const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const {
  createScheduledReportRunner,
  filenameForRun
} = require('../src/scheduledReportRunner');
const { createScheduledReportStore } = require('../src/scheduledReportStore');

const defaultConfig = {
  defaultRowLimit: 10000,
  maxRowLimit: 100000,
  maxFileSizeBytes: 10485760,
  queryTimeoutMs: 120000
};

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

function saveMailSettings(store) {
  store.saveMailSettings({
    host: 'smtp.example.test',
    port: 465,
    secureMode: 'ssl',
    username: 'sender',
    password: 'Secret123!',
    fromEmail: 'sender@example.test',
    fromName: 'Reports'
  });
}

function xmlDecode(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&amp;/g, '&');
}

function zipEntry(buffer, name) {
  const eocdMinOffset = Math.max(0, buffer.length - 22 - 65535);
  let eocdOffset = -1;

  for (let offset = buffer.length - 22; offset >= eocdMinOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }

  assert.notEqual(eocdOffset, -1, 'expected XLSX ZIP end of central directory');

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  let centralOffset = buffer.readUInt32LE(eocdOffset + 16);

  for (let index = 0; index < totalEntries; index += 1) {
    assert.equal(buffer.readUInt32LE(centralOffset), 0x02014b50);

    const method = buffer.readUInt16LE(centralOffset + 10);
    const compressedSize = buffer.readUInt32LE(centralOffset + 20);
    const fileNameLength = buffer.readUInt16LE(centralOffset + 28);
    const extraLength = buffer.readUInt16LE(centralOffset + 30);
    const commentLength = buffer.readUInt16LE(centralOffset + 32);
    const localHeaderOffset = buffer.readUInt32LE(centralOffset + 42);
    const fileNameStart = centralOffset + 46;
    const fileName = buffer.toString('utf8', fileNameStart, fileNameStart + fileNameLength).replace(/\\/g, '/');

    if (fileName === name) {
      assert.equal(buffer.readUInt32LE(localHeaderOffset), 0x04034b50);

      const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const compressedData = buffer.subarray(dataStart, dataStart + compressedSize);

      if (method === 0) {
        return compressedData;
      }
      if (method === 8) {
        return zlib.inflateRawSync(compressedData);
      }

      throw new Error(`Unsupported ZIP method ${method}`);
    }

    centralOffset += 46 + fileNameLength + extraLength + commentLength;
  }

  throw new Error(`Missing ZIP entry ${name}`);
}

function sheetValues(buffer) {
  const xml = zipEntry(buffer, 'xl/worksheets/sheet1.xml').toString('utf8');
  const values = [];
  const pattern = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  let match;

  while ((match = pattern.exec(xml)) !== null) {
    values.push(xmlDecode(match[1]));
  }

  return values;
}

test('runner executes query writes xlsx sends mail and records success', async () => {
  const { dir, fileDir, store } = await fixture();
  const sent = [];
  const queries = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      queries.push({ query, params, operation });

      return [{ client: 'Brand A', shifts: 12 }];
    }
  };

  try {
    const report = store.createReport({
      title: 'Daily shifts',
      sql: 'SELECT client, shifts FROM mg_jobs',
      rowLimit: 100,
      timeoutMs: 60000,
      userId: 'u'
    });
    const schedule = store.createSchedule({
      reportId: report.id,
      enabled: true,
      scheduleTime: '09:00',
      recipients: ['a@example.test'],
      emailSubject: 'Daily',
      emailBody: 'Attached',
      userId: 'u'
    });
    saveMailSettings(store);

    const runner = createScheduledReportRunner({
      client,
      store,
      fileDir,
      config: defaultConfig,
      mailer: {
        async sendReport(input) {
          sent.push(input);
          return { messageId: 'msg-1' };
        }
      }
    });

    const run = await runner.runSchedule({ scheduleId: schedule.id, trigger: 'manual', userId: 'u' });
    const file = await fs.readFile(run.filePath);

    assert.equal(run.status, 'success');
    assert.equal(run.rowCount, 1);
    assert.equal(run.fileSizeBytes, file.length);
    assert.match(zipEntry(file, 'xl/workbook.xml').toString('utf8'), /name="Отчет"/);
    assert.equal(path.basename(run.filePath), filenameForRun(report, run));
    assert.equal(path.basename(run.filePath), 'scheduled-report-1-000001.xlsx');
    assert.equal(file.readUInt32LE(0), 0x04034b50);
    assert.equal(queries.length, 1);
    assert.equal(queries[0].operation, 'scheduled report SQL');
    assert.match(queries[0].query, /SELECT \* FROM \(/);
    assert.match(queries[0].query, /LIMIT 100\nFORMAT JSONEachRow$/);
    assert.deepEqual(queries[0].params, {});
    assert.equal(sent.length, 1);
    assert.equal(sent[0].settings.password, 'Secret123!');
    assert.deepEqual(sent[0].recipients, ['a@example.test']);
    assert.equal(sent[0].subject, 'Daily');
    assert.equal(sent[0].body, 'Attached');
    assert.equal(sent[0].filename, 'scheduled-report-1-000001.xlsx');
    assert.deepEqual(sent[0].fileBuffer, file);
    assert.deepEqual(await fs.readdir(fileDir), ['scheduled-report-1-000001.xlsx']);
    assert.deepEqual(store.getRun(run.id), run);
  } finally {
    store.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('runner prunes old runs after finishing report run', async () => {
  const { dir, fileDir, store: baseStore } = await fixture();
  const pruneCalls = [];
  const store = {
    ...baseStore,
    pruneOldRuns(days) {
      pruneCalls.push(days);
      return Promise.resolve({ runs: 0, files: 0, skipped: 0 });
    }
  };

  try {
    const report = baseStore.createReport({ title: 'R', sql: 'SELECT value FROM mg_jobs', userId: 'u' });
    const schedule = baseStore.createSchedule({ reportId: report.id, recipients: ['a@example.test'], userId: 'u' });
    saveMailSettings(baseStore);

    const runner = createScheduledReportRunner({
      client: {
        async queryJSONEachRow() {
          return [{ value: 'ok' }];
        }
      },
      store,
      fileDir,
      config: { ...defaultConfig, retentionDays: 60 },
      mailer: {
        async sendReport() {}
      }
    });
    const run = await runner.runSchedule({ scheduleId: schedule.id, trigger: 'schedule', userId: 'system' });

    assert.equal(run.status, 'success');
    assert.deepEqual(pruneCalls, [60]);
  } finally {
    baseStore.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('runner keeps generated file and sanitized error when SMTP fails', async () => {
  const { dir, fileDir, store } = await fixture();
  const client = {
    async queryJSONEachRow() {
      return [{ value: '=formula' }];
    }
  };

  try {
    const report = store.createReport({ title: 'R', sql: 'SELECT value FROM mg_jobs', userId: 'u' });
    const schedule = store.createSchedule({
      reportId: report.id,
      recipients: ['a@example.test'],
      emailSubject: 'R',
      userId: 'u'
    });
    saveMailSettings(store);

    const runner = createScheduledReportRunner({
      client,
      store,
      fileDir,
      config: defaultConfig,
      mailer: {
        async sendReport() {
          throw new Error('SMTP Secret123! failed');
        }
      },
      sanitizeError: (error) => String(error.message).replace('Secret123!', '[redacted]')
    });

    const run = await runner.runSchedule({ scheduleId: schedule.id, trigger: 'manual', userId: 'u' });
    const stat = await fs.stat(run.filePath);

    assert.equal(run.status, 'failed');
    assert.equal(run.rowCount, 1);
    assert.equal(run.errorMessage.includes('Secret123!'), false);
    assert.match(run.errorMessage, /\[redacted\]/);
    assert.equal(stat.isFile(), true);
    assert.equal(run.fileSizeBytes, stat.size);
  } finally {
    store.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('runner records SQL validation and query failures without creating a file', async () => {
  const cases = [
    {
      sql: 'DELETE FROM mg_jobs',
      client: {
        async queryJSONEachRow() {
          throw new Error('query should not be called');
        }
      },
      expectedError: /Only SELECT queries are allowed/
    },
    {
      sql: 'SELECT value FROM mg_jobs',
      client: {
        async queryJSONEachRow() {
          throw new Error('ClickHouse failed');
        }
      },
      expectedError: /ClickHouse failed/
    }
  ];

  for (const current of cases) {
    const { dir, fileDir, store } = await fixture();

    try {
      const report = store.createReport({ title: 'R', sql: current.sql, userId: 'u' });
      const schedule = store.createSchedule({ reportId: report.id, recipients: ['a@example.test'], userId: 'u' });
      saveMailSettings(store);

      const runner = createScheduledReportRunner({
        client: current.client,
        store,
        fileDir,
        config: defaultConfig,
        mailer: {
          async sendReport() {
            throw new Error('mailer should not be called');
          }
        },
        sanitizeError: (error) => String(error.message)
      });
      const run = await runner.runSchedule({ scheduleId: schedule.id, trigger: 'manual', userId: 'u' });

      assert.equal(run.status, 'failed');
      assert.equal(run.filePath, '');
      assert.equal(run.fileSizeBytes, 0);
      assert.match(run.errorMessage, current.expectedError);
      assert.deepEqual(await fs.readdir(fileDir), []);
    } finally {
      store.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

test('runner records file size limit failure and does not call mailer', async () => {
  const { dir, fileDir, store } = await fixture();
  let mailerCalled = false;
  const client = {
    async queryJSONEachRow() {
      return [{ value: 'large enough for workbook' }];
    }
  };

  try {
    const report = store.createReport({ title: 'R', sql: 'SELECT value FROM mg_jobs', userId: 'u' });
    const schedule = store.createSchedule({ reportId: report.id, recipients: ['a@example.test'], userId: 'u' });
    saveMailSettings(store);

    const runner = createScheduledReportRunner({
      client,
      store,
      fileDir,
      config: { ...defaultConfig, maxFileSizeBytes: 1 },
      mailer: {
        async sendReport() {
          mailerCalled = true;
        }
      },
      sanitizeError: (error) => String(error.message)
    });
    const run = await runner.runSchedule({ scheduleId: schedule.id, trigger: 'manual', userId: 'u' });

    assert.equal(run.status, 'failed');
    assert.equal(run.filePath, '');
    assert.equal(run.fileSizeBytes, 0);
    assert.match(run.errorMessage, /file size limit/i);
    assert.equal(mailerCalled, false);
    assert.deepEqual(await fs.readdir(fileDir), []);
  } finally {
    store.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('runner records empty query result as failed and does not send mail', async () => {
  const { dir, fileDir, store } = await fixture();
  let mailerCalled = false;
  const client = {
    async queryJSONEachRow() {
      return [];
    }
  };

  try {
    const report = store.createReport({ title: 'R', sql: 'SELECT value FROM mg_jobs', userId: 'u' });
    const schedule = store.createSchedule({ reportId: report.id, recipients: ['a@example.test'], userId: 'u' });
    saveMailSettings(store);

    const runner = createScheduledReportRunner({
      client,
      store,
      fileDir,
      config: defaultConfig,
      mailer: {
        async sendReport() {
          mailerCalled = true;
        }
      },
      sanitizeError: (error) => String(error.message)
    });
    const run = await runner.runSchedule({ scheduleId: schedule.id, trigger: 'schedule', userId: 'system' });

    assert.equal(run.status, 'failed');
    assert.equal(run.rowCount, 0);
    assert.equal(run.filePath, '');
    assert.equal(run.fileSizeBytes, 0);
    assert.match(run.errorMessage, /returned no rows/i);
    assert.equal(mailerCalled, false);
    assert.deepEqual(await fs.readdir(fileDir), []);
  } finally {
    store.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('runner escapes formula-like values in produced workbook', async () => {
  const { dir, fileDir, store } = await fixture();
  const sent = [];
  const client = {
    async queryJSONEachRow() {
      return [{
        value: '=cmd|A1',
        plus: '+SUM(1,1)',
        minus: '-10',
        mention: '@handle'
      }];
    }
  };

  try {
    const report = store.createReport({ title: 'R', sql: 'SELECT value FROM mg_jobs', userId: 'u' });
    const schedule = store.createSchedule({ reportId: report.id, recipients: ['a@example.test'], userId: 'u' });
    saveMailSettings(store);

    const runner = createScheduledReportRunner({
      client,
      store,
      fileDir,
      config: defaultConfig,
      mailer: {
        async sendReport(input) {
          sent.push(input);
        }
      }
    });
    const run = await runner.runSchedule({ scheduleId: schedule.id, trigger: 'manual', userId: 'u' });
    const values = sheetValues(await fs.readFile(run.filePath));

    assert.equal(run.status, 'success');
    assert.deepEqual(sent.length, 1);
    assert.deepEqual(values.slice(4), ["'=cmd|A1", "'+SUM(1,1)", "'-10", "'@handle"]);
  } finally {
    store.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('runner uses report title and empty body when schedule email text is empty', async () => {
  const { dir, fileDir, store } = await fixture();
  const sent = [];

  try {
    const report = store.createReport({ title: 'Fallback report title', sql: 'SELECT value FROM mg_jobs', userId: 'u' });
    const schedule = store.createSchedule({ reportId: report.id, recipients: ['a@example.test'], userId: 'u' });
    saveMailSettings(store);

    const runner = createScheduledReportRunner({
      client: {
        async queryJSONEachRow() {
          return [{ value: 'ok' }];
        }
      },
      store,
      fileDir,
      config: defaultConfig,
      mailer: {
        async sendReport(input) {
          sent.push(input);
        }
      }
    });
    const run = await runner.runSchedule({ scheduleId: schedule.id, trigger: 'manual', userId: 'u' });

    assert.equal(run.status, 'success');
    assert.equal(sent[0].subject, 'Fallback report title');
    assert.equal(sent[0].body, '');
  } finally {
    store.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('runner default sanitizer stores generic error without raw details', async () => {
  const { dir, fileDir, store } = await fixture();
  const client = {
    async queryJSONEachRow() {
      throw new Error('ClickHouse failed with password Secret123!');
    }
  };

  try {
    const report = store.createReport({ title: 'R', sql: 'SELECT value FROM mg_jobs', userId: 'u' });
    const schedule = store.createSchedule({ reportId: report.id, recipients: ['a@example.test'], userId: 'u' });
    const runner = createScheduledReportRunner({
      client,
      store,
      fileDir,
      config: defaultConfig,
      mailer: {
        async sendReport() {
          throw new Error('mailer should not be called');
        }
      }
    });
    const run = await runner.runSchedule({ scheduleId: schedule.id, trigger: 'manual', userId: 'u' });

    assert.equal(run.status, 'failed');
    assert.equal(run.errorMessage, 'Scheduled report failed');
    assert.equal(run.errorMessage.includes('Secret123!'), false);
    assert.equal(run.filePath, '');
    assert.equal(run.fileSizeBytes, 0);
  } finally {
    store.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('runner propagates success finishRun failure after sending mail', async () => {
  const { dir, fileDir, store: baseStore } = await fixture();
  let sent = 0;
  let successFinishCalls = 0;
  let failedFinishCalls = 0;
  const store = {
    ...baseStore,
    finishRun(runId, input) {
      if (input.status === 'success') {
        successFinishCalls += 1;
        throw new Error('finish success failed');
      }

      failedFinishCalls += 1;
      return baseStore.finishRun(runId, input);
    }
  };

  try {
    const report = baseStore.createReport({ title: 'R', sql: 'SELECT value FROM mg_jobs', userId: 'u' });
    const schedule = baseStore.createSchedule({ reportId: report.id, recipients: ['a@example.test'], userId: 'u' });
    saveMailSettings(baseStore);

    const runner = createScheduledReportRunner({
      client: {
        async queryJSONEachRow() {
          return [{ value: 'ok' }];
        }
      },
      store,
      fileDir,
      config: defaultConfig,
      mailer: {
        async sendReport() {
          sent += 1;
        }
      }
    });

    await assert.rejects(
      () => runner.runSchedule({ scheduleId: schedule.id, trigger: 'manual', userId: 'u' }),
      /finish success failed/
    );
    assert.equal(sent, 1);
    assert.equal(successFinishCalls, 1);
    assert.equal(failedFinishCalls, 0);
  } finally {
    baseStore.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('runner records write failure with no saved file metadata', async () => {
  const { dir, fileDir, store } = await fixture();
  let mailerCalled = false;
  let observedWritePath = '';

  try {
    const report = store.createReport({ title: 'R', sql: 'SELECT value FROM mg_jobs', userId: 'u' });
    const schedule = store.createSchedule({ reportId: report.id, recipients: ['a@example.test'], userId: 'u' });
    saveMailSettings(store);

    const runner = createScheduledReportRunner({
      client: {
        async queryJSONEachRow() {
          return [{ value: 'ok' }];
        }
      },
      store,
      fileDir,
      config: defaultConfig,
      writeFile: async (filePath) => {
        observedWritePath = filePath;
        await fs.writeFile(filePath, 'partial');
        throw new Error('disk full');
      },
      randomId: () => 'atomic-test',
      mailer: {
        async sendReport() {
          mailerCalled = true;
        }
      },
      sanitizeError: (error) => String(error.message)
    });
    const run = await runner.runSchedule({ scheduleId: schedule.id, trigger: 'manual', userId: 'u' });

    assert.equal(run.status, 'failed');
    assert.equal(run.errorMessage, 'disk full');
    assert.equal(run.filePath, '');
    assert.equal(run.fileSizeBytes, 0);
    assert.equal(run.rowCount, 0);
    assert.equal(mailerCalled, false);
    assert.match(path.basename(observedWritePath), /^scheduled-report-1-000001\.xlsx\.\d+\.atomic-test\.tmp$/);
    assert.deepEqual(await fs.readdir(fileDir), []);
  } finally {
    store.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('runner returns disabled scheduled run without creating a run record', async () => {
  const { dir, fileDir, store } = await fixture();

  try {
    const report = store.createReport({ title: 'R', sql: 'SELECT 1', enabled: true, userId: 'u' });
    const schedule = store.createSchedule({
      reportId: report.id,
      enabled: false,
      recipients: ['a@example.test'],
      userId: 'u'
    });
    const runner = createScheduledReportRunner({
      client: {
        async queryJSONEachRow() {
          throw new Error('query should not be called');
        }
      },
      store,
      fileDir,
      config: defaultConfig,
      mailer: {
        async sendReport() {
          throw new Error('mailer should not be called');
        }
      }
    });

    const run = await runner.runSchedule({ scheduleId: schedule.id });

    assert.deepEqual(run, { status: 'disabled' });
    assert.deepEqual(store.listRuns({ reportId: report.id }), []);
  } finally {
    store.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('runner returns disabled for scheduled trigger when report is disabled', async () => {
  const { dir, fileDir, store } = await fixture();

  try {
    const report = store.createReport({ title: 'R', sql: 'SELECT 1', enabled: false, userId: 'u' });
    const schedule = store.createSchedule({
      reportId: report.id,
      enabled: true,
      recipients: ['a@example.test'],
      userId: 'u'
    });
    const runner = createScheduledReportRunner({
      client: {
        async queryJSONEachRow() {
          throw new Error('query should not be called');
        }
      },
      store,
      fileDir,
      config: defaultConfig,
      mailer: {
        async sendReport() {
          throw new Error('mailer should not be called');
        }
      }
    });

    const run = await runner.runSchedule({ scheduleId: schedule.id });

    assert.deepEqual(run, { status: 'disabled' });
    assert.deepEqual(store.listRuns({ reportId: report.id }), []);
  } finally {
    store.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('runner throws when schedule or report is missing', async () => {
  const { dir, fileDir, store } = await fixture();

  try {
    const runner = createScheduledReportRunner({
      client: {},
      store,
      fileDir,
      config: defaultConfig,
      mailer: {}
    });

    await assert.rejects(
      () => runner.runSchedule({ scheduleId: 404, trigger: 'manual', userId: 'u' }),
      /Scheduled report not found/
    );
  } finally {
    store.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
