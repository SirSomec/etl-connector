# Дизайн предзагрузки дашборда "Анализ точек"

Дата: 2026-06-16.

## Цель

Добавить дашборд "Анализ точек" в систему предзагрузки витрин так, чтобы тяжелые секции дашборда могли отдаваться из локальной SQLite-витрины без обращения к ClickHouse, а при отсутствии подходящей витрины сохранялся текущий fallback на ClickHouse.

Целевой отклик для покрытых предзагрузкой секций - менее 0,5 секунды на Linux Docker volume при нормальном размере сохраненного payload. Предзагрузка не должна менять расчетную семантику дашборда.

## Подход

Для "Анализа точек" используется result-preload: в SQLite хранится готовый JSON payload секций, а не новые сырые fact-таблицы.

Причины:

- секция `points` содержит сложную JS-постобработку: пагинацию, pinned-точки, SLA, стабильность, heatmap и активных гигеров;
- секция `attention` использует отдельный период внимания, будущие заказы и радиусную базу исполнителей;
- хранение готовых секций сохраняет поведение существующего кода и дает максимальное ускорение без дублирования SQL-логики в SQLite.

Существующая витрина `sales-by-project` остается на структурированных SQLite-таблицах. Новый механизм result-preload добавляется поверх общей системы job/run/schedule и используется дашбордом `workplace-analysis`.

## Jobs и расписание

В системе предзагрузки должно быть минимум два job:

- `sales-by-project` - существующая витрина продаж;
- `workplace-analysis` - новая витрина дашборда "Анализ точек".

У каждого job есть собственные настройки:

- `enabled`;
- `scheduleTime`;
- `timezone`;
- `refreshPastDays`;
- `refreshFutureDays`.

Для обратной совместимости старое поле `refresh_days` считается прошлым окном и мигрируется в `refresh_past_days`. Новое поле `refresh_future_days` получает значение `45`.

Ежедневное расписание пересчитывает скользящее окно:

```text
fromDate = today - refreshPastDays
toDateExclusive = today + refreshFutureDays + 1 day
```

При дефолтных настройках `45/45`, если сегодня 2026-06-16, scheduled range:

```text
fromDate = 2026-05-02
toDateExclusive = 2026-08-01
```

Ручной запуск остается с явным пользовательским диапазоном дат.

## Хранение result-preload

Добавляется SQLite-таблица готовых результатов:

```sql
CREATE TABLE preload_dashboard_results (
  job_id TEXT NOT NULL,
  dashboard_id TEXT NOT NULL,
  section TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  refreshed_at TEXT NOT NULL,
  source_from TEXT NOT NULL,
  source_to TEXT NOT NULL,
  PRIMARY KEY (job_id, section, cache_key)
);
```

`cache_key` строится из нормализованных фильтров секции. Для одинакового URL/набора фильтров ключ должен быть стабильным.

Дополнительно хранится каталог известных ключей, которые надо обновлять:

```sql
CREATE TABLE preload_dashboard_requests (
  job_id TEXT NOT NULL,
  dashboard_id TEXT NOT NULL,
  section TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  input_json TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (job_id, section, cache_key)
);
```

Когда пользователь открывает секцию дашборда, сервис:

1. нормализует фильтры;
2. регистрирует ключ в `preload_dashboard_requests`;
3. пытается прочитать `preload_dashboard_results`;
4. если payload найден и покрывает период, возвращает его;
5. если payload отсутствует, считает секцию через ClickHouse как сейчас.

## Обновление данных

Scheduled refresh для `workplace-analysis` берет известные ключи из `preload_dashboard_requests` и пересчитывает их на scheduled range.

Чтобы витрина появилась без ожидания пользовательских фильтров, seed-набор включает:

- `points` с дефолтными фильтрами;
- `attention` с дефолтными фильтрами;
- `points` для дефолтного лимита и первой страницы.

Если пользователь открывает другие фильтры, они автоматически становятся кандидатами для следующих предзагрузок.

## Fallback и безопасность

При ошибке чтения SQLite, отсутствии payload или неполном покрытии периода дашборд продолжает использовать текущий ClickHouse-путь.

Ошибки scheduled/manual обновлений пишутся в `preload_runs`. Пользовательский произвольный SQL не добавляется. Все SQL-запросы остаются в whitelisted коде дашбордов.

## Интерфейс управления

Страница `/admin/preload` должна показывать несколько витрин. Для каждой:

- название и job id;
- покрытие/последний успех/последнюю ошибку;
- ручной запуск с диапазоном дат;
- расписание с `enabled`, временем, днями назад и днями вперед;
- историю запусков.

Доступ остается по permission `preload-admin`, который выдается отдельным чекбоксом в настройках учетной записи.

## Не входит в первую итерацию

В первую итерацию не включаются:

- предзагрузка страниц `/dashboards/workplace-analysis/point`;
- предзагрузка `/gigers`, export и detail endpoints;
- произвольный список URL для ручной предзагрузки;
- перенос витрин в ClickHouse/ETL.

Эти части можно подключать следующим шагом после стабилизации общей result-preload схемы.

## Тестирование

Автотесты должны покрыть:

- миграцию `refresh_days` в `refresh_past_days` и `refresh_future_days`;
- расчет scheduled range `45 назад / 45 вперед`;
- регистрацию и чтение result-preload payload;
- отдельные job-ы в scheduler/service;
- fallback `workplace-analysis` на ClickHouse при miss;
- отдачу секции `workplace-analysis` из preload без ClickHouse;
- UI `/admin/preload` с несколькими витринами;
- ручной запуск и сохранение расписания по выбранному `jobId`.
