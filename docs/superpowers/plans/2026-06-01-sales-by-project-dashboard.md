# Sales By Project Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first MyGig analytics dashboard, "Продажи по проектам", with left navigation, server-rendered metrics, period dynamics, brand breakdowns, status breakdowns, and safe ClickHouse queries over `mg_*`.

**Architecture:** Keep the current Express + server-rendered HTML architecture. Add one data module that owns dashboard filters and ClickHouse queries, extend the renderer with a shared left sidebar and dashboard page, then wire a new Express route to the data module.

**Tech Stack:** Node.js 20, Express 4, built-in `node:test`, ClickHouse HTTP API over the existing `ClickHouseClient`, plain HTML/CSS with inline SVG or CSS bars.

---

## File Structure

- Modify `src/clickhouseClient.js`: add a small `queryJSONEachRow` helper so dashboard code can request parsed rows without duplicating parsing.
- Create `src/salesByProjectDashboard.js`: validate filters, build whitelisted period expressions, query `mg_orders`, `mg_job_history`, `mg_clients`, `mg_workplaces`, `mg_contractors`, `mg_transactions`, and merge rows into a render-ready dashboard model.
- Modify `src/render.js`: add shared sidebar layout and `renderSalesByProjectDashboard`.
- Modify `src/server.js`: import dashboard loader/renderer and add `/dashboards/sales-by-project`.
- Create `test/salesByProjectDashboard.test.js`: unit-test filter validation, query parameter safety, and data merging.
- Modify `test/clickhouseClient.test.js`: cover `queryJSONEachRow`.
- Modify `test/render.test.js`: cover sidebar, active navigation, dashboard escaping, empty states.
- Modify `test/server.test.js`: cover route integration and sanitized error behavior.
- Modify `README.md`: mention the dashboard URL after implementation is verified.

## Data Contracts

`loadSalesByProjectDashboard(client, input)` returns:

```js
{
  filters: {
    period: 'day' | 'week' | 'month' | 'quarter',
    from: 'YYYY-MM-DD',
    to: 'YYYY-MM-DD',
    fromDateTime: 'YYYY-MM-DD 00:00:00',
    toExclusiveDateTime: 'YYYY-MM-DD 00:00:00'
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
  trendRows: [
    {
      period: '2026-04-01',
      orderedShifts: 0,
      workedShifts: 0,
      slaPercent: 0,
      revenueRub: 0,
      cancelledShifts: 0
    }
  ],
  brandRows: [
    {
      brand: 'Самокат',
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
    }
  ],
  statusRows: [
    {
      status: 'confirmed',
      shifts: 0
    }
  ]
}
```

## Task 1: Add Parsed ClickHouse Query Helper

**Files:**
- Modify: `src/clickhouseClient.js`
- Modify: `test/clickhouseClient.test.js`

- [ ] **Step 1: Write failing test for parsed JSONEachRow helper**

Add this test to `test/clickhouseClient.test.js`:

```js
test('queryJSONEachRow executes a query and returns parsed rows', async () => {
  const transport = fakeRequest('{"period":"2026-04-01","ordered":3}\n');
  const client = new ClickHouseClient(baseConfig(), {
    request: transport.request,
    readFileSync: () => 'CA'
  });

  const rows = await client.queryJSONEachRow(
    'SELECT {period:String} AS period, {ordered:UInt64} AS ordered FORMAT JSONEachRow',
    {
      param_period: '2026-04-01',
      param_ordered: 3
    },
    'dashboard query'
  );

  assert.deepEqual(rows, [{ period: '2026-04-01', ordered: 3 }]);

  const params = queryParams(transport.calls[0]);
  assert.equal(params.get('query'), 'SELECT {period:String} AS period, {ordered:UInt64} AS ordered FORMAT JSONEachRow');
  assert.equal(params.get('param_period'), '2026-04-01');
  assert.equal(params.get('param_ordered'), '3');
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm test -- test/clickhouseClient.test.js
```

Expected: fail with `client.queryJSONEachRow is not a function`.

- [ ] **Step 3: Implement the helper**

Add this method inside `class ClickHouseClient` in `src/clickhouseClient.js` after `execute` and before `listTables`:

```js
  async queryJSONEachRow(query, params = {}, operation = 'ClickHouse query') {
    const body = await this.execute(query, params, operation);

    return parseJSONEachRow(body);
  }
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
npm test -- test/clickhouseClient.test.js
```

Expected: all tests in `test/clickhouseClient.test.js` pass.

- [ ] **Step 5: Commit**

```bash
git add src/clickhouseClient.js test/clickhouseClient.test.js
git commit -m "feat: add parsed ClickHouse query helper"
```

## Task 2: Add Dashboard Data Module

**Files:**
- Create: `src/salesByProjectDashboard.js`
- Create: `test/salesByProjectDashboard.test.js`

- [ ] **Step 1: Write failing tests for filters and safe period mapping**

Create `test/salesByProjectDashboard.test.js` with:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPeriodExpression,
  loadSalesByProjectDashboard,
  normalizeSalesByProjectFilters
} = require('../src/salesByProjectDashboard');

test('normalizeSalesByProjectFilters keeps only supported periods and date strings', () => {
  const filters = normalizeSalesByProjectFilters(
    {
      period: 'week',
      from: '2026-04-01',
      to: '2026-04-30'
    },
    new Date('2026-06-01T12:00:00.000Z')
  );

  assert.deepEqual(filters, {
    period: 'week',
    from: '2026-04-01',
    to: '2026-04-30',
    fromDateTime: '2026-04-01 00:00:00',
    toExclusiveDateTime: '2026-05-01 00:00:00'
  });
});

test('normalizeSalesByProjectFilters falls back from unsafe period and invalid dates', () => {
  const filters = normalizeSalesByProjectFilters(
    {
      period: 'month); DROP TABLE mg_orders; --',
      from: 'not-a-date',
      to: '2026-99-99'
    },
    new Date('2026-06-01T12:00:00.000Z')
  );

  assert.equal(filters.period, 'month');
  assert.equal(filters.from, '2026-03-03');
  assert.equal(filters.to, '2026-06-01');
  assert.equal(filters.fromDateTime, '2026-03-03 00:00:00');
  assert.equal(filters.toExclusiveDateTime, '2026-06-02 00:00:00');
});

test('buildPeriodExpression only returns whitelisted ClickHouse expressions', () => {
  assert.equal(buildPeriodExpression('day', 'start_at'), 'toDate(start_at)');
  assert.equal(buildPeriodExpression('week', 'start_at'), 'toStartOfWeek(start_at)');
  assert.equal(buildPeriodExpression('month', 'start_at'), 'toStartOfMonth(start_at)');
  assert.equal(buildPeriodExpression('quarter', 'start_at'), 'toStartOfQuarter(start_at)');
  assert.throws(() => buildPeriodExpression('year', 'start_at'), /Unsupported period/);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm test -- test/salesByProjectDashboard.test.js
```

Expected: fail with `Cannot find module '../src/salesByProjectDashboard'`.

- [ ] **Step 3: Implement filter helpers**

Create `src/salesByProjectDashboard.js` with these helpers and exports first:

```js
const PERIOD_EXPRESSIONS = {
  day: (field) => `toDate(${field})`,
  week: (field) => `toStartOfWeek(${field})`,
  month: (field) => `toStartOfMonth(${field})`,
  quarter: (field) => `toStartOfQuarter(${field})`
};

const DEFAULT_PERIOD = 'month';
const DEFAULT_LOOKBACK_DAYS = 90;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

function toDateTimeParam(dateOnly) {
  return `${dateOnly} 00:00:00`;
}

function normalizeSalesByProjectFilters(input = {}, now = new Date()) {
  const requestedPeriod = typeof input.period === 'string' ? input.period : '';
  const period = Object.prototype.hasOwnProperty.call(PERIOD_EXPRESSIONS, requestedPeriod)
    ? requestedPeriod
    : DEFAULT_PERIOD;
  const today = parseDateOnly(formatDateUTC(now));
  const defaultFrom = formatDateUTC(addDaysUTC(today, -DEFAULT_LOOKBACK_DAYS));
  const requestedFrom = parseDateOnly(input.from);
  const requestedTo = parseDateOnly(input.to);
  let from = requestedFrom ? formatDateUTC(requestedFrom) : defaultFrom;
  let to = requestedTo ? formatDateUTC(requestedTo) : formatDateUTC(today);

  if (parseDateOnly(from).getTime() > parseDateOnly(to).getTime()) {
    from = defaultFrom;
    to = formatDateUTC(today);
  }

  const toExclusive = formatDateUTC(addDaysUTC(parseDateOnly(to), 1));

  return {
    period,
    from,
    to,
    fromDateTime: toDateTimeParam(from),
    toExclusiveDateTime: toDateTimeParam(toExclusive)
  };
}

function buildPeriodExpression(period, field) {
  const builder = PERIOD_EXPRESSIONS[period];

  if (!builder) {
    throw new Error(`Unsupported period: ${period}`);
  }

  return builder(field);
}

module.exports = {
  buildPeriodExpression,
  loadSalesByProjectDashboard,
  normalizeSalesByProjectFilters
};

async function loadSalesByProjectDashboard() {
  throw new Error('loadSalesByProjectDashboard is not implemented yet');
}
```

- [ ] **Step 4: Run filter tests and verify only loader tests are still absent**

Run:

```bash
npm test -- test/salesByProjectDashboard.test.js
```

Expected: current three tests pass.

- [ ] **Step 5: Add failing test for data loading and merging**

Append this test to `test/salesByProjectDashboard.test.js`:

```js
test('loadSalesByProjectDashboard queries dashboard datasets and merges KPI values', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'sales by project orders summary') {
        return [
          {
            ordered_shifts: 10,
            workplaces_with_orders: 3,
            avg_worker_rate_hour: 250
          }
        ];
      }

      if (operation === 'sales by project shifts summary') {
        return [
          {
            worked_shifts: 8,
            revenue_rub: 12000,
            unique_workers: 5,
            workplaces_with_worked_shifts: 2,
            cancelled_shifts: 1,
            self_booked_confirmed_shifts: 4
          }
        ];
      }

      if (operation === 'sales by project orders trend') {
        return [{ period: '2026-04-01', ordered_shifts: 10 }];
      }

      if (operation === 'sales by project shifts trend') {
        return [
          {
            period: '2026-04-01',
            worked_shifts: 8,
            revenue_rub: 12000,
            cancelled_shifts: 1
          }
        ];
      }

      if (operation === 'sales by project brand orders') {
        return [
          {
            brand: 'Бренд <A>',
            ordered_shifts: 10,
            workplaces_with_orders: 3,
            avg_worker_rate_hour: 250
          }
        ];
      }

      if (operation === 'sales by project brand shifts') {
        return [
          {
            brand: 'Бренд <A>',
            worked_shifts: 8,
            revenue_rub: 12000,
            unique_workers: 5,
            workplaces_with_worked_shifts: 2,
            cancelled_shifts: 1,
            self_booked_confirmed_shifts: 4
          }
        ];
      }

      if (operation === 'sales by project status breakdown') {
        return [{ status: 'confirmed', shifts: 8 }];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  };

  const dashboard = await loadSalesByProjectDashboard(
    client,
    {
      period: 'month',
      from: '2026-04-01',
      to: '2026-04-30'
    },
    new Date('2026-06-01T12:00:00.000Z')
  );

  assert.equal(dashboard.summary.orderedShifts, 10);
  assert.equal(dashboard.summary.workedShifts, 8);
  assert.equal(dashboard.summary.slaPercent, 80);
  assert.equal(dashboard.summary.revenueRub, 12000);
  assert.equal(dashboard.summary.uniqueWorkers, 5);
  assert.equal(dashboard.summary.workplacesWithOrders, 3);
  assert.equal(dashboard.summary.workplacesWithWorkedShifts, 2);
  assert.equal(dashboard.summary.cancelledShifts, 1);
  assert.equal(dashboard.summary.selfBookingPercent, 50);
  assert.equal(dashboard.summary.avgWorkerRateHour, 250);
  assert.deepEqual(dashboard.trendRows, [
    {
      period: '2026-04-01',
      orderedShifts: 10,
      workedShifts: 8,
      slaPercent: 80,
      revenueRub: 12000,
      cancelledShifts: 1
    }
  ]);
  assert.equal(dashboard.brandRows[0].brand, 'Бренд <A>');
  assert.deepEqual(dashboard.statusRows, [{ status: 'confirmed', shifts: 8 }]);
  assert.equal(calls.length, 7);
  assert.ok(calls.every((call) => call.params.param_from === '2026-04-01 00:00:00'));
  assert.ok(calls.every((call) => call.params.param_to === '2026-05-01 00:00:00'));
  assert.equal(calls.some((call) => call.query.includes('DROP TABLE')), false);
});
```

- [ ] **Step 6: Run the focused test and verify it fails**

Run:

```bash
npm test -- test/salesByProjectDashboard.test.js
```

Expected: fail with `loadSalesByProjectDashboard is not implemented yet`.

- [ ] **Step 7: Implement dashboard loader utilities**

Add these utilities to `src/salesByProjectDashboard.js` above `module.exports`:

```js
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

function mapSummaryRows(orderRows, shiftRows) {
  const orders = orderRows[0] || {};
  const shifts = shiftRows[0] || {};
  const orderedShifts = numberValue(orders.ordered_shifts);
  const workedShifts = numberValue(shifts.worked_shifts);

  return {
    orderedShifts,
    workedShifts,
    slaPercent: percent(workedShifts, orderedShifts),
    revenueRub: numberValue(shifts.revenue_rub),
    uniqueWorkers: numberValue(shifts.unique_workers),
    workplacesWithOrders: numberValue(orders.workplaces_with_orders),
    workplacesWithWorkedShifts: numberValue(shifts.workplaces_with_worked_shifts),
    cancelledShifts: numberValue(shifts.cancelled_shifts),
    selfBookingPercent: percent(shifts.self_booked_confirmed_shifts, workedShifts),
    avgWorkerRateHour: numberValue(orders.avg_worker_rate_hour)
  };
}

function mergeTrendRows(orderRows, shiftRows) {
  const byPeriod = new Map();

  for (const row of orderRows) {
    byPeriod.set(String(row.period), {
      period: String(row.period),
      orderedShifts: numberValue(row.ordered_shifts),
      workedShifts: 0,
      slaPercent: 0,
      revenueRub: 0,
      cancelledShifts: 0
    });
  }

  for (const row of shiftRows) {
    const period = String(row.period);
    const current =
      byPeriod.get(period) ||
      {
        period,
        orderedShifts: 0,
        workedShifts: 0,
        slaPercent: 0,
        revenueRub: 0,
        cancelledShifts: 0
      };

    current.workedShifts = numberValue(row.worked_shifts);
    current.revenueRub = numberValue(row.revenue_rub);
    current.cancelledShifts = numberValue(row.cancelled_shifts);
    current.slaPercent = percent(current.workedShifts, current.orderedShifts);
    byPeriod.set(period, current);
  }

  return Array.from(byPeriod.values()).sort((left, right) => left.period.localeCompare(right.period));
}

function mergeBrandRows(orderRows, shiftRows) {
  const byBrand = new Map();

  for (const row of orderRows) {
    const brand = String(row.brand || 'Без бренда');

    byBrand.set(brand, {
      brand,
      orderedShifts: numberValue(row.ordered_shifts),
      workedShifts: 0,
      slaPercent: 0,
      revenueRub: 0,
      uniqueWorkers: 0,
      workplacesWithOrders: numberValue(row.workplaces_with_orders),
      workplacesWithWorkedShifts: 0,
      cancelledShifts: 0,
      selfBookingPercent: 0,
      avgWorkerRateHour: numberValue(row.avg_worker_rate_hour)
    });
  }

  for (const row of shiftRows) {
    const brand = String(row.brand || 'Без бренда');
    const current =
      byBrand.get(brand) ||
      {
        brand,
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
      };

    current.workedShifts = numberValue(row.worked_shifts);
    current.revenueRub = numberValue(row.revenue_rub);
    current.uniqueWorkers = numberValue(row.unique_workers);
    current.workplacesWithWorkedShifts = numberValue(row.workplaces_with_worked_shifts);
    current.cancelledShifts = numberValue(row.cancelled_shifts);
    current.slaPercent = percent(current.workedShifts, current.orderedShifts);
    current.selfBookingPercent = percent(row.self_booked_confirmed_shifts, current.workedShifts);
    byBrand.set(brand, current);
  }

  return Array.from(byBrand.values()).sort((left, right) => right.orderedShifts - left.orderedShifts);
}

function mapStatusRows(rows) {
  return rows.map((row) => ({
    status: String(row.status || 'empty'),
    shifts: numberValue(row.shifts)
  }));
}
```

- [ ] **Step 8: Implement dashboard SQL builders and loader**

Add the SQL helpers below the merge utilities in `src/salesByProjectDashboard.js`:

```js
function orderBaseWhere() {
  return [
    'o.deleted = 0',
    'o.start >= {from:DateTime}',
    'o.start < {to:DateTime}'
  ].join(' AND ');
}

function shiftFactsCte() {
  return `
WITH shift_facts AS (
  SELECT
    job,
    min(parseDateTimeBestEffortOrNull(start)) AS shift_start,
    coalesce(argMaxIf(status, coalesce(updatedAt, createdAt, toDateTime64('1970-01-01 00:00:00', 3, 'UTC')), ifNull(status, '') != ''), '') AS status,
    argMaxIf(client, coalesce(updatedAt, createdAt, toDateTime64('1970-01-01 00:00:00', 3, 'UTC')), ifNull(client, '') != '') AS client,
    argMaxIf(workplace, coalesce(updatedAt, createdAt, toDateTime64('1970-01-01 00:00:00', 3, 'UTC')), ifNull(workplace, '') != '') AS workplace,
    argMaxIf(worker, coalesce(updatedAt, createdAt, toDateTime64('1970-01-01 00:00:00', 3, 'UTC')), ifNull(worker, '') != '') AS worker,
    argMaxIf(source, coalesce(updatedAt, createdAt, toDateTime64('1970-01-01 00:00:00', 3, 'UTC')), ifNull(source, '') != '') AS source,
    argMax(salary_per_hour, coalesce(updatedAt, createdAt, toDateTime64('1970-01-01 00:00:00', 3, 'UTC'))) AS salary_per_hour,
    argMax(salary_per_job, coalesce(updatedAt, createdAt, toDateTime64('1970-01-01 00:00:00', 3, 'UTC'))) AS salary_per_job,
    argMax(payment_per_hour, coalesce(updatedAt, createdAt, toDateTime64('1970-01-01 00:00:00', 3, 'UTC'))) AS payment_per_hour,
    argMax(payment_per_job, coalesce(updatedAt, createdAt, toDateTime64('1970-01-01 00:00:00', 3, 'UTC'))) AS payment_per_job,
    argMax(hours, coalesce(updatedAt, createdAt, toDateTime64('1970-01-01 00:00:00', 3, 'UTC'))) AS hours,
    max(if(status = 'booked' AND initiator = 'worker', 1, 0)) AS is_self_booked
  FROM mg_job_history
  WHERE job != ''
    AND parseDateTimeBestEffortOrNull(start) >= {from:DateTime}
    AND parseDateTimeBestEffortOrNull(start) < {to:DateTime}
  GROUP BY job
),
surcharges AS (
  SELECT
    entityId AS job,
    sum(coalesce(nullIf(payment_amount, 0), amount, 0)) AS surcharge_amount
  FROM mg_transactions
  WHERE transaction_type = 'surcharge'
    AND entityId != ''
  GROUP BY entityId
),
shift_enriched AS (
  SELECT
    sf.job AS job,
    sf.shift_start AS shift_start,
    sf.status AS status,
    sf.worker AS worker,
    coalesce(nullIf(sf.client, ''), o.client) AS client,
    coalesce(nullIf(sf.workplace, ''), o.workplace) AS workplace,
    sf.is_self_booked AS is_self_booked,
    ifNull(nullIf(o.contract_type, ''), 'services') AS contract_type,
    ifNull(ct.comission, 0) AS commission_percent,
    if(ifNull(sf.salary_per_job, 0) > 0, ifNull(sf.salary_per_job, 0), ifNull(sf.salary_per_hour, 0) * ifNull(sf.hours, 0)) AS worker_shift_amount,
    if(ifNull(sf.payment_per_job, 0) > 0, ifNull(sf.payment_per_job, 0), ifNull(sf.payment_per_hour, 0) * ifNull(sf.hours, 0)) AS customer_shift_amount,
    ifNull(s.surcharge_amount, 0) AS surcharge_amount
  FROM shift_facts AS sf
  LEFT JOIN mg_orders AS o ON sf.source = o._id
  LEFT JOIN mg_workplaces AS w ON coalesce(nullIf(sf.workplace, ''), o.workplace) = w._id
  LEFT JOIN mg_contractors AS ct ON w.contractor = ct._id
  LEFT JOIN surcharges AS s ON sf.job = s.job
)`;
}

function revenueExpression() {
  return [
    'if(status = \\'confirmed\\',',
    '  if(contract_type = \\'saas\\',',
    '    worker_shift_amount * (1 + commission_percent / 100) + surcharge_amount,',
    '    customer_shift_amount + surcharge_amount',
    '  ),',
    '  0',
    ')'
  ].join(' ');
}

function paramsForFilters(filters) {
  return {
    param_from: filters.fromDateTime,
    param_to: filters.toExclusiveDateTime
  };
}
```

Replace the temporary loader with:

```js
async function loadSalesByProjectDashboard(client, input = {}, now = new Date()) {
  const filters = normalizeSalesByProjectFilters(input, now);
  const periodOrders = buildPeriodExpression(filters.period, 'o.start');
  const periodShifts = buildPeriodExpression(filters.period, 'shift_start');
  const params = paramsForFilters(filters);
  const revenue = revenueExpression();

  const [
    orderSummaryRows,
    shiftSummaryRows,
    orderTrendRows,
    shiftTrendRows,
    brandOrderRows,
    brandShiftRows,
    statusRows
  ] = await Promise.all([
    client.queryJSONEachRow(
      `SELECT
        sum(o.amount) AS ordered_shifts,
        countDistinctIf(o.workplace, o.amount > 0) AS workplaces_with_orders,
        avgIf(o.salary_per_hour, o.salary_per_hour > 0) AS avg_worker_rate_hour
      FROM mg_orders AS o
      WHERE ${orderBaseWhere()}
      FORMAT JSONEachRow`,
      params,
      'sales by project orders summary'
    ),
    client.queryJSONEachRow(
      `${shiftFactsCte()}
      SELECT
        countIf(status = 'confirmed') AS worked_shifts,
        sum(${revenue}) AS revenue_rub,
        countDistinctIf(worker, status = 'confirmed' AND worker != '') AS unique_workers,
        countDistinctIf(workplace, status = 'confirmed' AND workplace != '') AS workplaces_with_worked_shifts,
        countIf(status = 'cancelled') AS cancelled_shifts,
        countIf(status = 'confirmed' AND is_self_booked = 1) AS self_booked_confirmed_shifts
      FROM shift_enriched
      FORMAT JSONEachRow`,
      params,
      'sales by project shifts summary'
    ),
    client.queryJSONEachRow(
      `SELECT
        ${periodOrders} AS period,
        sum(o.amount) AS ordered_shifts
      FROM mg_orders AS o
      WHERE ${orderBaseWhere()}
      GROUP BY period
      ORDER BY period
      FORMAT JSONEachRow`,
      params,
      'sales by project orders trend'
    ),
    client.queryJSONEachRow(
      `${shiftFactsCte()}
      SELECT
        ${periodShifts} AS period,
        countIf(status = 'confirmed') AS worked_shifts,
        sum(${revenue}) AS revenue_rub,
        countIf(status = 'cancelled') AS cancelled_shifts
      FROM shift_enriched
      GROUP BY period
      ORDER BY period
      FORMAT JSONEachRow`,
      params,
      'sales by project shifts trend'
    ),
    client.queryJSONEachRow(
      `SELECT
        ifNull(nullIf(c.title, ''), 'Без бренда') AS brand,
        sum(o.amount) AS ordered_shifts,
        countDistinctIf(o.workplace, o.amount > 0) AS workplaces_with_orders,
        avgIf(o.salary_per_hour, o.salary_per_hour > 0) AS avg_worker_rate_hour
      FROM mg_orders AS o
      LEFT JOIN mg_clients AS c ON o.client = c._id
      WHERE ${orderBaseWhere()}
      GROUP BY brand
      ORDER BY ordered_shifts DESC
      LIMIT 50
      FORMAT JSONEachRow`,
      params,
      'sales by project brand orders'
    ),
    client.queryJSONEachRow(
      `${shiftFactsCte()}
      SELECT
        ifNull(nullIf(c.title, ''), 'Без бренда') AS brand,
        countIf(status = 'confirmed') AS worked_shifts,
        sum(${revenue}) AS revenue_rub,
        countDistinctIf(worker, status = 'confirmed' AND worker != '') AS unique_workers,
        countDistinctIf(workplace, status = 'confirmed' AND workplace != '') AS workplaces_with_worked_shifts,
        countIf(status = 'cancelled') AS cancelled_shifts,
        countIf(status = 'confirmed' AND is_self_booked = 1) AS self_booked_confirmed_shifts
      FROM shift_enriched
      LEFT JOIN mg_clients AS c ON shift_enriched.client = c._id
      GROUP BY brand
      ORDER BY worked_shifts DESC
      LIMIT 50
      FORMAT JSONEachRow`,
      params,
      'sales by project brand shifts'
    ),
    client.queryJSONEachRow(
      `${shiftFactsCte()}
      SELECT
        if(status = '', 'empty', status) AS status,
        count() AS shifts
      FROM shift_enriched
      GROUP BY status
      ORDER BY shifts DESC
      FORMAT JSONEachRow`,
      params,
      'sales by project status breakdown'
    )
  ]);

  return {
    filters,
    summary: mapSummaryRows(orderSummaryRows, shiftSummaryRows),
    trendRows: mergeTrendRows(orderTrendRows, shiftTrendRows),
    brandRows: mergeBrandRows(brandOrderRows, brandShiftRows),
    statusRows: mapStatusRows(statusRows)
  };
}
```

- [ ] **Step 9: Run focused tests**

Run:

```bash
npm test -- test/salesByProjectDashboard.test.js
```

Expected: all tests in `test/salesByProjectDashboard.test.js` pass.

- [ ] **Step 10: Commit**

```bash
git add src/salesByProjectDashboard.js test/salesByProjectDashboard.test.js
git commit -m "feat: add sales by project dashboard data"
```

## Task 3: Add Sidebar Layout And Dashboard Renderer

**Files:**
- Modify: `src/render.js`
- Modify: `test/render.test.js`

- [ ] **Step 1: Write failing renderer tests**

Update the import in `test/render.test.js`:

```js
const {
  escapeHtml,
  renderError,
  renderHome,
  renderSalesByProjectDashboard,
  renderTable
} = require('../src/render');
```

Append these tests:

```js
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
```

- [ ] **Step 2: Run renderer tests and verify they fail**

Run:

```bash
npm test -- test/render.test.js
```

Expected: fail because `renderSalesByProjectDashboard` is missing and sidebar classes are not rendered.

- [ ] **Step 3: Extend layout with sidebar navigation**

Change the `layout` signature in `src/render.js`:

```js
function layout({ title, database, content, activeNav = 'tables' }) {
```

Add this helper above `layout`:

```js
function navLink({ href, label, id, activeNav }) {
  const activeClass = activeNav === id ? ' active' : '';

  return `<a class="nav-link${activeClass}" href="${href}">${escapeHtml(label)}</a>`;
}
```

Replace the `<body>` content in `layout` with:

```html
<body>
  <div class="app-shell">
    <aside class="sidebar" aria-label="Основная навигация">
      <div class="sidebar-title">ETL Analytics</div>
      <nav class="nav-list">
        ${navLink({ href: '/', label: 'Таблицы', id: 'tables', activeNav })}
        ${navLink({ href: '/dashboards/sales-by-project', label: 'Продажи по проектам', id: 'sales-by-project', activeNav })}
      </nav>
    </aside>
    <div class="page-shell">
      <header>
        <div class="topbar">
          <div class="app-title">${escapeHtml(title)}</div>
          <div class="database">Database: ${escapeHtml(database)}</div>
        </div>
      </header>
      <main>${content}</main>
    </div>
  </div>
</body>
```

Replace the CSS rules for `header`, `.topbar`, and `main` with this shell structure, and keep the existing table/list/error rules below it:

```css
    .app-shell {
      display: flex;
      min-height: 100vh;
    }

    .sidebar {
      flex: 0 0 240px;
      border-right: 1px solid var(--line);
      background: var(--surface);
      padding: 18px 14px;
    }

    .sidebar-title {
      margin: 0 0 16px;
      font-size: 18px;
      font-weight: 700;
    }

    .nav-list {
      display: grid;
      gap: 6px;
    }

    .nav-link {
      display: block;
      padding: 9px 10px;
      border-radius: 6px;
      color: var(--text);
      text-decoration: none;
    }

    .nav-link:hover,
    .nav-link:focus,
    .nav-link.active {
      background: var(--link-bg);
      color: var(--link);
      outline: none;
    }

    .page-shell {
      flex: 1 1 auto;
      min-width: 0;
    }

    header {
      background: var(--surface);
      border-bottom: 1px solid var(--line);
    }

    .topbar,
    main {
      width: min(1180px, calc(100% - 32px));
      margin: 0 auto;
    }

    .topbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px 18px;
      min-height: 64px;
      padding: 10px 0;
    }

    main {
      padding: 28px 0 44px;
    }

    .filter-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      gap: 10px;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
    }

    .filter-bar label {
      display: grid;
      gap: 4px;
      color: var(--muted);
      font-size: 13px;
    }

    .filter-bar input,
    .filter-bar select,
    .filter-bar button {
      min-height: 36px;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 6px 9px;
      background: #fff;
      color: var(--text);
      font: inherit;
    }

    .filter-bar button {
      border-color: var(--link);
      background: var(--link);
      color: #fff;
      cursor: pointer;
    }

    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 10px;
    }

    .kpi-card {
      min-height: 88px;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 12px;
      background: var(--surface);
    }

    .kpi-label {
      color: var(--muted);
      font-size: 13px;
    }

    .kpi-value {
      margin-top: 6px;
      font-size: 24px;
      font-weight: 700;
      line-height: 1.15;
      overflow-wrap: anywhere;
    }

    .bar-cell {
      min-width: 120px;
    }

    .bar-track {
      height: 8px;
      border-radius: 999px;
      background: #e5eaf0;
      overflow: hidden;
    }

    .bar-fill {
      height: 100%;
      background: var(--link);
    }

    @media (max-width: 820px) {
      .app-shell {
        display: block;
      }

      .sidebar {
        border-right: 0;
        border-bottom: 1px solid var(--line);
      }

      .nav-list {
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      }
    }
```

- [ ] **Step 4: Add dashboard formatting and renderer helpers**

Add helpers below `renderRows`:

```js
function formatNumber(value, digits = 0) {
  const number = Number(value || 0);

  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  }).format(Number.isFinite(number) ? number : 0);
}

function formatPercent(value) {
  return `${formatNumber(value, 1)}%`;
}

function renderKpiCards(summary) {
  const cards = [
    ['Заказано смен', formatNumber(summary.orderedShifts)],
    ['Отработано смен', formatNumber(summary.workedShifts)],
    ['SLA', formatPercent(summary.slaPercent)],
    ['Выручка, руб.', formatNumber(summary.revenueRub)],
    ['Уникальные исполнители', formatNumber(summary.uniqueWorkers)],
    ['ТТ с заказами', formatNumber(summary.workplacesWithOrders)],
    ['ТТ с выполненными сменами', formatNumber(summary.workplacesWithWorkedShifts)],
    ['Отмены', formatNumber(summary.cancelledShifts)],
    ['Самоброни', formatPercent(summary.selfBookingPercent)],
    ['Средняя ставка в час', formatNumber(summary.avgWorkerRateHour, 2)]
  ];

  return `<div class="kpi-grid">${cards
    .map(([label, value]) => `<div class="kpi-card"><div class="kpi-label">${escapeHtml(label)}</div><div class="kpi-value">${escapeHtml(value)}</div></div>`)
    .join('')}</div>`;
}
```

- [ ] **Step 5: Add dashboard page renderer**

Add `renderSalesByProjectDashboard` to `src/render.js`:

```js
function renderSalesByProjectDashboard({ database, dashboard }) {
  const { filters, summary, trendRows, brandRows, statusRows } = dashboard;
  const content = `<section class="section">
  <h1>Продажи по проектам</h1>
  <form class="filter-bar" method="get" action="/dashboards/sales-by-project">
    <label>Период
      <select name="period">
        ${['day', 'week', 'month', 'quarter']
          .map((period) => `<option value="${period}"${filters.period === period ? ' selected' : ''}>${periodLabel(period)}</option>`)
          .join('')}
      </select>
    </label>
    <label>С
      <input type="date" name="from" value="${escapeHtml(filters.from)}">
    </label>
    <label>По
      <input type="date" name="to" value="${escapeHtml(filters.to)}">
    </label>
    <button type="submit">Применить</button>
  </form>
</section>
<section class="section">
  ${renderKpiCards(summary)}
</section>
<section class="section">
  <h2>Динамика</h2>
  ${renderTrendRows(trendRows)}
</section>
<section class="section">
  <h2>Бренды</h2>
  ${renderBrandRows(brandRows)}
</section>
<section class="section">
  <h2>Статусы работ</h2>
  ${renderStatusRows(statusRows)}
</section>
<section class="section">
  <p class="muted">Проект = бренд клиента. Заказано считается из mg_orders.amount. Факт, статусы и самоброни считаются из mg_job_history.</p>
</section>`;

  return layout({
    title: 'Продажи по проектам',
    database,
    content,
    activeNav: 'sales-by-project'
  });
}
```

Add these table helpers below `renderSalesByProjectDashboard`:

```js
function periodLabel(period) {
  const labels = {
    day: 'День',
    week: 'Неделя',
    month: 'Месяц',
    quarter: 'Квартал'
  };

  return labels[period] || labels.month;
}

function renderEmptyDashboardTable() {
  return '<p class="empty">Нет данных за выбранный период.</p>';
}

function renderTrendRows(rows) {
  if (rows.length === 0) {
    return renderEmptyDashboardTable();
  }

  const maxWorked = Math.max(...rows.map((row) => Number(row.workedShifts || 0)), 1);
  const body = rows
    .map((row) => {
      const width = Math.max(0, Math.min(100, (Number(row.workedShifts || 0) / maxWorked) * 100));

      return `<tr>
        <td>${escapeHtml(row.period)}</td>
        <td>${escapeHtml(formatNumber(row.orderedShifts))}</td>
        <td>${escapeHtml(formatNumber(row.workedShifts))}</td>
        <td>${escapeHtml(formatPercent(row.slaPercent))}</td>
        <td>${escapeHtml(formatNumber(row.revenueRub))}</td>
        <td>${escapeHtml(formatNumber(row.cancelledShifts))}</td>
        <td class="bar-cell"><div class="bar-track"><div class="bar-fill" style="width: ${width}%"></div></div></td>
      </tr>`;
    })
    .join('');

  return `<div class="table-wrap"><table>
    <thead><tr><th>Период</th><th>Заказано</th><th>Отработано</th><th>SLA</th><th>Выручка</th><th>Отмены</th><th>Динамика</th></tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
}

function renderBrandRows(rows) {
  if (rows.length === 0) {
    return renderEmptyDashboardTable();
  }

  const body = rows
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.brand)}</td>
        <td>${escapeHtml(formatNumber(row.orderedShifts))}</td>
        <td>${escapeHtml(formatNumber(row.workedShifts))}</td>
        <td>${escapeHtml(formatPercent(row.slaPercent))}</td>
        <td>${escapeHtml(formatNumber(row.revenueRub))}</td>
        <td>${escapeHtml(formatNumber(row.uniqueWorkers))}</td>
        <td>${escapeHtml(formatNumber(row.workplacesWithOrders))}</td>
        <td>${escapeHtml(formatNumber(row.workplacesWithWorkedShifts))}</td>
        <td>${escapeHtml(formatNumber(row.cancelledShifts))}</td>
        <td>${escapeHtml(formatPercent(row.selfBookingPercent))}</td>
        <td>${escapeHtml(formatNumber(row.avgWorkerRateHour, 2))}</td>
      </tr>`
    )
    .join('');

  return `<div class="table-wrap"><table>
    <thead><tr><th>Бренд</th><th>Заказано</th><th>Отработано</th><th>SLA</th><th>Выручка</th><th>Гигеры</th><th>ТТ с заказами</th><th>ТТ выполнены</th><th>Отмены</th><th>Самоброни</th><th>Ставка/час</th></tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
}

function renderStatusRows(rows) {
  if (rows.length === 0) {
    return renderEmptyDashboardTable();
  }

  const body = rows
    .map((row) => `<tr><td>${escapeHtml(row.status)}</td><td>${escapeHtml(formatNumber(row.shifts))}</td></tr>`)
    .join('');

  return `<div class="table-wrap"><table>
    <thead><tr><th>Статус</th><th>Смены</th></tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
}
```

- [ ] **Step 6: Export renderer**

Update `module.exports` in `src/render.js`:

```js
module.exports = {
  escapeHtml,
  renderError,
  renderHome,
  renderSalesByProjectDashboard,
  renderTable
};
```

- [ ] **Step 7: Run renderer tests**

Run:

```bash
npm test -- test/render.test.js
```

Expected: all tests in `test/render.test.js` pass.

- [ ] **Step 8: Commit**

```bash
git add src/render.js test/render.test.js
git commit -m "feat: add dashboard navigation and rendering"
```

## Task 4: Wire Express Route

**Files:**
- Modify: `src/server.js`
- Modify: `test/server.test.js`

- [ ] **Step 1: Write failing server route test**

Extend `createFakeClient` in `test/server.test.js` with:

```js
async queryJSONEachRow(query, params, operation) {
  calls.push(['queryJSONEachRow', operation]);

  if (operation === 'sales by project orders summary') {
    return [{ ordered_shifts: 10, workplaces_with_orders: 3, avg_worker_rate_hour: 250 }];
  }

  if (operation === 'sales by project shifts summary') {
    return [{ worked_shifts: 8, revenue_rub: 12000, unique_workers: 5, workplaces_with_worked_shifts: 2, cancelled_shifts: 1, self_booked_confirmed_shifts: 4 }];
  }

  if (operation === 'sales by project orders trend') {
    return [{ period: '2026-04-01', ordered_shifts: 10 }];
  }

  if (operation === 'sales by project shifts trend') {
    return [{ period: '2026-04-01', worked_shifts: 8, revenue_rub: 12000, cancelled_shifts: 1 }];
  }

  if (operation === 'sales by project brand orders') {
    return [{ brand: 'Бренд', ordered_shifts: 10, workplaces_with_orders: 3, avg_worker_rate_hour: 250 }];
  }

  if (operation === 'sales by project brand shifts') {
    return [{ brand: 'Бренд', worked_shifts: 8, revenue_rub: 12000, unique_workers: 5, workplaces_with_worked_shifts: 2, cancelled_shifts: 1, self_booked_confirmed_shifts: 4 }];
  }

  if (operation === 'sales by project status breakdown') {
    return [{ status: 'confirmed', shifts: 8 }];
  }

  return [];
}
```

Add this test:

```js
test('GET /dashboards/sales-by-project renders dashboard', async () => {
  const client = createFakeClient();

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(
      baseUrl,
      '/dashboards/sales-by-project?period=month&from=2026-04-01&to=2026-04-30'
    );

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html\b/);
    assert.match(text, /Продажи по проектам/);
    assert.match(text, /Заказано смен/);
    assert.match(text, /Бренд/);
    assert.match(text, /confirmed/);
  });

  assert.equal(client.calls.filter((call) => call[0] === 'queryJSONEachRow').length, 7);
});
```

- [ ] **Step 2: Run server tests and verify failure**

Run:

```bash
npm test -- test/server.test.js
```

Expected: fail because the route returns 404.

- [ ] **Step 3: Wire route in server**

Update imports in `src/server.js`:

```js
const { loadSalesByProjectDashboard } = require('./salesByProjectDashboard');
const { renderError, renderHome, renderSalesByProjectDashboard, renderTable } = require('./render');
```

Add this route after `/` and before `/tables`:

```js
  app.get(
    '/dashboards/sales-by-project',
    asyncRoute(async (req, res) => {
      const dashboard = await loadSalesByProjectDashboard(client, req.query);

      res
        .status(200)
        .type('html')
        .send(renderSalesByProjectDashboard({ database, dashboard }));
    })
  );
```

- [ ] **Step 4: Run server tests**

Run:

```bash
npm test -- test/server.test.js
```

Expected: all tests in `test/server.test.js` pass.

- [ ] **Step 5: Commit**

```bash
git add src/server.js test/server.test.js
git commit -m "feat: expose sales by project dashboard"
```

## Task 5: Documentation, Full Verification, Docker Check

**Files:**
- Modify: `README.md`
- Runtime check: Docker container

- [ ] **Step 1: Document the dashboard**

Add this bullet to the first-iteration capabilities in `README.md`:

```md
- показывать первый дашборд `Продажи по проектам` по брендам MyGig на базе таблиц `mg_*`;
```

Add this section after the table exploration description:

```md
## Дашборды

Доступные экраны:

- `http://localhost:3000/` - список таблиц и просмотр структуры данных;
- `http://localhost:3000/dashboards/sales-by-project` - дашборд `Продажи по проектам`.

В дашбордах по умолчанию используются таблицы `mg_*`. Для `Продажи по проектам` проектом считается бренд клиента из `mg_clients.title`.
```

- [ ] **Step 2: Run the full test suite**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Build Docker image**

Run:

```bash
docker build -t etl-analytics-service .
```

Expected: image builds without errors.

- [ ] **Step 4: Restart the local container**

If `etl-analytics-service-live` exists, stop and remove it with:

```bash
docker rm -f etl-analytics-service-live
```

Start a fresh container using the existing local `.env`:

```bash
docker run --name etl-analytics-service-live --env-file .env -p 3000:3000 -d etl-analytics-service
```

Expected: container id is printed.

- [ ] **Step 5: Verify health and dashboard HTML**

Run:

```bash
curl.exe -s http://127.0.0.1:3000/healthz
curl.exe -s "http://127.0.0.1:3000/dashboards/sales-by-project?period=month&from=2026-04-01&to=2026-04-30"
```

Expected:

- first command prints `ok`;
- second command includes `Продажи по проектам`, `Заказано смен`, `SLA`, and `Бренды`;
- second command does not include the ClickHouse password.

- [ ] **Step 6: Use the in-app browser for visual verification**

Open:

```text
http://127.0.0.1:3000/dashboards/sales-by-project?period=month&from=2026-04-01&to=2026-04-30
```

Verify:

- left menu is visible;
- `Продажи по проектам` is active;
- filters fit on desktop width;
- KPI cards do not overlap;
- wide tables use horizontal scrolling instead of overlapping the page;
- no personal phone, email, or full name appears in the dashboard.

- [ ] **Step 7: Commit docs and verification-ready changes**

```bash
git add README.md
git commit -m "docs: document sales dashboard"
```

## Self-Review Checklist

- Spec coverage: navigation, route, filters, KPI, dynamics, brand breakdown, status breakdown, errors, empty states, tests, and Docker verification are covered by tasks.
- Query safety: period expressions are whitelisted; dates are validated as `YYYY-MM-DD`; user input is passed as ClickHouse parameters.
- Data source consistency: dashboard uses `mg_orders`, `mg_job_history`, `mg_clients`, `mg_workplaces`, `mg_contractors`, and `mg_transactions`; `mg_jobs` is not required for first version.
- PII safety: dashboard aggregates by brand, period, status, and counts; it does not render worker phone, email, or names.
- Known business assumption: surcharge revenue uses `mg_transactions.transaction_type = 'surcharge'` and `entityId = job`, with `coalesce(nullIf(payment_amount, 0), amount, 0)`.
