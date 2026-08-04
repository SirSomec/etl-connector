const { successfulConfirmedShiftFlagExpression } = require('./successfulConfirmedShift');
const {
  actualOrderDomainCondition,
  actualOrderJoinsSql,
  clientNotFakeCondition
} = require('./analyticsDomainSql');

const PERIOD_EXPRESSIONS = {
  day: (field) => `toDate(${field})`,
  week: (field) => `toStartOfWeek(${field})`,
  month: (field) => `toStartOfMonth(${field})`,
  quarter: (field) => `toStartOfQuarter(${field})`
};

const DEFAULT_PERIOD = 'month';
const DEFAULT_LOOKBACK_DAYS = 90;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BRAND_ANALYSIS_SECTION_NAMES = ['summary', 'trend', 'regions', 'workplaces', 'professions', 'statuses'];
const BRAND_ANALYSIS_SECTIONS = new Set(BRAND_ANALYSIS_SECTION_NAMES);
const FILTER_OPTION_KEYS = ['city', 'region'];
const BRAND_TITLE_EXPRESSION = "ifNull(nullIf(trimBoth(ifNull(c.title, '')), ''), 'Без бренда')";
const CLOSING_STATUSES_SQL = "('booked', 'going', 'inprogress', 'checkingin', 'checkingout', 'completed', 'delayed', 'waiting')";

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

function toDateTimeParam(dateOnly) {
  return `${dateOnly} 00:00:00`;
}

function normalizeBrandId(value) {
  return String(value || '').trim();
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

function normalizeBrandAnalysisFilters(input = {}, now = new Date()) {
  const requestedPeriod = typeof input.period === 'string' ? input.period : '';
  const period = Object.prototype.hasOwnProperty.call(PERIOD_EXPRESSIONS, requestedPeriod)
    ? requestedPeriod
    : DEFAULT_PERIOD;
  const today = parseDateOnly(formatDateUTC(now));
  const defaultFrom = formatDateUTC(addDaysUTC(today, -DEFAULT_LOOKBACK_DAYS));
  const requestedFrom = parseDateOnly(input.from);
  const requestedTo = parseDateOnly(input.to);
  let from = requestedFrom ? formatDateUTC(requestedFrom) : defaultFrom;
  let to = requestedTo ? formatDateUTC(requestedTo) : formatDateUTC(today);

  if (parseDateOnly(from).getTime() > parseDateOnly(to).getTime()) {
    from = defaultFrom;
    to = formatDateUTC(today);
  }

  const fromDate = parseDateOnly(from);
  const toExclusiveDate = addDaysUTC(parseDateOnly(to), 1);
  const rangeDays = Math.max(0, Math.round((toExclusiveDate.getTime() - fromDate.getTime()) / 86400000));

  return {
    period,
    from,
    to,
    fromDateTime: toDateTimeParam(from),
    toExclusiveDateTime: toDateTimeParam(formatDateUTC(toExclusiveDate)),
    brandId: normalizeBrandId(input.brandId),
    city: cleanValues(input.city),
    region: cleanValues(input.region),
    page: Math.max(1, Math.floor(Number(input.page) || 1)),
    rangeDays
  };
}

function buildPeriodExpression(period, field) {
  const builder = PERIOD_EXPRESSIONS[period];

  if (!builder) {
    throw new Error(`Unsupported period: ${period}`);
  }

  return builder(field);
}

function numberValue(value) {
  const number = Number(value || 0);

  return Number.isFinite(number) ? number : 0;
}

function nullableNumberValue(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

function textValue(value) {
  return value === null || typeof value === 'undefined' ? '' : String(value);
}

function phoneValue(value) {
  return textValue(value).trim();
}

function percent(numerator, denominator) {
  const bottom = numberValue(denominator);

  if (bottom <= 0) {
    return 0;
  }

  return (numberValue(numerator) / bottom) * 100;
}

function firstNumberValue(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') {
      return numberValue(value);
    }
  }

  return 0;
}

function emptySummary() {
  return {
    orderedShifts: 0,
    workedShifts: 0,
    coveredShifts: 0,
    openDemand: 0,
    slaPercent: 0,
    coveragePercent: 0,
    revenueRub: 0,
    uniqueWorkers: 0,
    workplacesWithOrders: 0,
    workplacesWithWorkedShifts: 0,
    cancelledShifts: 0,
    selfBookingPercent: 0,
    orderStabilityPercent: 0,
    avgWorkerRateHour: 0,
    avgCustomerRateHour: 0,
    ratingAll: null,
    ratingLast10: null,
    ratingReviewCount: 0
  };
}

function mapSummaryRows(orderRows, shiftRows, reviewRows, filters) {
  const orders = orderRows[0] || {};
  const shifts = shiftRows[0] || {};
  const reviews = reviewRows[0] || {};
  const orderedShifts = numberValue(orders.ordered_shifts);
  const workedShifts = numberValue(shifts.worked_shifts);
  const coveredShifts = numberValue(shifts.covered_shifts);

  return {
    orderedShifts,
    workedShifts,
    coveredShifts,
    openDemand: Math.max(0, orderedShifts - coveredShifts),
    slaPercent: percent(workedShifts, orderedShifts),
    coveragePercent: percent(coveredShifts, orderedShifts),
    revenueRub: numberValue(shifts.revenue_rub),
    uniqueWorkers: numberValue(shifts.unique_workers),
    workplacesWithOrders: numberValue(orders.workplaces_with_orders),
    workplacesWithWorkedShifts: numberValue(shifts.workplaces_with_worked_shifts),
    cancelledShifts: numberValue(shifts.cancelled_shifts),
    selfBookingPercent: percent(shifts.self_booked_confirmed_shifts, workedShifts),
    orderStabilityPercent: percent(orders.active_days, filters.rangeDays),
    avgWorkerRateHour: firstNumberValue(shifts.avg_worker_rate_hour),
    avgCustomerRateHour: firstNumberValue(shifts.avg_customer_rate_hour),
    ratingAll: nullableNumberValue(reviews.avg_rating_all),
    ratingLast10: nullableNumberValue(reviews.avg_rating_last_10),
    ratingReviewCount: numberValue(reviews.review_count)
  };
}

function emptyTrendRow(period) {
  return {
    period,
    orderedShifts: 0,
    workedShifts: 0,
    coveredShifts: 0,
    openDemand: 0,
    slaPercent: 0,
    coveragePercent: 0,
    revenueRub: 0,
    cancelledShifts: 0,
    respondedUserIds: [],
    workedUserIds: [],
    uniqueRespondedUsers: 0,
    uniqueWorkedUsers: 0
  };
}

function normalizeIdArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return cleanValues(value);
}

function mergeTrendRows(orderRows, shiftRows, responseRows = []) {
  const byPeriod = new Map();

  for (const row of orderRows) {
    const period = String(row.period);

    byPeriod.set(period, {
      ...emptyTrendRow(period),
      orderedShifts: numberValue(row.ordered_shifts)
    });
  }

  for (const row of shiftRows) {
    const period = String(row.period);
    const current = byPeriod.get(period) || emptyTrendRow(period);

    current.workedShifts = numberValue(row.worked_shifts);
    current.coveredShifts = numberValue(row.covered_shifts);
    current.openDemand = Math.max(0, current.orderedShifts - current.coveredShifts);
    current.slaPercent = percent(current.workedShifts, current.orderedShifts);
    current.coveragePercent = percent(current.coveredShifts, current.orderedShifts);
    current.revenueRub = numberValue(row.revenue_rub);
    current.cancelledShifts = numberValue(row.cancelled_shifts);
    current.workedUserIds = normalizeIdArray(row.worked_user_ids);
    current.uniqueWorkedUsers = current.workedUserIds.length;
    byPeriod.set(period, current);
  }

  for (const row of responseRows) {
    const period = String(row.period);
    const current = byPeriod.get(period) || emptyTrendRow(period);

    current.respondedUserIds = normalizeIdArray(row.responded_user_ids);
    current.uniqueRespondedUsers = current.respondedUserIds.length;
    byPeriod.set(period, current);
  }

  return Array.from(byPeriod.values()).sort((left, right) => left.period.localeCompare(right.period));
}

function emptyRegionRow(region) {
  return {
    region,
    orderedShifts: 0,
    coveredShifts: 0,
    workedShifts: 0,
    openDemand: 0,
    slaPercent: 0,
    coveragePercent: 0,
    workplaces: 0,
    orderTrend: []
  };
}

function mergeRegionRows(orderRows, shiftRows, trendRows = []) {
  const byRegion = new Map();

  for (const row of orderRows) {
    const region = String(row.region || 'Без региона');

    byRegion.set(region, {
      ...emptyRegionRow(region),
      orderedShifts: numberValue(row.ordered_shifts),
      workplaces: numberValue(row.workplaces)
    });
  }

  for (const row of shiftRows) {
    const region = String(row.region || 'Без региона');
    const current = byRegion.get(region) || emptyRegionRow(region);

    current.coveredShifts = numberValue(row.covered_shifts);
    current.workedShifts = numberValue(row.worked_shifts);
    current.openDemand = Math.max(0, current.orderedShifts - current.coveredShifts);
    current.slaPercent = percent(current.workedShifts, current.orderedShifts);
    current.coveragePercent = percent(current.coveredShifts, current.orderedShifts);
    byRegion.set(region, current);
  }

  for (const row of trendRows) {
    const region = String(row.region || 'Без региона');
    const current = byRegion.get(region) || emptyRegionRow(region);

    current.orderTrend.push({
      period: String(row.period || ''),
      orderedShifts: numberValue(row.ordered_shifts)
    });
    byRegion.set(region, current);
  }

  return Array.from(byRegion.values()).map((row) => ({
    ...row,
    orderTrend: row.orderTrend.sort((left, right) => left.period.localeCompare(right.period))
  })).sort((left, right) => {
    if (right.openDemand !== left.openDemand) {
      return right.openDemand - left.openDemand;
    }

    if (right.orderedShifts !== left.orderedShifts) {
      return right.orderedShifts - left.orderedShifts;
    }

    return left.region.localeCompare(right.region);
  });
}

function emptyWorkplaceRow(workplaceId) {
  return {
    workplaceId,
    workplaceTitle: '',
    city: '',
    orderedShifts: 0,
    workedShifts: 0,
    coveredShifts: 0,
    openDemand: 0,
    slaPercent: 0,
    coveragePercent: 0,
    revenueRub: 0,
    uniqueWorkers: 0,
    activeDays: 0,
    cancelledShifts: 0
  };
}

function mergeWorkplaceRows(orderRows, shiftRows) {
  const byWorkplace = new Map();

  for (const row of orderRows) {
    const workplaceId = String(row.workplace_id || '');

    byWorkplace.set(workplaceId, {
      ...emptyWorkplaceRow(workplaceId),
      workplaceTitle: String(row.workplace_title || 'Без точки'),
      city: String(row.city || ''),
      orderedShifts: numberValue(row.ordered_shifts),
      activeDays: numberValue(row.active_days)
    });
  }

  for (const row of shiftRows) {
    const workplaceId = String(row.workplace_id || '');
    const current = byWorkplace.get(workplaceId) || emptyWorkplaceRow(workplaceId);

    current.workedShifts = numberValue(row.worked_shifts);
    current.coveredShifts = numberValue(row.covered_shifts);
    current.openDemand = Math.max(0, current.orderedShifts - current.coveredShifts);
    current.slaPercent = percent(current.workedShifts, current.orderedShifts);
    current.coveragePercent = percent(current.coveredShifts, current.orderedShifts);
    current.revenueRub = numberValue(row.revenue_rub);
    current.uniqueWorkers = numberValue(row.unique_workers);
    current.cancelledShifts = numberValue(row.cancelled_shifts);
    byWorkplace.set(workplaceId, current);
  }

  return Array.from(byWorkplace.values()).sort((left, right) => {
    if (right.openDemand !== left.openDemand) {
      return right.openDemand - left.openDemand;
    }

    if (right.orderedShifts !== left.orderedShifts) {
      return right.orderedShifts - left.orderedShifts;
    }

    return left.workplaceTitle.localeCompare(right.workplaceTitle);
  });
}

function emptyProfessionRow(profession) {
  return {
    profession,
    orderedShifts: 0,
    workedShifts: 0,
    slaPercent: 0,
    revenueRub: 0,
    cancelledShifts: 0
  };
}

function mergeProfessionRows(orderRows, shiftRows) {
  const byProfession = new Map();

  for (const row of orderRows) {
    const profession = String(row.profession || 'Без специальности');

    byProfession.set(profession, {
      ...emptyProfessionRow(profession),
      orderedShifts: numberValue(row.ordered_shifts)
    });
  }

  for (const row of shiftRows) {
    const profession = String(row.profession || 'Без специальности');
    const current = byProfession.get(profession) || emptyProfessionRow(profession);

    current.workedShifts = numberValue(row.worked_shifts);
    current.slaPercent = percent(current.workedShifts, current.orderedShifts);
    current.revenueRub = numberValue(row.revenue_rub);
    current.cancelledShifts = numberValue(row.cancelled_shifts);
    byProfession.set(profession, current);
  }

  return Array.from(byProfession.values()).sort((left, right) => {
    if (right.orderedShifts !== left.orderedShifts) {
      return right.orderedShifts - left.orderedShifts;
    }

    return left.profession.localeCompare(right.profession);
  });
}

function mapStatusRows(rows) {
  return rows.map((row) => ({
    status: String(row.status || 'empty'),
    shifts: numberValue(row.shifts)
  }));
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

    if (seenByKey[key].has(value)) {
      continue;
    }

    seenByKey[key].add(value);
    options[key].push(value);
  }

  return options;
}

function nullableNumberExpression(alias, field) {
  return `toFloat64OrNull(nullIf(trimBoth(ifNull(toString(${alias}.${field}), '')), ''))`;
}

function nullablePositiveNumberExpression(alias, field) {
  return `nullIf(${nullableNumberExpression(alias, field)}, 0)`;
}

function positiveOrZeroNumberExpression(alias, field) {
  return `ifNull(${nullablePositiveNumberExpression(alias, field)}, 0)`;
}

function transactionAmountExpression(alias = 't') {
  return `coalesce(${nullableNumberExpression(alias, 'payment_amount')}, ${nullableNumberExpression(alias, 'amount')}, 0)`;
}

function escapeClickHouseString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function serializeStringArray(values) {
  return `[${values.map((value) => `'${escapeClickHouseString(value)}'`).join(',')}]`;
}

function addDimensionFiltersWhere(filters, where) {
  if (filters.city.length > 0) {
    where.push('w.address__city IN {cities:Array(String)}');
  }
  if (filters.region.length > 0) {
    where.push('w.address__region IN {regions:Array(String)}');
  }
}

function actualOrdersCte({ includeDateFilter = false } = {}, filters = null) {
  const where = [
    actualOrderDomainCondition('o', 'c', 'ct'),
    `${BRAND_TITLE_EXPRESSION} = {brand_title:String}`
  ];

  if (includeDateFilter) {
    where.push('o.start >= {from:DateTime}', 'o.start < {to:DateTime}');
  }

  if (filters) {
    addDimensionFiltersWhere(filters, where);
  }

  return `actual_orders AS (
  SELECT
    o._id AS order_id,
    o.start AS start,
    o.client AS client,
    o.workplace AS workplace,
    ifNull(nullIf(w.title, ''), 'Без точки') AS workplace_title,
    ifNull(w.address__city, '') AS city,
    ifNull(w.address__region, '') AS region,
    if(ifNull(p.caption, '') = '', ifNull(o.spec, ''), p.caption) AS profession,
    ifNull(o.amount, 0) AS amount,
    ifNull(nullIf(c.title, ''), 'Без бренда') AS brand,
    o.pieceworks AS pieceworks,
    ifNull(o.contract_type, '') AS order_contract_type,
    ifNull(ct.contract_type, '') AS contractor_contract_type,
    ifNull(ct.comission, 0) AS commission_percent
  FROM mg_orders AS o
  ${actualOrderJoinsSql('o', { clientAlias: 'c', workplaceAlias: 'w', contractorAlias: 'ct' })}
  LEFT JOIN mg_professions AS p ON o.spec = p.spec
  WHERE ${where.join('\n    AND ')}
)`;
}

function actualOrdersWithClause(options, filters = null) {
  return `WITH ${actualOrdersCte(options, filters)}`;
}

function shiftFactsOnlyCte(filters = null) {
  return `WITH ${actualOrdersCte({}, filters)},
shift_facts AS (
  SELECT
    j._id AS job,
    j.start AS shift_start,
    ifNull(j.status, '') AS status,
    ao.client AS client,
    ao.workplace AS workplace,
    ao.workplace_title AS workplace_title,
    ao.city AS city,
    ao.region AS region,
    ao.profession AS profession,
    j.worker AS worker,
    j.source AS source,
    j.cancellation_reason AS cancellation_reason,
    j.salary_per_hour AS salary_per_hour,
    j.salary_per_job AS salary_per_job,
    j.payment_per_hour AS payment_per_hour,
    j.payment_per_job AS payment_per_job,
    j.hours AS hours,
    j.payment AS payment,
    ao.pieceworks AS piecework,
    j.start_fact AS start_fact,
    j.finish_fact AS finish_fact,
    ao.order_contract_type AS order_contract_type,
    ao.contractor_contract_type AS contractor_contract_type,
    ao.commission_percent AS commission_percent
  FROM mg_jobs AS j
  INNER JOIN actual_orders AS ao ON j.source = ao.order_id
  WHERE ifNull(j._id, '') != ''
    AND ifNull(j.deleted, 0) = 0
    AND j.start >= {from:DateTime}
    AND j.start < {to:DateTime}
)`;
}

function shiftFactsCte(filters = null) {
  return `${shiftFactsOnlyCte(filters)},
history_ranked AS (
  SELECT
    h.job AS job,
    ifNull(h.status, '') AS first_status,
    ifNull(h.initiator, '') AS first_initiator,
    row_number() OVER (
      PARTITION BY h.job
      ORDER BY coalesce(h.createdAt, h.updatedAt), h._id
    ) AS rn
  FROM mg_job_history AS h
  INNER JOIN shift_facts AS sf ON h.job = sf.job
  WHERE ifNull(h.job, '') != ''
    AND ifNull(h.status, '') != ''
),
first_history AS (
  SELECT
    job,
    first_status,
    first_initiator
  FROM history_ranked
  WHERE rn = 1
),
job_transactions AS (
  SELECT
    t.entityId AS job,
    sum(${transactionAmountExpression('t')}) AS transaction_amount
  FROM mg_transactions AS t
  INNER JOIN shift_facts AS sf ON t.entityId = sf.job
  WHERE ifNull(t.deleted, 0) = 0
    AND t.entityId != ''
  GROUP BY t.entityId
),
shift_enriched AS (
  SELECT
    sf.job AS job,
    sf.shift_start AS shift_start,
    sf.status AS status,
    sf.worker AS worker,
    sf.cancellation_reason AS cancellation_reason,
    sf.workplace AS workplace,
    sf.workplace_title AS workplace_title,
    sf.city AS city,
    sf.region AS region,
    sf.profession AS profession,
    sf.salary_per_hour AS salary_per_hour,
    sf.hours AS hours,
    sf.payment AS payment,
    sf.start_fact AS start_fact,
    sf.finish_fact AS finish_fact,
    sf.piecework AS piecework,
    if(ifNull(fh.first_initiator, '') = 'worker', 1, 0) AS is_self_booked,
    ifNull(nullIf(sf.order_contract_type, ''), ifNull(nullIf(sf.contractor_contract_type, ''), 'services')) AS contract_type,
    sf.commission_percent AS commission_percent,
    if(${positiveOrZeroNumberExpression('sf', 'salary_per_job')} > 0, ${positiveOrZeroNumberExpression('sf', 'salary_per_job')}, ${positiveOrZeroNumberExpression('sf', 'salary_per_hour')} * ${positiveOrZeroNumberExpression('sf', 'hours')}) AS worker_shift_amount,
    if(${positiveOrZeroNumberExpression('sf', 'payment_per_job')} > 0, ${positiveOrZeroNumberExpression('sf', 'payment_per_job')}, ${positiveOrZeroNumberExpression('sf', 'payment_per_hour')} * ${positiveOrZeroNumberExpression('sf', 'hours')}) AS customer_shift_amount,
    ifNull(jt.transaction_amount, 0) AS transaction_amount,
    ${nullablePositiveNumberExpression('sf', 'salary_per_hour')} AS worker_rate_hour,
    ${nullablePositiveNumberExpression('sf', 'payment_per_hour')} AS customer_rate_hour,
    ${successfulConfirmedShiftFlagExpression('sf', { pieceworkExpression: 'sf.piecework' })} AS is_successful_confirmed_shift
  FROM shift_facts AS sf
  LEFT JOIN first_history AS fh ON sf.job = fh.job
  LEFT JOIN job_transactions AS jt ON sf.job = jt.job
)`;
}

function revenueExpression() {
  return [
    'if(is_successful_confirmed_shift = 1,',
    "  if(contract_type = 'saas',",
    '    worker_shift_amount * (1 + commission_percent / 100) + transaction_amount,',
    '    customer_shift_amount + transaction_amount',
    '  ),',
    '  0',
    ')'
  ].join(' ');
}

function workedShiftsExpression() {
  return "uniqExactIf(job, is_successful_confirmed_shift = 1 AND job != '')";
}

function coveredShiftsExpression() {
  return `uniqExactIf(job, (status IN ${CLOSING_STATUSES_SQL} OR is_successful_confirmed_shift = 1) AND job != '')`;
}

function cancelledShiftsExpression() {
  return "countIf(ifNull(cancellation_reason, '') != '' OR status = 'failed')";
}

function avgWorkerRateHourExpression() {
  return "avgIf(worker_rate_hour, is_successful_confirmed_shift = 1 AND worker_rate_hour IS NOT NULL)";
}

function avgCustomerRateHourExpression() {
  return "avgIf(customer_rate_hour, is_successful_confirmed_shift = 1 AND customer_rate_hour IS NOT NULL)";
}

function paramsForFilters(filters) {
  const params = {
    param_brand_title: filters.brandId,
    param_from: filters.fromDateTime,
    param_to: filters.toExclusiveDateTime
  };

  if (filters.city.length > 0) {
    params.param_cities = serializeStringArray(filters.city);
  }
  if (filters.region.length > 0) {
    params.param_regions = serializeStringArray(filters.region);
  }

  return params;
}

function mergeBrandAnalysisReviews(filters, reviewRows = []) {
  return {
    filters,
    brandId: filters.brandId,
    reviews: reviewRows.map((row) => ({
      reviewId: textValue(row.review_id),
      jobId: textValue(row.job_id),
      workplaceId: textValue(row.workplace_id),
      workplaceTitle: textValue(row.workplace_title) || 'Без точки',
      city: textValue(row.city),
      rating: numberValue(row.rating),
      text: textValue(row.text),
      authorFullName: textValue(row.author_full_name),
      authorPhone: phoneValue(row.author_phone),
      createdAtLocal: textValue(row.created_at_local)
    }))
  };
}

function emptyBrandAnalysisDashboard(filters) {
  return {
    filters,
    brandOptions: [],
    selectedBrandTitle: '',
    filterOptions: emptyFilterOptions(),
    summary: emptySummary(),
    trendRows: [],
    regionRows: [],
    workplaceRows: [],
    professionRows: [],
    statusRows: []
  };
}

function assertBrandAnalysisSection(section) {
  if (BRAND_ANALYSIS_SECTIONS.has(section)) {
    return;
  }

  const error = new Error(`Unknown brand analysis section: ${section}`);

  error.status = 400;
  throw error;
}

async function readThroughCache(cache, key, loader) {
  if (!cache || typeof cache.getOrLoad !== 'function') {
    return loader();
  }

  return cache.getOrLoad(key, loader);
}

function cacheKeyForBrandAnalysisSection(section, filters) {
  return JSON.stringify({
    board: 'brand-analysis',
    section,
    filters: {
      period: filters.period,
      from: filters.from,
      to: filters.to,
      brandId: filters.brandId,
      city: filters.city,
      region: filters.region
    }
  });
}

async function loadBrandOptions(client) {
  const rows = await client.queryJSONEachRow(
    `SELECT
      ${BRAND_TITLE_EXPRESSION} AS brand_title
    FROM mg_clients AS c
    WHERE ifNull(c.deleted, 0) = 0
      AND ifNull(c._id, '') != ''
      AND ${clientNotFakeCondition('c')}
    GROUP BY brand_title
    ORDER BY brand_title
    FORMAT JSONEachRow`,
    {},
    'brand analysis brand options'
  );

  const byTitle = new Map();

  for (const row of rows) {
    const title = String(row.brand_title || 'Без бренда').trim();

    if (title !== '' && !byTitle.has(title)) {
      byTitle.set(title, { id: title, title });
    }
  }

  return Array.from(byTitle.values());
}

function brandFilterOptionsQuery() {
  return `${actualOrdersWithClause({ includeDateFilter: true })}
SELECT
  tupleElement(option, 1) AS filter,
  tupleElement(option, 2) AS value
FROM (
  SELECT
    ifNull(o.city, '') AS city_value,
    ifNull(o.region, '') AS region_value
  FROM actual_orders AS o
)
ARRAY JOIN [
  tuple('city', city_value),
  tuple('region', region_value)
] AS option
WHERE value != ''
GROUP BY filter, value
ORDER BY filter, value
FORMAT JSONEachRow`;
}

async function loadBrandFilterOptions(client, filters) {
  if (filters.brandId === '') {
    return emptyFilterOptions();
  }

  const rows = await client.queryJSONEachRow(
    brandFilterOptionsQuery(),
    paramsForFilters({ ...filters, city: [], region: [] }),
    'brand analysis filter options'
  );

  return filterOptionsFromRows(rows);
}

async function loadBrandAnalysisSectionRows(client, filters, section) {
  assertBrandAnalysisSection(section);

  if (filters.brandId === '') {
    return {};
  }

  const params = paramsForFilters(filters);
  const periodOrders = buildPeriodExpression(filters.period, 'o.start');
  const periodShifts = buildPeriodExpression(filters.period, 'shift_start');
  const revenue = revenueExpression();
  const workedShifts = workedShiftsExpression();
  const coveredShifts = coveredShiftsExpression();
  const cancelledShifts = cancelledShiftsExpression();
  const avgWorkerRateHour = avgWorkerRateHourExpression();
  const avgCustomerRateHour = avgCustomerRateHourExpression();

  if (section === 'summary') {
    const [orderSummaryRows, shiftSummaryRows, reviewSummaryRows] = await Promise.all([
      client.queryJSONEachRow(
        `${actualOrdersWithClause({ includeDateFilter: true }, filters)}
      SELECT
        sum(o.amount) AS ordered_shifts,
        countDistinctIf(o.workplace, o.workplace != '') AS workplaces_with_orders,
        countDistinct(toDate(o.start)) AS active_days
      FROM actual_orders AS o
      FORMAT JSONEachRow`,
        params,
        'brand analysis orders summary'
      ),
      client.queryJSONEachRow(
        `${shiftFactsCte(filters)}
      SELECT
        ${workedShifts} AS worked_shifts,
        ${coveredShifts} AS covered_shifts,
        sum(${revenue}) AS revenue_rub,
        uniqExactIf(worker, is_successful_confirmed_shift = 1 AND worker != '') AS unique_workers,
        uniqExactIf(workplace, is_successful_confirmed_shift = 1 AND workplace != '') AS workplaces_with_worked_shifts,
        ${cancelledShifts} AS cancelled_shifts,
        countIf(is_successful_confirmed_shift = 1 AND is_self_booked = 1) AS self_booked_confirmed_shifts,
        ${avgWorkerRateHour} AS avg_worker_rate_hour,
        ${avgCustomerRateHour} AS avg_customer_rate_hour
      FROM shift_enriched
      FORMAT JSONEachRow`,
        params,
        'brand analysis shifts summary'
      ),
      client.queryJSONEachRow(
        brandReviewSummaryQuery(filters),
        params,
        'brand analysis review summary'
      )
    ]);

    return { orderSummaryRows, shiftSummaryRows, reviewSummaryRows };
  }

  if (section === 'trend') {
    const [orderTrendRows, shiftTrendRows, responseTrendRows] = await Promise.all([
      client.queryJSONEachRow(
        `${actualOrdersWithClause({ includeDateFilter: true }, filters)}
      SELECT
        toDate(o.start) AS period,
        sum(o.amount) AS ordered_shifts
      FROM actual_orders AS o
      GROUP BY period
      ORDER BY period
      FORMAT JSONEachRow`,
        params,
        'brand analysis orders trend'
      ),
      client.queryJSONEachRow(
        `${shiftFactsCte(filters)}
      SELECT
        toDate(shift_start) AS period,
        ${workedShifts} AS worked_shifts,
        ${coveredShifts} AS covered_shifts,
        sum(${revenue}) AS revenue_rub,
        ${cancelledShifts} AS cancelled_shifts,
        groupUniqArrayIf(ifNull(worker_profile.user, ''), is_successful_confirmed_shift = 1 AND ifNull(worker_profile.user, '') != '') AS worked_user_ids
      FROM shift_enriched
      LEFT JOIN mg_workers AS worker_profile ON worker_profile._id = worker
      GROUP BY period
      ORDER BY period
      FORMAT JSONEachRow`,
        params,
        'brand analysis shifts trend'
      ),
      client.queryJSONEachRow(
        `${actualOrdersWithClause({}, filters)}
      SELECT
        toDate(h.createdAt) AS period,
        groupUniqArrayIf(ifNull(worker_profile.user, ''), ifNull(worker_profile.user, '') != '') AS responded_user_ids
      FROM mg_job_history AS h
      INNER JOIN mg_jobs AS j ON h.job = j._id
      INNER JOIN actual_orders AS ao ON j.source = ao.order_id
      LEFT JOIN mg_workers AS worker_profile
        ON coalesce(nullIf(ifNull(h.worker, ''), ''), nullIf(ifNull(j.worker, ''), ''), '') = worker_profile._id
      WHERE ifNull(h.status, '') = 'booked'
        AND h.createdAt >= {from:DateTime}
        AND h.createdAt < {to:DateTime}
      GROUP BY period
      ORDER BY period
      FORMAT JSONEachRow`,
        params,
        'brand analysis responses trend'
      )
    ]);

    return { orderTrendRows, shiftTrendRows, responseTrendRows };
  }

  if (section === 'workplaces') {
    const [workplaceOrderRows, workplaceShiftRows] = await Promise.all([
      client.queryJSONEachRow(
        `${actualOrdersWithClause({ includeDateFilter: true }, filters)}
      SELECT
        o.workplace AS workplace_id,
        any(o.workplace_title) AS workplace_title,
        any(o.city) AS city,
        sum(o.amount) AS ordered_shifts,
        countDistinct(toDate(o.start)) AS active_days
      FROM actual_orders AS o
      GROUP BY workplace_id
      ORDER BY ordered_shifts DESC
      LIMIT 100
      FORMAT JSONEachRow`,
        params,
        'brand analysis workplace orders'
      ),
      client.queryJSONEachRow(
        `${shiftFactsCte(filters)}
      SELECT
        workplace AS workplace_id,
        ${workedShifts} AS worked_shifts,
        ${coveredShifts} AS covered_shifts,
        sum(${revenue}) AS revenue_rub,
        uniqExactIf(worker, is_successful_confirmed_shift = 1 AND worker != '') AS unique_workers,
        ${cancelledShifts} AS cancelled_shifts
      FROM shift_enriched
      GROUP BY workplace_id
      ORDER BY worked_shifts DESC
      LIMIT 100
      FORMAT JSONEachRow`,
        params,
        'brand analysis workplace shifts'
      )
    ]);

    return { workplaceOrderRows, workplaceShiftRows };
  }

  if (section === 'regions') {
    const [regionOrderRows, regionShiftRows, regionOrderTrendRows] = await Promise.all([
      client.queryJSONEachRow(
        `${actualOrdersWithClause({ includeDateFilter: true }, filters)}
      SELECT
        ifNull(nullIf(o.region, ''), 'Без региона') AS region,
        sum(o.amount) AS ordered_shifts,
        uniqExactIf(o.workplace, o.workplace != '') AS workplaces
      FROM actual_orders AS o
      GROUP BY region
      ORDER BY ordered_shifts DESC, region
      FORMAT JSONEachRow`,
        params,
        'brand analysis region orders'
      ),
      client.queryJSONEachRow(
        `${shiftFactsCte(filters)}
      SELECT
        ifNull(nullIf(region, ''), 'Без региона') AS region,
        ${workedShifts} AS worked_shifts,
        ${coveredShifts} AS covered_shifts
      FROM shift_enriched
      GROUP BY region
      ORDER BY worked_shifts DESC, region
      FORMAT JSONEachRow`,
        params,
        'brand analysis region shifts'
      ),
      client.queryJSONEachRow(
        `${actualOrdersWithClause({ includeDateFilter: true }, filters)}
      SELECT
        ifNull(nullIf(o.region, ''), 'Без региона') AS region,
        ${periodOrders} AS period,
        sum(o.amount) AS ordered_shifts
      FROM actual_orders AS o
      GROUP BY region, period
      ORDER BY region, period
      FORMAT JSONEachRow`,
        params,
        'brand analysis region order trend'
      )
    ]);

    return { regionOrderRows, regionShiftRows, regionOrderTrendRows };
  }

  if (section === 'professions') {
    const [professionOrderRows, professionShiftRows] = await Promise.all([
      client.queryJSONEachRow(
        `${actualOrdersWithClause({ includeDateFilter: true }, filters)}
      SELECT
        ifNull(nullIf(o.profession, ''), 'Без специальности') AS profession,
        sum(o.amount) AS ordered_shifts
      FROM actual_orders AS o
      GROUP BY profession
      ORDER BY ordered_shifts DESC
      FORMAT JSONEachRow`,
        params,
        'brand analysis profession orders'
      ),
      client.queryJSONEachRow(
        `${shiftFactsCte(filters)}
      SELECT
        ifNull(nullIf(profession, ''), 'Без специальности') AS profession,
        ${workedShifts} AS worked_shifts,
        sum(${revenue}) AS revenue_rub,
        ${cancelledShifts} AS cancelled_shifts
      FROM shift_enriched
      GROUP BY profession
      ORDER BY worked_shifts DESC
      FORMAT JSONEachRow`,
        params,
        'brand analysis profession shifts'
      )
    ]);

    return { professionOrderRows, professionShiftRows };
  }

  const statusRows = await client.queryJSONEachRow(
    `${shiftFactsOnlyCte(filters)}
      SELECT
        if(status = '', 'empty', status) AS status,
        count() AS shifts
      FROM shift_facts
      GROUP BY status
      ORDER BY shifts DESC
      FORMAT JSONEachRow`,
    params,
    'brand analysis status breakdown'
  );

  return { statusRows };
}

function mergeBrandAnalysisSection(filters, section, rows) {
  const dashboard = emptyBrandAnalysisDashboard(filters);

  if (section === 'summary') {
    return {
      ...dashboard,
      summary: mapSummaryRows(
        rows.orderSummaryRows || [],
        rows.shiftSummaryRows || [],
        rows.reviewSummaryRows || [],
        filters
      )
    };
  }

  if (section === 'trend') {
    return {
      ...dashboard,
      trendRows: mergeTrendRows(rows.orderTrendRows || [], rows.shiftTrendRows || [], rows.responseTrendRows || [])
    };
  }

  if (section === 'workplaces') {
    return {
      ...dashboard,
      workplaceRows: mergeWorkplaceRows(rows.workplaceOrderRows || [], rows.workplaceShiftRows || [])
    };
  }

  if (section === 'regions') {
    return {
      ...dashboard,
      regionRows: mergeRegionRows(rows.regionOrderRows || [], rows.regionShiftRows || [], rows.regionOrderTrendRows || [])
    };
  }

  if (section === 'professions') {
    return {
      ...dashboard,
      professionRows: mergeProfessionRows(rows.professionOrderRows || [], rows.professionShiftRows || [])
    };
  }

  return {
    ...dashboard,
    statusRows: mapStatusRows(rows.statusRows || [])
  };
}

async function loadBrandAnalysisDashboardShell(client, input = {}, now = new Date()) {
  const filters = normalizeBrandAnalysisFilters(input, now);
  const brandOptions = await loadBrandOptions(client);
  const selected = brandOptions.find((brand) => brand.id === filters.brandId);
  const filterOptions = selected ? await loadBrandFilterOptions(client, filters) : emptyFilterOptions();

  return {
    ...emptyBrandAnalysisDashboard(filters),
    brandOptions,
    selectedBrandTitle: selected ? selected.title : '',
    filterOptions
  };
}

async function loadBrandAnalysisDashboardSection(
  client,
  input = {},
  section,
  now = new Date(),
  options = {}
) {
  assertBrandAnalysisSection(section);

  const filters = normalizeBrandAnalysisFilters(input, now);

  if (filters.brandId === '') {
    return emptyBrandAnalysisDashboard(filters);
  }

  const rows = await readThroughCache(
    options.cache,
    cacheKeyForBrandAnalysisSection(section, filters),
    () => loadBrandAnalysisSectionRows(client, filters, section)
  );

  return mergeBrandAnalysisSection(filters, section, rows);
}

async function loadBrandAnalysisDashboard(client, input = {}, now = new Date()) {
  const shell = await loadBrandAnalysisDashboardShell(client, input, now);

  if (shell.filters.brandId === '') {
    return shell;
  }

  const [summaryRows, trendRows, regionRows, workplaceRows, professionRows, statusRows] = await Promise.all(
    BRAND_ANALYSIS_SECTION_NAMES.map((section) =>
      loadBrandAnalysisSectionRows(client, shell.filters, section)
    )
  );

  return {
    ...shell,
    summary: mapSummaryRows(
      summaryRows.orderSummaryRows,
      summaryRows.shiftSummaryRows,
      summaryRows.reviewSummaryRows,
      shell.filters
    ),
    trendRows: mergeTrendRows(trendRows.orderTrendRows, trendRows.shiftTrendRows, trendRows.responseTrendRows),
    regionRows: mergeRegionRows(regionRows.regionOrderRows, regionRows.regionShiftRows, regionRows.regionOrderTrendRows),
    workplaceRows: mergeWorkplaceRows(workplaceRows.workplaceOrderRows, workplaceRows.workplaceShiftRows),
    professionRows: mergeProfessionRows(professionRows.professionOrderRows, professionRows.professionShiftRows),
    statusRows: mapStatusRows(statusRows.statusRows)
  };
}

function reviewAuthorFullNameExpression() {
  return `coalesce(
      nullIf(trim(concat(ifNull(wu.lastname, ''), ' ', ifNull(wu.firstname, ''), ' ', ifNull(wu.middlename, ''))), ''),
      nullIf(trim(ifNull(w.full_name, '')), ''),
      ''
    )`;
}

function brandReviewSummaryQuery(filters = null) {
  return `${actualOrdersWithClause({}, filters)}
SELECT
  count() AS review_count,
  avgOrNull(r.rating) AS avg_rating_all,
  (
    SELECT avgOrNull(rating)
    FROM (
      SELECT r2.rating AS rating
      FROM mg_reviews AS r2
      INNER JOIN mg_jobs AS j2 ON r2.job = j2._id
      INNER JOIN actual_orders AS ao2 ON j2.source = ao2.order_id
      WHERE ifNull(r2.rating, 0) > 0
      ORDER BY r2.createdAt DESC, r2._id DESC
      LIMIT 10
    )
  ) AS avg_rating_last_10
FROM mg_reviews AS r
INNER JOIN mg_jobs AS j ON r.job = j._id
INNER JOIN actual_orders AS ao ON j.source = ao.order_id
WHERE ifNull(r.rating, 0) > 0
FORMAT JSONEachRow`;
}

function brandReviewsQuery(filters = null) {
  return `${actualOrdersWithClause({}, filters)}
SELECT
  r._id AS review_id,
  r.job AS job_id,
  ao.workplace AS workplace_id,
  ao.workplace_title AS workplace_title,
  ao.city AS city,
  r.rating AS rating,
  ifNull(r.text, '') AS text,
  ${reviewAuthorFullNameExpression()} AS author_full_name,
  ifNull(wu.phone, '') AS author_phone,
  ifNull(formatDateTime(toTimeZone(r.createdAt, 'Europe/Moscow'), '%F %T'), '') AS created_at_local
FROM mg_reviews AS r
INNER JOIN mg_jobs AS j ON r.job = j._id
INNER JOIN actual_orders AS ao ON j.source = ao.order_id
LEFT JOIN mg_workers AS w ON coalesce(nullIf(ifNull(r.worker, ''), ''), nullIf(ifNull(j.worker, ''), ''), '') = w._id
LEFT JOIN mg_users AS wu ON w.user = wu._id
ORDER BY r.createdAt DESC, r._id DESC
FORMAT JSONEachRow`;
}

async function loadBrandAnalysisReviews(client, input = {}, now = new Date()) {
  const filters = normalizeBrandAnalysisFilters(input, now);

  if (filters.brandId === '') {
    const error = new Error('Missing brandId');

    error.status = 400;
    throw error;
  }

  const reviewRows = await client.queryJSONEachRow(
    brandReviewsQuery(filters),
    paramsForFilters(filters),
    'brand analysis reviews'
  );

  return mergeBrandAnalysisReviews(filters, reviewRows);
}

module.exports = {
  BRAND_ANALYSIS_SECTIONS,
  buildPeriodExpression,
  loadBrandAnalysisReviews,
  loadBrandAnalysisDashboard,
  loadBrandAnalysisDashboardSection,
  loadBrandAnalysisDashboardShell,
  normalizeBrandAnalysisFilters
};
