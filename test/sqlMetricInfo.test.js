const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SQL_METRIC_INFO,
  getSqlMetricInfo,
  highlightSql,
  sqlMetricInfoFor
} = require('../src/sqlMetricInfo');

const RENDERED_SQL_METRIC_IDS = [
  'sales-by-project.summary',
  'sales-by-project.summary.ordered-shifts',
  'sales-by-project.summary.worked-shifts',
  'sales-by-project.summary.sla',
  'sales-by-project.summary.revenue-rub',
  'sales-by-project.summary.unique-workers',
  'sales-by-project.summary.workplaces-with-orders',
  'sales-by-project.summary.workplaces-with-worked-shifts',
  'sales-by-project.summary.cancelled-shifts',
  'sales-by-project.summary.self-booking-percent',
  'sales-by-project.summary.avg-worker-rate-hour',
  'sales-by-project.trend',
  'sales-by-project.trend.ordered-shifts',
  'sales-by-project.trend.worked-shifts',
  'sales-by-project.trend.sla',
  'sales-by-project.trend.revenue-rub',
  'sales-by-project.trend.cancelled-shifts',
  'sales-by-project.trend.chart',
  'sales-by-project.brands',
  'sales-by-project.brands.ordered-shifts',
  'sales-by-project.brands.worked-shifts',
  'sales-by-project.brands.sla',
  'sales-by-project.brands.revenue-rub',
  'sales-by-project.brands.unique-workers',
  'sales-by-project.brands.workplaces-with-orders',
  'sales-by-project.brands.workplaces-with-worked-shifts',
  'sales-by-project.brands.cancelled-shifts',
  'sales-by-project.brands.self-booking-percent',
  'sales-by-project.brands.avg-worker-rate-hour',
  'sales-by-project.statuses',
  'sales-by-project.statuses.shifts',
  'brand-analysis.summary',
  'brand-analysis.summary.ordered-shifts',
  'brand-analysis.summary.worked-shifts',
  'brand-analysis.summary.covered-shifts',
  'brand-analysis.summary.open-demand',
  'brand-analysis.summary.sla',
  'brand-analysis.summary.coverage',
  'brand-analysis.summary.revenue-rub',
  'brand-analysis.summary.unique-workers',
  'brand-analysis.summary.workplaces-with-orders',
  'brand-analysis.summary.workplaces-with-worked-shifts',
  'brand-analysis.summary.cancelled-shifts',
  'brand-analysis.summary.self-booking-percent',
  'brand-analysis.summary.order-stability',
  'brand-analysis.summary.avg-worker-rate-hour',
  'brand-analysis.summary.avg-customer-rate-hour',
  'brand-analysis.trend',
  'brand-analysis.trend.ordered-shifts',
  'brand-analysis.trend.worked-shifts',
  'brand-analysis.trend.covered-shifts',
  'brand-analysis.trend.open-demand',
  'brand-analysis.trend.sla',
  'brand-analysis.trend.coverage',
  'brand-analysis.trend.revenue-rub',
  'brand-analysis.trend.cancelled-shifts',
  'brand-analysis.workplaces',
  'brand-analysis.workplaces.ordered-shifts',
  'brand-analysis.workplaces.worked-shifts',
  'brand-analysis.workplaces.coverage',
  'brand-analysis.workplaces.sla',
  'brand-analysis.workplaces.revenue-rub',
  'brand-analysis.workplaces.cancelled-shifts',
  'brand-analysis.professions',
  'brand-analysis.professions.ordered-shifts',
  'brand-analysis.professions.worked-shifts',
  'brand-analysis.professions.sla',
  'brand-analysis.professions.revenue-rub',
  'brand-analysis.professions.cancelled-shifts',
  'brand-analysis.statuses',
  'brand-analysis.statuses.shifts',
  'workplace-analysis.points',
  'workplace-analysis.points.ordered-shifts',
  'workplace-analysis.points.sla',
  'workplace-analysis.points.stability',
  'workplace-analysis.points.active-gigers-5km',
  'workplace-analysis.points.active-days',
  'workplace-analysis.points.avg-daily-order',
  'workplace-analysis.points.heatmap',
  'workplace-analysis.attention',
  'workplace-analysis.attention.free-7d',
  'workplace-analysis.attention.coverage',
  'workplace-analysis.attention.total-workers-15km',
  'workplace-analysis.attention.active-workers-30d-15km',
  'workplace-analysis.attention.active-workers-per-free-shift',
  'worker-cancellations.workers',
  'worker-cancellations.workers.confirmed-shifts',
  'worker-cancellations.workers.worker-cancellations',
  'worker-cancellations.workers.worker-cancellations24h',
  'worker-cancellations.workers.post-start-cancellations',
  'worker-cancellations.workers.failed-shifts',
  'workplace-point.summary',
  'workplace-point.summary.ordered-shifts',
  'workplace-point.summary.completed-shifts',
  'workplace-point.summary.sla',
  'workplace-point.summary.stability',
  'workplace-point.summary.unique-completed-workers',
  'workplace-point.summary.unique-booked-workers',
  'workplace-point.summary.avg-completed-shifts-per-active-worker-week',
  'workplace-point.summary.avg-completed-shifts-per-active-worker-month',
  'workplace-point.summary.rating',
  'workplace-point.summary.dropoffs-24h',
  'workplace-point.radius',
  'workplace-point.summary.radius-5km',
  'workplace-point.summary.radius-10km',
  'workplace-point.summary.radius-15km',
  'workplace-point.summary.radius-20km',
  'workplace-point.charts.calendar-ordered-shifts',
  'workplace-point.charts.calendar-sla',
  'workplace-point.charts.calendar-dropoffs-24h',
  'workplace-point.charts.calendar-order-lead-avg',
  'workplace-point.charts.calendar-order-lead-min',
  'workplace-point.charts.professions',
  'city-analysis.summary',
  'city-analysis.summary.ordered-shifts',
  'city-analysis.summary.active-order-requests',
  'city-analysis.summary.total-located-users',
  'city-analysis.summary.ready-located-users',
  'city-analysis.summary.app-active-users',
  'city-analysis.summary.app-30d-active-users',
  'city-analysis.summary.booked-users',
  'city-analysis.summary.completed-users',
  'city-analysis.summary.avg-daily-30d-active-users-per-request',
  'city-analysis.composition',
  'city-analysis.composition.brands',
  'city-analysis.composition.brands.ordered-shifts',
  'city-analysis.composition.professions',
  'city-analysis.composition.professions.ordered-shifts',
  'city-analysis.composition.rate-buckets',
  'city-analysis.composition.rate-buckets.ordered-shifts',
  'city-analysis.dynamics',
  'city-analysis.dynamics.line-ordered-shifts',
  'city-analysis.dynamics.line-app-active-users',
  'city-analysis.dynamics.line-booked-users',
  'city-analysis.dynamics.line-completed-users',
  'city-analysis.dynamics.line-active-users-per-request',
  'city-analysis.dynamics.bar-ordered-shifts',
  'city-analysis.dynamics.bar-app-active-users',
  'city-analysis.dynamics.bar-booked-users',
  'city-analysis.dynamics.bar-completed-users',
  'city-analysis.dynamics.bar-active-users-per-request',
  'city-analysis.dynamics.combo-ordered-shifts',
  'city-analysis.dynamics.combo-app-active-users',
  'city-analysis.dynamics.combo-booked-users',
  'city-analysis.dynamics.combo-completed-users',
  'city-analysis.dynamics.multiples-ordered-shifts',
  'city-analysis.dynamics.multiples-app-active-users',
  'city-analysis.dynamics.multiples-booked-users',
  'city-analysis.dynamics.multiples-completed-users',
  'city-analysis.dynamics.multiples-active-users-per-request',
  'city-analysis.dynamics.heatmap-ordered-shifts',
  'city-analysis.dynamics.heatmap-app-active-users',
  'city-analysis.dynamics.heatmap-booked-users',
  'city-analysis.dynamics.heatmap-completed-users',
  'city-analysis.dynamics.heatmap-active-users-per-request',
  'city-analysis.dynamics.funnel-ordered-shifts',
  'city-analysis.dynamics.funnel-app-active-users',
  'city-analysis.dynamics.funnel-booked-users',
  'city-analysis.dynamics.funnel-completed-users',
  'city-analysis.dynamics.index-ordered-shifts',
  'city-analysis.dynamics.index-app-active-users',
  'city-analysis.dynamics.index-booked-users',
  'city-analysis.dynamics.index-completed-users',
  'city-analysis.dynamics.index-active-users-per-request',
  'heatmap.map',
  'heatmap.map.points-with-order',
  'heatmap.map.ordered-shifts',
  'heatmap.map.weighted-active-users',
  'heatmap.map.avg-weighted-active-users-per-shift',
  'heatmap.map.worker-concentration'
];

test('getSqlMetricInfo returns stable metadata without secrets', () => {
  const info = getSqlMetricInfo('sales-by-project.summary');

  assert.equal(info.id, 'sales-by-project.summary');
  assert.match(info.title, /Продажи/);
  assert.match(info.description, /Показывает/);
  assert.doesNotMatch(info.title, /Р[џЃ™љњ]/);
  assert.doesNotMatch(info.description, /Р[џЃ™љњ]/);
  assert.match(info.sql, /SELECT/i);
  assert.doesNotMatch(info.sql, /CLICKHOUSE_PASSWORD|AUTH_ADMIN_PASSWORD|AUTH_SESSION_SECRET/);
});

test('sqlMetricInfoFor returns null for missing ids and does not inherit parent SQL', () => {
  assert.equal(sqlMetricInfoFor('missing.metric'), null);
  assert.equal(sqlMetricInfoFor('workplace-point.summary.unknown-child'), null);
});

test('all rendered SQL inspector ids have explicit metadata', () => {
  for (const id of RENDERED_SQL_METRIC_IDS) {
    const info = getSqlMetricInfo(id);

    assert.ok(SQL_METRIC_INFO[id], `${id} must be explicit in SQL_METRIC_INFO`);
    assert.ok(info, `${id} must resolve`);
    assert.equal(info.id, id);
    assert.match(info.title, /\S/);
    assert.match(info.description, /\S/);
    assert.match(info.sql, /SELECT/i);
  }
});

test('workplace point radius metrics show radius workers SQL, not summary SQL', () => {
  const info = getSqlMetricInfo('workplace-point.summary.radius-20km');

  assert.match(info.title, /20 км/);
  assert.match(info.sql, /arrayJoin\(\[5, 10, 15, 20\]\) AS radius_km/);
  assert.match(info.sql, /appmetrica_sessions/);
  assert.match(info.sql, /greatCircleDistance/);
  assert.match(info.sql, /active_session_workers/);
  assert.doesNotMatch(info.sql, /LEFT JOIN candidate_distances AS cd ON cd\.distance_m <=/);
  assert.match(info.sql, /cd\.join_key = r\.join_key/);
  assert.doesNotMatch(info.sql, /sum\(amount\) AS ordered_shifts/);
});

test('workplace point chart metrics point to their actual query templates', () => {
  const calendar = getSqlMetricInfo('workplace-point.charts.calendar-sla');
  const professions = getSqlMetricInfo('workplace-point.charts.professions');

  assert.match(calendar.sql, /avg_order_lead_minutes/);
  assert.match(calendar.sql, /dropoffs_24h/);
  assert.match(calendar.sql, /GROUP BY period/);
  assert.match(professions.sql, /GROUP BY profession/);
  assert.doesNotMatch(professions.sql, /GROUP BY period/);
});

test('city composition metrics show the exact grouped SQL for visible row values', () => {
  const brands = getSqlMetricInfo('city-analysis.composition.brands.ordered-shifts');
  const professions = getSqlMetricInfo('city-analysis.composition.professions.ordered-shifts');
  const rateBuckets = getSqlMetricInfo('city-analysis.composition.rate-buckets.ordered-shifts');
  const summary = getSqlMetricInfo('city-analysis.summary.total-located-users');

  assert.match(brands.sql, /ordered_shifts/);
  assert.match(brands.sql, /share_percent/);
  assert.match(brands.sql, /brand AS label/);
  assert.match(professions.sql, /profession AS label/);
  assert.match(professions.sql, /share_percent/);
  assert.match(rateBuckets.sql, /multiIf/);
  assert.match(rateBuckets.sql, /avgIf\(salary_per_hour, salary_per_hour > 0\) AS avg_salary_per_hour/);
  assert.match(rateBuckets.sql, /share_percent/);
  assert.doesNotMatch(rateBuckets.sql, /brand AS label/);
  assert.match(summary.sql, /city_search_cells AS/);
  assert.match(summary.sql, /INNER JOIN candidate_workers AS worker/);
  assert.doesNotMatch(summary.sql, /CROSS JOIN city_workplaces AS cw/);
});

test('sql inspector sales metrics document actual order and finance domain filters', () => {
  const summary = getSqlMetricInfo('sales-by-project.summary');

  assert.match(summary.sql, /INNER JOIN mg_clients AS c ON c\._id = o\.client/);
  assert.match(summary.sql, /MyGig Demo/);
  assert.match(summary.sql, /contract_type[\s\S]*processing/);
  assert.match(summary.sql, /ifNull\(t\.deleted, 0\) = 0/);
  assert.match(summary.sql, /row_number\(\) OVER/);
  assert.doesNotMatch(summary.sql, /h\.status = 'booked' AND h\.initiator = 'worker'/);
});

test('geo and cancellation metrics show the specialized SQL used for those values', () => {
  const activeGigers = getSqlMetricInfo('workplace-analysis.points.active-gigers-5km');
  const heatmap = getSqlMetricInfo('heatmap.map.weighted-active-users');
  const cancellations = getSqlMetricInfo('worker-cancellations.workers.worker-cancellations24h');

  assert.match(activeGigers.sql, /activeGigers5kmQuery|active_gigers_5km/);
  assert.match(activeGigers.sql, /greatCircleDistance/);
  assert.match(activeGigers.sql, /candidate_users AS/);
  assert.doesNotMatch(activeGigers.sql, /CROSS JOIN active_workers AS aw/);
  assert.match(heatmap.sql, /influence_weight/);
  assert.match(heatmap.sql, /appmetrica_sessions/);
  assert.match(heatmap.sql, /CROSS JOIN demand_bounds AS bounds/);
  assert.match(heatmap.sql, /WHERE bounds\.points > 0/);
  assert.doesNotMatch(heatmap.sql, /INNER JOIN demand_bounds AS bounds ON bounds\.points > 0/);
  assert.match(heatmap.sql, /demand_search_cells AS/);
  assert.match(heatmap.sql, /abs\(toInt32\(lon_offsets\.number\) - 8\) <=/);
  assert.match(heatmap.sql, /abs\(toInt32\(lat_offsets\.number\) - 8\) <=/);
  assert.match(heatmap.sql, /worker_candidates AS/);
  assert.match(heatmap.sql, /candidate_users AS/);
  assert.match(heatmap.sql, /active_worker_candidates AS/);
  assert.match(heatmap.sql, /INNER JOIN active_worker_candidates AS awc/);
  assert.doesNotMatch(heatmap.sql, /CROSS JOIN active_workers AS aw/);
  assert.doesNotMatch(heatmap.sql, /INNER JOIN active_workers AS aw/);
  assert.match(cancellations.sql, /is_worker_cancelled_24h/);
  assert.match(cancellations.sql, /INTERVAL 24 HOUR/);
  assert.match(cancellations.sql, /is_successful_confirmed_shift/);
});

test('heatmap worker concentration metric documents the 30 day current-date layer SQL', () => {
  const info = getSqlMetricInfo('heatmap.map.worker-concentration');

  assert.match(info.description, /30/);
  assert.match(info.sql, /appmetrica_sessions/);
  assert.match(info.sql, /now\(\) - INTERVAL 30 DAY/);
  assert.match(info.sql, /mg_workers AS worker/);
  assert.match(info.sql, /mg_users AS u/);
  assert.match(info.sql, /round\(worker_coordinates\[1\], 2\) AS lon/);
  assert.match(info.sql, /round\(worker_coordinates\[2\], 2\) AS lat/);
  assert.match(info.sql, /uniqExact\(user_id\) AS active_users/);
  assert.match(info.sql, /status IN \('ready', 'booked', 'worked'\)/);
  assert.match(info.sql, /density_per_km2/);
  assert.match(info.sql, /concentration_candidates/);
  assert.match(info.sql, /quantileExact\(0\.5\)\(density_per_km2\) AS p50_density_per_km2/);
  assert.match(info.sql, /quantileExact\(0\.95\)\(density_per_km2\)/);
  assert.match(info.sql, /density_per_km2 > p50_density_per_km2/);
  assert.match(info.sql, /\(density_per_km2 - p50_density_per_km2\) \/ \(p95_density_per_km2 - p50_density_per_km2\)/);
  assert.match(info.sql, /AS intensity/);
  assert.doesNotMatch(info.sql, /min_density_per_km2/);
  assert.doesNotMatch(info.sql, /active_users \/ max_active_users/);
});

test('workplace attention metrics show 15km base and closing statuses SQL', () => {
  const attention = getSqlMetricInfo('workplace-analysis.attention.free-7d');

  assert.match(attention.sql, /completed/);
  assert.doesNotMatch(attention.sql, /doccheck/);
  assert.match(attention.sql, /greatCircleDistance/);
  assert.match(attention.sql, /15000/);
  assert.match(attention.sql, /appmetrica_sessions/);
  assert.match(attention.sql, /point_worker_users AS/);
  assert.match(attention.sql, /count\(\) AS total_workers_15km/);
  assert.match(attention.sql, /selected_points AS/);
  assert.match(attention.sql, /arrayZip\(\{workplace_ids:Array\(String\)\}, \{point_lons:Array\(Float64\)\}, \{point_lats:Array\(Float64\)\}\)/);
  assert.doesNotMatch(attention.sql, /latest_workers AS/);
  assert.doesNotMatch(attention.sql, /argMax\(/);
  assert.match(attention.sql, /FROM mg_workers AS worker\s+CROSS JOIN point_bounds AS bounds/);
  assert.doesNotMatch(attention.sql, /uniqExact\(pwp\.user_id/);
  assert.doesNotMatch(attention.sql, /influence_weight/);
});

test('highlightSql escapes html and highlights SQL keywords and parameters', () => {
  const html = highlightSql("SELECT '<tag>' AS value WHERE start >= {from:DateTime}");

  assert.match(html, /<span class="sql-keyword">SELECT<\/span>/);
  assert.match(html, /&lt;tag&gt;/);
  assert.match(html, /<span class="sql-param">\{from:DateTime\}<\/span>/);
  assert.doesNotMatch(html, /<tag>/);
});
