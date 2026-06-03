# Дашборд `Тепловая карта`

Код: `src/heatmapDashboard.js`. Маршрут: `/dashboards/heatmap`.

Экран показывает точки со спросом за выбранный месяц и баланс спроса к активной базе исполнителей вокруг точки. Карта использует координаты `mg_workplaces.location__coordinates`, спрос - `mg_orders.amount`, активную базу - `mg_workers` плюс `appmetrica_sessions`.

## Фильтры

- `{from:DateTime}`, `{to:DateTime}` - выбранный месяц по `mg_orders.start`.
- `{active_from:DateTime}`, `{active_to:DateTime}` - окно активных сессий. Режим `last30d` берет 30 дней до конца месяца, режим `selected` - выбранный месяц.
- `{clients:Array(String)}` - бренды.
- `{excluded_professions:Array(String)}` - исключаемые специальности.
- `{address_search:String}` - поиск по региону, городу, улице, названию и техническому названию точки.
- `activeBaseMode`: `all` или `ready`; во втором режиме исполнители ограничиваются статусами `ready`, `booked`, `worked`.

Базовый фильтр заказов:

```sql
ifNull(o.deleted, 0) = 0
AND ifNull(o.is_hidden, 0) = 0
AND o.start >= {from:DateTime}
AND o.start < {to:DateTime}
AND ifNull(o.amount, 0) > 0
```

## SQL: опции фильтров

```sql
SELECT 'client' AS filter, ifNull(c.title, '') AS value
FROM mg_orders AS o
LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
LEFT JOIN mg_clients AS c ON o.client = c._id
LEFT JOIN mg_professions AS p ON o.spec = p.spec
WHERE <base_where_without_optional_filters>
GROUP BY value
HAVING value != ''
UNION ALL
SELECT 'profession' AS filter, if(ifNull(p.caption, '') = '', o.spec, p.caption) AS value
FROM mg_orders AS o
LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
LEFT JOIN mg_clients AS c ON o.client = c._id
LEFT JOIN mg_professions AS p ON o.spec = p.spec
WHERE <base_where_without_optional_filters>
GROUP BY value
HAVING value != ''
ORDER BY filter, value
FORMAT JSONEachRow
```

## SQL: точки спроса и активная база

```sql
WITH filtered_orders AS (
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
  WHERE <whereSql>
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
    AND length(worker_coordinates) >= 2
    AND worker_coordinates[1] BETWEEN -180 AND 180
    AND worker_coordinates[2] BETWEEN -90 AND 90
    AND worker_coordinates[1] BETWEEN bounds.min_lon - bounds.lon_margin AND bounds.max_lon + bounds.lon_margin
    AND worker_coordinates[2] BETWEEN bounds.min_lat - bounds.lat_margin AND bounds.max_lat + bounds.lat_margin
    /* если activeBaseMode = 'ready': AND status IN ('ready', 'booked', 'worked') */
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
FORMAT JSONEachRow
```

## Метрики

- `pointsWithOrder`: количество точек с `ordered_shifts > 0` и валидными координатами.
- `regionsWithOrder`: количество регионов среди точек со спросом.
- `orderedShifts`: сумма `mg_orders.amount` по всем точкам карты.
- `orderRequests`: уникальные заявки по точке.
- `weightedActiveUsers`: сумма весов активных пользователей вокруг точки: до 5 км - `1.0`, 5-10 км - `0.5`, 10-15 км - `0.25`.
- `weightedActiveUsersPerShift`: `weightedActiveUsers / orderedShifts`.
- `activeUsers5km`, `activeUsers10km`, `activeUsers15km`: уникальные активные пользователи в соответствующих радиальных кольцах.
- `avgWeightedActiveUsersPerShift`: `sum(weightedActiveUsers) / sum(orderedShifts)`.
- `balanceLevel`: `no-order`, если спроса нет; `low`, если `weightedActiveUsersPerShift < 1`; `medium`, если `< 3`; иначе `high`.
- `color`: HSL-цвет, рассчитывается в JS по прогрессу `weightedActiveUsersPerShift / 3`.
