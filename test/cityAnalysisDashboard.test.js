const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  createCityAnalysisCache,
  loadCityAnalysisDashboard,
  loadCityAnalysisDashboardSection,
  loadCityAnalysisDashboardShell,
  mergeCityAnalysisRows,
  normalizeCityAnalysisFilters
} = require('../src/cityAnalysisDashboard');

test('normalizeCityAnalysisFilters defaults dates, requires a single city, and whitelists values', () => {
  const filters = normalizeCityAnalysisFilters(
    {
      city: [' Москва ', 'Казань'],
      client: ['Brand A', 'Brand A', ' '],
      profession: ' Комплектовщик ',
      orderType: ['regular', 'DROP TABLE'],
      jobStatus: ['confirmed', 'failed', 'confirmed'],
      contractor: ['ООО Ромашка'],
      salaryFrom: '-10',
      salaryTo: '450,5',
      includeDeletedOrders: '1',
      includeHiddenOrders: 'on'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.deepEqual(filters, {
    from: '2026-06-01',
    to: '2026-06-15',
    fromDateTime: '2026-06-01 00:00:00',
    toExclusiveDateTime: '2026-06-16 00:00:00',
    active30dFromDateTime: '2026-05-17 00:00:00',
    active30dToExclusiveDateTime: '2026-06-16 00:00:00',
    rangeDays: 15,
    city: 'Москва',
    client: ['Brand A'],
    profession: ['Комплектовщик'],
    orderType: ['regular'],
    jobStatus: ['confirmed', 'failed'],
    contractor: ['ООО Ромашка'],
    salaryFrom: 0,
    salaryTo: 450.5,
    includeDeletedOrders: true,
    includeHiddenOrders: true
  });
});

test('normalizeCityAnalysisFilters resets invalid date ranges to current month', () => {
  const filters = normalizeCityAnalysisFilters(
    {
      from: '2026-07-10',
      to: '2026-06-01',
      city: 'Москва',
      orderType: 'once'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.equal(filters.from, '2026-06-01');
  assert.equal(filters.to, '2026-06-15');
  assert.equal(filters.toExclusiveDateTime, '2026-06-16 00:00:00');
  assert.equal(filters.city, 'Москва');
  assert.deepEqual(filters.orderType, ['once']);
});

test('mergeCityAnalysisRows maps summary, composition, dynamics, and empty city state', () => {
  const filters = normalizeCityAnalysisFilters(
    {
      from: '2026-06-01',
      to: '2026-06-03',
      city: 'Москва'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  const dashboard = mergeCityAnalysisRows(filters, {
    cityOptionRows: [{ city: 'Москва' }, { city: 'Казань' }],
    filterOptionRows: [
      { filter: 'client', value: 'Brand A' },
      { filter: 'profession', value: 'Комплектовщик' },
      { filter: 'orderType', value: 'regular' },
      { filter: 'jobStatus', value: 'confirmed' },
      { filter: 'contractor', value: 'ООО Ромашка' }
    ],
    cityCoordinateRows: [{ workplace_id: 'wp1' }],
    summaryRows: [{
      ordered_shifts: 100,
      active_order_requests: 25,
      total_located_users: 80,
      ready_located_users: 31,
      ready_status_located_users: 12,
      booked_status_located_users: 9,
      worked_status_located_users: 10,
      app_active_users: 18,
      app_30d_active_users: 42,
      app_30d_ready_status_users: 12,
      app_30d_booked_status_users: 14,
      app_30d_worked_status_users: 16,
      booked_users: 11,
      completed_users: 7,
      avg_daily_30d_active_users_per_request: 2.5
    }],
    brandRows: [
      { label: 'Brand A', ordered_shifts: 70 },
      { label: 'Brand B', ordered_shifts: 30 }
    ],
    professionRows: [
      { label: 'Комплектовщик', ordered_shifts: 60 },
      { label: 'Водитель', ordered_shifts: 40 }
    ],
    rateRows: [
      { label: '250-350', ordered_shifts: 80, avg_salary_per_hour: 310 },
      { label: '450+', ordered_shifts: 20, avg_salary_per_hour: 470 }
    ],
    dynamicRows: [
      {
        period: '2026-06-01',
        ordered_shifts: 20,
        app_active_users: 8,
        booked_users: 4,
        completed_users: 3,
        active_users_per_request: 2
      }
    ]
  });

  assert.deepEqual(dashboard.filterOptions.city, ['Москва', 'Казань']);
  assert.deepEqual(dashboard.filterOptions.client, ['Brand A']);
  assert.equal(dashboard.context.hasCity, true);
  assert.equal(dashboard.context.hasCityCoordinates, true);
  assert.equal(dashboard.summary.orderedShifts, 100);
  assert.equal(dashboard.summary.activeOrderRequests, 25);
  assert.equal(dashboard.summary.totalLocatedUsers, 80);
  assert.equal(dashboard.summary.readyLocatedUsers, 31);
  assert.equal(dashboard.summary.readyStatusLocatedUsers, 12);
  assert.equal(dashboard.summary.bookedStatusLocatedUsers, 9);
  assert.equal(dashboard.summary.workedStatusLocatedUsers, 10);
  assert.equal(dashboard.summary.appActiveUsers, 18);
  assert.equal(dashboard.summary.app30dActiveUsers, 42);
  assert.equal(dashboard.summary.app30dReadyStatusUsers, 12);
  assert.equal(dashboard.summary.app30dBookedStatusUsers, 14);
  assert.equal(dashboard.summary.app30dWorkedStatusUsers, 16);
  assert.equal(dashboard.summary.bookedUsers, 11);
  assert.equal(dashboard.summary.completedUsers, 7);
  assert.equal(dashboard.summary.avgDaily30dActiveUsersPerRequest, 2.5);
  assert.deepEqual(dashboard.composition.brands, [
    { label: 'Brand A', orderedShifts: 70, sharePercent: 70 },
    { label: 'Brand B', orderedShifts: 30, sharePercent: 30 }
  ]);
  assert.deepEqual(dashboard.composition.rateBuckets[0], {
    label: '250-350',
    orderedShifts: 80,
    sharePercent: 80,
    avgSalaryPerHour: 310
  });
  assert.deepEqual(dashboard.dynamics[0], {
    period: '2026-06-01',
    orderedShifts: 20,
    appActiveUsers: 8,
    bookedUsers: 4,
    completedUsers: 3,
    activeUsersPerRequest: 2
  });
});

test('mergeCityAnalysisRows returns zero model when city is not selected', () => {
  const filters = normalizeCityAnalysisFilters({}, new Date('2026-06-15T12:00:00.000Z'));
  const dashboard = mergeCityAnalysisRows(filters, {
    cityOptionRows: [{ city: 'Москва' }],
    filterOptionRows: [
      { filter: 'client', value: 'Brand A' },
      { filter: 'profession', value: 'Комплектовщик' },
      { filter: 'orderType', value: 'regular' },
      { filter: 'jobStatus', value: 'confirmed' },
      { filter: 'contractor', value: 'ООО Ромашка' }
    ],
    cityCoordinateRows: [{ workplace_id: 'wp1' }],
    summaryRows: [{
      ordered_shifts: 100,
      active_order_requests: 25,
      total_located_users: 80,
      ready_located_users: 31,
      ready_status_located_users: 12,
      booked_status_located_users: 9,
      worked_status_located_users: 10,
      app_active_users: 18,
      app_30d_active_users: 42,
      app_30d_ready_status_users: 12,
      app_30d_booked_status_users: 14,
      app_30d_worked_status_users: 16,
      booked_users: 11,
      completed_users: 7,
      avg_daily_30d_active_users_per_request: 2.5
    }],
    brandRows: [{ label: 'Brand A', ordered_shifts: 100 }],
    professionRows: [{ label: 'Комплектовщик', ordered_shifts: 100 }],
    rateRows: [{ label: '250-350', ordered_shifts: 100, avg_salary_per_hour: 310 }],
    dynamicRows: [{
      period: '2026-06-01',
      ordered_shifts: 20,
      app_active_users: 8,
      booked_users: 4,
      completed_users: 3,
      active_users_per_request: 2
    }]
  });

  assert.deepEqual(dashboard.filterOptions.city, ['Москва']);
  assert.deepEqual(dashboard.filterOptions.client, ['Brand A']);
  assert.equal(dashboard.context.hasCity, false);
  assert.equal(dashboard.context.hasCityCoordinates, false);
  assert.deepEqual(dashboard.summary, {
    orderedShifts: 0,
    activeOrderRequests: 0,
    totalLocatedUsers: 0,
    readyLocatedUsers: 0,
    readyStatusLocatedUsers: 0,
    bookedStatusLocatedUsers: 0,
    workedStatusLocatedUsers: 0,
    appActiveUsers: 0,
    app30dActiveUsers: 0,
    app30dReadyStatusUsers: 0,
    app30dBookedStatusUsers: 0,
    app30dWorkedStatusUsers: 0,
    bookedUsers: 0,
    completedUsers: 0,
    avgDaily30dActiveUsersPerRequest: 0
  });
  assert.deepEqual(dashboard.composition.brands, []);
  assert.deepEqual(dashboard.composition.professions, []);
  assert.deepEqual(dashboard.composition.rateBuckets, []);
  assert.deepEqual(dashboard.dynamics, []);
});

test('loadCityAnalysisDashboard returns city options and skips heavy queries without selected city', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'city analysis city options') {
        return [{ city: 'Москва' }, { city: 'Казань' }];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  };

  const dashboard = await loadCityAnalysisDashboard(client, {}, new Date('2026-06-15T12:00:00.000Z'));

  assert.equal(dashboard.context.hasCity, false);
  assert.deepEqual(dashboard.filterOptions.city, ['Москва', 'Казань']);
  assert.deepEqual(calls.map((call) => call.operation), ['city analysis city options']);
  assert.equal(calls[0].params.param_from, '2026-06-01 00:00:00');
  assert.equal(calls[0].params.param_to, '2026-06-16 00:00:00');
});

test('loadCityAnalysisDashboardShell keeps selected city page light', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'city analysis city options') {
        return [{ city: 'Москва' }, { city: 'Казань' }];
      }

      if (operation === 'city analysis filter options') {
        return [
          { filter: 'client', value: 'Brand A' },
          { filter: 'profession', value: 'Комплектовщик' },
          { filter: 'orderType', value: 'regular' },
          { filter: 'jobStatus', value: 'confirmed' },
          { filter: 'contractor', value: 'ООО Ромашка' }
        ];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  };

  const dashboard = await loadCityAnalysisDashboardShell(
    client,
    {
      city: 'Москва',
      from: '2026-06-01',
      to: '2026-06-03',
      client: 'Brand A',
      salaryFrom: '250'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.equal(dashboard.context.hasCity, true);
  assert.equal(dashboard.context.isProgressive, true);
  assert.deepEqual(dashboard.filterOptions.city, ['Москва', 'Казань']);
  assert.deepEqual(dashboard.filterOptions.client, ['Brand A']);
  assert.deepEqual(calls.map((call) => call.operation), [
    'city analysis city options',
    'city analysis filter options'
  ]);
  assert.equal(calls[1].params.param_city, 'Москва');
  assert.equal(Object.prototype.hasOwnProperty.call(calls[1].params, 'param_clients'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(calls[1].params, 'param_salary_from'), false);
});

test('loadCityAnalysisDashboardSection loads small summary fragments and caches them for a day', async () => {
  let timestamp = Date.parse('2026-06-15T10:00:00.000Z');
  const cache = createCityAnalysisCache({ now: () => timestamp });
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'city analysis summary demand') {
        return [{ ordered_shifts: 40, active_order_requests: 8 }];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  };
  const input = {
    city: 'Москва',
    from: '2026-06-01',
    to: '2026-06-03',
    client: 'Brand A'
  };

  const first = await loadCityAnalysisDashboardSection(
    client,
    input,
    'summary-demand',
    new Date('2026-06-15T12:00:00.000Z'),
    { cache }
  );
  const second = await loadCityAnalysisDashboardSection(
    client,
    input,
    'summary-demand',
    new Date('2026-06-15T12:00:00.000Z'),
    { cache }
  );

  assert.equal(first.summary.orderedShifts, 40);
  assert.equal(first.summary.activeOrderRequests, 8);
  assert.equal(second.summary.orderedShifts, 40);
  assert.deepEqual(calls.map((call) => call.operation), ['city analysis summary demand']);
  assert.equal(calls[0].params.param_city, 'Москва');
  assert.equal(calls[0].params.param_clients, "['Brand A']");
  assert.equal(calls[0].query.includes('appmetrica_sessions'), false);

  timestamp += 24 * 60 * 60 * 1000 + 1;

  await loadCityAnalysisDashboardSection(
    client,
    input,
    'summary-demand',
    new Date('2026-06-15T12:00:00.000Z'),
    { cache }
  );

  assert.deepEqual(calls.map((call) => call.operation), [
    'city analysis summary demand',
    'city analysis summary demand'
  ]);
});

test('loadCityAnalysisDashboardSection can reuse persisted city cache after cache recreation', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'city-analysis-cache-'));
  const filePath = path.join(tempDir, 'cache.json');
  const input = {
    city: 'Москва',
    from: '2026-06-01',
    to: '2026-06-03'
  };
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'city analysis summary demand') {
        return [{ ordered_shifts: 41, active_order_requests: 9 }];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  };

  try {
    await loadCityAnalysisDashboardSection(
      client,
      input,
      'summary-demand',
      new Date('2026-06-15T12:00:00.000Z'),
      { cache: createCityAnalysisCache({ now: () => Date.parse('2026-06-15T10:00:00.000Z'), filePath }) }
    );

    const restored = await loadCityAnalysisDashboardSection(
      client,
      input,
      'summary-demand',
      new Date('2026-06-15T12:00:00.000Z'),
      { cache: createCityAnalysisCache({ now: () => Date.parse('2026-06-15T11:00:00.000Z'), filePath }) }
    );

    assert.equal(restored.summary.orderedShifts, 41);
    assert.equal(restored.summary.activeOrderRequests, 9);
    assert.deepEqual(calls.map((call) => call.operation), ['city analysis summary demand']);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('loadCityAnalysisDashboardSection keeps geo base summary separate from app sessions', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'city analysis city coordinates') {
        return [{ workplace_id: 'wp1' }];
      }

      if (operation === 'city analysis summary base') {
        return [
          {
            total_located_users: 120,
            ready_located_users: 80,
            ready_status_located_users: 20,
            booked_status_located_users: 30,
            worked_status_located_users: 50
          }
        ];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  };

  const dashboard = await loadCityAnalysisDashboardSection(
    client,
    { city: 'Москва', from: '2026-06-01', to: '2026-06-03' },
    'summary-base',
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.equal(dashboard.context.hasCityCoordinates, true);
  assert.equal(dashboard.summary.totalLocatedUsers, 120);
  assert.equal(dashboard.summary.readyLocatedUsers, 80);
  assert.deepEqual(calls.map((call) => call.operation), [
    'city analysis city coordinates',
    'city analysis summary base'
  ]);
  assert.equal(calls[1].query.includes('appmetrica_sessions'), false);
  assert.equal(calls[1].query.includes('greatCircleDistance'), true);
});

test('city geo base sections locate users from filtered demand workplaces', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'city analysis city coordinates') {
        return [{ workplace_id: 'wp1' }];
      }

      if (operation === 'city analysis summary base') {
        return [{
          total_located_users: 120,
          ready_located_users: 80,
          ready_status_located_users: 20,
          booked_status_located_users: 30,
          worked_status_located_users: 50
        }];
      }

      if (operation === 'city analysis summary app') {
        return [{
          app_active_users: 25,
          app_30d_active_users: 65,
          app_30d_ready_status_users: 20,
          app_30d_booked_status_users: 25,
          app_30d_worked_status_users: 20
        }];
      }

      if (operation === 'city analysis summary ratio') {
        return [{ avg_daily_30d_active_users_per_request: 2.4 }];
      }

      if (operation === 'city analysis dynamics') {
        return [{
          period: '2026-06-01',
          ordered_shifts: 10,
          app_active_users: 4,
          booked_users: 3,
          completed_users: 2,
          active_users_per_request: 1.3
        }];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  };
  const input = {
    city: 'Москва',
    from: '2026-06-01',
    to: '2026-06-03',
    client: 'Brand A'
  };

  for (const section of ['summary-base', 'summary-app', 'summary-ratio', 'dynamics']) {
    await loadCityAnalysisDashboardSection(
      client,
      input,
      section,
      new Date('2026-06-15T12:00:00.000Z')
    );
  }

  const summaryBaseCall = calls.find((call) => call.operation === 'city analysis summary base');
  const summaryAppCall = calls.find((call) => call.operation === 'city analysis summary app');
  const summaryRatioCall = calls.find((call) => call.operation === 'city analysis summary ratio');
  const dynamicsCall = calls.find((call) => call.operation === 'city analysis dynamics');

  for (const call of [summaryBaseCall, summaryAppCall, dynamicsCall]) {
    assert.equal(call.query.includes('filtered_orders AS ('), true);
    assert.equal(call.query.includes('w.location__coordinates AS workplace_coordinates'), true);
    assert.match(call.query, /raw_city_workplaces AS \([\s\S]*FROM filtered_orders/s);
    assert.equal(call.query.includes('city_coordinate_bounds AS ('), true);
    assert.equal(call.query.includes('quantileExact(0.01)'), true);
    assert.equal(call.query.includes('raw_points < 100'), true);
    assert.equal(call.query.includes('bounds.lon_margin'), true);
    assert.equal(call.query.includes('bounds.lat_margin'), true);
    assert.doesNotMatch(call.query, /bounds\.min_lon\s*-\s*1\b/);
    assert.doesNotMatch(call.query, /bounds\.min_lat\s*-\s*0\.25\b/);
  }

  assert.equal(summaryRatioCall.query.includes('active_30d_orders AS ('), true);
  assert.equal(summaryRatioCall.query.includes('w.location__coordinates AS workplace_coordinates'), true);
  assert.match(summaryRatioCall.query, /raw_city_workplaces AS \([\s\S]*FROM active_30d_orders/s);
  assert.equal(summaryAppCall.query.includes('app_30d_active_users AS ('), true);
  assert.equal(summaryAppCall.query.includes('{active_30d_from:DateTime}'), true);
  assert.equal(summaryAppCall.query.includes('{active_30d_to:DateTime}'), true);
  assert.equal(summaryAppCall.query.includes('app_30d_ready_status_users'), true);
  assert.equal(summaryAppCall.query.includes('app_30d_booked_status_users'), true);
  assert.equal(summaryAppCall.query.includes('app_30d_worked_status_users'), true);
});

test('loadCityAnalysisDashboard queries city datasets with safe parameters', async () => {
  const calls = [];
  const maliciousCity = 'Москва; DROP TABLE mg_orders';
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'city analysis city options') {
        return [{ city: maliciousCity }];
      }

      if (operation === 'city analysis filter options') {
        return [
          { filter: 'client', value: 'Brand A' },
          { filter: 'profession', value: 'Комплектовщик' },
          { filter: 'orderType', value: 'regular' },
          { filter: 'jobStatus', value: 'confirmed' },
          { filter: 'contractor', value: 'ООО Ромашка' }
        ];
      }

      if (operation === 'city analysis city coordinates') {
        return [{ workplace_id: 'wp1' }];
      }

      if (operation === 'city analysis summary') {
        return [{
          ordered_shifts: 20,
          active_order_requests: 5,
          total_located_users: 12,
          ready_located_users: 8,
          ready_status_located_users: 3,
          booked_status_located_users: 2,
          worked_status_located_users: 3,
          app_active_users: 6,
          app_30d_active_users: 16,
          app_30d_ready_status_users: 5,
          app_30d_booked_status_users: 6,
          app_30d_worked_status_users: 7,
          booked_users: 4,
          completed_users: 3,
          avg_daily_30d_active_users_per_request: 1.4
        }];
      }

      if (operation === 'city analysis brands') {
        return [{ label: 'Brand A', ordered_shifts: 20 }];
      }

      if (operation === 'city analysis professions') {
        return [{ label: 'Комплектовщик', ordered_shifts: 20 }];
      }

      if (operation === 'city analysis rate buckets') {
        return [{ label: '250-350', ordered_shifts: 20, avg_salary_per_hour: 300 }];
      }

      if (operation === 'city analysis dynamics') {
        return [{
          period: '2026-06-01',
          ordered_shifts: 20,
          app_active_users: 6,
          booked_users: 4,
          completed_users: 3,
          active_users_per_request: 1.4
        }];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  };

  const dashboard = await loadCityAnalysisDashboard(
    client,
    {
      from: '2026-06-01',
      to: '2026-06-03',
      city: maliciousCity,
      client: 'Brand A',
      profession: 'Комплектовщик',
      orderType: 'regular',
      jobStatus: 'confirmed',
      contractor: 'ООО Ромашка',
      salaryFrom: '250',
      salaryTo: '450'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.equal(dashboard.context.selectedCity, maliciousCity);
  assert.equal(dashboard.summary.orderedShifts, 20);
  assert.equal(dashboard.summary.totalLocatedUsers, 12);
  assert.equal(dashboard.summary.readyLocatedUsers, 8);
  assert.equal(dashboard.summary.readyStatusLocatedUsers, 3);
  assert.equal(dashboard.summary.bookedStatusLocatedUsers, 2);
  assert.equal(dashboard.summary.workedStatusLocatedUsers, 3);
  assert.equal(dashboard.summary.app30dActiveUsers, 16);
  assert.equal(dashboard.summary.app30dReadyStatusUsers, 5);
  assert.equal(dashboard.summary.app30dBookedStatusUsers, 6);
  assert.equal(dashboard.summary.app30dWorkedStatusUsers, 7);
  assert.equal(dashboard.summary.bookedUsers, 4);
  assert.equal(dashboard.composition.brands[0].label, 'Brand A');
  assert.deepEqual(calls.map((call) => call.operation), [
    'city analysis city options',
    'city analysis filter options',
    'city analysis city coordinates',
    'city analysis summary',
    'city analysis brands',
    'city analysis professions',
    'city analysis rate buckets',
    'city analysis dynamics'
  ]);

  for (const call of calls) {
    assert.equal(call.query.includes(maliciousCity), false);
    assert.equal(call.query.includes('DROP TABLE'), false);
    assert.equal(call.params.param_from, '2026-06-01 00:00:00');
    assert.equal(call.params.param_to, '2026-06-04 00:00:00');
  }

  const filterOptionsCall = calls.find((call) => call.operation === 'city analysis filter options');
  assert.equal(filterOptionsCall.params.param_city, maliciousCity);
  assert.equal(Object.prototype.hasOwnProperty.call(filterOptionsCall.params, 'param_clients'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(filterOptionsCall.params, 'param_professions'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(filterOptionsCall.params, 'param_order_types'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(filterOptionsCall.params, 'param_job_statuses'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(filterOptionsCall.params, 'param_contractors'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(filterOptionsCall.params, 'param_salary_from'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(filterOptionsCall.params, 'param_salary_to'), false);

  for (const call of calls.slice(2)) {
    assert.equal(call.params.param_city, maliciousCity);
    assert.equal(call.params.param_clients, "['Brand A']");
    assert.equal(call.params.param_professions, "['Комплектовщик']");
    assert.equal(call.params.param_order_types, "['regular']");
    assert.equal(call.params.param_job_statuses, "['confirmed']");
    assert.equal(call.params.param_contractors, "['ООО Ромашка']");
    assert.equal(call.params.param_salary_from, 250);
    assert.equal(call.params.param_salary_to, 450);
  }

  const summaryCall = calls.find((call) => call.operation === 'city analysis summary');
  const cityCoordinatesCall = calls.find((call) => call.operation === 'city analysis city coordinates');

  assert.match(cityCoordinatesCall.query, /\bLIMIT\s+1\b/);
  assert.equal(cityCoordinatesCall.query.includes('FROM mg_orders AS o'), true);
  assert.equal(cityCoordinatesCall.query.includes('w.location__coordinates'), true);
  assert.match(
    summaryCall.query,
    /raw_city_workplaces AS \([\s\S]*FROM filtered_orders/s
  );
  assert.equal(summaryCall.query.includes('w.location__coordinates AS workplace_coordinates'), true);
  assert.equal(summaryCall.query.includes('city_coordinate_bounds AS ('), true);
  assert.equal(summaryCall.query.includes('quantileExact(0.01)'), true);
  assert.equal(summaryCall.query.includes('raw_points < 100'), true);
  assert.match(summaryCall.query, /city_bounds AS \(/);
  assert.doesNotMatch(summaryCall.query, /\bJOIN\s+city_bounds\s+AS\s+bounds\s+ON\b/i);
  assert.doesNotMatch(summaryCall.query, /\bINNER\s+JOIN\s+city_bounds\b/i);
  assert.match(summaryCall.query, /candidate_workers AS \(/);
  assert.match(
    summaryCall.query,
    /candidate_workers AS \([\s\S]*FROM mg_workers AS worker\s+CROSS JOIN city_bounds AS bounds\s+WHERE/s
  );
  assert.match(
    summaryCall.query,
    /located_users AS \([\s\S]*FROM candidate_workers AS worker\s+CROSS JOIN city_workplaces AS cw/s
  );
  assert.match(
    summaryCall.query,
    /worker\.location__coordinates\[1\]\s+BETWEEN\s+bounds\.min_lon\s*-\s*bounds\.lon_margin\s+AND\s+bounds\.max_lon\s*\+\s*bounds\.lon_margin/s
  );
  assert.match(
    summaryCall.query,
    /worker\.location__coordinates\[2\]\s+BETWEEN\s+bounds\.min_lat\s*-\s*bounds\.lat_margin\s+AND\s+bounds\.max_lat\s*\+\s*bounds\.lat_margin/s
  );
  assert.equal(summaryCall.query.includes('greatCircleDistance'), true);
  assert.equal(summaryCall.query.includes('<= 15000'), true);
  assert.equal(summaryCall.query.includes('appmetrica_sessions'), true);
  assert.equal(summaryCall.query.includes("ifNull(worker.status, '') IN ('ready', 'booked', 'worked')"), true);
  assert.equal(summaryCall.query.includes("ifNull(worker.status, '') = 'ready'"), true);
  assert.equal(summaryCall.query.includes("ifNull(worker.status, '') = 'booked'"), true);
  assert.equal(summaryCall.query.includes("ifNull(worker.status, '') = 'worked'"), true);
  assert.equal(summaryCall.query.includes('AS ready_status_located_users'), true);
  assert.equal(summaryCall.query.includes('AS booked_status_located_users'), true);
  assert.equal(summaryCall.query.includes('AS worked_status_located_users'), true);
  assert.equal(summaryCall.query.includes('app_30d_active_users AS ('), true);
  assert.equal(summaryCall.query.includes('app_30d_ready_status_users'), true);
  assert.equal(summaryCall.query.includes('app_30d_booked_status_users'), true);
  assert.equal(summaryCall.query.includes('app_30d_worked_status_users'), true);
  assert.equal(summaryCall.query.includes('located.is_ready_status'), true);
  assert.equal(summaryCall.query.includes('located.is_booked_status'), true);
  assert.equal(summaryCall.query.includes('located.is_worked_status'), true);
  assert.equal(summaryCall.query.includes("ifNull(history.status, '') = 'booked'"), true);
  assert.equal(summaryCall.query.includes('AS is_successful_confirmed_shift'), true);
  assert.equal(summaryCall.query.includes('is_successful_confirmed_shift = 1'), true);
  assert.equal(summaryCall.query.includes('uniqExactIf(located.user_id'), true);
});

test('loadCityAnalysisDashboard keeps request denominator non-deleted even when deleted orders are included', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'city analysis city options') {
        return [{ city: 'Москва' }];
      }

      if (operation === 'city analysis filter options' || operation === 'city analysis city coordinates') {
        return [];
      }

      return [];
    }
  };

  await loadCityAnalysisDashboard(
    client,
    {
      city: 'Москва',
      from: '2026-06-01',
      to: '2026-06-01',
      includeDeletedOrders: '1',
      includeHiddenOrders: '1'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  const summaryCall = calls.find((call) => call.operation === 'city analysis summary');
  const dynamicsCall = calls.find((call) => call.operation === 'city analysis dynamics');

  assert.equal(summaryCall.query.includes('active_order_requests'), true);
  assert.equal(summaryCall.query.includes('ifNull(o.deleted, 0) = 0 AS is_active_request'), true);
  assert.equal(summaryCall.query.includes('countDistinctIf(order_id, is_active_request)'), true);
  assert.equal(dynamicsCall.query.includes('countDistinctIf(order_id, is_active_request)'), true);
});
