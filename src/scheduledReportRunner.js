const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const { buildXlsxWorkbook } = require('./xlsxWorkbook');
const { normalizeReportLimits, wrapReportSql } = require('./scheduledReportSql');

const DEFAULT_MAX_FILE_SIZE_BYTES = 10485760;

function filenameForRun(report, run) {
  return `scheduled-report-${report.id}-${String(run.id).padStart(6, '0')}.xlsx`;
}

function sanitizeDefaultError(error) {
  return 'Scheduled report failed';
}

function headersForRows(rows) {
  const seen = new Set();
  const headers = [];

  for (const row of rows) {
    if (!row || Array.isArray(row) || typeof row !== 'object') {
      continue;
    }

    for (const header of Object.keys(row)) {
      if (!seen.has(header)) {
        seen.add(header);
        headers.push(header);
      }
    }
  }

  return headers;
}

function maxFileSize(config) {
  const value = Number(config && config.maxFileSizeBytes);

  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_FILE_SIZE_BYTES;
}

function retentionDays(config) {
  const value = Number(config && config.retentionDays);

  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 60;
}

async function unlinkBestEffort(filePath, unlink) {
  try {
    await unlink(filePath);
  } catch (_) {
    // Best-effort cleanup must not hide the original write or rename error.
  }
}

async function writeFileAtomic({ targetPath, data, writeFile, rename, unlink, randomId }) {
  const tempPath = `${targetPath}.${process.pid}.${randomId()}.tmp`;

  try {
    await writeFile(tempPath, data);
    await rename(tempPath, targetPath);
  } catch (error) {
    await unlinkBestEffort(tempPath, unlink);
    throw error;
  }
}

function createScheduledReportRunner({
  client,
  store,
  fileDir,
  config = {},
  mailer,
  mkdir = fs.mkdir,
  writeFile = fs.writeFile,
  rename = fs.rename,
  unlink = fs.unlink,
  randomId = randomUUID,
  sanitizeError = sanitizeDefaultError
} = {}) {
  async function runSchedule({ scheduleId, trigger = 'schedule', userId = 'system' }) {
    const schedule = store.getSchedule(scheduleId);
    const report = schedule ? store.getReport(schedule.reportId) : null;

    if (!schedule || !report) {
      throw new Error('Scheduled report not found');
    }

    if (trigger === 'schedule' && (!schedule.enabled || !report.enabled)) {
      return { status: 'disabled' };
    }

    const run = store.startRun({
      reportId: report.id,
      scheduleId: schedule.id,
      trigger,
      recipients: schedule.recipients,
      userId
    });
    let filePath = '';
    let fileSizeBytes = 0;
    let rows = [];

    async function pruneOldRunsBestEffort() {
      if (typeof store.pruneOldRuns !== 'function') {
        return;
      }

      try {
        await store.pruneOldRuns(retentionDays(config));
      } catch (_) {
        // Retention cleanup must not hide the result of the report run.
      }
    }

    async function finishRunAndPrune(input) {
      const finished = await store.finishRun(run.id, input);

      await pruneOldRunsBestEffort();
      return finished;
    }

    try {
      const limits = normalizeReportLimits(report, config);
      const wrapped = wrapReportSql(report.sql, limits);
      const query = `${wrapped.query}\nFORMAT JSONEachRow`;
      const params = {
        ...wrapped.params,
        ...wrapped.settings
      };

      rows = await client.queryJSONEachRow(query, params, 'scheduled report SQL');

      if (!Array.isArray(rows)) {
        throw new Error('Scheduled report query returned invalid rows');
      }

      const headers = headersForRows(rows);
      const workbook = buildXlsxWorkbook({
        sheetName: 'Отчет',
        headers,
        rows
      });
      const workbookSize = workbook.length;

      if (workbookSize > maxFileSize(config)) {
        throw new Error('Scheduled report file size limit exceeded');
      }

      await mkdir(fileDir, { recursive: true });
      const targetPath = path.join(fileDir, filenameForRun(report, run));

      await writeFileAtomic({
        targetPath,
        data: workbook,
        writeFile,
        rename,
        unlink,
        randomId
      });
      filePath = targetPath;
      fileSizeBytes = workbookSize;

      await mailer.sendReport({
        settings: store.getMailSettingsSecret(),
        recipients: schedule.recipients,
        subject: schedule.emailSubject || report.title,
        body: schedule.emailBody || '',
        filename: path.basename(filePath),
        fileBuffer: workbook
      });

    } catch (error) {
      return finishRunAndPrune({
        status: 'failed',
        rowCount: filePath ? rows.length : 0,
        fileSizeBytes: filePath ? fileSizeBytes : 0,
        filePath,
        errorMessage: sanitizeError(error)
      });
    }

    return finishRunAndPrune({
      status: 'success',
      rowCount: rows.length,
      fileSizeBytes,
      filePath
    });
  }

  return { runSchedule };
}

module.exports = {
  createScheduledReportRunner,
  filenameForRun
};
