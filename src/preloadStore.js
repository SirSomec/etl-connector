const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SALES_PRELOAD_JOB_ID = 'sales-by-project';
const WORKPLACE_ANALYSIS_PRELOAD_JOB_ID = 'workplace-analysis';
const WORKPLACE_POINT_PRELOAD_JOB_ID = 'workplace-point';
const DEFAULT_PRELOAD_REFRESH_DAYS = 45;
const DEFAULT_PRELOAD_REFRESH_FUTURE_DAYS = 45;
const DEFAULT_PRELOAD_STORE_PATH = path.join(process.cwd(), 'data', 'preload.sqlite');
const DEFAULT_PRELOAD_SCHEDULE_TIME = '03:00';
const DEFAULT_PRELOAD_TIMEZONE = 'Europe/Moscow';
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const SALES_BY_PROJECT_PRELOAD_SECTIONS = new Set(['summary', 'trend', 'brands', 'statuses']);
const SALES_BY_PROJECT_PRELOAD_PERIODS = new Set(['day', 'week', 'month', 'quarter']);
const WORKPLACE_POINT_PRELOAD_SECTIONS = new Set(['summary', 'charts', 'year-heatmap', 'radius']);

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

function nullableFiniteNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
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

function tableHasColumn(db, tableName, columnName) {
  return db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .some((row) => row.name === columnName);
}

function resetWorkplacePointPreloadTables(db) {
  db.exec(`
DROP TABLE IF EXISTS workplace_point_coverage;
DROP TABLE IF EXISTS workplace_point_order_facts;
DROP TABLE IF EXISTS workplace_point_shift_facts;
DROP TABLE IF EXISTS workplace_point_order_status_facts;
DROP TABLE IF EXISTS workplace_point_booked_worker_facts;
DROP TABLE IF EXISTS workplace_point_review_rollups;
DROP TABLE IF EXISTS workplace_point_radius_rollups;
DROP TABLE IF EXISTS workplace_point_radius_coverage;
`);
}

function ensureWorkplacePointCoverageSchema(db) {
  const hasCoverageTable = db
    .prepare("SELECT 1 AS exists_flag FROM sqlite_master WHERE type = 'table' AND name = 'workplace_point_coverage'")
    .get();

  if (hasCoverageTable && !tableHasColumn(db, 'workplace_point_coverage', 'workplace_id')) {
    resetWorkplacePointPreloadTables(db);
  }
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

function seedPreloadJob(db, now, {
  id,
  title,
  scheduleTime = DEFAULT_PRELOAD_SCHEDULE_TIME,
  timezone = DEFAULT_PRELOAD_TIMEZONE,
  refreshPastDays = DEFAULT_PRELOAD_REFRESH_DAYS,
  refreshFutureDays = DEFAULT_PRELOAD_REFRESH_FUTURE_DAYS
}) {
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
    scheduleTime,
    timezone,
    refreshPastDays,
    refreshPastDays,
    refreshFutureDays,
    timestamp,
    timestamp
  );
}

function initializeSchema(db, now) {
  db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
`);

  ensureWorkplacePointCoverageSchema(db);

  db.exec(`
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

CREATE TABLE IF NOT EXISTS workplace_point_coverage (
  workplace_id TEXT NOT NULL,
  period_date TEXT NOT NULL,
  source_from TEXT NOT NULL,
  source_to TEXT NOT NULL,
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY (workplace_id, period_date)
);

CREATE TABLE IF NOT EXISTS workplace_point_order_facts (
  period_date TEXT NOT NULL,
  workplace_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  profession TEXT NOT NULL DEFAULT '',
  order_type TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL DEFAULT 0,
  pieceworks REAL NOT NULL DEFAULT 0,
  order_lead_minutes REAL,
  include_deleted INTEGER NOT NULL DEFAULT 0,
  include_hidden INTEGER NOT NULL DEFAULT 0,
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY (period_date, order_id)
);

CREATE TABLE IF NOT EXISTS workplace_point_shift_facts (
  period_date TEXT NOT NULL,
  workplace_id TEXT NOT NULL,
  order_id TEXT NOT NULL DEFAULT '',
  job_id TEXT NOT NULL,
  worker_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  is_successful_confirmed_shift REAL NOT NULL DEFAULT 0,
  is_forecast_active_shift REAL NOT NULL DEFAULT 0,
  is_dropoff_24h REAL NOT NULL DEFAULT 0,
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY (period_date, job_id)
);

CREATE TABLE IF NOT EXISTS workplace_point_order_status_facts (
  period_date TEXT NOT NULL,
  workplace_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '',
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY (period_date, order_id, status)
);

CREATE TABLE IF NOT EXISTS workplace_point_booked_worker_facts (
  period_date TEXT NOT NULL,
  workplace_id TEXT NOT NULL,
  order_id TEXT NOT NULL DEFAULT '',
  job_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY (period_date, job_id, worker_id)
);

CREATE TABLE IF NOT EXISTS workplace_point_review_rollups (
  workplace_id TEXT PRIMARY KEY,
  review_count REAL NOT NULL DEFAULT 0,
  avg_rating_all REAL,
  avg_rating_last_10 REAL,
  refreshed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workplace_point_radius_rollups (
  workplace_id TEXT NOT NULL,
  active_window_date TEXT NOT NULL,
  radius_km REAL NOT NULL,
  workers REAL NOT NULL DEFAULT 0,
  active_session_workers REAL NOT NULL DEFAULT 0,
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY (workplace_id, active_window_date, radius_km)
);

CREATE TABLE IF NOT EXISTS workplace_point_radius_coverage (
  workplace_id TEXT NOT NULL,
  active_window_date TEXT NOT NULL,
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY (workplace_id, active_window_date)
);

CREATE INDEX IF NOT EXISTS idx_sales_daily_period_brand ON sales_by_project_daily (period_date, brand);
CREATE INDEX IF NOT EXISTS idx_sales_daily_status ON sales_by_project_daily (period_date, status);
CREATE INDEX IF NOT EXISTS idx_preload_runs_job_id ON preload_runs (job_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_preload_dashboard_requests_job ON preload_dashboard_requests (job_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_preload_dashboard_results_lookup ON preload_dashboard_results (job_id, section, cache_key, source_from, source_to);
CREATE INDEX IF NOT EXISTS idx_sales_order_facts_period_brand ON sales_by_project_order_facts (period_date, brand);
CREATE INDEX IF NOT EXISTS idx_sales_shift_facts_period_brand ON sales_by_project_shift_facts (period_date, brand);
CREATE INDEX IF NOT EXISTS idx_sales_shift_facts_status ON sales_by_project_shift_facts (period_date, status);
CREATE INDEX IF NOT EXISTS idx_workplace_point_orders_lookup ON workplace_point_order_facts (workplace_id, period_date);
CREATE INDEX IF NOT EXISTS idx_workplace_point_orders_profession ON workplace_point_order_facts (workplace_id, period_date, profession);
CREATE INDEX IF NOT EXISTS idx_workplace_point_orders_type ON workplace_point_order_facts (workplace_id, period_date, order_type);
CREATE INDEX IF NOT EXISTS idx_workplace_point_shifts_lookup ON workplace_point_shift_facts (workplace_id, period_date);
CREATE INDEX IF NOT EXISTS idx_workplace_point_shifts_status ON workplace_point_shift_facts (workplace_id, period_date, status);
CREATE INDEX IF NOT EXISTS idx_workplace_point_status_lookup ON workplace_point_order_status_facts (workplace_id, period_date, status);
CREATE INDEX IF NOT EXISTS idx_workplace_point_booked_lookup ON workplace_point_booked_worker_facts (workplace_id, period_date);
CREATE INDEX IF NOT EXISTS idx_workplace_point_radius_lookup ON workplace_point_radius_rollups (workplace_id, active_window_date);
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
  seedPreloadJob(db, now, {
    id: WORKPLACE_POINT_PRELOAD_JOB_ID,
    title: 'Карточка точки',
    scheduleTime: '08:00',
    refreshPastDays: 30,
    refreshFutureDays: 30
  });
}

function assertWorkplacePointPreloadSection(section) {
  if (!WORKPLACE_POINT_PRELOAD_SECTIONS.has(section)) {
    throw new Error(`Unknown workplace point preload section: ${section}`);
  }
}

function normalizeFilterValues(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => String(item || '')).filter((item) => item !== '');
}

function normalizeWorkplaceIds(values) {
  const ids = [];
  const seen = new Set();

  for (const value of Array.isArray(values) ? values : []) {
    const id = String(value || '').trim();

    if (id === '' || seen.has(id)) {
      continue;
    }

    seen.add(id);
    ids.push(id);
  }

  return ids;
}

function collectWorkplacePointCoverageIds({
  workplaceIds = [],
  orderFacts = [],
  shiftFacts = [],
  orderStatusFacts = [],
  bookedWorkerFacts = [],
  reviewRollups = [],
  radiusRollups = []
}) {
  const ids = normalizeWorkplaceIds(workplaceIds);
  const seen = new Set(ids);

  for (const rows of [orderFacts, shiftFacts, orderStatusFacts, bookedWorkerFacts, reviewRollups, radiusRollups]) {
    for (const row of Array.isArray(rows) ? rows : []) {
      const id = String(row && row.workplace_id ? row.workplace_id : '').trim();

      if (id === '' || seen.has(id)) {
        continue;
      }

      seen.add(id);
      ids.push(id);
    }
  }

  return ids;
}

function addInClause(clauses, params, columnSql, values) {
  if (values.length === 0) {
    return;
  }

  clauses.push(`${columnSql} IN (${values.map(() => '?').join(', ')})`);
  params.push(...values);
}

function workplacePointOrderFilterSql({ filters = {}, fromDate, toDate, alias = 'o' }) {
  const clauses = [
    `${alias}.period_date >= ?`,
    `${alias}.period_date < ?`,
    `${alias}.workplace_id = ?`
  ];
  const params = [fromDate, toDate, String(filters.workplaceId || '')];

  if (!filters.includeDeletedOrders) {
    clauses.push(`${alias}.include_deleted = 0`);
  }

  if (!filters.includeHiddenOrders) {
    clauses.push(`${alias}.include_hidden = 0`);
  }

  addInClause(clauses, params, `${alias}.profession`, normalizeFilterValues(filters.profession));
  addInClause(clauses, params, `${alias}.order_type`, normalizeFilterValues(filters.orderType));

  const jobStatuses = normalizeFilterValues(filters.jobStatus);

  if (jobStatuses.length > 0) {
    clauses.push(`EXISTS (
      SELECT 1
      FROM workplace_point_order_status_facts AS os
      WHERE os.period_date = ${alias}.period_date
        AND os.workplace_id = ${alias}.workplace_id
        AND os.order_id = ${alias}.order_id
        AND os.status IN (${jobStatuses.map(() => '?').join(', ')})
    )`);
    params.push(...jobStatuses);
  }

  return {
    whereSql: clauses.join('\n    AND '),
    params
  };
}

function activeWindowDateFromFilters(filters = {}, fallbackDate) {
  const value = filters.activeWindowDate
    || (typeof filters.activeSessionToDateTime === 'string' ? filters.activeSessionToDateTime.slice(0, 10) : '')
    || filters.currentDate
    || fallbackDate;

  parseDateOnly(value);
  return value;
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

  function getWorkplacePointOverview() {
    const coverage = coverageSegmentFromRows(normalizeRows(db.prepare(`
SELECT DISTINCT period_date
FROM workplace_point_coverage
ORDER BY period_date
`).all()));
    const job = getJob(WORKPLACE_POINT_PRELOAD_JOB_ID) || {};
    const lastErrorRun = normalizeRun(db.prepare(`
SELECT *
FROM preload_runs
WHERE job_id = ? AND status = 'failed' AND error_message != ''
ORDER BY id DESC
LIMIT 1
`).get(WORKPLACE_POINT_PRELOAD_JOB_ID));

    return {
      coveredFrom: coverage.coveredFrom || '',
      coveredTo: coverage.coveredTo || '',
      lastSuccessAt: job.lastSuccessAt || '',
      lastError: lastErrorRun ? lastErrorRun.errorMessage : ''
    };
  }

  function getWorkplacePointDiagnostics() {
    const coverage = db.prepare(`
SELECT
  MIN(period_date) AS min_date,
  MAX(period_date) AS max_date,
  COUNT(DISTINCT period_date) AS days
FROM workplace_point_coverage
`).get();
    const orderFacts = db.prepare('SELECT COUNT(*) AS rows FROM workplace_point_order_facts').get();
    const shiftFacts = db.prepare('SELECT COUNT(*) AS rows FROM workplace_point_shift_facts').get();
    const radiusRollups = db.prepare('SELECT COUNT(*) AS rows FROM workplace_point_radius_rollups').get();

    return {
      coverage: {
        minDate: coverage && coverage.min_date ? coverage.min_date : '',
        maxDate: coverage && coverage.max_date ? coverage.max_date : '',
        days: Number(coverage && coverage.days ? coverage.days : 0)
      },
      tables: {
        orderFacts: Number(orderFacts && orderFacts.rows ? orderFacts.rows : 0),
        shiftFacts: Number(shiftFacts && shiftFacts.rows ? shiftFacts.rows : 0),
        radiusRollups: Number(radiusRollups && radiusRollups.rows ? radiusRollups.rows : 0)
      },
      lastRuns: listRuns(WORKPLACE_POINT_PRELOAD_JOB_ID, 5)
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

  function hasWorkplacePointCoverage(workplaceId, fromDate, toDate) {
    assertValidDashboardPreloadRange(fromDate, toDate);

    const normalizedWorkplaceId = String(workplaceId || '');
    const dates = enumerateDateRange(fromDate, toDate);

    if (dates.length === 0) {
      return true;
    }

    if (normalizedWorkplaceId === '') {
      return false;
    }

    const row = db.prepare(`
SELECT COUNT(*) AS covered_days
FROM workplace_point_coverage
WHERE workplace_id = ? AND period_date >= ? AND period_date < ?
`).get(normalizedWorkplaceId, fromDate, toDate);

    return Number(row.covered_days || 0) === dates.length;
  }

  function hasAnyWorkplacePointCoverage(workplaceId, fromDate, toDate) {
    assertValidDashboardPreloadRange(fromDate, toDate);

    const normalizedWorkplaceId = String(workplaceId || '');

    if (normalizedWorkplaceId === '' || fromDate === toDate) {
      return false;
    }

    const row = db.prepare(`
SELECT 1 AS covered
FROM workplace_point_coverage
WHERE workplace_id = ? AND period_date >= ? AND period_date < ?
LIMIT 1
`).get(normalizedWorkplaceId, fromDate, toDate);

    return Boolean(row);
  }

  function hasWorkplacePointRadiusCoverage(workplaceId, activeWindowDate) {
    parseDateOnly(activeWindowDate);

    const row = db.prepare(`
SELECT 1 AS covered
FROM workplace_point_radius_coverage
WHERE workplace_id = ? AND active_window_date = ?
LIMIT 1
`).get(String(workplaceId || ''), activeWindowDate);

    return Boolean(row);
  }

  function replaceWorkplacePointRange({
    fromDate,
    toDate,
    workplaceIds = [],
    orderFacts = [],
    shiftFacts = [],
    orderStatusFacts = [],
    bookedWorkerFacts = [],
    reviewRollups = [],
    radiusRollups = []
  }) {
    assertValidDashboardPreloadRange(fromDate, toDate);

    const refreshedAt = toIsoString(now);
    const deleteOrderFacts = db.prepare('DELETE FROM workplace_point_order_facts WHERE period_date >= ? AND period_date < ?');
    const deleteShiftFacts = db.prepare('DELETE FROM workplace_point_shift_facts WHERE period_date >= ? AND period_date < ?');
    const deleteOrderStatusFacts = db.prepare('DELETE FROM workplace_point_order_status_facts WHERE period_date >= ? AND period_date < ?');
    const deleteBookedWorkerFacts = db.prepare('DELETE FROM workplace_point_booked_worker_facts WHERE period_date >= ? AND period_date < ?');
    const deleteCoverage = db.prepare('DELETE FROM workplace_point_coverage WHERE period_date >= ? AND period_date < ?');
    const insertCoverage = db.prepare(`
INSERT INTO workplace_point_coverage (workplace_id, period_date, source_from, source_to, refreshed_at)
VALUES (?, ?, ?, ?, ?)
`);
    const insertOrderFact = db.prepare(`
INSERT INTO workplace_point_order_facts (
  period_date,
  workplace_id,
  order_id,
  profession,
  order_type,
  amount,
  pieceworks,
  order_lead_minutes,
  include_deleted,
  include_hidden,
  refreshed_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
    const insertShiftFact = db.prepare(`
INSERT INTO workplace_point_shift_facts (
  period_date,
  workplace_id,
  order_id,
  job_id,
  worker_id,
  status,
  is_successful_confirmed_shift,
  is_forecast_active_shift,
  is_dropoff_24h,
  refreshed_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
    const insertOrderStatusFact = db.prepare(`
INSERT INTO workplace_point_order_status_facts (
  period_date,
  workplace_id,
  order_id,
  status,
  refreshed_at
) VALUES (?, ?, ?, ?, ?)
`);
    const insertBookedWorkerFact = db.prepare(`
INSERT INTO workplace_point_booked_worker_facts (
  period_date,
  workplace_id,
  order_id,
  job_id,
  worker_id,
  refreshed_at
) VALUES (?, ?, ?, ?, ?, ?)
`);
    const upsertReviewRollup = db.prepare(`
INSERT INTO workplace_point_review_rollups (
  workplace_id,
  review_count,
  avg_rating_all,
  avg_rating_last_10,
  refreshed_at
) VALUES (?, ?, ?, ?, ?)
ON CONFLICT(workplace_id) DO UPDATE SET
  review_count = excluded.review_count,
  avg_rating_all = excluded.avg_rating_all,
  avg_rating_last_10 = excluded.avg_rating_last_10,
  refreshed_at = excluded.refreshed_at
`);
    const upsertRadiusRollup = db.prepare(`
INSERT INTO workplace_point_radius_rollups (
  workplace_id,
  active_window_date,
  radius_km,
  workers,
  active_session_workers,
  refreshed_at
) VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(workplace_id, active_window_date, radius_km) DO UPDATE SET
  workers = excluded.workers,
  active_session_workers = excluded.active_session_workers,
  refreshed_at = excluded.refreshed_at
`);
    const upsertRadiusCoverage = db.prepare(`
INSERT INTO workplace_point_radius_coverage (
  workplace_id,
  active_window_date,
  refreshed_at
) VALUES (?, ?, ?)
ON CONFLICT(workplace_id, active_window_date) DO UPDATE SET
  refreshed_at = excluded.refreshed_at
`);

    db.exec('BEGIN IMMEDIATE');
    try {
      deleteOrderFacts.run(fromDate, toDate);
      deleteShiftFacts.run(fromDate, toDate);
      deleteOrderStatusFacts.run(fromDate, toDate);
      deleteBookedWorkerFacts.run(fromDate, toDate);
      deleteCoverage.run(fromDate, toDate);

      assertRowsInsideRange(orderFacts, fromDate, toDate, 'orderFacts');
      assertRowsInsideRange(shiftFacts, fromDate, toDate, 'shiftFacts');
      assertRowsInsideRange(orderStatusFacts, fromDate, toDate, 'orderStatusFacts');
      assertRowsInsideRange(bookedWorkerFacts, fromDate, toDate, 'bookedWorkerFacts');
      assertRequiredFactIds(orderFacts, shiftFacts);

      for (const row of radiusRollups) {
        parseDateOnly(row.active_window_date);
      }

      const coveredWorkplaceIds = collectWorkplacePointCoverageIds({
        workplaceIds,
        orderFacts,
        shiftFacts,
        orderStatusFacts,
        bookedWorkerFacts,
        reviewRollups,
        radiusRollups
      });

      for (const workplaceId of coveredWorkplaceIds) {
        for (const periodDate of enumerateDateRange(fromDate, toDate)) {
          insertCoverage.run(workplaceId, periodDate, fromDate, toDate, refreshedAt);
        }
      }

      for (const row of orderFacts) {
        insertOrderFact.run(
          row.period_date,
          row.workplace_id || '',
          row.order_id || '',
          row.profession || '',
          row.order_type || '',
          finiteNumber(row.amount),
          finiteNumber(row.pieceworks),
          nullableFiniteNumber(row.order_lead_minutes),
          finiteNumber(row.include_deleted),
          finiteNumber(row.include_hidden),
          refreshedAt
        );
      }

      for (const row of shiftFacts) {
        insertShiftFact.run(
          row.period_date,
          row.workplace_id || '',
          row.order_id || '',
          row.job_id || '',
          row.worker_id || '',
          row.status || '',
          finiteNumber(row.is_successful_confirmed_shift),
          finiteNumber(row.is_forecast_active_shift),
          finiteNumber(row.is_dropoff_24h),
          refreshedAt
        );
      }

      for (const row of orderStatusFacts) {
        insertOrderStatusFact.run(
          row.period_date,
          row.workplace_id || '',
          row.order_id || '',
          row.status || '',
          refreshedAt
        );
      }

      for (const row of bookedWorkerFacts) {
        insertBookedWorkerFact.run(
          row.period_date,
          row.workplace_id || '',
          row.order_id || '',
          row.job_id || '',
          row.worker_id || '',
          refreshedAt
        );
      }

      for (const row of reviewRollups) {
        upsertReviewRollup.run(
          row.workplace_id || '',
          finiteNumber(row.review_count),
          nullableFiniteNumber(row.avg_rating_all),
          nullableFiniteNumber(row.avg_rating_last_10),
          refreshedAt
        );
      }

      const coveredRadiusKeys = new Set();

      for (const row of radiusRollups) {
        const workplaceId = row.workplace_id || '';
        const activeWindowDate = row.active_window_date;

        upsertRadiusRollup.run(
          workplaceId,
          activeWindowDate,
          finiteNumber(row.radius_km),
          finiteNumber(row.workers),
          finiteNumber(row.active_session_workers),
          refreshedAt
        );

        coveredRadiusKeys.add(`${workplaceId}\u0000${activeWindowDate}`);
      }

      for (const key of coveredRadiusKeys) {
        const [workplaceId, activeWindowDate] = key.split('\u0000');

        upsertRadiusCoverage.run(workplaceId, activeWindowDate, refreshedAt);
      }

      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function readWorkplacePointSectionRows({ section, filters = {}, fromDate, toDate }) {
    assertWorkplacePointPreloadSection(section);
    assertValidDashboardPreloadRange(fromDate, toDate);

    const hasCoverage = section === 'year-heatmap'
      ? hasAnyWorkplacePointCoverage(filters.workplaceId, fromDate, toDate)
      : hasWorkplacePointCoverage(filters.workplaceId, fromDate, toDate);

    if (!hasCoverage) {
      return null;
    }

    const currentDate = filters.currentDate && DATE_ONLY_RE.test(String(filters.currentDate))
      ? String(filters.currentDate)
      : fromDate;
    const { whereSql, params } = workplacePointOrderFilterSql({ filters, fromDate, toDate, alias: 'o' });
    const filteredOrdersCte = `
WITH filtered_orders AS (
  SELECT *
  FROM workplace_point_order_facts AS o
  WHERE ${whereSql}
)`;

    if (section === 'summary') {
      const summaryRows = normalizeRows(db.prepare(`
${filteredOrdersCte},
shift_summary AS (
  SELECT
    COUNT(DISTINCT CASE WHEN s.is_successful_confirmed_shift = 1 AND s.job_id != '' THEN s.job_id END) AS completed_shifts,
    COUNT(DISTINCT CASE WHEN s.is_successful_confirmed_shift = 1 AND s.period_date < ? AND s.job_id != '' THEN s.job_id END) AS sla_completed_shifts,
    COUNT(DISTINCT CASE WHEN s.is_forecast_active_shift = 1 AND s.period_date >= ? AND s.job_id != '' THEN s.job_id END) AS forecast_sla_active_shifts,
    COUNT(DISTINCT CASE WHEN s.is_successful_confirmed_shift = 1 AND s.worker_id != '' THEN s.worker_id END) AS unique_completed_workers,
    COUNT(DISTINCT CASE WHEN s.is_dropoff_24h = 1 AND s.job_id != '' THEN s.job_id END) AS dropoffs_24h
  FROM workplace_point_shift_facts AS s
  INNER JOIN filtered_orders AS fo
    ON fo.period_date = s.period_date
   AND fo.workplace_id = s.workplace_id
   AND fo.order_id = s.order_id
),
booked_summary AS (
  SELECT COUNT(DISTINCT CASE WHEN b.worker_id != '' THEN b.worker_id END) AS unique_booked_workers
  FROM workplace_point_booked_worker_facts AS b
  INNER JOIN filtered_orders AS fo
    ON fo.period_date = b.period_date
   AND fo.workplace_id = b.workplace_id
   AND fo.order_id = b.order_id
),
worker_week_summary AS (
  SELECT AVG(completed_shifts) AS avg_completed_shifts_per_active_worker_week
  FROM (
    SELECT
      date(s.period_date, '-' || ((CAST(strftime('%w', s.period_date) AS INTEGER) + 6) % 7) || ' days') AS period_week,
      s.worker_id AS worker_id,
      COUNT(DISTINCT s.job_id) AS completed_shifts
    FROM workplace_point_shift_facts AS s
    INNER JOIN filtered_orders AS fo
      ON fo.period_date = s.period_date
     AND fo.workplace_id = s.workplace_id
     AND fo.order_id = s.order_id
    WHERE s.is_successful_confirmed_shift = 1
      AND s.worker_id != ''
      AND s.job_id != ''
    GROUP BY period_week, s.worker_id
  )
),
worker_month_summary AS (
  SELECT AVG(completed_shifts) AS avg_completed_shifts_per_active_worker_month
  FROM (
    SELECT
      substr(s.period_date, 1, 7) || '-01' AS period_month,
      s.worker_id AS worker_id,
      COUNT(DISTINCT s.job_id) AS completed_shifts
    FROM workplace_point_shift_facts AS s
    INNER JOIN filtered_orders AS fo
      ON fo.period_date = s.period_date
     AND fo.workplace_id = s.workplace_id
     AND fo.order_id = s.order_id
    WHERE s.is_successful_confirmed_shift = 1
      AND s.worker_id != ''
      AND s.job_id != ''
    GROUP BY period_month, s.worker_id
  )
)
SELECT
  COALESCE((SELECT SUM(amount) FROM filtered_orders), 0) AS ordered_shifts,
  COALESCE((SELECT completed_shifts FROM shift_summary), 0) AS completed_shifts,
  COALESCE((SELECT SUM(CASE WHEN period_date < ? THEN amount ELSE 0 END) FROM filtered_orders), 0) AS sla_ordered_shifts,
  COALESCE((SELECT sla_completed_shifts FROM shift_summary), 0) AS sla_completed_shifts,
  COALESCE((SELECT SUM(CASE WHEN period_date >= ? THEN amount ELSE 0 END) FROM filtered_orders), 0) AS forecast_sla_ordered_shifts,
  COALESCE((SELECT forecast_sla_active_shifts FROM shift_summary), 0) AS forecast_sla_active_shifts,
  COALESCE((SELECT COUNT(DISTINCT period_date) FROM filtered_orders), 0) AS active_days,
  COALESCE((SELECT unique_completed_workers FROM shift_summary), 0) AS unique_completed_workers,
  COALESCE((SELECT unique_booked_workers FROM booked_summary), 0) AS unique_booked_workers,
  COALESCE((SELECT avg_completed_shifts_per_active_worker_week FROM worker_week_summary), 0) AS avg_completed_shifts_per_active_worker_week,
  COALESCE((SELECT avg_completed_shifts_per_active_worker_month FROM worker_month_summary), 0) AS avg_completed_shifts_per_active_worker_month,
  COALESCE((SELECT dropoffs_24h FROM shift_summary), 0) AS dropoffs_24h
`).all(...params, currentDate, currentDate, currentDate, currentDate));
      const reviewSummaryRows = normalizeRows(db.prepare(`
SELECT
  review_count,
  avg_rating_all,
  avg_rating_last_10
FROM workplace_point_review_rollups
WHERE workplace_id = ?
`).all(String(filters.workplaceId || '')));

      return {
        summaryRows,
        reviewSummaryRows: reviewSummaryRows.length > 0
          ? reviewSummaryRows
          : [{ review_count: 0, avg_rating_all: null, avg_rating_last_10: null }]
      };
    }

    if (section === 'charts' || section === 'year-heatmap') {
      const dailyRows = normalizeRows(db.prepare(`
${filteredOrdersCte},
shift_daily AS (
  SELECT
    s.period_date AS period,
    COUNT(DISTINCT CASE WHEN s.is_successful_confirmed_shift = 1 AND s.job_id != '' THEN s.job_id END) AS completed_shifts,
    COUNT(DISTINCT CASE WHEN s.is_forecast_active_shift = 1 AND s.period_date >= ? AND s.job_id != '' THEN s.job_id END) AS forecast_sla_active_shifts,
    COUNT(DISTINCT CASE WHEN s.is_dropoff_24h = 1 AND s.job_id != '' THEN s.job_id END) AS dropoffs_24h
  FROM workplace_point_shift_facts AS s
  INNER JOIN filtered_orders AS fo
    ON fo.period_date = s.period_date
   AND fo.workplace_id = s.workplace_id
   AND fo.order_id = s.order_id
  GROUP BY s.period_date
)
SELECT
  fo.period_date AS period,
  COALESCE(SUM(fo.amount), 0) AS ordered_shifts,
  AVG(fo.order_lead_minutes) AS avg_order_lead_minutes,
  MIN(fo.order_lead_minutes) AS min_order_lead_minutes,
  COALESCE(sd.completed_shifts, 0) AS completed_shifts,
  COALESCE(sd.forecast_sla_active_shifts, 0) AS forecast_sla_active_shifts,
  COALESCE(sd.dropoffs_24h, 0) AS dropoffs_24h
FROM filtered_orders AS fo
LEFT JOIN shift_daily AS sd ON fo.period_date = sd.period
GROUP BY fo.period_date
ORDER BY fo.period_date
`).all(...params, currentDate));

      if (section === 'year-heatmap') {
        return { yearHeatmapRows: dailyRows };
      }

      const professionRows = normalizeRows(db.prepare(`
${filteredOrdersCte}
SELECT
  profession,
  COALESCE(SUM(amount), 0) AS ordered_shifts
FROM filtered_orders
GROUP BY profession
ORDER BY ordered_shifts DESC, profession
`).all(...params));

      return { dailyRows, professionRows };
    }

    const activeWindowDate = activeWindowDateFromFilters(filters, toDate);

    if (!hasWorkplacePointRadiusCoverage(filters.workplaceId, activeWindowDate)) {
      return null;
    }

    return {
      radiusRows: normalizeRows(db.prepare(`
SELECT
  radius_km,
  workers,
  active_session_workers
FROM workplace_point_radius_rollups
WHERE workplace_id = ?
  AND active_window_date = ?
ORDER BY radius_km
`).all(String(filters.workplaceId || ''), activeWindowDate))
    };
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
    getWorkplacePointOverview,
    getWorkplacePointDiagnostics,
    hasSalesByProjectCoverage,
    replaceSalesByProjectRange,
    readSalesByProjectSectionRows,
    hasWorkplacePointCoverage,
    hasWorkplacePointRadiusCoverage,
    replaceWorkplacePointRange,
    readWorkplacePointSectionRows,
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
  WORKPLACE_POINT_PRELOAD_JOB_ID,
  createPreloadStore
};
