const test = require('node:test');
const assert = require('node:assert/strict');

const {
  escapeHtml,
  renderError,
  renderHome,
  renderSalesByProjectDashboard,
  renderTable
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

function countOccurrences(text, needle) {
  return text.split(needle).length - 1;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
