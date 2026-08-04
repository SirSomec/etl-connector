# Дашборд `Анализ брендов`

Код: `src/brandAnalysisDashboard.js`. Маршрут: `/dashboards/brand-analysis`.

Экран анализирует один выбранный бренд из `mg_clients` за период. В UI бренд выбирается по уникальному нормализованному `mg_clients.title`, потому что в `mg_clients` может быть несколько client-записей с одинаковым названием бренда. Пробелы по краям названия обрезаются, чтобы `Магнит` и `Магнит ` не выглядели как два разных бренда. Shell маршрута загружает только список брендов и фильтры; тяжелые блоки догружаются progressive-фрагментами через `/dashboards/brand-analysis/section`.

## Секции

- `summary` - KPI по заказу, факту, покрытию, выручке, исполнителям, точкам, отменам, самоброни и ставкам.
- `trend` - динамика заказа, выполненных смен, закрытого спроса, свободного заказа, SLA, покрытия, выручки и отмен.
- `regions` - регионы присутствия бренда: заказ, свободный заказ, SLA, покрытие, выполнение и число точек.
- `workplaces` - топ точек бренда по свободному заказу и объему заказа.
- `professions` - разрез по специальностям.
- `statuses` - распределение смен бренда по статусам.

## KPI

- `Заказано смен` - сумма `mg_orders.amount` по актуальным заказам бренда.
- `Отработано смен` - успешные `confirmed`-смены по общему правилу исключения прогулов.
- `Закрыто смен` - смены в закрывающих статусах `booked`, `going`, `inprogress`, `checkingin`, `checkingout`, `completed`, `delayed`, `waiting`, а также успешные `confirmed`.
- `Свободный заказ` - `Заказано смен - Закрыто смен`, не ниже нуля.
- `SLA` - `Отработано смен / Заказано смен`.
- `Покрытие` - `Закрыто смен / Заказано смен`.
- `Выручка` - сумма клиентской оплаты успешных смен; для `saas` используется выплата исполнителю с комиссией, для остальных контрактов клиентская стоимость смены, в обоих случаях добавляются неудаленные транзакции по смене.
- `Уникальные исполнители` - исполнители успешных смен.
- `ТТ с заказами` - рабочие места с заказом бренда.
- `ТТ с выполненными сменами` - рабочие места с успешными сменами.
- `Отмены` - смены с `cancellation_reason` или статусом `failed`.
- `Самоброни` - доля успешных смен, где первое событие истории смены было инициировано исполнителем.
- `Стабильность заказа` - доля календарных дней периода, где у бренда был заказ.
- `Ставка гигера/час` и `Ставка клиента/час` - средние положительные часовые ставки по успешным сменам.

## Доменные правила

- Используются только таблицы `mg_*`: `mg_clients`, `mg_orders`, `mg_jobs`, `mg_workplaces`, `mg_contractors`, `mg_professions`, `mg_job_history`, `mg_transactions`.
- Все метрики строятся через актуальные заказы: не удаленные, не скрытые, без тестовых клиентов и без `processing`.
- Смены связываются с заказом через `mg_jobs.source = mg_orders._id`; смены без актуального заказа бренда в метрики не попадают.
- Контрагент берется через рабочее место заказа: `mg_orders.workplace -> mg_workplaces._id -> mg_contractors._id`.
- Успешная `confirmed`-смена использует общий helper `successfulConfirmedShiftFlagExpression`: нулевая фактическая длительность и нулевая выплата/оплата не считаются успешным выполнением; для сделок признак берется из `mg_orders.pieceworks`.
- Транзакции учитываются только при `mg_transactions.deleted = 0` и связываются по `mg_transactions.entityId = mg_jobs._id`.

## Фильтры и параметры SQL

- `brandId` - обязательное выбранное название бренда из `mg_clients.title`; имя параметра оставлено для совместимости с уже существующим URL.
- `period`: `day`, `week`, `month`, `quarter`; по умолчанию `month`.
- `from`, `to` - календарный диапазон; по умолчанию последние 90 дней.
- `{brand_title:String}` - нормализованное название бренда в ClickHouse-запросах.
- `{from:DateTime}`, `{to:DateTime}` - период, верхняя граница эксклюзивная.

Базовый CTE заказов:

```sql
WITH actual_orders AS (
  SELECT
    o._id AS order_id,
    o.start AS start,
    o.client AS client,
    o.workplace AS workplace,
    ifNull(o.amount, 0) AS amount
  FROM mg_orders AS o
  LEFT JOIN mg_clients AS c ON o.client = c._id
  LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
  LEFT JOIN mg_contractors AS ct ON w.contractor = ct._id
  WHERE ifNull(o.deleted, 0) = 0
    AND ifNull(o.is_hidden, false) = false
    AND c.title NOT IN (<test_client_titles>)
    AND ifNull(ct.contract_type, ifNull(o.contract_type, '')) != 'processing'
    AND ifNull(nullIf(trimBoth(ifNull(c.title, '')), ''), 'Без бренда') = {brand_title:String}
)
```

Фактовый CTE смен всегда присоединяется к `actual_orders`:

```sql
FROM mg_jobs AS j
INNER JOIN actual_orders AS ao ON j.source = ao.order_id
WHERE ifNull(j.deleted, 0) = 0
  AND j.start >= {from:DateTime}
  AND j.start < {to:DateTime}
```

Для каждой секции и каждой расчетной ячейки есть SQL-info metadata с id вида `brand-analysis.<section>...`; видимость управляется правом `SQL метрик`.
