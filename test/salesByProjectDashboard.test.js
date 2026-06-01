const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPeriodExpression,
  loadSalesByProjectDashboard,
  normalizeSalesByProjectFilters
} = require('../src/salesByProjectDashboard');

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
            self_booked_confirmed_shifts: 4
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
            self_booked_confirmed_shifts: 4
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
  assert.equal(dashboard.summary.avgWorkerRateHour, 250);
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
  assert.equal(calls.some((call) => call.query.includes('DROP TABLE')), false);
  assert.ok(
    calls.some((call) =>
      call.query.includes("ifNull(nullIf(o.contract_type, ''), 'services') AS contract_type")
    )
  );
  assert.equal(
    calls.some((call) => call.query.includes('ct.contract_type AS contract_type')),
    false
  );
  assert.equal(
    calls.some((call) => call.query.includes("nullIf(ct.contract_type, '')")),
    false
  );
});
