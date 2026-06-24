const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  REQUEST_REPORT_SHIFT_STATUS_OPTIONS,
  createRequestReportShiftStatusStore,
  requestReportShiftStatusKey
} = require('../src/requestReportShiftStatusStore');

test('request report shift statuses are persisted per user and survive refreshed report rows', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'request-report-status-'));
  const filePath = path.join(tempDir, 'statuses.json');
  const firstReportRow = {
    idLkk: '101.0',
    organization: 'АО Тест',
    workplace: 'Точка 1',
    employee: 'Иванов Иван',
    startText: '2026-06-01 09:00',
    actualDuration: '7.5'
  };
  const refreshedReportRows = [
    {
      idLkk: '101',
      organization: 'АО Тест обновлено',
      workplace: 'Точка 1',
      employee: 'Иванов Иван',
      startText: '2026-06-01 09:00',
      actualDuration: '8'
    }
  ];

  try {
    const store = createRequestReportShiftStatusStore({ filePath });
    const rowKey = requestReportShiftStatusKey(firstReportRow);

    await store.setStatus({ userId: 'user-a', rowKey, status: 'verified' });
    await store.setStatus({ userId: 'user-b', rowKey, status: 'return-later' });

    const reloadedStore = createRequestReportShiftStatusStore({ filePath });
    const userARows = await reloadedStore.attachStatuses('user-a', refreshedReportRows);
    const userBRows = await reloadedStore.attachStatuses('user-b', refreshedReportRows);

    assert.equal(userARows[0].reviewStatusKey, rowKey);
    assert.equal(userARows[0].reviewStatus, 'verified');
    assert.equal(userARows[0].reviewStatusLabel, 'Проверена');
    assert.equal(userBRows[0].reviewStatus, 'return-later');
    assert.equal(userBRows[0].reviewStatusLabel, 'Вернуться позже');
    assert.deepEqual(
      REQUEST_REPORT_SHIFT_STATUS_OPTIONS.map((option) => option.id),
      ['verified', 'return-later']
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('request report shift status store serializes concurrent writes without losing rows', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'request-report-status-concurrent-'));
  const filePath = path.join(tempDir, 'statuses.json');
  const rows = Array.from({ length: 20 }, (_, index) => ({
    idLkk: String(7000 + index),
    organization: 'АО Тест',
    workplace: `Точка ${index}`,
    employee: 'Иванов Иван',
    startText: '2026-06-01 09:00'
  }));

  try {
    const store = createRequestReportShiftStatusStore({ filePath });

    await Promise.all(rows.map((row, index) =>
      store.setStatus({
        userId: 'user-a',
        rowKey: requestReportShiftStatusKey(row),
        status: index % 2 === 0 ? 'verified' : 'return-later'
      })
    ));

    const reloadedStore = createRequestReportShiftStatusStore({ filePath });
    const enriched = await reloadedStore.attachStatuses('user-a', rows);
    const leftoverTempFiles = (await fs.readdir(tempDir)).filter((fileName) => fileName.endsWith('.tmp'));

    assert.equal(enriched.filter((row) => row.reviewStatus === 'verified').length, 10);
    assert.equal(enriched.filter((row) => row.reviewStatus === 'return-later').length, 10);
    assert.deepEqual(leftoverTempFiles, []);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

