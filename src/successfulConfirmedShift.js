function sqlField(alias, field) {
  return alias ? `${alias}.${field}` : field;
}

function positiveFactIntervalCondition(alias) {
  const startFact = sqlField(alias, 'start_fact');
  const finishFact = sqlField(alias, 'finish_fact');

  return [
    `${startFact} IS NOT NULL`,
    `${finishFact} IS NOT NULL`,
    `${finishFact} > ${startFact}`,
    `dateDiff('minute', ${startFact}, ${finishFact}) > 0`
  ].join(' AND ');
}

function numericFieldExpression(alias, field) {
  const value = sqlField(alias, field);

  return `toFloat64OrZero(ifNull(toString(${value}), ''))`;
}

function stringFieldExpression(alias, field) {
  const value = sqlField(alias, field);

  return `ifNull(toString(${value}), '')`;
}

function pieceworkNotEmptyCondition(alias) {
  const piecework = stringFieldExpression(alias, 'piecework');

  return `(${piecework} != '' AND ${piecework} != '[]' AND ${piecework} != '{}')`;
}

function positiveAccrualCondition(alias) {
  const hours = numericFieldExpression(alias, 'hours');
  const payment = numericFieldExpression(alias, 'payment');
  const salaryPerJob = numericFieldExpression(alias, 'salary_per_job');
  const salaryPerHour = numericFieldExpression(alias, 'salary_per_hour');
  const pieceworkNotEmpty = pieceworkNotEmptyCondition(alias);
  const nonPieceworkPositiveFacts = [
    `${hours} > 0`,
    `${payment} > 0`,
    `${salaryPerJob} > 0`,
    `${salaryPerHour} * ${hours} > 0`,
    `(${positiveFactIntervalCondition(alias)})`
  ].join(' OR ');

  return [
    `(${pieceworkNotEmpty} AND ${payment} > 0)`,
    `(NOT ${pieceworkNotEmpty} AND (${nonPieceworkPositiveFacts}))`
  ].join(' OR ');
}

function successfulConfirmedShiftCondition(alias) {
  return `ifNull(${sqlField(alias, 'status')}, '') = 'confirmed' AND (${positiveAccrualCondition(alias)})`;
}

function successfulConfirmedShiftFlagExpression(alias) {
  return `if(${successfulConfirmedShiftCondition(alias)}, 1, 0)`;
}

module.exports = {
  numericFieldExpression,
  pieceworkNotEmptyCondition,
  successfulConfirmedShiftCondition,
  successfulConfirmedShiftFlagExpression
};
