# Heatmap Worker Concentration Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toggleable worker concentration layer to `/dashboards/heatmap`.

**Architecture:** Extend the existing Express/server-rendered heatmap flow. The map section keeps one endpoint and returns demand points plus optional aggregated worker-concentration buckets; the browser renders buckets on a Leaflet canvas overlay under existing order markers.

**Tech Stack:** Node.js 22, Express 4, ClickHouse SQL, server-rendered HTML, Leaflet 1.9, `node:test`.

---

### Task 1: Server Filter And Query Model

**Files:**
- Modify: `src/heatmapDashboard.js`
- Test: `test/heatmapDashboard.test.js`

- [ ] **Step 1: Write failing tests**

Add tests that verify:

```js
const filters = normalizeHeatmapFilters({ workerConcentrationLayer: 'on' }, new Date('2026-06-15T12:00:00.000Z'));
assert.equal(filters.workerConcentrationLayer, 'on');

const unsafe = normalizeHeatmapFilters({ workerConcentrationLayer: 'unsafe' }, new Date('2026-06-15T12:00:00.000Z'));
assert.equal(unsafe.workerConcentrationLayer, 'off');
```

Also assert that `loadHeatmapDashboardSection` does not call `heatmap worker concentration` when the layer is `off`, and does call it when the layer is `on`.

- [ ] **Step 2: Run RED**

Run:

```bash
npm test -- test/heatmapDashboard.test.js
```

Expected: FAIL because `workerConcentrationLayer` and `heatmap worker concentration` are not implemented.

- [ ] **Step 3: Implement minimal server behavior**

In `src/heatmapDashboard.js`:

- add whitelist `off|on`;
- include `workerConcentrationLayer` in normalized filters and section cache key;
- add `workerConcentrationQuery(filters)`;
- call it from `loadHeatmapMapRows` only when the layer is `on`;
- add `workerConcentration` to the merged dashboard model.

- [ ] **Step 4: Run GREEN**

Run:

```bash
npm test -- test/heatmapDashboard.test.js
```

Expected: PASS.

### Task 2: Renderer Toggle And Canvas Layer

**Files:**
- Modify: `src/render.js`
- Test: `test/render.test.js`

- [ ] **Step 1: Write failing renderer tests**

Assert that the page form includes:

```html
<input type="checkbox" name="workerConcentrationLayer" value="on" checked>
```

when the filter is enabled, and that map HTML includes `data-worker-concentration`.

- [ ] **Step 2: Run RED**

Run:

```bash
npm test -- test/render.test.js
```

Expected: FAIL because toggle and data attribute are missing.

- [ ] **Step 3: Implement renderer behavior**

In `src/render.js`:

- add a compact checkbox control labeled `Концентрация исполнителей`;
- pass `workerConcentrationLayer` through `heatmapSectionUrl`;
- serialize `dashboard.workerConcentration` to `data-worker-concentration`;
- add Leaflet canvas overlay that draws soft radial spots and redraws on `moveend` and `zoomend`;
- keep existing order markers above the canvas overlay.

- [ ] **Step 4: Run GREEN**

Run:

```bash
npm test -- test/render.test.js
```

Expected: PASS.

### Task 3: SQL-info And Docs

**Files:**
- Modify: `src/sqlMetricInfo.js`
- Modify: `docs/dashboards/heatmap.md`
- Test: `test/sqlMetricInfo.test.js`

- [ ] **Step 1: Write failing SQL-info test**

Assert `getSqlMetricInfo('heatmap.map.worker-concentration')` exists and mentions:

```js
assert.match(info.sql, /appmetrica_sessions/);
assert.match(info.sql, /now\(\) - INTERVAL 30 DAY/);
assert.match(info.sql, /mg_workers/);
```

- [ ] **Step 2: Run RED**

Run:

```bash
npm test -- test/sqlMetricInfo.test.js
```

Expected: FAIL because metadata is missing.

- [ ] **Step 3: Implement SQL-info and docs**

Add stable metadata id `heatmap.map.worker-concentration` and document the new layer in `docs/dashboards/heatmap.md`.

- [ ] **Step 4: Run GREEN**

Run:

```bash
npm test -- test/sqlMetricInfo.test.js
```

Expected: PASS.

### Task 4: Verification And Container

**Files:**
- No code changes.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
npm test -- test/heatmapDashboard.test.js test/render.test.js test/sqlMetricInfo.test.js
```

Expected: PASS.

- [ ] **Step 2: Rebuild container**

Run:

```bash
docker compose up -d --build --force-recreate
```

Expected: service `etl-analytics` starts on port `3000`.

- [ ] **Step 3: Verify real ClickHouse section data**

Run inside the container:

```bash
docker compose exec -T etl-analytics node -e "const { loadConfig } = require('./src/config'); const { ClickHouseClient } = require('./src/clickhouseClient'); const { loadHeatmapDashboardSection } = require('./src/heatmapDashboard'); (async () => { const config = loadConfig(); const client = new ClickHouseClient(config.clickhouse); const dashboard = await loadHeatmapDashboardSection(client, { year: '2026', month: '5', workerConcentrationLayer: 'on' }, 'map', new Date()); console.log(JSON.stringify({ points: dashboard.points.length, workerConcentration: dashboard.workerConcentration.length })); })().catch((error) => { console.error(error.name + ': ' + error.message); process.exit(1); });"
```

Expected: command exits `0` and prints non-error JSON.
