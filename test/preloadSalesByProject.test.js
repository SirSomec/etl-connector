const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { createPreloadStore } = require('../src/preloadStore');
const {
  buildSalesByProjectPreloadQueries,
  refreshSalesByProjectPreload
} = require('../src/preloadSalesByProject');

async function tempDbPath() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'preload-sales-'));
  return path.join(dir, 'preload.sqlite');
}

function createSalesClient(calls) {
  return {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'preload sales by project order facts') {
        return [
          {
            period_date: '2026-05-01',
            brand: 'Brand A',
            order_id: 'o1',
            workplace_id: 'w1',
            ordered_shifts: 10
          }
        ];
      }

      if (operation === 'preload sales by project shift facts') {
        return [
          {
            period_date: '2026-05-01',
            brand: 'Brand A',
            job_id: 'j1',
            worker_id: 'worker-1',
            workplace_id: 'w1',
            status: 'confirmed',
            revenue_rub: 1000,
            cancelled_shifts: 0,
            self_booked_confirmed_shift: 1,
            worker_rate_hour: 300
          },
          {
            period_date: '2026-05-01',
            brand: 'Brand A',
            job_id: 'j2',
            worker_id: 'worker-2',
            workplace_id: 'w1',
            status: 'failed',
            revenue_rub: 0,
            cancelled_shifts: 1,
            self_booked_confirmed_shift: 0,
            worker_rate_hour: 0
          }
        ];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  };
}

function findCall(calls, operation) {
  return calls.find((call) => call.operation === operation);
}

test('sales preload query builders use parameterized ClickHouse ranges', () => {
  const queries = buildSalesByProjectPreloadQueries();

  assert.equal(queries.orderFacts.includes('FROM mg_orders AS o'), true);
  assert.equal(queries.orderFacts.includes('{from:DateTime}'), true);
  assert.equal(queries.orderFacts.includes('{to:DateTime}'), true);
  assert.equal(queries.orderFacts.includes("ifNull(o._id, '') != ''"), false);
  assert.equal(queries.shiftFacts.includes('FROM mg_jobs AS j'), true);
  assert.equal(queries.shiftFacts.includes('mg_job_history'), true);
  assert.equal(queries.shiftFacts.includes('mg_transactions'), true);
  assert.equal(queries.shiftFacts.includes('INNER JOIN shift_facts AS sf'), true);
  assert.equal(queries.shiftFacts.includes("contract_type = 'saas'"), true);
  assert.equal(queries.shiftFacts.includes("if(ifNull(cancellation_reason, '') != '' OR status = 'failed', 1, 0) AS cancelled_shifts"), true);
  assert.equal(queries.shiftFacts.includes("if(status = 'confirmed' AND is_self_booked = 1, 1, 0) AS self_booked_confirmed_shift"), true);
  assert.equal(queries.shiftFacts.includes("if(status = 'confirmed' AND salary_per_hour > 0, salary_per_hour, 0) AS worker_rate_hour"), true);
  assert.equal(queries.shiftFacts.includes('FORMAT JSONEachRow'), true);
});

test('sales preload query builders calculate period dates in Moscow timezone', () => {
  const queries = buildSalesByProjectPreloadQueries();

  assert.match(queries.orderFacts, /toString\(toDate\(o\.start, 'Europe\/Moscow'\)\) AS period_date/);
  assert.match(queries.shiftFacts, /toString\(toDate\(shift_start, 'Europe\/Moscow'\)\) AS period_date/);
});

test('refreshSalesByProjectPreload loads ClickHouse rows and writes sqlite range', async () => {
  const calls = [];
  const client = createSalesClient(calls);
  const store = createPreloadStore({ filePath: await tempDbPath() });

  try {
    const result = await refreshSalesByProjectPreload({
      client,
      store,
      fromDate: '2026-05-01',
      toDate: '2026-05-02'
    });
    const summary = store.readSalesByProjectSectionRows({
      section: 'summary',
      period: 'month',
      fromDate: '2026-05-01',
      toDate: '2026-05-02'
    });

    assert.equal(result.rowsWritten, 6);
    assert.equal(calls.length, 2);
    const orderCall = findCall(calls, 'preload sales by project order facts');
    const shiftCall = findCall(calls, 'preload sales by project shift facts');

    assert.equal(orderCall.params.param_from, '2026-05-01 00:00:00');
    assert.equal(orderCall.params.param_to, '2026-05-02 00:00:00');
    assert.equal(shiftCall.params.param_from, '2026-05-01 00:00:00');
    assert.equal(shiftCall.params.param_to, '2026-05-02 00:00:00');
    assert.equal(summary.orderSummaryRows[0].ordered_shifts, 10);
    assert.equal(summary.shiftSummaryRows[0].worked_shifts, 1);
    assert.equal(summary.shiftSummaryRows[0].unique_workers, 1);
    assert.equal(summary.shiftSummaryRows[0].cancelled_shifts, 1);
  } finally {
    store.close();
  }
});

test('sales preload rejects empty order ids and keeps previous sqlite range', async () => {
  const store = createPreloadStore({ filePath: await tempDbPath() });
  const validCalls = [];
  const validClient = createSalesClient(validCalls);
  const invalidClient = {
    async queryJSONEachRow(query, params, operation) {
      if (operation === 'preload sales by project order facts') {
        return [
          {
            period_date: '2026-05-01',
            brand: 'Brand B',
            order_id: '',
            workplace_id: 'w2',
            ordered_shifts: 99
          }
        ];
      }

      if (operation === 'preload sales by project shift facts') {
        return [];
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  };

  try {
    await refreshSalesByProjectPreload({
      client: validClient,
      store,
      fromDate: '2026-05-01',
      toDate: '2026-05-02'
    });

    await assert.rejects(
      () =>
        refreshSalesByProjectPreload({
          client: invalidClient,
          store,
          fromDate: '2026-05-01',
          toDate: '2026-05-02'
        }),
      /orderFacts requires non-empty order_id/
    );

    const summary = store.readSalesByProjectSectionRows({
      section: 'summary',
      period: 'month',
      fromDate: '2026-05-01',
      toDate: '2026-05-02'
    });

    assert.equal(summary.orderSummaryRows[0].ordered_shifts, 10);
    assert.equal(summary.shiftSummaryRows[0].worked_shifts, 1);
    assert.equal(summary.shiftSummaryRows[0].cancelled_shifts, 1);
  } finally {
    store.close();
  }
});

test('sales preload rollup writes daily brand and status rows for cached sections', async () => {
  const filePath = await tempDbPath();
  const calls = [];
  const client = createSalesClient(calls);
  const store = createPreloadStore({ filePath });

  try {
    await refreshSalesByProjectPreload({
      client,
      store,
      fromDate: '2026-05-01',
      toDate: '2026-05-02'
    });

    const statuses = store.readSalesByProjectSectionRows({
      section: 'statuses',
      period: 'day',
      fromDate: '2026-05-01',
      toDate: '2026-05-02'
    });
    const brands = store.readSalesByProjectSectionRows({
      section: 'brands',
      period: 'day',
      fromDate: '2026-05-01',
      toDate: '2026-05-02'
    });
    const trend = store.readSalesByProjectSectionRows({
      section: 'trend',
      period: 'day',
      fromDate: '2026-05-01',
      toDate: '2026-05-02'
    });

    assert.deepEqual(
      statuses.statusRows
        .map((row) => ({ ...row }))
        .sort((left, right) => left.status.localeCompare(right.status)),
      [
        { status: 'confirmed', shifts: 1 },
        { status: 'failed', shifts: 1 }
      ]
    );
    assert.equal(brands.brandOrderRows[0].brand, 'Brand A');
    assert.equal(brands.brandShiftRows[0].worked_shifts, 1);
    assert.equal(trend.orderTrendRows[0].ordered_shifts, 10);
    assert.equal(trend.shiftTrendRows[0].cancelled_shifts, 1);

    const db = new DatabaseSync(filePath, { readOnly: true });

    try {
      const dailyRows = db.prepare(`
SELECT
  period_date,
  brand,
  ordered_shifts,
  worked_shifts,
  revenue_rub,
  unique_workers,
  workplaces_with_orders,
  workplaces_with_worked_shifts,
  cancelled_shifts,
  self_booked_confirmed_shifts,
  avg_worker_rate_hour_weighted_sum,
  avg_worker_rate_hour_weight,
  status,
  shifts
FROM sales_by_project_daily
ORDER BY brand DESC, status
`).all();

      assert.deepEqual(
        dailyRows.map((row) => ({ ...row })),
        [
          {
            period_date: '2026-05-01',
            brand: 'Brand A',
            ordered_shifts: 10,
            worked_shifts: 1,
            revenue_rub: 1000,
            unique_workers: 1,
            workplaces_with_orders: 1,
            workplaces_with_worked_shifts: 1,
            cancelled_shifts: 1,
            self_booked_confirmed_shifts: 1,
            avg_worker_rate_hour_weighted_sum: 300,
            avg_worker_rate_hour_weight: 1,
            status: '',
            shifts: 0
          },
          {
            period_date: '2026-05-01',
            brand: '',
            ordered_shifts: 0,
            worked_shifts: 0,
            revenue_rub: 0,
            unique_workers: 0,
            workplaces_with_orders: 0,
            workplaces_with_worked_shifts: 0,
            cancelled_shifts: 0,
            self_booked_confirmed_shifts: 0,
            avg_worker_rate_hour_weighted_sum: 0,
            avg_worker_rate_hour_weight: 0,
            status: 'confirmed',
            shifts: 1
          },
          {
            period_date: '2026-05-01',
            brand: '',
            ordered_shifts: 0,
            worked_shifts: 0,
            revenue_rub: 0,
            unique_workers: 0,
            workplaces_with_orders: 0,
            workplaces_with_worked_shifts: 0,
            cancelled_shifts: 0,
            self_booked_confirmed_shifts: 0,
            avg_worker_rate_hour_weighted_sum: 0,
            avg_worker_rate_hour_weight: 0,
            status: 'failed',
            shifts: 1
          }
        ]
      );
    } finally {
      db.close();
    }
  } finally {
    store.close();
  }
});
