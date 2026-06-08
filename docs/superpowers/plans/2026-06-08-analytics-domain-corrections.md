# Analytics Domain Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Исправить доменные правила расчетов MyGig по замечаниям аналитика: считать смены только через актуальные заказы, исключить тестовых клиентов, `processing` и удаленные транзакции, пересчитать самобронь по первому событию истории и привести финансовые ставки к безопасной числовой модели.

**Architecture:** Ввести общий модуль SQL-правил для актуальных заказов, валидных смен, числовых ставок и транзакций, затем заменить локальные строковые условия в дашбордах и SQL-инспекторе. Слой `mg_*` остается основным; `mygig_*` не используется как проверочный источник и допускается только при отсутствии аналога в `mg_*`.

**Tech Stack:** Node.js 22, Express, ClickHouse SQL, `node:test`, server-rendered HTML, существующие кеши `dashboardSectionCache`, `preload.sqlite` и SQL-инспектор.

---

## Scope Check

Замечания аналитика затрагивают несколько экранов, но это один общий доменный слой расчетов. План намеренно не добавляет новые дашборды и не вводит пользовательский SQL в UI.

Затронутые правила:

- `mg_jobs` должны считаться только через `mg_jobs.source = mg_orders._id` и актуальный заказ: `deleted = 0`, `is_hidden = 0`.
- Заказы и смены исключают тестовые клиентские группы: `MyGig ГПХ`, `MyGig Demo`, `Проверка выплаты Альфа-банк`, `Тест`, `ТестДляПроверки`, `ТестСдокументами`, `ООО «МгРу»`.
- Контракты `processing` исключаются из аналитических расчетов.
- Самобронь считается по первому непустому событию `mg_job_history` в рамках смены, а не по любому `status = 'booked'`.
- `mg_transactions.deleted = true` исключаются; связанные со сменой транзакции учитываются как положительные и отрицательные суммы.
- Нулевые/пустые/строковые ставки не должны смещать средние и не должны создавать деление на ноль.
- `confirmed`-смена типа `piecework` с непустым `piecework` и нулевой фактической клиентской оплатой считается прогулом.
- Необязательные `CROSS JOIN` нужно убрать; географические many-to-many расчеты оставлять только там, где они действительно нужны и ограничены bounding box.

## File Structure

- Create: `src/analyticsDomainSql.js`
  - Общие SQL-helper функции: исключенные клиенты, актуальный заказ, исключение `processing`, безопасные числовые выражения, положительные nullable-ставки, сумма транзакций.
- Create: `test/analyticsDomainSql.test.js`
  - Тесты строковых SQL-helper функций.
- Modify: `src/successfulConfirmedShift.js`
  - Добавить `piecework`-признак прогула и экспорт безопасных числовых helper-выражений.
- Modify: `test/successfulConfirmedShift.test.js`
  - Проверить `piecework`, строковые числа, отсутствие прямых `ifNull(field, 0)` для ставок.
- Modify: `src/salesByProjectDashboard.js`
  - Перевести `orderBaseWhere`, `shift_facts`, `self_bookings`, транзакции, выручку и среднюю ставку на общий доменный слой.
- Modify: `src/preloadSalesByProject.js`
  - Применить те же SQL-правила к предзагрузке продаж.
- Modify: `test/salesByProjectDashboard.test.js`, `test/preloadSalesByProject.test.js`
  - Обновить ожидания по актуальному заказу, самоброни, транзакциям и ставкам.
- Modify: `src/workplaceAnalysisDashboard.js`, `src/workplacePointDashboard.js`
  - Связать все факты смен и историю через актуальные заказы; убрать лишние `CROSS JOIN` в агрегатах.
- Modify: `test/workplaceAnalysisDashboard.test.js`, `test/workplacePointDashboard.test.js`
  - Проверить актуальные заказы, фильтры тестовых клиентов, `processing`, `piecework`-прогулы и отсутствие лишних cross join.
- Modify: `src/cityAnalysisDashboard.js`, `src/heatmapDashboard.js`
  - Применить доменные фильтры заказов и перепривязать `booked/completed` пользователей через `job -> order`.
- Modify: `test/cityAnalysisDashboard.test.js`, `test/heatmapDashboard.test.js`
  - Проверить отсутствие `mygig_*`, актуальные заказы и bounded географические join.
- Modify: `src/workerCancellationsDashboard.js`
  - Исключить смены без актуального заказа и учитывать `piecework` в successful confirmed helper.
- Modify: `test/workerCancellationsDashboard.test.js`
  - Проверить join на актуальные заказы и фильтр удаленных/скрытых заказов.
- Modify: `src/sqlMetricInfo.js`, `test/sqlMetricInfo.test.js`
  - Синхронизировать SQL-инспектор с новыми правилами.
- Modify: `AGENTS.md`, `docs/mygig-etl-data-context.md`, `docs/dashboards/*.md`, `README.md`
  - Обновить проектную память и пользовательскую документацию.

Перед редактированием кода выполнить:

```bash
git status --short
```

Ожидаемо: нет чужих изменений или они явно не относятся к этим файлам. Не откатывать чужие изменения.

---

### Task 1: Shared Domain SQL Helpers

**Files:**
- Create: `src/analyticsDomainSql.js`
- Create: `test/analyticsDomainSql.test.js`
- Modify: `src/successfulConfirmedShift.js`
- Modify: `test/successfulConfirmedShift.test.js`

- [ ] **Step 1: Write failing tests for actual-order and numeric SQL helpers**

Create `test/analyticsDomainSql.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  EXCLUDED_CLIENT_TITLES,
  actualOrderWhere,
  nonProcessingContractCondition,
  nullablePositiveNumberExpression,
  transactionAmountExpression
} = require('../src/analyticsDomainSql');

test('actualOrderWhere excludes deleted hidden test clients and processing contracts', () => {
  const where = actualOrderWhere({ orderAlias: 'o', clientAlias: 'c', contractorAlias: 'ct' });

  assert.equal(where.includes('ifNull(o.deleted, 0) = 0'), true);
  assert.equal(where.includes('ifNull(o.is_hidden, 0) = 0'), true);
  assert.equal(where.includes('ifNull(c.title, \'\') NOT IN'), true);
  assert.equal(where.includes('MyGig Demo'), true);
  assert.equal(where.includes('ООО «МгРу»'), true);
  assert.equal(where.includes("!= 'processing'"), true);
});

test('actualOrderWhere can keep explicit include flags for diagnostic screens', () => {
  const where = actualOrderWhere({
    orderAlias: 'o',
    clientAlias: 'c',
    contractorAlias: 'ct',
    includeDeletedOrders: true,
    includeHiddenOrders: true
  });

  assert.equal(where.includes('ifNull(o.deleted, 0) = 0'), false);
  assert.equal(where.includes('ifNull(o.is_hidden, 0) = 0'), false);
  assert.equal(where.includes('ifNull(c.title, \'\') NOT IN'), true);
  assert.equal(where.includes("!= 'processing'"), true);
});

test('nonProcessingContractCondition falls back from order contract type to contractor type', () => {
  const condition = nonProcessingContractCondition({ orderAlias: 'o', contractorAlias: 'ct' });

  assert.equal(
    condition,
    "ifNull(coalesce(nullIf(o.contract_type, ''), nullIf(ct.contract_type, '')), '') != 'processing'"
  );
});

test('nullablePositiveNumberExpression parses strings but keeps zero and invalid values out of averages', () => {
  const expression = nullablePositiveNumberExpression('j', 'salary_per_hour');

  assert.equal(
    expression,
    "nullIf(toFloat64OrNull(nullIf(trimBoth(toString(j.salary_per_hour)), '')), 0)"
  );
});

test('transactionAmountExpression keeps signed values and ignores empty numeric strings', () => {
  const expression = transactionAmountExpression('t');

  assert.equal(expression.includes('toFloat64OrNull'), true);
  assert.equal(expression.includes('payment_amount'), true);
  assert.equal(expression.includes('amount'), true);
  assert.equal(expression.includes('abs('), false);
});

test('excluded client list is explicit and stable', () => {
  assert.deepEqual(EXCLUDED_CLIENT_TITLES, [
    'MyGig ГПХ',
    'MyGig Demo',
    'Проверка выплаты Альфа-банк',
    'Тест',
    'ТестДляПроверки',
    'ТестСдокументами',
    'ООО «МгРу»'
  ]);
});
```

- [ ] **Step 2: Run helper tests and verify they fail**

Run:

```bash
npm test -- test/analyticsDomainSql.test.js
```

Expected: FAIL because `src/analyticsDomainSql.js` does not exist.

- [ ] **Step 3: Implement `src/analyticsDomainSql.js`**

Create:

```js
const EXCLUDED_CLIENT_TITLES = [
  'MyGig ГПХ',
  'MyGig Demo',
  'Проверка выплаты Альфа-банк',
  'Тест',
  'ТестДляПроверки',
  'ТестСдокументами',
  'ООО «МгРу»'
];

function sqlStringLiteral(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function excludedClientCondition(clientAlias = 'c') {
  return `ifNull(${clientAlias}.title, '') NOT IN (${EXCLUDED_CLIENT_TITLES.map(sqlStringLiteral).join(', ')})`;
}

function nonProcessingContractCondition({ orderAlias = 'o', contractorAlias = 'ct' } = {}) {
  return `ifNull(coalesce(nullIf(${orderAlias}.contract_type, ''), nullIf(${contractorAlias}.contract_type, '')), '') != 'processing'`;
}

function actualOrderConditions({
  orderAlias = 'o',
  clientAlias = 'c',
  contractorAlias = 'ct',
  includeDeletedOrders = false,
  includeHiddenOrders = false
} = {}) {
  const conditions = [];

  if (!includeDeletedOrders) {
    conditions.push(`ifNull(${orderAlias}.deleted, 0) = 0`);
  }

  if (!includeHiddenOrders) {
    conditions.push(`ifNull(${orderAlias}.is_hidden, 0) = 0`);
  }

  conditions.push(excludedClientCondition(clientAlias));
  conditions.push(nonProcessingContractCondition({ orderAlias, contractorAlias }));

  return conditions;
}

function actualOrderWhere(options = {}) {
  return actualOrderConditions(options).join('\n    AND ');
}

function numericExpression(alias, field) {
  return `toFloat64OrZero(ifNull(toString(${alias}.${field}), ''))`;
}

function nullableNumberExpression(alias, field) {
  return `toFloat64OrNull(nullIf(trimBoth(toString(${alias}.${field})), ''))`;
}

function nullablePositiveNumberExpression(alias, field) {
  return `nullIf(${nullableNumberExpression(alias, field)}, 0)`;
}

function positiveOrZeroNumberExpression(alias, field) {
  return `ifNull(${nullablePositiveNumberExpression(alias, field)}, 0)`;
}

function transactionAmountExpression(alias = 't') {
  return `coalesce(${nullableNumberExpression(alias, 'payment_amount')}, ${nullableNumberExpression(alias, 'amount')}, 0)`;
}

module.exports = {
  EXCLUDED_CLIENT_TITLES,
  actualOrderConditions,
  actualOrderWhere,
  excludedClientCondition,
  nonProcessingContractCondition,
  nullableNumberExpression,
  nullablePositiveNumberExpression,
  numericExpression,
  positiveOrZeroNumberExpression,
  transactionAmountExpression
};
```

- [ ] **Step 4: Add piecework tests to successful confirmed shift helper**

In `test/successfulConfirmedShift.test.js`, add:

```js
test('successful confirmed shift excludes piecework absences with zero client payment', () => {
  const condition = successfulConfirmedShiftCondition('j');

  assert.equal(condition.includes('j.piecework'), true);
  assert.equal(condition.includes('notEmpty'), true);
  assert.equal(condition.includes("toFloat64OrZero(ifNull(toString(j.payment), '')) <= 0"), true);
  assert.equal(condition.includes('AND NOT'), true);
});
```

- [ ] **Step 5: Update `src/successfulConfirmedShift.js`**

Add:

```js
function pieceworkNotEmptyCondition(alias) {
  return `notEmpty(ifNull(${sqlField(alias, 'piecework')}, []))`;
}

function pieceworkAbsenceCondition(alias) {
  const payment = numericFieldExpression(alias, 'payment');

  return `${pieceworkNotEmptyCondition(alias)} AND ${payment} <= 0`;
}
```

Change `successfulConfirmedShiftCondition` to:

```js
function successfulConfirmedShiftCondition(alias) {
  return [
    `ifNull(${sqlField(alias, 'status')}, '') = 'confirmed'`,
    `(${positiveAccrualCondition(alias)})`,
    `NOT (${pieceworkAbsenceCondition(alias)})`
  ].join(' AND ');
}
```

Export `pieceworkAbsenceCondition` only if tests in later tasks need direct assertions.

- [ ] **Step 6: Run focused helper tests**

Run:

```bash
npm test -- test/analyticsDomainSql.test.js test/successfulConfirmedShift.test.js
```

Expected: PASS.

---

### Task 2: Sales By Project And Preload Rules

**Files:**
- Modify: `src/salesByProjectDashboard.js`
- Modify: `src/preloadSalesByProject.js`
- Modify: `test/salesByProjectDashboard.test.js`
- Modify: `test/preloadSalesByProject.test.js`

- [ ] **Step 1: Write failing sales dashboard tests**

In `test/salesByProjectDashboard.test.js`, update the existing SQL semantics test and add these assertions:

```js
assert.ok(calls.some((call) => call.query.includes('actual_orders AS (')));
assert.ok(calls.some((call) => call.query.includes('INNER JOIN actual_orders AS ao ON j.source = ao.order_id')));
assert.ok(calls.some((call) => call.query.includes('ifNull(o.is_hidden, 0) = 0')));
assert.ok(calls.some((call) => call.query.includes("ifNull(c.title, '') NOT IN")));
assert.ok(calls.some((call) => call.query.includes('MyGig Demo')));
assert.ok(calls.some((call) => call.query.includes("!= 'processing'")));
assert.ok(calls.some((call) => call.query.includes('row_number() OVER (PARTITION BY h.job')));
assert.ok(calls.some((call) => call.query.includes("ifNull(fh.first_initiator, '') = 'worker' AS is_self_booked")));
assert.equal(calls.some((call) => call.query.includes("max(if(h.status = 'booked' AND h.initiator = 'worker'")), false);
assert.ok(calls.some((call) => call.query.includes('ifNull(t.deleted, 0) = 0')));
assert.equal(calls.some((call) => call.query.includes("t.transaction_type = 'surcharge'")), false);
assert.ok(calls.some((call) => call.query.includes('j.piecework AS piecework')));
assert.ok(calls.some((call) => call.query.includes('nullIf(toFloat64OrNull')));
```

Add a dedicated transaction test:

```js
test('loadSalesByProjectDashboard uses signed non-deleted transactions for selected shift facts', async () => {
  const { calls, client } = createDashboardClient({});

  await loadSalesByProjectDashboard(client, {
    period: 'month',
    from: '2026-04-01',
    to: '2026-04-30'
  }, new Date('2026-06-01T12:00:00.000Z'));

  assert.ok(calls.some((call) => call.query.includes('FROM mg_transactions AS t')));
  assert.ok(calls.some((call) => call.query.includes('INNER JOIN shift_facts AS sf ON t.entityId = sf.job')));
  assert.ok(calls.some((call) => call.query.includes('ifNull(t.deleted, 0) = 0')));
  assert.equal(calls.some((call) => call.query.includes("t.transaction_type = 'surcharge'")), false);
  assert.ok(calls.some((call) => call.query.includes('sum(')));
});
```

- [ ] **Step 2: Write failing preload query tests**

In `test/preloadSalesByProject.test.js`, extend `sales preload query builders use parameterized ClickHouse ranges`:

```js
assert.equal(queries.orderFacts.includes('actual_orders AS ('), true);
assert.equal(queries.shiftFacts.includes('actual_orders AS ('), true);
assert.equal(queries.shiftFacts.includes('INNER JOIN actual_orders AS ao ON j.source = ao.order_id'), true);
assert.equal(queries.shiftFacts.includes('row_number() OVER (PARTITION BY h.job'), true);
assert.equal(queries.shiftFacts.includes("ifNull(fh.first_initiator, '') = 'worker' AS is_self_booked"), true);
assert.equal(queries.shiftFacts.includes("max(if(h.status = 'booked' AND h.initiator = 'worker'"), false);
assert.equal(queries.shiftFacts.includes('ifNull(t.deleted, 0) = 0'), true);
assert.equal(queries.shiftFacts.includes("t.transaction_type = 'surcharge'"), false);
assert.equal(queries.shiftFacts.includes('j.piecework AS piecework'), true);
```

- [ ] **Step 3: Run focused tests and verify they fail**

Run:

```bash
npm test -- test/salesByProjectDashboard.test.js test/preloadSalesByProject.test.js
```

Expected: FAIL on missing `actual_orders`, first-history self-booking, transaction deletion filter, and `piecework`.

- [ ] **Step 4: Implement actual order CTE in sales modules**

In both `src/salesByProjectDashboard.js` and `src/preloadSalesByProject.js`, import:

```js
const {
  actualOrderWhere,
  nullablePositiveNumberExpression,
  positiveOrZeroNumberExpression,
  transactionAmountExpression
} = require('./analyticsDomainSql');
```

Replace order queries with an `actual_orders` CTE:

```sql
WITH actual_orders AS (
  SELECT
    o._id AS order_id,
    o.start AS order_start,
    o.client AS client,
    o.workplace AS workplace,
    o.amount AS amount,
    o.contract_type AS order_contract_type,
    c.title AS client_title,
    w.contractor AS contractor,
    ct.contract_type AS contractor_contract_type,
    ct.comission AS commission_percent
  FROM mg_orders AS o
  LEFT JOIN mg_clients AS c ON o.client = c._id
  LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
  LEFT JOIN mg_contractors AS ct ON w.contractor = ct._id
  WHERE ${actualOrderWhere({ orderAlias: 'o', clientAlias: 'c', contractorAlias: 'ct' })}
    AND o.start >= {from:DateTime}
    AND o.start < {to:DateTime}
)
```

For order summary/trend/brand queries, read from `actual_orders` instead of raw `mg_orders`.

- [ ] **Step 5: Implement valid shift facts and first-history self-booking**

In `shift_facts`, include only shifts linked to `actual_orders`:

```sql
FROM mg_jobs AS j
INNER JOIN actual_orders AS ao ON j.source = ao.order_id
WHERE ifNull(j._id, '') != ''
  AND ifNull(j.deleted, 0) = 0
```

Add selected fields:

```sql
j.piecework AS piecework,
ao.client AS order_client,
ao.workplace AS order_workplace,
ao.order_contract_type AS order_contract_type,
ao.contractor_contract_type AS contractor_contract_type,
ao.commission_percent AS commission_percent
```

Replace `self_bookings` with:

```sql
history_ranked AS (
  SELECT
    h.job AS job,
    ifNull(h.status, '') AS first_status,
    ifNull(h.initiator, '') AS first_initiator,
    row_number() OVER (
      PARTITION BY h.job
      ORDER BY coalesce(h.createdAt, h.updatedAt), h._id
    ) AS rn
  FROM mg_job_history AS h
  INNER JOIN shift_facts AS sf ON h.job = sf.job
  WHERE ifNull(h.job, '') != ''
    AND ifNull(h.status, '') != ''
),
first_history AS (
  SELECT
    job,
    first_status,
    first_initiator
  FROM history_ranked
  WHERE rn = 1
)
```

Then compute:

```sql
if(ifNull(fh.first_initiator, '') = 'worker', 1, 0) AS is_self_booked
```

- [ ] **Step 6: Implement signed non-deleted transaction sums**

Replace `surcharges` with `job_transactions`:

```sql
job_transactions AS (
  SELECT
    t.entityId AS job,
    sum(${transactionAmountExpression('t')}) AS transaction_amount
  FROM mg_transactions AS t
  INNER JOIN shift_facts AS sf ON t.entityId = sf.job
  WHERE ifNull(t.deleted, 0) = 0
    AND ifNull(t.entityId, '') != ''
  GROUP BY t.entityId
)
```

Use `transaction_amount` in revenue. Do not take `abs()`; ClickHouse signed values must remain signed.

- [ ] **Step 7: Use nullable positive rates for amounts and averages**

Use helper expressions:

```js
const salaryPerHour = positiveOrZeroNumberExpression('sf', 'salary_per_hour');
const salaryPerJob = positiveOrZeroNumberExpression('sf', 'salary_per_job');
const paymentPerHour = positiveOrZeroNumberExpression('sf', 'payment_per_hour');
const paymentPerJob = positiveOrZeroNumberExpression('sf', 'payment_per_job');
const hours = positiveOrZeroNumberExpression('sf', 'hours');
```

Worker amount:

```sql
if(${salaryPerJob} > 0, ${salaryPerJob}, ${salaryPerHour} * ${hours}) AS worker_shift_amount
```

Customer amount:

```sql
if(${paymentPerJob} > 0, ${paymentPerJob}, ${paymentPerHour} * ${hours}) AS customer_shift_amount
```

Average hourly rate:

```sql
avgIf(worker_rate_hour, is_successful_confirmed_shift = 1 AND worker_rate_hour IS NOT NULL)
```

where `worker_rate_hour` is:

```sql
${nullablePositiveNumberExpression('sf', 'salary_per_hour')} AS worker_rate_hour
```

- [ ] **Step 8: Run focused sales tests**

Run:

```bash
npm test -- test/salesByProjectDashboard.test.js test/preloadSalesByProject.test.js test/preloadStore.test.js
```

Expected: PASS.

---

### Task 3: Workplace And Worker Dashboards Use Actual Orders

**Files:**
- Modify: `src/workplaceAnalysisDashboard.js`
- Modify: `src/workplacePointDashboard.js`
- Modify: `src/workerCancellationsDashboard.js`
- Modify: `test/workplaceAnalysisDashboard.test.js`
- Modify: `test/workplacePointDashboard.test.js`
- Modify: `test/workerCancellationsDashboard.test.js`

- [ ] **Step 1: Write failing tests for actual-order joins in workplace analysis**

In `test/workplaceAnalysisDashboard.test.js`, add assertions in SQL tests:

```js
assert.equal(call.query.includes("ifNull(c.title, '') NOT IN"), true);
assert.equal(call.query.includes('MyGig Demo'), true);
assert.equal(call.query.includes("!= 'processing'"), true);
assert.equal(call.query.includes('ifNull(o.is_hidden, 0) = 0'), true);
assert.equal(call.query.includes('INNER JOIN filtered_orders AS fo ON j.source = fo.order_id'), true);
```

For attention query:

```js
assert.equal(call.query.includes('covered_jobs AS ('), true);
assert.equal(call.query.includes('INNER JOIN filtered_orders AS fo ON j.source = fo.order_id'), true);
assert.equal(call.query.includes('mg_job_history AS h'), false);
```

- [ ] **Step 2: Write failing tests for workplace point and worker cancellations**

In `test/workplacePointDashboard.test.js`, assert:

```js
assert.equal(call.query.includes("ifNull(c.title, '') NOT IN"), true);
assert.equal(call.query.includes("!= 'processing'"), true);
assert.equal(call.query.includes('INNER JOIN filtered_orders AS fo ON j.source = fo.order_id'), true);
assert.equal(call.query.includes('j.piecework AS piecework'), true);
```

In `test/workerCancellationsDashboard.test.js`, assert in worker and detail SQL:

```js
assert.equal(workerCall.query.includes('actual_orders AS ('), true);
assert.equal(workerCall.query.includes('INNER JOIN actual_orders AS ao ON j.source = ao.order_id'), true);
assert.equal(workerCall.query.includes('ifNull(o.is_hidden, 0) = 0'), true);
assert.equal(workerCall.query.includes("ifNull(c.title, '') NOT IN"), true);
assert.equal(workerCall.query.includes("!= 'processing'"), true);
```

- [ ] **Step 3: Run focused tests and verify they fail**

Run:

```bash
npm test -- test/workplaceAnalysisDashboard.test.js test/workplacePointDashboard.test.js test/workerCancellationsDashboard.test.js
```

Expected: FAIL until actual-order conditions are added consistently.

- [ ] **Step 4: Update order where builders**

In `workplaceAnalysisDashboard.js` and `workplacePointDashboard.js`, import:

```js
const { actualOrderConditions } = require('./analyticsDomainSql');
```

Append these conditions to the existing order `where` arrays after includeDeleted/includeHidden logic:

```js
where.push(...actualOrderConditions({
  orderAlias: 'o',
  clientAlias: 'c',
  contractorAlias: 'ct',
  includeDeletedOrders: filters.includeDeletedOrders,
  includeHiddenOrders: filters.includeHiddenOrders
}).filter((condition) => !where.includes(condition)));
```

Ensure all query builders that use this `whereSql` have the required joins:

```sql
LEFT JOIN mg_clients AS c ON o.client = c._id
LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
LEFT JOIN mg_contractors AS ct ON w.contractor = ct._id
```

For `workplacePointDashboard.js` queries that currently do not join `mg_clients` or `mg_contractors`, add those joins before `WHERE ${whereSql}`.

- [ ] **Step 5: Update shift CTEs**

In both workplace modules, ensure `shiftFactsCte()` selects `piecework` and joins filtered orders:

```sql
FROM mg_jobs AS j
INNER JOIN filtered_orders AS fo ON j.source = fo.order_id
WHERE ifNull(j.deleted, 0) = 0
```

Do not count a shift by `j.start` alone when it is part of an order-facing metric.

- [ ] **Step 6: Update worker cancellations CTEs**

In `workerCancellationsDashboard.js`, create `actual_orders` inside `workerCancellationMetricsCtes()` and detail CTEs:

```sql
actual_orders AS (
  SELECT o._id AS order_id
  FROM mg_orders AS o
  LEFT JOIN mg_clients AS c ON o.client = c._id
  LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
  LEFT JOIN mg_contractors AS ct ON w.contractor = ct._id
  WHERE ${actualOrderWhere({ orderAlias: 'o', clientAlias: 'c', contractorAlias: 'ct' })}
),
shift_facts AS (
  SELECT ...
  FROM mg_jobs AS j
  INNER JOIN actual_orders AS ao ON j.source = ao.order_id
  WHERE j.start >= {from:DateTime}
    AND j.start < {to:DateTime}
    AND ifNull(j.worker, '') != ''
    AND ifNull(j.deleted, 0) = 0
)
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
npm test -- test/workplaceAnalysisDashboard.test.js test/workplacePointDashboard.test.js test/workerCancellationsDashboard.test.js
```

Expected: PASS.

---

### Task 4: City Analysis, Heatmap, And History Joins

**Files:**
- Modify: `src/cityAnalysisDashboard.js`
- Modify: `src/heatmapDashboard.js`
- Modify: `test/cityAnalysisDashboard.test.js`
- Modify: `test/heatmapDashboard.test.js`

- [ ] **Step 1: Write failing city-analysis tests**

In `test/cityAnalysisDashboard.test.js`, add assertions for summary, responses, dynamics and details queries:

```js
assert.equal(call.query.includes("ifNull(c.title, '') NOT IN"), true);
assert.equal(call.query.includes('MyGig Demo'), true);
assert.equal(call.query.includes("!= 'processing'"), true);
assert.equal(call.query.includes('INNER JOIN filtered_orders AS fo ON job.source = fo.order_id'), true);
assert.equal(call.query.includes('INNER JOIN filtered_orders AS fo ON history.source = fo.order_id'), false);
assert.equal(call.query.includes('FROM mygig_'), false);
```

For booked users, expect `history -> job -> filtered_orders`:

```js
assert.equal(call.query.includes('INNER JOIN mg_jobs AS job ON history.job = job._id'), true);
assert.equal(call.query.includes('INNER JOIN filtered_orders AS fo ON job.source = fo.order_id'), true);
```

- [ ] **Step 2: Write failing heatmap tests**

In `test/heatmapDashboard.test.js`, assert:

```js
assert.equal(call.query.includes("ifNull(c.title, '') NOT IN"), true);
assert.equal(call.query.includes("!= 'processing'"), true);
assert.equal(call.query.includes('ifNull(o.is_hidden, 0) = 0'), true);
assert.equal(call.query.includes('CROSS JOIN mg_workers AS worker'), false);
```

- [ ] **Step 3: Run focused tests and verify they fail**

Run:

```bash
npm test -- test/cityAnalysisDashboard.test.js test/heatmapDashboard.test.js
```

Expected: FAIL until city and heatmap SQL use the shared domain filters.

- [ ] **Step 4: Update city order filters**

In `src/cityAnalysisDashboard.js`, import `actualOrderConditions` and append it in `orderWhereForFilters()` with current include flags.

Ensure `cityOptionsQuery()` also joins clients/workplaces/contractors and applies:

```sql
AND ifNull(o.deleted, 0) = 0
AND ifNull(o.is_hidden, 0) = 0
AND ifNull(c.title, '') NOT IN (...)
AND ifNull(coalesce(nullIf(o.contract_type, ''), nullIf(ct.contract_type, '')), '') != 'processing'
```

- [ ] **Step 5: Replace history-only booked users**

Replace `bookedUsersCte()`:

```sql
booked_users AS (
  SELECT DISTINCT worker.user AS user_id
  FROM mg_job_history AS history
  INNER JOIN mg_jobs AS job ON history.job = job._id
  INNER JOIN filtered_orders AS fo ON job.source = fo.order_id
  INNER JOIN mg_workers AS worker ON history.worker = worker._id
  WHERE ifNull(history.status, '') = 'booked'
    AND ifNull(job.deleted, 0) = 0
    AND ifNull(worker.user, '') != ''
)
```

Apply the same `history -> job -> filtered_orders` pattern in dynamic booked users and city giger details.

- [ ] **Step 6: Update heatmap filters and bounded joins**

In `src/heatmapDashboard.js`, import `actualOrderConditions` and apply it in `baseOrderWhere()`.

Replace unbounded worker cross joins:

```sql
FROM worker_rows AS worker
INNER JOIN demand_bounds AS bounds ON bounds.points > 0
```

For point influence, prefer:

```sql
FROM demand_points AS dp
INNER JOIN active_workers AS aw
  ON aw.worker_coordinates[1] BETWEEN dp.lon - (15000 / (111320 * greatest(abs(cos(dp.lat * pi() / 180)), 0.2))) AND dp.lon + (15000 / (111320 * greatest(abs(cos(dp.lat * pi() / 180)), 0.2)))
  AND aw.worker_coordinates[2] BETWEEN dp.lat - (15000 / 111000) AND dp.lat + (15000 / 111000)
WHERE greatCircleDistance(...) <= 15000
```

Keep the distance predicate; the join change avoids a full cartesian product before bounding.

- [ ] **Step 7: Run focused tests**

Run:

```bash
npm test -- test/cityAnalysisDashboard.test.js test/heatmapDashboard.test.js
```

Expected: PASS.

---

### Task 5: Remove Redundant Cross Joins And Guard Divisions

**Files:**
- Modify: `src/workplaceAnalysisDashboard.js`
- Modify: `src/workplacePointDashboard.js`
- Modify: `src/cityAnalysisDashboard.js`
- Modify: `src/heatmapDashboard.js`
- Modify: matching dashboard tests

- [ ] **Step 1: Write failing cross-join audit tests**

Add targeted assertions to existing tests:

```js
assert.equal(call.query.includes('CROSS JOIN shift_summary'), false);
assert.equal(call.query.includes('CROSS JOIN booked_workers'), false);
assert.equal(call.query.includes('CROSS JOIN display_total'), false);
assert.equal(call.query.includes('CROSS JOIN mg_workers AS worker'), false);
```

Do not assert that every `CROSS JOIN` is gone globally; scalar bounds and bounded geospatial joins may still be valid if ClickHouse requires them.

- [ ] **Step 2: Run dashboard tests and verify they fail**

Run:

```bash
npm test -- test/workplaceAnalysisDashboard.test.js test/workplacePointDashboard.test.js test/cityAnalysisDashboard.test.js test/heatmapDashboard.test.js
```

Expected: FAIL where redundant cross joins still exist.

- [ ] **Step 3: Replace scalar cross joins with scalar subselects**

For summary queries like:

```sql
FROM order_summary AS os
CROSS JOIN shift_summary AS ss
CROSS JOIN booked_workers AS bw
```

replace with:

```sql
SELECT
  (SELECT ordered_shifts FROM order_summary) AS ordered_shifts,
  ifNull((SELECT completed_shifts FROM shift_summary), 0) AS completed_shifts,
  ifNull((SELECT unique_booked_workers FROM booked_workers), 0) AS unique_booked_workers
FORMAT JSONEachRow
```

For display totals, use a scalar subselect in the selected expression instead of `CROSS JOIN display_total`.

- [ ] **Step 4: Guard every ratio**

For every ratio introduced or touched in this plan, use:

```sql
if(denominator > 0, numerator / denominator, 0)
```

For averages over rates, use positive nullable rates:

```sql
avgIf(rate, rate IS NOT NULL AND rate > 0)
```

Do not use `avg(ifNull(rate, 0))`.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- test/workplaceAnalysisDashboard.test.js test/workplacePointDashboard.test.js test/cityAnalysisDashboard.test.js test/heatmapDashboard.test.js
```

Expected: PASS.

---

### Task 6: SQL Inspector And Documentation

**Files:**
- Modify: `src/sqlMetricInfo.js`
- Modify: `test/sqlMetricInfo.test.js`
- Modify: `AGENTS.md`
- Modify: `docs/mygig-etl-data-context.md`
- Modify: `docs/dashboards/sales-by-project.md`
- Modify: `docs/dashboards/workplace-analysis.md`
- Modify: `docs/dashboards/workplace-point.md`
- Modify: `docs/dashboards/city-analysis.md`
- Modify: `docs/dashboards/heatmap.md`
- Modify: `docs/dashboards/worker-cancellations.md`
- Modify: `README.md`

- [ ] **Step 1: Write failing SQL-info tests**

In `test/sqlMetricInfo.test.js`, add assertions for sales SQL:

```js
const salesSummary = getSqlMetricInfo('sales-by-project.summary');
assert.equal(salesSummary.sql.includes('actual_orders AS ('), true);
assert.equal(salesSummary.sql.includes("ifNull(c.title, '') NOT IN"), true);
assert.equal(salesSummary.sql.includes("!= 'processing'"), true);
assert.equal(salesSummary.sql.includes('row_number() OVER (PARTITION BY h.job'), true);
assert.equal(salesSummary.sql.includes('ifNull(t.deleted, 0) = 0'), true);
assert.equal(salesSummary.sql.includes("t.transaction_type = 'surcharge'"), false);
```

Add similar assertions for workplace/city/heatmap SQL snippets that already have metric ids.

- [ ] **Step 2: Run SQL-info tests and verify they fail**

Run:

```bash
npm test -- test/sqlMetricInfo.test.js
```

Expected: FAIL until `src/sqlMetricInfo.js` mirrors the new SQL.

- [ ] **Step 3: Update `src/sqlMetricInfo.js`**

Import helper functions where useful:

```js
const {
  actualOrderWhere,
  nullablePositiveNumberExpression,
  positiveOrZeroNumberExpression,
  transactionAmountExpression
} = require('./analyticsDomainSql');
```

Replace copied sales SQL constants with the same `actual_orders`, first-history self-booking, non-deleted signed transactions, `piecework` and nullable-rate logic used by `src/salesByProjectDashboard.js`.

For non-sales SQL snippets, update the text copies so the SQL inspector shows the same actual-order filters and join paths as the runtime dashboards.

- [ ] **Step 4: Update project instructions**

In `AGENTS.md`, replace the `mygig_*` rule with:

```md
- К `mygig_*` обращайся только если в `mg_*` нет аналога нужного поля или таблицы. Не используй `mygig_*` как проверочный источник для дашбордов, если есть рабочий `mg_*` аналог.
```

Add:

```md
- Для сменных метрик по умолчанию связывай `mg_jobs.source = mg_orders._id` и считай только смены актуальных заказов: заказ не удален, не скрыт, клиент не из тестового списка, контракт не `processing`.
- Самобронь считай по первому непустому событию `mg_job_history` в рамках смены, связанному через `order -> job -> history`; не по любому `booked` событию.
- При расчетах выручки и маржи исключай `mg_transactions.deleted = true`, а суммы транзакций учитывай со знаком.
- Для ставок используй nullable-positive выражения: нули, пустые строки и нечисловые значения не должны попадать в средние.
```

- [ ] **Step 5: Update data context docs**

In `docs/mygig-etl-data-context.md`, update:

- `mygig_*` rule: only when there is no `mg_*` analogue.
- Successful confirmed shift rule: add `piecework` absence.
- Finance rule: transactions are signed and deleted transactions are excluded.
- Actual order rule: not hidden, not deleted, not fake client, not `processing`.
- Self-booking rule: first non-empty history event for a valid `order -> job -> history` chain.

- [ ] **Step 6: Update dashboard docs**

Update each `docs/dashboards/*.md` file touched by runtime SQL so docs contain:

```md
Актуальный заказ: `ifNull(o.deleted, 0) = 0`, `ifNull(o.is_hidden, 0) = 0`, клиент не из тестового списка, `contract_type != 'processing'`.
```

For sales docs, replace self-booking description:

```md
`selfBookingPercent`: доля успешных подтвержденных смен, где первое непустое событие `mg_job_history` по смене имеет `initiator = 'worker'`.
```

For finance docs, replace surcharge-only text with:

```md
Связанные транзакции из `mg_transactions` учитываются по `entityId = job`, только при `deleted = false`, со знаком суммы.
```

- [ ] **Step 7: Run docs and SQL-info tests**

Run:

```bash
npm test -- test/sqlMetricInfo.test.js
```

Expected: PASS.

---

### Task 7: Full Verification And Cache Compatibility

**Files:**
- All modified files from previous tasks.

- [ ] **Step 1: Run the full automated test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 2: Verify no runtime data files are staged**

Run:

```bash
git status --short
```

Expected: only intentional source, test and documentation files. Nothing under `data/`.

- [ ] **Step 3: Manually inspect changed SQL for raw layer usage**

Run:

```bash
rg -n "FROM mygig_|JOIN mygig_|mygig_" src docs/dashboards docs/mygig-etl-data-context.md AGENTS.md
```

Expected: `mygig_*` appears only in documentation explaining the raw layer, not in dashboard runtime SQL.

- [ ] **Step 4: Manually inspect cross joins**

Run:

```bash
rg -n "CROSS JOIN" src docs/dashboards
```

Expected: remaining occurrences are either scalar bounds required by ClickHouse or bounded geospatial pairing with explicit coordinate filters. No `CROSS JOIN mg_workers AS worker` and no scalar summary joins.

- [ ] **Step 5: Browser smoke test**

Start the app:

```bash
npm start
```

Open:

```text
http://localhost:3000/dashboards/sales-by-project
http://localhost:3000/dashboards/workplace-analysis
http://localhost:3000/dashboards/workplace-analysis/point?workplaceId=<existing-workplace-id>
http://localhost:3000/dashboards/city-analysis
http://localhost:3000/dashboards/heatmap
http://localhost:3000/dashboards/worker-cancellations
```

Expected:

- progressive sections load;
- SQL-inspector snippets match the updated filters;
- dashboards do not show obvious count inflation from orphan shifts;
- heatmap still renders Leaflet points;
- filter controls and pagination still preserve query params;
- no browser console errors for changed screens.

---

## Self-Review

Spec coverage:

- Актуальный заказ и связка `order -> job`: Tasks 2, 3, 4.
- Связка `order -> job -> history` для самоброни и history-метрик: Tasks 2, 4.
- `processing` exclusion: Tasks 1-4 and docs in Task 6.
- Тестовые клиенты: Tasks 1-4 and docs in Task 6.
- `mg_transactions.deleted = false` and signed transactions: Task 2 and SQL info in Task 6.
- Null/string/zero rates and divide-by-zero protection: Tasks 1, 2, 5.
- `piecework` прогул: Tasks 1-3 and docs in Task 6.
- `mygig_*` prompt correction: Task 6.
- Cross join audit: Task 5 and verification Task 7.

Placeholder scan:

- No banned placeholder markers or unnamed generic handling steps.

Type and name consistency:

- Shared helper names are consistent: `actualOrderWhere`, `actualOrderConditions`, `nullablePositiveNumberExpression`, `positiveOrZeroNumberExpression`, `transactionAmountExpression`.
- Runtime and SQL inspector both use the same helper vocabulary.
- `self_bookings` becomes first-history based through `history_ranked` and `first_history`.

Plan complete and saved to `docs/superpowers/plans/2026-06-08-analytics-domain-corrections.md`.

Execution options:

1. Subagent-Driven (recommended) - implement task-by-task with review checkpoints.
2. Inline Execution - execute tasks in this session using the plan as the checklist.
