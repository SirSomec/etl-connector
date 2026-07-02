# Workplace Point Year Heatmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a current-year daily heatmap above the existing point calendar without creating page-level horizontal scroll.

**Architecture:** Extend the existing Express/server-rendered workplace point dashboard with a new progressive section `year-heatmap`. The section reuses the point daily SQL, but normalizes dates to the current calendar year and renders a dedicated month-wrapped heatmap grid instead of the existing horizontally scrollable `.heatmap`.

**Tech Stack:** Node.js `node:test`, Express, server-rendered HTML in `src/render.js`, ClickHouse SQL templates in `src/workplacePointDashboard.js`.

---

## File Structure

- Modify `src/workplacePointDashboard.js`: add current-year filter normalization, `year-heatmap` section loading, cache-key behavior, and `yearHeatmapRows` model mapping.
- Modify `src/render.js`: add non-scroll year heatmap CSS and renderer; place it above `renderPointCalendar(...)`.
- Modify `src/sqlMetricInfo.js`: add SQL-info metadata for `workplace-point.charts.year-heatmap`.
- Modify `test/workplacePointDashboard.test.js`: add TDD coverage for year range, cache key, and section loader.
- Modify `test/render.test.js`: add TDD coverage for placement, month markers, SQL inspector id, and CSS without `overflow-x:auto`.
- Modify `docs/dashboards/workplace-point.md`: document the new current-year section after implementation.

## Task 1: Data Model And Section Loader

**Files:**
- Modify: `test/workplacePointDashboard.test.js`
- Modify: `src/workplacePointDashboard.js`

- [ ] **Step 1: Write failing tests for current-year filters**

Add imports:

```js
const {
  WORKPLACE_POINT_SECTIONS,
  cacheKeyForWorkplacePointSection,
  loadWorkplacePointDashboard,
  loadWorkplacePointDashboardSection,
  loadWorkplacePointDashboardShell,
  loadWorkplacePointDayDetails,
  loadWorkplacePointGigerDetails,
  loadWorkplacePointReviews,
  mergeWorkplacePointDayDetails,
  mergeWorkplacePointReviews,
  mergeWorkplacePointRows,
  normalizeWorkplacePointGigerDetailsInput,
  normalizeWorkplacePointDayDetailsInput,
  normalizeWorkplacePointReviewsInput,
  normalizeWorkplacePointFilters,
  normalizeWorkplacePointYearHeatmapFilters
} = require('../src/workplacePointDashboard');
```

Add this test:

```js
test('normalizeWorkplacePointYearHeatmapFilters uses the current full year and ignores selected dates', () => {
  const filters = normalizeWorkplacePointYearHeatmapFilters(
    {
      workplaceId: ' wp1 ',
      from: '2026-06-01',
      to: '2026-06-30',
      profession: ['picker', 'driver'],
      orderType: 'regular',
      jobStatus: 'confirmed',
      includeHiddenOrders: '1'
    },
    new Date('2026-07-02T12:00:00.000Z')
  );

  assert.equal(filters.workplaceId, 'wp1');
  assert.equal(filters.from, '2026-01-01');
  assert.equal(filters.to, '2026-12-31');
  assert.equal(filters.fromDateTime, '2026-01-01 00:00:00');
  assert.equal(filters.toExclusiveDateTime, '2027-01-01 00:00:00');
  assert.equal(filters.rangeDays, 365);
  assert.deepEqual(filters.profession, ['picker', 'driver']);
  assert.deepEqual(filters.orderType, ['regular']);
  assert.deepEqual(filters.jobStatus, ['confirmed']);
  assert.equal(filters.includeHiddenOrders, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- test/workplacePointDashboard.test.js
```

Expected: FAIL because `normalizeWorkplacePointYearHeatmapFilters` and `WORKPLACE_POINT_SECTIONS` export are not available yet.

- [ ] **Step 3: Implement current-year normalization and section registration**

In `src/workplacePointDashboard.js`:

```js
const WORKPLACE_POINT_SECTION_NAMES = ['summary', 'year-heatmap', 'charts', 'radius'];
```

Add helpers near `firstDayOfMonthUTC`:

```js
function firstDayOfYearUTC(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
}

function lastDayOfYearUTC(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), 11, 31));
}
```

Add normalizer after `normalizeWorkplacePointFilters`:

```js
function normalizeWorkplacePointYearHeatmapFilters(input = {}, now = new Date()) {
  const filters = normalizeWorkplacePointFilters(input, now);
  const today = parseDateOnly(formatDateUTC(now));
  const fromDate = firstDayOfYearUTC(today);
  const toDate = lastDayOfYearUTC(today);
  const from = formatDateUTC(fromDate);
  const to = formatDateUTC(toDate);
  const toExclusive = formatDateUTC(addDaysUTC(toDate, 1));

  return {
    ...filters,
    from,
    to,
    fromDateTime: toDateTimeParam(from),
    toExclusiveDateTime: toDateTimeParam(toExclusive),
    rangeDays: buildDateKeys(from, to).length
  };
}
```

Export `WORKPLACE_POINT_SECTIONS`, `cacheKeyForWorkplacePointSection`, and `normalizeWorkplacePointYearHeatmapFilters`.

- [ ] **Step 4: Run tests and fix only the expected new failures**

Run:

```bash
npm test -- test/workplacePointDashboard.test.js
```

Expected: the new normalization test passes; later loader tests are not written yet.

## Task 2: Year Section Query And Cache Key

**Files:**
- Modify: `test/workplacePointDashboard.test.js`
- Modify: `src/workplacePointDashboard.js`

- [ ] **Step 1: Write failing section loader tests**

Add tests:

```js
test('cacheKeyForWorkplacePointSection keeps year heatmap independent from selected dates', () => {
  const first = normalizeWorkplacePointYearHeatmapFilters(
    { workplaceId: 'wp1', from: '2026-06-01', to: '2026-06-30', profession: 'picker' },
    new Date('2026-07-02T12:00:00.000Z')
  );
  const second = normalizeWorkplacePointYearHeatmapFilters(
    { workplaceId: 'wp1', from: '2026-02-01', to: '2026-02-28', profession: 'picker' },
    new Date('2026-07-02T12:00:00.000Z')
  );

  assert.equal(
    cacheKeyForWorkplacePointSection('year-heatmap', first),
    cacheKeyForWorkplacePointSection('year-heatmap', second)
  );
  assert.notEqual(
    cacheKeyForWorkplacePointSection('year-heatmap', first),
    cacheKeyForWorkplacePointSection('charts', first)
  );
});

test('loadWorkplacePointDashboardSection loads year heatmap with current-year parameters', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'workplace point year heatmap') {
        return [{ period: '2026-01-02', ordered_shifts: 5, completed_shifts: 3 }];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  };

  const dashboard = await loadWorkplacePointDashboardSection(
    client,
    {
      workplaceId: 'wp1',
      from: '2026-06-01',
      to: '2026-06-30',
      profession: 'picker'
    },
    'year-heatmap',
    new Date('2026-07-02T12:00:00.000Z')
  );

  assert.equal(WORKPLACE_POINT_SECTIONS.has('year-heatmap'), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].operation, 'workplace point year heatmap');
  assert.equal(calls[0].params.param_from, '2026-01-01 00:00:00');
  assert.equal(calls[0].params.param_to, '2027-01-01 00:00:00');
  assert.equal(calls[0].params.param_professions, "['picker']");
  assert.equal(dashboard.filters.from, '2026-01-01');
  assert.equal(dashboard.filters.to, '2026-12-31');
  assert.deepEqual(dashboard.yearHeatmapRows, [
    {
      period: '2026-01-02',
      orderedShifts: 5,
      completedShifts: 3,
      slaPercent: 60,
      forecastSlaActiveShifts: 0,
      forecastSlaPercent: 0,
      dropoffs24h: 0,
      orderLeadAvgMinutes: null,
      orderLeadMinMinutes: null
    }
  ]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- test/workplacePointDashboard.test.js
```

Expected: FAIL because `year-heatmap` is not routed in `loadWorkplacePointSectionRows` and `yearHeatmapRows` is not mapped.

- [ ] **Step 3: Implement section query and row mapping**

Extract daily row mapping:

```js
function mapWorkplacePointDailyRow(row) {
  const dailyOrderedShifts = numberValue(row.ordered_shifts);
  const dailyCompletedShifts = numberValue(row.completed_shifts);
  const dailyForecastSlaActiveShifts = numberValue(row.forecast_sla_active_shifts);

  return {
    period: String(row.period || ''),
    orderedShifts: dailyOrderedShifts,
    completedShifts: dailyCompletedShifts,
    slaPercent: percent(dailyCompletedShifts, dailyOrderedShifts),
    forecastSlaActiveShifts: dailyForecastSlaActiveShifts,
    forecastSlaPercent: percent(dailyForecastSlaActiveShifts, dailyOrderedShifts),
    dropoffs24h: numberValue(row.dropoffs_24h),
    orderLeadAvgMinutes: nullableNumberValue(row.avg_order_lead_minutes),
    orderLeadMinMinutes: nullableNumberValue(row.min_order_lead_minutes)
  };
}
```

Use it for both `dailyRows` and `yearHeatmapRows` in `mergeWorkplacePointRows`:

```js
const dailyRows = (datasets.dailyRows || []).map(mapWorkplacePointDailyRow);
const yearHeatmapRows = (datasets.yearHeatmapRows || []).map(mapWorkplacePointDailyRow);
```

Return `yearHeatmapRows` in the dashboard object.

In `loadWorkplacePointSectionRows`, route the new section:

```js
if (section === 'year-heatmap') {
  const yearHeatmapRows = await client.queryJSONEachRow(
    dailyQuery(whereSql),
    params,
    'workplace point year heatmap'
  );

  return { yearHeatmapRows };
}
```

In `loadWorkplacePointDashboardSection`, choose filters by section:

```js
const filters = section === 'year-heatmap'
  ? normalizeWorkplacePointYearHeatmapFilters(input, now)
  : normalizeWorkplacePointFilters(input, now);
```

- [ ] **Step 4: Run data tests**

Run:

```bash
npm test -- test/workplacePointDashboard.test.js
```

Expected: PASS for the new data tests and existing point tests.

## Task 3: Render Year Heatmap Above Calendar

**Files:**
- Modify: `test/render.test.js`
- Modify: `src/render.js`

- [ ] **Step 1: Write failing render test**

Add a render test that builds a point dashboard with `yearHeatmapRows` and `dailyRows`:

```js
test('renderWorkplacePointDashboard renders year heatmap above calendar without horizontal page scroll', () => {
  const html = renderWorkplacePointDashboard({
    database: 'etl',
    dashboard: {
      filters: {
        workplaceId: 'wp1',
        from: '2026-06-01',
        to: '2026-06-30',
        currentDate: '2026-07-02',
        profession: [],
        orderType: [],
        jobStatus: [],
        includeDeletedOrders: false,
        includeHiddenOrders: false
      },
      currentDate: '2026-07-02',
      point: {
        workplaceId: 'wp1',
        title: 'Point',
        clientTitle: 'Brand',
        city: 'Moscow',
        region: 'Moscow',
        address: 'Moscow, Street'
      },
      summary: {},
      filterOptions: { profession: [], orderType: [], jobStatus: [] },
      yearHeatmapRows: [
        { period: '2026-01-01', orderedShifts: 3, completedShifts: 2 },
        { period: '2026-02-01', orderedShifts: 8, completedShifts: 6 },
        { period: '2026-07-02', orderedShifts: 0, completedShifts: 0 }
      ],
      dailyRows: [
        { period: '2026-06-01', orderedShifts: 1, completedShifts: 1, slaPercent: 100, forecastSlaPercent: 0, dropoffs24h: 0 }
      ],
      professionRows: []
    }
  });

  const yearStart = html.indexOf('class="detail-panel year-heatmap-panel"');
  const calendarStart = html.indexOf('class="detail-panel calendar-panel"');

  assert.ok(yearStart > -1);
  assert.ok(calendarStart > yearStart);
  assert.match(html, /data-sql-inspector-open="workplace-point\.charts\.year-heatmap"/);
  assert.match(html, /class="point-year-heatmap-month-label">Янв<\/div>/);
  assert.match(html, /class="point-year-heatmap-month-label">Фев<\/div>/);
  assert.match(html, /<span class="point-year-heatmap-cell is-current-day" data-date="2026-07-02" data-level="0" aria-current="date"/);
  assert.match(html, /\.point-year-heatmap-months\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(96px,\s*1fr\)\);[\s\S]*?\.point-year-heatmap-grid\s*\{[^}]*grid-template-columns:\s*repeat\(7,\s*minmax\(0,\s*1fr\)\);/);
  assert.doesNotMatch(html, /\.point-year-heatmap[\s\S]{0,260}overflow-x:\s*auto/);
});
```

- [ ] **Step 2: Run render test to verify it fails**

Run:

```bash
npm test -- test/render.test.js
```

Expected: FAIL because the year heatmap classes and metric id do not exist yet.

- [ ] **Step 3: Implement CSS and renderer**

Add CSS near the point calendar styles:

```css
.year-heatmap-panel {
  grid-column: 1 / -1;
}

.point-year-heatmap {
  display: grid;
  gap: 10px;
  max-width: 100%;
  overflow: hidden;
}

.point-year-heatmap-months {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
  gap: 8px;
  min-width: 0;
}

.point-year-heatmap-month {
  min-width: 0;
  padding-left: 7px;
  border-left: 1px solid var(--line);
}

.point-year-heatmap-month-label {
  margin-bottom: 5px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 700;
  line-height: 1.2;
}

.point-year-heatmap-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 3px;
  min-width: 0;
}

.point-year-heatmap-cell {
  min-width: 0;
  aspect-ratio: 1 / 1;
  border-radius: 2px;
  background: #e5e7eb;
}

.point-year-heatmap-cell[data-level="1"] { background: #bfdbfe; }
.point-year-heatmap-cell[data-level="2"] { background: #60a5fa; }
.point-year-heatmap-cell[data-level="3"] { background: #2563eb; }
.point-year-heatmap-cell[data-level="4"] { background: #1d4ed8; }

.point-year-heatmap-cell.is-current-day {
  outline: 2px solid #111827;
  outline-offset: 1px;
}
```

Add render helpers near point calendar helpers:

```js
function shortMonthLabelFromDateKey(value) {
  const labels = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
  const date = new Date(`${value}T00:00:00.000Z`);

  return Number.isNaN(date.getTime()) ? String(value || '') : labels[date.getUTCMonth()];
}

function yearRangeFromCurrentDateValue(currentDateValue) {
  const currentDateKey = currentDateKeyFromValue(currentDateValue) || currentDateKeyFromValue(new Date());
  const year = Number((currentDateKey || '').slice(0, 4));

  if (!Number.isInteger(year)) {
    return { from: '', to: '' };
  }

  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

function yearHeatmapLevel(value, maxValue) {
  const amount = Number(value) || 0;
  const max = Number(maxValue) || 0;

  if (amount <= 0 || max <= 0) return 0;
  if (amount / max <= 0.25) return 1;
  if (amount / max <= 0.5) return 2;
  if (amount / max <= 0.75) return 3;
  return 4;
}
```

Create `renderPointYearHeatmap(rows, currentDateValue, currentUser)` that fills every day in `yearRangeFromCurrentDateValue`, groups by month, renders `.point-year-heatmap-month-label`, and wraps content with:

```js
renderMetricInfoScope({
  className: 'metric-visual-output',
  metricId: 'workplace-point.charts.year-heatmap',
  currentUser,
  content: `<div class="point-year-heatmap" aria-label="Дневная тепловая лента заказа за текущий год">${months}</div>`
})
```

In `renderWorkplacePointCharts`, place it above `renderPointCalendar(...)`:

```js
${renderPointYearHeatmap(dashboard.yearHeatmapRows || [], dashboard.currentDate, currentUser)}
${renderPointCalendar(dashboard.dailyRows, dashboard.filters, dashboard.currentDate, currentUser)}
```

- [ ] **Step 4: Run render tests**

Run:

```bash
npm test -- test/render.test.js
```

Expected: PASS for the new render test and existing render tests.

## Task 4: SQL-info And Docs

**Files:**
- Modify: `src/sqlMetricInfo.js`
- Modify: `docs/dashboards/workplace-point.md`
- Test: `test/render.test.js`
- Test: `test/sqlMetricInfo.test.js`

- [ ] **Step 1: Add failing SQL-info assertion if existing tests do not cover it**

If no test checks the registry directly, add a render assertion in the Task 3 test:

```js
assert.match(html, /data-sql-inspector-open="workplace-point\.charts\.year-heatmap"/);
```

- [ ] **Step 2: Add metadata**

In the `workplace-point.charts` SQL-info group, add:

```js
{ id: 'workplace-point.charts.year-heatmap', title: 'Годовая лента точки: заказ', description: 'Дневная тепловая лента планового заказа выбранной точки за текущий год.', sql: WORKPLACE_POINT_DAILY_SQL },
```

- [ ] **Step 3: Document the dashboard**

In `docs/dashboards/workplace-point.md`, add a short section after `SQL: daily` explaining that the `year-heatmap` section reuses the daily query with the current-year date range and ignores user `from/to`.

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- test/workplacePointDashboard.test.js test/render.test.js test/sqlMetricInfo.test.js
```

Expected: PASS.

## Task 5: Full Verification

**Files:**
- No code edits.

- [ ] **Step 1: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 2: Inspect git diff**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only intended files changed.
