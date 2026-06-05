const test = require('node:test');
const assert = require('node:assert/strict');

const {
  loadWorkplacePointDashboard,
  loadWorkplacePointDashboardSection,
  loadWorkplacePointDashboardShell,
  loadWorkplacePointDayDetails,
  loadWorkplacePointGigerDetails,
  mergeWorkplacePointDayDetails,
  mergeWorkplacePointRows,
  normalizeWorkplacePointGigerDetailsInput,
  normalizeWorkplacePointDayDetailsInput,
  normalizeWorkplacePointFilters
} = require('../src/workplacePointDashboard');

const { createDashboardSectionCache } = require('../src/dashboardSectionCache');

test('normalizeWorkplacePointFilters keeps workplace id and supported filters', () => {
  const filters = normalizeWorkplacePointFilters(
    {
      workplaceId: ' wp1 ',
      from: '2026-06-01',
      to: '2026-06-30',
      profession: ['picker', 'driver', 'picker', ' '],
      orderType: ['regular', 'once', 'bad'],
      jobStatus: ['confirmed', 'failed', 'confirmed'],
      includeDeletedOrders: '1',
      includeHiddenOrders: 'on'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.equal(filters.workplaceId, 'wp1');
  assert.equal(filters.from, '2026-06-01');
  assert.equal(filters.to, '2026-06-30');
  assert.equal(filters.toExclusiveDateTime, '2026-07-01 00:00:00');
  assert.deepEqual(filters.profession, ['picker', 'driver']);
  assert.deepEqual(filters.orderType, ['regular', 'once']);
  assert.deepEqual(filters.jobStatus, ['confirmed', 'failed']);
  assert.equal(filters.includeDeletedOrders, true);
  assert.equal(filters.includeHiddenOrders, true);
});

test('normalizeWorkplacePointGigerDetailsInput validates point metrics and keeps page size at 20', () => {
  const details = normalizeWorkplacePointGigerDetailsInput(
    {
      workplaceId: ' wp1 ',
      metric: 'radius-active-session-workers',
      radiusKm: '10',
      page: '3'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.equal(details.workplaceId, 'wp1');
  assert.equal(details.metric, 'radius-active-session-workers');
  assert.equal(details.metricLabel, 'Активные в радиусе');
  assert.equal(details.radiusKm, 10);
  assert.equal(details.page, 3);
  assert.equal(details.pageSize, 20);
  assert.equal(details.offset, 40);
  assert.equal(details.export, false);
});

test('loadWorkplacePointGigerDetails loads completed workers with safe filters', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'workplace point giger details total') {
        return [{ total_gigers: 22 }];
      }

      if (operation === 'workplace point giger details') {
        return [
          {
            user_id: 'user-1',
            worker_id: 'worker-1',
            full_name: 'Иван Петров',
            phone: '+79990000000',
            status: 'worked'
          }
        ];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  };

  const details = await loadWorkplacePointGigerDetails(
    client,
    {
      workplaceId: 'wp1; DROP TABLE mg_jobs',
      metric: 'unique-completed-workers',
      page: '2',
      profession: 'Комплектовщик',
      orderType: 'regular'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.equal(details.metricLabel, 'Завершавшие');
  assert.equal(details.pagination.page, 2);
  assert.equal(details.pagination.pageSize, 20);
  assert.equal(details.pagination.totalGigers, 22);
  assert.deepEqual(details.gigers, [
    {
      userId: 'user-1',
      workerId: 'worker-1',
      fullName: 'Иван Петров',
      phone: '+79990000000',
      status: 'worked'
    }
  ]);

  for (const call of calls) {
    assert.equal(call.params.param_workplace_id, 'wp1; DROP TABLE mg_jobs');
    assert.equal(call.params.param_professions, "['Комплектовщик']");
    assert.equal(call.params.param_order_types, "['regular']");
    assert.equal(call.params.param_limit, 20);
    assert.equal(call.params.param_offset, 20);
    assert.equal(call.query.includes('shift_facts'), true);
    assert.equal(call.query.includes('is_successful_confirmed_shift = 1'), true);
    assert.equal(call.query.includes('mg_workers'), true);
    assert.equal(call.query.includes('mg_users'), true);
    assert.equal(call.query.includes('DROP TABLE'), false);
  }
});

test('loadWorkplacePointGigerDetails loads radius active-session workers by radius', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'workplace point giger details total') {
        return [{ total_gigers: 1 }];
      }

      if (operation === 'workplace point giger details') {
        return [{ user_id: 'user-2', worker_id: 'worker-2', full_name: 'Анна Иванова', phone: '', status: 'ready' }];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  };

  await loadWorkplacePointGigerDetails(
    client,
    {
      workplaceId: 'wp2',
      metric: 'radius-active-session-workers',
      radiusKm: '15'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  const detailsCall = calls.find((call) => call.operation === 'workplace point giger details');

  assert.equal(detailsCall.params.param_workplace_id, 'wp2');
  assert.equal(detailsCall.params.param_radius_m, 15000);
  assert.equal(detailsCall.params.param_active_session_from, '2026-05-16 12:00:00');
  assert.equal(detailsCall.params.param_active_session_to, '2026-06-15 12:00:00');
  assert.equal(detailsCall.query.includes('greatCircleDistance'), true);
  assert.equal(detailsCall.query.includes('user_id IN (SELECT user_id FROM active_session_users)'), true);
  assert.equal(detailsCall.query.includes('LIMIT {limit:UInt64} OFFSET {offset:UInt64}'), true);
});

test('normalizeWorkplacePointDayDetailsInput requires workplace id and valid date', () => {
  const input = normalizeWorkplacePointDayDetailsInput(
    {
      workplaceId: ' wp1 ',
      date: '2026-06-02',
      profession: ['picker'],
      orderType: ['regular'],
      jobStatus: ['confirmed'],
      includeHiddenOrders: '1'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.equal(input.filters.workplaceId, 'wp1');
  assert.equal(input.date, '2026-06-02');
  assert.equal(input.fromDateTime, '2026-06-02 00:00:00');
  assert.equal(input.toExclusiveDateTime, '2026-06-03 00:00:00');
  assert.deepEqual(input.filters.profession, ['picker']);
  assert.deepEqual(input.filters.orderType, ['regular']);
  assert.deepEqual(input.filters.jobStatus, ['confirmed']);
  assert.equal(input.filters.includeHiddenOrders, true);

  assert.throws(
    () => normalizeWorkplacePointDayDetailsInput({ date: '2026-06-02' }),
    (error) => error.status === 400 && /workplaceId/.test(error.message)
  );
  assert.throws(
    () => normalizeWorkplacePointDayDetailsInput({ workplaceId: 'wp1', date: 'bad' }),
    (error) => error.status === 400 && /date/.test(error.message)
  );
});

test('mergeWorkplacePointDayDetails maps confirmed and cancelled-only order rows', () => {
  const detailInput = normalizeWorkplacePointDayDetailsInput(
    { workplaceId: 'wp1', date: '2026-06-02' },
    new Date('2026-06-15T12:00:00.000Z')
  );
  const details = mergeWorkplacePointDayDetails(detailInput, [
    {
      order_id: 'order-1',
      job_id: 'job-1',
      profession: 'Комплектовщик',
      order_start_local: '2026-06-02 09:00:00',
      planned_hours: 8,
      worker_full_name: 'Иванов Иван',
      worker_phone: '+79990000000',
      confirmed_status: 'confirmed',
      actual_hours: 7.5,
      actual_time_local: '2026-06-02 09:10 - 2026-06-02 16:40',
      payment_amount: 4500,
      cancelled_shifts: 0,
      last_cancelled_at_local: ''
    },
    {
      order_id: 'order-2',
      job_id: '',
      profession: '',
      order_start_local: '2026-06-02 14:00:00',
      planned_hours: null,
      worker_full_name: '',
      worker_phone: '',
      confirmed_status: '',
      actual_hours: null,
      actual_time_local: '',
      payment_amount: null,
      cancelled_shifts: 2,
      last_cancelled_at_local: '2026-06-02 12:30:00'
    }
  ]);

  assert.equal(details.workplaceId, 'wp1');
  assert.equal(details.date, '2026-06-02');
  assert.equal(details.rows.length, 2);
  assert.deepEqual(details.rows[0], {
    orderId: 'order-1',
    jobId: 'job-1',
    profession: 'Комплектовщик',
    orderStartLocal: '2026-06-02 09:00:00',
    plannedHours: 8,
    workerFullName: 'Иванов Иван',
    workerPhone: '+79990000000',
    confirmedStatus: 'confirmed',
    actualHours: 7.5,
    actualTimeLocal: '2026-06-02 09:10 - 2026-06-02 16:40',
    paymentAmount: 4500,
    cancelledShifts: 0,
    lastCancelledAtLocal: ''
  });
  assert.deepEqual(details.rows[1], {
    orderId: 'order-2',
    jobId: '',
    profession: 'Без специальности',
    orderStartLocal: '2026-06-02 14:00:00',
    plannedHours: null,
    workerFullName: '',
    workerPhone: '',
    confirmedStatus: '',
    actualHours: null,
    actualTimeLocal: '',
    paymentAmount: 0,
    cancelledShifts: 2,
    lastCancelledAtLocal: '2026-06-02 12:30:00'
  });
});

test('mergeWorkplacePointRows maps summary, daily rows, professions, and radius rows', () => {
  const filters = normalizeWorkplacePointFilters(
    {
      workplaceId: 'wp1',
      from: '2026-06-01',
      to: '2026-06-02'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );
  const dashboard = mergeWorkplacePointRows(filters, {
    metadataRows: [
      {
        workplace_id: 'wp1',
        workplace_title: 'Point',
        technical_name: 'tech',
        client_title: 'Brand',
        city: 'Moscow',
        region: 'Moscow',
        street: 'Lenina 10'
      }
    ],
    filterOptionRows: [
      { filter: 'profession', value: 'picker' },
      { filter: 'orderType', value: 'regular' },
      { filter: 'jobStatus', value: 'confirmed' }
    ],
    summaryRows: [
      {
        ordered_shifts: 12,
        completed_shifts: 9,
        active_days: 2,
        unique_completed_workers: 5,
        unique_booked_workers: 8,
        dropoffs_24h: 2
      }
    ],
    dailyRows: [
      {
        period: '2026-06-01',
        ordered_shifts: 7,
        completed_shifts: 5,
        dropoffs_24h: 1,
        avg_order_lead_minutes: 2160,
        min_order_lead_minutes: 240
      },
      {
        period: '2026-06-02',
        ordered_shifts: 5,
        completed_shifts: 4,
        dropoffs_24h: 1,
        avg_order_lead_minutes: null,
        min_order_lead_minutes: null
      }
    ],
    professionRows: [
      {
        profession: 'picker',
        ordered_shifts: 9
      },
      {
        profession: 'driver',
        ordered_shifts: 3
      }
    ],
    radiusRows: [
      { radius_km: 5, workers: 11, active_session_workers: 4 },
      { radius_km: 10, workers: 23, active_session_workers: 9 },
      { radius_km: 15, workers: 31, active_session_workers: 12 },
      { radius_km: 20, workers: 45, active_session_workers: 18 }
    ]
  });

  assert.equal(dashboard.point.title, 'Point');
  assert.equal(dashboard.point.address, 'Moscow, Lenina 10');
  assert.equal(dashboard.summary.orderedShifts, 12);
  assert.equal(dashboard.summary.completedShifts, 9);
  assert.equal(dashboard.summary.slaPercent, 75);
  assert.equal(dashboard.summary.stabilityPercent, 100);
  assert.equal(dashboard.summary.uniqueCompletedWorkers, 5);
  assert.equal(dashboard.summary.uniqueBookedWorkers, 8);
  assert.equal(dashboard.summary.dropoffs24h, 2);
  assert.deepEqual(dashboard.summary.radiusWorkers, {
    5: 11,
    10: 23,
    15: 31,
    20: 45
  });
  assert.deepEqual(dashboard.summary.radiusActiveSessionWorkers, {
    5: 4,
    10: 9,
    15: 12,
    20: 18
  });
  assert.equal(dashboard.dailyRows[0].slaPercent, 71.42857142857143);
  assert.equal(dashboard.dailyRows[0].orderLeadAvgMinutes, 2160);
  assert.equal(dashboard.dailyRows[0].orderLeadMinMinutes, 240);
  assert.equal(dashboard.dailyRows[1].orderLeadAvgMinutes, null);
  assert.equal(dashboard.professionRows[0].sharePercent, 75);
  assert.deepEqual(dashboard.filterOptions.profession, ['picker']);
});

test('loadWorkplacePointDashboard queries point detail datasets with safe parameters', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'workplace point metadata') {
        return [{ workplace_id: 'wp1', workplace_title: 'Point' }];
      }
      if (operation === 'workplace point filter options') {
        return [
          { filter: 'profession', value: 'picker' },
          { filter: 'orderType', value: 'regular' },
          { filter: 'jobStatus', value: 'confirmed' }
        ];
      }
      if (operation === 'workplace point summary') {
        return [
          {
            ordered_shifts: 10,
            completed_shifts: 8,
            active_days: 2,
            unique_completed_workers: 4,
            unique_booked_workers: 6,
            dropoffs_24h: 1
          }
        ];
      }
      if (operation === 'workplace point daily') {
        return [
          {
            period: '2026-06-01',
            ordered_shifts: 10,
            completed_shifts: 8,
            dropoffs_24h: 1,
            avg_order_lead_minutes: 1440,
            min_order_lead_minutes: 60
          }
        ];
      }
      if (operation === 'workplace point professions') {
        return [{ profession: 'picker', ordered_shifts: 10 }];
      }
      if (operation === 'workplace point radius workers') {
        return [{ radius_km: 5, workers: 12, active_session_workers: 5 }];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  };

  const dashboard = await loadWorkplacePointDashboard(
    client,
    {
      workplaceId: 'wp1; DROP TABLE mg_orders',
      from: '2026-06-01',
      to: '2026-06-30',
      profession: ['picker'],
      orderType: ['regular'],
      jobStatus: ['confirmed']
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.equal(dashboard.filters.workplaceId, 'wp1; DROP TABLE mg_orders');
  assert.equal(dashboard.summary.slaPercent, 80);
  assert.equal(dashboard.summary.radiusActiveSessionWorkers[5], 5);
  assert.equal(dashboard.dailyRows[0].orderLeadAvgMinutes, 1440);
  assert.equal(dashboard.dailyRows[0].orderLeadMinMinutes, 60);
  assert.equal(calls.length, 6);

  for (const call of calls) {
    assert.equal(call.params.param_workplace_id, 'wp1; DROP TABLE mg_orders');
    assert.equal(call.params.param_from, '2026-06-01 00:00:00');
    assert.equal(call.params.param_to, '2026-07-01 00:00:00');
    assert.equal(call.params.param_active_session_from, '2026-05-16 12:00:00');
    assert.equal(call.params.param_active_session_to, '2026-06-15 12:00:00');
    assert.equal(call.query.includes('DROP TABLE'), false);
  }

  for (const call of calls.filter((item) =>
    item.operation !== 'workplace point metadata' && item.operation !== 'workplace point filter options'
  )) {
    assert.equal(call.params.param_professions, "['picker']");
    assert.equal(call.params.param_order_types, "['regular']");
    assert.equal(call.params.param_job_statuses, "['confirmed']");
  }

  for (const operation of ['workplace point summary', 'workplace point daily']) {
    const query = calls.find((call) => call.operation === operation).query;

    assert.equal(query.includes('mg_job_history'), true);
    assert.equal(query.includes("toFloat64OrZero(ifNull(toString(j.hours), ''))"), true);
    assert.equal(query.includes('ifNull(j.hours, 0) > 0'), false);
  }

  assert.equal(
    calls.find((call) => call.operation === 'workplace point daily').query.includes('avg_order_lead_minutes'),
    true
  );
  assert.equal(
    calls.find((call) => call.operation === 'workplace point daily').query.includes('min_order_lead_minutes'),
    true
  );

  assert.equal(
    calls.find((call) => call.operation === 'workplace point radius workers').query.includes('arrayJoin([5, 10, 15, 20])'),
    true
  );
  assert.equal(
    calls.find((call) => call.operation === 'workplace point radius workers').query.includes('appmetrica_sessions'),
    true
  );
  assert.equal(
    calls.find((call) => call.operation === 'workplace point radius workers').query.includes('active_session_workers'),
    true
  );
  assert.equal(
    calls.find((call) => call.operation === 'workplace point summary').query.includes('dropoffs_24h'),
    true
  );
});

test('loadWorkplacePointDayDetails queries selected day datasets with safe parameters', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'workplace point day orders') {
        return [
          {
            order_id: 'order-1',
            profession: 'Комплектовщик',
            order_start_local: '2026-06-02 09:00:00',
            planned_hours: 8
          },
          {
            order_id: 'order-2',
            profession: 'Курьер',
            order_start_local: '2026-06-02 14:00:00',
            planned_hours: 4
          }
        ];
      }

      if (operation === 'workplace point day jobs') {
        return [
          {
            order_id: 'order-1',
            job_id: 'job-1',
            status: 'confirmed',
            worker_id: 'worker-1',
            actual_hours: 7.5,
            is_factual: 1,
            actual_time_local: '2026-06-02 09:10 - 2026-06-02 16:40'
          },
          {
            order_id: 'order-2',
            job_id: 'job-2',
            status: 'cancelled',
            worker_id: '',
            actual_hours: null,
            is_factual: 0,
            actual_time_local: ''
          }
        ];
      }

      if (operation === 'workplace point day workers') {
        return [
          {
            worker_id: 'worker-1',
            worker_full_name: 'Иванов Иван',
            worker_phone: '+79990000000'
          }
        ];
      }

      if (operation === 'workplace point day payments') {
        return [{ job_id: 'job-1', payment_amount: 4500 }];
      }

      if (operation === 'workplace point day cancelled history') {
        return [{ job_id: 'job-2', last_cancelled_at_local: '2026-06-02 12:30:00' }];
      }

      return [];
    }
  };

  const details = await loadWorkplacePointDayDetails(
    client,
    {
      workplaceId: 'wp1; DROP TABLE mg_orders',
      date: '2026-06-02',
      profession: ['Комплектовщик'],
      orderType: ['regular'],
      jobStatus: ['confirmed', 'cancelled']
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.equal(details.rows.length, 2);
  assert.deepEqual(calls.map((call) => call.operation), [
    'workplace point day orders',
    'workplace point day jobs',
    'workplace point day workers',
    'workplace point day payments',
    'workplace point day cancelled history'
  ]);
  assert.equal(calls[0].params.param_workplace_id, 'wp1; DROP TABLE mg_orders');
  assert.equal(calls[0].params.param_from, '2026-06-02 00:00:00');
  assert.equal(calls[0].params.param_to, '2026-06-03 00:00:00');
  assert.equal(calls[0].params.param_professions, "['Комплектовщик']");
  assert.equal(calls[0].params.param_order_types, "['regular']");
  assert.equal(Object.prototype.hasOwnProperty.call(calls[0].params, 'param_job_statuses'), false);
  assert.equal(calls[1].params.param_job_statuses, "['confirmed','completed','cancelled']");
  assert.equal(calls[0].query.includes('DROP TABLE'), false);
  assert.equal(calls[0].query.includes('FROM mg_orders AS o'), true);
  assert.equal(calls[1].query.includes('FROM mg_jobs'), true);
  assert.equal(calls[1].query.includes('source IN {order_ids:Array(String)}'), true);
  assert.equal(calls[3].query.includes('arrayDistinct([ifNull(job, \'\'), ifNull(entityId, \'\')])'), true);
  assert.equal(calls[4].query.includes('FROM mg_job_history'), true);
  assert.deepEqual(details.rows[0], {
    orderId: 'order-1',
    jobId: 'job-1',
    profession: 'Комплектовщик',
    orderStartLocal: '2026-06-02 09:00:00',
    plannedHours: 8,
    workerFullName: 'Иванов Иван',
    workerPhone: '+79990000000',
    confirmedStatus: 'confirmed',
    actualHours: 7.5,
    actualTimeLocal: '2026-06-02 09:10 - 2026-06-02 16:40',
    paymentAmount: 4500,
    cancelledShifts: 0,
    lastCancelledAtLocal: ''
  });
  assert.deepEqual(details.rows[1], {
    orderId: 'order-2',
    jobId: '',
    profession: 'Курьер',
    orderStartLocal: '2026-06-02 14:00:00',
    plannedHours: 4,
    workerFullName: '',
    workerPhone: '',
    confirmedStatus: '',
    actualHours: null,
    actualTimeLocal: '',
    paymentAmount: 0,
    cancelledShifts: 1,
    lastCancelledAtLocal: '2026-06-02 12:30:00'
  });
});

test('loadWorkplacePointDayDetails keeps no-shift orders when job status filter is selected', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'workplace point day orders') {
        return [
          {
            order_id: 'order-without-jobs',
            profession: 'Сборщик',
            order_start_local: '2026-06-02 10:00:00',
            planned_hours: 6
          }
        ];
      }

      return [];
    }
  };

  const details = await loadWorkplacePointDayDetails(
    client,
    {
      workplaceId: 'wp1',
      date: '2026-06-02',
      jobStatus: ['confirmed']
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.equal(details.rows.length, 1);
  assert.equal(details.rows[0].orderId, 'order-without-jobs');
  assert.equal(details.rows[0].profession, 'Сборщик');
  assert.equal(details.rows[0].jobId, '');
  assert.deepEqual(calls.map((call) => call.operation), [
    'workplace point day orders',
    'workplace point day jobs'
  ]);
  assert.equal(Object.prototype.hasOwnProperty.call(calls[0].params, 'param_job_statuses'), false);
  assert.equal(calls[1].params.param_job_statuses, "['confirmed','completed']");
});

test('loadWorkplacePointDayDetails treats completed factual shifts as detail rows', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'workplace point day orders') {
        return [
          {
            order_id: 'order-1',
            profession: 'picker',
            order_start_local: '2026-06-02 09:00:00',
            planned_hours: 8
          }
        ];
      }

      if (operation === 'workplace point day jobs') {
        return [
          {
            order_id: 'order-1',
            job_id: 'job-1',
            status: 'completed',
            worker_id: 'worker-1',
            actual_hours: 7.5,
            is_factual: 1,
            actual_time_local: '2026-06-02 09:10 - 2026-06-02 16:40'
          }
        ];
      }

      if (operation === 'workplace point day workers') {
        return [
          {
            worker_id: 'worker-1',
            worker_full_name: 'Worker Name',
            worker_phone: '+79990000000'
          }
        ];
      }

      if (operation === 'workplace point day payments') {
        return [{ job_id: 'job-1', payment_amount: 4500 }];
      }

      return [];
    }
  };

  const details = await loadWorkplacePointDayDetails(
    client,
    {
      workplaceId: 'wp1',
      date: '2026-06-02',
      jobStatus: ['completed']
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.equal(details.rows[0].confirmedStatus, 'completed');
  assert.equal(details.rows[0].workerFullName, 'Worker Name');
  assert.equal(details.rows[0].workerPhone, '+79990000000');
  assert.equal(details.rows[0].actualHours, 7.5);
  assert.equal(details.rows[0].paymentAmount, 4500);
  assert.deepEqual(calls.map((call) => call.operation), [
    'workplace point day orders',
    'workplace point day jobs',
    'workplace point day workers',
    'workplace point day payments'
  ]);
  assert.equal(calls[1].params.param_job_statuses, "['completed']");
  assert.equal(calls[1].query.includes("ifNull(status, '') IN ('confirmed', 'completed')"), true);
  assert.equal(calls[1].query.includes('hours AS actual_hours'), true);
});

test('loadWorkplacePointDayDetails keeps completed factual shifts when confirmed filter is selected', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'workplace point day orders') {
        return [
          {
            order_id: 'order-1',
            profession: 'cook',
            order_start_local: '2026-06-04 06:00:00',
            planned_hours: 8.3
          }
        ];
      }

      if (operation === 'workplace point day jobs') {
        if (params.param_job_statuses !== "['confirmed','completed']") {
          return [];
        }

        return [
          {
            order_id: 'order-1',
            job_id: 'job-1',
            status: 'completed',
            worker_id: 'worker-1',
            actual_hours: 8.3,
            is_factual: 1,
            actual_time_local: '2026-06-04 06:03 - 2026-06-04 15:29'
          }
        ];
      }

      if (operation === 'workplace point day workers') {
        return [
          {
            worker_id: 'worker-1',
            worker_full_name: 'Worker Name',
            worker_phone: '+79990000000'
          }
        ];
      }

      if (operation === 'workplace point day payments') {
        return [{ job_id: 'job-1', payment_amount: 0 }];
      }

      return [];
    }
  };

  const details = await loadWorkplacePointDayDetails(
    client,
    {
      workplaceId: 'wp1',
      date: '2026-06-04',
      jobStatus: ['confirmed']
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.equal(details.rows[0].confirmedStatus, 'completed');
  assert.equal(details.rows[0].workerFullName, 'Worker Name');
  assert.equal(details.rows[0].actualHours, 8.3);
  assert.equal(details.rows[0].actualTimeLocal, '2026-06-04 06:03 - 2026-06-04 15:29');
  assert.equal(calls[1].params.param_job_statuses, "['confirmed','completed']");
});

test('loadWorkplacePointDayDetails keeps completed shifts without factual interval details', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'workplace point day orders') {
        return [
          {
            order_id: 'order-1',
            profession: 'picker',
            order_start_local: '2026-06-04 10:00:00',
            planned_hours: 11
          }
        ];
      }

      if (operation === 'workplace point day jobs') {
        return [
          {
            order_id: 'order-1',
            job_id: 'job-1',
            status: 'completed',
            worker_id: 'worker-1',
            actual_hours: 11,
            is_factual: 0,
            actual_time_local: ''
          }
        ];
      }

      if (operation === 'workplace point day workers') {
        return [
          {
            worker_id: 'worker-1',
            worker_full_name: 'Worker Name',
            worker_phone: '+79990000000'
          }
        ];
      }

      if (operation === 'workplace point day payments') {
        return [{ job_id: 'job-1', payment_amount: 2200 }];
      }

      return [];
    }
  };

  const details = await loadWorkplacePointDayDetails(
    client,
    {
      workplaceId: 'wp1',
      date: '2026-06-04',
      jobStatus: ['confirmed']
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.equal(details.rows[0].confirmedStatus, 'completed');
  assert.equal(details.rows[0].workerFullName, 'Worker Name');
  assert.equal(details.rows[0].workerPhone, '+79990000000');
  assert.equal(details.rows[0].actualHours, 11);
  assert.equal(details.rows[0].actualTimeLocal, '');
  assert.equal(details.rows[0].paymentAmount, 2200);
  assert.deepEqual(calls.map((call) => call.operation), [
    'workplace point day orders',
    'workplace point day jobs',
    'workplace point day workers',
    'workplace point day payments'
  ]);
});

test('loadWorkplacePointDayDetails treats zero-duration zero-payment confirmed shifts as absences', async () => {
  const client = {
    async queryJSONEachRow(query, params, operation) {
      if (operation === 'workplace point day orders') {
        return [
          {
            order_id: 'order-absence',
            profession: 'picker',
            order_start_local: '2026-06-04 10:00:00',
            planned_hours: 8
          }
        ];
      }

      if (operation === 'workplace point day jobs') {
        return [
          {
            order_id: 'order-absence',
            job_id: 'job-absence',
            status: 'confirmed',
            worker_id: 'worker-1',
            actual_hours: 0,
            is_factual: 0,
            actual_time_local: ''
          }
        ];
      }

      if (operation === 'workplace point day workers') {
        return [{ worker_id: 'worker-1', worker_full_name: 'Worker Name', worker_phone: '+79990000000' }];
      }

      if (operation === 'workplace point day payments') {
        return [{ job_id: 'job-absence', payment_amount: 0 }];
      }

      return [];
    }
  };

  const details = await loadWorkplacePointDayDetails(
    client,
    {
      workplaceId: 'wp1',
      date: '2026-06-04',
      jobStatus: ['confirmed']
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.deepEqual(details.rows[0], {
    orderId: 'order-absence',
    jobId: '',
    profession: 'picker',
    orderStartLocal: '2026-06-04 10:00:00',
    plannedHours: 8,
    workerFullName: '',
    workerPhone: '',
    confirmedStatus: '',
    actualHours: null,
    actualTimeLocal: '',
    paymentAmount: 0,
    cancelledShifts: 0,
    lastCancelledAtLocal: ''
  });
});

test('mergeWorkplacePointDayDetails keeps legacy row mapping', () => {
  const detailInput = normalizeWorkplacePointDayDetailsInput(
    { workplaceId: 'wp1', date: '2026-06-02' },
    new Date('2026-06-15T12:00:00.000Z')
  );
  const details = mergeWorkplacePointDayDetails(detailInput, [
    {
          order_id: 'order-1',
          job_id: 'job-1',
          profession: 'Комплектовщик',
          order_start_local: '2026-06-02 09:00:00',
          planned_hours: 8,
          worker_full_name: 'Иванов Иван',
          worker_phone: '+79990000000',
          confirmed_status: 'confirmed',
          actual_hours: 7.5,
          actual_time_local: '2026-06-02 09:10 - 2026-06-02 16:40',
          payment_amount: 4500,
          cancelled_shifts: 0,
          last_cancelled_at_local: ''
        }
  ]);

  assert.equal(details.rows.length, 1);
  assert.equal(details.rows[0].confirmedStatus, 'confirmed');
});

test('loadWorkplacePointDashboardShell loads metadata and filters only', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'workplace point metadata') {
        return [{ workplace_id: 'wp1', workplace_title: 'Point 1', client_title: 'Brand' }];
      }

      if (operation === 'workplace point filter options') {
        return [
          { filter: 'profession', value: 'picker' },
          { filter: 'orderType', value: 'regular' },
          { filter: 'jobStatus', value: 'confirmed' }
        ];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  };

  const dashboard = await loadWorkplacePointDashboardShell(
    client,
    {
      workplaceId: 'wp1',
      from: '2026-06-01',
      to: '2026-06-30',
      profession: ['picker', 'driver'],
      orderType: ['regular', 'once'],
      jobStatus: ['confirmed', 'failed']
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.deepEqual(calls.map((call) => call.operation), [
    'workplace point metadata',
    'workplace point filter options'
  ]);
  assert.equal(dashboard.point.title, 'Point 1');
  assert.deepEqual(dashboard.filterOptions.profession, ['picker']);
  assert.deepEqual(dashboard.filters.profession, ['picker']);
  assert.deepEqual(dashboard.filters.orderType, ['regular']);
  assert.deepEqual(dashboard.filters.jobStatus, ['confirmed']);
  assert.equal(dashboard.summary.orderedShifts, 0);
  assert.deepEqual(dashboard.dailyRows, []);
  assert.deepEqual(dashboard.professionRows, []);
});

test('loadWorkplacePointDashboardSection loads and caches summary, charts, and radius independently', async () => {
  let timestamp = Date.parse('2026-06-15T12:00:00.000Z');
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'workplace point summary') {
        return [
          {
            ordered_shifts: 10,
            completed_shifts: 8,
            active_days: 2,
            unique_completed_workers: 4,
            unique_booked_workers: 6,
            dropoffs_24h: 1
          }
        ];
      }

      if (operation === 'workplace point daily') {
        return [{ period: '2026-06-01', ordered_shifts: 10, completed_shifts: 8 }];
      }

      if (operation === 'workplace point professions') {
        return [{ profession: 'picker', ordered_shifts: 10 }];
      }

      if (operation === 'workplace point radius workers') {
        return [{ radius_km: 5, workers: 12, active_session_workers: 5 }];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  };
  const cache = createDashboardSectionCache({ now: () => timestamp });
  const input = {
    workplaceId: 'wp1',
    from: '2026-06-01',
    to: '2026-06-30',
    profession: 'picker',
    orderType: 'regular',
    jobStatus: 'confirmed'
  };

  const summary = await loadWorkplacePointDashboardSection(
    client,
    input,
    'summary',
    new Date('2026-06-15T12:00:00.000Z'),
    { cache }
  );
  const charts = await loadWorkplacePointDashboardSection(
    client,
    input,
    'charts',
    new Date('2026-06-15T12:00:00.000Z'),
    { cache }
  );
  const radius = await loadWorkplacePointDashboardSection(
    client,
    input,
    'radius',
    new Date('2026-06-15T12:00:00.000Z'),
    { cache }
  );
  await loadWorkplacePointDashboardSection(
    client,
    input,
    'summary',
    new Date('2026-06-15T12:00:00.000Z'),
    { cache }
  );

  assert.equal(summary.summary.orderedShifts, 10);
  assert.equal(charts.dailyRows.length, 1);
  assert.equal(charts.professionRows.length, 1);
  assert.equal(radius.summary.radiusWorkers[5], 12);
  assert.deepEqual(calls.map((call) => call.operation), [
    'workplace point summary',
    'workplace point daily',
    'workplace point professions',
    'workplace point radius workers'
  ]);

  timestamp += 10 * 60 * 60 * 1000 + 1;

  await loadWorkplacePointDashboardSection(
    client,
    input,
    'summary',
    new Date('2026-06-15T12:00:00.000Z'),
    { cache }
  );

  assert.deepEqual(calls.map((call) => call.operation), [
    'workplace point summary',
    'workplace point daily',
    'workplace point professions',
    'workplace point radius workers',
    'workplace point summary'
  ]);
});

test('loadWorkplacePointDashboard rejects missing workplace id', async () => {
  await assert.rejects(
    () => loadWorkplacePointDashboard({ queryJSONEachRow: async () => [] }, {}, new Date('2026-06-15T12:00:00.000Z')),
    (error) => error.status === 400 && /workplaceId/.test(error.message)
  );
});
