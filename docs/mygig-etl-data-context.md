# Контекст данных MyGig ETL

Дата фиксации контекста: 2026-06-01.

Источник доменной схемы: приложенные пользователем PDF и PNG со схемой БД для аналитических запросов, выгруженные из wiki MyGig. Фактическая структура `etl` дополнительно проверена через ClickHouse `system.tables`, `system.columns` и `system.parts`.

## Назначение данных

`etl` содержит данные платформы `mygig.ru`. MyGig связывает клиентов/бренды и их рабочие места с исполнителями-гигерами, которые бронируют и выполняют смены. В данных есть:

- спрос: заказы/заявки клиентов на смены;
- факт выполнения: смены и история изменения их статусов;
- предложение: исполнители, пользователи, регистрации, статусы, специализации;
- деньги: выплаты гигерам, ставки, платежные статусы;
- организационная структура: клиенты, работодатели со стороны клиента, контрагенты, рабочие места;
- мобильная и маркетинговая аналитика: установки, профили, сессии AppMetrica.

## Слои таблиц в `etl`

В базе найдено 58 таблиц.

Основные группы:

- `mg_*` - рекомендуемый слой для аналитики. Поля лучше типизированы: `DateTime`, `DateTime64`, `Array`, `Bool`, числовые типы.
- `mygig_*` - более сырой слой выгрузки из исходной базы. Часто содержит `_sdc_*` метаданные синхронизации, даты и массивы могут быть строками.
- `appmetrica_*`, `installations`, `profiles`, `sessions` - мобильная/маркетинговая аналитика и события установок/сессий.
- `etl_states` - техническое состояние ETL-инкрементов.

Правило по умолчанию: для дашбордов сначала использовать `mg_*`; к `mygig_*` обращаться, если нужное поле отсутствует или нужна проверка сырой выгрузки.

## Ключевые сущности исходной модели

### Клиенты и рабочие места

- `clients` / `mg_clients` - клиенты/бренды. Важные поля: `_id`, `title`, `organizationName`, `dateOfPayment`, `contractor`, `coordinator`, `deleted`.
- `workplaces` / `mg_workplaces` - торговые точки и адреса. Важные поля: `_id`, `title`, `client`, `contractor`, `contract`, `address__region`, `address__city`, `address__street`, `location__coordinates`, `technical_name`, `deleted`.
- `employers` / `mg_employers` - заказчики со стороны клиента. Связаны с `client`, `user`, `workplace`.
- `contractors` / `mg_contractors` - юридические контрагенты. Важные доменные значения: `contract_type` (`saas`, `services`, `processing`), `contract` (`mygigru`, `mygigtech`), `deleted`, `legal_name`.

### Планирование и факт смен

- `orders` / `mg_orders` - плановые заявки клиента на смены. Важные поля: `_id`, `amount`, `amount_guaranteed`, `client`, `workplace`, `spec`, `start`, `finish`, `hours`, `salary_per_hour`, `payment_per_hour`, `type`, `deleted`.
- `jobs` / `mg_jobs` - фактические смены. Важные поля: `_id`, `status`, `worker`, `source`, `client`, `workplace`, `employer`, `spec`, `start`, `finish`, `start_fact`, `finish_fact`, `salary_per_hour`, `payment_per_hour`, `api_client`, `contract`, `payment`.
- `job_history` / `mg_job_history` - история статусов смены. Важные поля: `_id`, `job`, `status`, `createdAt`, `updatedAt`, `source`, `worker`, `client`, `workplace`, `spec`, `api_client`, `contract`.

`orders` отражает потребность клиента. `jobs` отражает назначение/исполнение смены конкретным исполнителем. `job_history` нужен для воронок бронирования и таймлайна переходов статусов.

### Исполнители и пользователи

- `workers` / `mg_workers` - исполнители/гигеры. Важные поля: `_id`, `user`, `spec`, `status`, `inn`, `is_self_employed`, `employment_status`, `createdAt`, `updatedAt`, `city/region` поля адреса.
- `users` / `mg_users` - пользователи платформы. Важные поля: `_id`, `phone`, `role`, `email`, `firstname`, `lastname`, `createdAt`, `firstLoginAt`, `lastLoginAt`, `reg_source`, `smartphone_type`.
- `professions` / `mg_professions` - справочник специальностей. Важные поля: `_id`, `spec`, `caption`, `description`.

Статусы исполнителей из исходной схемы: `lead`, `registred`, `moderation`, `uploaded`, `ready`, `booked`, `worked`.

### Платежи

- `payments` / `mg_payments` - выплаты исполнителям. Важные поля: `_id`, `payment_status`, `worker`, `entityId`, `job`, `amount`, `fee`, `createdAt`, `done_at`, `bank_status`, `moderation_status`, `is_done`.

По исходной документации успешными платежами считаются статусы `bank_done` и `done`.

### Операторы и внутренние сотрудники

- `operators` / `mg_operators` - сотрудники MyGig.
- Поля `coordinator` в заказах, сменах, точках и истории указывают на координатора проекта от MyGig. В исходной wiki указано, что это manager в коллекции contractors; при построении отчетов нужно проверять фактическую семантику на данных.

## Основные связи

ObjectId в ClickHouse хранится как строка.

| Откуда | Куда | Назначение |
| --- | --- | --- |
| `mg_jobs.source` | `mg_orders._id` | заказ, из которого создана смена |
| `mg_jobs.worker` | `mg_workers._id` | исполнитель смены |
| `mg_jobs.client` | `mg_clients._id` | клиент/бренд |
| `mg_jobs.workplace` | `mg_workplaces._id` | рабочее место |
| `mg_jobs.employer` | `mg_employers._id` | заказчик со стороны клиента |
| `mg_jobs.spec` | `mg_professions.spec` | специальность |
| `mg_job_history.job` | `mg_jobs._id` | смена в истории |
| `mg_job_history.source` | `mg_orders._id` | заказ в истории |
| `mg_payments.worker` | `mg_workers._id` | получатель выплаты |
| `mg_payments.job` / `mg_payments.entityId` | `mg_jobs._id` | смена, за которую сделана выплата |
| `mg_workers.user` | `mg_users._id` | пользовательская учетная запись исполнителя |
| `mg_employers.user` | `mg_users._id` | пользовательская учетная запись заказчика |
| `mg_employers.client` | `mg_clients._id` | клиент работодателя |
| `mg_employers.workplace` | `mg_workplaces._id` | рабочее место работодателя |
| `mg_workplaces.client` | `mg_clients._id` | клиент рабочей точки |
| `mg_workplaces.contractor` | `mg_contractors._id` | юридический контрагент точки |
| `mg_orders.client` | `mg_clients._id` | клиент заказа |
| `mg_orders.workplace` | `mg_workplaces._id` | рабочее место заказа |
| `mg_orders.template` | `mg_templates._id` | шаблон заказа, если заполнен |

## Фактический каталог таблиц

Количество строк ниже взято из `system.parts` для активных частей на момент проверки.

| Таблица | Строк | Комментарий |
| --- | ---: | --- |
| `appmetrica_installations` | 84 874 | установки AppMetrica, новый слой с `_ingested_at` |
| `appmetrica_profiles` | 137 894 | профили AppMetrica |
| `appmetrica_profiles_copy` | 114 861 | копия профилей AppMetrica |
| `appmetrica_sessions` | 2 846 222 | сессии AppMetrica |
| `etl_states` | 4 | техническое состояние инкрементов |
| `installations` | 47 549 520 | большой сырой слой установок |
| `profiles` | 200 001 | профили, отдельный слой |
| `sessions` | 2 722 464 | сессии, отдельный слой |
| `rfm_phys_persons` | 2 124 833 | физлица/RFM-контекст |
| `mg_jobs` | 4 036 645 | смены, основной аналитический слой |
| `mg_job_history` | 20 966 060 | история статусов смен |
| `mg_orders` | 7 983 419 | заказы/заявки |
| `mg_payments` | 2 379 062 | выплаты |
| `mg_workers` | 1 474 002 | исполнители |
| `mg_users` | 1 484 315 | пользователи |
| `mg_clients` | 1 858 | клиенты |
| `mg_workplaces` | 267 038 | рабочие места |
| `mg_employers` | 22 115 | заказчики со стороны клиента |
| `mg_contractors` | 2 890 | контрагенты |
| `mg_professions` | 254 | специальности |
| `mg_documents` | 1 666 050 | документы |
| `mg_reviews` | 248 181 | отзывы |
| `mg_transactions` | 88 724 | транзакции |
| `mg_accounts` | 219 278 | аккаунты/счета |
| `mg_workers_funnels` | 367 953 | воронки исполнителей |
| `mg_interviews` | 35 589 | интервью/проверки |
| `mg_operators` | 715 | операторы |
| `mg_operators_call_history` | 2 283 504 | история звонков операторов |
| `mg_operators_history` | 3 439 640 | история операторов |
| `mg_clients_groups` | 86 | группы клиентов |
| `mg_zvonobot_history` | 15 | история звонобота |
| `mygig_jobs` | 1 128 641 | сырой слой смен |
| `mygig_job_history` | 8 740 613 | сырой слой истории смен |
| `mygig_orders` | 4 706 395 | сырой слой заказов |
| `mygig_payments` | 2 379 071 | сырой слой выплат |
| `mygig_workers` | 1 474 008 | сырой слой исполнителей |
| `mygig_users` | 1 484 320 | сырой слой пользователей |
| `mygig_clients` | 1 858 | сырой слой клиентов |
| `mygig_workplaces` | 267 038 | сырой слой рабочих мест |
| `mygig_employers` | 22 115 | сырой слой работодателей |
| `mygig_contractors` | 0 | сырой слой контрагентов, на момент проверки пустой |
| `mygig_professions` | 254 | сырой слой специальностей |
| `mygig_documents` | 230 000 | сырой слой документов |
| `mygig_reviews` | 106 299 | сырой слой отзывов |
| `mygig_transactions` | 60 000 | сырой слой транзакций |
| `mygig_accounts` | 219 278 | сырой слой аккаунтов |
| `mygig_workers_funnels` | 367 953 | сырой слой воронок |
| `mygig_worker_funnel` | 404 | отдельная таблица worker funnel |
| `mygig_interviews` | 35 589 | сырой слой интервью |
| `mygig_operators` | 715 | сырой слой операторов |
| `mygig_operators_call_history` | 1 371 760 | сырой слой истории звонков |
| `mygig_operators_history` | 4 905 884 | сырой слой истории операторов |
| `mygig_clients_groups` | 86 | сырой слой групп клиентов |
| `mygig_alfa_registry_caches` | 471 777 | реестры/кэши Альфа |
| `mygig_balancehistories` | 1 152 820 | история баланса |
| `mygig_procurement_documents_and_non_cash_operations` | 969 030 | закупочные документы и безналичные операции |
| `mygig_templates` | 60 000 | сырой слой шаблонов |
| `mygig_zvonobot_history` | 60 | сырой слой звонобота |

## Справочники статусов и важных значений

### Статусы смен `mg_jobs.status`

На момент проверки основные значения:

- `confirmed` - 2 105 633;
- `cancelled` - 1 848 342;
- `failed` - 51 908;
- `completed` - 14 430;
- `booked` - 12 517;
- `checkingout`, `going`, `inprogress`, `checkingin` - промежуточные статусы выполнения;
- редкие: `doccheck`, `toolate`, `delayed`, `revoked`.

Для факта выполненной смены в большинстве отчетов использовать `status = 'confirmed'`. Для операционной воронки использовать также `booked`, `going`, `inprogress`, `checkingout`, `completed`, `cancelled`, `failed`.

### История смен `mg_job_history.status`

Частые значения:

- пустой статус - 9 101 553 строк, требует осторожности при расчетах;
- `booked` - 3 237 412;
- `confirmed` - 1 872 990;
- `cancelled` - 1 812 189;
- `completed` - 1 534 403;
- `inprogress` - 1 261 972;
- `going` - 993 564;
- `checkingout` - 537 127;
- `checkingin` - 474 255;
- `failed` - 63 509.

### Платежи `mg_payments.payment_status`

- успешные: `bank_done`, `done`;
- неуспешные: `bank_rejected`, `rejected`;
- промежуточные: `bank_init`, `bank_processed`.

### Исполнители `mg_workers.status`

- `registred` - 817 466;
- `lead` - 354 493;
- `moderation` - 105 587;
- `ready` - 91 245;
- `worked` - 70 863;
- `uploaded` - 33 749;
- `booked` - 599.

### Пользовательские роли `mg_users.role`

Основные роли: `worker`, `employer`, `supervisor`. Также встречаются пустые значения, `operator`, `user`, `partner`, `recruiter`.

### Каналы `mg_jobs.api_client`

Основные значения: `android`, `internal`, `web`, `ios`, `import`.

### Контракты `mg_jobs.contract`

Основные значения: `mygigru`, `mygigtech`, пустое значение, редкое `mygigbiz`.

### Типы заказов `mg_orders.type`

Основные значения: `once`, `regular`.

## Временные диапазоны

Фактические диапазоны на момент проверки:

- `mg_jobs.createdAt`: 2020-05-04 - 2026-05-31.
- `mg_jobs.start`: 2020-03-09 - 2027-10-11. Есть будущие плановые смены.
- `mg_jobs.start_fact`: 2020-05-10 - 2026-05-31.
- `mg_orders.createdAt`: 2020-05-03 - 2026-06-01.
- `mg_orders.start`: 2002-08-21 - 2027-01-16. Значение 2002 выглядит как выброс или историческая/ошибочная дата.
- `mg_job_history.createdAt`: 2022-04-19 - 2026-05-31.
- `mg_payments.done_at`: 2020-09-17 - 2026-05-31.
- `mg_users.createdAt`: 2020-05-02 - 2026-05-31.
- `appmetrica_installations._ingested_at`: 2026-02-19 - 2026-05-31.
- `installations._sdc_extracted_at`: 2024-04-26 - 2026-02-17.

При построении дашбордов обязательно явно выбирать временное поле: `createdAt` для создания сущности, `start/finish` для планового периода смены, `start_fact/finish_fact` для фактического выполнения, `done_at` для выплат.

## Рекомендации для будущих дашбордов

### Операционный спрос и выполнение смен

Базовые таблицы: `mg_orders`, `mg_jobs`, `mg_job_history`, `mg_clients`, `mg_workplaces`, `mg_professions`.

Возможные метрики:

- созданные заказы и запрошенное количество исполнителей (`mg_orders.amount`);
- созданные смены (`mg_jobs`);
- выполненные смены (`mg_jobs.status = 'confirmed'`);
- отмены и провалы (`cancelled`, `failed`);
- fill rate: выполненные или назначенные смены относительно планового спроса;
- динамика по клиентам, рабочим местам, городам, специальностям.

### Финансы и маржинальность

Базовые таблицы: `mg_jobs`, `mg_payments`, `mg_clients`, `mg_workplaces`.

Возможные метрики:

- начисления гигерам: `salary_per_hour`, `salary_per_job`, `salary_per_unit`;
- стоимость для клиента: `payment_per_hour`, `payment_per_job`, `payment_per_unit`;
- выплаты по `mg_payments.amount`;
- успешные выплаты: `payment_status in ('bank_done', 'done')`;
- отклоненные выплаты: `payment_status in ('bank_rejected', 'rejected')`;
- потенциальная маржа на смене: разница между клиентской ставкой и ставкой исполнителя, с учетом фактических часов.

### Воронка исполнителей

Базовые таблицы: `mg_users`, `mg_workers`, `mg_workers_funnels`, `mg_jobs`, `mg_job_history`.

Возможные метрики:

- регистрации пользователей и исполнителей;
- переходы статусов `lead -> registred -> moderation -> uploaded -> ready -> booked -> worked`;
- доля готовых к работе (`ready`) и реально работавших (`worked`);
- активность по `lastLoginAt`, `firstLoginAt`;
- разрезы по источникам регистрации, городам, устройствам.

### Мобильная аналитика и привлечение

Базовые таблицы: `appmetrica_installations`, `appmetrica_profiles`, `appmetrica_sessions`, `installations`, `profiles`, `sessions`.

Возможные метрики:

- установки по дате, стране, городу, устройству, ОС;
- переустановки и reattribution;
- сессии по приложению и устройству;
- связка с пользователями возможна только после отдельного исследования ключей (`profile_id`, device id, user id), не считать ее очевидной.

## Практические SQL-подсказки

Пример join смен с измерениями:

```sql
SELECT
  toDate(j.start) AS shift_date,
  c.title AS client_title,
  w.address__city AS city,
  p.caption AS profession,
  count() AS jobs,
  countIf(j.status = 'confirmed') AS confirmed_jobs
FROM mg_jobs AS j
LEFT JOIN mg_clients AS c ON j.client = c._id
LEFT JOIN mg_workplaces AS w ON j.workplace = w._id
LEFT JOIN mg_professions AS p ON j.spec = p.spec
WHERE j.start >= now() - INTERVAL 30 DAY
GROUP BY shift_date, client_title, city, profession
ORDER BY shift_date DESC, jobs DESC
```

Пример выплат:

```sql
SELECT
  toDate(done_at) AS payment_date,
  payment_status,
  count() AS payments,
  sum(amount) AS amount
FROM mg_payments
WHERE done_at IS NOT NULL
GROUP BY payment_date, payment_status
ORDER BY payment_date DESC
```

## Ограничения и осторожность

- В первой итерации web-сервис не имеет авторизации. Не выставлять наружу без reverse proxy или другого контроля доступа.
- В таблицах есть персональные данные: телефоны, email, ФИО, паспортные данные, ИНН, СНИЛС. Не выводить их в дашбордах без явной необходимости и маскирования.
- В `mg_job_history.status` много пустых значений; не использовать эту таблицу без фильтрации статусов.
- В `mg_orders.start` есть очень ранние даты, похожие на выбросы. Для отчетности лучше задавать явные временные фильтры и проверять выбросы.
- В `mygig_*` поля часто строковые и могут требовать парсинга; не смешивать `mg_*` и `mygig_*` в одном расчете без проверки типов.
- Текущие row counts - снимок на 2026-06-01, они будут меняться после новых ETL-прогонов.
