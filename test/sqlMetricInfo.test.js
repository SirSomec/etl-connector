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
  'workplace-analysis.points',
  'workplace-analysis.points.ordered-shifts',
  'workplace-analysis.points.sla',
  'workplace-analysis.points.stability',
  'workplace-analysis.points.active-gigers-5km',
  'workplace-analysis.points.active-days',
  'workplace-analysis.points.avg-daily-order',
  'workplace-analysis.points.heatmap',
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
  'city-analysis.dynamics',
  'city-analysis.dynamics.combo-ordered-shifts',
  'city-analysis.dynamics.combo-app-active-users',
  'city-analysis.dynamics.combo-booked-users',
  'city-analysis.dynamics.combo-completed-users',
  'city-analysis.dynamics.heatmap-ordered-shifts',
  'city-analysis.dynamics.heatmap-app-active-users',
  'city-analysis.dynamics.heatmap-booked-users',
  'city-analysis.dynamics.heatmap-completed-users',
  'city-analysis.dynamics.heatmap-active-users-per-request',
  'heatmap.map',
  'heatmap.map.points-with-order',
  'heatmap.map.ordered-shifts',
  'heatmap.map.weighted-active-users',
  'heatmap.map.avg-weighted-active-users-per-shift'
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

test('geo and cancellation metrics show the specialized SQL used for those values', () => {
  const activeGigers = getSqlMetricInfo('workplace-analysis.points.active-gigers-5km');
  const heatmap = getSqlMetricInfo('heatmap.map.weighted-active-users');
  const cancellations = getSqlMetricInfo('worker-cancellations.workers.worker-cancellations24h');

  assert.match(activeGigers.sql, /activeGigers5kmQuery|active_gigers_5km/);
  assert.match(activeGigers.sql, /greatCircleDistance/);
  assert.match(heatmap.sql, /influence_weight/);
  assert.match(heatmap.sql, /appmetrica_sessions/);
  assert.match(cancellations.sql, /is_worker_cancelled_24h/);
  assert.match(cancellations.sql, /INTERVAL 24 HOUR/);
});

test('highlightSql escapes html and highlights SQL keywords and parameters', () => {
  const html = highlightSql("SELECT '<tag>' AS value WHERE start >= {from:DateTime}");

  assert.match(html, /<span class="sql-keyword">SELECT<\/span>/);
  assert.match(html, /&lt;tag&gt;/);
  assert.match(html, /<span class="sql-param">\{from:DateTime\}<\/span>/);
  assert.doesNotMatch(html, /<tag>/);
});
