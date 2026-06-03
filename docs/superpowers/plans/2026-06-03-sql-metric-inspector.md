# SQL Metric Inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a permission-gated SQL inspector modal for calculated dashboard metrics, charts, maps, calendars, and tables.

**Architecture:** Keep the existing Express + server-rendered HTML architecture. Add one small metadata module for SQL-info definitions, extend the existing auth permission list, and add shared render helpers in `src/render.js` so current and future dashboard blocks can opt into the same button and modal pattern.

**Tech Stack:** Node.js 20, Express, built-in `node:test`, server-rendered HTML/CSS/JS, ClickHouse SQL templates.

---

## File Structure

- Modify `src/auth.js`: add `sql-inspector` permission so admins receive it automatically and analysts can be granted it.
- Create `src/sqlMetricInfo.js`: define SQL-info metadata, lookup helpers, and safe SQL highlighting.
- Modify `src/render.js`: add modal CSS/JS, button helpers, current-user permission checks, and attach SQL-info to dashboard blocks.
- Modify `src/server.js`: pass `viewContext(req)` into progressive section renderers so fragments can respect `sql-inspector`.
- Modify `test/auth.test.js`: cover the new permission in admin and analyst flows.
- Modify `test/renderAuth.test.js`: cover account-management checkbox rendering.
- Modify `test/render.test.js`: cover SQL modal visibility, escaping, and absence without permission.
- Modify `test/serverAuth.test.js`: cover section fragments with and without the new permission.
- Modify `README.md` and `docs/dashboards/README.md`: document the permission and future-development rule.

## Scope Boundary

This plan adds one SQL-info button per main calculated panel/table group and representative KPI grids across current dashboards. It does not add one distinct query modal for every single numeric cell in large tables in this pass; table-level SQL-info explains the query backing those cells. Future new calculated blocks must add metadata at creation time.

---

### Task 1: Add Permission

**Files:**
- Modify: `src/auth.js`
- Test: `test/auth.test.js`
- Test: `test/renderAuth.test.js`

- [ ] **Step 1: Write failing auth test**

Add assertions in `test/auth.test.js`:

```js
assert.equal(ALL_PERMISSION_IDS.includes('sql-inspector'), true);
assert.equal(hasPermission(envAdmin, 'sql-inspector'), true);
```

In the managed analyst create flow, include `sql-inspector` in the selected permissions and assert it is preserved:

```js
permissions: ['city-analysis', 'heatmap', 'worker-cancellations', 'sql-inspector', 'users', 'unknown']
```

Expected analyst permissions:

```js
assert.deepEqual(created.permissions, ['city-analysis', 'heatmap', 'worker-cancellations', 'sql-inspector']);
assert.equal(hasPermission(analyst, 'sql-inspector'), true);
```

- [ ] **Step 2: Write failing account form test**

In `test/renderAuth.test.js`, include `sql-inspector` in admin and analyst permissions and assert:

```js
assert.match(html, /SQL метрик/);
assert.match(html, /name="permissions" value="sql-inspector" checked/);
```

- [ ] **Step 3: Verify RED**

Run:

```bash
npm test -- test/auth.test.js test/renderAuth.test.js
```

Expected: fail because `sql-inspector` does not exist.

- [ ] **Step 4: Implement permission**

Add to `PERMISSION_DEFINITIONS` in `src/auth.js` before `users`:

```js
{
  id: 'sql-inspector',
  label: 'SQL метрик',
  description: 'Просмотр SQL-запросов и простых описаний расчетных метрик.'
}
```

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm test -- test/auth.test.js test/renderAuth.test.js
```

Expected: pass.

---

### Task 2: Add SQL Metadata and Highlighter

**Files:**
- Create: `src/sqlMetricInfo.js`
- Test: `test/sqlMetricInfo.test.js`

- [ ] **Step 1: Write failing metadata tests**

Create `test/sqlMetricInfo.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getSqlMetricInfo,
  highlightSql,
  sqlMetricInfoFor
} = require('../src/sqlMetricInfo');

test('getSqlMetricInfo returns stable escaped-safe metadata', () => {
  const info = getSqlMetricInfo('sales-by-project.summary');

  assert.equal(info.id, 'sales-by-project.summary');
  assert.match(info.title, /Продажи/);
  assert.match(info.description, /простым языком|показывает|считает/i);
  assert.match(info.sql, /SELECT/i);
  assert.doesNotMatch(info.sql, /CLICKHOUSE_PASSWORD|AUTH_ADMIN_PASSWORD/);
});

test('sqlMetricInfoFor returns null for missing ids', () => {
  assert.equal(sqlMetricInfoFor('missing.metric'), null);
});

test('highlightSql escapes html and highlights SQL keywords and parameters', () => {
  const html = highlightSql("SELECT '<tag>' AS value WHERE start >= {from:DateTime}");

  assert.match(html, /<span class="sql-keyword">SELECT<\/span>/);
  assert.match(html, /&lt;tag&gt;/);
  assert.match(html, /<span class="sql-param">\{from:DateTime\}<\/span>/);
  assert.doesNotMatch(html, /<tag>/);
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- test/sqlMetricInfo.test.js
```

Expected: fail because module does not exist.

- [ ] **Step 3: Implement metadata module**

Create `src/sqlMetricInfo.js` with:

```js
const SQL_METRIC_INFO = {
  'sales-by-project.summary': {
    id: 'sales-by-project.summary',
    title: 'Продажи по проектам',
    description: 'Показывает общий спрос, выполненные смены, SLA, выручку и связанные показатели за выбранный период с учетом фильтров.',
    sql: `WITH
  filtered_orders AS (
    SELECT _id, client, workplace, amount, start
    FROM mg_orders
    WHERE start >= {from:DateTime}
      AND start < {toExclusive:DateTime}
  ),
  filtered_jobs AS (
    SELECT _id, source, status, worker, payment_per_hour, salary_per_hour
    FROM mg_jobs
    WHERE start >= {from:DateTime}
      AND start < {toExclusive:DateTime}
  )
SELECT
  sum(filtered_orders.amount) AS ordered_shifts,
  countIf(filtered_jobs.status = 'confirmed') AS worked_shifts
FROM filtered_orders
LEFT JOIN filtered_jobs ON filtered_jobs.source = filtered_orders._id`
  },
  'sales-by-project.trend': {
    id: 'sales-by-project.trend',
    title: 'Динамика продаж',
    description: 'Показывает изменение заказа, выполненных смен и связанных показателей по периодам.',
    sql: `SELECT
  toDate(start) AS period,
  sum(amount) AS ordered_shifts
FROM mg_orders
WHERE start >= {from:DateTime}
  AND start < {toExclusive:DateTime}
GROUP BY period
ORDER BY period`
  },
  'sales-by-project.brands': {
    id: 'sales-by-project.brands',
    title: 'Разбивка по брендам',
    description: 'Показывает заказ и выполнение по брендам клиентов.',
    sql: `SELECT
  ifNull(c.title, 'Без бренда') AS brand,
  sum(o.amount) AS ordered_shifts
FROM mg_orders AS o
LEFT JOIN mg_clients AS c ON o.client = c._id
WHERE o.start >= {from:DateTime}
  AND o.start < {toExclusive:DateTime}
GROUP BY brand
ORDER BY ordered_shifts DESC`
  },
  'sales-by-project.statuses': {
    id: 'sales-by-project.statuses',
    title: 'Статусы смен',
    description: 'Показывает распределение смен по статусам за выбранный период.',
    sql: `SELECT
  status,
  count() AS shifts
FROM mg_jobs
WHERE start >= {from:DateTime}
  AND start < {toExclusive:DateTime}
GROUP BY status
ORDER BY shifts DESC`
  },
  'workplace-analysis.points': {
    id: 'workplace-analysis.points',
    title: 'Анализ точек',
    description: 'Показывает рабочие места с плановым заказом, стабильностью заказа и активной базой исполнителей.',
    sql: `SELECT
  o.workplace,
  sum(o.amount) AS ordered_shifts,
  countDistinct(toDate(o.start)) AS active_days
FROM mg_orders AS o
LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
WHERE o.start >= {from:DateTime}
  AND o.start < {toExclusive:DateTime}
GROUP BY o.workplace
ORDER BY ordered_shifts DESC`
  },
  'workplace-point.summary': {
    id: 'workplace-point.summary',
    title: 'Детализация точки',
    description: 'Показывает заказ, выполнение, SLA, уникальных исполнителей и слеты по выбранной рабочей точке.',
    sql: `SELECT
  sum(o.amount) AS ordered_shifts,
  countIf(j.status = 'confirmed') AS completed_shifts,
  uniqExactIf(j.worker, j.status = 'confirmed') AS unique_completed_workers
FROM mg_orders AS o
LEFT JOIN mg_jobs AS j ON j.source = o._id
WHERE o.workplace = {workplaceId:String}
  AND o.start >= {from:DateTime}
  AND o.start < {toExclusive:DateTime}`
  },
  'city-analysis.summary': {
    id: 'city-analysis.summary',
    title: 'Баланс спроса и базы',
    description: 'Сравнивает заказ в выбранном городе с базой исполнителей и их активностью в приложении.',
    sql: `WITH filtered_orders AS (
  SELECT workplace, amount, start
  FROM mg_orders
  WHERE start >= {from:DateTime}
    AND start < {toExclusive:DateTime}
),
located_users AS (
  SELECT worker._id AS worker_id, worker.user AS user_id
  FROM mg_workers AS worker
  LEFT JOIN mg_users AS u ON worker.user = u._id
)
SELECT
  sum(amount) AS ordered_shifts,
  uniqExact(user_id) AS total_located_users
FROM filtered_orders
CROSS JOIN located_users`
  },
  'city-analysis.composition': {
    id: 'city-analysis.composition',
    title: 'Состав заказа',
    description: 'Показывает, из каких брендов, специальностей и ставок состоит спрос в выбранном городе.',
    sql: `SELECT
  c.title AS brand,
  p.caption AS profession,
  sum(o.amount) AS ordered_shifts
FROM mg_orders AS o
LEFT JOIN mg_clients AS c ON o.client = c._id
LEFT JOIN mg_professions AS p ON o.spec = p.spec
WHERE o.start >= {from:DateTime}
  AND o.start < {toExclusive:DateTime}
GROUP BY brand, profession`
  },
  'city-analysis.dynamics': {
    id: 'city-analysis.dynamics',
    title: 'Динамика города',
    description: 'Показывает изменение спроса, активности, откликов и завершений по дням.',
    sql: `SELECT
  toDate(o.start) AS period,
  sum(o.amount) AS ordered_shifts
FROM mg_orders AS o
WHERE o.start >= {from:DateTime}
  AND o.start < {toExclusive:DateTime}
GROUP BY period
ORDER BY period`
  },
  'heatmap.map': {
    id: 'heatmap.map',
    title: 'Тепловая карта',
    description: 'Показывает точки с заказом на карте и сравнивает плановый заказ с активной базой исполнителей рядом.',
    sql: `SELECT
  workplace,
  sum(amount) AS ordered_shifts,
  sum(influence_weight) AS weighted_active_users
FROM mg_orders AS o
LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
WHERE o.start >= {from:DateTime}
  AND o.start < {toExclusive:DateTime}
GROUP BY workplace`
  },
  'worker-cancellations.workers': {
    id: 'worker-cancellations.workers',
    title: 'Отмены гигерами',
    description: 'Показывает исполнителей с выполненными сменами, отменами, поздними отменами и провалами за период.',
    sql: `WITH shift_facts AS (
  SELECT _id AS job, worker, status, start
  FROM mg_jobs
  WHERE start >= {from:DateTime}
    AND start < {toExclusive:DateTime}
),
cancellation_events AS (
  SELECT job, initiator, coalesce(createdAt, updatedAt) AS event_at
  FROM mg_job_history
  WHERE status = 'cancelled'
)
SELECT
  worker,
  uniqExactIf(job, status = 'confirmed') AS confirmed_shifts,
  uniqExactIf(job, status = 'cancelled') AS worker_cancellations
FROM shift_facts
GROUP BY worker`
  }
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getSqlMetricInfo(id) {
  const info = SQL_METRIC_INFO[String(id || '')];

  return info ? { ...info } : null;
}

function sqlMetricInfoFor(id) {
  return getSqlMetricInfo(id);
}

function highlightSql(sql) {
  const escaped = escapeHtml(sql);
  const withStrings = escaped.replace(/(&#39;[^&#]*(?:&#39;)?)/g, '<span class="sql-string">$1</span>');
  const withParams = withStrings.replace(/(\{[A-Za-z0-9_]+:[A-Za-z0-9_(), ]+\})/g, '<span class="sql-param">$1</span>');
  const keywords = [
    'SELECT', 'WITH', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'LEFT JOIN',
    'INNER JOIN', 'JOIN', 'ON', 'AS', 'AND', 'OR', 'COUNT', 'COUNTIF',
    'UNIQEXACT', 'SUM', 'TODATE', 'IFNULL'
  ];
  let highlighted = withParams;

  for (const keyword of keywords) {
    const pattern = new RegExp(`\\b${keyword.replace(' ', '\\s+')}\\b`, 'gi');
    highlighted = highlighted.replace(pattern, (match) => `<span class="sql-keyword">${match}</span>`);
  }

  return highlighted;
}

module.exports = {
  SQL_METRIC_INFO,
  getSqlMetricInfo,
  highlightSql,
  sqlMetricInfoFor
};
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npm test -- test/sqlMetricInfo.test.js
```

Expected: pass.

---

### Task 3: Add Render Helpers and Permission-Gated Modal

**Files:**
- Modify: `src/render.js`
- Test: `test/render.test.js`

- [ ] **Step 1: Write failing render tests**

Add tests in `test/render.test.js`:

```js
test('renderSalesByProjectDashboard shows SQL inspector only with permission', () => {
  const dashboard = {
    filters: { period: 'month', from: '2026-04-01', to: '2026-04-30' },
    summary: { orderedShifts: 10, workedShifts: 8, slaPercent: 80, revenueRub: 12000 },
    trendRows: [],
    brandRows: [],
    statusRows: []
  };
  const withoutPermission = renderSalesByProjectDashboard({
    database: 'etl',
    dashboard,
    currentUser: { role: 'analyst', permissions: ['sales-by-project'] }
  });
  const withPermission = renderSalesByProjectDashboard({
    database: 'etl',
    dashboard,
    currentUser: { role: 'analyst', permissions: ['sales-by-project', 'sql-inspector'] }
  });

  assert.doesNotMatch(withoutPermission, /sql-inspector-button/);
  assert.doesNotMatch(withoutPermission, /SELECT/);
  assert.match(withPermission, /sql-inspector-button/);
  assert.match(withPermission, /data-sql-inspector-modal/);
  assert.match(withPermission, /Показать SQL метрики: Продажи по проектам/);
  assert.match(withPermission, /<span class="sql-keyword">SELECT<\/span>/);
});
```

Add an escaping-focused test:

```js
test('SQL inspector escapes descriptions and SQL markup', () => {
  const html = renderHeatmapDashboardSection({
    currentUser: { role: 'admin', permissions: [] },
    section: 'map',
    dashboard: {
      filters: { from: '2026-05-01', to: '2026-05-31' },
      summary: {},
      points: []
    }
  });

  assert.match(html, /data-sql-inspector-modal/);
  assert.doesNotMatch(html, /<tag>/);
  assert.doesNotMatch(html, /<script>bad<\/script>/);
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- test/render.test.js
```

Expected: fail because helpers and buttons do not exist.

- [ ] **Step 3: Implement render helpers**

In `src/render.js` import:

```js
const { getSqlMetricInfo, highlightSql } = require('./sqlMetricInfo');
```

Add helpers near `renderHiddenCsrf`:

```js
function canViewSqlInspector(currentUser) {
  if (currentUser === undefined) {
    return false;
  }

  return hasPermission(currentUser, 'sql-inspector');
}

function renderSqlInspectorTrigger(metricId, currentUser) {
  const info = getSqlMetricInfo(metricId);

  if (!info || !canViewSqlInspector(currentUser)) {
    return '';
  }

  return `<button type="button" class="sql-inspector-button" data-sql-inspector-open="${escapeHtml(info.id)}" aria-label="Показать SQL метрики: ${escapeHtml(info.title)}">i</button>`;
}

function renderSqlInspectorModal(metricId, currentUser) {
  const info = getSqlMetricInfo(metricId);

  if (!info || !canViewSqlInspector(currentUser)) {
    return '';
  }

  return `<div class="sql-inspector-modal" data-sql-inspector-modal="${escapeHtml(info.id)}" hidden>
  <div class="sql-inspector-backdrop" data-sql-inspector-close></div>
  <div class="sql-inspector-dialog" role="dialog" aria-modal="true" aria-labelledby="sql-inspector-title-${escapeHtml(info.id)}">
    <div class="sql-inspector-head">
      <h2 id="sql-inspector-title-${escapeHtml(info.id)}">${escapeHtml(info.title)}</h2>
      <button type="button" class="sql-inspector-close" data-sql-inspector-close aria-label="Закрыть">×</button>
    </div>
    <div class="sql-inspector-body">
      <p class="sql-inspector-description">${escapeHtml(info.description)}</p>
      <pre class="sql-code-block"><code>${highlightSql(info.sql)}</code></pre>
    </div>
  </div>
</div>`;
}

function renderSqlInspector(metricId, currentUser) {
  return `${renderSqlInspectorTrigger(metricId, currentUser)}${renderSqlInspectorModal(metricId, currentUser)}`;
}
```

Add CSS in `layout` style:

```css
.metric-panel-head {
  position: relative;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.sql-inspector-button {
  width: 22px;
  min-width: 22px;
  min-height: 22px;
  padding: 0;
  border-color: var(--line);
  border-radius: 50%;
  background: #f0f2f4;
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
}

.sql-inspector-modal[hidden] {
  display: none;
}

.sql-inspector-modal {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.sql-inspector-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(16, 33, 43, 0.42);
}

.sql-inspector-dialog {
  position: relative;
  width: min(900px, calc(100vw - 32px));
  max-height: calc(100vh - 48px);
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--surface);
  box-shadow: 0 18px 50px rgba(31, 41, 55, 0.24);
}

.sql-inspector-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
}

.sql-inspector-head h2 {
  margin: 0;
  font-size: 18px;
}

.sql-inspector-close {
  width: 34px;
  min-width: 34px;
  padding: 0;
  border-color: var(--line);
  background: var(--surface);
  color: var(--text);
  font-size: 22px;
}

.sql-inspector-body {
  max-height: calc(100vh - 126px);
  overflow: auto;
  padding: 16px;
}

.sql-inspector-description {
  margin-bottom: 12px;
  color: var(--text);
}

.sql-code-block {
  margin: 0;
  overflow: auto;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #0f1720;
  color: #d8e2ea;
  font-family: Consolas, "Liberation Mono", monospace;
  font-size: 13px;
  line-height: 1.45;
}

.sql-keyword {
  color: #8bd3ff;
  font-weight: 700;
}

.sql-param {
  color: #f5c16c;
}

.sql-string {
  color: #9bd48b;
}
```

Add client script near existing dashboard scripts:

```html
<script>
(function () {
  document.addEventListener('click', function (event) {
    var open = event.target.closest('[data-sql-inspector-open]');
    if (open) {
      var id = open.getAttribute('data-sql-inspector-open');
      var modal = document.querySelector('[data-sql-inspector-modal="' + CSS.escape(id) + '"]');
      if (modal) {
        modal.hidden = false;
      }
      return;
    }
    if (event.target.closest('[data-sql-inspector-close]')) {
      var current = event.target.closest('[data-sql-inspector-modal]');
      if (current) {
        current.hidden = true;
      }
    }
  });

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') {
      return;
    }
    document.querySelectorAll('[data-sql-inspector-modal]').forEach(function (modal) {
      modal.hidden = true;
    });
  });
})();
</script>
```

- [ ] **Step 4: Attach to dashboard sections**

Add `currentUser` to section renderer signatures and wrap headings/KPI grids with `renderSqlInspector(...)`:

```js
function renderSalesByProjectDashboardSection({ dashboard, section, currentUser }) {
  ...
}
```

Use ids:

- `sales-by-project.summary`
- `sales-by-project.trend`
- `sales-by-project.brands`
- `sales-by-project.statuses`
- `workplace-analysis.points`
- `workplace-point.summary`
- `city-analysis.summary`
- `city-analysis.composition`
- `city-analysis.dynamics`
- `heatmap.map`
- `worker-cancellations.workers`

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm test -- test/render.test.js
```

Expected: pass.

---

### Task 4: Pass Current User Into Progressive Fragments

**Files:**
- Modify: `src/server.js`
- Test: `test/serverAuth.test.js`

- [ ] **Step 1: Write failing server auth test**

In `test/serverAuth.test.js`, add route coverage using auth-enabled app:

```js
test('dashboard section fragments respect sql-inspector permission', async () => {
  // create analyst with sales-by-project but without sql-inspector, request section, assert no sql-inspector-button
  // update analyst with sql-inspector, request same section, assert sql-inspector-button appears
});
```

Use existing test helpers in the file for login/session requests. The fake client must return enough rows for `/dashboards/sales-by-project/section?section=summary`.

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- test/serverAuth.test.js
```

Expected: fail because section renderers do not receive `currentUser`.

- [ ] **Step 3: Pass context into section renderers**

In each section route in `src/server.js`, pass `...viewContext(req)`:

```js
renderSalesByProjectDashboardSection({ dashboard, section, ...viewContext(req) })
renderCityAnalysisDashboardSection({ dashboard, section, ...viewContext(req) })
renderHeatmapDashboardSection({ dashboard, section, ...viewContext(req) })
renderWorkplaceAnalysisDashboardSection({ dashboard, section, ...viewContext(req) })
renderWorkplacePointDashboardSection({ dashboard, section, ...viewContext(req) })
renderWorkerCancellationsDashboardSection({ dashboard, section, ...viewContext(req) })
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npm test -- test/serverAuth.test.js
```

Expected: pass.

---

### Task 5: Update Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/dashboards/README.md`
- Test: none beyond review

- [ ] **Step 1: Update README**

Add to auth section:

```md
Право `SQL метрик` включает серые кнопки `i` на расчетных KPI, графиках, картах и таблицах дашбордов. Кнопка открывает описание метрики и SQL-шаблон расчета. Без этого права SQL не попадает в HTML страницы или фрагмента.
```

- [ ] **Step 2: Update dashboard docs index**

Add:

```md
## Обязательное правило для новых расчетных блоков

Каждый новый KPI, график, карта, календарь, heatmap или расчетная таблица должен иметь SQL-info metadata: стабильный `id`, краткое описание для пользователя и SQL-шаблон с ClickHouse-параметрами. Видимость SQL контролируется общим правом `SQL метрик`.
```

- [ ] **Step 3: Review diff**

Run:

```bash
git diff -- README.md docs/dashboards/README.md
```

Expected: documentation mentions permission and future rule.

---

### Task 6: Full Verification and Commit

**Files:**
- All touched files

- [ ] **Step 1: Run full test suite**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Inspect git diff**

Run:

```bash
git diff --stat
git diff --check
```

Expected: no whitespace errors; changed files match the plan.

- [ ] **Step 3: Commit**

Run:

```bash
git add src/auth.js src/sqlMetricInfo.js src/render.js src/server.js test/auth.test.js test/renderAuth.test.js test/render.test.js test/serverAuth.test.js test/sqlMetricInfo.test.js README.md docs/dashboards/README.md docs/superpowers/plans/2026-06-03-sql-metric-inspector.md
git commit -m "feat: add sql metric inspector"
```

Expected: one implementation commit after the earlier design commit.

## Self-Review

Spec coverage:

- Permission model: Task 1.
- Metadata and SQL syntax highlighting: Task 2.
- UI button and modal: Task 3.
- Server-side permission gating in fragments: Task 4.
- Future-development documentation rule: Task 5.
- Verification and commit: Task 6.

Placeholder scan:

- The plan intentionally uses one broad server auth test description in Task 4 because the exact helpers depend on the existing file. During execution, implement it with the current helpers and keep the behavior assertions exact.

Type consistency:

- Permission id is consistently `sql-inspector`.
- Metadata ids match the ids used in renderer attachments.
- Renderer context key remains `currentUser`.
