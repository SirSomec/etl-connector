# Worker Cancellations Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `Отмены гигерами` dashboard with server-side filtering, sorting, pagination, section loading, and full worker PII display.

**Architecture:** Add one focused dashboard data module, one renderer section, one permission/navigation entry, and two Express routes. Follow the existing Express + server-rendered HTML + `data-dashboard-fragment-url` pattern; heavy ClickHouse aggregation runs only in the section endpoint and is cached through `dashboardSectionCache`.

**Tech Stack:** Node.js 20+ built-in `node:test`, Express, server-rendered HTML in `src/render.js`, ClickHouse queries through `ClickHouseClient.queryJSONEachRow`.

---

## Scope Check

The approved spec covers one subsystem: a single read-only analytics dashboard. It does not need decomposition into multiple implementation plans.

## File Structure

- Create `src/workerCancellationsDashboard.js`: filter normalization, pagination, sort whitelist, ClickHouse SQL, row mapping, shell loader, section loader, cache key.
- Create `test/workerCancellationsDashboard.test.js`: unit tests for filters, SQL safety, metric query semantics, row mapping, pagination, and cache use.
- Modify `src/render.js`: nav entry, section URL helpers, sortable worker table, dashboard shell, section renderer, exports.
- Modify `test/render.test.js`: render tests for nav, shell, sortable headers, pagination, full phone output, escaping, and empty state.
- Modify `src/auth.js`: add `worker-cancellations` permission definition.
- Modify `test/auth.test.js` and `test/renderAuth.test.js`: ensure analyst permission normalization and account-management UI include the new permission.
- Modify `src/server.js`: imports, active nav mapping, dashboard shell route, section route, error handling.
- Modify `test/server.test.js`: fake client operations and route/section/cache/error tests.
- Modify `README.md`: list the new dashboard route and describe the PII exception.

Before editing any file, run `git status --short`. This repo may already contain unrelated user edits in tests; do not overwrite or revert them.

---

### Task 1: Dashboard Data Module

**Files:**
- Create: `src/workerCancellationsDashboard.js`
- Create: `test/workerCancellationsDashboard.test.js`

- [ ] **Step 1: Write the failing module tests**

Create `test/workerCancellationsDashboard.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  WORKER_CANCELLATIONS_SECTIONS,
  loadWorkerCancellationsDashboardSection,
  loadWorkerCancellationsDashboardShell,
  mergeWorkerCancellationRows,
  normalizeWorkerCancellationFilters
} = require('../src/workerCancellationsDashboard');

const { createDashboardSectionCache } = require('../src/dashboardSectionCache');

function createDashboardClient(rowsByOperation = {}) {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });
      return rowsByOperation[operation] || [];
    }
  };

  return { calls, client };
}

test('normalizeWorkerCancellationFilters defaults to current month and whitelists pagination and sort', () => {
  const filters = normalizeWorkerCancellationFilters(
    {
      from: '2026-05-10',
      to: '2026-05-20',
      page: '3',
      pageSize: '200',
      sort: 'phone',
      direction: 'asc'
    },
    new Date('2026-06-03T12:00:00.000Z')
  );

  assert.deepEqual(filters, {
    from: '2026-05-10',
    to: '2026-05-20',
    fromDateTime: '2026-05-10 00:00:00',
    toExclusiveDateTime: '2026-05-21 00:00:00',
    page: 3,
    pageSize: 200,
    offset: 400,
    sort: 'phone',
    direction: 'asc'
  });
});

test('normalizeWorkerCancellationFilters falls back from unsafe values', () => {
  const filters = normalizeWorkerCancellationFilters(
    {
      from: 'not-a-date',
      to: '2026-99-99',
      page: '-9',
      pageSize: '9999',
      sort: 'workerCancellations24h DESC; DROP TABLE mg_jobs; --',
      direction: 'sideways'
    },
    new Date('2026-06-03T12:00:00.000Z')
  );

  assert.equal(filters.from, '2026-06-01');
  assert.equal(filters.to, '2026-06-03');
  assert.equal(filters.fromDateTime, '2026-06-01 00:00:00');
  assert.equal(filters.toExclusiveDateTime, '2026-06-04 00:00:00');
  assert.equal(filters.page, 1);
  assert.equal(filters.pageSize, 100);
  assert.equal(filters.offset, 0);
  assert.equal(filters.sort, 'workerCancellations24h');
  assert.equal(filters.direction, 'desc');
});

test('mergeWorkerCancellationRows maps ClickHouse rows and pagination values', () => {
  const dashboard = mergeWorkerCancellationRows(
    normalizeWorkerCancellationFilters(
      { from: '2026-05-01', to: '2026-05-31', page: '2', pageSize: '50' },
      new Date('2026-06-03T12:00:00.000Z')
    ),
    [
      {
        worker_id: 'worker-1',
        full_name: 'Иванов Иван Иванович',
        phone: '+79990000000',
        city: 'Москва',
        confirmed_shifts: '10',
        worker_cancellations: '3',
        worker_cancellations_24h: '2',
        post_start_cancellations: '1',
        failed_shifts: '4'
      },
      {
        worker_id: 'worker-2',
        full_name: '',
        phone: '',
        city: '',
        confirmed_shifts: null,
        worker_cancellations: null,
        worker_cancellations_24h: null,
        post_start_cancellations: null,
        failed_shifts: null
      }
    ],
    [{ total_workers: '75' }]
  );

  assert.deepEqual(dashboard.rows[0], {
    workerId: 'worker-1',
    fullName: 'Иванов Иван Иванович',
    phone: '+79990000000',
    city: 'Москва',
    confirmedShifts: 10,
    workerCancellations: 3,
    workerCancellations24h: 2,
    postStartCancellations: 1,
    failedShifts: 4
  });
  assert.deepEqual(dashboard.rows[1], {
    workerId: 'worker-2',
    fullName: 'worker-2',
    phone: '',
    city: '',
    confirmedShifts: 0,
    workerCancellations: 0,
    workerCancellations24h: 0,
    postStartCancellations: 0,
    failedShifts: 0
  });
  assert.deepEqual(dashboard.pagination, {
    page: 2,
    pageSize: 50,
    totalWorkers: 75,
    totalPages: 2,
    hasPrevious: true,
    hasNext: false
  });
});

test('loadWorkerCancellationsDashboardShell returns filters and does not query ClickHouse', async () => {
  const { calls, client } = createDashboardClient();
  const dashboard = await loadWorkerCancellationsDashboardShell(
    client,
    { from: '2026-05-01', to: '2026-05-31' },
    new Date('2026-06-03T12:00:00.000Z')
  );

  assert.equal(calls.length, 0);
  assert.equal(dashboard.filters.from, '2026-05-01');
  assert.equal(dashboard.filters.to, '2026-05-31');
  assert.deepEqual(dashboard.rows, []);
  assert.equal(dashboard.pagination.totalWorkers, 0);
});

test('loadWorkerCancellationsDashboardSection queries workers and total with safe SQL semantics', async () => {
  const { calls, client } = createDashboardClient({
    'worker cancellations total workers': [{ total_workers: 1 }],
    'worker cancellations workers': [
      {
        worker_id: 'worker-1',
        full_name: 'Иванов Иван',
        phone: '+79990000000',
        city: 'Москва',
        confirmed_shifts: 7,
        worker_cancellations: 2,
        worker_cancellations_24h: 1,
        post_start_cancellations: 1,
        failed_shifts: 3
      }
    ]
  });

  const dashboard = await loadWorkerCancellationsDashboardSection(
    client,
    {
      from: '2026-05-01',
      to: '2026-05-31',
      page: '2',
      pageSize: '50',
      sort: 'failedShifts',
      direction: 'asc'
    },
    'workers',
    new Date('2026-06-03T12:00:00.000Z')
  );

  assert.equal(dashboard.rows.length, 1);
  assert.deepEqual(calls.map((call) => call.operation), [
    'worker cancellations total workers',
    'worker cancellations workers'
  ]);

  const workerCall = calls.find((call) => call.operation === 'worker cancellations workers');
  const totalCall = calls.find((call) => call.operation === 'worker cancellations total workers');

  assert.equal(workerCall.params.param_from, '2026-05-01 00:00:00');
  assert.equal(workerCall.params.param_to, '2026-06-01 00:00:00');
  assert.equal(workerCall.params.param_limit, 50);
  assert.equal(workerCall.params.param_offset, 50);
  assert.equal(workerCall.query.includes('DROP TABLE'), false);
  assert.equal(workerCall.query.includes('failedShifts'), false);
  assert.match(workerCall.query, /ORDER BY failed_shifts ASC/);
  assert.match(workerCall.query, /j\.start >= \{from:DateTime\}/);
  assert.match(workerCall.query, /j\.start < \{to:DateTime\}/);
  assert.match(workerCall.query, /ifNull\(j\.worker, ''\) != ''/);
  assert.match(workerCall.query, /ifNull\(j\.deleted, 0\) = 0/);
  assert.match(workerCall.query, /h\.initiator = 'worker'/);
  assert.match(workerCall.query, /INTERVAL 24 HOUR/);
  assert.match(workerCall.query, /event_at >= sf\.start/);
  assert.match(workerCall.query, /status = 'failed'/);
  assert.match(workerCall.query, /LEFT JOIN mg_workers AS w ON wm\.worker_id = w\._id/);
  assert.match(workerCall.query, /LEFT JOIN mg_users AS u ON w\.user = u\._id/);
  assert.match(workerCall.query, /w\.full_address__city AS city/);
  assert.doesNotMatch(totalCall.query, /ORDER BY/);
  assert.doesNotMatch(totalCall.query, /LIMIT \{limit:UInt64\}/);
});

test('loadWorkerCancellationsDashboardSection rejects unknown sections', async () => {
  const { client } = createDashboardClient();

  await assert.rejects(
    () =>
      loadWorkerCancellationsDashboardSection(
        client,
        {},
        'summary',
        new Date('2026-06-03T12:00:00.000Z')
      ),
    /Unknown worker cancellations section: summary/
  );
});

test('loadWorkerCancellationsDashboardSection caches section results by filters', async () => {
  let timestamp = Date.parse('2026-06-03T12:00:00.000Z');
  const { calls, client } = createDashboardClient({
    'worker cancellations total workers': [{ total_workers: 1 }],
    'worker cancellations workers': [{ worker_id: 'worker-1', full_name: 'Иванов Иван' }]
  });
  const cache = createDashboardSectionCache({ now: () => timestamp });
  const input = { from: '2026-05-01', to: '2026-05-31' };

  await loadWorkerCancellationsDashboardSection(
    client,
    input,
    'workers',
    new Date('2026-06-03T12:00:00.000Z'),
    { cache }
  );
  await loadWorkerCancellationsDashboardSection(
    client,
    input,
    'workers',
    new Date('2026-06-03T12:00:00.000Z'),
    { cache }
  );

  assert.deepEqual(calls.map((call) => call.operation), [
    'worker cancellations total workers',
    'worker cancellations workers'
  ]);

  timestamp += 10 * 60 * 60 * 1000 + 1;

  await loadWorkerCancellationsDashboardSection(
    client,
    input,
    'workers',
    new Date('2026-06-03T12:00:00.000Z'),
    { cache }
  );

  assert.deepEqual(calls.map((call) => call.operation), [
    'worker cancellations total workers',
    'worker cancellations workers',
    'worker cancellations total workers',
    'worker cancellations workers'
  ]);
});

test('WORKER_CANCELLATIONS_SECTIONS exposes only workers section', () => {
  assert.equal(WORKER_CANCELLATIONS_SECTIONS.has('workers'), true);
  assert.equal(WORKER_CANCELLATIONS_SECTIONS.has('summary'), false);
});
```

- [ ] **Step 2: Run the module tests and verify RED**

Run:

```bash
npm test -- test/workerCancellationsDashboard.test.js
```

Expected: FAIL because `../src/workerCancellationsDashboard` does not exist.

- [ ] **Step 3: Implement the dashboard module**

Create `src/workerCancellationsDashboard.js`:

```javascript
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_PAGE = 1;
const MAX_PAGE = 100000;
const DEFAULT_PAGE_SIZE = 100;
const ALLOWED_PAGE_SIZES = new Set([50, 100, 200, 500]);
const DEFAULT_SORT = 'workerCancellations24h';
const DEFAULT_DIRECTION = 'desc';
const TEXT_SORTS = new Set(['fullName', 'phone', 'city']);
const SORT_COLUMNS = {
  fullName: 'full_name',
  phone: 'phone',
  city: 'city',
  confirmedShifts: 'confirmed_shifts',
  workerCancellations: 'worker_cancellations',
  workerCancellations24h: 'worker_cancellations_24h',
  postStartCancellations: 'post_start_cancellations',
  failedShifts: 'failed_shifts'
};
const WORKER_CANCELLATIONS_SECTION_NAMES = ['workers'];
const WORKER_CANCELLATIONS_SECTIONS = new Set(WORKER_CANCELLATIONS_SECTION_NAMES);

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

function normalizePage(value) {
  const page = Number(value);

  return Number.isSafeInteger(page) && page >= 1 && page <= MAX_PAGE ? page : DEFAULT_PAGE;
}

function normalizePageSize(value) {
  const pageSize = Number(value);

  return Number.isInteger(pageSize) && ALLOWED_PAGE_SIZES.has(pageSize)
    ? pageSize
    : DEFAULT_PAGE_SIZE;
}

function normalizeSort(value) {
  const sort = cleanText(value);

  return Object.prototype.hasOwnProperty.call(SORT_COLUMNS, sort) ? sort : DEFAULT_SORT;
}

function normalizeDirection(value) {
  const direction = cleanText(value).toLowerCase();

  return direction === 'asc' || direction === 'desc' ? direction : DEFAULT_DIRECTION;
}

function normalizeWorkerCancellationFilters(input = {}, now = new Date()) {
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
  const page = normalizePage(input.page);
  const pageSize = normalizePageSize(input.pageSize);

  return {
    from,
    to,
    fromDateTime: toDateTimeParam(from),
    toExclusiveDateTime: toDateTimeParam(toExclusive),
    page,
    pageSize,
    offset: (page - 1) * pageSize,
    sort: normalizeSort(input.sort),
    direction: normalizeDirection(input.direction)
  };
}

function numberValue(value) {
  const number = Number(value || 0);

  return Number.isFinite(number) ? number : 0;
}

function baseParams(filters) {
  return {
    param_from: filters.fromDateTime,
    param_to: filters.toExclusiveDateTime,
    param_limit: filters.pageSize,
    param_offset: filters.offset
  };
}

function shiftFactsCte() {
  return `shift_facts AS (
    SELECT
      j._id AS job_id,
      j.worker AS worker_id,
      ifNull(j.status, '') AS status,
      j.start AS start
    FROM mg_jobs AS j
    WHERE j.start >= {from:DateTime}
      AND j.start < {to:DateTime}
      AND ifNull(j.worker, '') != ''
      AND ifNull(j.deleted, 0) = 0
  )`;
}

function cancellationEventsCte() {
  return `cancellation_events AS (
    SELECT
      h.job AS job_id,
      max(if(h.initiator = 'worker', 1, 0)) AS is_worker_cancelled,
      max(if(
        h.initiator = 'worker'
        AND coalesce(h.createdAt, h.updatedAt) >= sf.start - INTERVAL 24 HOUR
        AND coalesce(h.createdAt, h.updatedAt) < sf.start,
        1,
        0
      )) AS is_worker_cancelled_24h,
      max(if(coalesce(h.createdAt, h.updatedAt) >= sf.start, 1, 0)) AS is_post_start_cancelled
    FROM mg_job_history AS h
    INNER JOIN shift_facts AS sf ON h.job = sf.job_id
    WHERE ifNull(h.job, '') != ''
      AND ifNull(h.status, '') = 'cancelled'
    GROUP BY h.job
  )`;
}

function workerMetricsCte() {
  return `worker_metrics AS (
    SELECT
      sf.worker_id AS worker_id,
      countDistinctIf(sf.job_id, sf.status = 'confirmed') AS confirmed_shifts,
      countDistinctIf(
        sf.job_id,
        sf.status = 'cancelled' AND ifNull(ce.is_worker_cancelled, 0) = 1
      ) AS worker_cancellations,
      countDistinctIf(
        sf.job_id,
        sf.status = 'cancelled' AND ifNull(ce.is_worker_cancelled_24h, 0) = 1
      ) AS worker_cancellations_24h,
      countDistinctIf(
        sf.job_id,
        sf.status = 'cancelled' AND ifNull(ce.is_post_start_cancelled, 0) = 1
      ) AS post_start_cancellations,
      countDistinctIf(sf.job_id, sf.status = 'failed') AS failed_shifts
    FROM shift_facts AS sf
    LEFT JOIN cancellation_events AS ce ON sf.job_id = ce.job_id
    GROUP BY sf.worker_id
  )`;
}

function workerFullNameExpression() {
  const userName = "trim(BOTH ' ' FROM concat(ifNull(u.lastname, ''), ' ', ifNull(u.firstname, ''), ' ', ifNull(u.middlename, '')))";

  return `if(${userName} != '', ${userName}, if(ifNull(w.full_name, '') != '', w.full_name, wm.worker_id))`;
}

function workerRowsBaseSelect() {
  return `WITH ${shiftFactsCte()},
  ${cancellationEventsCte()},
  ${workerMetricsCte()}
  SELECT
    wm.worker_id AS worker_id,
    ${workerFullNameExpression()} AS full_name,
    ifNull(u.phone, '') AS phone,
    w.full_address__city AS city,
    wm.confirmed_shifts AS confirmed_shifts,
    wm.worker_cancellations AS worker_cancellations,
    wm.worker_cancellations_24h AS worker_cancellations_24h,
    wm.post_start_cancellations AS post_start_cancellations,
    wm.failed_shifts AS failed_shifts
  FROM worker_metrics AS wm
  LEFT JOIN mg_workers AS w ON wm.worker_id = w._id
  LEFT JOIN mg_users AS u ON w.user = u._id`;
}

function orderByForSort(sort, direction) {
  const column = SORT_COLUMNS[sort] || SORT_COLUMNS[DEFAULT_SORT];
  const safeDirection = direction === 'asc' ? 'ASC' : 'DESC';
  const tieBreakDirection = TEXT_SORTS.has(sort) ? safeDirection : 'ASC';

  if (sort === DEFAULT_SORT && direction === DEFAULT_DIRECTION) {
    return 'worker_cancellations_24h DESC, worker_cancellations DESC, failed_shifts DESC, full_name ASC, worker_id ASC';
  }

  return `${column} ${safeDirection}, full_name ${tieBreakDirection}, worker_id ASC`;
}

function workerRowsQuery(filters) {
  return `${workerRowsBaseSelect()}
  ORDER BY ${orderByForSort(filters.sort, filters.direction)}
  LIMIT {limit:UInt64} OFFSET {offset:UInt64}
  FORMAT JSONEachRow`;
}

function totalWorkersQuery() {
  return `WITH ${shiftFactsCte()}
  SELECT count() AS total_workers
  FROM (
    SELECT sf.worker_id AS worker_id
    FROM shift_facts AS sf
    GROUP BY sf.worker_id
  ) AS workers
  FORMAT JSONEachRow`;
}

function paginationFromTotal(filters, totalWorkers) {
  const safeTotal = numberValue(totalWorkers);
  const totalPages = Math.max(1, Math.ceil(safeTotal / filters.pageSize));
  const page = Math.min(filters.page, totalPages);

  return {
    page,
    pageSize: filters.pageSize,
    totalWorkers: safeTotal,
    totalPages,
    hasPrevious: page > 1,
    hasNext: page < totalPages
  };
}

function emptyPagination(filters) {
  return {
    page: filters.page,
    pageSize: filters.pageSize,
    totalWorkers: 0,
    totalPages: 1,
    hasPrevious: false,
    hasNext: false
  };
}

function mapWorkerRow(row) {
  const workerId = String(row.worker_id || '');
  const fullName = cleanText(row.full_name) || workerId;

  return {
    workerId,
    fullName,
    phone: String(row.phone || ''),
    city: String(row.city || ''),
    confirmedShifts: numberValue(row.confirmed_shifts),
    workerCancellations: numberValue(row.worker_cancellations),
    workerCancellations24h: numberValue(row.worker_cancellations_24h),
    postStartCancellations: numberValue(row.post_start_cancellations),
    failedShifts: numberValue(row.failed_shifts)
  };
}

function mergeWorkerCancellationRows(filters, workerRows = [], totalRows = []) {
  return {
    filters,
    rows: workerRows.map(mapWorkerRow),
    pagination: paginationFromTotal(filters, totalRows[0] && totalRows[0].total_workers)
  };
}

function emptyWorkerCancellationsDashboard(filters) {
  return {
    filters,
    rows: [],
    pagination: emptyPagination(filters)
  };
}

function assertWorkerCancellationsSection(section) {
  if (WORKER_CANCELLATIONS_SECTIONS.has(section)) {
    return;
  }

  const error = new Error(`Unknown worker cancellations section: ${section}`);

  error.status = 400;
  throw error;
}

async function readThroughCache(cache, key, loader) {
  if (!cache || typeof cache.getOrLoad !== 'function') {
    return loader();
  }

  return cache.getOrLoad(key, loader);
}

function cacheKeyForWorkerCancellationsSection(section, filters) {
  return JSON.stringify({
    board: 'worker-cancellations',
    section,
    filters: {
      from: filters.from,
      to: filters.to,
      page: filters.page,
      pageSize: filters.pageSize,
      sort: filters.sort,
      direction: filters.direction
    }
  });
}

async function loadWorkerCancellationsSectionRows(client, filters) {
  const params = baseParams(filters);
  const [totalRows, workerRows] = await Promise.all([
    client.queryJSONEachRow(
      totalWorkersQuery(),
      params,
      'worker cancellations total workers'
    ),
    client.queryJSONEachRow(
      workerRowsQuery(filters),
      params,
      'worker cancellations workers'
    )
  ]);

  return { totalRows, workerRows };
}

async function loadWorkerCancellationsDashboardShell(client, input = {}, now = new Date()) {
  const filters = normalizeWorkerCancellationFilters(input, now);

  return emptyWorkerCancellationsDashboard(filters);
}

async function loadWorkerCancellationsDashboardSection(
  client,
  input = {},
  section,
  now = new Date(),
  options = {}
) {
  assertWorkerCancellationsSection(section);

  const filters = normalizeWorkerCancellationFilters(input, now);
  const rows = await readThroughCache(
    options.cache,
    cacheKeyForWorkerCancellationsSection(section, filters),
    () => loadWorkerCancellationsSectionRows(client, filters)
  );

  return mergeWorkerCancellationRows(filters, rows.workerRows, rows.totalRows);
}

module.exports = {
  WORKER_CANCELLATIONS_SECTIONS,
  loadWorkerCancellationsDashboardSection,
  loadWorkerCancellationsDashboardShell,
  mergeWorkerCancellationRows,
  normalizeWorkerCancellationFilters
};
```

- [ ] **Step 4: Run the module tests and verify GREEN**

Run:

```bash
npm test -- test/workerCancellationsDashboard.test.js
```

Expected: PASS. If the query-regex assertions fail because of whitespace, adjust the assertion only enough to match the actual safe query shape.

- [ ] **Step 5: Commit the data module**

Run:

```bash
git add src/workerCancellationsDashboard.js test/workerCancellationsDashboard.test.js
git commit -m "feat: add worker cancellations data model"
```

Expected: commit succeeds with only those two files staged.

---

### Task 2: Renderer and Navigation Shell

**Files:**
- Modify: `src/render.js`
- Modify: `test/render.test.js`

- [ ] **Step 1: Write failing render tests**

In `test/render.test.js`, extend the import:

```javascript
const {
  escapeHtml,
  renderError,
  renderCityAnalysisDashboard,
  renderCityAnalysisDashboardSection,
  renderHeatmapDashboard,
  renderHeatmapDashboardSection,
  renderHome,
  renderSalesByProjectDashboard,
  renderTable,
  renderWorkerCancellationsDashboard,
  renderWorkerCancellationsDashboardSection,
  renderWorkplaceAnalysisDashboard,
  renderWorkplacePointDashboard
} = require('../src/render');
```

Add these tests after `renderHome includes workplace analysis navigation`:

```javascript
test('renderHome includes worker cancellations navigation', () => {
  const html = renderHome({
    database: 'etl',
    tables: ['mg_jobs']
  });

  assert.match(html, /Отмены гигерами/);
  assert.match(html, /href="\/dashboards\/worker-cancellations"/);
});
```

Add these tests near the other dashboard render tests:

```javascript
test('renderWorkerCancellationsDashboard renders filters and progressive table loading state', () => {
  const html = renderWorkerCancellationsDashboard({
    database: 'etl',
    progressive: true,
    dashboard: {
      filters: {
        from: '2026-05-01',
        to: '2026-05-31',
        page: 2,
        pageSize: 200,
        sort: 'workerCancellations24h',
        direction: 'desc'
      },
      rows: [],
      pagination: {
        page: 2,
        pageSize: 200,
        totalWorkers: 0,
        totalPages: 1,
        hasPrevious: false,
        hasNext: false
      }
    }
  });

  assert.match(html, /<h1>Отмены гигерами<\/h1>/);
  assert.match(html, /class="nav-link active" href="\/dashboards\/worker-cancellations"/);
  assert.match(html, /<form class="filter-bar" action="\/dashboards\/worker-cancellations" method="get">/);
  assert.match(html, /<input id="from" name="from" type="date" value="2026-05-01">/);
  assert.match(html, /<input id="to" name="to" type="date" value="2026-05-31">/);
  assert.match(html, /<select id="pageSize" name="pageSize">/);
  assert.match(html, /<option value="200" selected>200<\/option>/);
  assert.match(html, /Период по плановому старту смены/);
  assert.match(html, /data-dashboard-fragment-url="\/dashboards\/worker-cancellations\/section\?section=workers&amp;from=2026-05-01&amp;to=2026-05-31&amp;page=2&amp;pageSize=200&amp;sort=workerCancellations24h&amp;direction=desc"/);
  assert.match(html, /Загружается/);
  assert.match(html, /document\.querySelectorAll\('\[data-dashboard-fragment-url\]/);
});

test('renderWorkerCancellationsDashboardSection renders sortable escaped table and full phone', () => {
  const html = renderWorkerCancellationsDashboardSection({
    section: 'workers',
    dashboard: {
      filters: {
        from: '2026-05-01',
        to: '2026-05-31',
        page: 1,
        pageSize: 50,
        sort: 'workerCancellations',
        direction: 'asc'
      },
      rows: [
        {
          workerId: 'worker-1',
          fullName: 'Иванов <script>Иван</script>',
          phone: '+79990000000<script>x</script>',
          city: 'Москва<script>bad</script>',
          confirmedShifts: 10,
          workerCancellations: 3,
          workerCancellations24h: 2,
          postStartCancellations: 1,
          failedShifts: 4
        }
      ],
      pagination: {
        page: 1,
        pageSize: 50,
        totalWorkers: 125,
        totalPages: 3,
        hasPrevious: false,
        hasNext: true
      }
    }
  });

  assert.match(html, /ФИО/);
  assert.match(html, /Телефон/);
  assert.match(html, /Город/);
  assert.match(html, /Выполнено/);
  assert.match(html, /Отмены worker/);
  assert.match(html, /Отмены worker &lt; 24ч/);
  assert.match(html, /Отмены после старта/);
  assert.match(html, /Провалы \/ failed/);
  assert.match(html, /href="\/dashboards\/worker-cancellations\?from=2026-05-01&amp;to=2026-05-31&amp;pageSize=50&amp;sort=fullName&amp;direction=asc"/);
  assert.match(html, /href="\/dashboards\/worker-cancellations\?from=2026-05-01&amp;to=2026-05-31&amp;pageSize=50&amp;sort=workerCancellations&amp;direction=desc"/);
  assert.match(html, /Иванов &lt;script&gt;Иван&lt;\/script&gt;/);
  assert.match(html, /\+79990000000&lt;script&gt;x&lt;\/script&gt;/);
  assert.match(html, /Москва&lt;script&gt;bad&lt;\/script&gt;/);
  assert.match(html, /Страница 1 из 3 · исполнителей: 125/);
  assert.match(html, /page=2/);
  assert.doesNotMatch(html, /<script>Иван<\/script>/);
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.doesNotMatch(html, /<script>bad<\/script>/);
  assert.doesNotMatch(html, /<html/);
});

test('renderWorkerCancellationsDashboardSection renders empty state', () => {
  const html = renderWorkerCancellationsDashboardSection({
    section: 'workers',
    dashboard: {
      filters: {
        from: '2026-05-01',
        to: '2026-05-31',
        page: 1,
        pageSize: 100,
        sort: 'workerCancellations24h',
        direction: 'desc'
      },
      rows: [],
      pagination: {
        page: 1,
        pageSize: 100,
        totalWorkers: 0,
        totalPages: 1,
        hasPrevious: false,
        hasNext: false
      }
    }
  });

  assert.match(html, /Нет исполнителей со сменами за выбранный период/);
  assert.doesNotMatch(html, /<table>/);
  assert.doesNotMatch(html, /<html/);
});
```

- [ ] **Step 2: Run render tests and verify RED**

Run:

```bash
npm test -- test/render.test.js
```

Expected: FAIL because `renderWorkerCancellationsDashboard` and `renderWorkerCancellationsDashboardSection` are not exported.

- [ ] **Step 3: Add navigation and renderer helpers**

In `src/render.js`, add this item to `NAV_LINKS` before `Учетные записи`:

```javascript
  {
    href: '/dashboards/worker-cancellations',
    label: 'Отмены гигерами',
    id: 'worker-cancellations',
    permission: 'worker-cancellations'
  },
```

Add CSS near the existing `th` rules:

```css
    .sortable-header {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: var(--text);
      text-decoration: none;
    }

    .sortable-header:hover,
    .sortable-header:focus {
      color: var(--link);
      outline: none;
    }

    .sort-indicator {
      color: var(--muted);
      font-size: 12px;
    }
```

Add these helpers after `renderDashboardLoadingSection`:

```javascript
const WORKER_CANCELLATION_PAGE_SIZES = [50, 100, 200, 500];
const WORKER_CANCELLATION_COLUMNS = [
  { key: 'fullName', label: 'ФИО', numeric: false },
  { key: 'phone', label: 'Телефон', numeric: false },
  { key: 'city', label: 'Город', numeric: false },
  { key: 'confirmedShifts', label: 'Выполнено', numeric: true },
  { key: 'workerCancellations', label: 'Отмены worker', numeric: true },
  { key: 'workerCancellations24h', label: 'Отмены worker < 24ч', numeric: true },
  { key: 'postStartCancellations', label: 'Отмены после старта', numeric: true },
  { key: 'failedShifts', label: 'Провалы / failed', numeric: true }
];

function workerCancellationParam(params, name, value) {
  if (value !== null && value !== undefined && String(value) !== '') {
    params.set(name, String(value));
  }
}

function workerCancellationsPageHref(filters, overrides = {}) {
  const next = {
    ...filters,
    ...overrides
  };
  const params = new URLSearchParams();

  workerCancellationParam(params, 'from', next.from);
  workerCancellationParam(params, 'to', next.to);
  workerCancellationParam(params, 'page', next.page);
  workerCancellationParam(params, 'pageSize', next.pageSize);
  workerCancellationParam(params, 'sort', next.sort);
  workerCancellationParam(params, 'direction', next.direction);

  return `/dashboards/worker-cancellations?${params.toString()}`;
}

function workerCancellationsSectionUrl(filters, section) {
  const pageHref = workerCancellationsPageHref(filters);
  const query = pageHref.includes('?') ? pageHref.slice(pageHref.indexOf('?') + 1) : '';
  const suffix = query === '' ? '' : `&${query}`;

  return `/dashboards/worker-cancellations/section?section=${encodeURIComponent(section)}${suffix}`;
}

function defaultWorkerCancellationDirection(column) {
  return column.numeric ? 'desc' : 'asc';
}

function nextWorkerCancellationDirection(filters, column) {
  if (filters.sort !== column.key) {
    return defaultWorkerCancellationDirection(column);
  }

  return filters.direction === 'asc' ? 'desc' : 'asc';
}

function renderWorkerCancellationSortHeader(filters, column) {
  const direction = nextWorkerCancellationDirection(filters, column);
  const href = workerCancellationsPageHref(filters, {
    page: 1,
    sort: column.key,
    direction
  });
  const active = filters.sort === column.key;
  const indicator = active
    ? `<span class="sort-indicator" aria-hidden="true">${filters.direction === 'asc' ? '↑' : '↓'}</span>`
    : '';

  return `<a class="sortable-header" href="${escapeHtml(href)}">${escapeHtml(column.label)}${indicator}</a>`;
}

function renderWorkerCancellationPageSizeOptions(selectedPageSize) {
  const selected = Number(selectedPageSize) || 100;

  return WORKER_CANCELLATION_PAGE_SIZES.map((pageSize) => {
    const selectedAttr = pageSize === selected ? ' selected' : '';

    return `<option value="${pageSize}"${selectedAttr}>${pageSize}</option>`;
  }).join('');
}

function renderWorkerCancellationsPagination({ filters, pagination }) {
  if (!pagination || (!pagination.hasPrevious && !pagination.hasNext)) {
    return '';
  }

  const page = Number(pagination.page) || 1;
  const totalPages = Math.max(page, Number(pagination.totalPages) || page);
  const totalLabel = Number(pagination.totalWorkers) || 0;

  return `<nav class="pagination" aria-label="Пагинация исполнителей">
  <div class="pagination-meta">Страница ${escapeHtml(page)} из ${escapeHtml(totalPages)} · исполнителей: ${escapeHtml(formatNumber(totalLabel))}</div>
  <div class="pagination-actions">
    ${renderPaginationLink({
      href: workerCancellationsPageHref(filters, { page: page - 1 }),
      label: 'Назад',
      disabled: !pagination.hasPrevious
    })}
    ${renderWorkerCancellationPaginationPages({ filters, page, totalPages })}
    ${renderPaginationLink({
      href: workerCancellationsPageHref(filters, { page: page + 1 }),
      label: 'Вперед',
      disabled: !pagination.hasNext
    })}
  </div>
</nav>`;
}

function renderWorkerCancellationPaginationPages({ filters, page, totalPages }) {
  const pageNumbers = paginationPageNumbers(page, totalPages);
  let previousPage = 0;
  const items = [];

  for (const pageNumber of pageNumbers) {
    if (previousPage > 0 && pageNumber - previousPage > 1) {
      items.push('<span class="pagination-ellipsis" aria-hidden="true">...</span>');
    }

    if (pageNumber === page) {
      items.push(`<span class="pagination-link pagination-page pagination-current" aria-current="page">${escapeHtml(pageNumber)}</span>`);
    } else {
      items.push(`<a class="pagination-link pagination-page" href="${escapeHtml(workerCancellationsPageHref(filters, { page: pageNumber }))}">${escapeHtml(pageNumber)}</a>`);
    }

    previousPage = pageNumber;
  }

  return `<div class="pagination-pages" aria-label="Страницы">${items.join('')}</div>`;
}

function renderWorkerCancellationsTable(dashboard) {
  const rows = Array.isArray(dashboard.rows) ? dashboard.rows : [];
  const filters = dashboard.filters || {};

  if (rows.length === 0) {
    return `<p class="empty">Нет исполнителей со сменами за выбранный период.</p>`;
  }

  return `<div class="table-wrap"><table>
    <thead>
      <tr>
        ${WORKER_CANCELLATION_COLUMNS.map((column) => `<th>${renderWorkerCancellationSortHeader(filters, column)}</th>`).join('')}
      </tr>
    </thead>
    <tbody>
      ${rows
        .map((row) => `<tr>
          <td>${escapeHtml(row.fullName)}</td>
          <td>${escapeHtml(row.phone)}</td>
          <td>${escapeHtml(row.city)}</td>
          <td class="number-cell">${escapeHtml(formatNumber(row.confirmedShifts))}</td>
          <td class="number-cell">${escapeHtml(formatNumber(row.workerCancellations))}</td>
          <td class="number-cell">${escapeHtml(formatNumber(row.workerCancellations24h))}</td>
          <td class="number-cell">${escapeHtml(formatNumber(row.postStartCancellations))}</td>
          <td class="number-cell">${escapeHtml(formatNumber(row.failedShifts))}</td>
        </tr>`)
        .join('')}
    </tbody>
  </table></div>`;
}

function renderWorkerCancellationsDashboardSection({ dashboard, section }) {
  if (section !== 'workers') {
    return `<section class="section"><div class="error">Неизвестный блок дашборда.</div></section>`;
  }

  return `<section class="section">
  <h2>Исполнители</h2>
  ${renderWorkerCancellationsTable(dashboard)}
  ${renderWorkerCancellationsPagination({ filters: dashboard.filters, pagination: dashboard.pagination })}
</section>`;
}

function renderWorkerCancellationsDashboard({
  database,
  dashboard,
  progressive = false,
  currentUser,
  csrfToken
}) {
  const filters = dashboard.filters || {};
  const content = `<section class="section">
  <h1>Отмены гигерами</h1>
  <p class="technical-note">Период: ${escapeHtml(filters.from)} - ${escapeHtml(filters.to)} · Период по плановому старту смены.</p>
</section>
<section class="section">
  <form class="filter-bar" action="/dashboards/worker-cancellations" method="get">
    <div class="field">
      <label for="from">С</label>
      <input id="from" name="from" type="date" value="${escapeHtml(filters.from)}">
    </div>
    <div class="field">
      <label for="to">По</label>
      <input id="to" name="to" type="date" value="${escapeHtml(filters.to)}">
    </div>
    <div class="field">
      <label for="pageSize">Строк на странице</label>
      <select id="pageSize" name="pageSize">${renderWorkerCancellationPageSizeOptions(filters.pageSize)}</select>
    </div>
    ${renderHiddenInput('sort', filters.sort)}
    ${renderHiddenInput('direction', filters.direction)}
    <button type="submit">Применить</button>
  </form>
</section>
${progressive
    ? `<div data-dashboard-fragment-url="${escapeHtml(workerCancellationsSectionUrl(filters, 'workers'))}">
  <section class="section">
    <h2>Исполнители</h2>
    <p class="loading">Загружается</p>
  </section>
</div>`
    : renderWorkerCancellationsDashboardSection({ dashboard, section: 'workers' })}`;

  return layout({
    title: 'Отмены гигерами',
    database,
    content,
    activeNav: 'worker-cancellations',
    currentUser,
    csrfToken
  });
}
```

Add exports in `module.exports`:

```javascript
  renderWorkerCancellationsDashboard,
  renderWorkerCancellationsDashboardSection,
```

- [ ] **Step 4: Run render tests and verify GREEN**

Run:

```bash
npm test -- test/render.test.js
```

Expected: PASS. If unrelated existing render tests fail because the working tree already has user edits, inspect those diffs and do not revert them.

- [ ] **Step 5: Commit renderer changes**

Run:

```bash
git add src/render.js test/render.test.js
git commit -m "feat: render worker cancellations dashboard"
```

Expected: commit succeeds with only renderer-related files staged.

---

### Task 3: Permission Model

**Files:**
- Modify: `src/auth.js`
- Modify: `test/auth.test.js`
- Modify: `test/renderAuth.test.js`

- [ ] **Step 1: Write failing auth tests**

In `test/auth.test.js`, update the managed analyst creation assertion inside `user store exposes env admin and persists managed accounts`:

```javascript
    const created = await store.createUser({
      email: 'Analyst@Example.Test',
      name: 'Analyst <One>',
      role: 'analyst',
      permissions: ['city-analysis', 'heatmap', 'worker-cancellations', 'users', 'unknown'],
      password: 'AnalystPass123'
    });

    assert.equal(created.email, 'analyst@example.test');
    assert.equal(created.name, 'Analyst <One>');
    assert.equal(created.role, 'analyst');
    assert.deepEqual(created.permissions, ['city-analysis', 'heatmap', 'worker-cancellations']);
```

Also add:

```javascript
    assert.equal(hasPermission(analyst, 'worker-cancellations'), true);
```

In `test/renderAuth.test.js`, add `worker-cancellations` to the managed user permissions and assert the label renders:

```javascript
        permissions: ['tables', 'worker-cancellations'],
```

Add assertions:

```javascript
  assert.match(html, /Отмены гигерами/);
  assert.match(html, /name="permissions" value="worker-cancellations" checked/);
```

- [ ] **Step 2: Run auth tests and verify RED**

Run:

```bash
npm test -- test/auth.test.js test/renderAuth.test.js
```

Expected: FAIL because `worker-cancellations` is not a known permission yet.

- [ ] **Step 3: Add permission definition**

In `src/auth.js`, insert this object in `PERMISSION_DEFINITIONS` before `users`:

```javascript
  {
    id: 'worker-cancellations',
    label: 'Отмены гигерами',
    description: 'Таблица исполнителей с отменами, поздними отменами и провалами смен.'
  },
```

- [ ] **Step 4: Run auth tests and verify GREEN**

Run:

```bash
npm test -- test/auth.test.js test/renderAuth.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit permission changes**

Run:

```bash
git add src/auth.js test/auth.test.js test/renderAuth.test.js
git commit -m "feat: add worker cancellations permission"
```

Expected: commit succeeds with only auth-related files staged.

---

### Task 4: Server Routes and Section Error Handling

**Files:**
- Modify: `src/server.js`
- Modify: `test/server.test.js`

- [ ] **Step 1: Write failing server tests**

In `test/server.test.js`, extend `createFakeClient().queryJSONEachRow` with:

```javascript
      if (operation === 'worker cancellations total workers') {
        return [{ total_workers: 1 }];
      }

      if (operation === 'worker cancellations workers') {
        return [
          {
            worker_id: 'worker-1',
            full_name: 'Иванов Иван',
            phone: '+79990000000',
            city: 'Москва',
            confirmed_shifts: 10,
            worker_cancellations: 3,
            worker_cancellations_24h: 2,
            post_start_cancellations: 1,
            failed_shifts: 4
          }
        ];
      }
```

Add these tests near the other dashboard route tests:

```javascript
test('GET /dashboards/worker-cancellations renders dashboard shell without heavy query', async () => {
  const client = createFakeClient();

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(
      baseUrl,
      '/dashboards/worker-cancellations?from=2026-05-01&to=2026-05-31&page=2&pageSize=200&sort=failedShifts&direction=asc'
    );

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html\b/);
    assert.match(text, /Отмены гигерами/);
    assert.match(text, /Загружается/);
    assert.match(text, /data-dashboard-fragment-url="\/dashboards\/worker-cancellations\/section\?section=workers/);
    assert.match(text, /pageSize=200/);
    assert.match(text, /sort=failedShifts/);
    assert.match(text, /direction=asc/);
  });

  const workerCalls = client.calls.filter(
    (call) => call[0] === 'queryJSONEachRow' && String(call[1]).startsWith('worker cancellations')
  );

  assert.equal(workerCalls.length, 0);
});

test('GET /dashboards/worker-cancellations/section renders cached workers fragment', async () => {
  const client = createFakeClient();

  await withServer(client, async (baseUrl) => {
    const path =
      '/dashboards/worker-cancellations/section?section=workers&from=2026-05-01&to=2026-05-31&pageSize=50&sort=workerCancellations&direction=desc';
    const first = await fetchText(baseUrl, path);
    const second = await fetchText(baseUrl, path);

    assert.equal(first.response.status, 200);
    assert.match(first.response.headers.get('content-type'), /^text\/html\b/);
    assert.match(first.text, /Иванов Иван/);
    assert.match(first.text, /\+79990000000/);
    assert.match(first.text, /Отмены worker/);
    assert.match(first.text, /Провалы \/ failed/);
    assert.doesNotMatch(first.text, /<html/);
    assert.equal(second.response.status, 200);
  });

  const workerCalls = client.calls.filter(
    (call) => call[0] === 'queryJSONEachRow' && String(call[1]).startsWith('worker cancellations')
  );

  assert.deepEqual(workerCalls.map((call) => call[1]), [
    'worker cancellations total workers',
    'worker cancellations workers'
  ]);
  assert.equal(workerCalls[0][2].param_from, '2026-05-01 00:00:00');
  assert.equal(workerCalls[0][2].param_to, '2026-06-01 00:00:00');
});

test('GET /dashboards/worker-cancellations/section redacts upstream errors in fragment', async () => {
  const client = createFakeClient({
    async queryJSONEachRow(query, params, operation) {
      this.calls.push(['queryJSONEachRow', operation, params]);
      throw new Error('ClickHouse rejected password super-secret');
    }
  });

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(
      baseUrl,
      '/dashboards/worker-cancellations/section?section=workers'
    );

    assert.equal(response.status, 502);
    assert.match(text, /ClickHouse rejected password \[redacted\]/);
    assert.doesNotMatch(text, /super-secret/);
    assert.doesNotMatch(text, /<html/);
  });
});

test('GET /dashboards/worker-cancellations keeps navigation active and redacts upstream errors', async () => {
  const client = createFakeClient();

  client.queryJSONEachRow = async (query, params, operation) => {
    client.calls.push(['queryJSONEachRow', operation, params]);
    throw new Error('ClickHouse rejected password super-secret');
  };

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(baseUrl, '/dashboards/worker-cancellations/');

    assert.equal(response.status, 502);
    assert.match(text, /ClickHouse rejected password \[redacted\]/);
    assert.match(text, /class="nav-link active" href="\/dashboards\/worker-cancellations"/);
    assert.doesNotMatch(text, /super-secret/);
  });
});
```

Extend the `activeNavForPath normalizes dashboard trailing slashes` test:

```javascript
  assert.equal(activeNavForPath('/dashboards/worker-cancellations'), 'worker-cancellations');
  assert.equal(activeNavForPath('/dashboards/worker-cancellations/'), 'worker-cancellations');
```

- [ ] **Step 2: Run server tests and verify RED**

Run:

```bash
npm test -- test/server.test.js
```

Expected: FAIL because the new route does not exist.

- [ ] **Step 3: Add server imports and active nav**

In `src/server.js`, add imports:

```javascript
const {
  WORKER_CANCELLATIONS_SECTIONS,
  loadWorkerCancellationsDashboardSection,
  loadWorkerCancellationsDashboardShell
} = require('./workerCancellationsDashboard');
```

Add render imports:

```javascript
  renderWorkerCancellationsDashboard,
  renderWorkerCancellationsDashboardSection,
```

Add nav mapping:

```javascript
    '/dashboards/worker-cancellations': 'worker-cancellations',
```

Add prefix branch:

```javascript
  if (normalized.startsWith('/dashboards/worker-cancellations/')) {
    return 'worker-cancellations';
  }
```

- [ ] **Step 4: Add dashboard routes**

In `src/server.js`, add routes before `/tables`:

```javascript
  app.get(
    '/dashboards/worker-cancellations',
    requireAuth('worker-cancellations'),
    asyncRoute(async (req, res) => {
      const dashboard = await loadWorkerCancellationsDashboardShell(client, req.query, new Date());

      res
        .status(200)
        .type('html')
        .send(renderWorkerCancellationsDashboard({ database, dashboard, progressive: true, ...viewContext(req) }));
    })
  );

  app.get(
    '/dashboards/worker-cancellations/section',
    requireAuth('worker-cancellations'),
    asyncRoute(async (req, res) => {
      const section = String(req.query.section || '');

      if (!WORKER_CANCELLATIONS_SECTIONS.has(section)) {
        sendError(
          res,
          400,
          'Bad Request',
          `Unknown worker cancellations section: ${section}`,
          'worker-cancellations',
          viewContext(req)
        );
        return;
      }

      try {
        const dashboard = await loadWorkerCancellationsDashboardSection(
          client,
          req.query,
          section,
          new Date(),
          {
            cache: dashboardSectionCache
          }
        );

        res
          .status(200)
          .type('html')
          .send(renderWorkerCancellationsDashboardSection({ dashboard, section }));
      } catch (error) {
        const statusCode = statusCodeFromError(error);

        res
          .status(statusCode)
          .type('html')
          .send(renderDashboardSectionError({ message: sanitizeForResponse(error && error.message, config) }));
      }
    })
  );
```

- [ ] **Step 5: Run server tests and verify GREEN**

Run:

```bash
npm test -- test/server.test.js
```

Expected: PASS. If the trailing-slash route produces a 404 instead of an upstream error, keep the active-nav assertion in the 404 page and remove any assumption that a trailing slash invokes the dashboard loader.

- [ ] **Step 6: Commit server routes**

Run:

```bash
git add src/server.js test/server.test.js
git commit -m "feat: add worker cancellations routes"
```

Expected: commit succeeds with only server-related files staged.

---

### Task 5: README and Full Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Write the documentation update**

In `README.md`, update the dashboard list by adding:

```markdown
- `http://localhost:3000/dashboards/worker-cancellations` - дашборд `Отмены гигерами` для анализа отмен и провалов смен по исполнителям;
```

In the security section, add:

```markdown
- Дашборд `Отмены гигерами` намеренно выводит ФИО и полный телефон исполнителя для операционной работы с отменами; остальные персональные поля не выводятся.
```

- [ ] **Step 2: Run the complete test suite**

Run:

```bash
npm test
```

Expected: PASS for all tests. If tests fail in files that had pre-existing unstaged user changes, inspect `git diff -- <file>` before editing and preserve the user changes.

- [ ] **Step 3: Check working tree scope**

Run:

```bash
git status --short
```

Expected: only files intentionally changed by this implementation remain unstaged or staged. Do not stage unrelated user changes.

- [ ] **Step 4: Commit documentation**

Run:

```bash
git add README.md
git commit -m "docs: document worker cancellations dashboard"
```

Expected: commit succeeds with only `README.md` staged.

- [ ] **Step 5: Manual smoke test**

Start the app if it is not already running:

```bash
npm start
```

Open:

```text
http://localhost:3000/dashboards/worker-cancellations
```

Verify:

- the page title is `Отмены гигерами`;
- `С`, `По`, and `Строк на странице` filters are visible;
- the table section loads after the shell;
- full phone values are visible;
- clicking each table header changes `sort` and `direction` in the URL;
- page-size options `50`, `100`, `200`, `500` work;
- pagination links preserve date range, page size, sort, and direction.

---

## Self-Review

Spec coverage:

- New menu, route, section route, date range, page size, sortable headers, pagination, ClickHouse safety, full phone output: Tasks 1, 2, 4.
- `mg_jobs.start` period and planned-start comparisons: Task 1 SQL tests and implementation.
- `cancelled` separate from `failed`: Task 1 tests and SQL aggregation.
- `initiator = 'worker'`, `< 24ч`, and `после старта`: Task 1 tests and SQL CTE.
- Permission id and analyst access: Task 3.
- README and PII note: Task 5.

Placeholder scan:

- No banned marker words or unnamed error-handling steps are present.

Type and name consistency:

- Module API names match imports in tests and server: `WORKER_CANCELLATIONS_SECTIONS`, `loadWorkerCancellationsDashboardShell`, `loadWorkerCancellationsDashboardSection`.
- Model field names match render usage: `confirmedShifts`, `workerCancellations`, `workerCancellations24h`, `postStartCancellations`, `failedShifts`.
- Query aliases match mapper expectations: `confirmed_shifts`, `worker_cancellations`, `worker_cancellations_24h`, `post_start_cancellations`, `failed_shifts`.
