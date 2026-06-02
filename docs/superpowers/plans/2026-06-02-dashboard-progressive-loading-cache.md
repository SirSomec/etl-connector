# Dashboard Progressive Loading And Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make current dashboards render shells quickly, load heavy dashboard blocks as independent fragments, and add new 10-hour caches only where cache is missing.

**Architecture:** Keep Express and server-rendered HTML. Add a generic dashboard section cache, split dashboard loaders into shell/section functions, add section routes, and reuse a common progressive fragment script in `src/render.js`.

**Tech Stack:** Node.js 20, Express 4, `node:test`, existing ClickHouse client abstraction, server-rendered HTML/CSS.

---

## File Structure

- Create: `src/dashboardSectionCache.js` - generic 10-hour file-backed cache for new dashboard section data.
- Modify: `src/salesByProjectDashboard.js` - add section constants, shell loader, section loader, cache keys, and keep full loader compatible.
- Modify: `src/workplaceAnalysisDashboard.js` - add shell loader and points section loader with new 10-hour cache wrapper.
- Modify: `src/workplacePointDashboard.js` - add shell loader and section loader for summary, charts, radius.
- Modify: `src/server.js` - create dashboard section cache, add section routes, wire shell routes.
- Modify: `src/render.js` - generalize progressive script and add section renderers/placeholders.
- Modify: `test/*.test.js` - add red tests for cache, shell routes, section routes, and progressive script.
- Modify: `README.md` only if a new env var needs to be documented.

### Task 1: Generic Dashboard Section Cache

**Files:**
- Create: `src/dashboardSectionCache.js`
- Create: `test/dashboardSectionCache.test.js`

- [ ] **Step 1: Write failing cache tests**

Add tests that prove:

```js
const {
  DASHBOARD_SECTION_CACHE_TTL_MS,
  createDashboardSectionCache
} = require('../src/dashboardSectionCache');

test('dashboard section cache reuses fresh values for 10 hours and reloads stale values', async () => {
  let now = Date.parse('2026-06-15T10:00:00.000Z');
  let loads = 0;
  const cache = createDashboardSectionCache({ now: () => now });

  const first = await cache.getOrLoad('key', async () => ({ value: ++loads }));
  const second = await cache.getOrLoad('key', async () => ({ value: ++loads }));
  now += DASHBOARD_SECTION_CACHE_TTL_MS + 1;
  const third = await cache.getOrLoad('key', async () => ({ value: ++loads }));

  assert.deepEqual(first, { value: 1 });
  assert.deepEqual(second, { value: 1 });
  assert.deepEqual(third, { value: 2 });
});
```

Also test persisted cache reuse after cache recreation.

- [ ] **Step 2: Run red test**

Run: `npm test -- test/dashboardSectionCache.test.js`

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement minimal cache**

Implement:

```js
const DASHBOARD_SECTION_CACHE_TTL_MS = 10 * 60 * 60 * 1000;
function createDashboardSectionCache({ ttlMs = DASHBOARD_SECTION_CACHE_TTL_MS, now = () => Date.now(), filePath = null } = {}) { ... }
```

Use the same atomic write pattern as `cityAnalysisDashboard.js`.

- [ ] **Step 4: Run green test**

Run: `npm test -- test/dashboardSectionCache.test.js`

Expected: PASS.

### Task 2: Sales By Project Sections

**Files:**
- Modify: `src/salesByProjectDashboard.js`
- Modify: `src/render.js`
- Modify: `src/server.js`
- Modify: `test/salesByProjectDashboard.test.js`
- Modify: `test/server.test.js`

- [ ] **Step 1: Write failing tests**

Add tests for:

```js
loadSalesByProjectDashboardShell(client, input, now)
```

It returns normalized filters and empty render-ready data without calling `client.queryJSONEachRow`.

Add tests for:

```js
loadSalesByProjectDashboardSection(client, input, 'summary', now, { cache })
```

It calls only `orders summary` and `shifts summary`, returns merged KPI data, and reuses cache on second call.

Add server route tests:

- `GET /dashboards/sales-by-project` calls no sales ClickHouse operations and contains fragment URLs.
- `GET /dashboards/sales-by-project/section?section=summary` returns fragment HTML without `<html>`.

- [ ] **Step 2: Run red tests**

Run:

```bash
npm test -- test/salesByProjectDashboard.test.js test/server.test.js
```

Expected: FAIL on missing functions/routes.

- [ ] **Step 3: Implement sales shell and sections**

Add:

```js
const SALES_BY_PROJECT_SECTION_NAMES = ['summary', 'trend', 'brands', 'statuses'];
async function loadSalesByProjectDashboardShell(client, input = {}, now = new Date()) { ... }
async function loadSalesByProjectDashboardSection(client, input = {}, section, now = new Date(), options = {}) { ... }
```

Keep `loadSalesByProjectDashboard` compatible by composing all sections without cache.

- [ ] **Step 4: Render progressive shell and fragments**

Add `renderSalesByProjectDashboardSection` and make `renderSalesByProjectDashboard({ progressive: true })` output placeholders.

- [ ] **Step 5: Add routes**

Wire `/dashboards/sales-by-project/section` in `src/server.js` with section whitelist and sanitized fragment errors.

- [ ] **Step 6: Run green tests**

Run:

```bash
npm test -- test/salesByProjectDashboard.test.js test/server.test.js
```

Expected: PASS for sales-related tests.

### Task 3: Workplace Analysis Points Section

**Files:**
- Modify: `src/workplaceAnalysisDashboard.js`
- Modify: `src/render.js`
- Modify: `src/server.js`
- Modify: `test/workplaceAnalysisDashboard.test.js`
- Modify: `test/server.test.js`

- [ ] **Step 1: Write failing tests**

Add tests for:

- `loadWorkplaceAnalysisDashboardShell` loads filter options only.
- `loadWorkplaceAnalysisDashboardSection(..., 'points')` loads total/top/daily/active gigers and uses new cache.
- shell server route has fragment URL and does not call `workplace analysis top workplaces`.

- [ ] **Step 2: Run red tests**

Run:

```bash
npm test -- test/workplaceAnalysisDashboard.test.js test/server.test.js
```

Expected: FAIL on missing shell/section functions and routes.

- [ ] **Step 3: Implement shell/section split**

Add:

```js
const WORKPLACE_ANALYSIS_SECTION_NAMES = ['points'];
async function loadWorkplaceAnalysisDashboardShell(client, input, now) { ... }
async function loadWorkplaceAnalysisDashboardSection(client, input, section, now, options) { ... }
```

Move existing heavy body into points section and cache the merged dashboard result with the new section cache.

- [ ] **Step 4: Add fragment renderer and route**

Render only pagination plus point cards for the `points` section.

- [ ] **Step 5: Run green tests**

Run:

```bash
npm test -- test/workplaceAnalysisDashboard.test.js test/server.test.js
```

Expected: PASS for workplace analysis tests.

### Task 4: Workplace Point Sections

**Files:**
- Modify: `src/workplacePointDashboard.js`
- Modify: `src/render.js`
- Modify: `src/server.js`
- Modify: `test/workplacePointDashboard.test.js`
- Modify: `test/server.test.js`

- [ ] **Step 1: Write failing tests**

Add tests for:

- `loadWorkplacePointDashboardShell` calls metadata and filter options only.
- `loadWorkplacePointDashboardSection(..., 'summary')` calls summary only.
- `charts` calls daily and professions.
- `radius` calls radius workers.
- each section uses the new 10-hour cache.

- [ ] **Step 2: Run red tests**

Run:

```bash
npm test -- test/workplacePointDashboard.test.js test/server.test.js
```

Expected: FAIL on missing functions/routes.

- [ ] **Step 3: Implement split**

Add:

```js
const WORKPLACE_POINT_SECTION_NAMES = ['summary', 'charts', 'radius'];
async function loadWorkplacePointDashboardShell(client, input, now) { ... }
async function loadWorkplacePointDashboardSection(client, input, section, now, options) { ... }
```

Keep full `loadWorkplacePointDashboard` compatible by composing shell and all sections without cache.

- [ ] **Step 4: Add fragment renderers and route**

Render KPI cards, charts, and radius cards as independent fragments.

- [ ] **Step 5: Run green tests**

Run:

```bash
npm test -- test/workplacePointDashboard.test.js test/server.test.js
```

Expected: PASS for point tests.

### Task 5: General Progressive Script And City Compatibility

**Files:**
- Modify: `src/render.js`
- Modify: `test/render.test.js`
- Modify: `test/cityAnalysisDashboard.test.js` only if needed

- [ ] **Step 1: Write failing render tests**

Assert:

- pages with `data-dashboard-fragment-url` include the generic progressive script;
- city progressive page still contains working fragment URLs;
- old city section route remains unchanged.

- [ ] **Step 2: Run red tests**

Run:

```bash
npm test -- test/render.test.js test/cityAnalysisDashboard.test.js
```

Expected: FAIL until render helper is generalized.

- [ ] **Step 3: Implement common attributes**

Use `data-dashboard-fragment-url` in new dashboards and optionally support `data-city-analysis-fragment-url` during migration.

- [ ] **Step 4: Run green tests**

Run:

```bash
npm test -- test/render.test.js test/cityAnalysisDashboard.test.js
```

Expected: PASS.

### Task 6: Final Verification

**Files:**
- Modify: `README.md` if `DASHBOARD_SECTION_CACHE_PATH` is documented.

- [ ] **Step 1: Run full test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 2: Inspect git diff**

Run:

```bash
git diff -- src test docs README.md
git status --short
```

Expected: only intended files changed; no `.env` or secrets.

- [ ] **Step 3: Manual server check if feasible**

Run: `npm start`

Open dashboards in browser and confirm shells render before sections.
