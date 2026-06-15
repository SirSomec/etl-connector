const { actualOrderDomainCondition, actualOrderJoinsSql } = require('./analyticsDomainSql');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_ACTIVE_BASE_MODES = new Set(['all', 'ready']);
const ALLOWED_ACTIVE_BASE_PERIODS = new Set(['last30d', 'selected']);
const ALLOWED_WORKER_CONCENTRATION_LAYERS = new Set(['off', 'on']);
const FILTER_OPTION_KEYS = ['client', 'excludedProfession'];
const HEATMAP_SECTION_NAMES = ['map'];
const HEATMAP_SECTIONS = new Set(HEATMAP_SECTION_NAMES);
const DEFAULT_ACTIVE_BASE_MODE = 'all';
const DEFAULT_ACTIVE_BASE_PERIOD = 'last30d';
const DEFAULT_WORKER_CONCENTRATION_LAYER = 'off';

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatDateUTC(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function parseDateOnly(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime()) || formatDateUTC(date) !== value) {
    return null;
  }

  return date;
}

function addDaysUTC(date, days) {
  const next = new Date(date.getTime());

  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function firstDayOfMonthUTC(year, month) {
  return new Date(Date.UTC(year, month - 1, 1));
}

function nextMonthUTC(year, month) {
  return new Date(Date.UTC(year, month, 1));
}

function previousMonthFromNow(now) {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  date.setUTCMonth(date.getUTCMonth() - 1);

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1
  };
}

function toDateTimeParam(dateOnly) {
  return `${dateOnly} 00:00:00`;
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanValues(value) {
  const rawValues = Array.isArray(value) ? value : [value];
  const values = [];
  const seen = new Set();

  for (const rawValue of rawValues) {
    const text = cleanText(rawValue);

    if (text === '' || seen.has(text)) {
      continue;
    }

    seen.add(text);
    values.push(text);
  }

  return values;
}

function normalizeYearMonth(input = {}, now = new Date()) {
  const fallback = previousMonthFromNow(now);
  const year = Number(input.year);
  const month = Number(input.month);
  const maxYear = now.getUTCFullYear() + 1;

  if (
    Number.isInteger(year) &&
    year >= 2020 &&
    year <= maxYear &&
    Number.isInteger(month) &&
    month >= 1 &&
    month <= 12
  ) {
    return { year, month };
  }

  return fallback;
}

function normalizeHeatmapFilters(input = {}, now = new Date()) {
  const { year, month } = normalizeYearMonth(input, now);
  const fromDate = firstDayOfMonthUTC(year, month);
  const toExclusiveDate = nextMonthUTC(year, month);
  const toDate = addDaysUTC(toExclusiveDate, -1);
  const from = formatDateUTC(fromDate);
  const to = formatDateUTC(toDate);
  const toExclusive = formatDateUTC(toExclusiveDate);
  const requestedMode = cleanText(input.activeBaseMode);
  const activeBaseMode = ALLOWED_ACTIVE_BASE_MODES.has(requestedMode)
    ? requestedMode
    : DEFAULT_ACTIVE_BASE_MODE;
  const requestedPeriod = cleanText(input.activeBasePeriod);
  const activeBasePeriod = ALLOWED_ACTIVE_BASE_PERIODS.has(requestedPeriod)
    ? requestedPeriod
    : DEFAULT_ACTIVE_BASE_PERIOD;
  const requestedWorkerConcentrationLayer = cleanText(input.workerConcentrationLayer);
  const workerConcentrationLayer = ALLOWED_WORKER_CONCENTRATION_LAYERS.has(
    requestedWorkerConcentrationLayer
  )
    ? requestedWorkerConcentrationLayer
    : DEFAULT_WORKER_CONCENTRATION_LAYER;
  const activeFromDate = activeBasePeriod === 'selected'
    ? fromDate
    : addDaysUTC(toExclusiveDate, -30);
  const activeFrom = formatDateUTC(activeFromDate);

  return {
    year,
    month,
    periodKey: `${year}-${pad2(month)}`,
    from,
    to,
    fromDateTime: toDateTimeParam(from),
    toExclusiveDateTime: toDateTimeParam(toExclusive),
    activeFromDateTime: toDateTimeParam(activeFrom),
    activeToExclusiveDateTime: toDateTimeParam(toExclusive),
    client: cleanValues(input.client),
    excludedProfession: cleanValues(input.excludedProfession),
    addressSearch: cleanText(input.addressSearch),
    activeBaseMode,
    activeBasePeriod,
    workerConcentrationLayer
  };
}

function numberValue(value) {
  const number = Number(value || 0);

  return Number.isFinite(number) ? number : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function balanceLevel(orderedShifts, weightedActiveUsersPerShift) {
  if (numberValue(orderedShifts) <= 0) {
    return 'no-order';
  }

  if (weightedActiveUsersPerShift < 1) {
    return 'low';
  }

  if (weightedActiveUsersPerShift < 3) {
    return 'medium';
  }

  return 'high';
}

function formatCssNumber(value) {
  const rounded = Math.round(value * 10) / 10;

  return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(',', '.');
}

function balanceColor(orderedShifts, weightedActiveUsersPerShift) {
  if (numberValue(orderedShifts) <= 0) {
    return '#e5e7eb';
  }

  const progress = clamp(weightedActiveUsersPerShift / 3, 0, 1);
  const hue = 12 + progress * 126;
  const saturation = 72 - progress * 8;
  const lightness = 44 - progress * 9;

  return `hsl(${formatCssNumber(hue)}, ${formatCssNumber(saturation)}%, ${formatCssNumber(lightness)}%)`;
}

function emptyFilterOptions() {
  return FILTER_OPTION_KEYS.reduce((options, key) => {
    options[key] = [];
    return options;
  }, {});
}

function filterOptionsFromRows(rows) {
  const options = emptyFilterOptions();
  const seenByKey = FILTER_OPTION_KEYS.reduce((seen, key) => {
    seen[key] = new Set();
    return seen;
  }, {});

  for (const row of rows) {
    const key = String(row.filter || '');
    const optionKey = key === 'profession' ? 'excludedProfession' : key;
    const value = cleanText(row.value);

    if (!Object.prototype.hasOwnProperty.call(options, optionKey) || value === '') {
      continue;
    }

    if (seenByKey[optionKey].has(value)) {
      continue;
    }

    seenByKey[optionKey].add(value);
    options[optionKey].push(value);
  }

  return options;
}

function mergeHeatmapRows(filters, datasets) {
  const filterOptions = filterOptionsFromRows(datasets.filterOptionRows || []);
  const points = [];
  const workerConcentration = [];

  for (const row of datasets.demandPointRows || []) {
    const orderedShifts = numberValue(row.ordered_shifts);

    if (orderedShifts <= 0) {
      continue;
    }

    const weightedActiveUsers = numberValue(row.weighted_active_users);
    const weightedActiveUsersPerShift = weightedActiveUsers / orderedShifts;
    const level = balanceLevel(orderedShifts, weightedActiveUsersPerShift);

    points.push({
      workplaceId: cleanText(row.workplace_id),
      workplaceTitle: cleanText(row.workplace_title),
      region: cleanText(row.region),
      city: cleanText(row.city),
      street: cleanText(row.street),
      lon: numberValue(row.lon),
      lat: numberValue(row.lat),
      orderedShifts,
      orderRequests: numberValue(row.order_requests),
      weightedActiveUsers,
      weightedActiveUsersPerShift,
      radiusUsers: {
        near: numberValue(row.active_users_5km),
        medium: numberValue(row.active_users_10km),
        far: numberValue(row.active_users_15km)
      },
      balanceLevel: level,
      color: balanceColor(orderedShifts, weightedActiveUsersPerShift)
    });
  }

  points.sort((left, right) => {
    if (right.orderedShifts !== left.orderedShifts) {
      return right.orderedShifts - left.orderedShifts;
    }

    if (right.weightedActiveUsers !== left.weightedActiveUsers) {
      return right.weightedActiveUsers - left.weightedActiveUsers;
    }

    return `${left.city} ${left.street} ${left.workplaceTitle}`.localeCompare(
      `${right.city} ${right.street} ${right.workplaceTitle}`,
      'ru'
    );
  });

  const orderedShifts = points.reduce((sum, row) => sum + row.orderedShifts, 0);
  const weightedActiveUsers = points.reduce((sum, row) => sum + row.weightedActiveUsers, 0);
  const regionsWithOrder = new Set(points.map((point) => point.region).filter(Boolean)).size;

  for (const row of datasets.workerConcentrationRows || []) {
    const lon = numberValue(row.lon);
    const lat = numberValue(row.lat);
    const activeUsers = numberValue(row.active_users);

    if (
      activeUsers <= 0 ||
      lon < -180 ||
      lon > 180 ||
      lat < -90 ||
      lat > 90
    ) {
      continue;
    }

    workerConcentration.push({
      lon,
      lat,
      activeUsers,
      intensity: clamp(numberValue(row.intensity), 0, 1)
    });
  }

  return {
    filters,
    filterOptions,
    summary: {
      pointsWithOrder: points.length,
      regionsWithOrder,
      orderedShifts,
      weightedActiveUsers,
      activeUsers: weightedActiveUsers,
      avgWeightedActiveUsersPerShift:
        orderedShifts > 0 ? weightedActiveUsers / orderedShifts : 0,
      avgActiveUsersPerShift:
        orderedShifts > 0 ? weightedActiveUsers / orderedShifts : 0
    },
    points,
    regions: points,
    workerConcentration
  };
}

function escapeClickHouseString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function serializeStringArray(values) {
  return `[${values.map((value) => `'${escapeClickHouseString(value)}'`).join(',')}]`;
}

function periodParams(filters) {
  return {
    param_from: filters.fromDateTime,
    param_to: filters.toExclusiveDateTime
  };
}

function mapParams(filters) {
  return {
    ...periodParams(filters),
    param_active_from: filters.activeFromDateTime,
    param_active_to: filters.activeToExclusiveDateTime
  };
}

function addOrderFilters(filters, where, params) {
  if (filters.client.length > 0) {
    where.push('c.title IN {clients:Array(String)}');
    params.param_clients = serializeStringArray(filters.client);
  }

  if (filters.excludedProfession.length > 0) {
    where.push("if(ifNull(p.caption, '') = '', o.spec, p.caption) NOT IN {excluded_professions:Array(String)}");
    params.param_excluded_professions = serializeStringArray(filters.excludedProfession);
  }

  if (filters.addressSearch !== '') {
    where.push(`(
      positionCaseInsensitive(ifNull(w.address__region, ''), {address_search:String}) > 0
      OR positionCaseInsensitive(ifNull(w.address__city, ''), {address_search:String}) > 0
      OR positionCaseInsensitive(ifNull(w.address__street, ''), {address_search:String}) > 0
      OR positionCaseInsensitive(ifNull(w.title, ''), {address_search:String}) > 0
      OR positionCaseInsensitive(ifNull(w.technical_name, ''), {address_search:String}) > 0
    )`);
    params.param_address_search = filters.addressSearch;
  }
}

function baseOrderWhere(filters, params, { withOptionalFilters = true } = {}) {
  const where = [
    actualOrderDomainCondition('o', 'c', 'ct'),
    'o.start >= {from:DateTime}',
    'o.start < {to:DateTime}',
    'ifNull(o.amount, 0) > 0'
  ];

  if (withOptionalFilters) {
    addOrderFilters(filters, where, params);
  }

  return where.join('\n    AND ');
}

function filterOptionSelect(filter, valueExpression, whereSql) {
  return `SELECT
    '${filter}' AS filter,
    ${valueExpression} AS value
  FROM mg_orders AS o
  LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
  ${actualOrderJoinsSql('o', { clientAlias: 'c', contractorAlias: 'ct' })}
  LEFT JOIN mg_professions AS p ON o.spec = p.spec
  WHERE ${whereSql}
  GROUP BY value
  HAVING value != ''`;
}

function filterOptionsQuery(whereSql) {
  return `${[
    filterOptionSelect('client', "ifNull(c.title, '')", whereSql),
    filterOptionSelect('profession', "if(ifNull(p.caption, '') = '', o.spec, p.caption)", whereSql)
  ].join('\n  UNION ALL\n  ')}
  ORDER BY filter, value
  FORMAT JSONEachRow`;
}

function activeWorkersWhere(filters) {
  const where = [
    'length(worker_coordinates) >= 2',
    'worker_coordinates[1] BETWEEN -180 AND 180',
    'worker_coordinates[2] BETWEEN -90 AND 90',
    'worker_coordinates[1] BETWEEN bounds.min_lon - bounds.lon_margin AND bounds.max_lon + bounds.lon_margin',
    'worker_coordinates[2] BETWEEN bounds.min_lat - bounds.lat_margin AND bounds.max_lat + bounds.lat_margin'
  ];

  if (filters.activeBaseMode === 'ready') {
    where.push("status IN ('ready', 'booked', 'worked')");
  }

  return where.join('\n      AND ');
}

function workerConcentrationWhere(filters) {
  const where = [
    'length(worker_coordinates) >= 2',
    'worker_coordinates[1] BETWEEN -180 AND 180',
    'worker_coordinates[2] BETWEEN -90 AND 90'
  ];

  if (filters.activeBaseMode === 'ready') {
    where.push("status IN ('ready', 'booked', 'worked')");
  }

  return where.join('\n      AND ');
}

function demandPointsQuery(whereSql, filters) {
  return `WITH filtered_orders AS (
    SELECT
      o._id AS order_id,
      ifNull(w._id, o.workplace) AS workplace_id,
      ifNull(w.title, '') AS workplace_title,
      ifNull(w.address__region, '') AS region,
      ifNull(w.address__city, '') AS city,
      ifNull(w.address__street, '') AS street,
      w.location__coordinates AS workplace_coordinates,
      ifNull(o.amount, 0) AS amount
    FROM mg_orders AS o
    LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
    ${actualOrderJoinsSql('o', { clientAlias: 'c', contractorAlias: 'ct' })}
    LEFT JOIN mg_professions AS p ON o.spec = p.spec
    WHERE ${whereSql}
  ),
  demand_points AS (
    SELECT
      workplace_id AS workplace_id,
      any(workplace_title) AS workplace_title,
      any(region) AS region,
      any(city) AS city,
      any(street) AS street,
      any(workplace_coordinates[1]) AS lon,
      any(workplace_coordinates[2]) AS lat,
      sum(amount) AS ordered_shifts,
      countDistinct(order_id) AS order_requests
    FROM filtered_orders
    WHERE workplace_id != ''
      AND length(workplace_coordinates) >= 2
      AND workplace_coordinates[1] BETWEEN -180 AND 180
      AND workplace_coordinates[2] BETWEEN -90 AND 90
    GROUP BY workplace_id
    HAVING ordered_shifts > 0
  ),
  demand_bounds AS (
    SELECT
      count() AS points,
      min(lon) AS min_lon,
      max(lon) AS max_lon,
      min(lat) AS min_lat,
      max(lat) AS max_lat,
      15000 / 111000 AS lat_margin,
      15000 / (111320 * greatest(abs(cos(((min(lat) + max(lat)) / 2) * pi() / 180)), 0.2)) AS lon_margin
    FROM demand_points
  ),
  app_active_users AS (
    SELECT DISTINCT ifNull(s.profile_id, '') AS user_id
    FROM appmetrica_sessions AS s
    WHERE ifNull(s.profile_id, '') != ''
      AND parseDateTimeBestEffortOrNull(s.session_start_datetime) >= {active_from:DateTime}
      AND parseDateTimeBestEffortOrNull(s.session_start_datetime) < {active_to:DateTime}
  ),
  worker_rows AS (
    SELECT
      worker.user AS user_id,
      ifNull(worker.status, '') AS status,
      worker.location__coordinates AS worker_coordinates,
      ifNull(worker.updatedAt, ifNull(worker.createdAt, toDateTime64('1970-01-01 00:00:00', 3, 'UTC'))) AS updated_at
    FROM mg_workers AS worker
    INNER JOIN app_active_users AS active ON active.user_id = worker.user
    LEFT JOIN mg_users AS u ON worker.user = u._id
    WHERE ifNull(worker.user, '') != ''
      AND ifNull(worker.deleted, 0) = 0
      AND ifNull(u.deleted, 0) = 0
      AND ifNull(u.createdAt, worker.createdAt) < {active_to:DateTime}
  ),
  latest_workers AS (
    SELECT
      user_id AS user_id,
      argMax(status, updated_at) AS status,
      argMax(worker_coordinates, updated_at) AS worker_coordinates
    FROM worker_rows
    GROUP BY user_id
  ),
  active_workers AS (
    SELECT
      user_id AS user_id,
      worker_coordinates AS worker_coordinates
    FROM latest_workers
    CROSS JOIN demand_bounds AS bounds
    WHERE bounds.points > 0
      AND ${activeWorkersWhere(filters)}
  ),
  influence_pairs AS (
    SELECT
      workplace_id,
      user_id,
      distance_m,
      multiIf(distance_m <= 5000, 1.0, distance_m <= 10000, 0.5, distance_m <= 15000, 0.25, 0.0) AS influence_weight
    FROM (
      SELECT
        dp.workplace_id AS workplace_id,
        aw.user_id AS user_id,
        greatCircleDistance(
          dp.lon,
          dp.lat,
          aw.worker_coordinates[1],
          aw.worker_coordinates[2]
        ) AS distance_m
      FROM demand_points AS dp
      CROSS JOIN active_workers AS aw
      WHERE aw.worker_coordinates[1] BETWEEN dp.lon - (15000 / (111320 * greatest(abs(cos(dp.lat * pi() / 180)), 0.2))) AND dp.lon + (15000 / (111320 * greatest(abs(cos(dp.lat * pi() / 180)), 0.2)))
        AND aw.worker_coordinates[2] BETWEEN dp.lat - (15000 / 111000) AND dp.lat + (15000 / 111000)
        AND greatCircleDistance(
          dp.lon,
          dp.lat,
          aw.worker_coordinates[1],
          aw.worker_coordinates[2]
        ) <= 15000
    )
  ),
  worker_influence AS (
    SELECT
      workplace_id AS workplace_id,
      sum(influence_weight) AS weighted_active_users,
      uniqExactIf(user_id, distance_m <= 5000) AS active_users_5km,
      uniqExactIf(user_id, distance_m > 5000 AND distance_m <= 10000) AS active_users_10km,
      uniqExactIf(user_id, distance_m > 10000 AND distance_m <= 15000) AS active_users_15km
    FROM influence_pairs
    GROUP BY workplace_id
  )
  SELECT
    dp.workplace_id AS workplace_id,
    dp.workplace_title AS workplace_title,
    dp.region AS region,
    dp.city AS city,
    dp.street AS street,
    dp.lon AS lon,
    dp.lat AS lat,
    dp.ordered_shifts AS ordered_shifts,
    dp.order_requests AS order_requests,
    ifNull(wi.weighted_active_users, 0) AS weighted_active_users,
    ifNull(wi.active_users_5km, 0) AS active_users_5km,
    ifNull(wi.active_users_10km, 0) AS active_users_10km,
    ifNull(wi.active_users_15km, 0) AS active_users_15km
  FROM demand_points AS dp
  LEFT JOIN worker_influence AS wi ON dp.workplace_id = wi.workplace_id
  ORDER BY ordered_shifts DESC, weighted_active_users DESC, city, street, workplace_title
  FORMAT JSONEachRow`;
}

function workerConcentrationQuery(filters) {
  return `WITH app_active_users AS (
    SELECT DISTINCT ifNull(s.profile_id, '') AS user_id
    FROM appmetrica_sessions AS s
    WHERE ifNull(s.profile_id, '') != ''
      AND parseDateTimeBestEffortOrNull(s.session_start_datetime) >= now() - INTERVAL 30 DAY
      AND parseDateTimeBestEffortOrNull(s.session_start_datetime) < now()
  ),
  worker_rows AS (
    SELECT
      worker.user AS user_id,
      ifNull(worker.status, '') AS status,
      worker.location__coordinates AS worker_coordinates,
      ifNull(worker.updatedAt, ifNull(worker.createdAt, toDateTime64('1970-01-01 00:00:00', 3, 'UTC'))) AS updated_at
    FROM mg_workers AS worker
    INNER JOIN app_active_users AS active ON active.user_id = worker.user
    LEFT JOIN mg_users AS u ON worker.user = u._id
    WHERE ifNull(worker.user, '') != ''
      AND ifNull(worker.deleted, 0) = 0
      AND ifNull(u.deleted, 0) = 0
  ),
  latest_workers AS (
    SELECT
      user_id AS user_id,
      argMax(status, updated_at) AS status,
      argMax(worker_coordinates, updated_at) AS worker_coordinates
    FROM worker_rows
    GROUP BY user_id
  ),
  concentration_raw AS (
    SELECT
      round(worker_coordinates[1], 2) AS lon,
      round(worker_coordinates[2], 2) AS lat,
      uniqExact(user_id) AS active_users
    FROM latest_workers
    WHERE ${workerConcentrationWhere(filters)}
    GROUP BY lon, lat
    HAVING active_users > 0
  ),
  concentration_cells AS (
    SELECT
      lon,
      lat,
      active_users,
      active_users / ((111.0 * 0.01) * (111.32 * greatest(abs(cos(lat * pi() / 180)), 0.2) * 0.01)) AS density_per_km2
    FROM concentration_raw
  ),
  concentration_candidates AS (
    SELECT
      lon,
      lat,
      active_users,
      density_per_km2
    FROM concentration_cells
    ORDER BY density_per_km2 DESC, active_users DESC, lat DESC, lon ASC
    LIMIT 3000
  ),
  density_scale AS (
    SELECT
      quantileExact(0.5)(density_per_km2) AS p50_density_per_km2,
      greatest(ifNull(quantileExact(0.95)(density_per_km2), 0), 0.000001) AS p95_density_per_km2
    FROM concentration_candidates
  )
  SELECT
    lon,
    lat,
    active_users,
    density_per_km2,
    if(
      p95_density_per_km2 > p50_density_per_km2,
      least(1.0, greatest(0.0, (density_per_km2 - p50_density_per_km2) / (p95_density_per_km2 - p50_density_per_km2))),
      if(density_per_km2 > 0, 1.0, 0.0)
    ) AS intensity
  FROM concentration_candidates
  CROSS JOIN density_scale
  WHERE p95_density_per_km2 <= p50_density_per_km2
    OR density_per_km2 > p50_density_per_km2
  ORDER BY density_per_km2 DESC, active_users DESC, lat DESC, lon ASC
  LIMIT 3000
  FORMAT JSONEachRow`;
}

async function readThroughCache(cache, key, loader) {
  if (!cache || typeof cache.getOrLoad !== 'function') {
    return loader();
  }

  return cache.getOrLoad(key, loader);
}

function cacheKeyForHeatmapSection(section, filters) {
  return JSON.stringify({
    board: 'heatmap',
    section,
    filters: {
      year: filters.year,
      month: filters.month,
      client: filters.client,
      excludedProfession: filters.excludedProfession,
      addressSearch: filters.addressSearch,
      activeBaseMode: filters.activeBaseMode,
      activeBasePeriod: filters.activeBasePeriod,
      workerConcentrationLayer: filters.workerConcentrationLayer
    }
  });
}

function emptyHeatmapDashboard(filters, filterOptions = emptyFilterOptions()) {
  return {
    filters,
    filterOptions,
    summary: {
      pointsWithOrder: 0,
      regionsWithOrder: 0,
      orderedShifts: 0,
      weightedActiveUsers: 0,
      activeUsers: 0,
      avgWeightedActiveUsersPerShift: 0,
      avgActiveUsersPerShift: 0
    },
    points: [],
    regions: [],
    workerConcentration: []
  };
}

function assertHeatmapSection(section) {
  if (HEATMAP_SECTIONS.has(section)) {
    return;
  }

  const error = new Error(`Unknown heatmap section: ${section}`);

  error.status = 400;
  throw error;
}

async function loadFilterOptionRows(client, filters) {
  const params = periodParams(filters);
  const whereSql = baseOrderWhere(filters, params, { withOptionalFilters: false });

  return client.queryJSONEachRow(
    filterOptionsQuery(whereSql),
    params,
    'heatmap filter options'
  );
}

async function loadHeatmapMapRows(client, filters) {
  const params = mapParams(filters);
  const whereSql = baseOrderWhere(filters, params);
  const demandPointRows = await client.queryJSONEachRow(
    demandPointsQuery(whereSql, filters),
    params,
    'heatmap demand points'
  );
  const workerConcentrationRows = filters.workerConcentrationLayer === 'on'
    ? await client.queryJSONEachRow(
      workerConcentrationQuery(filters),
      {},
      'heatmap worker concentration'
    )
    : [];

  return { demandPointRows, workerConcentrationRows };
}

async function loadHeatmapDashboardShell(client, input = {}, now = new Date()) {
  const filters = normalizeHeatmapFilters(input, now);
  const filterOptionRows = await loadFilterOptionRows(client, filters);

  return emptyHeatmapDashboard(filters, filterOptionsFromRows(filterOptionRows));
}

async function loadHeatmapDashboardSection(client, input = {}, section, now = new Date(), options = {}) {
  assertHeatmapSection(section);

  const filters = normalizeHeatmapFilters(input, now);
  const rows = await readThroughCache(
    options.cache,
    cacheKeyForHeatmapSection(section, filters),
    () => loadHeatmapMapRows(client, filters)
  );

  return mergeHeatmapRows(filters, {
    filterOptionRows: [],
    ...rows
  });
}

async function loadHeatmapDashboard(client, input = {}, now = new Date()) {
  const shell = await loadHeatmapDashboardShell(client, input, now);
  const mapDashboard = await loadHeatmapDashboardSection(client, input, 'map', now);

  return {
    ...mapDashboard,
    filterOptions: shell.filterOptions
  };
}

module.exports = {
  HEATMAP_SECTIONS,
  loadHeatmapDashboard,
  loadHeatmapDashboardSection,
  loadHeatmapDashboardShell,
  mergeHeatmapRows,
  normalizeHeatmapFilters
};
