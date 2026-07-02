# Workplace Point Preload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ускорить открытие карточки точки за счет ежедневной витрины `workplace-point`, которая обновляет окно `-30/+30` дней в 08:00 Europe/Moscow и умеет читать произвольные периоды из накопленных покрытых дат.

**Architecture:** Добавляем новый preload job `workplace-point` в существующую SQLite-базу `data/preload.sqlite`. Для быстрых произвольных периодов храним нормализованные дневные факты заказов, смен, статусов, бронирований, отзывов и радиусных rollup; секции карточки сначала читают SQLite-витрину, при отсутствии полного покрытия падают обратно на ClickHouse и регистрируют запрос для следующего прогрева.

**Tech Stack:** Node.js 22, Express, `node:sqlite` `DatabaseSync`, ClickHouse JSONEachRow, `node --test`.

---

## Файловая структура

- Modify: `src/preloadStore.js` - новый `WORKPLACE_POINT_PRELOAD_JOB_ID`, schema SQLite, запись/чтение фактов и coverage.
- Create: `src/preloadWorkplacePoint.js` - ClickHouse-запросы и refresh loader витрины карточки точки.
- Modify: `src/preloadService.js` - регистрация loader, методы read/register/save/run для `workplace-point`.
- Modify: `src/preloadScheduler.js` - разрешить scheduled window 30 дней, не форсировать 45.
- Modify: `src/server.js` - передать `preloadService` в `/dashboards/workplace-analysis/point/section`, поддержать schedule/manual run с 30 днями.
- Modify: `src/workplacePointDashboard.js` - читать секции из preload перед ClickHouse fallback.
- Modify: `src/render.js` - отложить тяжелые фрагменты и ограничить параллельную загрузку.
- Modify: `README.md`, `docs/dashboards/workplace-point.md` - описать новую витрину, schedule и fallback.
- Test: `test/preloadStore.test.js`, `test/preloadScheduler.test.js`, `test/preloadWorkplacePoint.test.js`, `test/workplacePointDashboard.test.js`, `test/serverAuth.test.js`.

## Важные решения

- Окно ежедневного обновления: если сегодня по времени приложения `2026-07-02`, scheduled run пишет факты за `[2026-06-02, 2026-08-01]` включительно, в store передается `fromDate = '2026-06-02'`, `toDate = '2026-08-02'` как exclusive.
- Schedule нового job: `08:00`, timezone `Europe/Moscow`, `refreshPastDays = 30`, `refreshFutureDays = 30`.
- Произвольный период: reader принимает любые `from/to`; если `workplace_point_coverage` полностью покрывает все даты периода, секция собирается из SQLite. Если покрытие неполное, секция считается из ClickHouse и регистрируется в `preload_dashboard_requests` для последующего ручного или scheduled прогрева.
- Радиусы тяжелые: для `radius` используем rollup по горячим точкам из зарегистрированных запросов карточки. Если радиус точки не прогрет, только секция `radius` падает обратно на ClickHouse; `summary/charts` остаются быстрыми из фактов.
- `year-heatmap` требует годовой период. Ежедневное окно `-30/+30` само по себе год не покрывает, поэтому `year-heatmap` читает SQLite только после ручного/расширенного прогрева текущего года; иначе остается deferred fallback.

---

### Task 1: Preload job и окно 30 дней

**Files:**
- Modify: `src/preloadStore.js`
- Modify: `src/preloadScheduler.js`
- Modify: `src/server.js`
- Test: `test/preloadStore.test.js`
- Test: `test/preloadScheduler.test.js`

- [ ] **Step 1: Write failing store test for the new job**

Add to `test/preloadStore.test.js`:

```js
test('preload store initializes workplace point job at 08:00 with 30 day windows', async () => {
  const store = createPreloadStore({ filePath: await tempDbPath() });

  try {
    const job = store.getJob(WORKPLACE_POINT_PRELOAD_JOB_ID);

    assert.equal(job.id, WORKPLACE_POINT_PRELOAD_JOB_ID);
    assert.equal(job.title, 'Карточка точки');
    assert.equal(job.enabled, true);
    assert.equal(job.scheduleTime, '08:00');
    assert.equal(job.timezone, 'Europe/Moscow');
    assert.equal(job.refreshPastDays, 30);
    assert.equal(job.refreshFutureDays, 30);
  } finally {
    store.close();
  }
});
```

Update the import in the same file:

```js
const {
  SALES_PRELOAD_JOB_ID,
  WORKPLACE_ANALYSIS_PRELOAD_JOB_ID,
  WORKPLACE_POINT_PRELOAD_JOB_ID,
  createPreloadStore
} = require('../src/preloadStore');
```

- [ ] **Step 2: Write failing scheduler test for `-30/+30`**

Add to `test/preloadScheduler.test.js`:

```js
test('preload scheduler builds 30 day inclusive workplace point window', () => {
  const range = scheduledRangeForJob(
    {
      id: WORKPLACE_POINT_PRELOAD_JOB_ID,
      refreshPastDays: 30,
      refreshFutureDays: 30
    },
    new Date('2026-07-02T05:00:00.000Z')
  );

  assert.deepEqual(range, {
    fromDate: '2026-06-02',
    toDate: '2026-08-02'
  });
});
```

- [ ] **Step 3: Add job constant and seeded defaults**

In `src/preloadStore.js`, add:

```js
const WORKPLACE_POINT_PRELOAD_JOB_ID = 'workplace-point';
```

Replace `seedPreloadJob(db, now, { id, title })` with:

```js
function seedPreloadJob(db, now, {
  id,
  title,
  scheduleTime = DEFAULT_PRELOAD_SCHEDULE_TIME,
  timezone = DEFAULT_PRELOAD_TIMEZONE,
  refreshPastDays = DEFAULT_PRELOAD_REFRESH_DAYS,
  refreshFutureDays = DEFAULT_PRELOAD_REFRESH_FUTURE_DAYS
}) {
  const timestamp = toIsoString(now);

  db.prepare(`
INSERT OR IGNORE INTO preload_jobs (
  id,
  title,
  enabled,
  schedule_time,
  timezone,
  refresh_days,
  refresh_past_days,
  refresh_future_days,
  created_at,
  updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
    id,
    title,
    1,
    scheduleTime,
    timezone,
    refreshPastDays,
    refreshPastDays,
    refreshFutureDays,
    timestamp,
    timestamp
  );
}
```

Seed the new job in `initializeSchema`:

```js
seedPreloadJob(db, now, {
  id: WORKPLACE_POINT_PRELOAD_JOB_ID,
  title: 'Карточка точки',
  scheduleTime: '08:00',
  timezone: DEFAULT_PRELOAD_TIMEZONE,
  refreshPastDays: 30,
  refreshFutureDays: 30
});
```

Export `WORKPLACE_POINT_PRELOAD_JOB_ID`.

- [ ] **Step 4: Allow 30 day scheduled windows**

In `src/preloadScheduler.js`, change:

```js
const MIN_SCHEDULE_REFRESH_DAYS = 45;
```

to:

```js
const MIN_SCHEDULE_REFRESH_DAYS = 30;
```

Keep existing sales and workplace-analysis defaults at 45 through seeded job values.

- [ ] **Step 5: Allow admin schedule forms to save 30**

In `src/server.js`, change `parseRefreshDaysFromBody` lower bound from `45` to `30`:

```js
if (!Number.isInteger(refreshDays) || refreshDays < 30 || refreshDays > 366) {
  throw createScheduleSettingsError();
}
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm test -- test/preloadStore.test.js test/preloadScheduler.test.js
```

Expected: PASS.

---

### Task 2: SQLite schema для произвольных периодов карточки

**Files:**
- Modify: `src/preloadStore.js`
- Test: `test/preloadStore.test.js`

- [ ] **Step 1: Write failing schema test**

Add to `test/preloadStore.test.js`:

```js
test('preload store creates workplace point fact schema', async () => {
  const filePath = await tempDbPath();
  const store = createPreloadStore({ filePath });

  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(filePath);
    const tables = db.prepare(`
SELECT name
FROM sqlite_master
WHERE type = 'table'
ORDER BY name
`).all().map((row) => row.name);

    assert.equal(tables.includes('workplace_point_coverage'), true);
    assert.equal(tables.includes('workplace_point_order_facts'), true);
    assert.equal(tables.includes('workplace_point_shift_facts'), true);
    assert.equal(tables.includes('workplace_point_order_status_facts'), true);
    assert.equal(tables.includes('workplace_point_booked_worker_facts'), true);
    assert.equal(tables.includes('workplace_point_review_rollups'), true);
    assert.equal(tables.includes('workplace_point_radius_rollups'), true);
    assert.equal(tables.includes('workplace_point_radius_coverage'), true);
    db.close();
  } finally {
    store.close();
  }
});
```

- [ ] **Step 2: Add tables and indexes**

Append to `initializeSchema(db, now)` in `src/preloadStore.js`:

```sql
CREATE TABLE IF NOT EXISTS workplace_point_coverage (
  period_date TEXT PRIMARY KEY,
  source_from TEXT NOT NULL,
  source_to TEXT NOT NULL,
  refreshed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workplace_point_order_facts (
  period_date TEXT NOT NULL,
  workplace_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  profession TEXT NOT NULL DEFAULT '',
  order_type TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL DEFAULT 0,
  pieceworks TEXT NOT NULL DEFAULT '',
  order_lead_minutes REAL,
  include_deleted INTEGER NOT NULL DEFAULT 0,
  include_hidden INTEGER NOT NULL DEFAULT 0,
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY (period_date, order_id)
);

CREATE TABLE IF NOT EXISTS workplace_point_shift_facts (
  period_date TEXT NOT NULL,
  workplace_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  worker_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  is_successful_confirmed_shift INTEGER NOT NULL DEFAULT 0,
  is_forecast_active_shift INTEGER NOT NULL DEFAULT 0,
  is_dropoff_24h INTEGER NOT NULL DEFAULT 0,
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY (period_date, job_id)
);

CREATE TABLE IF NOT EXISTS workplace_point_order_status_facts (
  period_date TEXT NOT NULL,
  workplace_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  status TEXT NOT NULL,
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY (period_date, order_id, status)
);

CREATE TABLE IF NOT EXISTS workplace_point_booked_worker_facts (
  period_date TEXT NOT NULL,
  workplace_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY (period_date, job_id, worker_id)
);

CREATE TABLE IF NOT EXISTS workplace_point_review_rollups (
  workplace_id TEXT PRIMARY KEY,
  review_count REAL NOT NULL DEFAULT 0,
  avg_rating_all REAL,
  avg_rating_last_10 REAL,
  refreshed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workplace_point_radius_rollups (
  workplace_id TEXT NOT NULL,
  active_window_date TEXT NOT NULL,
  radius_km INTEGER NOT NULL,
  workers REAL NOT NULL DEFAULT 0,
  active_session_workers REAL NOT NULL DEFAULT 0,
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY (workplace_id, active_window_date, radius_km)
);

CREATE TABLE IF NOT EXISTS workplace_point_radius_coverage (
  workplace_id TEXT NOT NULL,
  active_window_date TEXT NOT NULL,
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY (workplace_id, active_window_date)
);

CREATE INDEX IF NOT EXISTS idx_wp_point_orders_lookup
  ON workplace_point_order_facts (workplace_id, period_date);
CREATE INDEX IF NOT EXISTS idx_wp_point_orders_profession
  ON workplace_point_order_facts (workplace_id, profession, period_date);
CREATE INDEX IF NOT EXISTS idx_wp_point_shifts_lookup
  ON workplace_point_shift_facts (workplace_id, period_date);
CREATE INDEX IF NOT EXISTS idx_wp_point_status_lookup
  ON workplace_point_order_status_facts (workplace_id, status, period_date);
CREATE INDEX IF NOT EXISTS idx_wp_point_booked_lookup
  ON workplace_point_booked_worker_facts (workplace_id, period_date);
```

- [ ] **Step 3: Run schema test**

Run:

```bash
npm test -- test/preloadStore.test.js
```

Expected: PASS.

---

### Task 3: Store writer и coverage helpers

**Files:**
- Modify: `src/preloadStore.js`
- Test: `test/preloadStore.test.js`

- [ ] **Step 1: Write failing replace/read coverage test**

Add to `test/preloadStore.test.js`:

```js
test('preload store replaces workplace point range and checks arbitrary coverage', async () => {
  const store = createPreloadStore({ filePath: await tempDbPath() });

  try {
    store.replaceWorkplacePointRange({
      fromDate: '2026-06-02',
      toDate: '2026-06-05',
      orderFacts: [
        {
          period_date: '2026-06-02',
          workplace_id: 'wp1',
          order_id: 'o1',
          profession: 'Сборщик',
          order_type: 'once',
          amount: 3,
          pieceworks: '',
          order_lead_minutes: 120,
          include_deleted: 0,
          include_hidden: 0
        }
      ],
      shiftFacts: [
        {
          period_date: '2026-06-02',
          workplace_id: 'wp1',
          order_id: 'o1',
          job_id: 'j1',
          worker_id: 'w1',
          status: 'confirmed',
          is_successful_confirmed_shift: 1,
          is_forecast_active_shift: 0,
          is_dropoff_24h: 0
        }
      ],
      orderStatusFacts: [
        {
          period_date: '2026-06-02',
          workplace_id: 'wp1',
          order_id: 'o1',
          status: 'confirmed'
        }
      ],
      bookedWorkerFacts: [
        {
          period_date: '2026-06-02',
          workplace_id: 'wp1',
          order_id: 'o1',
          job_id: 'j1',
          worker_id: 'w1'
        }
      ],
      reviewRollups: [
        {
          workplace_id: 'wp1',
          review_count: 2,
          avg_rating_all: 4.5,
          avg_rating_last_10: 4.5
        }
      ],
      radiusRollups: [
        {
          workplace_id: 'wp1',
          active_window_date: '2026-07-02',
          radius_km: 5,
          workers: 7,
          active_session_workers: 3
        }
      ]
    });

    assert.equal(store.hasWorkplacePointCoverage('2026-06-02', '2026-06-05'), true);
    assert.equal(store.hasWorkplacePointCoverage('2026-06-01', '2026-06-05'), false);
    assert.equal(store.hasWorkplacePointRadiusCoverage('wp1', '2026-07-02'), true);
  } finally {
    store.close();
  }
});
```

- [ ] **Step 2: Implement range replacement**

Add `replaceWorkplacePointRange` to `createPreloadStore` in `src/preloadStore.js`. It must:

```js
function replaceWorkplacePointRange({
  fromDate,
  toDate,
  orderFacts = [],
  shiftFacts = [],
  orderStatusFacts = [],
  bookedWorkerFacts = [],
  reviewRollups = [],
  radiusRollups = []
}) {
  assertValidDashboardPreloadRange(fromDate, toDate);

  const refreshedAt = toIsoString(now);

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM workplace_point_coverage WHERE period_date >= ? AND period_date < ?').run(fromDate, toDate);
    db.prepare('DELETE FROM workplace_point_order_facts WHERE period_date >= ? AND period_date < ?').run(fromDate, toDate);
    db.prepare('DELETE FROM workplace_point_shift_facts WHERE period_date >= ? AND period_date < ?').run(fromDate, toDate);
    db.prepare('DELETE FROM workplace_point_order_status_facts WHERE period_date >= ? AND period_date < ?').run(fromDate, toDate);
    db.prepare('DELETE FROM workplace_point_booked_worker_facts WHERE period_date >= ? AND period_date < ?').run(fromDate, toDate);

    for (const periodDate of enumerateDateRange(fromDate, toDate)) {
      db.prepare(`
INSERT INTO workplace_point_coverage (period_date, source_from, source_to, refreshed_at)
VALUES (?, ?, ?, ?)
`).run(periodDate, fromDate, toDate, refreshedAt);
    }

    // Prepare INSERT statements once, then loop through normalized rows.
    // Use finiteNumber for numeric fields and String(value || '') for ids.

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
```

Fill the insert loops in the same style as `replaceSalesByProjectRange`: strict date validation with `assertRowsInsideRange`, `finiteNumber` for numbers, no empty `order_id`/`job_id` for primary facts.

- [ ] **Step 3: Implement coverage helpers**

Add:

```js
function hasWorkplacePointCoverage(fromDate, toDate) {
  assertValidDashboardPreloadRange(fromDate, toDate);

  const dates = enumerateDateRange(fromDate, toDate);

  if (dates.length === 0) {
    return true;
  }

  const row = db.prepare(`
SELECT COUNT(*) AS covered_days
FROM workplace_point_coverage
WHERE period_date >= ? AND period_date < ?
`).get(fromDate, toDate);

  return Number(row.covered_days || 0) === dates.length;
}

function hasWorkplacePointRadiusCoverage(workplaceId, activeWindowDate) {
  const row = db.prepare(`
SELECT 1 AS ok
FROM workplace_point_radius_coverage
WHERE workplace_id = ? AND active_window_date = ?
LIMIT 1
`).get(String(workplaceId || ''), String(activeWindowDate || ''));

  return Boolean(row);
}
```

Export both methods from the store object.

- [ ] **Step 4: Run focused test**

Run:

```bash
npm test -- test/preloadStore.test.js
```

Expected: PASS.

---

### Task 4: SQLite section readers for `summary`, `charts`, `radius`

**Files:**
- Modify: `src/preloadStore.js`
- Test: `test/preloadStore.test.js`

- [ ] **Step 1: Write failing reader test**

Add to `test/preloadStore.test.js`:

```js
test('preload store reads workplace point sections for arbitrary covered period', async () => {
  const store = createPreloadStore({ filePath: await tempDbPath() });

  try {
    store.replaceWorkplacePointRange({
      fromDate: '2026-06-01',
      toDate: '2026-06-04',
      orderFacts: [
        { period_date: '2026-06-01', workplace_id: 'wp1', order_id: 'o1', profession: 'Сборщик', order_type: 'once', amount: 2, order_lead_minutes: 60 },
        { period_date: '2026-06-03', workplace_id: 'wp1', order_id: 'o2', profession: 'Кассир', order_type: 'regular', amount: 1, order_lead_minutes: 30 }
      ],
      shiftFacts: [
        { period_date: '2026-06-01', workplace_id: 'wp1', order_id: 'o1', job_id: 'j1', worker_id: 'w1', status: 'confirmed', is_successful_confirmed_shift: 1 },
        { period_date: '2026-06-03', workplace_id: 'wp1', order_id: 'o2', job_id: 'j2', worker_id: 'w2', status: 'cancelled', is_dropoff_24h: 1 }
      ],
      orderStatusFacts: [
        { period_date: '2026-06-01', workplace_id: 'wp1', order_id: 'o1', status: 'confirmed' },
        { period_date: '2026-06-03', workplace_id: 'wp1', order_id: 'o2', status: 'cancelled' }
      ],
      bookedWorkerFacts: [
        { period_date: '2026-06-01', workplace_id: 'wp1', order_id: 'o1', job_id: 'j1', worker_id: 'w1' }
      ],
      reviewRollups: [
        { workplace_id: 'wp1', review_count: 1, avg_rating_all: 5, avg_rating_last_10: 5 }
      ],
      radiusRollups: [
        { workplace_id: 'wp1', active_window_date: '2026-07-02', radius_km: 5, workers: 10, active_session_workers: 4 },
        { workplace_id: 'wp1', active_window_date: '2026-07-02', radius_km: 10, workers: 20, active_session_workers: 8 }
      ]
    });

    const summary = store.readWorkplacePointSectionRows({
      section: 'summary',
      filters: {
        workplaceId: 'wp1',
        from: '2026-06-01',
        to: '2026-06-03',
        currentDate: '2026-07-02',
        profession: [],
        orderType: [],
        jobStatus: [],
        activeSessionToDate: '2026-07-02'
      },
      fromDate: '2026-06-01',
      toDate: '2026-06-04'
    });

    assert.deepEqual(summary.summaryRows[0].ordered_shifts, 3);
    assert.deepEqual(summary.summaryRows[0].completed_shifts, 1);
    assert.deepEqual(summary.reviewSummaryRows[0].review_count, 1);

    const charts = store.readWorkplacePointSectionRows({
      section: 'charts',
      filters: {
        workplaceId: 'wp1',
        from: '2026-06-01',
        to: '2026-06-03',
        profession: [],
        orderType: [],
        jobStatus: []
      },
      fromDate: '2026-06-01',
      toDate: '2026-06-04'
    });

    assert.equal(charts.dailyRows.length, 2);
    assert.equal(charts.professionRows.length, 2);
  } finally {
    store.close();
  }
});
```

- [ ] **Step 2: Implement `readWorkplacePointSectionRows`**

Add a helper that returns `null` when coverage is incomplete:

```js
function readWorkplacePointSectionRows({ section, filters, fromDate, toDate }) {
  if (!hasWorkplacePointCoverage(fromDate, toDate)) {
    return null;
  }

  if (section === 'summary') {
    return readWorkplacePointSummaryRows(filters, fromDate, toDate);
  }

  if (section === 'charts' || section === 'year-heatmap') {
    return readWorkplacePointChartRows(filters, fromDate, toDate, section);
  }

  if (section === 'radius') {
    if (!hasWorkplacePointRadiusCoverage(filters.workplaceId, filters.activeSessionToDate || filters.currentDate)) {
      return null;
    }

    return readWorkplacePointRadiusRows(filters);
  }

  throw new Error(`Unknown workplace point preload section: ${section}`);
}
```

Use SQLite parameter binding. Do not concatenate filter values into SQL. Build optional predicates as arrays and bind values:

```js
function workplacePointSqlFilter(filters, alias = 'o') {
  const where = [`${alias}.workplace_id = ?`];
  const params = [filters.workplaceId];

  if (Array.isArray(filters.profession) && filters.profession.length > 0) {
    where.push(`${alias}.profession IN (${filters.profession.map(() => '?').join(', ')})`);
    params.push(...filters.profession);
  }

  if (Array.isArray(filters.orderType) && filters.orderType.length > 0) {
    where.push(`${alias}.order_type IN (${filters.orderType.map(() => '?').join(', ')})`);
    params.push(...filters.orderType);
  }

  return { where, params };
}
```

For `jobStatus`, filter eligible order ids through `workplace_point_order_status_facts`:

```sql
AND o.order_id IN (
  SELECT os.order_id
  FROM workplace_point_order_status_facts AS os
  WHERE os.workplace_id = o.workplace_id
    AND os.period_date >= ?
    AND os.period_date < ?
    AND os.status IN (?, ...)
)
```

- [ ] **Step 3: Return row shapes matching ClickHouse loaders**

Readers must return the same keys expected by `mergeWorkplacePointRows`:

```js
return {
  summaryRows: [{
    ordered_shifts,
    completed_shifts,
    sla_ordered_shifts,
    sla_completed_shifts,
    forecast_sla_ordered_shifts,
    forecast_sla_active_shifts,
    active_days,
    unique_completed_workers,
    unique_booked_workers,
    dropoffs_24h
  }],
  reviewSummaryRows: [{
    review_count,
    avg_rating_all,
    avg_rating_last_10
  }]
};
```

For charts:

```js
return {
  dailyRows: [
    {
      period,
      ordered_shifts,
      avg_order_lead_minutes,
      min_order_lead_minutes,
      completed_shifts,
      forecast_sla_active_shifts,
      dropoffs_24h
    }
  ],
  professionRows: [
    { profession, ordered_shifts }
  ]
};
```

For `year-heatmap`, return `{ yearHeatmapRows: dailyRows }`.

For `radius`, return:

```js
return {
  radiusRows: [
    { radius_km: 5, workers: 10, active_session_workers: 4 }
  ]
};
```

- [ ] **Step 4: Run store tests**

Run:

```bash
npm test -- test/preloadStore.test.js
```

Expected: PASS.

---

### Task 5: ClickHouse loader `preloadWorkplacePoint`

**Files:**
- Create: `src/preloadWorkplacePoint.js`
- Test: `test/preloadWorkplacePoint.test.js`

- [ ] **Step 1: Write failing loader test**

Create `test/preloadWorkplacePoint.test.js`:

```js
const assert = require('node:assert/strict');
const test = require('node:test');
const {
  WORKPLACE_POINT_PRELOAD_JOB_ID
} = require('../src/preloadStore');
const {
  refreshWorkplacePointPreload
} = require('../src/preloadWorkplacePoint');

test('refreshWorkplacePointPreload writes normalized facts for the requested range', async () => {
  const calls = [];
  const saved = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'workplace point preload order facts') {
        return [{ period_date: '2026-06-02', workplace_id: 'wp1', order_id: 'o1', amount: 2 }];
      }
      if (operation === 'workplace point preload shift facts') {
        return [{ period_date: '2026-06-02', workplace_id: 'wp1', order_id: 'o1', job_id: 'j1', status: 'confirmed' }];
      }
      if (operation === 'workplace point preload order status facts') {
        return [{ period_date: '2026-06-02', workplace_id: 'wp1', order_id: 'o1', status: 'confirmed' }];
      }
      if (operation === 'workplace point preload booked workers') {
        return [];
      }
      if (operation === 'workplace point preload review rollups') {
        return [];
      }
      if (operation === 'workplace point preload radius rollups') {
        return [];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  };
  const store = {
    listDashboardPreloadRequests(jobId) {
      assert.equal(jobId, WORKPLACE_POINT_PRELOAD_JOB_ID);
      return [{ input: { workplaceId: 'wp1' } }];
    },
    replaceWorkplacePointRange(input) {
      saved.push(input);
    }
  };

  const result = await refreshWorkplacePointPreload({
    client,
    store,
    fromDate: '2026-06-02',
    toDate: '2026-08-02',
    now: new Date('2026-07-02T05:00:00.000Z')
  });

  assert.equal(result.rowsWritten, 1);
  assert.equal(saved[0].fromDate, '2026-06-02');
  assert.equal(saved[0].toDate, '2026-08-02');
  assert.equal(saved[0].orderFacts.length, 1);
  assert.deepEqual(calls.map((call) => call.operation), [
    'workplace point preload order facts',
    'workplace point preload shift facts',
    'workplace point preload order status facts',
    'workplace point preload booked workers',
    'workplace point preload review rollups',
    'workplace point preload radius rollups'
  ]);
});
```

- [ ] **Step 2: Create loader skeleton**

Create `src/preloadWorkplacePoint.js`:

```js
const { WORKPLACE_POINT_PRELOAD_JOB_ID } = require('./preloadStore');

const WORKPLACE_POINT_DASHBOARD_ID = 'workplace-point';
const WORKPLACE_POINT_PRELOAD_SECTIONS = ['summary', 'charts', 'year-heatmap', 'radius'];

function uniqueTextValues(values) {
  return [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function activeWindowDate(now) {
  return now.toISOString().slice(0, 10);
}

function hotWorkplaceIdsFromRequests(requests) {
  return uniqueTextValues(
    (Array.isArray(requests) ? requests : [])
      .map((request) => request && request.input && request.input.workplaceId)
  );
}

async function refreshWorkplacePointPreload({
  client,
  store,
  fromDate,
  toDate,
  now = new Date()
}) {
  const requests = typeof store.listDashboardPreloadRequests === 'function'
    ? store.listDashboardPreloadRequests(WORKPLACE_POINT_PRELOAD_JOB_ID, 1000)
    : [];
  const hotWorkplaceIds = hotWorkplaceIdsFromRequests(requests);
  const params = {
    param_from: `${fromDate} 00:00:00`,
    param_to: `${toDate} 00:00:00`,
    param_current_date: activeWindowDate(now),
    param_workplace_ids: hotWorkplaceIds
  };

  const [
    orderFacts,
    shiftFacts,
    orderStatusFacts,
    bookedWorkerFacts,
    reviewRollups,
    radiusRollups
  ] = await Promise.all([
    client.queryJSONEachRow(orderFactsQuery(), params, 'workplace point preload order facts'),
    client.queryJSONEachRow(shiftFactsQuery(), params, 'workplace point preload shift facts'),
    client.queryJSONEachRow(orderStatusFactsQuery(), params, 'workplace point preload order status facts'),
    client.queryJSONEachRow(bookedWorkerFactsQuery(), params, 'workplace point preload booked workers'),
    client.queryJSONEachRow(reviewRollupsQuery(hotWorkplaceIds.length > 0), params, 'workplace point preload review rollups'),
    client.queryJSONEachRow(radiusRollupsQuery(hotWorkplaceIds.length > 0), params, 'workplace point preload radius rollups')
  ]);

  store.replaceWorkplacePointRange({
    fromDate,
    toDate,
    orderFacts,
    shiftFacts,
    orderStatusFacts,
    bookedWorkerFacts,
    reviewRollups,
    radiusRollups
  });

  return { rowsWritten: orderFacts.length + shiftFacts.length + radiusRollups.length };
}

module.exports = {
  WORKPLACE_POINT_DASHBOARD_ID,
  WORKPLACE_POINT_PRELOAD_SECTIONS,
  refreshWorkplacePointPreload
};
```

- [ ] **Step 3: Implement query builders**

Implement these functions in `src/preloadWorkplacePoint.js`:

```js
function orderFactsQuery() {
  return `SELECT
    toString(toDate(o.start)) AS period_date,
    ifNull(o.workplace, '') AS workplace_id,
    o._id AS order_id,
    if(ifNull(p.caption, '') = '', o.spec, p.caption) AS profession,
    ifNull(o.type, '') AS order_type,
    ifNull(o.amount, 0) AS amount,
    toString(o.pieceworks) AS pieceworks,
    if(
      o.createdAt IS NOT NULL
      AND o.start IS NOT NULL
      AND o.createdAt <= o.start,
      dateDiff('minute', o.createdAt, o.start),
      NULL
    ) AS order_lead_minutes,
    ifNull(o.deleted, 0) AS include_deleted,
    ifNull(o.is_hidden, 0) AS include_hidden
  FROM mg_orders AS o
  LEFT JOIN mg_professions AS p ON o.spec = p.spec
  LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
  LEFT JOIN mg_clients AS c ON o.client = c._id
  LEFT JOIN mg_contractors AS ct ON w.contractor = ct._id
  WHERE o.start >= {from:DateTime}
    AND o.start < {to:DateTime}
    AND ifNull(o.workplace, '') != ''
    AND ifNull(o.amount, 0) > 0
    AND ifNull(c.is_test, 0) = 0
    AND ifNull(ct.contract_type, '') != 'processing'
  FORMAT JSONEachRow`;
}
```

Use existing domain SQL helpers if field names differ in `actualOrderDomainCondition`. Keep the source tables `mg_*`.

`shiftFactsQuery` must join only orders from the range and calculate `is_successful_confirmed_shift` with the same logic as `successfulConfirmedShiftFlagExpression`.

`orderStatusFactsQuery` must produce distinct statuses by `order_id` so the `jobStatus` filter does not duplicate order amount.

`bookedWorkerFactsQuery` must read `mg_job_history` only for jobs linked to range orders and `status = 'booked'`.

`reviewRollupsQuery` must aggregate by `j.workplace` and filter to `hotWorkplaceIds` when provided.

`radiusRollupsQuery` must filter to `hotWorkplaceIds` and use bounding predicates before `greatCircleDistance`; never cross join all workers to all workplaces without a bounding box.

- [ ] **Step 4: Run loader test**

Run:

```bash
npm test -- test/preloadWorkplacePoint.test.js
```

Expected: PASS.

---

### Task 6: Preload service facade and scheduler registration

**Files:**
- Modify: `src/preloadService.js`
- Test: `test/preloadScheduler.test.js`

- [ ] **Step 1: Write failing service facade test**

Add to `test/preloadScheduler.test.js`:

```js
test('preload service exposes workplace point facade methods', async () => {
  const calls = [];
  const store = {
    listJobs() {
      return [{ id: WORKPLACE_POINT_PRELOAD_JOB_ID }];
    },
    getJob(jobId) {
      return { id: jobId };
    },
    listRuns() {
      return [];
    },
    saveJobSchedule() {
      return {};
    },
    registerDashboardPreloadRequest(input) {
      calls.push({ method: 'register', input });
    },
    readWorkplacePointSectionRows(input) {
      calls.push({ method: 'readWorkplacePointSectionRows', input });
      return { summaryRows: [] };
    },
    hasWorkplacePointCoverage() {
      return true;
    },
    readDashboardPreloadResult() {
      return null;
    },
    saveDashboardPreloadResult() {},
    startRun() {
      return { id: 1, jobId: WORKPLACE_POINT_PRELOAD_JOB_ID };
    },
    finishRun() {
      return { id: 1, status: 'success' };
    },
    close() {}
  };
  const scheduler = {
    reschedule() {},
    runNow(input) {
      calls.push({ method: 'runNow', input });
      return Promise.resolve({ status: 'success' });
    },
    stop() {},
    drain() {
      return Promise.resolve();
    }
  };
  const service = createPreloadService({
    client: {},
    store,
    scheduler,
    sanitizeError: (error) => error.message
  });

  service.registerWorkplacePointRequest({
    section: 'summary',
    cacheKey: 'key',
    input: { workplaceId: 'wp1' }
  });
  const rows = service.readWorkplacePointSection({
    section: 'summary',
    filters: { workplaceId: 'wp1' },
    fromDate: '2026-06-01',
    toDate: '2026-06-10'
  });
  await service.runWorkplacePoint({ fromDate: '2026-06-02', toDate: '2026-08-02' });

  assert.deepEqual(rows, { summaryRows: [] });
  assert.equal(calls.some((call) => call.method === 'register'), true);
  assert.equal(calls.some((call) => call.method === 'readWorkplacePointSectionRows'), true);
  assert.equal(calls.some((call) => call.method === 'runNow'), true);
});
```

- [ ] **Step 2: Register loader and methods**

In `src/preloadService.js`, import:

```js
const {
  WORKPLACE_POINT_PRELOAD_JOB_ID
} = require('./preloadStore');
const { refreshWorkplacePointPreload } = require('./preloadWorkplacePoint');
```

Add loader:

```js
[WORKPLACE_POINT_PRELOAD_JOB_ID]: ({ fromDate, toDate }) =>
  refreshWorkplacePointPreload({
    client,
    store: actualStore,
    fromDate,
    toDate
  })
```

Add methods:

```js
runWorkplacePoint(input) {
  return this.runJob({
    jobId: WORKPLACE_POINT_PRELOAD_JOB_ID,
    fromDate: input.fromDate,
    toDate: input.toDate
  });
},
registerWorkplacePointRequest(input) {
  return actualStore.registerDashboardPreloadRequest({
    jobId: WORKPLACE_POINT_PRELOAD_JOB_ID,
    dashboardId: 'workplace-point',
    section: input.section,
    cacheKey: input.cacheKey,
    input: input.input || {}
  });
},
readWorkplacePointSection(input) {
  return actualStore.readWorkplacePointSectionRows(input);
}
```

- [ ] **Step 3: Run service tests**

Run:

```bash
npm test -- test/preloadScheduler.test.js
```

Expected: PASS.

---

### Task 7: Card section reads from preload before ClickHouse

**Files:**
- Modify: `src/workplacePointDashboard.js`
- Modify: `src/server.js`
- Test: `test/workplacePointDashboard.test.js`
- Test: `test/serverAuth.test.js`

- [ ] **Step 1: Write failing dashboard preload-hit test**

Add to `test/workplacePointDashboard.test.js`:

```js
test('loadWorkplacePointDashboardSection reads summary from preload when covered', async () => {
  const registerCalls = [];
  const client = {
    async queryJSONEachRow() {
      throw new Error('ClickHouse should not be queried on preload hit');
    }
  };
  const preloadService = {
    registerWorkplacePointRequest(input) {
      registerCalls.push(input);
    },
    readWorkplacePointSection(input) {
      assert.equal(input.section, 'summary');
      assert.equal(input.fromDate, '2026-06-01');
      assert.equal(input.toDate, '2026-06-04');
      return {
        summaryRows: [{ ordered_shifts: 3, completed_shifts: 2, active_days: 2 }],
        reviewSummaryRows: [{ review_count: 0 }]
      };
    }
  };

  const dashboard = await loadWorkplacePointDashboardSection(
    client,
    { workplaceId: 'wp1', from: '2026-06-01', to: '2026-06-03' },
    'summary',
    new Date('2026-07-02T05:00:00.000Z'),
    { preloadService }
  );

  assert.equal(dashboard.dataSource, 'preload');
  assert.equal(dashboard.summary.orderedShifts, 3);
  assert.equal(registerCalls.length, 1);
});
```

- [ ] **Step 2: Write fallback test**

Add:

```js
test('loadWorkplacePointDashboardSection falls back to ClickHouse on preload miss', async () => {
  const calls = [];
  const saved = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'workplace point summary') {
        return [{ ordered_shifts: 1, completed_shifts: 1, active_days: 1 }];
      }
      if (operation === 'workplace point review summary') {
        return [{ review_count: 0 }];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  };
  const preloadService = {
    registerWorkplacePointRequest() {},
    readWorkplacePointSection() {
      return null;
    },
    saveWorkplacePointSection(input) {
      saved.push(input);
    }
  };

  const dashboard = await loadWorkplacePointDashboardSection(
    client,
    { workplaceId: 'wp1', from: '2026-06-01', to: '2026-06-01' },
    'summary',
    new Date('2026-07-02T05:00:00.000Z'),
    { preloadService }
  );

  assert.equal(dashboard.dataSource, 'clickhouse');
  assert.deepEqual(calls.map((call) => call.operation), [
    'workplace point summary',
    'workplace point review summary'
  ]);
  assert.equal(saved.length, 1);
});
```

- [ ] **Step 3: Implement preload read in dashboard section loader**

In `src/workplacePointDashboard.js`, update `loadWorkplacePointDashboardSection`:

```js
const cacheKey = cacheKeyForWorkplacePointSection(section, filters);
const fromDate = filters.from;
const toDate = toExclusiveDateFromFilters(filters);

if (options.preloadService && typeof options.preloadService.registerWorkplacePointRequest === 'function') {
  options.preloadService.registerWorkplacePointRequest({
    section,
    cacheKey,
    input: filters
  });
}

if (options.preloadService && typeof options.preloadService.readWorkplacePointSection === 'function') {
  const preloadedRows = options.preloadService.readWorkplacePointSection({
    section,
    filters,
    fromDate,
    toDate
  });

  if (preloadedRows) {
    return {
      ...mergeWorkplacePointSection(filters, preloadedRows),
      dataSource: 'preload'
    };
  }
}
```

Then keep the existing `readThroughCache` ClickHouse fallback. After fallback, call `saveWorkplacePointSection` if provided:

```js
if (options.preloadService && typeof options.preloadService.saveWorkplacePointSection === 'function') {
  options.preloadService.saveWorkplacePointSection({
    section,
    cacheKey,
    fromDate,
    toDate,
    payload: dashboard
  });
}
```

Use the existing `toExclusiveDateTime` logic; do not create date strings by string concatenation if a helper already exists.

- [ ] **Step 4: Pass preload service from server**

In `src/server.js`, update `/dashboards/workplace-analysis/point/section`:

```js
const dashboard = await loadWorkplacePointDashboardSection(
  client,
  req.query,
  section,
  new Date(),
  {
    cache: dashboardSectionCache,
    preloadService: preloads
  }
);
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm test -- test/workplacePointDashboard.test.js test/serverAuth.test.js
```

Expected: PASS.

---

### Task 8: UI fragment priority and lower ClickHouse contention

**Files:**
- Modify: `src/render.js`
- Test: `test/render.test.js`

- [ ] **Step 1: Write failing render test for deferred heavy point sections**

Add to `test/render.test.js`:

```js
test('workplace point dashboard defers heavy radius and year fragments', () => {
  const html = renderWorkplacePointDashboard({
    database: 'etl',
    progressive: true,
    dashboard: {
      filters: {
        workplaceId: 'wp1',
        from: '2026-06-01',
        to: '2026-06-30',
        profession: [],
        orderType: [],
        jobStatus: [],
        includeDeletedOrders: false,
        includeHiddenOrders: false
      },
      point: { title: 'Точка', address: 'Москва' }
    },
    currentUser: null
  });

  assert.match(html, /section=summary/);
  assert.match(html, /section=charts/);
  assert.match(html, /section=radius[^"]*" data-dashboard-fragment-defer="idle"/);
  assert.match(html, /section=year-heatmap[^"]*" data-dashboard-fragment-defer="visible"/);
});
```

- [ ] **Step 2: Mark section priority**

In `renderWorkplacePointDashboard`, keep `summary` and `charts` eager. Change `radius` wrapper:

```html
<div data-dashboard-fragment-url="..." data-dashboard-fragment-defer="idle">
```

Change `year-heatmap` wrapper:

```html
<div data-dashboard-fragment-url="..." data-dashboard-fragment-defer="visible">
```

- [ ] **Step 3: Limit fragment concurrency**

In the global dashboard fragment script, replace immediate `fetch` for all eager roots with a small queue:

```js
var dashboardFragmentQueue = [];
var dashboardFragmentActive = 0;
var dashboardFragmentLimit = 2;

function enqueueDashboardFragment(root) {
  dashboardFragmentQueue.push(root);
  pumpDashboardFragmentQueue();
}

function pumpDashboardFragmentQueue() {
  while (dashboardFragmentActive < dashboardFragmentLimit && dashboardFragmentQueue.length > 0) {
    loadQueuedDashboardFragment(dashboardFragmentQueue.shift());
  }
}

function loadQueuedDashboardFragment(root) {
  dashboardFragmentActive += 1;
  fetchDashboardFragment(root).finally(function () {
    dashboardFragmentActive -= 1;
    pumpDashboardFragmentQueue();
  });
}
```

Implement `fetchDashboardFragment(root)` by extracting the current fetch body. Keep existing error behavior.

- [ ] **Step 4: Add idle and visible defer behavior**

For `data-dashboard-fragment-defer="idle"`:

```js
var runIdle = window.requestIdleCallback || function (callback) { return setTimeout(callback, 500); };
runIdle(function () { enqueueDashboardFragment(root); });
```

For `data-dashboard-fragment-defer="visible"` use `IntersectionObserver` when available, otherwise idle fallback.

- [ ] **Step 5: Run render tests**

Run:

```bash
npm test -- test/render.test.js
```

Expected: PASS.

---

### Task 9: Admin preload page and diagnostics

**Files:**
- Modify: `src/preloadService.js`
- Modify: `src/preloadStore.js`
- Modify: `src/render.js`
- Test: `test/preloadStore.test.js`
- Test: `test/serverAuth.test.js`

- [ ] **Step 1: Add diagnostics store method**

Add to `src/preloadStore.js`:

```js
function getWorkplacePointDiagnostics() {
  const coverage = db.prepare(`
SELECT
  MIN(period_date) AS min_date,
  MAX(period_date) AS max_date,
  COUNT(*) AS days
FROM workplace_point_coverage
`).get();
  const orders = db.prepare('SELECT COUNT(*) AS rows FROM workplace_point_order_facts').get();
  const shifts = db.prepare('SELECT COUNT(*) AS rows FROM workplace_point_shift_facts').get();
  const radius = db.prepare('SELECT COUNT(*) AS rows FROM workplace_point_radius_rollups').get();

  return {
    coverage: {
      minDate: coverage && coverage.min_date ? coverage.min_date : '',
      maxDate: coverage && coverage.max_date ? coverage.max_date : '',
      days: Number(coverage && coverage.days ? coverage.days : 0)
    },
    tables: {
      orderFacts: Number(orders && orders.rows ? orders.rows : 0),
      shiftFacts: Number(shifts && shifts.rows ? shifts.rows : 0),
      radiusRollups: Number(radius && radius.rows ? radius.rows : 0)
    },
    lastRuns: listRuns(WORKPLACE_POINT_PRELOAD_JOB_ID, 5)
  };
}
```

- [ ] **Step 2: Expose diagnostics through service**

In `src/preloadService.js`, add to `getDiagnostics()`:

```js
workplacePoint: actualStore.getWorkplacePointDiagnostics()
```

- [ ] **Step 3: Render compact diagnostics**

In `renderPreloadManagement`, extend the diagnostics block to include `workplacePoint` with labels:

```text
Карточка точки: покрытие, order facts, shift facts, radius rollups
```

- [ ] **Step 4: Run auth/admin tests**

Run:

```bash
npm test -- test/serverAuth.test.js test/preloadStore.test.js
```

Expected: PASS.

---

### Task 10: Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/dashboards/workplace-point.md`
- Modify: `.env.example`

- [ ] **Step 1: Update `.env.example` only if needed**

No new env var is required if `PRELOAD_STORE_PATH` remains shared. Do not add a redundant variable.

- [ ] **Step 2: Update README preload section**

Add under `### Предзагрузка витрин`:

```md
- `workplace-point` - структурированная SQLite-витрина для карточки точки. По расписанию обновляет окно 30 дней назад и 30 дней вперед от текущей даты; schedule по умолчанию `08:00 Europe/Moscow`. Витрина хранит дневные факты заказов и смен, поэтому секции карточки могут читать произвольный период, если все даты периода уже покрыты витриной. При неполном покрытии секция использует ClickHouse fallback и регистрирует запрос для следующего прогрева.
```

Add deploy note:

```md
Для `workplace-point` особенно важно, чтобы `./data:/app/data` был доступен на запись пользователю контейнера `node`, потому что факты и coverage пишутся в `data/preload.sqlite`.
```

- [ ] **Step 3: Update dashboard docs**

In `docs/dashboards/workplace-point.md`, add:

```md
## Предзагруженная витрина

Секции `summary`, `charts`, `year-heatmap` и `radius` сначала пытаются читать `workplace-point` из SQLite. `summary` и `charts` работают по произвольному периоду, если `workplace_point_coverage` полностью покрывает даты фильтра. Ежедневный scheduled run обновляет окно `-30/+30` дней в `08:00 Europe/Moscow`; ручной запуск `/admin/preload` может покрыть более длинный период, например текущий год для `year-heatmap`.

Если покрытие неполное, секция сохраняет текущее поведение и читает ClickHouse напрямую. Такой промах регистрируется в `preload_dashboard_requests`, чтобы следующий scheduled или ручной прогрев мог заполнить нужную комбинацию.
```

- [ ] **Step 4: Run docs-free test suite**

Run:

```bash
npm test
```

Expected: PASS.

---

### Task 11: End-to-end verification

**Files:**
- No required source edits.

- [ ] **Step 1: Run full tests**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Manual scheduled window check**

Run a manual preload from admin UI or service test harness with:

```text
jobId = workplace-point
from = 2026-06-02
to = 2026-08-01
```

Expected:

- run status `success`;
- `workplace_point_coverage` has 61 daily rows for exclusive range `2026-06-02..2026-08-02`;
- `/admin/preload` shows job `Карточка точки`, schedule `08:00`, windows `30 / 30`.

- [ ] **Step 3: Manual card check**

Open:

```text
http://localhost:3000/dashboards/workplace-analysis/point?workplaceId=<known_id>&from=2026-06-10&to=2026-06-20
```

Expected:

- shell renders quickly;
- `summary` and `charts` sections show without ClickHouse delay when coverage exists;
- `radius` may load after idle, and uses ClickHouse only if that point has no radius rollup;
- changing to an uncovered period still renders via ClickHouse fallback.

---

## Self-review

- Требование ежедневного обновления `-30/+30` в 08:00 MSK покрыто Task 1, Task 5, Task 6.
- Требование произвольного периода покрыто Task 2, Task 3, Task 4: факты хранятся по дням, reader проверяет coverage и группирует по выбранным датам.
- Узкое место `radius` покрыто Task 5 и Task 8: rollup для горячих точек, bounding predicates, deferred loading.
- Безопасность сохранена: произвольный SQL в UI не добавляется, фильтры SQLite строятся через bound-параметры, ClickHouse использует существующие параметры.
- Runtime-файлы остаются в `data/preload.sqlite`; документация по writable volume обновляется.
