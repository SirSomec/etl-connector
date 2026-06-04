const { successfulConfirmedShiftFlagExpression } = require('./successfulConfirmedShift');

function toDateTimeParam(dateOnly) {
  return `${dateOnly} 00:00:00`;
}

function preloadParams(fromDate, toDate) {
  return {
    param_from: toDateTimeParam(fromDate),
    param_to: toDateTimeParam(toDate)
  };
}

function buildSalesByProjectPreloadQueries() {
  return {
    orderFacts: `SELECT
  toString(toDate(o.start, 'Europe/Moscow')) AS period_date,
  ifNull(nullIf(c.title, ''), 'Без бренда') AS brand,
  o._id AS order_id,
  ifNull(o.workplace, '') AS workplace_id,
  ifNull(o.amount, 0) AS ordered_shifts
FROM mg_orders AS o
LEFT JOIN mg_clients AS c ON o.client = c._id
WHERE o.deleted = 0
  AND o.start >= {from:DateTime}
  AND o.start < {to:DateTime}
FORMAT JSONEachRow`,
    shiftFacts: `WITH shift_facts AS (
  SELECT
    j._id AS job,
    j.start AS shift_start,
    ifNull(j.status, '') AS status,
    j.client AS client,
    j.workplace AS workplace,
    j.worker AS worker,
    j.source AS source,
    j.cancellation_reason AS cancellation_reason,
    j.salary_per_hour AS salary_per_hour,
    j.salary_per_job AS salary_per_job,
    j.payment_per_hour AS payment_per_hour,
    j.payment_per_job AS payment_per_job,
    j.hours AS hours,
    j.payment AS payment,
    j.start_fact AS start_fact,
    j.finish_fact AS finish_fact
  FROM mg_jobs AS j
  WHERE ifNull(j._id, '') != ''
    AND j.deleted = 0
    AND j.start >= {from:DateTime}
    AND j.start < {to:DateTime}
),
self_bookings AS (
  SELECT
    h.job AS job,
    max(if(h.status = 'booked' AND h.initiator = 'worker', 1, 0)) AS is_self_booked
  FROM mg_job_history AS h
  INNER JOIN shift_facts AS sf ON h.job = sf.job
  WHERE h.job != ''
  GROUP BY h.job
),
surcharges AS (
  SELECT
    t.entityId AS job,
    sum(coalesce(nullIf(t.payment_amount, 0), t.amount, 0)) AS surcharge_amount
  FROM mg_transactions AS t
  INNER JOIN shift_facts AS sf ON t.entityId = sf.job
  WHERE t.transaction_type = 'surcharge'
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
    coalesce(nullIf(sf.client, ''), o.client) AS client,
    coalesce(nullIf(sf.workplace, ''), o.workplace) AS workplace,
    ifNull(sb.is_self_booked, 0) AS is_self_booked,
    ifNull(nullIf(o.contract_type, ''), 'services') AS contract_type,
    ifNull(ct.comission, 0) AS commission_percent,
    if(ifNull(sf.salary_per_job, 0) > 0, ifNull(sf.salary_per_job, 0), ifNull(sf.salary_per_hour, 0) * ifNull(sf.hours, 0)) AS worker_shift_amount,
    if(ifNull(sf.payment_per_job, 0) > 0, ifNull(sf.payment_per_job, 0), ifNull(sf.payment_per_hour, 0) * ifNull(sf.hours, 0)) AS customer_shift_amount,
    ifNull(s.surcharge_amount, 0) AS surcharge_amount,
    ${successfulConfirmedShiftFlagExpression('sf')} AS is_successful_confirmed_shift
  FROM shift_facts AS sf
  LEFT JOIN mg_orders AS o ON sf.source = o._id
  LEFT JOIN mg_workplaces AS w ON coalesce(nullIf(sf.workplace, ''), o.workplace) = w._id
  LEFT JOIN mg_contractors AS ct ON w.contractor = ct._id
  LEFT JOIN self_bookings AS sb ON sf.job = sb.job
  LEFT JOIN surcharges AS s ON sf.job = s.job
)
SELECT
  toString(toDate(shift_start, 'Europe/Moscow')) AS period_date,
  ifNull(nullIf(c.title, ''), 'Без бренда') AS brand,
  job AS job_id,
  ifNull(worker, '') AS worker_id,
  ifNull(workplace, '') AS workplace_id,
  status,
  if(is_successful_confirmed_shift = 1,
    if(contract_type = 'saas',
      worker_shift_amount * (1 + commission_percent / 100) + surcharge_amount,
      customer_shift_amount + surcharge_amount
    ),
    0
  ) AS revenue_rub,
  if(ifNull(cancellation_reason, '') != '' OR status = 'failed', 1, 0) AS cancelled_shifts,
  is_successful_confirmed_shift,
  if(is_successful_confirmed_shift = 1 AND is_self_booked = 1, 1, 0) AS self_booked_confirmed_shift,
  if(is_successful_confirmed_shift = 1 AND salary_per_hour > 0, salary_per_hour, 0) AS worker_rate_hour
FROM shift_enriched
LEFT JOIN mg_clients AS c ON shift_enriched.client = c._id
FORMAT JSONEachRow`
  };
}

function numberValue(value) {
  const number = Number(value || 0);

  return Number.isFinite(number) ? number : 0;
}

function stringValue(value) {
  return String(value || '');
}

function getOrCreate(map, key, create) {
  const current = map.get(key);

  if (current) {
    return current;
  }

  const next = create();

  map.set(key, next);
  return next;
}

function addToSet(sets, name, value) {
  const normalized = stringValue(value);

  if (normalized !== '') {
    sets[name].add(normalized);
  }
}

function createBrandAccumulator(periodDate, brand) {
  return {
    row: {
      period_date: periodDate,
      brand,
      ordered_shifts: 0,
      workplaces_with_orders: 0,
      worked_shifts: 0,
      revenue_rub: 0,
      unique_workers: 0,
      workplaces_with_worked_shifts: 0,
      cancelled_shifts: 0,
      self_booked_confirmed_shifts: 0,
      avg_worker_rate_hour_weighted_sum: 0,
      avg_worker_rate_hour_weight: 0,
      status: '',
      shifts: 0
    },
    sets: {
      orderWorkplaces: new Set(),
      workers: new Set(),
      workedWorkplaces: new Set()
    }
  };
}

function isSuccessfulConfirmedFact(fact) {
  if (Object.prototype.hasOwnProperty.call(fact, 'is_successful_confirmed_shift')) {
    return numberValue(fact.is_successful_confirmed_shift) === 1;
  }

  return stringValue(fact.status) === 'confirmed';
}

function createStatusRow(periodDate, status) {
  return {
    period_date: periodDate,
    brand: '',
    ordered_shifts: 0,
    workplaces_with_orders: 0,
    worked_shifts: 0,
    revenue_rub: 0,
    unique_workers: 0,
    workplaces_with_worked_shifts: 0,
    cancelled_shifts: 0,
    self_booked_confirmed_shifts: 0,
    avg_worker_rate_hour_weighted_sum: 0,
    avg_worker_rate_hour_weight: 0,
    status,
    shifts: 0
  };
}

function rollupDailyRows({ orderFacts, shiftFacts }) {
  const brandRows = new Map();
  const statusRows = new Map();

  for (const fact of orderFacts) {
    const periodDate = stringValue(fact.period_date);
    const brand = stringValue(fact.brand);
    const accumulator = getOrCreate(
      brandRows,
      `${periodDate}\u0000${brand}`,
      () => createBrandAccumulator(periodDate, brand)
    );

    accumulator.row.ordered_shifts += numberValue(fact.ordered_shifts);
    addToSet(accumulator.sets, 'orderWorkplaces', fact.workplace_id);
  }

  for (const fact of shiftFacts) {
    const periodDate = stringValue(fact.period_date);
    const brand = stringValue(fact.brand);
    const status = stringValue(fact.status);
    const accumulator = getOrCreate(
      brandRows,
      `${periodDate}\u0000${brand}`,
      () => createBrandAccumulator(periodDate, brand)
    );
    const statusRow = getOrCreate(
      statusRows,
      `${periodDate}\u0000${status}`,
      () => createStatusRow(periodDate, status)
    );

    statusRow.shifts += 1;
    accumulator.row.cancelled_shifts += numberValue(fact.cancelled_shifts);

    if (isSuccessfulConfirmedFact(fact)) {
      accumulator.row.worked_shifts += 1;
      accumulator.row.revenue_rub += numberValue(fact.revenue_rub);
      accumulator.row.self_booked_confirmed_shifts += numberValue(fact.self_booked_confirmed_shift);
      addToSet(accumulator.sets, 'workers', fact.worker_id);
      addToSet(accumulator.sets, 'workedWorkplaces', fact.workplace_id);

      const workerRateHour = numberValue(fact.worker_rate_hour);

      if (workerRateHour > 0) {
        accumulator.row.avg_worker_rate_hour_weighted_sum += workerRateHour;
        accumulator.row.avg_worker_rate_hour_weight += 1;
      }
    }
  }

  const dailyBrandRows = Array.from(brandRows.values()).map((accumulator) => ({
    ...accumulator.row,
    workplaces_with_orders: accumulator.sets.orderWorkplaces.size,
    unique_workers: accumulator.sets.workers.size,
    workplaces_with_worked_shifts: accumulator.sets.workedWorkplaces.size
  }));

  return [...dailyBrandRows, ...Array.from(statusRows.values())].sort((left, right) => {
    const dateCompare = left.period_date.localeCompare(right.period_date);

    if (dateCompare !== 0) {
      return dateCompare;
    }

    const brandCompare = left.brand.localeCompare(right.brand);

    if (brandCompare !== 0) {
      return brandCompare;
    }

    return left.status.localeCompare(right.status);
  });
}

async function refreshSalesByProjectPreload({ client, store, fromDate, toDate }) {
  const queries = buildSalesByProjectPreloadQueries();
  const params = preloadParams(fromDate, toDate);
  const [orderFacts, shiftFacts] = await Promise.all([
    client.queryJSONEachRow(queries.orderFacts, params, 'preload sales by project order facts'),
    client.queryJSONEachRow(queries.shiftFacts, params, 'preload sales by project shift facts')
  ]);
  const dailyRows = rollupDailyRows({ orderFacts, shiftFacts, fromDate, toDate });

  store.replaceSalesByProjectRange({
    fromDate,
    toDate,
    dailyRows,
    orderFacts,
    shiftFacts
  });

  return {
    rowsWritten: dailyRows.length + orderFacts.length + shiftFacts.length
  };
}

module.exports = {
  buildSalesByProjectPreloadQueries,
  refreshSalesByProjectPreload
};
