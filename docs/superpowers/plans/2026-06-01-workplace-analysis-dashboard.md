# Workplace Analysis Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the "Анализ точек" dashboard that shows top MyGig workplaces by planned order volume and visualizes each workplace's daily `mg_orders.amount` as a GitHub-style heatmap.

**Architecture:** Keep the current Express + server-rendered HTML architecture. Add one focused data module for filters, safe ClickHouse queries, and heatmap model assembly; extend the shared renderer and navigation; wire one new Express route.

**Tech Stack:** Node.js 20, Express 4, built-in `node:test`, ClickHouse HTTP API via `ClickHouseClient.queryJSONEachRow`, plain HTML/CSS.

---

## File Structure

- Create `src/workplaceAnalysisDashboard.js`: owns filter normalization, date math, safe SQL fragments, ClickHouse loading, metric calculations, and heatmap model assembly.
- Create `test/workplaceAnalysisDashboard.test.js`: unit tests for filters, date range, SQL safety, merge logic, heatmap levels, and loader behavior.
- Modify `src/render.js`: add navigation item "Анализ точек", CSS for point cards and heatmaps, and `renderWorkplaceAnalysisDashboard`.
- Modify `test/render.test.js`: test navigation, dashboard rendering, escaping, heatmap cells, filters, and empty state.
- Modify `src/server.js`: import loader and renderer, add `GET /dashboards/workplace-analysis`.
- Modify `test/server.test.js`: add fake ClickHouse responses and route integration test.
- Modify `README.md`: document the new dashboard URL after implementation passes.

## Data Contract

`loadWorkplaceAnalysisDashboard(client, input, now)` returns:

```js
{
  filters: {
    from: '2026-06-01',
    to: '2026-06-15',
    fromDateTime: '2026-06-01 00:00:00',
    toExclusiveDateTime: '2026-06-16 00:00:00',
    rangeDays: 15,
    client: '',
    city: '',
    region: '',
    profession: '',
    orderType: '',
    contractor: '',
    search: '',
    limit: 12
  },
  context: {
    sortLabel: 'Сначала крупнейшие по заказу',
    maxDailyAmount: 7
  },
  points: [
    {
      workplaceId: 'wp1',
      title: 'Точка Ленина',
      clientTitle: 'Бренд',
      city: 'Москва',
      region: 'Москва',
      address: 'Москва, Ленина 10',
      totalOrderedShifts: 12,
      activeDays: 2,
      rangeDays: 15,
      stabilityPercent: 13.333333333333334,
      avgDailyOrder: 6,
      heatmapDays: [
        { date: '2026-06-01', amount: 5, level: 3 },
        { date: '2026-06-02', amount: 0, level: 0 }
      ]
    }
  ]
}
```

## Task 1: Data Module Filters And Heatmap Merge

**Files:**
- Create: `src/workplaceAnalysisDashboard.js`
- Create: `test/workplaceAnalysisDashboard.test.js`

- [ ] **Step 1: Write failing tests for filter normalization and heatmap merge**

Create `test/workplaceAnalysisDashboard.test.js` with:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDateKeys,
  heatmapLevel,
  mergeWorkplaceAnalysisRows,
  normalizeWorkplaceAnalysisFilters
} = require('../src/workplaceAnalysisDashboard');

test('normalizeWorkplaceAnalysisFilters defaults to the current month and whitelists limit and order type', () => {
  const filters = normalizeWorkplaceAnalysisFilters(
    {
      limit: '999',
      orderType: 'once; DROP TABLE mg_orders',
      client: '  Бренд  ',
      search: '<script>'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.deepEqual(filters, {
    from: '2026-06-01',
    to: '2026-06-15',
    fromDateTime: '2026-06-01 00:00:00',
    toExclusiveDateTime: '2026-06-16 00:00:00',
    rangeDays: 15,
    client: 'Бренд',
    city: '',
    region: '',
    profession: '',
    orderType: '',
    contractor: '',
    search: '<script>',
    limit: 12
  });
});

test('normalizeWorkplaceAnalysisFilters accepts valid dates, valid order type, and whitelisted limit', () => {
  const filters = normalizeWorkplaceAnalysisFilters(
    {
      from: '2026-04-01',
      to: '2026-04-30',
      orderType: 'regular',
      city: 'Казань',
      region: 'Татарстан',
      profession: 'picker',
      contractor: 'ООО Ромашка',
      limit: '20'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.equal(filters.from, '2026-04-01');
  assert.equal(filters.to, '2026-04-30');
  assert.equal(filters.toExclusiveDateTime, '2026-05-01 00:00:00');
  assert.equal(filters.rangeDays, 30);
  assert.equal(filters.orderType, 'regular');
  assert.equal(filters.city, 'Казань');
  assert.equal(filters.region, 'Татарстан');
  assert.equal(filters.profession, 'picker');
  assert.equal(filters.contractor, 'ООО Ромашка');
  assert.equal(filters.limit, 20);
});

test('buildDateKeys returns every inclusive date in the selected range', () => {
  assert.deepEqual(buildDateKeys('2026-06-01', '2026-06-04'), [
    '2026-06-01',
    '2026-06-02',
    '2026-06-03',
    '2026-06-04'
  ]);
});

test('heatmapLevel maps zero to level 0 and positive values to four intensity levels', () => {
  assert.equal(heatmapLevel(0, 10), 0);
  assert.equal(heatmapLevel(1, 10), 1);
  assert.equal(heatmapLevel(3, 10), 2);
  assert.equal(heatmapLevel(7, 10), 3);
  assert.equal(heatmapLevel(10, 10), 4);
});

test('mergeWorkplaceAnalysisRows calculates stability and fills missing heatmap days', () => {
  const filters = normalizeWorkplaceAnalysisFilters(
    {
      from: '2026-06-01',
      to: '2026-06-03'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  const dashboard = mergeWorkplaceAnalysisRows(
    filters,
    [
      {
        workplace_id: 'wp1',
        workplace_title: '',
        technical_name: 'tech-1',
        client_title: 'Бренд <A>',
        city: 'Москва',
        region: 'Москва',
        street: 'Ленина 10',
        total_ordered_shifts: 9,
        active_days: 2
      }
    ],
    [
      { workplace_id: 'wp1', order_date: '2026-06-01', ordered_shifts: 3 },
      { workplace_id: 'wp1', order_date: '2026-06-03', ordered_shifts: 6 }
    ]
  );

  assert.equal(dashboard.context.maxDailyAmount, 6);
  assert.equal(dashboard.points.length, 1);
  assert.equal(dashboard.points[0].title, 'tech-1');
  assert.equal(dashboard.points[0].clientTitle, 'Бренд <A>');
  assert.equal(dashboard.points[0].address, 'Москва, Ленина 10');
  assert.equal(dashboard.points[0].totalOrderedShifts, 9);
  assert.equal(dashboard.points[0].activeDays, 2);
  assert.equal(dashboard.points[0].rangeDays, 3);
  assert.equal(dashboard.points[0].stabilityPercent, 66.66666666666666);
  assert.equal(dashboard.points[0].avgDailyOrder, 4.5);
  assert.deepEqual(dashboard.points[0].heatmapDays, [
    { date: '2026-06-01', amount: 3, level: 2 },
    { date: '2026-06-02', amount: 0, level: 0 },
    { date: '2026-06-03', amount: 6, level: 4 }
  ]);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
npm test -- test/workplaceAnalysisDashboard.test.js
```

Expected: fail with `Cannot find module '../src/workplaceAnalysisDashboard'`.

- [ ] **Step 3: Implement filter and merge helpers**

Create `src/workplaceAnalysisDashboard.js` with:

```js
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_LIMIT = 12;
const ALLOWED_LIMITS = new Set([10, 12, 20, 50]);
const ALLOWED_ORDER_TYPES = new Set(['once', 'regular']);

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatDateUTC(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function parseDateOnly(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime()) || formatDateUTC(date) !== value) {
    return null;
  }

  return date;
}

function addDaysUTC(date, days) {
  const next = new Date(date.getTime());

  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function firstDayOfMonthUTC(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function toDateTimeParam(dateOnly) {
  return `${dateOnly} 00:00:00`;
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeLimit(value) {
  const limit = Number(value);

  return Number.isInteger(limit) && ALLOWED_LIMITS.has(limit) ? limit : DEFAULT_LIMIT;
}

function normalizeWorkplaceAnalysisFilters(input = {}, now = new Date()) {
  const today = parseDateOnly(formatDateUTC(now));
  const defaultFromDate = firstDayOfMonthUTC(today);
  const requestedFrom = parseDateOnly(input.from);
  const requestedTo = parseDateOnly(input.to);
  let fromDate = requestedFrom || defaultFromDate;
  let toDate = requestedTo || today;

  if (fromDate.getTime() > toDate.getTime()) {
    fromDate = defaultFromDate;
    toDate = today;
  }

  const from = formatDateUTC(fromDate);
  const to = formatDateUTC(toDate);
  const toExclusive = formatDateUTC(addDaysUTC(toDate, 1));
  const orderType = cleanText(input.orderType);

  return {
    from,
    to,
    fromDateTime: toDateTimeParam(from),
    toExclusiveDateTime: toDateTimeParam(toExclusive),
    rangeDays: buildDateKeys(from, to).length,
    client: cleanText(input.client),
    city: cleanText(input.city),
    region: cleanText(input.region),
    profession: cleanText(input.profession),
    orderType: ALLOWED_ORDER_TYPES.has(orderType) ? orderType : '',
    contractor: cleanText(input.contractor),
    search: cleanText(input.search),
    limit: normalizeLimit(input.limit)
  };
}

function buildDateKeys(from, to) {
  const start = parseDateOnly(from);
  const end = parseDateOnly(to);
  const dates = [];

  for (let current = start; current.getTime() <= end.getTime(); current = addDaysUTC(current, 1)) {
    dates.push(formatDateUTC(current));
  }

  return dates;
}

function numberValue(value) {
  const number = Number(value || 0);

  return Number.isFinite(number) ? number : 0;
}

function percent(numerator, denominator) {
  const bottom = numberValue(denominator);

  if (bottom <= 0) {
    return 0;
  }

  return (numberValue(numerator) / bottom) * 100;
}

function heatmapLevel(amount, maxAmount) {
  const value = numberValue(amount);
  const max = numberValue(maxAmount);

  if (value <= 0 || max <= 0) {
    return 0;
  }

  const ratio = value / max;

  if (ratio <= 0.25) {
    return 1;
  }
  if (ratio <= 0.5) {
    return 2;
  }
  if (ratio <= 0.75) {
    return 3;
  }

  return 4;
}

function titleForPoint(row) {
  return String(row.workplace_title || row.technical_name || row.workplace_id || 'Без названия');
}

function compactAddress(row) {
  return [row.city, row.street].map((part) => String(part || '').trim()).filter(Boolean).join(', ');
}

function mergeWorkplaceAnalysisRows(filters, workplaceRows, dailyRows) {
  const dateKeys = buildDateKeys(filters.from, filters.to);
  const dailyByWorkplace = new Map();
  let maxDailyAmount = 0;

  for (const row of dailyRows) {
    const workplaceId = String(row.workplace_id || '');
    const date = String(row.order_date || '');
    const amount = numberValue(row.ordered_shifts);

    if (!dailyByWorkplace.has(workplaceId)) {
      dailyByWorkplace.set(workplaceId, new Map());
    }

    dailyByWorkplace.get(workplaceId).set(date, amount);
    maxDailyAmount = Math.max(maxDailyAmount, amount);
  }

  const points = workplaceRows.map((row) => {
    const workplaceId = String(row.workplace_id || '');
    const activeDays = numberValue(row.active_days);
    const totalOrderedShifts = numberValue(row.total_ordered_shifts);
    const dailyAmounts = dailyByWorkplace.get(workplaceId) || new Map();
    const heatmapDays = dateKeys.map((date) => {
      const amount = numberValue(dailyAmounts.get(date));

      return {
        date,
        amount,
        level: heatmapLevel(amount, maxDailyAmount)
      };
    });

    return {
      workplaceId,
      title: titleForPoint(row),
      clientTitle: String(row.client_title || 'Без бренда'),
      city: String(row.city || ''),
      region: String(row.region || ''),
      address: compactAddress(row),
      totalOrderedShifts,
      activeDays,
      rangeDays: filters.rangeDays,
      stabilityPercent: percent(activeDays, filters.rangeDays),
      avgDailyOrder: activeDays > 0 ? totalOrderedShifts / activeDays : 0,
      heatmapDays
    };
  });

  return {
    filters,
    context: {
      sortLabel: 'Сначала крупнейшие по заказу',
      maxDailyAmount
    },
    points
  };
}

async function loadWorkplaceAnalysisDashboard() {
  throw new Error('loadWorkplaceAnalysisDashboard is not implemented yet');
}

module.exports = {
  buildDateKeys,
  heatmapLevel,
  loadWorkplaceAnalysisDashboard,
  mergeWorkplaceAnalysisRows,
  normalizeWorkplaceAnalysisFilters
};
```

- [ ] **Step 4: Run focused tests and verify helper tests pass**

Run:

```powershell
npm test -- test/workplaceAnalysisDashboard.test.js
```

Expected: all tests in `test/workplaceAnalysisDashboard.test.js` pass.

- [ ] **Step 5: Commit**

Run:

```powershell
git add src/workplaceAnalysisDashboard.js test/workplaceAnalysisDashboard.test.js
git commit -m "feat: add workplace analysis dashboard model"
```

## Task 2: Safe ClickHouse Loader

**Files:**
- Modify: `src/workplaceAnalysisDashboard.js`
- Modify: `test/workplaceAnalysisDashboard.test.js`

- [ ] **Step 1: Add failing loader test**

Append this test to `test/workplaceAnalysisDashboard.test.js`:

```js
const { loadWorkplaceAnalysisDashboard } = require('../src/workplaceAnalysisDashboard');

test('loadWorkplaceAnalysisDashboard queries top workplaces and daily orders with safe parameters', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'workplace analysis top workplaces') {
        return [
          {
            workplace_id: 'wp1',
            workplace_title: 'Точка',
            technical_name: 'tech',
            client_title: 'Бренд',
            city: 'Москва',
            region: 'Москва',
            street: 'Ленина 10',
            total_ordered_shifts: 9,
            active_days: 2
          }
        ];
      }

      if (operation === 'workplace analysis daily orders') {
        return [
          { workplace_id: 'wp1', order_date: '2026-06-01', ordered_shifts: 3 },
          { workplace_id: 'wp1', order_date: '2026-06-03', ordered_shifts: 6 }
        ];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  };

  const dashboard = await loadWorkplaceAnalysisDashboard(
    client,
    {
      from: '2026-06-01',
      to: '2026-06-03',
      client: 'Бренд',
      city: 'Москва',
      region: 'Москва',
      profession: 'Комплектовщик',
      orderType: 'regular',
      contractor: 'Ромашка',
      search: 'Ленина'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.equal(dashboard.points.length, 1);
  assert.equal(dashboard.points[0].totalOrderedShifts, 9);
  assert.equal(dashboard.points[0].heatmapDays.length, 3);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].operation, 'workplace analysis top workplaces');
  assert.equal(calls[1].operation, 'workplace analysis daily orders');

  for (const call of calls) {
    assert.equal(call.params.param_from, '2026-06-01 00:00:00');
    assert.equal(call.params.param_to, '2026-06-04 00:00:00');
    assert.equal(call.params.param_client, 'Бренд');
    assert.equal(call.params.param_city, 'Москва');
    assert.equal(call.params.param_region, 'Москва');
    assert.equal(call.params.param_profession, 'Комплектовщик');
    assert.equal(call.params.param_order_type, 'regular');
    assert.equal(call.params.param_contractor, 'Ромашка');
    assert.equal(call.params.param_search, 'Ленина');
    assert.equal(call.query.includes('DROP TABLE'), false);
    assert.equal(call.query.includes('{limit:UInt64}'), true);
  }
});
```

- [ ] **Step 2: Run focused test and verify it fails**

Run:

```powershell
npm test -- test/workplaceAnalysisDashboard.test.js
```

Expected: fail with `loadWorkplaceAnalysisDashboard is not implemented yet`.

- [ ] **Step 3: Implement SQL builders and loader**

Modify `src/workplaceAnalysisDashboard.js`.

Add these helpers above `loadWorkplaceAnalysisDashboard`:

```js
function addOptionalWhere(filters, where, params) {
  if (filters.client) {
    where.push('c.title = {client:String}');
    params.param_client = filters.client;
  }
  if (filters.city) {
    where.push('w.address__city = {city:String}');
    params.param_city = filters.city;
  }
  if (filters.region) {
    where.push('w.address__region = {region:String}');
    params.param_region = filters.region;
  }
  if (filters.profession) {
    where.push("(o.spec = {profession:String} OR positionCaseInsensitive(ifNull(p.caption, ''), {profession:String}) > 0)");
    params.param_profession = filters.profession;
  }
  if (filters.orderType) {
    where.push('o.type = {order_type:String}');
    params.param_order_type = filters.orderType;
  }
  if (filters.contractor) {
    where.push("(ct._id = {contractor:String} OR positionCaseInsensitive(ifNull(ct.legal_name, ''), {contractor:String}) > 0)");
    params.param_contractor = filters.contractor;
  }
  if (filters.search) {
    where.push(`(
      positionCaseInsensitive(ifNull(w.title, ''), {search:String}) > 0
      OR positionCaseInsensitive(ifNull(w.technical_name, ''), {search:String}) > 0
      OR positionCaseInsensitive(ifNull(w.address__city, ''), {search:String}) > 0
      OR positionCaseInsensitive(ifNull(w.address__region, ''), {search:String}) > 0
      OR positionCaseInsensitive(ifNull(w.address__street, ''), {search:String}) > 0
    )`);
    params.param_search = filters.search;
  }
}

function paramsForFilters(filters) {
  const params = {
    param_from: filters.fromDateTime,
    param_to: filters.toExclusiveDateTime,
    param_limit: filters.limit
  };
  const where = [
    'o.deleted = 0',
    'o.start >= {from:DateTime}',
    'o.start < {to:DateTime}',
    "ifNull(o.workplace, '') != ''",
    'ifNull(o.amount, 0) > 0'
  ];

  addOptionalWhere(filters, where, params);

  return {
    params,
    whereSql: where.join('\n    AND ')
  };
}

function topWorkplacesSelect(whereSql) {
  return `SELECT
    o.workplace AS workplace_id,
    ifNull(any(w.title), '') AS workplace_title,
    ifNull(any(w.technical_name), '') AS technical_name,
    ifNull(any(c.title), 'Без бренда') AS client_title,
    ifNull(any(w.address__city), '') AS city,
    ifNull(any(w.address__region), '') AS region,
    ifNull(any(w.address__street), '') AS street,
    sum(ifNull(o.amount, 0)) AS total_ordered_shifts,
    countDistinct(toDate(o.start)) AS active_days
  FROM mg_orders AS o
  LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
  LEFT JOIN mg_clients AS c ON o.client = c._id
  LEFT JOIN mg_professions AS p ON o.spec = p.spec
  LEFT JOIN mg_contractors AS ct ON w.contractor = ct._id
  WHERE ${whereSql}
  GROUP BY workplace_id
  ORDER BY total_ordered_shifts DESC
  LIMIT {limit:UInt64}`;
}

function topWorkplacesQuery(whereSql) {
  return `${topWorkplacesSelect(whereSql)}
  FORMAT JSONEachRow`;
}

function dailyOrdersQuery(whereSql) {
  return `WITH top_workplaces AS (
    ${topWorkplacesSelect(whereSql)}
  )
  SELECT
    o.workplace AS workplace_id,
    toString(toDate(o.start)) AS order_date,
    sum(ifNull(o.amount, 0)) AS ordered_shifts
  FROM mg_orders AS o
  LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
  LEFT JOIN mg_clients AS c ON o.client = c._id
  LEFT JOIN mg_professions AS p ON o.spec = p.spec
  LEFT JOIN mg_contractors AS ct ON w.contractor = ct._id
  INNER JOIN top_workplaces AS tw ON o.workplace = tw.workplace_id
  WHERE ${whereSql}
  GROUP BY workplace_id, order_date
  ORDER BY workplace_id, order_date
  FORMAT JSONEachRow`;
}
```

Replace `loadWorkplaceAnalysisDashboard` with:

```js
async function loadWorkplaceAnalysisDashboard(client, input = {}, now = new Date()) {
  const filters = normalizeWorkplaceAnalysisFilters(input, now);
  const { params, whereSql } = paramsForFilters(filters);
  const [workplaceRows, dailyRows] = await Promise.all([
    client.queryJSONEachRow(
      topWorkplacesQuery(whereSql),
      params,
      'workplace analysis top workplaces'
    ),
    client.queryJSONEachRow(
      dailyOrdersQuery(whereSql),
      params,
      'workplace analysis daily orders'
    )
  ]);

  return mergeWorkplaceAnalysisRows(filters, workplaceRows, dailyRows);
}
```

Update `module.exports` to export the loader only once:

```js
module.exports = {
  buildDateKeys,
  heatmapLevel,
  loadWorkplaceAnalysisDashboard,
  mergeWorkplaceAnalysisRows,
  normalizeWorkplaceAnalysisFilters
};
```

- [ ] **Step 4: Run focused tests and verify they pass**

Run:

```powershell
npm test -- test/workplaceAnalysisDashboard.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

Run:

```powershell
git add src/workplaceAnalysisDashboard.js test/workplaceAnalysisDashboard.test.js
git commit -m "feat: load workplace analysis dashboard data"
```

## Task 3: Dashboard Renderer And Navigation

**Files:**
- Modify: `src/render.js`
- Modify: `test/render.test.js`

- [ ] **Step 1: Add failing renderer tests**

Modify the import in `test/render.test.js`:

```js
const {
  escapeHtml,
  renderError,
  renderHome,
  renderSalesByProjectDashboard,
  renderTable,
  renderWorkplaceAnalysisDashboard
} = require('../src/render');
```

Append these tests:

```js
test('renderHome includes workplace analysis navigation', () => {
  const html = renderHome({
    database: 'etl',
    tables: ['mg_orders']
  });

  assert.match(html, /Анализ точек/);
  assert.match(html, /href="\/dashboards\/workplace-analysis"/);
});

test('renderWorkplaceAnalysisDashboard renders filters, cards, heatmap, and escapes values', () => {
  const html = renderWorkplaceAnalysisDashboard({
    database: 'etl',
    dashboard: {
      filters: {
        from: '2026-06-01',
        to: '2026-06-03',
        rangeDays: 3,
        client: '<script>client</script>',
        city: 'Москва',
        region: '',
        profession: '',
        orderType: 'regular',
        contractor: '',
        search: 'Ленина',
        limit: 12
      },
      context: {
        sortLabel: 'Сначала крупнейшие по заказу',
        maxDailyAmount: 6
      },
      points: [
        {
          workplaceId: 'wp1',
          title: '<script>bad</script>',
          clientTitle: 'Бренд',
          city: 'Москва',
          region: 'Москва',
          address: 'Москва, Ленина 10',
          totalOrderedShifts: 9,
          activeDays: 2,
          rangeDays: 3,
          stabilityPercent: 66.66666666666666,
          avgDailyOrder: 4.5,
          heatmapDays: [
            { date: '2026-06-01', amount: 3, level: 2 },
            { date: '2026-06-02', amount: 0, level: 0 },
            { date: '2026-06-03', amount: 6, level: 4 }
          ]
        }
      ]
    }
  });

  assert.match(html, /Анализ точек/);
  assert.match(html, /class="nav-link active" href="\/dashboards\/workplace-analysis"/);
  assert.match(html, /value="2026-06-01"/);
  assert.match(html, /value="2026-06-03"/);
  assert.match(html, /&lt;script&gt;client&lt;\/script&gt;/);
  assert.match(html, /&lt;script&gt;bad&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>bad<\/script>/);
  assert.match(html, /Заказано/);
  assert.match(html, /9/);
  assert.match(html, /66\.7%/);
  assert.match(html, /data-level="4"/);
  assert.match(html, /title="2026-06-03: 6"/);
});

test('renderWorkplaceAnalysisDashboard shows empty state', () => {
  const html = renderWorkplaceAnalysisDashboard({
    database: 'etl',
    dashboard: {
      filters: {
        from: '2026-06-01',
        to: '2026-06-03',
        rangeDays: 3,
        client: '',
        city: '',
        region: '',
        profession: '',
        orderType: '',
        contractor: '',
        search: '',
        limit: 12
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
```

- [ ] **Step 2: Run renderer tests and verify they fail**

Run:

```powershell
npm test -- test/render.test.js
```

Expected: fail because `renderWorkplaceAnalysisDashboard` is missing and navigation lacks the new item.

- [ ] **Step 3: Add navigation item**

In `src/render.js`, inside `.nav-list`, add this link after "Продажи по проектам":

```js
        ${navLink({
          href: '/dashboards/workplace-analysis',
          label: 'Анализ точек',
          id: 'workplace-analysis',
          activeNav
        })}
```

- [ ] **Step 4: Add CSS for cards and heatmap**

In the `<style>` block in `src/render.js`, add these rules before the first `@media` block:

```css
    .context-line {
      margin-top: 8px;
      color: var(--muted);
      font-size: 14px;
    }

    .points-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 12px;
    }

    .point-card {
      min-width: 0;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
    }

    .point-card-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 8px;
    }

    .point-title {
      font-weight: 700;
      line-height: 1.25;
      overflow-wrap: anywhere;
    }

    .stability-badge {
      flex: 0 0 auto;
      border-radius: 999px;
      padding: 2px 7px;
      background: var(--accent-bg);
      color: var(--accent);
      font-size: 12px;
      font-weight: 700;
      white-space: nowrap;
    }

    .point-subtitle {
      min-height: 40px;
      margin-bottom: 10px;
      color: var(--muted);
      font-size: 13px;
      overflow-wrap: anywhere;
    }

    .point-metrics {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6px;
      margin-bottom: 10px;
    }

    .point-metric {
      min-width: 0;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 6px;
      background: #fbfcfd;
    }

    .point-metric-label {
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
    }

    .point-metric-value {
      margin-top: 2px;
      font-size: 15px;
      font-weight: 700;
      overflow-wrap: anywhere;
    }

    .heatmap {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(10px, 1fr));
      gap: 3px;
      align-items: center;
    }

    .heatmap-cell {
      aspect-ratio: 1;
      min-width: 10px;
      border-radius: 2px;
      background: #e5e7eb;
    }

    .heatmap-cell[data-level="1"] { background: #bfdbfe; }
    .heatmap-cell[data-level="2"] { background: #60a5fa; }
    .heatmap-cell[data-level="3"] { background: #2563eb; }
    .heatmap-cell[data-level="4"] { background: #1d4ed8; }

    .heatmap-legend {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 5px;
      margin-top: 8px;
      color: var(--muted);
      font-size: 12px;
    }

    .legend-cell {
      width: 10px;
      height: 10px;
      border-radius: 2px;
      background: #e5e7eb;
    }

    .legend-cell[data-level="1"] { background: #bfdbfe; }
    .legend-cell[data-level="2"] { background: #60a5fa; }
    .legend-cell[data-level="3"] { background: #2563eb; }
    .legend-cell[data-level="4"] { background: #1d4ed8; }
```

- [ ] **Step 5: Add renderer helpers**

In `src/render.js`, add these helpers above `renderError`:

```js
function renderOrderTypeOptions(selectedType) {
  const options = [
    ['', 'Все'],
    ['once', 'Разовые'],
    ['regular', 'Регулярные']
  ];

  return options
    .map(([value, label]) => {
      const selected = value === selectedType ? ' selected' : '';

      return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(label)}</option>`;
    })
    .join('');
}

function renderPointMetric(label, value) {
  return `<div class="point-metric">
  <div class="point-metric-label">${escapeHtml(label)}</div>
  <div class="point-metric-value">${escapeHtml(value)}</div>
</div>`;
}

function renderHeatmap(days) {
  const cells = days
    .map(
      (day) =>
        `<span class="heatmap-cell" data-level="${escapeHtml(day.level)}" title="${escapeHtml(`${day.date}: ${formatNumber(day.amount)}`)}"></span>`
    )
    .join('');

  return `<div class="heatmap" aria-label="Календарь заказов">${cells}</div>
<div class="heatmap-legend">
  <span>Меньше</span>
  <span class="legend-cell" data-level="0"></span>
  <span class="legend-cell" data-level="1"></span>
  <span class="legend-cell" data-level="2"></span>
  <span class="legend-cell" data-level="3"></span>
  <span class="legend-cell" data-level="4"></span>
  <span>Больше</span>
</div>`;
}

function renderPointCard(point) {
  const subtitle = [point.clientTitle, point.city, point.region, point.address]
    .filter((value) => String(value || '').trim() !== '')
    .join(' · ');

  return `<article class="point-card">
  <div class="point-card-head">
    <div class="point-title">${escapeHtml(point.title)}</div>
    <div class="stability-badge">${escapeHtml(formatPercent(point.stabilityPercent))}</div>
  </div>
  <div class="point-subtitle">${escapeHtml(subtitle || 'Без адреса')}</div>
  <div class="point-metrics">
    ${renderPointMetric('Заказано', formatNumber(point.totalOrderedShifts))}
    ${renderPointMetric('Активные дни', `${formatNumber(point.activeDays)} / ${formatNumber(point.rangeDays)}`)}
    ${renderPointMetric('Среднее', formatNumber(point.avgDailyOrder, 1))}
  </div>
  ${renderHeatmap(point.heatmapDays)}
</article>`;
}

function renderPointCards(points) {
  if (points.length === 0) {
    return '<p class="empty">Нет точек с заказами за выбранный период.</p>';
  }

  return `<div class="points-grid">${points.map(renderPointCard).join('')}</div>`;
}
```

- [ ] **Step 6: Add dashboard renderer**

Add this function above `renderError`:

```js
function renderWorkplaceAnalysisDashboard({ database, dashboard }) {
  const filters = dashboard.filters;
  const content = `<section class="section">
  <h1>Анализ точек</h1>
  <p class="technical-note">Стабильность = доля дней с плановым заказом по mg_orders.amount.</p>
  <p class="context-line">Период: ${escapeHtml(filters.from)} - ${escapeHtml(filters.to)} · дней: ${escapeHtml(filters.rangeDays)} · ${escapeHtml(dashboard.context.sortLabel)}</p>
</section>
<section class="section">
  <form class="filter-bar" action="/dashboards/workplace-analysis" method="get">
    <div class="field">
      <label for="from">С</label>
      <input id="from" name="from" type="date" value="${escapeHtml(filters.from)}">
    </div>
    <div class="field">
      <label for="to">По</label>
      <input id="to" name="to" type="date" value="${escapeHtml(filters.to)}">
    </div>
    <div class="field">
      <label for="client">Бренд</label>
      <input id="client" name="client" value="${escapeHtml(filters.client)}">
    </div>
    <div class="field">
      <label for="city">Город</label>
      <input id="city" name="city" value="${escapeHtml(filters.city)}">
    </div>
    <div class="field">
      <label for="region">Регион</label>
      <input id="region" name="region" value="${escapeHtml(filters.region)}">
    </div>
    <div class="field">
      <label for="profession">Специальность</label>
      <input id="profession" name="profession" value="${escapeHtml(filters.profession)}">
    </div>
    <div class="field">
      <label for="orderType">Тип заказа</label>
      <select id="orderType" name="orderType">${renderOrderTypeOptions(filters.orderType)}</select>
    </div>
    <div class="field">
      <label for="contractor">Контрагент</label>
      <input id="contractor" name="contractor" value="${escapeHtml(filters.contractor)}">
    </div>
    <div class="field">
      <label for="search">Поиск точки</label>
      <input id="search" name="search" value="${escapeHtml(filters.search)}">
    </div>
    <button type="submit">Применить</button>
  </form>
</section>
<section class="section">
  ${renderPointCards(dashboard.points)}
</section>`;

  return layout({
    title: 'Анализ точек',
    database,
    content,
    activeNav: 'workplace-analysis'
  });
}
```

- [ ] **Step 7: Export renderer**

Update `module.exports` in `src/render.js`:

```js
module.exports = {
  escapeHtml,
  renderError,
  renderHome,
  renderSalesByProjectDashboard,
  renderTable,
  renderWorkplaceAnalysisDashboard
};
```

- [ ] **Step 8: Run renderer tests**

Run:

```powershell
npm test -- test/render.test.js
```

Expected: all tests in `test/render.test.js` pass.

- [ ] **Step 9: Commit**

Run:

```powershell
git add src/render.js test/render.test.js
git commit -m "feat: render workplace analysis dashboard"
```

## Task 4: Express Route Integration

**Files:**
- Modify: `src/server.js`
- Modify: `test/server.test.js`

- [ ] **Step 1: Add fake client responses**

In `test/server.test.js`, inside `createFakeClient().queryJSONEachRow`, add these branches before `return []`:

```js
      if (operation === 'workplace analysis top workplaces') {
        return [
          {
            workplace_id: 'wp1',
            workplace_title: 'Точка',
            technical_name: 'tech',
            client_title: 'Бренд',
            city: 'Москва',
            region: 'Москва',
            street: 'Ленина 10',
            total_ordered_shifts: 9,
            active_days: 2
          }
        ];
      }

      if (operation === 'workplace analysis daily orders') {
        return [
          { workplace_id: 'wp1', order_date: '2026-06-01', ordered_shifts: 3 },
          { workplace_id: 'wp1', order_date: '2026-06-03', ordered_shifts: 6 }
        ];
      }
```

- [ ] **Step 2: Add failing route test**

Append this test to `test/server.test.js`:

```js
test('GET /dashboards/workplace-analysis renders dashboard', async () => {
  const client = createFakeClient();

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(
      baseUrl,
      '/dashboards/workplace-analysis?from=2026-06-01&to=2026-06-03&city=Москва&orderType=regular'
    );

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html\b/);
    assert.match(text, /Анализ точек/);
    assert.match(text, /Точка/);
    assert.match(text, /Заказано/);
    assert.match(text, /66\.7%/);
  });

  assert.equal(
    client.calls.filter((call) => call[0] === 'queryJSONEachRow' && String(call[1]).startsWith('workplace analysis')).length,
    2
  );
});
```

- [ ] **Step 3: Run server tests and verify failure**

Run:

```powershell
npm test -- test/server.test.js
```

Expected: fail because `/dashboards/workplace-analysis` returns 404.

- [ ] **Step 4: Wire route in `src/server.js`**

Add imports:

```js
const { loadWorkplaceAnalysisDashboard } = require('./workplaceAnalysisDashboard');
```

Extend the renderer import:

```js
const {
  renderError,
  renderHome,
  renderSalesByProjectDashboard,
  renderTable,
  renderWorkplaceAnalysisDashboard
} = require('./render');
```

Add this route after `/dashboards/sales-by-project` and before `/tables`:

```js
  app.get(
    '/dashboards/workplace-analysis',
    asyncRoute(async (req, res) => {
      const dashboard = await loadWorkplaceAnalysisDashboard(client, req.query);

      res
        .status(200)
        .type('html')
        .send(renderWorkplaceAnalysisDashboard({ database, dashboard }));
    })
  );
```

- [ ] **Step 5: Run server tests**

Run:

```powershell
npm test -- test/server.test.js
```

Expected: all tests in `test/server.test.js` pass.

- [ ] **Step 6: Commit**

Run:

```powershell
git add src/server.js test/server.test.js
git commit -m "feat: expose workplace analysis dashboard"
```

## Task 5: Documentation And Full Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document dashboard capability**

In `README.md`, add this bullet to the first-iteration capabilities:

```md
- показывать дашборд `Анализ точек` для оценки стабильности планового заказа по рабочим местам MyGig;
```

In the `## Дашборды` section, add:

```md
- `http://localhost:3000/dashboards/workplace-analysis` - дашборд `Анализ точек`.
```

If the `## Дашборды` section is missing, add it after `## Контекст данных`:

```md
## Дашборды

Доступные экраны:

- `http://localhost:3000/` - список таблиц и просмотр структуры данных;
- `http://localhost:3000/dashboards/sales-by-project` - дашборд `Продажи по проектам`;
- `http://localhost:3000/dashboards/workplace-analysis` - дашборд `Анализ точек`.

В дашбордах по умолчанию используются таблицы `mg_*`. В `Анализе точек` стабильность считается как доля дней с плановым заказом по `mg_orders.amount`.
```

- [ ] **Step 2: Run full test suite**

Run:

```powershell
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Start local server for manual HTML verification**

If ClickHouse environment variables are available, run:

```powershell
npm start
```

Expected: server logs `ETL Analytics listening on port 3000` or the configured port.

If environment variables are not available, skip the live ClickHouse check and record that only automated tests were run.

- [ ] **Step 4: Browser verification**

Open:

```text
http://127.0.0.1:3000/dashboards/workplace-analysis
```

Verify:

- page title is `Анализ точек`;
- left navigation includes `Анализ точек` and marks it active;
- filters fit without overlap;
- cards render as a grid;
- heatmap cells are visible;
- no phone, email, full name, INN, passport data, or worker data appears.

- [ ] **Step 5: Commit docs**

Run:

```powershell
git add README.md
git commit -m "docs: document workplace analysis dashboard"
```

## Self-Review Checklist

- Spec coverage: tasks cover route, filters, top 12 workplaces, heatmap cards, stability metric, default current-month range, no empty workplaces, SQL safety, renderer, route tests, docs, and manual verification.
- TDD coverage: every production change has a failing test step before implementation.
- Query safety: user text is only passed through ClickHouse parameters; `orderType` and `limit` are whitelisted; no arbitrary SQL input is introduced.
- PII safety: dashboard renders only workplace, brand, location, address fragments, and aggregates.
- Type consistency: plan consistently uses `workplaceId`, `totalOrderedShifts`, `activeDays`, `rangeDays`, `stabilityPercent`, `avgDailyOrder`, and `heatmapDays`.
