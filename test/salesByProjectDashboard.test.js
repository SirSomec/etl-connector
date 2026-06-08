const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPeriodExpression,
  loadSalesByProjectDashboard,
  loadSalesByProjectDashboardSection,
  loadSalesByProjectDashboardShell,
  normalizeSalesByProjectFilters
} = require('../src/salesByProjectDashboard');

const { createDashboardSectionCache } = require('../src/dashboardSectionCache');

function createDashboardClient(rowsByOperation) {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      return rowsByOperation[operation] || [];
    }
  };

  return { calls, client };
}

test('normalizeSalesByProjectFilters keeps only supported periods and date strings', () => {
  const filters = normalizeSalesByProjectFilters(
    {
      period: 'week',
      from: '2026-04-01',
      to: '2026-04-30'
    },
    new Date('2026-06-01T12:00:00.000Z')
  );

  assert.deepEqual(filters, {
    period: 'week',
    from: '2026-04-01',
    to: '2026-04-30',
    fromDateTime: '2026-04-01 00:00:00',
    toExclusiveDateTime: '2026-05-01 00:00:00'
  });
});

test('normalizeSalesByProjectFilters falls back from unsafe period and invalid dates', () => {
  const filters = normalizeSalesByProjectFilters(
    {
      period: 'month); DROP TABLE mg_orders; --',
      from: 'not-a-date',
      to: '2026-99-99'
    },
    new Date('2026-06-01T12:00:00.000Z')
  );

  assert.equal(filters.period, 'month');
  assert.equal(filters.from, '2026-03-03');
  assert.equal(filters.to, '2026-06-01');
  assert.equal(filters.fromDateTime, '2026-03-03 00:00:00');
  assert.equal(filters.toExclusiveDateTime, '2026-06-02 00:00:00');
});

test('buildPeriodExpression only returns whitelisted ClickHouse expressions', () => {
  assert.equal(buildPeriodExpression('day', 'start_at'), 'toDate(start_at)');
  assert.equal(buildPeriodExpression('week', 'start_at'), 'toStartOfWeek(start_at)');
  assert.equal(buildPeriodExpression('month', 'start_at'), 'toStartOfMonth(start_at)');
  assert.equal(buildPeriodExpression('quarter', 'start_at'), 'toStartOfQuarter(start_at)');
  assert.throws(() => buildPeriodExpression('year', 'start_at'), /Unsupported period/);
});

test('loadSalesByProjectDashboard queries dashboard datasets and merges KPI values', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'sales by project orders summary') {
        return [
          {
            ordered_shifts: 10,
            workplaces_with_orders: 3,
            avg_worker_rate_hour: 250
          }
        ];
      }

      if (operation === 'sales by project shifts summary') {
        return [
          {
            worked_shifts: 8,
            revenue_rub: 12000,
            unique_workers: 5,
            workplaces_with_worked_shifts: 2,
            cancelled_shifts: 1,
            self_booked_confirmed_shifts: 4,
            avg_worker_rate_hour: 300
          }
        ];
      }

      if (operation === 'sales by project orders trend') {
        return [{ period: '2026-04-01', ordered_shifts: 10 }];
      }

      if (operation === 'sales by project shifts trend') {
        return [
          {
            period: '2026-04-01',
            worked_shifts: 8,
            revenue_rub: 12000,
            cancelled_shifts: 1
          }
        ];
      }

      if (operation === 'sales by project brand orders') {
        return [
          {
            brand: 'Бренд <A>',
            ordered_shifts: 10,
            workplaces_with_orders: 3,
            avg_worker_rate_hour: 250
          }
        ];
      }

      if (operation === 'sales by project brand shifts') {
        return [
          {
            brand: 'Бренд <A>',
            worked_shifts: 8,
            revenue_rub: 12000,
            unique_workers: 5,
            workplaces_with_worked_shifts: 2,
            cancelled_shifts: 1,
            self_booked_confirmed_shifts: 4,
            avg_worker_rate_hour: 300
          }
        ];
      }

      if (operation === 'sales by project status breakdown') {
        return [{ status: 'confirmed', shifts: 8 }];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  };

  const dashboard = await loadSalesByProjectDashboard(
    client,
    {
      period: 'month',
      from: '2026-04-01',
      to: '2026-04-30'
    },
    new Date('2026-06-01T12:00:00.000Z')
  );

  assert.equal(dashboard.summary.orderedShifts, 10);
  assert.equal(dashboard.summary.workedShifts, 8);
  assert.equal(dashboard.summary.slaPercent, 80);
  assert.equal(dashboard.summary.revenueRub, 12000);
  assert.equal(dashboard.summary.uniqueWorkers, 5);
  assert.equal(dashboard.summary.workplacesWithOrders, 3);
  assert.equal(dashboard.summary.workplacesWithWorkedShifts, 2);
  assert.equal(dashboard.summary.cancelledShifts, 1);
  assert.equal(dashboard.summary.selfBookingPercent, 50);
  assert.equal(dashboard.summary.avgWorkerRateHour, 300);
  assert.deepEqual(dashboard.trendRows, [
    {
      period: '2026-04-01',
      orderedShifts: 10,
      workedShifts: 8,
      slaPercent: 80,
      revenueRub: 12000,
      cancelledShifts: 1
    }
  ]);
  assert.equal(dashboard.brandRows[0].brand, 'Бренд <A>');
  assert.deepEqual(dashboard.statusRows, [{ status: 'confirmed', shifts: 8 }]);
  assert.equal(calls.length, 7);
  assert.ok(calls.every((call) => call.params.param_from === '2026-04-01 00:00:00'));
  assert.ok(calls.every((call) => call.params.param_to === '2026-05-01 00:00:00'));
  assert.ok(calls.every((call) => call.params.param_from_string === '2026-04-01 00:00:00'));
  assert.ok(calls.every((call) => call.params.param_to_string === '2026-05-01 00:00:00'));
  assert.equal(calls.some((call) => call.query.includes('DROP TABLE')), false);
  assert.ok(calls.some((call) => call.query.includes('actual_orders AS (')));
  assert.ok(calls.some((call) => call.query.includes('INNER JOIN actual_orders AS ao ON j.source = ao.order_id')));
  assert.ok(calls.some((call) => call.query.includes('ifNull(o.is_hidden, false) = false')));
  assert.ok(calls.some((call) => call.query.includes('c.title NOT IN')));
  assert.ok(calls.some((call) => call.query.includes('MyGig Demo')));
  assert.ok(calls.some((call) => call.query.includes("!= 'processing'")));
  assert.ok(calls.some((call) => call.query.includes('FROM mg_jobs AS j')));
  assert.ok(calls.some((call) => call.query.includes('j.start >= {from:DateTime}')));
  assert.ok(calls.some((call) => call.query.includes('j.start < {to:DateTime}')));
  assert.ok(calls.some((call) => call.query.includes('LEFT JOIN first_history AS fh ON sf.job = fh.job')));
  assert.equal(calls.some((call) => call.query.includes("h.start != 'NaT'")), false);
  assert.equal(calls.some((call) => call.query.includes('h.start >= {from_string:String}')), false);
  assert.ok(calls.some((call) => call.query.includes('row_number() OVER (')));
  assert.ok(calls.some((call) => call.query.includes('PARTITION BY h.job')));
  assert.ok(calls.some((call) => call.query.includes("if(ifNull(fh.first_initiator, '') = 'worker', 1, 0) AS is_self_booked")));
  assert.equal(calls.some((call) => call.query.includes("max(if(h.status = 'booked' AND h.initiator = 'worker'")), false);
  assert.ok(calls.some((call) => call.query.includes('AS cancellation_reason')));
  assert.ok(calls.some((call) => call.query.includes('ao.pieceworks AS piecework')));
  assert.equal(calls.some((call) => call.query.includes('j.piecework')), false);
  assert.ok(calls.some((call) => call.query.includes('AS is_successful_confirmed_shift')));
  assert.ok(calls.some((call) => call.query.includes("uniqExactIf(job, is_successful_confirmed_shift = 1 AND job != '') AS worked_shifts")));
  assert.equal(calls.some((call) => call.query.includes("uniqExactIf(job, status = 'confirmed' AND job != '') AS worked_shifts")), false);
  assert.ok(
    calls.some((call) =>
      call.query.includes("countIf(ifNull(cancellation_reason, '') != '' OR status = 'failed') AS cancelled_shifts")
    )
  );
  assert.ok(
    calls.some((call) =>
      call.query.includes("avgIf(worker_rate_hour, is_successful_confirmed_shift = 1 AND worker_rate_hour IS NOT NULL) AS avg_worker_rate_hour")
    )
  );
  assert.ok(calls.some((call) => call.query.includes('sf.salary_per_hour AS salary_per_hour')));
  assert.ok(calls.some((call) => call.query.includes('nullIf(toFloat64OrNull')));
  assert.ok(
    calls.some((call) =>
      call.query.includes("countDistinctIf(o.workplace, o.workplace != '') AS workplaces_with_orders")
    )
  );
  assert.equal(calls.some((call) => call.query.includes('o.amount > 0) AS workplaces_with_orders')), false);
  assert.equal(calls.some((call) => call.query.includes("countIf(status = 'confirmed') AS worked_shifts")), false);
  assert.equal(calls.some((call) => call.query.includes("countIf(status = 'cancelled') AS cancelled_shifts")), false);
  assert.ok(
    calls.some((call) =>
      call.query.includes("ifNull(nullIf(sf.order_contract_type, ''), ifNull(nullIf(sf.contractor_contract_type, ''), 'services')) AS contract_type")
    )
  );
  assert.ok(calls.some((call) => call.query.includes('ifNull(t.deleted, 0) = 0')));
  assert.equal(calls.some((call) => call.query.includes("t.transaction_type = 'surcharge'")), false);
});

test('loadSalesByProjectDashboardShell returns filters and does not query dashboard datasets', async () => {
  const { calls, client } = createDashboardClient({});

  const dashboard = await loadSalesByProjectDashboardShell(
    client,
    {
      period: 'week',
      from: '2026-04-01',
      to: '2026-04-30'
    },
    new Date('2026-06-01T12:00:00.000Z')
  );

  assert.equal(calls.length, 0);
  assert.equal(dashboard.filters.period, 'week');
  assert.equal(dashboard.filters.from, '2026-04-01');
  assert.equal(dashboard.filters.to, '2026-04-30');
  assert.deepEqual(dashboard.summary, {
    orderedShifts: 0,
    workedShifts: 0,
    slaPercent: 0,
    revenueRub: 0,
    uniqueWorkers: 0,
    workplacesWithOrders: 0,
    workplacesWithWorkedShifts: 0,
    cancelledShifts: 0,
    selfBookingPercent: 0,
    avgWorkerRateHour: 0
  });
  assert.deepEqual(dashboard.trendRows, []);
  assert.deepEqual(dashboard.brandRows, []);
  assert.deepEqual(dashboard.statusRows, []);
});

test('loadSalesByProjectDashboardSection loads and caches summary independently', async () => {
  let timestamp = Date.parse('2026-06-01T12:00:00.000Z');
  const { calls, client } = createDashboardClient({
    'sales by project orders summary': [
      {
        ordered_shifts: 10,
        workplaces_with_orders: 3
      }
    ],
    'sales by project shifts summary': [
      {
        worked_shifts: 8,
        revenue_rub: 12000,
        unique_workers: 5,
        workplaces_with_worked_shifts: 2,
        cancelled_shifts: 1,
        self_booked_confirmed_shifts: 4,
        avg_worker_rate_hour: 300
      }
    ]
  });
  const cache = createDashboardSectionCache({ now: () => timestamp });
  const input = {
    period: 'month',
    from: '2026-04-01',
    to: '2026-04-30'
  };

  const first = await loadSalesByProjectDashboardSection(
    client,
    input,
    'summary',
    new Date('2026-06-01T12:00:00.000Z'),
    { cache }
  );
  const second = await loadSalesByProjectDashboardSection(
    client,
    input,
    'summary',
    new Date('2026-06-01T12:00:00.000Z'),
    { cache }
  );

  assert.equal(first.summary.orderedShifts, 10);
  assert.equal(first.summary.workedShifts, 8);
  assert.equal(first.summary.slaPercent, 80);
  assert.equal(first.summary.revenueRub, 12000);
  assert.equal(first.dataSource, undefined);
  assert.equal(second.summary.orderedShifts, 10);
  assert.deepEqual(calls.map((call) => call.operation), [
    'sales by project orders summary',
    'sales by project shifts summary'
  ]);

  timestamp = Date.parse('2026-06-02T00:00:00.000Z');

  await loadSalesByProjectDashboardSection(
    client,
    input,
    'summary',
    new Date('2026-06-01T12:00:00.000Z'),
    { cache }
  );

  assert.deepEqual(calls.map((call) => call.operation), [
    'sales by project orders summary',
    'sales by project shifts summary',
    'sales by project orders summary',
    'sales by project shifts summary'
  ]);
});

test('loadSalesByProjectDashboardSection reads from preload when coverage is available', async () => {
  const { calls, client } = createDashboardClient({
    'sales by project orders summary': [{ ordered_shifts: 999 }],
    'sales by project shifts summary': [{ worked_shifts: 999 }]
  });
  const preloadService = {
    readSalesByProjectSectionRows(input) {
      assert.equal(input.section, 'summary');
      assert.equal(input.fromDate, '2026-05-01');
      assert.equal(input.toDate, '2026-06-01');

      return {
        orderSummaryRows: [
          {
            ordered_shifts: 10,
            workplaces_with_orders: 3
          }
        ],
        shiftSummaryRows: [
          {
            worked_shifts: 8,
            revenue_rub: 12000,
            unique_workers: 5,
            workplaces_with_worked_shifts: 2,
            cancelled_shifts: 1,
            self_booked_confirmed_shifts: 4,
            avg_worker_rate_hour: 300
          }
        ]
      };
    }
  };

  const dashboard = await loadSalesByProjectDashboardSection(
    client,
    {
      period: 'month',
      from: '2026-05-01',
      to: '2026-05-31'
    },
    'summary',
    new Date('2026-06-01T12:00:00.000Z'),
    { preloadService }
  );

  assert.equal(calls.length, 0);
  assert.equal(dashboard.summary.orderedShifts, 10);
  assert.equal(dashboard.dataSource, 'preload');
});

test('loadSalesByProjectDashboardSection falls back to ClickHouse when preload misses', async () => {
  const { calls, client } = createDashboardClient({
    'sales by project orders summary': [
      {
        ordered_shifts: 10,
        workplaces_with_orders: 3
      }
    ],
    'sales by project shifts summary': [
      {
        worked_shifts: 8,
        revenue_rub: 12000,
        unique_workers: 5,
        workplaces_with_worked_shifts: 2,
        cancelled_shifts: 1,
        self_booked_confirmed_shifts: 4,
        avg_worker_rate_hour: 300
      }
    ]
  });
  const preloadService = {
    readSalesByProjectSectionRows() {
      return null;
    }
  };

  const dashboard = await loadSalesByProjectDashboardSection(
    client,
    {
      period: 'month',
      from: '2026-05-01',
      to: '2026-05-31'
    },
    'summary',
    new Date('2026-06-01T12:00:00.000Z'),
    { preloadService }
  );

  assert.equal(calls.length, 2);
  assert.equal(dashboard.summary.orderedShifts, 10);
  assert.equal(dashboard.dataSource, 'clickhouse');
});

test('loadSalesByProjectDashboard merges brand rows before limiting them', async () => {
  const fillerBrandOrders = Array.from({ length: 49 }, (_, index) => ({
    brand: `Filler ${index}`,
    ordered_shifts: 1
  }));
  const { calls, client } = createDashboardClient({
    'sales by project brand orders': [
      { brand: 'Общий бренд', ordered_shifts: 5, workplaces_with_orders: 2 },
      ...fillerBrandOrders
    ],
    'sales by project brand shifts': [
      {
        brand: 'Общий бренд',
        worked_shifts: 4,
        revenue_rub: 1000,
        self_booked_confirmed_shifts: 2,
        avg_worker_rate_hour: 300
      },
      {
        brand: 'Только смены',
        worked_shifts: 1000,
        revenue_rub: 5000,
        unique_workers: 20,
        workplaces_with_worked_shifts: 10
      }
    ]
  });

  const dashboard = await loadSalesByProjectDashboard(
    client,
    {
      period: 'month',
      from: '2026-04-01',
      to: '2026-04-30'
    },
    new Date('2026-06-01T12:00:00.000Z')
  );
  const sharedBrand = dashboard.brandRows.find((row) => row.brand === 'Общий бренд');
  const shiftsOnlyBrand = dashboard.brandRows.find((row) => row.brand === 'Только смены');
  const brandQueries = calls.filter((call) =>
    ['sales by project brand orders', 'sales by project brand shifts'].includes(call.operation)
  );

  assert.equal(dashboard.brandRows.length, 50);
  assert.equal(sharedBrand.orderedShifts, 5);
  assert.equal(sharedBrand.workedShifts, 4);
  assert.equal(sharedBrand.slaPercent, 80);
  assert.equal(sharedBrand.avgWorkerRateHour, 300);
  assert.equal(shiftsOnlyBrand.orderedShifts, 0);
  assert.equal(shiftsOnlyBrand.workedShifts, 1000);
  assert.ok(brandQueries.every((call) => !call.query.includes('LIMIT 50')));
});

test('loadSalesByProjectDashboard uses signed non-deleted transactions for selected shift facts', async () => {
  const { calls, client } = createDashboardClient({});

  await loadSalesByProjectDashboard(
    client,
    {
      period: 'month',
      from: '2026-04-01',
      to: '2026-04-30'
    },
    new Date('2026-06-01T12:00:00.000Z')
  );

  assert.ok(calls.some((call) => call.query.includes('FROM mg_transactions AS t')));
  assert.ok(
    calls.some((call) => call.query.includes('INNER JOIN shift_facts AS sf ON t.entityId = sf.job'))
  );
  assert.ok(calls.some((call) => call.query.includes('ifNull(t.deleted, 0) = 0')));
  assert.equal(calls.some((call) => call.query.includes("t.transaction_type = 'surcharge'")), false);
  assert.ok(calls.some((call) => call.query.includes("t.entityId != ''")));
  assert.ok(calls.some((call) => call.query.includes('sum(')));
});

test('loadSalesByProjectDashboard uses a lightweight status breakdown query', async () => {
  const { calls, client } = createDashboardClient({});

  await loadSalesByProjectDashboard(
    client,
    {
      period: 'month',
      from: '2026-04-01',
      to: '2026-04-30'
    },
    new Date('2026-06-01T12:00:00.000Z')
  );

  const statusQuery = calls.find((call) => call.operation === 'sales by project status breakdown');

  assert.ok(statusQuery.query.includes('actual_orders AS ('));
  assert.ok(statusQuery.query.includes('FROM shift_facts'));
  assert.equal(statusQuery.query.includes('FROM shift_enriched'), false);
  assert.equal(statusQuery.query.includes('FROM mg_transactions AS t'), false);
});

test('loadSalesByProjectDashboard maps empty responses to zero summary and empty rows', async () => {
  const { client } = createDashboardClient({});

  const dashboard = await loadSalesByProjectDashboard(
    client,
    {
      period: 'month',
      from: '2026-04-01',
      to: '2026-04-30'
    },
    new Date('2026-06-01T12:00:00.000Z')
  );

  assert.deepEqual(dashboard.summary, {
    orderedShifts: 0,
    workedShifts: 0,
    slaPercent: 0,
    revenueRub: 0,
    uniqueWorkers: 0,
    workplacesWithOrders: 0,
    workplacesWithWorkedShifts: 0,
    cancelledShifts: 0,
    selfBookingPercent: 0,
    avgWorkerRateHour: 0
  });
  assert.deepEqual(dashboard.trendRows, []);
  assert.deepEqual(dashboard.brandRows, []);
  assert.deepEqual(dashboard.statusRows, []);
});

test('loadSalesByProjectDashboard converts ClickHouse numeric strings to numeric KPI values', async () => {
  const { client } = createDashboardClient({
    'sales by project orders summary': [
      {
        ordered_shifts: '10',
        workplaces_with_orders: '3',
        avg_worker_rate_hour: '250'
      }
    ],
    'sales by project shifts summary': [
      {
        worked_shifts: '8',
        revenue_rub: '12000',
        unique_workers: '5',
        workplaces_with_worked_shifts: '2',
        cancelled_shifts: '1',
        self_booked_confirmed_shifts: '4',
        avg_worker_rate_hour: '250'
      }
    ]
  });

  const dashboard = await loadSalesByProjectDashboard(
    client,
    {
      period: 'month',
      from: '2026-04-01',
      to: '2026-04-30'
    },
    new Date('2026-06-01T12:00:00.000Z')
  );

  assert.deepEqual(dashboard.summary, {
    orderedShifts: 10,
    workedShifts: 8,
    slaPercent: 80,
    revenueRub: 12000,
    uniqueWorkers: 5,
    workplacesWithOrders: 3,
    workplacesWithWorkedShifts: 2,
    cancelledShifts: 1,
    selfBookingPercent: 50,
    avgWorkerRateHour: 250
  });
});
