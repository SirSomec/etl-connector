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

test('worker cancellations preload query builder resolves active workers inside parameterized SQL', () => {
  const queries = buildWorkerCancellationsPreloadQueries();

  assert.match(queries.shiftFacts, /active_workers AS/);
  assert.match(queries.shiftFacts, /active_j\.start >= \{from:DateTime\}/);
  assert.match(queries.shiftFacts, /active_j\.start < \{to:DateTime\}/);
  assert.match(queries.shiftFacts, /INNER JOIN active_workers AS aw ON j\.worker = aw\.worker_id/);
  assert.equal(queries.shiftFacts.includes('worker_ids:Array(String)'), false);
  assert.match(queries.shiftFacts, /INNER JOIN mg_orders AS o ON o\._id = j\.source/);
  assert.match(queries.shiftFacts, /mg_job_history/);
  assert.match(queries.shiftFacts, /is_worker_cancelled_24h/);
  assert.equal(queries.shiftFacts.includes('DROP TABLE'), false);
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

      return [{
        period_date: '2026-06-01',
        job_id: 'job-1',
        worker_id: 'worker-1',
        user_id: 'user-1',
        full_name: 'Иван Петров',
        phone: '+79990000000',
        city: 'Москва',
        client: 'Бренд',
        order_city: 'Москва',
        address: 'Москва, Тверская, 1',
        planned_start: '2026-06-01 10:00:00',
        status: 'cancelled',
        is_successful_confirmed_shift: 0,
        is_worker_cancelled: 1,
        is_worker_cancelled_24h: 1,
        is_post_start_cancelled: 0,
        booked_at: '2026-05-30 10:00:00',
        cancelled_at: '2026-06-01 09:00:00',
        cancelled_by: 'worker'
      }];
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
    assert.deepEqual(calls.map((call) => call.operation), ['worker cancellations preload shift facts']);
    assert.equal(Object.hasOwn(calls[0].params, 'param_worker_ids'), false);

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
