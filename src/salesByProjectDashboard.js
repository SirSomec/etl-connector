const { successfulConfirmedShiftFlagExpression } = require('./successfulConfirmedShift');
const {
  actualOrderDomainCondition,
  actualOrderJoinsSql
} = require('./analyticsDomainSql');

const PERIOD_EXPRESSIONS = {
  day: (field) => `toDate(${field})`,
  week: (field) => `toStartOfWeek(${field})`,
  month: (field) => `toStartOfMonth(${field})`,
  quarter: (field) => `toStartOfQuarter(${field})`
};

const DEFAULT_PERIOD = 'month';
const DEFAULT_LOOKBACK_DAYS = 90;
const MAX_BRAND_ROWS = 50;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SALES_BY_PROJECT_SECTION_NAMES = ['summary', 'trend', 'brands', 'statuses'];
const SALES_BY_PROJECT_SECTIONS = new Set(SALES_BY_PROJECT_SECTION_NAMES);

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

function normalizeSalesByProjectFilters(input = {}, now = new Date()) {
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

  const toExclusive = formatDateUTC(addDaysUTC(parseDateOnly(to), 1));

  return {
    period,
    from,
    to,
    fromDateTime: toDateTimeParam(from),
    toExclusiveDateTime: toDateTimeParam(toExclusive)
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

function hasNumericValue(value) {
  return value !== null && value !== undefined && value !== '';
}

function firstNumberValue(...values) {
  for (const value of values) {
    if (hasNumericValue(value)) {
      return numberValue(value);
    }
  }

  return 0;
}

function percent(numerator, denominator) {
  const bottom = numberValue(denominator);

  if (bottom <= 0) {
    return 0;
  }

  return (numberValue(numerator) / bottom) * 100;
}

function mapSummaryRows(orderRows, shiftRows) {
  const orders = orderRows[0] || {};
  const shifts = shiftRows[0] || {};
  const orderedShifts = numberValue(orders.ordered_shifts);
  const workedShifts = numberValue(shifts.worked_shifts);

  return {
    orderedShifts,
    workedShifts,
    slaPercent: percent(workedShifts, orderedShifts),
    revenueRub: numberValue(shifts.revenue_rub),
    uniqueWorkers: numberValue(shifts.unique_workers),
    workplacesWithOrders: numberValue(orders.workplaces_with_orders),
    workplacesWithWorkedShifts: numberValue(shifts.workplaces_with_worked_shifts),
    cancelledShifts: numberValue(shifts.cancelled_shifts),
    selfBookingPercent: percent(shifts.self_booked_confirmed_shifts, workedShifts),
    avgWorkerRateHour: firstNumberValue(shifts.avg_worker_rate_hour)
  };
}

function emptyTrendRow(period) {
  return {
    period,
    orderedShifts: 0,
    workedShifts: 0,
    slaPercent: 0,
    revenueRub: 0,
    cancelledShifts: 0
  };
}

function mergeTrendRows(orderRows, shiftRows) {
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
    current.revenueRub = numberValue(row.revenue_rub);
    current.cancelledShifts = numberValue(row.cancelled_shifts);
    current.slaPercent = percent(current.workedShifts, current.orderedShifts);
    byPeriod.set(period, current);
  }

  return Array.from(byPeriod.values()).sort((left, right) => left.period.localeCompare(right.period));
}

function emptyBrandRow(brand) {
  return {
    brand,
    orderedShifts: 0,
    workedShifts: 0,
    slaPercent: 0,
    revenueRub: 0,
    uniqueWorkers: 0,
    workplacesWithOrders: 0,
    workplacesWithWorkedShifts: 0,
    cancelledShifts: 0,
    selfBookingPercent: 0,
    avgWorkerRateHour: 0
  };
}

function mergeBrandRows(orderRows, shiftRows) {
  const byBrand = new Map();

  for (const row of orderRows) {
    const brand = String(row.brand || 'Без бренда');

    byBrand.set(brand, {
      ...emptyBrandRow(brand),
      orderedShifts: numberValue(row.ordered_shifts),
      workplacesWithOrders: numberValue(row.workplaces_with_orders),
      avgWorkerRateHour: numberValue(row.avg_worker_rate_hour)
    });
  }

  for (const row of shiftRows) {
    const brand = String(row.brand || 'Без бренда');
    const current = byBrand.get(brand) || emptyBrandRow(brand);

    current.workedShifts = numberValue(row.worked_shifts);
    current.revenueRub = numberValue(row.revenue_rub);
    current.uniqueWorkers = numberValue(row.unique_workers);
    current.workplacesWithWorkedShifts = numberValue(row.workplaces_with_worked_shifts);
    current.cancelledShifts = numberValue(row.cancelled_shifts);
    current.slaPercent = percent(current.workedShifts, current.orderedShifts);
    current.selfBookingPercent = percent(row.self_booked_confirmed_shifts, current.workedShifts);
    current.avgWorkerRateHour = firstNumberValue(row.avg_worker_rate_hour);
    byBrand.set(brand, current);
  }

  return Array.from(byBrand.values())
    .sort((left, right) => {
      const leftActivity = left.orderedShifts + left.workedShifts;
      const rightActivity = right.orderedShifts + right.workedShifts;

      if (rightActivity !== leftActivity) {
        return rightActivity - leftActivity;
      }

      if (right.revenueRub !== left.revenueRub) {
        return right.revenueRub - left.revenueRub;
      }

      return left.brand.localeCompare(right.brand);
    })
    .slice(0, MAX_BRAND_ROWS);
}

function mapStatusRows(rows) {
  return rows.map((row) => ({
    status: String(row.status || 'empty'),
    shifts: numberValue(row.shifts)
  }));
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

function actualOrdersCte({ includeDateFilter = false } = {}) {
  const where = [actualOrderDomainCondition('o', 'c', 'ct')];

  if (includeDateFilter) {
    where.push('o.start >= {from:DateTime}', 'o.start < {to:DateTime}');
  }

  return `actual_orders AS (
  SELECT
    o._id AS order_id,
    o.start AS start,
    o.client AS client,
    o.workplace AS workplace,
    ifNull(o.amount, 0) AS amount,
    ifNull(nullIf(c.title, ''), 'Без бренда') AS brand,
    o.pieceworks AS pieceworks,
    ifNull(o.contract_type, '') AS order_contract_type,
    ifNull(ct.contract_type, '') AS contractor_contract_type,
    ifNull(ct.comission, 0) AS commission_percent
  FROM mg_orders AS o
  ${actualOrderJoinsSql('o', { clientAlias: 'c', contractorAlias: 'ct' })}
  WHERE ${where.join('\n    AND ')}
)`;
}

function actualOrdersWithClause(options) {
  return `WITH ${actualOrdersCte(options)}`;
}

function shiftFactsOnlyCte() {
  return `
WITH ${actualOrdersCte()},
shift_facts AS (
  SELECT
    j._id AS job,
    j.start AS shift_start,
    ifNull(j.status, '') AS status,
    coalesce(nullIf(j.client, ''), ao.client) AS client,
    coalesce(nullIf(j.workplace, ''), ao.workplace) AS workplace,
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
    ao.commission_percent AS commission_percent,
    ao.brand AS brand
  FROM mg_jobs AS j
  INNER JOIN actual_orders AS ao ON j.source = ao.order_id
  WHERE ifNull(j._id, '') != ''
    AND ifNull(j.deleted, 0) = 0
    AND j.start >= {from:DateTime}
    AND j.start < {to:DateTime}
)`;
}

function shiftFactsCte() {
  return `${shiftFactsOnlyCte()},
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
    sf.salary_per_hour AS salary_per_hour,
    sf.hours AS hours,
    sf.payment AS payment,
    sf.start_fact AS start_fact,
    sf.finish_fact AS finish_fact,
    sf.piecework AS piecework,
    sf.client AS client,
    sf.workplace AS workplace,
    sf.brand AS brand,
    if(ifNull(fh.first_initiator, '') = 'worker', 1, 0) AS is_self_booked,
    ifNull(nullIf(sf.order_contract_type, ''), ifNull(nullIf(sf.contractor_contract_type, ''), 'services')) AS contract_type,
    sf.commission_percent AS commission_percent,
    if(${positiveOrZeroNumberExpression('sf', 'salary_per_job')} > 0, ${positiveOrZeroNumberExpression('sf', 'salary_per_job')}, ${positiveOrZeroNumberExpression('sf', 'salary_per_hour')} * ${positiveOrZeroNumberExpression('sf', 'hours')}) AS worker_shift_amount,
    if(${positiveOrZeroNumberExpression('sf', 'payment_per_job')} > 0, ${positiveOrZeroNumberExpression('sf', 'payment_per_job')}, ${positiveOrZeroNumberExpression('sf', 'payment_per_hour')} * ${positiveOrZeroNumberExpression('sf', 'hours')}) AS customer_shift_amount,
    ifNull(jt.transaction_amount, 0) AS transaction_amount,
    ${nullablePositiveNumberExpression('sf', 'salary_per_hour')} AS worker_rate_hour,
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

function cancelledShiftsExpression() {
  return "countIf(ifNull(cancellation_reason, '') != '' OR status = 'failed')";
}

function avgWorkerRateHourExpression() {
  return "avgIf(worker_rate_hour, is_successful_confirmed_shift = 1 AND worker_rate_hour IS NOT NULL)";
}

function paramsForFilters(filters) {
  return {
    param_from: filters.fromDateTime,
    param_to: filters.toExclusiveDateTime,
    param_from_string: filters.fromDateTime,
    param_to_string: filters.toExclusiveDateTime
  };
}

function emptySalesByProjectDashboard(filters) {
  return {
    filters,
    summary: mapSummaryRows([], []),
    trendRows: [],
    brandRows: [],
    statusRows: []
  };
}

function assertSalesByProjectSection(section) {
  if (SALES_BY_PROJECT_SECTIONS.has(section)) {
    return;
  }

  const error = new Error(`Unknown sales by project section: ${section}`);

  error.status = 400;
  throw error;
}

async function readThroughCache(cache, key, loader) {
  if (!cache || typeof cache.getOrLoad !== 'function') {
    return loader();
  }

  return cache.getOrLoad(key, loader);
}

function cacheKeyForSalesByProjectSection(section, filters) {
  return JSON.stringify({
    board: 'sales-by-project',
    section,
    filters: {
      period: filters.period,
      from: filters.from,
      to: filters.to
    }
  });
}

async function loadSalesByProjectSectionRows(client, filters, section) {
  assertSalesByProjectSection(section);

  const periodOrders = buildPeriodExpression(filters.period, 'o.start');
  const periodShifts = buildPeriodExpression(filters.period, 'shift_start');
  const params = paramsForFilters(filters);
  const revenue = revenueExpression();
  const workedShifts = workedShiftsExpression();
  const cancelledShifts = cancelledShiftsExpression();
  const avgWorkerRateHour = avgWorkerRateHourExpression();

  if (section === 'summary') {
    const [orderSummaryRows, shiftSummaryRows] = await Promise.all([
      client.queryJSONEachRow(
        `${actualOrdersWithClause({ includeDateFilter: true })}
      SELECT
        sum(o.amount) AS ordered_shifts,
        countDistinctIf(o.workplace, o.workplace != '') AS workplaces_with_orders
      FROM actual_orders AS o
      FORMAT JSONEachRow`,
        params,
        'sales by project orders summary'
      ),
      client.queryJSONEachRow(
        `${shiftFactsCte()}
      SELECT
        ${workedShifts} AS worked_shifts,
        sum(${revenue}) AS revenue_rub,
        uniqExactIf(worker, is_successful_confirmed_shift = 1 AND worker != '') AS unique_workers,
        uniqExactIf(workplace, is_successful_confirmed_shift = 1 AND workplace != '') AS workplaces_with_worked_shifts,
        ${cancelledShifts} AS cancelled_shifts,
        countIf(is_successful_confirmed_shift = 1 AND is_self_booked = 1) AS self_booked_confirmed_shifts,
        ${avgWorkerRateHour} AS avg_worker_rate_hour
      FROM shift_enriched
      FORMAT JSONEachRow`,
        params,
        'sales by project shifts summary'
      )
    ]);

    return { orderSummaryRows, shiftSummaryRows };
  }

  if (section === 'trend') {
    const [orderTrendRows, shiftTrendRows] = await Promise.all([
      client.queryJSONEachRow(
        `${actualOrdersWithClause({ includeDateFilter: true })}
      SELECT
        ${periodOrders} AS period,
        sum(o.amount) AS ordered_shifts
      FROM actual_orders AS o
      GROUP BY period
      ORDER BY period
      FORMAT JSONEachRow`,
        params,
        'sales by project orders trend'
      ),
      client.queryJSONEachRow(
        `${shiftFactsCte()}
      SELECT
        ${periodShifts} AS period,
        ${workedShifts} AS worked_shifts,
        sum(${revenue}) AS revenue_rub,
        ${cancelledShifts} AS cancelled_shifts
      FROM shift_enriched
      GROUP BY period
      ORDER BY period
      FORMAT JSONEachRow`,
        params,
        'sales by project shifts trend'
      )
    ]);

    return { orderTrendRows, shiftTrendRows };
  }

  if (section === 'brands') {
    const [brandOrderRows, brandShiftRows] = await Promise.all([
      client.queryJSONEachRow(
        `${actualOrdersWithClause({ includeDateFilter: true })}
      SELECT
        o.brand AS brand,
        sum(o.amount) AS ordered_shifts,
        countDistinctIf(o.workplace, o.workplace != '') AS workplaces_with_orders
      FROM actual_orders AS o
      GROUP BY brand
      ORDER BY ordered_shifts DESC
      FORMAT JSONEachRow`,
        params,
        'sales by project brand orders'
      ),
      client.queryJSONEachRow(
        `${shiftFactsCte()}
      SELECT
        ifNull(nullIf(brand, ''), 'Без бренда') AS brand,
        ${workedShifts} AS worked_shifts,
        sum(${revenue}) AS revenue_rub,
        uniqExactIf(worker, is_successful_confirmed_shift = 1 AND worker != '') AS unique_workers,
        uniqExactIf(workplace, is_successful_confirmed_shift = 1 AND workplace != '') AS workplaces_with_worked_shifts,
        ${cancelledShifts} AS cancelled_shifts,
        countIf(is_successful_confirmed_shift = 1 AND is_self_booked = 1) AS self_booked_confirmed_shifts,
        ${avgWorkerRateHour} AS avg_worker_rate_hour
      FROM shift_enriched
      GROUP BY brand
      ORDER BY worked_shifts DESC
      FORMAT JSONEachRow`,
        params,
        'sales by project brand shifts'
      )
    ]);

    return { brandOrderRows, brandShiftRows };
  }

  const statusRows = await client.queryJSONEachRow(
    `${shiftFactsOnlyCte()}
      SELECT
        if(status = '', 'empty', status) AS status,
        count() AS shifts
      FROM shift_facts
      GROUP BY status
      ORDER BY shifts DESC
      FORMAT JSONEachRow`,
    params,
    'sales by project status breakdown'
  );

  return { statusRows };
}

function mergeSalesByProjectSection(filters, section, rows) {
  const dashboard = emptySalesByProjectDashboard(filters);

  if (section === 'summary') {
    return {
      ...dashboard,
      summary: mapSummaryRows(rows.orderSummaryRows || [], rows.shiftSummaryRows || [])
    };
  }

  if (section === 'trend') {
    return {
      ...dashboard,
      trendRows: mergeTrendRows(rows.orderTrendRows || [], rows.shiftTrendRows || [])
    };
  }

  if (section === 'brands') {
    return {
      ...dashboard,
      brandRows: mergeBrandRows(rows.brandOrderRows || [], rows.brandShiftRows || [])
    };
  }

  return {
    ...dashboard,
    statusRows: mapStatusRows(rows.statusRows || [])
  };
}

async function loadSalesByProjectDashboardShell(client, input = {}, now = new Date()) {
  const filters = normalizeSalesByProjectFilters(input, now);

  return emptySalesByProjectDashboard(filters);
}

async function loadSalesByProjectDashboardSection(
  client,
  input = {},
  section,
  now = new Date(),
  options = {}
) {
  assertSalesByProjectSection(section);

  const filters = normalizeSalesByProjectFilters(input, now);
  const preloadReader = options.preloadService && options.preloadService.readSalesByProjectSectionRows;

  if (typeof preloadReader === 'function') {
    try {
      const preloadRows = await preloadReader.call(options.preloadService, {
        section,
        period: filters.period,
        fromDate: filters.from,
        toDate: filters.toExclusiveDateTime.slice(0, 10)
      });

      if (preloadRows) {
        return {
          ...mergeSalesByProjectSection(filters, section, preloadRows),
          dataSource: 'preload'
        };
      }
    } catch {
      // Fall back to live ClickHouse data when the preload store is unavailable.
    }
  }

  const rows = await readThroughCache(
    options.cache,
    cacheKeyForSalesByProjectSection(section, filters),
    () => loadSalesByProjectSectionRows(client, filters, section)
  );

  const dashboard = mergeSalesByProjectSection(filters, section, rows);

  if (typeof preloadReader === 'function') {
    return {
      ...dashboard,
      dataSource: 'clickhouse'
    };
  }

  return dashboard;
}

async function loadSalesByProjectDashboard(client, input = {}, now = new Date()) {
  const filters = normalizeSalesByProjectFilters(input, now);
  const [summaryRows, trendRows, brandRows, statusRows] = await Promise.all(
    SALES_BY_PROJECT_SECTION_NAMES.map((section) =>
      loadSalesByProjectSectionRows(client, filters, section)
    )
  );

  return {
    filters,
    summary: mapSummaryRows(summaryRows.orderSummaryRows, summaryRows.shiftSummaryRows),
    trendRows: mergeTrendRows(trendRows.orderTrendRows, trendRows.shiftTrendRows),
    brandRows: mergeBrandRows(brandRows.brandOrderRows, brandRows.brandShiftRows),
    statusRows: mapStatusRows(statusRows.statusRows)
  };
}

module.exports = {
  SALES_BY_PROJECT_SECTIONS,
  buildPeriodExpression,
  loadSalesByProjectDashboard,
  loadSalesByProjectDashboardSection,
  loadSalesByProjectDashboardShell,
  normalizeSalesByProjectFilters
};
