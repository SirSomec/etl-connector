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

function positiveAccrualCondition(alias) {
  const hours = numericFieldExpression(alias, 'hours');
  const payment = numericFieldExpression(alias, 'payment');
  const salaryPerJob = numericFieldExpression(alias, 'salary_per_job');
  const salaryPerHour = numericFieldExpression(alias, 'salary_per_hour');

  return [
    `${hours} > 0`,
    `${payment} > 0`,
    `${salaryPerJob} > 0`,
    `${salaryPerHour} * ${hours} > 0`,
    `(${positiveFactIntervalCondition(alias)})`
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
  successfulConfirmedShiftCondition,
  successfulConfirmedShiftFlagExpression
};
