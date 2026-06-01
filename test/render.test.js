const test = require('node:test');
const assert = require('node:assert/strict');

const {
  escapeHtml,
  renderError,
  renderHome,
  renderSalesByProjectDashboard,
  renderTable,
  renderWorkplaceAnalysisDashboard
} = require('../src/render');

test('escapeHtml escapes HTML content and attributes', () => {
  assert.equal(escapeHtml('<script>"&\''), '&lt;script&gt;&quot;&amp;&#39;');
});

test('renderHome shows database, escapes table names, and encodes table links', () => {
  const dangerousTable = '<script>"&\'';
  const tableWithUrlChars = 'raw events/table?day=1&ok=true';
  const html = renderHome({
    database: 'etl <main> & "quoted"',
    tables: ['events', dangerousTable, tableWithUrlChars]
  });

  assert.match(html, /Database: etl &lt;main&gt; &amp; &quot;quoted&quot;/);
  assert.match(html, /events/);
  assert.match(html, /&lt;script&gt;&quot;&amp;&#39;/);
  assert.match(
    html,
    new RegExp(`href="/tables\\?name=${escapeRegExp(encodeURIComponent(dangerousTable))}"`)
  );
  assert.match(
    html,
    new RegExp(`href="/tables\\?name=${escapeRegExp(encodeURIComponent(tableWithUrlChars))}"`)
  );
  assert.doesNotMatch(html, /<script>"&'/);
  assert.doesNotMatch(html, /raw events\/table\?day=1&ok=true/);
});

test('renderHome uses query links for dot-segment table names', () => {
  const html = renderHome({
    database: 'etl',
    tables: ['.', '..']
  });

  assert.match(html, /href="\/tables\?name=\."/);
  assert.match(html, /href="\/tables\?name=\.\."/);
  assert.doesNotMatch(html, /href="\/tables\/\."/);
  assert.doesNotMatch(html, /href="\/tables\/\.\."/);
});

test('renderHome renders an empty state when tables is empty', () => {
  const html = renderHome({
    database: 'etl',
    tables: []
  });

  assert.match(html, /No tables found/);
});

test('renderHome includes sidebar navigation with tables active', () => {
  const html = renderHome({
    database: 'etl',
    tables: ['mg_orders']
  });

  assert.match(html, /class="nav-link active" href="\/"/);
  assert.match(html, /Таблицы/);
  assert.match(html, /Продажи по проектам/);
  assert.match(html, /href="\/dashboards\/sales-by-project"/);
});

test('renderHome includes workplace analysis navigation', () => {
  const html = renderHome({
    database: 'etl',
    tables: ['mg_orders']
  });

  assert.match(html, /Анализ точек/);
  assert.match(html, /href="\/dashboards\/workplace-analysis"/);
});

test('renderTable escapes metadata and cells, formats complex values, and uses column order', () => {
  const html = renderTable({
    database: 'etl',
    tableName: '<events>"&\'',
    columns: [
      { name: '<id>', type: 'UInt64 & Int64', position: '<1>' },
      { name: 'payload', type: 'Object("<json>")', position: 2 },
      { name: 'missing', type: 'Nullable(String)', position: 3 }
    ],
    rows: [
      {
        payload: { html: '<img src=x onerror=alert(1)>', ok: true },
        '<id>': '<cell>"&\'',
        ignored: '<ignored>',
        missing: null
      },
      {
        '<id>': 7,
        payload: ['<array>', 'value'],
        missing: undefined
      }
    ]
  });

  assert.match(html, /&lt;events&gt;&quot;&amp;&#39;/);
  assert.match(html, /&lt;id&gt;/);
  assert.match(html, /UInt64 &amp; Int64/);
  assert.match(html, /&lt;1&gt;/);
  assert.match(html, /Object\(&quot;&lt;json&gt;&quot;\)/);
  assert.match(html, /&lt;cell&gt;&quot;&amp;&#39;/);
  assert.match(
    html,
    /{&quot;html&quot;:&quot;&lt;img src=x onerror=alert\(1\)&gt;&quot;,&quot;ok&quot;:true}/
  );
  assert.match(html, /\[&quot;&lt;array&gt;&quot;,&quot;value&quot;\]/);
  assert.equal(countOccurrences(html, '<span class="muted">NULL</span>'), 2);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<ignored>/);
  assert.ok(html.indexOf('&lt;id&gt;') < html.indexOf('payload'));
  assert.ok(html.indexOf('payload') < html.indexOf('missing'));
});

test('renderTable renders NULL for missing own row properties', () => {
  const html = renderTable({
    database: 'etl',
    tableName: 'prototype_safe',
    columns: [{ name: 'constructor', type: 'String', position: 1 }],
    rows: [{}]
  });

  assert.match(html, /<span class="muted">NULL<\/span>/);
  assert.doesNotMatch(html, /function Object/);
  assert.doesNotMatch(html, /\[native code\]/);
});

test('renderTable derives headers from rows when columns are empty', () => {
  const html = renderTable({
    database: 'etl',
    tableName: 'derived',
    columns: [],
    rows: [{ '<first>': 'one', second: 'two' }]
  });

  assert.match(html, /No columns found/);
  assert.match(html, /&lt;first&gt;/);
  assert.match(html, /second/);
  assert.match(html, /one/);
  assert.match(html, /two/);
});

test('renderTable shows empty states for no columns and no rows', () => {
  const html = renderTable({
    database: 'etl',
    tableName: 'empty_table',
    columns: [],
    rows: []
  });

  assert.match(html, /No columns found/);
  assert.match(html, /No preview rows/);
});

test('renderError escapes title and message', () => {
  const html = renderError({
    database: 'etl',
    title: 'Cannot <load> "tables"',
    message: '<b>failure</b> & "bad"'
  });

  assert.match(html, /Cannot &lt;load&gt; &quot;tables&quot;/);
  assert.match(html, /&lt;b&gt;failure&lt;\/b&gt; &amp; &quot;bad&quot;/);
  assert.doesNotMatch(html, /<b>failure<\/b>/);
});

test('renderError can keep dashboard navigation active', () => {
  const html = renderError({
    database: 'etl',
    title: 'Upstream Error',
    message: 'timeout',
    activeNav: 'sales-by-project'
  });

  assert.match(html, /class="nav-link active" href="\/dashboards\/sales-by-project"/);
  assert.doesNotMatch(html, /class="nav-link active" href="\/"/);
});

test('renderSalesByProjectDashboard escapes values and renders metrics', () => {
  const html = renderSalesByProjectDashboard({
    database: 'etl',
    dashboard: {
      filters: {
        period: 'month',
        from: '2026-04-01',
        to: '2026-04-30'
      },
      summary: {
        orderedShifts: 10,
        workedShifts: 8,
        slaPercent: 80,
        revenueRub: 12000,
        uniqueWorkers: 5,
        workplacesWithOrders: 3,
        workplacesWithWorkedShifts: 2,
        cancelledShifts: 1,
        selfBookingPercent: 50,
        avgWorkerRateHour: 250
      },
      trendRows: [
        {
          period: '2026-04-01',
          orderedShifts: 10,
          workedShifts: 8,
          slaPercent: 80,
          revenueRub: 12000,
          cancelledShifts: 1
        }
      ],
      brandRows: [
        {
          brand: '<script>bad</script>',
          orderedShifts: 10,
          workedShifts: 8,
          slaPercent: 80,
          revenueRub: 12000,
          uniqueWorkers: 5,
          workplacesWithOrders: 3,
          workplacesWithWorkedShifts: 2,
          cancelledShifts: 1,
          selfBookingPercent: 50,
          avgWorkerRateHour: 250
        }
      ],
      statusRows: [{ status: 'confirmed', shifts: 8 }]
    }
  });

  assert.match(html, /Продажи по проектам/);
  assert.match(html, /Заказано смен/);
  assert.match(html, /10/);
  assert.match(html, /SLA/);
  assert.match(html, /80\.0%/);
  assert.match(html, /12 000/);
  assert.match(html, /&lt;script&gt;bad&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>bad<\/script>/);
  assert.match(html, /class="nav-link active" href="\/dashboards\/sales-by-project"/);
});

test('renderSalesByProjectDashboard shows empty states', () => {
  const html = renderSalesByProjectDashboard({
    database: 'etl',
    dashboard: {
      filters: {
        period: 'day',
        from: '2026-04-01',
        to: '2026-04-02'
      },
      summary: {
        orderedShifts: 0,
        workedShifts: 0,
        slaPercent: 0,
        revenueRub: 0,
        uniqueWorkers: 0,
        workplacesWithOrders: 0,
        workplacesWithWorkedShifts: 0,
        cancelledShifts: 0,
        selfBookingPercent: 0,
        avgWorkerRateHour: 0
      },
      trendRows: [],
      brandRows: [],
      statusRows: []
    }
  });

  assert.match(html, /Нет данных за выбранный период/);
  assert.match(html, /value="2026-04-01"/);
  assert.match(html, /value="2026-04-02"/);
});

test('renderWorkplaceAnalysisDashboard renders filters, cards, heatmap, and escapes values', () => {
  const html = renderWorkplaceAnalysisDashboard({
    database: 'etl',
    dashboard: {
      filters: {
        from: '2026-06-01',
        to: '2026-06-03',
        rangeDays: 3,
        client: ['<script>client</script>', 'Brand A'],
        city: ['Москва'],
        region: [],
        profession: ['driver'],
        orderType: ['regular'],
        contractor: ['<script>contractor</script>'],
        search: '<script>search</script>',
        limit: 12
      },
      filterOptions: {
        client: ['<script>client</script>', 'Brand A', 'Brand B'],
        city: ['Москва', '<script>city option</script>'],
        region: ['Region A'],
        profession: ['driver', 'picker'],
        orderType: ['regular', 'once'],
        contractor: ['<script>contractor</script>', 'Contractor B']
      },
      context: {
        sortLabel: '<script>sort</script>',
        maxDailyAmount: 6
      },
      points: [
        {
          workplaceId: 'wp1',
          title: '<script>bad</script>',
          clientTitle: '<b>Бренд</b>',
          city: '<script>city</script>',
          region: '<em>region</em>',
          address: '<img src=x onerror=alert(1)>',
          totalOrderedShifts: 9,
          activeDays: 2,
          rangeDays: 3,
          stabilityPercent: 66.66666666666666,
          avgDailyOrder: 4.5,
          heatmapDays: [
            { date: '2026-06-01', amount: 3, level: 2 },
            { date: '2026-06-02', amount: 0, level: 0 },
            { date: '<script>date</script>', amount: 6, level: 4 }
          ]
        }
      ]
    }
  });

  assert.match(html, /Анализ точек/);
  assert.match(html, /class="nav-link active" href="\/dashboards\/workplace-analysis"/);
  assert.match(html, /value="2026-06-01"/);
  assert.match(html, /value="2026-06-03"/);
  assert.match(html, /name="limit"/);
  assert.match(html, /<select id="client" name="client" multiple/);
  assert.match(html, /<select id="city" name="city" multiple/);
  assert.match(html, /<select id="profession" name="profession" multiple/);
  assert.match(html, /<select id="orderType" name="orderType" multiple/);
  assert.match(html, /<option value="&lt;script&gt;client&lt;\/script&gt;" selected>&lt;script&gt;client&lt;\/script&gt;<\/option>/);
  assert.match(html, /<option value="Brand A" selected>Brand A<\/option>/);
  assert.match(html, /<option value="Brand B">Brand B<\/option>/);
  assert.match(html, /<option value="driver" selected>driver<\/option>/);
  assert.match(html, /<option value="once">Разовые<\/option>/);
  assert.match(html, /<option value="regular" selected>Регулярные<\/option>/);
  assert.match(html, /<option value="10">10<\/option>/);
  assert.match(html, /<option value="12" selected>12<\/option>/);
  assert.match(html, /<option value="20">20<\/option>/);
  assert.match(html, /<option value="50">50<\/option>/);
  assert.match(html, /value="12" selected/);
  assert.match(html, /&lt;script&gt;client&lt;\/script&gt;/);
  assert.match(html, /&lt;script&gt;sort&lt;\/script&gt;/);
  assert.match(html, /&lt;script&gt;contractor&lt;\/script&gt;/);
  assert.match(html, /&lt;script&gt;search&lt;\/script&gt;/);
  assert.match(html, /&lt;script&gt;bad&lt;\/script&gt;/);
  assert.match(html, /&lt;b&gt;Бренд&lt;\/b&gt;/);
  assert.match(html, /&lt;script&gt;city&lt;\/script&gt;/);
  assert.match(html, /&lt;em&gt;region&lt;\/em&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /title="&lt;script&gt;date&lt;\/script&gt;: 6"/);
  assert.doesNotMatch(html, /<script>sort<\/script>/);
  assert.doesNotMatch(html, /<script>contractor<\/script>/);
  assert.doesNotMatch(html, /<script>search<\/script>/);
  assert.doesNotMatch(html, /<script>bad<\/script>/);
  assert.doesNotMatch(html, /<b>Бренд<\/b>/);
  assert.doesNotMatch(html, /<script>city<\/script>/);
  assert.doesNotMatch(html, /<em>region<\/em>/);
  assert.doesNotMatch(html, /<img src=x onerror=alert\(1\)>/);
  assert.doesNotMatch(html, /<script>date<\/script>/);
  assert.match(html, /Заказано/);
  assert.match(html, /9/);
  assert.match(html, /66\.7%/);
  assert.match(html, /data-level="4"/);
});

test('renderWorkplaceAnalysisDashboard shows empty state', () => {
  const html = renderWorkplaceAnalysisDashboard({
    database: 'etl',
    dashboard: {
      filters: {
        from: '2026-06-01',
        to: '2026-06-03',
        rangeDays: 3,
        client: [],
        city: [],
        region: [],
        profession: [],
        orderType: [],
        contractor: [],
        search: '',
        limit: 12
      },
      filterOptions: {
        client: [],
        city: [],
        region: [],
        profession: [],
        orderType: [],
        contractor: []
      },
      context: {
        sortLabel: 'Сначала крупнейшие по заказу',
        maxDailyAmount: 0
      },
      points: []
    }
  });

  assert.match(html, /Нет точек с заказами за выбранный период/);
  assert.match(html, /value="2026-06-01"/);
});

function countOccurrences(text, needle) {
  return text.split(needle).length - 1;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
