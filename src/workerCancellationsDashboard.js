const { successfulConfirmedShiftFlagExpression } = require('./successfulConfirmedShift');
const {
  actualOrderDomainCondition,
  actualOrderJoinsSql
} = require('./analyticsDomainSql');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_PAGE = 1;
const MAX_PAGE = 100000;
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_SORT = 'workerCancellations24h';
const DEFAULT_DIRECTION = 'desc';
const DETAIL_LIMIT = 500;
const SEARCH_CANDIDATE_LIMIT = 1001;
const SEARCH_PREFILTER_MAX_WORKERS = SEARCH_CANDIDATE_LIMIT - 1;
const BOUNDED_SEARCH_WORKER_LIMIT = 50;
const ALLOWED_PAGE_SIZES = new Set([50, 100, 200, 500]);
const ALLOWED_DIRECTIONS = new Set(['asc', 'desc']);
const WORKER_CANCELLATIONS_SECTION_NAMES = ['workers'];
const WORKER_CANCELLATIONS_SECTIONS = new Set(WORKER_CANCELLATIONS_SECTION_NAMES);
const WORKER_CANCELLATION_DETAIL_METRICS = Object.freeze({
  confirmedShifts: {
    label: 'Выполнено',
    condition: 'sf.is_successful_confirmed_shift = 1'
  },
  workerCancellations: {
    label: 'Отмены worker',
    condition: "sf.status = 'cancelled' AND ifNull(cf.is_worker_cancelled, 0) = 1"
  },
  workerCancellations24h: {
    label: 'Отмены worker < 24ч',
    condition: "sf.status = 'cancelled' AND ifNull(cf.is_worker_cancelled_24h, 0) = 1"
  },
  postStartCancellations: {
    label: 'Отмены после старта',
    condition: "sf.status = 'cancelled' AND ifNull(cf.is_post_start_cancelled, 0) = 1"
  },
  failedShifts: {
    label: 'Провалы / failed',
    condition: "sf.status = 'failed'"
  }
});
const SORT_COLUMNS = {
  fullName: 'full_name',
  phone: 'phone',
  city: 'city',
  confirmedShifts: 'confirmed_shifts',
  workerCancellations: 'worker_cancellations',
  workerCancellations24h: 'worker_cancellations_24h',
  postStartCancellations: 'post_start_cancellations',
  failedShifts: 'failed_shifts'
};
const WORKER_CANCELLATION_NUMERIC_FILTERS = [
  { key: 'confirmedShifts', column: 'confirmed_shifts', param: 'confirmed_shifts' },
  { key: 'workerCancellations', column: 'worker_cancellations', param: 'worker_cancellations' },
  { key: 'workerCancellations24h', column: 'worker_cancellations_24h', param: 'worker_cancellations_24h' },
  { key: 'postStartCancellations', column: 'post_start_cancellations', param: 'post_start_cancellations' },
  { key: 'failedShifts', column: 'failed_shifts', param: 'failed_shifts' }
];
const WORKER_CANCELLATION_FILTER_OPTION_KEYS = ['client', 'city'];

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatDateUTC(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function parseDateOnly(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime()) || formatDateUTC(date) !== value) {
    return null;
  }

  return date;
}

function addDaysUTC(date, days) {
  const next = new Date(date.getTime());

  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function firstDayOfMonthUTC(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function toDateTimeParam(dateOnly) {
  return `${dateOnly} 00:00:00`;
}

function cleanText(value) {
  const values = Array.isArray(value) ? value : [value];

  for (const rawValue of values) {
    if (rawValue === null || typeof rawValue === 'undefined') {
      continue;
    }

    const text = String(rawValue).trim();

    if (text !== '') {
      return text;
    }
  }

  return '';
}

function cleanValues(value) {
  const rawValues = Array.isArray(value) ? value : [value];
  const values = [];
  const seen = new Set();

  for (const rawValue of rawValues) {
    const text = cleanText(rawValue);

    if (text === '' || seen.has(text)) {
      continue;
    }

    seen.add(text);
    values.push(text);
  }

  return values;
}

function normalizePage(value) {
  const page = Number(cleanText(value));

  return Number.isSafeInteger(page) && page >= 1 && page <= MAX_PAGE ? page : DEFAULT_PAGE;
}

function normalizePageSize(value) {
  const pageSize = Number(cleanText(value));

  return Number.isInteger(pageSize) && ALLOWED_PAGE_SIZES.has(pageSize)
    ? pageSize
    : DEFAULT_PAGE_SIZE;
}

function normalizeSort(value) {
  const sort = cleanText(value);

  return Object.prototype.hasOwnProperty.call(SORT_COLUMNS, sort) ? sort : DEFAULT_SORT;
}

function normalizeDirection(value) {
  const direction = cleanText(value).toLowerCase();

  return ALLOWED_DIRECTIONS.has(direction) ? direction : DEFAULT_DIRECTION;
}

function normalizeNonNegativeNumber(value) {
  const text = cleanText(value);

  if (text === '') {
    return undefined;
  }

  const number = Number(text.replace(',', '.'));

  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function appendWorkerCancellationOptionalFilters(filters, input) {
  const search = cleanText(input.search);
  const client = cleanValues(input.client);
  const city = cleanValues(input.city);

  if (search !== '') {
    filters.search = search;
  }

  filters.client = client;
  filters.city = city;

  for (const metric of WORKER_CANCELLATION_NUMERIC_FILTERS) {
    const fromKey = `${metric.key}From`;
    const toKey = `${metric.key}To`;
    const from = normalizeNonNegativeNumber(input[fromKey]);
    const to = normalizeNonNegativeNumber(input[toKey]);

    if (typeof from !== 'undefined') {
      filters[fromKey] = from;
    }

    if (typeof to !== 'undefined') {
      filters[toKey] = to;
    }
  }

  return filters;
}

function normalizeWorkerCancellationFilters(input = {}, now = new Date()) {
  const today = parseDateOnly(formatDateUTC(now));
  const defaultFromDate = firstDayOfMonthUTC(today);
  const requestedFrom = parseDateOnly(input.from);
  const requestedTo = parseDateOnly(input.to);
  let fromDate = requestedFrom || defaultFromDate;
  let toDate = requestedTo || today;

  if (fromDate.getTime() > toDate.getTime()) {
    fromDate = defaultFromDate;
    toDate = today;
  }

  const from = formatDateUTC(fromDate);
  const to = formatDateUTC(toDate);
  const toExclusive = formatDateUTC(addDaysUTC(toDate, 1));
  const page = normalizePage(input.page);
  const pageSize = normalizePageSize(input.pageSize);

  return appendWorkerCancellationOptionalFilters({
    from,
    to,
    fromDateTime: toDateTimeParam(from),
    toExclusiveDateTime: toDateTimeParam(toExclusive),
    page,
    pageSize,
    offset: (page - 1) * pageSize,
    sort: normalizeSort(input.sort),
    direction: normalizeDirection(input.direction)
  }, input);
}

function numberValue(value) {
  const number = Number(value || 0);

  return Number.isFinite(number) ? number : 0;
}

function textValue(value) {
  return cleanText(value);
}

function phoneValue(value) {
  const text = textValue(value);

  return text.replace(/^(\+?\d+)\.0$/, '$1');
}

function clickHouseFlag(value) {
  return value === true || value === 1 || value === '1';
}

function parseClickHouseDateTimeMs(value) {
  const text = textValue(value);

  if (text === '') {
    return Number.NaN;
  }

  const normalized = text.includes('T') ? text : text.replace(' ', 'T');
  const timestamp = Date.parse(`${normalized}Z`);

  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

function pluralizeRu(count, one, few, many) {
  const value = Math.abs(Number(count) || 0);
  const mod100 = value % 100;

  if (mod100 >= 11 && mod100 <= 14) {
    return many;
  }

  const mod10 = value % 10;

  if (mod10 === 1) {
    return one;
  }

  if (mod10 >= 2 && mod10 <= 4) {
    return few;
  }

  return many;
}

function cancellationWord(count) {
  return pluralizeRu(count, 'отмена', 'отмены', 'отмен');
}

function shiftWord(count) {
  return pluralizeRu(count, 'смена', 'смены', 'смен');
}

function workerCancellationRiskReasons(row) {
  const reasons = [];

  if (row.workerCancellations24h > 0) {
    reasons.push({
      kind: 'worker-cancellations-24h',
      label: `${row.workerCancellations24h} ${cancellationWord(row.workerCancellations24h)} менее чем за 24ч`
    });
  }

  if (row.postStartCancellations > 0) {
    reasons.push({
      kind: 'post-start-cancellations',
      label: `${row.postStartCancellations} ${cancellationWord(row.postStartCancellations)} после старта`
    });
  }

  if (row.failedShifts > 0) {
    reasons.push({
      kind: 'failed-shifts',
      label: `${row.failedShifts} failed-${shiftWord(row.failedShifts)}`
    });
  }

  return reasons;
}

function workerCancellationRiskSeverity(row) {
  if (
    row.workerCancellations24h >= 3
    || row.postStartCancellations > 0
    || row.failedShifts >= 3
  ) {
    return 'high';
  }

  if (
    row.workerCancellations24h > 0
    || row.failedShifts > 0
    || row.workerCancellations > 1
  ) {
    return 'medium';
  }

  return 'low';
}

function paginationFromTotal(filters, totalWorkers) {
  const safeTotal = numberValue(totalWorkers);
  const totalPages = Math.max(1, Math.ceil(safeTotal / filters.pageSize));

  return {
    page: filters.page,
    pageSize: filters.pageSize,
    totalWorkers: safeTotal,
    totalPages,
    hasPrevious: filters.page > 1,
    hasNext: filters.page < totalPages
  };
}

function mergeWorkerCancellationRows(filters, workerRows = [], totalRows = []) {
  const workers = workerRows.map((row) => {
    const workerId = String(row.worker_id || '');
    const fullName = textValue(row.full_name) || workerId;
    const worker = {
      workerId,
      fullName,
      phone: phoneValue(row.phone),
      city: textValue(row.city),
      confirmedShifts: numberValue(row.confirmed_shifts),
      workerCancellations: numberValue(row.worker_cancellations),
      workerCancellations24h: numberValue(row.worker_cancellations_24h),
      postStartCancellations: numberValue(row.post_start_cancellations),
      failedShifts: numberValue(row.failed_shifts)
    };

    return {
      ...worker,
      riskReasons: workerCancellationRiskReasons(worker),
      riskSeverity: workerCancellationRiskSeverity(worker)
    };
  });

  return {
    filters,
    workers,
    pagination: paginationFromTotal(filters, totalRows[0] && totalRows[0].total_workers)
  };
}

function createBadRequestError(message) {
  const error = new Error(message);

  error.status = 400;
  return error;
}

function emptyWorkerCancellationsDashboard(filters) {
  return {
    ...mergeWorkerCancellationRows(filters, [], []),
    filterOptions: emptyWorkerCancellationFilterOptions()
  };
}

function emptyWorkerCancellationFilterOptions() {
  return WORKER_CANCELLATION_FILTER_OPTION_KEYS.reduce((options, key) => {
    options[key] = [];
    return options;
  }, {});
}

function workerCancellationFilterOptionsFromRows(rows = []) {
  const options = emptyWorkerCancellationFilterOptions();
  const seenByKey = WORKER_CANCELLATION_FILTER_OPTION_KEYS.reduce((seen, key) => {
    seen[key] = new Set();
    return seen;
  }, {});

  for (const row of rows) {
    const key = String(row.filter || '');
    const value = cleanText(row.value);

    if (!Object.prototype.hasOwnProperty.call(options, key) || value === '') {
      continue;
    }

    if (seenByKey[key].has(value)) {
      continue;
    }

    seenByKey[key].add(value);
    options[key].push(value);
  }

  return options;
}

function assertWorkerCancellationsSection(section) {
  if (WORKER_CANCELLATIONS_SECTIONS.has(section)) {
    return;
  }

  throw createBadRequestError(`Unknown worker cancellations section: ${section}`);
}

function assertWorkerCancellationMetric(metric) {
  if (Object.prototype.hasOwnProperty.call(WORKER_CANCELLATION_DETAIL_METRICS, metric)) {
    return;
  }

  throw createBadRequestError(`Unknown worker cancellation metric: ${metric}`);
}

function normalizeWorkerCancellationDetailInput(input = {}, now = new Date()) {
  const filters = normalizeWorkerCancellationFilters(input, now);
  const workerId = cleanText(input.workerId);
  const metric = cleanText(input.metric);

  if (workerId === '') {
    throw createBadRequestError('Worker id is required');
  }

  assertWorkerCancellationMetric(metric);

  return {
    filters,
    workerId,
    metric,
    metricLabel: WORKER_CANCELLATION_DETAIL_METRICS[metric].label
  };
}

function mergeWorkerCancellationDetails(detailInput, detailRows = []) {
  return {
    filters: detailInput.filters,
    workerId: detailInput.workerId,
    metric: detailInput.metric,
    metricLabel: detailInput.metricLabel,
    limit: DETAIL_LIMIT,
    shifts: detailRows.map((row) => ({
      shiftId: textValue(row.shift_id),
      brand: textValue(row.brand),
      address: textValue(row.address),
      plannedStart: textValue(row.planned_start),
      bookedAt: textValue(row.booked_at),
      cancelledAt: textValue(row.cancelled_at),
      cancelledBy: textValue(row.cancelled_by)
    }))
  };
}

async function readThroughCache(cache, key, loader) {
  if (!cache || typeof cache.getOrLoad !== 'function') {
    return loader();
  }

  return cache.getOrLoad(key, loader);
}

function cacheKeyForWorkerCancellationsSection(section, filters) {
  const keyFilters = {
    from: filters.from,
    to: filters.to,
    page: filters.page,
    pageSize: filters.pageSize,
    sort: filters.sort,
    direction: filters.direction
  };

  if (filters.search) {
    keyFilters.search = filters.search;
  }

  if (filters.client.length > 0) {
    keyFilters.client = filters.client;
  }

  if (filters.city.length > 0) {
    keyFilters.city = filters.city;
  }

  for (const metric of WORKER_CANCELLATION_NUMERIC_FILTERS) {
    const fromKey = `${metric.key}From`;
    const toKey = `${metric.key}To`;

    if (typeof filters[fromKey] !== 'undefined') {
      keyFilters[fromKey] = filters[fromKey];
    }

    if (typeof filters[toKey] !== 'undefined') {
      keyFilters[toKey] = filters[toKey];
    }
  }

  return JSON.stringify({
    board: 'worker-cancellations',
    section,
    filters: keyFilters
  });
}

function cacheKeyForWorkerCancellationFilterOptions(filters) {
  return JSON.stringify({
    board: 'worker-cancellations',
    section: 'filter-options',
    filters: {
      from: filters.from,
      to: filters.to
    }
  });
}

function paramsForFilters(filters) {
  const params = {
    param_from: filters.fromDateTime,
    param_to: filters.toExclusiveDateTime,
    param_limit: filters.pageSize,
    param_offset: filters.offset
  };

  if (filters.search) {
    params.param_search = filters.search;
  }

  if (Array.isArray(filters.searchWorkerIds) && filters.searchWorkerIds.length > 0) {
    params.param_search_worker_ids = serializeStringArray(filters.searchWorkerIds);
  }

  if (filters.client.length > 0) {
    params.param_clients = serializeStringArray(filters.client);
  }

  if (filters.city.length > 0) {
    params.param_cities = serializeStringArray(filters.city);
  }

  for (const metric of WORKER_CANCELLATION_NUMERIC_FILTERS) {
    const fromKey = `${metric.key}From`;
    const toKey = `${metric.key}To`;

    if (typeof filters[fromKey] !== 'undefined') {
      params[`param_${metric.param}_from`] = filters[fromKey];
    }

    if (typeof filters[toKey] !== 'undefined') {
      params[`param_${metric.param}_to`] = filters[toKey];
    }
  }

  return params;
}

function paramsForSearchCandidates(filters) {
  return {
    param_from: filters.fromDateTime,
    param_to: filters.toExclusiveDateTime,
    param_search: filters.search,
    param_search_candidate_limit: SEARCH_CANDIDATE_LIMIT
  };
}

function paramsForDetails(detailInput) {
  const params = {
    param_from: detailInput.filters.fromDateTime,
    param_to: detailInput.filters.toExclusiveDateTime,
    param_worker_id: detailInput.workerId,
    param_limit: DETAIL_LIMIT
  };

  if (detailInput.filters.client.length > 0) {
    params.param_clients = serializeStringArray(detailInput.filters.client);
  }

  if (detailInput.filters.city.length > 0) {
    params.param_cities = serializeStringArray(detailInput.filters.city);
  }

  return params;
}

function hasWorkerCancellationMetricFilters(filters) {
  if (filters.search) {
    return true;
  }

  return WORKER_CANCELLATION_NUMERIC_FILTERS.some((metric) => {
    const fromKey = `${metric.key}From`;
    const toKey = `${metric.key}To`;

    return typeof filters[fromKey] !== 'undefined' || typeof filters[toKey] !== 'undefined';
  });
}

function workerFullNameExpression({
  workerAlias = 'w',
  userAlias = 'u',
  fallbackExpression = 'wm.worker_id'
} = {}) {
  return `coalesce(
      nullIf(trim(concat(ifNull(${userAlias}.lastname, ''), ' ', ifNull(${userAlias}.firstname, ''), ' ', ifNull(${userAlias}.middlename, ''))), ''),
      nullIf(trim(ifNull(${workerAlias}.full_name, '')), ''),
      ${fallbackExpression}
    )`;
}

function workerShiftActualOrderJoinsSql({ clientAlias = 'c', workplaceAlias = 'ow', contractorAlias = 'ct' } = {}) {
  return `INNER JOIN mg_orders AS o ON o._id = j.source
    ${actualOrderJoinsSql('o', { clientAlias, workplaceAlias, contractorAlias })}`;
}

function serializeStringArray(values) {
  return `[${values.map((value) => `'${String(value).replaceAll("'", "\\'")}'`).join(',')}]`;
}

function workerCancellationClientCondition(filters, clientAlias = 'c') {
  return filters.client.length > 0 ? `\n      AND ${clientAlias}.title IN {clients:Array(String)}` : '';
}

function workerCancellationCityCondition(filters, workplaceAlias = 'ow') {
  return filters.city.length > 0 ? `\n      AND ${workplaceAlias}.address__city IN {cities:Array(String)}` : '';
}

function hasWorkerCancellationSearchWorkerIds(filters) {
  return Array.isArray(filters.searchWorkerIds) && filters.searchWorkerIds.length > 0;
}

function workerCancellationJobsSourceSql(filters = {}) {
  if (!hasWorkerCancellationSearchWorkerIds(filters)) {
    return 'mg_jobs AS j';
  }

  return `(
      SELECT
        _id,
        worker,
        start,
        status,
        source,
        hours,
        payment,
        salary_per_job,
        salary_per_hour,
        start_fact,
        finish_fact
      FROM mg_jobs
      PREWHERE worker IN {search_worker_ids:Array(String)}
      WHERE start >= {from:DateTime}
        AND start < {to:DateTime}
        AND ifNull(worker, '') != ''
        AND ifNull(deleted, 0) = 0
    ) AS j`;
}

function workerCancellationShiftFactConditions(filters = {}) {
  const conditions = [];

  if (!hasWorkerCancellationSearchWorkerIds(filters)) {
    conditions.push(
      'j.start >= {from:DateTime}',
      'j.start < {to:DateTime}',
      "ifNull(j.worker, '') != ''",
      'ifNull(j.deleted, 0) = 0'
    );
  }

  conditions.push(actualOrderDomainCondition('o', 'c', 'ct'));

  if (filters.client.length > 0) {
    conditions.push('c.title IN {clients:Array(String)}');
  }

  if (filters.city.length > 0) {
    conditions.push('ow.address__city IN {cities:Array(String)}');
  }

  return conditions.join('\n      AND ');
}

function workerCancellationMetricsCtes(filters = {}) {
  return `WITH shift_facts AS (
    SELECT
      j._id AS job,
      j.worker AS worker_id,
      j.start AS start,
      ifNull(j.status, '') AS status,
      ${successfulConfirmedShiftFlagExpression('j', { pieceworkExpression: 'o.pieceworks' })} AS is_successful_confirmed_shift
    FROM ${workerCancellationJobsSourceSql(filters)}
    ${workerShiftActualOrderJoinsSql()}
    WHERE ${workerCancellationShiftFactConditions(filters)}
  ),
  cancelled_shift_facts AS (
    SELECT
      job,
      worker_id,
      start
    FROM shift_facts
    WHERE status = 'cancelled'
  ),
  cancellation_events AS (
    SELECT
      h.job AS job,
      csf.worker_id AS worker_id,
      h.initiator = 'worker' AS is_worker_event,
      coalesce(h.createdAt, h.updatedAt) AS event_at,
      csf.start AS start
    FROM mg_job_history AS h
    INNER JOIN cancelled_shift_facts AS csf ON h.job = csf.job
    WHERE h.status = 'cancelled'
  ),
  base_worker_metrics AS (
    SELECT
      sf.worker_id AS worker_id,
      uniqExactIf(sf.job, is_successful_confirmed_shift = 1) AS confirmed_shifts,
      uniqExactIf(sf.job, status = 'failed') AS failed_shifts
    FROM shift_facts AS sf
    GROUP BY sf.worker_id
  ),
  cancellation_worker_metrics AS (
    SELECT
      ce.worker_id AS worker_id,
      uniqExactIf(ce.job, ce.is_worker_event) AS worker_cancellations,
      uniqExactIf(
        ce.job,
        ce.is_worker_event
          AND ce.event_at >= ce.start - INTERVAL 24 HOUR
          AND ce.event_at < ce.start
      ) AS worker_cancellations_24h,
      uniqExactIf(ce.job, ce.event_at >= ce.start) AS post_start_cancellations
    FROM cancellation_events AS ce
    GROUP BY ce.worker_id
  ),
  worker_metrics AS (
    SELECT
      bwm.worker_id AS worker_id,
      bwm.confirmed_shifts AS confirmed_shifts,
      ifNull(cwm.worker_cancellations, 0) AS worker_cancellations,
      ifNull(cwm.worker_cancellations_24h, 0) AS worker_cancellations_24h,
      ifNull(cwm.post_start_cancellations, 0) AS post_start_cancellations,
      bwm.failed_shifts AS failed_shifts
    FROM base_worker_metrics AS bwm
    LEFT JOIN cancellation_worker_metrics AS cwm ON cwm.worker_id = bwm.worker_id
  )`;
}

function workerMetricsJoinsSql() {
  return `FROM worker_metrics AS wm
  LEFT JOIN mg_workers AS w ON wm.worker_id = w._id
  LEFT JOIN mg_users AS u ON w.user = u._id`;
}

function workerMetricsWhereSql(filters) {
  const conditions = [];

  if (filters.search) {
    conditions.push(`(
      positionCaseInsensitive(wm.worker_id, {search:String}) > 0
      OR positionCaseInsensitive(ifNull(w.user, ''), {search:String}) > 0
      OR positionCaseInsensitive(ifNull(u.phone, ''), {search:String}) > 0
      OR positionCaseInsensitive(${workerFullNameExpression()}, {search:String}) > 0
      OR positionCaseInsensitive(ifNull(w.full_address__city, ''), {search:String}) > 0
    )`);
  }

  for (const metric of WORKER_CANCELLATION_NUMERIC_FILTERS) {
    const fromKey = `${metric.key}From`;
    const toKey = `${metric.key}To`;

    if (typeof filters[fromKey] !== 'undefined') {
      conditions.push(`wm.${metric.column} >= {${metric.param}_from:Float64}`);
    }

    if (typeof filters[toKey] !== 'undefined') {
      conditions.push(`wm.${metric.column} <= {${metric.param}_to:Float64}`);
    }
  }

  return conditions.length === 0 ? '' : `\n  WHERE ${conditions.join('\n    AND ')}`;
}

function workerCancellationMetricsSelect(filters = {}) {
  return `${workerCancellationMetricsCtes(filters)}
  SELECT
    wm.worker_id AS worker_id,
    ifNull(w.user, '') AS user_id,
    ${workerFullNameExpression()} AS full_name,
    ifNull(u.phone, '') AS phone,
    ifNull(w.full_address__city, '') AS city,
    wm.confirmed_shifts AS confirmed_shifts,
    wm.worker_cancellations AS worker_cancellations,
    wm.worker_cancellations_24h AS worker_cancellations_24h,
    wm.post_start_cancellations AS post_start_cancellations,
    wm.failed_shifts AS failed_shifts
  ${workerMetricsJoinsSql()}${workerMetricsWhereSql(filters)}`;
}

function totalWorkersQuery(filters = {}) {
  if (hasWorkerCancellationMetricFilters(filters)) {
    return `${workerCancellationMetricsCtes(filters)}
  SELECT count() AS total_workers
  ${workerMetricsJoinsSql()}${workerMetricsWhereSql(filters)}
  FORMAT JSONEachRow`;
  }

  return `WITH shift_facts AS (
    SELECT
      j.worker AS worker_id
    FROM ${workerCancellationJobsSourceSql(filters)}
    ${workerShiftActualOrderJoinsSql()}
    WHERE ${workerCancellationShiftFactConditions(filters)}
    GROUP BY worker_id
  )
  SELECT
    count() AS total_workers
  FROM shift_facts
  FORMAT JSONEachRow`;
}

function orderByForFilters(filters) {
  const column = SORT_COLUMNS[filters.sort] || SORT_COLUMNS[DEFAULT_SORT];
  const direction = filters.direction === 'asc' ? 'ASC' : 'DESC';

  return `${column} ${direction}, worker_id ASC`;
}

function workersQuery(filters) {
  return `${workerCancellationMetricsSelect(filters)}
  ORDER BY ${orderByForFilters(filters)}
  LIMIT {limit:UInt64} OFFSET {offset:UInt64}
  FORMAT JSONEachRow`;
}

function workerCancellationDetailsQuery(metric, filters = {}) {
  const metricCondition = WORKER_CANCELLATION_DETAIL_METRICS[metric].condition;

  return `WITH shift_facts AS (
    SELECT
      j._id AS job,
      j.worker AS worker_id,
      j.start AS start,
      ifNull(j.status, '') AS status,
      ${successfulConfirmedShiftFlagExpression('j', { pieceworkExpression: 'o.pieceworks' })} AS is_successful_confirmed_shift,
      ifNull(o.client, '') AS client_id,
      ifNull(o.workplace, '') AS workplace_id
    FROM mg_jobs AS j
    ${workerShiftActualOrderJoinsSql({
      clientAlias: 'actual_client',
      workplaceAlias: 'actual_workplace',
      contractorAlias: 'actual_contractor'
    })}
    WHERE j.start >= {from:DateTime}
      AND j.start < {to:DateTime}
      AND j.worker = {worker_id:String}
      AND ifNull(j.deleted, 0) = 0
      AND ${actualOrderDomainCondition('o', 'actual_client', 'actual_contractor')}${workerCancellationClientCondition(filters, 'actual_client')}${workerCancellationCityCondition(filters, 'actual_workplace')}
  ),
  cancelled_shift_facts AS (
    SELECT
      job,
      start
    FROM shift_facts
    WHERE status = 'cancelled'
  ),
  cancellation_events AS (
    SELECT
      h.job AS job,
      h.initiator = 'worker' AS is_worker_event,
      coalesce(h.createdAt, h.updatedAt) AS event_at,
      csf.start AS start
    FROM mg_job_history AS h
    INNER JOIN cancelled_shift_facts AS csf ON h.job = csf.job
    WHERE h.status = 'cancelled'
  ),
  cancellation_flags AS (
    SELECT
      ce.job AS job,
      max(if(ce.is_worker_event, 1, 0)) AS is_worker_cancelled,
      max(if(
        ce.is_worker_event
          AND ce.event_at >= ce.start - INTERVAL 24 HOUR
          AND ce.event_at < ce.start,
        1,
        0
      )) AS is_worker_cancelled_24h,
      max(if(ce.event_at >= ce.start, 1, 0)) AS is_post_start_cancelled
    FROM cancellation_events AS ce
    GROUP BY ce.job
  ),
  booking_events AS (
    SELECT
      h.job AS job,
      min(coalesce(h.createdAt, h.updatedAt)) AS booked_at
    FROM mg_job_history AS h
    INNER JOIN shift_facts AS sf ON h.job = sf.job
    WHERE h.status = 'booked'
    GROUP BY h.job
  ),
  cancel_events AS (
    SELECT
      h.job AS job,
      max(coalesce(h.createdAt, h.updatedAt)) AS cancelled_at,
      argMax(ifNull(h.initiator, ''), coalesce(h.createdAt, h.updatedAt)) AS cancelled_by
    FROM mg_job_history AS h
    INNER JOIN shift_facts AS sf ON h.job = sf.job
    WHERE h.status = 'cancelled'
    GROUP BY h.job
  )
  SELECT
    sf.job AS shift_id,
    coalesce(nullIf(trim(ifNull(c.title, '')), ''), nullIf(sf.client_id, ''), '') AS brand,
    coalesce(
      nullIf(arrayStringConcat(arrayFilter(x -> x != '', [
        ifNull(wp.address__city, ''),
        ifNull(wp.address__street, ''),
        ifNull(wp.address__house, '')
      ]), ', '), ''),
      nullIf(trim(ifNull(wp.title, '')), ''),
      nullIf(sf.workplace_id, ''),
      ''
    ) AS address,
    sf.start AS planned_start,
    be.booked_at AS booked_at,
    ce.cancelled_at AS cancelled_at,
    ce.cancelled_by AS cancelled_by
  FROM shift_facts AS sf
  LEFT JOIN cancellation_flags AS cf ON cf.job = sf.job
  LEFT JOIN booking_events AS be ON be.job = sf.job
  LEFT JOIN cancel_events AS ce ON ce.job = sf.job
  LEFT JOIN mg_clients AS c ON sf.client_id = c._id
  LEFT JOIN mg_workplaces AS wp ON sf.workplace_id = wp._id
  WHERE ${metricCondition}
  ORDER BY sf.start DESC, sf.job ASC
  LIMIT {limit:UInt64}
  FORMAT JSONEachRow`;
}

function workerCancellationSearchCandidatesQuery() {
  return `WITH raw_candidates AS (
    SELECT
      ifNull(w._id, '') AS worker_id,
      ${workerFullNameExpression({ fallbackExpression: "ifNull(w._id, '')" })} AS full_name,
      ifNull(u.phone, '') AS phone,
      ifNull(w.full_address__city, '') AS city
    FROM mg_workers AS w
    LEFT JOIN mg_users AS u ON w.user = u._id
    WHERE ifNull(w._id, '') != ''
      AND (
        positionCaseInsensitive(ifNull(w._id, ''), {search:String}) > 0
        OR positionCaseInsensitive(ifNull(w.user, ''), {search:String}) > 0
        OR positionCaseInsensitive(ifNull(u.phone, ''), {search:String}) > 0
        OR positionCaseInsensitive(${workerFullNameExpression({ fallbackExpression: "ifNull(w._id, '')" })}, {search:String}) > 0
        OR positionCaseInsensitive(ifNull(w.full_address__city, ''), {search:String}) > 0
      )
    UNION ALL
    SELECT
      j.worker AS worker_id,
      '' AS full_name,
      '' AS phone,
      '' AS city
    FROM mg_jobs AS j
    WHERE j.start >= {from:DateTime}
      AND j.start < {to:DateTime}
      AND ifNull(j.worker, '') != ''
      AND ifNull(j.deleted, 0) = 0
      AND positionCaseInsensitive(j.worker, {search:String}) > 0
    GROUP BY worker_id
  )
  SELECT
    worker_id,
    anyIf(full_name, full_name != '') AS full_name,
    anyIf(phone, phone != '') AS phone,
    anyIf(city, city != '') AS city
  FROM raw_candidates
  WHERE worker_id != ''
  GROUP BY worker_id
  ORDER BY worker_id
  LIMIT {search_candidate_limit:UInt64}
  FORMAT JSONEachRow`;
}

function boundedWorkerCancellationShiftFactsQuery(filters = {}) {
  return `SELECT
    j._id AS job,
    j.worker AS worker_id,
    j.start AS start,
    ifNull(j.status, '') AS status,
    ${successfulConfirmedShiftFlagExpression('j', { pieceworkExpression: 'o.pieceworks' })} AS is_successful_confirmed_shift
  FROM ${workerCancellationJobsSourceSql(filters)}
  ${workerShiftActualOrderJoinsSql()}
  WHERE ${workerCancellationShiftFactConditions(filters)}
  FORMAT JSONEachRow`;
}

function boundedWorkerCancellationEventsQuery() {
  return `SELECT
    h.job AS job,
    h.initiator = 'worker' AS is_worker_event,
    coalesce(h.createdAt, h.updatedAt) AS event_at
  FROM mg_job_history AS h
  PREWHERE job IN {jobs:Array(String)}
  WHERE h.status = 'cancelled'
  FORMAT JSONEachRow`;
}

function workerCancellationFilterOptionsQuery() {
  return `SELECT
    filter,
    value
  FROM (
    SELECT
      ifNull(c.title, '') AS client,
      ifNull(ow.address__city, '') AS city
    FROM mg_jobs AS j
    ${workerShiftActualOrderJoinsSql()}
    WHERE j.start >= {from:DateTime}
      AND j.start < {to:DateTime}
      AND ifNull(j.worker, '') != ''
      AND ifNull(j.deleted, 0) = 0
      AND ${actualOrderDomainCondition('o', 'c', 'ct')}
  )
  ARRAY JOIN ['client', 'city'] AS filter, [client, city] AS value
  WHERE value != ''
  GROUP BY filter, value
  ORDER BY filter, value
  FORMAT JSONEachRow`;
}

function mergeWorkerCancellationSearchCandidateRows(rows = []) {
  const candidates = [];
  const seen = new Set();

  for (const row of rows) {
    const workerId = textValue(row.worker_id);

    if (workerId === '' || seen.has(workerId)) {
      continue;
    }

    seen.add(workerId);
    candidates.push({
      workerId,
      fullName: textValue(row.full_name),
      phone: phoneValue(row.phone),
      city: textValue(row.city)
    });
  }

  return candidates;
}

async function resolveWorkerCancellationSearchCandidates(client, filters) {
  if (!filters.search) {
    return null;
  }

  const rows = await client.queryJSONEachRow(
    workerCancellationSearchCandidatesQuery(),
    paramsForSearchCandidates(filters),
    'worker cancellations search candidates'
  );
  const candidates = mergeWorkerCancellationSearchCandidateRows(rows);

  if (candidates.length > SEARCH_PREFILTER_MAX_WORKERS) {
    return null;
  }

  return candidates;
}

function createBoundedMetricAccumulator(workerId) {
  return {
    workerId,
    confirmedShifts: new Set(),
    workerCancellations: new Set(),
    workerCancellations24h: new Set(),
    postStartCancellations: new Set(),
    failedShifts: new Set()
  };
}

function metricAccumulatorRows(accumulators, candidatesByWorkerId) {
  return Array.from(accumulators.values()).map((metrics) => {
    const candidate = candidatesByWorkerId.get(metrics.workerId) || {};

    return {
      worker_id: metrics.workerId,
      full_name: candidate.fullName || metrics.workerId,
      phone: candidate.phone || '',
      city: candidate.city || '',
      confirmed_shifts: metrics.confirmedShifts.size,
      worker_cancellations: metrics.workerCancellations.size,
      worker_cancellations_24h: metrics.workerCancellations24h.size,
      post_start_cancellations: metrics.postStartCancellations.size,
      failed_shifts: metrics.failedShifts.size
    };
  });
}

function boundedRowPassesMetricFilters(row, filters) {
  for (const metric of WORKER_CANCELLATION_NUMERIC_FILTERS) {
    const value = numberValue(row[metric.column]);
    const from = filters[`${metric.key}From`];
    const to = filters[`${metric.key}To`];

    if (typeof from !== 'undefined' && value < from) {
      return false;
    }

    if (typeof to !== 'undefined' && value > to) {
      return false;
    }
  }

  return true;
}

function compareBoundedWorkerRows(filters) {
  const column = SORT_COLUMNS[filters.sort] || SORT_COLUMNS[DEFAULT_SORT];
  const directionFactor = filters.direction === 'asc' ? 1 : -1;

  return (left, right) => {
    const leftValue = left[column];
    const rightValue = right[column];
    const leftNumber = numberValue(leftValue);
    const rightNumber = numberValue(rightValue);
    const numeric = Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
      && !['full_name', 'phone', 'city'].includes(column);
    let comparison;

    if (numeric) {
      comparison = leftNumber === rightNumber ? 0 : (leftNumber < rightNumber ? -1 : 1);
    } else {
      comparison = textValue(leftValue).localeCompare(textValue(rightValue), 'ru');
    }

    if (comparison !== 0) {
      return comparison * directionFactor;
    }

    return textValue(left.worker_id).localeCompare(textValue(right.worker_id), 'ru');
  };
}

function mergeBoundedWorkerCancellationRows(filters, candidates, shiftRows = [], eventRows = []) {
  const candidatesByWorkerId = new Map(candidates.map((candidate) => [candidate.workerId, candidate]));
  const accumulators = new Map();
  const shiftsByJob = new Map();

  for (const row of shiftRows) {
    const job = textValue(row.job);
    const workerId = textValue(row.worker_id);

    if (job === '' || workerId === '') {
      continue;
    }

    if (!accumulators.has(workerId)) {
      accumulators.set(workerId, createBoundedMetricAccumulator(workerId));
    }

    const metrics = accumulators.get(workerId);
    const status = textValue(row.status);
    const startMs = parseClickHouseDateTimeMs(row.start);

    shiftsByJob.set(job, {
      workerId,
      startMs
    });

    if (clickHouseFlag(row.is_successful_confirmed_shift)) {
      metrics.confirmedShifts.add(job);
    }

    if (status === 'failed') {
      metrics.failedShifts.add(job);
    }
  }

  for (const row of eventRows) {
    const job = textValue(row.job);
    const shift = shiftsByJob.get(job);

    if (!shift) {
      continue;
    }

    const metrics = accumulators.get(shift.workerId);
    const eventAtMs = parseClickHouseDateTimeMs(row.event_at);

    if (!metrics || !Number.isFinite(eventAtMs) || !Number.isFinite(shift.startMs)) {
      continue;
    }

    if (clickHouseFlag(row.is_worker_event)) {
      metrics.workerCancellations.add(job);

      if (eventAtMs >= shift.startMs - 24 * 60 * 60 * 1000 && eventAtMs < shift.startMs) {
        metrics.workerCancellations24h.add(job);
      }
    }

    if (eventAtMs >= shift.startMs) {
      metrics.postStartCancellations.add(job);
    }
  }

  const filteredRows = metricAccumulatorRows(accumulators, candidatesByWorkerId)
    .filter((row) => boundedRowPassesMetricFilters(row, filters))
    .sort(compareBoundedWorkerRows(filters));

  return {
    totalRows: [{ total_workers: filteredRows.length }],
    workerRows: filteredRows.slice(filters.offset, filters.offset + filters.pageSize)
  };
}

async function loadBoundedWorkerCancellationRows(client, filters, candidates) {
  const searchWorkerIds = candidates.map((candidate) => candidate.workerId);
  const queryFilters = {
    ...filters,
    searchWorkerIds
  };
  const shiftRows = await client.queryJSONEachRow(
    boundedWorkerCancellationShiftFactsQuery(queryFilters),
    paramsForFilters(queryFilters),
    'worker cancellations bounded shift facts'
  );
  const cancelledJobIds = Array.from(new Set(
    shiftRows
      .filter((row) => textValue(row.status) === 'cancelled')
      .map((row) => textValue(row.job))
      .filter((job) => job !== '')
  ));
  const eventRows = cancelledJobIds.length === 0
    ? []
    : await client.queryJSONEachRow(
        boundedWorkerCancellationEventsQuery(),
        { param_jobs: serializeStringArray(cancelledJobIds) },
        'worker cancellations bounded cancellation events'
      );

  return mergeBoundedWorkerCancellationRows(filters, candidates, shiftRows, eventRows);
}

async function loadWorkerCancellationRows(client, filters) {
  const searchCandidates = await resolveWorkerCancellationSearchCandidates(client, filters);

  if (Array.isArray(searchCandidates) && searchCandidates.length === 0) {
    return {
      totalRows: [{ total_workers: 0 }],
      workerRows: []
    };
  }

  if (Array.isArray(searchCandidates) && searchCandidates.length <= BOUNDED_SEARCH_WORKER_LIMIT) {
    return loadBoundedWorkerCancellationRows(client, filters, searchCandidates);
  }

  const searchWorkerIds = Array.isArray(searchCandidates)
    ? searchCandidates.map((candidate) => candidate.workerId)
    : null;
  const queryFilters = Array.isArray(searchWorkerIds)
    ? {
        ...filters,
        searchWorkerIds
      }
    : filters;
  const params = paramsForFilters(queryFilters);
  const [totalRows, workerRows] = await Promise.all([
    client.queryJSONEachRow(
      totalWorkersQuery(queryFilters),
      params,
      'worker cancellations total workers'
    ),
    client.queryJSONEachRow(
      workersQuery(queryFilters),
      params,
      'worker cancellations workers'
    )
  ]);

  return { totalRows, workerRows };
}

async function loadWorkerCancellationFilterOptionRows(client, filters) {
  return client.queryJSONEachRow(
    workerCancellationFilterOptionsQuery(),
    {
      param_from: filters.fromDateTime,
      param_to: filters.toExclusiveDateTime
    },
    'worker cancellations filter options'
  );
}

function readWorkerCancellationPreload(preloadService, method, input) {
  if (!preloadService || typeof preloadService[method] !== 'function') {
    return null;
  }

  try {
    return preloadService[method](input);
  } catch (_) {
    return null;
  }
}

async function loadWorkerCancellationsDetails(client, input = {}, now = new Date(), options = {}) {
  const detailInput = normalizeWorkerCancellationDetailInput(input, now);
  const preloadedRows = readWorkerCancellationPreload(
    options.preloadService,
    'readWorkerCancellationDetails',
    {
      filters: detailInput.filters,
      workerId: detailInput.workerId,
      metric: detailInput.metric
    }
  );

  if (preloadedRows) {
    return mergeWorkerCancellationDetails(detailInput, preloadedRows);
  }

  const detailRows = await client.queryJSONEachRow(
    workerCancellationDetailsQuery(detailInput.metric, detailInput.filters),
    paramsForDetails(detailInput),
    'worker cancellations detail shifts'
  );

  return mergeWorkerCancellationDetails(detailInput, detailRows);
}

async function loadWorkerCancellationsDashboardShell(client, input = {}, now = new Date(), options = {}) {
  const filters = normalizeWorkerCancellationFilters(input, now);
  const preloadedRows = readWorkerCancellationPreload(
    options.preloadService,
    'readWorkerCancellationFilterOptions',
    { filters }
  );
  const filterOptionRows = await readThroughCache(
    options.cache,
    cacheKeyForWorkerCancellationFilterOptions(filters),
    () => preloadedRows || loadWorkerCancellationFilterOptionRows(client, filters)
  );

  return {
    ...emptyWorkerCancellationsDashboard(filters),
    filterOptions: workerCancellationFilterOptionsFromRows(filterOptionRows)
  };
}

async function loadWorkerCancellationsDashboardSection(
  client,
  input = {},
  section,
  now = new Date(),
  options = {}
) {
  assertWorkerCancellationsSection(section);

  const filters = normalizeWorkerCancellationFilters(input, now);
  const preloadedRows = readWorkerCancellationPreload(
    options.preloadService,
    'readWorkerCancellationSection',
    { section, filters }
  );

  if (preloadedRows) {
    return mergeWorkerCancellationRows(filters, preloadedRows.workerRows || [], preloadedRows.totalRows || []);
  }

  const rows = await readThroughCache(
    options.cache,
    cacheKeyForWorkerCancellationsSection(section, filters),
    () => loadWorkerCancellationRows(client, filters)
  );

  return mergeWorkerCancellationRows(filters, rows.workerRows || [], rows.totalRows || []);
}

module.exports = {
  WORKER_CANCELLATION_DETAIL_METRICS,
  WORKER_CANCELLATIONS_SECTIONS,
  loadWorkerCancellationsDashboardSection,
  loadWorkerCancellationsDetails,
  loadWorkerCancellationsDashboardShell,
  mergeWorkerCancellationDetails,
  mergeWorkerCancellationRows,
  normalizeWorkerCancellationDetailInput,
  normalizeWorkerCancellationFilters
};
