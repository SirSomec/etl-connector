# Дашборд «Смены исполнителей младше 18 лет»

Код: `src/underageCompletedShiftsDashboard.js`. Маршрут: `/dashboards/underage-completed-shifts`.

Экран показывает с начала текущего года недельное количество успешно завершенных смен исполнителей младше 18 лет. Неделя начинается в понедельник; первая неполная неделя года включается, чтобы не терять смены с 1 января.

## Правила расчета

- Факт смен берется из `mg_jobs`; удаленные смены исключаются.
- Связь исполнителя с датой рождения: `mg_jobs.worker = mg_workers._id`, затем `mg_workers.user = mg_users._id`.
- Используются только даты рождения из `mg_users.birthday`, которые корректно приводятся к дате в формате `YYYY-MM-DD`.
- Возраст рассчитывается на дату начала смены. Условие `addYears(birthday, 18) > toDate(j.start)` исключает смены, выполненные в день 18-летия и позже.
- Завершенной считается успешная `confirmed`-смена: статус `confirmed` и ненулевой факт работы, начисление или выплата. Нулевые прогулы не включаются.

## SQL

```sql
WITH workers_with_birthdays AS (
  SELECT
    w._id AS worker_id,
    toDateOrNull(nullIf(trimBoth(u.birthday), '')) AS birthday
  FROM mg_workers AS w
  INNER JOIN mg_users AS u ON u._id = w.user
  WHERE toDateOrNull(nullIf(trimBoth(u.birthday), '')) IS NOT NULL
)
SELECT
  toMonday(j.start) AS week,
  uniqExact(j._id) AS completed_shifts
FROM mg_jobs AS j
INNER JOIN workers_with_birthdays AS wb ON wb.worker_id = j.worker
WHERE ifNull(j._id, '') != ''
  AND ifNull(j.deleted, 0) = 0
  AND j.start >= {from:DateTime}
  AND j.start < {to:DateTime}
  AND wb.birthday <= toDate(j.start)
  AND addYears(wb.birthday, 18) > toDate(j.start)
  AND <successful_confirmed_shift_condition>
GROUP BY week
ORDER BY week
FORMAT JSONEachRow
```
