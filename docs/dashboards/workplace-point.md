# Дашборд `Карточка точки`

Код: `src/workplacePointDashboard.js`. Маршрут открывается из `Анализа точек` для конкретного `workplaceId`.

Экран показывает паспорт точки, спрос и факт по дням, распределение по специальностям, активную базу в радиусах 5/10/15/20 км и детализацию конкретного дня.

## Доменные правила

- Все заказы точки фильтруются как актуальные: не удаленные, не скрытые, без тестовых клиентов и без `processing`.
- Контрагент определяется через рабочее место заказа: `mg_orders.workplace -> mg_workplaces._id -> mg_contractors._id`.
- Смены в `shift_facts`, деталях дня и истории связываются с уже отфильтрованными заказами через `mg_jobs.source = filtered_orders.order_id`.
- Успешные `confirmed` используют общее правило исключения прогулов: для сделки признак берется из `mg_orders.pieceworks`, и нулевая фактическая клиентская оплата не считается успешным выполнением.
- Агрегатные summary CTE соединяются обычным `LEFT JOIN` по явной колонке-константе `aggregate_join_key`; `CROSS JOIN` оставлен только в радиусной гео-логике.

## Фильтры

- `{workplace_id:String}` - обязательный id точки.
- `{from:DateTime}`, `{to:DateTime}` - период по `mg_orders.start`.
- `{active_session_from:DateTime}`, `{active_session_to:DateTime}` - окно AppMetrica-сессий за последние 30 дней от текущего времени.
- Массивы: `{professions:Array(String)}`, `{order_types:Array(String)}`, `{job_statuses:Array(String)}`.

Базовый фильтр заказов:

```sql
o.workplace = {workplace_id:String}
AND o.start >= {from:DateTime}
AND o.start < {to:DateTime}
AND ifNull(o.amount, 0) > 0
```

При выключенных опциях включения удаленных/скрытых заказов добавляются:

```sql
ifNull(o.deleted, 0) = 0
AND ifNull(o.is_hidden, 0) = 0
```

Фильтр статусов использует подзапрос:

```sql
o._id IN (
  SELECT DISTINCT j.source
  FROM mg_jobs AS j
  WHERE j.deleted = 0
    AND ifNull(j.source, '') != ''
    AND ifNull(j.status, '') IN {job_statuses:Array(String)}
)
```

## SQL: metadata

```sql
SELECT
  w._id AS workplace_id,
  ifNull(w.title, '') AS workplace_title,
  ifNull(w.technical_name, '') AS technical_name,
  ifNull(c.title, '') AS client_title,
  ifNull(w.address__city, '') AS city,
  ifNull(w.address__region, '') AS region,
  ifNull(w.address__street, '') AS street
FROM mg_workplaces AS w
LEFT JOIN mg_clients AS c ON w.client = c._id
WHERE w._id = {workplace_id:String}
LIMIT 1
FORMAT JSONEachRow
```

## SQL: опции фильтров

```sql
SELECT 'profession' AS filter, if(ifNull(p.caption, '') = '', o.spec, p.caption) AS value
FROM mg_orders AS o
LEFT JOIN mg_professions AS p ON o.spec = p.spec
WHERE <where_without_profession_orderType_jobStatus>
GROUP BY value
HAVING value != ''
UNION ALL
SELECT 'orderType' AS filter, ifNull(o.type, '') AS value
FROM mg_orders AS o
LEFT JOIN mg_professions AS p ON o.spec = p.spec
WHERE <where_without_profession_orderType_jobStatus>
GROUP BY value
HAVING value != ''
UNION ALL
SELECT 'jobStatus' AS filter, ifNull(j.status, '') AS value
FROM mg_orders AS o
INNER JOIN mg_jobs AS j ON j.source = o._id
LEFT JOIN mg_professions AS p ON o.spec = p.spec
WHERE <where_without_profession_orderType_jobStatus>
  AND j.deleted = 0
GROUP BY value
HAVING value != ''
ORDER BY filter, value
FORMAT JSONEachRow
```

## Общие CTE

```sql
filtered_orders AS (
  SELECT
    o._id AS order_id,
    toString(toDate(o.start)) AS period,
    o.start AS order_start,
    o.createdAt AS order_created_at,
    if(
      o.createdAt IS NOT NULL
      AND o.start IS NOT NULL
      AND o.createdAt <= o.start,
      dateDiff('minute', o.createdAt, o.start),
      NULL
    ) AS order_lead_minutes,
    ifNull(o.amount, 0) AS amount,
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
    if(
      ifNull(j.status, '') = 'confirmed'
      AND (
        ifNull(j.hours, 0) > 0
        OR ifNull(j.payment, 0) > 0
        OR ifNull(j.salary_per_job, 0) > 0
        OR ifNull(j.salary_per_hour, 0) * ifNull(j.hours, 0) > 0
        OR (
          j.start_fact IS NOT NULL
          AND j.finish_fact IS NOT NULL
          AND j.finish_fact > j.start_fact
          AND dateDiff('minute', j.start_fact, j.finish_fact) > 0
        )
      ),
      1,
      0
    ) AS is_successful_confirmed_shift,
    ifNull(j.cancellation_reason, '') AS cancellation_reason,
    ifNull(j.failure_reason, '') AS failure_reason
  FROM mg_jobs AS j
  INNER JOIN filtered_orders AS fo ON j.source = fo.order_id
  WHERE j.deleted = 0
),
drop_events AS (
  SELECT
    h.job AS job_id,
    minIf(
      coalesce(h.createdAt, h.updatedAt),
      (
        ifNull(h.status, '') IN ('cancelled', 'failed')
        OR ifNull(h.cancellation_reason, '') != ''
        OR ifNull(h.failure_reason, '') != ''
      )
      AND (
        ifNull(h.initiator, '') = 'worker'
        OR ifNull(h.status, '') = 'failed'
        OR ifNull(h.failure_reason, '') != ''
      )
    ) AS drop_at
  FROM mg_job_history AS h
  INNER JOIN shift_facts AS sf ON h.job = sf.job_id
  GROUP BY h.job
),
booked_workers AS (
  SELECT
    1 AS aggregate_join_key,
    uniqExact(ifNull(h.worker, '')) AS unique_booked_workers
  FROM mg_job_history AS h
  INNER JOIN shift_facts AS sf ON h.job = sf.job_id
  WHERE ifNull(h.status, '') = 'booked'
    AND ifNull(h.worker, '') != ''
)
```

## SQL: summary

```sql
WITH <common_cte>,
order_summary AS (
  SELECT
    1 AS aggregate_join_key,
    sum(amount) AS ordered_shifts,
    countDistinct(period) AS active_days
  FROM filtered_orders
),
shift_summary AS (
  SELECT
    1 AS aggregate_join_key,
    countIf(is_successful_confirmed_shift = 1) AS completed_shifts,
    uniqExactIf(worker, is_successful_confirmed_shift = 1 AND worker != '') AS unique_completed_workers,
    uniqExactIf(
      sf.job_id,
      de.drop_at IS NOT NULL
      AND sf.start IS NOT NULL
      AND de.drop_at >= sf.start - INTERVAL 24 HOUR
      AND de.drop_at <= sf.start
    ) AS dropoffs_24h
  FROM shift_facts AS sf
  LEFT JOIN drop_events AS de ON sf.job_id = de.job_id
)
SELECT
  os.ordered_shifts AS ordered_shifts,
  ifNull(ss.completed_shifts, 0) AS completed_shifts,
  os.active_days AS active_days,
  ifNull(ss.unique_completed_workers, 0) AS unique_completed_workers,
  ifNull(bw.unique_booked_workers, 0) AS unique_booked_workers,
  ifNull(ss.dropoffs_24h, 0) AS dropoffs_24h
FROM order_summary AS os
LEFT JOIN shift_summary AS ss ON os.aggregate_join_key = ss.aggregate_join_key
LEFT JOIN booked_workers AS bw ON os.aggregate_join_key = bw.aggregate_join_key
FORMAT JSONEachRow
```

## SQL: daily

```sql
WITH <filtered_orders>, <shift_facts>, <drop_events>,
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
    uniqExactIf(
      sf.job_id,
      de.drop_at IS NOT NULL
      AND sf.start IS NOT NULL
      AND de.drop_at >= sf.start - INTERVAL 24 HOUR
      AND de.drop_at <= sf.start
    ) AS dropoffs_24h
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
  ifNull(sd.dropoffs_24h, 0) AS dropoffs_24h
FROM order_daily AS od
LEFT JOIN shift_daily AS sd ON od.period = sd.period
ORDER BY od.period
FORMAT JSONEachRow
```

## SQL: professions

```sql
WITH <filtered_orders>
SELECT
  profession AS profession,
  sum(amount) AS ordered_shifts
FROM filtered_orders
GROUP BY profession
ORDER BY ordered_shifts DESC, profession
FORMAT JSONEachRow
```

## SQL: radius workers

```sql
WITH workplace AS (
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
  uniqExactIf(aw.worker_id, greatCircleDistance(w.workplace_coordinates[1], w.workplace_coordinates[2], aw.worker_coordinates[1], aw.worker_coordinates[2]) <= r.radius_km * 1000) AS workers,
  uniqExactIf(aw.worker_id, greatCircleDistance(w.workplace_coordinates[1], w.workplace_coordinates[2], aw.worker_coordinates[1], aw.worker_coordinates[2]) <= r.radius_km * 1000 AND asu.user_id != '') AS active_session_workers
FROM radii AS r
CROSS JOIN workplace AS w
CROSS JOIN active_workers AS aw
LEFT JOIN active_session_users AS asu ON aw.user_id = asu.user_id
GROUP BY r.radius_km
ORDER BY r.radius_km
FORMAT JSONEachRow
```

## SQL: детализация дня

Детализация использует тот же `whereSql`, но даты заменяются на выбранный день. Кандидатами факта считаются статусы `confirmed` и `completed` либо смены с непустыми `start_fact`/`finish_fact`. В итоговую выполненную строку попадают только кандидаты с положительным фактическим интервалом, положительными `actual_hours` или успешной выплатой; нулевая `confirmed`-смена без выплаты остается свободной строкой заказа.

```sql
WITH filtered_orders AS (
  SELECT
    o._id AS order_id,
    o.start AS order_start,
    o.finish AS order_finish,
    o.hours AS hours,
    if(ifNull(p.caption, '') = '', o.spec, p.caption) AS profession
  FROM mg_orders AS o
  LEFT JOIN mg_professions AS p ON o.spec = p.spec
  WHERE <day_whereSql>
),
confirmed_jobs AS (
  SELECT
    fo.order_id AS order_id,
    j._id AS job_id,
    j.status AS status,
    ifNull(j.worker, '') AS worker_id,
    j.start_fact AS start_fact,
    j.finish_fact AS finish_fact,
    j.hours AS actual_hours
  FROM filtered_orders AS fo
  LEFT JOIN mg_jobs AS j ON j.source = fo.order_id
    AND ifNull(j.deleted, 0) = 0
  WHERE ifNull(j.status, '') IN ('confirmed', 'completed')
    OR (
      j.start_fact IS NOT NULL
      AND j.finish_fact IS NOT NULL
      AND j.finish_fact > j.start_fact
      AND dateDiff('second', j.start_fact, j.finish_fact) != 0
    )
),
job_rollup AS (
  SELECT
    fo.order_id AS order_id,
    countIf(j.status = 'cancelled') AS cancelled_shifts,
    countIf(
      ifNull(j.status, '') IN ('confirmed', 'completed')
      AND (
        ifNull(j.hours, 0) > 0
        OR (
          j.start_fact IS NOT NULL
          AND j.finish_fact IS NOT NULL
          AND j.finish_fact > j.start_fact
          AND dateDiff('second', j.start_fact, j.finish_fact) != 0
        )
      )
    ) AS confirmed_fact_shifts
  FROM filtered_orders AS fo
  LEFT JOIN mg_jobs AS j ON j.source = fo.order_id
    AND ifNull(j.deleted, 0) = 0
  GROUP BY fo.order_id
),
last_cancelled AS (
  SELECT
    fo.order_id AS order_id,
    max(coalesce(h.createdAt, h.updatedAt)) AS last_cancelled_at
  FROM filtered_orders AS fo
  INNER JOIN mg_jobs AS j ON j.source = fo.order_id
    AND ifNull(j.deleted, 0) = 0
  INNER JOIN mg_job_history AS h ON h.job = j._id
  WHERE ifNull(h.status, '') = 'cancelled'
  GROUP BY fo.order_id
),
payment_rows AS (
  SELECT
    if(ifNull(job, '') != '', job, ifNull(entityId, '')) AS job_id,
    ifNull(amount, 0) AS amount,
    ifNull(payment_status, '') AS payment_status
  FROM mg_payments
),
payments AS (
  SELECT
    pr.job_id AS job_id,
    sumIf(pr.amount, ifNull(pr.payment_status, '') IN ('done', 'bank_done')) AS payment_amount
  FROM payment_rows AS pr
  INNER JOIN confirmed_jobs AS cj ON pr.job_id = cj.job_id
  WHERE ifNull(pr.job_id, '') != ''
  GROUP BY pr.job_id
)
SELECT
  fo.order_id AS order_id,
  cj.job_id AS job_id,
  fo.profession AS profession,
  formatDateTime(toTimeZone(fo.order_start, 'Europe/Moscow'), '%F %T') AS order_start_local,
  <planned_hours_expression> AS planned_hours,
  coalesce(nullIf(trim(concat(ifNull(u.lastname, ''), ' ', ifNull(u.firstname, ''), ' ', ifNull(u.middlename, ''))), ''), nullIf(trim(ifNull(w.full_name, '')), ''), '') AS worker_full_name,
  ifNull(u.phone, '') AS worker_phone,
  cj.status AS confirmed_status,
  cj.actual_hours AS actual_hours,
  concat(formatDateTime(toTimeZone(cj.start_fact, 'Europe/Moscow'), '%d.%m.%Y %H:%i'), ' - ', formatDateTime(toTimeZone(cj.finish_fact, 'Europe/Moscow'), '%d.%m.%Y %H:%i')) AS actual_time_local,
  ifNull(pay.payment_amount, 0) AS payment_amount,
  ifNull(jr.cancelled_shifts, 0) AS cancelled_shifts,
  '' AS last_cancelled_at_local
FROM filtered_orders AS fo
INNER JOIN confirmed_jobs AS cj ON fo.order_id = cj.order_id
LEFT JOIN mg_workers AS w ON cj.worker_id = w._id
LEFT JOIN mg_users AS u ON w.user = u._id
LEFT JOIN payments AS pay ON cj.job_id = pay.job_id
LEFT JOIN job_rollup AS jr ON fo.order_id = jr.order_id
UNION ALL
SELECT
  fo.order_id AS order_id,
  '' AS job_id,
  fo.profession AS profession,
  formatDateTime(toTimeZone(fo.order_start, 'Europe/Moscow'), '%F %T') AS order_start_local,
  <planned_hours_expression> AS planned_hours,
  '' AS worker_full_name,
  '' AS worker_phone,
  '' AS confirmed_status,
  CAST(NULL, 'Nullable(Float64)') AS actual_hours,
  '' AS actual_time_local,
  0 AS payment_amount,
  ifNull(jr.cancelled_shifts, 0) AS cancelled_shifts,
  if(ifNull(jr.cancelled_shifts, 0) > 0, ifNull(formatDateTime(toTimeZone(lc.last_cancelled_at, 'Europe/Moscow'), '%F %T'), ''), '') AS last_cancelled_at_local
FROM filtered_orders AS fo
LEFT JOIN job_rollup AS jr ON fo.order_id = jr.order_id
LEFT JOIN last_cancelled AS lc ON fo.order_id = lc.order_id
WHERE ifNull(jr.confirmed_fact_shifts, 0) = 0
ORDER BY order_start_local ASC, profession ASC, order_id ASC, job_id ASC
FORMAT JSONEachRow
```

`<planned_hours_expression>`:

```sql
if(
  ifNull(fo.hours, 0) > 0,
  toNullable(toFloat64(fo.hours)),
  if(
    fo.order_finish > fo.order_start,
    toNullable(dateDiff('minute', fo.order_start, fo.order_finish) / 60.0),
    CAST(NULL, 'Nullable(Float64)')
  )
)
```

## Метрики

- `orderedShifts`: сумма `amount` заказов точки.
- `completedShifts`: число успешных `confirmed`-смен; `confirmed` с длительностью `0:00` и нулевым начислением/выплатой исключаются как прогул.
- `slaPercent`: `completedShifts / orderedShifts * 100`.
- `stabilityPercent`: `activeDays / rangeDays * 100`.
- `activeDays`: число дней с заказом.
- `uniqueCompletedWorkers`: уникальные исполнители успешных подтвержденных смен.
- `uniqueBookedWorkers`: уникальные исполнители, у которых в истории был `status = 'booked'`.
- `dropoffs24h`: уникальные смены с отменой/провалом от исполнителя в интервале `[start - 24h; start]`.
- `orderLeadAvgMinutes`, `orderLeadMinMinutes`: среднее и минимальное время от создания заказа до старта.
- `professionRows.sharePercent`: доля спроса специальности от всего спроса точки.
- `radiusWorkers`: исполнители со статусом `ready`, `worked`, `booked` в радиусах 5/10/15/20 км.
- `radiusActiveSessionWorkers`: такие же исполнители, но только с AppMetrica-сессией за последние 30 дней.
- `paymentAmount` в детализации дня: сумма успешных платежей `payment_status IN ('done', 'bank_done')` по фактической смене; платеж также помогает отличить выполненную смену от нулевого прогула.
