const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDateKeys,
  heatmapLevel,
  mergeWorkplaceAnalysisRows,
  normalizeWorkplaceAnalysisFilters
} = require('../src/workplaceAnalysisDashboard');

test('normalizeWorkplaceAnalysisFilters defaults to the current month and whitelists limit and order type', () => {
  const filters = normalizeWorkplaceAnalysisFilters(
    {
      limit: '999',
      orderType: 'once; DROP TABLE mg_orders',
      client: '  Бренд  ',
      search: '<script>'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.deepEqual(filters, {
    from: '2026-06-01',
    to: '2026-06-15',
    fromDateTime: '2026-06-01 00:00:00',
    toExclusiveDateTime: '2026-06-16 00:00:00',
    rangeDays: 15,
    client: 'Бренд',
    city: '',
    region: '',
    profession: '',
    orderType: '',
    contractor: '',
    search: '<script>',
    limit: 12
  });
});

test('normalizeWorkplaceAnalysisFilters accepts valid dates, valid order type, and whitelisted limit', () => {
  const filters = normalizeWorkplaceAnalysisFilters(
    {
      from: '2026-04-01',
      to: '2026-04-30',
      orderType: 'regular',
      city: 'Казань',
      region: 'Татарстан',
      profession: 'picker',
      contractor: 'ООО Ромашка',
      limit: '20'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.equal(filters.from, '2026-04-01');
  assert.equal(filters.to, '2026-04-30');
  assert.equal(filters.toExclusiveDateTime, '2026-05-01 00:00:00');
  assert.equal(filters.rangeDays, 30);
  assert.equal(filters.orderType, 'regular');
  assert.equal(filters.city, 'Казань');
  assert.equal(filters.region, 'Татарстан');
  assert.equal(filters.profession, 'picker');
  assert.equal(filters.contractor, 'ООО Ромашка');
  assert.equal(filters.limit, 20);
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
      { workplace_id: 'wp1', order_date: '2026-06-01', ordered_shifts: 3 },
      { workplace_id: 'wp1', order_date: '2026-06-03', ordered_shifts: 6 }
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
  assert.equal(dashboard.points[0].avgDailyOrder, 4.5);
  assert.deepEqual(dashboard.points[0].heatmapDays, [
    { date: '2026-06-01', amount: 3, level: 2 },
    { date: '2026-06-02', amount: 0, level: 0 },
    { date: '2026-06-03', amount: 6, level: 4 }
  ]);
});

const { loadWorkplaceAnalysisDashboard } = require('../src/workplaceAnalysisDashboard');

test('loadWorkplaceAnalysisDashboard queries top workplaces and daily orders with safe parameters', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

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

      if (operation === 'workplace analysis daily orders') {
        return [
          { workplace_id: 'wp1', order_date: '2026-06-01', ordered_shifts: 3 },
          { workplace_id: 'wp1', order_date: '2026-06-03', ordered_shifts: 6 }
        ];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  };

  const dashboard = await loadWorkplaceAnalysisDashboard(
    client,
    {
      from: '2026-06-01',
      to: '2026-06-03',
      client: 'Бренд',
      city: 'Москва',
      region: 'Москва',
      profession: 'Комплектовщик',
      orderType: 'regular',
      contractor: 'Ромашка',
      search: 'Ленина'
    },
    new Date('2026-06-15T12:00:00.000Z')
  );

  assert.equal(dashboard.points.length, 1);
  assert.equal(dashboard.points[0].totalOrderedShifts, 9);
  assert.equal(dashboard.points[0].heatmapDays.length, 3);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].operation, 'workplace analysis top workplaces');
  assert.equal(calls[1].operation, 'workplace analysis daily orders');

  for (const call of calls) {
    assert.equal(call.params.param_from, '2026-06-01 00:00:00');
    assert.equal(call.params.param_to, '2026-06-04 00:00:00');
    assert.equal(call.params.param_client, 'Бренд');
    assert.equal(call.params.param_city, 'Москва');
    assert.equal(call.params.param_region, 'Москва');
    assert.equal(call.params.param_profession, 'Комплектовщик');
    assert.equal(call.params.param_order_type, 'regular');
    assert.equal(call.params.param_contractor, 'Ромашка');
    assert.equal(call.params.param_search, 'Ленина');
    assert.equal(call.query.includes('DROP TABLE'), false);
    assert.equal(call.query.includes('{limit:UInt64}'), true);
  }
});
