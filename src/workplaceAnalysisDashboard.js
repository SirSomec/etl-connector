const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_LIMIT = 12;
const ALLOWED_LIMITS = new Set([10, 12, 20, 50]);
const ALLOWED_ORDER_TYPES = new Set(['once', 'regular']);

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
  const orderType = cleanText(input.orderType);

  return {
    from,
    to,
    fromDateTime: toDateTimeParam(from),
    toExclusiveDateTime: toDateTimeParam(toExclusive),
    rangeDays: buildDateKeys(from, to).length,
    client: cleanText(input.client),
    city: cleanText(input.city),
    region: cleanText(input.region),
    profession: cleanText(input.profession),
    orderType: ALLOWED_ORDER_TYPES.has(orderType) ? orderType : '',
    contractor: cleanText(input.contractor),
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
  if (filters.client) {
    where.push('c.title = {client:String}');
    params.param_client = filters.client;
  }
  if (filters.city) {
    where.push('w.address__city = {city:String}');
    params.param_city = filters.city;
  }
  if (filters.region) {
    where.push('w.address__region = {region:String}');
    params.param_region = filters.region;
  }
  if (filters.profession) {
    where.push("(o.spec = {profession:String} OR positionCaseInsensitive(ifNull(p.caption, ''), {profession:String}) > 0)");
    params.param_profession = filters.profession;
  }
  if (filters.orderType) {
    where.push('o.type = {order_type:String}');
    params.param_order_type = filters.orderType;
  }
  if (filters.contractor) {
    where.push("(ct._id = {contractor:String} OR positionCaseInsensitive(ifNull(ct.legal_name, ''), {contractor:String}) > 0)");
    params.param_contractor = filters.contractor;
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

function paramsForFilters(filters) {
  const params = {
    param_from: filters.fromDateTime,
    param_to: filters.toExclusiveDateTime,
    param_limit: filters.limit
  };
  const where = [
    'o.deleted = 0',
    'o.start >= {from:DateTime}',
    'o.start < {to:DateTime}',
    "ifNull(o.workplace, '') != ''",
    'ifNull(o.amount, 0) > 0'
  ];

  addOptionalWhere(filters, where, params);

  return {
    params,
    whereSql: where.join('\n    AND ')
  };
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
  const filters = normalizeWorkplaceAnalysisFilters(input, now);
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

  return mergeWorkplaceAnalysisRows(filters, workplaceRows, dailyRows);
}

module.exports = {
  buildDateKeys,
  heatmapLevel,
  loadWorkplaceAnalysisDashboard,
  mergeWorkplaceAnalysisRows,
  normalizeWorkplaceAnalysisFilters
};
