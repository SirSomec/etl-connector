# Дашборд `Отмены гигерами`

Код: `src/workerCancellationsDashboard.js`. Маршрут: `/dashboards/worker-cancellations`.

Экран показывает исполнителей с выполненными сменами, отменами со стороны исполнителя, отменами менее чем за 24 часа, отменами после планового старта и провалами смен. Дашборд намеренно выводит ФИО и телефон исполнителя для операционной работы.

## Операционный риск исполнителя

В таблице исполнителей риск отображается как `Высокий`, `Средний` или `Низкий`. Это вычисляемая в приложении оценка поверх уже загруженных агрегатов `worker_cancellations`, `worker_cancellations_24h`, `post_start_cancellations` и `failed_shifts`; отдельный SQL-запрос для риска не выполняется.

Высокий риск получает исполнитель с тремя и более отменами менее чем за 24 часа, любой отменой после старта или тремя и более failed-сменами. Средний риск получает исполнитель с одной или двумя отменами менее чем за 24 часа, одной или двумя failed-сменами либо повторяющимися worker-отменами без срочного признака. Низкий риск означает, что эти сигналы не сработали.

Причины риска показывают конкретные операционные сигналы: отмены менее чем за 24 часа, отмены после старта и failed-смены. ФИО и полный телефон остаются только на этом экране, потому что нужны для прямой операционной обработки отмен.

## Фильтры

- `{from:DateTime}`, `{to:DateTime}` - период по `mg_jobs.start`.
- `{limit:UInt64}`, `{offset:UInt64}` - пагинация.
- `{search:String}` - поиск по worker id, user id, телефону, ФИО и городу.
- Диапазоны метрик: `{confirmed_shifts_from:Float64}`, `{confirmed_shifts_to:Float64}`, `{worker_cancellations_from:Float64}`, `{worker_cancellations_to:Float64}`, `{worker_cancellations_24h_from:Float64}`, `{worker_cancellations_24h_to:Float64}`, `{post_start_cancellations_from:Float64}`, `{post_start_cancellations_to:Float64}`, `{failed_shifts_from:Float64}`, `{failed_shifts_to:Float64}`.
- Сортировки: `fullName`, `phone`, `city`, `confirmedShifts`, `workerCancellations`, `workerCancellations24h`, `postStartCancellations`, `failedShifts`.

## Общие CTE метрик

```sql
WITH shift_facts AS (
  SELECT
    j._id AS job,
    j.worker AS worker_id,
    j.start AS start,
    ifNull(j.status, '') AS status,
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
```

`shift_facts` ограничивает смены периодом, непустым исполнителем и `deleted = 0`. `cancellation_events` берет только события `cancelled` из истории. `cancellation_flags` сворачивает события до признаков на смену.

## SQL: список исполнителей

```sql
WITH <worker_metrics_cte>
SELECT
  wm.worker_id AS worker_id,
  ifNull(w.user, '') AS user_id,
  coalesce(
    nullIf(trim(concat(ifNull(u.lastname, ''), ' ', ifNull(u.firstname, ''), ' ', ifNull(u.middlename, ''))), ''),
    nullIf(trim(ifNull(w.full_name, '')), ''),
    wm.worker_id
  ) AS full_name,
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
WHERE <optional_search_and_metric_filters>
ORDER BY <sort_column> <ASC|DESC>, worker_id ASC
LIMIT {limit:UInt64} OFFSET {offset:UInt64}
FORMAT JSONEachRow
```

Поиск:

```sql
positionCaseInsensitive(wm.worker_id, {search:String}) > 0
OR positionCaseInsensitive(ifNull(w.user, ''), {search:String}) > 0
OR positionCaseInsensitive(ifNull(u.phone, ''), {search:String}) > 0
OR positionCaseInsensitive(<full_name_expression>, {search:String}) > 0
OR positionCaseInsensitive(ifNull(w.full_address__city, ''), {search:String}) > 0
```

Фильтры по метрикам добавляются как условия вида:

```sql
wm.worker_cancellations_24h >= {worker_cancellations_24h_from:Float64}
AND wm.worker_cancellations_24h <= {worker_cancellations_24h_to:Float64}
```

## SQL: total workers

Если есть поиск или фильтры по метрикам, total считается по тем же агрегатам:

```sql
WITH <worker_metrics_cte>
SELECT count() AS total_workers
FROM worker_metrics AS wm
LEFT JOIN mg_workers AS w ON wm.worker_id = w._id
LEFT JOIN mg_users AS u ON w.user = u._id
WHERE <optional_search_and_metric_filters>
FORMAT JSONEachRow
```

Если фильтров нет, используется более дешевый запрос:

```sql
WITH shift_facts AS (
  SELECT
    j.worker AS worker_id
  FROM mg_jobs AS j
  WHERE j.start >= {from:DateTime}
    AND j.start < {to:DateTime}
    AND ifNull(j.worker, '') != ''
    AND ifNull(j.deleted, 0) = 0
  GROUP BY worker_id
)
SELECT
  count() AS total_workers
FROM shift_facts
FORMAT JSONEachRow
```

## SQL: детализация смен по метрике

Для клика по метрике используется `{worker_id:String}` и `{limit:UInt64}`. Условие в `WHERE` зависит от выбранной метрики:

```sql
confirmedShifts: sf.is_successful_confirmed_shift = 1
workerCancellations: sf.status = 'cancelled' AND ifNull(cf.is_worker_cancelled, 0) = 1
workerCancellations24h: sf.status = 'cancelled' AND ifNull(cf.is_worker_cancelled_24h, 0) = 1
postStartCancellations: sf.status = 'cancelled' AND ifNull(cf.is_post_start_cancelled, 0) = 1
failedShifts: sf.status = 'failed'
```

Полный запрос:

```sql
WITH shift_facts AS (
  SELECT
    j._id AS job,
    j.worker AS worker_id,
    j.start AS start,
    ifNull(j.status, '') AS status,
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
    ifNull(j.client, '') AS client_id,
    ifNull(j.workplace, '') AS workplace_id
  FROM mg_jobs AS j
  WHERE j.start >= {from:DateTime}
    AND j.start < {to:DateTime}
    AND j.worker = {worker_id:String}
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
booking_events AS (
  SELECT
    h.job AS job,
    min(coalesce(h.createdAt, h.updatedAt)) AS booked_at
  FROM mg_job_history AS h
  INNER JOIN shift_facts AS sf ON h.job = sf.job
  WHERE h.status = 'booked'
  GROUP BY h.job
),
cancel_events AS (
  SELECT
    h.job AS job,
    max(coalesce(h.createdAt, h.updatedAt)) AS cancelled_at,
    argMax(ifNull(h.initiator, ''), coalesce(h.createdAt, h.updatedAt)) AS cancelled_by
  FROM mg_job_history AS h
  INNER JOIN shift_facts AS sf ON h.job = sf.job
  WHERE h.status = 'cancelled'
  GROUP BY h.job
)
SELECT
  sf.job AS shift_id,
  coalesce(nullIf(trim(ifNull(c.title, '')), ''), nullIf(sf.client_id, ''), '') AS brand,
  coalesce(
    nullIf(arrayStringConcat(arrayFilter(x -> x != '', [
      ifNull(wp.address__city, ''),
      ifNull(wp.address__street, ''),
      ifNull(wp.address__house, '')
    ]), ', '), ''),
    nullIf(trim(ifNull(wp.title, '')), ''),
    nullIf(sf.workplace_id, ''),
    ''
  ) AS address,
  sf.start AS planned_start,
  be.booked_at AS booked_at,
  ce.cancelled_at AS cancelled_at,
  ce.cancelled_by AS cancelled_by
FROM shift_facts AS sf
LEFT JOIN cancellation_flags AS cf ON cf.job = sf.job
LEFT JOIN booking_events AS be ON be.job = sf.job
LEFT JOIN cancel_events AS ce ON ce.job = sf.job
LEFT JOIN mg_clients AS c ON sf.client_id = c._id
LEFT JOIN mg_workplaces AS wp ON sf.workplace_id = wp._id
WHERE <metric_condition>
ORDER BY sf.start DESC, sf.job ASC
LIMIT {limit:UInt64}
FORMAT JSONEachRow
```

## Метрики

- `confirmedShifts`: уникальные успешные `confirmed`-смены исполнителя; нулевые `confirmed` с длительностью `0:00` и нулевым начислением/выплатой исключаются как прогул.
- `workerCancellations`: уникальные отмененные смены, где в истории есть событие `cancelled` с `initiator = 'worker'`.
- `workerCancellations24h`: подмножество `workerCancellations`, где событие отмены исполнителем произошло от `start - 24 HOUR` до `start`.
- `postStartCancellations`: отмененные смены, где событие `cancelled` произошло после планового старта смены. В текущем SQL инициатор не ограничивается исполнителем.
- `failedShifts`: уникальные смены со статусом `failed`.
- `fullName`: сначала ФИО из `mg_users`, затем `mg_workers.full_name`, затем `worker_id`.
- `phone`: телефон из `mg_users.phone`, в JS дополнительно убирается хвост `.0`, если ClickHouse вернул телефон как числовую строку.
- `city`: `mg_workers.full_address__city`.
- `bookedAt`: первое событие `booked` в истории смены.
- `cancelledAt`: последнее событие `cancelled` в истории смены.
- `cancelledBy`: `initiator` последнего события отмены.
