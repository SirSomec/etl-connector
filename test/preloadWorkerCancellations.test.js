const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  WORKER_CANCELLATIONS_PRELOAD_JOB_ID,
  createPreloadStore
} = require('../src/preloadStore');
const {
  buildWorkerCancellationsPreloadQueries,
  refreshWorkerCancellationsPreload
} = require('../src/preloadWorkerCancellations');
const { scheduledRangeForJob } = require('../src/preloadScheduler');

function createTemporaryStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-cancellations-preload-'));

  return {
    directory,
    store: createPreloadStore({ filePath: path.join(directory, 'preload.sqlite') })
  };
}

test('worker cancellations preload query builder uses bounded lookups instead of a large join', () => {
  const queries = buildWorkerCancellationsPreloadQueries();

  assert.match(queries.jobs, /PREWHERE j\.start >= \{from:DateTime\}/);
  assert.match(queries.orders, /o\._id IN \{ids:Array\(String\)\}/);
  assert.match(queries.history, /PREWHERE h\.job IN \{ids:Array\(String\)\}/);
  assert.equal(queries.jobs.includes('JOIN mg_orders'), false);
  assert.equal(queries.jobs.includes('toDate(j.start)'), false);
  assert.equal(queries.jobs.includes('DROP TABLE'), false);
});

test('worker cancellations preload job is enabled daily with a 60-day past window', () => {
  const { directory, store } = createTemporaryStore();

  try {
    const job = store.getJob(WORKER_CANCELLATIONS_PRELOAD_JOB_ID);

    assert.equal(job.id, 'worker-cancellations');
    assert.equal(job.title, 'Отмены гигерами');
    assert.equal(job.enabled, true);
    assert.equal(job.scheduleTime, '04:00');
    assert.equal(job.timezone, 'Europe/Moscow');
    assert.equal(job.refreshDays, 60);
    assert.equal(job.refreshPastDays, 60);
    assert.equal(job.refreshFutureDays, 0);
  } finally {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('worker cancellations preload refreshes active workers and writes a readable SQLite range', async () => {
  const { directory, store } = createTemporaryStore();
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      const rowsByOperation = {
        'worker cancellations preload jobs': [{
        period_date: '2026-05-31',
        job_id: 'job-1',
        order_id: 'order-1',
        worker_id: 'worker-1',
        planned_start: '2026-06-01 10:00:00',
        status: 'cancelled',
        hours: 0,
        payment: 0,
        salary_per_hour: 0,
        salary_per_job: 0
      }],
        'worker cancellations preload orders': [{
          order_id: 'order-1', client_id: 'client-1', workplace_id: 'workplace-1', pieceworks: '', contract_type: '', deleted: 0, is_hidden: 0
        }],
        'worker cancellations preload clients': [{ client_id: 'client-1', title: 'Бренд' }],
        'worker cancellations preload workplaces': [{ workplace_id: 'workplace-1', contractor_id: 'contractor-1', address__city: 'Москва', address__street: 'Тверская', address__house: '1' }],
        'worker cancellations preload contractors': [{ contractor_id: 'contractor-1', contract_type: 'saas' }],
        'worker cancellations preload workers': [{ worker_id: 'worker-1', user_id: 'user-1', full_name: '', city: 'Москва' }],
        'worker cancellations preload users': [{ user_id: 'user-1', firstname: 'Иван', lastname: 'Петров', middlename: '', phone: '+79990000000' }],
        'worker cancellations preload history': [{ job_id: 'job-1', status: 'cancelled', initiator: 'worker', event_at: '2026-06-01 09:00:00' }]
      };

      if (operation === 'worker cancellations preload jobs' && params.param_from === '2026-06-02 00:00:00') {
        return [];
      }

      return rowsByOperation[operation] || [];
    }
  };

  try {
    const result = await refreshWorkerCancellationsPreload({
      client,
      store,
      fromDate: '2026-06-01',
      toDate: '2026-06-03'
    });

    assert.equal(result.rowsWritten, 1);
    assert.deepEqual(calls.map((call) => call.operation), [
      'worker cancellations preload jobs',
      'worker cancellations preload orders',
      'worker cancellations preload clients',
      'worker cancellations preload workplaces',
      'worker cancellations preload workers',
      'worker cancellations preload contractors',
      'worker cancellations preload users',
      'worker cancellations preload history',
      'worker cancellations preload jobs'
    ]);
    assert.equal(calls.some((call) => Object.hasOwn(call.params, 'param_worker_ids')), false);

    const filters = {
      from: '2026-06-01',
      to: '2026-06-02',
      pageSize: 100,
      offset: 0,
      sort: 'workerCancellations24h',
      direction: 'desc',
      client: ['Бренд'],
      city: ['Москва']
    };
    const section = store.readWorkerCancellationSectionRows({ section: 'workers', filters });
    const details = store.readWorkerCancellationDetails({
      filters,
      workerId: 'worker-1',
      metric: 'workerCancellations24h'
    });

    assert.equal(section.totalRows[0].total_workers, 1);
    assert.equal(section.workerRows[0].worker_cancellations_24h, 1);
    assert.equal(details[0].shift_id, 'job-1');
    assert.deepEqual(store.readWorkerCancellationFilterOptions(filters), [
      { filter: 'city', value: 'Москва' },
      { filter: 'client', value: 'Бренд' }
    ]);
  } finally {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('worker cancellations scheduled range keeps exactly the current 60-day window', () => {
  const range = scheduledRangeForJob(
    {
      id: WORKER_CANCELLATIONS_PRELOAD_JOB_ID,
      refreshPastDays: 60,
      refreshFutureDays: 0
    },
    new Date('2026-07-14T12:00:00.000Z')
  );

  assert.deepEqual(range, {
    fromDate: '2026-05-15',
    toDate: '2026-07-15'
  });
});
