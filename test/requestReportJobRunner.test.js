const test = require('node:test');
const assert = require('node:assert/strict');

const { runRequestReportConfirmedCheckJob } = require('../src/requestReportJobRunner');

test('runRequestReportConfirmedCheckJob parses, finds, attaches statuses and renders result', async () => {
  const fileBuffer = Buffer.from('xlsx bytes');
  const client = { name: 'clickhouse' };
  const events = [];
  const calls = [];
  const parsedRows = [{ idLkk: '101', organization: 'Org A' }];
  const missingRows = [{ idLkk: '102', organization: 'Org B' }];
  const checkedRows = [
    { idLkk: '101', checkResult: 'confirmed-found' },
    { idLkk: '102', checkResult: 'confirmed-missing' }
  ];
  const summary = {
    totalRows: 2,
    rowsWithId: 2,
    checkedExternalIds: 2,
    confirmedRows: 1,
    missingConfirmedRows: 1
  };

  const html = await runRequestReportConfirmedCheckJob({
    client,
    fileBuffer,
    filename: 'requests.xlsx',
    csrfToken: 'csrf-token',
    statusUserId: 'user-1',
    onProgress: (event) => events.push(event),
    parseWorkbook(buffer, options) {
      calls.push(['parseWorkbook', buffer]);
      options.onProgress({ stage: 'reading-file', progress: 5 });

      return {
        rows: parsedRows,
        warnings: ['parse warning']
      };
    },
    async findMissingRows(receivedClient, rows, options) {
      calls.push(['findMissingRows', receivedClient, rows]);
      options.onProgress({ stage: 'external-id-lookup', progress: 30 });
      options.onProgress({ stage: 'render-result', progress: 100 });

      return {
        rows: missingRows,
        checkedRows,
        summary,
        warnings: ['lookup warning']
      };
    },
    async attachStatuses(userId, rows) {
      calls.push(['attachStatuses', userId, rows]);

      return rows.map((row) => ({
        ...row,
        reviewStatusKey: `lkk:${row.idLkk}`,
        reviewStatus: 'verified'
      }));
    },
    renderResult(input) {
      calls.push(['renderResult', input]);

      return '<section>done</section>';
    }
  });

  assert.equal(html, '<section>done</section>');
  assert.deepEqual(calls[0], ['parseWorkbook', fileBuffer]);
  assert.deepEqual(calls[1], ['findMissingRows', client, parsedRows]);
  assert.deepEqual(calls[2], ['attachStatuses', 'user-1', missingRows]);
  assert.deepEqual(calls[3], ['attachStatuses', 'user-1', checkedRows]);
  assert.equal(calls[4][0], 'renderResult');
  assert.equal(calls[4][1].filename, 'requests.xlsx');
  assert.equal(calls[4][1].csrfToken, 'csrf-token');
  assert.deepEqual(calls[4][1].result.warnings, ['parse warning', 'lookup warning']);
  assert.deepEqual(calls[4][1].result.rows, [
    {
      idLkk: '102',
      organization: 'Org B',
      reviewStatusKey: 'lkk:102',
      reviewStatus: 'verified'
    }
  ]);
  assert.deepEqual(calls[4][1].result.checkedRows, [
    {
      idLkk: '101',
      checkResult: 'confirmed-found',
      reviewStatusKey: 'lkk:101',
      reviewStatus: 'verified'
    },
    {
      idLkk: '102',
      checkResult: 'confirmed-missing',
      reviewStatusKey: 'lkk:102',
      reviewStatus: 'verified'
    }
  ]);
  assert.deepEqual(events.map((event) => event.stage), [
    'reading-file',
    'external-id-lookup',
    'render-result'
  ]);
  assert.equal(events.at(-1).progress, 100);
  assert.deepEqual(events.at(-1).counts, {
    total: 2,
    processed: 2,
    matched: 1,
    missing: 1
  });
});

test('runRequestReportConfirmedCheckJob uses file.buffer when fileBuffer is omitted', async () => {
  const file = { buffer: Buffer.from('file buffer') };
  let receivedBuffer = null;

  const html = await runRequestReportConfirmedCheckJob({
    client: {},
    file,
    parseWorkbook(buffer) {
      receivedBuffer = buffer;

      return { rows: [], warnings: [] };
    },
    async findMissingRows() {
      return { rows: [], summary: {}, warnings: [] };
    },
    renderResult() {
      return '<section>fallback</section>';
    }
  });

  assert.equal(receivedBuffer, file.buffer);
  assert.equal(html, '<section>fallback</section>');
});

test('runRequestReportConfirmedCheckJob ignores progress callback failure on runner event', async () => {
  const html = await runRequestReportConfirmedCheckJob({
    client: {},
    fileBuffer: Buffer.from('xlsx bytes'),
    parseWorkbook() {
      return { rows: [], warnings: [] };
    },
    async findMissingRows() {
      return {
        rows: [],
        summary: { totalRows: 0, confirmedRows: 0, missingConfirmedRows: 0 },
        warnings: []
      };
    },
    onProgress(event) {
      if (event.stage === 'render-result') {
        throw new Error('progress failed');
      }
    },
    renderResult() {
      return '<section>done</section>';
    }
  });

  assert.equal(html, '<section>done</section>');
});

test('runRequestReportConfirmedCheckJob ignores progress callback failure from parser and finder events', async () => {
  const html = await runRequestReportConfirmedCheckJob({
    client: {},
    fileBuffer: Buffer.from('xlsx bytes'),
    parseWorkbook(buffer, options) {
      options.onProgress({ stage: 'reading-file', progress: 5 });

      return { rows: [{ idLkk: '101' }], warnings: [] };
    },
    async findMissingRows(client, rows, options) {
      options.onProgress({ stage: 'external-id-lookup', progress: 30 });

      return {
        rows,
        summary: { totalRows: 1, confirmedRows: 0, missingConfirmedRows: 1 },
        warnings: []
      };
    },
    onProgress() {
      throw new Error('progress failed');
    },
    renderResult() {
      return '<section>done</section>';
    }
  });

  assert.equal(html, '<section>done</section>');
});

test('runRequestReportConfirmedCheckJob propagates parser errors', async () => {
  const parserError = new Error('invalid workbook');

  await assert.rejects(
    runRequestReportConfirmedCheckJob({
      client: {},
      fileBuffer: Buffer.from('bad xlsx'),
      parseWorkbook() {
        throw parserError;
      },
      async findMissingRows() {
        throw new Error('should not be called');
      }
    }),
    parserError
  );
});

test('runRequestReportConfirmedCheckJob propagates async parser errors', async () => {
  const parserError = new Error('async invalid workbook');

  await assert.rejects(
    runRequestReportConfirmedCheckJob({
      client: {},
      fileBuffer: Buffer.from('bad xlsx'),
      async parseWorkbook() {
        throw parserError;
      },
      async findMissingRows() {
        throw new Error('should not be called');
      }
    }),
    parserError
  );
});

test('runRequestReportConfirmedCheckJob propagates finder errors', async () => {
  const finderError = new Error('clickhouse failed');
  const calls = [];

  await assert.rejects(
    runRequestReportConfirmedCheckJob({
      client: {},
      fileBuffer: Buffer.from('xlsx bytes'),
      parseWorkbook() {
        return { rows: [{ idLkk: '101' }], warnings: [] };
      },
      async findMissingRows() {
        throw finderError;
      },
      async attachStatuses() {
        calls.push('attachStatuses');
      },
      renderResult() {
        calls.push('renderResult');
      }
    }),
    finderError
  );

  assert.deepEqual(calls, []);
});
