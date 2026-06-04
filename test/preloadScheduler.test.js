const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createPreloadScheduler,
  scheduledRangeForJob
} = require('../src/preloadScheduler');
const { SALES_PRELOAD_JOB_ID } = require('../src/preloadStore');
const { createPreloadService } = require('../src/preloadService');

test('scheduledRangeForJob returns last refresh days as exclusive range', () => {
  const range = scheduledRangeForJob(
    { refreshDays: 45 },
    new Date('2026-06-04T12:00:00.000Z')
  );

  assert.deepEqual(range, {
    fromDate: '2026-04-20',
    toDate: '2026-06-05'
  });
});

test('preload scheduler prevents parallel runs for the same job', async () => {
  let loads = 0;
  let startRuns = 0;
  let release;
  const blocker = new Promise((resolve) => {
    release = resolve;
  });
  const store = {
    startRun(input) {
      startRuns += 1;
      return { id: 1, ...input };
    },
    finishRun() {},
    getJob() {
      return {
        id: SALES_PRELOAD_JOB_ID,
        enabled: true,
        scheduleTime: '03:00',
        timezone: 'Europe/Moscow',
        refreshDays: 45
      };
    }
  };
  const scheduler = createPreloadScheduler({
    store,
    loaders: {
      [SALES_PRELOAD_JOB_ID]: async () => {
        loads += 1;
        await blocker;
        return { rowsWritten: 1 };
      }
    },
    sanitizeError: (error) => String(error && error.message)
  });

  const first = scheduler.runNow({
    jobId: SALES_PRELOAD_JOB_ID,
    trigger: 'manual',
    fromDate: '2026-05-01',
    toDate: '2026-06-01'
  });
  const second = await scheduler.runNow({
    jobId: SALES_PRELOAD_JOB_ID,
    trigger: 'manual',
    fromDate: '2026-05-01',
    toDate: '2026-06-01'
  });

  release();
  const firstResult = await first;

  assert.equal(loads, 1);
  assert.equal(startRuns, 1);
  assert.equal(second.status, 'running');
  assert.equal(second.alreadyRunning, true);
  assert.equal(firstResult.status, 'success');
});

test('preload scheduler records failed loader run with sanitized error', async () => {
  const finishCalls = [];
  const store = {
    startRun(input) {
      return { id: 12, ...input };
    },
    finishRun(runId, input) {
      finishCalls.push({ runId, input });
      return { id: runId, ...input };
    },
    getJob() {
      return null;
    }
  };
  const scheduler = createPreloadScheduler({
    store,
    loaders: {
      [SALES_PRELOAD_JOB_ID]: async () => {
        throw new Error('ClickHouse timeout');
      }
    },
    sanitizeError: (error) => `safe: ${error.message}`
  });

  const result = await scheduler.runNow({
    jobId: SALES_PRELOAD_JOB_ID,
    trigger: 'manual',
    fromDate: '2026-05-01',
    toDate: '2026-06-01'
  });

  assert.deepEqual(finishCalls, [
    {
      runId: 12,
      input: {
        status: 'failed',
        errorMessage: 'safe: ClickHouse timeout',
        rowsWritten: 0
      }
    }
  ]);
  assert.equal(result.status, 'failed');
  assert.equal(result.errorMessage, 'safe: ClickHouse timeout');
  assert.equal(result.rowsWritten, 0);
});

test('preload scheduler clears running marker after missing loader failure', async () => {
  const startRuns = [];
  const finishCalls = [];
  const store = {
    startRun(input) {
      const run = { id: startRuns.length + 1, ...input };

      startRuns.push(run);
      return run;
    },
    finishRun(runId, input) {
      finishCalls.push({ runId, input });
      return { id: runId, ...input };
    },
    getJob() {
      return null;
    }
  };
  const scheduler = createPreloadScheduler({
    store,
    loaders: {},
    sanitizeError: (error) => String(error && error.message)
  });
  const input = {
    jobId: SALES_PRELOAD_JOB_ID,
    trigger: 'manual',
    fromDate: '2026-05-01',
    toDate: '2026-06-01'
  };

  const first = await scheduler.runNow(input);
  const second = await scheduler.runNow(input);

  assert.equal(first.status, 'failed');
  assert.equal(first.errorMessage, `No preload loader registered for ${SALES_PRELOAD_JOB_ID}`);
  assert.equal(second.status, 'failed');
  assert.equal(second.alreadyRunning, undefined);
  assert.equal(startRuns.length, 2);
  assert.deepEqual(finishCalls.map((call) => call.runId), [1, 2]);
});

test('preload scheduler reschedules enabled sales job and stop clears timer', () => {
  const timeouts = [];
  const cleared = [];
  const store = {
    startRun(input) {
      return { id: 1, ...input };
    },
    finishRun(runId, input) {
      return { id: runId, ...input };
    },
    getJob(jobId) {
      assert.equal(jobId, SALES_PRELOAD_JOB_ID);
      return {
        id: SALES_PRELOAD_JOB_ID,
        enabled: true,
        scheduleTime: '03:00',
        timezone: 'Europe/Moscow',
        refreshDays: 45
      };
    }
  };
  const scheduler = createPreloadScheduler({
    store,
    loaders: {
      [SALES_PRELOAD_JOB_ID]: async () => ({ rowsWritten: 1 })
    },
    now: () => new Date('2026-06-04T00:00:00.000Z'),
    setTimeoutFn(callback, delay) {
      const timer = { callback, delay };
      timeouts.push(timer);
      return timer;
    },
    clearTimeoutFn(timer) {
      cleared.push(timer);
    }
  });

  scheduler.reschedule();
  scheduler.reschedule();
  scheduler.stop();
  scheduler.stop();

  assert.equal(timeouts.length, 2);
  assert.equal(timeouts[0].delay >= 0, true);
  assert.equal(timeouts[1].delay >= 0, true);
  assert.deepEqual(cleared, [timeouts[0], timeouts[1]]);
});

test('reschedule does not schedule missing or disabled sales job', () => {
  const missingTimeouts = [];
  const missingJobScheduler = createPreloadScheduler({
    store: {
      getJob() {
        return null;
      },
      startRun() {
        throw new Error('missing job should not start');
      },
      finishRun() {}
    },
    loaders: {},
    setTimeoutFn(callback, delay) {
      missingTimeouts.push({ callback, delay });
      return {};
    }
  });

  missingJobScheduler.reschedule();

  const disabledTimeouts = [];
  const disabledJobScheduler = createPreloadScheduler({
    store: {
      getJob() {
        return {
          id: SALES_PRELOAD_JOB_ID,
          enabled: false,
          scheduleTime: '03:00',
          timezone: 'Europe/Moscow',
          refreshDays: 45
        };
      },
      startRun() {
        throw new Error('disabled job should not start');
      },
      finishRun() {}
    },
    loaders: {},
    setTimeoutFn(callback, delay) {
      disabledTimeouts.push({ callback, delay });
      return {};
    }
  });

  disabledJobScheduler.reschedule();

  assert.deepEqual(missingTimeouts, []);
  assert.deepEqual(disabledTimeouts, []);
});

test('scheduled callback runs sales job range and reschedules after completion', async () => {
  const nowDate = new Date('2026-06-04T00:00:00.000Z');
  const job = {
    id: SALES_PRELOAD_JOB_ID,
    enabled: true,
    scheduleTime: '03:00',
    timezone: 'Europe/Moscow',
    refreshDays: 45
  };
  const timeouts = [];
  const startRuns = [];
  let loads = 0;
  const store = {
    startRun(input) {
      startRuns.push(input);
      return { id: startRuns.length, ...input };
    },
    finishRun(runId, input) {
      return { id: runId, ...input };
    },
    getJob(jobId) {
      assert.equal(jobId, SALES_PRELOAD_JOB_ID);
      return job;
    }
  };
  const scheduler = createPreloadScheduler({
    store,
    loaders: {
      [SALES_PRELOAD_JOB_ID]: async () => {
        loads += 1;
        return { rowsWritten: 2 };
      }
    },
    now: () => nowDate,
    setTimeoutFn(callback, delay) {
      const timer = { callback, delay };
      timeouts.push(timer);
      return timer;
    },
    clearTimeoutFn() {}
  });

  scheduler.reschedule();
  await timeouts[0].callback();

  assert.equal(loads, 1);
  assert.equal(timeouts.length, 2);
  assert.deepEqual(startRuns, [
    {
      jobId: SALES_PRELOAD_JOB_ID,
      trigger: 'schedule',
      ...scheduledRangeForJob(job, nowDate)
    }
  ]);
});

test('preload service facade delegates schedule, run and covered reads', async () => {
  const calls = [];
  const store = {
    getSalesByProjectOverview() {
      return { coveredFrom: '2026-05-01', coveredTo: '2026-06-01' };
    },
    getJob(jobId) {
      calls.push({ method: 'getJob', jobId });
      return { id: jobId };
    },
    listRuns(jobId, limit) {
      calls.push({ method: 'listRuns', jobId, limit });
      return [];
    },
    saveJobSchedule(jobId, input) {
      calls.push({ method: 'saveJobSchedule', jobId, input });
      return { id: jobId, ...input };
    },
    hasSalesByProjectCoverage(fromDate, toDate) {
      calls.push({ method: 'hasSalesByProjectCoverage', fromDate, toDate });
      return fromDate === '2026-05-01';
    },
    readSalesByProjectSectionRows(input) {
      calls.push({ method: 'readSalesByProjectSectionRows', input });
      return { rows: [] };
    },
    close() {
      calls.push({ method: 'store.close' });
    }
  };
  const scheduler = {
    reschedule() {
      calls.push({ method: 'scheduler.reschedule' });
    },
    runNow(input) {
      calls.push({ method: 'scheduler.runNow', input });
      return Promise.resolve({ status: 'success' });
    },
    stop() {
      calls.push({ method: 'scheduler.stop' });
    }
  };
  const service = createPreloadService({ client: {}, store, scheduler });

  const saved = service.saveSchedule({ enabled: false });
  const run = await service.runSalesByProject({
    fromDate: '2026-05-01',
    toDate: '2026-06-01'
  });
  const coveredRows = service.readSalesByProjectSectionRows({
    section: 'summary',
    period: 'month',
    fromDate: '2026-05-01',
    toDate: '2026-06-01'
  });
  const missingRows = service.readSalesByProjectSectionRows({
    section: 'summary',
    period: 'month',
    fromDate: '2026-04-01',
    toDate: '2026-05-01'
  });

  await service.close();

  assert.deepEqual(saved, { id: SALES_PRELOAD_JOB_ID, enabled: false });
  assert.deepEqual(run, { status: 'success' });
  assert.deepEqual(coveredRows, { rows: [] });
  assert.equal(missingRows, null);
  assert.deepEqual(calls, [
    { method: 'scheduler.reschedule' },
    {
      method: 'saveJobSchedule',
      jobId: SALES_PRELOAD_JOB_ID,
      input: { enabled: false }
    },
    { method: 'scheduler.reschedule' },
    {
      method: 'scheduler.runNow',
      input: {
        jobId: SALES_PRELOAD_JOB_ID,
        trigger: 'manual',
        fromDate: '2026-05-01',
        toDate: '2026-06-01'
      }
    },
    {
      method: 'hasSalesByProjectCoverage',
      fromDate: '2026-05-01',
      toDate: '2026-06-01'
    },
    {
      method: 'readSalesByProjectSectionRows',
      input: {
        section: 'summary',
        period: 'month',
        fromDate: '2026-05-01',
        toDate: '2026-06-01'
      }
    },
    {
      method: 'hasSalesByProjectCoverage',
      fromDate: '2026-04-01',
      toDate: '2026-05-01'
    },
    { method: 'scheduler.stop' },
    { method: 'store.close' }
  ]);
});

test('preload service close waits for active scheduler run before closing store', async () => {
  let releaseLoader;
  let markLoaderStarted;
  const loaderCanFinish = new Promise((resolve) => {
    releaseLoader = resolve;
  });
  const loaderStarted = new Promise((resolve) => {
    markLoaderStarted = resolve;
  });
  const calls = [];
  const store = {
    closed: false,
    startRun(input) {
      calls.push('store.startRun');
      return { id: 1, ...input };
    },
    finishRun(runId, input) {
      calls.push(`store.finishRun:${this.closed ? 'closed' : 'open'}`);
      return { id: runId, ...input };
    },
    getJob() {
      return null;
    },
    getSalesByProjectOverview() {
      return {};
    },
    listRuns() {
      return [];
    },
    saveJobSchedule() {
      return null;
    },
    hasSalesByProjectCoverage() {
      return false;
    },
    readSalesByProjectSectionRows() {
      return null;
    },
    close() {
      this.closed = true;
      calls.push('store.close');
    }
  };
  const scheduler = createPreloadScheduler({
    store,
    loaders: {
      [SALES_PRELOAD_JOB_ID]: async () => {
        calls.push('loader.start');
        markLoaderStarted();
        await loaderCanFinish;
        calls.push('loader.finish');
        return { rowsWritten: 1 };
      }
    },
    sanitizeError: (error) => String(error && error.message)
  });
  const service = createPreloadService({ client: {}, store, scheduler });
  const runPromise = service.runSalesByProject({
    fromDate: '2026-05-01',
    toDate: '2026-06-01'
  });
  let closePromise;
  let assertionError;

  runPromise.catch(() => {});
  await loaderStarted;

  try {
    closePromise = service.close();
    assert.equal(store.closed, false);
  } catch (error) {
    assertionError = error;
  } finally {
    releaseLoader();
  }

  if (closePromise && typeof closePromise.then === 'function') {
    await closePromise;
  }

  const run = await runPromise;

  if (assertionError) {
    throw assertionError;
  }

  assert.equal(run.status, 'success');
  assert.equal(store.closed, true);
  assert.deepEqual(calls, [
    'store.startRun',
    'loader.start',
    'loader.finish',
    'store.finishRun:open',
    'store.close'
  ]);
});

test('preload service close is idempotent', async () => {
  const calls = [];
  const store = {
    getSalesByProjectOverview() {
      return {};
    },
    getJob() {
      return null;
    },
    listRuns() {
      return [];
    },
    saveJobSchedule() {
      return null;
    },
    hasSalesByProjectCoverage() {
      return false;
    },
    readSalesByProjectSectionRows() {
      return null;
    },
    close() {
      calls.push('store.close');
    }
  };
  const scheduler = {
    reschedule() {
      calls.push('scheduler.reschedule');
    },
    runNow() {
      return Promise.resolve({ status: 'success' });
    },
    stop() {
      calls.push('scheduler.stop');
    },
    drain() {
      calls.push('scheduler.drain');
      return Promise.resolve();
    }
  };
  const service = createPreloadService({ client: {}, store, scheduler });

  const firstClose = service.close();
  const secondClose = service.close();

  assert.equal(typeof firstClose.then, 'function');
  assert.equal(firstClose, secondClose);
  await Promise.all([firstClose, secondClose]);

  assert.deepEqual(calls, [
    'scheduler.reschedule',
    'scheduler.stop',
    'scheduler.drain',
    'store.close'
  ]);
});
