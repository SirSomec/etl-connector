const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDateKeys,
  heatmapLevel,
  loadWorkplaceAnalysisGigerDetails,
  loadWorkplaceAnalysisDashboardSection,
  loadWorkplaceAnalysisDashboardShell,
  mergeWorkplaceAttentionRows,
  mergeWorkplaceAnalysisRows,
  normalizeWorkplaceGigerDetailsInput,
  normalizeWorkplaceAnalysisFilters,
  normalizeWorkplaceAttentionFilters
} = require('../src/workplaceAnalysisDashboard');

const { createDashboardSectionCache } = require('../src/dashboardSectionCache');

function extractMgJobJoinOnClauses(query, alias) {
  const marker = `INNER JOIN mg_jobs AS ${alias} ON `;
  const clauses = [];
  let markerIndex = query.indexOf(marker);

  while (markerIndex !== -1) {
    const clauseStart = markerIndex + marker.length;
    const clauseEndCandidates = [
      query.indexOf('\n    WHERE ', clauseStart),
      query.indexOf('\n    GROUP BY ', clauseStart)
    ].filter((index) => index !== -1);

    assert.notEqual(clauseEndCandidates.length, 0);
    clauses.push(query.slice(clauseStart, Math.min(...clauseEndCandidates)).trim());
    markerIndex = query.indexOf(marker, clauseStart);
  }

  return clauses;
}

test('normalizeWorkplaceAnalysisFilters defaults from previous month start to current month end and whitelists limit and order type', () => {
  const filters = normalizeWorkplaceAnalysisFilters(
    {
      limit: '999',
      orderType: 'once; DROP TABLE mg_orders',
      sort: 'DROP TABLE',
      client: '  Бренд  ',
      search: '<script>'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.deepEqual(filters, {
    from: '2026-05-01',
    to: '2026-06-30',
    currentDate: '2026-06-15',
    fromDateTime: '2026-05-01 00:00:00',
    toExclusiveDateTime: '2026-07-01 00:00:00',
    rangeDays: 61,
    pinnedWorkplaceIds: [],
    client: ['Бренд'],
    city: [],
    region: [],
    profession: [],
    orderType: [],
    jobStatus: [],
    contractor: [],
    search: '<script>',
    includeDeletedOrders: false,
    includeHiddenOrders: false,
    sort: 'orders',
    slaFrom: null,
    slaTo: null,
    ordersFrom: null,
    ordersTo: null,
    stabilityFrom: null,
    stabilityTo: null,
    limit: 12,
    page: 1,
    offset: 0
  });
});

test('normalizeWorkplaceAttentionFilters defaults to today plus seven days and keeps shared filters', () => {
  const filters = normalizeWorkplaceAttentionFilters(
    {
      attentionLimit: '999',
      attentionPage: '2',
      attentionSort: 'activeWorkers30d15km',
      attentionDirection: 'asc',
      client: ['Бренд', ' '],
      city: 'Москва',
      orderType: ['regular', 'unsafe'],
      search: '  север  ',
      includeHiddenOrders: 'on'
    },
    new Date('2026-06-04T12:00:00.000Z')
  );

  assert.equal(filters.attentionFrom, '2026-06-04');
  assert.equal(filters.attentionTo, '2026-06-11');
  assert.equal(filters.attentionFromDateTime, '2026-06-04 00:00:00');
  assert.equal(filters.attentionToExclusiveDateTime, '2026-06-12 00:00:00');
  assert.equal(filters.attentionDays, 8);
  assert.equal(filters.attentionLimit, 150);
  assert.equal(filters.attentionPage, 2);
  assert.equal(filters.attentionPageSize, 15);
  assert.equal(filters.attentionSort, 'activeWorkers30d15km');
  assert.equal(filters.attentionDirection, 'asc');
  assert.deepEqual(filters.client, ['Бренд']);
  assert.deepEqual(filters.city, ['Москва']);
  assert.deepEqual(filters.orderType, ['regular']);
  assert.equal(filters.search, 'север');
  assert.equal(filters.includeHiddenOrders, true);
});

test('mergeWorkplaceAttentionRows calculates free order, status bases, score and priority reason', () => {
  const filters = normalizeWorkplaceAttentionFilters({}, new Date('2026-06-04T12:00:00.000Z'));
  const dashboard = mergeWorkplaceAttentionRows(filters, [
    {
      workplace_id: 'wp1',
      workplace_title: 'Точка 1',
      client_title: 'Бренд',
      city: 'Москва',
      street: 'Ленина 1',
      ordered_7d: 10,
      covered_7d: 4,
      free_7d: 6,
      max_daily_free: 5,
      days_with_free: 2,
      nearest_free_date: '2026-06-04',
      total_workers_15km: 20,
      active_workers_30d_15km: 3,
      total_status_ready: 8,
      total_status_booked: 2,
      total_status_worked: 1,
      total_status_other: 9,
      active_status_ready: 2,
      active_status_booked: 1,
      active_status_worked: 0,
      active_status_other: 0
    },
    {
      workplace_id: 'wp2',
      workplace_title: 'Точка 2',
      ordered_7d: 4,
      covered_7d: 0,
      free_7d: 4,
      max_daily_free: 4,
      days_with_free: 1,
      nearest_free_date: '2026-06-08',
      total_workers_15km: 50,
      active_workers_30d_15km: 20
    }
  ]);

  assert.equal(dashboard.attentionPoints.length, 2);
  assert.equal(dashboard.attentionPoints[0].workplaceId, 'wp1');
  assert.equal(dashboard.attentionPoints[0].free7d, 6);
  assert.equal(dashboard.attentionPoints[0].coveragePercent, 40);
  assert.equal(dashboard.attentionPoints[0].activeWorkersPerFreeShift, 0.5);
  assert.equal(dashboard.attentionPoints[0].priorityReason, 'пик в ближайшие дни');
  assert.deepEqual(dashboard.attentionPoints[0].totalWorkersByStatus15km, {
    ready: 8,
    booked: 2,
    worked: 1,
    other: 9
  });
  assert.deepEqual(dashboard.attentionPoints[0].activeWorkers30dByStatus15km, {
    ready: 2,
    booked: 1,
    worked: 0,
    other: 0
  });
});

test('mergeWorkplaceAttentionRows assigns high risk severity and reasons for urgent free order', () => {
  const filters = normalizeWorkplaceAttentionFilters({}, new Date('2026-06-04T12:00:00.000Z'));
  const dashboard = mergeWorkplaceAttentionRows(filters, [
    {
      workplace_id: 'wp-risk',
      workplace_title: 'Точка риска',
      ordered_7d: 12,
      covered_7d: 3,
      free_7d: 9,
      max_daily_free: 6,
      days_with_free: 2,
      nearest_free_date: '2026-06-04',
      total_workers_15km: 20,
      active_workers_30d_15km: 2
    }
  ]);

  assert.equal(dashboard.attentionPoints[0].riskSeverity, 'high');
  assert.equal(dashboard.attentionPoints[0].attentionDetailDate, '2026-06-04');
  assert.equal(dashboard.attentionPoints[0].riskScore >= 80, true);
  assert.deepEqual(dashboard.attentionPoints[0].riskReasons.slice(0, 3), [
    { kind: 'free-order', label: 'Свободный заказ 9 за 7 дней' },
    { kind: 'coverage', label: 'Покрытие 25%' },
    { kind: 'active-base', label: 'Актив 0,2 на свободную смену' }
  ]);
});

test('mergeWorkplaceAttentionRows assigns medium risk when order is later and base is acceptable', () => {
  const filters = normalizeWorkplaceAttentionFilters({}, new Date('2026-06-04T12:00:00.000Z'));
  const dashboard = mergeWorkplaceAttentionRows(filters, [
    {
      workplace_id: 'wp-medium',
      workplace_title: 'Средний риск',
      ordered_7d: 10,
      covered_7d: 8,
      free_7d: 2,
      max_daily_free: 2,
      days_with_free: 1,
      nearest_free_date: '2026-06-10',
      total_workers_15km: 60,
      active_workers_30d_15km: 18
    }
  ]);

  assert.equal(dashboard.attentionPoints[0].riskSeverity, 'medium');
  assert.equal(dashboard.attentionPoints[0].riskReasons[0].kind, 'free-order');
  assert.equal(dashboard.attentionPoints[0].riskReasons.some((reason) => reason.kind === 'active-base'), false);
});

test('normalizeWorkplaceGigerDetailsInput keeps page size at 20 and validates workplace metrics', () => {
  const details = normalizeWorkplaceGigerDetailsInput(
    {
      metric: 'attention-active-workers-30d-15km',
      workplaceId: ' wp-1 ',
      status: 'ready',
      page: '3'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.equal(details.metric, 'attention-active-workers-30d-15km');
  assert.equal(details.metricLabel, 'Актив 30д');
  assert.equal(details.workplaceId, 'wp-1');
  assert.equal(details.status, 'ready');
  assert.equal(details.page, 3);
  assert.equal(details.pageSize, 20);
  assert.equal(details.offset, 40);
  assert.equal(details.export, false);
});

test('loadWorkplaceAnalysisGigerDetails loads paged active gigers for a point and preserves safe parameters', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'workplace analysis giger details total') {
        return [{ total_gigers: 21 }];
      }

      if (operation === 'workplace analysis giger details') {
        return [
          {
            user_id: 'user-1',
            worker_id: 'worker-1',
            full_name: 'Иван Петров',
            phone: '+79990000000',
            status: 'ready'
          }
        ];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  };

  const details = await loadWorkplaceAnalysisGigerDetails(
    client,
    {
      metric: 'points-active-gigers-5km',
      workplaceId: 'wp-1',
      page: '2'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.equal(details.metricLabel, 'Гигеры 5 км');
  assert.equal(details.pagination.page, 2);
  assert.equal(details.pagination.pageSize, 20);
  assert.equal(details.pagination.totalGigers, 21);
  assert.equal(details.pagination.totalPages, 2);
  assert.equal(details.pagination.hasPrevious, true);
  assert.equal(details.pagination.hasNext, false);
  assert.deepEqual(details.gigers, [
    {
      userId: 'user-1',
      workerId: 'worker-1',
      fullName: 'Иван Петров',
      phone: '+79990000000',
      status: 'ready'
    }
  ]);

  assert.equal(calls.length, 2);

  for (const call of calls) {
    assert.equal(call.params.param_workplace_id, 'wp-1');
    assert.equal(call.params.param_limit, 20);
    assert.equal(call.params.param_offset, 20);
    assert.equal(call.query.includes('appmetrica_sessions'), true);
    assert.equal(call.query.includes('mg_workers'), true);
    assert.equal(call.query.includes('mg_users'), true);
    assert.equal(call.query.includes('greatCircleDistance'), true);
    assert.equal(call.query.includes('CROSS JOIN mg_workers AS worker'), false);
    assert.equal(call.query.includes('candidate_gigers AS'), true);
    assert.equal(call.query.includes('candidate_users AS'), true);
    assert.match(call.query, /INNER JOIN candidate_users AS cu\s+ON cu\.user_id = ifNull\(s\.profile_id, ''\)/);
    assert.equal(call.query.includes('worker.location__coordinates[1] BETWEEN sw.lon -'), true);
    assert.equal(call.query.includes('worker.location__coordinates[2] BETWEEN sw.lat -'), true);
    assert.equal(call.query.includes('wp-1'), false);
  }
});

test('loadWorkplaceAnalysisGigerDetails filters attention workers by status and active session window', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'workplace analysis giger details total') {
        return [{ total_gigers: 1 }];
      }

      if (operation === 'workplace analysis giger details') {
        return [{ user_id: 'user-2', worker_id: 'worker-2', full_name: 'Анна Иванова', phone: '', status: 'ready' }];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  };

  await loadWorkplaceAnalysisGigerDetails(
    client,
    {
      metric: 'attention-active-workers-30d-15km',
      workplaceId: 'wp-2',
      status: 'ready',
      attentionPage: '2',
      attentionSort: 'free7d',
      attentionDirection: 'asc'
    },
    new Date('2026-06-04T12:00:00.000Z')
  );

  const detailsCall = calls.find((call) => call.operation === 'workplace analysis giger details');

  assert.equal(detailsCall.params.param_workplace_id, 'wp-2');
  assert.equal(detailsCall.params.param_active_from, '2026-06-04 00:00:00');
  assert.equal(detailsCall.params.param_active_to, '2026-06-12 00:00:00');
  assert.equal(detailsCall.params.param_status, 'ready');
  assert.equal(detailsCall.query.includes('user_id IN (SELECT user_id FROM active_session_users)'), false);
  assert.equal(detailsCall.query.includes('CROSS JOIN latest_workers'), false);
  assert.equal(detailsCall.query.includes('candidate_gigers AS'), true);
  assert.equal(detailsCall.query.includes('candidate_users AS'), true);
  assert.match(detailsCall.query, /INNER JOIN candidate_users AS cu\s+ON cu\.user_id = ifNull\(s\.profile_id, ''\)/);
  assert.equal(detailsCall.query.includes("AND au.user_id != ''"), true);
  assert.equal(detailsCall.query.includes('status = {status:String}'), true);
  assert.equal(detailsCall.query.includes('LIMIT {limit:UInt64} OFFSET {offset:UInt64}'), true);
});

test('mergeWorkplaceAttentionRows sorts attention points and paginates by 15 rows', () => {
  const filters = normalizeWorkplaceAttentionFilters(
    {
      attentionPage: '2',
      attentionSort: 'free7d',
      attentionDirection: 'asc'
    },
    new Date('2026-06-04T12:00:00.000Z')
  );
  const rows = Array.from({ length: 16 }, (_, index) => ({
    workplace_id: `wp${index + 1}`,
    workplace_title: `Точка ${String(index + 1).padStart(2, '0')}`,
    client_title: 'Бренд',
    city: 'Москва',
    ordered_7d: index + 1,
    covered_7d: 0,
    free_7d: index + 1,
    max_daily_free: index + 1,
    days_with_free: 1,
    nearest_free_date: '2026-06-04',
    total_workers_15km: 100,
    active_workers_30d_15km: 10,
    total_status_ready: 1,
    total_status_booked: 2,
    total_status_worked: 3,
    total_status_other: 4,
    active_status_ready: 5,
    active_status_booked: 6,
    active_status_worked: 7,
    active_status_other: 8
  }));

  const dashboard = mergeWorkplaceAttentionRows(filters, rows);

  assert.equal(dashboard.attentionPoints.length, 1);
  assert.equal(dashboard.attentionPoints[0].workplaceId, 'wp16');
  assert.equal(dashboard.attentionPagination.page, 2);
  assert.equal(dashboard.attentionPagination.pageSize, 15);
  assert.equal(dashboard.attentionPagination.totalWorkplaces, 16);
  assert.equal(dashboard.attentionPagination.totalPages, 2);
  assert.equal(dashboard.attentionPagination.hasPrevious, true);
  assert.equal(dashboard.attentionPagination.hasNext, false);
});

test('normalizeWorkplaceAnalysisFilters accepts repeated values, valid order types, and whitelisted limit', () => {
  const filters = normalizeWorkplaceAnalysisFilters(
    {
      from: '2026-04-01',
      to: '2026-04-30',
      client: ['Brand A', 'Brand B', 'Brand A', ' '],
      orderType: ['regular', 'once', 'unsafe'],
      city: ['Казань', 'Москва'],
      region: 'Татарстан',
      profession: ['picker', 'driver'],
      jobStatus: ['confirmed', 'failed', 'confirmed', ' '],
      contractor: ['ООО Ромашка'],
      includeDeletedOrders: '1',
      includeHiddenOrders: 'on',
      sort: 'sla',
      limit: '20',
      page: '3',
      pinnedWorkplaceId: ['wp1', 'wp2', 'wp1', ' ']
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.equal(filters.from, '2026-04-01');
  assert.equal(filters.to, '2026-04-30');
  assert.equal(filters.toExclusiveDateTime, '2026-05-01 00:00:00');
  assert.equal(filters.rangeDays, 30);
  assert.deepEqual(filters.pinnedWorkplaceIds, ['wp1', 'wp2']);
  assert.deepEqual(filters.client, ['Brand A', 'Brand B']);
  assert.deepEqual(filters.orderType, ['regular', 'once']);
  assert.deepEqual(filters.city, ['Казань', 'Москва']);
  assert.deepEqual(filters.region, ['Татарстан']);
  assert.deepEqual(filters.profession, ['picker', 'driver']);
  assert.deepEqual(filters.jobStatus, ['confirmed', 'failed']);
  assert.deepEqual(filters.contractor, ['ООО Ромашка']);
  assert.equal(filters.includeDeletedOrders, true);
  assert.equal(filters.includeHiddenOrders, true);
  assert.equal(filters.sort, 'sla');
  assert.equal(filters.limit, 20);
  assert.equal(filters.page, 3);
  assert.equal(filters.offset, 40);
});

test('normalizeWorkplaceAnalysisFilters accepts metric ranges and clamps percent values', () => {
  const filters = normalizeWorkplaceAnalysisFilters(
    {
      from: '2026-04-01',
      to: '2026-04-30',
      slaFrom: '-5',
      slaTo: '105',
      ordersFrom: '10',
      ordersTo: '25.5',
      stabilityFrom: '20,5',
      stabilityTo: '80',
      page: '4'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.equal(filters.slaFrom, 0);
  assert.equal(filters.slaTo, 100);
  assert.equal(filters.ordersFrom, 10);
  assert.equal(filters.ordersTo, 25.5);
  assert.equal(filters.stabilityFrom, 20.5);
  assert.equal(filters.stabilityTo, 80);
  assert.equal(filters.page, 4);
  assert.equal(filters.offset, 36);
});

test('buildDateKeys returns every inclusive date in the selected range', () => {
  assert.deepEqual(buildDateKeys('2026-06-01', '2026-06-04'), [
    '2026-06-01',
    '2026-06-02',
    '2026-06-03',
    '2026-06-04'
  ]);
});

test('heatmapLevel maps zero to level 0 and positive values to four intensity levels', () => {
  assert.equal(heatmapLevel(0, 10), 0);
  assert.equal(heatmapLevel(1, 10), 1);
  assert.equal(heatmapLevel(3, 10), 2);
  assert.equal(heatmapLevel(7, 10), 3);
  assert.equal(heatmapLevel(10, 10), 4);
});

test('mergeWorkplaceAnalysisRows calculates stability and fills missing heatmap days', () => {
  const filters = normalizeWorkplaceAnalysisFilters(
    {
      from: '2026-06-01',
      to: '2026-06-03'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  const dashboard = mergeWorkplaceAnalysisRows(
    filters,
    [
      {
        workplace_id: 'wp1',
        workplace_title: '',
        technical_name: 'tech-1',
        client_title: 'Бренд <A>',
        city: 'Москва',
        region: 'Москва',
        street: 'Ленина 10',
        total_ordered_shifts: 9,
        active_days: 2
      }
    ],
    [
      {
        workplace_id: 'wp1',
        order_date: '2026-06-01',
        ordered_shifts: 3,
        completed_shifts: 2,
        sla_ordered_shifts: 3,
        sla_completed_shifts: 2
      },
      {
        workplace_id: 'wp1',
        order_date: '2026-06-03',
        ordered_shifts: 6,
        completed_shifts: 3,
        sla_ordered_shifts: 6,
        sla_completed_shifts: 3
      }
    ]
  );

  assert.equal(dashboard.context.maxDailyAmount, 6);
  assert.equal(dashboard.points.length, 1);
  assert.equal(dashboard.points[0].title, 'tech-1');
  assert.equal(dashboard.points[0].clientTitle, 'Бренд <A>');
  assert.equal(dashboard.points[0].address, 'Москва, Ленина 10');
  assert.equal(dashboard.points[0].totalOrderedShifts, 9);
  assert.equal(dashboard.points[0].activeDays, 2);
  assert.equal(dashboard.points[0].rangeDays, 3);
  assert.equal(dashboard.points[0].stabilityPercent, 66.66666666666666);
  assert.equal(dashboard.points[0].slaPercent, 55.55555555555556);
  assert.equal(dashboard.points[0].slaOrderedShifts, 9);
  assert.equal(dashboard.points[0].slaCompletedShifts, 5);
  assert.equal(dashboard.points[0].avgDailyOrder, 4.5);
  assert.deepEqual(dashboard.points[0].heatmapDays, [
    { date: '2026-06-01', amount: 3, completedShifts: 2, level: 2 },
    { date: '2026-06-02', amount: 0, completedShifts: 0, level: 0 },
    { date: '2026-06-03', amount: 6, completedShifts: 3, level: 4 }
  ]);
});

test('mergeWorkplaceAnalysisRows splits SLA into past and forecast from current date', () => {
  const filters = normalizeWorkplaceAnalysisFilters(
    {
      from: '2026-06-14',
      to: '2026-06-16'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  const dashboard = mergeWorkplaceAnalysisRows(
    filters,
    [
      {
        workplace_id: 'wp1',
        workplace_title: 'Point',
        total_ordered_shifts: 18,
        active_days: 3
      }
    ],
    [
      {
        workplace_id: 'wp1',
        order_date: '2026-06-14',
        ordered_shifts: 6,
        completed_shifts: 4,
        sla_ordered_shifts: 6,
        sla_completed_shifts: 4,
        forecast_sla_active_shifts: 6
      },
      {
        workplace_id: 'wp1',
        order_date: '2026-06-15',
        ordered_shifts: 7,
        completed_shifts: 0,
        sla_ordered_shifts: 7,
        sla_completed_shifts: 0,
        forecast_sla_active_shifts: 5
      },
      {
        workplace_id: 'wp1',
        order_date: '2026-06-16',
        ordered_shifts: 5,
        completed_shifts: 0,
        sla_ordered_shifts: 5,
        sla_completed_shifts: 0,
        forecast_sla_active_shifts: 4
      }
    ]
  );

  assert.equal(dashboard.points[0].slaPercent, 66.66666666666666);
  assert.equal(dashboard.points[0].slaPastPercent, 66.66666666666666);
  assert.equal(dashboard.points[0].slaOrderedShifts, 6);
  assert.equal(dashboard.points[0].slaCompletedShifts, 4);
  assert.equal(dashboard.points[0].slaForecastPercent, 75);
  assert.equal(dashboard.points[0].slaForecastOrderedShifts, 12);
  assert.equal(dashboard.points[0].slaForecastActiveShifts, 9);
});

const { loadWorkplaceAnalysisDashboard } = require('../src/workplaceAnalysisDashboard');

test('loadWorkplaceAnalysisDashboard queries top workplaces and daily orders with safe parameters', async () => {
  const calls = [];
  const maliciousSearch = 'Lenina; DROP TABLE mg_orders';
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'workplace analysis filter options') {
        return [
          { filter: 'client', value: 'Бренд' },
          { filter: 'client', value: 'Бренд 2' },
          { filter: 'city', value: 'Москва' },
          { filter: 'region', value: 'Москва' },
          { filter: 'profession', value: 'Комплектовщик' },
          { filter: 'orderType', value: 'regular' },
          { filter: 'orderType', value: 'once' },
          { filter: 'jobStatus', value: 'confirmed' },
          { filter: 'jobStatus', value: 'failed' },
          { filter: 'contractor', value: 'Ромашка' }
        ];
      }

      if (operation === 'workplace analysis top workplaces') {
        return [
          {
            workplace_id: 'wp1',
            workplace_title: 'Точка',
            technical_name: 'tech',
            client_title: 'Бренд',
            city: 'Москва',
            region: 'Москва',
            street: 'Ленина 10',
            total_ordered_shifts: 9,
            active_days: 2
          }
        ];
      }

      if (operation === 'workplace analysis total workplaces') {
        return [{ total_workplaces: 13 }];
      }

      if (operation === 'workplace analysis daily orders') {
        return [
          {
            workplace_id: 'wp1',
            order_date: '2026-06-01',
            ordered_shifts: 3,
            completed_shifts: 2,
            sla_ordered_shifts: 3,
            sla_completed_shifts: 2
          },
          {
            workplace_id: 'wp1',
            order_date: '2026-06-03',
            ordered_shifts: 6,
            completed_shifts: 3,
            sla_ordered_shifts: 6,
            sla_completed_shifts: 3
          }
        ];
      }

      if (operation === 'workplace analysis active gigers 5km') {
        return [];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  };

  const dashboard = await loadWorkplaceAnalysisDashboard(
    client,
    {
      from: '2026-06-01',
      to: '2026-06-03',
      client: ['Бренд', 'Бренд 2'],
      city: ['Москва'],
      region: ['Москва'],
      profession: ['Комплектовщик'],
      orderType: ['regular', 'once'],
      jobStatus: ['confirmed', 'failed'],
      contractor: ['Ромашка'],
      search: maliciousSearch,
      page: '2'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.equal(dashboard.points.length, 1);
  assert.deepEqual(dashboard.pagination, {
    page: 2,
    limit: 12,
    totalWorkplaces: 13,
    totalPages: 2,
    hasPrevious: true,
    hasNext: false
  });
  assert.equal(dashboard.points[0].totalOrderedShifts, 9);
  assert.equal(dashboard.points[0].slaPercent, 55.55555555555556);
  assert.equal(dashboard.points[0].heatmapDays.length, 3);
  assert.equal(calls.length, 5);
  assert.equal(calls[0].operation, 'workplace analysis filter options');
  assert.equal(calls[1].operation, 'workplace analysis total workplaces');
  assert.equal(calls[2].operation, 'workplace analysis top workplaces');
  assert.equal(calls[3].operation, 'workplace analysis daily orders');
  assert.equal(calls[4].operation, 'workplace analysis active gigers 5km');
  assert.equal(calls[1].query.includes('countDistinct(o.workplace)'), true);
  assert.equal(calls[3].query.includes('WITH top_workplaces'), false);
  assert.equal(calls[3].query.includes('INNER JOIN top_workplaces AS tw'), false);
  assert.equal(calls[3].query.includes('o.workplace IN {workplace_ids:Array(String)}'), true);
  assert.equal(calls[3].params.param_workplace_ids, "['wp1']");
  assert.equal(calls[3].query.includes('INNER JOIN mg_jobs AS completed_job ON completed_job.source = o._id'), true);
  for (const call of [calls[2], calls[3]]) {
    assert.deepEqual(extractMgJobJoinOnClauses(call.query, 'completed_job'), ['completed_job.source = o._id']);
    assert.deepEqual(extractMgJobJoinOnClauses(call.query, 'forecast_job'), ['forecast_job.source = o._id']);
    assert.equal(call.query.includes('AND ifNull(completed_job.deleted, 0) = 0'), true);
    assert.equal(call.query.includes('AND ifNull(forecast_job.deleted, 0) = 0'), true);
  }
  assert.equal(calls[3].query.includes('AS is_successful_confirmed_shift'), false);
  assert.equal(calls[3].query.includes("toFloat64OrZero(ifNull(toString(completed_job.payment), '')) > 0"), true);
  assert.equal(calls[3].query.includes('ifNull(j.payment, 0) > 0'), false);
  assert.equal(calls[3].query.includes('completed_job.is_successful_confirmed_shift = 1'), false);
  assert.equal(calls[3].query.includes('sla_ordered_shifts'), true);
  assert.equal(calls[3].query.includes('sla_completed_shifts'), true);
  assert.equal(calls[3].params.param_current_date, '2026-06-15');
  assert.equal(calls[3].query.includes('toDate(o.start) >= {current_date:Date}'), true);
  assert.equal(calls[3].query.includes("ifNull(forecast_job.status, '') IN ('booked', 'going', 'delayed', 'waiting', 'checkingin', 'inprogress', 'checkingout', 'completed', 'confirmed')"), true);
  assert.equal(calls[3].query.includes('forecast_sla_active_shifts'), true);
  assert.equal(calls[4].params.param_workplace_ids, "['wp1']");
  assert.deepEqual(dashboard.filterOptions.client, ['Бренд', 'Бренд 2']);
  assert.deepEqual(dashboard.filterOptions.city, ['Москва']);
  assert.deepEqual(dashboard.filterOptions.jobStatus, ['confirmed', 'failed']);

  const orderDomainCalls = calls.filter((call) => call.operation !== 'workplace analysis active gigers 5km');

  for (const call of orderDomainCalls) {
    assert.equal(call.params.param_from, '2026-06-01 00:00:00');
    assert.equal(call.params.param_to, '2026-06-04 00:00:00');
    assert.equal(call.query.includes(maliciousSearch), false);
    assert.equal(call.query.includes('DROP TABLE'), false);
    assert.equal(call.query.includes('ifNull(o.deleted, 0) = 0'), true);
    assert.equal(call.query.includes('ifNull(o.is_hidden, 0) = 0'), true);
  }

  for (const call of orderDomainCalls.slice(1)) {
    assert.equal(call.params.param_clients, "['Бренд','Бренд 2']");
    assert.equal(call.params.param_cities, "['Москва']");
    assert.equal(call.params.param_regions, "['Москва']");
    assert.equal(call.params.param_professions, "['Комплектовщик']");
    assert.equal(call.params.param_order_types, "['regular','once']");
    assert.equal(call.params.param_job_statuses, "['confirmed','failed']");
    assert.equal(call.params.param_contractors, "['Ромашка']");
    assert.equal(call.params.param_search, maliciousSearch);
    assert.equal(Object.values(call.params).includes(maliciousSearch), true);
    assert.equal(call.query.includes('IN {clients:Array(String)}'), true);
    assert.equal(call.query.includes('IN {cities:Array(String)}'), true);
    assert.equal(call.query.includes('IN {order_types:Array(String)}'), true);
    assert.equal(call.query.includes('IN {job_statuses:Array(String)}'), true);
    assert.equal(call.query.includes('FROM mg_jobs AS j'), true);
    assert.equal(call.query.includes('SELECT DISTINCT j.source'), true);
    assert.equal(call.query.includes("positionCaseInsensitive(ifNull(o.workplace, ''), {search:String}) > 0"), true);
    assert.equal(call.query.includes("positionCaseInsensitive(ifNull(w._id, ''), {search:String}) > 0"), true);
    assert.equal(call.query.includes("concat(ifNull(w.address__region, ''), ' ', ifNull(w.address__city, ''), ' ', ifNull(w.address__street, ''))"), true);
  }

  assert.equal(calls[2].query.includes('{limit:UInt64}'), true);
  assert.equal(calls[2].query.includes('OFFSET {offset:UInt64}'), true);
  assert.equal(calls[2].params.param_limit, 12);
  assert.equal(calls[2].params.param_offset, 12);
  assert.equal(calls[2].query.includes('ORDER BY total_ordered_shifts DESC, workplace_id ASC'), true);
  assert.equal(calls[3].query.includes('{limit:UInt64}'), false);
  assert.equal(calls[3].query.includes('OFFSET {offset:UInt64}'), false);
  assert.equal(calls[3].query.includes('ORDER BY total_ordered_shifts DESC, workplace_id ASC'), false);
});

test('loadWorkplaceAnalysisDashboardShell loads filter options without point datasets', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'workplace analysis filter options') {
        return [
          { filter: 'client', value: 'Бренд' },
          { filter: 'city', value: 'Москва' },
          { filter: 'region', value: 'Москва' },
          { filter: 'profession', value: 'Комплектовщик' },
          { filter: 'orderType', value: 'regular' },
          { filter: 'jobStatus', value: 'confirmed' },
          { filter: 'contractor', value: 'Ромашка' }
        ];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  };

  const dashboard = await loadWorkplaceAnalysisDashboardShell(
    client,
    {
      from: '2026-06-01',
      to: '2026-06-03',
      city: ['Москва', 'Казань'],
      orderType: ['regular', 'once']
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.deepEqual(calls.map((call) => call.operation), ['workplace analysis filter options']);
  assert.equal((calls[0].query.match(/FROM mg_orders AS o/g) || []).length, 2);
  assert.equal(calls[0].query.includes('ARRAY JOIN'), true);
  assert.equal(calls[0].query.includes('LEFT JOIN mg_workplaces AS ow'), false);
  assert.deepEqual(dashboard.filterOptions.city, ['Москва']);
  assert.deepEqual(dashboard.filters.city, ['Москва']);
  assert.deepEqual(dashboard.filters.orderType, ['regular']);
  assert.deepEqual(dashboard.points, []);
  assert.deepEqual(dashboard.pagination, {
    page: 1,
    limit: 12,
    totalWorkplaces: 0,
    totalPages: 1,
    hasPrevious: false,
    hasNext: false
  });
});

test('loadWorkplaceAnalysisDashboardSection loads and caches points independently', async () => {
  let timestamp = Date.parse('2026-06-15T12:00:00.000Z');
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'workplace analysis total workplaces') {
        return [{ total_workplaces: 13 }];
      }

      if (operation === 'workplace analysis top workplaces') {
        return [
          {
            workplace_id: 'wp1',
            workplace_title: 'Точка',
            client_title: 'Бренд',
            city: 'Москва',
            total_ordered_shifts: 9,
            active_days: 2
          }
        ];
      }

      if (operation === 'workplace analysis daily orders') {
        return [
          {
            workplace_id: 'wp1',
            order_date: '2026-06-01',
            ordered_shifts: 9,
            sla_ordered_shifts: 9,
            sla_completed_shifts: 8
          }
        ];
      }

      if (operation === 'workplace analysis active gigers 5km') {
        return [];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  };
  const cache = createDashboardSectionCache({ now: () => timestamp });
  const input = {
    from: '2026-06-01',
    to: '2026-06-03',
    city: 'Москва',
    limit: '12',
    page: '2'
  };

  const first = await loadWorkplaceAnalysisDashboardSection(
    client,
    input,
    'points',
    new Date('2026-06-15T12:00:00.000Z'),
    { cache }
  );
  const second = await loadWorkplaceAnalysisDashboardSection(
    client,
    input,
    'points',
    new Date('2026-06-15T12:00:00.000Z'),
    { cache }
  );

  assert.equal(first.points.length, 1);
  assert.equal(first.points[0].workplaceId, 'wp1');
  assert.equal(first.pagination.totalWorkplaces, 13);
  assert.equal(second.points[0].workplaceId, 'wp1');
  assert.deepEqual(calls.map((call) => call.operation), [
    'workplace analysis total workplaces',
    'workplace analysis top workplaces',
    'workplace analysis daily orders',
    'workplace analysis active gigers 5km'
  ]);

  timestamp = Date.parse('2026-06-16T00:00:00.000Z');

  await loadWorkplaceAnalysisDashboardSection(
    client,
    input,
    'points',
    new Date('2026-06-15T12:00:00.000Z'),
    { cache }
  );

  assert.deepEqual(calls.map((call) => call.operation), [
    'workplace analysis total workplaces',
    'workplace analysis top workplaces',
    'workplace analysis daily orders',
    'workplace analysis active gigers 5km',
    'workplace analysis total workplaces',
    'workplace analysis top workplaces',
    'workplace analysis daily orders',
    'workplace analysis active gigers 5km'
  ]);
});

test('loadWorkplaceAnalysisDashboardSection reads points from preload when available', async () => {
  const readCalls = [];
  const registerCalls = [];
  const client = {
    async queryJSONEachRow() {
      throw new Error('ClickHouse should not be queried on preload hit');
    }
  };
  const preloadService = {
    registerWorkplaceAnalysisRequest(input) {
      registerCalls.push(input);
    },
    readWorkplaceAnalysisSection(input) {
      readCalls.push(input);
      return {
        filters: {
          from: '2026-06-01',
          to: '2026-06-03',
          toExclusiveDateTime: '2026-06-04 00:00:00'
        },
        points: [{ workplaceId: 'wp1', totalOrderedShifts: 9 }],
        pagination: { totalWorkplaces: 1 }
      };
    }
  };

  const dashboard = await loadWorkplaceAnalysisDashboardSection(
    client,
    { from: '2026-06-01', to: '2026-06-03', city: 'Москва' },
    'points',
    new Date('2026-06-15T12:00:00.000Z'),
    { preloadService }
  );

  assert.equal(dashboard.dataSource, 'preload');
  assert.deepEqual(dashboard.points, [{ workplaceId: 'wp1', totalOrderedShifts: 9 }]);
  assert.equal(readCalls.length, 1);
  assert.equal(readCalls[0].section, 'points');
  assert.equal(readCalls[0].fromDate, '2026-06-01');
  assert.equal(readCalls[0].toDate, '2026-06-04');
  assert.equal(readCalls[0].cacheKey.includes('"section":"points"'), true);
  assert.equal(registerCalls.length, 1);
  assert.equal(registerCalls[0].section, 'points');
});

test('loadWorkplaceAnalysisDashboardSection reads attention from preload when available', async () => {
  const readCalls = [];
  const client = {
    async queryJSONEachRow() {
      throw new Error('ClickHouse should not be queried on preload hit');
    }
  };
  const preloadService = {
    registerWorkplaceAnalysisRequest() {},
    readWorkplaceAnalysisSection(input) {
      readCalls.push(input);
      return {
        filters: {
          attentionFrom: '2026-06-15',
          attentionTo: '2026-06-22',
          attentionToExclusiveDateTime: '2026-06-23 00:00:00'
        },
        attentionPoints: [{ workplaceId: 'wp1', free7d: 3 }]
      };
    }
  };

  const dashboard = await loadWorkplaceAnalysisDashboardSection(
    client,
    { city: 'Москва' },
    'attention',
    new Date('2026-06-15T12:00:00.000Z'),
    { preloadService }
  );

  assert.equal(dashboard.dataSource, 'preload');
  assert.deepEqual(dashboard.attentionPoints, [{ workplaceId: 'wp1', free7d: 3 }]);
  assert.equal(readCalls.length, 1);
  assert.equal(readCalls[0].section, 'attention');
  assert.equal(readCalls[0].fromDate, '2026-06-15');
  assert.equal(readCalls[0].toDate, '2026-06-23');
});

test('loadWorkplaceAnalysisDashboardSection registers request and falls back to ClickHouse on preload miss', async () => {
  const calls = [];
  const registerCalls = [];
  const saveCalls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'workplace analysis total workplaces') {
        return [{ total_workplaces: 1 }];
      }

      if (operation === 'workplace analysis top workplaces') {
        return [
          {
            workplace_id: 'wp1',
            workplace_title: 'Точка',
            client_title: 'Бренд',
            city: 'Москва',
            total_ordered_shifts: 9,
            active_days: 1
          }
        ];
      }

      if (operation === 'workplace analysis daily orders') {
        return [
          {
            workplace_id: 'wp1',
            order_date: '2026-06-01',
            ordered_shifts: 9,
            sla_ordered_shifts: 9,
            sla_completed_shifts: 8
          }
        ];
      }

      if (operation === 'workplace analysis active gigers 5km') {
        return [];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  };
  const preloadService = {
    registerWorkplaceAnalysisRequest(input) {
      registerCalls.push(input);
    },
    readWorkplaceAnalysisSection() {
      return null;
    },
    saveWorkplaceAnalysisSection(input) {
      saveCalls.push(input);
    }
  };

  const dashboard = await loadWorkplaceAnalysisDashboardSection(
    client,
    { from: '2026-06-01', to: '2026-06-03' },
    'points',
    new Date('2026-06-15T12:00:00.000Z'),
    { preloadService }
  );

  assert.equal(dashboard.dataSource, 'clickhouse');
  assert.equal(dashboard.points.length, 1);
  assert.deepEqual(calls.map((call) => call.operation), [
    'workplace analysis total workplaces',
    'workplace analysis top workplaces',
    'workplace analysis daily orders',
    'workplace analysis active gigers 5km'
  ]);
  assert.equal(registerCalls.length, 1);
  assert.equal(registerCalls[0].fromDate, '2026-06-01');
  assert.equal(registerCalls[0].toDate, '2026-06-04');
  assert.equal(saveCalls.length, 1);
  assert.equal(saveCalls[0].section, 'points');
  assert.equal(saveCalls[0].cacheKey, registerCalls[0].cacheKey);
  assert.equal(saveCalls[0].fromDate, '2026-06-01');
  assert.equal(saveCalls[0].toDate, '2026-06-04');
  assert.equal(saveCalls[0].payload.points.length, 1);
});

test('loadWorkplaceAnalysisDashboardSection loads attention tab with closing statuses and 15km base', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'workplace analysis attention points') {
        return [
          {
            workplace_id: 'wp1',
            workplace_title: 'Север',
            client_title: 'Бренд',
            city: 'Москва',
            street: 'Ленина 1',
            ordered_7d: 10,
            covered_7d: 4,
            free_7d: 6,
            free_professions_7d: ['Picker', 'Courier<script>'],
            free_profession_counts_7d: [4, 2],
            max_daily_free: 5,
            days_with_free: 2,
            nearest_free_date: '2026-06-04',
            total_workers_15km: 20,
            active_workers_30d_15km: 3,
            total_status_ready: 8,
            total_status_booked: 2,
            total_status_worked: 1,
            total_status_other: 9,
            active_status_ready: 2,
            active_status_booked: 1
          }
        ];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  };

  const dashboard = await loadWorkplaceAnalysisDashboardSection(
    client,
    {
      from: '2026-01-01',
      to: '2026-01-31',
      client: 'Бренд',
      city: 'Москва',
      search: 'Север; DROP TABLE mg_jobs'
    },
    'attention',
    new Date('2026-06-04T12:00:00.000Z')
  );
  const attentionCall = calls[0];

  assert.equal(dashboard.attentionPoints.length, 1);
  assert.equal(dashboard.attentionPoints[0].workplaceId, 'wp1');
  assert.equal(dashboard.attentionPoints[0].free7d, 6);
  assert.deepEqual(dashboard.attentionPoints[0].freeProfessions7d, [
    { profession: 'Picker', free7d: 4 },
    { profession: 'Courier<script>', free7d: 2 }
  ]);
  assert.equal(attentionCall.operation, 'workplace analysis attention points');
  assert.equal(attentionCall.params.param_from, '2026-06-04 00:00:00');
  assert.equal(attentionCall.params.param_to, '2026-06-12 00:00:00');
  assert.equal(attentionCall.params.param_active_from, '2026-05-05 00:00:00');
  assert.equal(attentionCall.params.param_active_to, '2026-06-05 00:00:00');
  assert.equal(attentionCall.params.param_clients, "['Бренд']");
  assert.equal(attentionCall.query.includes('completed'), true);
  assert.equal(attentionCall.query.includes('free_professions_7d'), true);
  assert.equal(attentionCall.query.includes('free_profession_counts_7d'), true);
  assert.equal(attentionCall.query.includes('doccheck'), false);
  assert.equal(attentionCall.query.includes('greatCircleDistance'), true);
  assert.equal(attentionCall.query.includes('<= 15000'), true);
  assert.equal(attentionCall.query.includes('influence_weight'), false);
  assert.equal(attentionCall.query.includes('appmetrica_sessions'), true);
  assert.equal(attentionCall.query.includes('DROP TABLE'), false);
});

test('loadWorkplaceAnalysisDashboardSection bounds attention worker pairs before aggregation', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'workplace analysis attention points') {
        return [];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  };

  await loadWorkplaceAnalysisDashboardSection(
    client,
    {},
    'attention',
    new Date('2026-06-04T12:00:00.000Z')
  );

  const attentionCall = calls[0];

  assert.equal(attentionCall.operation, 'workplace analysis attention points');
  assert.equal(attentionCall.query.includes('CROSS JOIN latest_workers'), false);
  assert.equal(attentionCall.query.includes('latest_workers AS'), false);
  assert.equal(attentionCall.query.includes('argMax('), false);
  assert.equal(attentionCall.query.includes('user_id IN (SELECT user_id FROM active_session_users)'), false);
  assert.equal(attentionCall.query.includes('point_search_cells AS'), true);
  assert.equal(attentionCall.query.includes('worker_candidates AS'), true);
  assert.equal(attentionCall.query.includes('candidate_users AS'), true);
  assert.equal(attentionCall.query.includes('point_worker_users AS'), true);
  assert.equal(attentionCall.query.includes('GROUP BY workplace_id, user_id'), true);
  assert.equal(attentionCall.query.includes('uniqExact(pwp.user_id)'), false);
  assert.equal(attentionCall.query.includes('uniqExactIf(pwp.user_id'), false);
  assert.match(attentionCall.query, /worker_candidates AS \([\s\S]*FROM mg_workers AS worker\s+CROSS JOIN point_bounds AS bounds[\s\S]*WHERE bounds\.points > 0/s);
  assert.match(attentionCall.query, /INNER JOIN worker_candidates AS wc\s+ON wc\.lon_cell = psc\.lon_cell\s+AND wc\.lat_cell = psc\.lat_cell/);
  assert.match(attentionCall.query, /INNER JOIN candidate_users AS cu\s+ON cu\.user_id = ifNull\(s\.profile_id, ''\)/);
});

test('loadWorkplaceAnalysisDashboardSection ignores stale attention cache without profession breakdown', async () => {
  const now = new Date('2026-06-04T12:00:00.000Z');
  const input = {
    from: '2026-01-01',
    to: '2026-01-31',
    client: 'Бренд'
  };
  const filters = normalizeWorkplaceAttentionFilters(input, now);
  const staleCacheKey = JSON.stringify({
    board: 'workplace-analysis',
    section: 'attention',
    filters: {
      from: filters.from,
      to: filters.to,
      pinnedWorkplaceIds: filters.pinnedWorkplaceIds,
      client: filters.client,
      city: filters.city,
      region: filters.region,
      profession: filters.profession,
      orderType: filters.orderType,
      jobStatus: filters.jobStatus,
      contractor: filters.contractor,
      search: filters.search,
      includeDeletedOrders: filters.includeDeletedOrders,
      includeHiddenOrders: filters.includeHiddenOrders,
      sort: filters.sort,
      slaFrom: filters.slaFrom,
      slaTo: filters.slaTo,
      ordersFrom: filters.ordersFrom,
      ordersTo: filters.ordersTo,
      stabilityFrom: filters.stabilityFrom,
      stabilityTo: filters.stabilityTo,
      limit: filters.limit,
      page: filters.page,
      attentionPage: filters.attentionPage,
      attentionPageSize: filters.attentionPageSize,
      attentionSort: filters.attentionSort,
      attentionDirection: filters.attentionDirection,
      attentionLimit: filters.attentionLimit
    }
  });
  const cache = createDashboardSectionCache({
    now: () => Date.parse('2026-06-04T12:00:00.000Z')
  });

  await cache.getOrLoad(staleCacheKey, async () => ({
    filters,
    attentionPoints: [
      {
        workplaceId: 'stale-wp',
        free7d: 3
      }
    ],
    attentionPagination: {
      page: 1,
      pageSize: 15,
      totalWorkplaces: 1,
      totalPages: 1,
      hasPrevious: false,
      hasNext: false
    }
  }));

  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      return [
        {
          workplace_id: 'fresh-wp',
          workplace_title: 'Свежая точка',
          client_title: 'Бренд',
          ordered_7d: 8,
          covered_7d: 2,
          free_7d: 6,
          free_professions_7d: ['Picker'],
          free_profession_counts_7d: [6],
          max_daily_free: 6,
          days_with_free: 1,
          nearest_free_date: '2026-06-04'
        }
      ];
    }
  };

  const dashboard = await loadWorkplaceAnalysisDashboardSection(client, input, 'attention', now, { cache });

  assert.equal(calls.length, 1);
  assert.equal(dashboard.attentionPoints[0].workplaceId, 'fresh-wp');
  assert.deepEqual(dashboard.attentionPoints[0].freeProfessions7d, [{ profession: 'Picker', free7d: 6 }]);
});

test('loadWorkplaceAnalysisDashboardSection keeps attention cache independent from points pagination', async () => {
  const now = new Date('2026-06-04T12:00:00.000Z');
  const keys = [];
  const cache = {
    async getOrLoad(key) {
      keys.push(key);

      return {
        filters: normalizeWorkplaceAttentionFilters({ client: 'Brand' }, now),
        attentionPoints: [],
        attentionPagination: {
          page: 1,
          pageSize: 15,
          totalWorkplaces: 0,
          totalPages: 1,
          hasPrevious: false,
          hasNext: false
        }
      };
    }
  };
  const client = {
    async queryJSONEachRow() {
      throw new Error('attention cache should satisfy the request');
    }
  };

  await loadWorkplaceAnalysisDashboardSection(
    client,
    { client: 'Brand', page: '1', limit: '10', sort: 'sla', slaFrom: '50' },
    'attention',
    now,
    { cache }
  );
  await loadWorkplaceAnalysisDashboardSection(
    client,
    { client: 'Brand', page: '3', limit: '50', sort: 'stability', slaFrom: '80' },
    'attention',
    now,
    { cache }
  );

  const parsed = JSON.parse(keys[0]);

  assert.equal(keys[0], keys[1]);
  assert.equal(parsed.section, 'attention');
  assert.equal(parsed.filters.client[0], 'Brand');
  assert.equal(parsed.filters.attentionFrom, '2026-06-04');
  assert.equal(Object.prototype.hasOwnProperty.call(parsed.filters, 'page'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed.filters, 'limit'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed.filters, 'sort'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed.filters, 'slaFrom'), false);
});

test('loadWorkplaceAnalysisDashboard keeps pinned workplaces above filtered and sorted results', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'workplace analysis filter options') {
        return [
          { filter: 'client', value: 'Filtered Brand' },
          { filter: 'city', value: 'Москва' },
          { filter: 'region', value: 'Москва' },
          { filter: 'profession', value: 'Комплектовщик' },
          { filter: 'orderType', value: 'regular' },
          { filter: 'jobStatus', value: 'confirmed' },
          { filter: 'contractor', value: 'Ромашка' }
        ];
      }

      if (operation === 'workplace analysis total workplaces') {
        return [{ total_workplaces: 1 }];
      }

      if (operation === 'workplace analysis top workplaces') {
        return [
          {
            workplace_id: 'wp-regular',
            workplace_title: 'Filtered point',
            client_title: 'Filtered Brand',
            city: 'Москва',
            total_ordered_shifts: 5,
            active_days: 1
          }
        ];
      }

      if (operation === 'workplace analysis pinned workplaces') {
        return [
          {
            workplace_id: 'wp-pin',
            workplace_title: 'Pinned point',
            client_title: 'Other Brand',
            city: 'Казань',
            total_ordered_shifts: 7,
            active_days: 1
          }
        ];
      }

      if (operation === 'workplace analysis pinned daily orders') {
        return [
          {
            workplace_id: 'wp-pin',
            order_date: '2026-06-01',
            ordered_shifts: 7,
            completed_shifts: 6,
            sla_ordered_shifts: 7,
            sla_completed_shifts: 6
          }
        ];
      }

      if (operation === 'workplace analysis daily orders') {
        return [
          {
            workplace_id: 'wp-regular',
            order_date: '2026-06-01',
            ordered_shifts: 5,
            completed_shifts: 4,
            sla_ordered_shifts: 5,
            sla_completed_shifts: 4
          }
        ];
      }

      if (operation === 'workplace analysis active gigers 5km') {
        return [];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  };

  const dashboard = await loadWorkplaceAnalysisDashboard(
    client,
    {
      from: '2026-06-01',
      to: '2026-06-01',
      pinnedWorkplaceId: 'wp-pin',
      client: 'Filtered Brand',
      city: 'Москва',
      region: 'Москва',
      profession: 'Комплектовщик',
      orderType: 'regular',
      jobStatus: 'confirmed',
      contractor: 'Ромашка',
      search: 'North hub',
      sort: 'sla',
      slaFrom: '50',
      stabilityTo: '90'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );
  const totalCall = calls.find((call) => call.operation === 'workplace analysis total workplaces');
  const topCall = calls.find((call) => call.operation === 'workplace analysis top workplaces');
  const pinnedCall = calls.find((call) => call.operation === 'workplace analysis pinned workplaces');
  const pinnedDailyCall = calls.find((call) => call.operation === 'workplace analysis pinned daily orders');
  const regularDailyCall = calls.find((call) => call.operation === 'workplace analysis daily orders');

  assert.equal(dashboard.points.length, 2);
  assert.equal(dashboard.points[0].workplaceId, 'wp-pin');
  assert.equal(dashboard.points[0].pinned, true);
  assert.equal(dashboard.points[1].workplaceId, 'wp-regular');
  assert.equal(dashboard.points[1].pinned, false);
  assert.deepEqual(dashboard.filters.pinnedWorkplaceIds, ['wp-pin']);

  assert.equal(totalCall.query.includes('o.workplace NOT IN {pinned_workplace_ids:Array(String)}'), true);
  assert.equal(topCall.query.includes('o.workplace NOT IN {pinned_workplace_ids:Array(String)}'), true);
  assert.equal(regularDailyCall.query.includes('o.workplace NOT IN {pinned_workplace_ids:Array(String)}'), true);
  assert.equal(regularDailyCall.params.param_workplace_ids, "['wp-regular']");

  assert.equal(pinnedCall.params.param_pinned_workplace_ids, "['wp-pin']");
  assert.equal(pinnedCall.params.param_professions, "['Комплектовщик']");
  assert.equal(pinnedDailyCall.params.param_workplace_ids, "['wp-pin']");
  assert.equal(pinnedDailyCall.params.param_pinned_workplace_ids, "['wp-pin']");
  assert.equal(pinnedDailyCall.params.param_professions, "['Комплектовщик']");

  for (const call of [pinnedCall, pinnedDailyCall]) {
    assert.equal(call.query.includes('o.workplace IN {pinned_workplace_ids:Array(String)}'), true);
    assert.equal(call.query.includes("if(ifNull(p.caption, '') = '', o.spec, p.caption) IN {professions:Array(String)}"), true);
    assert.equal(call.query.includes('ifNull(o.deleted, 0) = 0'), true);
    assert.equal(call.query.includes('ifNull(o.is_hidden, 0) = 0'), true);
    assert.equal(call.query.includes('IN {clients:Array(String)}'), false);
    assert.equal(call.query.includes('IN {cities:Array(String)}'), false);
    assert.equal(call.query.includes('IN {regions:Array(String)}'), false);
    assert.equal(call.query.includes('IN {order_types:Array(String)}'), false);
    assert.equal(call.query.includes('IN {job_statuses:Array(String)}'), false);
    assert.equal(call.query.includes('IN {contractors:Array(String)}'), false);
    assert.equal(call.query.includes('positionCaseInsensitive'), false);
    assert.equal(call.query.includes('metrics.sla_percent >= {sla_from:Float64}'), false);
    assert.equal(call.query.includes('metrics.stability_percent <= {stability_to:Float64}'), false);
    assert.equal(call.query.includes('ORDER BY sla_sort DESC'), false);
  }
});

test('loadWorkplaceAnalysisDashboard constrains workplace metrics to actual non-fake non-processing orders', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'workplace analysis total workplaces') {
        return [{ total_workplaces: 1 }];
      }

      if (operation === 'workplace analysis top workplaces') {
        return [
          {
            workplace_id: 'wp-domain',
            workplace_title: 'Domain point',
            total_ordered_shifts: 1,
            active_days: 1
          }
        ];
      }

      return [];
    }
  };

  await loadWorkplaceAnalysisDashboard(
    client,
    {
      from: '2026-06-01',
      to: '2026-06-30'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  const orderMetricCalls = calls.filter((call) =>
    [
      'workplace analysis filter options',
      'workplace analysis total workplaces',
      'workplace analysis top workplaces',
      'workplace analysis daily orders'
    ].includes(call.operation)
  );

  for (const call of orderMetricCalls) {
    assert.equal(call.query.includes('INNER JOIN mg_clients AS c ON c._id = o.client'), true);
    assert.equal(call.query.includes('LEFT JOIN mg_workplaces AS w ON w._id = o.workplace'), true);
    assert.equal(call.query.includes('LEFT JOIN mg_workplaces AS ow ON ow._id = o.workplace'), false);
    assert.equal(call.query.includes('LEFT JOIN mg_contractors AS ct ON ct._id = w.contractor'), true);
    assert.equal(call.query.includes('c.title IS NULL OR c.title NOT IN'), true);
    assert.equal(call.query.includes("ifNull(ct.contract_type, ifNull(o.contract_type, '')) != 'processing'"), true);
  }

  const topCall = calls.find((call) => call.operation === 'workplace analysis top workplaces');
  const dailyCall = calls.find((call) => call.operation === 'workplace analysis daily orders');

  for (const call of [topCall, dailyCall]) {
    assert.equal(call.query.includes('INNER JOIN mg_orders AS actual_order ON actual_order._id = j.source'), false);
    assert.equal(call.query.includes('actual_order.deleted = 0'), false);
    assert.equal(call.query.includes('ifNull(actual_order.is_hidden, false) = false'), false);
    assert.equal(call.query.includes('INNER JOIN mg_clients AS actual_client ON actual_client._id = actual_order.client'), false);
    assert.equal(call.query.includes('LEFT JOIN mg_contractors AS actual_contractor'), false);
    assert.equal(call.query.includes('actual_client.title IS NULL OR actual_client.title NOT IN'), false);
    assert.equal(call.query.includes("ifNull(actual_contractor.contract_type, ifNull(actual_order.contract_type, '')) != 'processing'"), false);
    assert.equal(call.query.includes('toString(o.pieceworks)'), true);
    assert.equal(call.query.includes('j.piecework'), false);
  }
});

test('loadWorkplaceAnalysisDashboard adds cached active gigers and refreshes stale workplace values', async () => {
  const calls = [];
  const writtenCacheValues = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'workplace analysis filter options') {
        return [];
      }

      if (operation === 'workplace analysis total workplaces') {
        return [{ total_workplaces: 3 }];
      }

      if (operation === 'workplace analysis top workplaces') {
        return [
          {
            workplace_id: 'wp1',
            workplace_title: 'Point 1',
            total_ordered_shifts: 9,
            active_days: 2
          },
          {
            workplace_id: 'wp2',
            workplace_title: 'Point 2',
            total_ordered_shifts: 8,
            active_days: 1
          },
          {
            workplace_id: 'wp3',
            workplace_title: 'Point 3',
            total_ordered_shifts: 7,
            active_days: 1
          }
        ];
      }

      if (operation === 'workplace analysis daily orders') {
        return [
          {
            workplace_id: 'wp1',
            order_date: '2026-06-01',
            ordered_shifts: 9,
            sla_ordered_shifts: 9,
            sla_completed_shifts: 8
          },
          {
            workplace_id: 'wp2',
            order_date: '2026-06-01',
            ordered_shifts: 8,
            sla_ordered_shifts: 8,
            sla_completed_shifts: 6
          },
          {
            workplace_id: 'wp3',
            order_date: '2026-06-01',
            ordered_shifts: 7,
            sla_ordered_shifts: 7,
            sla_completed_shifts: 5
          }
        ];
      }

      if (operation === 'workplace analysis active gigers 5km') {
        return [{ workplace_id: 'wp2', active_gigers_5km: 9 }];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  };
  const activeGigersCache = {
    async readFresh(workplaceIds) {
      assert.deepEqual(workplaceIds, ['wp1', 'wp2', 'wp3']);

      return {
        values: new Map([['wp1', 5]]),
        staleWorkplaceIds: ['wp2', 'wp3']
      };
    },
    async writeValues(values) {
      writtenCacheValues.push(new Map(values));
    }
  };

  const dashboard = await loadWorkplaceAnalysisDashboard(
    client,
    {
      from: '2026-06-01',
      to: '2026-06-01'
    },
    new Date('2026-06-15T12:00:00.000Z'),
    { activeGigersCache }
  );
  const activeCall = calls.find((call) => call.operation === 'workplace analysis active gigers 5km');

  assert.equal(dashboard.points[0].activeGigers5km, 5);
  assert.equal(dashboard.points[1].activeGigers5km, 9);
  assert.equal(dashboard.points[2].activeGigers5km, 0);
  assert.deepEqual(writtenCacheValues[0], new Map([
    ['wp2', 9],
    ['wp3', 0]
  ]));
  assert.equal(activeCall.params.param_workplace_ids, "['wp2','wp3']");
  assert.equal(activeCall.query.includes('appmetrica_sessions'), true);
  assert.equal(activeCall.query.includes('mg_workers'), true);
  assert.equal(activeCall.query.includes("ifNull(worker.status, '') IN ('ready', 'worked', 'booked')"), true);
  assert.equal(activeCall.query.includes('parseDateTimeBestEffortOrNull(s.session_start_datetime) >= now() - INTERVAL 30 DAY'), true);
  assert.equal(activeCall.query.includes('CROSS JOIN active_workers AS aw'), false);
  assert.equal(activeCall.query.includes('candidate_users AS'), true);
  assert.equal(activeCall.query.includes('point_worker_pairs AS'), true);
  assert.match(activeCall.query, /INNER JOIN worker_candidates AS wc\s+ON wc\.lon_cell = wsc\.lon_cell\s+AND wc\.lat_cell = wsc\.lat_cell/);
  assert.match(activeCall.query, /INNER JOIN candidate_users AS cu\s+ON cu\.user_id = ifNull\(s\.profile_id, ''\)/);
  assert.equal(activeCall.query.includes('wc.worker_coordinates[1] BETWEEN wsc.lon -'), true);
  assert.equal(activeCall.query.includes('wc.worker_coordinates[2] BETWEEN wsc.lat -'), true);
  assert.equal(activeCall.query.includes('greatCircleDistance'), true);
});

test('loadWorkplaceAnalysisDashboard loads active gigers directly when cache is disabled', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'workplace analysis filter options') {
        return [];
      }

      if (operation === 'workplace analysis total workplaces') {
        return [{ total_workplaces: 2 }];
      }

      if (operation === 'workplace analysis top workplaces') {
        return [
          {
            workplace_id: 'wp1',
            workplace_title: 'Point 1',
            total_ordered_shifts: 9,
            active_days: 2
          },
          {
            workplace_id: 'wp2',
            workplace_title: 'Point 2',
            total_ordered_shifts: 8,
            active_days: 1
          }
        ];
      }

      if (operation === 'workplace analysis daily orders') {
        return [];
      }

      if (operation === 'workplace analysis active gigers 5km') {
        return [
          { workplace_id: 'wp1', active_gigers_5km: 4 },
          { workplace_id: 'wp2', active_gigers_5km: 7 }
        ];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  };

  const dashboard = await loadWorkplaceAnalysisDashboard(
    client,
    {
      from: '2026-06-01',
      to: '2026-06-01'
    },
    new Date('2026-06-15T12:00:00.000Z'),
    { activeGigersCache: null }
  );
  const activeCall = calls.find((call) => call.operation === 'workplace analysis active gigers 5km');

  assert.equal(dashboard.points[0].activeGigers5km, 4);
  assert.equal(dashboard.points[1].activeGigers5km, 7);
  assert.equal(activeCall.params.param_workplace_ids, "['wp1','wp2']");
});

test('loadWorkplaceAnalysisDashboard applies SLA and stability sort before pagination', async () => {
  const scenarios = [
    {
      sort: 'sla',
      orderBy: 'ORDER BY sla_sort DESC, total_ordered_shifts DESC, workplace_id ASC'
    },
    {
      sort: 'stability',
      orderBy: 'ORDER BY active_days DESC, total_ordered_shifts DESC, workplace_id ASC'
    }
  ];

  for (const scenario of scenarios) {
    const calls = [];
    const client = {
      async queryJSONEachRow(query, params, operation) {
        calls.push({ query, params, operation });

        if (operation === 'workplace analysis total workplaces') {
          return [{ total_workplaces: 0 }];
        }

        return [];
      }
    };

    const dashboard = await loadWorkplaceAnalysisDashboard(
      client,
      {
        from: '2026-06-01',
        to: '2026-06-30',
        sort: scenario.sort,
        limit: '10',
        page: '2'
      },
      new Date('2026-06-15T12:00:00.000Z')
    );
    const topCall = calls.find((call) => call.operation === 'workplace analysis top workplaces');
    const dailyCall = calls.find((call) => call.operation === 'workplace analysis daily orders');

    assert.equal(dashboard.filters.sort, scenario.sort);
    assert.equal(topCall.query.includes('sla_ordered_shifts'), true);
    assert.equal(topCall.query.includes('sla_completed_shifts'), true);
    assert.equal(topCall.query.includes('sla_sort'), true);
    assert.equal(topCall.query.includes(scenario.orderBy), true);
    assert.equal(dailyCall, undefined);
  }
});

test('loadWorkplaceAnalysisDashboard applies metric range filters before pagination', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'workplace analysis total workplaces') {
        return [{ total_workplaces: 1 }];
      }

      if (operation === 'workplace analysis top workplaces') {
        return [
          {
            workplace_id: 'wp-visible',
            workplace_title: 'Visible point',
            total_ordered_shifts: 1,
            active_days: 1
          }
        ];
      }

      return [];
    }
  };

  const dashboard = await loadWorkplaceAnalysisDashboard(
    client,
    {
      from: '2026-06-01',
      to: '2026-06-30',
      slaFrom: '50',
      slaTo: '95',
      ordersFrom: '10',
      ordersTo: '100',
      stabilityFrom: '25',
      stabilityTo: '90',
      limit: '10',
      page: '2'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );
  const filteredCalls = calls.filter((call) =>
    !['workplace analysis filter options', 'workplace analysis active gigers 5km'].includes(call.operation)
  );

  assert.equal(dashboard.filters.slaFrom, 50);
  assert.equal(dashboard.filters.slaTo, 95);
  assert.equal(dashboard.filters.ordersFrom, 10);
  assert.equal(dashboard.filters.ordersTo, 100);
  assert.equal(dashboard.filters.stabilityFrom, 25);
  assert.equal(dashboard.filters.stabilityTo, 90);

  for (const call of filteredCalls.filter((item) => item.operation !== 'workplace analysis daily orders')) {
    assert.equal(call.params.param_sla_from, 50);
    assert.equal(call.params.param_sla_to, 95);
    assert.equal(call.params.param_orders_from, 10);
    assert.equal(call.params.param_orders_to, 100);
    assert.equal(call.params.param_stability_from, 25);
    assert.equal(call.params.param_stability_to, 90);
    assert.equal(call.params.param_range_days, 30);
    assert.equal(call.query.includes('metrics.sla_percent >= {sla_from:Float64}'), true);
    assert.equal(call.query.includes('metrics.sla_percent <= {sla_to:Float64}'), true);
    assert.equal(call.query.includes('metrics.total_ordered_shifts >= {orders_from:Float64}'), true);
    assert.equal(call.query.includes('metrics.total_ordered_shifts <= {orders_to:Float64}'), true);
    assert.equal(call.query.includes('metrics.stability_percent >= {stability_from:Float64}'), true);
    assert.equal(call.query.includes('metrics.stability_percent <= {stability_to:Float64}'), true);
  }

  const dailyCall = filteredCalls.find((call) => call.operation === 'workplace analysis daily orders');

  assert.equal(dailyCall.params.param_workplace_ids, "['wp-visible']");
  assert.equal(dailyCall.query.includes('metrics.sla_percent >= {sla_from:Float64}'), false);
  assert.equal(dailyCall.query.includes('metrics.total_ordered_shifts >= {orders_from:Float64}'), false);
  assert.equal(dailyCall.query.includes('metrics.stability_percent >= {stability_from:Float64}'), false);
});

test('loadWorkplaceAnalysisDashboard can include deleted and hidden orders', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'workplace analysis total workplaces') {
        return [{ total_workplaces: 1 }];
      }

      if (operation === 'workplace analysis top workplaces') {
        return [
          {
            workplace_id: 'wp-visible',
            workplace_title: 'Visible point',
            total_ordered_shifts: 1,
            active_days: 1
          }
        ];
      }

      return [];
    }
  };

  const dashboard = await loadWorkplaceAnalysisDashboard(
    client,
    {
      from: '2026-06-01',
      to: '2026-06-01',
      includeDeletedOrders: '1',
      includeHiddenOrders: '1'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.equal(dashboard.filters.includeDeletedOrders, true);
  assert.equal(dashboard.filters.includeHiddenOrders, true);

  for (const call of calls.filter((item) =>
    ['workplace analysis filter options', 'workplace analysis total workplaces'].includes(item.operation)
  )) {
    assert.equal(call.query.includes('ifNull(o.deleted, 0) = 0'), false);
    assert.equal(call.query.includes('ifNull(o.is_hidden, 0) = 0'), false);
  }

  const topCall = calls.find((item) => item.operation === 'workplace analysis top workplaces');
  const dailyCall = calls.find((item) => item.operation === 'workplace analysis daily orders');

  assert.equal(topCall.query.includes('sla_ordered_shifts'), true);
  assert.equal(topCall.query.includes('sla_completed_shifts'), true);
  assert.equal(dailyCall.query.includes('sla_ordered_shifts'), true);
  assert.equal(dailyCall.query.includes('sla_completed_shifts'), true);
  assert.equal(dailyCall.query.includes('ifNull(o.deleted, 0) = 0'), true);
  assert.equal(dailyCall.query.includes('ifNull(o.is_hidden, 0) = 0'), true);
});

test('loadWorkplaceAnalysisDashboard uses total count for pagination', async () => {
  const calls = [];
  const workplaceRows = Array.from({ length: 10 }, (_, index) => {
    const number = index + 1;

    return {
      workplace_id: `wp${number}`,
      workplace_title: `Point ${number}`,
      technical_name: `tech-${number}`,
      client_title: 'Brand',
      city: 'Moscow',
      region: 'Moscow',
      street: `Street ${number}`,
      total_ordered_shifts: 100 - index,
      active_days: 1
    };
  });
  const dailyRows = workplaceRows.map((row) => ({
    workplace_id: row.workplace_id,
    order_date: '2026-06-01',
    ordered_shifts: 10
  }));
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'workplace analysis filter options') {
        return [];
      }

      if (operation === 'workplace analysis total workplaces') {
        return [{ total_workplaces: 101 }];
      }

      if (operation === 'workplace analysis top workplaces') {
        return workplaceRows;
      }

      if (operation === 'workplace analysis daily orders') {
        return dailyRows;
      }

      if (operation === 'workplace analysis active gigers 5km') {
        return [];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  };

  const dashboard = await loadWorkplaceAnalysisDashboard(
    client,
    {
      from: '2026-06-01',
      to: '2026-06-01',
      limit: '10',
      page: '3'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );
  const pagedCalls = calls.filter((call) => call.operation !== 'workplace analysis filter options');

  assert.equal(dashboard.points.length, 10);
  assert.equal(dashboard.context.maxDailyAmount, 10);
  assert.deepEqual(dashboard.pagination, {
    page: 3,
    limit: 10,
    totalWorkplaces: 101,
    totalPages: 11,
    hasPrevious: true,
    hasNext: true
  });

  assert.equal(pagedCalls[0].operation, 'workplace analysis total workplaces');

  const topCall = pagedCalls.find((call) => call.operation === 'workplace analysis top workplaces');
  const dailyCall = pagedCalls.find((call) => call.operation === 'workplace analysis daily orders');

  assert.equal(topCall.params.param_limit, 10);
  assert.equal(topCall.params.param_offset, 20);
  assert.equal(topCall.query.includes('LIMIT {limit:UInt64} OFFSET {offset:UInt64}'), true);
  assert.equal(dailyCall.params.param_workplace_ids, "['wp1','wp2','wp3','wp4','wp5','wp6','wp7','wp8','wp9','wp10']");
  assert.equal(dailyCall.query.includes('LIMIT {limit:UInt64} OFFSET {offset:UInt64}'), false);
});
