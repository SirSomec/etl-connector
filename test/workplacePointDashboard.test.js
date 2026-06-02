const test = require('node:test');
const assert = require('node:assert/strict');

const {
  loadWorkplacePointDashboard,
  loadWorkplacePointDashboardSection,
  loadWorkplacePointDashboardShell,
  mergeWorkplacePointRows,
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
    assert.equal(
      calls.find((call) => call.operation === operation).query.includes('mg_job_history'),
      true
    );
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
