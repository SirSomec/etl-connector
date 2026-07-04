const test = require('node:test');
const assert = require('node:assert/strict');

const {
  WORKER_CANCELLATION_DETAIL_METRICS,
  WORKER_CANCELLATIONS_SECTIONS,
  loadWorkerCancellationsDashboardSection,
  loadWorkerCancellationsDetails,
  loadWorkerCancellationsDashboardShell,
  mergeWorkerCancellationDetails,
  mergeWorkerCancellationRows,
  normalizeWorkerCancellationDetailInput,
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

test('WORKER_CANCELLATION_DETAIL_METRICS exposes numeric metrics only', () => {
  assert.deepEqual(Object.keys(WORKER_CANCELLATION_DETAIL_METRICS), [
    'confirmedShifts',
    'workerCancellations',
    'workerCancellations24h',
    'postStartCancellations',
    'failedShifts'
  ]);
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
    direction: 'asc',
    client: [],
    city: []
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
    direction: 'desc',
    client: [],
    city: []
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

test('normalizeWorkerCancellationFilters keeps search and valid numeric ranges only', () => {
  const filters = normalizeWorkerCancellationFilters(
    {
      from: '2026-05-01',
      to: '2026-05-31',
      search: ' user-123 ',
      confirmedShiftsFrom: '2',
      confirmedShiftsTo: '10',
      workerCancellationsFrom: 'bad',
      workerCancellationsTo: '5',
      failedShiftsFrom: '-1',
      failedShiftsTo: '0'
    },
    new Date('2026-06-03T12:00:00.000Z')
  );

  assert.equal(filters.search, 'user-123');
  assert.equal(filters.confirmedShiftsFrom, 2);
  assert.equal(filters.confirmedShiftsTo, 10);
  assert.equal(filters.workerCancellationsFrom, undefined);
  assert.equal(filters.workerCancellationsTo, 5);
  assert.equal(filters.failedShiftsFrom, undefined);
  assert.equal(filters.failedShiftsTo, 0);
});

test('normalizeWorkerCancellationFilters keeps unique client and city filters', () => {
  const filters = normalizeWorkerCancellationFilters(
    {
      from: '2026-05-01',
      to: '2026-05-31',
      client: [' Brand A ', 'Brand A', '', 'Brand B'],
      city: [' Moscow ', 'Moscow', '', 'Kazan']
    },
    new Date('2026-06-03T12:00:00.000Z')
  );

  assert.deepEqual(filters.client, ['Brand A', 'Brand B']);
  assert.deepEqual(filters.city, ['Moscow', 'Kazan']);
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
      phone: '+79990000000.0',
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
      phone: 79990000001,
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
      failedShifts: 1,
      riskReasons: [
        { kind: 'worker-cancellations-24h', label: '3 отмены менее чем за 24ч' },
        { kind: 'post-start-cancellations', label: '2 отмены после старта' },
        { kind: 'failed-shifts', label: '1 failed-смена' }
      ],
      riskSeverity: 'high'
    },
    {
      workerId: 'worker-2',
      fullName: 'worker-2',
      phone: '79990000001',
      city: '',
      confirmedShifts: 0,
      workerCancellations: 0,
      workerCancellations24h: 0,
      postStartCancellations: 0,
      failedShifts: 5,
      riskReasons: [
        { kind: 'failed-shifts', label: '5 failed-смен' }
      ],
      riskSeverity: 'high'
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

test('mergeWorkerCancellationRows assigns high risk for urgent worker cancellations', () => {
  const filters = normalizeWorkerCancellationFilters(
    {
      from: '2026-06-01',
      to: '2026-06-03'
    },
    new Date('2026-06-03T12:00:00.000Z')
  );

  const dashboard = mergeWorkerCancellationRows(filters, [
    {
      worker_id: 'worker-1',
      full_name: 'Ivan Petrov',
      worker_cancellations: '3',
      worker_cancellations_24h: '3',
      post_start_cancellations: '1',
      failed_shifts: '0'
    }
  ], [{ total_workers: '1' }]);

  assert.equal(dashboard.workers[0].riskSeverity, 'high');
  assert.deepEqual(dashboard.workers[0].riskReasons.slice(0, 2), [
    { kind: 'worker-cancellations-24h', label: '3 отмены менее чем за 24ч' },
    { kind: 'post-start-cancellations', label: '1 отмена после старта' }
  ]);
});

test('mergeWorkerCancellationRows assigns medium risk for worker cancellations within 24h', () => {
  const filters = normalizeWorkerCancellationFilters(
    {
      from: '2026-06-01',
      to: '2026-06-03'
    },
    new Date('2026-06-03T12:00:00.000Z')
  );

  const dashboard = mergeWorkerCancellationRows(filters, [
    {
      worker_id: 'worker-1',
      full_name: 'Ivan Petrov',
      worker_cancellations: '1',
      worker_cancellations_24h: '1',
      post_start_cancellations: '0',
      failed_shifts: '0'
    }
  ], [{ total_workers: '1' }]);

  assert.equal(dashboard.workers[0].riskSeverity, 'medium');
  assert.deepEqual(dashboard.workers[0].riskReasons, [
    { kind: 'worker-cancellations-24h', label: '1 отмена менее чем за 24ч' }
  ]);
});

test('mergeWorkerCancellationRows assigns medium risk for fewer than three failed shifts', () => {
  const filters = normalizeWorkerCancellationFilters(
    {
      from: '2026-06-01',
      to: '2026-06-03'
    },
    new Date('2026-06-03T12:00:00.000Z')
  );

  const dashboard = mergeWorkerCancellationRows(filters, [
    {
      worker_id: 'worker-1',
      full_name: 'Ivan Petrov',
      worker_cancellations: '0',
      worker_cancellations_24h: '0',
      post_start_cancellations: '0',
      failed_shifts: '2'
    }
  ], [{ total_workers: '1' }]);

  assert.equal(dashboard.workers[0].riskSeverity, 'medium');
  assert.deepEqual(dashboard.workers[0].riskReasons, [
    { kind: 'failed-shifts', label: '2 failed-смены' }
  ]);
});

test('mergeWorkerCancellationRows uses Russian plural forms in risk reasons', () => {
  const filters = normalizeWorkerCancellationFilters(
    {
      from: '2026-06-01',
      to: '2026-06-03'
    },
    new Date('2026-06-03T12:00:00.000Z')
  );

  const dashboard = mergeWorkerCancellationRows(filters, [
    {
      worker_id: 'worker-24h-1',
      worker_cancellations: '1',
      worker_cancellations_24h: '1',
      post_start_cancellations: '0',
      failed_shifts: '0'
    },
    {
      worker_id: 'worker-24h-2',
      worker_cancellations: '2',
      worker_cancellations_24h: '2',
      post_start_cancellations: '0',
      failed_shifts: '0'
    },
    {
      worker_id: 'worker-24h-5',
      worker_cancellations: '5',
      worker_cancellations_24h: '5',
      post_start_cancellations: '0',
      failed_shifts: '0'
    },
    {
      worker_id: 'worker-post-start-1',
      worker_cancellations: '1',
      worker_cancellations_24h: '0',
      post_start_cancellations: '1',
      failed_shifts: '0'
    },
    {
      worker_id: 'worker-post-start-2',
      worker_cancellations: '2',
      worker_cancellations_24h: '0',
      post_start_cancellations: '2',
      failed_shifts: '0'
    },
    {
      worker_id: 'worker-post-start-5',
      worker_cancellations: '5',
      worker_cancellations_24h: '0',
      post_start_cancellations: '5',
      failed_shifts: '0'
    },
    {
      worker_id: 'worker-failed-1',
      worker_cancellations: '0',
      worker_cancellations_24h: '0',
      post_start_cancellations: '0',
      failed_shifts: '1'
    },
    {
      worker_id: 'worker-failed-2',
      worker_cancellations: '0',
      worker_cancellations_24h: '0',
      post_start_cancellations: '0',
      failed_shifts: '2'
    },
    {
      worker_id: 'worker-failed-5',
      worker_cancellations: '0',
      worker_cancellations_24h: '0',
      post_start_cancellations: '0',
      failed_shifts: '5'
    }
  ], [{ total_workers: '9' }]);

  assert.deepEqual(dashboard.workers.map((worker) => worker.riskReasons[0].label), [
    '1 отмена менее чем за 24ч',
    '2 отмены менее чем за 24ч',
    '5 отмен менее чем за 24ч',
    '1 отмена после старта',
    '2 отмены после старта',
    '5 отмен после старта',
    '1 failed-смена',
    '2 failed-смены',
    '5 failed-смен'
  ]);
});

test('mergeWorkerCancellationRows assigns medium risk for repeated worker cancellations without urgent reasons', () => {
  const filters = normalizeWorkerCancellationFilters(
    {
      from: '2026-06-01',
      to: '2026-06-03'
    },
    new Date('2026-06-03T12:00:00.000Z')
  );

  const dashboard = mergeWorkerCancellationRows(filters, [
    {
      worker_id: 'worker-1',
      full_name: 'Ivan Petrov',
      worker_cancellations: '2',
      worker_cancellations_24h: '0',
      post_start_cancellations: '0',
      failed_shifts: '0'
    }
  ], [{ total_workers: '1' }]);

  assert.equal(dashboard.workers[0].riskSeverity, 'medium');
  assert.deepEqual(dashboard.workers[0].riskReasons, []);
});

test('mergeWorkerCancellationRows assigns low risk with no attention reasons by default', () => {
  const filters = normalizeWorkerCancellationFilters(
    {
      from: '2026-06-01',
      to: '2026-06-03'
    },
    new Date('2026-06-03T12:00:00.000Z')
  );

  const dashboard = mergeWorkerCancellationRows(filters, [
    {
      worker_id: 'worker-1',
      full_name: 'Ivan Petrov',
      worker_cancellations: '1',
      worker_cancellations_24h: '0',
      post_start_cancellations: '0',
      failed_shifts: '0'
    }
  ], [{ total_workers: '1' }]);

  assert.equal(dashboard.workers[0].riskSeverity, 'low');
  assert.deepEqual(dashboard.workers[0].riskReasons, []);
});

test('normalizeWorkerCancellationDetailInput accepts worker id and whitelisted metric', () => {
  const detailInput = normalizeWorkerCancellationDetailInput(
    {
      from: '2026-05-01',
      to: '2026-05-31',
      workerId: ' worker-1 ',
      metric: 'workerCancellations'
    },
    new Date('2026-06-03T12:00:00.000Z')
  );

  assert.equal(detailInput.workerId, 'worker-1');
  assert.equal(detailInput.metric, 'workerCancellations');
  assert.equal(detailInput.metricLabel, 'Отмены worker');
  assert.equal(detailInput.filters.fromDateTime, '2026-05-01 00:00:00');
  assert.equal(detailInput.filters.toExclusiveDateTime, '2026-06-01 00:00:00');
});

test('normalizeWorkerCancellationDetailInput rejects missing worker and unknown metric', () => {
  assert.throws(
    () => normalizeWorkerCancellationDetailInput(
      {
        workerId: '',
        metric: 'workerCancellations'
      },
      new Date('2026-06-03T12:00:00.000Z')
    ),
    {
      message: /Worker id is required/,
      status: 400
    }
  );

  assert.throws(
    () => normalizeWorkerCancellationDetailInput(
      {
        workerId: 'worker-1',
        metric: 'workerCancellations; DROP TABLE mg_jobs'
      },
      new Date('2026-06-03T12:00:00.000Z')
    ),
    {
      message: /Unknown worker cancellation metric/,
      status: 400
    }
  );
});

test('mergeWorkerCancellationDetails maps detail rows to popup model', () => {
  const detailInput = normalizeWorkerCancellationDetailInput(
    {
      from: '2026-05-01',
      to: '2026-05-31',
      workerId: 'worker-1',
      metric: 'workerCancellations'
    },
    new Date('2026-06-03T12:00:00.000Z')
  );

  const details = mergeWorkerCancellationDetails(detailInput, [
    {
      shift_id: 'job-1',
      brand: 'Brand A',
      address: 'Moscow, Lenina, 10',
      planned_start: '2026-05-12 09:00:00',
      booked_at: '2026-05-10 15:30:00',
      cancelled_at: '2026-05-11 18:00:00',
      cancelled_by: 'worker'
    },
    {
      shift_id: 'job-2',
      brand: null,
      address: null,
      planned_start: null,
      booked_at: null,
      cancelled_at: null,
      cancelled_by: null
    }
  ]);

  assert.equal(details.workerId, 'worker-1');
  assert.equal(details.metric, 'workerCancellations');
  assert.equal(details.metricLabel, 'Отмены worker');
  assert.equal(details.limit, 500);
  assert.deepEqual(details.shifts, [
    {
      shiftId: 'job-1',
      brand: 'Brand A',
      address: 'Moscow, Lenina, 10',
      plannedStart: '2026-05-12 09:00:00',
      bookedAt: '2026-05-10 15:30:00',
      cancelledAt: '2026-05-11 18:00:00',
      cancelledBy: 'worker'
    },
    {
      shiftId: 'job-2',
      brand: '',
      address: '',
      plannedStart: '',
      bookedAt: '',
      cancelledAt: '',
      cancelledBy: ''
    }
  ]);
});

test('loadWorkerCancellationsDashboardShell returns empty dashboard with brand and city filter options', async () => {
  const { calls, client } = createDashboardClient({
    'worker cancellations filter options': [
      { filter: 'client', value: 'Brand A' },
      { filter: 'city', value: 'Moscow' }
    ]
  });

  const dashboard = await loadWorkerCancellationsDashboardShell(
    client,
    {
      from: '2026-05-01',
      to: '2026-05-31',
      page: '3',
      client: ['Brand A'],
      city: ['Moscow']
    },
    new Date('2026-06-03T12:00:00.000Z')
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].operation, 'worker cancellations filter options');
  assert.equal(calls[0].params.param_from, '2026-05-01 00:00:00');
  assert.equal(calls[0].params.param_to, '2026-06-01 00:00:00');
  assert.equal(calls[0].query.includes('INNER JOIN mg_clients AS c ON c._id = o.client'), true);
  assert.equal((calls[0].query.match(/FROM mg_jobs AS j/g) || []).length, 1);
  assert.equal(calls[0].query.includes('ARRAY JOIN'), true);
  assert.equal(calls[0].query.includes('UNION ALL'), false);
  assert.equal(dashboard.filters.from, '2026-05-01');
  assert.equal(dashboard.filters.to, '2026-05-31');
  assert.deepEqual(dashboard.filters.client, ['Brand A']);
  assert.deepEqual(dashboard.filters.city, ['Moscow']);
  assert.deepEqual(dashboard.filterOptions.client, ['Brand A']);
  assert.deepEqual(dashboard.filterOptions.city, ['Moscow']);
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

test('loadWorkerCancellationsDashboardShell caches filter options by normalized period', async () => {
  let timestamp = Date.parse('2026-06-03T12:00:00.000Z');
  const { calls, client } = createDashboardClient({
    'worker cancellations filter options': [
      { filter: 'client', value: 'Brand A' },
      { filter: 'city', value: 'Moscow' }
    ]
  });
  const cache = createDashboardSectionCache({ now: () => timestamp });
  const input = {
    from: '2026-05-01',
    to: '2026-05-31'
  };

  const first = await loadWorkerCancellationsDashboardShell(
    client,
    input,
    new Date('2026-06-03T12:00:00.000Z'),
    { cache }
  );
  const second = await loadWorkerCancellationsDashboardShell(
    client,
    input,
    new Date('2026-06-03T12:00:00.000Z'),
    { cache }
  );

  assert.deepEqual(first.filterOptions.client, ['Brand A']);
  assert.deepEqual(second.filterOptions.city, ['Moscow']);
  assert.deepEqual(calls.map((call) => call.operation), [
    'worker cancellations filter options'
  ]);

  timestamp = Date.parse('2026-06-04T00:00:00.000Z');

  await loadWorkerCancellationsDashboardShell(
    client,
    input,
    new Date('2026-06-03T12:00:00.000Z'),
    { cache }
  );

  assert.deepEqual(calls.map((call) => call.operation), [
    'worker cancellations filter options',
    'worker cancellations filter options'
  ]);
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
  assert.equal(workersCall.query.includes('AS worker_cancellations'), true);
  assert.equal(workersCall.query.includes('AS worker_cancellations_24h'), true);
  assert.equal(workersCall.query.includes('AS post_start_cancellations'), true);
  assert.equal(workersCall.query.includes('event_at >= ce.start'), true);
  assert.equal(workersCall.query.includes('event_at < ce.start'), true);
  assert.equal(workersCall.query.includes('INTERVAL 24 HOUR'), true);
  assert.equal(workersCall.query.includes("status = 'failed'"), true);
  assert.equal(workersCall.query.includes('LEFT JOIN cancellation_flags AS cf ON cf.job = sf.job'), false);
  assert.equal(workersCall.query.includes('AS is_successful_confirmed_shift'), true);
  assert.equal(workersCall.query.includes('uniqExactIf(sf.job, is_successful_confirmed_shift = 1) AS confirmed_shifts'), true);
  assert.equal(workersCall.query.includes('LEFT JOIN worker_cancel_events AS worker_event'), false);
  assert.equal(workersCall.query.includes('LEFT JOIN cancel_events AS cancel_event'), false);
  assert.equal(workersCall.query.includes('LEFT JOIN mg_workers AS w'), true);
  assert.equal(workersCall.query.includes('LEFT JOIN mg_users AS u'), true);
  assert.equal(workersCall.query.includes('w.full_address__city'), true);
  assert.equal(workersCall.query.includes('ORDER BY full_name ASC, worker_id ASC'), true);
  assert.equal(workersCall.query.includes('ORDER BY fullName'), false);
  assert.equal(workersCall.query.includes('LIMIT {limit:UInt64} OFFSET {offset:UInt64}'), true);
});

test('loadWorkerCancellationsDashboardSection filters workers by selected brands and cities', async () => {
  const { calls, client } = createDashboardClient({
    'worker cancellations total workers': [{ total_workers: '1' }],
    'worker cancellations workers': [{ worker_id: 'worker-1', full_name: 'Ivan Petrov' }]
  });

  const dashboard = await loadWorkerCancellationsDashboardSection(
    client,
    {
      from: '2026-05-01',
      to: '2026-05-31',
      client: ['Brand A', 'Brand B'],
      city: ['Moscow', 'Kazan']
    },
    'workers',
    new Date('2026-06-03T12:00:00.000Z')
  );

  assert.deepEqual(dashboard.filters.client, ['Brand A', 'Brand B']);
  assert.deepEqual(dashboard.filters.city, ['Moscow', 'Kazan']);

  for (const call of calls) {
    assert.equal(call.params.param_clients, "['Brand A','Brand B']");
    assert.equal(call.params.param_cities, "['Moscow','Kazan']");
    assert.equal(call.query.includes('c.title IN {clients:Array(String)}'), true);
    assert.equal(call.query.includes('ow.address__city IN {cities:Array(String)}'), true);
  }
});

test('loadWorkerCancellationsDashboardSection constrains cancellation metrics to actual orders', async () => {
  const { calls, client } = createDashboardClient({
    'worker cancellations total workers': [{ total_workers: '0' }],
    'worker cancellations workers': []
  });

  await loadWorkerCancellationsDashboardSection(
    client,
    {
      from: '2026-05-01',
      to: '2026-05-31'
    },
    'workers',
    new Date('2026-06-03T12:00:00.000Z')
  );

  const totalCall = calls.find((call) => call.operation === 'worker cancellations total workers');
  const workersCall = calls.find((call) => call.operation === 'worker cancellations workers');

  for (const call of [totalCall, workersCall]) {
    assert.equal(call.query.includes('INNER JOIN mg_orders AS o ON o._id = j.source'), true);
    assert.equal(call.query.includes('INNER JOIN mg_clients AS c ON c._id = o.client'), true);
    assert.equal(call.query.includes('LEFT JOIN mg_workplaces AS ow ON ow._id = o.workplace'), true);
    assert.equal(call.query.includes('LEFT JOIN mg_contractors AS ct ON ct._id = ow.contractor'), true);
    assert.equal(call.query.includes('o.deleted = 0'), true);
    assert.equal(call.query.includes('ifNull(o.is_hidden, false) = false'), true);
    assert.equal(call.query.includes('c.title IS NULL OR c.title NOT IN'), true);
    assert.equal(call.query.includes("ifNull(ct.contract_type, ifNull(o.contract_type, '')) != 'processing'"), true);
  }

  assert.equal(workersCall.query.includes('toString(o.pieceworks)'), true);
  assert.equal(workersCall.query.includes('j.piecework'), false);
});

test('loadWorkerCancellationsDashboardSection limits cancellation history joins to cancelled shifts', async () => {
  const { calls, client } = createDashboardClient({
    'worker cancellations total workers': [{ total_workers: '0' }],
    'worker cancellations workers': []
  });

  await loadWorkerCancellationsDashboardSection(
    client,
    {
      from: '2026-05-01',
      to: '2026-05-31'
    },
    'workers',
    new Date('2026-06-03T12:00:00.000Z')
  );

  const workersCall = calls.find((call) => call.operation === 'worker cancellations workers');

  assert.equal(workersCall.query.includes('cancelled_shift_facts AS'), true);
  assert.equal(workersCall.query.includes("WHERE status = 'cancelled'"), true);
  assert.equal(
    workersCall.query.includes('INNER JOIN cancelled_shift_facts AS csf ON h.job = csf.job'),
    true
  );
  assert.equal(workersCall.query.includes('FROM shift_facts AS sf\n    LEFT JOIN cancellation_events AS ce'), false);
});

test('loadWorkerCancellationsDashboardSection aggregates cancellation metrics by worker before final join', async () => {
  const { calls, client } = createDashboardClient({
    'worker cancellations total workers': [{ total_workers: '0' }],
    'worker cancellations workers': []
  });

  await loadWorkerCancellationsDashboardSection(
    client,
    {
      from: '2026-05-01',
      to: '2026-05-31'
    },
    'workers',
    new Date('2026-06-03T12:00:00.000Z')
  );

  const workersCall = calls.find((call) => call.operation === 'worker cancellations workers');

  assert.equal(workersCall.query.includes('base_worker_metrics AS'), true);
  assert.equal(workersCall.query.includes('cancellation_worker_metrics AS'), true);
  assert.equal(workersCall.query.includes('LEFT JOIN cancellation_worker_metrics AS cwm'), true);
  assert.equal(workersCall.query.includes('LEFT JOIN cancellation_flags AS cf ON cf.job = sf.job'), false);
});

test('loadWorkerCancellationsDashboardSection filters search and numeric ranges before pagination', async () => {
  const searchCandidates = Array.from({ length: 51 }, (_, index) => ({
    worker_id: `worker-${index + 1}`
  }));
  const { calls, client } = createDashboardClient({
    'worker cancellations search candidates': searchCandidates,
    'worker cancellations total workers': [{ total_workers: '7' }],
    'worker cancellations workers': [
      {
        worker_id: 'worker-1',
        user_id: 'user-1',
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
      search: 'user-1',
      confirmedShiftsFrom: '5',
      workerCancellationsTo: '4',
      failedShiftsFrom: '1',
      pageSize: '50',
      sort: 'workerCancellations',
      direction: 'desc'
    },
    'workers',
    new Date('2026-06-03T12:00:00.000Z')
  );

  assert.equal(dashboard.filters.search, 'user-1');
  assert.equal(dashboard.filters.confirmedShiftsFrom, 5);
  assert.equal(dashboard.filters.workerCancellationsTo, 4);
  assert.equal(dashboard.filters.failedShiftsFrom, 1);
  assert.deepEqual(calls.map((call) => call.operation), [
    'worker cancellations search candidates',
    'worker cancellations total workers',
    'worker cancellations workers'
  ]);

  assert.equal(calls[0].params.param_search, 'user-1');
  assert.equal(calls[0].query.includes('FROM mg_workers AS w'), true);

  for (const call of calls.slice(1)) {
    assert.equal(call.params.param_search, 'user-1');
    assert.match(call.params.param_search_worker_ids, /^\['worker-1','worker-2'/);
    assert.equal(call.params.param_confirmed_shifts_from, 5);
    assert.equal(call.params.param_worker_cancellations_to, 4);
    assert.equal(call.params.param_failed_shifts_from, 1);
    assert.equal(call.query.includes('positionCaseInsensitive'), true);
    assert.equal(call.query.includes('PREWHERE worker IN {search_worker_ids:Array(String)}'), true);
    assert.equal(call.query.includes('wm.worker_id'), true);
    assert.equal(call.query.includes('w.user'), true);
    assert.equal(call.query.includes('u.phone'), true);
    assert.equal(call.query.includes('w.full_address__city'), true);
    assert.equal(call.query.includes('wm.confirmed_shifts >= {confirmed_shifts_from:Float64}'), true);
    assert.equal(call.query.includes('wm.worker_cancellations <= {worker_cancellations_to:Float64}'), true);
    assert.equal(call.query.includes('wm.failed_shifts >= {failed_shifts_from:Float64}'), true);
    assert.equal(call.query.includes('DROP TABLE'), false);
  }

  const totalCall = calls[1];
  const workersCall = calls[2];
  assert.equal(totalCall.query.includes('SELECT count() AS total_workers'), true);
  assert.equal(totalCall.query.includes('ORDER BY'), false);
  assert.equal(totalCall.query.includes('LIMIT'), false);
  assert.equal(workersCall.query.includes('ORDER BY worker_cancellations DESC, worker_id ASC'), true);
  assert.equal(workersCall.query.indexOf('WHERE') < workersCall.query.indexOf('ORDER BY'), true);
  assert.equal(workersCall.query.includes('LIMIT {limit:UInt64} OFFSET {offset:UInt64}'), true);
});

test('loadWorkerCancellationsDashboardSection prefilters bounded search candidates before metrics', async () => {
  const { calls, client } = createDashboardClient({
    'worker cancellations search candidates': [
      {
        worker_id: 'worker-1',
        full_name: 'Ivan Petrov',
        phone: '+79990000000',
        city: 'Moscow'
      }
    ],
    'worker cancellations bounded shift facts': [
      {
        job: 'job-1',
        worker_id: 'worker-1',
        start: '2026-05-10 09:00:00',
        status: 'confirmed',
        is_successful_confirmed_shift: 1
      },
      {
        job: 'job-2',
        worker_id: 'worker-1',
        start: '2026-05-11 09:00:00',
        status: 'cancelled',
        is_successful_confirmed_shift: 0
      },
      {
        job: 'job-3',
        worker_id: 'worker-1',
        start: '2026-05-12 09:00:00',
        status: 'failed',
        is_successful_confirmed_shift: 0
      }
    ],
    'worker cancellations bounded cancellation events': [
      {
        job: 'job-2',
        is_worker_event: 1,
        event_at: '2026-05-10 18:00:00'
      }
    ]
  });

  const dashboard = await loadWorkerCancellationsDashboardSection(
    client,
    {
      from: '2026-05-01',
      to: '2026-05-31',
      search: '+79990000000'
    },
    'workers',
    new Date('2026-06-03T12:00:00.000Z')
  );

  assert.equal(dashboard.workers.length, 1);
  assert.deepEqual(dashboard.workers[0], {
    workerId: 'worker-1',
    fullName: 'Ivan Petrov',
    phone: '+79990000000',
    city: 'Moscow',
    confirmedShifts: 1,
    workerCancellations: 1,
    workerCancellations24h: 1,
    postStartCancellations: 0,
    failedShifts: 1,
    riskReasons: [
      { kind: 'worker-cancellations-24h', label: '1 отмена менее чем за 24ч' },
      { kind: 'failed-shifts', label: '1 failed-смена' }
    ],
    riskSeverity: 'medium'
  });
  assert.deepEqual(dashboard.pagination, {
    page: 1,
    pageSize: 100,
    totalWorkers: 1,
    totalPages: 1,
    hasPrevious: false,
    hasNext: false
  });
  assert.deepEqual(calls.map((call) => call.operation), [
    'worker cancellations search candidates',
    'worker cancellations bounded shift facts',
    'worker cancellations bounded cancellation events'
  ]);

  const candidateCall = calls[0];

  assert.equal(candidateCall.params.param_search, '+79990000000');
  assert.equal(candidateCall.params.param_search_candidate_limit, 1001);
  assert.equal(candidateCall.query.includes('FROM mg_workers AS w'), true);
  assert.equal(candidateCall.query.includes('LEFT JOIN mg_users AS u ON w.user = u._id'), true);
  assert.equal(candidateCall.query.includes('UNION ALL'), true);
  assert.equal(candidateCall.query.includes('FROM mg_jobs AS j'), true);
  assert.equal(candidateCall.query.includes('LIMIT {search_candidate_limit:UInt64}'), true);

  const shiftFactsCall = calls[1];
  const eventsCall = calls[2];

  assert.equal(shiftFactsCall.params.param_search_worker_ids, "['worker-1']");
  assert.equal(shiftFactsCall.query.includes('PREWHERE worker IN {search_worker_ids:Array(String)}'), true);
  assert.equal(shiftFactsCall.query.includes('INNER JOIN mg_orders AS o ON o._id = j.source'), true);
  assert.equal(eventsCall.params.param_jobs, "['job-2']");
  assert.equal(eventsCall.query.includes('PREWHERE job IN {jobs:Array(String)}'), true);
});

test('loadWorkerCancellationsDashboardSection skips heavy metrics when search has no candidates', async () => {
  const { calls, client } = createDashboardClient({
    'worker cancellations search candidates': []
  });

  const dashboard = await loadWorkerCancellationsDashboardSection(
    client,
    {
      from: '2026-05-01',
      to: '2026-05-31',
      search: '+79990009999'
    },
    'workers',
    new Date('2026-06-03T12:00:00.000Z')
  );

  assert.deepEqual(dashboard.workers, []);
  assert.deepEqual(dashboard.pagination, {
    page: 1,
    pageSize: 100,
    totalWorkers: 0,
    totalPages: 1,
    hasPrevious: false,
    hasNext: false
  });
  assert.deepEqual(calls.map((call) => call.operation), [
    'worker cancellations search candidates'
  ]);
});

test('loadWorkerCancellationsDetails queries selected metric with shift timeline and workplace context', async () => {
  const { calls, client } = createDashboardClient({
    'worker cancellations detail shifts': [
      {
        shift_id: 'job-1',
        brand: 'Brand A',
        address: 'Moscow, Lenina, 10',
        planned_start: '2026-05-12 09:00:00',
        booked_at: '2026-05-10 15:30:00',
        cancelled_at: '2026-05-11 18:00:00',
        cancelled_by: 'worker'
      }
    ]
  });

  const details = await loadWorkerCancellationsDetails(
    client,
    {
      from: '2026-05-01',
      to: '2026-05-31',
      workerId: 'worker-1',
      metric: 'workerCancellations24h',
      client: ['Brand A'],
      city: ['Moscow']
    },
    new Date('2026-06-03T12:00:00.000Z')
  );

  assert.equal(details.shifts.length, 1);
  assert.equal(details.metricLabel, 'Отмены worker < 24ч');
  assert.deepEqual(calls.map((call) => call.operation), [
    'worker cancellations detail shifts'
  ]);

  const detailCall = calls[0];

  assert.equal(detailCall.params.param_from, '2026-05-01 00:00:00');
  assert.equal(detailCall.params.param_to, '2026-06-01 00:00:00');
  assert.equal(detailCall.params.param_worker_id, 'worker-1');
  assert.equal(detailCall.params.param_limit, 500);
  assert.equal(detailCall.params.param_clients, "['Brand A']");
  assert.equal(detailCall.params.param_cities, "['Moscow']");
  assert.equal(detailCall.query.includes('FROM mg_jobs AS j'), true);
  assert.equal(detailCall.query.includes('INNER JOIN mg_orders AS o ON o._id = j.source'), true);
  assert.equal(detailCall.query.includes('INNER JOIN mg_clients AS actual_client ON actual_client._id = o.client'), true);
  assert.equal(detailCall.query.includes('LEFT JOIN mg_workplaces AS actual_workplace ON actual_workplace._id = o.workplace'), true);
  assert.equal(detailCall.query.includes('LEFT JOIN mg_contractors AS actual_contractor ON actual_contractor._id = actual_workplace.contractor'), true);
  assert.equal(detailCall.query.includes('o.deleted = 0'), true);
  assert.equal(detailCall.query.includes('ifNull(o.is_hidden, false) = false'), true);
  assert.equal(detailCall.query.includes('actual_client.title IS NULL OR actual_client.title NOT IN'), true);
  assert.equal(detailCall.query.includes("ifNull(actual_contractor.contract_type, ifNull(o.contract_type, '')) != 'processing'"), true);
  assert.equal(detailCall.query.includes('actual_client.title IN {clients:Array(String)}'), true);
  assert.equal(detailCall.query.includes('actual_workplace.address__city IN {cities:Array(String)}'), true);
  assert.equal(detailCall.query.includes('j.worker = {worker_id:String}'), true);
  assert.equal(detailCall.query.includes('j.start >= {from:DateTime}'), true);
  assert.equal(detailCall.query.includes('j.start < {to:DateTime}'), true);
  assert.equal(detailCall.query.includes('ifNull(j.deleted, 0) = 0'), true);
  assert.equal(detailCall.query.includes('LEFT JOIN mg_clients AS c'), true);
  assert.equal(detailCall.query.includes('LEFT JOIN mg_workplaces AS wp'), true);
  assert.equal(detailCall.query.includes("h.status = 'booked'"), true);
  assert.equal(detailCall.query.includes("h.status = 'cancelled'"), true);
  assert.equal(detailCall.query.includes('min(coalesce(h.createdAt, h.updatedAt)) AS booked_at'), true);
  assert.equal(detailCall.query.includes('argMax(ifNull(h.initiator, \'\'), coalesce(h.createdAt, h.updatedAt)) AS cancelled_by'), true);
  assert.equal(detailCall.query.includes("sf.status = 'cancelled' AND ifNull(cf.is_worker_cancelled_24h, 0) = 1"), true);
  assert.equal(detailCall.query.includes('arrayStringConcat'), true);
  assert.equal(detailCall.query.includes('DROP TABLE'), false);
  assert.equal(detailCall.query.includes('LIMIT {limit:UInt64}'), true);
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

  timestamp = Date.parse('2026-06-04T00:00:00.000Z');

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
