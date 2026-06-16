const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SALES_PRELOAD_JOB_ID = 'sales-by-project';
const WORKPLACE_ANALYSIS_PRELOAD_JOB_ID = 'workplace-analysis';
const DEFAULT_PRELOAD_REFRESH_DAYS = 45;
const DEFAULT_PRELOAD_REFRESH_FUTURE_DAYS = 45;
const DEFAULT_PRELOAD_STORE_PATH = path.join(process.cwd(), 'data', 'preload.sqlite');
const DEFAULT_PRELOAD_SCHEDULE_TIME = '03:00';
const DEFAULT_PRELOAD_TIMEZONE = 'Europe/Moscow';
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const SALES_BY_PROJECT_PRELOAD_SECTIONS = new Set(['summary', 'trend', 'brands', 'statuses']);
const SALES_BY_PROJECT_PRELOAD_PERIODS = new Set(['day', 'week', 'month', 'quarter']);

function toIsoString(now) {
  return now().toISOString();
}

function normalizeRows(rows) {
  return rows.map((row) => ({ ...row }));
}

function finiteNumber(value) {
  const number = Number(value || 0);

  return Number.isFinite(number) ? number : 0;
}

function parseDateOnly(value) {
  if (typeof value !== 'string' || !DATE_ONLY_RE.test(value)) {
    throw new Error(`Invalid date: ${value}`);
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime()) || formatDateUTC(date) !== value) {
    throw new Error(`Invalid date: ${value}`);
  }

  return date;
}

function formatDateUTC(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0')
  ].join('-');
}

function addDaysUTC(date, days) {
  const next = new Date(date.getTime());

  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function enumerateDateRange(fromDate, toDate) {
  const dates = [];
  const end = parseDateOnly(toDate).getTime();

  for (let date = parseDateOnly(fromDate); date.getTime() < end; date = addDaysUTC(date, 1)) {
    dates.push(formatDateUTC(date));
  }

  return dates;
}

function assertValidSalesByProjectRange(fromDate, toDate) {
  const fromTime = parseDateOnly(fromDate).getTime();
  const toTime = parseDateOnly(toDate).getTime();

  if (fromTime > toTime) {
    throw new Error(`Invalid sales by project preload range: ${fromDate}..${toDate}`);
  }
}

function assertValidDashboardPreloadRange(fromDate, toDate) {
  const fromTime = parseDateOnly(fromDate).getTime();
  const toTime = parseDateOnly(toDate).getTime();

  if (fromTime > toTime) {
    throw new Error(`Invalid dashboard preload range: ${fromDate}..${toDate}`);
  }
}

function assertDateInRange(periodDate, fromDate, toDate, sourceName) {
  const dateTime = parseDateOnly(periodDate).getTime();
  const fromTime = parseDateOnly(fromDate).getTime();
  const toTime = parseDateOnly(toDate).getTime();

  if (dateTime < fromTime || dateTime >= toTime) {
    throw new Error(`${sourceName} period_date ${periodDate} is outside preload range ${fromDate}..${toDate}`);
  }
}

function assertRowsInsideRange(rows, fromDate, toDate, sourceName) {
  for (const row of rows) {
    assertDateInRange(row.period_date, fromDate, toDate, sourceName);
  }
}

function assertRequiredFactIds(orderFacts, shiftFacts) {
  for (const row of orderFacts) {
    if (String(row.order_id || '').trim() === '') {
      throw new Error('orderFacts requires non-empty order_id');
    }
  }

  for (const row of shiftFacts) {
    if (String(row.job_id || '').trim() === '') {
      throw new Error('shiftFacts requires non-empty job_id');
    }
  }
}

function coverageSegmentFromRows(rows) {
  if (rows.length === 0) {
    return { coveredFrom: '', coveredTo: '' };
  }

  let segmentStart = rows[0].period_date;
  let previousDate = rows[0].period_date;

  for (let index = 1; index < rows.length; index += 1) {
    const expectedNext = formatDateUTC(addDaysUTC(parseDateOnly(previousDate), 1));
    const currentDate = rows[index].period_date;

    if (currentDate !== expectedNext) {
      segmentStart = currentDate;
    }

    previousDate = currentDate;
  }

  return {
    coveredFrom: segmentStart,
    coveredTo: formatDateUTC(addDaysUTC(parseDateOnly(previousDate), 1))
  };
}

function normalizeJob(row) {
  if (!row) {
    return null;
  }

  const refreshPastDays = Number.isFinite(Number(row.refresh_past_days))
    ? Number(row.refresh_past_days)
    : Number(row.refresh_days);
  const refreshFutureDays = Number.isFinite(Number(row.refresh_future_days))
    ? Number(row.refresh_future_days)
    : DEFAULT_PRELOAD_REFRESH_FUTURE_DAYS;

  return {
    id: row.id,
    title: row.title,
    enabled: Boolean(row.enabled),
    scheduleTime: row.schedule_time,
    timezone: row.timezone,
    refreshDays: refreshPastDays,
    refreshPastDays,
    refreshFutureDays,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSuccessAt: row.last_success_at || '',
    lastRunId: row.last_run_id
  };
}

function normalizeRun(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    jobId: row.job_id,
    trigger: row.trigger,
    status: row.status,
    fromDate: row.from_date,
    toDate: row.to_date,
    startedAt: row.started_at,
    finishedAt: row.finished_at || '',
    rowsWritten: row.rows_written,
    errorMessage: row.error_message || ''
  };
}

function sqlitePeriodExpression(period) {
  if (period === 'day') return 'period_date';
  if (period === 'week') return "date(period_date, '-' || ((CAST(strftime('%w', period_date) AS INTEGER) + 6) % 7) || ' days')";
  if (period === 'month') return "substr(period_date, 1, 7) || '-01'";
  if (period === 'quarter') return "substr(period_date, 1, 4) || '-' || printf('%02d', (((CAST(substr(period_date, 6, 2) AS INTEGER) - 1) / 3) * 3 + 1)) || '-01'";
  throw new Error(`Unsupported sales by project period: ${period}`);
}

function assertSalesByProjectPreloadSection(section) {
  if (!SALES_BY_PROJECT_PRELOAD_SECTIONS.has(section)) {
    throw new Error(`Unknown sales by project preload section: ${section}`);
  }
}

function assertSalesByProjectPreloadPeriod(period) {
  if (!SALES_BY_PROJECT_PRELOAD_PERIODS.has(period)) {
    throw new Error(`Unsupported sales by project period: ${period}`);
  }
}

function ensureColumn(db, tableName, columnName, definition) {
  const exists = db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .some((row) => row.name === columnName);

  if (!exists) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    return true;
  }

  return false;
}

function refreshDayValue(value) {
  const number = Number(value);

  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function parseJsonObject(value, fallback) {
  try {
    return JSON.parse(String(value || ''));
  } catch (_) {
    return fallback;
  }
}

function normalizeDashboardPreloadRequest(row) {
  if (!row) {
    return null;
  }

  return {
    jobId: row.job_id,
    dashboardId: row.dashboard_id,
    section: row.section,
    cacheKey: row.cache_key,
    input: parseJsonObject(row.input_json, {}),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    hitCount: Number(row.hit_count || 0)
  };
}

function normalizeDashboardPreloadResult(row) {
  if (!row) {
    return null;
  }

  return {
    jobId: row.job_id,
    dashboardId: row.dashboard_id,
    section: row.section,
    cacheKey: row.cache_key,
    fromDate: row.from_date,
    toDate: row.to_date,
    payload: parseJsonObject(row.payload_json, null),
    refreshedAt: row.refreshed_at,
    sourceFrom: row.source_from,
    sourceTo: row.source_to
  };
}

function seedPreloadJob(db, now, { id, title }) {
  const timestamp = toIsoString(now);

  db.prepare(`
INSERT OR IGNORE INTO preload_jobs (
  id,
  title,
  enabled,
  schedule_time,
  timezone,
  refresh_days,
  refresh_past_days,
  refresh_future_days,
  created_at,
  updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
    id,
    title,
    1,
    DEFAULT_PRELOAD_SCHEDULE_TIME,
    DEFAULT_PRELOAD_TIMEZONE,
    DEFAULT_PRELOAD_REFRESH_DAYS,
    DEFAULT_PRELOAD_REFRESH_DAYS,
    DEFAULT_PRELOAD_REFRESH_FUTURE_DAYS,
    timestamp,
    timestamp
  );
}

function initializeSchema(db, now) {
  db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS preload_jobs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  schedule_time TEXT NOT NULL,
  timezone TEXT NOT NULL,
  refresh_days INTEGER NOT NULL,
  refresh_past_days INTEGER NOT NULL DEFAULT 45,
  refresh_future_days INTEGER NOT NULL DEFAULT 45,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_success_at TEXT,
  last_run_id INTEGER
);

CREATE TABLE IF NOT EXISTS preload_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL,
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  rows_written INTEGER NOT NULL DEFAULT 0,
  error_message TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS preload_dashboard_requests (
  job_id TEXT NOT NULL,
  dashboard_id TEXT NOT NULL,
  section TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  input_json TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (job_id, section, cache_key)
);

CREATE TABLE IF NOT EXISTS preload_dashboard_results (
  job_id TEXT NOT NULL,
  dashboard_id TEXT NOT NULL,
  section TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  refreshed_at TEXT NOT NULL,
  source_from TEXT NOT NULL,
  source_to TEXT NOT NULL,
  PRIMARY KEY (job_id, section, cache_key)
);

-- Daily rows are rollup/cache metadata; exact dashboard distinct reads use fact tables.
CREATE TABLE IF NOT EXISTS sales_by_project_daily (
  period_date TEXT NOT NULL,
  brand TEXT NOT NULL,
  ordered_shifts REAL NOT NULL DEFAULT 0,
  workplaces_with_orders REAL NOT NULL DEFAULT 0,
  worked_shifts REAL NOT NULL DEFAULT 0,
  revenue_rub REAL NOT NULL DEFAULT 0,
  unique_workers REAL NOT NULL DEFAULT 0,
  workplaces_with_worked_shifts REAL NOT NULL DEFAULT 0,
  cancelled_shifts REAL NOT NULL DEFAULT 0,
  self_booked_confirmed_shifts REAL NOT NULL DEFAULT 0,
  avg_worker_rate_hour_weighted_sum REAL NOT NULL DEFAULT 0,
  avg_worker_rate_hour_weight REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT '',
  shifts REAL NOT NULL DEFAULT 0,
  refreshed_at TEXT NOT NULL,
  source_from TEXT NOT NULL,
  source_to TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sales_by_project_order_facts (
  period_date TEXT NOT NULL,
  brand TEXT NOT NULL,
  order_id TEXT NOT NULL,
  workplace_id TEXT NOT NULL,
  ordered_shifts REAL NOT NULL DEFAULT 0,
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY (period_date, order_id)
);

CREATE TABLE IF NOT EXISTS sales_by_project_shift_facts (
  period_date TEXT NOT NULL,
  brand TEXT NOT NULL,
  job_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  workplace_id TEXT NOT NULL,
  status TEXT NOT NULL,
  is_successful_confirmed_shift REAL NOT NULL DEFAULT 0,
  revenue_rub REAL NOT NULL DEFAULT 0,
  cancelled_shifts REAL NOT NULL DEFAULT 0,
  self_booked_confirmed_shift REAL NOT NULL DEFAULT 0,
  worker_rate_hour REAL NOT NULL DEFAULT 0,
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY (period_date, job_id)
);

CREATE TABLE IF NOT EXISTS sales_by_project_coverage (
  period_date TEXT PRIMARY KEY,
  source_from TEXT NOT NULL,
  source_to TEXT NOT NULL,
  refreshed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sales_daily_period_brand ON sales_by_project_daily (period_date, brand);
CREATE INDEX IF NOT EXISTS idx_sales_daily_status ON sales_by_project_daily (period_date, status);
CREATE INDEX IF NOT EXISTS idx_preload_runs_job_id ON preload_runs (job_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_preload_dashboard_requests_job ON preload_dashboard_requests (job_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_preload_dashboard_results_lookup ON preload_dashboard_results (job_id, section, cache_key, source_from, source_to);
CREATE INDEX IF NOT EXISTS idx_sales_order_facts_period_brand ON sales_by_project_order_facts (period_date, brand);
CREATE INDEX IF NOT EXISTS idx_sales_shift_facts_period_brand ON sales_by_project_shift_facts (period_date, brand);
CREATE INDEX IF NOT EXISTS idx_sales_shift_facts_status ON sales_by_project_shift_facts (period_date, status);
`);

  ensureColumn(db, 'preload_jobs', 'refresh_past_days', 'INTEGER NOT NULL DEFAULT 45');
  ensureColumn(db, 'preload_jobs', 'refresh_future_days', 'INTEGER NOT NULL DEFAULT 45');
  db.exec('UPDATE preload_jobs SET refresh_past_days = refresh_days WHERE refresh_days IS NOT NULL');

  ensureColumn(db, 'sales_by_project_daily', 'workplaces_with_orders', 'REAL NOT NULL DEFAULT 0');
  ensureColumn(db, 'sales_by_project_daily', 'worked_shifts', 'REAL NOT NULL DEFAULT 0');
  ensureColumn(db, 'sales_by_project_daily', 'unique_workers', 'REAL NOT NULL DEFAULT 0');
  ensureColumn(db, 'sales_by_project_daily', 'workplaces_with_worked_shifts', 'REAL NOT NULL DEFAULT 0');
  const addedSuccessfulConfirmedShiftColumn = ensureColumn(
    db,
    'sales_by_project_shift_facts',
    'is_successful_confirmed_shift',
    'REAL NOT NULL DEFAULT 0'
  );

  if (addedSuccessfulConfirmedShiftColumn) {
    db.exec('DELETE FROM sales_by_project_coverage');
  }

  seedPreloadJob(db, now, {
    id: SALES_PRELOAD_JOB_ID,
    title: 'Sales by project'
  });
  seedPreloadJob(db, now, {
    id: WORKPLACE_ANALYSIS_PRELOAD_JOB_ID,
    title: 'Анализ точек'
  });
}

function createPreloadStore({ filePath = DEFAULT_PRELOAD_STORE_PATH, now = () => new Date() } = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const db = new DatabaseSync(filePath);

  initializeSchema(db, now);

  function getJob(jobId) {
    return normalizeJob(db.prepare('SELECT * FROM preload_jobs WHERE id = ?').get(jobId));
  }

  function listJobs() {
    return db.prepare(`
SELECT *
FROM preload_jobs
ORDER BY id
`).all().map(normalizeJob);
  }

  function saveJobSchedule(jobId, { enabled, scheduleTime, refreshDays, refreshPastDays, refreshFutureDays }) {
    const pastDays = refreshDayValue(
      refreshPastDays === undefined || refreshPastDays === null ? refreshDays : refreshPastDays
    );
    const futureDays = refreshDayValue(refreshFutureDays);

    db.prepare(`
UPDATE preload_jobs
SET enabled = COALESCE(?, enabled),
    schedule_time = COALESCE(?, schedule_time),
    refresh_days = COALESCE(?, refresh_days),
    refresh_past_days = COALESCE(?, refresh_past_days),
    refresh_future_days = COALESCE(?, refresh_future_days),
    updated_at = ?
WHERE id = ?
`).run(
      typeof enabled === 'boolean' ? Number(enabled) : null,
      scheduleTime || null,
      pastDays,
      pastDays,
      futureDays,
      toIsoString(now),
      jobId
    );

    return getJob(jobId);
  }

  function startRun({ jobId, trigger, fromDate, toDate }) {
    const result = db.prepare(`
INSERT INTO preload_runs (job_id, trigger, status, from_date, to_date, started_at)
VALUES (?, ?, ?, ?, ?, ?)
`).run(jobId, trigger, 'running', fromDate, toDate, toIsoString(now));

    return normalizeRun(db.prepare('SELECT * FROM preload_runs WHERE id = ?').get(result.lastInsertRowid));
  }

  function finishRun(runId, { status, rowsWritten = 0, errorMessage = '' }) {
    const timestamp = toIsoString(now);

    db.prepare(`
UPDATE preload_runs
SET status = ?,
    finished_at = ?,
    rows_written = ?,
    error_message = ?
WHERE id = ?
`).run(status, timestamp, rowsWritten, errorMessage, runId);

    const run = normalizeRun(db.prepare('SELECT * FROM preload_runs WHERE id = ?').get(runId));

    if (run && status === 'success') {
      db.prepare(`
UPDATE preload_jobs
SET last_success_at = ?,
    last_run_id = ?,
    updated_at = ?
WHERE id = ?
`).run(timestamp, runId, timestamp, run.jobId);
    }

    return run;
  }

  function listRuns(jobId, limit = 20) {
    return db.prepare(`
SELECT *
FROM preload_runs
WHERE job_id = ?
ORDER BY id DESC
LIMIT ?
`).all(jobId, limit).map(normalizeRun);
  }

  function registerDashboardPreloadRequest({
    jobId,
    dashboardId,
    section,
    cacheKey,
    input = {}
  }) {
    const timestamp = toIsoString(now);
    const inputJson = JSON.stringify(input || {});

    db.prepare(`
INSERT INTO preload_dashboard_requests (
  job_id,
  dashboard_id,
  section,
  cache_key,
  input_json,
  first_seen_at,
  last_seen_at,
  hit_count
) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
ON CONFLICT(job_id, section, cache_key) DO UPDATE SET
  dashboard_id = excluded.dashboard_id,
  input_json = excluded.input_json,
  last_seen_at = excluded.last_seen_at,
  hit_count = preload_dashboard_requests.hit_count + 1
`).run(jobId, dashboardId, section, cacheKey, inputJson, timestamp, timestamp);

    return normalizeDashboardPreloadRequest(db.prepare(`
SELECT *
FROM preload_dashboard_requests
WHERE job_id = ? AND section = ? AND cache_key = ?
`).get(jobId, section, cacheKey));
  }

  function listDashboardPreloadRequests(jobId, limit = 100) {
    return db.prepare(`
SELECT *
FROM preload_dashboard_requests
WHERE job_id = ?
ORDER BY last_seen_at DESC, hit_count DESC, cache_key ASC
LIMIT ?
`).all(jobId, limit).map(normalizeDashboardPreloadRequest);
  }

  function saveDashboardPreloadResult({
    jobId,
    dashboardId,
    section,
    cacheKey,
    fromDate,
    toDate,
    payload
  }) {
    assertValidDashboardPreloadRange(fromDate, toDate);

    const timestamp = toIsoString(now);
    const payloadJson = JSON.stringify(payload || {});

    db.prepare(`
INSERT INTO preload_dashboard_results (
  job_id,
  dashboard_id,
  section,
  cache_key,
  from_date,
  to_date,
  payload_json,
  refreshed_at,
  source_from,
  source_to
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(job_id, section, cache_key) DO UPDATE SET
  dashboard_id = excluded.dashboard_id,
  from_date = excluded.from_date,
  to_date = excluded.to_date,
  payload_json = excluded.payload_json,
  refreshed_at = excluded.refreshed_at,
  source_from = excluded.source_from,
  source_to = excluded.source_to
`).run(jobId, dashboardId, section, cacheKey, fromDate, toDate, payloadJson, timestamp, fromDate, toDate);

    return normalizeDashboardPreloadResult(db.prepare(`
SELECT *
FROM preload_dashboard_results
WHERE job_id = ? AND section = ? AND cache_key = ?
`).get(jobId, section, cacheKey));
  }

  function readDashboardPreloadResult({ jobId, section, cacheKey, fromDate, toDate }) {
    assertValidDashboardPreloadRange(fromDate, toDate);

    return normalizeDashboardPreloadResult(db.prepare(`
SELECT *
FROM preload_dashboard_results
WHERE job_id = ?
  AND section = ?
  AND cache_key = ?
  AND source_from <= ?
  AND source_to >= ?
LIMIT 1
`).get(jobId, section, cacheKey, fromDate, toDate));
  }

  function getSalesByProjectOverview() {
    const coverage = coverageSegmentFromRows(normalizeRows(db.prepare(`
SELECT period_date
FROM sales_by_project_coverage
ORDER BY period_date
`).all()));
    const job = getJob(SALES_PRELOAD_JOB_ID) || {};
    const lastErrorRun = normalizeRun(db.prepare(`
SELECT *
FROM preload_runs
WHERE job_id = ? AND status = 'failed' AND error_message != ''
ORDER BY id DESC
LIMIT 1
`).get(SALES_PRELOAD_JOB_ID));

    return {
      coveredFrom: coverage.coveredFrom || '',
      coveredTo: coverage.coveredTo || '',
      lastSuccessAt: job.lastSuccessAt || '',
      lastError: lastErrorRun ? lastErrorRun.errorMessage : ''
    };
  }

  function getSalesByProjectDiagnostics() {
    const coverage = db.prepare(`
SELECT
  MIN(period_date) AS min_date,
  MAX(period_date) AS max_date,
  COUNT(*) AS days
FROM sales_by_project_coverage
`).get();
    const daily = db.prepare('SELECT COUNT(*) AS rows FROM sales_by_project_daily').get();
    const orderFacts = db.prepare('SELECT COUNT(*) AS rows FROM sales_by_project_order_facts').get();
    const shiftFacts = db.prepare('SELECT COUNT(*) AS rows FROM sales_by_project_shift_facts').get();

    return {
      coverage: {
        minDate: coverage && coverage.min_date ? coverage.min_date : '',
        maxDate: coverage && coverage.max_date ? coverage.max_date : '',
        days: Number(coverage && coverage.days ? coverage.days : 0)
      },
      tables: {
        dailyRows: Number(daily && daily.rows ? daily.rows : 0),
        orderFacts: Number(orderFacts && orderFacts.rows ? orderFacts.rows : 0),
        shiftFacts: Number(shiftFacts && shiftFacts.rows ? shiftFacts.rows : 0)
      },
      lastRuns: listRuns(SALES_PRELOAD_JOB_ID, 5)
    };
  }

  function hasSalesByProjectCoverage(fromDate, toDate) {
    assertValidSalesByProjectRange(fromDate, toDate);

    const dates = enumerateDateRange(fromDate, toDate);

    if (dates.length === 0) {
      return true;
    }

    const row = db.prepare(`
SELECT COUNT(*) AS covered_days
FROM sales_by_project_coverage
WHERE period_date >= ? AND period_date < ?
`).get(fromDate, toDate);

    return Number(row.covered_days || 0) === dates.length;
  }

  function replaceSalesByProjectRange({
    fromDate,
    toDate,
    dailyRows = [],
    orderFacts = [],
    shiftFacts = []
  }) {
    assertValidSalesByProjectRange(fromDate, toDate);

    const refreshedAt = toIsoString(now);
    const deleteDaily = db.prepare('DELETE FROM sales_by_project_daily WHERE period_date >= ? AND period_date < ?');
    const deleteOrderFacts = db.prepare('DELETE FROM sales_by_project_order_facts WHERE period_date >= ? AND period_date < ?');
    const deleteShiftFacts = db.prepare('DELETE FROM sales_by_project_shift_facts WHERE period_date >= ? AND period_date < ?');
    const deleteCoverage = db.prepare('DELETE FROM sales_by_project_coverage WHERE period_date >= ? AND period_date < ?');
    const insertCoverage = db.prepare(`
INSERT INTO sales_by_project_coverage (period_date, source_from, source_to, refreshed_at)
VALUES (?, ?, ?, ?)
`);
    const insertDaily = db.prepare(`
INSERT INTO sales_by_project_daily (
  period_date,
  brand,
  ordered_shifts,
  workplaces_with_orders,
  worked_shifts,
  revenue_rub,
  unique_workers,
  workplaces_with_worked_shifts,
  cancelled_shifts,
  self_booked_confirmed_shifts,
  avg_worker_rate_hour_weighted_sum,
  avg_worker_rate_hour_weight,
  status,
  shifts,
  refreshed_at,
  source_from,
  source_to
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
    const insertOrderFact = db.prepare(`
INSERT INTO sales_by_project_order_facts (
  period_date, brand, order_id, workplace_id, ordered_shifts, refreshed_at
) VALUES (?, ?, ?, ?, ?, ?)
`);
    const insertShiftFact = db.prepare(`
INSERT INTO sales_by_project_shift_facts (
  period_date,
  brand,
  job_id,
  worker_id,
  workplace_id,
  status,
  is_successful_confirmed_shift,
  revenue_rub,
  cancelled_shifts,
  self_booked_confirmed_shift,
  worker_rate_hour,
  refreshed_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

    db.exec('BEGIN IMMEDIATE');
    try {
      deleteDaily.run(fromDate, toDate);
      deleteOrderFacts.run(fromDate, toDate);
      deleteShiftFacts.run(fromDate, toDate);
      deleteCoverage.run(fromDate, toDate);

      assertRowsInsideRange(dailyRows, fromDate, toDate, 'dailyRows');
      assertRowsInsideRange(orderFacts, fromDate, toDate, 'orderFacts');
      assertRowsInsideRange(shiftFacts, fromDate, toDate, 'shiftFacts');
      assertRequiredFactIds(orderFacts, shiftFacts);

      for (const periodDate of enumerateDateRange(fromDate, toDate)) {
        insertCoverage.run(periodDate, fromDate, toDate, refreshedAt);
      }

      for (const row of dailyRows) {
        insertDaily.run(
          row.period_date,
          row.brand || '',
          finiteNumber(row.ordered_shifts),
          finiteNumber(row.workplaces_with_orders),
          finiteNumber(row.worked_shifts),
          finiteNumber(row.revenue_rub),
          finiteNumber(row.unique_workers),
          finiteNumber(row.workplaces_with_worked_shifts),
          finiteNumber(row.cancelled_shifts),
          finiteNumber(row.self_booked_confirmed_shifts),
          finiteNumber(row.avg_worker_rate_hour_weighted_sum),
          finiteNumber(row.avg_worker_rate_hour_weight),
          row.status || '',
          finiteNumber(row.shifts),
          refreshedAt,
          fromDate,
          toDate
        );
      }

      for (const row of orderFacts) {
        insertOrderFact.run(
          row.period_date,
          row.brand || '',
          row.order_id || '',
          row.workplace_id || '',
          finiteNumber(row.ordered_shifts),
          refreshedAt
        );
      }

      for (const row of shiftFacts) {
        insertShiftFact.run(
          row.period_date,
          row.brand || '',
          row.job_id || '',
          row.worker_id || '',
          row.workplace_id || '',
          row.status || '',
          Object.prototype.hasOwnProperty.call(row, 'is_successful_confirmed_shift')
            ? finiteNumber(row.is_successful_confirmed_shift)
            : (row.status === 'confirmed' ? 1 : 0),
          finiteNumber(row.revenue_rub),
          finiteNumber(row.cancelled_shifts),
          finiteNumber(row.self_booked_confirmed_shift),
          finiteNumber(row.worker_rate_hour),
          refreshedAt
        );
      }

      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function readSalesByProjectSectionRows({ section, period, fromDate, toDate }) {
    assertSalesByProjectPreloadSection(section);
    assertValidSalesByProjectRange(fromDate, toDate);
    assertSalesByProjectPreloadPeriod(period);

    if (!hasSalesByProjectCoverage(fromDate, toDate)) {
      return null;
    }

    if (section === 'summary') {
      return {
        orderSummaryRows: normalizeRows(db.prepare(`
SELECT
  COALESCE(SUM(ordered_shifts), 0) AS ordered_shifts,
  COUNT(DISTINCT CASE WHEN workplace_id != '' THEN workplace_id END) AS workplaces_with_orders
FROM sales_by_project_order_facts
WHERE period_date >= ? AND period_date < ?
`).all(fromDate, toDate)),
        shiftSummaryRows: normalizeRows(db.prepare(`
SELECT
  COUNT(DISTINCT CASE WHEN is_successful_confirmed_shift = 1 AND job_id != '' THEN job_id END) AS worked_shifts,
  COALESCE(SUM(CASE WHEN is_successful_confirmed_shift = 1 THEN revenue_rub ELSE 0 END), 0) AS revenue_rub,
  COUNT(DISTINCT CASE WHEN is_successful_confirmed_shift = 1 AND worker_id != '' THEN worker_id END) AS unique_workers,
  COUNT(DISTINCT CASE WHEN is_successful_confirmed_shift = 1 AND workplace_id != '' THEN workplace_id END) AS workplaces_with_worked_shifts,
  COALESCE(SUM(cancelled_shifts), 0) AS cancelled_shifts,
  COALESCE(SUM(CASE WHEN is_successful_confirmed_shift = 1 THEN self_booked_confirmed_shift ELSE 0 END), 0) AS self_booked_confirmed_shifts,
  COALESCE(AVG(CASE WHEN is_successful_confirmed_shift = 1 AND worker_rate_hour > 0 THEN worker_rate_hour END), 0) AS avg_worker_rate_hour
FROM sales_by_project_shift_facts
WHERE period_date >= ? AND period_date < ?
`).all(fromDate, toDate))
      };
    }

    if (section === 'trend') {
      const periodExpression = sqlitePeriodExpression(period);

      return {
        orderTrendRows: normalizeRows(db.prepare(`
SELECT
  ${periodExpression} AS period,
  COALESCE(SUM(ordered_shifts), 0) AS ordered_shifts
FROM sales_by_project_order_facts
WHERE period_date >= ? AND period_date < ?
GROUP BY period
ORDER BY period
`).all(fromDate, toDate)),
        shiftTrendRows: normalizeRows(db.prepare(`
SELECT
  ${periodExpression} AS period,
  COUNT(DISTINCT CASE WHEN is_successful_confirmed_shift = 1 AND job_id != '' THEN job_id END) AS worked_shifts,
  COALESCE(SUM(CASE WHEN is_successful_confirmed_shift = 1 THEN revenue_rub ELSE 0 END), 0) AS revenue_rub,
  COALESCE(SUM(cancelled_shifts), 0) AS cancelled_shifts
FROM sales_by_project_shift_facts
WHERE period_date >= ? AND period_date < ?
GROUP BY period
ORDER BY period
`).all(fromDate, toDate))
      };
    }

    if (section === 'brands') {
      return {
        brandOrderRows: normalizeRows(db.prepare(`
SELECT
  brand,
  COALESCE(SUM(ordered_shifts), 0) AS ordered_shifts,
  COUNT(DISTINCT CASE WHEN workplace_id != '' THEN workplace_id END) AS workplaces_with_orders
FROM sales_by_project_order_facts
WHERE period_date >= ? AND period_date < ?
GROUP BY brand
ORDER BY ordered_shifts DESC
`).all(fromDate, toDate)),
        brandShiftRows: normalizeRows(db.prepare(`
SELECT
  brand,
  COUNT(DISTINCT CASE WHEN is_successful_confirmed_shift = 1 AND job_id != '' THEN job_id END) AS worked_shifts,
  COALESCE(SUM(CASE WHEN is_successful_confirmed_shift = 1 THEN revenue_rub ELSE 0 END), 0) AS revenue_rub,
  COUNT(DISTINCT CASE WHEN is_successful_confirmed_shift = 1 AND worker_id != '' THEN worker_id END) AS unique_workers,
  COUNT(DISTINCT CASE WHEN is_successful_confirmed_shift = 1 AND workplace_id != '' THEN workplace_id END) AS workplaces_with_worked_shifts,
  COALESCE(SUM(cancelled_shifts), 0) AS cancelled_shifts,
  COALESCE(SUM(CASE WHEN is_successful_confirmed_shift = 1 THEN self_booked_confirmed_shift ELSE 0 END), 0) AS self_booked_confirmed_shifts,
  COALESCE(AVG(CASE WHEN is_successful_confirmed_shift = 1 AND worker_rate_hour > 0 THEN worker_rate_hour END), 0) AS avg_worker_rate_hour
FROM sales_by_project_shift_facts
WHERE period_date >= ? AND period_date < ?
GROUP BY brand
ORDER BY worked_shifts DESC, revenue_rub DESC
`).all(fromDate, toDate))
      };
    }

    const statusRows = normalizeRows(db.prepare(`
SELECT
  CASE WHEN status = '' THEN 'empty' ELSE status END AS status,
  COUNT(*) AS shifts
FROM sales_by_project_shift_facts
WHERE period_date >= ? AND period_date < ?
GROUP BY status
ORDER BY shifts DESC
`).all(fromDate, toDate));

    return { statusRows };
  }

  function close() {
    db.close();
  }

  return {
    getJob,
    listJobs,
    saveJobSchedule,
    startRun,
    finishRun,
    listRuns,
    registerDashboardPreloadRequest,
    listDashboardPreloadRequests,
    saveDashboardPreloadResult,
    readDashboardPreloadResult,
    getSalesByProjectOverview,
    getSalesByProjectDiagnostics,
    hasSalesByProjectCoverage,
    replaceSalesByProjectRange,
    readSalesByProjectSectionRows,
    close
  };
}

module.exports = {
  DEFAULT_PRELOAD_REFRESH_DAYS,
  DEFAULT_PRELOAD_REFRESH_FUTURE_DAYS,
  DEFAULT_PRELOAD_SCHEDULE_TIME,
  DEFAULT_PRELOAD_STORE_PATH,
  DEFAULT_PRELOAD_TIMEZONE,
  SALES_PRELOAD_JOB_ID,
  WORKPLACE_ANALYSIS_PRELOAD_JOB_ID,
  createPreloadStore
};
