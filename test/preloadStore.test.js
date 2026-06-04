const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const {
  DEFAULT_PRELOAD_REFRESH_DAYS,
  SALES_PRELOAD_JOB_ID,
  createPreloadStore
} = require('../src/preloadStore');

async function tempDbPath() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'preload-store-'));
  return path.join(dir, 'preload.sqlite');
}

test('preload store initializes default sales job', async () => {
  const store = createPreloadStore({ filePath: await tempDbPath() });

  try {
    const job = store.getJob(SALES_PRELOAD_JOB_ID);

    assert.equal(job.id, SALES_PRELOAD_JOB_ID);
    assert.equal(job.enabled, true);
    assert.equal(job.scheduleTime, '03:00');
    assert.equal(job.timezone, 'Europe/Moscow');
    assert.equal(job.refreshDays, DEFAULT_PRELOAD_REFRESH_DAYS);
  } finally {
    store.close();
  }
});

test('preload store invalidates legacy sales coverage when successful confirmed flag is added', async () => {
  const filePath = await tempDbPath();
  const legacyDb = new DatabaseSync(filePath);

  try {
    legacyDb.exec(`
CREATE TABLE sales_by_project_shift_facts (
  period_date TEXT NOT NULL,
  brand TEXT NOT NULL,
  job_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  workplace_id TEXT NOT NULL,
  status TEXT NOT NULL,
  revenue_rub REAL NOT NULL DEFAULT 0,
  cancelled_shifts REAL NOT NULL DEFAULT 0,
  self_booked_confirmed_shift REAL NOT NULL DEFAULT 0,
  worker_rate_hour REAL NOT NULL DEFAULT 0,
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY (period_date, job_id)
);

CREATE TABLE sales_by_project_coverage (
  period_date TEXT PRIMARY KEY,
  source_from TEXT NOT NULL,
  source_to TEXT NOT NULL,
  refreshed_at TEXT NOT NULL
);

INSERT INTO sales_by_project_shift_facts (
  period_date,
  brand,
  job_id,
  worker_id,
  workplace_id,
  status,
  revenue_rub,
  cancelled_shifts,
  self_booked_confirmed_shift,
  worker_rate_hour,
  refreshed_at
) VALUES (
  '2026-05-01',
  'Brand A',
  'legacy-confirmed',
  'worker-1',
  'workplace-1',
  'confirmed',
  100,
  0,
  0,
  300,
  '2026-06-04T10:00:00.000Z'
);

INSERT INTO sales_by_project_coverage (
  period_date,
  source_from,
  source_to,
  refreshed_at
) VALUES (
  '2026-05-01',
  '2026-05-01',
  '2026-05-02',
  '2026-06-04T10:00:00.000Z'
);
`);
  } finally {
    legacyDb.close();
  }

  const store = createPreloadStore({ filePath });

  try {
    assert.equal(store.hasSalesByProjectCoverage('2026-05-01', '2026-05-02'), false);
    assert.equal(
      store.readSalesByProjectSectionRows({
        section: 'summary',
        period: 'month',
        fromDate: '2026-05-01',
        toDate: '2026-05-02'
      }),
      null
    );
  } finally {
    store.close();
  }
});

test('preload store saves schedule and run history', async () => {
  const store = createPreloadStore({
    filePath: await tempDbPath(),
    now: () => new Date('2026-06-04T10:00:00.000Z')
  });

  try {
    const saved = store.saveJobSchedule(SALES_PRELOAD_JOB_ID, {
      enabled: false,
      scheduleTime: '04:30',
      refreshDays: 60
    });
    const run = store.startRun({
      jobId: SALES_PRELOAD_JOB_ID,
      trigger: 'manual',
      fromDate: '2026-05-01',
      toDate: '2026-06-01'
    });

    store.finishRun(run.id, {
      status: 'success',
      rowsWritten: 3
    });

    const runs = store.listRuns(SALES_PRELOAD_JOB_ID, 5);

    assert.equal(saved.enabled, false);
    assert.equal(saved.scheduleTime, '04:30');
    assert.equal(saved.refreshDays, 60);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].status, 'success');
    assert.equal(runs[0].rowsWritten, 3);
  } finally {
    store.close();
  }
});

test('preload store replaces sales range transactionally and reports coverage', async () => {
  const store = createPreloadStore({
    filePath: await tempDbPath(),
    now: () => new Date('2026-06-04T10:00:00.000Z')
  });

  try {
    store.replaceSalesByProjectRange({
      fromDate: '2026-05-01',
      toDate: '2026-05-03',
      dailyRows: [
        {
          period_date: '2026-05-01',
          brand: 'Brand A',
          ordered_shifts: 10,
          revenue_rub: 1000,
          status: '',
          shifts: 0
        },
        {
          period_date: '2026-05-01',
          brand: '',
          ordered_shifts: 0,
          revenue_rub: 0,
          status: 'confirmed',
          shifts: 7
        },
        {
          period_date: '2026-05-02',
          brand: 'Brand A',
          ordered_shifts: 5,
          revenue_rub: 500,
          status: '',
          shifts: 0
        }
      ],
      orderFacts: [
        { period_date: '2026-05-01', brand: 'Brand A', order_id: 'o1', workplace_id: 'w1', ordered_shifts: 10 },
        { period_date: '2026-05-02', brand: 'Brand A', order_id: 'o2', workplace_id: 'w1', ordered_shifts: 5 }
      ],
      shiftFacts: [
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
          period_date: '2026-05-02',
          brand: 'Brand A',
          job_id: 'j2',
          worker_id: 'worker-1',
          workplace_id: 'w1',
          status: 'failed',
          revenue_rub: 0,
          cancelled_shifts: 1,
          self_booked_confirmed_shift: 0,
          worker_rate_hour: 0
        }
      ]
    });

    assert.equal(store.hasSalesByProjectCoverage('2026-05-01', '2026-05-03'), true);
    assert.equal(store.hasSalesByProjectCoverage('2026-05-01', '2026-05-04'), false);

    const summary = store.readSalesByProjectSectionRows({
      section: 'summary',
      period: 'month',
      fromDate: '2026-05-01',
      toDate: '2026-05-03'
    });

    assert.equal(summary.orderSummaryRows[0].ordered_shifts, 15);
    assert.equal(summary.orderSummaryRows[0].workplaces_with_orders, 1);
    assert.equal(summary.shiftSummaryRows[0].unique_workers, 1);
    assert.equal(summary.shiftSummaryRows[0].self_booked_confirmed_shifts, 1);
  } finally {
    store.close();
  }
});

test('preload store creates complete daily schema and stores daily metrics', async () => {
  const filePath = await tempDbPath();
  const store = createPreloadStore({
    filePath,
    now: () => new Date('2026-06-04T10:00:00.000Z')
  });

  try {
    store.replaceSalesByProjectRange({
      fromDate: '2026-05-01',
      toDate: '2026-05-02',
      dailyRows: [
        {
          period_date: '2026-05-01',
          brand: 'Brand A',
          ordered_shifts: 10,
          workplaces_with_orders: 2,
          worked_shifts: 8,
          unique_workers: 7,
          workplaces_with_worked_shifts: 3
        },
        {
          period_date: '2026-05-01',
          brand: 'Brand B'
        }
      ],
      orderFacts: [],
      shiftFacts: []
    });

    const db = new DatabaseSync(filePath, { readOnly: true });

    try {
      const columns = new Set(
        db.prepare('PRAGMA table_info(sales_by_project_daily)').all().map((row) => row.name)
      );
      const rows = db.prepare(`
SELECT
  brand,
  workplaces_with_orders,
  worked_shifts,
  unique_workers,
  workplaces_with_worked_shifts
FROM sales_by_project_daily
ORDER BY brand
`).all();

      assert.equal(columns.has('workplaces_with_orders'), true);
      assert.equal(columns.has('worked_shifts'), true);
      assert.equal(columns.has('unique_workers'), true);
      assert.equal(columns.has('workplaces_with_worked_shifts'), true);
      assert.deepEqual(
        rows.map((row) => ({ ...row })),
        [
          {
            brand: 'Brand A',
            workplaces_with_orders: 2,
            worked_shifts: 8,
            unique_workers: 7,
            workplaces_with_worked_shifts: 3
          },
          {
            brand: 'Brand B',
            workplaces_with_orders: 0,
            worked_shifts: 0,
            unique_workers: 0,
            workplaces_with_worked_shifts: 0
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

test('preload store rejects unsupported sales period values for all sections', async () => {
  const store = createPreloadStore({ filePath: await tempDbPath() });

  try {
    store.replaceSalesByProjectRange({
      fromDate: '2026-05-01',
      toDate: '2026-05-02',
      dailyRows: [{ period_date: '2026-05-01', brand: 'Brand A' }],
      orderFacts: [],
      shiftFacts: []
    });

    for (const section of ['summary', 'trend', 'brands', 'statuses']) {
      assert.throws(
        () =>
          store.readSalesByProjectSectionRows({
            section,
            period: 'year',
            fromDate: '2026-05-01',
            toDate: '2026-05-02'
          }),
        /Unsupported sales by project period: year/
      );
    }
  } finally {
    store.close();
  }
});

test('preload store rolls back range replacement when a later insert fails', async () => {
  const store = createPreloadStore({ filePath: await tempDbPath() });

  try {
    store.replaceSalesByProjectRange({
      fromDate: '2026-05-01',
      toDate: '2026-05-02',
      dailyRows: [{ period_date: '2026-05-01', brand: 'Brand A', ordered_shifts: 10 }],
      orderFacts: [
        { period_date: '2026-05-01', brand: 'Brand A', order_id: 'o1', workplace_id: 'w1', ordered_shifts: 10 }
      ],
      shiftFacts: []
    });

    assert.throws(
      () =>
        store.replaceSalesByProjectRange({
          fromDate: '2026-05-01',
          toDate: '2026-05-02',
          dailyRows: [{ period_date: '2026-05-01', brand: 'Brand A', ordered_shifts: 99 }],
          orderFacts: [
            { period_date: '2026-05-01', brand: 'Brand A', order_id: 'duplicate', workplace_id: 'w2', ordered_shifts: 1 },
            { period_date: '2026-05-01', brand: 'Brand A', order_id: 'duplicate', workplace_id: 'w3', ordered_shifts: 2 }
          ],
          shiftFacts: []
        }),
      /UNIQUE constraint failed/
    );

    const summary = store.readSalesByProjectSectionRows({
      section: 'summary',
      period: 'month',
      fromDate: '2026-05-01',
      toDate: '2026-05-02'
    });

    assert.equal(summary.orderSummaryRows[0].ordered_shifts, 10);
    assert.equal(summary.orderSummaryRows[0].workplaces_with_orders, 1);
  } finally {
    store.close();
  }
});

test('preload store tracks coverage for empty and adjacent sales ranges', async () => {
  const store = createPreloadStore({ filePath: await tempDbPath() });

  try {
    store.replaceSalesByProjectRange({
      fromDate: '2026-05-01',
      toDate: '2026-05-02',
      dailyRows: [],
      orderFacts: [],
      shiftFacts: []
    });

    assert.equal(store.hasSalesByProjectCoverage('2026-05-01', '2026-05-02'), true);

    const emptySummary = store.readSalesByProjectSectionRows({
      section: 'summary',
      period: 'month',
      fromDate: '2026-05-01',
      toDate: '2026-05-02'
    });

    assert.equal(emptySummary.orderSummaryRows[0].ordered_shifts, 0);

    store.replaceSalesByProjectRange({
      fromDate: '2026-05-02',
      toDate: '2026-05-03',
      dailyRows: [],
      orderFacts: [],
      shiftFacts: []
    });

    assert.equal(store.hasSalesByProjectCoverage('2026-05-01', '2026-05-03'), true);
    assert.equal(store.hasSalesByProjectCoverage('2026-05-01', '2026-05-04'), false);
  } finally {
    store.close();
  }
});

test('preload store overview reports the latest continuous covered segment', async () => {
  const store = createPreloadStore({ filePath: await tempDbPath() });

  try {
    store.replaceSalesByProjectRange({
      fromDate: '2026-05-01',
      toDate: '2026-05-03',
      dailyRows: [],
      orderFacts: [],
      shiftFacts: []
    });
    store.replaceSalesByProjectRange({
      fromDate: '2026-05-04',
      toDate: '2026-05-05',
      dailyRows: [],
      orderFacts: [],
      shiftFacts: []
    });

    const overview = store.getSalesByProjectOverview();

    assert.equal(overview.coveredFrom, '2026-05-04');
    assert.equal(overview.coveredTo, '2026-05-05');
  } finally {
    store.close();
  }
});

test('preload store validates row dates inside range and rolls back changes', async () => {
  const store = createPreloadStore({ filePath: await tempDbPath() });

  try {
    store.replaceSalesByProjectRange({
      fromDate: '2026-05-01',
      toDate: '2026-05-03',
      dailyRows: [{ period_date: '2026-05-01', brand: 'Brand A' }],
      orderFacts: [
        { period_date: '2026-05-01', brand: 'Brand A', order_id: 'o1', workplace_id: 'w1', ordered_shifts: 10 }
      ],
      shiftFacts: [
        {
          period_date: '2026-05-01',
          brand: 'Brand A',
          job_id: 'j1',
          worker_id: 'worker-1',
          workplace_id: 'w1',
          status: 'confirmed',
          revenue_rub: 100,
          cancelled_shifts: 0,
          self_booked_confirmed_shift: 0,
          worker_rate_hour: 300
        }
      ]
    });

    assert.throws(
      () =>
        store.replaceSalesByProjectRange({
          fromDate: '2026-05-01',
          toDate: '2026-05-03',
          dailyRows: [{ period_date: '2026-05-03', brand: 'Brand B', ordered_shifts: 99 }],
          orderFacts: [
            { period_date: '2026-04-30', brand: 'Brand B', order_id: 'o2', workplace_id: 'w2', ordered_shifts: 99 }
          ],
          shiftFacts: [
            {
              period_date: '2026-05-03',
              brand: 'Brand B',
              job_id: 'j2',
              worker_id: 'worker-2',
              workplace_id: 'w2',
              status: 'confirmed',
              revenue_rub: 999,
              cancelled_shifts: 0,
              self_booked_confirmed_shift: 0,
              worker_rate_hour: 400
            }
          ]
        }),
      /outside preload range/
    );

    const summary = store.readSalesByProjectSectionRows({
      section: 'summary',
      period: 'month',
      fromDate: '2026-05-01',
      toDate: '2026-05-03'
    });

    assert.equal(summary.orderSummaryRows[0].ordered_shifts, 10);
    assert.equal(summary.shiftSummaryRows[0].worked_shifts, 1);
    assert.equal(summary.shiftSummaryRows[0].revenue_rub, 100);
  } finally {
    store.close();
  }
});

test('preload store reads trend brands statuses and confirmed positive averages', async () => {
  const store = createPreloadStore({ filePath: await tempDbPath() });

  try {
    store.replaceSalesByProjectRange({
      fromDate: '2026-05-01',
      toDate: '2026-05-04',
      dailyRows: [],
      orderFacts: [
        { period_date: '2026-05-01', brand: 'Brand A', order_id: 'o1', workplace_id: 'w1', ordered_shifts: 3 },
        { period_date: '2026-05-02', brand: 'Brand A', order_id: 'o2', workplace_id: 'w1', ordered_shifts: 4 },
        { period_date: '2026-05-02', brand: 'Brand B', order_id: 'o3', workplace_id: 'w2', ordered_shifts: 5 }
      ],
      shiftFacts: [
        {
          period_date: '2026-05-01',
          brand: 'Brand A',
          job_id: 'j1',
          worker_id: 'worker-1',
          workplace_id: 'w1',
          status: 'confirmed',
          revenue_rub: 100,
          cancelled_shifts: 0,
          self_booked_confirmed_shift: 1,
          worker_rate_hour: 300
        },
        {
          period_date: '2026-05-02',
          brand: 'Brand A',
          job_id: 'j2',
          worker_id: 'worker-1',
          workplace_id: 'w1',
          status: 'confirmed',
          revenue_rub: 200,
          cancelled_shifts: 0,
          self_booked_confirmed_shift: 0,
          worker_rate_hour: 0
        },
        {
          period_date: '2026-05-02',
          brand: 'Brand A',
          job_id: 'j3',
          worker_id: 'worker-2',
          workplace_id: 'w2',
          status: 'confirmed',
          revenue_rub: 300,
          cancelled_shifts: 0,
          self_booked_confirmed_shift: 1,
          worker_rate_hour: 500
        },
        {
          period_date: '2026-05-03',
          brand: 'Brand A',
          job_id: 'j4',
          worker_id: 'worker-3',
          workplace_id: 'w3',
          status: 'failed',
          revenue_rub: 999,
          cancelled_shifts: 1,
          self_booked_confirmed_shift: 1,
          worker_rate_hour: 700
        },
        {
          period_date: '2026-05-03',
          brand: 'Brand B',
          job_id: 'j5',
          worker_id: 'worker-2',
          workplace_id: 'w2',
          status: 'cancelled',
          revenue_rub: 50,
          cancelled_shifts: 1,
          self_booked_confirmed_shift: 0,
          worker_rate_hour: 800
        }
      ]
    });

    const summary = store.readSalesByProjectSectionRows({
      section: 'summary',
      period: 'day',
      fromDate: '2026-05-01',
      toDate: '2026-05-04'
    });
    const trend = store.readSalesByProjectSectionRows({
      section: 'trend',
      period: 'day',
      fromDate: '2026-05-01',
      toDate: '2026-05-04'
    });
    const brands = store.readSalesByProjectSectionRows({
      section: 'brands',
      period: 'day',
      fromDate: '2026-05-01',
      toDate: '2026-05-04'
    });
    const statuses = store.readSalesByProjectSectionRows({
      section: 'statuses',
      period: 'day',
      fromDate: '2026-05-01',
      toDate: '2026-05-04'
    });

    assert.equal(summary.shiftSummaryRows[0].avg_worker_rate_hour, 400);

    assert.deepEqual(
      trend.orderTrendRows.map((row) => ({ ...row })),
      [
        { period: '2026-05-01', ordered_shifts: 3 },
        { period: '2026-05-02', ordered_shifts: 9 }
      ]
    );
    assert.deepEqual(
      trend.shiftTrendRows.map((row) => ({ ...row })),
      [
        { period: '2026-05-01', worked_shifts: 1, revenue_rub: 100, cancelled_shifts: 0 },
        { period: '2026-05-02', worked_shifts: 2, revenue_rub: 500, cancelled_shifts: 0 },
        { period: '2026-05-03', worked_shifts: 0, revenue_rub: 0, cancelled_shifts: 2 }
      ]
    );

    assert.deepEqual(
      brands.brandOrderRows.map((row) => ({ ...row })),
      [
        { brand: 'Brand A', ordered_shifts: 7, workplaces_with_orders: 1 },
        { brand: 'Brand B', ordered_shifts: 5, workplaces_with_orders: 1 }
      ]
    );
    assert.deepEqual(
      brands.brandShiftRows.map((row) => ({ ...row })),
      [
        {
          brand: 'Brand A',
          worked_shifts: 3,
          revenue_rub: 600,
          unique_workers: 2,
          workplaces_with_worked_shifts: 2,
          cancelled_shifts: 1,
          self_booked_confirmed_shifts: 2,
          avg_worker_rate_hour: 400
        },
        {
          brand: 'Brand B',
          worked_shifts: 0,
          revenue_rub: 0,
          unique_workers: 0,
          workplaces_with_worked_shifts: 0,
          cancelled_shifts: 1,
          self_booked_confirmed_shifts: 0,
          avg_worker_rate_hour: 0
        }
      ]
    );
    assert.deepEqual(
      statuses.statusRows.map((row) => ({ ...row })),
      [
        { status: 'confirmed', shifts: 3 },
        { status: 'failed', shifts: 1 },
        { status: 'cancelled', shifts: 1 }
      ]
    );
  } finally {
    store.close();
  }
});

test('preload store creates run history index and normalizes non-finite numbers', async () => {
  const filePath = await tempDbPath();
  const store = createPreloadStore({ filePath });

  try {
    store.replaceSalesByProjectRange({
      fromDate: '2026-05-01',
      toDate: '2026-05-02',
      dailyRows: [
        {
          period_date: '2026-05-01',
          brand: 'Brand A',
          ordered_shifts: Infinity,
          worked_shifts: NaN
        }
      ],
      orderFacts: [
        { period_date: '2026-05-01', brand: 'Brand A', order_id: 'o1', workplace_id: 'w1', ordered_shifts: Infinity }
      ],
      shiftFacts: [
        {
          period_date: '2026-05-01',
          brand: 'Brand A',
          job_id: 'j1',
          worker_id: 'worker-1',
          workplace_id: 'w1',
          status: 'confirmed',
          revenue_rub: Infinity,
          cancelled_shifts: NaN,
          self_booked_confirmed_shift: Infinity,
          worker_rate_hour: Infinity
        }
      ]
    });

    const summary = store.readSalesByProjectSectionRows({
      section: 'summary',
      period: 'month',
      fromDate: '2026-05-01',
      toDate: '2026-05-02'
    });

    assert.equal(summary.orderSummaryRows[0].ordered_shifts, 0);
    assert.equal(summary.shiftSummaryRows[0].revenue_rub, 0);
    assert.equal(summary.shiftSummaryRows[0].cancelled_shifts, 0);
    assert.equal(summary.shiftSummaryRows[0].self_booked_confirmed_shifts, 0);
    assert.equal(summary.shiftSummaryRows[0].avg_worker_rate_hour, 0);

    const db = new DatabaseSync(filePath, { readOnly: true });

    try {
      const indexRows = db.prepare("PRAGMA index_list('preload_runs')").all();

      assert.equal(indexRows.some((row) => row.name === 'idx_preload_runs_job_id'), true);
    } finally {
      db.close();
    }
  } finally {
    store.close();
  }
});

test('preload store treats zero-length sales ranges as covered empty results', async () => {
  const store = createPreloadStore({ filePath: await tempDbPath() });

  try {
    assert.equal(store.hasSalesByProjectCoverage('2026-05-01', '2026-05-01'), true);

    const summary = store.readSalesByProjectSectionRows({
      section: 'summary',
      period: 'month',
      fromDate: '2026-05-01',
      toDate: '2026-05-01'
    });

    assert.equal(summary.orderSummaryRows[0].ordered_shifts, 0);
    assert.equal(summary.orderSummaryRows[0].workplaces_with_orders, 0);
    assert.equal(summary.shiftSummaryRows[0].worked_shifts, 0);
    assert.equal(summary.shiftSummaryRows[0].revenue_rub, 0);
    assert.equal(summary.shiftSummaryRows[0].unique_workers, 0);
  } finally {
    store.close();
  }
});

test('preload store overview keeps last failed error when a later run is running', async () => {
  const store = createPreloadStore({
    filePath: await tempDbPath(),
    now: () => new Date('2026-06-04T10:00:00.000Z')
  });

  try {
    const failedRun = store.startRun({
      jobId: SALES_PRELOAD_JOB_ID,
      trigger: 'schedule',
      fromDate: '2026-05-01',
      toDate: '2026-05-02'
    });

    store.finishRun(failedRun.id, {
      status: 'failed',
      errorMessage: 'ClickHouse timeout'
    });
    store.startRun({
      jobId: SALES_PRELOAD_JOB_ID,
      trigger: 'manual',
      fromDate: '2026-05-02',
      toDate: '2026-05-03'
    });

    assert.equal(store.getSalesByProjectOverview().lastError, 'ClickHouse timeout');
  } finally {
    store.close();
  }
});

test('preload store rejects unknown sales preload sections', async () => {
  const store = createPreloadStore({ filePath: await tempDbPath() });

  try {
    assert.throws(
      () =>
        store.readSalesByProjectSectionRows({
          section: 'unknown',
          period: 'month',
          fromDate: '2026-05-01',
          toDate: '2026-05-01'
        }),
      /Unknown sales by project preload section/
    );
  } finally {
    store.close();
  }
});

test('preload store rejects inverted sales date ranges', async () => {
  const store = createPreloadStore({ filePath: await tempDbPath() });

  try {
    assert.throws(
      () => store.hasSalesByProjectCoverage('2026-05-03', '2026-05-01'),
      /Invalid sales by project preload range/
    );
    assert.throws(
      () =>
        store.readSalesByProjectSectionRows({
          section: 'summary',
          period: 'month',
          fromDate: '2026-05-03',
          toDate: '2026-05-01'
        }),
      /Invalid sales by project preload range/
    );
    assert.throws(
      () =>
        store.replaceSalesByProjectRange({
          fromDate: '2026-05-03',
          toDate: '2026-05-01',
          dailyRows: [],
          orderFacts: [],
          shiftFacts: []
        }),
      /Invalid sales by project preload range/
    );
  } finally {
    store.close();
  }
});

test('preload store status rows count all shift facts', async () => {
  const filePath = await tempDbPath();
  const store = createPreloadStore({ filePath });

  try {
    store.replaceSalesByProjectRange({
      fromDate: '2026-05-01',
      toDate: '2026-05-02',
      dailyRows: [],
      orderFacts: [],
      shiftFacts: [
        {
          period_date: '2026-05-01',
          brand: 'Brand A',
          job_id: 'same-job',
          worker_id: 'worker-1',
          workplace_id: 'w1',
          status: 'confirmed',
          revenue_rub: 100,
          cancelled_shifts: 0,
          self_booked_confirmed_shift: 0,
          worker_rate_hour: 300
        },
        {
          period_date: '2026-05-01',
          brand: 'Brand A',
          job_id: 'same-job-2',
          worker_id: 'worker-1',
          workplace_id: 'w1',
          status: 'confirmed',
          revenue_rub: 100,
          cancelled_shifts: 0,
          self_booked_confirmed_shift: 0,
          worker_rate_hour: 300
        },
        {
          period_date: '2026-05-01',
          brand: 'Brand A',
          job_id: 'failed-job',
          worker_id: 'worker-2',
          workplace_id: 'w2',
          status: 'failed',
          revenue_rub: 0,
          cancelled_shifts: 1,
          self_booked_confirmed_shift: 0,
          worker_rate_hour: 0
        }
      ]
    });

    const db = new DatabaseSync(filePath);

    try {
      db.prepare(`
INSERT INTO sales_by_project_shift_facts (
  period_date,
  brand,
  job_id,
  worker_id,
  workplace_id,
  status,
  revenue_rub,
  cancelled_shifts,
  self_booked_confirmed_shift,
  worker_rate_hour,
  refreshed_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run('2026-05-01', 'Brand A', '', 'worker-legacy', 'w3', 'confirmed', 0, 0, 0, 0, '2026-06-04T10:00:00.000Z');
    } finally {
      db.close();
    }

    const statuses = store.readSalesByProjectSectionRows({
      section: 'statuses',
      period: 'month',
      fromDate: '2026-05-01',
      toDate: '2026-05-02'
    });

    assert.deepEqual(
      statuses.statusRows.map((row) => ({ ...row })),
      [
        { status: 'confirmed', shifts: 3 },
        { status: 'failed', shifts: 1 }
      ]
    );
  } finally {
    store.close();
  }
});

test('preload store rejects empty fact ids and rolls back changes', async () => {
  const store = createPreloadStore({ filePath: await tempDbPath() });

  try {
    store.replaceSalesByProjectRange({
      fromDate: '2026-05-01',
      toDate: '2026-05-02',
      dailyRows: [],
      orderFacts: [
        { period_date: '2026-05-01', brand: 'Brand A', order_id: 'o1', workplace_id: 'w1', ordered_shifts: 10 }
      ],
      shiftFacts: [
        {
          period_date: '2026-05-01',
          brand: 'Brand A',
          job_id: 'j1',
          worker_id: 'worker-1',
          workplace_id: 'w1',
          status: 'confirmed',
          revenue_rub: 100,
          cancelled_shifts: 0,
          self_booked_confirmed_shift: 0,
          worker_rate_hour: 300
        }
      ]
    });

    assert.throws(
      () =>
        store.replaceSalesByProjectRange({
          fromDate: '2026-05-01',
          toDate: '2026-05-02',
          dailyRows: [],
          orderFacts: [
            { period_date: '2026-05-01', brand: 'Brand B', order_id: '   ', workplace_id: 'w2', ordered_shifts: 99 }
          ],
          shiftFacts: [
            {
              period_date: '2026-05-01',
              brand: 'Brand B',
              job_id: '   ',
              worker_id: 'worker-2',
              workplace_id: 'w2',
              status: 'confirmed',
              revenue_rub: 999,
              cancelled_shifts: 0,
              self_booked_confirmed_shift: 0,
              worker_rate_hour: 500
            }
          ]
        }),
      /requires non-empty/
    );

    const summary = store.readSalesByProjectSectionRows({
      section: 'summary',
      period: 'month',
      fromDate: '2026-05-01',
      toDate: '2026-05-02'
    });

    assert.equal(summary.orderSummaryRows[0].ordered_shifts, 10);
    assert.equal(summary.shiftSummaryRows[0].worked_shifts, 1);
    assert.equal(summary.shiftSummaryRows[0].revenue_rub, 100);
  } finally {
    store.close();
  }
});
