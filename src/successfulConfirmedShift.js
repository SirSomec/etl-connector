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

function positiveAccrualCondition(alias) {
  const hours = sqlField(alias, 'hours');
  const payment = sqlField(alias, 'payment');
  const salaryPerJob = sqlField(alias, 'salary_per_job');
  const salaryPerHour = sqlField(alias, 'salary_per_hour');

  return [
    `ifNull(${hours}, 0) > 0`,
    `ifNull(${payment}, 0) > 0`,
    `ifNull(${salaryPerJob}, 0) > 0`,
    `ifNull(${salaryPerHour}, 0) * ifNull(${hours}, 0) > 0`,
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
  successfulConfirmedShiftCondition,
  successfulConfirmedShiftFlagExpression
};
