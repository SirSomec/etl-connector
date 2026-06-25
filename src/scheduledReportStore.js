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

function toIsoString(now) {
  return now().toISOString();
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeSql(value) {
  const sql = normalizeText(value);

  if (!sql) {
    throw new Error('Scheduled report requires sql');
  }

  return sql;
}

function normalizeTitle(value) {
  const title = normalizeText(value);

  if (!title) {
    throw new Error('Scheduled report requires title');
  }

  return title;
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);

  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function normalizeBoolean(value, fallback = true) {
  return typeof value === 'boolean' ? value : fallback;
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(String(value || '[]'));

    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function isPathInsideDir(filePath, dirPath) {
  const relativePath = path.relative(path.resolve(dirPath), path.resolve(filePath));

  return Boolean(relativePath) && relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath);
}

function normalizeReport(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    sql: row.sql,
    enabled: Boolean(row.enabled),
    rowLimit: row.row_limit,
    timeoutMs: row.timeout_ms,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeSchedule(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    reportId: row.report_id,
    enabled: Boolean(row.enabled),
    scheduleTime: row.schedule_time,
    timezone: row.timezone,
    recipients: parseJsonArray(row.recipients_json),
    emailSubject: row.email_subject,
    emailBody: row.email_body,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeRun(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    reportId: row.report_id,
    scheduleId: row.schedule_id,
    trigger: row.trigger,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at || '',
    rowCount: row.row_count,
    fileSizeBytes: row.file_size_bytes,
    filePath: row.file_path,
    recipients: parseJsonArray(row.recipients_json),
    errorMessage: row.error_message,
    createdBy: row.created_by
  };
}

function normalizeMailSettings(row) {
  if (!row) {
    return null;
  }

  return {
    host: row.host,
    port: row.port,
    secureMode: row.secure_mode,
    username: row.username,
    fromEmail: row.from_email,
    fromName: row.from_name,
    hasPassword: Boolean(row.password_secret),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeMailSettingsSecret(row) {
  if (!row) {
    return null;
  }

  return {
    host: row.host,
    port: row.port,
    secureMode: row.secure_mode,
    username: row.username,
    password: row.password_secret,
    fromEmail: row.from_email,
    fromName: row.from_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function initializeSchema(db) {
  db.exec(`
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
`);
}

function createScheduledReportStore({
  filePath = DEFAULT_SCHEDULED_REPORT_STORE_PATH,
  fileDir = DEFAULT_SCHEDULED_REPORT_FILE_DIR,
  now = () => new Date()
} = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.mkdirSync(fileDir, { recursive: true });

  const db = new DatabaseSync(filePath);
  initializeSchema(db);

  function assertReportExists(reportId) {
    if (!getReport(reportId)) {
      throw new Error(`Scheduled report not found: ${reportId}`);
    }
  }

  function assertScheduleExists(scheduleId, reportId) {
    const schedule = getSchedule(scheduleId);

    if (!schedule) {
      throw new Error(`Scheduled report schedule not found: ${scheduleId}`);
    }

    if (reportId !== undefined && reportId !== null && schedule.reportId !== reportId) {
      throw new Error(`Scheduled report schedule ${scheduleId} does not belong to report ${reportId}`);
    }

    return schedule;
  }

  function getReport(reportId) {
    return normalizeReport(db.prepare('SELECT * FROM scheduled_reports WHERE id = ?').get(reportId));
  }

  function listReports() {
    return db.prepare(`
SELECT *
FROM scheduled_reports
ORDER BY id DESC
`).all().map(normalizeReport);
  }

  function createReport(input) {
    const timestamp = toIsoString(now);
    const userId = normalizeText(input && input.userId);
    const result = db.prepare(`
INSERT INTO scheduled_reports (
  title,
  description,
  sql,
  enabled,
  row_limit,
  timeout_ms,
  created_by,
  updated_by,
  created_at,
  updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
      normalizeTitle(input && input.title),
      normalizeText(input && input.description),
      normalizeSql(input && input.sql),
      Number(normalizeBoolean(input && input.enabled, true)),
      normalizePositiveInteger(input && input.rowLimit, 10000),
      normalizePositiveInteger(input && input.timeoutMs, 120000),
      userId,
      userId,
      timestamp,
      timestamp
    );

    return getReport(result.lastInsertRowid);
  }

  function updateReport(reportId, input) {
    const report = getReport(reportId);

    if (!report) {
      return null;
    }

    const timestamp = toIsoString(now);
    const title = Object.prototype.hasOwnProperty.call(input || {}, 'title')
      ? normalizeTitle(input.title)
      : report.title;
    const sql = Object.prototype.hasOwnProperty.call(input || {}, 'sql') ? normalizeSql(input.sql) : report.sql;

    db.prepare(`
UPDATE scheduled_reports
SET title = ?,
    description = ?,
    sql = ?,
    enabled = ?,
    row_limit = ?,
    timeout_ms = ?,
    updated_by = ?,
    updated_at = ?
WHERE id = ?
`).run(
      title,
      Object.prototype.hasOwnProperty.call(input || {}, 'description')
        ? normalizeText(input.description)
        : report.description,
      sql,
      Number(Object.prototype.hasOwnProperty.call(input || {}, 'enabled') ? Boolean(input.enabled) : report.enabled),
      Object.prototype.hasOwnProperty.call(input || {}, 'rowLimit')
        ? normalizePositiveInteger(input.rowLimit, report.rowLimit)
        : report.rowLimit,
      Object.prototype.hasOwnProperty.call(input || {}, 'timeoutMs')
        ? normalizePositiveInteger(input.timeoutMs, report.timeoutMs)
        : report.timeoutMs,
      Object.prototype.hasOwnProperty.call(input || {}, 'userId') ? normalizeText(input.userId) : report.updatedBy,
      timestamp,
      reportId
    );

    return getReport(reportId);
  }

  function getSchedule(scheduleId) {
    return normalizeSchedule(db.prepare('SELECT * FROM scheduled_report_schedules WHERE id = ?').get(scheduleId));
  }

  function listSchedules(reportId) {
    return db.prepare(`
SELECT *
FROM scheduled_report_schedules
WHERE report_id = ?
ORDER BY id DESC
`).all(reportId).map(normalizeSchedule);
  }

  function listEnabledSchedules() {
    return db.prepare(`
SELECT *
FROM scheduled_report_schedules
WHERE enabled = 1
ORDER BY schedule_time ASC, id ASC
`).all().map(normalizeSchedule);
  }

  function createSchedule(input) {
    const timestamp = toIsoString(now);
    const userId = normalizeText(input && input.userId);

    assertReportExists(input && input.reportId);

    const result = db.prepare(`
INSERT INTO scheduled_report_schedules (
  report_id,
  enabled,
  schedule_time,
  timezone,
  recipients_json,
  email_subject,
  email_body,
  created_by,
  updated_by,
  created_at,
  updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
      input && input.reportId,
      Number(normalizeBoolean(input && input.enabled, true)),
      normalizeText(input && input.scheduleTime) || '09:00',
      normalizeText(input && input.timezone) || 'Europe/Moscow',
      JSON.stringify(normalizeRecipients(input && input.recipients)),
      normalizeText(input && input.emailSubject),
      normalizeText(input && input.emailBody),
      userId,
      userId,
      timestamp,
      timestamp
    );

    return getSchedule(result.lastInsertRowid);
  }

  function updateSchedule(scheduleId, input) {
    const schedule = getSchedule(scheduleId);

    if (!schedule) {
      return null;
    }

    const timestamp = toIsoString(now);
    const nextReportId = Object.prototype.hasOwnProperty.call(input || {}, 'reportId') ? input.reportId : schedule.reportId;
    const recipients = Object.prototype.hasOwnProperty.call(input || {}, 'recipients')
      ? normalizeRecipients(input.recipients)
      : schedule.recipients;

    assertReportExists(nextReportId);

    db.prepare(`
UPDATE scheduled_report_schedules
SET report_id = ?,
    enabled = ?,
    schedule_time = ?,
    timezone = ?,
    recipients_json = ?,
    email_subject = ?,
    email_body = ?,
    updated_by = ?,
    updated_at = ?
WHERE id = ?
`).run(
      nextReportId,
      Number(Object.prototype.hasOwnProperty.call(input || {}, 'enabled') ? Boolean(input.enabled) : schedule.enabled),
      Object.prototype.hasOwnProperty.call(input || {}, 'scheduleTime')
        ? normalizeText(input.scheduleTime) || '09:00'
        : schedule.scheduleTime,
      Object.prototype.hasOwnProperty.call(input || {}, 'timezone')
        ? normalizeText(input.timezone) || 'Europe/Moscow'
        : schedule.timezone,
      JSON.stringify(recipients),
      Object.prototype.hasOwnProperty.call(input || {}, 'emailSubject')
        ? normalizeText(input.emailSubject)
        : schedule.emailSubject,
      Object.prototype.hasOwnProperty.call(input || {}, 'emailBody')
        ? normalizeText(input.emailBody)
        : schedule.emailBody,
      Object.prototype.hasOwnProperty.call(input || {}, 'userId') ? normalizeText(input.userId) : schedule.updatedBy,
      timestamp,
      scheduleId
    );

    return getSchedule(scheduleId);
  }

  function getRun(runId) {
    return normalizeRun(db.prepare('SELECT * FROM scheduled_report_runs WHERE id = ?').get(runId));
  }

  function startRun(input) {
    const reportId = input && input.reportId;
    const scheduleId = input && input.scheduleId ? input.scheduleId : null;

    assertReportExists(reportId);

    if (scheduleId !== null) {
      assertScheduleExists(scheduleId, reportId);
    }

    const result = db.prepare(`
INSERT INTO scheduled_report_runs (
  report_id,
  schedule_id,
  trigger,
  status,
  started_at,
  recipients_json,
  created_by
) VALUES (?, ?, ?, ?, ?, ?, ?)
`).run(
      reportId,
      scheduleId,
      normalizeText(input && input.trigger) || 'manual',
      'running',
      toIsoString(now),
      JSON.stringify(normalizeRecipients(input && input.recipients)),
      normalizeText(input && input.userId)
    );

    return getRun(result.lastInsertRowid);
  }

  function finishRun(runId, input) {
    db.prepare(`
UPDATE scheduled_report_runs
SET status = ?,
    finished_at = ?,
    row_count = ?,
    file_size_bytes = ?,
    file_path = ?,
    error_message = ?
WHERE id = ?
`).run(
      normalizeText(input && input.status) || 'success',
      toIsoString(now),
      normalizePositiveInteger(input && input.rowCount, 0),
      normalizePositiveInteger(input && input.fileSizeBytes, 0),
      normalizeText(input && input.filePath),
      normalizeText(input && input.errorMessage),
      runId
    );

    return getRun(runId);
  }

  function listRuns({ reportId, limit = 50 } = {}) {
    const safeLimit = normalizePositiveInteger(limit, 50);

    if (reportId !== undefined && reportId !== null) {
      return db.prepare(`
SELECT *
FROM scheduled_report_runs
WHERE report_id = ?
ORDER BY id DESC
LIMIT ?
`).all(reportId, safeLimit).map(normalizeRun);
    }

    return db.prepare(`
SELECT *
FROM scheduled_report_runs
ORDER BY id DESC
LIMIT ?
`).all(safeLimit).map(normalizeRun);
  }

  function saveMailSettings(input) {
    const timestamp = toIsoString(now);
    const existing = db.prepare('SELECT * FROM mail_settings WHERE id = 1').get();
    const password = normalizeText(input && input.password);
    const passwordSecret = input && input.clearPassword ? '' : password || (existing ? existing.password_secret : '');

    db.prepare(`
INSERT INTO mail_settings (
  id,
  host,
  port,
  secure_mode,
  username,
  password_secret,
  from_email,
  from_name,
  created_at,
  updated_at
) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  host = excluded.host,
  port = excluded.port,
  secure_mode = excluded.secure_mode,
  username = excluded.username,
  password_secret = excluded.password_secret,
  from_email = excluded.from_email,
  from_name = excluded.from_name,
  updated_at = excluded.updated_at
`).run(
      normalizeText(input && input.host),
      normalizePositiveInteger(input && input.port, 587),
      normalizeText(input && input.secureMode) || 'starttls',
      normalizeText(input && input.username),
      passwordSecret,
      normalizeText(input && input.fromEmail),
      normalizeText(input && input.fromName),
      existing ? existing.created_at : timestamp,
      timestamp
    );

    return getMailSettings();
  }

  function getMailSettings() {
    return normalizeMailSettings(db.prepare('SELECT * FROM mail_settings WHERE id = 1').get());
  }

  function getMailSettingsSecret() {
    return normalizeMailSettingsSecret(db.prepare('SELECT * FROM mail_settings WHERE id = 1').get());
  }

  async function pruneOldRuns(retentionDays) {
    const days = normalizePositiveInteger(retentionDays, 60);
    const cutoff = new Date(now().getTime());

    cutoff.setUTCDate(cutoff.getUTCDate() - days);

    const rows = db.prepare(`
SELECT id, file_path
FROM scheduled_report_runs
WHERE finished_at IS NOT NULL AND finished_at < ?
`).all(cutoff.toISOString());
    let files = 0;
    let skipped = 0;
    const runIdsToDelete = [];

    for (const row of rows) {
      if (!row.file_path) {
        runIdsToDelete.push(row.id);
        continue;
      }

      if (!isPathInsideDir(row.file_path, fileDir)) {
        skipped += 1;
        continue;
      }

      try {
        await fsp.unlink(row.file_path);
        files += 1;
        runIdsToDelete.push(row.id);
      } catch (error) {
        if (error.code === 'ENOENT') {
          runIdsToDelete.push(row.id);
        } else {
          skipped += 1;
        }
      }
    }

    let runs = 0;

    if (runIdsToDelete.length > 0) {
      const placeholders = runIdsToDelete.map(() => '?').join(', ');
      const result = db.prepare(`DELETE FROM scheduled_report_runs WHERE id IN (${placeholders})`).run(...runIdsToDelete);

      runs = Number(result.changes || 0);
    }

    return {
      runs,
      files,
      skipped
    };
  }

  function close() {
    db.close();
  }

  return {
    createReport,
    updateReport,
    getReport,
    listReports,
    createSchedule,
    updateSchedule,
    getSchedule,
    listSchedules,
    listEnabledSchedules,
    startRun,
    finishRun,
    listRuns,
    getRun,
    saveMailSettings,
    getMailSettings,
    getMailSettingsSecret,
    pruneOldRuns,
    close
  };
}

module.exports = {
  DEFAULT_SCHEDULED_REPORT_FILE_DIR,
  DEFAULT_SCHEDULED_REPORT_STORE_PATH,
  createScheduledReportStore,
  normalizeRecipients
};
