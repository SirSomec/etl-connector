const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createPreloadScheduler,
  scheduledRangeForJob
} = require('../src/preloadScheduler');
const {
  SALES_PRELOAD_JOB_ID,
  WORKPLACE_POINT_PRELOAD_JOB_ID,
  WORKPLACE_ANALYSIS_PRELOAD_JOB_ID
} = require('../src/preloadStore');
const { createPreloadService } = require('../src/preloadService');

test('scheduledRangeForJob returns last refresh days as exclusive range', () => {
  const range = scheduledRangeForJob(
    { refreshDays: 45 },
    new Date('2026-06-04T12:00:00.000Z')
  );

  assert.deepEqual(range, {
    fromDate: '2026-04-20',
    toDate: '2026-07-20'
  });
});

test('scheduledRangeForJob returns past and future exclusive range', () => {
  const range = scheduledRangeForJob(
    { refreshPastDays: 45, refreshFutureDays: 45 },
    new Date('2026-06-16T12:00:00.000Z')
  );

  assert.deepEqual(range, {
    fromDate: '2026-05-02',
    toDate: '2026-08-01'
  });
});

test('scheduledRangeForJob enforces at least 45 days backward and forward', () => {
  const range = scheduledRangeForJob(
    { refreshPastDays: 7, refreshFutureDays: 3 },
    new Date('2026-06-16T12:00:00.000Z')
  );

  assert.deepEqual(range, {
    fromDate: '2026-05-02',
    toDate: '2026-08-01'
  });
});

test('scheduledRangeForJob allows workplace point thirty day scheduled window', () => {
  const range = scheduledRangeForJob(
    {
      id: WORKPLACE_POINT_PRELOAD_JOB_ID,
      refreshPastDays: 30,
      refreshFutureDays: 30
    },
    new Date('2026-07-02T05:00:00.000Z')
  );

  assert.deepEqual(range, {
    fromDate: '2026-06-02',
    toDate: '2026-08-02'
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

test('preload scheduler reschedules every enabled job', () => {
  const timeouts = [];
  const store = {
    startRun(input) {
      return { id: timeouts.length, ...input };
    },
    finishRun(runId, input) {
      return { id: runId, ...input };
    },
    listJobs() {
      return [
        {
          id: SALES_PRELOAD_JOB_ID,
          enabled: true,
          scheduleTime: '03:00',
          timezone: 'Europe/Moscow',
          refreshPastDays: 45,
          refreshFutureDays: 45
        },
        {
          id: WORKPLACE_ANALYSIS_PRELOAD_JOB_ID,
          enabled: true,
          scheduleTime: '04:00',
          timezone: 'Europe/Moscow',
          refreshPastDays: 45,
          refreshFutureDays: 45
        }
      ];
    },
    getJob() {
      throw new Error('listJobs should be used when available');
    }
  };
  const scheduler = createPreloadScheduler({
    store,
    loaders: {
      [SALES_PRELOAD_JOB_ID]: async () => ({ rowsWritten: 1 }),
      [WORKPLACE_ANALYSIS_PRELOAD_JOB_ID]: async () => ({ rowsWritten: 2 })
    },
    now: () => new Date('2026-06-16T00:00:00.000Z'),
    setTimeoutFn(callback, delay) {
      const timer = { callback, delay };
      timeouts.push(timer);
      return timer;
    },
    clearTimeoutFn() {}
  });

  scheduler.reschedule();

  assert.equal(timeouts.length, 2);
  assert.equal(timeouts.every((timer) => timer.delay >= 0), true);
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
    getSalesByProjectDiagnostics() {
      calls.push({ method: 'getSalesByProjectDiagnostics' });
      return { tables: { orderFacts: 1 } };
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
  const diagnostics = service.getDiagnostics();
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
  assert.deepEqual(diagnostics, { salesByProject: { tables: { orderFacts: 1 } } });
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
    { method: 'getSalesByProjectDiagnostics' },
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

test('preload service facade delegates generic workplace analysis methods', async () => {
  const calls = [];
  const store = {
    listJobs() {
      calls.push({ method: 'listJobs' });
      return [{ id: SALES_PRELOAD_JOB_ID }, { id: WORKPLACE_ANALYSIS_PRELOAD_JOB_ID }];
    },
    getSalesByProjectOverview() {
      return {};
    },
    getSalesByProjectDiagnostics() {
      return {};
    },
    getJob(jobId) {
      return { id: jobId };
    },
    listRuns() {
      return [];
    },
    saveJobSchedule(jobId, input) {
      calls.push({ method: 'saveJobSchedule', jobId, input });
      return { id: jobId, ...input };
    },
    registerDashboardPreloadRequest(input) {
      calls.push({ method: 'registerDashboardPreloadRequest', input });
      return input;
    },
    saveDashboardPreloadResult(input) {
      calls.push({ method: 'saveDashboardPreloadResult', input });
      return input;
    },
    readDashboardPreloadResult(input) {
      calls.push({ method: 'readDashboardPreloadResult', input });
      return { payload: { points: [{ workplaceId: 'wp1' }] } };
    },
    close() {}
  };
  const scheduler = {
    reschedule() {
      calls.push({ method: 'reschedule' });
    },
    runNow(input) {
      calls.push({ method: 'runNow', input });
      return Promise.resolve({ status: 'success', rowsWritten: 2 });
    },
    stop() {},
    drain() {
      return Promise.resolve([]);
    }
  };
  const service = createPreloadService({ client: {}, store, scheduler });

  assert.deepEqual(service.listJobs().map((job) => job.id), [
    SALES_PRELOAD_JOB_ID,
    WORKPLACE_ANALYSIS_PRELOAD_JOB_ID
  ]);
  service.saveSchedule({
    jobId: WORKPLACE_ANALYSIS_PRELOAD_JOB_ID,
    enabled: true,
    scheduleTime: '04:00',
    refreshPastDays: 45,
    refreshFutureDays: 45
  });
  await service.runJob({
    jobId: WORKPLACE_ANALYSIS_PRELOAD_JOB_ID,
    fromDate: '2026-05-02',
    toDate: '2026-08-01'
  });
  service.registerWorkplaceAnalysisRequest({
    section: 'points',
    cacheKey: 'points-key',
    input: { from: '2026-06-01', to: '2026-06-30' }
  });
  const payload = service.readWorkplaceAnalysisSection({
    section: 'points',
    cacheKey: 'points-key',
    fromDate: '2026-06-01',
    toDate: '2026-07-01'
  });
  service.saveWorkplaceAnalysisSection({
    section: 'points',
    cacheKey: 'points-key',
    fromDate: '2026-06-01',
    toDate: '2026-07-01',
    payload: { points: [{ workplaceId: 'wp2' }] }
  });

  assert.deepEqual(payload, { points: [{ workplaceId: 'wp1' }] });
  assert.deepEqual(calls.filter((call) => call.method === 'saveJobSchedule'), [
    {
      method: 'saveJobSchedule',
      jobId: WORKPLACE_ANALYSIS_PRELOAD_JOB_ID,
      input: {
        enabled: true,
        scheduleTime: '04:00',
        refreshPastDays: 45,
        refreshFutureDays: 45
      }
    }
  ]);
  assert.deepEqual(calls.filter((call) => call.method === 'runNow'), [
    {
      method: 'runNow',
      input: {
        jobId: WORKPLACE_ANALYSIS_PRELOAD_JOB_ID,
        trigger: 'manual',
        fromDate: '2026-05-02',
        toDate: '2026-08-01'
      }
    }
  ]);
  assert.equal(
    calls.some((call) =>
      call.method === 'registerDashboardPreloadRequest' &&
      call.input.jobId === WORKPLACE_ANALYSIS_PRELOAD_JOB_ID &&
      call.input.dashboardId === 'workplace-analysis'
    ),
    true
  );
  assert.equal(
    calls.some((call) =>
      call.method === 'readDashboardPreloadResult' &&
      call.input.jobId === WORKPLACE_ANALYSIS_PRELOAD_JOB_ID
    ),
    true
  );
  assert.equal(
    calls.some((call) =>
      call.method === 'saveDashboardPreloadResult' &&
      call.input.jobId === WORKPLACE_ANALYSIS_PRELOAD_JOB_ID &&
      call.input.dashboardId === 'workplace-analysis' &&
      call.input.payload.points[0].workplaceId === 'wp2'
    ),
    true
  );
});

test('preload service facade delegates workplace point methods', async () => {
  const calls = [];
  const store = {
    listJobs() {
      return [{ id: WORKPLACE_POINT_PRELOAD_JOB_ID }];
    },
    getSalesByProjectOverview() {
      return {};
    },
    getSalesByProjectDiagnostics() {
      return {};
    },
    getJob(jobId) {
      return { id: jobId };
    },
    listRuns() {
      return [];
    },
    saveJobSchedule() {
      return null;
    },
    registerDashboardPreloadRequest(input) {
      calls.push({ method: 'registerDashboardPreloadRequest', input });
      return input;
    },
    readWorkplacePointSectionRows(input) {
      calls.push({ method: 'readWorkplacePointSectionRows', input });
      return null;
    },
    readDashboardPreloadResult(input) {
      calls.push({ method: 'readDashboardPreloadResult', input });
      return { payload: { summaryRows: [{ stale: true }] } };
    },
    saveDashboardPreloadResult(input) {
      calls.push({ method: 'saveDashboardPreloadResult', input });
      return input;
    },
    close() {}
  };
  const scheduler = {
    reschedule() {},
    runNow(input) {
      calls.push({ method: 'runNow', input });
      return Promise.resolve({ status: 'success', rowsWritten: 4 });
    },
    stop() {},
    drain() {
      return Promise.resolve([]);
    }
  };
  const service = createPreloadService({ client: {}, store, scheduler });

  await service.runWorkplacePoint({ fromDate: '2026-06-02', toDate: '2026-08-02' });
  service.registerWorkplacePointRequest({
    section: 'summary',
    cacheKey: 'summary-key',
    input: { workplaceId: 'wp1' }
  });
  const preloaded = service.readWorkplacePointSection({
    section: 'summary',
    cacheKey: 'summary-key',
    filters: { workplaceId: 'wp1' },
    fromDate: '2026-07-01',
    toDate: '2026-07-03'
  });
  service.saveWorkplacePointSection({
    section: 'summary',
    cacheKey: 'summary-key',
    fromDate: '2026-07-01',
    toDate: '2026-07-03',
    payload: { summaryRows: [] }
  });

  assert.equal(preloaded, null);

  assert.deepEqual(calls, [
    {
      method: 'runNow',
      input: {
        jobId: WORKPLACE_POINT_PRELOAD_JOB_ID,
        trigger: 'manual',
        fromDate: '2026-06-02',
        toDate: '2026-08-02'
      }
    },
    {
      method: 'registerDashboardPreloadRequest',
      input: {
        jobId: WORKPLACE_POINT_PRELOAD_JOB_ID,
        dashboardId: 'workplace-point',
        section: 'summary',
        cacheKey: 'summary-key',
        input: { workplaceId: 'wp1' }
      }
    },
    {
      method: 'readWorkplacePointSectionRows',
      input: {
        section: 'summary',
        cacheKey: 'summary-key',
        filters: { workplaceId: 'wp1' },
        fromDate: '2026-07-01',
        toDate: '2026-07-03'
      }
    }
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
