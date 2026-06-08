const test = require('node:test');
const assert = require('node:assert/strict');

const { createDashboardSectionCache } = require('../src/dashboardSectionCache');
const {
  HEATMAP_SECTIONS,
  loadHeatmapDashboard,
  loadHeatmapDashboardSection,
  loadHeatmapDashboardShell,
  mergeHeatmapRows,
  normalizeHeatmapFilters
} = require('../src/heatmapDashboard');

test('normalizeHeatmapFilters defaults to the previous month and cleans filter values', () => {
  const filters = normalizeHeatmapFilters(
    {
      year: '2026',
      month: '13',
      client: ['Brand A', 'Brand A', ' '],
      excludedProfession: ['Курьер', 'Курьер', ' '],
      addressSearch: '  Тверская  ',
      activeBaseMode: 'unsafe',
      activeBasePeriod: 'unsafe'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.deepEqual(filters, {
    year: 2026,
    month: 5,
    periodKey: '2026-05',
    from: '2026-05-01',
    to: '2026-05-31',
    fromDateTime: '2026-05-01 00:00:00',
    toExclusiveDateTime: '2026-06-01 00:00:00',
    activeFromDateTime: '2026-05-02 00:00:00',
    activeToExclusiveDateTime: '2026-06-01 00:00:00',
    client: ['Brand A'],
    excludedProfession: ['Курьер'],
    addressSearch: 'Тверская',
    activeBaseMode: 'all',
    activeBasePeriod: 'last30d'
  });
});

test('normalizeHeatmapFilters accepts selected year, month, ready-status base mode, and selected-period activity', () => {
  const filters = normalizeHeatmapFilters(
    {
      year: '2024',
      month: '2',
      activeBaseMode: 'ready',
      activeBasePeriod: 'selected'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.equal(filters.periodKey, '2024-02');
  assert.equal(filters.from, '2024-02-01');
  assert.equal(filters.to, '2024-02-29');
  assert.equal(filters.toExclusiveDateTime, '2024-03-01 00:00:00');
  assert.equal(filters.activeFromDateTime, '2024-02-01 00:00:00');
  assert.equal(filters.activeBaseMode, 'ready');
  assert.equal(filters.activeBasePeriod, 'selected');
});

test('mergeHeatmapRows joins weighted demand points and calculates balance', () => {
  const filters = normalizeHeatmapFilters(
    {
      year: '2026',
      month: '5',
      activeBaseMode: 'ready'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );
  const dashboard = mergeHeatmapRows(filters, {
    filterOptionRows: [
      { filter: 'client', value: 'Brand A' },
      { filter: 'profession', value: 'Курьер' }
    ],
    demandPointRows: [
      {
        region: 'Москва',
        city: 'Москва',
        street: 'Тверская',
        workplace_id: 'workplace-1',
        workplace_title: 'Точка 1',
        ordered_shifts: 100,
        order_requests: 25,
        lon: 37.6,
        lat: 55.7,
        weighted_active_users: 30,
        active_users_5km: 20,
        active_users_10km: 12,
        active_users_15km: 8
      },
      {
        region: 'Татарстан',
        city: 'Казань',
        street: 'Кремлевская',
        workplace_id: 'workplace-2',
        workplace_title: 'Точка 2',
        ordered_shifts: 20,
        order_requests: 5,
        lon: 49.1,
        lat: 55.8,
        weighted_active_users: 80,
        active_users_5km: 50,
        active_users_10km: 35,
        active_users_15km: 20
      }
    ]
  });

  assert.deepEqual(dashboard.filterOptions.client, ['Brand A']);
  assert.deepEqual(dashboard.filterOptions.excludedProfession, ['Курьер']);
  assert.equal(dashboard.summary.pointsWithOrder, 2);
  assert.equal(dashboard.summary.orderedShifts, 120);
  assert.equal(dashboard.summary.weightedActiveUsers, 110);
  assert.equal(dashboard.summary.avgWeightedActiveUsersPerShift, 110 / 120);
  assert.equal(dashboard.points.length, 2);

  const moscow = dashboard.points.find((row) => row.region === 'Москва');
  const tatarstan = dashboard.points.find((row) => row.region === 'Татарстан');

  assert.equal(moscow.weightedActiveUsersPerShift, 0.3);
  assert.equal(moscow.balanceLevel, 'low');
  assert.match(moscow.color, /^hsl\(/);
  assert.equal(moscow.radiusUsers.near, 20);
  assert.equal(moscow.radiusUsers.medium, 12);
  assert.equal(moscow.radiusUsers.far, 8);
  assert.equal(tatarstan.weightedActiveUsersPerShift, 4);
  assert.equal(tatarstan.balanceLevel, 'high');
});

test('loadHeatmapDashboardShell loads filter options without heavy map queries', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'heatmap filter options') {
        return [
          { filter: 'client', value: 'Brand A' },
          { filter: 'profession', value: 'Курьер' }
        ];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  };

  const dashboard = await loadHeatmapDashboardShell(
    client,
    {
      year: '2026',
      month: '5',
      client: 'Brand A'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.deepEqual(dashboard.filterOptions.client, ['Brand A']);
  assert.deepEqual(dashboard.points, []);
  assert.deepEqual(calls.map((call) => call.operation), ['heatmap filter options']);
  assert.equal(calls[0].params.param_from, '2026-05-01 00:00:00');
  assert.equal(calls[0].params.param_to, '2026-06-01 00:00:00');
  assert.equal(Object.prototype.hasOwnProperty.call(calls[0].params, 'param_clients'), false);
});

test('loadHeatmapDashboardSection queries weighted demand points with safe parameters', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'heatmap demand points') {
        return [{
          region: 'Москва',
          city: 'Москва',
          street: 'Тверская',
          workplace_id: 'workplace-1',
          ordered_shifts: 100,
          order_requests: 25,
          lon: 37.6,
          lat: 55.7,
          weighted_active_users: 30,
          active_users_5km: 20,
          active_users_10km: 12,
          active_users_15km: 8
        }];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  };

  const dashboard = await loadHeatmapDashboardSection(
    client,
    {
      year: '2026',
      month: '5',
      client: ['Brand A', 'Brand B'],
      excludedProfession: 'Курьер',
      addressSearch: '  Тверская  ',
      activeBaseMode: 'ready',
      activeBasePeriod: 'selected'
    },
    'map',
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.equal(HEATMAP_SECTIONS.has('map'), true);
  assert.equal(dashboard.points[0].region, 'Москва');
  assert.deepEqual(calls.map((call) => call.operation), ['heatmap demand points']);

  for (const call of calls) {
    assert.equal(call.params.param_from, '2026-05-01 00:00:00');
    assert.equal(call.params.param_to, '2026-06-01 00:00:00');
    assert.equal(call.query.includes('Brand A'), false);
    assert.equal(call.query.includes('Brand B'), false);
    assert.equal(call.query.includes('Курьер'), false);
    assert.equal(call.query.includes('Тверская'), false);
  }

  const orderCall = calls[0];

  assert.equal(orderCall.params.param_clients, "['Brand A','Brand B']");
  assert.equal(orderCall.params.param_excluded_professions, "['Курьер']");
  assert.equal(orderCall.params.param_address_search, 'Тверская');
  assert.equal(orderCall.query.includes('c.title IN {clients:Array(String)}'), true);
  assert.equal(orderCall.query.includes('NOT IN {excluded_professions:Array(String)}'), true);
  assert.equal(orderCall.query.includes('{address_search:String}'), true);
  assert.equal(orderCall.query.includes('positionCaseInsensitive(ifNull(w.address__city'), true);
  assert.equal(orderCall.query.includes('positionCaseInsensitive(ifNull(w.address__street'), true);
  assert.equal(orderCall.query.includes('positionCaseInsensitive(ifNull(w.address__region'), true);
  assert.equal(orderCall.query.includes('positionCaseInsensitive(ifNull(w.title'), true);
  assert.equal(orderCall.query.includes('positionCaseInsensitive(ifNull(w.technical_name'), true);
  assert.equal(orderCall.query.includes('ifNull(o.amount, 0) AS amount'), true);
  assert.equal(orderCall.query.includes('w.location__coordinates AS workplace_coordinates'), true);
  assert.equal(orderCall.query.includes('HAVING ordered_shifts > 0'), true);
  assert.equal(orderCall.query.includes('greatCircleDistance'), true);
  assert.equal(orderCall.query.includes('distance_m <= 5000'), true);
  assert.equal(orderCall.query.includes('distance_m <= 10000'), true);
  assert.equal(orderCall.query.includes('distance_m <= 15000'), true);
  assert.equal(orderCall.query.includes('weighted_active_users'), true);
  assert.equal(orderCall.params.param_active_from, '2026-05-01 00:00:00');
  assert.equal(orderCall.params.param_active_to, '2026-06-01 00:00:00');
  assert.equal(orderCall.query.includes('appmetrica_sessions'), true);
  assert.equal(orderCall.query.includes('mg_workers AS worker'), true);
  assert.equal(orderCall.query.includes("status IN ('ready', 'booked', 'worked')"), true);
});

test('loadHeatmapDashboardSection caches the map section', async () => {
  let timestamp = Date.parse('2026-06-15T12:00:00.000Z');
  const calls = [];
  const cache = createDashboardSectionCache({ now: () => timestamp });
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push(operation);

      if (operation === 'heatmap demand points') {
        return [{ region: 'Москва', ordered_shifts: 100, order_requests: 25, weighted_active_users: 30 }];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  };

  const input = { year: '2026', month: '5' };
  const first = await loadHeatmapDashboardSection(
    client,
    input,
    'map',
    new Date('2026-06-15T12:00:00.000Z'),
    { cache }
  );
  const second = await loadHeatmapDashboardSection(
    client,
    input,
    'map',
    new Date('2026-06-15T12:00:00.000Z'),
    { cache }
  );

  assert.equal(first.points.length, 1);
  assert.equal(second.points.length, 1);
  assert.deepEqual(calls, ['heatmap demand points']);

  await loadHeatmapDashboardSection(
    client,
    { ...input, activeBasePeriod: 'selected' },
    'map',
    new Date('2026-06-15T12:00:00.000Z'),
    { cache }
  );

  assert.deepEqual(calls, [
    'heatmap demand points',
    'heatmap demand points'
  ]);

  timestamp = Date.parse('2026-06-16T00:00:00.000Z');

  await loadHeatmapDashboardSection(
    client,
    input,
    'map',
    new Date('2026-06-15T12:00:00.000Z'),
    { cache }
  );

  assert.deepEqual(calls, [
    'heatmap demand points',
    'heatmap demand points',
    'heatmap demand points'
  ]);
});

test('loadHeatmapDashboard loads filter options and map data for non-progressive use', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push(operation);

      if (operation === 'heatmap filter options') {
        return [{ filter: 'client', value: 'Brand A' }];
      }

      if (operation === 'heatmap demand points') {
        return [{ region: 'Москва', ordered_shifts: 100, order_requests: 25, weighted_active_users: 30 }];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  };

  const dashboard = await loadHeatmapDashboard(
    client,
    { year: '2026', month: '5' },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.deepEqual(dashboard.filterOptions.client, ['Brand A']);
  assert.equal(dashboard.points.length, 1);
  assert.deepEqual(calls, [
    'heatmap filter options',
    'heatmap demand points'
  ]);
});

test('heatmap SQL uses actual order domain and bounded worker joins', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });
      return [];
    }
  };

  await loadHeatmapDashboard(
    client,
    {
      year: '2026',
      month: '5',
      client: 'Brand A',
      excludedProfession: 'РљСѓСЂСЊРµСЂ',
      activeBaseMode: 'ready'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  const filterOptionsCall = calls.find((call) => call.operation === 'heatmap filter options');
  const demandCall = calls.find((call) => call.operation === 'heatmap demand points');

  for (const call of [filterOptionsCall, demandCall]) {
    assert.equal(call.query.includes('FROM mygig_'), false);
    assert.equal(call.query.includes('INNER JOIN mg_clients AS c ON c._id = o.client'), true);
    assert.equal(call.query.includes('LEFT JOIN mg_workplaces AS ow ON ow._id = o.workplace'), true);
    assert.equal(call.query.includes('LEFT JOIN mg_contractors AS ct ON ct._id = ow.contractor'), true);
    assert.equal(call.query.includes('c.title NOT IN'), true);
    assert.equal(call.query.includes("!= 'processing'"), true);
    assert.equal(call.query.includes('ifNull(o.is_hidden, false) = false'), true);
  }

  assert.equal(demandCall.query.includes('CROSS JOIN demand_bounds AS bounds'), false);
  assert.equal(demandCall.query.includes('INNER JOIN demand_bounds AS bounds ON bounds.points > 0'), true);
  assert.equal(demandCall.query.includes('CROSS JOIN active_workers AS aw'), false);
  assert.equal(demandCall.query.includes('INNER JOIN active_workers AS aw'), true);
  assert.equal(demandCall.query.includes('aw.worker_coordinates[1] BETWEEN dp.lon'), true);
  assert.equal(demandCall.query.includes('aw.worker_coordinates[2] BETWEEN dp.lat'), true);
  assert.equal(demandCall.query.includes('greatCircleDistance'), true);
  assert.equal(demandCall.query.includes('<= 15000'), true);
  assert.equal(demandCall.query.includes('CROSS JOIN mg_workers AS worker'), false);
});
