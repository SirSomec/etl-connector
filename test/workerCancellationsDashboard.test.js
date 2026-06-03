const test = require('node:test');
const assert = require('node:assert/strict');

const {
  WORKER_CANCELLATIONS_SECTIONS,
  loadWorkerCancellationsDashboardSection,
  loadWorkerCancellationsDashboardShell,
  mergeWorkerCancellationRows,
  normalizeWorkerCancellationFilters
} = require('../src/workerCancellationsDashboard');

const { createDashboardSectionCache } = require('../src/dashboardSectionCache');

function createDashboardClient(rowsByOperation = {}) {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      return rowsByOperation[operation] || [];
    }
  };

  return { calls, client };
}

test('WORKER_CANCELLATIONS_SECTIONS contains only workers', () => {
  assert.deepEqual(Array.from(WORKER_CANCELLATIONS_SECTIONS), ['workers']);
});

test('normalizeWorkerCancellationFilters defaults and whitelists range, paging, sort, and direction', () => {
  const filters = normalizeWorkerCancellationFilters(
    {
      from: '2026-05-01',
      to: '2026-05-31',
      page: '2',
      pageSize: '200',
      sort: 'fullName',
      direction: 'asc'
    },
    new Date('2026-06-03T12:00:00.000Z')
  );

  assert.deepEqual(filters, {
    from: '2026-05-01',
    to: '2026-05-31',
    fromDateTime: '2026-05-01 00:00:00',
    toExclusiveDateTime: '2026-06-01 00:00:00',
    page: 2,
    pageSize: 200,
    offset: 200,
    sort: 'fullName',
    direction: 'asc'
  });
});

test('normalizeWorkerCancellationFilters falls back from invalid values to current month defaults', () => {
  const filters = normalizeWorkerCancellationFilters(
    {
      from: '2026-99-99',
      to: 'not-a-date',
      page: '-3',
      pageSize: '999',
      sort: 'workerCancellations24h; DROP TABLE mg_jobs',
      direction: 'sideways'
    },
    new Date('2026-06-03T12:00:00.000Z')
  );

  assert.deepEqual(filters, {
    from: '2026-06-01',
    to: '2026-06-03',
    fromDateTime: '2026-06-01 00:00:00',
    toExclusiveDateTime: '2026-06-04 00:00:00',
    page: 1,
    pageSize: 100,
    offset: 0,
    sort: 'workerCancellations24h',
    direction: 'desc'
  });
});

test('normalizeWorkerCancellationFilters rejects pages above the maximum guard', () => {
  const filters = normalizeWorkerCancellationFilters(
    {
      from: '2026-05-01',
      to: '2026-05-31',
      page: '100001',
      pageSize: '50'
    },
    new Date('2026-06-03T12:00:00.000Z')
  );

  assert.equal(filters.page, 1);
  assert.equal(filters.offset, 0);
});

test('mergeWorkerCancellationRows maps ClickHouse rows to camelCase model and pagination', () => {
  const filters = normalizeWorkerCancellationFilters(
    {
      from: '2026-06-01',
      to: '2026-06-03',
      page: '2',
      pageSize: '50'
    },
    new Date('2026-06-03T12:00:00.000Z')
  );

  const dashboard = mergeWorkerCancellationRows(filters, [
    {
      worker_id: 'worker-1',
      full_name: '  Ivan Petrov  ',
      phone: '+79990000000',
      city: 'Moscow',
      confirmed_shifts: '10',
      worker_cancellations: '4',
      worker_cancellations_24h: '3',
      post_start_cancellations: '2',
      failed_shifts: '1'
    },
    {
      worker_id: 'worker-2',
      full_name: '',
      phone: null,
      city: null,
      confirmed_shifts: 'not-a-number',
      worker_cancellations: '',
      worker_cancellations_24h: null,
      post_start_cancellations: undefined,
      failed_shifts: '5'
    }
  ], [{ total_workers: '125' }]);

  assert.deepEqual(dashboard.workers, [
    {
      workerId: 'worker-1',
      fullName: 'Ivan Petrov',
      phone: '+79990000000',
      city: 'Moscow',
      confirmedShifts: 10,
      workerCancellations: 4,
      workerCancellations24h: 3,
      postStartCancellations: 2,
      failedShifts: 1
    },
    {
      workerId: 'worker-2',
      fullName: 'worker-2',
      phone: '',
      city: '',
      confirmedShifts: 0,
      workerCancellations: 0,
      workerCancellations24h: 0,
      postStartCancellations: 0,
      failedShifts: 5
    }
  ]);
  assert.deepEqual(dashboard.pagination, {
    page: 2,
    pageSize: 50,
    totalWorkers: 125,
    totalPages: 3,
    hasPrevious: true,
    hasNext: true
  });
});

test('loadWorkerCancellationsDashboardShell returns empty dashboard without ClickHouse queries', async () => {
  const { calls, client } = createDashboardClient();

  const dashboard = await loadWorkerCancellationsDashboardShell(
    client,
    {
      from: '2026-05-01',
      to: '2026-05-31',
      page: '3'
    },
    new Date('2026-06-03T12:00:00.000Z')
  );

  assert.equal(calls.length, 0);
  assert.equal(dashboard.filters.from, '2026-05-01');
  assert.equal(dashboard.filters.to, '2026-05-31');
  assert.deepEqual(dashboard.workers, []);
  assert.deepEqual(dashboard.pagination, {
    page: 3,
    pageSize: 100,
    totalWorkers: 0,
    totalPages: 1,
    hasPrevious: true,
    hasNext: false
  });
});

test('loadWorkerCancellationsDashboardSection queries workers with safe params and SQL semantics', async () => {
  const { calls, client } = createDashboardClient({
    'worker cancellations total workers': [{ total_workers: '101' }],
    'worker cancellations workers': [
      {
        worker_id: 'worker-1',
        full_name: 'Ivan Petrov',
        phone: '+79990000000',
        city: 'Moscow',
        confirmed_shifts: '10',
        worker_cancellations: '4',
        worker_cancellations_24h: '3',
        post_start_cancellations: '2',
        failed_shifts: '1'
      }
    ]
  });

  const dashboard = await loadWorkerCancellationsDashboardSection(
    client,
    {
      from: '2026-05-01',
      to: '2026-05-31',
      page: '2',
      pageSize: '50',
      sort: 'fullName',
      direction: 'asc'
    },
    'workers',
    new Date('2026-06-03T12:00:00.000Z')
  );

  assert.equal(dashboard.workers.length, 1);
  assert.deepEqual(calls.map((call) => call.operation), [
    'worker cancellations total workers',
    'worker cancellations workers'
  ]);

  const totalCall = calls[0];
  const workersCall = calls[1];

  for (const call of calls) {
    assert.equal(call.params.param_from, '2026-05-01 00:00:00');
    assert.equal(call.params.param_to, '2026-06-01 00:00:00');
    assert.equal(call.query.includes('FROM mg_jobs AS j'), true);
    assert.equal(call.query.includes('j.start >= {from:DateTime}'), true);
    assert.equal(call.query.includes('j.start < {to:DateTime}'), true);
    assert.equal(call.query.includes("ifNull(j.worker, '') != ''"), true);
    assert.equal(call.query.includes('ifNull(j.deleted, 0) = 0'), true);
    assert.equal(call.query.includes('DROP TABLE'), false);
  }

  assert.equal(totalCall.query.includes('mg_job_history'), false);
  assert.equal(totalCall.query.includes('LEFT JOIN mg_workers AS w'), false);
  assert.equal(totalCall.query.includes('LEFT JOIN mg_users AS u'), false);
  assert.equal(totalCall.query.includes('ORDER BY'), false);
  assert.equal(totalCall.query.includes('LIMIT'), false);
  assert.equal(totalCall.query.includes('OFFSET'), false);
  assert.equal(totalCall.query.includes('GROUP BY worker_id'), true);

  assert.equal(workersCall.params.param_limit, 50);
  assert.equal(workersCall.params.param_offset, 50);
  assert.equal(workersCall.query.includes('mg_job_history'), true);
  assert.equal(workersCall.query.includes("h.initiator = 'worker'"), true);
  assert.equal(workersCall.query.includes("h.status = 'cancelled'"), true);
  assert.equal(workersCall.query.includes('coalesce(h.createdAt, h.updatedAt) AS event_at'), true);
  assert.equal(workersCall.query.includes('is_worker_cancelled'), true);
  assert.equal(workersCall.query.includes('is_worker_cancelled_24h'), true);
  assert.equal(workersCall.query.includes('is_post_start_cancelled'), true);
  assert.equal(workersCall.query.includes('event_at >= sf.start'), true);
  assert.equal(workersCall.query.includes('event_at < sf.start'), true);
  assert.equal(workersCall.query.includes('INTERVAL 24 HOUR'), true);
  assert.equal(workersCall.query.includes("status = 'failed'"), true);
  assert.equal(workersCall.query.includes('LEFT JOIN cancellation_flags AS cf ON cf.job = sf.job'), true);
  assert.equal(workersCall.query.includes('LEFT JOIN worker_cancel_events AS worker_event'), false);
  assert.equal(workersCall.query.includes('LEFT JOIN cancel_events AS cancel_event'), false);
  assert.equal(workersCall.query.includes('LEFT JOIN mg_workers AS w'), true);
  assert.equal(workersCall.query.includes('LEFT JOIN mg_users AS u'), true);
  assert.equal(workersCall.query.includes('w.full_address__city'), true);
  assert.equal(workersCall.query.includes('ORDER BY full_name ASC, worker_id ASC'), true);
  assert.equal(workersCall.query.includes('ORDER BY fullName'), false);
  assert.equal(workersCall.query.includes('LIMIT {limit:UInt64} OFFSET {offset:UInt64}'), true);
});

test('loadWorkerCancellationsDashboardSection rejects unknown section', async () => {
  const { client } = createDashboardClient();

  await assert.rejects(
    () => loadWorkerCancellationsDashboardSection(
      client,
      {},
      'summary',
      new Date('2026-06-03T12:00:00.000Z')
    ),
    {
      message: /Unknown worker cancellations section: summary/,
      status: 400
    }
  );
});

test('loadWorkerCancellationsDashboardSection caches workers through createDashboardSectionCache', async () => {
  let timestamp = Date.parse('2026-06-03T12:00:00.000Z');
  const { calls, client } = createDashboardClient({
    'worker cancellations total workers': [{ total_workers: '1' }],
    'worker cancellations workers': [{ worker_id: 'worker-1', full_name: 'Ivan Petrov' }]
  });
  const cache = createDashboardSectionCache({ now: () => timestamp });
  const input = {
    from: '2026-05-01',
    to: '2026-05-31',
    page: '1',
    pageSize: '100',
    sort: 'workerCancellations24h',
    direction: 'desc'
  };

  const first = await loadWorkerCancellationsDashboardSection(
    client,
    input,
    'workers',
    new Date('2026-06-03T12:00:00.000Z'),
    { cache }
  );
  const second = await loadWorkerCancellationsDashboardSection(
    client,
    input,
    'workers',
    new Date('2026-06-03T12:00:00.000Z'),
    { cache }
  );

  assert.equal(first.workers[0].workerId, 'worker-1');
  assert.equal(second.workers[0].workerId, 'worker-1');
  assert.deepEqual(calls.map((call) => call.operation), [
    'worker cancellations total workers',
    'worker cancellations workers'
  ]);

  await loadWorkerCancellationsDashboardSection(
    client,
    {
      ...input,
      direction: 'asc'
    },
    'workers',
    new Date('2026-06-03T12:00:00.000Z'),
    { cache }
  );

  assert.deepEqual(calls.map((call) => call.operation), [
    'worker cancellations total workers',
    'worker cancellations workers',
    'worker cancellations total workers',
    'worker cancellations workers'
  ]);

  timestamp += 10 * 60 * 60 * 1000 + 1;

  await loadWorkerCancellationsDashboardSection(
    client,
    input,
    'workers',
    new Date('2026-06-03T12:00:00.000Z'),
    { cache }
  );

  assert.deepEqual(calls.map((call) => call.operation), [
    'worker cancellations total workers',
    'worker cancellations workers',
    'worker cancellations total workers',
    'worker cancellations workers',
    'worker cancellations total workers',
    'worker cancellations workers'
  ]);
});
