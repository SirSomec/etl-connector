const { actualOrderDomainCondition, actualOrderJoinsSql } = require('./analyticsDomainSql');
const { successfulConfirmedShiftFlagExpression } = require('./successfulConfirmedShift');
const {
  GIGER_DETAILS_PAGE_SIZE,
  cleanBooleanFlag,
  mergeGigerDetails,
  normalizeGigerDetailsPage
} = require('./gigerDetails');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD_EXPRESSIONS = {
  day: 'toDate(ao.start)',
  week: 'toStartOfWeek(ao.start)',
  month: 'toStartOfMonth(ao.start)'
};
const REGION_ANALYSIS_SECTIONS = new Set(['summary', 'trend', 'cities', 'professions', 'attention']);
const CLOSED_STATUSES_SQL = "('booked', 'going', 'inprogress', 'checkingin', 'checkingout', 'completed', 'delayed', 'waiting')";
const REGION_GIGER_COHORTS = ['registered', 'documents', 'self-employed', 'applied', 'worked'];
const REGION_GIGER_EXPORT_LIMIT = 50000;
const cohortCache = new Map();

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatDateUTC(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function parseDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || formatDateUTC(date) !== value ? null : date;
}

function addDays(date, days) {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanValues(value) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

function normalizeOptionalDate(value) {
  return parseDate(cleanText(value));
}

function normalizeRegionAnalysisFilters(input = {}, now = new Date()) {
  const today = parseDate(formatDateUTC(now));
  const fallbackFrom = addDays(today, -89);
  let fromDate = parseDate(input.from) || fallbackFrom;
  let toDate = parseDate(input.to) || today;
  if (fromDate > toDate) {
    fromDate = fallbackFrom;
    toDate = today;
  }
  const period = Object.hasOwn(PERIOD_EXPRESSIONS, input.period) ? input.period : 'week';
  return {
    region: cleanText(input.region),
    from: formatDateUTC(fromDate),
    to: formatDateUTC(toDate),
    fromDateTime: `${formatDateUTC(fromDate)} 00:00:00`,
    toExclusiveDateTime: `${formatDateUTC(addDays(toDate, 1))} 00:00:00`,
    period,
    client: cleanValues(input.client),
    profession: cleanValues(input.profession),
    orderType: cleanValues(input.orderType).filter((value) => value === 'once' || value === 'regular'),
    activityMode: cleanText(input.activityMode) === 'range' ? 'range' : 'all',
    activityFrom: cleanText(input.activityFrom),
    activityTo: cleanText(input.activityTo),
    cohort: cleanValues(input.cohort).filter((value) => REGION_GIGER_COHORTS.includes(value))
  };
}

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pct(value, total) {
  return total > 0 ? (value / total) * 100 : 0;
}

function paramsFor(filters) {
  return {
    param_region: filters.region,
    param_from: filters.fromDateTime,
    param_to: filters.toExclusiveDateTime,
    param_clients: filters.client,
    param_professions: filters.profession,
    param_order_types: filters.orderType
  };
}

function actualOrdersCte(filters) {
  const conditions = [
    actualOrderDomainCondition('o', 'c', 'ct'),
    "ifNull(ow.address__region, '') = {region:String}",
    'o.start >= {from:DateTime}',
    'o.start < {to:DateTime}',
    "ifNull(o.workplace, '') != ''",
    'ifNull(o.amount, 0) > 0'
  ];
  if (filters.client.length) conditions.push('c.title IN {clients:Array(String)}');
  if (filters.profession.length) conditions.push("if(ifNull(p.caption, '') = '', o.spec, p.caption) IN {professions:Array(String)}");
  if (filters.orderType.length) conditions.push('o.type IN {order_types:Array(String)}');
  return `actual_orders AS (
  SELECT o._id AS order_id, o.start AS start, ifNull(o.amount, 0) AS amount,
    ifNull(ow.address__city, 'Без города') AS city,
    if(ifNull(p.caption, '') = '', ifNull(o.spec, 'Без специальности'), p.caption) AS profession,
    o.workplace AS workplace
  FROM mg_orders AS o
  ${actualOrderJoinsSql('o', { workplaceAlias: 'ow' })}
  LEFT JOIN mg_professions AS p ON p.spec = o.spec
  WHERE ${conditions.join('\n    AND ')}
)`;
}

function jobsByOrderCte() {
  return `jobs_by_order AS (
  SELECT j.source AS order_id,
    uniqExactIf(j._id, ifNull(j.status, '') IN ${CLOSED_STATUSES_SQL} OR ${successfulConfirmedShiftFlagExpression('j')} = 1) AS covered_shifts,
    uniqExactIf(j._id, ${successfulConfirmedShiftFlagExpression('j')} = 1) AS worked_shifts,
    uniqExactIf(j._id, ifNull(j.cancellation_reason, '') != '' OR ifNull(j.status, '') = 'failed') AS cancelled_shifts
  FROM mg_jobs AS j
  INNER JOIN actual_orders AS ao ON ao.order_id = j.source
  WHERE ifNull(j.deleted, 0) = 0
  GROUP BY j.source
)`;
}

function metricsSelect(groupBy = '') {
  const group = groupBy ? `GROUP BY ${groupBy}` : '';
  return `SELECT ${groupBy ? `${groupBy},` : ''}
  sum(ao.amount) AS ordered_shifts,
  sum(ifNull(jbo.covered_shifts, 0)) AS covered_shifts,
  sum(ifNull(jbo.worked_shifts, 0)) AS worked_shifts,
  greatest(sum(ao.amount) - sum(ifNull(jbo.covered_shifts, 0)), 0) AS open_demand,
  if(sum(ao.amount) > 0, sum(ifNull(jbo.worked_shifts, 0)) / sum(ao.amount) * 100, 0) AS sla_percent,
  if(sum(ao.amount) > 0, sum(ifNull(jbo.covered_shifts, 0)) / sum(ao.amount) * 100, 0) AS coverage_percent,
  sum(ifNull(jbo.cancelled_shifts, 0)) AS cancelled_shifts,
  uniqExact(ao.workplace) AS workplaces
FROM actual_orders AS ao
LEFT JOIN jobs_by_order AS jbo ON jbo.order_id = ao.order_id
${group}`;
}

function regionOptionsQuery() {
  return `SELECT ifNull(ow.address__region, '') AS region
FROM mg_orders AS o
${actualOrderJoinsSql('o', { workplaceAlias: 'ow' })}
WHERE ${actualOrderDomainCondition('o', 'c', 'ct')}
  AND ifNull(ow.address__region, '') != ''
GROUP BY region ORDER BY region FORMAT JSONEachRow`;
}

function queryForSection(filters, section) {
  const ctes = `WITH ${actualOrdersCte(filters)},\n${jobsByOrderCte()}`;
  if (section === 'summary') return `${ctes}\n${metricsSelect()} FORMAT JSONEachRow`;
  if (section === 'cities') return `${ctes}\n${metricsSelect('city')}\nORDER BY open_demand DESC, ordered_shifts DESC, city\nLIMIT 100 FORMAT JSONEachRow`;
  if (section === 'professions') return `${ctes}\n${metricsSelect('profession')}\nORDER BY open_demand DESC, ordered_shifts DESC, profession\nLIMIT 50 FORMAT JSONEachRow`;
  if (section === 'attention') return `${ctes}\n${metricsSelect('city')}\nHAVING open_demand > 0\nORDER BY open_demand DESC, sla_percent ASC\nLIMIT 15 FORMAT JSONEachRow`;
  return `${ctes}\n${metricsSelect(`period`)}\nORDER BY period FORMAT JSONEachRow`.replace(/SELECT period,/, `SELECT ${PERIOD_EXPRESSIONS[filters.period]} AS period,`);
}

function mapRow(row, dimension) {
  const orderedShifts = number(row.ordered_shifts);
  const coveredShifts = number(row.covered_shifts);
  const workedShifts = number(row.worked_shifts);
  return {
    ...(dimension ? { [dimension]: cleanText(row[dimension]) || `Без ${dimension === 'city' ? 'города' : 'специальности'}` } : {}),
    ...(row.period ? { period: String(row.period) } : {}),
    orderedShifts, coveredShifts, workedShifts,
    openDemand: number(row.open_demand),
    slaPercent: number(row.sla_percent) || pct(workedShifts, orderedShifts),
    coveragePercent: number(row.coverage_percent) || pct(coveredShifts, orderedShifts),
    cancelledShifts: number(row.cancelled_shifts), workplaces: number(row.workplaces)
  };
}

function emptyDashboard(filters, regionOptions = []) {
  return { filters, regionOptions, summary: mapRow({}), trendRows: [], cityRows: [], professionRows: [], attentionRows: [] };
}

async function loadRegionAnalysisDashboardShell(client, input = {}, now = new Date()) {
  const filters = normalizeRegionAnalysisFilters(input, now);
  const regionOptions = await client.queryJSONEachRow(regionOptionsQuery(), {}, 'region analysis region options');
  return emptyDashboard(filters, regionOptions.map((row) => cleanText(row.region)).filter(Boolean));
}

async function loadRegionAnalysisDashboardSection(client, input = {}, section, now = new Date()) {
  if (!REGION_ANALYSIS_SECTIONS.has(section)) throw new Error(`Unknown region analysis section: ${section}`);
  const filters = normalizeRegionAnalysisFilters(input, now);
  if (!filters.region) return emptyDashboard(filters);
  const rows = await client.queryJSONEachRow(queryForSection(filters, section), paramsFor(filters), `region analysis ${section}`);
  const dashboard = emptyDashboard(filters);
  if (section === 'summary') dashboard.summary = mapRow(rows[0] || {});
  else if (section === 'trend') dashboard.trendRows = rows.map((row) => mapRow(row));
  else if (section === 'cities') dashboard.cityRows = rows.map((row) => mapRow(row, 'city'));
  else if (section === 'professions') dashboard.professionRows = rows.map((row) => mapRow(row, 'profession'));
  else dashboard.attentionRows = rows.map((row) => mapRow(row, 'city'));
  return dashboard;
}

function normalizeRegionGigerDetailsInput(input = {}, now = new Date()) {
  const filters = normalizeRegionAnalysisFilters(input, now);
  const activityMode = cleanText(input.activityMode) === 'range' ? 'range' : 'all';
  const activityFromDate = normalizeOptionalDate(input.activityFrom);
  const activityToDate = normalizeOptionalDate(input.activityTo);
  const cohorts = cleanValues(input.cohort).filter((value) => REGION_GIGER_COHORTS.includes(value));

  if (!filters.region) {
    const error = new Error('region is required');
    error.status = 400;
    throw error;
  }
  if (activityMode === 'range' && (!activityFromDate || !activityToDate || activityFromDate > activityToDate)) {
    const error = new Error('Укажите корректный период последнего входа');
    error.status = 400;
    throw error;
  }

  return {
    source: 'region-analysis',
    metric: 'worked-workers',
    metricLabel: 'Выполнявшие исполнители',
    page: normalizeGigerDetailsPage(input.page),
    pageSize: GIGER_DETAILS_PAGE_SIZE,
    offset: (normalizeGigerDetailsPage(input.page) - 1) * GIGER_DETAILS_PAGE_SIZE,
    export: cleanBooleanFlag(input.export),
    activityMode,
    activityFrom: activityFromDate ? `${formatDateUTC(activityFromDate)} 00:00:00` : '',
    activityTo: activityToDate ? `${formatDateUTC(addDays(activityToDate, 1))} 00:00:00` : '',
    cohorts,
    filters
  };
}

function regionCohortCtes(input) {
  const activityWhere = input.activityMode === 'range'
    ? "AND u.lastLoginAt >= {activity_from:DateTime} AND u.lastLoginAt < {activity_to:DateTime}"
    : '';
  return `region_workers AS (
  SELECT u._id AS user_id, w._id AS worker_id,
    ifNull(w.first_passport_upload, '') != '' AND ifNull(w.first_passport_upload, '') != 'NaT' AS has_documents,
    ifNull(w.is_self_employed, 0) = 1 AS is_self_employed,
    ifNull(u.lastLoginAt, toDateTime(0)) AS last_login_at,
    coalesce(nullIf(trim(concat(ifNull(u.lastname, ''), ' ', ifNull(u.firstname, ''), ' ', ifNull(u.middlename, ''))), ''), nullIf(trim(ifNull(w.full_name, '')), ''), '') AS full_name,
    ifNull(u.phone, '') AS phone, ifNull(w.status, '') AS status
  FROM mg_users AS u
  INNER JOIN mg_workers AS w ON w.user = u._id
  WHERE ifNull(u.deleted, 0) = 0 AND ifNull(w.deleted, 0) = 0
    AND ifNull(u.role, '') = 'worker'
    AND positionCaseInsensitiveUTF8(ifNull(w.full_address__state, ''), {region:String}) > 0
    ${activityWhere}
),
worker_job_facts AS (
  SELECT j.worker AS worker_id, max(1) AS has_applied,
    max(${successfulConfirmedShiftFlagExpression('j')}) AS has_worked
  FROM mg_jobs AS j
  INNER JOIN region_workers AS rw ON rw.worker_id = j.worker
  WHERE ifNull(j.deleted, 0) = 0 AND ifNull(j.worker, '') != ''
  GROUP BY j.worker
),
cohort_gigers AS (
  SELECT
    rw.user_id, rw.worker_id, rw.full_name, rw.phone, rw.status, rw.last_login_at,
    multiIf(ifNull(f.has_worked, 0) = 1, 'worked', ifNull(f.has_applied, 0) = 1, 'applied', rw.is_self_employed, 'self-employed', rw.has_documents, 'documents', 'registered') AS cohort
  FROM region_workers AS rw
  LEFT JOIN worker_job_facts AS f ON f.worker_id = rw.worker_id
)`;
}

function regionGigerDetailsParams(input) {
  return {
    ...paramsFor(input.filters),
    param_activity_from: input.activityFrom,
    param_activity_to: input.activityTo,
    param_cohorts: input.cohorts,
    param_limit: input.pageSize,
    param_offset: input.offset
  };
}

async function loadRegionAnalysisGigerDetails(client, input = {}, now = new Date()) {
  const detailInput = normalizeRegionGigerDetailsInput(input, now);
  const ctes = regionCohortCtes(detailInput);
  const params = regionGigerDetailsParams(detailInput);
  const cohortWhere = detailInput.cohorts.length ? ' WHERE cohort IN {cohorts:Array(String)}' : '';
  const totalRows = await client.queryJSONEachRow(`WITH ${ctes}\nSELECT count() AS total_gigers FROM cohort_gigers${cohortWhere} FORMAT JSONEachRow`, params, 'region analysis giger details total');
  const total = number((totalRows[0] || {}).total_gigers);
  if (detailInput.export && total > REGION_GIGER_EXPORT_LIMIT) {
    const error = new Error(`Выгрузка содержит более ${REGION_GIGER_EXPORT_LIMIT} пользователей. Сузьте период активности или выберите когорты.`);
    error.status = 422;
    throw error;
  }
  const gigerRows = await client.queryJSONEachRow(`WITH ${ctes}\nSELECT user_id, worker_id, full_name, phone, status FROM cohort_gigers${cohortWhere} ORDER BY full_name, user_id, worker_id${detailInput.export ? '' : '\nLIMIT {limit:UInt64} OFFSET {offset:UInt64}'} FORMAT JSONEachRow`, params, 'region analysis giger details');

  return mergeGigerDetails(detailInput, totalRows, gigerRows);
}

async function loadRegionCohortFunnel(client, input = {}, now = new Date()) {
  const details = normalizeRegionGigerDetailsInput(input, now);
  const key = JSON.stringify({ region: details.filters.region, activityMode: details.activityMode, activityFrom: details.activityFrom, activityTo: details.activityTo });
  const cached = cohortCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached && cached.promise) return cached.promise;
  const promise = client.queryJSONEachRow(`WITH ${regionCohortCtes(details)}\nSELECT cohort, count() AS users FROM cohort_gigers GROUP BY cohort FORMAT JSONEachRow`, regionGigerDetailsParams(details), 'region analysis cohort funnel')
    .then((rows) => REGION_GIGER_COHORTS.map((cohort) => ({ cohort, users: number((rows.find((row) => row.cohort === cohort) || {}).users) })));
  cohortCache.set(key, { promise, expiresAt: Date.now() + 10 * 60 * 1000 });
  try { const value = await promise; cohortCache.set(key, { value, expiresAt: Date.now() + 10 * 60 * 1000 }); return value; } catch (error) { cohortCache.delete(key); throw error; }
}

module.exports = { REGION_ANALYSIS_SECTIONS, REGION_GIGER_COHORTS, loadRegionAnalysisGigerDetails, loadRegionCohortFunnel, loadRegionAnalysisDashboardSection, loadRegionAnalysisDashboardShell, normalizeRegionAnalysisFilters, normalizeRegionGigerDetailsInput, queryForSection };
