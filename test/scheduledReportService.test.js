const test = require('node:test');
const assert = require('node:assert/strict');

const { createScheduledReportService } = require('../src/scheduledReportService');

function createFacadeMocks() {
  const calls = [];
  const store = {
    listReports(...args) {
      calls.push(['listReports', ...args]);
      return [{ id: 1 }];
    },
    getReport(...args) {
      calls.push(['getReport', ...args]);
      return { id: args[0] };
    },
    createReport(input) {
      calls.push(['createReport', input]);
      return { id: 2, ...input };
    },
    updateReport(id, input) {
      calls.push(['updateReport', id, input]);
      return { id, ...input };
    },
    listSchedules(...args) {
      calls.push(['listSchedules', ...args]);
      return [{ id: 3 }];
    },
    getSchedule(...args) {
      calls.push(['getSchedule', ...args]);
      return { id: args[0] };
    },
    createSchedule(input) {
      calls.push(['createSchedule', input]);
      return { id: 4, ...input };
    },
    updateSchedule(id, input) {
      calls.push(['updateSchedule', id, input]);
      return { id, ...input };
    },
    listRuns(...args) {
      calls.push(['listRuns', ...args]);
      return [];
    },
    getRun(...args) {
      calls.push(['getRun', ...args]);
      return { id: args[0] };
    },
    getMailSettings(...args) {
      calls.push(['getMailSettings', ...args]);
      return { hasPassword: false };
    },
    saveMailSettings(input) {
      calls.push(['saveMailSettings', input]);
      return { hasPassword: Boolean(input.password) };
    },
    async pruneOldRuns(days) {
      calls.push(['pruneOldRuns', days]);
      return { runs: 0, files: 0 };
    },
    close() {
      calls.push(['close']);
    }
  };
  const scheduler = {
    reschedule() {
      calls.push(['reschedule']);
    },
    runNow(input) {
      calls.push(['runNow', input]);
      return Promise.resolve({ status: 'success' });
    },
    stop() {
      calls.push(['stop']);
    },
    drain() {
      calls.push(['drain']);
      return Promise.resolve([]);
    }
  };

  return { calls, scheduler, store };
}

test('scheduled report service delegates CRUD and reschedules after schedule changes', async () => {
  const { calls, scheduler, store } = createFacadeMocks();
  const service = createScheduledReportService({ store, scheduler });

  assert.deepEqual(service.listReports({ limit: 5 }), [{ id: 1 }]);
  assert.deepEqual(service.getReport(1), { id: 1 });
  assert.deepEqual(service.createReport({ title: 'R' }), { id: 2, title: 'R' });
  assert.deepEqual(service.updateReport(2, { enabled: false }), { id: 2, enabled: false });
  assert.deepEqual(service.listSchedules(2), [{ id: 3 }]);
  assert.deepEqual(service.getSchedule(3), { id: 3 });
  assert.deepEqual(service.createSchedule({ reportId: 2 }), { id: 4, reportId: 2 });
  assert.deepEqual(service.updateSchedule(4, { enabled: false }), { id: 4, enabled: false });
  assert.deepEqual(service.listRuns({ reportId: 2 }), []);
  assert.deepEqual(service.getRun(5), { id: 5 });
  assert.deepEqual(service.getMailSettings(), { hasPassword: false });
  assert.deepEqual(service.saveMailSettings({ password: 'secret' }), { hasPassword: true });
  assert.deepEqual(await service.pruneOldRuns(60), { runs: 0, files: 0 });
  assert.deepEqual(await service.runSchedule({ scheduleId: 4, userId: 'u' }), { status: 'success' });

  assert.deepEqual(calls.map((call) => call[0]), [
    'reschedule',
    'listReports',
    'getReport',
    'createReport',
    'updateReport',
    'reschedule',
    'listSchedules',
    'getSchedule',
    'createSchedule',
    'reschedule',
    'updateSchedule',
    'reschedule',
    'listRuns',
    'getRun',
    'getMailSettings',
    'saveMailSettings',
    'pruneOldRuns',
    'runNow'
  ]);
});

test('scheduled report service close is idempotent and stops drains then closes store', async () => {
  const { calls, scheduler, store } = createFacadeMocks();
  const service = createScheduledReportService({ store, scheduler });

  const firstClose = service.close();
  const secondClose = service.close();

  assert.strictEqual(firstClose, secondClose);
  await Promise.all([firstClose, secondClose]);

  assert.deepEqual(calls.map((call) => call[0]), [
    'reschedule',
    'stop',
    'drain',
    'close'
  ]);
});
