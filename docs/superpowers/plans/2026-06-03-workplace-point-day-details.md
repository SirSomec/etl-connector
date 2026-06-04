# Workplace Point Day Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить модальное окно детализации дня на странице `Детализация точки`.

**Architecture:** Данные дня грузятся отдельным endpoint `/dashboards/workplace-analysis/point/details`, чтобы календарная секция оставалась легкой. `src/workplacePointDashboard.js` нормализует дату, строит безопасный ClickHouse-запрос и маппит строки; `src/render.js` делает кликабельные дни, модалку, компактную таблицу и клиентский `fetch`; `src/server.js` добавляет HTML-фрагмент маршрута.

**Tech Stack:** Node.js 20, `node:test`, Express, server-rendered HTML, ClickHouse `queryJSONEachRow`.

---

## Scope Check

Спека покрывает один subsystem: drill-down по дню внутри существующей страницы точки. Отдельная декомпозиция не нужна.

## File Structure

- Modify: `src/workplacePointDashboard.js` - добавить `normalizeWorkplacePointDayDetailsInput`, `mergeWorkplacePointDayDetails`, SQL-запрос и `loadWorkplacePointDayDetails`.
- Modify: `test/workplacePointDashboard.test.js` - покрыть нормализацию даты, ошибки, маппинг и SQL-операцию.
- Modify: `src/render.js` - добавить helper URL деталей, кликабельные ячейки календаря, модалку, таблицу деталей, CSS и скрипт.
- Modify: `test/render.test.js` - проверить `data-detail-url`, модалку, таблицу, экранирование и отсутствие переносов для ключевых колонок.
- Modify: `src/server.js` - добавить route `/dashboards/workplace-analysis/point/details`.
- Modify: `test/server.test.js` - проверить route, параметры ClickHouse, фрагмент без полного layout и ошибку в виде фрагмента.

Перед правками выполнить `git status --short` и не трогать unrelated изменения.

---

### Task 1: Day Details Data Loader

**Files:**
- Modify: `src/workplacePointDashboard.js`
- Modify: `test/workplacePointDashboard.test.js`

- [ ] **Step 1: Write failing data tests**

Add imports in `test/workplacePointDashboard.test.js`:

```javascript
  loadWorkplacePointDayDetails,
  mergeWorkplacePointDayDetails,
  normalizeWorkplacePointDayDetailsInput,
```

Add tests:

```javascript
test('normalizeWorkplacePointDayDetailsInput requires workplace id and valid date', () => {
  const input = normalizeWorkplacePointDayDetailsInput(
    {
      workplaceId: ' wp1 ',
      date: '2026-06-02',
      profession: ['picker'],
      orderType: ['regular'],
      jobStatus: ['confirmed'],
      includeHiddenOrders: '1'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.equal(input.filters.workplaceId, 'wp1');
  assert.equal(input.date, '2026-06-02');
  assert.equal(input.fromDateTime, '2026-06-02 00:00:00');
  assert.equal(input.toExclusiveDateTime, '2026-06-03 00:00:00');
  assert.deepEqual(input.filters.profession, ['picker']);
  assert.deepEqual(input.filters.orderType, ['regular']);
  assert.deepEqual(input.filters.jobStatus, ['confirmed']);
  assert.equal(input.filters.includeHiddenOrders, true);

  assert.throws(
    () => normalizeWorkplacePointDayDetailsInput({ date: '2026-06-02' }),
    (error) => error.status === 400 && /workplaceId/.test(error.message)
  );
  assert.throws(
    () => normalizeWorkplacePointDayDetailsInput({ workplaceId: 'wp1', date: 'bad' }),
    (error) => error.status === 400 && /date/.test(error.message)
  );
});

test('mergeWorkplacePointDayDetails maps confirmed and cancelled-only order rows', () => {
  const detailInput = normalizeWorkplacePointDayDetailsInput(
    { workplaceId: 'wp1', date: '2026-06-02' },
    new Date('2026-06-15T12:00:00.000Z')
  );
  const details = mergeWorkplacePointDayDetails(detailInput, [
    {
      order_id: 'order-1',
      job_id: 'job-1',
      profession: 'Комплектовщик',
      order_start_local: '2026-06-02 09:00:00',
      planned_hours: 8,
      worker_full_name: 'Иванов Иван',
      worker_phone: '+79990000000',
      confirmed_status: 'confirmed',
      actual_hours: 7.5,
      actual_time_local: '2026-06-02 09:10 - 2026-06-02 16:40',
      payment_amount: 4500,
      cancelled_shifts: 0,
      last_cancelled_at_local: ''
    },
    {
      order_id: 'order-2',
      job_id: '',
      profession: '',
      order_start_local: '2026-06-02 14:00:00',
      planned_hours: null,
      worker_full_name: '',
      worker_phone: '',
      confirmed_status: '',
      actual_hours: null,
      actual_time_local: '',
      payment_amount: null,
      cancelled_shifts: 2,
      last_cancelled_at_local: '2026-06-02 12:30:00'
    }
  ]);

  assert.equal(details.workplaceId, 'wp1');
  assert.equal(details.date, '2026-06-02');
  assert.equal(details.rows.length, 2);
  assert.deepEqual(details.rows[0], {
    orderId: 'order-1',
    jobId: 'job-1',
    profession: 'Комплектовщик',
    orderStartLocal: '2026-06-02 09:00:00',
    plannedHours: 8,
    workerFullName: 'Иванов Иван',
    workerPhone: '+79990000000',
    confirmedStatus: 'confirmed',
    actualHours: 7.5,
    actualTimeLocal: '2026-06-02 09:10 - 2026-06-02 16:40',
    paymentAmount: 4500,
    cancelledShifts: 0,
    lastCancelledAtLocal: ''
  });
  assert.deepEqual(details.rows[1], {
    orderId: 'order-2',
    jobId: '',
    profession: 'Без специальности',
    orderStartLocal: '2026-06-02 14:00:00',
    plannedHours: null,
    workerFullName: '',
    workerPhone: '',
    confirmedStatus: '',
    actualHours: null,
    actualTimeLocal: '',
    paymentAmount: 0,
    cancelledShifts: 2,
    lastCancelledAtLocal: '2026-06-02 12:30:00'
  });
});

test('loadWorkplacePointDayDetails queries one selected day with safe parameters', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });
      return [
        {
          order_id: 'order-1',
          job_id: 'job-1',
          profession: 'Комплектовщик',
          order_start_local: '2026-06-02 09:00:00',
          planned_hours: 8,
          worker_full_name: 'Иванов Иван',
          worker_phone: '+79990000000',
          confirmed_status: 'confirmed',
          actual_hours: 7.5,
          actual_time_local: '2026-06-02 09:10 - 2026-06-02 16:40',
          payment_amount: 4500,
          cancelled_shifts: 0,
          last_cancelled_at_local: ''
        }
      ];
    }
  };

  const details = await loadWorkplacePointDayDetails(
    client,
    {
      workplaceId: 'wp1; DROP TABLE mg_orders',
      date: '2026-06-02',
      profession: ['Комплектовщик'],
      orderType: ['regular'],
      jobStatus: ['confirmed']
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.equal(details.rows.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].operation, 'workplace point day details');
  assert.equal(calls[0].params.param_workplace_id, 'wp1; DROP TABLE mg_orders');
  assert.equal(calls[0].params.param_from, '2026-06-02 00:00:00');
  assert.equal(calls[0].params.param_to, '2026-06-03 00:00:00');
  assert.equal(calls[0].params.param_professions, "['Комплектовщик']");
  assert.equal(calls[0].params.param_order_types, "['regular']");
  assert.equal(calls[0].params.param_job_statuses, "['confirmed']");
  assert.equal(calls[0].query.includes('DROP TABLE'), false);
  assert.equal(calls[0].query.includes('FROM mg_orders AS o'), true);
  assert.equal(calls[0].query.includes('LEFT JOIN mg_jobs AS j'), true);
  assert.equal(calls[0].query.includes('mg_job_history'), true);
  assert.equal(calls[0].query.includes('mg_payments'), true);
  assert.equal(calls[0].query.includes('is_successful_confirmed_shift'), true);
  assert.equal(calls[0].query.includes("j.status = 'cancelled'"), true);
  assert.equal(calls[0].query.includes("payment_status, '') IN ('done', 'bank_done')"), true);
});
```

- [ ] **Step 2: Run data tests and verify RED**

Run:

```bash
npm test -- test/workplacePointDashboard.test.js
```

Expected: FAIL because the new functions are not exported.

- [ ] **Step 3: Implement day detail normalization and mapper**

In `src/workplacePointDashboard.js`, add:

```javascript
function normalizeWorkplacePointDayDetailsInput(input = {}, now = new Date()) {
  const filters = normalizeWorkplacePointFilters(input, now);
  const requestedDate = parseDateOnly(input.date);

  if (filters.workplaceId === '') {
    throw httpError(400, 'Missing workplaceId');
  }

  if (!requestedDate) {
    throw httpError(400, 'Missing or invalid date');
  }

  const date = formatDateUTC(requestedDate);
  const nextDate = formatDateUTC(addDaysUTC(requestedDate, 1));

  return {
    filters,
    date,
    fromDateTime: toDateTimeParam(date),
    toExclusiveDateTime: toDateTimeParam(nextDate)
  };
}

function textValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function mergeWorkplacePointDayDetails(detailInput, detailRows = []) {
  return {
    filters: detailInput.filters,
    workplaceId: detailInput.filters.workplaceId,
    date: detailInput.date,
    rows: detailRows.map((row) => ({
      orderId: textValue(row.order_id),
      jobId: textValue(row.job_id),
      profession: textValue(row.profession) || 'Без специальности',
      orderStartLocal: textValue(row.order_start_local),
      plannedHours: nullableNumberValue(row.planned_hours),
      workerFullName: textValue(row.worker_full_name),
      workerPhone: textValue(row.worker_phone),
      confirmedStatus: textValue(row.confirmed_status),
      actualHours: nullableNumberValue(row.actual_hours),
      actualTimeLocal: textValue(row.actual_time_local),
      paymentAmount: numberValue(row.payment_amount),
      cancelledShifts: numberValue(row.cancelled_shifts),
      lastCancelledAtLocal: textValue(row.last_cancelled_at_local)
    }))
  };
}
```

- [ ] **Step 4: Implement detail SQL and loader**

Add `dayDetailsQuery(whereSql)` that uses existing `orderWhereForFilters` with overridden `from/to` params. The query must:

- build `filtered_orders` from `mg_orders`;
- aggregate `job_rollup` by `order_id` with `countIf(status = 'cancelled')`;
- aggregate `last_cancelled` from `mg_job_history`;
- aggregate successful `payments` from `mg_payments`;
- return confirmed rows where `finish_fact > start_fact`;
- return one fallback order row when no confirmed row exists.

Add:

```javascript
async function loadWorkplacePointDayDetails(client, input = {}, now = new Date()) {
  const detailInput = normalizeWorkplacePointDayDetailsInput(input, now);
  const params = baseParams(detailInput.filters);

  params.param_from = detailInput.fromDateTime;
  params.param_to = detailInput.toExclusiveDateTime;

  const whereSql = orderWhereForFilters(detailInput.filters, params);
  const rows = await client.queryJSONEachRow(
    dayDetailsQuery(whereSql),
    params,
    'workplace point day details'
  );

  return mergeWorkplacePointDayDetails(detailInput, rows);
}
```

Export:

```javascript
  loadWorkplacePointDayDetails,
  mergeWorkplacePointDayDetails,
  normalizeWorkplacePointDayDetailsInput,
```

- [ ] **Step 5: Run data tests and verify GREEN**

Run:

```bash
npm test -- test/workplacePointDashboard.test.js
```

Expected: PASS.

---

### Task 2: Renderer, Modal And Compact Table

**Files:**
- Modify: `src/render.js`
- Modify: `test/render.test.js`

- [ ] **Step 1: Write failing render tests**

In `test/render.test.js`, add `renderWorkplacePointDayDetails` to imports.

Extend the existing `renderWorkplacePointDashboard renders filters, point metrics, and compact charts` assertions:

```javascript
  assert.match(calendarPanelHtml, /data-workplace-point-day-detail-trigger/);
  assert.match(calendarPanelHtml, /data-detail-url="\/dashboards\/workplace-analysis\/point\/details\?[^"]*workplaceId=wp1[^"]*date=2026-06-01/);
  assert.match(html, /data-workplace-point-day-modal/);
  assert.match(html, /data-workplace-point-day-modal-body/);
```

Add a new test:

```javascript
test('renderWorkplacePointDayDetails renders escaped compact table fragment', () => {
  const html = renderWorkplacePointDayDetails({
    details: {
      date: '2026-06-02',
      rows: [
        {
          orderId: 'order-1',
          jobId: 'job-1',
          profession: '<bad>',
          orderStartLocal: '2026-06-02 09:00:00',
          plannedHours: 8,
          workerFullName: 'Иванов <Иван>',
          workerPhone: '+79990000000',
          confirmedStatus: 'confirmed',
          actualHours: 7.5,
          actualTimeLocal: '2026-06-02 09:10 - 2026-06-02 16:40',
          paymentAmount: 4500,
          cancelledShifts: 0,
          lastCancelledAtLocal: ''
        }
      ]
    }
  });

  assert.match(html, /Детализация дня: 2026-06-02/);
  assert.match(html, /<th>Профессия<\/th>/);
  assert.match(html, /<th>Старт<\/th>/);
  assert.match(html, /<th>План<\/th>/);
  assert.match(html, /<th>Гигер<\/th>/);
  assert.match(html, /<th>Телефон<\/th>/);
  assert.match(html, /&lt;bad&gt;/);
  assert.match(html, /Иванов &lt;Иван&gt;/);
  assert.match(html, /\+79990000000/);
  assert.match(html, /confirmed/);
  assert.match(html, /7\.5/);
  assert.match(html, /4 500/);
  assert.doesNotMatch(html, /<html/);
});
```

- [ ] **Step 2: Run render tests and verify RED**

Run:

```bash
npm test -- test/render.test.js
```

Expected: FAIL because the detail renderer and modal hooks do not exist.

- [ ] **Step 3: Add detail URL and interactive calendar cells**

In `src/render.js`, add:

```javascript
function workplacePointDayDetailsUrl(filters, date) {
  const params = new URLSearchParams();

  addDashboardQueryParam(params, 'workplaceId', filters.workplaceId);
  addDashboardQueryParam(params, 'from', filters.from);
  addDashboardQueryParam(params, 'to', filters.to);
  addDashboardQueryParam(params, 'date', date);
  addDashboardQueryParam(params, 'profession', filters.profession);
  addDashboardQueryParam(params, 'orderType', filters.orderType);
  addDashboardQueryParam(params, 'jobStatus', filters.jobStatus);

  if (filters.includeDeletedOrders) {
    params.set('includeDeletedOrders', '1');
  }

  if (filters.includeHiddenOrders) {
    params.set('includeHiddenOrders', '1');
  }

  return `/dashboards/workplace-analysis/point/details?${params.toString()}`;
}
```

Change `renderPointCalendarCell(row, currentDateKey)` to accept `filters`, build `detailUrl`, and render a `<button type="button" class="point-calendar-cell-button" data-workplace-point-day-detail-trigger data-detail-url="...">` inside the existing cell.

- [ ] **Step 4: Add modal, details table, CSS and script**

Add renderer helpers:

```javascript
function renderWorkplacePointDayDetails({ details }) {
  const rows = (details && details.rows) || [];
  const date = details && details.date ? details.date : '';

  if (rows.length === 0) {
    return `<div class="workplace-point-day-details">
  <h2>Детализация дня: ${escapeHtml(date)}</h2>
  <p class="empty">Нет заданий за выбранный день.</p>
</div>`;
  }

  const bodyRows = rows.map((row) => `<tr>
  <td class="compact-text-cell">${escapeHtml(detailText(row.profession))}</td>
  <td class="nowrap-cell">${escapeHtml(formatDateTimeValue(row.orderStartLocal))}</td>
  <td class="number-cell">${escapeHtml(formatNullableNumber(row.plannedHours, 1))}</td>
  <td class="compact-text-cell">${escapeHtml(detailText(row.workerFullName))}</td>
  <td class="nowrap-cell">${escapeHtml(detailText(row.workerPhone))}</td>
  <td>${escapeHtml(detailText(row.confirmedStatus))}</td>
  <td class="number-cell">${escapeHtml(formatNullableNumber(row.actualHours, 1))}</td>
  <td class="nowrap-cell">${escapeHtml(detailText(row.actualTimeLocal))}</td>
  <td class="number-cell">${escapeHtml(formatNumber(row.paymentAmount))}</td>
  <td class="number-cell">${escapeHtml(formatNumber(row.cancelledShifts))}</td>
  <td class="nowrap-cell">${escapeHtml(formatDateTimeValue(row.lastCancelledAtLocal))}</td>
</tr>`).join('');

  return `<div class="workplace-point-day-details">
  <h2>Детализация дня: ${escapeHtml(date)}</h2>
  <div class="table-wrap compact-detail-table-wrap"><table class="compact-detail-table">
    <thead><tr>
      <th>Профессия</th>
      <th>Старт</th>
      <th>План</th>
      <th>Гигер</th>
      <th>Телефон</th>
      <th>Confirmed</th>
      <th>Факт, ч</th>
      <th>Факт время</th>
      <th>Начислено</th>
      <th>Cancelled</th>
      <th>Последний cancelled</th>
    </tr></thead>
    <tbody>${bodyRows}</tbody>
  </table></div>
</div>`;
}
```

Add `renderWorkplacePointDayModal()` and `renderWorkplacePointDayDetailsScript()` following the existing worker cancellation modal pattern, but using `data-workplace-point-day-*` attributes.

Add CSS for:

- `.point-calendar-cell-button`;
- `.workplace-point-day-modal`;
- `.compact-detail-table`;
- `.compact-text-cell`;
- `.compact-detail-table-wrap`.

Add export:

```javascript
  renderWorkplacePointDayDetails,
```

- [ ] **Step 5: Run render tests and verify GREEN**

Run:

```bash
npm test -- test/render.test.js
```

Expected: PASS.

---

### Task 3: Server Route

**Files:**
- Modify: `src/server.js`
- Modify: `test/server.test.js`

- [ ] **Step 1: Write failing server tests**

In `test/server.test.js`, add fake operation support:

```javascript
      if (operation === 'workplace point day details') {
        return [
          {
            order_id: 'order-1',
            job_id: 'job-1',
            profession: 'Комплектовщик',
            order_start_local: '2026-06-02 09:00:00',
            planned_hours: 8,
            worker_full_name: 'Иванов Иван',
            worker_phone: '+79990000000',
            confirmed_status: 'confirmed',
            actual_hours: 7.5,
            actual_time_local: '2026-06-02 09:10 - 2026-06-02 16:40',
            payment_amount: 4500,
            cancelled_shifts: 0,
            last_cancelled_at_local: ''
          }
        ];
      }
```

Add tests:

```javascript
test('GET /dashboards/workplace-analysis/point/details renders day details fragment', async () => {
  const client = createFakeClient();

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(
      baseUrl,
      '/dashboards/workplace-analysis/point/details?workplaceId=wp1&date=2026-06-02&profession=Комплектовщик&orderType=regular&jobStatus=confirmed'
    );

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html\b/);
    assert.match(text, /Детализация дня: 2026-06-02/);
    assert.match(text, /Иванов Иван/);
    assert.match(text, /\+79990000000/);
    assert.doesNotMatch(text, /<html/);
  });

  const calls = client.calls.filter(
    (call) => call[0] === 'queryJSONEachRow' && call[1] === 'workplace point day details'
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0][2].param_workplace_id, 'wp1');
  assert.equal(calls[0][2].param_from, '2026-06-02 00:00:00');
  assert.equal(calls[0][2].param_to, '2026-06-03 00:00:00');
});

test('GET /dashboards/workplace-analysis/point/details renders bad request as fragment', async () => {
  const client = createFakeClient();

  await withServer(client, async (baseUrl) => {
    const { response, text } = await fetchText(
      baseUrl,
      '/dashboards/workplace-analysis/point/details?workplaceId=wp1&date=bad'
    );

    assert.equal(response.status, 400);
    assert.match(text, /date/);
    assert.doesNotMatch(text, /<html/);
  });
});
```

- [ ] **Step 2: Run server tests and verify RED**

Run:

```bash
npm test -- test/server.test.js
```

Expected: FAIL because the route is missing.

- [ ] **Step 3: Add route imports and handler**

In `src/server.js`, import:

```javascript
  loadWorkplacePointDayDetails,
```

and:

```javascript
  renderWorkplacePointDayDetails,
```

Add route after `/dashboards/workplace-analysis/point/section`:

```javascript
  app.get(
    '/dashboards/workplace-analysis/point/details',
    requireAuth('workplace-analysis'),
    asyncRoute(async (req, res) => {
      try {
        const details = await loadWorkplacePointDayDetails(client, req.query, new Date());

        res
          .status(200)
          .type('html')
          .send(renderWorkplacePointDayDetails({ details }));
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

- [ ] **Step 4: Run server tests and verify GREEN**

Run:

```bash
npm test -- test/server.test.js
```

Expected: PASS.

---

### Task 4: Full Verification

**Files:**
- Verify all modified files.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- test/workplacePointDashboard.test.js test/render.test.js test/server.test.js
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Inspect changed files**

Run:

```bash
git status --short
git diff -- src/workplacePointDashboard.js src/render.js src/server.js test/workplacePointDashboard.test.js test/render.test.js test/server.test.js
```

Expected: only intended files are changed, no `.env`, `data/` or secrets.

- [ ] **Step 4: Manual browser smoke test**

Start app if needed:

```bash
npm start
```

Open:

```text
http://localhost:3000/dashboards/workplace-analysis/point?workplaceId=<known-workplace-id>
```

Verify:

- calendar days are focusable/clickable;
- click opens modal;
- modal loads details table;
- table is compact on desktop;
- horizontal scroll appears only inside the modal table when needed;
- `Escape`, close button and backdrop close the modal.

## Self-Review

Spec coverage:

- Separate endpoint and lazy loading: Task 3.
- Clickable calendar cells and modal: Task 2.
- Removal of `количество откликов`: no task adds this metric.
- Required columns: Task 2 render table and Task 1 model.
- `confirmed` only with non-zero factual duration: Task 1 SQL implementation.
- `cancelled` count and last cancelled transition when confirmed is absent: Task 1 SQL implementation.
- Compact table and horizontal scroll fallback: Task 2 CSS.
- PII scope and escaping: Task 2 render tests.
- No arbitrary SQL: Task 1 SQL parameter test.

Placeholder scan:

- No banned marker words or unspecified implementation steps.

Type consistency:

- Loader export names match server imports.
- Row aliases use snake_case from ClickHouse and camelCase in render model.
- URL helper uses existing filter keys: `workplaceId`, `from`, `to`, `profession`, `orderType`, `jobStatus`, `includeDeletedOrders`, `includeHiddenOrders`.
