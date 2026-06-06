# Operational UI/UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Улучшить существующие аналитические экраны как единый операционный инструмент: сначала `Анализ точек`, затем карточка точки, `Отмены гигерами`, и только потом компактные тренды для руководителя-аналитика.

**Architecture:** Остаемся в Express + server-rendered HTML. Новые UI-паттерны оформляем как render-helper функции в `src/render.js`, а новые расчетные поля для риска добавляем в `src/workplaceAnalysisDashboard.js` без нового кеша и без отдельного главного экрана.

**Tech Stack:** Node.js 22, Express, `node:test`, server-rendered HTML/CSS/SVG, существующий progressive loading и SQL-инспектор.

---

## File Structure

- Modify: `src/render.js`
  - Добавить общие render-helper функции: `renderDashboardHeader`, `renderActiveFilterChips`, `renderRiskBadge`, `renderAttentionReason`, `renderMiniTrend`, `renderDashboardLoadingState`, `renderDashboardEmptyState`, `renderDashboardErrorState`.
  - Перевести ключевые секции `workplace-analysis`, `workplace-point`, `worker-cancellations`, `sales-by-project`, `city-analysis` на эти helper-функции постепенно.
- Modify: `src/workplaceAnalysisDashboard.js`
  - Расширить модель attention rows полями `riskSeverity`, `riskReasons`, `riskScore`, `attentionDetailDate`.
  - Не добавлять новые SQL-запросы на первом шаге; использовать уже возвращаемые поля attention rows.
- Modify: `src/sqlMetricInfo.js`
  - Добавить metadata только для новых самостоятельных расчетных значений, если они появятся как отдельные `metricId`.
- Modify: `test/workplaceAnalysisDashboard.test.js`
  - Тесты нормализации severity/reasons и сохранения существующей пагинации.
- Modify: `test/render.test.js`
  - Render-тесты для новых helper-функций и ключевых HTML-блоков.
- Modify: `test/sqlMetricInfo.test.js`
  - Проверка новых `metricId`, если добавляются новые SQL-info элементы.
- Optional Modify: `docs/dashboards/workplace-analysis.md`, `docs/dashboards/worker-cancellations.md`
  - Обновить документацию только после изменения расчетной модели или видимых метрик.

---

### Task 1: UI Foundation Helpers

**Files:**
- Modify: `src/render.js`
- Test: `test/render.test.js`

- [ ] **Step 1: Write failing tests for reusable dashboard UI helpers**

Add these tests near the existing render helper tests in `test/render.test.js`:

```js
test('renderWorkplaceAnalysisDashboard renders unified dashboard header and active filter chips', () => {
  const html = renderWorkplaceAnalysisDashboard({
    database: 'etl',
    progressive: true,
    dashboard: {
      filters: {
        from: '2026-06-01',
        to: '2026-06-15',
        rangeDays: 15,
        client: ['Brand A'],
        city: ['Москва'],
        region: [],
        profession: ['Комплектовщик'],
        orderType: ['regular'],
        jobStatus: [],
        contractor: [],
        search: 'Ленина',
        includeDeletedOrders: false,
        includeHiddenOrders: false,
        sort: 'orders',
        limit: 12,
        page: 1,
        pinnedWorkplaceIds: []
      },
      filterOptions: {
        client: ['Brand A'],
        city: ['Москва'],
        region: [],
        profession: ['Комплектовщик'],
        orderType: ['regular'],
        jobStatus: [],
        contractor: []
      },
      context: { sortLabel: 'по заказу' },
      points: [],
      attentionPoints: [],
      pagination: { page: 1, limit: 12, totalWorkplaces: 0, totalPages: 1, hasPrevious: false, hasNext: false },
      attentionPagination: { page: 1, pageSize: 15, totalWorkplaces: 0, totalPages: 1, hasPrevious: false, hasNext: false }
    }
  });

  assert.match(html, /dashboard-header/);
  assert.match(html, /dashboard-eyebrow/);
  assert.match(html, /Анализ точек/);
  assert.match(html, /Период: 2026-06-01 - 2026-06-15/);
  assert.match(html, /active-filter-chips/);
  assert.match(html, /Brand A/);
  assert.match(html, /Москва/);
  assert.match(html, /Комплектовщик/);
  assert.match(html, /Ленина/);
});

test('renderWorkerCancellationsDashboard renders unified loading state', () => {
  const html = renderWorkerCancellationsDashboard({
    database: 'etl',
    progressive: true,
    dashboard: {
      filters: {
        from: '2026-06-01',
        to: '2026-06-15',
        page: 1,
        pageSize: 100,
        sort: 'workerCancellations24h',
        direction: 'desc'
      }
    }
  });

  assert.match(html, /dashboard-header/);
  assert.match(html, /dashboard-loading-state/);
  assert.match(html, /Загружается/);
});
```

- [ ] **Step 2: Run the focused render tests and verify they fail**

Run:

```bash
npm test -- test/render.test.js
```

Expected: FAIL with missing `dashboard-header`, `active-filter-chips`, or `dashboard-loading-state`.

- [ ] **Step 3: Add helper functions in `src/render.js`**

Add these functions after `renderMetricPanelHead`:

```js
function renderDashboardHeader({
  title,
  eyebrow = 'Дашборд',
  period = '',
  details = []
}) {
  const detailItems = [period, ...details]
    .filter((item) => String(item || '').trim() !== '')
    .map((item) => `<span>${escapeHtml(item)}</span>`)
    .join('');

  return `<div class="dashboard-header">
  <div>
    <div class="dashboard-eyebrow">${escapeHtml(eyebrow)}</div>
    <h1>${escapeHtml(title)}</h1>
  </div>
  ${detailItems ? `<div class="dashboard-meta">${detailItems}</div>` : ''}
</div>`;
}

function activeFilterChipItems(filters = {}) {
  const items = [];
  const pushArray = (label, values) => {
    for (const value of Array.isArray(values) ? values : []) {
      if (String(value || '').trim() !== '') {
        items.push(`${label}: ${value}`);
      }
    }
  };

  pushArray('Бренд', filters.client);
  pushArray('Город', filters.city);
  pushArray('Регион', filters.region);
  pushArray('Профессия', filters.profession);
  pushArray('Тип заказа', (filters.orderType || []).map(orderTypeLabel));
  pushArray('Статус', filters.jobStatus);
  pushArray('Контрагент', filters.contractor);

  if (String(filters.search || '').trim() !== '') {
    items.push(`Поиск: ${filters.search}`);
  }

  if (filters.includeDeletedOrders) {
    items.push('Удаленные включены');
  }

  if (filters.includeHiddenOrders) {
    items.push('Скрытые включены');
  }

  return items;
}

function renderActiveFilterChips(filters = {}) {
  const items = activeFilterChipItems(filters);

  if (items.length === 0) {
    return '<div class="active-filter-chips"><span class="filter-chip muted-chip">Фильтры не выбраны</span></div>';
  }

  return `<div class="active-filter-chips">${items
    .map((item) => `<span class="filter-chip">${escapeHtml(item)}</span>`)
    .join('')}</div>`;
}

function renderDashboardLoadingState(label = 'Загружается') {
  return `<div class="dashboard-loading-state"><p class="loading">${escapeHtml(label)}</p></div>`;
}

function renderDashboardEmptyState(label) {
  return `<div class="dashboard-empty-state"><p class="empty">${escapeHtml(label)}</p></div>`;
}

function renderDashboardErrorState(message) {
  return `<div class="dashboard-error-state"><div class="error">${escapeHtml(message)}</div></div>`;
}
```

- [ ] **Step 4: Add CSS for the shared shell**

In `layout()` CSS inside `src/render.js`, add these rules near the existing `h1`, `.filter-bar`, and state styles:

```css
    .dashboard-header {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      justify-content: space-between;
      gap: 10px 18px;
      margin-bottom: 12px;
    }

    .dashboard-eyebrow {
      margin-bottom: 4px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0;
    }

    .dashboard-meta {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 6px 10px;
      color: var(--muted);
      font-size: 13px;
    }

    .dashboard-meta span {
      overflow-wrap: anywhere;
    }

    .active-filter-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: -6px 0 14px;
    }

    .filter-chip {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 3px 8px;
      border: 1px solid #c7d4df;
      border-radius: 999px;
      background: #f6f9fb;
      color: var(--text);
      font-size: 12px;
      font-weight: 700;
      overflow-wrap: anywhere;
    }

    .muted-chip {
      color: var(--muted);
      font-weight: 400;
    }

    .dashboard-loading-state,
    .dashboard-empty-state,
    .dashboard-error-state {
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
    }
```

- [ ] **Step 5: Replace shell title and loading fragments in two dashboards**

In `renderWorkplaceAnalysisDashboard`, replace the top `<h1>` and context line with:

```js
  ${renderDashboardHeader({
    title: 'Анализ точек',
    eyebrow: 'Операции',
    period: `Период: ${filters.from} - ${filters.to}`,
    details: [`Дней: ${filters.rangeDays}`, dashboard.context && dashboard.context.sortLabel ? dashboard.context.sortLabel : '']
  })}
  ${renderActiveFilterChips(filters)}
```

In `renderWorkerCancellationsDashboard`, replace the top `<h1>` with:

```js
  ${renderDashboardHeader({
    title: 'Отмены гигерами',
    eyebrow: 'Операции',
    period: `Период: ${filters.from} - ${filters.to}`,
    details: ['Период по плановому старту смены']
  })}
```

Replace loading paragraphs in progressive fragment containers:

```js
${renderDashboardLoadingState()}
```

- [ ] **Step 6: Run focused render tests**

Run:

```bash
npm test -- test/render.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add src/render.js test/render.test.js
git commit -m "Add shared dashboard UI helpers"
```

---

### Task 2: Workplace Attention Risk Model

**Files:**
- Modify: `src/workplaceAnalysisDashboard.js`
- Test: `test/workplaceAnalysisDashboard.test.js`

- [ ] **Step 1: Write failing tests for risk severity and reasons**

Add these tests after `mergeWorkplaceAttentionRows calculates free order...`:

```js
test('mergeWorkplaceAttentionRows assigns high risk severity and reasons for urgent free order', () => {
  const filters = normalizeWorkplaceAttentionFilters({}, new Date('2026-06-04T12:00:00.000Z'));
  const dashboard = mergeWorkplaceAttentionRows(filters, [
    {
      workplace_id: 'wp-risk',
      workplace_title: 'Точка риска',
      ordered_7d: 12,
      covered_7d: 3,
      free_7d: 9,
      max_daily_free: 6,
      days_with_free: 2,
      nearest_free_date: '2026-06-04',
      total_workers_15km: 20,
      active_workers_30d_15km: 2
    }
  ]);

  assert.equal(dashboard.attentionPoints[0].riskSeverity, 'high');
  assert.equal(dashboard.attentionPoints[0].attentionDetailDate, '2026-06-04');
  assert.equal(dashboard.attentionPoints[0].riskScore >= 80, true);
  assert.deepEqual(dashboard.attentionPoints[0].riskReasons.slice(0, 3), [
    { kind: 'free-order', label: 'Свободный заказ 9 за 7 дней' },
    { kind: 'coverage', label: 'Покрытие 25%' },
    { kind: 'active-base', label: 'Актив 0,2 на свободную смену' }
  ]);
});

test('mergeWorkplaceAttentionRows assigns medium risk when order is later and base is acceptable', () => {
  const filters = normalizeWorkplaceAttentionFilters({}, new Date('2026-06-04T12:00:00.000Z'));
  const dashboard = mergeWorkplaceAttentionRows(filters, [
    {
      workplace_id: 'wp-medium',
      workplace_title: 'Средний риск',
      ordered_7d: 10,
      covered_7d: 8,
      free_7d: 2,
      max_daily_free: 2,
      days_with_free: 1,
      nearest_free_date: '2026-06-10',
      total_workers_15km: 60,
      active_workers_30d_15km: 18
    }
  ]);

  assert.equal(dashboard.attentionPoints[0].riskSeverity, 'medium');
  assert.equal(dashboard.attentionPoints[0].riskReasons[0].kind, 'free-order');
  assert.equal(dashboard.attentionPoints[0].riskReasons.some((reason) => reason.kind === 'active-base'), false);
});
```

- [ ] **Step 2: Run focused workplace tests and verify they fail**

Run:

```bash
npm test -- test/workplaceAnalysisDashboard.test.js
```

Expected: FAIL with missing `riskSeverity`, `riskReasons`, or `riskScore`.

- [ ] **Step 3: Implement risk helper functions**

Add these functions in `src/workplaceAnalysisDashboard.js` near `mergeWorkplaceAttentionRows`:

```js
function formatRiskNumber(value, digits = 0) {
  const number = Number(value) || 0;

  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(number).replace(/\u00a0/g, ' ');
}

function attentionRiskReasons(row) {
  const free7d = Number(row.free_7d) || 0;
  const ordered7d = Number(row.ordered_7d) || 0;
  const covered7d = Number(row.covered_7d) || 0;
  const maxDailyFree = Number(row.max_daily_free) || 0;
  const activeWorkers30d15km = Number(row.active_workers_30d_15km) || 0;
  const activePerFree = free7d > 0 ? activeWorkers30d15km / free7d : 0;
  const coveragePercent = ordered7d > 0 ? covered7d / ordered7d * 100 : 0;
  const reasons = [];

  if (free7d > 0) {
    reasons.push({ kind: 'free-order', label: `Свободный заказ ${formatRiskNumber(free7d)} за 7 дней` });
  }

  if (ordered7d > 0 && coveragePercent < 70) {
    reasons.push({ kind: 'coverage', label: `Покрытие ${formatRiskNumber(coveragePercent)}%` });
  }

  if (free7d > 0 && activePerFree < 1) {
    reasons.push({ kind: 'active-base', label: `Актив ${formatRiskNumber(activePerFree, 1)} на свободную смену` });
  }

  if (maxDailyFree >= 3) {
    reasons.push({ kind: 'peak-day', label: `Пик ${formatRiskNumber(maxDailyFree)} свободных смен в день` });
  }

  return reasons;
}

function attentionRiskScore(row, reasons) {
  const free7d = Number(row.free_7d) || 0;
  const maxDailyFree = Number(row.max_daily_free) || 0;
  const activeWorkers30d15km = Number(row.active_workers_30d_15km) || 0;
  const activePerFree = free7d > 0 ? activeWorkers30d15km / free7d : 0;
  let score = 0;

  score += Math.min(45, free7d * 5);
  score += Math.min(25, maxDailyFree * 4);

  if (free7d > 0 && activePerFree < 0.5) {
    score += 25;
  } else if (free7d > 0 && activePerFree < 1) {
    score += 15;
  }

  if (reasons.some((reason) => reason.kind === 'coverage')) {
    score += 15;
  }

  return Math.min(100, score);
}

function attentionRiskSeverity(score) {
  if (score >= 70) {
    return 'high';
  }

  if (score >= 25) {
    return 'medium';
  }

  return 'low';
}
```

- [ ] **Step 4: Attach risk fields inside attention row mapping**

In `mergeWorkplaceAttentionRows`, while mapping each row into an attention point, compute:

```js
const riskReasons = attentionRiskReasons(row);
const riskScore = attentionRiskScore(row, riskReasons);
```

Add these properties to each attention point object:

```js
riskReasons,
riskScore,
riskSeverity: attentionRiskSeverity(riskScore),
attentionDetailDate: String(row.nearest_free_date || '')
```

Keep existing `priorityReason`, `coveragePercent`, `activeWorkersPerFreeShift`, status breakdowns, sorting, and pagination unchanged.

- [ ] **Step 5: Keep risk helpers private**

Do not add `attentionRiskReasons`, `attentionRiskScore`, or `attentionRiskSeverity` to `module.exports`. The tests validate them through `mergeWorkplaceAttentionRows`, which keeps the dashboard module API smaller.

- [ ] **Step 6: Run focused workplace tests**

Run:

```bash
npm test -- test/workplaceAnalysisDashboard.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add src/workplaceAnalysisDashboard.js test/workplaceAnalysisDashboard.test.js
git commit -m "Add workplace attention risk model"
```

---

### Task 3: Workplace Attention UI

**Files:**
- Modify: `src/render.js`
- Test: `test/render.test.js`

- [ ] **Step 1: Write failing render tests for risk badges and attention reasons**

Add this test near existing workplace-analysis render tests:

```js
test('renderWorkplaceAnalysisDashboardSection renders attention risk badges, reasons, and detail links', () => {
  const html = renderWorkplaceAnalysisDashboardSection({
    section: 'attention',
    dashboard: {
      filters: {
        from: '2026-06-01',
        to: '2026-06-15',
        client: [],
        city: [],
        region: [],
        profession: [],
        orderType: [],
        jobStatus: [],
        contractor: [],
        search: '',
        includeDeletedOrders: false,
        includeHiddenOrders: false,
        attentionPage: 1,
        attentionPageSize: 15,
        attentionSort: 'free7d',
        attentionDirection: 'desc'
      },
      attentionPoints: [
        {
          workplaceId: 'wp-risk',
          title: 'Точка риска',
          clientTitle: 'Brand A',
          address: 'Москва, Ленина 1',
          free7d: 9,
          ordered7d: 12,
          covered7d: 3,
          coveragePercent: 25,
          maxDailyFree: 6,
          nearestFreeDate: '2026-06-04',
          activeWorkers30d15km: 2,
          activeWorkersPerFreeShift: 0.2,
          riskSeverity: 'high',
          riskScore: 90,
          attentionDetailDate: '2026-06-04',
          riskReasons: [
            { kind: 'free-order', label: 'Свободный заказ 9 за 7 дней' },
            { kind: 'coverage', label: 'Покрытие 25%' },
            { kind: 'active-base', label: 'Актив 0,2 на свободную смену' }
          ]
        }
      ],
      attentionPagination: {
        page: 1,
        pageSize: 15,
        totalWorkplaces: 1,
        totalPages: 1,
        hasPrevious: false,
        hasNext: false
      }
    }
  });

  assert.match(html, /risk-badge risk-high/);
  assert.match(html, /Высокий/);
  assert.match(html, /Свободный заказ 9 за 7 дней/);
  assert.match(html, /Покрытие 25%/);
  assert.match(html, /Актив 0,2 на свободную смену/);
  assert.match(html, /\/dashboards\/workplace-analysis\/point\?workplaceId=wp-risk/);
  assert.match(html, /2026-06-04/);
  assert.doesNotMatch(html, /<html/);
});
```

- [ ] **Step 2: Run focused render tests and verify they fail**

Run:

```bash
npm test -- test/render.test.js
```

Expected: FAIL with missing `risk-badge` and reason labels.

- [ ] **Step 3: Add risk render helpers**

Add these functions in `src/render.js` near other workplace helper functions:

```js
function riskSeverityLabel(severity) {
  if (severity === 'high') {
    return 'Высокий';
  }

  if (severity === 'medium') {
    return 'Средний';
  }

  return 'Низкий';
}

function renderRiskBadge(severity) {
  const normalized = ['high', 'medium', 'low'].includes(severity) ? severity : 'low';

  return `<span class="risk-badge risk-${escapeHtml(normalized)}">${escapeHtml(riskSeverityLabel(normalized))}</span>`;
}

function renderAttentionReason(reason) {
  const kind = String(reason && reason.kind ? reason.kind : 'default');
  const label = String(reason && reason.label ? reason.label : '');

  if (label === '') {
    return '';
  }

  return `<span class="attention-reason attention-reason-${escapeHtml(kind)}">${escapeHtml(label)}</span>`;
}

function renderAttentionReasons(reasons) {
  const items = safeRows(reasons)
    .map(renderAttentionReason)
    .filter((item) => item !== '')
    .join('');

  return items === '' ? '<span class="attention-reason attention-reason-muted">Причина не рассчитана</span>' : items;
}
```

- [ ] **Step 4: Add CSS for risk and reasons**

In `layout()` CSS in `src/render.js`, add:

```css
    .risk-badge,
    .attention-reason {
      display: inline-flex;
      align-items: center;
      min-height: 22px;
      padding: 2px 7px;
      border: 1px solid var(--line);
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      white-space: nowrap;
    }

    .risk-high {
      border-color: #d49386;
      background: #fff0ed;
      color: #9f2a1d;
    }

    .risk-medium {
      border-color: #ddbf75;
      background: #fff8e6;
      color: #7a5400;
    }

    .risk-low {
      border-color: #a8cdb6;
      background: #effaf3;
      color: #24613a;
    }

    .attention-reasons {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      min-width: 0;
    }

    .attention-reason {
      background: #f6f9fb;
      color: var(--text);
      font-weight: 600;
      white-space: normal;
    }

    .attention-reason-muted {
      color: var(--muted);
      font-weight: 400;
    }
```

- [ ] **Step 5: Update attention table markup**

In `renderWorkplaceAttentionRows`, add a risk column near the point title:

```js
<td>${renderRiskBadge(point.riskSeverity)}</td>
```

Add a reasons column:

```js
<td><div class="attention-reasons">${renderAttentionReasons(point.riskReasons)}</div></td>
```

Keep existing metric buttons and pagination. The point link should continue to use `workplacePointPageHref(filters, point.workplaceId)`.

If the attention table already has many columns, replace the old `priorityReason` text column with the new risk/reasons pair instead of adding unbounded width.

- [ ] **Step 6: Run render tests**

Run:

```bash
npm test -- test/render.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add src/render.js test/render.test.js
git commit -m "Render workplace attention risk context"
```

---

### Task 4: Workplace Point Continuity

**Files:**
- Modify: `src/render.js`
- Test: `test/render.test.js`

- [ ] **Step 1: Write failing tests for point dashboard header and problem-day highlighting**

Add this test near workplace point render tests:

```js
test('renderWorkplacePointDashboard renders unified header and preserves point calendar actions', () => {
  const html = renderWorkplacePointDashboard({
    database: 'etl',
    progressive: false,
    dashboard: {
      filters: {
        workplaceId: 'wp-risk',
        from: '2026-06-01',
        to: '2026-06-15',
        client: [],
        city: [],
        region: [],
        profession: [],
        orderType: [],
        jobStatus: [],
        contractor: [],
        salaryFrom: null,
        salaryTo: null,
        includeDeletedOrders: false,
        includeHiddenOrders: false
      },
      currentDate: '2026-06-04',
      point: {
        workplaceId: 'wp-risk',
        title: 'Точка риска',
        clientTitle: 'Brand A',
        address: 'Москва, Ленина 1'
      },
      summary: {
        orderedShifts: 12,
        completedShifts: 3,
        slaPercent: 25,
        stabilityPercent: 40,
        uniqueCompletedWorkers: 3,
        uniqueBookedWorkers: 4,
        ratingAvg: 4.2,
        ratingCount: 5,
        dropoffs24h: 2,
        radius5km: 2,
        radius10km: 4,
        radius15km: 8,
        radius20km: 12
      },
      dailyRows: [
        {
          date: '2026-06-04',
          orderedShifts: 6,
          completedShifts: 1,
          slaPercent: 16.666,
          dropoffs24h: 2,
          orderLeadAvgMinutes: 60,
          orderLeadMinMinutes: 20
        }
      ],
      professionRows: []
    }
  });

  assert.match(html, /dashboard-header/);
  assert.match(html, /Карточка точки/);
  assert.match(html, /Точка риска/);
  assert.match(html, /Москва, Ленина 1/);
  assert.match(html, /data-workplace-point-day-trigger/);
  assert.match(html, /2026-06-04/);
});
```

- [ ] **Step 2: Run focused render tests and verify they fail**

Run:

```bash
npm test -- test/render.test.js
```

Expected: FAIL if `dashboard-header` is not rendered on the point page.

- [ ] **Step 3: Update point page header**

In `renderWorkplacePointDashboard`, replace the top raw heading with:

```js
  ${renderDashboardHeader({
    title: point && point.title ? point.title : 'Карточка точки',
    eyebrow: 'Карточка точки',
    period: `Период: ${filters.from} - ${filters.to}`,
    details: [point && point.clientTitle ? point.clientTitle : '', point && point.address ? point.address : '']
  })}
  ${renderActiveFilterChips(filters)}
```

Keep the existing back link:

```html
<a class="back-link" href="/dashboards/workplace-analysis">Анализ точек</a>
```

- [ ] **Step 4: Improve calendar risk visual density without new data**

In the point-calendar cell renderer around the existing `point-calendar-cell` markup, add a deterministic `data-risk-level` attribute from existing daily values:

```js
const dailySla = Number(row.slaPercent) || 0;
const dropoffs24h = Number(row.dropoffs24h) || 0;
const orderedShifts = Number(row.orderedShifts) || 0;
const riskLevel = orderedShifts > 0 && (dailySla < 50 || dropoffs24h > 0)
  ? 'high'
  : orderedShifts > 0 && dailySla < 80
    ? 'medium'
    : 'low';
```

Add to the wrapper that currently renders `class="${escapeHtml(cellClass)}"`:

```html
data-risk-level="${escapeHtml(riskLevel)}"
```

- [ ] **Step 5: Add CSS for point calendar risk levels**

In `layout()` CSS:

```css
    .point-calendar-day[data-risk-level="high"] {
      border-color: #d49386;
      background: #fff7f5;
    }

    .point-calendar-day[data-risk-level="medium"] {
      border-color: #ddbf75;
      background: #fffaf0;
    }
```

Use `.point-calendar-cell` selectors. Do not introduce a second wrapper class for the same calendar cell.

- [ ] **Step 6: Run render tests**

Run:

```bash
npm test -- test/render.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/render.js test/render.test.js
git commit -m "Improve workplace point operational continuity"
```

---

### Task 5: Worker Cancellations Operational Pattern

**Files:**
- Modify: `src/workerCancellationsDashboard.js`
- Modify: `src/render.js`
- Test: `test/workerCancellationsDashboard.test.js`
- Test: `test/render.test.js`

- [ ] **Step 1: Write failing model test for cancellation risk severity**

Add this test after `mergeWorkerCancellationRows maps ClickHouse rows...`:

```js
test('mergeWorkerCancellationRows adds cancellation risk severity and reasons', () => {
  const filters = normalizeWorkerCancellationFilters(
    {
      from: '2026-06-01',
      to: '2026-06-15'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );
  const dashboard = mergeWorkerCancellationRows(filters, [
    {
      worker_id: 'worker-risk',
      full_name: 'Ivan Petrov',
      phone: '+79990000000',
      city: 'Moscow',
      confirmed_shifts: '10',
      worker_cancellations: '5',
      worker_cancellations_24h: '3',
      post_start_cancellations: '1',
      failed_shifts: '2'
    }
  ], [{ total_workers: '1' }]);

  assert.equal(dashboard.workers[0].riskSeverity, 'high');
  assert.deepEqual(dashboard.workers[0].riskReasons.slice(0, 2), [
    { kind: 'worker-cancellations-24h', label: '3 отмены менее чем за 24ч' },
    { kind: 'post-start-cancellations', label: '1 отмена после старта' }
  ]);
});
```

- [ ] **Step 2: Run focused worker cancellation tests and verify they fail**

Run:

```bash
npm test -- test/workerCancellationsDashboard.test.js
```

Expected: FAIL with missing `riskSeverity` or `riskReasons`.

- [ ] **Step 3: Implement worker cancellation risk helpers**

Add in `src/workerCancellationsDashboard.js` near `mergeWorkerCancellationRows`:

```js
function workerCancellationRiskReasons(worker) {
  const reasons = [];

  if ((Number(worker.workerCancellations24h) || 0) > 0) {
    reasons.push({
      kind: 'worker-cancellations-24h',
      label: `${worker.workerCancellations24h} отмены менее чем за 24ч`
    });
  }

  if ((Number(worker.postStartCancellations) || 0) > 0) {
    reasons.push({
      kind: 'post-start-cancellations',
      label: `${worker.postStartCancellations} отмена после старта`
    });
  }

  if ((Number(worker.failedShifts) || 0) > 0) {
    reasons.push({
      kind: 'failed-shifts',
      label: `${worker.failedShifts} failed-смен`
    });
  }

  return reasons;
}

function workerCancellationRiskSeverity(worker) {
  const cancellations24h = Number(worker.workerCancellations24h) || 0;
  const postStart = Number(worker.postStartCancellations) || 0;
  const failed = Number(worker.failedShifts) || 0;

  if (cancellations24h >= 3 || postStart > 0 || failed >= 3) {
    return 'high';
  }

  if (cancellations24h > 0 || failed > 0 || (Number(worker.workerCancellations) || 0) > 1) {
    return 'medium';
  }

  return 'low';
}
```

Inside `mergeWorkerCancellationRows`, after creating the worker object:

```js
const riskReasons = workerCancellationRiskReasons(worker);

return {
  ...worker,
  riskReasons,
  riskSeverity: workerCancellationRiskSeverity(worker)
};
```

- [ ] **Step 4: Write failing render test for worker cancellation risk context**

Add to `test/render.test.js` near worker cancellation section tests:

```js
test('renderWorkerCancellationsDashboardSection renders risk badges and cancellation reasons', () => {
  const html = renderWorkerCancellationsDashboardSection({
    section: 'workers',
    dashboard: {
      filters: {
        from: '2026-06-01',
        to: '2026-06-15',
        page: 1,
        pageSize: 50,
        sort: 'workerCancellations24h',
        direction: 'desc'
      },
      rows: [
        {
          workerId: 'worker-risk',
          fullName: 'Ivan Petrov',
          phone: '+79990000000',
          city: 'Moscow',
          confirmedShifts: 10,
          workerCancellations: 5,
          workerCancellations24h: 3,
          postStartCancellations: 1,
          failedShifts: 2,
          riskSeverity: 'high',
          riskReasons: [
            { kind: 'worker-cancellations-24h', label: '3 отмены менее чем за 24ч' },
            { kind: 'post-start-cancellations', label: '1 отмена после старта' }
          ]
        }
      ],
      pagination: {
        page: 1,
        pageSize: 50,
        totalWorkers: 1,
        totalPages: 1,
        hasPrevious: false,
        hasNext: false
      }
    }
  });

  assert.match(html, /risk-badge risk-high/);
  assert.match(html, /3 отмены менее чем за 24ч/);
  assert.match(html, /1 отмена после старта/);
  assert.match(html, /data-worker-cancellation-detail-trigger/);
});
```

- [ ] **Step 5: Render risk in worker cancellations table**

In `renderWorkerCancellationsTable`, add a risk column and reasons column using the same helpers from Task 3:

```js
<td>${renderRiskBadge(row.riskSeverity)}</td>
<td><div class="attention-reasons">${renderAttentionReasons(row.riskReasons)}</div></td>
```

Keep full phone output unchanged for this screen.

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm test -- test/workerCancellationsDashboard.test.js test/render.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

```bash
git add src/workerCancellationsDashboard.js src/render.js test/workerCancellationsDashboard.test.js test/render.test.js
git commit -m "Align worker cancellations with operational risk UI"
```

---

### Task 6: Mini-Trends For Existing Trend Data

**Files:**
- Modify: `src/render.js`
- Test: `test/render.test.js`

- [ ] **Step 1: Write failing tests for mini-trend SVG rendering**

Add this test near sales/city render tests:

```js
test('renderSalesByProjectDashboard renders mini trends from existing trend rows', () => {
  const html = renderSalesByProjectDashboard({
    database: 'etl',
    progressive: false,
    dashboard: {
      filters: {
        from: '2026-04-01',
        to: '2026-06-30',
        period: 'month'
      },
      summary: {
        orderedShifts: 120,
        workedShifts: 90,
        slaPercent: 75,
        revenueRub: 150000,
        uniqueWorkers: 20,
        workplacesWithOrders: 12,
        workplacesWithWorkedShifts: 10,
        cancelledShifts: 8,
        selfBookingPercent: 30,
        avgWorkerRateHour: 350
      },
      trendRows: [
        { period: '2026-04-01', orderedShifts: 30, workedShifts: 20, revenueRub: 40000, cancelledShifts: 5 },
        { period: '2026-05-01', orderedShifts: 40, workedShifts: 30, revenueRub: 50000, cancelledShifts: 2 },
        { period: '2026-06-01', orderedShifts: 50, workedShifts: 40, revenueRub: 60000, cancelledShifts: 1 }
      ],
      brandRows: [],
      statusRows: []
    }
  });

  assert.match(html, /mini-trend/);
  assert.match(html, /polyline/);
  assert.match(html, /aria-label="Динамика/);
});
```

- [ ] **Step 2: Run focused render tests and verify they fail**

Run:

```bash
npm test -- test/render.test.js
```

Expected: FAIL with missing `mini-trend`.

- [ ] **Step 3: Add mini-trend helper**

Add this in `src/render.js` near chart helpers:

```js
function renderMiniTrend(rows, valueKey, label) {
  const values = safeRows(rows)
    .map((row) => Number(row[valueKey]) || 0)
    .filter((value) => Number.isFinite(value));

  if (values.length < 2) {
    return '';
  }

  const width = 120;
  const height = 36;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(1, max - min);
  const points = values
    .map((value, index) => {
      const x = values.length === 1 ? width : index / (values.length - 1) * width;
      const y = height - ((value - min) / range * (height - 4)) - 2;

      return `${formatNumber(x, 1)},${formatNumber(y, 1)}`;
    })
    .join(' ');

  return `<svg class="mini-trend" viewBox="0 0 ${width} ${height}" role="img" aria-label="Динамика ${escapeHtml(label)}">
  <polyline points="${escapeHtml(points)}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline>
</svg>`;
}
```

- [ ] **Step 4: Add mini-trend CSS**

In `layout()` CSS:

```css
    .mini-trend {
      display: block;
      width: 100%;
      max-width: 140px;
      height: 36px;
      margin-top: 8px;
      color: var(--accent);
    }
```

- [ ] **Step 5: Add mini-trends to sales KPI cards without changing SQL**

Where sales summary KPI cards are assembled, pass `valueHtml` or `detailHtml` using existing `dashboard.trendRows`. For ordered shifts:

```js
{
  label: 'Заказано смен',
  value: formatNumber(summary.orderedShifts),
  detailHtml: renderMiniTrend(dashboard.trendRows, 'orderedShifts', 'заказа'),
  metricId: 'sales-by-project.summary.ordered-shifts'
}
```

For worked shifts:

```js
{
  label: 'Выполнено смен',
  value: formatNumber(summary.workedShifts),
  detailHtml: renderMiniTrend(dashboard.trendRows, 'workedShifts', 'выполненных смен'),
  metricId: 'sales-by-project.summary.worked-shifts'
}
```

Do not add a new SQL query in this task.

- [ ] **Step 6: Run render tests**

Run:

```bash
npm test -- test/render.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit Task 6**

```bash
git add src/render.js test/render.test.js
git commit -m "Add mini trends to existing dashboard KPI"
```

---

### Task 7: SQL Info, Docs, And Full Verification

**Files:**
- Modify: `src/sqlMetricInfo.js`
- Modify: `test/sqlMetricInfo.test.js`
- Modify: `docs/dashboards/workplace-analysis.md`
- Modify: `docs/dashboards/worker-cancellations.md`

- [ ] **Step 1: Decide whether new `metricId` values were introduced**

Inspect staged changes from Tasks 1-6:

```bash
git diff HEAD -- src/render.js src/workplaceAnalysisDashboard.js src/workerCancellationsDashboard.js src/sqlMetricInfo.js
```

If all new UI elements reuse existing metric ids and no new SQL-backed displayed value was introduced, skip Steps 2-4 and continue at Step 5.

If new `metricId` values were introduced, continue with Step 2.

- [ ] **Step 2: Add failing SQL-info test for new ids**

In `test/sqlMetricInfo.test.js`, add the exact new ids to `RENDERED_SQL_METRIC_IDS`, for example:

```js
'workplace-analysis.attention.risk-severity',
'worker-cancellations.workers.risk-severity'
```

Run:

```bash
npm test -- test/sqlMetricInfo.test.js
```

Expected: FAIL with `must be explicit in SQL_METRIC_INFO`.

- [ ] **Step 3: Add explicit SQL-info metadata**

In `src/sqlMetricInfo.js`, add entries for each new SQL-backed displayed value. If risk severity is computed from existing attention rows rather than a new query, its SQL should point to the same attention query template and the description must state that severity is derived in application code from `free_7d`, `coverage`, `max_daily_free`, and active base values.

Use this shape:

```js
SQL_METRIC_INFO['workplace-analysis.attention.risk-severity'] = {
  id: 'workplace-analysis.attention.risk-severity',
  title: 'Риск точки внимания',
  description: 'Показывает высокий, средний или низкий риск точки. Значение рассчитывается приложением из свободного заказа, покрытия, дневного пика и активной базы.',
  sql: WORKPLACE_ANALYSIS_ATTENTION_SQL
};
```

Use `WORKPLACE_ATTENTION_SQL`, which is already defined in `src/sqlMetricInfo.js`.

- [ ] **Step 4: Run SQL-info tests**

Run:

```bash
npm test -- test/sqlMetricInfo.test.js
```

Expected: PASS.

- [ ] **Step 5: Update dashboard documentation**

In `docs/dashboards/workplace-analysis.md`, add a short subsection:

```md
## Операционный риск

Во вкладке `Требуют внимания` риск точки отображается как `Высокий`, `Средний` или `Низкий`.
Оценка строится из уже рассчитанных полей ближайших 7 дней: незакрытый заказ, покрытие, максимальный дневной свободный заказ и активная база в радиусе 15 км.
Если данные для причины отсутствуют, интерфейс не показывает эту причину как факт.
```

In `docs/dashboards/worker-cancellations.md`, add:

```md
## Операционный риск исполнителя

В таблице исполнителей риск показывает повторяемость проблемных отмен и failed-смен.
Высокий риск получают исполнители с несколькими отменами менее чем за 24 часа, отменой после старта или высокой долей failed-смен.
ФИО и телефон остаются только на этом экране, потому что используются для операционной работы с отменами.
```

- [ ] **Step 6: Run full automated test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 7: Run browser QA**

Start the app:

```bash
npm start
```

Open and check:

```text
http://localhost:3000/dashboards/workplace-analysis
http://localhost:3000/dashboards/workplace-analysis/point?workplaceId=<existing-workplace-id>
http://localhost:3000/dashboards/worker-cancellations
http://localhost:3000/dashboards/sales-by-project
http://localhost:3000/dashboards/city-analysis
http://localhost:3000/dashboards/heatmap
```

Expected:

- headers render consistently;
- filters remain usable;
- attention rows show severity and reasons;
- table text does not overlap at desktop width;
- mobile width keeps horizontal table scroll where needed;
- progressive sections load;
- SQL-inspector buttons only appear for users with `sql-inspector`;
- Leaflet map still renders on the heatmap page.

- [ ] **Step 8: Commit final docs and SQL-info changes**

```bash
git add src/sqlMetricInfo.js test/sqlMetricInfo.test.js docs/dashboards/workplace-analysis.md docs/dashboards/worker-cancellations.md
git commit -m "Document operational UI risk metrics"
```

If Steps 2-5 were skipped because no new `metricId` or docs change was needed, do not create an empty commit.

---

## Final Verification Checklist

- [ ] `npm test` passes.
- [ ] `workplace-analysis` keeps existing filters, pagination, and progressive loading.
- [ ] `workplace-analysis` attention rows show risk severity and concrete reasons.
- [ ] `workplace-analysis/point` remains reachable from attention rows.
- [ ] `worker-cancellations` keeps full phone output only on that screen.
- [ ] `sales-by-project` mini-trends use existing trend rows and do not add a SQL query.
- [ ] `city-analysis` remains visually compatible and existing dynamics still render.
- [ ] `heatmap` Leaflet map still renders.
- [ ] No arbitrary SQL input is introduced.
- [ ] No new files under `data/` are created or committed.
