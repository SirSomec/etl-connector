const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createScheduledReportStore, normalizeRecipients } = require('../src/scheduledReportStore');

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

test('scheduled report store clears SMTP password explicitly', async () => {
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
      host: 'smtp.example.test',
      port: 465,
      secureMode: 'ssl',
      username: 'sender',
      clearPassword: true,
      fromEmail: 'sender@example.test',
      fromName: 'Reports'
    });

    assert.equal(store.getMailSettings().hasPassword, false);
    assert.equal(store.getMailSettingsSecret().password, '');
  } finally {
    store.close();
    await fs.rm(paths.dir, { recursive: true, force: true });
  }
});

test('scheduled report store rejects orphan report and schedule references', async () => {
  const paths = await tempPaths();
  const store = createScheduledReportStore({ filePath: paths.dbPath, fileDir: paths.fileDir });

  try {
    const report = store.createReport({ title: 'R', sql: 'SELECT 1', userId: 'u' });
    const schedule = store.createSchedule({
      reportId: report.id,
      recipients: 'a@example.test',
      userId: 'u'
    });

    assert.throws(
      () => store.createSchedule({ reportId: report.id + 1000, recipients: 'a@example.test', userId: 'u' }),
      /Scheduled report not found/
    );
    assert.throws(
      () => store.updateSchedule(schedule.id, { reportId: report.id + 1000, userId: 'u' }),
      /Scheduled report not found/
    );
    assert.throws(
      () => store.startRun({ reportId: report.id + 1000, trigger: 'manual', recipients: [], userId: 'u' }),
      /Scheduled report not found/
    );
    assert.throws(
      () => store.startRun({
        reportId: report.id,
        scheduleId: schedule.id + 1000,
        trigger: 'manual',
        recipients: [],
        userId: 'u'
      }),
      /Scheduled report schedule not found/
    );
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

test('scheduled report store prunes selected run ids and keeps unsafe or failed file rows', async () => {
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
    await fs.writeFile(oldFile, 'old');
    store.finishRun(oldRun.id, { status: 'success', filePath: oldFile, fileSizeBytes: 3, rowCount: 1 });

    const unsafeRun = store.startRun({ reportId: report.id, trigger: 'manual', recipients: [], userId: 'u' });
    const unsafeFile = path.join(paths.dir, 'outside.xlsx');
    await fs.writeFile(unsafeFile, 'outside');
    store.finishRun(unsafeRun.id, { status: 'success', filePath: unsafeFile, fileSizeBytes: 7, rowCount: 1 });

    const failedFileRun = store.startRun({ reportId: report.id, trigger: 'manual', recipients: [], userId: 'u' });
    const failedFilePath = path.join(paths.fileDir, 'directory-file.xlsx');
    await fs.mkdir(failedFilePath, { recursive: true });
    store.finishRun(failedFileRun.id, { status: 'success', filePath: failedFilePath, fileSizeBytes: 0, rowCount: 1 });

    current = new Date('2026-06-26T00:00:00.000Z');
    const boundaryRun = store.startRun({ reportId: report.id, trigger: 'manual', recipients: [], userId: 'u' });
    const boundaryFile = path.join(paths.fileDir, `${boundaryRun.id}.xlsx`);
    await fs.writeFile(boundaryFile, 'boundary');
    store.finishRun(boundaryRun.id, { status: 'success', filePath: boundaryFile, fileSizeBytes: 8, rowCount: 1 });

    current = new Date('2026-06-26T00:00:01.000Z');
    const recentRun = store.startRun({ reportId: report.id, trigger: 'manual', recipients: [], userId: 'u' });
    const recentFile = path.join(paths.fileDir, `${recentRun.id}.xlsx`);
    await fs.writeFile(recentFile, 'recent');
    store.finishRun(recentRun.id, { status: 'success', filePath: recentFile, fileSizeBytes: 6, rowCount: 1 });

    current = new Date('2026-08-25T00:00:00.000Z');
    const removed = await store.pruneOldRuns(60);

    assert.deepEqual(removed, { runs: 1, files: 1, skipped: 2 });
    assert.deepEqual(
      store.listRuns({ reportId: report.id, limit: 10 }).map((run) => run.id).sort((a, b) => a - b),
      [unsafeRun.id, failedFileRun.id, boundaryRun.id, recentRun.id]
    );
    await assert.rejects(() => fs.stat(oldFile), /ENOENT/);
    assert.equal((await fs.stat(unsafeFile)).isFile(), true);
    assert.equal((await fs.stat(boundaryFile)).isFile(), true);
    assert.equal((await fs.stat(recentFile)).isFile(), true);
  } finally {
    store.close();
    await fs.rm(paths.dir, { recursive: true, force: true });
  }
});

test('normalizeRecipients accepts delimited strings and rejects invalid emails', () => {
  assert.deepEqual(
    normalizeRecipients('A@Example.test, b@example.test; a@example.test\nB@example.test'),
    ['a@example.test', 'b@example.test']
  );
  assert.throws(() => normalizeRecipients('valid@example.test; invalid-email'), /Invalid recipient email/);
});
