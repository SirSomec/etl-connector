const {
  successfulConfirmedShiftCondition,
  successfulConfirmedShiftFlagExpression
} = require('./successfulConfirmedShift');
const {
  actualOrderDomainCondition,
  actualOrderJoinsSql
} = require('./analyticsDomainSql');

const SQL_METRIC_INFO = {};

function defineSqlMetric(info) {
  if (SQL_METRIC_INFO[info.id]) {
    throw new Error(`Duplicate SQL metric info id: ${info.id}`);
  }

  SQL_METRIC_INFO[info.id] = info;
}

function defineMetricSet({ baseId, sql, metrics }) {
  for (const metric of metrics) {
    const id = metric.id ? metric.id : `${baseId}.${metric.suffix}`;

    defineSqlMetric({
      id,
      title: metric.title,
      description: metric.description,
      sql: metric.sql || sql
    });
  }
}

const SALES_SHIFT_FACTS_SQL = `WITH shift_facts AS (
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
  WHERE j._id != ''
    AND j.deleted = 0
    AND j.start >= {from:DateTime}
    AND j.start < {to:DateTime}
),
self_bookings AS (
  SELECT
    h.job AS job,
    argMax(if(h.initiator = 'worker', 1, 0), coalesce(h.createdAt, h.updatedAt)) AS is_self_booked
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
)`;

const SALES_SUMMARY_SQL = `-- orders summary
SELECT
  sum(o.amount) AS ordered_shifts,
  countDistinctIf(o.workplace, o.workplace != '') AS workplaces_with_orders
FROM mg_orders AS o
WHERE o.deleted = 0
  AND o.start >= {from:DateTime}
  AND o.start < {to:DateTime}
FORMAT JSONEachRow;

-- shifts summary
${SALES_SHIFT_FACTS_SQL}
SELECT
  uniqExactIf(job, is_successful_confirmed_shift = 1 AND job != '') AS worked_shifts,
  sum(if(is_successful_confirmed_shift = 1, if(contract_type = 'saas', worker_shift_amount * (1 + commission_percent / 100) + surcharge_amount, customer_shift_amount + surcharge_amount), 0)) AS revenue_rub,
  uniqExactIf(worker, is_successful_confirmed_shift = 1 AND worker != '') AS unique_workers,
  uniqExactIf(workplace, is_successful_confirmed_shift = 1 AND workplace != '') AS workplaces_with_worked_shifts,
  countIf(ifNull(cancellation_reason, '') != '' OR status = 'failed') AS cancelled_shifts,
  countIf(is_successful_confirmed_shift = 1 AND is_self_booked = 1) AS self_booked_confirmed_shifts,
  avgIf(salary_per_hour, is_successful_confirmed_shift = 1 AND salary_per_hour > 0) AS avg_worker_rate_hour
FROM shift_enriched
FORMAT JSONEachRow`;

const SALES_TREND_SQL = `-- orders trend
SELECT
  <period_expression(o.start)> AS period,
  sum(o.amount) AS ordered_shifts
FROM mg_orders AS o
WHERE o.deleted = 0
  AND o.start >= {from:DateTime}
  AND o.start < {to:DateTime}
GROUP BY period
ORDER BY period
FORMAT JSONEachRow;

-- shifts trend
${SALES_SHIFT_FACTS_SQL}
SELECT
  <period_expression(shift_start)> AS period,
  uniqExactIf(job, is_successful_confirmed_shift = 1 AND job != '') AS worked_shifts,
  sum(if(is_successful_confirmed_shift = 1, if(contract_type = 'saas', worker_shift_amount * (1 + commission_percent / 100) + surcharge_amount, customer_shift_amount + surcharge_amount), 0)) AS revenue_rub,
  countIf(ifNull(cancellation_reason, '') != '' OR status = 'failed') AS cancelled_shifts
FROM shift_enriched
GROUP BY period
ORDER BY period
FORMAT JSONEachRow`;

const SALES_BRANDS_SQL = `-- brand orders
SELECT
  ifNull(nullIf(c.title, ''), 'Без бренда') AS brand,
  sum(o.amount) AS ordered_shifts,
  countDistinctIf(o.workplace, o.workplace != '') AS workplaces_with_orders
FROM mg_orders AS o
LEFT JOIN mg_clients AS c ON o.client = c._id
WHERE o.deleted = 0
  AND o.start >= {from:DateTime}
  AND o.start < {to:DateTime}
GROUP BY brand
ORDER BY ordered_shifts DESC
FORMAT JSONEachRow;

-- brand shifts
${SALES_SHIFT_FACTS_SQL}
SELECT
  ifNull(nullIf(c.title, ''), 'Без бренда') AS brand,
  uniqExactIf(job, is_successful_confirmed_shift = 1 AND job != '') AS worked_shifts,
  sum(if(is_successful_confirmed_shift = 1, if(contract_type = 'saas', worker_shift_amount * (1 + commission_percent / 100) + surcharge_amount, customer_shift_amount + surcharge_amount), 0)) AS revenue_rub,
  uniqExactIf(worker, is_successful_confirmed_shift = 1 AND worker != '') AS unique_workers,
  uniqExactIf(workplace, is_successful_confirmed_shift = 1 AND workplace != '') AS workplaces_with_worked_shifts,
  countIf(ifNull(cancellation_reason, '') != '' OR status = 'failed') AS cancelled_shifts,
  countIf(is_successful_confirmed_shift = 1 AND is_self_booked = 1) AS self_booked_confirmed_shifts,
  avgIf(salary_per_hour, is_successful_confirmed_shift = 1 AND salary_per_hour > 0) AS avg_worker_rate_hour
FROM shift_enriched
LEFT JOIN mg_clients AS c ON shift_enriched.client = c._id
GROUP BY brand
ORDER BY worked_shifts DESC
FORMAT JSONEachRow`;

const SALES_STATUSES_SQL = `WITH shift_facts AS (
  SELECT
    j._id AS job,
    ifNull(j.status, '') AS status
  FROM mg_jobs AS j
  WHERE j._id != ''
    AND j.deleted = 0
    AND j.start >= {from:DateTime}
    AND j.start < {to:DateTime}
)
SELECT
  if(status = '', 'empty', status) AS status,
  count() AS shifts
FROM shift_facts
GROUP BY status
ORDER BY shifts DESC
FORMAT JSONEachRow`;

function sqlInspectorNullableNumberExpression(alias, field) {
  return `toFloat64OrNull(nullIf(trimBoth(ifNull(toString(${alias}.${field}), '')), ''))`;
}

function sqlInspectorNullablePositiveNumberExpression(alias, field) {
  return `nullIf(${sqlInspectorNullableNumberExpression(alias, field)}, 0)`;
}

function sqlInspectorPositiveOrZeroNumberExpression(alias, field) {
  return `ifNull(${sqlInspectorNullablePositiveNumberExpression(alias, field)}, 0)`;
}

function sqlInspectorTransactionAmountExpression(alias = 't') {
  return `coalesce(${sqlInspectorNullableNumberExpression(alias, 'payment_amount')}, ${sqlInspectorNullableNumberExpression(alias, 'amount')}, 0)`;
}

const SALES_DOMAIN_ACTUAL_ORDERS_SQL = `actual_orders AS (
  SELECT
    o._id AS order_id,
    o.start AS start,
    o.client AS client,
    o.workplace AS workplace,
    ifNull(o.amount, 0) AS amount,
    ifNull(nullIf(c.title, ''), 'Р‘РµР· Р±СЂРµРЅРґР°') AS brand,
    o.pieceworks AS pieceworks,
    ifNull(o.contract_type, '') AS order_contract_type,
    ifNull(ct.contract_type, '') AS contractor_contract_type,
    ifNull(ct.comission, 0) AS commission_percent
  FROM mg_orders AS o
  ${actualOrderJoinsSql('o', { clientAlias: 'c', contractorAlias: 'ct' })}
  WHERE ${actualOrderDomainCondition('o', 'c', 'ct')}
    AND o.start >= {from:DateTime}
    AND o.start < {to:DateTime}
)`;

const SALES_DOMAIN_SHIFT_FACTS_SQL = `WITH ${SALES_DOMAIN_ACTUAL_ORDERS_SQL},
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
    sum(${sqlInspectorTransactionAmountExpression('t')}) AS transaction_amount
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
    if(${sqlInspectorPositiveOrZeroNumberExpression('sf', 'salary_per_job')} > 0, ${sqlInspectorPositiveOrZeroNumberExpression('sf', 'salary_per_job')}, ${sqlInspectorPositiveOrZeroNumberExpression('sf', 'salary_per_hour')} * ${sqlInspectorPositiveOrZeroNumberExpression('sf', 'hours')}) AS worker_shift_amount,
    if(${sqlInspectorPositiveOrZeroNumberExpression('sf', 'payment_per_job')} > 0, ${sqlInspectorPositiveOrZeroNumberExpression('sf', 'payment_per_job')}, ${sqlInspectorPositiveOrZeroNumberExpression('sf', 'payment_per_hour')} * ${sqlInspectorPositiveOrZeroNumberExpression('sf', 'hours')}) AS customer_shift_amount,
    ifNull(jt.transaction_amount, 0) AS transaction_amount,
    ${sqlInspectorNullablePositiveNumberExpression('sf', 'salary_per_hour')} AS worker_rate_hour,
    ${successfulConfirmedShiftFlagExpression('sf', { pieceworkExpression: 'sf.piecework' })} AS is_successful_confirmed_shift
  FROM shift_facts AS sf
  LEFT JOIN first_history AS fh ON sf.job = fh.job
  LEFT JOIN job_transactions AS jt ON sf.job = jt.job
)`;

const SALES_DOMAIN_REVENUE_SQL = `if(is_successful_confirmed_shift = 1, if(contract_type = 'saas', worker_shift_amount * (1 + commission_percent / 100) + transaction_amount, customer_shift_amount + transaction_amount), 0)`;
const SALES_DOMAIN_AVG_WORKER_RATE_SQL = `avgIf(worker_rate_hour, is_successful_confirmed_shift = 1 AND worker_rate_hour IS NOT NULL)`;

const SALES_DOMAIN_SUMMARY_SQL = `-- orders summary
WITH ${SALES_DOMAIN_ACTUAL_ORDERS_SQL}
SELECT
  sum(o.amount) AS ordered_shifts,
  countDistinctIf(o.workplace, o.workplace != '') AS workplaces_with_orders
FROM actual_orders AS o
FORMAT JSONEachRow;

-- shifts summary
${SALES_DOMAIN_SHIFT_FACTS_SQL}
SELECT
  uniqExactIf(job, is_successful_confirmed_shift = 1 AND job != '') AS worked_shifts,
  sum(${SALES_DOMAIN_REVENUE_SQL}) AS revenue_rub,
  uniqExactIf(worker, is_successful_confirmed_shift = 1 AND worker != '') AS unique_workers,
  uniqExactIf(workplace, is_successful_confirmed_shift = 1 AND workplace != '') AS workplaces_with_worked_shifts,
  countIf(ifNull(cancellation_reason, '') != '' OR status = 'failed') AS cancelled_shifts,
  countIf(is_successful_confirmed_shift = 1 AND is_self_booked = 1) AS self_booked_confirmed_shifts,
  ${SALES_DOMAIN_AVG_WORKER_RATE_SQL} AS avg_worker_rate_hour
FROM shift_enriched
FORMAT JSONEachRow`;

const SALES_DOMAIN_TREND_SQL = `-- orders trend
WITH ${SALES_DOMAIN_ACTUAL_ORDERS_SQL}
SELECT
  <period_expression(o.start)> AS period,
  sum(o.amount) AS ordered_shifts
FROM actual_orders AS o
GROUP BY period
ORDER BY period
FORMAT JSONEachRow;

-- shifts trend
${SALES_DOMAIN_SHIFT_FACTS_SQL}
SELECT
  <period_expression(shift_start)> AS period,
  uniqExactIf(job, is_successful_confirmed_shift = 1 AND job != '') AS worked_shifts,
  sum(${SALES_DOMAIN_REVENUE_SQL}) AS revenue_rub,
  countIf(ifNull(cancellation_reason, '') != '' OR status = 'failed') AS cancelled_shifts
FROM shift_enriched
GROUP BY period
ORDER BY period
FORMAT JSONEachRow`;

const SALES_DOMAIN_BRANDS_SQL = `-- brand orders
WITH ${SALES_DOMAIN_ACTUAL_ORDERS_SQL}
SELECT
  o.brand AS brand,
  sum(o.amount) AS ordered_shifts,
  countDistinctIf(o.workplace, o.workplace != '') AS workplaces_with_orders
FROM actual_orders AS o
GROUP BY brand
ORDER BY ordered_shifts DESC
FORMAT JSONEachRow;

-- brand shifts
${SALES_DOMAIN_SHIFT_FACTS_SQL}
SELECT
  ifNull(nullIf(brand, ''), 'Р‘РµР· Р±СЂРµРЅРґР°') AS brand,
  uniqExactIf(job, is_successful_confirmed_shift = 1 AND job != '') AS worked_shifts,
  sum(${SALES_DOMAIN_REVENUE_SQL}) AS revenue_rub,
  uniqExactIf(worker, is_successful_confirmed_shift = 1 AND worker != '') AS unique_workers,
  uniqExactIf(workplace, is_successful_confirmed_shift = 1 AND workplace != '') AS workplaces_with_worked_shifts,
  countIf(ifNull(cancellation_reason, '') != '' OR status = 'failed') AS cancelled_shifts,
  countIf(is_successful_confirmed_shift = 1 AND is_self_booked = 1) AS self_booked_confirmed_shifts,
  ${SALES_DOMAIN_AVG_WORKER_RATE_SQL} AS avg_worker_rate_hour
FROM shift_enriched
GROUP BY brand
ORDER BY worked_shifts DESC
FORMAT JSONEachRow`;

const SALES_DOMAIN_STATUSES_SQL = `${SALES_DOMAIN_SHIFT_FACTS_SQL}
SELECT
  if(status = '', 'empty', status) AS status,
  count() AS shifts
FROM shift_facts
GROUP BY status
ORDER BY shifts DESC
FORMAT JSONEachRow`;

const WORKPLACE_ANALYSIS_POINTS_SQL = `SELECT
  metrics.workplace_id AS workplace_id,
  metrics.workplace_title AS workplace_title,
  metrics.total_ordered_shifts AS total_ordered_shifts,
  metrics.active_days AS active_days,
  metrics.sla_ordered_shifts AS sla_ordered_shifts,
  metrics.sla_completed_shifts AS sla_completed_shifts,
  metrics.forecast_sla_ordered_shifts AS forecast_sla_ordered_shifts,
  metrics.forecast_sla_active_shifts AS forecast_sla_active_shifts,
  metrics.forecast_sla_percent AS forecast_sla_percent,
  metrics.sla_percent AS sla_percent,
  metrics.stability_percent AS stability_percent
FROM (
  SELECT
    os.workplace_id AS workplace_id,
    os.workplace_title AS workplace_title,
    os.total_ordered_shifts AS total_ordered_shifts,
    os.active_days AS active_days,
    os.sla_ordered_shifts AS sla_ordered_shifts,
    ifNull(sc.sla_completed_shifts, 0) AS sla_completed_shifts,
    os.forecast_sla_ordered_shifts AS forecast_sla_ordered_shifts,
    ifNull(fa.forecast_sla_active_shifts, 0) AS forecast_sla_active_shifts,
    if(os.forecast_sla_ordered_shifts > 0, ifNull(fa.forecast_sla_active_shifts, 0) / os.forecast_sla_ordered_shifts * 100, 0) AS forecast_sla_percent,
    if(os.sla_ordered_shifts > 0, ifNull(sc.sla_completed_shifts, 0) / os.sla_ordered_shifts * 100, 0) AS sla_percent,
    if({range_days:Float64} > 0, os.active_days / {range_days:Float64} * 100, 0) AS stability_percent
  FROM (
    SELECT
      o.workplace AS workplace_id,
      ifNull(any(w.title), '') AS workplace_title,
      sum(ifNull(o.amount, 0)) AS total_ordered_shifts,
      sumIf(ifNull(o.amount, 0), ifNull(o.deleted, 0) = 0 AND ifNull(o.is_hidden, 0) = 0 AND toDate(o.start) < {current_date:Date}) AS sla_ordered_shifts,
      sumIf(ifNull(o.amount, 0), ifNull(o.deleted, 0) = 0 AND ifNull(o.is_hidden, 0) = 0 AND toDate(o.start) >= {current_date:Date}) AS forecast_sla_ordered_shifts,
      countDistinct(toDate(o.start)) AS active_days
    FROM mg_orders AS o
    LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
    LEFT JOIN mg_clients AS c ON o.client = c._id
    LEFT JOIN mg_professions AS p ON o.spec = p.spec
    LEFT JOIN mg_contractors AS ct ON w.contractor = ct._id
    WHERE <whereSql>
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
    INNER JOIN (
      SELECT
        j.source AS source,
        ${successfulConfirmedShiftFlagExpression('j', { pieceworkExpression: 'actual_order.pieceworks' })} AS is_successful_confirmed_shift
      FROM mg_jobs AS j
      INNER JOIN mg_orders AS actual_order ON actual_order._id = j.source
      WHERE ifNull(j.deleted, 0) = 0
    ) AS completed_job ON completed_job.source = o._id
    WHERE <whereSql>
      AND toDate(o.start) < {current_date:Date}
      AND completed_job.is_successful_confirmed_shift = 1
    GROUP BY workplace_id
  ) AS sc ON os.workplace_id = sc.workplace_id
  LEFT JOIN (
    SELECT
      o.workplace AS workplace_id,
      countIf(ifNull(o.deleted, 0) = 0 AND ifNull(o.is_hidden, 0) = 0) AS forecast_sla_active_shifts
    FROM mg_orders AS o
    LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
    LEFT JOIN mg_clients AS c ON o.client = c._id
    LEFT JOIN mg_professions AS p ON o.spec = p.spec
    LEFT JOIN mg_contractors AS ct ON w.contractor = ct._id
    INNER JOIN (
      SELECT
        j.source AS source
      FROM mg_jobs AS j
      WHERE ifNull(j.deleted, 0) = 0
        AND ifNull(j.status, '') IN ('booked', 'going', 'delayed', 'waiting', 'checkingin', 'inprogress', 'checkingout', 'completed', 'confirmed')
    ) AS forecast_job ON forecast_job.source = o._id
    WHERE <whereSql>
      AND toDate(o.start) >= {current_date:Date}
    GROUP BY workplace_id
  ) AS fa ON os.workplace_id = fa.workplace_id
) AS metrics
WHERE <metricWhereSql>
ORDER BY <sort_whitelist>
LIMIT {limit:UInt64} OFFSET {offset:UInt64}
FORMAT JSONEachRow`;

const WORKPLACE_ANALYSIS_DAILY_SQL = `WITH top_workplaces AS (
  <topWorkplacesSelect(whereSql, metricWhereSql, sort)>
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
  WHERE <whereSql>
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
  INNER JOIN (
    SELECT
      j.source AS source,
      ${successfulConfirmedShiftFlagExpression('j', { pieceworkExpression: 'actual_order.pieceworks' })} AS is_successful_confirmed_shift
    FROM mg_jobs AS j
    INNER JOIN mg_orders AS actual_order ON actual_order._id = j.source
    WHERE ifNull(j.deleted, 0) = 0
  ) AS completed_job ON completed_job.source = o._id
  WHERE <whereSql>
    AND completed_job.is_successful_confirmed_shift = 1
  GROUP BY workplace_id, order_date
),
daily_forecast_active AS (
  SELECT
    o.workplace AS workplace_id,
    toString(toDate(o.start)) AS order_date,
    count() AS forecast_active_shifts,
    countIf(ifNull(o.deleted, 0) = 0 AND ifNull(o.is_hidden, 0) = 0) AS forecast_sla_active_shifts
  FROM mg_orders AS o
  LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
  LEFT JOIN mg_clients AS c ON o.client = c._id
  LEFT JOIN mg_professions AS p ON o.spec = p.spec
  LEFT JOIN mg_contractors AS ct ON w.contractor = ct._id
  INNER JOIN top_workplaces AS tw ON o.workplace = tw.workplace_id
  INNER JOIN (
    SELECT
      j.source AS source
    FROM mg_jobs AS j
    WHERE ifNull(j.deleted, 0) = 0
      AND ifNull(j.status, '') IN ('booked', 'going', 'delayed', 'waiting', 'checkingin', 'inprogress', 'checkingout', 'completed', 'confirmed')
  ) AS forecast_job ON forecast_job.source = o._id
  WHERE <whereSql>
    AND toDate(o.start) >= {current_date:Date}
  GROUP BY workplace_id, order_date
)
SELECT
  d.workplace_id AS workplace_id,
  d.order_date AS order_date,
  d.ordered_shifts AS ordered_shifts,
  ifNull(c.completed_shifts, 0) AS completed_shifts,
  d.sla_ordered_shifts AS sla_ordered_shifts,
  ifNull(c.sla_completed_shifts, 0) AS sla_completed_shifts,
  ifNull(f.forecast_active_shifts, 0) AS forecast_active_shifts,
  ifNull(f.forecast_sla_active_shifts, 0) AS forecast_sla_active_shifts
FROM daily_orders AS d
LEFT JOIN daily_completed AS c
  ON d.workplace_id = c.workplace_id
  AND d.order_date = c.order_date
LEFT JOIN daily_forecast_active AS f
  ON d.workplace_id = f.workplace_id
  AND d.order_date = f.order_date
ORDER BY workplace_id, order_date
FORMAT JSONEachRow`;

const ACTIVE_GIGERS_5KM_SQL = `WITH selected_workplaces AS (
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

const WORKPLACE_ATTENTION_SQL = `WITH filtered_orders AS (
  SELECT
    o._id AS order_id,
    o.workplace AS workplace_id,
    toDate(o.start) AS order_date,
    w.location__coordinates AS workplace_coordinates,
    if(
      ifNull(p.caption, '') = '',
      if(ifNull(o.spec, '') = '', 'Без специальности', o.spec),
      p.caption
    ) AS profession,
    o.pieceworks AS pieceworks,
    ifNull(o.amount, 0) AS amount
  FROM mg_orders AS o
  LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
  LEFT JOIN mg_clients AS c ON o.client = c._id
  LEFT JOIN mg_professions AS p ON o.spec = p.spec
  LEFT JOIN mg_contractors AS ct ON w.contractor = ct._id
  WHERE o.start >= {from:DateTime}
    AND o.start < {to:DateTime}
    AND ifNull(o.amount, 0) > 0
    AND ifNull(o.workplace, '') != ''
    AND <safe_optional_filters>
),
covered_jobs AS (
  SELECT
    j.source AS order_id,
    count() AS covered
  FROM mg_jobs AS j
  INNER JOIN filtered_orders AS fo ON j.source = fo.order_id
  WHERE ifNull(j.deleted, 0) = 0
    AND (
      ifNull(j.status, '') IN ('booked', 'going', 'inprogress', 'checkingin', 'checkingout', 'completed', 'delayed', 'waiting')
      OR (${successfulConfirmedShiftCondition('j', { pieceworkExpression: 'fo.pieceworks' })})
    )
  GROUP BY order_id
),
daily_point AS (
  SELECT
    fo.workplace_id,
    fo.order_date,
    any(fo.workplace_coordinates) AS workplace_coordinates,
    sum(fo.amount) AS ordered,
    sum(ifNull(cj.covered, 0)) AS covered,
    greatest(sum(fo.amount) - sum(ifNull(cj.covered, 0)), 0) AS free
  FROM filtered_orders AS fo
  LEFT JOIN covered_jobs AS cj ON fo.order_id = cj.order_id
  GROUP BY fo.workplace_id, fo.order_date
),
profession_free_rows AS (
  SELECT
    fo.workplace_id AS workplace_id,
    fo.profession AS profession,
    sum(greatest(fo.amount - ifNull(cj.covered, 0), 0)) AS free
  FROM filtered_orders AS fo
  LEFT JOIN covered_jobs AS cj ON fo.order_id = cj.order_id
  GROUP BY fo.workplace_id, fo.profession
  HAVING free > 0
),
attention_points AS (
  SELECT
    workplace_id,
    any(workplace_coordinates[1]) AS lon,
    any(workplace_coordinates[2]) AS lat,
    sum(ordered) AS ordered_7d,
    sum(covered) AS covered_7d,
    sum(free) AS free_7d,
    max(free) AS max_daily_free,
    minIf(order_date, free > 0) AS nearest_free_date
  FROM daily_point
  WHERE length(workplace_coordinates) >= 2
  GROUP BY workplace_id
  HAVING free_7d > 0
  LIMIT {limit:UInt64}
),
point_professions AS (
  SELECT
    workplace_id,
    groupArray(profession) AS free_professions_7d,
    groupArray(free) AS free_profession_counts_7d
  FROM (
    SELECT
      pfr.workplace_id AS workplace_id,
      pfr.profession AS profession,
      pfr.free AS free
    FROM profession_free_rows AS pfr
    INNER JOIN attention_points AS ap ON pfr.workplace_id = ap.workplace_id
    ORDER BY pfr.workplace_id ASC, pfr.free DESC, pfr.profession ASC
  )
  GROUP BY workplace_id
),
active_session_users AS (
  SELECT DISTINCT ifNull(profile_id, '') AS user_id
  FROM appmetrica_sessions
  WHERE ifNull(profile_id, '') != ''
    AND parseDateTimeBestEffortOrNull(session_start_datetime) >= {active_from:DateTime}
    AND parseDateTimeBestEffortOrNull(session_start_datetime) < {active_to:DateTime}
),
latest_workers AS (
  SELECT
    worker.user AS user_id,
    argMax(ifNull(worker.status, ''), ifNull(worker.updatedAt, worker.createdAt)) AS status,
    argMax(worker.location__coordinates, ifNull(worker.updatedAt, worker.createdAt)) AS worker_coordinates
  FROM mg_workers AS worker
  LEFT JOIN mg_users AS u ON worker.user = u._id
  WHERE ifNull(worker.user, '') != ''
    AND ifNull(worker.deleted, 0) = 0
    AND ifNull(u.deleted, 0) = 0
    AND length(worker.location__coordinates) >= 2
  GROUP BY worker.user
),
point_worker_pairs AS (
  SELECT
    ap.workplace_id,
    lw.user_id,
    lw.status,
    lw.user_id IN (SELECT user_id FROM active_session_users) AS is_active_30d
  FROM attention_points AS ap
  CROSS JOIN latest_workers AS lw
  WHERE greatCircleDistance(ap.lon, ap.lat, lw.worker_coordinates[1], lw.worker_coordinates[2]) <= 15000
)
SELECT
  ap.workplace_id,
  ap.ordered_7d,
  ap.covered_7d,
  ap.free_7d,
  pp.free_professions_7d,
  pp.free_profession_counts_7d,
  ap.max_daily_free,
  uniqExact(pwp.user_id) AS total_workers_15km,
  uniqExactIf(pwp.user_id, pwp.is_active_30d) AS active_workers_30d_15km
FROM attention_points AS ap
LEFT JOIN point_worker_pairs AS pwp ON ap.workplace_id = pwp.workplace_id
LEFT JOIN point_professions AS pp ON ap.workplace_id = pp.workplace_id
GROUP BY ap.workplace_id, ap.ordered_7d, ap.covered_7d, ap.free_7d, pp.free_professions_7d, pp.free_profession_counts_7d, ap.max_daily_free
ORDER BY free_7d DESC, max_daily_free DESC
FORMAT JSONEachRow`;

const WORKER_CANCELLATIONS_SQL = `WITH shift_facts AS (
  SELECT
    j._id AS job,
    j.worker AS worker_id,
    j.start AS start,
    ifNull(j.status, '') AS status,
    ${successfulConfirmedShiftFlagExpression('j', { pieceworkExpression: 'o.pieceworks' })} AS is_successful_confirmed_shift
  FROM mg_jobs AS j
  INNER JOIN mg_orders AS o ON o._id = j.source
  WHERE j.start >= {from:DateTime}
    AND j.start < {to:DateTime}
    AND ifNull(j.worker, '') != ''
    AND ifNull(j.deleted, 0) = 0
),
cancellation_events AS (
  SELECT
    h.job AS job,
    h.initiator = 'worker' AS is_worker_event,
    coalesce(h.createdAt, h.updatedAt) AS event_at
  FROM mg_job_history AS h
  INNER JOIN shift_facts AS sf ON h.job = sf.job
  WHERE h.status = 'cancelled'
),
cancellation_flags AS (
  SELECT
    sf.job AS job,
    max(if(ce.is_worker_event, 1, 0)) AS is_worker_cancelled,
    max(if(
      ce.is_worker_event
        AND ce.event_at >= sf.start - INTERVAL 24 HOUR
        AND ce.event_at < sf.start,
      1,
      0
    )) AS is_worker_cancelled_24h,
    max(if(ce.event_at >= sf.start, 1, 0)) AS is_post_start_cancelled
  FROM shift_facts AS sf
  LEFT JOIN cancellation_events AS ce ON ce.job = sf.job
  GROUP BY sf.job
),
worker_metrics AS (
  SELECT
    sf.worker_id AS worker_id,
    uniqExactIf(sf.job, is_successful_confirmed_shift = 1) AS confirmed_shifts,
    uniqExactIf(sf.job, status = 'cancelled' AND ifNull(cf.is_worker_cancelled, 0) = 1) AS worker_cancellations,
    uniqExactIf(sf.job, status = 'cancelled' AND ifNull(cf.is_worker_cancelled_24h, 0) = 1) AS worker_cancellations_24h,
    uniqExactIf(sf.job, status = 'cancelled' AND ifNull(cf.is_post_start_cancelled, 0) = 1) AS post_start_cancellations,
    uniqExactIf(sf.job, status = 'failed') AS failed_shifts
  FROM shift_facts AS sf
  LEFT JOIN cancellation_flags AS cf ON cf.job = sf.job
  GROUP BY sf.worker_id
)
SELECT
  wm.worker_id AS worker_id,
  ifNull(w.user, '') AS user_id,
  <workerFullNameExpression()> AS full_name,
  ifNull(u.phone, '') AS phone,
  ifNull(w.full_address__city, '') AS city,
  wm.confirmed_shifts AS confirmed_shifts,
  wm.worker_cancellations AS worker_cancellations,
  wm.worker_cancellations_24h AS worker_cancellations_24h,
  wm.post_start_cancellations AS post_start_cancellations,
  wm.failed_shifts AS failed_shifts
FROM worker_metrics AS wm
LEFT JOIN mg_workers AS w ON wm.worker_id = w._id
LEFT JOIN mg_users AS u ON w.user = u._id
WHERE <search_and_metric_filters>
ORDER BY <sort_whitelist>, worker_id ASC
LIMIT {limit:UInt64} OFFSET {offset:UInt64}
FORMAT JSONEachRow`;

const WORKPLACE_POINT_SUMMARY_SQL = `WITH filtered_orders AS (
  SELECT
    o._id AS order_id,
    toString(toDate(o.start)) AS period,
    o.start AS order_start,
    o.createdAt AS order_created_at,
    if(o.createdAt IS NOT NULL AND o.start IS NOT NULL AND o.createdAt <= o.start, dateDiff('minute', o.createdAt, o.start), NULL) AS order_lead_minutes,
    ifNull(o.amount, 0) AS amount,
    o.pieceworks AS pieceworks,
    if(ifNull(p.caption, '') = '', o.spec, p.caption) AS profession
  FROM mg_orders AS o
  LEFT JOIN mg_professions AS p ON o.spec = p.spec
  WHERE <whereSql>
),
shift_facts AS (
  SELECT
    j._id AS job_id,
    j.source AS order_id,
    j.worker AS worker,
    j.status AS status,
    j.start AS start,
    j.hours AS hours,
    j.payment AS payment,
    j.salary_per_hour AS salary_per_hour,
    j.salary_per_job AS salary_per_job,
    j.start_fact AS start_fact,
    j.finish_fact AS finish_fact,
    ${successfulConfirmedShiftFlagExpression('j', { pieceworkExpression: 'fo.pieceworks' })} AS is_successful_confirmed_shift,
    ifNull(j.cancellation_reason, '') AS cancellation_reason,
    ifNull(j.failure_reason, '') AS failure_reason
  FROM mg_jobs AS j
  INNER JOIN filtered_orders AS fo ON j.source = fo.order_id
  WHERE j.deleted = 0
),
drop_events AS (
  SELECT
    h.job AS job_id,
    minIf(coalesce(h.createdAt, h.updatedAt), (ifNull(h.status, '') IN ('cancelled', 'failed') OR ifNull(h.cancellation_reason, '') != '' OR ifNull(h.failure_reason, '') != '') AND (ifNull(h.initiator, '') = 'worker' OR ifNull(h.status, '') = 'failed' OR ifNull(h.failure_reason, '') != '')) AS drop_at
  FROM mg_job_history AS h
  INNER JOIN shift_facts AS sf ON h.job = sf.job_id
  GROUP BY h.job
),
booked_workers AS (
  SELECT
    uniqExact(ifNull(h.worker, '')) AS unique_booked_workers
  FROM mg_job_history AS h
  INNER JOIN shift_facts AS sf ON h.job = sf.job_id
  WHERE ifNull(h.status, '') = 'booked'
    AND ifNull(h.worker, '') != ''
),
order_summary AS (
  SELECT
    sum(amount) AS ordered_shifts,
    sumIf(amount, toDate(order_start) < {current_date:Date}) AS sla_ordered_shifts,
    sumIf(amount, toDate(order_start) >= {current_date:Date}) AS forecast_sla_ordered_shifts,
    countDistinct(period) AS active_days
  FROM filtered_orders
),
shift_summary AS (
  SELECT
    countIf(is_successful_confirmed_shift = 1) AS completed_shifts,
    countIf(is_successful_confirmed_shift = 1 AND toDate(start) < {current_date:Date}) AS sla_completed_shifts,
    countIf(ifNull(status, '') IN ('booked', 'going', 'delayed', 'waiting', 'checkingin', 'inprogress', 'checkingout', 'completed', 'confirmed') AND toDate(start) >= {current_date:Date}) AS forecast_sla_active_shifts,
    uniqExactIf(worker, is_successful_confirmed_shift = 1 AND worker != '') AS unique_completed_workers,
    uniqExactIf(sf.job_id, de.drop_at IS NOT NULL AND sf.start IS NOT NULL AND de.drop_at >= sf.start - INTERVAL 24 HOUR AND de.drop_at <= sf.start) AS dropoffs_24h
  FROM shift_facts AS sf
  LEFT JOIN drop_events AS de ON sf.job_id = de.job_id
)
SELECT
  os.ordered_shifts AS ordered_shifts,
  ifNull(ss.completed_shifts, 0) AS completed_shifts,
  os.sla_ordered_shifts AS sla_ordered_shifts,
  ifNull(ss.sla_completed_shifts, 0) AS sla_completed_shifts,
  os.forecast_sla_ordered_shifts AS forecast_sla_ordered_shifts,
  ifNull(ss.forecast_sla_active_shifts, 0) AS forecast_sla_active_shifts,
  os.active_days AS active_days,
  ifNull(ss.unique_completed_workers, 0) AS unique_completed_workers,
  ifNull(bw.unique_booked_workers, 0) AS unique_booked_workers,
  ifNull(ss.dropoffs_24h, 0) AS dropoffs_24h
FROM order_summary AS os
LEFT JOIN shift_summary AS ss ON 1 = 1
LEFT JOIN booked_workers AS bw ON 1 = 1
FORMAT JSONEachRow`;

const WORKPLACE_POINT_REVIEW_SUMMARY_SQL = `SELECT
  count() AS review_count,
  avgOrNull(rating) AS avg_rating_all,
  (
    SELECT avgOrNull(rating)
    FROM (
      SELECT r2.rating AS rating
      FROM mg_reviews AS r2
      INNER JOIN mg_jobs AS j2 ON r2.job = j2._id
      WHERE j2.workplace = {workplace_id:String}
        AND ifNull(r2.rating, 0) > 0
      ORDER BY r2.createdAt DESC, r2._id DESC
      LIMIT 10
    )
  ) AS avg_rating_last_10
FROM mg_reviews AS r
INNER JOIN mg_jobs AS j ON r.job = j._id
WHERE j.workplace = {workplace_id:String}
  AND ifNull(r.rating, 0) > 0
FORMAT JSONEachRow`;

const WORKPLACE_POINT_DAILY_SQL = `WITH filtered_orders AS (
  SELECT
    o._id AS order_id,
    toString(toDate(o.start)) AS period,
    o.start AS order_start,
    o.createdAt AS order_created_at,
    if(o.createdAt IS NOT NULL AND o.start IS NOT NULL AND o.createdAt <= o.start, dateDiff('minute', o.createdAt, o.start), NULL) AS order_lead_minutes,
    ifNull(o.amount, 0) AS amount,
    o.pieceworks AS pieceworks,
    if(ifNull(p.caption, '') = '', o.spec, p.caption) AS profession
  FROM mg_orders AS o
  LEFT JOIN mg_professions AS p ON o.spec = p.spec
  WHERE <whereSql>
),
shift_facts AS (
  SELECT
    j._id AS job_id,
    j.source AS order_id,
    j.worker AS worker,
    j.status AS status,
    j.start AS start,
    j.hours AS hours,
    j.payment AS payment,
    j.salary_per_hour AS salary_per_hour,
    j.salary_per_job AS salary_per_job,
    j.start_fact AS start_fact,
    j.finish_fact AS finish_fact,
    ${successfulConfirmedShiftFlagExpression('j', { pieceworkExpression: 'fo.pieceworks' })} AS is_successful_confirmed_shift,
    ifNull(j.cancellation_reason, '') AS cancellation_reason,
    ifNull(j.failure_reason, '') AS failure_reason
  FROM mg_jobs AS j
  INNER JOIN filtered_orders AS fo ON j.source = fo.order_id
  WHERE j.deleted = 0
),
drop_events AS (
  SELECT
    h.job AS job_id,
    minIf(coalesce(h.createdAt, h.updatedAt), (ifNull(h.status, '') IN ('cancelled', 'failed') OR ifNull(h.cancellation_reason, '') != '' OR ifNull(h.failure_reason, '') != '') AND (ifNull(h.initiator, '') = 'worker' OR ifNull(h.status, '') = 'failed' OR ifNull(h.failure_reason, '') != '')) AS drop_at
  FROM mg_job_history AS h
  INNER JOIN shift_facts AS sf ON h.job = sf.job_id
  GROUP BY h.job
),
order_daily AS (
  SELECT
    period,
    sum(amount) AS ordered_shifts,
    avgOrNull(order_lead_minutes) AS avg_order_lead_minutes,
    minOrNull(order_lead_minutes) AS min_order_lead_minutes
  FROM filtered_orders
  GROUP BY period
),
shift_daily AS (
  SELECT
    toString(toDate(sf.start)) AS period,
    countIf(sf.is_successful_confirmed_shift = 1) AS completed_shifts,
    countIf(ifNull(sf.status, '') IN ('booked', 'going', 'delayed', 'waiting', 'checkingin', 'inprogress', 'checkingout', 'completed', 'confirmed') AND toDate(sf.start) >= {current_date:Date}) AS forecast_sla_active_shifts,
    uniqExactIf(sf.job_id, de.drop_at IS NOT NULL AND sf.start IS NOT NULL AND de.drop_at >= sf.start - INTERVAL 24 HOUR AND de.drop_at <= sf.start) AS dropoffs_24h
  FROM shift_facts AS sf
  LEFT JOIN drop_events AS de ON sf.job_id = de.job_id
  GROUP BY period
)
SELECT
  od.period AS period,
  od.ordered_shifts AS ordered_shifts,
  od.avg_order_lead_minutes AS avg_order_lead_minutes,
  od.min_order_lead_minutes AS min_order_lead_minutes,
  ifNull(sd.completed_shifts, 0) AS completed_shifts,
  ifNull(sd.forecast_sla_active_shifts, 0) AS forecast_sla_active_shifts,
  ifNull(sd.dropoffs_24h, 0) AS dropoffs_24h
FROM order_daily AS od
LEFT JOIN shift_daily AS sd ON od.period = sd.period
ORDER BY od.period
FORMAT JSONEachRow`;

const WORKPLACE_POINT_PROFESSIONS_SQL = `WITH filtered_orders AS (
  SELECT
    o._id AS order_id,
    ifNull(o.amount, 0) AS amount,
    if(ifNull(p.caption, '') = '', o.spec, p.caption) AS profession
  FROM mg_orders AS o
  LEFT JOIN mg_professions AS p ON o.spec = p.spec
  WHERE <whereSql>
)
SELECT
  profession AS profession,
  sum(amount) AS ordered_shifts
FROM filtered_orders
GROUP BY profession
ORDER BY ordered_shifts DESC, profession
FORMAT JSONEachRow`;

const WORKPLACE_POINT_RADIUS_SQL = `WITH workplace AS (
  SELECT location__coordinates AS workplace_coordinates
  FROM mg_workplaces
  WHERE _id = {workplace_id:String}
    AND length(location__coordinates) >= 2
  LIMIT 1
),
radii AS (
  SELECT arrayJoin([5, 10, 15, 20]) AS radius_km
),
active_workers AS (
  SELECT
    _id AS worker_id,
    user AS user_id,
    location__coordinates AS worker_coordinates
  FROM mg_workers
  WHERE length(location__coordinates) >= 2
    AND ifNull(deleted, 0) = 0
    AND ifNull(status, '') IN ('ready', 'worked', 'booked')
),
active_session_users AS (
  SELECT DISTINCT ifNull(profile_id, '') AS user_id
  FROM appmetrica_sessions
  WHERE ifNull(profile_id, '') != ''
    AND parseDateTimeBestEffortOrNull(session_start_datetime) >= {active_session_from:DateTime}
    AND parseDateTimeBestEffortOrNull(session_start_datetime) < {active_session_to:DateTime}
)
SELECT
  r.radius_km AS radius_km,
  uniqExactIf(
    aw.worker_id,
    greatCircleDistance(
      w.workplace_coordinates[1],
      w.workplace_coordinates[2],
      aw.worker_coordinates[1],
      aw.worker_coordinates[2]
    ) <= r.radius_km * 1000
  ) AS workers,
  uniqExactIf(
    aw.worker_id,
    greatCircleDistance(
      w.workplace_coordinates[1],
      w.workplace_coordinates[2],
      aw.worker_coordinates[1],
      aw.worker_coordinates[2]
    ) <= r.radius_km * 1000
    AND asu.user_id != ''
  ) AS active_session_workers
FROM radii AS r
CROSS JOIN workplace AS w
CROSS JOIN active_workers AS aw
LEFT JOIN active_session_users AS asu ON aw.user_id = asu.user_id
GROUP BY r.radius_km
ORDER BY r.radius_km
FORMAT JSONEachRow`;

const CITY_SUMMARY_SQL = `WITH filtered_orders AS (
  SELECT
    o._id AS order_id,
    o.workplace AS workplace_id,
    toString(toDate(o.start)) AS period,
    ifNull(o.amount, 0) AS amount,
    ifNull(o.salary_per_hour, 0) AS salary_per_hour,
    ifNull(c.title, '') AS brand,
    if(ifNull(p.caption, '') = '', o.spec, p.caption) AS profession,
    o.pieceworks AS pieceworks,
    w.location__coordinates AS workplace_coordinates,
    ifNull(o.deleted, 0) = 0 AS is_active_request
  FROM mg_orders AS o
  LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
  LEFT JOIN mg_clients AS c ON o.client = c._id
  LEFT JOIN mg_professions AS p ON o.spec = p.spec
  LEFT JOIN mg_contractors AS ct ON w.contractor = ct._id
  WHERE <whereSql>
),
city_workplaces AS (
  SELECT DISTINCT workplace_coordinates
  FROM filtered_orders
  WHERE length(workplace_coordinates) >= 2
),
city_bounds AS (
  SELECT
    count() AS robust_points,
    min(workplace_coordinates[1]) AS min_lon,
    max(workplace_coordinates[1]) AS max_lon,
    min(workplace_coordinates[2]) AS min_lat,
    max(workplace_coordinates[2]) AS max_lat,
    15000 / 111000 AS lat_margin,
    15000 / (111320 * greatest(abs(cos(((min(workplace_coordinates[2]) + max(workplace_coordinates[2])) / 2) * pi() / 180)), 0.2)) AS lon_margin
  FROM city_workplaces
),
candidate_workers AS (
  SELECT
    worker.user AS user_id,
    worker.status AS status,
    worker.location__coordinates AS location__coordinates
  FROM mg_workers AS worker
  CROSS JOIN city_bounds AS bounds
  WHERE bounds.robust_points > 0
    AND ifNull(worker.user, '') != ''
    AND length(worker.location__coordinates) >= 2
),
located_users AS (
  SELECT
    worker.user_id AS user_id,
    max(ifNull(worker.status, '') IN ('ready', 'booked', 'worked')) AS is_ready_base,
    max(ifNull(worker.status, '') = 'ready') AS is_ready_status,
    max(ifNull(worker.status, '') = 'booked') AS is_booked_status,
    max(ifNull(worker.status, '') = 'worked') AS is_worked_status
  FROM candidate_workers AS worker
  CROSS JOIN city_workplaces AS cw
  WHERE greatCircleDistance(cw.workplace_coordinates[1], cw.workplace_coordinates[2], worker.location__coordinates[1], worker.location__coordinates[2]) <= 15000
  GROUP BY user_id
),
app_active_users AS (
  SELECT DISTINCT ifNull(s.profile_id, '') AS user_id
  FROM appmetrica_sessions AS s
  INNER JOIN located_users AS located ON located.user_id = ifNull(s.profile_id, '')
  WHERE ifNull(s.profile_id, '') != ''
    AND parseDateTimeBestEffortOrNull(s.session_start_datetime) >= {from:DateTime}
    AND parseDateTimeBestEffortOrNull(s.session_start_datetime) < {to:DateTime}
),
app_30d_active_users AS (
  SELECT DISTINCT located.user_id AS user_id, located.is_ready_status, located.is_booked_status, located.is_worked_status
  FROM appmetrica_sessions AS s
  INNER JOIN located_users AS located ON located.user_id = ifNull(s.profile_id, '')
  WHERE ifNull(s.profile_id, '') != ''
    AND parseDateTimeBestEffortOrNull(s.session_start_datetime) >= {active_30d_from:DateTime}
    AND parseDateTimeBestEffortOrNull(s.session_start_datetime) < {active_30d_to:DateTime}
),
booked_users AS (
  SELECT DISTINCT worker.user AS user_id
  FROM mg_job_history AS history
  INNER JOIN mg_jobs AS job ON history.job = job._id
  INNER JOIN filtered_orders AS fo ON job.source = fo.order_id
  INNER JOIN mg_workers AS worker ON history.worker = worker._id
  WHERE ifNull(history.status, '') = 'booked'
    AND ifNull(worker.user, '') != ''
),
completed_users AS (
  SELECT DISTINCT worker.user AS user_id
  FROM (
    SELECT
      job.worker AS worker,
      ${successfulConfirmedShiftFlagExpression('job', { pieceworkExpression: 'fo.pieceworks' })} AS is_successful_confirmed_shift
    FROM mg_jobs AS job
    INNER JOIN filtered_orders AS fo ON job.source = fo.order_id
    WHERE ifNull(job.deleted, 0) = 0
  ) AS job
  INNER JOIN mg_workers AS worker ON job.worker = worker._id
  WHERE job.is_successful_confirmed_shift = 1
    AND ifNull(worker.user, '') != ''
),
daily_30d_ratio AS (
  SELECT <daily_30d_active_users_per_request> AS avg_ratio
)
SELECT
  (SELECT sum(amount) FROM filtered_orders) AS ordered_shifts,
  (SELECT countDistinctIf(order_id, is_active_request) FROM filtered_orders) AS active_order_requests,
  (SELECT uniqExact(user_id) FROM located_users) AS total_located_users,
  (SELECT uniqExactIf(located.user_id, located.is_ready_base) FROM located_users AS located) AS ready_located_users,
  (SELECT uniqExact(user_id) FROM app_active_users) AS app_active_users,
  (SELECT uniqExact(user_id) FROM app_30d_active_users) AS app_30d_active_users,
  (SELECT uniqExact(user_id) FROM booked_users) AS booked_users,
  (SELECT uniqExact(user_id) FROM completed_users) AS completed_users,
  ifNull((SELECT avg_ratio FROM daily_30d_ratio), 0) AS avg_daily_30d_active_users_per_request
FORMAT JSONEachRow`;

function cityCompositionSql(dimensionExpression) {
  return `WITH filtered_orders AS (
  SELECT
    ifNull(o.amount, 0) AS amount,
    ifNull(c.title, '') AS brand,
    if(ifNull(p.caption, '') = '', o.spec, p.caption) AS profession,
    ifNull(o.salary_per_hour, 0) AS salary_per_hour
  FROM mg_orders AS o
  LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
  LEFT JOIN mg_clients AS c ON o.client = c._id
  LEFT JOIN mg_professions AS p ON o.spec = p.spec
  LEFT JOIN mg_contractors AS ct ON w.contractor = ct._id
  WHERE <whereSql>
),
ranked AS (
  SELECT
    ${dimensionExpression} AS label,
    sum(amount) AS ordered_shifts
  FROM filtered_orders
  GROUP BY label
  HAVING label != ''
  ORDER BY ordered_shifts DESC, label
  LIMIT 8
),
display_total AS (
  SELECT sum(ordered_shifts) AS total_ordered_shifts
  FROM ranked
)
SELECT
  ranked.label AS label,
  ranked.ordered_shifts AS ordered_shifts,
  if(display_total.total_ordered_shifts > 0, ranked.ordered_shifts / display_total.total_ordered_shifts * 100, 0) AS share_percent
FROM ranked
CROSS JOIN display_total
ORDER BY ordered_shifts DESC, label
FORMAT JSONEachRow`;
}

const CITY_COMPOSITION_SQL = cityCompositionSql('<brand_or_profession>');
const CITY_COMPOSITION_BRANDS_SQL = cityCompositionSql('brand');
const CITY_COMPOSITION_PROFESSIONS_SQL = cityCompositionSql('profession');

const CITY_RATE_BUCKETS_SQL = `WITH filtered_orders AS (
  SELECT
    ifNull(o.amount, 0) AS amount,
    ifNull(c.title, '') AS brand,
    if(ifNull(p.caption, '') = '', o.spec, p.caption) AS profession,
    ifNull(o.salary_per_hour, 0) AS salary_per_hour
  FROM mg_orders AS o
  LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
  LEFT JOIN mg_clients AS c ON o.client = c._id
  LEFT JOIN mg_professions AS p ON o.spec = p.spec
  LEFT JOIN mg_contractors AS ct ON w.contractor = ct._id
  WHERE <whereSql>
),
grouped AS (
  SELECT
    multiIf(
      salary_per_hour < 250, '0-250',
      salary_per_hour < 350, '250-350',
      salary_per_hour < 450, '350-450',
      '450+'
    ) AS label,
    sum(amount) AS ordered_shifts,
    avgIf(salary_per_hour, salary_per_hour > 0) AS avg_salary_per_hour
  FROM filtered_orders
  GROUP BY label
),
display_total AS (
  SELECT sum(ordered_shifts) AS total_ordered_shifts
  FROM grouped
)
SELECT
  grouped.label AS label,
  grouped.ordered_shifts AS ordered_shifts,
  if(display_total.total_ordered_shifts > 0, grouped.ordered_shifts / display_total.total_ordered_shifts * 100, 0) AS share_percent,
  grouped.avg_salary_per_hour AS avg_salary_per_hour
FROM grouped
CROSS JOIN display_total
ORDER BY label
FORMAT JSONEachRow`;

const CITY_DYNAMICS_SQL = `WITH filtered_orders AS (
  SELECT
    o._id AS order_id,
    toString(toDate(o.start)) AS period,
    ifNull(o.amount, 0) AS amount,
    o.pieceworks AS pieceworks,
    w.location__coordinates AS workplace_coordinates,
    ifNull(o.deleted, 0) = 0 AS is_active_request
  FROM mg_orders AS o
  LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
  LEFT JOIN mg_clients AS c ON o.client = c._id
  LEFT JOIN mg_professions AS p ON o.spec = p.spec
  LEFT JOIN mg_contractors AS ct ON w.contractor = ct._id
  WHERE <whereSql>
),
located_users AS (
  SELECT <city_15km_located_users> AS user_id
),
daily_orders AS (
  SELECT
    period,
    sum(amount) AS ordered_shifts,
    countDistinctIf(order_id, is_active_request) AS active_order_requests
  FROM filtered_orders
  GROUP BY period
),
daily_app AS (
  SELECT
    toString(toDate(parseDateTimeBestEffortOrNull(s.session_start_datetime))) AS period,
    uniqExact(ifNull(s.profile_id, '')) AS app_active_users
  FROM appmetrica_sessions AS s
  INNER JOIN located_users AS located ON located.user_id = ifNull(s.profile_id, '')
  WHERE ifNull(s.profile_id, '') != ''
    AND parseDateTimeBestEffortOrNull(s.session_start_datetime) >= {from:DateTime}
    AND parseDateTimeBestEffortOrNull(s.session_start_datetime) < {to:DateTime}
  GROUP BY period
),
daily_booked AS (
  SELECT
    fo.period AS period,
    uniqExact(worker.user) AS booked_users
  FROM mg_job_history AS history
  INNER JOIN mg_jobs AS job ON history.job = job._id
  INNER JOIN filtered_orders AS fo ON job.source = fo.order_id
  INNER JOIN mg_workers AS worker ON history.worker = worker._id
  WHERE ifNull(history.status, '') = 'booked'
    AND ifNull(worker.user, '') != ''
  GROUP BY period
),
daily_completed AS (
  SELECT
    job.period AS period,
    uniqExact(worker.user) AS completed_users
  FROM (
    SELECT
      fo.period AS period,
      job.worker AS worker,
      ${successfulConfirmedShiftFlagExpression('job', { pieceworkExpression: 'fo.pieceworks' })} AS is_successful_confirmed_shift
    FROM mg_jobs AS job
    INNER JOIN filtered_orders AS fo ON job.source = fo.order_id
    WHERE ifNull(job.deleted, 0) = 0
  ) AS job
  INNER JOIN mg_workers AS worker ON job.worker = worker._id
  WHERE job.is_successful_confirmed_shift = 1
    AND ifNull(worker.user, '') != ''
  GROUP BY period
)
SELECT
  orders.period AS period,
  orders.ordered_shifts AS ordered_shifts,
  ifNull(app.app_active_users, 0) AS app_active_users,
  ifNull(booked.booked_users, 0) AS booked_users,
  ifNull(completed.completed_users, 0) AS completed_users,
  if(orders.active_order_requests > 0, ifNull(app.app_active_users, 0) / orders.active_order_requests, 0) AS active_users_per_request
FROM daily_orders AS orders
LEFT JOIN daily_app AS app ON app.period = orders.period
LEFT JOIN daily_booked AS booked ON booked.period = orders.period
LEFT JOIN daily_completed AS completed ON completed.period = orders.period
ORDER BY orders.period
FORMAT JSONEachRow`;

const HEATMAP_MAP_SQL = `WITH filtered_orders AS (
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
  LEFT JOIN mg_clients AS c ON o.client = c._id
  LEFT JOIN mg_professions AS p ON o.spec = p.spec
  WHERE ifNull(o.deleted, 0) = 0
    AND ifNull(o.is_hidden, 0) = 0
    AND o.start >= {from:DateTime}
    AND o.start < {to:DateTime}
    AND ifNull(o.amount, 0) > 0
    AND <optional_heatmap_filters>
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
    AND <activeWorkersWhere(filters)>
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
      greatCircleDistance(dp.lon, dp.lat, aw.worker_coordinates[1], aw.worker_coordinates[2]) AS distance_m
    FROM demand_points AS dp
    CROSS JOIN active_workers AS aw
    WHERE aw.worker_coordinates[1] BETWEEN dp.lon - (15000 / (111320 * greatest(abs(cos(dp.lat * pi() / 180)), 0.2))) AND dp.lon + (15000 / (111320 * greatest(abs(cos(dp.lat * pi() / 180)), 0.2)))
      AND aw.worker_coordinates[2] BETWEEN dp.lat - (15000 / 111000) AND dp.lat + (15000 / 111000)
      AND greatCircleDistance(dp.lon, dp.lat, aw.worker_coordinates[1], aw.worker_coordinates[2]) <= 15000
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

const HEATMAP_WORKER_CONCENTRATION_SQL = `WITH app_active_users AS (
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
  WHERE length(worker_coordinates) >= 2
    AND worker_coordinates[1] BETWEEN -180 AND 180
    AND worker_coordinates[2] BETWEEN -90 AND 90
    /* если activeBaseMode = 'ready': AND status IN ('ready', 'booked', 'worked') */
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

defineMetricSet({
  baseId: 'sales-by-project.summary',
  sql: SALES_DOMAIN_SUMMARY_SQL,
  metrics: [
    { id: 'sales-by-project.summary', title: 'Продажи по проектам', description: 'Показывает общий заказ, выполненные смены, SLA, выручку и связанные показатели за выбранный период. Часть значений собирается из двух запросов: по заказам и по сменам.' },
    { suffix: 'ordered-shifts', title: 'Заказано смен', description: 'Сумма планового количества смен из заказов за выбранный период.' },
    { suffix: 'worked-shifts', title: 'Отработано смен', description: 'Количество уникальных успешных подтвержденных смен в заданиях за выбранный период; нулевые прогулы исключаются.' },
    { suffix: 'sla', title: 'SLA', description: 'Доля выполненных смен от планового заказа. В UI показатель собирается из заказанных и успешных подтвержденных смен.' },
    { suffix: 'revenue-rub', title: 'Выручка, руб.', description: 'Расчетная выручка по успешным подтвержденным сменам с учетом типа договора, ставки и доплат.' },
    { suffix: 'unique-workers', title: 'Уникальные исполнители', description: 'Количество уникальных исполнителей с успешными подтвержденными сменами.' },
    { suffix: 'workplaces-with-orders', title: 'ТТ с заказами', description: 'Количество рабочих мест, по которым был плановый заказ.' },
    { suffix: 'workplaces-with-worked-shifts', title: 'ТТ с выполненными сменами', description: 'Количество рабочих мест, по которым были успешные подтвержденные смены.' },
    { suffix: 'cancelled-shifts', title: 'Отмены', description: 'Количество смен с причиной отмены или статусом failed.' },
    { suffix: 'self-booking-percent', title: 'Самоброни', description: 'Доля успешных подтвержденных смен, которые исполнитель забронировал сам.' },
    { suffix: 'avg-worker-rate-hour', title: 'Средняя ставка в час', description: 'Средняя часовая ставка исполнителя по успешным подтвержденным сменам.' }
  ]
});

defineMetricSet({
  baseId: 'sales-by-project.trend',
  sql: SALES_DOMAIN_TREND_SQL,
  metrics: [
    { id: 'sales-by-project.trend', title: 'Динамика продаж', description: 'Показывает динамику заказа, выполнения, SLA, выручки и отмен по выбранной периодизации.' },
    { suffix: 'ordered-shifts', title: 'Динамика: заказано', description: 'Плановый заказ по периодам.' },
    { suffix: 'worked-shifts', title: 'Динамика: отработано', description: 'Успешные подтвержденные смены по периодам.' },
    { suffix: 'sla', title: 'Динамика: SLA', description: 'Доля успешных подтвержденных смен от заказа по каждому периоду.' },
    { suffix: 'revenue-rub', title: 'Динамика: выручка', description: 'Расчетная выручка по успешным подтвержденным сменам в периоде.' },
    { suffix: 'cancelled-shifts', title: 'Динамика: отмены', description: 'Количество отмененных или failed смен по периодам.' },
    { suffix: 'chart', title: 'Динамика: график', description: 'Полоса в таблице строится по тем же строкам динамики и масштабируется относительно максимума выполненных смен.' }
  ]
});

defineMetricSet({
  baseId: 'sales-by-project.brands',
  sql: SALES_DOMAIN_BRANDS_SQL,
  metrics: [
    { id: 'sales-by-project.brands', title: 'Бренды', description: 'Показывает заказ, выполнение, SLA, выручку и связанные показатели в разрезе брендов клиентов.' },
    { suffix: 'ordered-shifts', title: 'Бренд: заказано', description: 'Плановый заказ по бренду.' },
    { suffix: 'worked-shifts', title: 'Бренд: отработано', description: 'Успешные подтвержденные смены по бренду.' },
    { suffix: 'sla', title: 'Бренд: SLA', description: 'Доля успешных подтвержденных смен от заказа по бренду.' },
    { suffix: 'revenue-rub', title: 'Бренд: выручка', description: 'Расчетная выручка по успешным подтвержденным сменам бренда.' },
    { suffix: 'unique-workers', title: 'Бренд: уникальные исполнители', description: 'Количество исполнителей с успешными подтвержденными сменами по бренду.' },
    { suffix: 'workplaces-with-orders', title: 'Бренд: ТТ с заказами', description: 'Количество рабочих мест бренда с плановым заказом.' },
    { suffix: 'workplaces-with-worked-shifts', title: 'Бренд: ТТ с выполнением', description: 'Количество рабочих мест бренда с успешными подтвержденными сменами.' },
    { suffix: 'cancelled-shifts', title: 'Бренд: отмены', description: 'Количество отмененных или failed смен по бренду.' },
    { suffix: 'self-booking-percent', title: 'Бренд: самоброни', description: 'Доля самоброни среди успешных подтвержденных смен бренда.' },
    { suffix: 'avg-worker-rate-hour', title: 'Бренд: средняя ставка', description: 'Средняя часовая ставка исполнителя по успешным подтвержденным сменам бренда.' }
  ]
});

defineMetricSet({
  baseId: 'sales-by-project.statuses',
  sql: SALES_DOMAIN_STATUSES_SQL,
  metrics: [
    { id: 'sales-by-project.statuses', title: 'Статусы работ', description: 'Показывает распределение смен по статусам в выбранном периоде.' },
    { suffix: 'shifts', title: 'Статусы работ: смены', description: 'Количество смен в конкретном статусе.' }
  ]
});

defineMetricSet({
  baseId: 'workplace-analysis.points',
  sql: WORKPLACE_ANALYSIS_POINTS_SQL,
  metrics: [
    { id: 'workplace-analysis.points', title: 'Анализ точек', description: 'Показывает рабочие места с заказом, SLA, стабильностью и дневной тепловой лентой.' },
    { suffix: 'ordered-shifts', title: 'Точка: заказано', description: 'Сумма планового заказа по рабочей точке.' },
    { suffix: 'sla', title: 'Точка: SLA', description: 'Доля успешных подтвержденных смен от заказа по рабочей точке.' },
    { suffix: 'stability', title: 'Точка: стабильность', description: 'Доля дней диапазона, в которые по точке был плановый заказ.' },
    { suffix: 'active-days', title: 'Точка: активные дни', description: 'Количество дней с заказом по точке относительно длины выбранного диапазона.' },
    { suffix: 'avg-daily-order', title: 'Точка: средний дневной заказ', description: 'Средний плановый заказ на активный день рабочей точки.' },
    { suffix: 'heatmap', title: 'Точка: дневная тепловая лента', description: 'Цвета дневной ленты строятся по дневному заказу и SLA из отдельного дневного запроса.', sql: WORKPLACE_ANALYSIS_DAILY_SQL },
    { suffix: 'active-gigers-5km', title: 'Точка: гигеры 5 км', description: 'Количество активных исполнителей, которые входили в приложение за последние 30 дней и находятся в радиусе 5 км от точки.', sql: ACTIVE_GIGERS_5KM_SQL }
  ]
});

defineMetricSet({
  baseId: 'workplace-analysis.attention',
  sql: WORKPLACE_ATTENTION_SQL,
  metrics: [
    { id: 'workplace-analysis.attention', title: 'Точки, требующие внимания', description: 'Показывает точки с незакрытым заказом на ближайшие 7 дней и базой исполнителей в радиусе 15 км.' },
    { suffix: 'free-7d', title: 'Требуют внимания: свободно 7 дней', description: 'Суммарный незакрытый заказ за ближайшие 7 дней.' },
    { suffix: 'coverage', title: 'Требуют внимания: покрытие', description: 'Доля заказа ближайших 7 дней, закрытая сменами в операционно закрывающих статусах.' },
    { suffix: 'total-workers-15km', title: 'Требуют внимания: вся база 15 км', description: 'Количество исполнителей с последней геолокацией в радиусе 15 км от точки.' },
    { suffix: 'active-workers-30d-15km', title: 'Требуют внимания: активная база 30 дней 15 км', description: 'Количество исполнителей в радиусе 15 км, которые входили в приложение за последние 30 дней.' },
    { suffix: 'active-workers-per-free-shift', title: 'Требуют внимания: актив / свободная', description: 'Отношение активной базы за 30 дней в радиусе 15 км к незакрытому заказу точки.' }
  ]
});

defineMetricSet({
  baseId: 'worker-cancellations.workers',
  sql: WORKER_CANCELLATIONS_SQL,
  metrics: [
    { id: 'worker-cancellations.workers', title: 'Отмены гигерами', description: 'Показывает исполнителей со сменами, отменами, поздними отменами и failed-сменами за выбранный период.' },
    { suffix: 'confirmed-shifts', title: 'Исполнитель: выполнено', description: 'Количество успешных подтвержденных смен исполнителя; нулевые прогулы исключаются.' },
    { suffix: 'worker-cancellations', title: 'Исполнитель: отмены worker', description: 'Количество отмененных смен, где событие отмены пришло от исполнителя.' },
    { suffix: 'worker-cancellations24h', title: 'Исполнитель: отмены worker < 24ч', description: 'Количество отмен исполнителем в интервале менее 24 часов до планового старта смены.' },
    { suffix: 'post-start-cancellations', title: 'Исполнитель: отмены после старта', description: 'Количество отмен, где событие отмены произошло после планового старта смены.' },
    { suffix: 'failed-shifts', title: 'Исполнитель: провалы / failed', description: 'Количество смен исполнителя со статусом failed.' }
  ]
});

defineMetricSet({
  baseId: 'workplace-point.summary',
  sql: WORKPLACE_POINT_SUMMARY_SQL,
  metrics: [
    { id: 'workplace-point.summary', title: 'Детализация точки: основные показатели', description: 'Показывает заказ, выполнение, SLA, стабильность, уникальных исполнителей и слеты по выбранной рабочей точке.' },
    { suffix: 'ordered-shifts', title: 'Детализация точки: заказано', description: 'Сумма планового количества смен по выбранной рабочей точке.' },
    { suffix: 'completed-shifts', title: 'Детализация точки: выполнено', description: 'Количество успешных подтвержденных смен по выбранной рабочей точке; нулевые прогулы исключаются.' },
    { suffix: 'sla', title: 'Детализация точки: SLA', description: 'Две доли: прошлое считается по успешным подтвержденным сменам до текущего дня, прогноз - по активным статусам с текущего дня до конца фильтра.' },
    { suffix: 'stability', title: 'Детализация точки: стабильность', description: 'Доля дней выбранного периода, в которые по точке был заказ.' },
    { suffix: 'unique-completed-workers', title: 'Детализация точки: уникальные завершали', description: 'Количество уникальных исполнителей, которые завершили смену на точке.' },
    { suffix: 'unique-booked-workers', title: 'Детализация точки: уникальные бронировали', description: 'Количество уникальных исполнителей, у которых была бронь смены на точке.' },
    { suffix: 'rating', title: 'Детализация точки: рейтинг', description: 'Средняя оценка точки по всем ненулевым отзывам и средняя по последним 10 оценкам.', sql: WORKPLACE_POINT_REVIEW_SUMMARY_SQL },
    { suffix: 'dropoffs-24h', title: 'Детализация точки: слеты < 24ч', description: 'Количество смен, где исполнительский слет зафиксирован менее чем за 24 часа до планового старта.' }
  ]
});

defineMetricSet({
  baseId: 'workplace-point.summary',
  sql: WORKPLACE_POINT_RADIUS_SQL,
  metrics: [
    { id: 'workplace-point.radius', title: 'База вокруг точки', description: 'Показывает количество исполнителей вокруг выбранной рабочей точки по радиусам 5, 10, 15 и 20 км.' },
    { suffix: 'radius-5km', title: 'База вокруг точки: 5 км', description: 'Количество исполнителей и активных в приложении исполнителей в радиусе 5 км от точки.' },
    { suffix: 'radius-10km', title: 'База вокруг точки: 10 км', description: 'Количество исполнителей и активных в приложении исполнителей в радиусе 10 км от точки.' },
    { suffix: 'radius-15km', title: 'База вокруг точки: 15 км', description: 'Количество исполнителей и активных в приложении исполнителей в радиусе 15 км от точки.' },
    { suffix: 'radius-20km', title: 'База вокруг точки: 20 км', description: 'Количество исполнителей и активных в приложении исполнителей в радиусе 20 км от точки.' }
  ]
});

defineMetricSet({
  baseId: 'workplace-point.charts',
  sql: WORKPLACE_POINT_DAILY_SQL,
  metrics: [
    { id: 'workplace-point.charts.calendar-ordered-shifts', title: 'Календарь точки: заказ', description: 'Дневной плановый заказ по выбранной точке.' },
    { id: 'workplace-point.charts.calendar-sla', title: 'Календарь точки: SLA', description: 'Для прошлых дней показывает фактический SLA, для текущего и будущих дней - прогнозный SLA по активным статусам.' },
    { id: 'workplace-point.charts.calendar-dropoffs-24h', title: 'Календарь точки: слеты < 24ч', description: 'Дневное количество исполнительских слетов менее чем за 24 часа до старта.' },
    { id: 'workplace-point.charts.calendar-order-lead-avg', title: 'Календарь точки: среднее размещение', description: 'Среднее время между созданием заказа и плановым стартом смены за день.' },
    { id: 'workplace-point.charts.calendar-order-lead-min', title: 'Календарь точки: минимальное размещение', description: 'Минимальное время между созданием заказа и плановым стартом смены за день.' },
    { id: 'workplace-point.charts.professions', title: 'Профессии точки', description: 'Распределение планового заказа выбранной точки по профессиям.', sql: WORKPLACE_POINT_PROFESSIONS_SQL }
  ]
});

defineMetricSet({
  baseId: 'city-analysis.summary',
  sql: CITY_SUMMARY_SQL,
  metrics: [
    { id: 'city-analysis.summary', title: 'Баланс спроса и базы', description: 'Сравнивает заказ в выбранном городе с базой исполнителей и активностью приложения.' },
    { suffix: 'ordered-shifts', title: 'Город: заказ', description: 'Сумма планового заказа в выбранном городе.' },
    { suffix: 'active-order-requests', title: 'Город: не удаленные заявки', description: 'Количество активных заявок без удаленных заказов.' },
    { suffix: 'total-located-users', title: 'Город: общая база', description: 'Количество пользователей-исполнителей с геолокацией в радиусе 15 км от точек спроса.' },
    { suffix: 'ready-located-users', title: 'Город: ready/booked/worked база', description: 'Количество пользователей базы со статусами ready, booked или worked.' },
    { suffix: 'app-active-users', title: 'Город: входили в приложение', description: 'Количество пользователей базы, входивших в приложение в выбранном периоде.' },
    { suffix: 'app-30d-active-users', title: 'Город: активные 30 дней', description: 'Количество пользователей базы, входивших в приложение за 30-дневное окно.' },
    { suffix: 'booked-users', title: 'Город: откликались', description: 'Количество пользователей, которые бронировали смены по заказам выбранного города.' },
    { suffix: 'completed-users', title: 'Город: завершали', description: 'Количество пользователей с успешными подтвержденными сменами по заказам выбранного города.' },
    { suffix: 'avg-daily-30d-active-users-per-request', title: 'Город: 30д активные / заявка', description: 'Среднее дневное отношение активной 30-дневной базы к количеству активных заявок.' }
  ]
});

defineMetricSet({
  baseId: 'city-analysis.composition',
  sql: CITY_COMPOSITION_SQL,
  metrics: [
    { id: 'city-analysis.composition', title: 'Состав заказа', description: 'Показывает, из каких брендов, профессий и ставок состоит плановый заказ в выбранном городе.' },
    { suffix: 'brands', title: 'Состав заказа: бренды', description: 'Показывает распределение планового заказа по брендам клиентов.', sql: CITY_COMPOSITION_BRANDS_SQL },
    { suffix: 'brands.ordered-shifts', title: 'Состав заказа: смены по бренду', description: 'Количество плановых смен и доля выбранного бренда в заказе города.', sql: CITY_COMPOSITION_BRANDS_SQL },
    { suffix: 'professions', title: 'Состав заказа: специальности', description: 'Показывает распределение планового заказа по специальностям.', sql: CITY_COMPOSITION_PROFESSIONS_SQL },
    { suffix: 'professions.ordered-shifts', title: 'Состав заказа: смены по специальности', description: 'Количество плановых смен и доля выбранной специальности в заказе города.', sql: CITY_COMPOSITION_PROFESSIONS_SQL },
    { suffix: 'rate-buckets', title: 'Состав заказа: ставки', description: 'Показывает распределение планового заказа по диапазонам часовой ставки.', sql: CITY_RATE_BUCKETS_SQL },
    { suffix: 'rate-buckets.ordered-shifts', title: 'Состав заказа: смены и средняя ставка', description: 'Количество плановых смен, доля диапазона ставки и средняя ставка внутри этого диапазона.', sql: CITY_RATE_BUCKETS_SQL }
  ]
});

defineMetricSet({
  baseId: 'city-analysis.dynamics',
  sql: CITY_DYNAMICS_SQL,
  metrics: [
    { id: 'city-analysis.dynamics', title: 'Динамика города', description: 'Показывает дневную динамику спроса, входов в приложение, откликов и завершений.' },
    { suffix: 'combo-ordered-shifts', title: 'Динамика города: заказ', description: 'Дневной плановый заказ в комбинированном графике.' },
    { suffix: 'combo-app-active-users', title: 'Динамика города: входы', description: 'Дневное количество пользователей базы, входивших в приложение.' },
    { suffix: 'combo-booked-users', title: 'Динамика города: отклики', description: 'Дневное количество пользователей, бронировавших смены.' },
    { suffix: 'combo-completed-users', title: 'Динамика города: завершения', description: 'Дневное количество пользователей, завершивших смены.' },
    { suffix: 'multiples-ordered-shifts', title: 'Small multiples: заказ', description: 'Отдельный дневной график планового заказа.' },
    { suffix: 'multiples-app-active-users', title: 'Small multiples: входы', description: 'Отдельный дневной график пользователей базы, входивших в приложение.' },
    { suffix: 'multiples-booked-users', title: 'Small multiples: отклики', description: 'Отдельный дневной график пользователей, бронировавших смены.' },
    { suffix: 'multiples-completed-users', title: 'Small multiples: завершения', description: 'Отдельный дневной график пользователей, завершивших смены.' },
    { suffix: 'multiples-active-users-per-request', title: 'Small multiples: актив / заявка', description: 'Отдельный дневной график отношения активных пользователей приложения к активным заявкам.' },
    { suffix: 'heatmap-ordered-shifts', title: 'Heatmap города: заказ', description: 'Дневной заказ в табличной тепловой карте динамики.' },
    { suffix: 'heatmap-app-active-users', title: 'Heatmap города: входы', description: 'Дневные входы пользователей базы в табличной тепловой карте.' },
    { suffix: 'heatmap-booked-users', title: 'Heatmap города: отклики', description: 'Дневные отклики пользователей в табличной тепловой карте.' },
    { suffix: 'heatmap-completed-users', title: 'Heatmap города: завершения', description: 'Дневные завершения смен пользователями в табличной тепловой карте.' },
    { suffix: 'heatmap-active-users-per-request', title: 'Heatmap города: актив / заявка', description: 'Дневное отношение активных пользователей приложения к активным заявкам.' },
    { suffix: 'funnel-ordered-shifts', title: 'Воронка города: заказ', description: 'Плановый заказ дня, рядом с которым сравниваются входы, отклики и завершения.' },
    { suffix: 'funnel-app-active-users', title: 'Воронка города: входы', description: 'Количество пользователей базы, входивших в приложение в этот день.' },
    { suffix: 'funnel-booked-users', title: 'Воронка города: отклики', description: 'Количество пользователей, бронировавших смены в этот день.' },
    { suffix: 'funnel-completed-users', title: 'Воронка города: завершения', description: 'Количество пользователей, завершивших смены в этот день.' },
    { suffix: 'index-ordered-shifts', title: 'Индексы города: заказ', description: 'Индекс дневного планового заказа относительно первого положительного значения периода.' },
    { suffix: 'index-app-active-users', title: 'Индексы города: входы', description: 'Индекс дневных входов в приложение относительно первого положительного значения периода.' },
    { suffix: 'index-booked-users', title: 'Индексы города: отклики', description: 'Индекс дневных откликов относительно первого положительного значения периода.' },
    { suffix: 'index-completed-users', title: 'Индексы города: завершения', description: 'Индекс дневных завершений относительно первого положительного значения периода.' },
    { suffix: 'index-active-users-per-request', title: 'Индексы города: актив / заявка', description: 'Индекс дневного отношения активных пользователей приложения к активным заявкам.' }
  ]
});

defineMetricSet({
  baseId: 'heatmap.map',
  sql: HEATMAP_MAP_SQL,
  metrics: [
    { id: 'heatmap.map', title: 'Карта баланса по точкам заказа', description: 'Показывает точки с заказом на карте и сравнивает плановый заказ с активной базой исполнителей рядом.' },
    { suffix: 'points-with-order', title: 'Тепловая карта: точки с заказом', description: 'Количество рабочих мест с координатами и заказом в выбранном периоде.' },
    { suffix: 'ordered-shifts', title: 'Тепловая карта: заказано смен', description: 'Сумма планового заказа по точкам на карте.' },
    { suffix: 'weighted-active-users', title: 'Тепловая карта: взвешенная база', description: 'Суммарный вклад активных исполнителей рядом с точками: до 5 км полный вес, 5-10 км половина, 10-15 км четверть.' },
    { suffix: 'avg-weighted-active-users-per-shift', title: 'Тепловая карта: база / смена', description: 'Отношение взвешенной активной базы к плановому заказу смен.' },
    { suffix: 'worker-concentration', title: 'Тепловая карта: концентрация исполнителей', description: 'Подключаемый слой пятен по координатам исполнителей, входивших в приложение за последние 30 дней относительно текущей даты.', sql: HEATMAP_WORKER_CONCENTRATION_SQL }
  ]
});

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getSqlMetricInfo(id) {
  const infoId = String(id || '');
  const info = SQL_METRIC_INFO[infoId];

  return info || null;
}

function sqlMetricInfoFor(id) {
  return getSqlMetricInfo(id);
}

function highlightSql(sql) {
  const keywords = [
    'LEFT JOIN',
    'INNER JOIN',
    'CROSS JOIN',
    'GROUP BY',
    'ORDER BY',
    'FORMAT',
    'SELECT',
    'WITH',
    'FROM',
    'WHERE',
    'HAVING',
    'LIMIT',
    'JOIN',
    'COUNTIF',
    'COUNTDISTINCTIF',
    'UNIQEXACTIF',
    'UNIQEXACT',
    'AVGIF',
    'SUMIF',
    'SUM',
    'TODATE',
    'IFNULL',
    'NULLIF',
    'COALESCE',
    'MULTIIF',
    'ON',
    'AS',
    'AND',
    'OR'
  ];
  const tokenPattern = /('[^']*')|(\{[A-Za-z0-9_]+:[A-Za-z0-9_(), ]+\})|(<[A-Za-z0-9_(), ]+>)/g;

  function highlightKeywords(text) {
    let result = escapeHtml(text);

    for (const keyword of keywords) {
      const pattern = new RegExp(`\\b${keyword.replace(' ', '\\s+')}\\b`, 'gi');
      result = result.replace(pattern, (match) => `<span class="sql-keyword">${match}</span>`);
    }

    return result;
  }

  let html = '';
  let lastIndex = 0;
  let match;

  while ((match = tokenPattern.exec(String(sql))) !== null) {
    html += highlightKeywords(String(sql).slice(lastIndex, match.index));

    if (match[1]) {
      html += `<span class="sql-string">${escapeHtml(match[1])}</span>`;
    } else {
      html += `<span class="sql-param">${escapeHtml(match[2] || match[3])}</span>`;
    }

    lastIndex = tokenPattern.lastIndex;
  }

  html += highlightKeywords(String(sql).slice(lastIndex));

  return html;
}

module.exports = {
  SQL_METRIC_INFO,
  getSqlMetricInfo,
  highlightSql,
  sqlMetricInfoFor
};
