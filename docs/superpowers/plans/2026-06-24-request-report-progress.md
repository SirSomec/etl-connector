# Реальный прогресс проверки отчетов Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить реальный этапный прогресс, анимацию и ETA для инструмента `Проверка отчетов`.

**Architecture:** Существующий синхронный HTML POST остается fallback. Новый JS-enhanced путь запускает in-memory задачу через JSON endpoint, UI опрашивает status endpoint, а анализатор отправляет реальные события прогресса по этапам и батчам ClickHouse lookup. Состояние задач, выполнение проверки и HTML-рендер результата разделяются по отдельным модулям/функциям, чтобы не раздувать `server.js`.

**Tech Stack:** Node.js 22, Express 4, `node:test`, server-rendered HTML/CSS/vanilla JS, существующий ClickHouse client.

---

## Контекст и ограничения

- Репозиторий уже может содержать несвязанные изменения. В каждом коммите staging делать только для файлов текущей задачи.
- Все ответы UI и документы остаются на русском языке.
- XLSX не сохраняется на диск и не пишется в `data/`.
- Новый async-путь требует permission `request-report-matching` и CSRF на запуске.
- Существующий маршрут `POST /tools/request-report-confirmed-check` должен продолжить работать.

## Структура файлов

- Create: `src/requestReportJobStore.js`  
  In-memory registry задач: создание, обновление прогресса, завершение, ошибка, snapshot для polling, TTL-очистка.

- Create: `test/requestReportJobStore.test.js`  
  Unit-тесты registry: статус, ETA, TTL, непредсказуемый id через injectable `randomBytes`.

- Modify: `src/requestReportMissingConfirmed.js`  
  Добавить опциональный `onProgress(event)` в парсинг и lookup-функции. Не менять расчетную семантику поиска строк без confirmed-смен.

- Modify: `test/requestReportMissingConfirmed.test.js`  
  Добавить TDD-тесты на события прогресса по этапам и батчам.

- Modify: `src/render.js`  
  Вынести фрагмент результата проверки отчетов в экспортируемую функцию. Добавить progress panel, CSS и JS polling enhancement к странице.

- Modify: `test/render.test.js`  
  Проверить async data-атрибуты, progress panel, fallback form action, скрипт polling и HTML-фрагмент результата.

- Create: `src/requestReportJobRunner.js`  
  Оркестрация одной проверки: parse workbook, lookup missing confirmed rows, merge warnings, render result fragment, проброс progress-событий.

- Create: `test/requestReportJobRunner.test.js`  
  Unit-тест runner-а с fake parser/finder/renderer.

- Modify: `src/server.js`  
  Подключить job store и runner, добавить `POST /tools/request-report-confirmed-check/jobs` и `GET /tools/request-report-confirmed-check/jobs/:jobId`.

- Modify: `test/server.test.js`  
  Проверить создание задачи, polling статусов, JSON-ошибки валидации, 404 для неизвестного `jobId`.

- Modify: `test/serverAuth.test.js`  
  Проверить, что async endpoint-ы требуют `request-report-matching`.

---

### Task 1: In-Memory Job Store

**Files:**
- Create: `src/requestReportJobStore.js`
- Create: `test/requestReportJobStore.test.js`

- [ ] **Step 1: Write the failing store tests**

Create `test/requestReportJobStore.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const { createRequestReportJobStore } = require('../src/requestReportJobStore');

test('request report job store tracks progress and calculates ETA', () => {
  let currentTime = 1_000;
  const store = createRequestReportJobStore({
    now: () => currentTime,
    randomBytes: () => Buffer.from('00112233445566778899aabbccddeeff', 'hex')
  });

  const job = store.createJob();

  assert.match(job.id, /^request-report-/);
  assert.equal(store.getSnapshot(job.id).status, 'queued');
  assert.equal(store.getSnapshot(job.id).progress, 0);
  assert.equal(store.getSnapshot(job.id).estimatedRemainingMs, null);

  currentTime = 11_000;
  store.updateJob(job.id, {
    status: 'running',
    progress: 25,
    stage: 'Поиск confirmed-смен по ID ЛКК',
    detail: 'Батч 1 из 4'
  });

  const running = store.getSnapshot(job.id);

  assert.equal(running.status, 'running');
  assert.equal(running.progress, 25);
  assert.equal(running.stage, 'Поиск confirmed-смен по ID ЛКК');
  assert.equal(running.detail, 'Батч 1 из 4');
  assert.equal(running.estimatedRemainingMs, 30_000);

  store.completeJob(job.id, {
    html: '<section>Готово</section>',
    detail: 'Проверено 12 строк'
  });

  const done = store.getSnapshot(job.id);

  assert.equal(done.status, 'done');
  assert.equal(done.progress, 100);
  assert.equal(done.stage, 'Готово');
  assert.equal(done.detail, 'Проверено 12 строк');
  assert.equal(done.estimatedRemainingMs, 0);
  assert.equal(done.html, '<section>Готово</section>');
});

test('request report job store reports failure and prunes completed jobs by ttl', () => {
  let currentTime = 1_000;
  const store = createRequestReportJobStore({
    now: () => currentTime,
    ttlMs: 15 * 60 * 1000,
    randomBytes: () => Buffer.from('ffeeddccbbaa99887766554433221100', 'hex')
  });

  const job = store.createJob();

  store.failJob(job.id, 'Не удалось прочитать XLSX');

  const failed = store.getSnapshot(job.id);

  assert.equal(failed.status, 'failed');
  assert.equal(failed.progress, 100);
  assert.equal(failed.stage, 'Ошибка');
  assert.equal(failed.error, 'Не удалось прочитать XLSX');
  assert.equal(failed.estimatedRemainingMs, 0);

  currentTime += 14 * 60 * 1000;
  assert.equal(store.pruneExpired(), 0);
  assert.notEqual(store.getSnapshot(job.id), null);

  currentTime += 2 * 60 * 1000;
  assert.equal(store.pruneExpired(), 1);
  assert.equal(store.getSnapshot(job.id), null);
});
```

- [ ] **Step 2: Run the store tests to verify RED**

Run:

```bash
node --test test/requestReportJobStore.test.js
```

Expected: FAIL with `Cannot find module '../src/requestReportJobStore'`.

- [ ] **Step 3: Implement the minimal job store**

Create `src/requestReportJobStore.js`:

```js
const crypto = require('node:crypto');

const DEFAULT_TTL_MS = 15 * 60 * 1000;

function clampProgress(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(number)));
}

function calculateEta({ now, startedAt, progress, status }) {
  if (status === 'done' || status === 'failed') {
    return 0;
  }

  if (!startedAt || progress <= 0) {
    return null;
  }

  const elapsedMs = Math.max(0, now - startedAt);

  return Math.max(0, Math.round((elapsedMs * (100 - progress)) / progress));
}

function snapshotJob(job, now) {
  if (!job) {
    return null;
  }

  const progress = clampProgress(job.progress);

  return {
    jobId: job.id,
    status: job.status,
    progress,
    stage: job.stage,
    detail: job.detail,
    estimatedRemainingMs: calculateEta({
      now,
      startedAt: job.startedAt,
      progress,
      status: job.status
    }),
    html: job.html,
    error: job.error
  };
}

function createRequestReportJobStore({
  now = () => Date.now(),
  ttlMs = DEFAULT_TTL_MS,
  randomBytes = crypto.randomBytes
} = {}) {
  const jobs = new Map();

  function createJob() {
    const current = now();
    const id = `request-report-${randomBytes(16).toString('hex')}`;
    const job = {
      id,
      status: 'queued',
      createdAt: current,
      updatedAt: current,
      startedAt: null,
      progress: 0,
      stage: 'Задача создана',
      detail: '',
      html: undefined,
      error: undefined
    };

    jobs.set(id, job);

    return { id };
  }

  function getJob(id) {
    return jobs.get(String(id || '')) || null;
  }

  function updateJob(id, patch) {
    const job = getJob(id);

    if (!job) {
      return null;
    }

    const current = now();

    if (!job.startedAt) {
      job.startedAt = current;
    }

    job.status = patch.status || job.status;
    job.progress = clampProgress(patch.progress ?? job.progress);
    job.stage = String(patch.stage || job.stage || '');
    job.detail = String(patch.detail || '');
    job.updatedAt = current;

    return snapshotJob(job, current);
  }

  function completeJob(id, { html = '', detail = '' } = {}) {
    const job = getJob(id);

    if (!job) {
      return null;
    }

    const current = now();

    job.status = 'done';
    job.progress = 100;
    job.stage = 'Готово';
    job.detail = String(detail || '');
    job.html = String(html || '');
    job.error = undefined;
    job.updatedAt = current;

    return snapshotJob(job, current);
  }

  function failJob(id, error) {
    const job = getJob(id);

    if (!job) {
      return null;
    }

    const current = now();

    job.status = 'failed';
    job.progress = 100;
    job.stage = 'Ошибка';
    job.detail = String(error || 'Не удалось проверить отчет.');
    job.error = String(error || 'Не удалось проверить отчет.');
    job.updatedAt = current;

    return snapshotJob(job, current);
  }

  function getSnapshot(id) {
    return snapshotJob(getJob(id), now());
  }

  function pruneExpired() {
    const current = now();
    let removed = 0;

    for (const [id, job] of jobs.entries()) {
      const terminal = job.status === 'done' || job.status === 'failed';

      if (terminal && current - job.updatedAt > ttlMs) {
        jobs.delete(id);
        removed += 1;
      }
    }

    return removed;
  }

  return {
    createJob,
    updateJob,
    completeJob,
    failJob,
    getSnapshot,
    pruneExpired
  };
}

module.exports = {
  createRequestReportJobStore
};
```

- [ ] **Step 4: Run the store tests to verify GREEN**

Run:

```bash
node --test test/requestReportJobStore.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add src/requestReportJobStore.js test/requestReportJobStore.test.js
git commit -m "Добавить хранилище задач проверки отчетов"
```

---

### Task 2: Progress Events From Report Analysis

**Files:**
- Modify: `src/requestReportMissingConfirmed.js`
- Modify: `test/requestReportMissingConfirmed.test.js`

- [ ] **Step 1: Write failing tests for analysis progress**

Append to `test/requestReportMissingConfirmed.test.js`:

```js
test('findRequestReportRowsWithoutConfirmedShift emits progress stages and batch details', async () => {
  const events = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      if (operation === 'request report confirmed shift lookup') {
        return [
          { external_id: 'confirmed-1', status: 'confirmed', workplace_id: 'wp-1' },
          { external_id: 'missing-1', status: 'cancelled', workplace_id: 'wp-2' }
        ];
      }

      return [];
    }
  };
  const rows = [
    { idLkk: 'confirmed-1', dateFrom: '2026-06-01', timeFrom: '09:00', startText: '2026-06-01 09:00', workplace: 'Точка А' },
    { idLkk: 'missing-1', dateFrom: '2026-06-01', timeFrom: '10:00', startText: '2026-06-01 10:00', workplace: 'Точка Б' },
    { idLkk: 'missing-2', dateFrom: '2026-06-01', timeFrom: '11:00', startText: '2026-06-01 11:00', workplace: 'Точка В' }
  ];

  await findRequestReportRowsWithoutConfirmedShift(client, rows, {
    batchSize: 2,
    onProgress: (event) => events.push(event)
  });

  assert.equal(events[0].stage, 'lookup-external-id');
  assert.equal(events[0].label, 'Поиск confirmed-смен по ID ЛКК');
  assert.equal(events[0].detail, 'Батч 1 из 2');
  assert.equal(events[1].detail, 'Батч 2 из 2');
  assert.ok(events.some((event) => event.stage === 'lookup-composite'));
  assert.ok(events.some((event) => event.stage === 'lookup-workplace'));
  assert.ok(events.every((event) => event.progress >= 0 && event.progress <= 95));
});

test('extractRequestsReportRowsFromSheetRows emits row extraction progress', () => {
  const events = [];

  extractRequestsReportRowsFromSheetRows([
    ['служебная строка'],
    [
      'ID ЛКК',
      'Организация',
      'Рабочая точка',
      'Адрес',
      'Сотрудник',
      'Дата запроса "с"',
      'Время запроса "с"',
      'Фактическая продолжительность запроса за вычетом перерыва'
    ],
    [101, 'ООО А', 'Точка А', 'Адрес А', 'Иванов Иван', '01.06.2026', '09:00', '7.5']
  ], {
    onProgress: (event) => events.push(event)
  });

  assert.deepEqual(events.map((event) => event.stage), ['extracting-rows']);
  assert.equal(events[0].label, 'Извлечение строк отчета');
  assert.equal(events[0].detail, 'Найдено строк: 1');
});
```

- [ ] **Step 2: Run the analysis tests to verify RED**

Run:

```bash
node --test test/requestReportMissingConfirmed.test.js
```

Expected: FAIL because `onProgress` is ignored and `extractRequestsReportRowsFromSheetRows` does not accept options.

- [ ] **Step 3: Add progress helpers**

In `src/requestReportMissingConfirmed.js`, add near constants:

```js
const PROGRESS_POINTS = {
  extractingRows: 20,
  lookupExternalIdStart: 20,
  lookupExternalIdEnd: 45,
  lookupCompositeStart: 45,
  lookupCompositeEnd: 60,
  lookupEmployeeStart: 60,
  lookupEmployeeEnd: 75,
  lookupEmployeeDateStart: 75,
  lookupEmployeeDateEnd: 85,
  lookupWorkplaceStart: 85,
  lookupWorkplaceEnd: 95
};

function emitProgress(onProgress, event) {
  if (typeof onProgress !== 'function') {
    return;
  }

  onProgress({
    stage: String(event.stage || ''),
    label: String(event.label || ''),
    detail: String(event.detail || ''),
    progress: Math.max(0, Math.min(95, Math.round(Number(event.progress) || 0)))
  });
}

function progressForBatch(start, end, batchIndex, totalBatches) {
  if (!Number.isInteger(totalBatches) || totalBatches <= 0) {
    return end;
  }

  return start + ((end - start) * (batchIndex + 1)) / totalBatches;
}

function batchDetail(batchIndex, totalBatches) {
  return `Батч ${batchIndex + 1} из ${totalBatches}`;
}
```

- [ ] **Step 4: Update row extraction progress**

Change the function signature:

```js
function extractRequestsReportRowsFromSheetRows(sheetRows, options = {}) {
```

Before `return { rows, warnings };`, add:

```js
  emitProgress(options.onProgress, {
    stage: 'extracting-rows',
    label: 'Извлечение строк отчета',
    detail: `Найдено строк: ${rows.length}`,
    progress: PROGRESS_POINTS.extractingRows
  });
```

Change `parseRequestsReportWorkbook` signature:

```js
function parseRequestsReportWorkbook(buffer, options = {}) {
```

At the start of `parseRequestsReportWorkbook`, after empty-buffer validation, add:

```js
  emitProgress(options.onProgress, {
    stage: 'reading-file',
    label: 'Чтение XLSX-файла',
    detail: 'Разбор структуры workbook',
    progress: 10
  });
```

Change its return line:

```js
  return extractRequestsReportRowsFromSheetRows(sheetRows, options);
```

- [ ] **Step 5: Update lookup functions to emit batch progress**

Change signatures:

```js
async function loadJobsForExternalIds(client, externalIds, batchSize = DEFAULT_BATCH_SIZE, onProgress) {
async function loadConfirmedCompositeKeys(client, candidates, batchSize = DEFAULT_BATCH_SIZE, onProgress) {
async function loadUniqueConfirmedCompositeEmployeeKeys(client, candidates, batchSize = DEFAULT_BATCH_SIZE, onProgress) {
async function loadUniqueConfirmedCompositeEmployeeDateKeys(client, candidates, batchSize = DEFAULT_BATCH_SIZE, onProgress) {
async function loadUniqueWorkplaceIdsByTechnicalName(client, technicalNames, batchSize = DEFAULT_BATCH_SIZE, onProgress) {
async function loadUniqueWorkplaceIdsByTechnicalNameAndDate(client, candidates, batchSize = DEFAULT_BATCH_SIZE, onProgress) {
```

Inside each function, assign chunks before the loop:

```js
  const batches = chunkValues(externalIds, batchSize);

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex];
```

For each function, emit after each ClickHouse response:

```js
    emitProgress(onProgress, {
      stage: 'lookup-external-id',
      label: 'Поиск confirmed-смен по ID ЛКК',
      detail: batchDetail(batchIndex, batches.length),
      progress: progressForBatch(PROGRESS_POINTS.lookupExternalIdStart, PROGRESS_POINTS.lookupExternalIdEnd, batchIndex, batches.length)
    });
```

Use these stage/label/range pairs in the other functions:

```js
{
  stage: 'lookup-composite',
  label: 'Сопоставление по дате, времени и точке',
  start: PROGRESS_POINTS.lookupCompositeStart,
  end: PROGRESS_POINTS.lookupCompositeEnd
}
{
  stage: 'lookup-employee',
  label: 'Сопоставление по исполнителю',
  start: PROGRESS_POINTS.lookupEmployeeStart,
  end: PROGRESS_POINTS.lookupEmployeeEnd
}
{
  stage: 'lookup-employee-date',
  label: 'Сопоставление по исполнителю без точного времени',
  start: PROGRESS_POINTS.lookupEmployeeDateStart,
  end: PROGRESS_POINTS.lookupEmployeeDateEnd
}
{
  stage: 'lookup-workplace',
  label: 'Подготовка CRM-ссылок',
  start: PROGRESS_POINTS.lookupWorkplaceStart,
  end: PROGRESS_POINTS.lookupWorkplaceEnd
}
```

For the two workplace lookup functions, both may use `lookup-workplace`; the first covers `85-90`, the second covers `90-95`.

- [ ] **Step 6: Pass `onProgress` from the public lookup function**

Inside `findRequestReportRowsWithoutConfirmedShift`, add:

```js
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
```

Pass it to each lookup call:

```js
    ? await loadJobsForExternalIds(client, externalIds, batchSize, onProgress)
```

Use the same pattern for composite, employee, employee-date and workplace lookup calls.

Before returning, emit:

```js
  emitProgress(onProgress, {
    stage: 'render-result',
    label: 'Сбор результата',
    detail: `Строк без confirmed: ${missingRows.length}`,
    progress: 95
  });
```

- [ ] **Step 7: Run the analysis tests to verify GREEN**

Run:

```bash
node --test test/requestReportMissingConfirmed.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

Run:

```bash
git add src/requestReportMissingConfirmed.js test/requestReportMissingConfirmed.test.js
git commit -m "Добавить прогресс в анализ проверки отчетов"
```

---

### Task 3: Reusable Result Fragment and Progress UI

**Files:**
- Modify: `src/render.js`
- Modify: `test/render.test.js`

- [ ] **Step 1: Write failing render tests**

In `test/render.test.js`, extend the existing `renderRequestReportMissingConfirmedPage renders upload form and requested result columns` test with:

```js
  assert.match(html, /data-request-report-async-form/);
  assert.match(html, /data-request-report-jobs-url="\/tools\/request-report-confirmed-check\/jobs"/);
  assert.match(html, /data-request-report-progress-panel hidden/);
  assert.match(html, /data-request-report-progress-bar/);
  assert.match(html, /data-request-report-progress-stage/);
  assert.match(html, /data-request-report-progress-eta/);
  assert.match(html, /function pollRequestReportJob/);
  assert.match(html, /fetch\(jobsUrl/);
```

Add a new import:

```js
  renderRequestReportMissingConfirmedResultSection,
```

Add a new test:

```js
test('renderRequestReportMissingConfirmedResultSection renders result fragment without full layout', () => {
  const html = renderRequestReportMissingConfirmedResultSection({
    filename: 'requests-report.xlsx',
    result: {
      summary: {
        totalRows: 1,
        rowsWithId: 1,
        checkedExternalIds: 1,
        confirmedRows: 0,
        missingConfirmedRows: 1
      },
      rows: [
        {
          organization: 'ООО Проверка',
          workplace: 'Точка 1',
          address: 'Адрес 1',
          employee: 'Иванов Иван',
          startText: '2026-06-01 09:00',
          actualDuration: '0'
        }
      ],
      warnings: []
    }
  });

  assert.match(html, /^<section class="section">/);
  assert.match(html, /Результат: requests-report\.xlsx/);
  assert.match(html, /ООО Проверка/);
  assert.doesNotMatch(html, /<!doctype html>/);
  assert.doesNotMatch(html, /<html lang="ru">/);
});
```

- [ ] **Step 2: Run render tests to verify RED**

Run:

```bash
node --test test/render.test.js
```

Expected: FAIL because the result fragment export and async progress markup do not exist.

- [ ] **Step 3: Export the reusable result fragment**

In `src/render.js`, add above `renderRequestReportMissingConfirmedPage`:

```js
function renderRequestReportMissingConfirmedResultSection({ filename = '', result = null } = {}) {
  if (!result) {
    return '';
  }

  return `<section class="section">
  <h2>Результат${filename ? `: ${escapeHtml(filename)}` : ''}</h2>
  ${renderRequestReportSummary(result.summary)}
  ${renderRequestReportWarnings(result.warnings)}
  ${renderRequestReportMissingConfirmedRows(result.rows)}
</section>`;
}
```

Change `renderRequestReportMissingConfirmedPage` result HTML:

```js
  const resultHtml = renderRequestReportMissingConfirmedResultSection({ filename, result });
```

Add the function to `module.exports`:

```js
  renderRequestReportMissingConfirmedResultSection,
```

- [ ] **Step 4: Add progress CSS**

Inside the main `<style>` block near `.request-report-filter`, add:

```css
    .request-report-progress {
      display: grid;
      gap: 8px;
      margin-top: 12px;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
    }

    .request-report-progress-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px 12px;
    }

    .request-report-progress-title {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-weight: 700;
    }

    .request-report-spinner {
      width: 14px;
      height: 14px;
      border: 2px solid #c7d4df;
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: request-report-spin 0.8s linear infinite;
    }

    .request-report-progress-track {
      height: 10px;
      overflow: hidden;
      border-radius: 999px;
      background: #e7edf3;
    }

    .request-report-progress-bar {
      width: 0;
      height: 100%;
      border-radius: inherit;
      background: var(--accent);
      transition: width 220ms ease;
    }

    .request-report-progress-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 14px;
      color: var(--muted);
      font-size: 13px;
    }

    @keyframes request-report-spin {
      to {
        transform: rotate(360deg);
      }
    }
```

- [ ] **Step 5: Add progress markup to the form**

In `renderRequestReportMissingConfirmedPage`, change the form opening tag:

```html
  <form class="filter-bar" action="/tools/request-report-confirmed-check" method="post" enctype="multipart/form-data" data-request-report-async-form data-request-report-jobs-url="/tools/request-report-confirmed-check/jobs">
```

After `</form>`, add:

```html
  <div class="request-report-progress" data-request-report-progress-panel hidden>
    <div class="request-report-progress-head">
      <div class="request-report-progress-title">
        <span class="request-report-spinner" aria-hidden="true"></span>
        <span data-request-report-progress-stage>Подготовка проверки</span>
      </div>
      <span class="technical-note" data-request-report-progress-percent>0%</span>
    </div>
    <div class="request-report-progress-track" aria-hidden="true">
      <div class="request-report-progress-bar" data-request-report-progress-bar></div>
    </div>
    <div class="request-report-progress-meta">
      <span data-request-report-progress-detail>Файл ожидает обработки</span>
      <span data-request-report-progress-eta>Оставшееся время уточняется</span>
    </div>
  </div>
  <div data-request-report-async-error></div>
  <div data-request-report-async-result></div>
```

- [ ] **Step 6: Add the polling script**

Add a function near `renderRequestReportDurationFilterScript`:

```js
function renderRequestReportProgressScript() {
  return `<script>
(function () {
  function formatEta(ms) {
    if (!Number.isFinite(ms) || ms <= 0) {
      return 'Оставшееся время уточняется';
    }

    var seconds = Math.ceil(ms / 1000);

    if (seconds < 60) {
      return 'Осталось примерно ' + seconds + ' сек';
    }

    return 'Осталось примерно ' + Math.ceil(seconds / 60) + ' мин';
  }

  function setText(root, selector, text) {
    var node = root.querySelector(selector);

    if (node) {
      node.textContent = text;
    }
  }

  function updateProgress(root, data) {
    var progress = Math.max(0, Math.min(100, Number(data.progress) || 0));
    var bar = root.querySelector('[data-request-report-progress-bar]');

    if (bar) {
      bar.style.width = progress + '%';
    }

    setText(root, '[data-request-report-progress-percent]', Math.round(progress) + '%');
    setText(root, '[data-request-report-progress-stage]', data.stage || 'Проверка отчета');
    setText(root, '[data-request-report-progress-detail]', data.detail || '');
    setText(root, '[data-request-report-progress-eta]', formatEta(data.estimatedRemainingMs));
  }

  function showInlineError(root, message) {
    var target = root.querySelector('[data-request-report-async-error]');

    if (target) {
      target.innerHTML = '<div class="inline-error">' + String(message || 'Не удалось проверить отчет.').replace(/[&<>"]/g, function (char) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char];
      }) + '</div>';
    }
  }

  function pollRequestReportJob(root, statusUrl) {
    fetch(statusUrl, { headers: { accept: 'application/json' } })
      .then(function (response) {
        return response.json().then(function (body) {
          return { response: response, body: body };
        });
      })
      .then(function (payload) {
        var data = payload.body || {};

        if (!payload.response.ok) {
          throw new Error(data.error || 'Статус проверки недоступен.');
        }

        updateProgress(root, data);

        if (data.status === 'done') {
          var result = root.querySelector('[data-request-report-async-result]');

          if (result) {
            result.innerHTML = data.html || '';
          }

          return;
        }

        if (data.status === 'failed') {
          showInlineError(root, data.error || data.detail || 'Не удалось проверить отчет.');
          return;
        }

        window.setTimeout(function () {
          pollRequestReportJob(root, statusUrl);
        }, 700);
      })
      .catch(function (error) {
        showInlineError(root, error && error.message ? error.message : 'Не удалось получить статус проверки.');
      });
  }

  document.addEventListener('submit', function (event) {
    var form = event.target && event.target.closest
      ? event.target.closest('[data-request-report-async-form]')
      : null;

    if (!form || typeof window.fetch !== 'function' || typeof window.FormData !== 'function') {
      return;
    }

    event.preventDefault();

    var root = form.parentElement;
    var panel = root.querySelector('[data-request-report-progress-panel]');
    var error = root.querySelector('[data-request-report-async-error]');
    var result = root.querySelector('[data-request-report-async-result]');
    var submit = form.querySelector('button[type="submit"]');
    var jobsUrl = form.getAttribute('data-request-report-jobs-url');

    if (panel) {
      panel.hidden = false;
    }

    if (error) {
      error.innerHTML = '';
    }

    if (result) {
      result.innerHTML = '';
    }

    if (submit) {
      submit.disabled = true;
    }

    updateProgress(root, {
      progress: 1,
      stage: 'Загрузка файла',
      detail: 'Передаем XLSX на сервер',
      estimatedRemainingMs: null
    });

    fetch(jobsUrl, {
      method: 'POST',
      body: new FormData(form),
      headers: { accept: 'application/json' }
    })
      .then(function (response) {
        return response.json().then(function (body) {
          return { response: response, body: body };
        });
      })
      .then(function (payload) {
        var data = payload.body || {};

        if (!payload.response.ok) {
          throw new Error(data.error || 'Не удалось запустить проверку.');
        }

        if (!data.jobId) {
          throw new Error('Сервер не вернул номер задачи.');
        }

        pollRequestReportJob(root, jobsUrl + '/' + encodeURIComponent(data.jobId));
      })
      .catch(function (error) {
        showInlineError(root, error && error.message ? error.message : 'Не удалось запустить проверку.');
      })
      .finally(function () {
        if (submit) {
          submit.disabled = false;
        }
      });
  });
})();
</script>`;
}
```

Append the script to `content` in `renderRequestReportMissingConfirmedPage`:

```js
${resultHtml}
${renderRequestReportProgressScript()}`;
```

- [ ] **Step 7: Run render tests to verify GREEN**

Run:

```bash
node --test test/render.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

Run:

```bash
git add src/render.js test/render.test.js
git commit -m "Добавить UI прогресса проверки отчетов"
```

---

### Task 4: Request Report Job Runner

**Files:**
- Create: `src/requestReportJobRunner.js`
- Create: `test/requestReportJobRunner.test.js`

- [ ] **Step 1: Write failing runner tests**

Create `test/requestReportJobRunner.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const { runRequestReportConfirmedCheckJob } = require('../src/requestReportJobRunner');

test('runRequestReportConfirmedCheckJob parses, checks and renders result html', async () => {
  const progress = [];
  const calls = [];
  const html = await runRequestReportConfirmedCheckJob({
    client: { queryJSONEachRow: async () => [] },
    fileBuffer: Buffer.from('xlsx-bytes'),
    filename: 'requests-report.xlsx',
    parseWorkbook: (buffer, options) => {
      calls.push(['parse', buffer.toString()]);
      options.onProgress({ stage: 'reading-file', label: 'Чтение XLSX-файла', detail: 'Разбор workbook', progress: 10 });

      return {
        rows: [{ idLkk: 'missing-id', workplace: 'Точка 1' }],
        warnings: ['Предупреждение парсинга']
      };
    },
    findMissingRows: async (client, rows, options) => {
      calls.push(['find', rows.length]);
      options.onProgress({ stage: 'lookup-external-id', label: 'Поиск confirmed-смен по ID ЛКК', detail: 'Батч 1 из 1', progress: 45 });

      return {
        rows,
        summary: {
          totalRows: 1,
          rowsWithId: 1,
          checkedExternalIds: 1,
          confirmedRows: 0,
          missingConfirmedRows: 1
        },
        warnings: ['Предупреждение поиска']
      };
    },
    renderResult: ({ filename, result }) => {
      calls.push(['render', filename, result.warnings.length]);
      return `<section>${filename}: ${result.warnings.join(', ')}</section>`;
    },
    onProgress: (event) => progress.push(event)
  });

  assert.equal(html, '<section>requests-report.xlsx: Предупреждение парсинга, Предупреждение поиска</section>');
  assert.deepEqual(calls, [
    ['parse', 'xlsx-bytes'],
    ['find', 1],
    ['render', 'requests-report.xlsx', 2]
  ]);
  assert.deepEqual(progress.map((event) => event.stage), ['reading-file', 'lookup-external-id', 'render-result']);
  assert.equal(progress.at(-1).progress, 95);
});
```

- [ ] **Step 2: Run runner tests to verify RED**

Run:

```bash
node --test test/requestReportJobRunner.test.js
```

Expected: FAIL with `Cannot find module '../src/requestReportJobRunner'`.

- [ ] **Step 3: Implement the runner**

Create `src/requestReportJobRunner.js`:

```js
const {
  findRequestReportRowsWithoutConfirmedShift,
  parseRequestsReportWorkbook
} = require('./requestReportMissingConfirmed');
const {
  renderRequestReportMissingConfirmedResultSection
} = require('./render');

async function runRequestReportConfirmedCheckJob({
  client,
  fileBuffer,
  filename,
  onProgress,
  parseWorkbook = parseRequestsReportWorkbook,
  findMissingRows = findRequestReportRowsWithoutConfirmedShift,
  renderResult = renderRequestReportMissingConfirmedResultSection
}) {
  const progress = typeof onProgress === 'function' ? onProgress : () => {};
  const parsed = parseWorkbook(fileBuffer, { onProgress: progress });
  const lookup = await findMissingRows(client, parsed.rows, { onProgress: progress });
  const result = {
    ...lookup,
    warnings: [
      ...(Array.isArray(parsed.warnings) ? parsed.warnings : []),
      ...(Array.isArray(lookup.warnings) ? lookup.warnings : [])
    ]
  };

  progress({
    stage: 'render-result',
    label: 'Сбор результата',
    detail: `Строк без confirmed: ${result.summary ? result.summary.missingConfirmedRows || 0 : 0}`,
    progress: 95
  });

  return renderResult({ filename, result });
}

module.exports = {
  runRequestReportConfirmedCheckJob
};
```

- [ ] **Step 4: Run runner tests to verify GREEN**

Run:

```bash
node --test test/requestReportJobRunner.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add src/requestReportJobRunner.js test/requestReportJobRunner.test.js
git commit -m "Добавить runner проверки отчетов"
```

---

### Task 5: Async Server Endpoints

**Files:**
- Modify: `src/server.js`
- Modify: `test/server.test.js`

- [ ] **Step 1: Write failing server tests for async jobs**

Add helper near existing multipart upload test in `test/server.test.js`:

```js
function multipartBody({ boundary, fields = {}, files = [] }) {
  const parts = [];

  for (const [name, value] of Object.entries(fields)) {
    parts.push(`--${boundary}`);
    parts.push(`Content-Disposition: form-data; name="${name}"`);
    parts.push('');
    parts.push(String(value));
  }

  for (const file of files) {
    parts.push(`--${boundary}`);
    parts.push(`Content-Disposition: form-data; name="${file.name}"; filename="${file.filename}"`);
    parts.push(`Content-Type: ${file.contentType || 'application/octet-stream'}`);
    parts.push('');
    parts.push(file.body);
  }

  parts.push(`--${boundary}--`);
  parts.push('');

  return parts.join('\r\n');
}
```

Add tests:

```js
test('request report async job endpoint starts job and exposes completed status', async () => {
  const client = createFakeClient();
  const runnerCalls = [];

  await withServer(client, async (baseUrl) => {
    const boundary = '----request-report-async-boundary';
    const body = multipartBody({
      boundary,
      fields: { csrfToken: '' },
      files: [
        {
          name: 'reportFile',
          filename: 'requests-report.xlsx',
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          body: 'fake-xlsx'
        }
      ]
    });
    const started = await fetchText(baseUrl, '/tools/request-report-confirmed-check/jobs', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': `multipart/form-data; boundary=${boundary}`
      },
      body
    });
    const startJson = JSON.parse(started.text);

    assert.equal(started.response.status, 202);
    assert.match(startJson.jobId, /^request-report-/);

    let statusJson = null;

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const status = await fetchText(baseUrl, `/tools/request-report-confirmed-check/jobs/${startJson.jobId}`, {
        headers: { accept: 'application/json' }
      });

      statusJson = JSON.parse(status.text);

      if (statusJson.status === 'done') {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    assert.equal(statusJson.status, 'done');
    assert.equal(statusJson.progress, 100);
    assert.match(statusJson.html, /async result/);
  }, baseConfig(), {
    requestReportJobRunner: async ({ file, filename, onProgress }) => {
      runnerCalls.push([filename, file.buffer.toString()]);
      onProgress({ stage: 'reading-file', label: 'Чтение XLSX-файла', detail: 'Разбор workbook', progress: 10 });
      return '<section>async result</section>';
    }
  });

  assert.deepEqual(runnerCalls, [['requests-report.xlsx', 'fake-xlsx']]);
});

test('request report async job endpoint returns json validation errors', async () => {
  const client = createFakeClient();

  await withServer(client, async (baseUrl) => {
    const boundary = '----request-report-invalid-boundary';
    const body = multipartBody({
      boundary,
      fields: { csrfToken: '' },
      files: [
        {
          name: 'reportFile',
          filename: 'requests-report.csv',
          contentType: 'text/csv',
          body: 'id,name'
        }
      ]
    });
    const response = await fetchText(baseUrl, '/tools/request-report-confirmed-check/jobs', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': `multipart/form-data; boundary=${boundary}`
      },
      body
    });
    const json = JSON.parse(response.text);

    assert.equal(response.response.status, 400);
    assert.equal(json.error, 'Поддерживаются только XLSX-файлы.');
  });
});

test('request report async status endpoint returns 404 for unknown job', async () => {
  const client = createFakeClient();

  await withServer(client, async (baseUrl) => {
    const response = await fetchText(baseUrl, '/tools/request-report-confirmed-check/jobs/missing-job', {
      headers: { accept: 'application/json' }
    });
    const json = JSON.parse(response.text);

    assert.equal(response.response.status, 404);
    assert.equal(json.error, 'Задача проверки не найдена.');
  });
});
```

- [ ] **Step 2: Run server tests to verify RED**

Run:

```bash
node --test test/server.test.js
```

Expected: FAIL because `/tools/request-report-confirmed-check/jobs` routes do not exist.

- [ ] **Step 3: Import job dependencies in `src/server.js`**

Add imports near the request report imports:

```js
const { createRequestReportJobStore } = require('./requestReportJobStore');
const { runRequestReportConfirmedCheckJob } = require('./requestReportJobRunner');
```

- [ ] **Step 4: Add injectable job dependencies to `createApp`**

In `createApp` parameter destructuring, keep `now = () => new Date()` before the new defaults and add:

```js
  now = () => new Date(),
  requestReportJobStore = createRequestReportJobStore({ now: () => now().getTime() }),
  requestReportJobRunner = runRequestReportConfirmedCheckJob,
  setImmediateFn = setImmediate
```

Add helper inside `createApp` near `sendError`:

```js
  function sendJsonError(res, statusCode, message) {
    res
      .status(statusCode)
      .type('json')
      .send({ error: sanitizeForResponse(message, config) });
  }

  function verifyJsonCsrf(req, res) {
    if (!authEnabled) {
      return true;
    }

    const expected = req.auth && req.auth.session && req.auth.session.csrfToken;
    const actual = req.body && req.body.csrfToken;

    if (actual === expected) {
      return true;
    }

    sendJsonError(res, 403, 'Неверный CSRF-токен.');
    return false;
  }
```

- [ ] **Step 5: Add async job routes**

Insert before the existing synchronous `app.post('/tools/request-report-confirmed-check', ...)` route:

```js
  app.post(
    '/tools/request-report-confirmed-check/jobs',
    requireAuth('request-report-matching'),
    asyncRoute(async (req, res) => {
      let form;

      try {
        form = await parseMultipartFormData(req, { maxBytes: 10 * 1024 * 1024 });
      } catch (error) {
        sendJsonError(res, statusCodeFromError(error), error && error.message);
        return;
      }

      req.body = form.fields || {};

      if (!verifyJsonCsrf(req, res)) {
        return;
      }

      const file = form.files && form.files.reportFile;
      const filename = file && file.filename ? file.filename : '';

      if (!file || !file.buffer || file.buffer.length === 0) {
        sendJsonError(res, 400, 'Выберите XLSX-файл.');
        return;
      }

      if (!filename.toLowerCase().endsWith('.xlsx')) {
        sendJsonError(res, 400, 'Поддерживаются только XLSX-файлы.');
        return;
      }

      const job = requestReportJobStore.createJob();

      requestReportJobStore.updateJob(job.id, {
        status: 'queued',
        progress: 1,
        stage: 'Файл принят',
        detail: 'Ожидает запуска анализа'
      });

      setImmediateFn(async () => {
        try {
          const html = await requestReportJobRunner({
            client,
            file,
            fileBuffer: file.buffer,
            filename,
            onProgress: (event) => {
              requestReportJobStore.updateJob(job.id, {
                status: 'running',
                progress: event.progress,
                stage: event.label || event.stage,
                detail: event.detail
              });
            }
          });

          requestReportJobStore.completeJob(job.id, {
            html,
            detail: 'Проверка завершена'
          });
        } catch (error) {
          requestReportJobStore.failJob(job.id, sanitizeForResponse(error && error.message, config));
        }
      });

      res.status(202).json({ jobId: job.id });
    })
  );

  app.get(
    '/tools/request-report-confirmed-check/jobs/:jobId',
    requireAuth('request-report-matching'),
    asyncRoute(async (req, res) => {
      requestReportJobStore.pruneExpired();

      const snapshot = requestReportJobStore.getSnapshot(req.params.jobId);

      if (!snapshot) {
        sendJsonError(res, 404, 'Задача проверки не найдена.');
        return;
      }

      res.status(200).json(snapshot);
    })
  );
```

- [ ] **Step 6: Confirm CSRF failures on JSON route return JSON**

Confirm the async `POST /tools/request-report-confirmed-check/jobs` route uses `verifyJsonCsrf(req, res)`. Keep the existing `verifyCsrf` call in the synchronous HTML route unchanged.

- [ ] **Step 7: Run server tests to verify GREEN**

Run:

```bash
node --test test/server.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit Task 5**

Run:

```bash
git add src/server.js test/server.test.js
git commit -m "Добавить async endpoint проверки отчетов"
```

---

### Task 6: Auth Coverage for Async Endpoints

**Files:**
- Modify: `test/serverAuth.test.js`

- [ ] **Step 1: Write failing auth tests**

Append to `test/serverAuth.test.js`:

```js
test('request report async endpoints require request-report-matching permission', async () => {
  await withAuthServer(async ({ baseUrl, userStore }) => {
    await userStore.createUser({
      email: 'analyst@example.test',
      name: 'Аналитик',
      role: 'analyst',
      password: 'AnalystPass123!',
      permissions: ['tables']
    });

    const login = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
      body: new URLSearchParams({
        email: 'analyst@example.test',
        password: 'AnalystPass123!'
      })
    });
    const cookie = login.headers.get('set-cookie');
    const status = await fetch(`${baseUrl}/tools/request-report-confirmed-check/jobs/missing-job`, {
      headers: {
        cookie,
        accept: 'application/json'
      }
    });

    assert.equal(status.status, 403);
  });
});
```

- [ ] **Step 2: Run auth tests to verify RED or existing pass**

Run:

```bash
node --test test/serverAuth.test.js
```

Expected before Task 5: FAIL with 404 or route absence. Expected after Task 5 if auth middleware is correct: PASS. If it passes immediately after adding the test, keep it as regression coverage.

- [ ] **Step 3: Fix route auth if needed**

If the test fails with `200` or `404`, confirm both async routes use:

```js
requireAuth('request-report-matching')
```

No production change is needed if the test already passes.

- [ ] **Step 4: Commit Task 6**

Run:

```bash
git add test/serverAuth.test.js src/server.js
git commit -m "Покрыть права async проверки отчетов"
```

If `src/server.js` did not change in this task, run:

```bash
git add test/serverAuth.test.js
git commit -m "Покрыть права async проверки отчетов"
```

---

### Task 7: Full Verification and Cleanup

**Files:**
- Verify all files changed in Tasks 1-6.

- [ ] **Step 1: Run focused tests**

Run:

```bash
node --test test/requestReportJobStore.test.js test/requestReportMissingConfirmed.test.js test/requestReportJobRunner.test.js test/render.test.js test/server.test.js test/serverAuth.test.js
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Inspect final diff**

Run:

```bash
git diff --stat HEAD
git diff -- src/requestReportJobStore.js src/requestReportJobRunner.js src/requestReportMissingConfirmed.js src/render.js src/server.js test/requestReportJobStore.test.js test/requestReportJobRunner.test.js test/requestReportMissingConfirmed.test.js test/render.test.js test/server.test.js test/serverAuth.test.js
```

Expected:

- no `.env`, `data/`, XLSX files or generated runtime artifacts;
- no unrelated brand-analysis, auth, SQL metric or README changes staged by this work;
- async route preserves the existing sync POST fallback;
- result HTML in async status is a fragment, not a full page.

- [ ] **Step 4: Manual browser check**

Run:

```bash
npm start
```

Open:

```text
http://localhost:3000/tools/request-report-confirmed-check
```

Check:

- the form still shows `Файл отчета` and `Проверить`;
- selecting an `.xlsx` starts progress without full page reload;
- progress panel shows stage, detail, percent and ETA;
- final result appears under the form;
- non-XLSX upload shows inline error;
- if JavaScript is disabled, the form action still posts to `/tools/request-report-confirmed-check`.

- [ ] **Step 5: Commit final verification note if fixes were required**

If Task 7 required code or test fixes, commit only those files:

```bash
git add src/requestReportJobStore.js src/requestReportJobRunner.js src/requestReportMissingConfirmed.js src/render.js src/server.js test/requestReportJobStore.test.js test/requestReportJobRunner.test.js test/requestReportMissingConfirmed.test.js test/render.test.js test/server.test.js test/serverAuth.test.js
git commit -m "Завершить прогресс проверки отчетов"
```

If Task 7 only ran verification and changed no files, do not create an empty commit.

---

## Self-Review Checklist

- Spec coverage: async job launch, polling status, real progress stages, ETA, progress animation, fallback sync POST, TTL cleanup, no disk writes and auth/CSRF are covered by Tasks 1-6.
- Placeholder scan: the plan contains concrete paths, commands, expected failures and implementation snippets for each task.
- Type consistency: `jobId`, `status`, `progress`, `stage`, `detail`, `estimatedRemainingMs`, `html` and `error` are used consistently across store, server and UI.
- Testing sequence: every production change has a failing test step before implementation.
