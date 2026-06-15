# Worker Funnel Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/dashboards/worker-funnel` dashboard for aggregated movement of worker users through the MyGig funnel.

**Architecture:** Add a focused dashboard module that normalizes filters, builds ClickHouse SQL for milestone-based funnel metrics, merges rows into a render model, and exposes progressive sections. Reuse the existing server-rendered dashboard pattern: shell route, section routes, permission id, navigation, SQL metric info, and documentation.

**Tech Stack:** Node.js 22, Express, server-rendered HTML, ClickHouse `JSONEachRow`, `node:test`, existing `dashboardSectionCache`, existing SQL helpers from `successfulConfirmedShift.js`.

---

## File Structure

- Create `src/workerFunnelDashboard.js`: filter normalization, stage definitions, SQL builders, params, cache keys, section loaders, and merge functions.
- Create `test/workerFunnelDashboard.test.js`: unit tests for filters, merge logic, SQL semantics, section loading, and cache use.
- Modify `src/auth.js`: add permission id `worker-funnel`.
- Modify `src/render.js`: add navigation link, dashboard shell, section renderers, URL helpers, and exports.
- Modify `src/server.js`: import loader/render functions, add active nav mapping, activity section mapping, shell route, and section route.
- Modify `test/render.test.js`: add navigation, shell, summary, dynamics, segments, and empty-state render tests.
- Modify `test/renderAuth.test.js`: add permission checkbox coverage.
- Modify `test/server.test.js`: add fake query rows and route tests.
- Modify `test/serverAuth.test.js`: add permission gate coverage if the existing auth tests do not cover new dashboard permissions generically.
- Modify `src/sqlMetricInfo.js`: add metric definitions for worker funnel summary, transitions, dynamics, and segments.
- Modify `test/sqlMetricInfo.test.js`: assert SQL info exists and does not expose PII.
- Create `docs/dashboards/worker-funnel.md`: document route, modes, filters, tables, and calculation semantics.
- Modify `README.md`: add the new dashboard route to the list.

---

### Task 1: Dashboard Module Skeleton And Filter Normalization

**Files:**
- Create: `src/workerFunnelDashboard.js`
- Create: `test/workerFunnelDashboard.test.js`

- [ ] **Step 1: Write failing tests for constants and filters**

Add this initial test file:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  WORKER_FUNNEL_SECTIONS,
  WORKER_FUNNEL_SEGMENT_DIMENSIONS,
  WORKER_FUNNEL_STAGES,
  emptyWorkerFunnelDashboard,
  normalizeWorkerFunnelFilters
} = require('../src/workerFunnelDashboard');

test('WORKER_FUNNEL_SECTIONS exposes progressive dashboard sections', () => {
  assert.deepEqual(Array.from(WORKER_FUNNEL_SECTIONS), ['summary', 'dynamics', 'segments']);
});

test('WORKER_FUNNEL_SEGMENT_DIMENSIONS exposes whitelisted dimensions', () => {
  assert.deepEqual(Object.keys(WORKER_FUNNEL_SEGMENT_DIMENSIONS), ['source', 'city', 'device']);
});

test('WORKER_FUNNEL_STAGES defines the milestone order', () => {
  assert.deepEqual(WORKER_FUNNEL_STAGES.map((stage) => stage.key), [
    'registration',
    'workerProfile',
    'documentsUploaded',
    'ready',
    'firstBooking',
    'firstSuccessfulShift'
  ]);
});

test('normalizeWorkerFunnelFilters defaults to last 30 days and cohort mode', () => {
  const filters = normalizeWorkerFunnelFilters({}, new Date('2026-06-15T12:00:00.000Z'));

  assert.deepEqual(filters, {
    from: '2026-05-16',
    to: '2026-06-15',
    fromDateTime: '2026-05-16 00:00:00',
    toExclusiveDateTime: '2026-06-16 00:00:00',
    mode: 'cohort',
    segment: 'source',
    source: '',
    city: '',
    device: '',
    workerStatus: '',
    profession: ''
  });
});

test('normalizeWorkerFunnelFilters accepts whitelisted values and trims filter text', () => {
  const filters = normalizeWorkerFunnelFilters(
    {
      from: '2026-05-01',
      to: '2026-05-31',
      mode: 'events',
      segment: 'city',
      source: ' Avito.ru ',
      city: ' Москва ',
      device: ' android ',
      workerStatus: ' ready ',
      profession: ' courier '
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.deepEqual(filters, {
    from: '2026-05-01',
    to: '2026-05-31',
    fromDateTime: '2026-05-01 00:00:00',
    toExclusiveDateTime: '2026-06-01 00:00:00',
    mode: 'events',
    segment: 'city',
    source: 'Avito.ru',
    city: 'Москва',
    device: 'android',
    workerStatus: 'ready',
    profession: 'courier'
  });
});

test('normalizeWorkerFunnelFilters falls back from invalid dates, mode, and segment', () => {
  const filters = normalizeWorkerFunnelFilters(
    {
      from: '2026-99-99',
      to: 'not-a-date',
      mode: 'cohort; DROP TABLE mg_users',
      segment: 'phone'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.equal(filters.from, '2026-05-16');
  assert.equal(filters.to, '2026-06-15');
  assert.equal(filters.mode, 'cohort');
  assert.equal(filters.segment, 'source');
});

test('emptyWorkerFunnelDashboard returns a shell model without rows', () => {
  const filters = normalizeWorkerFunnelFilters(
    { from: '2026-05-01', to: '2026-05-31' },
    new Date('2026-06-15T12:00:00.000Z')
  );
  const dashboard = emptyWorkerFunnelDashboard(filters);

  assert.deepEqual(dashboard, {
    filters,
    summary: {
      kpis: [],
      transitions: [],
      bottlenecks: []
    },
    dynamics: [],
    segments: []
  });
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
npm test -- test/workerFunnelDashboard.test.js
```

Expected: FAIL with `Cannot find module '../src/workerFunnelDashboard'`.

- [ ] **Step 3: Implement minimal module skeleton**

Create `src/workerFunnelDashboard.js` with:

```js
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_MODE = 'cohort';
const DEFAULT_SEGMENT = 'source';
const ALLOWED_MODES = new Set(['cohort', 'events']);

const WORKER_FUNNEL_SECTIONS = new Set(['summary', 'dynamics', 'segments']);
const WORKER_FUNNEL_SEGMENT_DIMENSIONS = Object.freeze({
  source: {
    label: 'Источник',
    column: 'source_label'
  },
  city: {
    label: 'Город',
    column: 'city_label'
  },
  device: {
    label: 'Устройство',
    column: 'device_label'
  }
});
const WORKER_FUNNEL_STAGES = Object.freeze([
  { key: 'registration', label: 'Регистрация' },
  { key: 'workerProfile', label: 'Профиль исполнителя' },
  { key: 'documentsUploaded', label: 'Документы загружены' },
  { key: 'ready', label: 'Ready' },
  { key: 'firstBooking', label: 'Первая бронь' },
  { key: 'firstSuccessfulShift', label: 'Первая успешная смена' }
]);

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

function cleanText(value) {
  const values = Array.isArray(value) ? value : [value];

  for (const rawValue of values) {
    if (rawValue === null || typeof rawValue === 'undefined') {
      continue;
    }

    const text = String(rawValue).trim();

    if (text !== '') {
      return text;
    }
  }

  return '';
}

function toDateTimeParam(dateOnly) {
  return `${dateOnly} 00:00:00`;
}

function defaultRange(now) {
  const toDate = parseDateOnly(formatDateUTC(now));
  const fromDate = addDaysUTC(toDate, -30);

  return { fromDate, toDate };
}

function normalizeWorkerFunnelFilters(input = {}, now = new Date()) {
  const defaults = defaultRange(now);
  const requestedFrom = parseDateOnly(input.from);
  const requestedTo = parseDateOnly(input.to);
  let fromDate = requestedFrom || defaults.fromDate;
  let toDate = requestedTo || defaults.toDate;

  if (fromDate.getTime() > toDate.getTime()) {
    fromDate = defaults.fromDate;
    toDate = defaults.toDate;
  }

  const from = formatDateUTC(fromDate);
  const to = formatDateUTC(toDate);
  const toExclusive = formatDateUTC(addDaysUTC(toDate, 1));
  const mode = ALLOWED_MODES.has(cleanText(input.mode)) ? cleanText(input.mode) : DEFAULT_MODE;
  const requestedSegment = cleanText(input.segment);
  const segment = Object.prototype.hasOwnProperty.call(WORKER_FUNNEL_SEGMENT_DIMENSIONS, requestedSegment)
    ? requestedSegment
    : DEFAULT_SEGMENT;

  return {
    from,
    to,
    fromDateTime: toDateTimeParam(from),
    toExclusiveDateTime: toDateTimeParam(toExclusive),
    mode,
    segment,
    source: cleanText(input.source),
    city: cleanText(input.city),
    device: cleanText(input.device),
    workerStatus: cleanText(input.workerStatus),
    profession: cleanText(input.profession)
  };
}

function emptyWorkerFunnelDashboard(filters) {
  return {
    filters,
    summary: {
      kpis: [],
      transitions: [],
      bottlenecks: []
    },
    dynamics: [],
    segments: []
  };
}

module.exports = {
  WORKER_FUNNEL_SECTIONS,
  WORKER_FUNNEL_SEGMENT_DIMENSIONS,
  WORKER_FUNNEL_STAGES,
  emptyWorkerFunnelDashboard,
  normalizeWorkerFunnelFilters
};
```

- [ ] **Step 4: Run the test and verify GREEN**

Run:

```bash
npm test -- test/workerFunnelDashboard.test.js
```

Expected: PASS for all tests in `test/workerFunnelDashboard.test.js`.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/workerFunnelDashboard.js test/workerFunnelDashboard.test.js
git commit -m "Add worker funnel filter model"
```

---

### Task 2: Merge Logic For Summary, Dynamics, Segments, And Bottlenecks

**Files:**
- Modify: `src/workerFunnelDashboard.js`
- Modify: `test/workerFunnelDashboard.test.js`

- [ ] **Step 1: Write failing merge tests**

Append these tests to `test/workerFunnelDashboard.test.js`:

```js
const {
  mergeWorkerFunnelDashboard
} = require('../src/workerFunnelDashboard');

test('mergeWorkerFunnelDashboard maps summary rows to KPI and transitions', () => {
  const filters = normalizeWorkerFunnelFilters(
    { from: '2026-05-01', to: '2026-05-31' },
    new Date('2026-06-15T12:00:00.000Z')
  );
  const dashboard = mergeWorkerFunnelDashboard(filters, {
    summaryRows: [
      {
        registration_users: '100',
        worker_profile_users: '90',
        documents_uploaded_users: '60',
        ready_users: '40',
        first_booking_users: '20',
        first_successful_shift_users: '10',
        registration_to_worker_profile_median_days: '1.5',
        worker_profile_to_documents_uploaded_median_days: '3',
        documents_uploaded_to_ready_median_days: '2',
        ready_to_first_booking_median_days: '4',
        first_booking_to_first_successful_shift_median_days: '5'
      }
    ],
    dynamicsRows: [],
    segmentRows: []
  });

  assert.deepEqual(dashboard.summary.kpis, [
    { key: 'sample', label: 'Размер выборки', value: 100, detail: 'пользователей на входе' },
    { key: 'ready', label: 'Дошли до ready', value: 40, detail: '40%' },
    { key: 'firstBooking', label: 'Дошли до первой брони', value: 20, detail: '20%' },
    { key: 'firstSuccessfulShift', label: 'Дошли до первой успешной смены', value: 10, detail: '10%' }
  ]);
  assert.deepEqual(dashboard.summary.transitions[0], {
    key: 'registration-to-workerProfile',
    fromKey: 'registration',
    toKey: 'workerProfile',
    fromLabel: 'Регистрация',
    toLabel: 'Профиль исполнителя',
    fromUsers: 100,
    toUsers: 90,
    conversion: 90,
    lostUsers: 10,
    medianDays: 1.5,
    eventFlowMismatch: false
  });
  assert.equal(dashboard.summary.transitions[4].conversion, 50);
  assert.equal(dashboard.summary.transitions[4].lostUsers, 10);
});

test('mergeWorkerFunnelDashboard clamps negative losses in events mode and marks mismatch', () => {
  const filters = normalizeWorkerFunnelFilters(
    { from: '2026-05-01', to: '2026-05-31', mode: 'events' },
    new Date('2026-06-15T12:00:00.000Z')
  );
  const dashboard = mergeWorkerFunnelDashboard(filters, {
    summaryRows: [
      {
        registration_users: '10',
        worker_profile_users: '15',
        documents_uploaded_users: '12',
        ready_users: '8',
        first_booking_users: '5',
        first_successful_shift_users: '3'
      }
    ],
    dynamicsRows: [],
    segmentRows: []
  });

  assert.equal(dashboard.summary.transitions[0].lostUsers, 0);
  assert.equal(dashboard.summary.transitions[0].eventFlowMismatch, true);
});

test('mergeWorkerFunnelDashboard maps dynamics and segments without PII fields', () => {
  const filters = normalizeWorkerFunnelFilters(
    { from: '2026-05-01', to: '2026-05-31', segment: 'city' },
    new Date('2026-06-15T12:00:00.000Z')
  );
  const dashboard = mergeWorkerFunnelDashboard(filters, {
    summaryRows: [
      {
        registration_users: '100',
        worker_profile_users: '80',
        documents_uploaded_users: '40',
        ready_users: '20',
        first_booking_users: '10',
        first_successful_shift_users: '5'
      }
    ],
    dynamicsRows: [
      {
        period: '2026-05-01',
        registration_users: '10',
        ready_users: '4',
        first_booking_users: '2',
        first_successful_shift_users: '1'
      }
    ],
    segmentRows: [
      {
        segment_value: 'Москва',
        registration_users: '60',
        ready_users: '30',
        first_booking_users: '12',
        first_successful_shift_users: '6',
        ready_median_days: '2',
        first_successful_shift_median_days: '8'
      }
    ]
  });

  assert.deepEqual(dashboard.dynamics, [
    {
      period: '2026-05-01',
      registrationUsers: 10,
      readyUsers: 4,
      firstBookingUsers: 2,
      firstSuccessfulShiftUsers: 1
    }
  ]);
  assert.deepEqual(dashboard.segments, [
    {
      label: 'Москва',
      sampleUsers: 60,
      readyUsers: 30,
      firstBookingUsers: 12,
      firstSuccessfulShiftUsers: 6,
      readyConversion: 50,
      firstBookingConversion: 20,
      firstSuccessfulShiftConversion: 10,
      readyMedianDays: 2,
      firstSuccessfulShiftMedianDays: 8,
      smallSample: false
    }
  ]);
  assert.equal(JSON.stringify(dashboard).includes('phone'), false);
  assert.equal(JSON.stringify(dashboard).includes('email'), false);
});

test('mergeWorkerFunnelDashboard identifies bottlenecks', () => {
  const filters = normalizeWorkerFunnelFilters(
    { from: '2026-05-01', to: '2026-05-31' },
    new Date('2026-06-15T12:00:00.000Z')
  );
  const dashboard = mergeWorkerFunnelDashboard(filters, {
    summaryRows: [
      {
        registration_users: '100',
        worker_profile_users: '90',
        documents_uploaded_users: '30',
        ready_users: '20',
        first_booking_users: '15',
        first_successful_shift_users: '5',
        registration_to_worker_profile_median_days: '1',
        worker_profile_to_documents_uploaded_median_days: '9',
        documents_uploaded_to_ready_median_days: '2',
        ready_to_first_booking_median_days: '3',
        first_booking_to_first_successful_shift_median_days: '5'
      }
    ],
    dynamicsRows: [],
    segmentRows: []
  });

  assert.deepEqual(dashboard.summary.bottlenecks, [
    {
      key: 'largest-loss',
      label: 'Самый большой отвал',
      transitionKey: 'workerProfile-to-documentsUploaded',
      value: 60,
      detail: 'Профиль исполнителя -> Документы загружены'
    },
    {
      key: 'lowest-conversion',
      label: 'Самая низкая конверсия',
      transitionKey: 'firstBooking-to-firstSuccessfulShift',
      value: 33.33,
      detail: 'Первая бронь -> Первая успешная смена'
    },
    {
      key: 'slowest-transition',
      label: 'Самый долгий переход',
      transitionKey: 'workerProfile-to-documentsUploaded',
      value: 9,
      detail: 'Профиль исполнителя -> Документы загружены'
    }
  ]);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npm test -- test/workerFunnelDashboard.test.js
```

Expected: FAIL with `mergeWorkerFunnelDashboard is not a function`.

- [ ] **Step 3: Implement merge helpers**

Add these exports and helpers to `src/workerFunnelDashboard.js`:

```js
const SUMMARY_STAGE_COLUMNS = Object.freeze({
  registration: 'registration_users',
  workerProfile: 'worker_profile_users',
  documentsUploaded: 'documents_uploaded_users',
  ready: 'ready_users',
  firstBooking: 'first_booking_users',
  firstSuccessfulShift: 'first_successful_shift_users'
});
const TRANSITIONS = Object.freeze([
  {
    key: 'registration-to-workerProfile',
    fromKey: 'registration',
    toKey: 'workerProfile',
    medianColumn: 'registration_to_worker_profile_median_days'
  },
  {
    key: 'workerProfile-to-documentsUploaded',
    fromKey: 'workerProfile',
    toKey: 'documentsUploaded',
    medianColumn: 'worker_profile_to_documents_uploaded_median_days'
  },
  {
    key: 'documentsUploaded-to-ready',
    fromKey: 'documentsUploaded',
    toKey: 'ready',
    medianColumn: 'documents_uploaded_to_ready_median_days'
  },
  {
    key: 'ready-to-firstBooking',
    fromKey: 'ready',
    toKey: 'firstBooking',
    medianColumn: 'ready_to_first_booking_median_days'
  },
  {
    key: 'firstBooking-to-firstSuccessfulShift',
    fromKey: 'firstBooking',
    toKey: 'firstSuccessfulShift',
    medianColumn: 'first_booking_to_first_successful_shift_median_days'
  }
]);

function numberValue(value) {
  const number = Number(value || 0);

  return Number.isFinite(number) ? number : 0;
}

function textValue(value) {
  return cleanText(value);
}

function roundPercent(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.round(value * 100) / 100;
}

function conversionPercent(numerator, denominator) {
  return denominator > 0 ? roundPercent((numerator / denominator) * 100) : 0;
}

function stageByKey(key) {
  return WORKER_FUNNEL_STAGES.find((stage) => stage.key === key);
}

function stageUsers(row, key) {
  return numberValue(row[SUMMARY_STAGE_COLUMNS[key]]);
}

function transitionFromRow(row, transition, mode) {
  const fromUsers = stageUsers(row, transition.fromKey);
  const toUsers = stageUsers(row, transition.toKey);
  const rawLostUsers = fromUsers - toUsers;

  return {
    key: transition.key,
    fromKey: transition.fromKey,
    toKey: transition.toKey,
    fromLabel: stageByKey(transition.fromKey).label,
    toLabel: stageByKey(transition.toKey).label,
    fromUsers,
    toUsers,
    conversion: conversionPercent(toUsers, fromUsers),
    lostUsers: Math.max(0, rawLostUsers),
    medianDays: numberValue(row[transition.medianColumn]),
    eventFlowMismatch: mode === 'events' && rawLostUsers < 0
  };
}

function kpisFromRow(row) {
  const sampleUsers = stageUsers(row, 'registration');
  const readyUsers = stageUsers(row, 'ready');
  const firstBookingUsers = stageUsers(row, 'firstBooking');
  const firstSuccessfulShiftUsers = stageUsers(row, 'firstSuccessfulShift');

  return [
    { key: 'sample', label: 'Размер выборки', value: sampleUsers, detail: 'пользователей на входе' },
    { key: 'ready', label: 'Дошли до ready', value: readyUsers, detail: `${conversionPercent(readyUsers, sampleUsers)}%` },
    { key: 'firstBooking', label: 'Дошли до первой брони', value: firstBookingUsers, detail: `${conversionPercent(firstBookingUsers, sampleUsers)}%` },
    { key: 'firstSuccessfulShift', label: 'Дошли до первой успешной смены', value: firstSuccessfulShiftUsers, detail: `${conversionPercent(firstSuccessfulShiftUsers, sampleUsers)}%` }
  ];
}

function bottlenecksFromTransitions(transitions) {
  if (transitions.length === 0) {
    return [];
  }

  const largestLoss = transitions.reduce((best, item) => (item.lostUsers > best.lostUsers ? item : best), transitions[0]);
  const lowestConversion = transitions.reduce((best, item) => (item.conversion < best.conversion ? item : best), transitions[0]);
  const slowestTransition = transitions.reduce((best, item) => (item.medianDays > best.medianDays ? item : best), transitions[0]);

  return [
    {
      key: 'largest-loss',
      label: 'Самый большой отвал',
      transitionKey: largestLoss.key,
      value: largestLoss.lostUsers,
      detail: `${largestLoss.fromLabel} -> ${largestLoss.toLabel}`
    },
    {
      key: 'lowest-conversion',
      label: 'Самая низкая конверсия',
      transitionKey: lowestConversion.key,
      value: lowestConversion.conversion,
      detail: `${lowestConversion.fromLabel} -> ${lowestConversion.toLabel}`
    },
    {
      key: 'slowest-transition',
      label: 'Самый долгий переход',
      transitionKey: slowestTransition.key,
      value: slowestTransition.medianDays,
      detail: `${slowestTransition.fromLabel} -> ${slowestTransition.toLabel}`
    }
  ];
}

function dynamicsFromRows(rows) {
  return rows.map((row) => ({
    period: textValue(row.period),
    registrationUsers: numberValue(row.registration_users),
    readyUsers: numberValue(row.ready_users),
    firstBookingUsers: numberValue(row.first_booking_users),
    firstSuccessfulShiftUsers: numberValue(row.first_successful_shift_users)
  }));
}

function segmentsFromRows(rows) {
  return rows.map((row) => {
    const sampleUsers = numberValue(row.registration_users);
    const readyUsers = numberValue(row.ready_users);
    const firstBookingUsers = numberValue(row.first_booking_users);
    const firstSuccessfulShiftUsers = numberValue(row.first_successful_shift_users);

    return {
      label: textValue(row.segment_value) || 'Не указан',
      sampleUsers,
      readyUsers,
      firstBookingUsers,
      firstSuccessfulShiftUsers,
      readyConversion: conversionPercent(readyUsers, sampleUsers),
      firstBookingConversion: conversionPercent(firstBookingUsers, sampleUsers),
      firstSuccessfulShiftConversion: conversionPercent(firstSuccessfulShiftUsers, sampleUsers),
      readyMedianDays: numberValue(row.ready_median_days),
      firstSuccessfulShiftMedianDays: numberValue(row.first_successful_shift_median_days),
      smallSample: sampleUsers < 30
    };
  });
}

function mergeWorkerFunnelDashboard(filters, rows = {}) {
  const summaryRow = rows.summaryRows && rows.summaryRows[0] ? rows.summaryRows[0] : {};
  const transitions = TRANSITIONS.map((transition) => transitionFromRow(summaryRow, transition, filters.mode));

  return {
    filters,
    summary: {
      kpis: kpisFromRow(summaryRow),
      transitions,
      bottlenecks: bottlenecksFromTransitions(transitions)
    },
    dynamics: dynamicsFromRows(rows.dynamicsRows || []),
    segments: segmentsFromRows(rows.segmentRows || [])
  };
}
```

Update `module.exports` to include `mergeWorkerFunnelDashboard`.

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
npm test -- test/workerFunnelDashboard.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/workerFunnelDashboard.js test/workerFunnelDashboard.test.js
git commit -m "Add worker funnel merge model"
```

---

### Task 3: SQL Builders And Section Loaders

**Files:**
- Modify: `src/workerFunnelDashboard.js`
- Modify: `test/workerFunnelDashboard.test.js`

- [ ] **Step 1: Write failing loader and SQL tests**

Append:

```js
const { createDashboardSectionCache } = require('../src/dashboardSectionCache');
const {
  loadWorkerFunnelDashboardSection,
  loadWorkerFunnelDashboardShell
} = require('../src/workerFunnelDashboard');

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

test('loadWorkerFunnelDashboardShell returns empty model without ClickHouse queries', async () => {
  const { calls, client } = createDashboardClient();
  const dashboard = await loadWorkerFunnelDashboardShell(
    client,
    { from: '2026-05-01', to: '2026-05-31', mode: 'events' },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.equal(calls.length, 0);
  assert.equal(dashboard.filters.mode, 'events');
  assert.deepEqual(dashboard.summary.kpis, []);
});

test('loadWorkerFunnelDashboardSection rejects unknown section', async () => {
  const { client } = createDashboardClient();

  await assert.rejects(
    () => loadWorkerFunnelDashboardSection(client, {}, 'bad', new Date('2026-06-15T12:00:00.000Z')),
    {
      message: /Unknown worker funnel section: bad/,
      status: 400
    }
  );
});

test('loadWorkerFunnelDashboardSection queries summary with milestone SQL and safe params', async () => {
  const { calls, client } = createDashboardClient({
    'worker funnel summary': [
      {
        registration_users: '100',
        worker_profile_users: '90',
        documents_uploaded_users: '70',
        ready_users: '50',
        first_booking_users: '20',
        first_successful_shift_users: '10'
      }
    ]
  });

  const dashboard = await loadWorkerFunnelDashboardSection(
    client,
    {
      from: '2026-05-01',
      to: '2026-05-31',
      mode: 'cohort',
      source: 'Avito.ru',
      city: 'Москва',
      device: 'android',
      workerStatus: 'ready',
      profession: 'courier'
    },
    'summary',
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.equal(dashboard.summary.transitions.length, 5);
  assert.deepEqual(calls.map((call) => call.operation), ['worker funnel summary']);

  const call = calls[0];
  assert.equal(call.params.param_from, '2026-05-01 00:00:00');
  assert.equal(call.params.param_to, '2026-06-01 00:00:00');
  assert.equal(call.params.param_source, 'Avito.ru');
  assert.equal(call.params.param_city, 'Москва');
  assert.equal(call.params.param_device, 'android');
  assert.equal(call.params.param_worker_status, 'ready');
  assert.equal(call.params.param_profession, 'courier');
  assert.equal(call.query.includes('FROM mg_users AS u'), true);
  assert.equal(call.query.includes('INNER JOIN mg_workers AS w ON w.user = u._id'), true);
  assert.equal(call.query.includes('LEFT JOIN mg_job_history AS h'), true);
  assert.equal(call.query.includes("h.status = 'booked'"), true);
  assert.equal(call.query.includes('h.worker = w._id'), true);
  assert.equal(call.query.includes('FROM mg_jobs AS j'), true);
  assert.equal(call.query.includes("j.status = 'confirmed'"), true);
  assert.equal(call.query.includes('parseDateTime64BestEffortOrNull(nullIf(w.first_passport_upload, \\'NaT\\'))'), true);
  assert.equal(call.query.includes('parseDateTime64BestEffortOrNull(nullIf(w.first_ready_status, \\'NaT\\'))'), true);
  assert.equal(call.query.includes('u.createdAt >= {from:DateTime}'), true);
  assert.equal(call.query.includes('u.createdAt < {to:DateTime}'), true);
  assert.equal(call.query.includes('meta__source'), true);
  assert.equal(call.query.includes('reg_source'), true);
  assert.equal(call.query.includes('w.full_address__city'), true);
  assert.equal(call.query.includes('u.smartphone_type'), true);
  assert.equal(call.query.includes('w.status = {worker_status:String}'), true);
  assert.equal(call.query.includes('w.spec = {profession:String}'), true);
  assert.equal(call.query.includes('mygig_'), false);
  assert.equal(call.query.includes('phone'), false);
  assert.equal(call.query.includes('email'), false);
  assert.equal(call.query.includes('DROP TABLE'), false);
});

test('loadWorkerFunnelDashboardSection uses stage date filters in events mode', async () => {
  const { calls, client } = createDashboardClient({
    'worker funnel summary': []
  });

  await loadWorkerFunnelDashboardSection(
    client,
    { from: '2026-05-01', to: '2026-05-31', mode: 'events' },
    'summary',
    new Date('2026-06-15T12:00:00.000Z')
  );

  const query = calls[0].query;
  assert.equal(query.includes('countDistinctIf(user_id, registration_at >= {from:DateTime} AND registration_at < {to:DateTime}) AS registration_users'), true);
  assert.equal(query.includes('countDistinctIf(user_id, ready_at >= {from:DateTime} AND ready_at < {to:DateTime}) AS ready_users'), true);
  assert.equal(query.includes('countDistinctIf(user_id, first_successful_shift_at >= {from:DateTime} AND first_successful_shift_at < {to:DateTime}) AS first_successful_shift_users'), true);
});

test('loadWorkerFunnelDashboardSection loads dynamics and segments', async () => {
  const { calls, client } = createDashboardClient({
    'worker funnel dynamics': [{ period: '2026-05-01', registration_users: '5' }],
    'worker funnel segments': [{ segment_value: 'Москва', registration_users: '50' }]
  });

  const dynamics = await loadWorkerFunnelDashboardSection(
    client,
    { from: '2026-05-01', to: '2026-05-31' },
    'dynamics',
    new Date('2026-06-15T12:00:00.000Z')
  );
  const segments = await loadWorkerFunnelDashboardSection(
    client,
    { from: '2026-05-01', to: '2026-05-31', segment: 'city' },
    'segments',
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.equal(dynamics.dynamics[0].period, '2026-05-01');
  assert.equal(segments.segments[0].label, 'Москва');
  assert.deepEqual(calls.map((call) => call.operation), [
    'worker funnel dynamics',
    'worker funnel segments'
  ]);
  assert.equal(calls[1].query.includes('city_label AS segment_value'), true);
  assert.equal(calls[1].query.includes('LIMIT 50'), true);
});

test('loadWorkerFunnelDashboardSection caches sections by filters', async () => {
  let timestamp = Date.parse('2026-06-15T12:00:00.000Z');
  const { calls, client } = createDashboardClient({
    'worker funnel summary': [{ registration_users: '1' }]
  });
  const cache = createDashboardSectionCache({ now: () => timestamp });
  const input = { from: '2026-05-01', to: '2026-05-31', mode: 'cohort' };

  await loadWorkerFunnelDashboardSection(client, input, 'summary', new Date('2026-06-15T12:00:00.000Z'), { cache });
  await loadWorkerFunnelDashboardSection(client, input, 'summary', new Date('2026-06-15T12:00:00.000Z'), { cache });
  assert.equal(calls.length, 1);

  await loadWorkerFunnelDashboardSection(client, { ...input, mode: 'events' }, 'summary', new Date('2026-06-15T12:00:00.000Z'), { cache });
  assert.equal(calls.length, 2);

  timestamp = Date.parse('2026-06-16T00:00:00.000Z');
  await loadWorkerFunnelDashboardSection(client, input, 'summary', new Date('2026-06-15T12:00:00.000Z'), { cache });
  assert.equal(calls.length, 3);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npm test -- test/workerFunnelDashboard.test.js
```

Expected: FAIL with missing loader exports.

- [ ] **Step 3: Implement SQL builders and loaders**

In `src/workerFunnelDashboard.js`:

- import `successfulConfirmedShiftFlagExpression`;
- add `createBadRequestError`, `assertWorkerFunnelSection`, `readThroughCache`, `cacheKeyForWorkerFunnelSection`;
- add `paramsForFilters`;
- add `workerMilestonesCte(filters)`;
- add `summaryQuery(filters)`, `dynamicsQuery(filters)`, `segmentsQuery(filters)`;
- add `loadWorkerFunnelRows`, `loadWorkerFunnelDashboardShell`, `loadWorkerFunnelDashboardSection`;
- export the new functions.

Use these SQL contracts:

```js
const { successfulConfirmedShiftFlagExpression } = require('./successfulConfirmedShift');

function sourceLabelExpression() {
  return "ifNull(nullIf(u.meta__source, ''), ifNull(nullIf(u.reg_source, ''), 'Не указан'))";
}

function cityLabelExpression() {
  return "ifNull(nullIf(w.full_address__city, ''), 'Не указан')";
}

function deviceLabelExpression() {
  return "ifNull(nullIf(u.smartphone_type, ''), 'Не указано')";
}

function optionalFilterConditions(filters) {
  const conditions = [
    "ifNull(u._id, '') != ''",
    "ifNull(w._id, '') != ''",
    "ifNull(w.user, '') != ''",
    "ifNull(u.role, '') = 'worker'",
    'ifNull(u.deleted, 0) = 0',
    'ifNull(w.deleted, 0) = 0'
  ];

  if (filters.source) {
    conditions.push(`${sourceLabelExpression()} = {source:String}`);
  }

  if (filters.city) {
    conditions.push(`${cityLabelExpression()} = {city:String}`);
  }

  if (filters.device) {
    conditions.push(`${deviceLabelExpression()} = {device:String}`);
  }

  if (filters.workerStatus) {
    conditions.push('w.status = {worker_status:String}');
  }

  if (filters.profession) {
    conditions.push('w.spec = {profession:String}');
  }

  return conditions;
}
```

The milestone CTE must contain:

```sql
WITH first_bookings AS (
  SELECT
    h.worker AS worker_id,
    min(coalesce(h.createdAt, h.updatedAt)) AS first_booking_at
  FROM mg_job_history AS h
  WHERE h.status = 'booked'
    AND ifNull(h.worker, '') != ''
  GROUP BY h.worker
),
first_successful_shifts AS (
  SELECT
    j.worker AS worker_id,
    min(coalesce(j.start_fact, j.finish_fact, j.start)) AS first_successful_shift_at
  FROM mg_jobs AS j
  WHERE ifNull(j.worker, '') != ''
    AND ifNull(j.deleted, 0) = 0
    AND if(ifNull(j.status, '') = 'confirmed' AND (
      toFloat64OrZero(ifNull(toString(j.hours), '')) > 0
      OR toFloat64OrZero(ifNull(toString(j.payment), '')) > 0
      OR toFloat64OrZero(ifNull(toString(j.salary_per_job), '')) > 0
      OR toFloat64OrZero(ifNull(toString(j.salary_per_hour), '')) * toFloat64OrZero(ifNull(toString(j.hours), '')) > 0
      OR (
        j.start_fact IS NOT NULL
        AND j.finish_fact IS NOT NULL
        AND j.finish_fact > j.start_fact
        AND dateDiff('minute', j.start_fact, j.finish_fact) > 0
      )
    ), 1, 0) = 1
  GROUP BY j.worker
),
worker_milestones AS (
  SELECT
    u._id AS user_id,
    w._id AS worker_id,
    u.createdAt AS registration_at,
    w.createdAt AS worker_profile_at,
    parseDateTime64BestEffortOrNull(nullIf(w.first_passport_upload, 'NaT')) AS documents_uploaded_at,
    parseDateTime64BestEffortOrNull(nullIf(w.first_ready_status, 'NaT')) AS ready_at,
    fb.first_booking_at AS first_booking_at,
    fs.first_successful_shift_at AS first_successful_shift_at,
    ifNull(nullIf(u.meta__source, ''), ifNull(nullIf(u.reg_source, ''), 'Не указан')) AS source_label,
    ifNull(nullIf(w.full_address__city, ''), 'Не указан') AS city_label,
    ifNull(nullIf(u.smartphone_type, ''), 'Не указано') AS device_label,
    ifNull(w.status, '') AS worker_status,
    ifNull(w.spec, '') AS profession
  FROM mg_users AS u
  INNER JOIN mg_workers AS w ON w.user = u._id
  LEFT JOIN first_bookings AS fb ON fb.worker_id = w._id
  LEFT JOIN first_successful_shifts AS fs ON fs.worker_id = w._id
  WHERE ifNull(u._id, '') != ''
    AND ifNull(w._id, '') != ''
    AND ifNull(w.user, '') != ''
    AND ifNull(u.role, '') = 'worker'
    AND ifNull(u.deleted, 0) = 0
    AND ifNull(w.deleted, 0) = 0
    AND ifNull(nullIf(u.meta__source, ''), ifNull(nullIf(u.reg_source, ''), 'Не указан')) = {source:String}
    AND ifNull(nullIf(w.full_address__city, ''), 'Не указан') = {city:String}
    AND ifNull(nullIf(u.smartphone_type, ''), 'Не указано') = {device:String}
    AND w.status = {worker_status:String}
    AND w.spec = {profession:String}
)
```

For the successful shift expression use:

```js
successfulConfirmedShiftFlagExpression('j')
```

The summary query for cohort mode must count stage completion inside users whose `registration_at` is in the selected range. The events mode must count each stage where the stage date itself is in the selected range.

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
npm test -- test/workerFunnelDashboard.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/workerFunnelDashboard.js test/workerFunnelDashboard.test.js
git commit -m "Add worker funnel ClickHouse loaders"
```

---

### Task 4: Permissions, Navigation, And Server Routes

**Files:**
- Modify: `src/auth.js`
- Modify: `src/render.js`
- Modify: `src/server.js`
- Modify: `test/render.test.js`
- Modify: `test/renderAuth.test.js`
- Modify: `test/server.test.js`

- [ ] **Step 1: Write failing render/auth/server tests**

Add these expectations:

In `test/render.test.js` near navigation tests:

```js
test('renderHome includes worker funnel navigation', () => {
  const html = renderHome({
    database: 'etl',
    tables: [],
    activeNav: 'tables'
  });

  assert.match(html, /href="\/dashboards\/worker-funnel"/);
  assert.match(html, /Воронка исполнителей/);
});
```

In `test/renderAuth.test.js`, extend the permission test user and assertions:

```js
permissions: ['tables', 'worker-funnel', 'worker-cancellations', 'sql-inspector']
```

and assert:

```js
assert.match(html, /name="permissions" value="worker-funnel" checked/);
```

In `test/server.test.js`, update `createFakeClient`:

```js
if (operation === 'worker funnel summary') {
  return [{
    registration_users: 100,
    worker_profile_users: 90,
    documents_uploaded_users: 70,
    ready_users: 50,
    first_booking_users: 20,
    first_successful_shift_users: 10
  }];
}

if (operation === 'worker funnel dynamics') {
  return [{ period: '2026-05-01', registration_users: 10, ready_users: 4, first_booking_users: 2, first_successful_shift_users: 1 }];
}

if (operation === 'worker funnel segments') {
  return [{ segment_value: 'Avito.ru', registration_users: 50, ready_users: 20, first_booking_users: 10, first_successful_shift_users: 5 }];
}
```

Add route tests:

```js
test('GET /dashboards/worker-funnel renders dashboard shell without heavy query', async () => {
  const client = createFakeClient();

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(
      baseUrl,
      '/dashboards/worker-funnel?from=2026-05-01&to=2026-05-31&mode=events&segment=city'
    );

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html\b/);
    assert.match(text, /Воронка исполнителей/);
    assert.match(text, /Загружается/);
    assert.match(text, /\/dashboards\/worker-funnel\/section\?section=summary/);
    assert.match(text, /\/dashboards\/worker-funnel\/section\?section=dynamics/);
    assert.match(text, /\/dashboards\/worker-funnel\/section\?section=segments/);
  });

  const funnelCalls = client.calls.filter(
    (call) => call[0] === 'queryJSONEachRow' && String(call[1]).startsWith('worker funnel')
  );
  assert.equal(funnelCalls.length, 0);
});

test('GET /dashboards/worker-funnel/section reloads summary fragment', async () => {
  const client = createFakeClient();

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(
      baseUrl,
      '/dashboards/worker-funnel/section?section=summary&from=2026-05-01&to=2026-05-31'
    );

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html\b/);
    assert.match(text, /Размер выборки/);
    assert.doesNotMatch(text, /<html/);
  });

  const calls = client.calls.filter(
    (call) => call[0] === 'queryJSONEachRow' && String(call[1]).startsWith('worker funnel')
  );
  assert.deepEqual(calls.map((call) => call[1]), ['worker funnel summary']);
});

test('GET /dashboards/worker-funnel/section redacts upstream errors in fragment', async () => {
  const client = createFakeClient({
    async queryJSONEachRow(query, params, operation) {
      throw new Error(`${operation} failed with password super-secret`);
    }
  });

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(baseUrl, '/dashboards/worker-funnel/section?section=summary');

    assert.equal(response.status, 502);
    assert.match(text, /worker funnel summary failed with password \[redacted\]/);
    assert.doesNotMatch(text, /super-secret/);
    assert.doesNotMatch(text, /<html/);
  });
});
```

Extend active nav test:

```js
assert.equal(activeNavForPath('/dashboards/worker-funnel'), 'worker-funnel');
assert.equal(activeNavForPath('/dashboards/worker-funnel/'), 'worker-funnel');
assert.equal(activeNavForPath('/dashboards/worker-funnel/section'), 'worker-funnel');
```

- [ ] **Step 2: Run selected tests and verify RED**

Run:

```bash
npm test -- test/render.test.js test/renderAuth.test.js test/server.test.js
```

Expected: FAIL because permission, nav, render exports, and routes are missing.

- [ ] **Step 3: Implement permission and navigation**

In `src/auth.js`, insert before `worker-cancellations`:

```js
{
  id: 'worker-funnel',
  label: 'Воронка исполнителей',
  description: 'Агрегированный дашборд переходов пользователей-исполнителей по воронке.'
},
```

In `src/render.js`, insert a nav item before `worker-cancellations`:

```js
{
  href: '/dashboards/worker-funnel',
  label: 'Воронка исполнителей',
  id: 'worker-funnel',
  permission: 'worker-funnel'
},
```

- [ ] **Step 4: Implement server imports and routes**

In `src/server.js`, import:

```js
const {
  WORKER_FUNNEL_SECTIONS,
  loadWorkerFunnelDashboardSection,
  loadWorkerFunnelDashboardShell
} = require('./workerFunnelDashboard');
```

and render functions:

```js
renderWorkerFunnelDashboard,
renderWorkerFunnelDashboardSection,
```

Update `activeNavForPath`, `sectionForPath`, and routes using the same pattern as worker cancellations. Add:

```js
app.get(
  '/dashboards/worker-funnel',
  requireAuth('worker-funnel'),
  asyncRoute(async (req, res) => {
    const dashboard = await loadWorkerFunnelDashboardShell(client, req.query, new Date());

    recordCurrentUserActivity(req, activityEventType(req));
    res
      .status(200)
      .type('html')
      .send(renderWorkerFunnelDashboard({ database, dashboard, progressive: true, ...viewContext(req) }));
  })
);

app.get(
  '/dashboards/worker-funnel/section',
  requireAuth('worker-funnel'),
  asyncRoute(async (req, res) => {
    const section = String(req.query.section || '');

    if (!WORKER_FUNNEL_SECTIONS.has(section)) {
      res
        .status(400)
        .type('html')
        .send(
          renderDashboardSectionError({
            message: sanitizeForResponse(`Unknown worker funnel section: ${section}`, config)
          })
        );
      return;
    }

    try {
      const dashboard = await loadWorkerFunnelDashboardSection(
        client,
        req.query,
        section,
        new Date(),
        { cache: dashboardSectionCache }
      );

      res
        .status(200)
        .type('html')
        .send(renderWorkerFunnelDashboardSection({ dashboard, section, ...viewContext(req) }));
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

- [ ] **Step 5: Run selected tests and verify remaining RED is only render functions**

Run:

```bash
npm test -- test/render.test.js test/renderAuth.test.js test/server.test.js
```

Expected: FAIL for missing `renderWorkerFunnelDashboard` and `renderWorkerFunnelDashboardSection`.

- [ ] **Step 6: Commit permission and route wiring after render task is green**

Do not commit yet if tests still fail. Commit at the end of Task 5 together with render wiring.

---

### Task 5: Render Worker Funnel Dashboard

**Files:**
- Modify: `src/render.js`
- Modify: `test/render.test.js`

- [ ] **Step 1: Write focused render tests**

Append tests for:

```js
test('renderWorkerFunnelDashboard renders filters and progressive section loading state', () => {
  const dashboard = {
    filters: {
      from: '2026-05-01',
      to: '2026-05-31',
      fromDateTime: '2026-05-01 00:00:00',
      toExclusiveDateTime: '2026-06-01 00:00:00',
      mode: 'events',
      segment: 'city',
      source: 'Avito.ru',
      city: 'Москва',
      device: 'android',
      workerStatus: 'ready',
      profession: 'courier'
    },
    summary: { kpis: [], transitions: [], bottlenecks: [] },
    dynamics: [],
    segments: []
  };
  const html = renderWorkerFunnelDashboard({
    database: 'etl',
    dashboard,
    progressive: true
  });

  assert.match(html, /Воронка исполнителей/);
  assert.match(html, /class="nav-link active" href="\/dashboards\/worker-funnel"/);
  assert.match(html, /<form class="filter-bar" action="\/dashboards\/worker-funnel" method="get">/);
  assert.match(html, /name="mode"/);
  assert.match(html, /value="events" selected/);
  assert.match(html, /name="segment"/);
  assert.match(html, /value="city" selected/);
  assert.match(html, /value="Avito.ru"/);
  assert.match(html, /value="Москва"/);
  assert.match(html, /value="android"/);
  assert.match(html, /value="ready"/);
  assert.match(html, /value="courier"/);
  assert.match(html, /data-dashboard-fragment-url="\/dashboards\/worker-funnel\/section\?section=summary/);
  assert.match(html, /data-dashboard-fragment-url="\/dashboards\/worker-funnel\/section\?section=dynamics/);
  assert.match(html, /data-dashboard-fragment-url="\/dashboards\/worker-funnel\/section\?section=segments/);
});

test('renderWorkerFunnelDashboardSection renders summary KPI, transitions, and bottlenecks', () => {
  const dashboard = {
    filters: {
      from: '2026-05-01',
      to: '2026-05-31',
      mode: 'cohort',
      segment: 'source'
    },
    summary: {
      kpis: [
        { key: 'sample', label: 'Размер выборки', value: 100, detail: 'пользователей на входе' },
        { key: 'ready', label: 'Дошли до ready', value: 40, detail: '40%' }
      ],
      transitions: [
        {
          key: 'registration-to-workerProfile',
          fromLabel: 'Регистрация',
          toLabel: 'Профиль исполнителя',
          fromUsers: 100,
          toUsers: 90,
          conversion: 90,
          lostUsers: 10,
          medianDays: 1.5,
          eventFlowMismatch: false
        }
      ],
      bottlenecks: [
        {
          key: 'largest-loss',
          label: 'Самый большой отвал',
          value: 10,
          detail: 'Регистрация -> Профиль исполнителя'
        }
      ]
    },
    dynamics: [],
    segments: []
  };
  const html = renderWorkerFunnelDashboardSection({ dashboard, section: 'summary' });

  assert.match(html, /Размер выборки/);
  assert.match(html, /100/);
  assert.match(html, /Регистрация/);
  assert.match(html, /Профиль исполнителя/);
  assert.match(html, /90%/);
  assert.match(html, /Самый большой отвал/);
});

test('renderWorkerFunnelDashboardSection renders dynamics and segment table without PII', () => {
  const dashboard = {
    filters: { from: '2026-05-01', to: '2026-05-31', mode: 'cohort', segment: 'source' },
    summary: { kpis: [], transitions: [], bottlenecks: [] },
    dynamics: [
      { period: '2026-05-01', registrationUsers: 10, readyUsers: 4, firstBookingUsers: 2, firstSuccessfulShiftUsers: 1 }
    ],
    segments: [
      {
        label: '<Avito>',
        sampleUsers: 60,
        readyUsers: 30,
        firstBookingUsers: 12,
        firstSuccessfulShiftUsers: 6,
        readyConversion: 50,
        firstBookingConversion: 20,
        firstSuccessfulShiftConversion: 10,
        readyMedianDays: 2,
        firstSuccessfulShiftMedianDays: 8,
        smallSample: false
      }
    ]
  };

  const dynamicsHtml = renderWorkerFunnelDashboardSection({ dashboard, section: 'dynamics' });
  const segmentsHtml = renderWorkerFunnelDashboardSection({ dashboard, section: 'segments' });

  assert.match(dynamicsHtml, /2026-05-01/);
  assert.match(dynamicsHtml, /10/);
  assert.match(segmentsHtml, /&lt;Avito&gt;/);
  assert.match(segmentsHtml, /50%/);
  assert.doesNotMatch(segmentsHtml, /phone|email|ФИО|Телефон/);
});

test('renderWorkerFunnelDashboardSection renders empty states', () => {
  const dashboard = {
    filters: { from: '2026-05-01', to: '2026-05-31', mode: 'cohort', segment: 'source' },
    summary: { kpis: [], transitions: [], bottlenecks: [] },
    dynamics: [],
    segments: []
  };

  assert.match(renderWorkerFunnelDashboardSection({ dashboard, section: 'summary' }), /Нет пользователей-исполнителей/);
  assert.match(renderWorkerFunnelDashboardSection({ dashboard, section: 'dynamics' }), /Нет динамики/);
  assert.match(renderWorkerFunnelDashboardSection({ dashboard, section: 'segments' }), /Нет сегментов/);
});
```

- [ ] **Step 2: Run render tests and verify RED**

Run:

```bash
npm test -- test/render.test.js
```

Expected: FAIL because new render functions are missing.

- [ ] **Step 3: Implement render helpers**

In `src/render.js`, add:

- `workerFunnelPageHref(filters, overrides = {})`;
- `workerFunnelSectionUrl(filters, section)`;
- `renderWorkerFunnelModeOptions(selectedMode)`;
- `renderWorkerFunnelSegmentOptions(selectedSegment)`;
- `renderWorkerFunnelKpiCards(kpis, currentUser)`;
- `renderWorkerFunnelTransitions(transitions, currentUser)`;
- `renderWorkerFunnelBottlenecks(bottlenecks, currentUser)`;
- `renderWorkerFunnelDynamics(rows, currentUser)`;
- `renderWorkerFunnelSegments(rows, currentUser)`;
- `renderWorkerFunnelDashboardSection({ dashboard, section, currentUser })`;
- `renderWorkerFunnelDashboard({ database, dashboard, progressive, currentUser, csrfToken })`.

Use metric ids:

- `worker-funnel.summary.sample`;
- `worker-funnel.summary.ready`;
- `worker-funnel.summary.first-booking`;
- `worker-funnel.summary.first-successful-shift`;
- `worker-funnel.transitions`;
- `worker-funnel.dynamics`;
- `worker-funnel.segments`.

Use these empty strings:

```js
'<p class="empty">Нет пользователей-исполнителей для выбранных фильтров.</p>'
'<p class="empty">Нет динамики для выбранных фильтров.</p>'
'<p class="empty">Нет сегментов для выбранных фильтров.</p>'
```

The shell header should use:

```js
renderDashboardHeader({
  title: 'Воронка исполнителей',
  eyebrow: 'Исполнители',
  period: `Период: ${filters.from} - ${filters.to}`,
  details: [
    filters.mode === 'events' ? 'Режим: события в периоде' : 'Режим: когорта регистраций',
    'Без вывода персональных данных'
  ]
})
```

Export `renderWorkerFunnelDashboard` and `renderWorkerFunnelDashboardSection`.

- [ ] **Step 4: Run render/server/auth tests and verify GREEN**

Run:

```bash
npm test -- test/render.test.js test/renderAuth.test.js test/server.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit route and render work**

Run:

```bash
git add src/auth.js src/render.js src/server.js test/render.test.js test/renderAuth.test.js test/server.test.js
git commit -m "Add worker funnel dashboard routes and UI"
```

---

### Task 6: SQL Metric Info

**Files:**
- Modify: `src/sqlMetricInfo.js`
- Modify: `test/sqlMetricInfo.test.js`

- [ ] **Step 1: Write failing SQL metric tests**

Add:

```js
test('worker funnel SQL metric info is registered without PII fields', () => {
  const ids = [
    'worker-funnel.summary.sample',
    'worker-funnel.summary.ready',
    'worker-funnel.summary.first-booking',
    'worker-funnel.summary.first-successful-shift',
    'worker-funnel.transitions',
    'worker-funnel.dynamics',
    'worker-funnel.segments'
  ];

  for (const id of ids) {
    const info = sqlMetricInfoFor(id);

    assert.ok(info, `missing ${id}`);
    assert.match(info.title, /Воронка исполнителей|Переходы|Динамика|Сегменты/);
    assert.match(info.sql, /mg_users|mg_workers/);
    assert.doesNotMatch(info.sql, /mygig_/);
    assert.doesNotMatch(info.sql, /\bphone\b|\bemail\b|passport|inn|snils/i);
  }
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
npm test -- test/sqlMetricInfo.test.js
```

Expected: FAIL because worker funnel metric ids are missing.

- [ ] **Step 3: Implement SQL metric definitions**

In `src/sqlMetricInfo.js`, add a `WORKER_FUNNEL_MILESTONES_SQL` constant with the same public calculation shape as the dashboard module. The SQL-info string should show the optional filters as commented parameterized predicates so analysts see the contract without implying arbitrary SQL input:

```sql
WITH first_bookings AS (
  SELECT
    h.worker AS worker_id,
    min(coalesce(h.createdAt, h.updatedAt)) AS first_booking_at
  FROM mg_job_history AS h
  WHERE h.status = 'booked'
    AND ifNull(h.worker, '') != ''
  GROUP BY h.worker
),
first_successful_shifts AS (
  SELECT
    j.worker AS worker_id,
    min(coalesce(j.start_fact, j.finish_fact, j.start)) AS first_successful_shift_at
  FROM mg_jobs AS j
  WHERE ifNull(j.worker, '') != ''
    AND ifNull(j.deleted, 0) = 0
    AND ifNull(j.status, '') = 'confirmed'
    AND (
      ifNull(j.hours, 0) > 0
      OR ifNull(j.payment, 0) > 0
      OR ifNull(j.salary_per_job, 0) > 0
      OR ifNull(j.salary_per_hour, 0) * ifNull(j.hours, 0) > 0
      OR (
        j.start_fact IS NOT NULL
        AND j.finish_fact IS NOT NULL
        AND j.finish_fact > j.start_fact
        AND dateDiff('minute', j.start_fact, j.finish_fact) > 0
      )
    )
  GROUP BY j.worker
),
worker_milestones AS (
  SELECT
    u._id AS user_id,
    w._id AS worker_id,
    u.createdAt AS registration_at,
    w.createdAt AS worker_profile_at,
    parseDateTime64BestEffortOrNull(nullIf(w.first_passport_upload, 'NaT')) AS documents_uploaded_at,
    parseDateTime64BestEffortOrNull(nullIf(w.first_ready_status, 'NaT')) AS ready_at,
    fb.first_booking_at AS first_booking_at,
    fs.first_successful_shift_at AS first_successful_shift_at,
    ifNull(nullIf(u.meta__source, ''), ifNull(nullIf(u.reg_source, ''), 'Не указан')) AS source_label,
    ifNull(nullIf(w.full_address__city, ''), 'Не указан') AS city_label,
    ifNull(nullIf(u.smartphone_type, ''), 'Не указано') AS device_label,
    ifNull(w.status, '') AS worker_status,
    ifNull(w.spec, '') AS profession
  FROM mg_users AS u
  INNER JOIN mg_workers AS w ON w.user = u._id
  LEFT JOIN first_bookings AS fb ON fb.worker_id = w._id
  LEFT JOIN first_successful_shifts AS fs ON fs.worker_id = w._id
  WHERE ifNull(u._id, '') != ''
    AND ifNull(w._id, '') != ''
    AND ifNull(w.user, '') != ''
    AND ifNull(u.role, '') = 'worker'
    AND ifNull(u.deleted, 0) = 0
    AND ifNull(w.deleted, 0) = 0
    -- Optional filters are appended only when selected:
    -- AND source_label = {source:String}
    -- AND city_label = {city:String}
    -- AND device_label = {device:String}
    -- AND worker_status = {worker_status:String}
    -- AND profession = {profession:String}
)
SELECT
  countDistinctIf(user_id, registration_at IS NOT NULL) AS registration_users,
  countDistinctIf(user_id, ready_at IS NOT NULL) AS ready_users,
  countDistinctIf(user_id, first_booking_at IS NOT NULL) AS first_booking_users,
  countDistinctIf(user_id, first_successful_shift_at IS NOT NULL) AS first_successful_shift_users
FROM worker_milestones
WHERE registration_at >= {from:DateTime}
  AND registration_at < {to:DateTime}
FORMAT JSONEachRow
```

Register:

```js
defineMetricSet({
  baseId: 'worker-funnel.summary',
  sql: WORKER_FUNNEL_MILESTONES_SQL,
  metrics: [
    { suffix: 'sample', title: 'Воронка исполнителей: размер выборки', description: 'Количество пользователей-исполнителей на входе выбранного режима.' },
    { suffix: 'ready', title: 'Воронка исполнителей: дошли до ready', description: 'Количество пользователей, дошедших до первого статуса ready.' },
    { suffix: 'first-booking', title: 'Воронка исполнителей: первая бронь', description: 'Количество пользователей с первым booked-событием в истории смен.' },
    { suffix: 'first-successful-shift', title: 'Воронка исполнителей: первая успешная смена', description: 'Количество пользователей с первой успешной confirmed-сменой без прогула.' }
  ]
});

defineSqlMetric({
  id: 'worker-funnel.transitions',
  title: 'Переходы воронки исполнителей',
  description: 'Показывает конверсию, потери и медианное время между milestone-стадиями.',
  sql: WORKER_FUNNEL_MILESTONES_SQL
});

defineSqlMetric({
  id: 'worker-funnel.dynamics',
  title: 'Динамика воронки исполнителей',
  description: 'Показывает динамику прохождения ключевых стадий по дням.',
  sql: WORKER_FUNNEL_MILESTONES_SQL
});

defineSqlMetric({
  id: 'worker-funnel.segments',
  title: 'Сегменты воронки исполнителей',
  description: 'Сравнивает конверсию по источникам, городам или устройствам.',
  sql: WORKER_FUNNEL_MILESTONES_SQL
});
```

- [ ] **Step 4: Run test and verify GREEN**

Run:

```bash
npm test -- test/sqlMetricInfo.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/sqlMetricInfo.js test/sqlMetricInfo.test.js
git commit -m "Document worker funnel SQL metrics"
```

---

### Task 7: Dashboard Documentation And README

**Files:**
- Create: `docs/dashboards/worker-funnel.md`
- Modify: `README.md`

- [ ] **Step 1: Write dashboard documentation**

Create `docs/dashboards/worker-funnel.md`:

```md
# Воронка исполнителей

Код: `src/workerFunnelDashboard.js`. Маршрут: `/dashboards/worker-funnel`.

Экран показывает агрегированное движение пользователей-исполнителей по milestone-воронке:

`Регистрация -> Профиль исполнителя -> Документы загружены -> Ready -> Первая бронь -> Первая успешная смена`.

## Режимы

- `Когорта регистраций`: пользователи выбираются по `mg_users.createdAt`, а стадии показывают, куда они дошли.
- `События в периоде`: каждая стадия считается по собственной milestone-дате внутри периода. Это операционный поток событий, а не когортная конверсия.

## Источники

Используются только `mg_*`:

- `mg_users`;
- `mg_workers`;
- `mg_job_history`;
- `mg_jobs`;
- `mg_professions`.

`mygig_*` не используется. AppMetrica не входит в первую версию.

## Milestone-даты

- Регистрация: `mg_users.createdAt`.
- Профиль исполнителя: `mg_workers.createdAt`.
- Документы загружены: `parseDateTime64BestEffortOrNull(nullIf(mg_workers.first_passport_upload, 'NaT'))`.
- Ready: `parseDateTime64BestEffortOrNull(nullIf(mg_workers.first_ready_status, 'NaT'))`.
- Первая бронь: первое `mg_job_history.status = 'booked'` по `mg_job_history.worker = mg_workers._id`.
- Первая успешная смена: первая `mg_jobs.status = 'confirmed'`, прошедшая общее правило успешной confirmed-смены без прогула.

## Фильтры

- Период `from/to`.
- Режим `cohort/events`.
- Источник: `mg_users.meta__source`, fallback `mg_users.reg_source`.
- Город: `mg_workers.full_address__city`.
- Устройство: `mg_users.smartphone_type`.
- Текущий статус: `mg_workers.status`.
- Специальность: `mg_workers.spec`.

## Безопасность

Дашборд не выводит телефон, email, ФИО, паспортные данные, ИНН, СНИЛС, `user_id` или `worker_id`. Показываются только агрегаты и сегменты.

## Ограничения

`mg_workers.status` является текущим статусом, а не историей переходов. Поэтому экран использует milestone-даты и не заявляет полный журнал изменения всех статусов исполнителя.
```

- [ ] **Step 2: Update README dashboard list**

In `README.md`, add:

```md
- `http://localhost:3000/dashboards/worker-funnel` - дашборд `Воронка исполнителей` для анализа переходов пользователей-исполнителей по стадиям регистрации, документов, ready, первой брони и первой успешной смены;
```

Add one sentence in the dashboard context paragraph:

```md
В `Воронке исполнителей` период может работать в режиме когорты регистраций или событий в периоде; персональные данные пользователей не выводятся.
```

- [ ] **Step 3: Verify docs grep**

Run:

```bash
rg -n "worker-funnel|Воронка исполнителей" README.md docs/dashboards docs/superpowers/specs
```

Expected: matches in README, dashboard docs, and the design spec.

- [ ] **Step 4: Commit**

Run:

```bash
git add README.md docs/dashboards/worker-funnel.md
git commit -m "Document worker funnel dashboard"
```

---

### Task 8: Full Test Suite And Browser QA

**Files:**
- No source files expected unless verification finds a defect.

- [ ] **Step 1: Run the full automated suite**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Start the app locally**

Use the project’s normal environment-loading approach. In PowerShell, if needed:

```powershell
Get-Content .env | ForEach-Object {
  if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
    [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), 'Process')
  }
}
$env:CLICKHOUSE_CA_PATH = "$PWD\data\yandex-ca-bundle.crt"
npm start
```

Expected: server logs `ETL Analytics listening on port 3000`.

- [ ] **Step 3: Browser QA through the Browser plugin**

Use the Browser skill/runtime. Target flow:

```text
/dashboards/worker-funnel -> change mode/filter -> progressive sections render -> no console errors -> mobile layout remains readable
```

Required checks:

- page identity: URL `/dashboards/worker-funnel`, title contains `Воронка исполнителей`;
- not blank: dashboard header, filters, KPI section loading states or data are visible;
- no framework overlay;
- console health has no relevant errors;
- screenshot desktop;
- switch mode `События в периоде`, submit filters, verify URL contains `mode=events`;
- open mobile viewport and verify filters, KPI, transitions, dynamics, segments stack vertically without overlap.

- [ ] **Step 4: Check no PII is rendered**

In the browser DOM snapshot and route HTML, verify these labels are absent from worker funnel sections:

```text
Телефон
Email
ФИО
Паспорт
ИНН
СНИЛС
```

Expected: none of those labels appear on `/dashboards/worker-funnel` or `/dashboards/worker-funnel/section`.

- [ ] **Step 5: Final git status**

Run:

```bash
git status --short
```

Expected: clean working tree after commits.

---

## Self-Review

Spec coverage:

- Worker-only funnel: Tasks 1, 3, 7.
- Cohort and events modes: Tasks 1, 3, 5, 7.
- Filters: Tasks 1, 3, 5.
- KPI, transitions, losses, median transition time: Tasks 2, 3, 5, 6.
- Dynamics: Tasks 2, 3, 5, 6.
- Segments: Tasks 2, 3, 5, 6.
- Bottlenecks: Tasks 2 and 5.
- No PII: Tasks 2, 3, 5, 6, 7, 8.
- Permissions/navigation/routes: Tasks 4 and 5.
- Documentation: Task 7.
- Browser QA: Task 8.

Placeholder scan:

- The plan contains no unresolved design decisions or SQL-заглушек.
- The only internal flexibility intentionally left to execution is whether section queries are internally split further; the public route contract is fixed and tested.

Type consistency:

- Filter keys are `from`, `to`, `mode`, `segment`, `source`, `city`, `device`, `workerStatus`, `profession`.
- Section names are `summary`, `dynamics`, `segments`.
- Route path is `/dashboards/worker-funnel`.
- Permission id is `worker-funnel`.
