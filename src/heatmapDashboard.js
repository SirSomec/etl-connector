const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_ACTIVE_BASE_MODES = new Set(['all', 'ready']);
const FILTER_OPTION_KEYS = ['client', 'excludedProfession'];
const HEATMAP_SECTION_NAMES = ['map'];
const HEATMAP_SECTIONS = new Set(HEATMAP_SECTION_NAMES);
const DEFAULT_ACTIVE_BASE_MODE = 'all';

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
  const activeFromDate = addDaysUTC(toExclusiveDate, -30);
  const from = formatDateUTC(fromDate);
  const to = formatDateUTC(toDate);
  const toExclusive = formatDateUTC(toExclusiveDate);
  const activeFrom = formatDateUTC(activeFromDate);
  const requestedMode = cleanText(input.activeBaseMode);
  const activeBaseMode = ALLOWED_ACTIVE_BASE_MODES.has(requestedMode)
    ? requestedMode
    : DEFAULT_ACTIVE_BASE_MODE;

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
    activeBaseMode
  };
}

function numberValue(value) {
  const number = Number(value || 0);

  return Number.isFinite(number) ? number : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function balanceLevel(orderedShifts, activeUsersPerShift) {
  if (numberValue(orderedShifts) <= 0) {
    return 'no-order';
  }

  if (activeUsersPerShift < 1) {
    return 'low';
  }

  if (activeUsersPerShift < 3) {
    return 'medium';
  }

  return 'high';
}

function balanceColor(orderedShifts, activeUsersPerShift) {
  if (numberValue(orderedShifts) <= 0) {
    return '#e5e7eb';
  }

  const progress = clamp(activeUsersPerShift / 3, 0, 1);
  const hue = 12 + progress * 126;
  const saturation = 72 - progress * 8;
  const lightness = 44 - progress * 9;

  return `hsl(${formatCssNumber(hue)}, ${formatCssNumber(saturation)}%, ${formatCssNumber(lightness)}%)`;
}

function formatCssNumber(value) {
  const rounded = Math.round(value * 10) / 10;

  return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(',', '.');
}

function projectedPoint(lonValue, latValue, region) {
  const lon = numberValue(lonValue);
  const lat = numberValue(latValue);

  if (lon >= 20 && lon <= 180 && lat >= 40 && lat <= 83) {
    return {
      mapX: Math.round(70 + ((lon - 20) / 160) * 820),
      mapY: Math.round(372 - ((lat - 40) / 43) * 320)
    };
  }

  const hash = Array.from(String(region || '')).reduce(
    (total, char) => total + char.charCodeAt(0),
    0
  );

  return {
    mapX: 90 + (hash % 760),
    mapY: 80 + (hash % 280)
  };
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
  const byRegion = new Map();

  for (const row of datasets.regionOrderRows || []) {
    const region = cleanText(row.region);

    if (region === '') {
      continue;
    }

    byRegion.set(region, {
      region,
      orderedShifts: numberValue(row.ordered_shifts),
      orderRequests: numberValue(row.order_requests),
      activeUsers: 0,
      avgLon: numberValue(row.avg_lon),
      avgLat: numberValue(row.avg_lat)
    });
  }

  for (const row of datasets.activeUserRows || []) {
    const region = cleanText(row.region);

    if (region === '') {
      continue;
    }

    const current = byRegion.get(region) || {
      region,
      orderedShifts: 0,
      orderRequests: 0,
      activeUsers: 0,
      avgLon: 0,
      avgLat: 0
    };

    current.activeUsers = numberValue(row.active_users);
    byRegion.set(region, current);
  }

  const regions = Array.from(byRegion.values()).map((row) => {
    const activeUsersPerShift =
      row.orderedShifts > 0 ? row.activeUsers / row.orderedShifts : 0;
    const level = balanceLevel(row.orderedShifts, activeUsersPerShift);
    const point = projectedPoint(row.avgLon, row.avgLat, row.region);

    return {
      region: row.region,
      orderedShifts: row.orderedShifts,
      orderRequests: row.orderRequests,
      activeUsers: row.activeUsers,
      activeUsersPerShift,
      balanceLevel: level,
      color: balanceColor(row.orderedShifts, activeUsersPerShift),
      mapX: point.mapX,
      mapY: point.mapY
    };
  });

  regions.sort((left, right) => {
    if (right.orderedShifts !== left.orderedShifts) {
      return right.orderedShifts - left.orderedShifts;
    }

    if (right.activeUsers !== left.activeUsers) {
      return right.activeUsers - left.activeUsers;
    }

    return left.region.localeCompare(right.region, 'ru');
  });

  const regionsWithOrder = regions.filter((row) => row.orderedShifts > 0);
  const orderedShifts = regionsWithOrder.reduce((sum, row) => sum + row.orderedShifts, 0);
  const activeUsers = regionsWithOrder.reduce((sum, row) => sum + row.activeUsers, 0);

  return {
    filters,
    filterOptions,
    summary: {
      regionsWithOrder: regionsWithOrder.length,
      orderedShifts,
      activeUsers,
      avgActiveUsersPerShift: orderedShifts > 0 ? activeUsers / orderedShifts : 0
    },
    regions
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

function addOrderFilters(filters, where, params) {
  if (filters.client.length > 0) {
    where.push('c.title IN {clients:Array(String)}');
    params.param_clients = serializeStringArray(filters.client);
  }

  if (filters.excludedProfession.length > 0) {
    where.push("if(ifNull(p.caption, '') = '', o.spec, p.caption) NOT IN {excluded_professions:Array(String)}");
    params.param_excluded_professions = serializeStringArray(filters.excludedProfession);
  }
}

function baseOrderWhere(filters, params, { withOptionalFilters = true } = {}) {
  const where = [
    'ifNull(o.deleted, 0) = 0',
    'ifNull(o.is_hidden, 0) = 0',
    'o.start >= {from:DateTime}',
    'o.start < {to:DateTime}',
    'ifNull(o.amount, 0) > 0',
    "ifNull(w.address__region, '') != ''"
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
  LEFT JOIN mg_clients AS c ON o.client = c._id
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

function regionalOrdersQuery(whereSql) {
  return `SELECT
    ifNull(w.address__region, '') AS region,
    sum(ifNull(o.amount, 0)) AS ordered_shifts,
    countDistinct(o._id) AS order_requests,
    avgIf(w.location__coordinates[1], length(w.location__coordinates) >= 2
      AND w.location__coordinates[1] BETWEEN 20 AND 180
      AND w.location__coordinates[2] BETWEEN 40 AND 83) AS avg_lon,
    avgIf(w.location__coordinates[2], length(w.location__coordinates) >= 2
      AND w.location__coordinates[1] BETWEEN 20 AND 180
      AND w.location__coordinates[2] BETWEEN 40 AND 83) AS avg_lat
  FROM mg_orders AS o
  LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
  LEFT JOIN mg_clients AS c ON o.client = c._id
  LEFT JOIN mg_professions AS p ON o.spec = p.spec
  WHERE ${whereSql}
  GROUP BY region
  ORDER BY ordered_shifts DESC, region
  FORMAT JSONEachRow`;
}

function activeUsersQuery(filters) {
  const statusWhere =
    filters.activeBaseMode === 'ready'
      ? "WHERE latest.status IN ('ready', 'booked', 'worked')"
      : '';

  return `WITH app_active_users AS (
    SELECT DISTINCT ifNull(s.profile_id, '') AS user_id
    FROM appmetrica_sessions AS s
    WHERE ifNull(s.profile_id, '') != ''
      AND parseDateTimeBestEffortOrNull(s.session_start_datetime) >= {active_from:DateTime}
      AND parseDateTimeBestEffortOrNull(s.session_start_datetime) < {active_to:DateTime}
  ),
  worker_rows AS (
    SELECT
      worker.user AS user_id,
      if(
        ifNull(worker.full_address__state, '') != '',
        worker.full_address__state,
        ifNull(u.region, '')
      ) AS region,
      ifNull(worker.status, '') AS status,
      ifNull(worker.updatedAt, ifNull(worker.createdAt, toDateTime64('1970-01-01 00:00:00', 3, 'UTC'))) AS updated_at
    FROM mg_workers AS worker
    INNER JOIN app_active_users AS active ON active.user_id = worker.user
    LEFT JOIN mg_users AS u ON worker.user = u._id
    WHERE ifNull(worker.user, '') != ''
      AND ifNull(worker.deleted, 0) = 0
      AND ifNull(u.deleted, 0) = 0
      AND ifNull(u.createdAt, worker.createdAt) < {active_to:DateTime}
  ),
  latest_worker_by_user AS (
    SELECT
      user_id,
      argMax(region, updated_at) AS region,
      argMax(status, updated_at) AS status
    FROM worker_rows
    GROUP BY user_id
  )
  SELECT
    latest.region AS region,
    uniqExact(latest.user_id) AS active_users
  FROM latest_worker_by_user AS latest
  ${statusWhere}
  GROUP BY region
  HAVING region != ''
  ORDER BY active_users DESC, region
  FORMAT JSONEachRow`;
}

function mapParams(filters) {
  return {
    ...periodParams(filters),
    param_active_from: filters.activeFromDateTime,
    param_active_to: filters.activeToExclusiveDateTime
  };
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
      activeBaseMode: filters.activeBaseMode
    }
  });
}

function emptyHeatmapDashboard(filters, filterOptions = emptyFilterOptions()) {
  return {
    filters,
    filterOptions,
    summary: {
      regionsWithOrder: 0,
      orderedShifts: 0,
      activeUsers: 0,
      avgActiveUsersPerShift: 0
    },
    regions: []
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
  const [regionOrderRows, activeUserRows] = await Promise.all([
    client.queryJSONEachRow(
      regionalOrdersQuery(whereSql),
      params,
      'heatmap regional orders'
    ),
    client.queryJSONEachRow(
      activeUsersQuery(filters),
      params,
      'heatmap active users'
    )
  ]);

  return { regionOrderRows, activeUserRows };
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
