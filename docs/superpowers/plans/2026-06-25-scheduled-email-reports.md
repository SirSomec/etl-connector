# Scheduled Email Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build scheduled email delivery for administrator-created SQL reports, with Excel `.xlsx` attachments, separate author/delivery/admin permissions, SMTP settings, send history, and 60-day file downloads.

**Architecture:** Add a focused scheduled-reports subsystem beside the existing preload and request-report modules. Persist report definitions, schedules, SMTP settings, runs, and file metadata in `data/scheduled-reports.sqlite`; store generated `.xlsx` files in `data/scheduled-report-files`; expose server-rendered management screens through `src/server.js` and `src/render.js`.

**Tech Stack:** Node.js 22, Express 4, `node:test`, `node:sqlite`, existing ClickHouse client, extracted internal XLSX ZIP writer, `nodemailer` for SMTP transport.

---

## File Structure

- Create `src/xlsxWorkbook.js`: generic safe `.xlsx` workbook writer extracted from the existing request-report workbook code.
- Modify `src/requestReportMissingConfirmed.js`: import `buildXlsxWorkbook` from `xlsxWorkbook.js` instead of owning generic ZIP/XLSX internals.
- Create `test/xlsxWorkbook.test.js`: verifies workbook can round-trip through existing parser and formula-like strings are escaped.
- Create `src/scheduledReportSql.js`: validate SQL, reject mutations and multiple statements, wrap query with an external `LIMIT`, normalize row/timeout limits.
- Create `test/scheduledReportSql.test.js`: unit tests for accepted selects, rejected mutations, rejected multi-statements, and limit wrapping.
- Create `src/scheduledReportStore.js`: SQLite store for reports, schedules, runs, SMTP settings, retention, and file metadata.
- Create `test/scheduledReportStore.test.js`: store schema, CRUD, run lifecycle, SMTP password behavior, and retention tests.
- Create `src/scheduledReportMailer.js`: SMTP adapter using `nodemailer`, with dependency injection for tests and sanitized errors.
- Create `test/scheduledReportMailer.test.js`: mock transport success and failure without leaking password.
- Create `src/scheduledReportRunner.js`: executes SQL, writes `.xlsx`, sends mail, and records run status.
- Create `test/scheduledReportRunner.test.js`: success, SQL failure, file-created SMTP failure, file-size limit, formula escaping.
- Create `src/scheduledReportScheduler.js`: daily `HH:mm Europe/Moscow` timer, reschedule, drain, stop, and parallel-run prevention.
- Create `test/scheduledReportScheduler.test.js`: scheduling, disabled schedules, manual run delegation, duplicate-run guard.
- Create `src/scheduledReportService.js`: facade used by routes and startup wiring; owns store, scheduler, runner, and close lifecycle.
- Create `test/scheduledReportService.test.js`: facade delegation and idempotent close.
- Modify `src/auth.js`: add `scheduled-report-author`, `scheduled-report-delivery`, and `mail-settings-admin`; exclude `mail-settings-admin` from analyst-selectable permissions.
- Modify `test/auth.test.js`: assert admin has all new permissions, analyst can receive author/delivery, analyst cannot receive mail settings.
- Modify `src/config.js`: add scheduled-report config defaults and env parsing.
- Modify `test/config.test.js`: assert defaults and invalid numeric env handling.
- Modify `src/render.js`: add nav items, scheduled-report pages, SMTP settings page, permission-aware forms, and compact history table.
- Modify `test/render.test.js` and `test/renderAuth.test.js`: render forms based on permissions and hide SMTP from analysts.
- Modify `src/server.js`: wire service startup/close, routes, CSRF, downloads, activity events, sanitization, and route permissions.
- Modify `test/serverAuth.test.js` and `test/server.test.js`: route-level permissions, downloads, SMTP admin-only, and activity events.
- Modify `package.json` and `package-lock.json`: add `nodemailer`.
- Modify `.env.example` and `README.md`: document scheduled report runtime paths, SMTP UI, retention, and Docker `data` write permissions.

---

### Task 1: Permissions And Configuration

**Files:**
- Modify: `src/auth.js`
- Modify: `src/config.js`
- Modify: `test/auth.test.js`
- Modify: `test/config.test.js`
- Modify: `.env.example`

- [ ] **Step 1: Write failing auth tests for new permissions**

Add to `test/auth.test.js`:

```js
test('scheduled report permissions are normalized for admins and analysts', async () => {
  const store = createUserStore({
    filePath: await tempStorePath(),
    adminEmail: 'admin@example.test',
    adminPassword: 'AdminPass123!',
    passwordHashOptions: { iterations: 1000, salt: '0123456789abcdef' }
  });

  const admin = await store.findByEmail('admin@example.test');
  const analyst = await store.createUser({
    email: 'reports@example.test',
    name: 'Reports Analyst',
    role: 'analyst',
    permissions: [
      'scheduled-report-author',
      'scheduled-report-delivery',
      'mail-settings-admin'
    ],
    password: 'ReportsPass123!'
  });

  assert.equal(admin.permissions.includes('scheduled-report-author'), true);
  assert.equal(admin.permissions.includes('scheduled-report-delivery'), true);
  assert.equal(admin.permissions.includes('mail-settings-admin'), true);
  assert.deepEqual(analyst.permissions, [
    'scheduled-report-author',
    'scheduled-report-delivery'
  ]);
});
```

- [ ] **Step 2: Run auth test and verify it fails**

Run: `node --test test/auth.test.js`

Expected: FAIL because the new permission ids are not known and admin permissions do not include them.

- [ ] **Step 3: Add permission definitions and analyst exclusion**

In `src/auth.js`, add to `PERMISSION_DEFINITIONS`:

```js
{
  id: 'scheduled-report-author',
  label: 'SQL отчеты',
  description: 'Создание, редактирование и проверка SQL-отчетов для регулярной рассылки.'
},
{
  id: 'scheduled-report-delivery',
  label: 'Рассылки отчетов',
  description: 'Расписания, получатели, история отправки и скачивание отправленных Excel-файлов.'
},
{
  id: 'mail-settings-admin',
  label: 'SMTP настройки',
  description: 'Администраторская настройка SMTP и тестовая отправка.'
}
```

Change analyst-selectable permissions:

```js
const ANALYST_PERMISSION_IDS = ALL_PERMISSION_IDS.filter((permission) => ![
  'users',
  'mail-settings-admin'
].includes(permission));
```

- [ ] **Step 4: Write failing config tests**

Add to `test/config.test.js`:

```js
test('scheduled report config uses safe defaults', () => {
  const config = loadConfig(requiredEnv());

  assert.equal(config.scheduledReports.storePath.endsWith('data/scheduled-reports.sqlite'), true);
  assert.equal(config.scheduledReports.fileDir.endsWith('data/scheduled-report-files'), true);
  assert.equal(config.scheduledReports.retentionDays, 60);
  assert.equal(config.scheduledReports.defaultRowLimit, 10000);
  assert.equal(config.scheduledReports.maxRowLimit, 100000);
  assert.equal(config.scheduledReports.maxFileSizeBytes, 10485760);
  assert.equal(config.scheduledReports.queryTimeoutMs, 120000);
});

test('scheduled report numeric config validates ranges', () => {
  assert.throws(
    () => loadConfig({ ...requiredEnv(), SCHEDULED_REPORT_RETENTION_DAYS: '0' }),
    /SCHEDULED_REPORT_RETENTION_DAYS must be between 1 and 3650/
  );
  assert.throws(
    () => loadConfig({ ...requiredEnv(), SCHEDULED_REPORT_MAX_ROW_LIMIT: 'abc' }),
    /SCHEDULED_REPORT_MAX_ROW_LIMIT must be an integer/
  );
});
```

- [ ] **Step 5: Run config test and verify it fails**

Run: `node --test test/config.test.js`

Expected: FAIL because `config.scheduledReports` is undefined.

- [ ] **Step 6: Implement scheduled report config**

In `src/config.js`, add defaults near other `DEFAULT_*` constants:

```js
const DEFAULT_SCHEDULED_REPORT_STORE_PATH = path.join(process.cwd(), 'data', 'scheduled-reports.sqlite');
const DEFAULT_SCHEDULED_REPORT_FILE_DIR = path.join(process.cwd(), 'data', 'scheduled-report-files');
```

Add to `loadConfig()` return value:

```js
scheduledReports: {
  storePath: env.SCHEDULED_REPORT_STORE_PATH || DEFAULT_SCHEDULED_REPORT_STORE_PATH,
  fileDir: env.SCHEDULED_REPORT_FILE_DIR || DEFAULT_SCHEDULED_REPORT_FILE_DIR,
  retentionDays: readPositiveInt(env, 'SCHEDULED_REPORT_RETENTION_DAYS', 60, 3650),
  defaultRowLimit: readPositiveInt(env, 'SCHEDULED_REPORT_DEFAULT_ROW_LIMIT', 10000, 1000000),
  maxRowLimit: readPositiveInt(env, 'SCHEDULED_REPORT_MAX_ROW_LIMIT', 100000, 1000000),
  maxFileSizeBytes: readPositiveInt(env, 'SCHEDULED_REPORT_MAX_FILE_SIZE_BYTES', 10485760, 104857600),
  queryTimeoutMs: readPositiveInt(env, 'SCHEDULED_REPORT_QUERY_TIMEOUT_MS', 120000, 600000)
}
```

Add the same env keys with non-secret defaults to `.env.example`.

- [ ] **Step 7: Run focused tests**

Run: `node --test test/auth.test.js test/config.test.js`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/auth.js src/config.js test/auth.test.js test/config.test.js .env.example
git commit -m "Добавить права и конфиг регулярных отчетов"
```

---

### Task 2: Generic XLSX Workbook Writer

**Files:**
- Create: `src/xlsxWorkbook.js`
- Modify: `src/requestReportMissingConfirmed.js`
- Create: `test/xlsxWorkbook.test.js`
- Modify: `test/requestReportMissingConfirmed.test.js`

- [ ] **Step 1: Write failing XLSX tests**

Create `test/xlsxWorkbook.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildXlsxWorkbook } = require('../src/xlsxWorkbook');
const { parseRequestsReportWorkbook } = require('../src/requestReportMissingConfirmed');

test('generic xlsx workbook writes headers and rows', () => {
  const workbook = buildXlsxWorkbook({
    sheetName: 'Отчет',
    headers: ['client', 'shifts'],
    rows: [
      ['Brand A', 12],
      ['Brand B', 5]
    ]
  });

  assert.equal(Buffer.isBuffer(workbook), true);
  assert.equal(workbook.readUInt32LE(0), 0x04034b50);
});

test('xlsx workbook escapes formula-like text values', () => {
  const workbook = buildXlsxWorkbook({
    sheetName: 'Запросы',
    headers: ['ID ЛКК', 'Организация', 'Рабочая точка', 'Адрес', 'Сотрудник', 'Дата запроса с', 'Время запроса с'],
    rows: [
      ['1', '=cmd|A1', '+SUM(1,1)', '-10', '@handle', '2026-06-01', '09:00']
    ]
  });
  const parsed = parseRequestsReportWorkbook(workbook);

  assert.equal(parsed.rows[0].organization, "'=cmd|A1");
  assert.equal(parsed.rows[0].workplace, "'+SUM(1,1)");
  assert.equal(parsed.rows[0].address, "'-10");
  assert.equal(parsed.rows[0].employee, "'@handle");
});
```

- [ ] **Step 2: Run XLSX test and verify it fails**

Run: `node --test test/xlsxWorkbook.test.js`

Expected: FAIL with `Cannot find module '../src/xlsxWorkbook'`.

- [ ] **Step 3: Extract generic XLSX writer**

Create `src/xlsxWorkbook.js` by moving these existing generic helpers from `src/requestReportMissingConfirmed.js`:

```js
crc32
dosDateTime
zipLocalHeader
zipCentralHeader
zipEndOfCentralDirectory
buildZip
escapeXml
columnName
worksheetCellXml
worksheetRowXml
workbookXmlRows
```

Expose this public function:

```js
function sanitizeExcelCell(value) {
  if (value === undefined || value === null) {
    return '';
  }

  const text = value instanceof Date ? value.toISOString() : String(value);

  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function buildXlsxWorkbook({ headers = [], rows = [], sheetName = 'Отчет' } = {}) {
  const workbookRows = [
    headers.map(sanitizeExcelCell),
    ...rows.map((row) => (Array.isArray(row) ? row : headers.map((header) => row && row[header])).map(sanitizeExcelCell))
  ];

  return buildXlsxRows(workbookRows, sheetName);
}

module.exports = {
  buildXlsxWorkbook,
  sanitizeExcelCell
};
```

Keep an internal `buildXlsxRows(rows, sheetName)` function containing the existing workbook XML and ZIP assembly logic.

- [ ] **Step 4: Update request-report workbook builder to reuse generic writer**

In `src/requestReportMissingConfirmed.js`, replace the local `buildXlsxWorkbook(rows, sheetName)` helper with:

```js
const { buildXlsxWorkbook: buildGenericXlsxWorkbook } = require('./xlsxWorkbook');
```

Change `buildRequestReportCheckWorkbook()` return:

```js
return buildGenericXlsxWorkbook({
  sheetName: 'Запросы',
  headers: workbookRows[0],
  rows: workbookRows.slice(1)
});
```

Remove generic ZIP/XLSX helper functions from `requestReportMissingConfirmed.js` after extraction.

- [ ] **Step 5: Run focused tests**

Run: `node --test test/xlsxWorkbook.test.js test/requestReportMissingConfirmed.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/xlsxWorkbook.js src/requestReportMissingConfirmed.js test/xlsxWorkbook.test.js test/requestReportMissingConfirmed.test.js
git commit -m "Вынести генератор Excel workbook"
```

---

### Task 3: SQL Validation And Query Wrapping

**Files:**
- Create: `src/scheduledReportSql.js`
- Create: `test/scheduledReportSql.test.js`

- [ ] **Step 1: Write failing SQL tests**

Create `test/scheduledReportSql.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assertSafeReportSql,
  normalizeReportLimits,
  wrapReportSql
} = require('../src/scheduledReportSql');

test('scheduled report SQL allows select and with select', () => {
  assert.equal(assertSafeReportSql('SELECT * FROM mg_jobs'), true);
  assert.equal(assertSafeReportSql('WITH x AS (SELECT 1) SELECT * FROM x'), true);
});

test('scheduled report SQL rejects mutations and multiple statements', () => {
  assert.throws(() => assertSafeReportSql('DELETE FROM mg_jobs'), /Only SELECT queries are allowed/);
  assert.throws(() => assertSafeReportSql('SELECT 1; SELECT 2'), /Multiple SQL statements are not allowed/);
  assert.throws(() => assertSafeReportSql('SELECT * FROM mg_jobs FORMAT JSONEachRow'), /FORMAT clause is managed by the application/);
});

test('wrapReportSql applies external limit and readonly settings', () => {
  const wrapped = wrapReportSql('SELECT _id, status FROM mg_jobs', { rowLimit: 100 });

  assert.match(wrapped.query, /SELECT \* FROM \(/);
  assert.match(wrapped.query, /LIMIT 100/);
  assert.deepEqual(wrapped.params, {});
  assert.deepEqual(wrapped.settings, { readonly: 1, max_result_rows: 100 });
});

test('normalizeReportLimits clamps unsafe values', () => {
  assert.deepEqual(
    normalizeReportLimits({ rowLimit: 200000, timeoutMs: 999999 }, {
      defaultRowLimit: 10000,
      maxRowLimit: 100000,
      queryTimeoutMs: 120000
    }),
    { rowLimit: 100000, timeoutMs: 120000 }
  );
});
```

- [ ] **Step 2: Run SQL tests and verify they fail**

Run: `node --test test/scheduledReportSql.test.js`

Expected: FAIL with missing module.

- [ ] **Step 3: Implement SQL module**

Create `src/scheduledReportSql.js`:

```js
const MUTATION_RE = /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE|RENAME|OPTIMIZE|SYSTEM|KILL|ATTACH|DETACH|GRANT|REVOKE)\b/i;

function normalizeSql(sql) {
  return String(sql || '').trim().replace(/;+\s*$/, '');
}

function hasMultipleStatements(sql) {
  return /;\s*\S/.test(String(sql || ''));
}

function assertSafeReportSql(sql) {
  const normalized = normalizeSql(sql);

  if (!/^(SELECT|WITH)\b/i.test(normalized)) {
    throw new Error('Only SELECT queries are allowed');
  }
  if (hasMultipleStatements(sql)) {
    throw new Error('Multiple SQL statements are not allowed');
  }
  if (MUTATION_RE.test(normalized)) {
    throw new Error('Only read-only SELECT queries are allowed');
  }
  if (/\bFORMAT\b/i.test(normalized)) {
    throw new Error('FORMAT clause is managed by the application');
  }

  return true;
}

function normalizeReportLimits(input = {}, config = {}) {
  const defaultRowLimit = Number(config.defaultRowLimit) || 10000;
  const maxRowLimit = Number(config.maxRowLimit) || 100000;
  const defaultTimeoutMs = Number(config.queryTimeoutMs) || 120000;
  const rowLimit = Math.max(1, Math.min(maxRowLimit, Number(input.rowLimit) || defaultRowLimit));
  const timeoutMs = Math.max(1, Math.min(defaultTimeoutMs, Number(input.timeoutMs) || defaultTimeoutMs));

  return { rowLimit, timeoutMs };
}

function wrapReportSql(sql, { rowLimit }) {
  assertSafeReportSql(sql);

  return {
    query: `SELECT * FROM (\n${normalizeSql(sql)}\n) AS scheduled_report_result\nLIMIT ${Number(rowLimit) || 10000}`,
    params: {},
    settings: {
      readonly: 1,
      max_result_rows: Number(rowLimit) || 10000
    }
  };
}

module.exports = {
  assertSafeReportSql,
  normalizeReportLimits,
  wrapReportSql
};
```

- [ ] **Step 4: Run SQL tests**

Run: `node --test test/scheduledReportSql.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scheduledReportSql.js test/scheduledReportSql.test.js
git commit -m "Добавить валидацию SQL отчетов"
```

---

### Task 4: Scheduled Report SQLite Store

**Files:**
- Create: `src/scheduledReportStore.js`
- Create: `test/scheduledReportStore.test.js`

- [ ] **Step 1: Write failing store tests**

Create `test/scheduledReportStore.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createScheduledReportStore } = require('../src/scheduledReportStore');

async function tempPaths() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scheduled-reports-'));
  return {
    dir,
    dbPath: path.join(dir, 'scheduled-reports.sqlite'),
    fileDir: path.join(dir, 'files')
  };
}

test('scheduled report store creates reports schedules and runs', async () => {
  const paths = await tempPaths();
  const store = createScheduledReportStore({
    filePath: paths.dbPath,
    fileDir: paths.fileDir,
    now: () => new Date('2026-06-25T06:00:00.000Z')
  });

  try {
    const report = store.createReport({
      title: 'Daily shifts',
      description: 'Confirmed shifts',
      sql: 'SELECT _id FROM mg_jobs',
      rowLimit: 500,
      timeoutMs: 60000,
      enabled: true,
      userId: 'user-1'
    });
    const schedule = store.createSchedule({
      reportId: report.id,
      enabled: true,
      scheduleTime: '09:30',
      timezone: 'Europe/Moscow',
      recipients: ['a@example.test', 'b@example.test'],
      emailSubject: 'Daily shifts',
      emailBody: 'Attached report',
      userId: 'user-1'
    });
    const run = store.startRun({
      reportId: report.id,
      scheduleId: schedule.id,
      trigger: 'manual',
      recipients: schedule.recipients,
      userId: 'user-1'
    });
    const finished = store.finishRun(run.id, {
      status: 'success',
      rowCount: 2,
      fileSizeBytes: 128,
      filePath: path.join(paths.fileDir, `${run.id}.xlsx`)
    });

    assert.equal(store.listReports()[0].title, 'Daily shifts');
    assert.equal(store.listSchedules(report.id)[0].recipients.length, 2);
    assert.equal(finished.status, 'success');
    assert.equal(store.listRuns({ reportId: report.id })[0].rowCount, 2);
  } finally {
    store.close();
    await fs.rm(paths.dir, { recursive: true, force: true });
  }
});

test('scheduled report store preserves SMTP password when update omits it', async () => {
  const paths = await tempPaths();
  const store = createScheduledReportStore({ filePath: paths.dbPath, fileDir: paths.fileDir });

  try {
    store.saveMailSettings({
      host: 'smtp.example.test',
      port: 465,
      secureMode: 'ssl',
      username: 'sender',
      password: 'Secret123!',
      fromEmail: 'sender@example.test',
      fromName: 'Reports'
    });
    store.saveMailSettings({
      host: 'smtp2.example.test',
      port: 587,
      secureMode: 'starttls',
      username: 'sender2',
      password: '',
      fromEmail: 'sender2@example.test',
      fromName: 'Reports 2'
    });

    const settings = store.getMailSettings();
    const secret = store.getMailSettingsSecret();

    assert.equal(settings.host, 'smtp2.example.test');
    assert.equal(settings.hasPassword, true);
    assert.equal(settings.password, undefined);
    assert.equal(secret.password, 'Secret123!');
  } finally {
    store.close();
    await fs.rm(paths.dir, { recursive: true, force: true });
  }
});

test('scheduled report store prunes runs and files older than retention', async () => {
  const paths = await tempPaths();
  let current = new Date('2026-06-25T00:00:00.000Z');
  const store = createScheduledReportStore({
    filePath: paths.dbPath,
    fileDir: paths.fileDir,
    now: () => current
  });

  try {
    const report = store.createReport({ title: 'R', sql: 'SELECT 1', userId: 'u' });
    const oldRun = store.startRun({ reportId: report.id, trigger: 'manual', recipients: [], userId: 'u' });
    const oldFile = path.join(paths.fileDir, `${oldRun.id}.xlsx`);
    await fs.mkdir(paths.fileDir, { recursive: true });
    await fs.writeFile(oldFile, 'old');
    store.finishRun(oldRun.id, { status: 'success', filePath: oldFile, fileSizeBytes: 3, rowCount: 1 });

    current = new Date('2026-08-25T00:00:00.000Z');
    const removed = await store.pruneOldRuns(60);

    assert.equal(removed.runs, 1);
    assert.equal(removed.files, 1);
    assert.equal(store.listRuns({ reportId: report.id }).length, 0);
    await assert.rejects(() => fs.stat(oldFile), /ENOENT/);
  } finally {
    store.close();
    await fs.rm(paths.dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run store tests and verify they fail**

Run: `node --test test/scheduledReportStore.test.js`

Expected: FAIL with missing module.

- [ ] **Step 3: Implement store schema and API**

Create `src/scheduledReportStore.js` with:

```js
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_SCHEDULED_REPORT_STORE_PATH = path.join(process.cwd(), 'data', 'scheduled-reports.sqlite');
const DEFAULT_SCHEDULED_REPORT_FILE_DIR = path.join(process.cwd(), 'data', 'scheduled-report-files');

function normalizeRecipients(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(/[,\n;]/);
  const recipients = [...new Set(list.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean))];

  for (const email of recipients) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error(`Invalid recipient email: ${email}`);
    }
  }

  return recipients;
}
```

Initialize tables:

```sql
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS scheduled_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sql TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  row_limit INTEGER NOT NULL DEFAULT 10000,
  timeout_ms INTEGER NOT NULL DEFAULT 120000,
  created_by TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduled_report_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  schedule_time TEXT NOT NULL DEFAULT '09:00',
  timezone TEXT NOT NULL DEFAULT 'Europe/Moscow',
  recipients_json TEXT NOT NULL DEFAULT '[]',
  email_subject TEXT NOT NULL DEFAULT '',
  email_body TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduled_report_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL,
  schedule_id INTEGER,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  file_size_bytes INTEGER NOT NULL DEFAULT 0,
  file_path TEXT NOT NULL DEFAULT '',
  recipients_json TEXT NOT NULL DEFAULT '[]',
  error_message TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS mail_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  host TEXT NOT NULL DEFAULT '',
  port INTEGER NOT NULL DEFAULT 587,
  secure_mode TEXT NOT NULL DEFAULT 'starttls',
  username TEXT NOT NULL DEFAULT '',
  password_secret TEXT NOT NULL DEFAULT '',
  from_email TEXT NOT NULL DEFAULT '',
  from_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scheduled_report_runs_report ON scheduled_report_runs (report_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_scheduled_report_runs_finished ON scheduled_report_runs (finished_at);
```

Expose these methods:

```js
createReport(input)
updateReport(reportId, input)
getReport(reportId)
listReports()
createSchedule(input)
updateSchedule(scheduleId, input)
getSchedule(scheduleId)
listSchedules(reportId)
listEnabledSchedules()
startRun(input)
finishRun(runId, input)
listRuns({ reportId, limit = 50 } = {})
getRun(runId)
saveMailSettings(input)
getMailSettings()
getMailSettingsSecret()
pruneOldRuns(retentionDays)
close()
```

Normalize row fields to camelCase on reads and keep `password_secret` out of `getMailSettings()`.

- [ ] **Step 4: Run store tests**

Run: `node --test test/scheduledReportStore.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scheduledReportStore.js test/scheduledReportStore.test.js
git commit -m "Добавить хранилище регулярных отчетов"
```

---

### Task 5: SMTP Mailer

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/scheduledReportMailer.js`
- Create: `test/scheduledReportMailer.test.js`

- [ ] **Step 1: Install SMTP dependency**

Run: `npm install nodemailer@^6.9.15`

Expected: `package.json` and `package-lock.json` include `nodemailer`.

- [ ] **Step 2: Write failing mailer tests**

Create `test/scheduledReportMailer.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const { createScheduledReportMailer, sanitizeMailError } = require('../src/scheduledReportMailer');

test('scheduled report mailer sends xlsx attachment through injected transport', async () => {
  const sent = [];
  const mailer = createScheduledReportMailer({
    createTransport() {
      return {
        async sendMail(message) {
          sent.push(message);
          return { messageId: 'msg-1' };
        }
      };
    }
  });

  const result = await mailer.sendReport({
    settings: {
      host: 'smtp.example.test',
      port: 465,
      secureMode: 'ssl',
      username: 'sender',
      password: 'Secret123!',
      fromEmail: 'sender@example.test',
      fromName: 'Reports'
    },
    recipients: ['a@example.test'],
    subject: 'Report',
    body: 'Attached',
    filename: 'report.xlsx',
    fileBuffer: Buffer.from('xlsx')
  });

  assert.equal(result.messageId, 'msg-1');
  assert.equal(sent[0].to, 'a@example.test');
  assert.equal(sent[0].attachments[0].filename, 'report.xlsx');
  assert.equal(sent[0].attachments[0].contentType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
});

test('sanitizeMailError redacts SMTP password and username', () => {
  const message = sanitizeMailError(
    new Error('auth failed for sender with Secret123!'),
    { username: 'sender', password: 'Secret123!' }
  );

  assert.equal(message.includes('Secret123!'), false);
  assert.equal(message.includes('sender'), false);
  assert.match(message, /\[redacted\]/);
});
```

- [ ] **Step 3: Run mailer tests and verify they fail**

Run: `node --test test/scheduledReportMailer.test.js`

Expected: FAIL with missing module.

- [ ] **Step 4: Implement mailer**

Create `src/scheduledReportMailer.js`:

```js
const nodemailer = require('nodemailer');

function secureFromMode(mode) {
  return mode === 'ssl';
}

function sanitizeMailError(error, settings = {}) {
  let message = String((error && error.message) || error || 'SMTP error');

  for (const secret of [settings.password, settings.username]) {
    if (secret) {
      message = message.split(String(secret)).join('[redacted]');
    }
  }

  return message;
}

function createScheduledReportMailer({ createTransport = nodemailer.createTransport } = {}) {
  return {
    async sendReport({ settings, recipients, subject, body, filename, fileBuffer }) {
      if (!settings || !settings.host || !settings.fromEmail) {
        throw new Error('SMTP is not configured');
      }

      const transport = createTransport({
        host: settings.host,
        port: Number(settings.port) || 587,
        secure: secureFromMode(settings.secureMode),
        auth: settings.username ? {
          user: settings.username,
          pass: settings.password || ''
        } : undefined
      });

      return transport.sendMail({
        from: settings.fromName ? `"${settings.fromName}" <${settings.fromEmail}>` : settings.fromEmail,
        to: recipients.join(', '),
        subject,
        text: body || '',
        attachments: [{
          filename,
          content: fileBuffer,
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        }]
      });
    }
  };
}

module.exports = {
  createScheduledReportMailer,
  sanitizeMailError
};
```

- [ ] **Step 5: Run mailer tests**

Run: `node --test test/scheduledReportMailer.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/scheduledReportMailer.js test/scheduledReportMailer.test.js
git commit -m "Добавить SMTP отправку отчетов"
```

---

### Task 6: Report Runner

**Files:**
- Create: `src/scheduledReportRunner.js`
- Create: `test/scheduledReportRunner.test.js`

- [ ] **Step 1: Write failing runner tests**

Create `test/scheduledReportRunner.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createScheduledReportRunner } = require('../src/scheduledReportRunner');
const { createScheduledReportStore } = require('../src/scheduledReportStore');

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scheduled-runner-'));
  const fileDir = path.join(dir, 'files');
  const store = createScheduledReportStore({
    filePath: path.join(dir, 'scheduled.sqlite'),
    fileDir,
    now: () => new Date('2026-06-25T07:00:00.000Z')
  });
  return { dir, fileDir, store };
}

test('runner executes query writes xlsx sends mail and records success', async () => {
  const { dir, fileDir, store } = await fixture();
  const sent = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      assert.equal(operation, 'scheduled report SQL');
      assert.match(query, /LIMIT 100/);
      return [{ client: 'Brand A', shifts: 12 }];
    }
  };
  const report = store.createReport({ title: 'Daily', sql: 'SELECT client, shifts FROM mg_jobs', rowLimit: 100, userId: 'u' });
  const schedule = store.createSchedule({
    reportId: report.id,
    enabled: true,
    scheduleTime: '09:00',
    recipients: ['a@example.test'],
    emailSubject: 'Daily',
    emailBody: 'Attached',
    userId: 'u'
  });
  store.saveMailSettings({
    host: 'smtp.example.test',
    port: 465,
    secureMode: 'ssl',
    username: 'sender',
    password: 'Secret123!',
    fromEmail: 'sender@example.test',
    fromName: 'Reports'
  });
  const runner = createScheduledReportRunner({
    client,
    store,
    fileDir,
    config: { defaultRowLimit: 10000, maxRowLimit: 100000, maxFileSizeBytes: 10485760, queryTimeoutMs: 120000 },
    mailer: {
      async sendReport(input) {
        sent.push(input);
        return { messageId: 'msg-1' };
      }
    }
  });

  try {
    const run = await runner.runSchedule({ scheduleId: schedule.id, trigger: 'manual', userId: 'u' });
    const file = await fs.readFile(run.filePath);

    assert.equal(run.status, 'success');
    assert.equal(run.rowCount, 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].recipients[0], 'a@example.test');
    assert.equal(file.readUInt32LE(0), 0x04034b50);
  } finally {
    store.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('runner keeps generated file when SMTP fails', async () => {
  const { dir, fileDir, store } = await fixture();
  const client = { async queryJSONEachRow() { return [{ value: '=formula' }]; } };
  const report = store.createReport({ title: 'R', sql: 'SELECT value FROM mg_jobs', userId: 'u' });
  const schedule = store.createSchedule({ reportId: report.id, recipients: ['a@example.test'], emailSubject: 'R', userId: 'u' });
  store.saveMailSettings({ host: 'smtp.example.test', port: 587, secureMode: 'starttls', username: 'sender', password: 'Secret123!', fromEmail: 'sender@example.test' });
  const runner = createScheduledReportRunner({
    client,
    store,
    fileDir,
    config: { defaultRowLimit: 10000, maxRowLimit: 100000, maxFileSizeBytes: 10485760, queryTimeoutMs: 120000 },
    mailer: { async sendReport() { throw new Error('SMTP Secret123! failed'); } },
    sanitizeError: (error) => String(error.message).replace('Secret123!', '[redacted]')
  });

  try {
    const run = await runner.runSchedule({ scheduleId: schedule.id, trigger: 'manual', userId: 'u' });

    assert.equal(run.status, 'failed');
    assert.match(run.errorMessage, /\[redacted\]/);
    assert.equal(run.errorMessage.includes('Secret123!'), false);
    assert.equal((await fs.stat(run.filePath)).isFile(), true);
  } finally {
    store.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run runner tests and verify they fail**

Run: `node --test test/scheduledReportRunner.test.js`

Expected: FAIL with missing module.

- [ ] **Step 3: Implement runner**

Create `src/scheduledReportRunner.js` with:

```js
const fs = require('node:fs/promises');
const path = require('node:path');

const { buildXlsxWorkbook } = require('./xlsxWorkbook');
const { normalizeReportLimits, wrapReportSql } = require('./scheduledReportSql');

function filenameForRun(report, run) {
  return `scheduled-report-${report.id}-${String(run.id).padStart(6, '0')}.xlsx`;
}

function createScheduledReportRunner({ client, store, fileDir, config, mailer, sanitizeError = (error) => String(error && error.message) } = {}) {
  async function runSchedule({ scheduleId, trigger = 'schedule', userId = 'system' }) {
    const schedule = store.getSchedule(scheduleId);
    const report = schedule ? store.getReport(schedule.reportId) : null;

    if (!schedule || !report) {
      throw new Error('Scheduled report not found');
    }
    if (trigger === 'schedule' && (!schedule.enabled || !report.enabled)) {
      return { status: 'disabled' };
    }

    const run = store.startRun({ reportId: report.id, scheduleId: schedule.id, trigger, recipients: schedule.recipients, userId });
    let filePath = '';
    let fileSizeBytes = 0;

    try {
      const limits = normalizeReportLimits(report, config);
      const wrapped = wrapReportSql(report.sql, limits);
      const rows = await client.queryJSONEachRow(wrapped.query, wrapped.params, 'scheduled report SQL');
      const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
      const workbook = buildXlsxWorkbook({ sheetName: 'Отчет', headers, rows });

      if (workbook.length > Number(config.maxFileSizeBytes || 10485760)) {
        throw new Error('Scheduled report file size limit exceeded');
      }

      await fs.mkdir(fileDir, { recursive: true });
      filePath = path.join(fileDir, filenameForRun(report, run));
      await fs.writeFile(filePath, workbook);
      fileSizeBytes = workbook.length;

      const settings = store.getMailSettingsSecret();

      await mailer.sendReport({
        settings,
        recipients: schedule.recipients,
        subject: schedule.emailSubject || report.title,
        body: schedule.emailBody || '',
        filename: path.basename(filePath),
        fileBuffer: workbook
      });

      return store.finishRun(run.id, {
        status: 'success',
        rowCount: rows.length,
        fileSizeBytes,
        filePath
      });
    } catch (error) {
      return store.finishRun(run.id, {
        status: 'failed',
        rowCount: 0,
        fileSizeBytes,
        filePath,
        errorMessage: sanitizeError(error)
      });
    }
  }

  return { runSchedule };
}

module.exports = {
  createScheduledReportRunner,
  filenameForRun
};
```

- [ ] **Step 4: Run runner tests**

Run: `node --test test/scheduledReportRunner.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scheduledReportRunner.js test/scheduledReportRunner.test.js
git commit -m "Добавить runner регулярных отчетов"
```

---

### Task 7: Scheduler And Service Facade

**Files:**
- Create: `src/scheduledReportScheduler.js`
- Create: `src/scheduledReportService.js`
- Create: `test/scheduledReportScheduler.test.js`
- Create: `test/scheduledReportService.test.js`

- [ ] **Step 1: Write failing scheduler tests**

Create `test/scheduledReportScheduler.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const { createScheduledReportScheduler, nextDelayForSchedule } = require('../src/scheduledReportScheduler');

test('scheduled report scheduler calculates next Moscow daily delay', () => {
  const delay = nextDelayForSchedule(
    { scheduleTime: '09:30', timezone: 'Europe/Moscow' },
    new Date('2026-06-25T06:00:00.000Z')
  );

  assert.equal(delay, 30 * 60 * 1000);
});

test('scheduled report scheduler prevents parallel run for same schedule', async () => {
  let release;
  const blocker = new Promise((resolve) => { release = resolve; });
  let runs = 0;
  const scheduler = createScheduledReportScheduler({
    store: { listEnabledSchedules: () => [] },
    runner: {
      async runSchedule() {
        runs += 1;
        await blocker;
        return { status: 'success' };
      }
    }
  });

  const first = scheduler.runNow({ scheduleId: 1, trigger: 'manual', userId: 'u' });
  const second = await scheduler.runNow({ scheduleId: 1, trigger: 'manual', userId: 'u' });

  release();
  await first;

  assert.equal(runs, 1);
  assert.deepEqual(second, { status: 'running', alreadyRunning: true });
});
```

- [ ] **Step 2: Run scheduler test and verify it fails**

Run: `node --test test/scheduledReportScheduler.test.js`

Expected: FAIL with missing module.

- [ ] **Step 3: Implement scheduler**

Create `src/scheduledReportScheduler.js` modeled on `src/preloadScheduler.js`:

```js
const MOSCOW_UTC_OFFSET_HOURS = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseScheduleTime(scheduleTime) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(scheduleTime || '09:00'));

  if (!match) {
    return { hours: 9, minutes: 0 };
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return { hours: 9, minutes: 0 };
  }

  return { hours, minutes };
}

function nextDelayForSchedule(schedule, currentDate) {
  const currentTime = currentDate.getTime();
  const { hours, minutes } = parseScheduleTime(schedule && schedule.scheduleTime);
  const moscowNow = new Date(currentTime + MOSCOW_UTC_OFFSET_HOURS * 60 * 60 * 1000);
  let target = Date.UTC(
    moscowNow.getUTCFullYear(),
    moscowNow.getUTCMonth(),
    moscowNow.getUTCDate(),
    hours - MOSCOW_UTC_OFFSET_HOURS,
    minutes,
    0,
    0
  );

  if (target <= currentTime) {
    target += MS_PER_DAY;
  }

  return Math.max(0, target - currentTime);
}

function createScheduledReportScheduler({ store, runner, now = () => new Date(), setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout }) {
  const runningBySchedule = new Map();
  const timersBySchedule = new Map();
  let stopped = false;

  async function runNow({ scheduleId, trigger = 'manual', userId = 'system' }) {
    if (runningBySchedule.has(scheduleId)) {
      return { status: 'running', alreadyRunning: true };
    }

    const promise = Promise.resolve()
      .then(() => runner.runSchedule({ scheduleId, trigger, userId }))
      .finally(() => runningBySchedule.delete(scheduleId));

    runningBySchedule.set(scheduleId, promise);
    return promise;
  }

  function clearTimers() {
    for (const timer of timersBySchedule.values()) {
      clearTimeoutFn(timer);
    }
    timersBySchedule.clear();
  }

  function reschedule() {
    stopped = false;
    clearTimers();

    for (const schedule of store.listEnabledSchedules()) {
      const timer = setTimeoutFn(async () => {
        timersBySchedule.delete(schedule.id);

        try {
          await runNow({ scheduleId: schedule.id, trigger: 'schedule', userId: 'system' });
        } finally {
          if (!stopped) {
            reschedule();
          }
        }
      }, nextDelayForSchedule(schedule, now()));

      timersBySchedule.set(schedule.id, timer);
    }
  }

  function stop() {
    stopped = true;
    clearTimers();
  }

  function drain() { return Promise.allSettled([...runningBySchedule.values()]); }

  return { drain, reschedule, runNow, stop };
}
```

Use `store.listEnabledSchedules()` in `reschedule()` and run callbacks with `trigger: 'schedule'`.

- [ ] **Step 4: Write service facade tests**

Create `test/scheduledReportService.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const { createScheduledReportService } = require('../src/scheduledReportService');

test('scheduled report service delegates CRUD and reschedules after schedule changes', async () => {
  const calls = [];
  const store = {
    listReports: () => [{ id: 1 }],
    createReport(input) { calls.push(['createReport', input]); return { id: 2, ...input }; },
    updateReport(id, input) { calls.push(['updateReport', id, input]); return { id, ...input }; },
    createSchedule(input) { calls.push(['createSchedule', input]); return { id: 3, ...input }; },
    updateSchedule(id, input) { calls.push(['updateSchedule', id, input]); return { id, ...input }; },
    listRuns: () => [],
    pruneOldRuns: async () => ({ runs: 0, files: 0 }),
    close() { calls.push(['close']); }
  };
  const scheduler = {
    reschedule() { calls.push(['reschedule']); },
    runNow(input) { calls.push(['runNow', input]); return Promise.resolve({ status: 'success' }); },
    stop() { calls.push(['stop']); },
    drain() { calls.push(['drain']); return Promise.resolve([]); }
  };
  const service = createScheduledReportService({ store, scheduler });

  service.createReport({ title: 'R' });
  service.createSchedule({ reportId: 1 });
  await service.runSchedule({ scheduleId: 3, userId: 'u' });
  await service.close();

  assert.deepEqual(calls.map((call) => call[0]), [
    'reschedule',
    'createReport',
    'createSchedule',
    'reschedule',
    'runNow',
    'stop',
    'drain',
    'close'
  ]);
});
```

- [ ] **Step 5: Implement service facade**

Create `src/scheduledReportService.js`:

```js
function createScheduledReportService({ store, scheduler }) {
  let closePromise = null;

  scheduler.reschedule();

  return {
    listReports: store.listReports,
    getReport: store.getReport,
    listSchedules: store.listSchedules,
    listRuns: store.listRuns,
    getRun: store.getRun,
    getMailSettings: store.getMailSettings,
    saveMailSettings: store.saveMailSettings,
    createReport(input) { return store.createReport(input); },
    updateReport(id, input) { return store.updateReport(id, input); },
    createSchedule(input) { const saved = store.createSchedule(input); scheduler.reschedule(); return saved; },
    updateSchedule(id, input) { const saved = store.updateSchedule(id, input); scheduler.reschedule(); return saved; },
    runSchedule(input) { return scheduler.runNow(input); },
    pruneOldRuns(days) { return store.pruneOldRuns(days); },
    close() {
      if (!closePromise) {
        closePromise = Promise.resolve()
          .then(() => scheduler.stop())
          .then(() => scheduler.drain())
          .then(() => store.close());
      }
      return closePromise;
    }
  };
}

module.exports = { createScheduledReportService };
```

- [ ] **Step 6: Run focused tests**

Run: `node --test test/scheduledReportScheduler.test.js test/scheduledReportService.test.js`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/scheduledReportScheduler.js src/scheduledReportService.js test/scheduledReportScheduler.test.js test/scheduledReportService.test.js
git commit -m "Добавить планировщик регулярных отчетов"
```

---

### Task 8: Render Scheduled Report UI

**Files:**
- Modify: `src/render.js`
- Modify: `test/render.test.js`
- Modify: `test/renderAuth.test.js`

- [ ] **Step 1: Write failing render tests**

Add to `test/renderAuth.test.js`:

```js
test('navigation shows scheduled reports based on report permissions and hides SMTP from analysts', () => {
  const authorHtml = renderHome({
    database: 'etl',
    tables: [],
    currentUser: { role: 'analyst', permissions: ['scheduled-report-author'] }
  });
  const deliveryHtml = renderHome({
    database: 'etl',
    tables: [],
    currentUser: { role: 'analyst', permissions: ['scheduled-report-delivery'] }
  });
  const adminHtml = renderHome({
    database: 'etl',
    tables: [],
    currentUser: { role: 'admin', permissions: [] }
  });

  assert.match(authorHtml, /href="\/reports\/scheduled"/);
  assert.match(deliveryHtml, /href="\/reports\/scheduled"/);
  assert.doesNotMatch(authorHtml, /href="\/admin\/mail-settings"/);
  assert.match(adminHtml, /href="\/admin\/mail-settings"/);
});
```

Add to `test/render.test.js`:

```js
test('scheduled reports page renders author and delivery controls separately', () => {
  const html = renderScheduledReportsPage({
    database: 'etl',
    reports: [{ id: 1, title: 'Daily', enabled: true, updatedAt: '2026-06-25T06:00:00.000Z' }],
    selectedReport: { id: 1, title: 'Daily', sql: 'SELECT 1', rowLimit: 100, timeoutMs: 120000, enabled: true },
    schedules: [{ id: 2, reportId: 1, enabled: true, scheduleTime: '09:00', recipients: ['a@example.test'] }],
    runs: [{ id: 3, status: 'success', rowCount: 1, fileSizeBytes: 128, finishedAt: '2026-06-25T07:00:00.000Z', canDownload: true }],
    canAuthor: true,
    canDeliver: true,
    csrfToken: 'csrf'
  });

  assert.match(html, /Регулярные отчеты/);
  assert.match(html, /name="sql"/);
  assert.match(html, /a@example.test/);
  assert.match(html, /href="\/reports\/scheduled\/runs\/3\/download"/);
});
```

- [ ] **Step 2: Run render tests and verify they fail**

Run: `node --test test/render.test.js test/renderAuth.test.js`

Expected: FAIL because render functions and nav links are missing.

- [ ] **Step 3: Add nav items**

In `src/render.js`, add:

```js
{
  href: '/reports/scheduled',
  label: 'Регулярные отчеты',
  id: 'scheduled-reports',
  permissionAny: ['scheduled-report-author', 'scheduled-report-delivery']
},
{
  href: '/admin/mail-settings',
  label: 'SMTP',
  id: 'mail-settings',
  permission: 'admin-only'
}
```

Update nav filtering so `permissionAny` renders if any listed permission is granted by `hasPermission`.

- [ ] **Step 4: Add render functions**

Add exports:

```js
renderScheduledReportsPage
renderMailSettingsPage
```

`renderScheduledReportsPage` must render:

- report list;
- author form only when `canAuthor`;
- schedule form, recipients textarea, run button, and history table only when `canDeliver`;
- a read-only empty state when the user has neither effective capability;
- hidden CSRF inputs in every POST form.

`renderMailSettingsPage` must render:

- SMTP host, port, secure mode, username, password, from email, from name;
- current `hasPassword` status as text;
- separate test-send form.

- [ ] **Step 5: Run render tests**

Run: `node --test test/render.test.js test/renderAuth.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/render.js test/render.test.js test/renderAuth.test.js
git commit -m "Добавить UI регулярных отчетов"
```

---

### Task 9: Server Routes And Startup Wiring

**Files:**
- Modify: `src/server.js`
- Modify: `test/serverAuth.test.js`
- Modify: `test/server.test.js`

- [ ] **Step 1: Write failing route permission tests**

Add to `test/serverAuth.test.js`:

```js
test('scheduled report routes enforce author delivery and admin SMTP permissions', async () => {
  const scheduledReports = {
    listReports: () => [],
    getReport: () => null,
    listSchedules: () => [],
    listRuns: () => [],
    getMailSettings: () => ({ hasPassword: false }),
    close() {}
  };

  await withAuthServer(async ({ baseUrl, userStore }) => {
    await createReadyUser(userStore, {
      email: 'author@example.test',
      name: 'Author',
      role: 'analyst',
      permissions: ['scheduled-report-author'],
      password: 'AuthorPass123!'
    }, 'AuthorReady123!');
    await createReadyUser(userStore, {
      email: 'delivery@example.test',
      name: 'Delivery',
      role: 'analyst',
      permissions: ['scheduled-report-delivery'],
      password: 'DeliveryPass123!'
    }, 'DeliveryReady123!');

    const authorCookie = cookieFrom(await login(baseUrl, 'author@example.test', 'AuthorReady123!'));
    const deliveryCookie = cookieFrom(await login(baseUrl, 'delivery@example.test', 'DeliveryReady123!'));
    const adminCookie = cookieFrom(await login(baseUrl, 'admin@example.test', 'EnvAdminPass123'));

    assert.equal((await fetchText(baseUrl, '/reports/scheduled', { headers: { cookie: authorCookie } })).response.status, 200);
    assert.equal((await fetchText(baseUrl, '/reports/scheduled', { headers: { cookie: deliveryCookie } })).response.status, 200);
    assert.equal((await fetchText(baseUrl, '/admin/mail-settings', { headers: { cookie: deliveryCookie } })).response.status, 403);
    assert.equal((await fetchText(baseUrl, '/admin/mail-settings', { headers: { cookie: adminCookie } })).response.status, 200);
  }, { scheduledReportService: scheduledReports });
});
```

- [ ] **Step 2: Run server auth test and verify it fails**

Run: `node --test test/serverAuth.test.js`

Expected: FAIL because routes are missing.

- [ ] **Step 3: Wire service in `createApp` and startup**

In `src/server.js`, import:

```js
const { createScheduledReportStore } = require('./scheduledReportStore');
const { createScheduledReportMailer, sanitizeMailError } = require('./scheduledReportMailer');
const { createScheduledReportRunner } = require('./scheduledReportRunner');
const { createScheduledReportScheduler } = require('./scheduledReportScheduler');
const { createScheduledReportService } = require('./scheduledReportService');
```

Extend the `createApp` dependency object with `scheduledReportService`.

In the CLI startup block, create the default service with config paths:

```js
const scheduledReportStore = createScheduledReportStore({
  filePath: config.scheduledReports.storePath,
  fileDir: config.scheduledReports.fileDir
});
const scheduledReportMailer = createScheduledReportMailer();
const scheduledReportRunner = createScheduledReportRunner({
  client,
  store: scheduledReportStore,
  fileDir: config.scheduledReports.fileDir,
  config: config.scheduledReports,
  mailer: scheduledReportMailer,
  sanitizeError: (error) => sanitizeForResponse(
    sanitizeMailError(error, scheduledReportStore.getMailSettingsSecret()),
    config
  )
});
const scheduledReportScheduler = createScheduledReportScheduler({
  store: scheduledReportStore,
  runner: scheduledReportRunner
});
const scheduledReportService = createScheduledReportService({
  store: scheduledReportStore,
  scheduler: scheduledReportScheduler
});
```

Add `scheduledReportService.close()` to graceful shutdown.

- [ ] **Step 4: Add route permission helpers**

Add:

```js
function requireAnyReportPermission() {
  return asyncRoute(async (req, res, next) => {
    const auth = await loadRequestAuth(req);
    if (!auth) return res.redirect(302, loginRedirect(req));
    if (!hasPermission(auth.user, 'scheduled-report-author') && !hasPermission(auth.user, 'scheduled-report-delivery')) {
      sendError(res, 403, 'Forbidden', 'Недостаточно прав для выбранного раздела.');
      return;
    }
    req.auth = auth;
    next();
  });
}
```

Use existing `requireAuth('scheduled-report-author')`, `requireAuth('scheduled-report-delivery')`, and `requireAdmin()` for specific POST/download/admin actions.

- [ ] **Step 5: Add scheduled-report routes**

Add routes:

```text
GET  /reports/scheduled
POST /reports/scheduled/create
POST /reports/scheduled/:reportId/update
POST /reports/scheduled/:reportId/preview
POST /reports/scheduled/:reportId/schedules/create
POST /reports/scheduled/:reportId/schedules/:scheduleId/update
POST /reports/scheduled/:reportId/schedules/:scheduleId/run
GET  /reports/scheduled/runs/:runId/download
GET  /admin/mail-settings
POST /admin/mail-settings
POST /admin/mail-settings/test
```

Route behavior:

- author POST routes require `scheduled-report-author` and CSRF;
- delivery POST/download routes require `scheduled-report-delivery` and CSRF for POST;
- SMTP routes require `requireAdmin()` and CSRF for POST;
- downloads set `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`;
- failed/missing files return sanitized `404`.

- [ ] **Step 6: Add activity sections and event types**

Map `/reports/scheduled` to section `scheduled-reports` and `/admin/mail-settings` to section `mail-settings`. Record:

- `admin_action` for report create/update, schedule save, SMTP save/test;
- `export` for `.xlsx` downloads;
- `page_view` for GET pages.

Do not include SQL, recipients, SMTP username/password, or email body in activity payloads.

- [ ] **Step 7: Run focused server tests**

Run: `node --test test/serverAuth.test.js test/server.test.js`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/server.js test/serverAuth.test.js test/server.test.js
git commit -m "Подключить маршруты регулярных отчетов"
```

---

### Task 10: Documentation And Full Verification

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Optional Modify: `docs/superpowers/specs/2026-06-25-scheduled-email-reports-design.md` only if implementation decisions require a spec correction.

- [ ] **Step 1: Update README**

Add a section `Регулярные отчеты` under configuration/admin docs:

```markdown
### Регулярные отчеты

Раздел `/reports/scheduled` позволяет пользователям с правами `scheduled-report-author` и `scheduled-report-delivery` создавать SQL-отчеты, настраивать ежедневную отправку и скачивать отправленные `.xlsx` файлы за последние 60 дней.

SMTP настраивается администратором на `/admin/mail-settings`. Пароль после сохранения не отображается в UI. Файлы отчетов и SQLite-хранилище находятся в `./data`, поэтому Docker volume `./data:/app/data` должен быть доступен на запись пользователю контейнера `node` (`uid 1000`).
```

Document env keys already added in Task 1.

- [ ] **Step 2: Run all tests**

Run: `npm test`

Expected: all `node:test` suites pass with exit code 0.

- [ ] **Step 3: Run dependency audit only if package install changed lockfile**

Run: `npm audit --omit=dev`

Expected: no high or critical vulnerabilities. If audit reports high/critical issues, document the exact package and fix or replace the dependency before completion.

- [ ] **Step 4: Run local smoke server**

Run:

```powershell
$env:CLICKHOUSE_HOST='example.invalid'
$env:CLICKHOUSE_USER='rouser'
$env:CLICKHOUSE_PASSWORD='change-me'
$env:AUTH_ADMIN_EMAIL='admin@example.test'
$env:AUTH_ADMIN_PASSWORD='AdminPass123!'
$env:AUTH_SESSION_SECRET='local-session-secret'
$env:PORT='3000'
npm start
```

Expected: server starts and logs the configured port. Stop the server after verifying startup.

- [ ] **Step 5: Check git diff**

Run: `git status --short`

Expected: only intended source, test, docs, package, and lockfile changes are present.

- [ ] **Step 6: Commit docs and final integration**

```bash
git add README.md .env.example package.json package-lock.json src test docs/superpowers/specs/2026-06-25-scheduled-email-reports-design.md
git commit -m "Добавить регулярную email рассылку отчетов"
```

---

## Self-Review Checklist

- Spec coverage:
  - SMTP instead of IMAP: Task 5 and Task 9.
  - Excel `.xlsx` attachments: Task 2 and Task 6.
  - Admin-created SQL reports: Task 3, Task 8, Task 9.
  - Separate author/delivery rights: Task 1, Task 8, Task 9.
  - SMTP settings admin-only: Task 1, Task 8, Task 9.
  - Multiple reports, recipients, times: Task 4, Task 7, Task 8.
  - History and 60-day downloads: Task 4, Task 9, Task 10.
  - Runtime `data/` storage: Task 4 and Task 10.
  - Formula injection protection: Task 2 and Task 6.
  - Activity without secrets: Task 9.
- Placeholder scan: no unresolved marker instructions are used.
- Type consistency: core objects use camelCase in JS (`rowLimit`, `timeoutMs`, `fileSizeBytes`, `emailSubject`, `emailBody`) and snake_case only inside SQLite schema.
