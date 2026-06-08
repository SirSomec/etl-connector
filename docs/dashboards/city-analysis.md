# Дашборд `Анализ городов`

Код: `src/cityAnalysisDashboard.js`. Маршрут: `/dashboards/city-analysis`.

Экран оценивает спрос и базу исполнителей по выбранному городу. Спрос считается по `mg_orders`, активность приложения - по `appmetrica_sessions`, база исполнителей - по последней геолокации `mg_workers.location__coordinates` и статусам исполнителей.

## Доменные правила

- Спрос, отклики и выполнения считаются только по актуальным заказам: не удаленным, не скрытым, без тестовых клиентов и без `processing`.
- Контрагент заказа берется через рабочее место: `mg_orders.workplace -> mg_workplaces._id -> mg_contractors._id`.
- История откликов связывается с конкретной сменой: `mg_job_history.job -> mg_jobs._id -> filtered_orders.order_id`; связь только по `history.source` не используется для метрик откликов.
- Выполнения считаются по успешным `confirmed` через общий helper, включая исключение `piecework`-прогулов.
- Гео-CTE оставляют `CROSS JOIN` только для scalar/bounds и сопоставления с точками спроса; перед `greatCircleDistance` используются bounding predicates.

## Фильтры

- `{from:DateTime}`, `{to:DateTime}` - выбранный период по `mg_orders.start`.
- `{active_30d_from:DateTime}`, `{active_30d_to:DateTime}` - последние 30 дней для отдельной метрики активной базы.
- `{city:String}` - выбранный город `mg_workplaces.address__city`.
- Массивы: `{clients:Array(String)}`, `{professions:Array(String)}`, `{order_types:Array(String)}`, `{job_statuses:Array(String)}`, `{contractors:Array(String)}`.
- Ставки: `{salary_from:Float64}`, `{salary_to:Float64}` по `mg_orders.salary_per_hour`.

Базовый фильтр заказов:

```sql
o.start >= {from:DateTime}
AND o.start < {to:DateTime}
AND ifNull(o.workplace, '') != ''
AND ifNull(o.amount, 0) > 0
```

По умолчанию также используются:

```sql
ifNull(o.deleted, 0) = 0
AND ifNull(o.is_hidden, 0) = 0
```

Для метрики активных заявок за 30 дней удаленные заявки принудительно исключаются.

## SQL: список городов

```sql
SELECT
  ifNull(w.address__city, '') AS city
FROM mg_orders AS o
LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
WHERE o.start >= {from:DateTime}
  AND o.start < {to:DateTime}
  AND ifNull(o.deleted, 0) = 0
  AND ifNull(o.is_hidden, 0) = 0
  AND ifNull(o.amount, 0) > 0
GROUP BY city
HAVING city != ''
ORDER BY city
FORMAT JSONEachRow
```

## SQL: опции фильтров

```sql
SELECT 'client' AS filter, ifNull(c.title, '') AS value
FROM mg_orders AS o
LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
LEFT JOIN mg_clients AS c ON o.client = c._id
LEFT JOIN mg_professions AS p ON o.spec = p.spec
LEFT JOIN mg_contractors AS ct ON w.contractor = ct._id
WHERE <whereSql>
GROUP BY value
HAVING value != ''
UNION ALL
SELECT 'profession' AS filter, if(ifNull(p.caption, '') = '', o.spec, p.caption) AS value ...
UNION ALL
SELECT 'orderType' AS filter, ifNull(o.type, '') AS value ...
UNION ALL
SELECT 'jobStatus' AS filter, ifNull(j.status, '') AS value
FROM mg_orders AS o
INNER JOIN mg_jobs AS j ON j.source = o._id
LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
LEFT JOIN mg_clients AS c ON o.client = c._id
LEFT JOIN mg_professions AS p ON o.spec = p.spec
LEFT JOIN mg_contractors AS ct ON w.contractor = ct._id
WHERE <whereSql>
  AND ifNull(j.deleted, 0) = 0
GROUP BY value
HAVING value != ''
UNION ALL
SELECT 'contractor' AS filter, ifNull(ct.legal_name, '') AS value ...
ORDER BY filter, value
FORMAT JSONEachRow
```

## Общие CTE

`filtered_orders` выбирает заявки выбранного города и фильтров:

```sql
filtered_orders AS (
  SELECT
    o._id AS order_id,
    toString(toDate(o.start)) AS period,
    ifNull(o.amount, 0) AS amount,
    ifNull(o.salary_per_hour, 0) AS salary_per_hour,
    ifNull(c.title, '') AS brand,
    if(ifNull(p.caption, '') = '', o.spec, p.caption) AS profession,
    w.location__coordinates AS workplace_coordinates,
    ifNull(o.deleted, 0) = 0 AS is_active_request
  FROM mg_orders AS o
  LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
  LEFT JOIN mg_clients AS c ON o.client = c._id
  LEFT JOIN mg_professions AS p ON o.spec = p.spec
  LEFT JOIN mg_contractors AS ct ON w.contractor = ct._id
  WHERE <whereSql>
)
```

Границы города строятся по координатам точек со спросом. Из координат берутся 1% и 99% квантили, чтобы снизить влияние выбросов, затем добавляется радиус 15 км:

```sql
raw_city_workplaces AS (
  SELECT DISTINCT workplace_coordinates AS workplace_coordinates
  FROM filtered_orders
  WHERE length(workplace_coordinates) >= 2
    AND workplace_coordinates[1] BETWEEN -180 AND 180
    AND workplace_coordinates[2] BETWEEN -90 AND 90
),
city_coordinate_bounds AS (
  SELECT
    count() AS raw_points,
    quantileExact(0.01)(workplace_coordinates[1]) AS min_lon,
    quantileExact(0.99)(workplace_coordinates[1]) AS max_lon,
    quantileExact(0.01)(workplace_coordinates[2]) AS min_lat,
    quantileExact(0.99)(workplace_coordinates[2]) AS max_lat
  FROM raw_city_workplaces
),
city_bounds AS (
  SELECT
    raw_points,
    min_lon,
    max_lon,
    min_lat,
    max_lat,
    15000 / 111000 AS lat_margin,
    15000 / (111320 * greatest(abs(cos(((min_lat + max_lat) / 2) * pi() / 180)), 0.2)) AS lon_margin
  FROM city_coordinate_bounds
)
```

База исполнителей и пользователей:

```sql
candidate_workers AS (
  SELECT
    worker.user AS user_id,
    ifNull(worker.status, '') AS status,
    worker.location__coordinates AS worker_coordinates,
    ifNull(worker.updatedAt, ifNull(worker.createdAt, toDateTime64('1970-01-01 00:00:00', 3, 'UTC'))) AS updated_at
  FROM mg_workers AS worker
  CROSS JOIN city_bounds AS bounds
  LEFT JOIN mg_users AS u ON worker.user = u._id
  WHERE bounds.raw_points > 0
    AND ifNull(worker.user, '') != ''
    AND ifNull(worker.deleted, 0) = 0
    AND ifNull(u.deleted, 0) = 0
    AND length(worker.location__coordinates) >= 2
    AND worker.location__coordinates[1] BETWEEN bounds.min_lon - bounds.lon_margin AND bounds.max_lon + bounds.lon_margin
    AND worker.location__coordinates[2] BETWEEN bounds.min_lat - bounds.lat_margin AND bounds.max_lat + bounds.lat_margin
),
located_users AS (
  SELECT
    user_id,
    argMax(status, updated_at) IN ('ready', 'booked', 'worked') AS is_ready_base,
    argMax(status, updated_at) = 'ready' AS is_ready_status,
    argMax(status, updated_at) = 'booked' AS is_booked_status,
    argMax(status, updated_at) = 'worked' AS is_worked_status
  FROM candidate_workers
  GROUP BY user_id
)
```

Активность приложения:

```sql
app_active_users AS (
  SELECT DISTINCT ifNull(s.profile_id, '') AS user_id
  FROM appmetrica_sessions AS s
  INNER JOIN located_users AS located ON located.user_id = ifNull(s.profile_id, '')
  WHERE ifNull(s.profile_id, '') != ''
    AND parseDateTimeBestEffortOrNull(s.session_start_datetime) >= {from:DateTime}
    AND parseDateTimeBestEffortOrNull(s.session_start_datetime) < {to:DateTime}
),
app_30d_active_users AS (
  SELECT DISTINCT
    located.user_id AS user_id,
    located.is_ready_status AS is_ready_status,
    located.is_booked_status AS is_booked_status,
    located.is_worked_status AS is_worked_status
  FROM appmetrica_sessions AS s
  INNER JOIN located_users AS located ON located.user_id = ifNull(s.profile_id, '')
  WHERE ifNull(s.profile_id, '') != ''
    AND parseDateTimeBestEffortOrNull(s.session_start_datetime) >= {active_30d_from:DateTime}
    AND parseDateTimeBestEffortOrNull(s.session_start_datetime) < {active_30d_to:DateTime}
)
```

Отклики и выполнения:

```sql
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
      job.source AS source,
      job.worker AS worker,
      if(
        ifNull(job.status, '') = 'confirmed'
        AND (
          ifNull(job.hours, 0) > 0
          OR ifNull(job.payment, 0) > 0
          OR ifNull(job.salary_per_job, 0) > 0
          OR ifNull(job.salary_per_hour, 0) * ifNull(job.hours, 0) > 0
          OR (
            job.start_fact IS NOT NULL
            AND job.finish_fact IS NOT NULL
            AND job.finish_fact > job.start_fact
            AND dateDiff('minute', job.start_fact, job.finish_fact) > 0
          )
        ),
        1,
        0
      ) AS is_successful_confirmed_shift
    FROM mg_jobs AS job
    WHERE ifNull(job.deleted, 0) = 0
  ) AS job
  INNER JOIN filtered_orders AS fo ON job.source = fo.order_id
  INNER JOIN mg_workers AS worker ON job.worker = worker._id
  WHERE job.is_successful_confirmed_shift = 1
    AND ifNull(worker.user, '') != ''
)
```

## SQL: summary-demand

```sql
WITH <filtered_orders>
SELECT
  sum(amount) AS ordered_shifts,
  countDistinctIf(order_id, is_active_request) AS active_order_requests
FROM filtered_orders
FORMAT JSONEachRow
```

## SQL: summary-base

```sql
WITH <filtered_orders>, <city_bounds>, <candidate_workers>, <located_users>
SELECT
  uniqExact(user_id) AS total_located_users,
  uniqExactIf(located.user_id, located.is_ready_base) AS ready_located_users,
  uniqExactIf(located.user_id, located.is_ready_status) AS ready_status_located_users,
  uniqExactIf(located.user_id, located.is_booked_status) AS booked_status_located_users,
  uniqExactIf(located.user_id, located.is_worked_status) AS worked_status_located_users
FROM located_users AS located
FORMAT JSONEachRow
```

Перед этим для признака наличия координат выполняется:

```sql
SELECT
  w._id AS workplace_id
FROM mg_orders AS o
LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
LEFT JOIN mg_clients AS c ON o.client = c._id
LEFT JOIN mg_professions AS p ON o.spec = p.spec
LEFT JOIN mg_contractors AS ct ON w.contractor = ct._id
WHERE <whereSql>
  AND length(w.location__coordinates) >= 2
  AND w.location__coordinates[1] BETWEEN -180 AND 180
  AND w.location__coordinates[2] BETWEEN -90 AND 90
LIMIT 1
FORMAT JSONEachRow
```

## SQL: summary-app

```sql
WITH <filtered_orders>, <city_bounds>, <candidate_workers>, <located_users>, <app_active_users>, <app_30d_active_users>
SELECT
  (SELECT uniqExact(user_id) FROM app_active_users) AS app_active_users,
  (SELECT uniqExact(user_id) FROM app_30d_active_users) AS app_30d_active_users,
  (SELECT uniqExactIf(user_id, is_ready_status) FROM app_30d_active_users) AS app_30d_ready_status_users,
  (SELECT uniqExactIf(user_id, is_booked_status) FROM app_30d_active_users) AS app_30d_booked_status_users,
  (SELECT uniqExactIf(user_id, is_worked_status) FROM app_30d_active_users) AS app_30d_worked_status_users
FORMAT JSONEachRow
```

## SQL: summary-responses

```sql
WITH <filtered_orders>, <booked_users>, <completed_users>
SELECT
  (SELECT uniqExact(user_id) FROM booked_users) AS booked_users,
  (SELECT uniqExact(user_id) FROM completed_users) AS completed_users
FORMAT JSONEachRow
```

## SQL: summary-ratio

```sql
WITH active_30d_orders AS (
  SELECT
    o._id AS order_id,
    toString(toDate(o.start)) AS period,
    w.location__coordinates AS workplace_coordinates,
    ifNull(o.deleted, 0) = 0 AS is_active_request
  FROM mg_orders AS o
  LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
  LEFT JOIN mg_clients AS c ON o.client = c._id
  LEFT JOIN mg_professions AS p ON o.spec = p.spec
  LEFT JOIN mg_contractors AS ct ON w.contractor = ct._id
  WHERE <active30dWhereSql>
),
<city_bounds_from_active_30d_orders>,
<candidate_workers>,
<located_users>,
daily_30d_active AS (
  SELECT
    toString(toDate(parseDateTimeBestEffortOrNull(s.session_start_datetime))) AS period,
    uniqExact(ifNull(s.profile_id, '')) AS active_users
  FROM appmetrica_sessions AS s
  INNER JOIN located_users AS located ON located.user_id = ifNull(s.profile_id, '')
  WHERE ifNull(s.profile_id, '') != ''
    AND parseDateTimeBestEffortOrNull(s.session_start_datetime) >= {active_30d_from:DateTime}
    AND parseDateTimeBestEffortOrNull(s.session_start_datetime) < {active_30d_to:DateTime}
  GROUP BY period
),
daily_30d_requests AS (
  SELECT
    period,
    countDistinctIf(order_id, is_active_request) AS active_requests
  FROM active_30d_orders
  GROUP BY period
),
daily_30d_ratio AS (
  SELECT avg(if(active_requests > 0, ifNull(active_users, 0) / active_requests, NULL)) AS avg_ratio
  FROM daily_30d_requests AS requests
  LEFT JOIN daily_30d_active AS active ON active.period = requests.period
  WHERE active_requests > 0
)
SELECT
  ifNull((SELECT avg_ratio FROM daily_30d_ratio), 0) AS avg_daily_30d_active_users_per_request
FORMAT JSONEachRow
```

## SQL: composition

Бренды и специальности:

```sql
WITH <filtered_orders>
SELECT
  <brand_or_profession> AS label,
  sum(amount) AS ordered_shifts
FROM filtered_orders
GROUP BY label
HAVING label != ''
ORDER BY ordered_shifts DESC, label
LIMIT 8
FORMAT JSONEachRow
```

Ставочные корзины:

```sql
WITH <filtered_orders>
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
ORDER BY label
FORMAT JSONEachRow
```

## SQL: dynamics

```sql
WITH <filtered_orders>, <city_bounds>, <candidate_workers>, <located_users>,
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
    fo.period AS period,
    uniqExact(worker.user) AS completed_users
  FROM (
    SELECT
      job.source AS source,
      job.worker AS worker,
      if(
        ifNull(job.status, '') = 'confirmed'
        AND (
          ifNull(job.hours, 0) > 0
          OR ifNull(job.payment, 0) > 0
          OR ifNull(job.salary_per_job, 0) > 0
          OR ifNull(job.salary_per_hour, 0) * ifNull(job.hours, 0) > 0
          OR (
            job.start_fact IS NOT NULL
            AND job.finish_fact IS NOT NULL
            AND job.finish_fact > job.start_fact
            AND dateDiff('minute', job.start_fact, job.finish_fact) > 0
          )
        ),
        1,
        0
      ) AS is_successful_confirmed_shift
    FROM mg_jobs AS job
    WHERE ifNull(job.deleted, 0) = 0
  ) AS job
  INNER JOIN filtered_orders AS fo ON job.source = fo.order_id
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
FORMAT JSONEachRow
```

## Метрики

- `orderedShifts`: сумма `mg_orders.amount`.
- `activeOrderRequests`: уникальные активные заказы, где `is_active_request = true`.
- `totalLocatedUsers`: уникальные пользователи-исполнители с координатами в границах города.
- `readyLocatedUsers`: пользователи со статусом `ready`, `booked` или `worked`.
- `readyStatusLocatedUsers`, `bookedStatusLocatedUsers`, `workedStatusLocatedUsers`: пользователи с последним статусом `ready`, `booked`, `worked`.
- `appActiveUsers`: пользователи из найденной базы, открывавшие приложение в выбранный период.
- `app30dActiveUsers`: такие же пользователи за последние 30 дней.
- `app30dReadyStatusUsers`, `app30dBookedStatusUsers`, `app30dWorkedStatusUsers`: 30-дневная активная база по последнему статусу.
- `bookedUsers`: уникальные пользователи, у которых в истории заказа выбранного города был `status = 'booked'`.
- `completedUsers`: уникальные пользователи с успешными подтвержденными сменами; нулевые `confirmed` с длительностью `0:00` и нулевым начислением/выплатой исключаются как прогул.
- `avgDaily30dActiveUsersPerRequest`: среднее по дням значение `active_users / active_requests`, дни без активных заявок исключаются.
- `composition.sharePercent`: доля спроса строки в сумме спроса соответствующего блока.
- `avgSalaryPerHour`: средняя положительная ставка `salary_per_hour` внутри корзины.
- `activeUsersPerRequest`: дневное отношение активных пользователей приложения к числу активных заявок.
