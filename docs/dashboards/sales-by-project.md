# Дашборд `Продажи по проектам`

Код: `src/salesByProjectDashboard.js`. Маршрут: `/dashboards/sales-by-project`.

Дашборд показывает плановый спрос, выполненные смены, выручку и разрезы по брендам за выбранный период. Временное поле для заказов - `mg_orders.start`, для смен - `mg_jobs.start`. По умолчанию период - последние 90 дней, группировка - месяц.

## Доменные правила

- Заказы и смены считаются только через актуальные заказы: `mg_jobs.source = mg_orders._id`, `mg_orders.deleted = 0`, `mg_orders.is_hidden = false`.
- Из расчетов исключаются тестовые клиенты `MyGig ГПХ`, `MyGig Demo`, `Проверка выплаты Альфа-банк`, `Тест`, `ТестДляПроверки`, `ТестСдокументами`, `ООО «МгРу»`.
- Контракты `processing` исключаются через тип контрагента точки заказа и fallback на `mg_orders.contract_type`.
- Самобронь считается по первому непустому событию `mg_job_history` внутри конкретной смены через оконную нумерацию по `job`, а не по любому `booked` от `worker`.
- Транзакции по смене учитываются только при `deleted = false`; сумма берется со знаком и не ограничивается `transaction_type = 'surcharge'`.
- Для сделки признак берется из `mg_orders.pieceworks`; если он не пустой, нулевая фактическая клиентская оплата считается прогулом даже при `status = 'confirmed'`.
- Средние ставки считаются только по положительным nullable-ставкам; невалидные, пустые и нулевые значения не превращаются в валидную ставку для среднего.

## Фильтры и параметры SQL

- `period`: `day`, `week`, `month`, `quarter`.
- `from`, `to`: календарный диапазон, в SQL передаются как `{from:DateTime}` и `{to:DateTime}`; верхняя граница эксклюзивная.
- `period` превращается в выражение:

```sql
toDate(<field>)
toStartOfWeek(<field>)
toStartOfMonth(<field>)
toStartOfQuarter(<field>)
```

Базовый фильтр заказов:

```sql
o.deleted = 0
AND ifNull(o.is_hidden, false) = false
AND c.title NOT IN (<test_client_titles>)
AND ifNull(ct.contract_type, ifNull(o.contract_type, '')) != 'processing'
AND o.start >= {from:DateTime}
AND o.start < {to:DateTime}
```

## Общие CTE для смен

Большинство запросов по факту строятся через `actual_orders`, `shift_facts`, `history_ranked`, `first_history`, `job_transactions` и `shift_enriched`. Большой листинг ниже оставлен как форма CTE; актуальные проверяемые SQL-фрагменты доступны в SQL-инспекторе дашборда.

```sql
WITH shift_facts AS (
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
    row_number() OVER (PARTITION BY h.job ORDER BY coalesce(h.createdAt, h.updatedAt), h._id) AS rn
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
    if(
      ifNull(sf.status, '') = 'confirmed'
      AND (
        ifNull(sf.hours, 0) > 0
        OR ifNull(sf.payment, 0) > 0
        OR ifNull(sf.salary_per_job, 0) > 0
        OR ifNull(sf.salary_per_hour, 0) * ifNull(sf.hours, 0) > 0
        OR (
          sf.start_fact IS NOT NULL
          AND sf.finish_fact IS NOT NULL
          AND sf.finish_fact > sf.start_fact
          AND dateDiff('minute', sf.start_fact, sf.finish_fact) > 0
        )
      ),
      1,
      0
    ) AS is_successful_confirmed_shift
  FROM shift_facts AS sf
  LEFT JOIN mg_orders AS o ON sf.source = o._id
  LEFT JOIN mg_workplaces AS w ON coalesce(nullIf(sf.workplace, ''), o.workplace) = w._id
  LEFT JOIN mg_contractors AS ct ON w.contractor = ct._id
  LEFT JOIN self_bookings AS sb ON sf.job = sb.job
  LEFT JOIN surcharges AS s ON sf.job = s.job
)
```

Успешная `confirmed`-смена должна иметь ненулевую длительность, начисление/выплату или положительный фактический интервал. `confirmed`-смена с длительностью `0:00` и нулевым начислением/выплатой считается прогулом и не участвует в факте, SLA и выручке. Для сделки с непустым `mg_orders.pieceworks` требуется положительная фактическая клиентская оплата.

Выручка считается только по `is_successful_confirmed_shift = 1`:

```sql
if(is_successful_confirmed_shift = 1,
  if(contract_type = 'saas',
    worker_shift_amount * (1 + commission_percent / 100) + surcharge_amount,
    customer_shift_amount + surcharge_amount
  ),
  0
)
```

## SQL: summary

Плановый спрос:

```sql
SELECT
  sum(o.amount) AS ordered_shifts,
  countDistinctIf(o.workplace, o.workplace != '') AS workplaces_with_orders
FROM mg_orders AS o
WHERE o.deleted = 0
  AND o.start >= {from:DateTime}
  AND o.start < {to:DateTime}
FORMAT JSONEachRow
```

Факт смен:

```sql
WITH ... shift_enriched AS (...)
SELECT
  uniqExactIf(job, is_successful_confirmed_shift = 1 AND job != '') AS worked_shifts,
  sum(<revenue_expression>) AS revenue_rub,
  uniqExactIf(worker, is_successful_confirmed_shift = 1 AND worker != '') AS unique_workers,
  uniqExactIf(workplace, is_successful_confirmed_shift = 1 AND workplace != '') AS workplaces_with_worked_shifts,
  countIf(ifNull(cancellation_reason, '') != '' OR status = 'failed') AS cancelled_shifts,
  countIf(is_successful_confirmed_shift = 1 AND is_self_booked = 1) AS self_booked_confirmed_shifts,
  avgIf(salary_per_hour, is_successful_confirmed_shift = 1 AND salary_per_hour > 0) AS avg_worker_rate_hour
FROM shift_enriched
FORMAT JSONEachRow
```

## SQL: trend

План по периодам:

```sql
SELECT
  <period_expression_for_o.start> AS period,
  sum(o.amount) AS ordered_shifts
FROM mg_orders AS o
WHERE o.deleted = 0
  AND o.start >= {from:DateTime}
  AND o.start < {to:DateTime}
GROUP BY period
ORDER BY period
FORMAT JSONEachRow
```

Факт по периодам:

```sql
WITH ... shift_enriched AS (...)
SELECT
  <period_expression_for_shift_start> AS period,
  uniqExactIf(job, is_successful_confirmed_shift = 1 AND job != '') AS worked_shifts,
  sum(<revenue_expression>) AS revenue_rub,
  countIf(ifNull(cancellation_reason, '') != '' OR status = 'failed') AS cancelled_shifts
FROM shift_enriched
GROUP BY period
ORDER BY period
FORMAT JSONEachRow
```

## SQL: brands

План по брендам:

```sql
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
FORMAT JSONEachRow
```

Факт по брендам:

```sql
WITH ... shift_enriched AS (...)
SELECT
  ifNull(nullIf(c.title, ''), 'Без бренда') AS brand,
  uniqExactIf(job, is_successful_confirmed_shift = 1 AND job != '') AS worked_shifts,
  sum(<revenue_expression>) AS revenue_rub,
  uniqExactIf(worker, is_successful_confirmed_shift = 1 AND worker != '') AS unique_workers,
  uniqExactIf(workplace, is_successful_confirmed_shift = 1 AND workplace != '') AS workplaces_with_worked_shifts,
  countIf(ifNull(cancellation_reason, '') != '' OR status = 'failed') AS cancelled_shifts,
  countIf(is_successful_confirmed_shift = 1 AND is_self_booked = 1) AS self_booked_confirmed_shifts,
  avgIf(salary_per_hour, is_successful_confirmed_shift = 1 AND salary_per_hour > 0) AS avg_worker_rate_hour
FROM shift_enriched
LEFT JOIN mg_clients AS c ON shift_enriched.client = c._id
GROUP BY brand
ORDER BY worked_shifts DESC
FORMAT JSONEachRow
```

## SQL: statuses

```sql
WITH shift_facts AS (
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
    j.hours AS hours
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
FORMAT JSONEachRow
```

## Метрики

- `orderedShifts`: сумма `mg_orders.amount`; плановое количество исполнителей в заказах.
- `workedShifts`: `uniqExactIf(job, is_successful_confirmed_shift = 1)`; факт успешно выполненных смен без прогулов с `0:00` и нулевым начислением/выплатой.
- `slaPercent`: `workedShifts / orderedShifts * 100`; показывает покрытие планового спроса фактом.
- `revenueRub`: сумма выражения выручки; для `saas` берется сумма исполнителя с комиссией подрядчика, для остальных контрактов клиентская стоимость, в обоих случаях добавляются подписанные неудаленные транзакции по смене.
- `uniqueWorkers`: уникальные исполнители успешных подтвержденных смен.
- `workplacesWithOrders`: уникальные точки в заказах.
- `workplacesWithWorkedShifts`: уникальные точки с успешными подтвержденными сменами.
- `cancelledShifts`: смены с непустой причиной отмены или `status = 'failed'`.
- `selfBookingPercent`: `self_booked_confirmed_shifts / workedShifts * 100`; доля выполненных смен, где первое непустое событие истории смены создано `initiator = 'worker'`.
- `avgWorkerRateHour`: средний `salary_per_hour` по успешным подтвержденным сменам с положительной nullable-ставкой.
- `statusRows.shifts`: количество смен по каждому статусу в `mg_jobs`.
