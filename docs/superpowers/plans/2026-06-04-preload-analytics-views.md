# Preload Analytics Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить локальные предрасчитанные SQLite-витрины, страницу управления предзагрузкой и подключить пилотный дашборд `Продажи по проектам` к preload-источнику с fallback на ClickHouse.

**Architecture:** Express остается основным процессом приложения. Новый preload service хранит runtime-состояние в `data/preload.sqlite`, выполняет ручные и scheduled обновления из read-only ClickHouse, а `salesByProjectDashboard` читает секции из SQLite при полном покрытии периода.

**Tech Stack:** Node.js 22, Express 4, встроенный `node:sqlite`, `node:test`, текущий ClickHouse HTTP client, server-rendered HTML.

---

## File Structure

- Modify: `package.json` - поднять `engines.node` до `>=22`.
- Modify: `.env.example` - добавить `PRELOAD_STORE_PATH=./data/preload.sqlite`.
- Modify: `README.md` - описать SQLite-витрину, volume и управление предзагрузкой.
- Modify: `src/config.js` - добавить `config.preload.storePath`.
- Modify: `src/auth.js` - добавить право `preload-admin`.
- Create: `src/preloadStore.js` - SQLite schema, migrations, schedules, runs, sales preload writes and reads.
- Create: `src/preloadSalesByProject.js` - ClickHouse query builders and preload range loader for `sales-by-project`.
- Create: `src/preloadScheduler.js` - manual/scheduled run orchestration and single-flight protection.
- Create: `src/preloadService.js` - facade used by server routes and dashboard loader.
- Modify: `src/salesByProjectDashboard.js` - preload-first section loading with ClickHouse fallback.
- Modify: `src/render.js` - permission checkbox appears automatically from auth definitions, add preload admin page and source badge for sales sections.
- Modify: `src/server.js` - instantiate preload service, add admin routes, pass preload service to sales section loader.
- Create: `test/preloadStore.test.js`.
- Create: `test/preloadSalesByProject.test.js`.
- Create: `test/preloadScheduler.test.js`.
- Modify: `test/config.test.js`.
- Modify: `test/auth.test.js`.
- Modify: `test/renderAuth.test.js`.
- Modify: `test/render.test.js`.
- Modify: `test/salesByProjectDashboard.test.js`.
- Modify: `test/serverAuth.test.js`.
- Modify: `test/server.test.js`.

## Shared Conventions

Use these constants consistently:

```js
const SALES_PRELOAD_JOB_ID = 'sales-by-project';
const DEFAULT_PRELOAD_SCHEDULE_TIME = '03:00';
const DEFAULT_PRELOAD_TIMEZONE = 'Europe/Moscow';
const DEFAULT_PRELOAD_REFRESH_DAYS = 45;
const DEFAULT_PRELOAD_STORE_PATH = path.join(process.cwd(), 'data', 'preload.sqlite');
```

Date ranges are inclusive/exclusive:

```text
from_date <= period_date < to_date
```

For UI date inputs `to` is a calendar date selected by user. Convert it to exclusive by adding one day before storing or querying preload data.

---

### Task 1: Node 22, Config, And Permission

**Files:**
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `src/config.js`
- Modify: `src/auth.js`
- Modify: `test/config.test.js`
- Modify: `test/auth.test.js`

- [ ] **Step 1: Write failing config tests**

Add to `test/config.test.js` inside `loadConfig returns required values and safe defaults`:

```js
  assert.match(config.preload.storePath, /data[\\/]preload\.sqlite$/);
```

Add a new test:

```js
test('loadConfig accepts preload store path override', () => {
  const config = loadConfig(baseEnv({
    PRELOAD_STORE_PATH: 'C:\\runtime\\preload.sqlite'
  }));

  assert.equal(config.preload.storePath, 'C:\\runtime\\preload.sqlite');
});
```

- [ ] **Step 2: Write failing auth tests**

In `test/auth.test.js`, extend the existing permission assertions:

```js
assert.equal(ALL_PERMISSION_IDS.includes('preload-admin'), true);
assert.equal(hasPermission(envAdmin, 'preload-admin'), true);
```

In the managed analyst create-user test, include `preload-admin` in the input permissions and expected normalized permissions:

```js
permissions: ['city-analysis', 'heatmap', 'worker-cancellations', 'sql-inspector', 'preload-admin', 'users', 'unknown']
```

Expected permissions:

```js
[
  'city-analysis',
  'heatmap',
  'worker-cancellations',
  'sql-inspector',
  'preload-admin'
]
```

Add:

```js
assert.equal(hasPermission(analyst, 'preload-admin'), true);
```

- [ ] **Step 3: Run red tests**

Run:

```bash
npm test -- test/config.test.js test/auth.test.js
```

Expected: FAIL because `config.preload` is undefined and `preload-admin` is absent.

- [ ] **Step 4: Update package engine**

In `package.json`, change:

```json
"engines": {
  "node": ">=20"
}
```

to:

```json
"engines": {
  "node": ">=22"
}
```

- [ ] **Step 5: Add preload config**

In `src/config.js`, add near the top:

```js
const DEFAULT_PRELOAD_STORE_PATH = path.join(process.cwd(), 'data', 'preload.sqlite');
```

Add to the object returned by `loadConfig`:

```js
    preload: {
      storePath: env.PRELOAD_STORE_PATH || DEFAULT_PRELOAD_STORE_PATH
    },
```

Place it after `clickhouse` and before `auth`.

- [ ] **Step 6: Add permission definition**

In `src/auth.js`, insert before the `users` permission:

```js
  {
    id: 'preload-admin',
    label: 'Предзагрузка витрин',
    description: 'Управление расписанием и ручным обновлением предрасчитанных витрин.'
  },
```

No other auth logic changes are needed: admins already receive all permission ids, and analysts receive ids from `ANALYST_PERMISSION_IDS`.

- [ ] **Step 7: Add env example**

In `.env.example`, add:

```dotenv
PRELOAD_STORE_PATH=./data/preload.sqlite
```

Place it near the other runtime file paths.

- [ ] **Step 8: Run green tests**

Run:

```bash
npm test -- test/config.test.js test/auth.test.js
```

Expected: PASS.

- [ ] **Step 9: Commit**

Run:

```bash
git add package.json .env.example src/config.js src/auth.js test/config.test.js test/auth.test.js
git commit -m "feat: add preload config and permission"
```

---

### Task 2: SQLite Preload Store

**Files:**
- Create: `src/preloadStore.js`
- Create: `test/preloadStore.test.js`

- [ ] **Step 1: Write failing preload store tests**

Create `test/preloadStore.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  DEFAULT_PRELOAD_REFRESH_DAYS,
  SALES_PRELOAD_JOB_ID,
  createPreloadStore
} = require('../src/preloadStore');

async function tempDbPath() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'preload-store-'));
  return path.join(dir, 'preload.sqlite');
}

test('preload store initializes default sales job', async () => {
  const store = createPreloadStore({ filePath: await tempDbPath() });

  try {
    const job = store.getJob(SALES_PRELOAD_JOB_ID);

    assert.equal(job.id, SALES_PRELOAD_JOB_ID);
    assert.equal(job.enabled, true);
    assert.equal(job.scheduleTime, '03:00');
    assert.equal(job.timezone, 'Europe/Moscow');
    assert.equal(job.refreshDays, DEFAULT_PRELOAD_REFRESH_DAYS);
  } finally {
    store.close();
  }
});

test('preload store saves schedule and run history', async () => {
  const store = createPreloadStore({
    filePath: await tempDbPath(),
    now: () => new Date('2026-06-04T10:00:00.000Z')
  });

  try {
    const saved = store.saveJobSchedule(SALES_PRELOAD_JOB_ID, {
      enabled: false,
      scheduleTime: '04:30',
      refreshDays: 60
    });
    const run = store.startRun({
      jobId: SALES_PRELOAD_JOB_ID,
      trigger: 'manual',
      fromDate: '2026-05-01',
      toDate: '2026-06-01'
    });

    store.finishRun(run.id, {
      status: 'success',
      rowsWritten: 3
    });

    const runs = store.listRuns(SALES_PRELOAD_JOB_ID, 5);

    assert.equal(saved.enabled, false);
    assert.equal(saved.scheduleTime, '04:30');
    assert.equal(saved.refreshDays, 60);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].status, 'success');
    assert.equal(runs[0].rowsWritten, 3);
  } finally {
    store.close();
  }
});

test('preload store replaces sales range transactionally and reports coverage', async () => {
  const store = createPreloadStore({
    filePath: await tempDbPath(),
    now: () => new Date('2026-06-04T10:00:00.000Z')
  });

  try {
    store.replaceSalesByProjectRange({
      fromDate: '2026-05-01',
      toDate: '2026-05-03',
      dailyRows: [
        {
          period_date: '2026-05-01',
          brand: 'Brand A',
          ordered_shifts: 10,
          revenue_rub: 1000,
          status: '',
          shifts: 0
        },
        {
          period_date: '2026-05-01',
          brand: '',
          ordered_shifts: 0,
          revenue_rub: 0,
          status: 'confirmed',
          shifts: 7
        },
        {
          period_date: '2026-05-02',
          brand: 'Brand A',
          ordered_shifts: 5,
          revenue_rub: 500,
          status: '',
          shifts: 0
        }
      ],
      orderFacts: [
        { period_date: '2026-05-01', brand: 'Brand A', order_id: 'o1', workplace_id: 'w1', ordered_shifts: 10 },
        { period_date: '2026-05-02', brand: 'Brand A', order_id: 'o2', workplace_id: 'w1', ordered_shifts: 5 }
      ],
      shiftFacts: [
        {
          period_date: '2026-05-01',
          brand: 'Brand A',
          job_id: 'j1',
          worker_id: 'worker-1',
          workplace_id: 'w1',
          status: 'confirmed',
          revenue_rub: 1000,
          cancelled_shifts: 0,
          self_booked_confirmed_shift: 1,
          worker_rate_hour: 300
        },
        {
          period_date: '2026-05-02',
          brand: 'Brand A',
          job_id: 'j2',
          worker_id: 'worker-1',
          workplace_id: 'w1',
          status: 'failed',
          revenue_rub: 0,
          cancelled_shifts: 1,
          self_booked_confirmed_shift: 0,
          worker_rate_hour: 0
        }
      ]
    });

    assert.equal(store.hasSalesByProjectCoverage('2026-05-01', '2026-05-03'), true);
    assert.equal(store.hasSalesByProjectCoverage('2026-05-01', '2026-05-04'), false);

    const summary = store.readSalesByProjectSectionRows({
      section: 'summary',
      period: 'month',
      fromDate: '2026-05-01',
      toDate: '2026-05-03'
    });

    assert.equal(summary.orderSummaryRows[0].ordered_shifts, 15);
    assert.equal(summary.orderSummaryRows[0].workplaces_with_orders, 1);
    assert.equal(summary.shiftSummaryRows[0].unique_workers, 1);
    assert.equal(summary.shiftSummaryRows[0].self_booked_confirmed_shifts, 1);
  } finally {
    store.close();
  }
});
```

- [ ] **Step 2: Run red test**

Run:

```bash
npm test -- test/preloadStore.test.js
```

Expected: FAIL because `src/preloadStore.js` does not exist.

- [ ] **Step 3: Create preload store module**

Create `src/preloadStore.js` with this public interface:

```js
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SALES_PRELOAD_JOB_ID = 'sales-by-project';
const DEFAULT_PRELOAD_REFRESH_DAYS = 45;
const DEFAULT_PRELOAD_STORE_PATH = path.join(process.cwd(), 'data', 'preload.sqlite');
const DEFAULT_PRELOAD_SCHEDULE_TIME = '03:00';
const DEFAULT_PRELOAD_TIMEZONE = 'Europe/Moscow';
```

Implement `createPreloadStore({ filePath = DEFAULT_PRELOAD_STORE_PATH, now = () => new Date() } = {})`.

The module must export:

```js
module.exports = {
  DEFAULT_PRELOAD_REFRESH_DAYS,
  DEFAULT_PRELOAD_SCHEDULE_TIME,
  DEFAULT_PRELOAD_STORE_PATH,
  DEFAULT_PRELOAD_TIMEZONE,
  SALES_PRELOAD_JOB_ID,
  createPreloadStore
};
```

- [ ] **Step 4: Implement SQLite schema**

Inside `initializeSchema(db)`, execute:

```sql
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS preload_jobs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  schedule_time TEXT NOT NULL,
  timezone TEXT NOT NULL,
  refresh_days INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_success_at TEXT,
  last_run_id INTEGER
);

CREATE TABLE IF NOT EXISTS preload_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL,
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  rows_written INTEGER NOT NULL DEFAULT 0,
  error_message TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS sales_by_project_daily (
  period_date TEXT NOT NULL,
  brand TEXT NOT NULL,
  ordered_shifts REAL NOT NULL DEFAULT 0,
  revenue_rub REAL NOT NULL DEFAULT 0,
  cancelled_shifts REAL NOT NULL DEFAULT 0,
  self_booked_confirmed_shifts REAL NOT NULL DEFAULT 0,
  avg_worker_rate_hour_weighted_sum REAL NOT NULL DEFAULT 0,
  avg_worker_rate_hour_weight REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT '',
  shifts REAL NOT NULL DEFAULT 0,
  refreshed_at TEXT NOT NULL,
  source_from TEXT NOT NULL,
  source_to TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sales_by_project_order_facts (
  period_date TEXT NOT NULL,
  brand TEXT NOT NULL,
  order_id TEXT NOT NULL,
  workplace_id TEXT NOT NULL,
  ordered_shifts REAL NOT NULL DEFAULT 0,
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY (period_date, order_id)
);

CREATE TABLE IF NOT EXISTS sales_by_project_shift_facts (
  period_date TEXT NOT NULL,
  brand TEXT NOT NULL,
  job_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  workplace_id TEXT NOT NULL,
  status TEXT NOT NULL,
  revenue_rub REAL NOT NULL DEFAULT 0,
  cancelled_shifts REAL NOT NULL DEFAULT 0,
  self_booked_confirmed_shift REAL NOT NULL DEFAULT 0,
  worker_rate_hour REAL NOT NULL DEFAULT 0,
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY (period_date, job_id)
);

CREATE INDEX IF NOT EXISTS idx_sales_daily_period_brand ON sales_by_project_daily (period_date, brand);
CREATE INDEX IF NOT EXISTS idx_sales_daily_status ON sales_by_project_daily (period_date, status);
CREATE INDEX IF NOT EXISTS idx_sales_order_facts_period_brand ON sales_by_project_order_facts (period_date, brand);
CREATE INDEX IF NOT EXISTS idx_sales_shift_facts_period_brand ON sales_by_project_shift_facts (period_date, brand);
CREATE INDEX IF NOT EXISTS idx_sales_shift_facts_status ON sales_by_project_shift_facts (period_date, status);
```

Use `INSERT OR IGNORE` to seed `preload_jobs` with `sales-by-project`.

- [ ] **Step 5: Implement store methods**

Implement these methods exactly:

```js
getJob(jobId)
saveJobSchedule(jobId, { enabled, scheduleTime, refreshDays })
startRun({ jobId, trigger, fromDate, toDate })
finishRun(runId, { status, rowsWritten = 0, errorMessage = '' })
listRuns(jobId, limit = 20)
getSalesByProjectOverview()
hasSalesByProjectCoverage(fromDate, toDate)
replaceSalesByProjectRange({ fromDate, toDate, dailyRows, orderFacts, shiftFacts })
readSalesByProjectSectionRows({ section, period, fromDate, toDate })
close()
```

`replaceSalesByProjectRange` must use `BEGIN IMMEDIATE`, delete all three sales tables for the date range, insert rows, and `COMMIT`. On error it must `ROLLBACK`.

- [ ] **Step 6: Implement section readers**

For `summary`, return:

```js
{
  orderSummaryRows: [
    {
      ordered_shifts,
      workplaces_with_orders
    }
  ],
  shiftSummaryRows: [
    {
      worked_shifts,
      revenue_rub,
      unique_workers,
      workplaces_with_worked_shifts,
      cancelled_shifts,
      self_booked_confirmed_shifts,
      avg_worker_rate_hour
    }
  ]
}
```

Use `COUNT(DISTINCT workplace_id)` from `sales_by_project_order_facts` and `COUNT(DISTINCT worker_id)` from `sales_by_project_shift_facts` to preserve current semantics.

For `trend`, group by `period` according to:

```js
function sqlitePeriodExpression(period) {
  if (period === 'day') return 'period_date';
  if (period === 'week') return "date(period_date, '-' || ((CAST(strftime('%w', period_date) AS INTEGER) + 6) % 7) || ' days')";
  if (period === 'quarter') return "substr(period_date, 1, 4) || '-' || printf('%02d', (((CAST(substr(period_date, 6, 2) AS INTEGER) - 1) / 3) * 3 + 1)) || '-01'";
  return "substr(period_date, 1, 7) || '-01'";
}
```

For `brands`, group by `brand`, use `COUNT(DISTINCT ...)` from fact tables, order the final SQL result by activity/revenue as existing `mergeBrandRows` expects.

For `statuses`, group `sales_by_project_shift_facts.status` and count jobs.

- [ ] **Step 7: Run green store tests**

Run:

```bash
npm test -- test/preloadStore.test.js
```

Expected: PASS. Node may print `ExperimentalWarning: SQLite is an experimental feature`; tests still pass.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/preloadStore.js test/preloadStore.test.js
git commit -m "feat: add sqlite preload store"
```

---

### Task 3: Sales By Project Preload Loader

**Files:**
- Create: `src/preloadSalesByProject.js`
- Create: `test/preloadSalesByProject.test.js`

- [ ] **Step 1: Write failing sales preload tests**

Create `test/preloadSalesByProject.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createPreloadStore } = require('../src/preloadStore');
const {
  buildSalesByProjectPreloadQueries,
  refreshSalesByProjectPreload
} = require('../src/preloadSalesByProject');

async function tempDbPath() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'preload-sales-'));
  return path.join(dir, 'preload.sqlite');
}

test('sales preload query builders use parameterized ClickHouse ranges', () => {
  const queries = buildSalesByProjectPreloadQueries();

  assert.equal(queries.orderFacts.includes('FROM mg_orders AS o'), true);
  assert.equal(queries.orderFacts.includes('{from:DateTime}'), true);
  assert.equal(queries.orderFacts.includes('{to:DateTime}'), true);
  assert.equal(queries.shiftFacts.includes('FROM mg_jobs AS j'), true);
  assert.equal(queries.shiftFacts.includes('mg_job_history'), true);
  assert.equal(queries.shiftFacts.includes('mg_transactions'), true);
  assert.equal(queries.shiftFacts.includes('FORMAT JSONEachRow'), true);
});

test('refreshSalesByProjectPreload loads ClickHouse rows and writes sqlite range', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'preload sales by project order facts') {
        return [
          {
            period_date: '2026-05-01',
            brand: 'Brand A',
            order_id: 'o1',
            workplace_id: 'w1',
            ordered_shifts: 10
          }
        ];
      }

      if (operation === 'preload sales by project shift facts') {
        return [
          {
            period_date: '2026-05-01',
            brand: 'Brand A',
            job_id: 'j1',
            worker_id: 'worker-1',
            workplace_id: 'w1',
            status: 'confirmed',
            revenue_rub: 1000,
            cancelled_shifts: 0,
            self_booked_confirmed_shift: 1,
            worker_rate_hour: 300
          },
          {
            period_date: '2026-05-01',
            brand: 'Brand A',
            job_id: 'j2',
            worker_id: 'worker-2',
            workplace_id: 'w1',
            status: 'failed',
            revenue_rub: 0,
            cancelled_shifts: 1,
            self_booked_confirmed_shift: 0,
            worker_rate_hour: 0
          }
        ];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  };
  const store = createPreloadStore({ filePath: await tempDbPath() });

  try {
    const result = await refreshSalesByProjectPreload({
      client,
      store,
      fromDate: '2026-05-01',
      toDate: '2026-05-02'
    });
    const summary = store.readSalesByProjectSectionRows({
      section: 'summary',
      period: 'month',
      fromDate: '2026-05-01',
      toDate: '2026-05-02'
    });

    assert.equal(result.rowsWritten, 4);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].params.param_from, '2026-05-01 00:00:00');
    assert.equal(calls[0].params.param_to, '2026-05-02 00:00:00');
    assert.equal(summary.orderSummaryRows[0].ordered_shifts, 10);
    assert.equal(summary.shiftSummaryRows[0].worked_shifts, 1);
    assert.equal(summary.shiftSummaryRows[0].unique_workers, 1);
    assert.equal(summary.shiftSummaryRows[0].cancelled_shifts, 1);
  } finally {
    store.close();
  }
});
```

- [ ] **Step 2: Run red test**

Run:

```bash
npm test -- test/preloadSalesByProject.test.js
```

Expected: FAIL because `src/preloadSalesByProject.js` does not exist.

- [ ] **Step 3: Implement query builders**

Create `src/preloadSalesByProject.js`. Implement:

```js
function toDateTimeParam(dateOnly) {
  return `${dateOnly} 00:00:00`;
}

function preloadParams(fromDate, toDate) {
  return {
    param_from: toDateTimeParam(fromDate),
    param_to: toDateTimeParam(toDate)
  };
}
```

Implement `buildSalesByProjectPreloadQueries()` returning `{ orderFacts, shiftFacts }`.

`orderFacts` SQL:

```sql
SELECT
  toString(toDate(o.start)) AS period_date,
  ifNull(nullIf(c.title, ''), 'Без бренда') AS brand,
  o._id AS order_id,
  ifNull(o.workplace, '') AS workplace_id,
  ifNull(o.amount, 0) AS ordered_shifts
FROM mg_orders AS o
LEFT JOIN mg_clients AS c ON o.client = c._id
WHERE o.deleted = 0
  AND o.start >= {from:DateTime}
  AND o.start < {to:DateTime}
  AND ifNull(o._id, '') != ''
FORMAT JSONEachRow
```

`shiftFacts` SQL must use the same business rules as `src/salesByProjectDashboard.js`: `mg_jobs` in date range, self-booking from `mg_job_history`, surcharges from `mg_transactions`, revenue from contract type and rates. It returns:

```sql
period_date,
brand,
job_id,
worker_id,
workplace_id,
status,
revenue_rub,
cancelled_shifts,
self_booked_confirmed_shift,
worker_rate_hour
```

Use `uniq` at read time in SQLite; do not aggregate away `job_id`, `worker_id`, or `workplace_id` in this preload query.

- [ ] **Step 4: Implement refresh function**

Implement:

```js
async function refreshSalesByProjectPreload({ client, store, fromDate, toDate }) {
  const queries = buildSalesByProjectPreloadQueries();
  const params = preloadParams(fromDate, toDate);
  const [orderFacts, shiftFacts] = await Promise.all([
    client.queryJSONEachRow(queries.orderFacts, params, 'preload sales by project order facts'),
    client.queryJSONEachRow(queries.shiftFacts, params, 'preload sales by project shift facts')
  ]);
  const dailyRows = rollupDailyRows({ orderFacts, shiftFacts, fromDate, toDate });

  store.replaceSalesByProjectRange({
    fromDate,
    toDate,
    dailyRows,
    orderFacts,
    shiftFacts
  });

  return {
    rowsWritten: dailyRows.length + orderFacts.length + shiftFacts.length
  };
}
```

Implement `rollupDailyRows` in the same file:

- one daily brand row for each `period_date + brand`;
- one status row for each `period_date + status`;
- brand rows have `status = ''`;
- status rows have `brand = ''`;
- `avg_worker_rate_hour_weighted_sum` stores sum of positive worker rates for confirmed shifts;
- `avg_worker_rate_hour_weight` stores count of confirmed shifts with positive worker rate.

Export:

```js
module.exports = {
  buildSalesByProjectPreloadQueries,
  refreshSalesByProjectPreload
};
```

- [ ] **Step 5: Run green sales preload tests**

Run:

```bash
npm test -- test/preloadSalesByProject.test.js test/preloadStore.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/preloadSalesByProject.js test/preloadSalesByProject.test.js
git commit -m "feat: add sales preload loader"
```

---

### Task 4: Scheduler And Preload Service

**Files:**
- Create: `src/preloadScheduler.js`
- Create: `src/preloadService.js`
- Create: `test/preloadScheduler.test.js`

- [ ] **Step 1: Write failing scheduler tests**

Create `test/preloadScheduler.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createPreloadScheduler,
  scheduledRangeForJob
} = require('../src/preloadScheduler');
const { SALES_PRELOAD_JOB_ID } = require('../src/preloadStore');

test('scheduledRangeForJob returns last refresh days as exclusive range', () => {
  const range = scheduledRangeForJob(
    { refreshDays: 45 },
    new Date('2026-06-04T12:00:00.000Z')
  );

  assert.deepEqual(range, {
    fromDate: '2026-04-20',
    toDate: '2026-06-05'
  });
});

test('preload scheduler prevents parallel runs for the same job', async () => {
  let loads = 0;
  let release;
  const blocker = new Promise((resolve) => {
    release = resolve;
  });
  const store = {
    startRun(input) {
      return { id: 1, ...input };
    },
    finishRun() {},
    getJob() {
      return {
        id: SALES_PRELOAD_JOB_ID,
        enabled: true,
        scheduleTime: '03:00',
        timezone: 'Europe/Moscow',
        refreshDays: 45
      };
    }
  };
  const scheduler = createPreloadScheduler({
    store,
    loaders: {
      [SALES_PRELOAD_JOB_ID]: async () => {
        loads += 1;
        await blocker;
        return { rowsWritten: 1 };
      }
    },
    sanitizeError: (error) => String(error && error.message)
  });

  const first = scheduler.runNow({
    jobId: SALES_PRELOAD_JOB_ID,
    trigger: 'manual',
    fromDate: '2026-05-01',
    toDate: '2026-06-01'
  });
  const second = await scheduler.runNow({
    jobId: SALES_PRELOAD_JOB_ID,
    trigger: 'manual',
    fromDate: '2026-05-01',
    toDate: '2026-06-01'
  });

  release();
  const firstResult = await first;

  assert.equal(loads, 1);
  assert.equal(second.status, 'running');
  assert.equal(second.alreadyRunning, true);
  assert.equal(firstResult.status, 'success');
});
```

- [ ] **Step 2: Run red test**

Run:

```bash
npm test -- test/preloadScheduler.test.js
```

Expected: FAIL because scheduler module does not exist.

- [ ] **Step 3: Implement scheduler**

Create `src/preloadScheduler.js` with exports:

```js
module.exports = {
  createPreloadScheduler,
  scheduledRangeForJob
};
```

Implement `formatDateUTC`, `addDaysUTC`, and:

```js
function scheduledRangeForJob(job, now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const toDate = formatDateUTC(addDaysUTC(today, 1));
  const fromDate = formatDateUTC(addDaysUTC(today, -Math.max(1, Number(job.refreshDays) || 45)));

  return { fromDate, toDate };
}
```

Implement `createPreloadScheduler({ store, loaders, sanitizeError = (error) => error.message, now = () => new Date(), setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout })`.

Public methods:

```js
runNow({ jobId, trigger, fromDate, toDate })
reschedule()
stop()
```

`runNow`:

- checks `runningByJob` map;
- returns `{ status: 'running', alreadyRunning: true }` if same job is active;
- calls `store.startRun`;
- awaits `loaders[jobId]({ fromDate, toDate })`;
- calls `store.finishRun` with `success` or `failed`;
- removes job from `runningByJob` in `finally`.

`reschedule` can schedule only `sales-by-project` in first iteration. Compute next run delay for `HH:mm Europe/Moscow` using local `Date` math; tests for exact timezone scheduling are not required in first iteration.

- [ ] **Step 4: Create preload service**

Create `src/preloadService.js`:

```js
const { createPreloadScheduler } = require('./preloadScheduler');
const { SALES_PRELOAD_JOB_ID, createPreloadStore } = require('./preloadStore');
const { refreshSalesByProjectPreload } = require('./preloadSalesByProject');

function createPreloadService({ client, storePath, store = null, scheduler = null, sanitizeError }) {
  const actualStore = store || createPreloadStore({ filePath: storePath });
  const actualScheduler = scheduler || createPreloadScheduler({
    store: actualStore,
    sanitizeError,
    loaders: {
      [SALES_PRELOAD_JOB_ID]: ({ fromDate, toDate }) =>
        refreshSalesByProjectPreload({ client, store: actualStore, fromDate, toDate })
    }
  });

  actualScheduler.reschedule();

  return {
    store: actualStore,
    scheduler: actualScheduler,
    getOverview() {
      return actualStore.getSalesByProjectOverview();
    },
    getJob(jobId = SALES_PRELOAD_JOB_ID) {
      return actualStore.getJob(jobId);
    },
    listRuns(jobId = SALES_PRELOAD_JOB_ID, limit = 20) {
      return actualStore.listRuns(jobId, limit);
    },
    saveSchedule(input) {
      const job = actualStore.saveJobSchedule(SALES_PRELOAD_JOB_ID, input);
      actualScheduler.reschedule();
      return job;
    },
    runSalesByProject(input) {
      return actualScheduler.runNow({
        jobId: SALES_PRELOAD_JOB_ID,
        trigger: 'manual',
        fromDate: input.fromDate,
        toDate: input.toDate
      });
    },
    readSalesByProjectSectionRows(input) {
      if (!actualStore.hasSalesByProjectCoverage(input.fromDate, input.toDate)) {
        return null;
      }

      return actualStore.readSalesByProjectSectionRows(input);
    },
    close() {
      actualScheduler.stop();
      actualStore.close();
    }
  };
}

module.exports = {
  createPreloadService
};
```

- [ ] **Step 5: Run green scheduler tests**

Run:

```bash
npm test -- test/preloadScheduler.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/preloadScheduler.js src/preloadService.js test/preloadScheduler.test.js
git commit -m "feat: add preload scheduler service"
```

---

### Task 5: Admin UI Rendering

**Files:**
- Modify: `src/render.js`
- Modify: `test/renderAuth.test.js`
- Modify: `test/render.test.js`

- [ ] **Step 1: Write failing render auth tests**

In `test/renderAuth.test.js`, extend account management assertions:

```js
assert.match(html, /name="permissions" value="preload-admin"/);
assert.match(html, /Предзагрузка витрин/);
```

- [ ] **Step 2: Write failing preload page render test**

In `test/render.test.js`, add:

```js
const { renderPreloadManagement } = require('../src/render');

test('renderPreloadManagement renders schedule, manual run, and history', () => {
  const html = renderPreloadManagement({
    database: 'etl',
    csrfToken: 'csrf-token',
    currentUser: { role: 'admin', permissions: ['preload-admin'] },
    message: 'Сохранено',
    error: '',
    job: {
      id: 'sales-by-project',
      enabled: true,
      scheduleTime: '03:00',
      timezone: 'Europe/Moscow',
      refreshDays: 45
    },
    overview: {
      coveredFrom: '2026-05-01',
      coveredTo: '2026-06-04',
      lastSuccessAt: '2026-06-04T03:00:00.000Z',
      lastError: ''
    },
    runs: [
      {
        id: 1,
        trigger: 'manual',
        status: 'success',
        fromDate: '2026-05-01',
        toDate: '2026-06-01',
        startedAt: '2026-06-04T10:00:00.000Z',
        finishedAt: '2026-06-04T10:01:00.000Z',
        rowsWritten: 10,
        errorMessage: ''
      }
    ]
  });

  assert.match(html, /Предзагрузка витрин/);
  assert.match(html, /action="\/admin\/preload\/run"/);
  assert.match(html, /action="\/admin\/preload\/schedule"/);
  assert.match(html, /name="csrfToken" value="csrf-token"/);
  assert.match(html, /value="03:00"/);
  assert.match(html, /value="45"/);
  assert.match(html, /sales-by-project/);
  assert.match(html, /class="nav-link active" href="\/admin\/preload"/);
});
```

- [ ] **Step 3: Run red tests**

Run:

```bash
npm test -- test/renderAuth.test.js test/render.test.js
```

Expected: FAIL because `renderPreloadManagement` and nav link are missing.

- [ ] **Step 4: Add nav link**

In `src/render.js`, add to `NAV_LINKS` after account management:

```js
  {
    href: '/admin/preload',
    label: 'Предзагрузка',
    id: 'preload-admin',
    permission: 'preload-admin'
  }
```

- [ ] **Step 5: Add renderPreloadManagement**

Add helper functions near account management renderers:

```js
function checkedAttribute(value) {
  return value ? ' checked' : '';
}

function renderPreloadRunRow(run) {
  return `<tr>
    <td>${escapeHtml(run.id)}</td>
    <td>${escapeHtml(run.trigger)}</td>
    <td>${escapeHtml(run.status)}</td>
    <td>${escapeHtml(run.fromDate)} - ${escapeHtml(run.toDate)}</td>
    <td>${escapeHtml(run.startedAt || '-')}</td>
    <td>${escapeHtml(run.finishedAt || '-')}</td>
    <td>${escapeHtml(run.rowsWritten || 0)}</td>
    <td>${escapeHtml(run.errorMessage || '')}</td>
  </tr>`;
}
```

Add:

```js
function renderPreloadManagement({
  database,
  currentUser,
  csrfToken = '',
  job,
  overview,
  runs = [],
  message = '',
  error = ''
}) {
  const safeJob = job || {};
  const safeOverview = overview || {};
  const messageHtml = message ? `<div class="success">${escapeHtml(message)}</div>` : '';
  const errorHtml = error ? `<div class="inline-error">${escapeHtml(error)}</div>` : '';
  const rowsHtml = runs.map(renderPreloadRunRow).join('');
  const content = `<section class="section">
  <h1>Предзагрузка витрин</h1>
  <p class="technical-note">Управление локальной SQLite-витриной для дашборда Продажи по проектам.</p>
</section>
<section class="section">
  ${messageHtml}
  ${errorHtml}
  <div class="kpi-grid">
    <div class="kpi-card"><div class="kpi-label">Витрина</div><div class="kpi-value">${escapeHtml(safeJob.id || 'sales-by-project')}</div></div>
    <div class="kpi-card"><div class="kpi-label">Покрытие</div><div class="kpi-value">${escapeHtml(safeOverview.coveredFrom || '-')} - ${escapeHtml(safeOverview.coveredTo || '-')}</div></div>
    <div class="kpi-card"><div class="kpi-label">Последний успех</div><div class="kpi-value">${escapeHtml(safeOverview.lastSuccessAt || '-')}</div></div>
  </div>
</section>
<section class="section">
  <h2>Ручной запуск</h2>
  <form class="filter-bar" action="/admin/preload/run" method="post">
    ${renderHiddenCsrf(csrfToken)}
    <div class="field"><label for="preload-from">С</label><input id="preload-from" name="from" type="date" required></div>
    <div class="field"><label for="preload-to">По</label><input id="preload-to" name="to" type="date" required></div>
    <button type="submit">Запустить</button>
  </form>
</section>
<section class="section">
  <h2>Расписание</h2>
  <form class="filter-bar" action="/admin/preload/schedule" method="post">
    ${renderHiddenCsrf(csrfToken)}
    <label class="checkbox-label"><input name="enabled" type="checkbox" value="1"${checkedAttribute(safeJob.enabled)}> Включено</label>
    <div class="field"><label for="schedule-time">Время</label><input id="schedule-time" name="scheduleTime" type="time" value="${escapeHtml(safeJob.scheduleTime || '03:00')}" required></div>
    <div class="field"><label for="refresh-days">Обновлять дней</label><input id="refresh-days" name="refreshDays" type="number" min="1" max="366" value="${escapeHtml(safeJob.refreshDays || 45)}" required></div>
    <button type="submit">Сохранить</button>
  </form>
</section>
<section class="section">
  <h2>История запусков</h2>
  <div class="table-scroll"><table><thead><tr><th>ID</th><th>Тип</th><th>Статус</th><th>Период</th><th>Старт</th><th>Финиш</th><th>Строк</th><th>Ошибка</th></tr></thead><tbody>${rowsHtml || '<tr><td colspan="8">Запусков пока нет.</td></tr>'}</tbody></table></div>
</section>`;

  return layout({
    title: 'Предзагрузка витрин',
    database,
    content,
    activeNav: 'preload-admin',
    currentUser,
    csrfToken
  });
}
```

Export `renderPreloadManagement`.

- [ ] **Step 6: Run green render tests**

Run:

```bash
npm test -- test/renderAuth.test.js test/render.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/render.js test/renderAuth.test.js test/render.test.js
git commit -m "feat: render preload management page"
```

---

### Task 6: Admin Routes And Server Wiring

**Files:**
- Modify: `src/server.js`
- Modify: `test/serverAuth.test.js`
- Modify: `test/server.test.js`

- [ ] **Step 1: Write failing auth route test**

In `test/serverAuth.test.js`, add a managed user with no `preload-admin` permission and assert:

```js
const preload = await fetchText(baseUrl, '/admin/preload', {
  headers: { cookie: analystCookie }
});

assert.equal(preload.response.status, 403);
assert.match(preload.text, /Недостаточно прав/);
```

Then create/login a user with `permissions: ['preload-admin']` and assert:

```js
const preloadAllowed = await fetchText(baseUrl, '/admin/preload', {
  headers: { cookie: preloadCookie }
});

assert.equal(preloadAllowed.response.status, 200);
assert.match(preloadAllowed.text, /Предзагрузка витрин/);
```

- [ ] **Step 2: Write failing server route tests**

In `test/server.test.js`, add fake preload service:

```js
function createFakePreloadService() {
  const calls = [];

  return {
    calls,
    getOverview() {
      calls.push(['getOverview']);
      return { coveredFrom: '2026-05-01', coveredTo: '2026-06-04', lastSuccessAt: '', lastError: '' };
    },
    getJob() {
      calls.push(['getJob']);
      return { id: 'sales-by-project', enabled: true, scheduleTime: '03:00', timezone: 'Europe/Moscow', refreshDays: 45 };
    },
    listRuns() {
      calls.push(['listRuns']);
      return [];
    },
    saveSchedule(input) {
      calls.push(['saveSchedule', input]);
      return { id: 'sales-by-project', ...input };
    },
    async runSalesByProject(input) {
      calls.push(['runSalesByProject', input]);
      return { status: 'success', rowsWritten: 1 };
    },
    close() {}
  };
}
```

Create app with `authEnabled: false` config and `preloadService`. Assert:

```js
const page = await fetchText(baseUrl, '/admin/preload');
assert.equal(page.response.status, 200);
assert.match(page.text, /Предзагрузка витрин/);
```

Post schedule:

```js
const saved = await fetchText(baseUrl, '/admin/preload/schedule', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: 'enabled=1&scheduleTime=04%3A30&refreshDays=60'
});

assert.equal(saved.response.status, 303);
assert.equal(saved.response.headers.get('location'), '/admin/preload?message=schedule-saved');
```

Post run:

```js
const run = await fetchText(baseUrl, '/admin/preload/run', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: 'from=2026-05-01&to=2026-05-31'
});

assert.equal(run.response.status, 303);
assert.equal(run.response.headers.get('location'), '/admin/preload?message=run-started');
```

- [ ] **Step 3: Run red tests**

Run:

```bash
npm test -- test/serverAuth.test.js test/server.test.js
```

Expected: FAIL because routes and service wiring are absent.

- [ ] **Step 4: Wire preload service into createApp**

In `src/server.js`, import:

```js
const { createPreloadService } = require('./preloadService');
const { SALES_PRELOAD_JOB_ID } = require('./preloadStore');
```

Add `preloadService = null` to `createApp` parameters.

Inside `createApp`, set:

```js
  const preloads = preloadService;
```

Add helper:

```js
function preloadMessage(code) {
  const messages = {
    'schedule-saved': 'Расписание сохранено',
    'run-started': 'Обновление запущено',
    'already-running': 'Обновление уже выполняется'
  };

  return messages[String(code || '')] || '';
}
```

- [ ] **Step 5: Add routes**

Add after `/admin/users` routes:

```js
  app.get(
    '/admin/preload',
    requireAuth('preload-admin'),
    asyncRoute(async (req, res) => {
      res.status(200).type('html').send(
        renderPreloadManagement({
          database,
          message: preloadMessage(req.query.message),
          error: '',
          job: preloads.getJob(SALES_PRELOAD_JOB_ID),
          overview: preloads.getOverview(),
          runs: preloads.listRuns(SALES_PRELOAD_JOB_ID, 20),
          ...viewContext(req)
        })
      );
    })
  );

  app.post(
    '/admin/preload/schedule',
    requireAuth('preload-admin'),
    asyncRoute(async (req, res) => {
      if (!verifyCsrf(req, res, 'preload-admin')) {
        return;
      }

      preloads.saveSchedule({
        enabled: req.body.enabled === '1',
        scheduleTime: req.body.scheduleTime,
        refreshDays: Number.parseInt(req.body.refreshDays, 10)
      });

      res.redirect(303, '/admin/preload?message=schedule-saved');
    })
  );

  app.post(
    '/admin/preload/run',
    requireAuth('preload-admin'),
    asyncRoute(async (req, res) => {
      if (!verifyCsrf(req, res, 'preload-admin')) {
        return;
      }

      const result = await preloads.runSalesByProject({
        fromDate: req.body.from,
        toDate: req.body.to
      });

      res.redirect(303, result && result.alreadyRunning
        ? '/admin/preload?message=already-running'
        : '/admin/preload?message=run-started');
    })
  );
```

Import `renderPreloadManagement` from `./render`.

- [ ] **Step 6: Instantiate service in start**

In `start`, after `const client = new ClientClass(config.clickhouse);`, add:

```js
  const preloadService = createPreloadService({
    client,
    storePath: config.preload.storePath,
    sanitizeError: (error) => sanitizeForResponse(error && error.message, config)
  });
```

Pass `preloadService` into `createAppFn`.

On server close, close it:

```js
  server.on('close', () => {
    workplaceDirectoryRefresh.stop();
    preloadService.close();
  });
```

Tests can pass fake `preloadService` to avoid SQLite.

- [ ] **Step 7: Validate input dates**

Before route handlers use manual run dates, add helper:

```js
function normalizeManualPreloadRange(body) {
  const fromDate = String((body && body.from) || '');
  const toDate = String((body && body.to) || '');

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    const error = new Error('Неверный диапазон дат');
    error.status = 400;
    throw error;
  }

  const from = new Date(`${fromDate}T00:00:00.000Z`);
  const to = new Date(`${toDate}T00:00:00.000Z`);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    const error = new Error('Неверный диапазон дат');
    error.status = 400;
    throw error;
  }

  to.setUTCDate(to.getUTCDate() + 1);

  return {
    fromDate,
    toDate: `${to.getUTCFullYear()}-${String(to.getUTCMonth() + 1).padStart(2, '0')}-${String(to.getUTCDate()).padStart(2, '0')}`
  };
}
```

Use it in `/admin/preload/run`.

- [ ] **Step 8: Run green server tests**

Run:

```bash
npm test -- test/serverAuth.test.js test/server.test.js
```

Expected: PASS.

- [ ] **Step 9: Commit**

Run:

```bash
git add src/server.js test/serverAuth.test.js test/server.test.js
git commit -m "feat: add preload admin routes"
```

---

### Task 7: Sales Dashboard Preload Fallback

**Files:**
- Modify: `src/salesByProjectDashboard.js`
- Modify: `src/render.js`
- Modify: `src/server.js`
- Modify: `test/salesByProjectDashboard.test.js`
- Modify: `test/server.test.js`

- [ ] **Step 1: Write failing dashboard preload tests**

In `test/salesByProjectDashboard.test.js`, add:

```js
test('loadSalesByProjectDashboardSection reads from preload when coverage is available', async () => {
  const { calls, client } = createDashboardClient({
    'sales by project orders summary': [{ ordered_shifts: 999 }]
  });
  const preloadService = {
    readSalesByProjectSectionRows(input) {
      assert.equal(input.section, 'summary');
      assert.equal(input.fromDate, '2026-05-01');
      assert.equal(input.toDate, '2026-06-01');

      return {
        orderSummaryRows: [{ ordered_shifts: 10, workplaces_with_orders: 2 }],
        shiftSummaryRows: [
          {
            worked_shifts: 8,
            revenue_rub: 12000,
            unique_workers: 3,
            workplaces_with_worked_shifts: 2,
            cancelled_shifts: 1,
            self_booked_confirmed_shifts: 4,
            avg_worker_rate_hour: 300
          }
        ]
      };
    }
  };

  const dashboard = await loadSalesByProjectDashboardSection(
    client,
    { from: '2026-05-01', to: '2026-05-31' },
    'summary',
    new Date('2026-06-04T12:00:00.000Z'),
    { preloadService }
  );

  assert.equal(calls.length, 0);
  assert.equal(dashboard.summary.orderedShifts, 10);
  assert.equal(dashboard.dataSource, 'preload');
});

test('loadSalesByProjectDashboardSection falls back to ClickHouse when preload misses', async () => {
  const { calls, client } = createDashboardClient({
    'sales by project orders summary': [{ ordered_shifts: 10, workplaces_with_orders: 2 }],
    'sales by project shifts summary': [{ worked_shifts: 8 }]
  });
  const preloadService = {
    readSalesByProjectSectionRows() {
      return null;
    }
  };

  const dashboard = await loadSalesByProjectDashboardSection(
    client,
    { from: '2026-05-01', to: '2026-05-31' },
    'summary',
    new Date('2026-06-04T12:00:00.000Z'),
    { preloadService }
  );

  assert.equal(calls.length, 2);
  assert.equal(dashboard.dataSource, 'clickhouse');
});
```

- [ ] **Step 2: Run red dashboard tests**

Run:

```bash
npm test -- test/salesByProjectDashboard.test.js
```

Expected: FAIL because preload service is not used and `dataSource` is absent.

- [ ] **Step 3: Add preload-first logic**

In `src/salesByProjectDashboard.js`, add:

```js
function preloadRangeForFilters(filters) {
  return {
    fromDate: filters.from,
    toDate: filters.toExclusiveDateTime.slice(0, 10)
  };
}

function withDataSource(dashboard, dataSource) {
  return {
    ...dashboard,
    dataSource
  };
}
```

Update `loadSalesByProjectDashboardSection`:

```js
  let rows = null;
  let dataSource = 'clickhouse';

  if (options.preloadService && typeof options.preloadService.readSalesByProjectSectionRows === 'function') {
    try {
      const range = preloadRangeForFilters(filters);

      rows = options.preloadService.readSalesByProjectSectionRows({
        section,
        period: filters.period,
        fromDate: range.fromDate,
        toDate: range.toDate
      });

      if (rows) {
        dataSource = 'preload';
      }
    } catch (_) {
      rows = null;
    }
  }

  if (!rows) {
    rows = await readThroughCache(
      options.cache,
      cacheKeyForSalesByProjectSection(section, filters),
      () => loadSalesByProjectSectionRows(client, filters, section)
    );
  }

  return withDataSource(mergeSalesByProjectSection(filters, section, rows), dataSource);
```

Do not cache ClickHouse fallback together with preload results under the same key when preload returned data.

- [ ] **Step 4: Render source badge**

In `src/render.js`, add:

```js
function renderDataSourceBadge(dashboard) {
  if (!dashboard || !dashboard.dataSource) {
    return '';
  }

  const label = dashboard.dataSource === 'preload' ? 'Источник: витрина' : 'Источник: ClickHouse';

  return `<p class="technical-note">${escapeHtml(label)}</p>`;
}
```

In `renderSalesByProjectDashboardSection`, after each section heading, add `${renderDataSourceBadge(dashboard)}`.

- [ ] **Step 5: Pass preload service from server**

In `/dashboards/sales-by-project/section`, pass:

```js
{
  cache: dashboardSectionCache,
  preloadService: preloads
}
```

- [ ] **Step 6: Update server test**

In `test/server.test.js`, add a test with fake preload service and assert that a sales section can render `Источник: витрина` and no sales ClickHouse operations are called.

Use:

```js
preloadService: {
  readSalesByProjectSectionRows() {
    return {
      orderSummaryRows: [{ ordered_shifts: 10, workplaces_with_orders: 2 }],
      shiftSummaryRows: [{ worked_shifts: 8 }]
    };
  },
  getOverview() { return {}; },
  getJob() { return {}; },
  listRuns() { return []; },
  close() {}
}
```

- [ ] **Step 7: Run green dashboard tests**

Run:

```bash
npm test -- test/salesByProjectDashboard.test.js test/server.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/salesByProjectDashboard.js src/render.js src/server.js test/salesByProjectDashboard.test.js test/server.test.js
git commit -m "feat: use preload source for sales dashboard"
```

---

### Task 8: Documentation And Runtime Hygiene

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `.gitignore`

- [ ] **Step 1: Check `.gitignore`**

Run:

```bash
Get-Content -Encoding UTF8 -LiteralPath '.gitignore'
```

Ensure `data/` is ignored. If it is not ignored, add:

```gitignore
data/
```

- [ ] **Step 2: Update README**

In `README.md`, add a Russian section under configuration:

```markdown
## Предзагрузка витрин

Первая итерация предзагрузки использует локальную SQLite-базу `data/preload.sqlite`. Путь можно переопределить через `PRELOAD_STORE_PATH`.

Страница управления доступна по адресу `/admin/preload` и требует права `Предзагрузка витрин`. В Docker volume `./data:/app/data` должен быть доступен на запись пользователю контейнера `node`, иначе создание SQLite-файла и обновление витрины завершатся ошибкой.

Пилотная витрина ускоряет дашборд `Продажи по проектам`. По умолчанию расписание включено, запуск выполняется каждый день в `03:00 Europe/Moscow`, обновляются последние 45 дней. Ручной запуск позволяет выбрать диапазон дат.

Если подходящая витрина отсутствует или недоступна, дашборд сохраняет текущее поведение и считает секции запросами к ClickHouse.
```

- [ ] **Step 3: Verify `.env.example`**

Confirm it contains:

```dotenv
PRELOAD_STORE_PATH=./data/preload.sqlite
```

- [ ] **Step 4: Run docs-adjacent tests**

Run:

```bash
npm test -- test/config.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add README.md .env.example .gitignore
git commit -m "docs: document preload sqlite store"
```

---

### Task 9: Final Verification

**Files:**
- All files changed by previous tasks.

- [ ] **Step 1: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS. If Node prints `ExperimentalWarning: SQLite is an experimental feature`, leave it visible unless tests fail.

- [ ] **Step 2: Inspect git status**

Run:

```bash
git status --short
```

Expected: no uncommitted source/test/doc changes except runtime files under ignored `data/`.

- [ ] **Step 3: Inspect recent commits**

Run:

```bash
git log --oneline -8
```

Expected: commits from Tasks 1-8 are present.

- [ ] **Step 4: Manual local smoke test**

Start server with valid env:

```bash
npm start
```

Open:

```text
http://localhost:3000/admin/preload
```

Verify:

- admin can see the page;
- schedule form shows `03:00` and `45`;
- manual run for a small range creates a run row;
- `http://localhost:3000/dashboards/sales-by-project` still renders;
- sales section fragments show either `Источник: витрина` after preload coverage or `Источник: ClickHouse` when coverage is missing.

- [ ] **Step 5: Final cleanup**

Stop the server. Confirm `data/preload.sqlite` exists locally and is ignored by git:

```bash
git status --short --ignored data
```

Expected: SQLite file appears as ignored, not staged.

---

## Self-Review

Spec coverage:

- SQLite runtime store: Tasks 1, 2, 8.
- `preload-admin` permission: Tasks 1, 5, 6.
- `/admin/preload` UI: Tasks 5, 6.
- schedule and manual run: Tasks 4, 6.
- run history: Tasks 2, 5, 6.
- single-flight protection: Task 4.
- `sales-by-project` preload: Tasks 2, 3, 7.
- ClickHouse fallback: Task 7.
- README/env documentation: Task 8.

Type consistency:

- Store API names are used consistently by scheduler, service, server routes, and dashboard loader.
- Manual range converts user `to` date into exclusive `toDate` before preload execution.
- `dataSource` values are exactly `preload` and `clickhouse`.

Implementation risk:

- Exact distinct metrics require `sales_by_project_order_facts` and `sales_by_project_shift_facts`; they are included in the store and loader tasks.
- `node:sqlite` is experimental in Node 22. The project Dockerfile already uses Node 22; tests may show the warning without failing.
