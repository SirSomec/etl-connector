const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createScheduledReportScheduler,
  nextDelayForSchedule,
  parseScheduleTime
} = require('../src/scheduledReportScheduler');

test('scheduled report scheduler calculates next Moscow daily delay before and after target time', () => {
  assert.equal(
    nextDelayForSchedule(
      { scheduleTime: '09:30', timezone: 'Europe/Moscow' },
      new Date('2026-06-25T06:00:00.000Z')
    ),
    30 * 60 * 1000
  );
  assert.equal(
    nextDelayForSchedule(
      { scheduleTime: '09:30', timezone: 'Europe/Moscow' },
      new Date('2026-06-25T06:31:00.000Z')
    ),
    (23 * 60 + 59) * 60 * 1000
  );
  assert.deepEqual(parseScheduleTime('23:59'), { hours: 23, minutes: 59 });
  assert.deepEqual(parseScheduleTime('25:00'), { hours: 9, minutes: 0 });
});

test('scheduled report scheduler reschedules enabled schedules and clears previous timers', () => {
  let schedules = [
    { id: 1, enabled: true, scheduleTime: '09:30', timezone: 'Europe/Moscow' },
    { id: 2, enabled: false, scheduleTime: '09:45', timezone: 'Europe/Moscow' }
  ];
  const timers = [];
  const cleared = [];
  const scheduler = createScheduledReportScheduler({
    store: {
      listEnabledSchedules() {
        return schedules;
      }
    },
    runner: { runSchedule: async () => ({ status: 'success' }) },
    now: () => new Date('2026-06-25T06:00:00.000Z'),
    setTimeoutFn(callback, delay) {
      const timer = { callback, delay };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn(timer) {
      cleared.push(timer);
    }
  });

  scheduler.reschedule();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 30 * 60 * 1000);

  schedules = [{ id: 3, enabled: true, scheduleTime: '10:00', timezone: 'Europe/Moscow' }];
  scheduler.reschedule();

  assert.deepEqual(cleared, [timers[0]]);
  assert.equal(timers.length, 2);
  assert.equal(timers[1].delay, 60 * 60 * 1000);
});

test('scheduled report scheduler timer callback delegates scheduled run and reschedules', async () => {
  let schedules = [{ id: 7, enabled: true, scheduleTime: '09:30', timezone: 'Europe/Moscow' }];
  const timers = [];
  const runs = [];
  const scheduler = createScheduledReportScheduler({
    store: {
      listEnabledSchedules() {
        return schedules;
      }
    },
    runner: {
      async runSchedule(input) {
        runs.push(input);
        return { status: 'success' };
      }
    },
    now: () => new Date('2026-06-25T06:00:00.000Z'),
    setTimeoutFn(callback, delay) {
      const timer = { callback, delay };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn() {}
  });

  scheduler.reschedule();
  schedules = [{ id: 8, enabled: true, scheduleTime: '10:00', timezone: 'Europe/Moscow' }];
  await timers[0].callback();

  assert.deepEqual(runs, [{ scheduleId: 7, trigger: 'schedule', userId: 'system' }]);
  assert.equal(timers.length, 2);
  assert.equal(timers[1].delay, 60 * 60 * 1000);
});

test('scheduled report scheduler retries failed generated reports after three minutes', async () => {
  const schedules = [{ id: 1, enabled: true, scheduleTime: '09:30', timezone: 'Europe/Moscow' }];
  const timers = [];
  const runs = [];
  const results = [
    { status: 'failed', filePath: '', rowCount: 0 },
    { status: 'success', filePath: 'report.xlsx', rowCount: 1 }
  ];
  const scheduler = createScheduledReportScheduler({
    store: {
      listEnabledSchedules() {
        return schedules;
      }
    },
    runner: {
      async runSchedule(input) {
        runs.push(input);
        return results.shift();
      }
    },
    now: () => new Date('2026-06-25T06:00:00.000Z'),
    setTimeoutFn(callback, delay) {
      const timer = { callback, delay };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn() {}
  });

  scheduler.reschedule();

  assert.equal(timers[0].delay, 30 * 60 * 1000);

  await timers[0].callback();

  assert.equal(runs.length, 1);
  assert.equal(timers[1].delay, 3 * 60 * 1000);

  await timers[1].callback();

  assert.deepEqual(runs, [
    { scheduleId: 1, trigger: 'schedule', userId: 'system' },
    { scheduleId: 1, trigger: 'schedule', userId: 'system' }
  ]);
  assert.equal(timers[2].delay, 30 * 60 * 1000);
});

test('scheduled report scheduler does not retry failed reports after mail sending started', async () => {
  const schedules = [{ id: 1, enabled: true, scheduleTime: '09:30', timezone: 'Europe/Moscow' }];
  const timers = [];
  const scheduler = createScheduledReportScheduler({
    store: {
      listEnabledSchedules() {
        return schedules;
      }
    },
    runner: {
      async runSchedule() {
        return { status: 'failed', filePath: 'report.xlsx', rowCount: 1 };
      }
    },
    now: () => new Date('2026-06-25T06:00:00.000Z'),
    setTimeoutFn(callback, delay) {
      const timer = { callback, delay };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn() {}
  });

  scheduler.reschedule();
  await timers[0].callback();

  assert.equal(timers[1].delay, 30 * 60 * 1000);
});

test('scheduled report scheduler does not retry manual failures', async () => {
  const timers = [];
  const scheduler = createScheduledReportScheduler({
    store: { listEnabledSchedules: () => [] },
    runner: {
      async runSchedule() {
        return { status: 'failed', filePath: '', rowCount: 0 };
      }
    },
    setTimeoutFn(callback, delay) {
      const timer = { callback, delay };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn() {}
  });

  const result = await scheduler.runNow({ scheduleId: 1, trigger: 'manual', userId: 'u' });

  assert.deepEqual(result, { status: 'failed', filePath: '', rowCount: 0 });
  assert.deepEqual(timers, []);
});

test('scheduled report scheduler prevents parallel run for same schedule and drains running promises', async () => {
  let release;
  const blocker = new Promise((resolve) => {
    release = resolve;
  });
  let runs = 0;
  const scheduler = createScheduledReportScheduler({
    store: { listEnabledSchedules: () => [] },
    runner: {
      async runSchedule(input) {
        runs += 1;
        assert.deepEqual(input, { scheduleId: 1, trigger: 'manual', userId: 'u' });
        await blocker;
        return { status: 'success' };
      }
    }
  });

  const first = scheduler.runNow({ scheduleId: 1, trigger: 'manual', userId: 'u' });
  const second = await scheduler.runNow({ scheduleId: 1, trigger: 'manual', userId: 'u' });

  assert.equal(runs, 1);
  assert.deepEqual(second, { status: 'running', alreadyRunning: true });

  release();
  assert.deepEqual(await scheduler.drain(), [{ status: 'fulfilled', value: { status: 'success' } }]);
  assert.deepEqual(await first, { status: 'success' });
});

test('scheduled report scheduler stale callback after stop does not run or reschedule', async () => {
  const timers = [];
  const cleared = [];
  let runs = 0;
  const scheduler = createScheduledReportScheduler({
    store: {
      listEnabledSchedules() {
        return [{ id: 1, enabled: true, scheduleTime: '09:30', timezone: 'Europe/Moscow' }];
      }
    },
    runner: {
      async runSchedule() {
        runs += 1;
        return { status: 'success' };
      }
    },
    now: () => new Date('2026-06-25T06:00:00.000Z'),
    setTimeoutFn(callback, delay) {
      const timer = { callback, delay };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn(timer) {
      cleared.push(timer);
    }
  });

  scheduler.reschedule();
  const staleCallback = timers[0].callback;
  scheduler.stop();
  scheduler.stop();
  await staleCallback();

  assert.deepEqual(cleared, [timers[0]]);
  assert.equal(timers.length, 1);
  assert.equal(runs, 0);
});

test('scheduled report scheduler explicit reschedule after stop starts timers again', () => {
  const timers = [];
  const cleared = [];
  const scheduler = createScheduledReportScheduler({
    store: {
      listEnabledSchedules() {
        return [{ id: 1, enabled: true, scheduleTime: '09:30', timezone: 'Europe/Moscow' }];
      }
    },
    runner: { runSchedule: async () => ({ status: 'success' }) },
    now: () => new Date('2026-06-25T06:00:00.000Z'),
    setTimeoutFn(callback, delay) {
      const timer = { callback, delay };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn(timer) {
      cleared.push(timer);
    }
  });

  scheduler.reschedule();
  scheduler.stop();
  scheduler.reschedule();

  assert.deepEqual(cleared, [timers[0]]);
  assert.equal(timers.length, 2);
  assert.equal(timers[1].delay, 30 * 60 * 1000);
});

test('scheduled report scheduler ignores stale callback after stop and explicit reschedule', async () => {
  let schedules = [{ id: 1, enabled: true, scheduleTime: '09:30', timezone: 'Europe/Moscow' }];
  const timers = [];
  const runs = [];
  const scheduler = createScheduledReportScheduler({
    store: {
      listEnabledSchedules() {
        return schedules;
      }
    },
    runner: {
      async runSchedule(input) {
        runs.push(input);
        return { status: 'success' };
      }
    },
    now: () => new Date('2026-06-25T06:00:00.000Z'),
    setTimeoutFn(callback, delay) {
      const timer = { callback, delay };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn() {}
  });

  scheduler.reschedule();
  const staleCallback = timers[0].callback;
  scheduler.stop();
  schedules = [{ id: 2, enabled: true, scheduleTime: '10:00', timezone: 'Europe/Moscow' }];
  scheduler.reschedule();

  await staleCallback();

  assert.deepEqual(runs, []);
  assert.equal(timers.length, 2);
});

test('scheduled report scheduler stale same-id callback does not orphan active timer', async () => {
  const timers = [];
  const cleared = [];
  const runs = [];
  const scheduler = createScheduledReportScheduler({
    store: {
      listEnabledSchedules() {
        return [{ id: 1, enabled: true, scheduleTime: '09:30', timezone: 'Europe/Moscow' }];
      }
    },
    runner: {
      async runSchedule(input) {
        runs.push(input);
        return { status: 'success' };
      }
    },
    now: () => new Date('2026-06-25T06:00:00.000Z'),
    setTimeoutFn(callback, delay) {
      const timer = { callback, delay };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn(timer) {
      cleared.push(timer);
    }
  });

  scheduler.reschedule();
  const staleCallback = timers[0].callback;
  scheduler.reschedule();
  const activeTimer = timers[1];

  await staleCallback();
  scheduler.stop();

  assert.deepEqual(runs, []);
  assert.equal(timers.length, 2);
  assert.equal(cleared.includes(activeTimer), true);
});
