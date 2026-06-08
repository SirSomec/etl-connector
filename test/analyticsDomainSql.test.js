const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ACTUAL_ORDER_CLIENT_JOIN_SQL,
  EXCLUDED_CLIENT_TITLES_SQL,
  actualOrderCondition,
  actualOrderJoinSql,
  contractTypeNotProcessingCondition
} = require('../src/analyticsDomainSql');

test('actual order condition keeps only visible non-deleted orders', () => {
  const condition = actualOrderCondition('o');

  assert.equal(condition.includes('o.deleted = 0'), true);
  assert.equal(condition.includes('ifNull(o.is_hidden, false) = false'), true);
});

test('actual order join adds clients and contractors for domain filters', () => {
  const joinSql = actualOrderJoinSql('o');

  assert.equal(joinSql.includes('INNER JOIN mg_clients AS c ON c._id = o.client'), true);
  assert.equal(joinSql.includes('LEFT JOIN mg_workplaces AS ow ON ow._id = o.workplace'), true);
  assert.equal(joinSql.includes('LEFT JOIN mg_contractors AS ct ON ct._id = ow.contractor'), true);
  assert.equal(joinSql.includes('o.deleted = 0'), true);
  assert.equal(joinSql.includes('c.title NOT IN'), true);
  assert.equal(joinSql.includes('ifNull(ct.contract_type, ifNull(o.contract_type, \'\')) != \'processing\''), true);
});

test('excluded fake client titles are centralized and SQL quoted', () => {
  assert.equal(EXCLUDED_CLIENT_TITLES_SQL.includes("'MyGig Demo'"), true);
  assert.equal(EXCLUDED_CLIENT_TITLES_SQL.includes("'ООО «МгРу»'"), true);
  assert.equal(ACTUAL_ORDER_CLIENT_JOIN_SQL.includes(EXCLUDED_CLIENT_TITLES_SQL), true);
});

test('contract type processing filter falls back from contractor to order type', () => {
  assert.equal(
    contractTypeNotProcessingCondition('ct', 'o'),
    "ifNull(ct.contract_type, ifNull(o.contract_type, '')) != 'processing'"
  );
});
