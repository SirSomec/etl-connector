const { successfulConfirmedShiftFlagExpression } = require('./successfulConfirmedShift');
const {
  actualOrderDomainCondition,
  actualOrderJoinsSql
} = require('./analyticsDomainSql');

const WORKPLACE_POINT_DASHBOARD_ID = 'workplace-point';
const WORKPLACE_POINT_PRELOAD_JOB_ID = 'workplace-point';
const WORKPLACE_POINT_PRELOAD_SECTIONS = ['summary', 'charts', 'year-heatmap', 'radius'];
const ACTIVE_WORKPLACE_LOOKBACK_DAYS = 14;
const FORECAST_SLA_ACTIVE_STATUSES_SQL =
  "('booked', 'going', 'delayed', 'waiting', 'checkingin', 'inprogress', 'checkingout', 'completed', 'confirmed')";

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatDateUTC(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function formatDateTimeUTC(date) {
  return `${formatDateUTC(date)} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`;
}

function toDateTimeParam(dateOnly) {
  return `${dateOnly} 00:00:00`;
}

function addDaysUTC(date, days) {
  const next = new Date(date.getTime());

  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function escapeClickHouseString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function serializeStringArray(values) {
  return `[${values.map((value) => `'${escapeClickHouseString(value)}'`).join(',')}]`;
}

function uniqueHotWorkplaceIds(requests, activeWorkplaceRows = []) {
  const ids = [];
  const seen = new Set(ids);

  for (const row of Array.isArray(activeWorkplaceRows) ? activeWorkplaceRows : []) {
    const workplaceId = cleanText(row && row.workplace_id);

    if (workplaceId === '' || seen.has(workplaceId)) {
      continue;
    }

    seen.add(workplaceId);
    ids.push(workplaceId);
  }

  for (const request of Array.isArray(requests) ? requests : []) {
    const workplaceId = cleanText(request && request.input && request.input.workplaceId);

    if (workplaceId === '' || seen.has(workplaceId)) {
      continue;
    }

    seen.add(workplaceId);
    ids.push(workplaceId);
  }

  return ids;
}

function preloadParams({ fromDate, toDate, now, workplaceIds }) {
  const activeSessionFrom = addDaysUTC(now, -30);
  const activeWorkplaceFrom = addDaysUTC(now, -ACTIVE_WORKPLACE_LOOKBACK_DAYS);

  return {
    param_from: toDateTimeParam(fromDate),
    param_to: toDateTimeParam(toDate),
    param_current_date: formatDateUTC(now),
    param_active_window_date: formatDateUTC(now),
    param_active_session_from: formatDateTimeUTC(activeSessionFrom),
    param_active_session_to: formatDateTimeUTC(now),
    param_active_workplace_from: formatDateTimeUTC(activeWorkplaceFrom),
    param_active_workplace_to: formatDateTimeUTC(now),
    param_workplace_ids: serializeStringArray(workplaceIds)
  };
}

function orderDimensionJoinsSql() {
  return `${actualOrderJoinsSql('o', { clientAlias: 'c', workplaceAlias: 'ow', contractorAlias: 'ct' })}
  LEFT JOIN mg_professions AS p ON o.spec = p.spec`;
}

function filteredOrdersCte() {
  return `filtered_orders AS (
    SELECT
      toString(toDate(o.start, 'Europe/Moscow')) AS period_date,
      o._id AS order_id,
      ifNull(o.workplace, '') AS workplace_id,
      o.start AS order_start,
      o.createdAt AS order_created_at,
      ifNull(o.amount, 0) AS ordered_shifts,
      ifNull(o.type, '') AS order_type,
      o.pieceworks AS pieceworks,
      if(ifNull(p.caption, '') = '', o.spec, p.caption) AS profession,
      if(
        o.createdAt IS NOT NULL
        AND o.start IS NOT NULL
        AND o.createdAt <= o.start,
        dateDiff('minute', o.createdAt, o.start),
        NULL
      ) AS order_lead_minutes
    FROM mg_orders AS o
    ${orderDimensionJoinsSql()}
    WHERE ${actualOrderDomainCondition('o', 'c', 'ct')}
      AND o.start >= {from:DateTime}
      AND o.start < {to:DateTime}
      AND length({workplace_ids:Array(String)}) > 0
      AND ifNull(o.workplace, '') IN {workplace_ids:Array(String)}
      AND ifNull(o.workplace, '') != ''
      AND ifNull(o.amount, 0) > 0
  )`;
}

function shiftFactsCte() {
  return `shift_facts AS (
    SELECT
      j._id AS job_id,
      fo.period_date AS period_date,
      fo.workplace_id AS workplace_id,
      fo.order_id AS order_id,
      j.source AS source,
      j.worker AS worker,
      ifNull(j.status, '') AS status,
      j.start AS start,
      j.hours AS hours,
      j.payment AS payment,
      j.salary_per_hour AS salary_per_hour,
      j.salary_per_job AS salary_per_job,
      j.start_fact AS start_fact,
      j.finish_fact AS finish_fact,
      ifNull(j.cancellation_reason, '') AS cancellation_reason,
      ifNull(j.failure_reason, '') AS failure_reason,
      fo.pieceworks AS pieceworks,
      ${successfulConfirmedShiftFlagExpression('j', { pieceworkExpression: 'fo.pieceworks' })} AS is_successful_confirmed_shift
    FROM mg_jobs AS j
    INNER JOIN filtered_orders AS fo ON j.source = fo.order_id
    WHERE ifNull(j._id, '') != ''
      AND ifNull(j.deleted, 0) = 0
  )`;
}

function dropEventsCte() {
  return `drop_events AS (
    SELECT
      h.job AS job_id,
      minIf(
        coalesce(h.createdAt, h.updatedAt),
        (
          ifNull(h.status, '') IN ('cancelled', 'failed')
          OR ifNull(h.cancellation_reason, '') != ''
          OR ifNull(h.failure_reason, '') != ''
        )
        AND (
          ifNull(h.initiator, '') = 'worker'
          OR ifNull(h.status, '') = 'failed'
          OR ifNull(h.failure_reason, '') != ''
        )
      ) AS drop_at
    FROM mg_job_history AS h
    INNER JOIN shift_facts AS sf ON h.job = sf.job_id
    GROUP BY h.job
  )`;
}

function buildWorkplacePointPreloadQueries() {
  const filteredOrders = filteredOrdersCte();
  const shiftFacts = shiftFactsCte();
  const dropEvents = dropEventsCte();

  return {
    activeWorkplaceIds: `SELECT DISTINCT
  ifNull(o.workplace, '') AS workplace_id
FROM mg_orders AS o
${actualOrderJoinsSql('o', { clientAlias: 'c', workplaceAlias: 'ow', contractorAlias: 'ct' })}
WHERE ${actualOrderDomainCondition('o', 'c', 'ct')}
  AND o.start >= {active_workplace_from:DateTime}
  AND o.start < {active_workplace_to:DateTime}
  AND ifNull(o.workplace, '') != ''
  AND ifNull(o.amount, 0) > 0
ORDER BY workplace_id
FORMAT JSONEachRow`,
    orderFacts: `WITH ${filteredOrders}
SELECT
  period_date,
  workplace_id,
  order_id,
  ordered_shifts AS amount,
  profession,
  order_type,
  order_lead_minutes,
  0 AS include_deleted,
  0 AS include_hidden
FROM filtered_orders
ORDER BY period_date, workplace_id, order_id
FORMAT JSONEachRow`,
    shiftFacts: `WITH ${filteredOrders},
  ${shiftFacts},
  ${dropEvents}
SELECT
  sf.period_date AS period_date,
  sf.workplace_id AS workplace_id,
  sf.order_id AS order_id,
  sf.job_id AS job_id,
  ifNull(sf.worker, '') AS worker_id,
  sf.status AS status,
  sf.is_successful_confirmed_shift AS is_successful_confirmed_shift,
  if(ifNull(sf.status, '') IN ${FORECAST_SLA_ACTIVE_STATUSES_SQL} AND toDate(sf.start) >= {current_date:Date}, 1, 0)
    AS is_forecast_active_shift,
  if(
    de.drop_at IS NOT NULL
    AND sf.start IS NOT NULL
    AND de.drop_at >= sf.start - INTERVAL 24 HOUR
    AND de.drop_at <= sf.start,
    1,
    0
  ) AS dropoffs_24h
FROM shift_facts AS sf
LEFT JOIN drop_events AS de ON sf.job_id = de.job_id
ORDER BY period_date, workplace_id, order_id, job_id
FORMAT JSONEachRow`,
    orderStatusFacts: `WITH ${filteredOrders},
  ${shiftFacts}
SELECT DISTINCT
  period_date,
  workplace_id,
  order_id,
  status
FROM shift_facts
ORDER BY period_date, workplace_id, order_id, status
FORMAT JSONEachRow`,
    bookedWorkerFacts: `WITH ${filteredOrders},
  ${shiftFacts}
SELECT DISTINCT
  sf.period_date AS period_date,
  sf.workplace_id AS workplace_id,
  sf.order_id AS order_id,
  sf.job_id AS job_id,
  h.worker AS worker_id
FROM mg_job_history AS h
INNER JOIN shift_facts AS sf ON h.job = sf.job_id
WHERE ifNull(h.status, '') = 'booked'
  AND ifNull(h.worker, '') != ''
ORDER BY period_date, workplace_id, order_id, job_id, worker_id
FORMAT JSONEachRow`,
    reviewRollups: `WITH ranked_reviews AS (
  SELECT
    j.workplace AS workplace_id,
    r.rating AS rating,
    row_number() OVER (
      PARTITION BY j.workplace
      ORDER BY r.createdAt DESC, r._id DESC
    ) AS rn
  FROM mg_reviews AS r
  INNER JOIN mg_jobs AS j ON r.job = j._id
  WHERE length({workplace_ids:Array(String)}) > 0
    AND j.workplace IN {workplace_ids:Array(String)}
    AND ifNull(r.rating, 0) > 0
)
SELECT
  workplace_id,
  count() AS review_count,
  avgOrNull(rating) AS avg_rating_all,
  avgOrNull(if(rn <= 10, rating, NULL)) AS avg_rating_last_10
FROM ranked_reviews
GROUP BY workplace_id
ORDER BY workplace_id
FORMAT JSONEachRow`,
    radiusRollups: `WITH hot_workplaces AS (
  SELECT
    w._id AS workplace_id,
    w.location__coordinates[1] AS workplace_lon,
    w.location__coordinates[2] AS workplace_lat
  FROM mg_workplaces AS w
  WHERE length({workplace_ids:Array(String)}) > 0
    AND w._id IN {workplace_ids:Array(String)}
    AND length(w.location__coordinates) >= 2
    AND w.location__coordinates[1] BETWEEN -180 AND 180
    AND w.location__coordinates[2] BETWEEN -90 AND 90
),
radii AS (
  SELECT arrayJoin([5, 10, 15, 20]) AS radius_km
),
point_bounds AS (
  SELECT
    count() AS points,
    min(workplace_lon) AS min_lon,
    max(workplace_lon) AS max_lon,
    min(workplace_lat) AS min_lat,
    max(workplace_lat) AS max_lat,
    20000 / 111000 AS lat_margin,
    20000 / (111320 * greatest(abs(cos(((min(workplace_lat) + max(workplace_lat)) / 2) * pi() / 180)), 0.2)) AS lon_margin
  FROM hot_workplaces
),
workplace_search_cells AS (
  SELECT
    w.workplace_id AS workplace_id,
    w.workplace_lon AS workplace_lon,
    w.workplace_lat AS workplace_lat,
    toInt32(floor(w.workplace_lon / 0.1)) + toInt32(lon_offsets.number) - 10 AS lon_cell,
    toInt32(floor(w.workplace_lat / 0.1)) + toInt32(lat_offsets.number) - 10 AS lat_cell
  FROM hot_workplaces AS w
  CROSS JOIN numbers(21) AS lon_offsets
  CROSS JOIN numbers(21) AS lat_offsets
),
worker_candidates AS (
  SELECT
    aw._id AS worker_id,
    ifNull(aw.user, '') AS user_id,
    aw.location__coordinates[1] AS worker_lon,
    aw.location__coordinates[2] AS worker_lat,
    toInt32(floor(aw.location__coordinates[1] / 0.1)) AS lon_cell,
    toInt32(floor(aw.location__coordinates[2] / 0.1)) AS lat_cell
  FROM mg_workers AS aw
  CROSS JOIN point_bounds AS bounds
  WHERE bounds.points > 0
    AND length(aw.location__coordinates) >= 2
    AND ifNull(aw.deleted, 0) = 0
    AND ifNull(aw.status, '') IN ('ready', 'worked', 'booked')
    AND ifNull(aw.user, '') != ''
    AND aw.location__coordinates[1] BETWEEN -180 AND 180
    AND aw.location__coordinates[2] BETWEEN -90 AND 90
    AND aw.location__coordinates[1] BETWEEN bounds.min_lon - bounds.lon_margin AND bounds.max_lon + bounds.lon_margin
    AND aw.location__coordinates[2] BETWEEN bounds.min_lat - bounds.lat_margin AND bounds.max_lat + bounds.lat_margin
),
worker_distance_candidates AS (
  SELECT
    wsc.workplace_id AS workplace_id,
    wc.worker_id AS worker_id,
    wc.user_id AS user_id,
    greatCircleDistance(
      wsc.workplace_lon,
      wsc.workplace_lat,
      wc.worker_lon,
      wc.worker_lat
    ) AS distance_m
  FROM workplace_search_cells AS wsc
  INNER JOIN worker_candidates AS wc
    ON wc.lon_cell = wsc.lon_cell
    AND wc.lat_cell = wsc.lat_cell
  WHERE wc.worker_lon BETWEEN wsc.workplace_lon - (20000 / (111320 * greatest(abs(cos(wsc.workplace_lat * pi() / 180)), 0.2))) AND wsc.workplace_lon + (20000 / (111320 * greatest(abs(cos(wsc.workplace_lat * pi() / 180)), 0.2)))
    AND wc.worker_lat BETWEEN wsc.workplace_lat - (20000 / 111000) AND wsc.workplace_lat + (20000 / 111000)
    AND greatCircleDistance(
      wsc.workplace_lon,
      wsc.workplace_lat,
      wc.worker_lon,
      wc.worker_lat
    ) <= 20.0 * 1000
),
candidate_users AS (
  SELECT DISTINCT user_id
  FROM worker_distance_candidates
),
active_session_users AS (
  SELECT DISTINCT ifNull(s.profile_id, '') AS user_id
  FROM appmetrica_sessions AS s
  INNER JOIN candidate_users AS cu
    ON cu.user_id = ifNull(s.profile_id, '')
  WHERE ifNull(s.profile_id, '') != ''
    AND parseDateTimeBestEffortOrNull(s.session_start_datetime) >= {active_session_from:DateTime}
    AND parseDateTimeBestEffortOrNull(s.session_start_datetime) < {active_session_to:DateTime}
),
candidate_distances AS (
  SELECT
    wdc.workplace_id AS workplace_id,
    wdc.worker_id AS worker_id,
    if(asu.user_id != '', 1, 0) AS has_active_session,
    wdc.distance_m AS distance_m
  FROM worker_distance_candidates AS wdc
  LEFT JOIN active_session_users AS asu ON wdc.user_id = asu.user_id
)
SELECT
  w.workplace_id,
  {active_window_date:Date} AS active_window_date,
  r.radius_km,
  uniqExactIf(cd.worker_id, cd.distance_m <= r.radius_km * 1000) AS workers,
  uniqExactIf(cd.worker_id, cd.distance_m <= r.radius_km * 1000 AND cd.has_active_session = 1) AS active_session_workers
FROM hot_workplaces AS w
CROSS JOIN radii AS r
LEFT JOIN candidate_distances AS cd ON cd.workplace_id = w.workplace_id
GROUP BY w.workplace_id, r.radius_km
ORDER BY w.workplace_id, r.radius_km
FORMAT JSONEachRow`
  };
}

async function refreshWorkplacePointPreload({
  client,
  store,
  fromDate,
  toDate,
  now = new Date()
}) {
  const requests = typeof store.listDashboardPreloadRequests === 'function'
    ? store.listDashboardPreloadRequests(WORKPLACE_POINT_PRELOAD_JOB_ID, 1000)
    : [];
  const queries = buildWorkplacePointPreloadQueries();
  const activeWorkplaceRows = await client.queryJSONEachRow(
    queries.activeWorkplaceIds,
    preloadParams({ fromDate, toDate, now, workplaceIds: [] }),
    'workplace point preload active workplaces'
  );
  const workplaceIds = uniqueHotWorkplaceIds(requests, activeWorkplaceRows);
  const params = preloadParams({ fromDate, toDate, now, workplaceIds });

  const [
    orderFacts,
    shiftFactsResult,
    orderStatusFacts,
    bookedWorkerFacts,
    reviewRollups,
    radiusRollups
  ] = await Promise.all([
    client.queryJSONEachRow(
      queries.orderFacts,
      params,
      'workplace point preload order facts'
    ),
    client.queryJSONEachRow(
      queries.shiftFacts,
      params,
      'workplace point preload shift facts'
    ),
    client.queryJSONEachRow(
      queries.orderStatusFacts,
      params,
      'workplace point preload order status facts'
    ),
    client.queryJSONEachRow(
      queries.bookedWorkerFacts,
      params,
      'workplace point preload booked workers'
    ),
    client.queryJSONEachRow(
      queries.reviewRollups,
      params,
      'workplace point preload review rollups'
    ),
    client.queryJSONEachRow(
      queries.radiusRollups,
      params,
      'workplace point preload radius rollups'
    )
  ]);

  store.replaceWorkplacePointRange({
    fromDate,
    toDate,
    workplaceIds,
    orderFacts,
    shiftFacts: shiftFactsResult,
    orderStatusFacts,
    bookedWorkerFacts,
    reviewRollups,
    radiusRollups
  });

  return {
    rowsWritten:
      orderFacts.length
      + shiftFactsResult.length
      + orderStatusFacts.length
      + bookedWorkerFacts.length
      + reviewRollups.length
      + radiusRollups.length
  };
}

module.exports = {
  WORKPLACE_POINT_DASHBOARD_ID,
  WORKPLACE_POINT_PRELOAD_SECTIONS,
  buildWorkplacePointPreloadQueries,
  refreshWorkplacePointPreload
};
