# Дашборд `Анализ точек`

Код: `src/workplaceAnalysisDashboard.js`. Маршрут: `/dashboards/workplace-analysis`.

Экран ранжирует рабочие места по плановому заказу, SLA и стабильности. Основная таблица - `mg_orders`; факт выполнения берется из `mg_jobs` через `mg_jobs.source = mg_orders._id`. Для SLA учитываются только успешные `confirmed`-смены: нулевые `confirmed` с длительностью `0:00` и нулевым начислением/выплатой считаются прогулом.

Внутри экрана есть подвкладка `Требуют внимания`. Она показывает точки с незакрытым заказом на ближайшие 7 дней и базой исполнителей в радиусе 15 км.

## Фильтры

Период по умолчанию - с первого дня текущего месяца до текущего дня. Параметры SQL:

- `{from:DateTime}`, `{to:DateTime}` - период по `o.start`.
- `{limit:UInt64}`, `{offset:UInt64}` - пагинация.
- `{range_days:Float64}` - число календарных дней в выбранном периоде.
- Массивы: `{clients:Array(String)}`, `{cities:Array(String)}`, `{regions:Array(String)}`, `{professions:Array(String)}`, `{order_types:Array(String)}`, `{job_statuses:Array(String)}`, `{contractors:Array(String)}`, `{pinned_workplace_ids:Array(String)}`.
- Поиск: `{search:String}`.
- Диапазоны метрик: `{sla_from:Float64}`, `{sla_to:Float64}`, `{orders_from:Float64}`, `{orders_to:Float64}`, `{stability_from:Float64}`, `{stability_to:Float64}`.

Базовый фильтр заказов:

```sql
o.start >= {from:DateTime}
AND o.start < {to:DateTime}
AND ifNull(o.workplace, '') != ''
AND ifNull(o.amount, 0) > 0
```

Если выключены чекбоксы включения удаленных/скрытых заказов, добавляются:

```sql
ifNull(o.deleted, 0) = 0
AND ifNull(o.is_hidden, 0) = 0
```

Дополнительные фильтры добавляются через `IN`, поиск по id/названию/адресу точки и фильтр статусов через подзапрос:

```sql
o._id IN (
  SELECT DISTINCT j.source
  FROM mg_jobs AS j
  WHERE j.deleted = 0
    AND ifNull(j.source, '') != ''
    AND ifNull(j.status, '') IN {job_statuses:Array(String)}
)
```

## Подвкладка `Требуют внимания`

Период подвкладки фиксируется относительно текущей даты:

- `{from:DateTime}` - текущий день;
- `{to:DateTime}` - текущий день + 7 дней включительно, в SQL передается эксклюзивной границей следующего дня;
- `{active_from:DateTime}`, `{active_to:DateTime}` - окно активности приложения за последние 30 дней.

Незакрытый заказ считается как плановый заказ `mg_orders.amount` минус смены `mg_jobs`, связанные через `mg_jobs.source = mg_orders._id`, в закрывающих статусах:

```text
booked, going, inprogress, checkingin, checkingout, completed, delayed, waiting
```

`confirmed` закрывает заказ только если смена успешная: есть положительная длительность, начисление/выплата или положительный фактический интервал `start_fact` - `finish_fact`. `doccheck` не закрывает заказ. `completed` закрывает заказ, потому что смена завершена.

Метрики подвкладки:

- `free7d` - незакрытый заказ за ближайшие 7 дней;
- `ordered7d` - плановый заказ за ближайшие 7 дней;
- `covered7d` - смены в закрывающих статусах;
- `coveragePercent` - доля закрытого заказа;
- `maxDailyFree` - максимальный незакрытый заказ в один день;
- `nearestFreeDate` - ближайший день с незакрытым заказом;
- `totalWorkers15km` - вся база исполнителей с координатами в радиусе 15 км;
- `activeWorkers30d15km` - база в радиусе 15 км, входившая в приложение за последние 30 дней;
- `activeWorkersPerFreeShift` - активная база на одну свободную смену.

База показывается по статусам `ready`, `booked`, `worked` и `прочие`. Специальность исполнителя в этой итерации не сопоставляется со специальностью заказа, влияние по расстоянию не взвешивается.

## SQL: опции фильтров

```sql
SELECT 'client' AS filter, ifNull(c.title, '') AS value
FROM mg_orders AS o
LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
LEFT JOIN mg_clients AS c ON o.client = c._id
LEFT JOIN mg_professions AS p ON o.spec = p.spec
LEFT JOIN mg_contractors AS ct ON w.contractor = ct._id
WHERE <base_where>
GROUP BY value
HAVING value != ''
UNION ALL
SELECT 'city' AS filter, ifNull(w.address__city, '') AS value ...
UNION ALL
SELECT 'region' AS filter, ifNull(w.address__region, '') AS value ...
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
WHERE <base_where>
  AND j.deleted = 0
GROUP BY value
HAVING value != ''
UNION ALL
SELECT 'contractor' AS filter, ifNull(ct.legal_name, '') AS value ...
ORDER BY filter, value
FORMAT JSONEachRow
```

В сокращенных ветках выше используется тот же `FROM/JOIN/WHERE/GROUP BY/HAVING`, что и в первом `SELECT`.

## SQL: расчет метрик точки

Этот шаблон используется для топа точек, pinned-точек и подсчета total при фильтрах по метрикам.

```sql
SELECT
  metrics.workplace_id AS workplace_id,
  metrics.workplace_title AS workplace_title,
  metrics.technical_name AS technical_name,
  metrics.client_title AS client_title,
  metrics.city AS city,
  metrics.region AS region,
  metrics.street AS street,
  metrics.total_ordered_shifts AS total_ordered_shifts,
  metrics.active_days AS active_days,
  metrics.sla_ordered_shifts AS sla_ordered_shifts,
  metrics.sla_completed_shifts AS sla_completed_shifts,
  metrics.sla_sort AS sla_sort,
  metrics.sla_percent AS sla_percent,
  metrics.stability_sort AS stability_sort,
  metrics.stability_percent AS stability_percent
FROM (
  SELECT
    os.workplace_id AS workplace_id,
    os.workplace_title AS workplace_title,
    os.technical_name AS technical_name,
    os.client_title AS client_title,
    os.city AS city,
    os.region AS region,
    os.street AS street,
    os.total_ordered_shifts AS total_ordered_shifts,
    os.active_days AS active_days,
    os.sla_ordered_shifts AS sla_ordered_shifts,
    ifNull(sc.sla_completed_shifts, 0) AS sla_completed_shifts,
    if(os.sla_ordered_shifts > 0, ifNull(sc.sla_completed_shifts, 0) / os.sla_ordered_shifts, 0) AS sla_sort,
    if(os.sla_ordered_shifts > 0, ifNull(sc.sla_completed_shifts, 0) / os.sla_ordered_shifts * 100, 0) AS sla_percent,
    if({range_days:Float64} > 0, os.active_days / {range_days:Float64}, 0) AS stability_sort,
    if({range_days:Float64} > 0, os.active_days / {range_days:Float64} * 100, 0) AS stability_percent
  FROM (
    SELECT
      o.workplace AS workplace_id,
      ifNull(any(w.title), '') AS workplace_title,
      ifNull(any(w.technical_name), '') AS technical_name,
      ifNull(any(c.title), 'Без бренда') AS client_title,
      ifNull(any(w.address__city), '') AS city,
      ifNull(any(w.address__region), '') AS region,
      ifNull(any(w.address__street), '') AS street,
      sum(ifNull(o.amount, 0)) AS total_ordered_shifts,
      sumIf(ifNull(o.amount, 0), ifNull(o.deleted, 0) = 0 AND ifNull(o.is_hidden, 0) = 0) AS sla_ordered_shifts,
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
        ) AS is_successful_confirmed_shift
      FROM mg_jobs AS j
      WHERE ifNull(j.deleted, 0) = 0
    ) AS completed_job ON completed_job.source = o._id
    WHERE <whereSql>
      AND completed_job.is_successful_confirmed_shift = 1
    GROUP BY workplace_id
  ) AS sc ON os.workplace_id = sc.workplace_id
) AS metrics
WHERE <metricWhereSql>
```

Топ точек добавляет:

```sql
ORDER BY <sort_expression>
LIMIT {limit:UInt64} OFFSET {offset:UInt64}
FORMAT JSONEachRow
```

Сортировки:

```sql
total_ordered_shifts DESC, workplace_id ASC
sla_sort DESC, total_ordered_shifts DESC, workplace_id ASC
active_days DESC, total_ordered_shifts DESC, workplace_id ASC
```

## SQL: total

Без фильтров по метрикам:

```sql
SELECT
  countDistinct(o.workplace) AS total_workplaces
FROM mg_orders AS o
LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
LEFT JOIN mg_clients AS c ON o.client = c._id
LEFT JOIN mg_professions AS p ON o.spec = p.spec
LEFT JOIN mg_contractors AS ct ON w.contractor = ct._id
WHERE <whereSql>
FORMAT JSONEachRow
```

С фильтрами по SLA, заказам или стабильности:

```sql
SELECT
  count() AS total_workplaces
FROM (
  <workplace_metrics_select>
) AS filtered_workplaces
FORMAT JSONEachRow
```

## SQL: дневные значения

Для обычной страницы сначала выбираются `top_workplaces`, затем дневные заказы и успешные подтвержденные смены:

```sql
WITH top_workplaces AS (
  <top_workplaces_select>
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
      ) AS is_successful_confirmed_shift
    FROM mg_jobs AS j
    WHERE ifNull(j.deleted, 0) = 0
  ) AS completed_job ON completed_job.source = o._id
  WHERE <whereSql>
    AND completed_job.is_successful_confirmed_shift = 1
  GROUP BY workplace_id, order_date
)
SELECT
  d.workplace_id AS workplace_id,
  d.order_date AS order_date,
  d.ordered_shifts AS ordered_shifts,
  ifNull(c.completed_shifts, 0) AS completed_shifts,
  d.sla_ordered_shifts AS sla_ordered_shifts,
  ifNull(c.sla_completed_shifts, 0) AS sla_completed_shifts
FROM daily_orders AS d
LEFT JOIN daily_completed AS c
  ON d.workplace_id = c.workplace_id
  AND d.order_date = c.order_date
ORDER BY workplace_id, order_date
FORMAT JSONEachRow
```

Для pinned-точек используется такой же запрос, но вместо `top_workplaces` добавляется условие:

```sql
AND o.workplace IN {workplace_ids:Array(String)}
```

## SQL: активные гигеры в 5 км

```sql
WITH selected_workplaces AS (
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
FORMAT JSONEachRow
```

## Метрики

- `totalOrderedShifts`: сумма `mg_orders.amount` по точке.
- `activeDays`: количество уникальных дат `toDate(o.start)` с заказами.
- `stabilityPercent`: `activeDays / rangeDays * 100`; доля дней периода, где у точки был плановый заказ.
- `slaOrderedShifts`: сумма `amount` только по неудаленным и нескрытым заказам.
- `slaCompletedShifts`: число успешных подтвержденных смен, привязанных к заказам точки; `confirmed` с длительностью `0:00` и нулевым начислением/выплатой исключаются как прогул.
- `slaPercent`: `slaCompletedShifts / slaOrderedShifts * 100`.
- `avgDailyOrder`: `totalOrderedShifts / activeDays`.
- `completedShifts`: дневное число успешных подтвержденных смен.
- `heatmapDays.level`: уровень 0-4, рассчитывается в JS от дневного `ordered_shifts` относительно максимума на странице.
- `activeGigers5km`: уникальные исполнители со статусом `ready`, `worked` или `booked`, у которых была AppMetrica-сессия за последние 30 дней и последняя известная геопозиция в радиусе 5 км.
