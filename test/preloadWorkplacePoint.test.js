const test = require('node:test');
const assert = require('node:assert/strict');

const {
  WORKPLACE_POINT_DASHBOARD_ID,
  WORKPLACE_POINT_PRELOAD_SECTIONS,
  buildWorkplacePointPreloadQueries,
  refreshWorkplacePointPreload
} = require('../src/preloadWorkplacePoint');

const EXPECTED_OPERATIONS = [
  'workplace point preload order facts',
  'workplace point preload shift facts',
  'workplace point preload order status facts',
  'workplace point preload booked workers',
  'workplace point preload review rollups',
  'workplace point preload radius rollups'
];

function createRowsForOperation(operation) {
  return [{ operation }];
}

test('workplace point preload exports dashboard metadata', () => {
  assert.equal(WORKPLACE_POINT_DASHBOARD_ID, 'workplace-point');
  assert.deepEqual(WORKPLACE_POINT_PRELOAD_SECTIONS, ['summary', 'charts', 'year-heatmap', 'radius']);
});

test('refreshWorkplacePointPreload loads hot workplace facts and replaces the range', async () => {
  const calls = [];
  const replacements = [];
  const store = {
    listDashboardPreloadRequests(jobId, limit) {
      assert.equal(jobId, 'workplace-point');
      assert.equal(limit, 1000);
      return [
        { input: { workplaceId: 'wp-hot-1' } },
        { input: { workplaceId: 'wp-hot-2' } },
        { input: { workplaceId: 'wp-hot-1' } },
        { input: { workplaceId: '' } },
        { input: {} }
      ];
    },
    replaceWorkplacePointRange(input) {
      replacements.push(input);
    }
  };
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });
      return createRowsForOperation(operation);
    }
  };

  const result = await refreshWorkplacePointPreload({
    client,
    store,
    fromDate: '2026-06-01',
    toDate: '2026-07-01',
    now: new Date('2026-07-02T09:15:00.000Z')
  });

  assert.deepEqual(calls.map((call) => call.operation), EXPECTED_OPERATIONS);
  assert.equal(result.rowsWritten, EXPECTED_OPERATIONS.length);

  for (const call of calls) {
    assert.equal(call.params.param_from, '2026-06-01 00:00:00');
    assert.equal(call.params.param_to, '2026-07-01 00:00:00');
    assert.equal(call.params.param_current_date, '2026-07-02');
    assert.equal(call.params.param_active_window_date, '2026-07-02');
    assert.equal(call.params.param_active_session_from, '2026-06-02 09:15:00');
    assert.equal(call.params.param_active_session_to, '2026-07-02 09:15:00');
    assert.equal(call.params.param_workplace_ids, "['wp-hot-1','wp-hot-2']");
  }

  assert.equal(replacements.length, 1);
  assert.equal(replacements[0].fromDate, '2026-06-01');
  assert.equal(replacements[0].toDate, '2026-07-01');
  assert.deepEqual(replacements[0].workplaceIds, ['wp-hot-1', 'wp-hot-2']);
  assert.deepEqual(replacements[0].orderFacts, createRowsForOperation('workplace point preload order facts'));
  assert.deepEqual(replacements[0].shiftFacts, createRowsForOperation('workplace point preload shift facts'));
  assert.deepEqual(
    replacements[0].orderStatusFacts,
    createRowsForOperation('workplace point preload order status facts')
  );
  assert.deepEqual(
    replacements[0].bookedWorkerFacts,
    createRowsForOperation('workplace point preload booked workers')
  );
  assert.deepEqual(
    replacements[0].reviewRollups,
    createRowsForOperation('workplace point preload review rollups')
  );
  assert.deepEqual(
    replacements[0].radiusRollups,
    createRowsForOperation('workplace point preload radius rollups')
  );
});

test('workplace point preload query builders keep joins and filters safe', () => {
  const queries = buildWorkplacePointPreloadQueries();
  const allSql = Object.values(queries).join('\n');

  assert.equal(allSql.includes('mygig_'), false);
  assert.equal(queries.orderFacts.includes('FROM mg_orders AS o'), true);
  assert.equal(queries.orderFacts.includes('INNER JOIN mg_clients AS c ON c._id = o.client'), true);
  assert.equal(queries.orderFacts.includes('LEFT JOIN mg_workplaces AS ow ON ow._id = o.workplace'), true);
  assert.equal(queries.orderFacts.includes('LEFT JOIN mg_contractors AS ct ON ct._id = ow.contractor'), true);
  assert.equal(queries.orderFacts.includes('LEFT JOIN mg_professions AS p ON o.spec = p.spec'), true);
  assert.equal(queries.orderFacts.includes('c.title IS NULL OR c.title NOT IN'), true);
  assert.equal(
    queries.orderFacts.includes("ifNull(ct.contract_type, ifNull(o.contract_type, '')) != 'processing'"),
    true
  );
  assert.equal(queries.orderFacts.includes('o.start >= {from:DateTime}'), true);
  assert.equal(queries.orderFacts.includes('o.start < {to:DateTime}'), true);
  assert.equal(queries.orderFacts.includes("ifNull(o.workplace, '') != ''"), true);
  assert.equal(allSql.includes('o.status'), false);
  assert.equal(queries.orderFacts.includes('ifNull(o.amount, 0) > 0'), true);
  assert.equal(queries.orderFacts.includes('ordered_shifts AS amount'), true);
  assert.equal(queries.orderFacts.includes('AS include_deleted'), true);
  assert.equal(queries.orderFacts.includes('AS include_hidden'), true);

  assert.equal(queries.shiftFacts.includes('FROM mg_jobs AS j'), true);
  assert.equal(queries.shiftFacts.includes('INNER JOIN filtered_orders AS fo ON j.source = fo.order_id'), true);
  assert.equal(queries.shiftFacts.includes('j.workplace = fo.workplace_id'), false);
  assert.equal(queries.shiftFacts.includes('mg_job_history'), true);
  assert.equal(queries.shiftFacts.includes('INNER JOIN shift_facts AS sf ON h.job = sf.job_id'), true);
  assert.equal(queries.shiftFacts.includes('fo.pieceworks'), true);
  assert.equal(queries.shiftFacts.includes('AS is_successful_confirmed_shift'), true);
  assert.equal(queries.shiftFacts.includes('AS is_forecast_active_shift'), true);
  assert.equal(queries.shiftFacts.includes('dropoffs_24h'), true);

  assert.equal(queries.bookedWorkerFacts.includes('FROM mg_job_history AS h'), true);
  assert.equal(queries.bookedWorkerFacts.includes("ifNull(h.status, '') = 'booked'"), true);
  assert.equal(queries.bookedWorkerFacts.includes('INNER JOIN shift_facts AS sf ON h.job = sf.job_id'), true);

  assert.match(
    queries.orderStatusFacts,
    /SELECT\s+DISTINCT\s+period_date,\s+workplace_id,\s+order_id,\s+status/s
  );
  assert.equal(queries.orderStatusFacts.includes('FROM shift_facts'), true);
  assert.equal(queries.orderStatusFacts.includes('FROM filtered_orders'), false);

  assert.equal(queries.reviewRollups.includes('FROM mg_reviews AS r'), true);
  assert.equal(queries.reviewRollups.includes('INNER JOIN mg_jobs AS j ON r.job = j._id'), true);
  assert.equal(queries.reviewRollups.includes('j.workplace IN {workplace_ids:Array(String)}'), true);

  assert.equal(queries.radiusRollups.includes('arrayJoin([5, 10, 15, 20])'), true);
  assert.equal(queries.radiusRollups.includes('FROM mg_workplaces AS w'), true);
  assert.equal(queries.radiusRollups.includes('FROM mg_workers AS aw'), true);
  assert.equal(queries.radiusRollups.includes('active_session_users AS'), true);
  assert.equal(queries.radiusRollups.includes('{active_session_from:DateTime}'), true);
  assert.equal(queries.radiusRollups.includes('{active_session_to:DateTime}'), true);
  assert.equal(queries.radiusRollups.includes('{active_window_date:Date} AS active_window_date'), true);
  assert.equal(queries.radiusRollups.includes('AS active_session_workers'), true);
  assert.equal(queries.radiusRollups.includes('length({workplace_ids:Array(String)}) > 0'), true);
  assert.equal(queries.radiusRollups.includes('w._id IN {workplace_ids:Array(String)}'), true);
  assert.equal(queries.radiusRollups.includes('abs(aw.worker_lat - w.workplace_lat) <='), true);
  assert.equal(queries.radiusRollups.includes('abs(aw.worker_lon - w.workplace_lon) <='), true);
  assert.equal(queries.radiusRollups.includes('FROM hot_workplaces AS w'), true);
  assert.equal(queries.radiusRollups.includes('CROSS JOIN radii AS r'), true);
  assert.equal(queries.radiusRollups.includes('LEFT JOIN candidate_distances AS cd ON cd.workplace_id = w.workplace_id'), true);
  assert.equal(queries.radiusRollups.includes('GROUP BY w.workplace_id, r.radius_km'), true);
  const radiusWhereIndex = queries.radiusRollups.indexOf('WHERE abs(aw.worker_lat - w.workplace_lat) <=');
  const radiusDistanceFilterIndex = queries.radiusRollups.indexOf(') <= 20.0 * 1000');
  assert.ok(
    radiusWhereIndex >= 0
      && radiusDistanceFilterIndex >= 0
      && radiusWhereIndex < radiusDistanceFilterIndex
  );
});

test('refreshWorkplacePointPreload handles an empty hot workplace set', async () => {
  const calls = [];
  const replacements = [];
  const store = {
    listDashboardPreloadRequests() {
      return [];
    },
    replaceWorkplacePointRange(input) {
      replacements.push(input);
    }
  };
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });
      return [];
    }
  };

  const result = await refreshWorkplacePointPreload({
    client,
    store,
    fromDate: '2026-06-01',
    toDate: '2026-07-01'
  });

  assert.equal(result.rowsWritten, 0);
  assert.deepEqual(calls.map((call) => call.operation), EXPECTED_OPERATIONS);
  assert.deepEqual(calls.map((call) => call.params.param_workplace_ids), ['[]', '[]', '[]', '[]', '[]', '[]']);
  assert.equal(replacements.length, 1);
  assert.deepEqual(replacements[0].radiusRollups, []);
});
