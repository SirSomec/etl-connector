const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BRAND_ANALYSIS_SECTIONS,
  loadBrandAnalysisDashboardSection,
  loadBrandAnalysisDashboardShell,
  normalizeBrandAnalysisFilters
} = require('../src/brandAnalysisDashboard');

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

test('normalizeBrandAnalysisFilters keeps supported period, dates and selected brand id', () => {
  const filters = normalizeBrandAnalysisFilters(
    {
      period: 'week',
      from: '2026-04-01',
      to: '2026-04-30',
      brandId: ' client-1 '
    },
    new Date('2026-06-01T12:00:00.000Z')
  );

  assert.deepEqual(filters, {
    period: 'week',
    from: '2026-04-01',
    to: '2026-04-30',
    fromDateTime: '2026-04-01 00:00:00',
    toExclusiveDateTime: '2026-05-01 00:00:00',
    brandId: 'client-1',
    rangeDays: 30
  });
});

test('normalizeBrandAnalysisFilters falls back from unsafe period and invalid dates', () => {
  const filters = normalizeBrandAnalysisFilters(
    {
      period: 'month); DROP TABLE mg_orders; --',
      from: 'bad',
      to: '2026-99-99',
      brandId: 'brand-1'
    },
    new Date('2026-06-01T12:00:00.000Z')
  );

  assert.equal(filters.period, 'month');
  assert.equal(filters.from, '2026-03-03');
  assert.equal(filters.to, '2026-06-01');
  assert.equal(filters.fromDateTime, '2026-03-03 00:00:00');
  assert.equal(filters.toExclusiveDateTime, '2026-06-02 00:00:00');
  assert.equal(filters.brandId, 'brand-1');
  assert.equal(filters.rangeDays, 91);
});

test('loadBrandAnalysisDashboardShell loads brand options without heavy dashboard sections', async () => {
  const { calls, client } = createDashboardClient({
    'brand analysis brand options': [
      { brand_title: 'Brand A' },
      { brand_title: 'Brand A ' },
      { brand_title: 'Brand A' },
      { brand_title: 'Brand B' }
    ]
  });

  const dashboard = await loadBrandAnalysisDashboardShell(
    client,
    {
      period: 'month',
      from: '2026-04-01',
      to: '2026-04-30',
      brandId: 'Brand A'
    },
    new Date('2026-06-01T12:00:00.000Z')
  );

  assert.deepEqual(dashboard.brandOptions, [
    { id: 'Brand A', title: 'Brand A' },
    { id: 'Brand B', title: 'Brand B' }
  ]);
  assert.equal(dashboard.selectedBrandTitle, 'Brand A');
  assert.deepEqual(calls.map((call) => call.operation), ['brand analysis brand options']);
  assert.match(calls[0].query, /GROUP BY brand_title/);
  assert.doesNotMatch(calls[0].query, /c\._id AS brand_id/);
});

test('loadBrandAnalysisDashboardSection returns empty data without selected brand', async () => {
  const { calls, client } = createDashboardClient();

  const dashboard = await loadBrandAnalysisDashboardSection(
    client,
    {
      period: 'month',
      from: '2026-04-01',
      to: '2026-04-30'
    },
    'summary',
    new Date('2026-06-01T12:00:00.000Z')
  );

  assert.equal(calls.length, 0);
  assert.equal(dashboard.summary.orderedShifts, 0);
  assert.equal(dashboard.summary.workedShifts, 0);
});

test('loadBrandAnalysisDashboardSection queries and maps summary for selected brand', async () => {
  const { calls, client } = createDashboardClient({
    'brand analysis orders summary': [
      {
        ordered_shifts: 20,
        workplaces_with_orders: 4,
        active_days: 10
      }
    ],
    'brand analysis shifts summary': [
      {
        worked_shifts: 15,
        covered_shifts: 17,
        revenue_rub: 30000,
        unique_workers: 9,
        workplaces_with_worked_shifts: 3,
        cancelled_shifts: 2,
        self_booked_confirmed_shifts: 6,
        avg_worker_rate_hour: 320,
        avg_customer_rate_hour: 450
      }
    ]
  });

  const dashboard = await loadBrandAnalysisDashboardSection(
    client,
    {
      period: 'month',
      from: '2026-04-01',
      to: '2026-04-30',
      brandId: 'Brand A'
    },
    'summary',
    new Date('2026-06-01T12:00:00.000Z')
  );

  assert.equal(dashboard.summary.orderedShifts, 20);
  assert.equal(dashboard.summary.workedShifts, 15);
  assert.equal(dashboard.summary.coveredShifts, 17);
  assert.equal(dashboard.summary.openDemand, 3);
  assert.equal(dashboard.summary.slaPercent, 75);
  assert.equal(dashboard.summary.coveragePercent, 85);
  assert.equal(dashboard.summary.orderStabilityPercent, 33.33333333333333);
  assert.equal(dashboard.summary.revenueRub, 30000);
  assert.equal(dashboard.summary.uniqueWorkers, 9);
  assert.equal(dashboard.summary.selfBookingPercent, 40);
  assert.equal(dashboard.summary.avgWorkerRateHour, 320);
  assert.equal(dashboard.summary.avgCustomerRateHour, 450);
  assert.deepEqual(calls.map((call) => call.operation), [
    'brand analysis orders summary',
    'brand analysis shifts summary'
  ]);
  assert.ok(calls.every((call) => call.params.param_brand_title === 'Brand A'));
  assert.ok(calls.every((call) => call.params.param_from === '2026-04-01 00:00:00'));
  assert.ok(calls.every((call) => call.params.param_to === '2026-05-01 00:00:00'));
  assert.ok(calls.some((call) => call.query.includes('actual_orders AS (')));
  assert.ok(calls.some((call) => call.query.includes('INNER JOIN actual_orders AS ao ON j.source = ao.order_id')));
  assert.ok(calls.some((call) => call.query.includes("ifNull(nullIf(trimBoth(ifNull(c.title, '')), ''), 'Без бренда') = {brand_title:String}")));
  assert.ok(calls.some((call) => call.query.includes('c.title NOT IN')));
  assert.ok(calls.some((call) => call.query.includes("!= 'processing'")));
  assert.ok(calls.some((call) => call.query.includes('AS is_successful_confirmed_shift')));
  assert.equal(calls.some((call) => call.query.includes('mygig_')), false);
});

test('loadBrandAnalysisDashboardSection maps trend, workplaces, professions and statuses', async () => {
  const { client } = createDashboardClient({
    'brand analysis orders trend': [
      { period: '2026-04-01', ordered_shifts: 20 }
    ],
    'brand analysis shifts trend': [
      { period: '2026-04-01', worked_shifts: 15, covered_shifts: 17, revenue_rub: 30000, cancelled_shifts: 2 }
    ],
    'brand analysis workplace orders': [
      {
        workplace_id: 'wp-1',
        workplace_title: 'Точка <1>',
        city: 'Москва',
        ordered_shifts: 12,
        active_days: 6
      }
    ],
    'brand analysis workplace shifts': [
      {
        workplace_id: 'wp-1',
        worked_shifts: 9,
        covered_shifts: 10,
        revenue_rub: 18000,
        unique_workers: 5,
        cancelled_shifts: 1
      }
    ],
    'brand analysis profession orders': [
      { profession: 'Комплектовщик', ordered_shifts: 12 }
    ],
    'brand analysis profession shifts': [
      { profession: 'Комплектовщик', worked_shifts: 9, revenue_rub: 18000, cancelled_shifts: 1 }
    ],
    'brand analysis status breakdown': [
      { status: 'confirmed', shifts: 9 }
    ]
  });

  const input = {
    period: 'month',
    from: '2026-04-01',
    to: '2026-04-30',
    brandId: 'client-1'
  };

  const trend = await loadBrandAnalysisDashboardSection(client, input, 'trend', new Date('2026-06-01T12:00:00.000Z'));
  const workplaces = await loadBrandAnalysisDashboardSection(client, input, 'workplaces', new Date('2026-06-01T12:00:00.000Z'));
  const professions = await loadBrandAnalysisDashboardSection(client, input, 'professions', new Date('2026-06-01T12:00:00.000Z'));
  const statuses = await loadBrandAnalysisDashboardSection(client, input, 'statuses', new Date('2026-06-01T12:00:00.000Z'));

  assert.deepEqual(trend.trendRows, [
    {
      period: '2026-04-01',
      orderedShifts: 20,
      workedShifts: 15,
      coveredShifts: 17,
      openDemand: 3,
      slaPercent: 75,
      coveragePercent: 85,
      revenueRub: 30000,
      cancelledShifts: 2
    }
  ]);
  assert.equal(workplaces.workplaceRows[0].workplaceTitle, 'Точка <1>');
  assert.equal(workplaces.workplaceRows[0].slaPercent, 75);
  assert.equal(workplaces.workplaceRows[0].coveragePercent, 83.33333333333334);
  assert.equal(professions.professionRows[0].profession, 'Комплектовщик');
  assert.equal(professions.professionRows[0].slaPercent, 75);
  assert.deepEqual(statuses.statusRows, [{ status: 'confirmed', shifts: 9 }]);
});

test('loadBrandAnalysisDashboardSection rejects unknown section', async () => {
  assert.equal(BRAND_ANALYSIS_SECTIONS.has('summary'), true);
  await assert.rejects(
    () => loadBrandAnalysisDashboardSection(createDashboardClient().client, { brandId: 'client-1' }, 'bad'),
    /Unknown brand analysis section/
  );
});
