# City Analysis Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the server-rendered "Анализ городов" dashboard for one selected city with demand, geographic worker base, app activity, responses, completions, order composition, and dynamics.

**Architecture:** Follow the existing Express + server-rendered HTML pattern. Add a focused `src/cityAnalysisDashboard.js` data/model module, extend `src/render.js` with city dashboard rendering helpers, and add `/dashboards/city-analysis` in `src/server.js`.

**Tech Stack:** Node.js 20, Express 4, built-in `node:test`, ClickHouse JSONEachRow queries through the existing `ClickHouseClient`.

---

## File Structure

- Create `src/cityAnalysisDashboard.js`
  - Owns filter normalization, ClickHouse parameter serialization, query builders, data loading, and render-ready dashboard model creation.
  - Exports `normalizeCityAnalysisFilters`, `mergeCityAnalysisRows`, `loadCityAnalysisDashboard`.
- Create `test/cityAnalysisDashboard.test.js`
  - Unit tests for normalization, merge calculations, safe query construction, geography, app sessions, booked/completed users, and empty states.
- Modify `src/render.js`
  - Adds navigation item "Анализ городов".
  - Adds `renderCityAnalysisDashboard`.
  - Adds compact KPI, composition, and dynamic chart helpers.
- Modify `test/render.test.js`
  - Covers navigation, city filters, city dashboard render output, escaping, compact blocks, and empty states.
- Modify `src/server.js`
  - Imports loader and renderer.
  - Adds active nav mapping.
  - Adds `/dashboards/city-analysis`.
- Modify `test/server.test.js`
  - Covers route success, query propagation, and active navigation on upstream errors.
- Modify `README.md`
  - Adds the new dashboard route to the dashboard list.

## Shared Naming

Use these names consistently across tests, implementation, and rendering:

```js
{
  filters: {
    from,
    to,
    fromDateTime,
    toExclusiveDateTime,
    active30dFromDateTime,
    active30dToExclusiveDateTime,
    rangeDays,
    city,
    client,
    profession,
    orderType,
    jobStatus,
    contractor,
    salaryFrom,
    salaryTo,
    includeDeletedOrders,
    includeHiddenOrders
  },
  filterOptions: {
    city,
    client,
    profession,
    orderType,
    jobStatus,
    contractor
  },
  context: {
    selectedCity,
    hasCity,
    hasCityCoordinates,
    periodLabel
  },
  summary: {
    orderedShifts,
    activeOrderRequests,
    totalLocatedUsers,
    readyLocatedUsers,
    appActiveUsers,
    bookedUsers,
    completedUsers,
    avgDaily30dActiveUsersPerRequest
  },
  composition: {
    brands,
    professions,
    rateBuckets
  },
  dynamics
}
```

Composition rows use this shape:

```js
{ label: 'Бренд', orderedShifts: 10, sharePercent: 50 }
```

Rate bucket rows use this shape:

```js
{ label: '250-350', orderedShifts: 12, sharePercent: 60, avgSalaryPerHour: 310 }
```

Dynamic rows use this shape:

```js
{
  period: '2026-06-01',
  orderedShifts: 10,
  appActiveUsers: 4,
  bookedUsers: 3,
  completedUsers: 2,
  activeUsersPerRequest: 1.5
}
```

### Task 1: Core Filter And Merge Model

**Files:**
- Create: `src/cityAnalysisDashboard.js`
- Create: `test/cityAnalysisDashboard.test.js`

- [ ] **Step 1: Write failing normalization and merge tests**

Add `test/cityAnalysisDashboard.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  mergeCityAnalysisRows,
  normalizeCityAnalysisFilters
} = require('../src/cityAnalysisDashboard');

test('normalizeCityAnalysisFilters defaults dates, requires a single city, and whitelists values', () => {
  const filters = normalizeCityAnalysisFilters(
    {
      city: [' Москва ', 'Казань'],
      client: ['Brand A', 'Brand A', ' '],
      profession: ' Комплектовщик ',
      orderType: ['regular', 'DROP TABLE'],
      jobStatus: ['confirmed', 'failed', 'confirmed'],
      contractor: ['ООО Ромашка'],
      salaryFrom: '-10',
      salaryTo: '450,5',
      includeDeletedOrders: '1',
      includeHiddenOrders: 'on'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.deepEqual(filters, {
    from: '2026-06-01',
    to: '2026-06-15',
    fromDateTime: '2026-06-01 00:00:00',
    toExclusiveDateTime: '2026-06-16 00:00:00',
    active30dFromDateTime: '2026-05-16 00:00:00',
    active30dToExclusiveDateTime: '2026-06-16 00:00:00',
    rangeDays: 15,
    city: 'Москва',
    client: ['Brand A'],
    profession: ['Комплектовщик'],
    orderType: ['regular'],
    jobStatus: ['confirmed', 'failed'],
    contractor: ['ООО Ромашка'],
    salaryFrom: 0,
    salaryTo: 450.5,
    includeDeletedOrders: true,
    includeHiddenOrders: true
  });
});

test('normalizeCityAnalysisFilters resets invalid date ranges to current month', () => {
  const filters = normalizeCityAnalysisFilters(
    {
      from: '2026-07-10',
      to: '2026-06-01',
      city: 'Москва',
      orderType: 'once'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.equal(filters.from, '2026-06-01');
  assert.equal(filters.to, '2026-06-15');
  assert.equal(filters.toExclusiveDateTime, '2026-06-16 00:00:00');
  assert.equal(filters.city, 'Москва');
  assert.deepEqual(filters.orderType, ['once']);
});

test('mergeCityAnalysisRows maps summary, composition, dynamics, and empty city state', () => {
  const filters = normalizeCityAnalysisFilters(
    {
      from: '2026-06-01',
      to: '2026-06-03',
      city: 'Москва'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  const dashboard = mergeCityAnalysisRows(filters, {
    cityOptionRows: [{ city: 'Москва' }, { city: 'Казань' }],
    filterOptionRows: [
      { filter: 'client', value: 'Brand A' },
      { filter: 'profession', value: 'Комплектовщик' },
      { filter: 'orderType', value: 'regular' },
      { filter: 'jobStatus', value: 'confirmed' },
      { filter: 'contractor', value: 'ООО Ромашка' }
    ],
    cityCoordinateRows: [{ workplace_id: 'wp1' }],
    summaryRows: [{
      ordered_shifts: 100,
      active_order_requests: 25,
      total_located_users: 80,
      ready_located_users: 31,
      app_active_users: 18,
      booked_users: 11,
      completed_users: 7,
      avg_daily_30d_active_users_per_request: 2.5
    }],
    brandRows: [
      { label: 'Brand A', ordered_shifts: 70 },
      { label: 'Brand B', ordered_shifts: 30 }
    ],
    professionRows: [
      { label: 'Комплектовщик', ordered_shifts: 60 },
      { label: 'Водитель', ordered_shifts: 40 }
    ],
    rateRows: [
      { label: '250-350', ordered_shifts: 80, avg_salary_per_hour: 310 },
      { label: '450+', ordered_shifts: 20, avg_salary_per_hour: 470 }
    ],
    dynamicRows: [
      {
        period: '2026-06-01',
        ordered_shifts: 20,
        app_active_users: 8,
        booked_users: 4,
        completed_users: 3,
        active_users_per_request: 2
      }
    ]
  });

  assert.deepEqual(dashboard.filterOptions.city, ['Москва', 'Казань']);
  assert.deepEqual(dashboard.filterOptions.client, ['Brand A']);
  assert.equal(dashboard.context.hasCity, true);
  assert.equal(dashboard.context.hasCityCoordinates, true);
  assert.equal(dashboard.summary.orderedShifts, 100);
  assert.equal(dashboard.summary.activeOrderRequests, 25);
  assert.equal(dashboard.summary.totalLocatedUsers, 80);
  assert.equal(dashboard.summary.readyLocatedUsers, 31);
  assert.equal(dashboard.summary.appActiveUsers, 18);
  assert.equal(dashboard.summary.bookedUsers, 11);
  assert.equal(dashboard.summary.completedUsers, 7);
  assert.equal(dashboard.summary.avgDaily30dActiveUsersPerRequest, 2.5);
  assert.deepEqual(dashboard.composition.brands, [
    { label: 'Brand A', orderedShifts: 70, sharePercent: 70 },
    { label: 'Brand B', orderedShifts: 30, sharePercent: 30 }
  ]);
  assert.deepEqual(dashboard.composition.rateBuckets[0], {
    label: '250-350',
    orderedShifts: 80,
    sharePercent: 80,
    avgSalaryPerHour: 310
  });
  assert.deepEqual(dashboard.dynamics[0], {
    period: '2026-06-01',
    orderedShifts: 20,
    appActiveUsers: 8,
    bookedUsers: 4,
    completedUsers: 3,
    activeUsersPerRequest: 2
  });
});

test('mergeCityAnalysisRows returns zero model when city is not selected', () => {
  const filters = normalizeCityAnalysisFilters({}, new Date('2026-06-15T12:00:00.000Z'));
  const dashboard = mergeCityAnalysisRows(filters, {
    cityOptionRows: [{ city: 'Москва' }],
    filterOptionRows: [],
    cityCoordinateRows: [],
    summaryRows: [],
    brandRows: [],
    professionRows: [],
    rateRows: [],
    dynamicRows: []
  });

  assert.equal(dashboard.context.hasCity, false);
  assert.equal(dashboard.context.hasCityCoordinates, false);
  assert.deepEqual(dashboard.summary, {
    orderedShifts: 0,
    activeOrderRequests: 0,
    totalLocatedUsers: 0,
    readyLocatedUsers: 0,
    appActiveUsers: 0,
    bookedUsers: 0,
    completedUsers: 0,
    avgDaily30dActiveUsersPerRequest: 0
  });
  assert.deepEqual(dashboard.composition.brands, []);
  assert.deepEqual(dashboard.dynamics, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- test/cityAnalysisDashboard.test.js
```

Expected: FAIL with `Cannot find module '../src/cityAnalysisDashboard'`.

- [ ] **Step 3: Create minimal model implementation**

Create `src/cityAnalysisDashboard.js`:

```js
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_ORDER_TYPES = new Set(['once', 'regular']);
const FILTER_OPTION_KEYS = ['client', 'profession', 'orderType', 'jobStatus', 'contractor'];

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatDateUTC(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function formatDateTimeUTC(date) {
  return `${formatDateUTC(date)} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`;
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

function buildDateKeys(from, to) {
  const start = parseDateOnly(from);
  const end = parseDateOnly(to);
  const dates = [];

  for (let current = start; current.getTime() <= end.getTime(); current = addDaysUTC(current, 1)) {
    dates.push(formatDateUTC(current));
  }

  return dates;
}

function toDateTimeParam(dateOnly) {
  return `${dateOnly} 00:00:00`;
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function firstCleanText(value) {
  const values = Array.isArray(value) ? value : [value];

  for (const rawValue of values) {
    const text = cleanText(rawValue);

    if (text !== '') {
      return text;
    }
  }

  return '';
}

function cleanValues(value) {
  const rawValues = Array.isArray(value) ? value : [value];
  const values = [];
  const seen = new Set();

  for (const rawValue of rawValues) {
    const text = cleanText(rawValue);

    if (text === '' || seen.has(text)) {
      continue;
    }

    seen.add(text);
    values.push(text);
  }

  return values;
}

function cleanBooleanFlag(value) {
  const rawValues = Array.isArray(value) ? value : [value];

  return rawValues.some((rawValue) => {
    const text = cleanText(rawValue).toLowerCase();

    return text === '1' || text === 'true' || text === 'on' || text === 'yes';
  });
}

function normalizePositiveNumber(value) {
  const text = firstCleanText(value).replace(',', '.');

  if (text === '') {
    return null;
  }

  const number = Number(text);

  if (!Number.isFinite(number)) {
    return null;
  }

  return Math.max(0, number);
}

function normalizeCityAnalysisFilters(input = {}, now = new Date()) {
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
  const active30dFromDate = addDaysUTC(today, -30);
  const active30dToExclusiveDate = addDaysUTC(today, 1);

  return {
    from,
    to,
    fromDateTime: toDateTimeParam(from),
    toExclusiveDateTime: toDateTimeParam(toExclusive),
    active30dFromDateTime: toDateTimeParam(formatDateUTC(active30dFromDate)),
    active30dToExclusiveDateTime: toDateTimeParam(formatDateUTC(active30dToExclusiveDate)),
    rangeDays: buildDateKeys(from, to).length,
    city: firstCleanText(input.city),
    client: cleanValues(input.client),
    profession: cleanValues(input.profession),
    orderType: cleanValues(input.orderType).filter((value) => ALLOWED_ORDER_TYPES.has(value)),
    jobStatus: cleanValues(input.jobStatus),
    contractor: cleanValues(input.contractor),
    salaryFrom: normalizePositiveNumber(input.salaryFrom),
    salaryTo: normalizePositiveNumber(input.salaryTo),
    includeDeletedOrders: cleanBooleanFlag(input.includeDeletedOrders),
    includeHiddenOrders: cleanBooleanFlag(input.includeHiddenOrders)
  };
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

  return numberValue(numerator) / bottom * 100;
}

function uniqueTextRows(rows, key) {
  const values = [];
  const seen = new Set();

  for (const row of rows) {
    const text = cleanText(row[key]);

    if (text === '' || seen.has(text)) {
      continue;
    }

    seen.add(text);
    values.push(text);
  }

  return values;
}

function emptyFilterOptions() {
  return FILTER_OPTION_KEYS.reduce((options, key) => {
    options[key] = [];
    return options;
  }, {});
}

function filterOptionsFromRows(rows) {
  const options = emptyFilterOptions();
  const seenByKey = FILTER_OPTION_KEYS.reduce((seen, key) => {
    seen[key] = new Set();
    return seen;
  }, {});

  for (const row of rows) {
    const key = String(row.filter || '');
    const value = cleanText(row.value);

    if (!Object.prototype.hasOwnProperty.call(options, key) || value === '') {
      continue;
    }

    if (key === 'orderType' && !ALLOWED_ORDER_TYPES.has(value)) {
      continue;
    }

    if (seenByKey[key].has(value)) {
      continue;
    }

    seenByKey[key].add(value);
    options[key].push(value);
  }

  return options;
}

function compositionRows(rows) {
  const total = rows.reduce((sum, row) => sum + numberValue(row.ordered_shifts), 0);

  return rows.map((row) => {
    const orderedShifts = numberValue(row.ordered_shifts);

    return {
      label: String(row.label || ''),
      orderedShifts,
      sharePercent: percent(orderedShifts, total)
    };
  });
}

function rateRows(rows) {
  const total = rows.reduce((sum, row) => sum + numberValue(row.ordered_shifts), 0);

  return rows.map((row) => {
    const orderedShifts = numberValue(row.ordered_shifts);

    return {
      label: String(row.label || ''),
      orderedShifts,
      sharePercent: percent(orderedShifts, total),
      avgSalaryPerHour: numberValue(row.avg_salary_per_hour)
    };
  });
}

function dynamicRows(rows) {
  return rows.map((row) => ({
    period: String(row.period || ''),
    orderedShifts: numberValue(row.ordered_shifts),
    appActiveUsers: numberValue(row.app_active_users),
    bookedUsers: numberValue(row.booked_users),
    completedUsers: numberValue(row.completed_users),
    activeUsersPerRequest: numberValue(row.active_users_per_request)
  }));
}

function mergeCityAnalysisRows(filters, datasets) {
  const summaryRow = (datasets.summaryRows || [])[0] || {};
  const hasCity = filters.city !== '';
  const filterOptions = filterOptionsFromRows(datasets.filterOptionRows || []);

  return {
    filters,
    filterOptions: {
      city: uniqueTextRows(datasets.cityOptionRows || [], 'city'),
      ...filterOptions
    },
    context: {
      selectedCity: filters.city,
      hasCity,
      hasCityCoordinates: (datasets.cityCoordinateRows || []).length > 0,
      periodLabel: `${filters.from} - ${filters.to}`
    },
    summary: {
      orderedShifts: numberValue(summaryRow.ordered_shifts),
      activeOrderRequests: numberValue(summaryRow.active_order_requests),
      totalLocatedUsers: numberValue(summaryRow.total_located_users),
      readyLocatedUsers: numberValue(summaryRow.ready_located_users),
      appActiveUsers: numberValue(summaryRow.app_active_users),
      bookedUsers: numberValue(summaryRow.booked_users),
      completedUsers: numberValue(summaryRow.completed_users),
      avgDaily30dActiveUsersPerRequest: numberValue(summaryRow.avg_daily_30d_active_users_per_request)
    },
    composition: {
      brands: compositionRows(datasets.brandRows || []),
      professions: compositionRows(datasets.professionRows || []),
      rateBuckets: rateRows(datasets.rateRows || [])
    },
    dynamics: dynamicRows(datasets.dynamicRows || [])
  };
}

async function loadCityAnalysisDashboard() {
  throw new Error('loadCityAnalysisDashboard is not implemented yet');
}

module.exports = {
  mergeCityAnalysisRows,
  normalizeCityAnalysisFilters,
  loadCityAnalysisDashboard
};
```

- [ ] **Step 4: Run test to verify it passes for model behavior**

Run:

```bash
npm test -- test/cityAnalysisDashboard.test.js
```

Expected: PASS for the four tests in `test/cityAnalysisDashboard.test.js`.

- [ ] **Step 5: Commit**

```bash
git add src/cityAnalysisDashboard.js test/cityAnalysisDashboard.test.js
git commit -m "feat: add city analysis dashboard model"
```

### Task 2: ClickHouse Query Loader

**Files:**
- Modify: `src/cityAnalysisDashboard.js`
- Modify: `test/cityAnalysisDashboard.test.js`

- [ ] **Step 1: Add failing loader tests**

Append these tests to `test/cityAnalysisDashboard.test.js`:

```js
const { loadCityAnalysisDashboard } = require('../src/cityAnalysisDashboard');

test('loadCityAnalysisDashboard returns city options and skips heavy queries without selected city', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'city analysis city options') {
        return [{ city: 'Москва' }, { city: 'Казань' }];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  };

  const dashboard = await loadCityAnalysisDashboard(client, {}, new Date('2026-06-15T12:00:00.000Z'));

  assert.equal(dashboard.context.hasCity, false);
  assert.deepEqual(dashboard.filterOptions.city, ['Москва', 'Казань']);
  assert.deepEqual(calls.map((call) => call.operation), ['city analysis city options']);
  assert.equal(calls[0].params.param_from, '2026-06-01 00:00:00');
  assert.equal(calls[0].params.param_to, '2026-06-16 00:00:00');
});

test('loadCityAnalysisDashboard queries city datasets with safe parameters', async () => {
  const calls = [];
  const maliciousCity = 'Москва; DROP TABLE mg_orders';
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'city analysis city options') {
        return [{ city: maliciousCity }];
      }

      if (operation === 'city analysis filter options') {
        return [
          { filter: 'client', value: 'Brand A' },
          { filter: 'profession', value: 'Комплектовщик' },
          { filter: 'orderType', value: 'regular' },
          { filter: 'jobStatus', value: 'confirmed' },
          { filter: 'contractor', value: 'ООО Ромашка' }
        ];
      }

      if (operation === 'city analysis city coordinates') {
        return [{ workplace_id: 'wp1' }];
      }

      if (operation === 'city analysis summary') {
        return [{
          ordered_shifts: 20,
          active_order_requests: 5,
          total_located_users: 12,
          ready_located_users: 8,
          app_active_users: 6,
          booked_users: 4,
          completed_users: 3,
          avg_daily_30d_active_users_per_request: 1.4
        }];
      }

      if (operation === 'city analysis brands') {
        return [{ label: 'Brand A', ordered_shifts: 20 }];
      }

      if (operation === 'city analysis professions') {
        return [{ label: 'Комплектовщик', ordered_shifts: 20 }];
      }

      if (operation === 'city analysis rate buckets') {
        return [{ label: '250-350', ordered_shifts: 20, avg_salary_per_hour: 300 }];
      }

      if (operation === 'city analysis dynamics') {
        return [{
          period: '2026-06-01',
          ordered_shifts: 20,
          app_active_users: 6,
          booked_users: 4,
          completed_users: 3,
          active_users_per_request: 1.4
        }];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  };

  const dashboard = await loadCityAnalysisDashboard(
    client,
    {
      from: '2026-06-01',
      to: '2026-06-03',
      city: maliciousCity,
      client: 'Brand A',
      profession: 'Комплектовщик',
      orderType: 'regular',
      jobStatus: 'confirmed',
      contractor: 'ООО Ромашка',
      salaryFrom: '250',
      salaryTo: '450'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.equal(dashboard.context.selectedCity, maliciousCity);
  assert.equal(dashboard.summary.orderedShifts, 20);
  assert.equal(dashboard.summary.totalLocatedUsers, 12);
  assert.equal(dashboard.composition.brands[0].label, 'Brand A');
  assert.deepEqual(calls.map((call) => call.operation), [
    'city analysis city options',
    'city analysis filter options',
    'city analysis city coordinates',
    'city analysis summary',
    'city analysis brands',
    'city analysis professions',
    'city analysis rate buckets',
    'city analysis dynamics'
  ]);

  for (const call of calls) {
    assert.equal(call.query.includes(maliciousCity), false);
    assert.equal(call.query.includes('DROP TABLE'), false);
    assert.equal(call.params.param_from, '2026-06-01 00:00:00');
    assert.equal(call.params.param_to, '2026-06-04 00:00:00');
  }

  const filterOptionsCall = calls.find((call) => call.operation === 'city analysis filter options');

  assert.equal(filterOptionsCall.params.param_city, maliciousCity);
  assert.equal(Object.prototype.hasOwnProperty.call(filterOptionsCall.params, 'param_clients'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(filterOptionsCall.params, 'param_professions'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(filterOptionsCall.params, 'param_order_types'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(filterOptionsCall.params, 'param_job_statuses'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(filterOptionsCall.params, 'param_contractors'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(filterOptionsCall.params, 'param_salary_from'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(filterOptionsCall.params, 'param_salary_to'), false);

  for (const call of calls.slice(2)) {
    assert.equal(call.params.param_city, maliciousCity);
    assert.equal(call.params.param_clients, "['Brand A']");
    assert.equal(call.params.param_professions, "['Комплектовщик']");
    assert.equal(call.params.param_order_types, "['regular']");
    assert.equal(call.params.param_job_statuses, "['confirmed']");
    assert.equal(call.params.param_contractors, "['ООО Ромашка']");
    assert.equal(call.params.param_salary_from, 250);
    assert.equal(call.params.param_salary_to, 450);
  }

  const summaryCall = calls.find((call) => call.operation === 'city analysis summary');
  assert.equal(summaryCall.query.includes('greatCircleDistance'), true);
  assert.equal(summaryCall.query.includes('<= 15000'), true);
  assert.equal(summaryCall.query.includes('appmetrica_sessions'), true);
  assert.equal(summaryCall.query.includes("ifNull(worker.status, '') IN ('ready', 'booked', 'worked')"), true);
  assert.equal(summaryCall.query.includes("ifNull(history.status, '') = 'booked'"), true);
  assert.equal(summaryCall.query.includes("ifNull(job.status, '') = 'confirmed'"), true);
  assert.equal(summaryCall.query.includes('uniqExactIf(located.user_id'), true);
});

test('loadCityAnalysisDashboard keeps request denominator non-deleted even when deleted orders are included', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'city analysis city options') {
        return [{ city: 'Москва' }];
      }

      if (operation === 'city analysis filter options' || operation === 'city analysis city coordinates') {
        return [];
      }

      return [];
    }
  };

  await loadCityAnalysisDashboard(
    client,
    {
      city: 'Москва',
      from: '2026-06-01',
      to: '2026-06-01',
      includeDeletedOrders: '1',
      includeHiddenOrders: '1'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  const summaryCall = calls.find((call) => call.operation === 'city analysis summary');
  const dynamicsCall = calls.find((call) => call.operation === 'city analysis dynamics');

  assert.equal(summaryCall.query.includes('active_order_requests'), true);
  assert.equal(summaryCall.query.includes('ifNull(o.deleted, 0) = 0 AS is_active_request'), true);
  assert.equal(summaryCall.query.includes('countDistinctIf(order_id, is_active_request)'), true);
  assert.equal(dynamicsCall.query.includes('countDistinctIf(order_id, is_active_request)'), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- test/cityAnalysisDashboard.test.js
```

Expected: FAIL with `loadCityAnalysisDashboard is not implemented yet`.

- [ ] **Step 3: Implement query helpers and loader**

In `src/cityAnalysisDashboard.js`, add these helpers before `loadCityAnalysisDashboard` and replace `loadCityAnalysisDashboard`:

```js
function escapeClickHouseString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function serializeStringArray(values) {
  return `[${values.map((value) => `'${escapeClickHouseString(value)}'`).join(',')}]`;
}

function baseParams(filters) {
  return {
    param_from: filters.fromDateTime,
    param_to: filters.toExclusiveDateTime,
    param_active_30d_from: filters.active30dFromDateTime,
    param_active_30d_to: filters.active30dToExclusiveDateTime
  };
}

function addOptionalOrderWhere(filters, where, params) {
  if (filters.city) {
    where.push('w.address__city = {city:String}');
    params.param_city = filters.city;
  }
  if (filters.client.length > 0) {
    where.push('c.title IN {clients:Array(String)}');
    params.param_clients = serializeStringArray(filters.client);
  }
  if (filters.profession.length > 0) {
    where.push("if(ifNull(p.caption, '') = '', o.spec, p.caption) IN {professions:Array(String)}");
    params.param_professions = serializeStringArray(filters.profession);
  }
  if (filters.orderType.length > 0) {
    where.push('o.type IN {order_types:Array(String)}');
    params.param_order_types = serializeStringArray(filters.orderType);
  }
  if (filters.jobStatus.length > 0) {
    where.push(`o._id IN (
      SELECT DISTINCT j.source
      FROM mg_jobs AS j
      WHERE ifNull(j.deleted, 0) = 0
        AND ifNull(j.source, '') != ''
        AND ifNull(j.status, '') IN {job_statuses:Array(String)}
    )`);
    params.param_job_statuses = serializeStringArray(filters.jobStatus);
  }
  if (filters.contractor.length > 0) {
    where.push("ifNull(ct.legal_name, '') IN {contractors:Array(String)}");
    params.param_contractors = serializeStringArray(filters.contractor);
  }
  if (filters.salaryFrom !== null) {
    where.push('ifNull(o.salary_per_hour, 0) >= {salary_from:Float64}');
    params.param_salary_from = filters.salaryFrom;
  }
  if (filters.salaryTo !== null) {
    where.push('ifNull(o.salary_per_hour, 0) <= {salary_to:Float64}');
    params.param_salary_to = filters.salaryTo;
  }
}

function orderWhereForFilters(filters, params, { forceActiveRequests = false } = {}) {
  const where = [
    'o.start >= {from:DateTime}',
    'o.start < {to:DateTime}',
    "ifNull(o.workplace, '') != ''",
    'ifNull(o.amount, 0) > 0'
  ];

  if (forceActiveRequests || !filters.includeDeletedOrders) {
    where.unshift('ifNull(o.deleted, 0) = 0');
  }

  if (!filters.includeHiddenOrders) {
    where.unshift('ifNull(o.is_hidden, 0) = 0');
  }

  addOptionalOrderWhere(filters, where, params);

  return where.join('\n    AND ');
}

function cityOptionsQuery() {
  return `SELECT
    ifNull(w.address__city, '') AS city
  FROM mg_orders AS o
  LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
  WHERE o.start >= {from:DateTime}
    AND o.start < {to:DateTime}
    AND ifNull(o.deleted, 0) = 0
    AND ifNull(o.is_hidden, 0) = 0
    AND ifNull(o.amount, 0) > 0
  GROUP BY city
  HAVING city != ''
  ORDER BY city
  FORMAT JSONEachRow`;
}

function filterOptionSelect(filter, valueExpression, whereSql) {
  return `SELECT
    '${filter}' AS filter,
    ${valueExpression} AS value
  FROM mg_orders AS o
  LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
  LEFT JOIN mg_clients AS c ON o.client = c._id
  LEFT JOIN mg_professions AS p ON o.spec = p.spec
  LEFT JOIN mg_contractors AS ct ON w.contractor = ct._id
  WHERE ${whereSql}
  GROUP BY value
  HAVING value != ''`;
}

function jobStatusFilterOptionSelect(whereSql) {
  return `SELECT
    'jobStatus' AS filter,
    ifNull(j.status, '') AS value
  FROM mg_orders AS o
  INNER JOIN mg_jobs AS j ON j.source = o._id
  LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
  LEFT JOIN mg_clients AS c ON o.client = c._id
  LEFT JOIN mg_professions AS p ON o.spec = p.spec
  LEFT JOIN mg_contractors AS ct ON w.contractor = ct._id
  WHERE ${whereSql}
    AND ifNull(j.deleted, 0) = 0
  GROUP BY value
  HAVING value != ''`;
}

function filterOptionsQuery(whereSql) {
  return `${[
    filterOptionSelect('client', "ifNull(c.title, '')", whereSql),
    filterOptionSelect('profession', "if(ifNull(p.caption, '') = '', o.spec, p.caption)", whereSql),
    filterOptionSelect('orderType', "ifNull(o.type, '')", whereSql),
    jobStatusFilterOptionSelect(whereSql),
    filterOptionSelect('contractor', "ifNull(ct.legal_name, '')", whereSql)
  ].join('\n  UNION ALL\n  ')}
  ORDER BY filter, value
  FORMAT JSONEachRow`;
}

function cityCoordinatesQuery() {
  return `SELECT
    _id AS workplace_id
  FROM mg_workplaces
  WHERE address__city = {city:String}
    AND length(location__coordinates) >= 2
  FORMAT JSONEachRow`;
}

function cityWorkplacesCte() {
  return `city_workplaces AS (
    SELECT
      _id AS workplace_id,
      location__coordinates AS workplace_coordinates
    FROM mg_workplaces
    WHERE address__city = {city:String}
      AND length(location__coordinates) >= 2
  )`;
}

function locatedUsersCte() {
  return `located_users AS (
    SELECT
      worker.user AS user_id,
      max(ifNull(worker.status, '') IN ('ready', 'booked', 'worked')) AS is_ready_base
    FROM mg_workers AS worker
    CROSS JOIN city_workplaces AS cw
    WHERE ifNull(worker.user, '') != ''
      AND length(worker.location__coordinates) >= 2
      AND greatCircleDistance(
        cw.workplace_coordinates[1],
        cw.workplace_coordinates[2],
        worker.location__coordinates[1],
        worker.location__coordinates[2]
      ) <= 15000
    GROUP BY user_id
  )`;
}

function filteredOrdersCte(whereSql) {
  return `filtered_orders AS (
    SELECT
      o._id AS order_id,
      o.workplace AS workplace_id,
      toString(toDate(o.start)) AS period,
      ifNull(o.amount, 0) AS amount,
      ifNull(o.salary_per_hour, 0) AS salary_per_hour,
      ifNull(c.title, 'Без бренда') AS brand,
      if(ifNull(p.caption, '') = '', o.spec, p.caption) AS profession,
      ifNull(o.deleted, 0) = 0 AS is_active_request
    FROM mg_orders AS o
    LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
    LEFT JOIN mg_clients AS c ON o.client = c._id
    LEFT JOIN mg_professions AS p ON o.spec = p.spec
    LEFT JOIN mg_contractors AS ct ON w.contractor = ct._id
    WHERE ${whereSql}
  )`;
}

function appActiveUsersCte({ use30d = false } = {}) {
  const fromParam = use30d ? 'active_30d_from' : 'from';
  const toParam = use30d ? 'active_30d_to' : 'to';

  return `app_active_users AS (
    SELECT DISTINCT ifNull(s.profile_id, '') AS user_id
    FROM appmetrica_sessions AS s
    INNER JOIN located_users AS located ON located.user_id = ifNull(s.profile_id, '')
    WHERE ifNull(s.profile_id, '') != ''
      AND parseDateTimeBestEffortOrNull(s.session_start_datetime) >= {${fromParam}:DateTime}
      AND parseDateTimeBestEffortOrNull(s.session_start_datetime) < {${toParam}:DateTime}
  )`;
}

function bookedUsersCte() {
  return `booked_users AS (
    SELECT DISTINCT worker.user AS user_id
    FROM mg_job_history AS history
    INNER JOIN filtered_orders AS fo ON history.source = fo.order_id
    INNER JOIN mg_workers AS worker ON history.worker = worker._id
    WHERE ifNull(history.status, '') = 'booked'
      AND ifNull(worker.user, '') != ''
  )`;
}

function completedUsersCte() {
  return `completed_users AS (
    SELECT DISTINCT worker.user AS user_id
    FROM mg_jobs AS job
    INNER JOIN filtered_orders AS fo ON job.source = fo.order_id
    INNER JOIN mg_workers AS worker ON job.worker = worker._id
    WHERE ifNull(job.deleted, 0) = 0
      AND ifNull(job.status, '') = 'confirmed'
      AND ifNull(worker.user, '') != ''
  )`;
}

function daily30dRatioCte() {
  return `daily_30d_ratio AS (
    WITH daily_active AS (
      SELECT
        toString(toDate(parseDateTimeBestEffortOrNull(s.session_start_datetime))) AS period,
        uniqExact(ifNull(s.profile_id, '')) AS active_users
      FROM appmetrica_sessions AS s
      INNER JOIN located_users AS located ON located.user_id = ifNull(s.profile_id, '')
      WHERE ifNull(s.profile_id, '') != ''
        AND parseDateTimeBestEffortOrNull(s.session_start_datetime) >= {active_30d_from:DateTime}
        AND parseDateTimeBestEffortOrNull(s.session_start_datetime) < {active_30d_to:DateTime}
      GROUP BY period
    ),
    daily_requests AS (
      SELECT
        period,
        countDistinctIf(order_id, is_active_request) AS active_requests
      FROM filtered_orders
      GROUP BY period
    )
    SELECT avg(if(active_requests > 0, active_users / active_requests, NULL)) AS avg_ratio
    FROM daily_requests AS requests
    LEFT JOIN daily_active AS active ON active.period = requests.period
    WHERE active_requests > 0
  )`;
}

function summaryQuery(whereSql) {
  return `WITH ${cityWorkplacesCte()},
  ${locatedUsersCte()},
  ${filteredOrdersCte(whereSql)},
  ${appActiveUsersCte()},
  ${bookedUsersCte()},
  ${completedUsersCte()},
  ${daily30dRatioCte()}
  SELECT
    (SELECT sum(amount) FROM filtered_orders) AS ordered_shifts,
    (SELECT countDistinctIf(order_id, is_active_request) FROM filtered_orders) AS active_order_requests,
    (SELECT uniqExact(user_id) FROM located_users) AS total_located_users,
    (SELECT uniqExactIf(located.user_id, located.is_ready_base) FROM located_users AS located) AS ready_located_users,
    (SELECT uniqExact(user_id) FROM app_active_users) AS app_active_users,
    (SELECT uniqExact(user_id) FROM booked_users) AS booked_users,
    (SELECT uniqExact(user_id) FROM completed_users) AS completed_users,
    ifNull((SELECT avg_ratio FROM daily_30d_ratio), 0) AS avg_daily_30d_active_users_per_request
  FORMAT JSONEachRow`;
}

function compositionQuery(whereSql, dimensionExpression, operationAlias) {
  return `WITH ${filteredOrdersCte(whereSql)}
  SELECT
    ${dimensionExpression} AS label,
    sum(amount) AS ordered_shifts
  FROM filtered_orders
  GROUP BY label
  HAVING label != ''
  ORDER BY ordered_shifts DESC, label
  LIMIT 8
  FORMAT JSONEachRow`;
}

function rateBucketsQuery(whereSql) {
  return `WITH ${filteredOrdersCte(whereSql)}
  SELECT
    multiIf(
      salary_per_hour < 250, '0-250',
      salary_per_hour < 350, '250-350',
      salary_per_hour < 450, '350-450',
      '450+'
    ) AS label,
    sum(amount) AS ordered_shifts,
    avgIf(salary_per_hour, salary_per_hour > 0) AS avg_salary_per_hour
  FROM filtered_orders
  GROUP BY label
  ORDER BY label
  FORMAT JSONEachRow`;
}

function dynamicsQuery(whereSql) {
  return `WITH ${cityWorkplacesCte()},
  ${locatedUsersCte()},
  ${filteredOrdersCte(whereSql)},
  daily_orders AS (
    SELECT
      period,
      sum(amount) AS ordered_shifts,
      countDistinctIf(order_id, is_active_request) AS active_order_requests
    FROM filtered_orders
    GROUP BY period
  ),
  daily_app AS (
    SELECT
      toString(toDate(parseDateTimeBestEffortOrNull(s.session_start_datetime))) AS period,
      uniqExact(ifNull(s.profile_id, '')) AS app_active_users
    FROM appmetrica_sessions AS s
    INNER JOIN located_users AS located ON located.user_id = ifNull(s.profile_id, '')
    WHERE ifNull(s.profile_id, '') != ''
      AND parseDateTimeBestEffortOrNull(s.session_start_datetime) >= {from:DateTime}
      AND parseDateTimeBestEffortOrNull(s.session_start_datetime) < {to:DateTime}
    GROUP BY period
  ),
  daily_booked AS (
    SELECT
      fo.period AS period,
      uniqExact(worker.user) AS booked_users
    FROM mg_job_history AS history
    INNER JOIN filtered_orders AS fo ON history.source = fo.order_id
    INNER JOIN mg_workers AS worker ON history.worker = worker._id
    WHERE ifNull(history.status, '') = 'booked'
      AND ifNull(worker.user, '') != ''
    GROUP BY period
  ),
  daily_completed AS (
    SELECT
      fo.period AS period,
      uniqExact(worker.user) AS completed_users
    FROM mg_jobs AS job
    INNER JOIN filtered_orders AS fo ON job.source = fo.order_id
    INNER JOIN mg_workers AS worker ON job.worker = worker._id
    WHERE ifNull(job.deleted, 0) = 0
      AND ifNull(job.status, '') = 'confirmed'
      AND ifNull(worker.user, '') != ''
    GROUP BY period
  )
  SELECT
    orders.period AS period,
    orders.ordered_shifts AS ordered_shifts,
    ifNull(app.app_active_users, 0) AS app_active_users,
    ifNull(booked.booked_users, 0) AS booked_users,
    ifNull(completed.completed_users, 0) AS completed_users,
    if(orders.active_order_requests > 0, ifNull(app.app_active_users, 0) / orders.active_order_requests, 0) AS active_users_per_request
  FROM daily_orders AS orders
  LEFT JOIN daily_app AS app ON app.period = orders.period
  LEFT JOIN daily_booked AS booked ON booked.period = orders.period
  LEFT JOIN daily_completed AS completed ON completed.period = orders.period
  ORDER BY orders.period
  FORMAT JSONEachRow`;
}

function paramsAndWhere(filters) {
  const params = baseParams(filters);
  const whereSql = orderWhereForFilters(filters, params);

  return { params, whereSql };
}

async function loadCityAnalysisDashboard(client, input = {}, now = new Date()) {
  const filters = normalizeCityAnalysisFilters(input, now);
  const optionRows = await client.queryJSONEachRow(
    cityOptionsQuery(),
    baseParams(filters),
    'city analysis city options'
  );

  if (filters.city === '') {
    return mergeCityAnalysisRows(filters, {
      cityOptionRows: optionRows,
      filterOptionRows: [],
      cityCoordinateRows: [],
      summaryRows: [],
      brandRows: [],
      professionRows: [],
      rateRows: [],
      dynamicRows: []
    });
  }

  const optionFilters = {
    ...filters,
    client: [],
    profession: [],
    orderType: [],
    jobStatus: [],
    contractor: [],
    salaryFrom: null,
    salaryTo: null
  };
  const { params: optionParams, whereSql: optionWhereSql } = paramsAndWhere(optionFilters);
  const { params, whereSql } = paramsAndWhere(filters);
  const [
    filterOptionRows,
    cityCoordinateRows,
    summaryRows,
    brandRows,
    professionRows,
    rateRows,
    dynamicRowsResult
  ] = await Promise.all([
    client.queryJSONEachRow(filterOptionsQuery(optionWhereSql), optionParams, 'city analysis filter options'),
    client.queryJSONEachRow(cityCoordinatesQuery(), params, 'city analysis city coordinates'),
    client.queryJSONEachRow(summaryQuery(whereSql), params, 'city analysis summary'),
    client.queryJSONEachRow(compositionQuery(whereSql, 'brand'), params, 'city analysis brands'),
    client.queryJSONEachRow(compositionQuery(whereSql, 'profession'), params, 'city analysis professions'),
    client.queryJSONEachRow(rateBucketsQuery(whereSql), params, 'city analysis rate buckets'),
    client.queryJSONEachRow(dynamicsQuery(whereSql), params, 'city analysis dynamics')
  ]);

  return mergeCityAnalysisRows(filters, {
    cityOptionRows: optionRows,
    filterOptionRows,
    cityCoordinateRows,
    summaryRows,
    brandRows,
    professionRows,
    rateRows,
    dynamicRows: dynamicRowsResult
  });
}
```

- [ ] **Step 4: Run loader tests**

Run:

```bash
npm test -- test/cityAnalysisDashboard.test.js
```

Expected: PASS for all tests in `test/cityAnalysisDashboard.test.js`.

- [ ] **Step 5: Commit**

```bash
git add src/cityAnalysisDashboard.js test/cityAnalysisDashboard.test.js
git commit -m "feat: load city analysis dashboard data"
```

### Task 3: Renderer And Navigation

**Files:**
- Modify: `src/render.js`
- Modify: `test/render.test.js`

- [ ] **Step 1: Add failing render tests**

Modify the import at the top of `test/render.test.js`:

```js
const {
  escapeHtml,
  renderCityAnalysisDashboard,
  renderError,
  renderHome,
  renderSalesByProjectDashboard,
  renderTable,
  renderWorkplaceAnalysisDashboard,
  renderWorkplacePointDashboard
} = require('../src/render');
```

Append these tests to `test/render.test.js`:

```js
test('renderHome includes city analysis navigation', () => {
  const html = renderHome({
    database: 'etl',
    tables: ['mg_orders']
  });

  assert.match(html, /Анализ городов/);
  assert.match(html, /href="\/dashboards\/city-analysis"/);
});

test('renderCityAnalysisDashboard renders filters, balance, composition, dynamics, and escapes values', () => {
  const html = renderCityAnalysisDashboard({
    database: 'etl',
    dashboard: {
      filters: {
        from: '2026-06-01',
        to: '2026-06-03',
        city: '<script>Москва</script>',
        client: ['Brand A'],
        profession: ['Комплектовщик'],
        orderType: ['regular'],
        jobStatus: ['confirmed'],
        contractor: ['ООО Ромашка'],
        salaryFrom: 250,
        salaryTo: 450,
        includeDeletedOrders: true,
        includeHiddenOrders: false
      },
      filterOptions: {
        city: ['<script>Москва</script>', 'Казань'],
        client: ['Brand A', 'Brand B'],
        profession: ['Комплектовщик'],
        orderType: ['regular', 'once'],
        jobStatus: ['confirmed', 'failed'],
        contractor: ['ООО Ромашка']
      },
      context: {
        selectedCity: '<script>Москва</script>',
        hasCity: true,
        hasCityCoordinates: true,
        periodLabel: '2026-06-01 - 2026-06-03'
      },
      summary: {
        orderedShifts: 120,
        activeOrderRequests: 20,
        totalLocatedUsers: 80,
        readyLocatedUsers: 31,
        appActiveUsers: 18,
        bookedUsers: 11,
        completedUsers: 7,
        avgDaily30dActiveUsersPerRequest: 2.5
      },
      composition: {
        brands: [{ label: '<b>Brand A</b>', orderedShifts: 120, sharePercent: 100 }],
        professions: [{ label: 'Комплектовщик', orderedShifts: 120, sharePercent: 100 }],
        rateBuckets: [{ label: '250-350', orderedShifts: 120, sharePercent: 100, avgSalaryPerHour: 310 }]
      },
      dynamics: [{
        period: '2026-06-01',
        orderedShifts: 120,
        appActiveUsers: 18,
        bookedUsers: 11,
        completedUsers: 7,
        activeUsersPerRequest: 2.5
      }]
    }
  });

  assert.match(html, /Анализ городов/);
  assert.match(html, /class="nav-link active" href="\/dashboards\/city-analysis"/);
  assert.match(html, /Баланс спроса и базы/);
  assert.match(html, /Заказ/);
  assert.match(html, /120/);
  assert.match(html, /Не удаленные заявки/);
  assert.match(html, /Общая база/);
  assert.match(html, /Активная база/);
  assert.match(html, /Входили в приложение/);
  assert.match(html, /Откликались/);
  assert.match(html, /Завершали/);
  assert.match(html, /30д активные \/ заявка/);
  assert.match(html, /Состав заказа/);
  assert.match(html, /Динамика/);
  assert.match(html, /value="2026-06-01"/);
  assert.match(html, /value="250"/);
  assert.match(html, /value="450"/);
  assert.match(html, /<option value="&lt;script&gt;Москва&lt;\/script&gt;" selected>/);
  assert.match(html, /<input type="checkbox" name="client" value="Brand A" checked data-multi-filter-checkbox>/);
  assert.match(html, /<input id="includeDeletedOrders" name="includeDeletedOrders" type="checkbox" value="1" checked>/);
  assert.match(html, /&lt;b&gt;Brand A&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<script>Москва<\/script>/);
  assert.doesNotMatch(html, /<b>Brand A<\/b>/);
});

test('renderCityAnalysisDashboard shows empty city and missing coordinate states', () => {
  const noCityHtml = renderCityAnalysisDashboard({
    database: 'etl',
    dashboard: {
      filters: {
        from: '2026-06-01',
        to: '2026-06-03',
        city: '',
        client: [],
        profession: [],
        orderType: [],
        jobStatus: [],
        contractor: [],
        salaryFrom: null,
        salaryTo: null,
        includeDeletedOrders: false,
        includeHiddenOrders: false
      },
      filterOptions: {
        city: ['Москва'],
        client: [],
        profession: [],
        orderType: [],
        jobStatus: [],
        contractor: []
      },
      context: { hasCity: false, hasCityCoordinates: false, periodLabel: '2026-06-01 - 2026-06-03' },
      summary: {
        orderedShifts: 0,
        activeOrderRequests: 0,
        totalLocatedUsers: 0,
        readyLocatedUsers: 0,
        appActiveUsers: 0,
        bookedUsers: 0,
        completedUsers: 0,
        avgDaily30dActiveUsersPerRequest: 0
      },
      composition: { brands: [], professions: [], rateBuckets: [] },
      dynamics: []
    }
  });

  assert.match(noCityHtml, /Выберите город для анализа/);

  const noCoordinatesHtml = renderCityAnalysisDashboard({
    database: 'etl',
    dashboard: {
      filters: {
        from: '2026-06-01',
        to: '2026-06-03',
        city: 'Москва',
        client: [],
        profession: [],
        orderType: [],
        jobStatus: [],
        contractor: [],
        salaryFrom: null,
        salaryTo: null,
        includeDeletedOrders: false,
        includeHiddenOrders: false
      },
      filterOptions: {
        city: ['Москва'],
        client: [],
        profession: [],
        orderType: [],
        jobStatus: [],
        contractor: []
      },
      context: { hasCity: true, hasCityCoordinates: false, periodLabel: '2026-06-01 - 2026-06-03' },
      summary: {
        orderedShifts: 0,
        activeOrderRequests: 0,
        totalLocatedUsers: 0,
        readyLocatedUsers: 0,
        appActiveUsers: 0,
        bookedUsers: 0,
        completedUsers: 0,
        avgDaily30dActiveUsersPerRequest: 0
      },
      composition: { brands: [], professions: [], rateBuckets: [] },
      dynamics: []
    }
  });

  assert.match(noCoordinatesHtml, /Нет координат точек для расчета базы в радиусе 15 км/);
});
```

- [ ] **Step 2: Run render tests to verify they fail**

Run:

```bash
npm test -- test/render.test.js
```

Expected: FAIL with `renderCityAnalysisDashboard is not a function` or missing navigation assertion.

- [ ] **Step 3: Add city navigation and renderer helpers**

In `src/render.js`, add a new nav item inside `layout` after "Анализ точек":

```js
        ${navLink({
          href: '/dashboards/city-analysis',
          label: 'Анализ городов',
          id: 'city-analysis',
          activeNav
        })}
```

Add these helper functions before `renderWorkplaceAnalysisDashboard`:

```js
function renderCityOptions(options, selectedCity) {
  const selected = String(selectedCity || '');
  const items = ['']
    .concat(options || [])
    .map((value) => {
      const text = String(value || '');
      const label = text === '' ? 'Выберите город' : text;
      const selectedAttribute = text === selected ? ' selected' : '';

      return `<option value="${escapeHtml(text)}"${selectedAttribute}>${escapeHtml(label)}</option>`;
    });

  return items.join('');
}

function cityAnalysisParam(params, name, value) {
  if (value === null || typeof value === 'undefined') {
    return;
  }

  const text = String(value).trim();

  if (text !== '') {
    params.append(name, text);
  }
}

function renderCityKpis(summary) {
  const cards = [
    ['Заказ', formatNumber(summary.orderedShifts)],
    ['Не удаленные заявки', formatNumber(summary.activeOrderRequests)],
    ['Общая база', formatNumber(summary.totalLocatedUsers)],
    ['Активная база', formatNumber(summary.readyLocatedUsers)],
    ['Входили в приложение', formatNumber(summary.appActiveUsers)],
    ['Откликались', formatNumber(summary.bookedUsers)],
    ['Завершали', formatNumber(summary.completedUsers)],
    ['30д активные / заявка', formatNumber(summary.avgDaily30dActiveUsersPerRequest, 2)]
  ];

  return `<div class="kpi-grid">${cards.map(([label, value]) => `<div class="kpi-card">
  <div class="kpi-label">${escapeHtml(label)}</div>
  <div class="kpi-value">${escapeHtml(value)}</div>
</div>`).join('')}</div>`;
}

function renderCityCompositionPanel(title, rows) {
  const maxValue = Math.max(0, ...rows.map((row) => Number(row.orderedShifts) || 0));

  return renderMiniChart({
    title,
    rows,
    maxValue,
    valueForRow: (row) => row.orderedShifts,
    labelForRow: (row) => row.label,
    textForRow: (row) => `${formatNumber(row.orderedShifts)} · ${formatPercent(row.sharePercent)}`
  });
}

function renderRateBucketText(row) {
  return `${formatNumber(row.orderedShifts)} · ${formatPercent(row.sharePercent)} · ср. ${formatNumber(row.avgSalaryPerHour, 0)}`;
}

function renderCityDynamics(dynamics) {
  const maxValue = Math.max(
    0,
    ...dynamics.map((row) => Number(row.orderedShifts) || 0),
    ...dynamics.map((row) => Number(row.appActiveUsers) || 0)
  );

  return renderMiniChart({
    title: 'Динамика',
    rows: dynamics,
    maxValue,
    valueForRow: (row) => Math.max(Number(row.orderedShifts) || 0, Number(row.appActiveUsers) || 0),
    labelForRow: (row) => row.period,
    textForRow: (row) => [
      `заказ ${formatNumber(row.orderedShifts)}`,
      `входы ${formatNumber(row.appActiveUsers)}`,
      `отклик ${formatNumber(row.bookedUsers)}`,
      `завершали ${formatNumber(row.completedUsers)}`,
      `акт/заявка ${formatNumber(row.activeUsersPerRequest, 2)}`
    ].join(' · ')
  });
}
```

Add `renderCityAnalysisDashboard` before `renderError`:

```js
function renderCityAnalysisDashboard({ database, dashboard }) {
  const filters = dashboard.filters;
  const context = dashboard.context;
  const noCityMessage = context.hasCity ? '' : '<p class="empty">Выберите город для анализа.</p>';
  const noCoordinatesMessage = context.hasCity && !context.hasCityCoordinates
    ? '<p class="empty">Нет координат точек для расчета базы в радиусе 15 км.</p>'
    : '';
  const content = `<section class="section">
  <h1>Анализ городов</h1>
  <p class="technical-note">Баланс спроса и базы считается для одного выбранного города. База - пользователи с последней локацией не дальше 15 км от любой точки города.</p>
  <p class="context-line">Период: ${escapeHtml(context.periodLabel)}</p>
</section>
<section class="section">
  <form class="filter-bar" action="/dashboards/city-analysis" method="get">
    <div class="field filter-field">
      <label for="city">Город</label>
      <select id="city" name="city">${renderCityOptions(dashboard.filterOptions.city, filters.city)}</select>
    </div>
    <div class="field">
      <label for="from">С</label>
      <input id="from" name="from" type="date" value="${escapeHtml(filters.from)}">
    </div>
    <div class="field">
      <label for="to">По</label>
      <input id="to" name="to" type="date" value="${escapeHtml(filters.to)}">
    </div>
    ${renderMultiSelectField({
      id: 'client',
      label: 'Бренд',
      options: filterOptions(dashboard, 'client'),
      selected: filters.client
    })}
    ${renderMultiSelectField({
      id: 'profession',
      label: 'Профессия',
      options: filterOptions(dashboard, 'profession'),
      selected: filters.profession
    })}
    ${renderMultiSelectField({
      id: 'orderType',
      label: 'Тип заказа',
      options: filterOptions(dashboard, 'orderType'),
      selected: filters.orderType,
      labelForValue: orderTypeLabel
    })}
    ${renderMultiSelectField({
      id: 'jobStatus',
      label: 'Статус задания',
      options: filterOptions(dashboard, 'jobStatus'),
      selected: filters.jobStatus
    })}
    ${renderMultiSelectField({
      id: 'contractor',
      label: 'Контрагент',
      options: filterOptions(dashboard, 'contractor'),
      selected: filters.contractor
    })}
    <div class="field metric-range-field">
      <label for="salaryFrom">Ставка от</label>
      <input id="salaryFrom" name="salaryFrom" type="number" min="0" step="1" value="${escapeHtml(rangeFilterValue(filters.salaryFrom))}">
    </div>
    <div class="field metric-range-field">
      <label for="salaryTo">Ставка до</label>
      <input id="salaryTo" name="salaryTo" type="number" min="0" step="1" value="${escapeHtml(rangeFilterValue(filters.salaryTo))}">
    </div>
    ${renderCheckboxField({
      id: 'includeDeletedOrders',
      label: 'Учитывать удаленные',
      checked: filters.includeDeletedOrders
    })}
    ${renderCheckboxField({
      id: 'includeHiddenOrders',
      label: 'Учитывать скрытые',
      checked: filters.includeHiddenOrders
    })}
    <button type="submit">Применить</button>
  </form>
</section>
<section class="section">
  <h2>Баланс спроса и базы</h2>
  ${noCityMessage}
  ${noCoordinatesMessage}
  ${renderCityKpis(dashboard.summary)}
</section>
<section class="section">
  <div class="detail-grid">
    ${renderCityDynamics(dashboard.dynamics)}
    ${renderCityCompositionPanel('Бренды', dashboard.composition.brands)}
    ${renderCityCompositionPanel('Профессии', dashboard.composition.professions)}
    ${renderMiniChart({
      title: 'Ставки',
      rows: dashboard.composition.rateBuckets,
      maxValue: Math.max(0, ...dashboard.composition.rateBuckets.map((row) => Number(row.orderedShifts) || 0)),
      valueForRow: (row) => row.orderedShifts,
      labelForRow: (row) => row.label,
      textForRow: renderRateBucketText,
      secondary: true
    })}
  </div>
</section>`;

  return layout({
    title: 'Анализ городов',
    database,
    content,
    activeNav: 'city-analysis'
  });
}
```

Export it in `module.exports`:

```js
module.exports = {
  escapeHtml,
  renderCityAnalysisDashboard,
  renderError,
  renderHome,
  renderSalesByProjectDashboard,
  renderTable,
  renderWorkplaceAnalysisDashboard,
  renderWorkplacePointDashboard
};
```

- [ ] **Step 4: Run render tests**

Run:

```bash
npm test -- test/render.test.js
```

Expected: PASS for `test/render.test.js`.

- [ ] **Step 5: Commit**

```bash
git add src/render.js test/render.test.js
git commit -m "feat: render city analysis dashboard"
```

### Task 4: Server Route

**Files:**
- Modify: `src/server.js`
- Modify: `test/server.test.js`

- [ ] **Step 1: Add failing server tests**

In `test/server.test.js`, extend `createFakeClient().queryJSONEachRow` with city operations:

```js
      if (operation === 'city analysis city options') {
        return [{ city: 'Москва' }];
      }

      if (operation === 'city analysis filter options') {
        return [
          { filter: 'client', value: 'Бренд' },
          { filter: 'profession', value: 'Комплектовщик' },
          { filter: 'orderType', value: 'regular' },
          { filter: 'jobStatus', value: 'confirmed' },
          { filter: 'contractor', value: 'Ромашка' }
        ];
      }

      if (operation === 'city analysis city coordinates') {
        return [{ workplace_id: 'wp1' }];
      }

      if (operation === 'city analysis summary') {
        return [{
          ordered_shifts: 10,
          active_order_requests: 3,
          total_located_users: 12,
          ready_located_users: 8,
          app_active_users: 6,
          booked_users: 4,
          completed_users: 2,
          avg_daily_30d_active_users_per_request: 2
        }];
      }

      if (operation === 'city analysis brands') {
        return [{ label: 'Бренд', ordered_shifts: 10 }];
      }

      if (operation === 'city analysis professions') {
        return [{ label: 'Комплектовщик', ordered_shifts: 10 }];
      }

      if (operation === 'city analysis rate buckets') {
        return [{ label: '250-350', ordered_shifts: 10, avg_salary_per_hour: 300 }];
      }

      if (operation === 'city analysis dynamics') {
        return [{ period: '2026-06-01', ordered_shifts: 10, app_active_users: 6, booked_users: 4, completed_users: 2, active_users_per_request: 2 }];
      }
```

Append these tests to `test/server.test.js`:

```js
test('GET /dashboards/city-analysis renders dashboard with query filters', async () => {
  const client = createFakeClient();

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(
      baseUrl,
      '/dashboards/city-analysis?from=2026-06-01&to=2026-06-03&city=Москва&client=Бренд&profession=Комплектовщик&orderType=regular&jobStatus=confirmed&contractor=Ромашка&salaryFrom=250&salaryTo=450'
    );

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html\b/);
    assert.match(text, /Анализ городов/);
    assert.match(text, /Баланс спроса и базы/);
    assert.match(text, /Общая база/);
  });

  const cityCalls = client.calls.filter((call) =>
    call[0] === 'queryJSONEachRow' && String(call[1]).startsWith('city analysis')
  );

  assert.equal(cityCalls.length, 8);
  assert.deepEqual(cityCalls.map((call) => call[1]), [
    'city analysis city options',
    'city analysis filter options',
    'city analysis city coordinates',
    'city analysis summary',
    'city analysis brands',
    'city analysis professions',
    'city analysis rate buckets',
    'city analysis dynamics'
  ]);

  const cityFilterOptionsCall = cityCalls.find((call) => call[1] === 'city analysis filter options');

  assert.equal(cityFilterOptionsCall[2].param_city, 'Москва');
  assert.equal(Object.prototype.hasOwnProperty.call(cityFilterOptionsCall[2], 'param_clients'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(cityFilterOptionsCall[2], 'param_professions'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(cityFilterOptionsCall[2], 'param_order_types'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(cityFilterOptionsCall[2], 'param_job_statuses'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(cityFilterOptionsCall[2], 'param_contractors'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(cityFilterOptionsCall[2], 'param_salary_from'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(cityFilterOptionsCall[2], 'param_salary_to'), false);

  for (const call of cityCalls.slice(2)) {
    assert.equal(call[2].param_city, 'Москва');
    assert.equal(call[2].param_clients, "['Бренд']");
    assert.equal(call[2].param_professions, "['Комплектовщик']");
    assert.equal(call[2].param_order_types, "['regular']");
    assert.equal(call[2].param_job_statuses, "['confirmed']");
    assert.equal(call[2].param_contractors, "['Ромашка']");
    assert.equal(call[2].param_salary_from, 250);
    assert.equal(call[2].param_salary_to, 450);
  }
});

test('GET /dashboards/city-analysis keeps navigation active on upstream errors', async () => {
  const client = createFakeClient({
    async queryJSONEachRow(query, params, operation) {
      throw new Error(`${operation} failed with super-secret`);
    }
  });

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(baseUrl, '/dashboards/city-analysis?city=Москва');

    assert.equal(response.status, 502);
    assert.match(text, /Upstream Error/);
    assert.match(text, /class="nav-link active" href="\/dashboards\/city-analysis"/);
    assert.doesNotMatch(text, /super-secret/);
  });
});

test('activeNavForPath recognizes city analysis route', () => {
  assert.equal(activeNavForPath('/dashboards/city-analysis'), 'city-analysis');
  assert.equal(activeNavForPath('/dashboards/city-analysis/'), 'city-analysis');
});
```

- [ ] **Step 2: Run server tests to verify they fail**

Run:

```bash
npm test -- test/server.test.js
```

Expected: FAIL because `/dashboards/city-analysis` returns 404 or active nav does not recognize the route.

- [ ] **Step 3: Add server route**

Modify imports in `src/server.js`:

```js
const { loadCityAnalysisDashboard } = require('./cityAnalysisDashboard');
```

Add `renderCityAnalysisDashboard` to the renderer destructuring:

```js
  renderCityAnalysisDashboard,
```

Update `activeNavForPath`:

```js
  const navByPath = {
    '/dashboards/city-analysis': 'city-analysis',
    '/dashboards/sales-by-project': 'sales-by-project',
    '/dashboards/workplace-analysis': 'workplace-analysis'
  };
```

Add route after `/dashboards/workplace-analysis`:

```js
  app.get(
    '/dashboards/city-analysis',
    asyncRoute(async (req, res) => {
      const dashboard = await loadCityAnalysisDashboard(client, req.query);

      res
        .status(200)
        .type('html')
        .send(renderCityAnalysisDashboard({ database, dashboard }));
    })
  );
```

- [ ] **Step 4: Run server tests**

Run:

```bash
npm test -- test/server.test.js
```

Expected: PASS for `test/server.test.js`.

- [ ] **Step 5: Commit**

```bash
git add src/server.js test/server.test.js
git commit -m "feat: add city analysis route"
```

### Task 5: Documentation And Full Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add failing README route assertion**

Add this assertion to the existing `renderHome includes city analysis navigation` test in `test/render.test.js`:

```js
  assert.match(html, /href="\/dashboards\/city-analysis"/);
```

This already passes after Task 3. The documentation step still needs a final full-suite check.

- [ ] **Step 2: Update README dashboard list**

Modify `README.md` dashboard list to include:

```md
- `http://localhost:3000/dashboards/city-analysis` - дашборд `Анализ городов`.
```

Add one sentence to the dashboard description paragraph:

```md
В `Анализе городов` город выбирается как город точки заказа, а база исполнителей считается по последней локации пользователя в радиусе 15 км от любой точки выбранного города.
```

- [ ] **Step 3: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS for all tests.

- [ ] **Step 4: Start the local app**

Run:

```bash
npm start
```

Expected: server logs `ETL Analytics listening on port 3000`. If port 3000 is occupied, run with a different `PORT` in the shell:

```bash
$env:PORT='3001'; npm start
```

- [ ] **Step 5: Manually verify the page**

Open:

```text
http://localhost:3000/dashboards/city-analysis
```

Expected:

- The page shows "Анализ городов".
- The city selector is visible.
- Without a selected city it shows `Выберите город для анализа`.
- After selecting a city and applying filters, the page shows "Баланс спроса и базы".
- No personal data such as phone, email, name, passport data, INN, or SNILS is rendered.

- [ ] **Step 6: Commit**

```bash
git add README.md test/render.test.js
git commit -m "docs: document city analysis dashboard"
```

## Self-Review

Spec coverage:

- One selected city: Task 1 normalization, Task 3 city `<select>`, Task 4 route.
- Filters analogous to "Анализ точек": Task 1 filter model, Task 2 safe query params, Task 3 filter UI.
- Demand as `sum(mg_orders.amount)`: Task 2 `filtered_orders` and `summaryQuery`.
- Non-deleted request count: Task 2 `is_active_request` and denominator tests.
- Geographic total base within 15 km of any city point: Task 2 `cityWorkplacesCte`, `locatedUsersCte`, and loader tests.
- Active base `ready/booked/worked`: Task 2 `locatedUsersCte` and summary query.
- App activity via `appmetrica_sessions`: Task 2 `appActiveUsersCte`, dynamics query, and tests.
- Responded users via `mg_job_history.status = 'booked'`: Task 2 `bookedUsersCte` and tests.
- Completed users via `mg_jobs.status = 'confirmed'`: Task 2 `completedUsersCte` and tests.
- 30-day active users per request: Task 2 `daily30dRatioCte` and denominator tests.
- Composition by brands, professions, rates: Task 2 composition queries, Task 3 render panels.
- One-screen balance-centered UI: Task 3 `renderCityAnalysisDashboard`.
- Empty states: Task 1 no-city model, Task 3 empty state rendering.
- No arbitrary SQL: Task 2 parameterization and whitelist buckets.
- PII avoidance: Task 3 only aggregate values, Task 5 manual verification.

Placeholder scan:

- No forbidden placeholder markers or vague implementation steps are present.

Type consistency:

- `totalLocatedUsers`, `readyLocatedUsers`, `appActiveUsers`, `bookedUsers`, `completedUsers`, and `avgDaily30dActiveUsersPerRequest` are used consistently across model, tests, and renderer.
