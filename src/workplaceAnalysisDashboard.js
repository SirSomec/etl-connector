const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_LIMIT = 12;
const DEFAULT_PAGE = 1;
const MAX_PAGE = 100000;
const DEFAULT_SORT = 'orders';
const ALLOWED_LIMITS = new Set([10, 12, 20, 50]);
const ALLOWED_ORDER_TYPES = new Set(['once', 'regular']);
const ALLOWED_SORTS = new Set([DEFAULT_SORT, 'sla', 'stability']);
const FILTER_OPTION_KEYS = ['client', 'city', 'region', 'profession', 'orderType', 'jobStatus', 'contractor'];
const WORKPLACE_ANALYSIS_SECTION_NAMES = ['points'];
const WORKPLACE_ANALYSIS_SECTIONS = new Set(WORKPLACE_ANALYSIS_SECTION_NAMES);
const SORT_LABELS = {
  orders: 'Сначала крупнейшие по заказу',
  sla: 'Сначала высокий SLA',
  stability: 'Сначала высокая стабильность'
};

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

function firstDayOfMonthUTC(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
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

function cleanBooleanFlag(value) {
  const rawValues = Array.isArray(value) ? value : [value];

  return rawValues.some((rawValue) => {
    const text = cleanText(rawValue).toLowerCase();

    return text === '1' || text === 'true' || text === 'on' || text === 'yes';
  });
}

function normalizeLimit(value) {
  const limit = Number(value);

  return Number.isInteger(limit) && ALLOWED_LIMITS.has(limit) ? limit : DEFAULT_LIMIT;
}

function normalizePage(value) {
  const page = Number(value);

  return Number.isSafeInteger(page) && page >= 1 && page <= MAX_PAGE ? page : DEFAULT_PAGE;
}

function normalizeSort(value) {
  const sort = cleanText(value);

  return ALLOWED_SORTS.has(sort) ? sort : DEFAULT_SORT;
}

function firstNonEmptyText(value) {
  const values = Array.isArray(value) ? value : [value];

  for (const rawValue of values) {
    const text = cleanText(rawValue);

    if (text !== '') {
      return text;
    }
  }

  return '';
}

function normalizeNumberRangeValue(value, { min = null, max = null } = {}) {
  const text = firstNonEmptyText(value).replace(',', '.');

  if (text === '') {
    return null;
  }

  const number = Number(text);

  if (!Number.isFinite(number)) {
    return null;
  }

  let normalized = number;

  if (min !== null) {
    normalized = Math.max(min, normalized);
  }
  if (max !== null) {
    normalized = Math.min(max, normalized);
  }

  return normalized;
}

function normalizePercentRangeValue(value) {
  return normalizeNumberRangeValue(value, { min: 0, max: 100 });
}

function normalizePositiveRangeValue(value) {
  return normalizeNumberRangeValue(value, { min: 0 });
}

function normalizeWorkplaceAnalysisFilters(input = {}, now = new Date()) {
  const today = parseDateOnly(formatDateUTC(now));
  const defaultFromDate = firstDayOfMonthUTC(today);
  const requestedFrom = parseDateOnly(input.from);
  const requestedTo = parseDateOnly(input.to);
  let fromDate = requestedFrom || defaultFromDate;
  let toDate = requestedTo || today;

  if (fromDate.getTime() > toDate.getTime()) {
    fromDate = defaultFromDate;
    toDate = today;
  }

  const from = formatDateUTC(fromDate);
  const to = formatDateUTC(toDate);
  const toExclusive = formatDateUTC(addDaysUTC(toDate, 1));

  const limit = normalizeLimit(input.limit);
  const page = normalizePage(input.page);

  return {
    from,
    to,
    fromDateTime: toDateTimeParam(from),
    toExclusiveDateTime: toDateTimeParam(toExclusive),
    rangeDays: buildDateKeys(from, to).length,
    pinnedWorkplaceIds: cleanValues(input.pinnedWorkplaceId),
    client: cleanValues(input.client),
    city: cleanValues(input.city),
    region: cleanValues(input.region),
    profession: cleanValues(input.profession),
    orderType: cleanValues(input.orderType).filter((value) => ALLOWED_ORDER_TYPES.has(value)),
    jobStatus: cleanValues(input.jobStatus),
    contractor: cleanValues(input.contractor),
    search: cleanText(input.search),
    includeDeletedOrders: cleanBooleanFlag(input.includeDeletedOrders),
    includeHiddenOrders: cleanBooleanFlag(input.includeHiddenOrders),
    sort: normalizeSort(input.sort),
    slaFrom: normalizePercentRangeValue(input.slaFrom),
    slaTo: normalizePercentRangeValue(input.slaTo),
    ordersFrom: normalizePositiveRangeValue(input.ordersFrom),
    ordersTo: normalizePositiveRangeValue(input.ordersTo),
    stabilityFrom: normalizePercentRangeValue(input.stabilityFrom),
    stabilityTo: normalizePercentRangeValue(input.stabilityTo),
    limit,
    page,
    offset: (page - 1) * limit
  };
}

function buildDateKeys(from, to) {
  const start = parseDateOnly(from);
  const end = parseDateOnly(to);
  const dates = [];

  for (let current = start; current.getTime() <= end.getTime(); current = addDaysUTC(current, 1)) {
    dates.push(formatDateUTC(current));
  }

  return dates;
}

function numberValue(value) {
  const number = Number(value || 0);

  return Number.isFinite(number) ? number : 0;
}

function percent(numerator, denominator) {
  const bottom = numberValue(denominator);

  if (bottom <= 0) {
    return 0;
  }

  return (numberValue(numerator) / bottom) * 100;
}

function sortLabel(sort) {
  return SORT_LABELS[sort] || SORT_LABELS[DEFAULT_SORT];
}

function heatmapLevel(amount, maxAmount) {
  const value = numberValue(amount);
  const max = numberValue(maxAmount);

  if (value <= 0 || max <= 0) {
    return 0;
  }

  const ratio = value / max;

  if (ratio <= 0.25) {
    return 1;
  }
  if (ratio <= 0.5) {
    return 2;
  }
  if (ratio <= 0.75) {
    return 3;
  }

  return 4;
}

function titleForPoint(row) {
  return String(row.workplace_title || row.technical_name || row.workplace_id || 'Без названия');
}

function compactAddress(row) {
  return [row.city, row.street].map((part) => String(part || '').trim()).filter(Boolean).join(', ');
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
    const value = cleanText(row.value);

    if (!Object.prototype.hasOwnProperty.call(options, key) || value === '') {
      continue;
    }

    if (key === 'orderType' && !ALLOWED_ORDER_TYPES.has(value)) {
      continue;
    }

    if (seenByKey[key].has(value)) {
      continue;
    }

    seenByKey[key].add(value);
    options[key].push(value);
  }

  return options;
}

function restrictFiltersToOptions(filters, filterOptions) {
  const restricted = { ...filters };

  for (const key of FILTER_OPTION_KEYS) {
    const allowed = new Set(filterOptions[key] || []);

    restricted[key] = filters[key].filter((value) => allowed.has(value));
  }

  return restricted;
}

function mergeWorkplaceAnalysisRows(filters, workplaceRows, dailyRows) {
  return mergeWorkplaceAnalysisRowsWithActiveGigers(filters, workplaceRows, dailyRows, new Map());
}

function mergeWorkplaceAnalysisRowsWithActiveGigers(
  filters,
  workplaceRows,
  dailyRows,
  activeGigersByWorkplace
) {
  const dateKeys = buildDateKeys(filters.from, filters.to);
  const pinnedWorkplaceIds = Array.isArray(filters.pinnedWorkplaceIds)
    ? filters.pinnedWorkplaceIds
    : [];
  const dailyByWorkplace = new Map();
  const totalsByWorkplace = new Map();
  let maxDailyAmount = 0;

  for (const row of dailyRows) {
    const workplaceId = String(row.workplace_id || '');
    const date = String(row.order_date || '');
    const amount = numberValue(row.ordered_shifts);
    const completedShifts = numberValue(row.completed_shifts);
    const slaOrderedShifts = numberValue(row.sla_ordered_shifts);
    const slaCompletedShifts = numberValue(row.sla_completed_shifts);

    if (!dailyByWorkplace.has(workplaceId)) {
      dailyByWorkplace.set(workplaceId, new Map());
    }
    if (!totalsByWorkplace.has(workplaceId)) {
      totalsByWorkplace.set(workplaceId, {
        slaOrderedShifts: 0,
        slaCompletedShifts: 0
      });
    }

    dailyByWorkplace.get(workplaceId).set(date, {
      amount,
      completedShifts
    });
    const totals = totalsByWorkplace.get(workplaceId);

    totals.slaOrderedShifts += slaOrderedShifts;
    totals.slaCompletedShifts += slaCompletedShifts;
    maxDailyAmount = Math.max(maxDailyAmount, amount);
  }

  const points = workplaceRows.map((row) => {
    const workplaceId = String(row.workplace_id || '');
    const activeDays = numberValue(row.active_days);
    const totalOrderedShifts = numberValue(row.total_ordered_shifts);
    const dailyValues = dailyByWorkplace.get(workplaceId) || new Map();
    const totals = totalsByWorkplace.get(workplaceId) || {
      slaOrderedShifts: 0,
      slaCompletedShifts: 0
    };
    const heatmapDays = dateKeys.map((date) => {
      const dailyValue = dailyValues.get(date) || {};
      const amount = numberValue(dailyValue.amount);
      const completedShifts = numberValue(dailyValue.completedShifts);

      return {
        date,
        amount,
        completedShifts,
        level: heatmapLevel(amount, maxDailyAmount)
      };
    });

    return {
      workplaceId,
      title: titleForPoint(row),
      clientTitle: String(row.client_title || 'Без бренда'),
      city: String(row.city || ''),
      region: String(row.region || ''),
      address: compactAddress(row),
      totalOrderedShifts,
      activeDays,
      rangeDays: filters.rangeDays,
      pinned: pinnedWorkplaceIds.includes(workplaceId),
      stabilityPercent: percent(activeDays, filters.rangeDays),
      slaPercent: percent(totals.slaCompletedShifts, totals.slaOrderedShifts),
      slaOrderedShifts: totals.slaOrderedShifts,
      slaCompletedShifts: totals.slaCompletedShifts,
      activeGigers5km: numberValue(activeGigersByWorkplace.get(workplaceId)),
      avgDailyOrder: activeDays > 0 ? totalOrderedShifts / activeDays : 0,
      heatmapDays
    };
  });

  return {
    filters,
    context: {
      sortLabel: sortLabel(filters.sort),
      maxDailyAmount
    },
    points
  };
}

function activeGigers5kmQuery() {
  return `WITH selected_workplaces AS (
    SELECT
      _id AS workplace_id,
      location__coordinates AS workplace_coordinates
    FROM mg_workplaces
    WHERE _id IN {workplace_ids:Array(String)}
      AND length(location__coordinates) >= 2
  ),
  active_session_users AS (
    SELECT DISTINCT profile_id
    FROM appmetrica_sessions
    WHERE nullIf(profile_id, '') IS NOT NULL
      AND parseDateTimeBestEffortOrNull(session_start_datetime) >= now() - INTERVAL 30 DAY
  ),
  active_workers AS (
    SELECT
      worker._id AS worker_id,
      worker.location__coordinates AS worker_coordinates
    FROM mg_workers AS worker
    INNER JOIN active_session_users AS au ON au.profile_id = worker.user
    WHERE length(worker.location__coordinates) >= 2
      AND ifNull(worker.user, '') != ''
      AND ifNull(worker.status, '') IN ('ready', 'worked', 'booked')
  )
  SELECT
    sw.workplace_id AS workplace_id,
    uniqExact(aw.worker_id) AS active_gigers_5km
  FROM selected_workplaces AS sw
  CROSS JOIN active_workers AS aw
  WHERE greatCircleDistance(
    sw.workplace_coordinates[1],
    sw.workplace_coordinates[2],
    aw.worker_coordinates[1],
    aw.worker_coordinates[2]
  ) <= 5000
  GROUP BY sw.workplace_id
  FORMAT JSONEachRow`;
}

function uniqueWorkplaceIds(rows) {
  const ids = [];
  const seen = new Set();

  for (const row of rows) {
    const workplaceId = String(row.workplace_id || '');

    if (workplaceId === '' || seen.has(workplaceId)) {
      continue;
    }

    seen.add(workplaceId);
    ids.push(workplaceId);
  }

  return ids;
}

async function loadActiveGigers5kmByWorkplace(client, workplaceIds, activeGigersCache) {
  if (!activeGigersCache || workplaceIds.length === 0) {
    return new Map();
  }

  let cached;

  try {
    cached = await activeGigersCache.readFresh(workplaceIds);
  } catch (_) {
    cached = {
      values: new Map(),
      staleWorkplaceIds: workplaceIds
    };
  }

  const values = new Map(cached.values || []);
  const staleWorkplaceIds = (cached.staleWorkplaceIds || []).filter((workplaceId) =>
    workplaceIds.includes(workplaceId)
  );

  if (staleWorkplaceIds.length === 0) {
    return values;
  }

  const params = {
    param_workplace_ids: serializeStringArray(staleWorkplaceIds)
  };
  const rows = await client.queryJSONEachRow(
    activeGigers5kmQuery(),
    params,
    'workplace analysis active gigers 5km'
  );
  const refreshedValues = new Map(staleWorkplaceIds.map((workplaceId) => [workplaceId, 0]));

  for (const row of rows) {
    refreshedValues.set(String(row.workplace_id || ''), numberValue(row.active_gigers_5km));
  }

  for (const [workplaceId, value] of refreshedValues) {
    values.set(workplaceId, value);
  }

  try {
    await activeGigersCache.writeValues(refreshedValues);
  } catch (_) {
    // The dashboard can still render the freshly calculated value if local cache write fails.
  }

  return values;
}

function addOptionalWhere(filters, where, params) {
  if (filters.client.length > 0) {
    where.push('c.title IN {clients:Array(String)}');
    params.param_clients = serializeStringArray(filters.client);
  }
  if (filters.city.length > 0) {
    where.push('w.address__city IN {cities:Array(String)}');
    params.param_cities = serializeStringArray(filters.city);
  }
  if (filters.region.length > 0) {
    where.push('w.address__region IN {regions:Array(String)}');
    params.param_regions = serializeStringArray(filters.region);
  }
  if (filters.profession.length > 0) {
    where.push("if(ifNull(p.caption, '') = '', o.spec, p.caption) IN {professions:Array(String)}");
    params.param_professions = serializeStringArray(filters.profession);
  }
  if (filters.orderType.length > 0) {
    where.push('o.type IN {order_types:Array(String)}');
    params.param_order_types = serializeStringArray(filters.orderType);
  }
  if (filters.jobStatus.length > 0) {
    where.push(`o._id IN (
      SELECT DISTINCT j.source
      FROM mg_jobs AS j
      WHERE j.deleted = 0
        AND ifNull(j.source, '') != ''
        AND ifNull(j.status, '') IN {job_statuses:Array(String)}
    )`);
    params.param_job_statuses = serializeStringArray(filters.jobStatus);
  }
  if (filters.contractor.length > 0) {
    where.push("ifNull(ct.legal_name, '') IN {contractors:Array(String)}");
    params.param_contractors = serializeStringArray(filters.contractor);
  }
  if (filters.search) {
    where.push(`(
      positionCaseInsensitive(ifNull(w.title, ''), {search:String}) > 0
      OR positionCaseInsensitive(ifNull(w.technical_name, ''), {search:String}) > 0
      OR positionCaseInsensitive(ifNull(w.address__city, ''), {search:String}) > 0
      OR positionCaseInsensitive(ifNull(w.address__region, ''), {search:String}) > 0
      OR positionCaseInsensitive(ifNull(w.address__street, ''), {search:String}) > 0
    )`);
    params.param_search = filters.search;
  }
}

function addMetricRangeWhere(filters, where, params) {
  if (filters.slaFrom !== null) {
    where.push('metrics.sla_percent >= {sla_from:Float64}');
    params.param_sla_from = filters.slaFrom;
  }
  if (filters.slaTo !== null) {
    where.push('metrics.sla_percent <= {sla_to:Float64}');
    params.param_sla_to = filters.slaTo;
  }
  if (filters.ordersFrom !== null) {
    where.push('metrics.total_ordered_shifts >= {orders_from:Float64}');
    params.param_orders_from = filters.ordersFrom;
  }
  if (filters.ordersTo !== null) {
    where.push('metrics.total_ordered_shifts <= {orders_to:Float64}');
    params.param_orders_to = filters.ordersTo;
  }
  if (filters.stabilityFrom !== null) {
    where.push('metrics.stability_percent >= {stability_from:Float64}');
    params.param_stability_from = filters.stabilityFrom;
  }
  if (filters.stabilityTo !== null) {
    where.push('metrics.stability_percent <= {stability_to:Float64}');
    params.param_stability_to = filters.stabilityTo;
  }
}

function addPinnedWorkplaceExclusionWhere(filters, where, params) {
  if (filters.pinnedWorkplaceIds.length === 0) {
    return;
  }

  where.push('o.workplace NOT IN {pinned_workplace_ids:Array(String)}');
  params.param_pinned_workplace_ids = serializeStringArray(filters.pinnedWorkplaceIds);
}

function addPinnedWorkplaceWhere(filters, where, params) {
  if (filters.pinnedWorkplaceIds.length === 0) {
    return;
  }

  where.push('o.workplace IN {pinned_workplace_ids:Array(String)}');
  params.param_pinned_workplace_ids = serializeStringArray(filters.pinnedWorkplaceIds);
}

function addPinnedFiltersWhere(filters, where, params) {
  if (filters.profession.length > 0) {
    where.push("if(ifNull(p.caption, '') = '', o.spec, p.caption) IN {professions:Array(String)}");
    params.param_professions = serializeStringArray(filters.profession);
  }

  addPinnedWorkplaceWhere(filters, where, params);
}

function escapeClickHouseString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function serializeStringArray(values) {
  return `[${values.map((value) => `'${escapeClickHouseString(value)}'`).join(',')}]`;
}

function baseParamsForFilters(filters) {
  const params = {
    param_from: filters.fromDateTime,
    param_to: filters.toExclusiveDateTime
  };
  const where = [
    'o.start >= {from:DateTime}',
    'o.start < {to:DateTime}',
    "ifNull(o.workplace, '') != ''",
    'ifNull(o.amount, 0) > 0'
  ];

  if (!filters.includeDeletedOrders) {
    where.unshift('ifNull(o.deleted, 0) = 0');
  }

  if (!filters.includeHiddenOrders) {
    where.unshift('ifNull(o.is_hidden, 0) = 0');
  }

  return {
    params,
    whereSql: where.join('\n    AND ')
  };
}

function paramsForFilters(filters, { excludePinned = false } = {}) {
  const base = baseParamsForFilters(filters);
  const params = {
    ...base.params,
    param_range_days: filters.rangeDays,
    param_limit: filters.limit,
    param_offset: filters.offset
  };
  const where = [base.whereSql];
  const metricWhere = [];

  addOptionalWhere(filters, where, params);
  if (excludePinned) {
    addPinnedWorkplaceExclusionWhere(filters, where, params);
  }
  addMetricRangeWhere(filters, metricWhere, params);

  return {
    params,
    whereSql: where.join('\n    AND '),
    metricWhereSql: metricWhere.length > 0 ? metricWhere.join('\n    AND ') : '1 = 1',
    hasMetricFilters: metricWhere.length > 0
  };
}

function paramsForPinnedWorkplaces(filters) {
  const base = baseParamsForFilters(filters);
  const params = {
    ...base.params,
    param_range_days: filters.rangeDays
  };
  const where = [base.whereSql];

  addPinnedFiltersWhere(filters, where, params);

  return {
    params,
    whereSql: where.join('\n    AND ')
  };
}

function filterOptionSelect(filter, valueExpression, whereSql) {
  return `SELECT
    '${filter}' AS filter,
    ${valueExpression} AS value
  FROM mg_orders AS o
  LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
  LEFT JOIN mg_clients AS c ON o.client = c._id
  LEFT JOIN mg_professions AS p ON o.spec = p.spec
  LEFT JOIN mg_contractors AS ct ON w.contractor = ct._id
  WHERE ${whereSql}
  GROUP BY value
  HAVING value != ''`;
}

function jobStatusFilterOptionSelect(whereSql) {
  return `SELECT
    'jobStatus' AS filter,
    ifNull(j.status, '') AS value
  FROM mg_orders AS o
  INNER JOIN mg_jobs AS j ON j.source = o._id
  LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
  LEFT JOIN mg_clients AS c ON o.client = c._id
  LEFT JOIN mg_professions AS p ON o.spec = p.spec
  LEFT JOIN mg_contractors AS ct ON w.contractor = ct._id
  WHERE ${whereSql}
    AND j.deleted = 0
  GROUP BY value
  HAVING value != ''`;
}

function filterOptionsQuery(whereSql) {
  return `${[
    filterOptionSelect('client', "ifNull(c.title, '')", whereSql),
    filterOptionSelect('city', "ifNull(w.address__city, '')", whereSql),
    filterOptionSelect('region', "ifNull(w.address__region, '')", whereSql),
    filterOptionSelect('profession', "if(ifNull(p.caption, '') = '', o.spec, p.caption)", whereSql),
    filterOptionSelect('orderType', "ifNull(o.type, '')", whereSql),
    jobStatusFilterOptionSelect(whereSql),
    filterOptionSelect('contractor', "ifNull(ct.legal_name, '')", whereSql)
  ].join('\n  UNION ALL\n  ')}
  ORDER BY filter, value
  FORMAT JSONEachRow`;
}

function orderByForSort(sort) {
  switch (sort) {
    case 'sla':
      return 'sla_sort DESC, total_ordered_shifts DESC, workplace_id ASC';
    case 'stability':
      return 'active_days DESC, total_ordered_shifts DESC, workplace_id ASC';
    default:
      return 'total_ordered_shifts DESC, workplace_id ASC';
  }
}

function workplaceMetricsSelect(whereSql, metricWhereSql = '1 = 1') {
  return `SELECT
    metrics.workplace_id AS workplace_id,
    metrics.workplace_title AS workplace_title,
    metrics.technical_name AS technical_name,
    metrics.client_title AS client_title,
    metrics.city AS city,
    metrics.region AS region,
    metrics.street AS street,
    metrics.total_ordered_shifts AS total_ordered_shifts,
    metrics.active_days AS active_days,
    metrics.sla_ordered_shifts AS sla_ordered_shifts,
    metrics.sla_completed_shifts AS sla_completed_shifts,
    metrics.sla_sort AS sla_sort,
    metrics.sla_percent AS sla_percent,
    metrics.stability_sort AS stability_sort,
    metrics.stability_percent AS stability_percent
  FROM (
    SELECT
      os.workplace_id AS workplace_id,
      os.workplace_title AS workplace_title,
      os.technical_name AS technical_name,
      os.client_title AS client_title,
      os.city AS city,
      os.region AS region,
      os.street AS street,
      os.total_ordered_shifts AS total_ordered_shifts,
      os.active_days AS active_days,
      os.sla_ordered_shifts AS sla_ordered_shifts,
      ifNull(sc.sla_completed_shifts, 0) AS sla_completed_shifts,
      if(os.sla_ordered_shifts > 0, ifNull(sc.sla_completed_shifts, 0) / os.sla_ordered_shifts, 0) AS sla_sort,
      if(os.sla_ordered_shifts > 0, ifNull(sc.sla_completed_shifts, 0) / os.sla_ordered_shifts * 100, 0) AS sla_percent,
      if({range_days:Float64} > 0, os.active_days / {range_days:Float64}, 0) AS stability_sort,
      if({range_days:Float64} > 0, os.active_days / {range_days:Float64} * 100, 0) AS stability_percent
    FROM (
      SELECT
        o.workplace AS workplace_id,
        ifNull(any(w.title), '') AS workplace_title,
        ifNull(any(w.technical_name), '') AS technical_name,
        ifNull(any(c.title), 'Без бренда') AS client_title,
        ifNull(any(w.address__city), '') AS city,
        ifNull(any(w.address__region), '') AS region,
        ifNull(any(w.address__street), '') AS street,
        sum(ifNull(o.amount, 0)) AS total_ordered_shifts,
        sumIf(ifNull(o.amount, 0), ifNull(o.deleted, 0) = 0 AND ifNull(o.is_hidden, 0) = 0) AS sla_ordered_shifts,
        countDistinct(toDate(o.start)) AS active_days
      FROM mg_orders AS o
      LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
      LEFT JOIN mg_clients AS c ON o.client = c._id
      LEFT JOIN mg_professions AS p ON o.spec = p.spec
      LEFT JOIN mg_contractors AS ct ON w.contractor = ct._id
      WHERE ${whereSql}
      GROUP BY workplace_id
    ) AS os
    LEFT JOIN (
      SELECT
        o.workplace AS workplace_id,
        countIf(ifNull(o.deleted, 0) = 0 AND ifNull(o.is_hidden, 0) = 0) AS sla_completed_shifts
      FROM mg_orders AS o
      LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
      LEFT JOIN mg_clients AS c ON o.client = c._id
      LEFT JOIN mg_professions AS p ON o.spec = p.spec
      LEFT JOIN mg_contractors AS ct ON w.contractor = ct._id
      INNER JOIN mg_jobs AS completed_job ON completed_job.source = o._id
      WHERE ${whereSql}
        AND completed_job.deleted = 0
        AND ifNull(completed_job.status, '') = 'confirmed'
      GROUP BY workplace_id
    ) AS sc ON os.workplace_id = sc.workplace_id
  ) AS metrics
  WHERE ${metricWhereSql}`;
}

function topWorkplacesSelect(whereSql, metricWhereSql = '1 = 1', sort = DEFAULT_SORT) {
  return `${workplaceMetricsSelect(whereSql, metricWhereSql)}
  ORDER BY ${orderByForSort(sort)}
  LIMIT {limit:UInt64} OFFSET {offset:UInt64}`;
}

function topWorkplacesQuery(whereSql, metricWhereSql, sort) {
  return `${topWorkplacesSelect(whereSql, metricWhereSql, sort)}
  FORMAT JSONEachRow`;
}

function pinnedWorkplacesQuery(whereSql) {
  return `${workplaceMetricsSelect(whereSql)}
  FORMAT JSONEachRow`;
}

function totalWorkplacesQuery(whereSql, metricWhereSql, hasMetricFilters) {
  if (hasMetricFilters) {
    return `SELECT
    count() AS total_workplaces
  FROM (
    ${workplaceMetricsSelect(whereSql, metricWhereSql)}
  ) AS filtered_workplaces
  FORMAT JSONEachRow`;
  }

  return `SELECT
    countDistinct(o.workplace) AS total_workplaces
  FROM mg_orders AS o
  LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
  LEFT JOIN mg_clients AS c ON o.client = c._id
  LEFT JOIN mg_professions AS p ON o.spec = p.spec
  LEFT JOIN mg_contractors AS ct ON w.contractor = ct._id
  WHERE ${whereSql}
  FORMAT JSONEachRow`;
}

function dailyOrdersQuery(whereSql, metricWhereSql, sort) {
  return `WITH top_workplaces AS (
    ${topWorkplacesSelect(whereSql, metricWhereSql, sort)}
  ),
  daily_orders AS (
    SELECT
      o.workplace AS workplace_id,
      toString(toDate(o.start)) AS order_date,
      sum(ifNull(o.amount, 0)) AS ordered_shifts,
      sumIf(ifNull(o.amount, 0), ifNull(o.deleted, 0) = 0 AND ifNull(o.is_hidden, 0) = 0) AS sla_ordered_shifts
    FROM mg_orders AS o
    LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
    LEFT JOIN mg_clients AS c ON o.client = c._id
    LEFT JOIN mg_professions AS p ON o.spec = p.spec
    LEFT JOIN mg_contractors AS ct ON w.contractor = ct._id
    INNER JOIN top_workplaces AS tw ON o.workplace = tw.workplace_id
    WHERE ${whereSql}
    GROUP BY workplace_id, order_date
  ),
  daily_completed AS (
    SELECT
      o.workplace AS workplace_id,
      toString(toDate(o.start)) AS order_date,
      count() AS completed_shifts,
      countIf(ifNull(o.deleted, 0) = 0 AND ifNull(o.is_hidden, 0) = 0) AS sla_completed_shifts
    FROM mg_orders AS o
    LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
    LEFT JOIN mg_clients AS c ON o.client = c._id
    LEFT JOIN mg_professions AS p ON o.spec = p.spec
    LEFT JOIN mg_contractors AS ct ON w.contractor = ct._id
    INNER JOIN top_workplaces AS tw ON o.workplace = tw.workplace_id
    INNER JOIN mg_jobs AS completed_job ON completed_job.source = o._id
    WHERE ${whereSql}
      AND completed_job.deleted = 0
      AND ifNull(completed_job.status, '') = 'confirmed'
    GROUP BY workplace_id, order_date
  )
  SELECT
    d.workplace_id AS workplace_id,
    d.order_date AS order_date,
    d.ordered_shifts AS ordered_shifts,
    ifNull(c.completed_shifts, 0) AS completed_shifts,
    d.sla_ordered_shifts AS sla_ordered_shifts,
    ifNull(c.sla_completed_shifts, 0) AS sla_completed_shifts
  FROM daily_orders AS d
  LEFT JOIN daily_completed AS c
    ON d.workplace_id = c.workplace_id
    AND d.order_date = c.order_date
  ORDER BY workplace_id, order_date
  FORMAT JSONEachRow`;
}

function dailyOrdersForWorkplacesQuery(whereSql) {
  return `WITH daily_orders AS (
    SELECT
      o.workplace AS workplace_id,
      toString(toDate(o.start)) AS order_date,
      sum(ifNull(o.amount, 0)) AS ordered_shifts,
      sumIf(ifNull(o.amount, 0), ifNull(o.deleted, 0) = 0 AND ifNull(o.is_hidden, 0) = 0) AS sla_ordered_shifts
    FROM mg_orders AS o
    LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
    LEFT JOIN mg_clients AS c ON o.client = c._id
    LEFT JOIN mg_professions AS p ON o.spec = p.spec
    LEFT JOIN mg_contractors AS ct ON w.contractor = ct._id
    WHERE ${whereSql}
      AND o.workplace IN {workplace_ids:Array(String)}
    GROUP BY workplace_id, order_date
  ),
  daily_completed AS (
    SELECT
      o.workplace AS workplace_id,
      toString(toDate(o.start)) AS order_date,
      count() AS completed_shifts,
      countIf(ifNull(o.deleted, 0) = 0 AND ifNull(o.is_hidden, 0) = 0) AS sla_completed_shifts
    FROM mg_orders AS o
    LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
    LEFT JOIN mg_clients AS c ON o.client = c._id
    LEFT JOIN mg_professions AS p ON o.spec = p.spec
    LEFT JOIN mg_contractors AS ct ON w.contractor = ct._id
    INNER JOIN mg_jobs AS completed_job ON completed_job.source = o._id
    WHERE ${whereSql}
      AND o.workplace IN {workplace_ids:Array(String)}
      AND completed_job.deleted = 0
      AND ifNull(completed_job.status, '') = 'confirmed'
    GROUP BY workplace_id, order_date
  )
  SELECT
    d.workplace_id AS workplace_id,
    d.order_date AS order_date,
    d.ordered_shifts AS ordered_shifts,
    ifNull(c.completed_shifts, 0) AS completed_shifts,
    d.sla_ordered_shifts AS sla_ordered_shifts,
    ifNull(c.sla_completed_shifts, 0) AS sla_completed_shifts
  FROM daily_orders AS d
  LEFT JOIN daily_completed AS c
    ON d.workplace_id = c.workplace_id
    AND d.order_date = c.order_date
  ORDER BY workplace_id, order_date
  FORMAT JSONEachRow`;
}

async function loadDailyRowsForWorkplaces(client, whereSql, params, workplaceIds, operation) {
  if (workplaceIds.length === 0) {
    return [];
  }

  return client.queryJSONEachRow(
    dailyOrdersForWorkplacesQuery(whereSql),
    {
      ...params,
      param_workplace_ids: serializeStringArray(workplaceIds)
    },
    operation
  );
}

function paginationFromTotal(filters, totalWorkplaces) {
  const safeTotal = numberValue(totalWorkplaces);
  const totalPages = Math.max(1, Math.ceil(safeTotal / filters.limit));
  const page = Math.min(filters.page, totalPages);

  return {
    page,
    limit: filters.limit,
    totalWorkplaces: safeTotal,
    totalPages,
    hasPrevious: page > 1,
    hasNext: page < totalPages
  };
}

function emptyPagination(filters) {
  return {
    page: filters.page,
    limit: filters.limit,
    totalWorkplaces: 0,
    totalPages: 1,
    hasPrevious: false,
    hasNext: false
  };
}

function emptyWorkplaceAnalysisDashboard(filters, filterOptions = emptyFilterOptions()) {
  return {
    ...mergeWorkplaceAnalysisRowsWithActiveGigers(filters, [], [], new Map()),
    filterOptions,
    pagination: emptyPagination(filters)
  };
}

function assertWorkplaceAnalysisSection(section) {
  if (WORKPLACE_ANALYSIS_SECTIONS.has(section)) {
    return;
  }

  const error = new Error(`Unknown workplace analysis section: ${section}`);

  error.status = 400;
  throw error;
}

async function readThroughCache(cache, key, loader) {
  if (!cache || typeof cache.getOrLoad !== 'function') {
    return loader();
  }

  return cache.getOrLoad(key, loader);
}

function cacheKeyForWorkplaceAnalysisSection(section, filters) {
  return JSON.stringify({
    board: 'workplace-analysis',
    section,
    filters: {
      from: filters.from,
      to: filters.to,
      pinnedWorkplaceIds: filters.pinnedWorkplaceIds,
      client: filters.client,
      city: filters.city,
      region: filters.region,
      profession: filters.profession,
      orderType: filters.orderType,
      jobStatus: filters.jobStatus,
      contractor: filters.contractor,
      search: filters.search,
      includeDeletedOrders: filters.includeDeletedOrders,
      includeHiddenOrders: filters.includeHiddenOrders,
      sort: filters.sort,
      slaFrom: filters.slaFrom,
      slaTo: filters.slaTo,
      ordersFrom: filters.ordersFrom,
      ordersTo: filters.ordersTo,
      stabilityFrom: filters.stabilityFrom,
      stabilityTo: filters.stabilityTo,
      limit: filters.limit,
      page: filters.page
    }
  });
}

function orderRowsByWorkplaceIds(rows, workplaceIds) {
  const rowsByWorkplace = new Map();

  for (const row of rows) {
    const workplaceId = String(row.workplace_id || '');

    if (workplaceId !== '' && !rowsByWorkplace.has(workplaceId)) {
      rowsByWorkplace.set(workplaceId, row);
    }
  }

  return workplaceIds.map((workplaceId) => rowsByWorkplace.get(workplaceId)).filter(Boolean);
}

async function loadWorkplaceAnalysisDashboardShell(client, input = {}, now = new Date()) {
  let filters = normalizeWorkplaceAnalysisFilters(input, now);
  const base = baseParamsForFilters(filters);
  const filterOptionRows = await client.queryJSONEachRow(
    filterOptionsQuery(base.whereSql),
    base.params,
    'workplace analysis filter options'
  );
  const filterOptions = filterOptionsFromRows(filterOptionRows);

  filters = restrictFiltersToOptions(filters, filterOptions);

  return emptyWorkplaceAnalysisDashboard(filters, filterOptions);
}

async function loadWorkplaceAnalysisPointsDashboard(client, filters, options = {}) {
  const hasPinnedWorkplaces = filters.pinnedWorkplaceIds.length > 0;
  let { params, whereSql, metricWhereSql, hasMetricFilters } = paramsForFilters(filters, {
    excludePinned: hasPinnedWorkplaces
  });
  const totalRows = await client.queryJSONEachRow(
    totalWorkplacesQuery(whereSql, metricWhereSql, hasMetricFilters),
    params,
    'workplace analysis total workplaces'
  );
  const pagination = paginationFromTotal(filters, totalRows[0] && totalRows[0].total_workplaces);

  if (pagination.page !== filters.page) {
    filters = {
      ...filters,
      page: pagination.page,
      offset: (pagination.page - 1) * filters.limit
    };
    ({ params, whereSql, metricWhereSql, hasMetricFilters } = paramsForFilters(filters, {
      excludePinned: hasPinnedWorkplaces
    }));
  }

  let workplaceRows;
  let dailyRows;

  if (!hasPinnedWorkplaces) {
    [workplaceRows, dailyRows] = await Promise.all([
      client.queryJSONEachRow(
        topWorkplacesQuery(whereSql, metricWhereSql, filters.sort),
        params,
        'workplace analysis top workplaces'
      ),
      client.queryJSONEachRow(
        dailyOrdersQuery(whereSql, metricWhereSql, filters.sort),
        params,
        'workplace analysis daily orders'
      )
    ]);
  } else {
    const pinnedParams = paramsForPinnedWorkplaces(filters);
    const [regularRows, rawPinnedRows] = await Promise.all([
      client.queryJSONEachRow(
        topWorkplacesQuery(whereSql, metricWhereSql, filters.sort),
        params,
        'workplace analysis top workplaces'
      ),
      client.queryJSONEachRow(
        pinnedWorkplacesQuery(pinnedParams.whereSql),
        pinnedParams.params,
        'workplace analysis pinned workplaces'
      )
    ]);
    const pinnedRows = orderRowsByWorkplaceIds(rawPinnedRows, filters.pinnedWorkplaceIds);
    const pinnedRowIds = new Set(uniqueWorkplaceIds(pinnedRows));
    const regularRowsWithoutPinned = regularRows.filter(
      (row) => !pinnedRowIds.has(String(row.workplace_id || ''))
    );
    const [pinnedDailyRows, regularDailyRows] = await Promise.all([
      loadDailyRowsForWorkplaces(
        client,
        pinnedParams.whereSql,
        pinnedParams.params,
        uniqueWorkplaceIds(pinnedRows),
        'workplace analysis pinned daily orders'
      ),
      loadDailyRowsForWorkplaces(
        client,
        whereSql,
        params,
        uniqueWorkplaceIds(regularRowsWithoutPinned),
        'workplace analysis daily orders'
      )
    ]);

    workplaceRows = [...pinnedRows, ...regularRowsWithoutPinned];
    dailyRows = [...pinnedDailyRows, ...regularDailyRows];
  }

  const activeGigersByWorkplace = await loadActiveGigers5kmByWorkplace(
    client,
    uniqueWorkplaceIds(workplaceRows),
    options.activeGigersCache
  );
  const dashboard = mergeWorkplaceAnalysisRowsWithActiveGigers(
    filters,
    workplaceRows,
    dailyRows,
    activeGigersByWorkplace
  );

  return {
    ...dashboard,
    pagination
  };
}

async function loadWorkplaceAnalysisDashboardSection(
  client,
  input = {},
  section,
  now = new Date(),
  options = {}
) {
  assertWorkplaceAnalysisSection(section);

  const filters = normalizeWorkplaceAnalysisFilters(input, now);

  return readThroughCache(
    options.cache,
    cacheKeyForWorkplaceAnalysisSection(section, filters),
    () => loadWorkplaceAnalysisPointsDashboard(client, filters, options)
  );
}

async function loadWorkplaceAnalysisDashboard(client, input = {}, now = new Date(), options = {}) {
  const shell = await loadWorkplaceAnalysisDashboardShell(client, input, now);
  const pointsDashboard = await loadWorkplaceAnalysisPointsDashboard(client, shell.filters, options);

  return {
    ...pointsDashboard,
    filterOptions: shell.filterOptions
  };
}

module.exports = {
  WORKPLACE_ANALYSIS_SECTIONS,
  buildDateKeys,
  heatmapLevel,
  loadActiveGigers5kmByWorkplace,
  loadWorkplaceAnalysisDashboard,
  loadWorkplaceAnalysisDashboardSection,
  loadWorkplaceAnalysisDashboardShell,
  mergeWorkplaceAnalysisRows,
  normalizeWorkplaceAnalysisFilters
};
