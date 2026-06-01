const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_LIMIT = 12;
const ALLOWED_LIMITS = new Set([10, 12, 20, 50]);
const ALLOWED_ORDER_TYPES = new Set(['once', 'regular']);
const FILTER_OPTION_KEYS = ['client', 'city', 'region', 'profession', 'orderType', 'contractor'];

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

function normalizeLimit(value) {
  const limit = Number(value);

  return Number.isInteger(limit) && ALLOWED_LIMITS.has(limit) ? limit : DEFAULT_LIMIT;
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

  return {
    from,
    to,
    fromDateTime: toDateTimeParam(from),
    toExclusiveDateTime: toDateTimeParam(toExclusive),
    rangeDays: buildDateKeys(from, to).length,
    client: cleanValues(input.client),
    city: cleanValues(input.city),
    region: cleanValues(input.region),
    profession: cleanValues(input.profession),
    orderType: cleanValues(input.orderType).filter((value) => ALLOWED_ORDER_TYPES.has(value)),
    contractor: cleanValues(input.contractor),
    search: cleanText(input.search),
    limit: normalizeLimit(input.limit)
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
  const dateKeys = buildDateKeys(filters.from, filters.to);
  const dailyByWorkplace = new Map();
  let maxDailyAmount = 0;

  for (const row of dailyRows) {
    const workplaceId = String(row.workplace_id || '');
    const date = String(row.order_date || '');
    const amount = numberValue(row.ordered_shifts);

    if (!dailyByWorkplace.has(workplaceId)) {
      dailyByWorkplace.set(workplaceId, new Map());
    }

    dailyByWorkplace.get(workplaceId).set(date, amount);
    maxDailyAmount = Math.max(maxDailyAmount, amount);
  }

  const points = workplaceRows.map((row) => {
    const workplaceId = String(row.workplace_id || '');
    const activeDays = numberValue(row.active_days);
    const totalOrderedShifts = numberValue(row.total_ordered_shifts);
    const dailyAmounts = dailyByWorkplace.get(workplaceId) || new Map();
    const heatmapDays = dateKeys.map((date) => {
      const amount = numberValue(dailyAmounts.get(date));

      return {
        date,
        amount,
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
      stabilityPercent: percent(activeDays, filters.rangeDays),
      avgDailyOrder: activeDays > 0 ? totalOrderedShifts / activeDays : 0,
      heatmapDays
    };
  });

  return {
    filters,
    context: {
      sortLabel: 'Сначала крупнейшие по заказу',
      maxDailyAmount
    },
    points
  };
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
    'o.deleted = 0',
    'o.start >= {from:DateTime}',
    'o.start < {to:DateTime}',
    "ifNull(o.workplace, '') != ''",
    'ifNull(o.amount, 0) > 0'
  ];

  return {
    params,
    whereSql: where.join('\n    AND ')
  };
}

function paramsForFilters(filters) {
  const base = baseParamsForFilters(filters);
  const params = {
    ...base.params,
    param_limit: filters.limit
  };
  const where = [base.whereSql];

  addOptionalWhere(filters, where, params);

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

function filterOptionsQuery(whereSql) {
  return `${[
    filterOptionSelect('client', "ifNull(c.title, '')", whereSql),
    filterOptionSelect('city', "ifNull(w.address__city, '')", whereSql),
    filterOptionSelect('region', "ifNull(w.address__region, '')", whereSql),
    filterOptionSelect('profession', "if(ifNull(p.caption, '') = '', o.spec, p.caption)", whereSql),
    filterOptionSelect('orderType', "ifNull(o.type, '')", whereSql),
    filterOptionSelect('contractor', "ifNull(ct.legal_name, '')", whereSql)
  ].join('\n  UNION ALL\n  ')}
  ORDER BY filter, value
  FORMAT JSONEachRow`;
}

function topWorkplacesSelect(whereSql) {
  return `SELECT
    o.workplace AS workplace_id,
    ifNull(any(w.title), '') AS workplace_title,
    ifNull(any(w.technical_name), '') AS technical_name,
    ifNull(any(c.title), 'Без бренда') AS client_title,
    ifNull(any(w.address__city), '') AS city,
    ifNull(any(w.address__region), '') AS region,
    ifNull(any(w.address__street), '') AS street,
    sum(ifNull(o.amount, 0)) AS total_ordered_shifts,
    countDistinct(toDate(o.start)) AS active_days
  FROM mg_orders AS o
  LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
  LEFT JOIN mg_clients AS c ON o.client = c._id
  LEFT JOIN mg_professions AS p ON o.spec = p.spec
  LEFT JOIN mg_contractors AS ct ON w.contractor = ct._id
  WHERE ${whereSql}
  GROUP BY workplace_id
  ORDER BY total_ordered_shifts DESC, workplace_id ASC
  LIMIT {limit:UInt64}`;
}

function topWorkplacesQuery(whereSql) {
  return `${topWorkplacesSelect(whereSql)}
  FORMAT JSONEachRow`;
}

function dailyOrdersQuery(whereSql) {
  return `WITH top_workplaces AS (
    ${topWorkplacesSelect(whereSql)}
  )
  SELECT
    o.workplace AS workplace_id,
    toString(toDate(o.start)) AS order_date,
    sum(ifNull(o.amount, 0)) AS ordered_shifts
  FROM mg_orders AS o
  LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
  LEFT JOIN mg_clients AS c ON o.client = c._id
  LEFT JOIN mg_professions AS p ON o.spec = p.spec
  LEFT JOIN mg_contractors AS ct ON w.contractor = ct._id
  INNER JOIN top_workplaces AS tw ON o.workplace = tw.workplace_id
  WHERE ${whereSql}
  GROUP BY workplace_id, order_date
  ORDER BY workplace_id, order_date
  FORMAT JSONEachRow`;
}

async function loadWorkplaceAnalysisDashboard(client, input = {}, now = new Date()) {
  let filters = normalizeWorkplaceAnalysisFilters(input, now);
  const base = baseParamsForFilters(filters);
  const filterOptionRows = await client.queryJSONEachRow(
    filterOptionsQuery(base.whereSql),
    base.params,
    'workplace analysis filter options'
  );
  const filterOptions = filterOptionsFromRows(filterOptionRows);

  filters = restrictFiltersToOptions(filters, filterOptions);

  const { params, whereSql } = paramsForFilters(filters);
  const [workplaceRows, dailyRows] = await Promise.all([
    client.queryJSONEachRow(
      topWorkplacesQuery(whereSql),
      params,
      'workplace analysis top workplaces'
    ),
    client.queryJSONEachRow(
      dailyOrdersQuery(whereSql),
      params,
      'workplace analysis daily orders'
    )
  ]);

  return {
    ...mergeWorkplaceAnalysisRows(filters, workplaceRows, dailyRows),
    filterOptions
  };
}

module.exports = {
  buildDateKeys,
  heatmapLevel,
  loadWorkplaceAnalysisDashboard,
  mergeWorkplaceAnalysisRows,
  normalizeWorkplaceAnalysisFilters
};
