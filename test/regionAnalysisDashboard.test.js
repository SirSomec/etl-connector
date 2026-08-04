const test = require('node:test');
const assert = require('node:assert/strict');

const {
  loadRegionAnalysisGigerDetails,
  loadRegionAnalysisDashboardSection,
  normalizeRegionAnalysisFilters
} = require('../src/regionAnalysisDashboard');

test('normalizes the selected region and calendar range', () => {
  assert.deepEqual(
    normalizeRegionAnalysisFilters({ region: '  Татарстан ', from: '2026-06-01', to: '2026-06-30' }, new Date('2026-07-20T12:00:00.000Z')),
    {
      region: 'Татарстан',
      from: '2026-06-01',
      to: '2026-06-30',
      fromDateTime: '2026-06-01 00:00:00',
      toExclusiveDateTime: '2026-07-01 00:00:00',
      period: 'week',
      client: [],
      profession: [],
      orderType: []
    }
  );
});

test('loads completed workers for a city and preserves the export input', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });
      return operation.endsWith('total')
        ? [{ total_gigers: '1' }]
        : [{ user_id: 'user-1', worker_id: 'worker-1', full_name: 'Иванов Иван', phone: '+79990000000', status: 'worked' }];
    }
  };

  const details = await loadRegionAnalysisGigerDetails(client, {
    region: 'Татарстан', city: 'Казань', from: '2026-06-01', to: '2026-06-30', export: '1'
  }, new Date('2026-07-20T12:00:00.000Z'));

  assert.equal(calls[0].operation, 'region analysis giger details total');
  assert.equal(calls[1].operation, 'region analysis giger details');
  assert.equal(calls[0].params.param_city, 'Казань');
  assert.match(calls[1].query, /city = \{city:String\}/);
  assert.equal(details.metricLabel, 'Выполнявшие исполнители');
  assert.equal(details.gigers[0].fullName, 'Иванов Иван');
});

test('loads city detail from actual orders of the requested region only', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });
      return [{ city: 'Казань', ordered_shifts: '12', covered_shifts: '9', worked_shifts: '8', open_demand: '3', sla_percent: '66.7', coverage_percent: '75', workplaces: '4' }];
    }
  };

  const dashboard = await loadRegionAnalysisDashboardSection(
    client,
    { region: 'Татарстан', from: '2026-06-01', to: '2026-06-30' },
    'cities',
    new Date('2026-07-20T12:00:00.000Z')
  );

  assert.equal(calls[0].operation, 'region analysis cities');
  assert.deepEqual(calls[0].params, {
    param_region: 'Татарстан',
    param_from: '2026-06-01 00:00:00',
    param_to: '2026-07-01 00:00:00',
    param_clients: [],
    param_professions: [],
    param_order_types: []
  });
  assert.match(calls[0].query, /ifNull\(ow\.address__region, ''\) = \{region:String\}/);
  assert.match(calls[0].query, /o\.deleted = 0/);
  assert.deepEqual(dashboard.cityRows, [{ city: 'Казань', orderedShifts: 12, coveredShifts: 9, workedShifts: 8, openDemand: 3, slaPercent: 66.7, coveragePercent: 75, cancelledShifts: 0, workplaces: 4 }]);
});
