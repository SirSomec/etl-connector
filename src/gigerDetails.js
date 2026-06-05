const GIGER_DETAILS_PAGE_SIZE = 20;
const GIGER_DETAILS_DEFAULT_PAGE = 1;
const GIGER_DETAILS_MAX_PAGE = 100000;

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function firstCleanText(value) {
  const values = Array.isArray(value) ? value : [value];

  for (const rawValue of values) {
    const text = cleanText(rawValue);

    if (text !== '') {
      return text;
    }
  }

  return '';
}

function cleanBooleanFlag(value) {
  const rawValues = Array.isArray(value) ? value : [value];

  return rawValues.some((rawValue) => {
    const text = cleanText(rawValue).toLowerCase();

    return text === '1' || text === 'true' || text === 'on' || text === 'yes';
  });
}

function normalizeGigerDetailsPage(value) {
  const page = Number(value);

  return Number.isSafeInteger(page) && page >= 1 && page <= GIGER_DETAILS_MAX_PAGE
    ? page
    : GIGER_DETAILS_DEFAULT_PAGE;
}

function numberValue(value) {
  const number = Number(value || 0);

  return Number.isFinite(number) ? number : 0;
}

function textValue(value) {
  if (value === null || typeof value === 'undefined') {
    return '';
  }

  return String(value).trim();
}

function phoneValue(value) {
  return textValue(value).replace(/^(\+?\d+)\.0$/, '$1');
}

function mapGigerRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    userId: textValue(row.user_id ?? row.userId),
    workerId: textValue(row.worker_id ?? row.workerId),
    fullName: textValue(row.full_name ?? row.fullName),
    phone: phoneValue(row.phone),
    status: textValue(row.status)
  }));
}

function totalGigersFromRows(rows) {
  const row = (Array.isArray(rows) ? rows : [])[0] || {};

  return numberValue(row.total_gigers ?? row.totalGigers);
}

function buildGigerPagination(input, totalRows) {
  const totalGigers = totalGigersFromRows(totalRows);
  const totalPages = Math.max(1, Math.ceil(totalGigers / GIGER_DETAILS_PAGE_SIZE));
  const page = Number(input.page) || GIGER_DETAILS_DEFAULT_PAGE;

  return {
    page,
    pageSize: GIGER_DETAILS_PAGE_SIZE,
    totalGigers,
    totalPages,
    hasPrevious: page > 1,
    hasNext: page < totalPages
  };
}

function mergeGigerDetails(input, totalRows, gigerRows) {
  return {
    source: input.source,
    metric: input.metric,
    metricLabel: input.metricLabel,
    filters: input.filters,
    page: input.page,
    pageSize: input.pageSize,
    pagination: buildGigerPagination(input, totalRows),
    gigers: mapGigerRows(gigerRows)
  };
}

module.exports = {
  GIGER_DETAILS_PAGE_SIZE,
  cleanBooleanFlag,
  firstCleanText,
  mergeGigerDetails,
  normalizeGigerDetailsPage
};
