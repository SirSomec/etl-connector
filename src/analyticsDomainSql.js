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
  return `'${String(value).replaceAll("'", "''")}'`;
}

const EXCLUDED_CLIENT_TITLES_SQL = `(${EXCLUDED_CLIENT_TITLES.map(sqlStringLiteral).join(', ')})`;

function actualOrderCondition(orderAlias = 'o') {
  return [
    `${orderAlias}.deleted = 0`,
    `ifNull(${orderAlias}.is_hidden, false) = false`
  ].join(' AND ');
}

function clientNotFakeCondition(clientAlias = 'c') {
  return `(${clientAlias}.title IS NULL OR ${clientAlias}.title NOT IN ${EXCLUDED_CLIENT_TITLES_SQL})`;
}

function contractTypeNotProcessingCondition(contractorAlias = 'ct', orderAlias = 'o') {
  return `ifNull(${contractorAlias}.contract_type, ifNull(${orderAlias}.contract_type, '')) != 'processing'`;
}

function actualOrderDomainCondition(orderAlias = 'o', clientAlias = 'c', contractorAlias = 'ct') {
  return [
    actualOrderCondition(orderAlias),
    clientNotFakeCondition(clientAlias),
    contractTypeNotProcessingCondition(contractorAlias, orderAlias)
  ].join(' AND ');
}

function actualOrderJoinsSql(
  orderAlias = 'o',
  { clientAlias = 'c', workplaceAlias = 'ow', contractorAlias = 'ct' } = {}
) {
  return [
    `INNER JOIN mg_clients AS ${clientAlias} ON ${clientAlias}._id = ${orderAlias}.client`,
    `LEFT JOIN mg_workplaces AS ${workplaceAlias} ON ${workplaceAlias}._id = ${orderAlias}.workplace`,
    `LEFT JOIN mg_contractors AS ${contractorAlias} ON ${contractorAlias}._id = ${workplaceAlias}.contractor`
  ].join('\n');
}

function actualOrderJoinSql(
  orderAlias = 'o',
  { clientAlias = 'c', workplaceAlias = 'ow', contractorAlias = 'ct' } = {}
) {
  return [
    actualOrderJoinsSql(orderAlias, { clientAlias, workplaceAlias, contractorAlias }),
    `WHERE ${actualOrderDomainCondition(orderAlias, clientAlias, contractorAlias)}`
  ].join('\n');
}

const ACTUAL_ORDER_CLIENT_JOIN_SQL = actualOrderJoinSql('o');

module.exports = {
  ACTUAL_ORDER_CLIENT_JOIN_SQL,
  EXCLUDED_CLIENT_TITLES,
  EXCLUDED_CLIENT_TITLES_SQL,
  actualOrderCondition,
  actualOrderDomainCondition,
  actualOrderJoinSql,
  actualOrderJoinsSql,
  clientNotFakeCondition,
  contractTypeNotProcessingCondition
};
