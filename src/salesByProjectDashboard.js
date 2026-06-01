const PERIOD_EXPRESSIONS = {
  day: (field) => `toDate(${field})`,
  week: (field) => `toStartOfWeek(${field})`,
  month: (field) => `toStartOfMonth(${field})`,
  quarter: (field) => `toStartOfQuarter(${field})`
};

const DEFAULT_PERIOD = 'month';
const DEFAULT_LOOKBACK_DAYS = 90;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
    avgWorkerRateHour: numberValue(orders.avg_worker_rate_hour)
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
    byBrand.set(brand, current);
  }

  return Array.from(byBrand.values()).sort((left, right) => right.orderedShifts - left.orderedShifts);
}

function mapStatusRows(rows) {
  return rows.map((row) => ({
    status: String(row.status || 'empty'),
    shifts: numberValue(row.shifts)
  }));
}

function orderBaseWhere() {
  return ['o.deleted = 0', 'o.start >= {from:DateTime}', 'o.start < {to:DateTime}'].join(' AND ');
}

function shiftFactsCte() {
  return `
WITH shift_facts AS (
  SELECT
    job,
    min(parseDateTimeBestEffortOrNull(start)) AS shift_start,
    coalesce(argMaxIf(status, coalesce(updatedAt, createdAt, toDateTime64('1970-01-01 00:00:00', 3, 'UTC')), ifNull(status, '') != ''), '') AS status,
    argMaxIf(client, coalesce(updatedAt, createdAt, toDateTime64('1970-01-01 00:00:00', 3, 'UTC')), ifNull(client, '') != '') AS client,
    argMaxIf(workplace, coalesce(updatedAt, createdAt, toDateTime64('1970-01-01 00:00:00', 3, 'UTC')), ifNull(workplace, '') != '') AS workplace,
    argMaxIf(worker, coalesce(updatedAt, createdAt, toDateTime64('1970-01-01 00:00:00', 3, 'UTC')), ifNull(worker, '') != '') AS worker,
    argMaxIf(source, coalesce(updatedAt, createdAt, toDateTime64('1970-01-01 00:00:00', 3, 'UTC')), ifNull(source, '') != '') AS source,
    argMax(salary_per_hour, coalesce(updatedAt, createdAt, toDateTime64('1970-01-01 00:00:00', 3, 'UTC'))) AS salary_per_hour,
    argMax(salary_per_job, coalesce(updatedAt, createdAt, toDateTime64('1970-01-01 00:00:00', 3, 'UTC'))) AS salary_per_job,
    argMax(payment_per_hour, coalesce(updatedAt, createdAt, toDateTime64('1970-01-01 00:00:00', 3, 'UTC'))) AS payment_per_hour,
    argMax(payment_per_job, coalesce(updatedAt, createdAt, toDateTime64('1970-01-01 00:00:00', 3, 'UTC'))) AS payment_per_job,
    argMax(hours, coalesce(updatedAt, createdAt, toDateTime64('1970-01-01 00:00:00', 3, 'UTC'))) AS hours,
    max(if(status = 'booked' AND initiator = 'worker', 1, 0)) AS is_self_booked
  FROM mg_job_history
  WHERE job != ''
    AND parseDateTimeBestEffortOrNull(start) >= {from:DateTime}
    AND parseDateTimeBestEffortOrNull(start) < {to:DateTime}
  GROUP BY job
),
surcharges AS (
  SELECT
    entityId AS job,
    sum(coalesce(nullIf(payment_amount, 0), amount, 0)) AS surcharge_amount
  FROM mg_transactions
  WHERE transaction_type = 'surcharge'
    AND entityId != ''
  GROUP BY entityId
),
shift_enriched AS (
  SELECT
    sf.job AS job,
    sf.shift_start AS shift_start,
    sf.status AS status,
    sf.worker AS worker,
    coalesce(nullIf(sf.client, ''), o.client) AS client,
    coalesce(nullIf(sf.workplace, ''), o.workplace) AS workplace,
    sf.is_self_booked AS is_self_booked,
    ifNull(nullIf(ct.contract_type, ''), 'services') AS contract_type,
    ifNull(ct.comission, 0) AS commission_percent,
    if(ifNull(sf.salary_per_job, 0) > 0, ifNull(sf.salary_per_job, 0), ifNull(sf.salary_per_hour, 0) * ifNull(sf.hours, 0)) AS worker_shift_amount,
    if(ifNull(sf.payment_per_job, 0) > 0, ifNull(sf.payment_per_job, 0), ifNull(sf.payment_per_hour, 0) * ifNull(sf.hours, 0)) AS customer_shift_amount,
    ifNull(s.surcharge_amount, 0) AS surcharge_amount
  FROM shift_facts AS sf
  LEFT JOIN mg_orders AS o ON sf.source = o._id
  LEFT JOIN mg_workplaces AS w ON coalesce(nullIf(sf.workplace, ''), o.workplace) = w._id
  LEFT JOIN mg_contractors AS ct ON w.contractor = ct._id
  LEFT JOIN surcharges AS s ON sf.job = s.job
)`;
}

function revenueExpression() {
  return [
    "if(status = 'confirmed',",
    "  if(contract_type = 'saas',",
    '    worker_shift_amount * (1 + commission_percent / 100) + surcharge_amount,',
    '    customer_shift_amount + surcharge_amount',
    '  ),',
    '  0',
    ')'
  ].join(' ');
}

function paramsForFilters(filters) {
  return {
    param_from: filters.fromDateTime,
    param_to: filters.toExclusiveDateTime
  };
}

async function loadSalesByProjectDashboard(client, input = {}, now = new Date()) {
  const filters = normalizeSalesByProjectFilters(input, now);
  const periodOrders = buildPeriodExpression(filters.period, 'o.start');
  const periodShifts = buildPeriodExpression(filters.period, 'shift_start');
  const params = paramsForFilters(filters);
  const revenue = revenueExpression();

  const [
    orderSummaryRows,
    shiftSummaryRows,
    orderTrendRows,
    shiftTrendRows,
    brandOrderRows,
    brandShiftRows,
    statusRows
  ] = await Promise.all([
    client.queryJSONEachRow(
      `SELECT
        sum(o.amount) AS ordered_shifts,
        countDistinctIf(o.workplace, o.amount > 0) AS workplaces_with_orders,
        avgIf(o.salary_per_hour, o.salary_per_hour > 0) AS avg_worker_rate_hour
      FROM mg_orders AS o
      WHERE ${orderBaseWhere()}
      FORMAT JSONEachRow`,
      params,
      'sales by project orders summary'
    ),
    client.queryJSONEachRow(
      `${shiftFactsCte()}
      SELECT
        countIf(status = 'confirmed') AS worked_shifts,
        sum(${revenue}) AS revenue_rub,
        countDistinctIf(worker, status = 'confirmed' AND worker != '') AS unique_workers,
        countDistinctIf(workplace, status = 'confirmed' AND workplace != '') AS workplaces_with_worked_shifts,
        countIf(status = 'cancelled') AS cancelled_shifts,
        countIf(status = 'confirmed' AND is_self_booked = 1) AS self_booked_confirmed_shifts
      FROM shift_enriched
      FORMAT JSONEachRow`,
      params,
      'sales by project shifts summary'
    ),
    client.queryJSONEachRow(
      `SELECT
        ${periodOrders} AS period,
        sum(o.amount) AS ordered_shifts
      FROM mg_orders AS o
      WHERE ${orderBaseWhere()}
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
        countIf(status = 'confirmed') AS worked_shifts,
        sum(${revenue}) AS revenue_rub,
        countIf(status = 'cancelled') AS cancelled_shifts
      FROM shift_enriched
      GROUP BY period
      ORDER BY period
      FORMAT JSONEachRow`,
      params,
      'sales by project shifts trend'
    ),
    client.queryJSONEachRow(
      `SELECT
        ifNull(nullIf(c.title, ''), 'Без бренда') AS brand,
        sum(o.amount) AS ordered_shifts,
        countDistinctIf(o.workplace, o.amount > 0) AS workplaces_with_orders,
        avgIf(o.salary_per_hour, o.salary_per_hour > 0) AS avg_worker_rate_hour
      FROM mg_orders AS o
      LEFT JOIN mg_clients AS c ON o.client = c._id
      WHERE ${orderBaseWhere()}
      GROUP BY brand
      ORDER BY ordered_shifts DESC
      LIMIT 50
      FORMAT JSONEachRow`,
      params,
      'sales by project brand orders'
    ),
    client.queryJSONEachRow(
      `${shiftFactsCte()}
      SELECT
        ifNull(nullIf(c.title, ''), 'Без бренда') AS brand,
        countIf(status = 'confirmed') AS worked_shifts,
        sum(${revenue}) AS revenue_rub,
        countDistinctIf(worker, status = 'confirmed' AND worker != '') AS unique_workers,
        countDistinctIf(workplace, status = 'confirmed' AND workplace != '') AS workplaces_with_worked_shifts,
        countIf(status = 'cancelled') AS cancelled_shifts,
        countIf(status = 'confirmed' AND is_self_booked = 1) AS self_booked_confirmed_shifts
      FROM shift_enriched
      LEFT JOIN mg_clients AS c ON shift_enriched.client = c._id
      GROUP BY brand
      ORDER BY worked_shifts DESC
      LIMIT 50
      FORMAT JSONEachRow`,
      params,
      'sales by project brand shifts'
    ),
    client.queryJSONEachRow(
      `${shiftFactsCte()}
      SELECT
        if(status = '', 'empty', status) AS status,
        count() AS shifts
      FROM shift_enriched
      GROUP BY status
      ORDER BY shifts DESC
      FORMAT JSONEachRow`,
      params,
      'sales by project status breakdown'
    )
  ]);

  return {
    filters,
    summary: mapSummaryRows(orderSummaryRows, shiftSummaryRows),
    trendRows: mergeTrendRows(orderTrendRows, shiftTrendRows),
    brandRows: mergeBrandRows(brandOrderRows, brandShiftRows),
    statusRows: mapStatusRows(statusRows)
  };
}

module.exports = {
  buildPeriodExpression,
  loadSalesByProjectDashboard,
  normalizeSalesByProjectFilters
};
