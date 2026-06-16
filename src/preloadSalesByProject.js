const { successfulConfirmedShiftFlagExpression } = require('./successfulConfirmedShift');
const {
  actualOrderDomainCondition,
  actualOrderJoinsSql
} = require('./analyticsDomainSql');

function toDateTimeParam(dateOnly) {
  return `${dateOnly} 00:00:00`;
}

function preloadParams(fromDate, toDate) {
  return {
    param_from_date: fromDate,
    param_to_date: toDate,
    param_from: toDateTimeParam(fromDate),
    param_to: toDateTimeParam(toDate)
  };
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
    where.push(
      "toDate(o.start, 'Europe/Moscow') >= {from_date:Date}",
      "toDate(o.start, 'Europe/Moscow') < {to_date:Date}"
    );
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

function buildSalesByProjectPreloadQueries() {
  return {
    orderFacts: `WITH ${actualOrdersCte({ includeDateFilter: true })}
SELECT
  toString(toDate(o.start, 'Europe/Moscow')) AS period_date,
  o.brand AS brand,
  o.order_id AS order_id,
  ifNull(o.workplace, '') AS workplace_id,
  o.amount AS ordered_shifts
FROM actual_orders AS o
FORMAT JSONEachRow`,
    shiftFacts: `WITH ${actualOrdersCte()},
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
    AND toDate(j.start, 'Europe/Moscow') >= {from_date:Date}
    AND toDate(j.start, 'Europe/Moscow') < {to_date:Date}
),
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
)
SELECT
  toString(toDate(shift_start, 'Europe/Moscow')) AS period_date,
  ifNull(nullIf(brand, ''), 'Без бренда') AS brand,
  job AS job_id,
  ifNull(worker, '') AS worker_id,
  ifNull(workplace, '') AS workplace_id,
  status,
  if(is_successful_confirmed_shift = 1,
    if(contract_type = 'saas',
      worker_shift_amount * (1 + commission_percent / 100) + transaction_amount,
      customer_shift_amount + transaction_amount
    ),
    0
  ) AS revenue_rub,
  if(ifNull(cancellation_reason, '') != '' OR status = 'failed', 1, 0) AS cancelled_shifts,
  is_successful_confirmed_shift,
  if(is_successful_confirmed_shift = 1 AND is_self_booked = 1, 1, 0) AS self_booked_confirmed_shift,
  if(is_successful_confirmed_shift = 1, worker_rate_hour, NULL) AS worker_rate_hour
FROM shift_enriched
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
