const test = require('node:test');
const assert = require('node:assert/strict');

const {
  numericFieldExpression,
  successfulConfirmedShiftCondition,
  successfulConfirmedShiftFlagExpression
} = require('../src/successfulConfirmedShift');

test('successful confirmed shift SQL casts numeric-like fields safely for ClickHouse', () => {
  const condition = successfulConfirmedShiftCondition('j');

  assert.equal(condition.includes("ifNull(j.status, '') = 'confirmed'"), true);
  assert.equal(condition.includes("toFloat64OrZero(ifNull(toString(j.hours), '')) > 0"), true);
  assert.equal(condition.includes("toFloat64OrZero(ifNull(toString(j.payment), '')) > 0"), true);
  assert.equal(condition.includes("toFloat64OrZero(ifNull(toString(j.salary_per_job), '')) > 0"), true);
  assert.equal(
    condition.includes(
      "toFloat64OrZero(ifNull(toString(j.salary_per_hour), '')) * toFloat64OrZero(ifNull(toString(j.hours), '')) > 0"
    ),
    true
  );
  assert.equal(condition.includes('ifNull(j.payment, 0) > 0'), false);
});

test('successful confirmed shift flag wraps the safe condition', () => {
  const flag = successfulConfirmedShiftFlagExpression('sf');

  assert.match(flag, /^if\(/);
  assert.equal(flag.includes("toFloat64OrZero(ifNull(toString(sf.payment), '')) > 0"), true);
});

test('numeric field expression supports unaliased and aliased fields', () => {
  assert.equal(numericFieldExpression('', 'payment'), "toFloat64OrZero(ifNull(toString(payment), ''))");
  assert.equal(numericFieldExpression('j', 'payment'), "toFloat64OrZero(ifNull(toString(j.payment), ''))");
});
