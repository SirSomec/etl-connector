const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_PAGE = 1;
const MAX_PAGE = 100000;
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_SORT = 'workerCancellations24h';
const DEFAULT_DIRECTION = 'desc';
const ALLOWED_PAGE_SIZES = new Set([50, 100, 200, 500]);
const ALLOWED_DIRECTIONS = new Set(['asc', 'desc']);
const WORKER_CANCELLATIONS_SECTION_NAMES = ['workers'];
const WORKER_CANCELLATIONS_SECTIONS = new Set(WORKER_CANCELLATIONS_SECTION_NAMES);
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
    if (typeof rawValue !== 'string') {
      continue;
    }

    const text = rawValue.trim();

    if (text !== '') {
      return text;
    }
  }

  return '';
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

  return {
    from,
    to,
    fromDateTime: toDateTimeParam(from),
    toExclusiveDateTime: toDateTimeParam(toExclusive),
    page,
    pageSize,
    offset: (page - 1) * pageSize,
    sort: normalizeSort(input.sort),
    direction: normalizeDirection(input.direction)
  };
}

function numberValue(value) {
  const number = Number(value || 0);

  return Number.isFinite(number) ? number : 0;
}

function textValue(value) {
  return typeof value === 'string' ? value.trim() : '';
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

    return {
      workerId,
      fullName,
      phone: textValue(row.phone),
      city: textValue(row.city),
      confirmedShifts: numberValue(row.confirmed_shifts),
      workerCancellations: numberValue(row.worker_cancellations),
      workerCancellations24h: numberValue(row.worker_cancellations_24h),
      postStartCancellations: numberValue(row.post_start_cancellations),
      failedShifts: numberValue(row.failed_shifts)
    };
  });

  return {
    filters,
    workers,
    pagination: paginationFromTotal(filters, totalRows[0] && totalRows[0].total_workers)
  };
}

function emptyWorkerCancellationsDashboard(filters) {
  return mergeWorkerCancellationRows(filters, [], []);
}

function assertWorkerCancellationsSection(section) {
  if (WORKER_CANCELLATIONS_SECTIONS.has(section)) {
    return;
  }

  const error = new Error(`Unknown worker cancellations section: ${section}`);

  error.status = 400;
  throw error;
}

async function readThroughCache(cache, key, loader) {
  if (!cache || typeof cache.getOrLoad !== 'function') {
    return loader();
  }

  return cache.getOrLoad(key, loader);
}

function cacheKeyForWorkerCancellationsSection(section, filters) {
  return JSON.stringify({
    board: 'worker-cancellations',
    section,
    filters: {
      from: filters.from,
      to: filters.to,
      page: filters.page,
      pageSize: filters.pageSize,
      sort: filters.sort,
      direction: filters.direction
    }
  });
}

function paramsForFilters(filters) {
  return {
    param_from: filters.fromDateTime,
    param_to: filters.toExclusiveDateTime,
    param_limit: filters.pageSize,
    param_offset: filters.offset
  };
}

function workerCancellationMetricsSelect() {
  return `WITH shift_facts AS (
    SELECT
      j._id AS job,
      j.worker AS worker_id,
      j.start AS start,
      ifNull(j.status, '') AS status
    FROM mg_jobs AS j
    WHERE j.start >= {from:DateTime}
      AND j.start < {to:DateTime}
      AND ifNull(j.worker, '') != ''
      AND ifNull(j.deleted, 0) = 0
  ),
  cancellation_events AS (
    SELECT
      h.job AS job,
      h.initiator = 'worker' AS is_worker_event,
      coalesce(h.createdAt, h.updatedAt) AS event_at
    FROM mg_job_history AS h
    INNER JOIN shift_facts AS sf ON h.job = sf.job
    WHERE h.status = 'cancelled'
  ),
  cancellation_flags AS (
    SELECT
      sf.job AS job,
      max(if(ce.is_worker_event, 1, 0)) AS is_worker_cancelled,
      max(if(
        ce.is_worker_event
          AND ce.event_at >= sf.start - INTERVAL 24 HOUR
          AND ce.event_at < sf.start,
        1,
        0
      )) AS is_worker_cancelled_24h,
      max(if(ce.event_at >= sf.start, 1, 0)) AS is_post_start_cancelled
    FROM shift_facts AS sf
    LEFT JOIN cancellation_events AS ce ON ce.job = sf.job
    GROUP BY sf.job
  ),
  worker_metrics AS (
    SELECT
      sf.worker_id AS worker_id,
      uniqExactIf(sf.job, status = 'confirmed') AS confirmed_shifts,
      uniqExactIf(
        sf.job,
        status = 'cancelled' AND ifNull(cf.is_worker_cancelled, 0) = 1
      ) AS worker_cancellations,
      uniqExactIf(
        sf.job,
        status = 'cancelled' AND ifNull(cf.is_worker_cancelled_24h, 0) = 1
      ) AS worker_cancellations_24h,
      uniqExactIf(
        sf.job,
        status = 'cancelled' AND ifNull(cf.is_post_start_cancelled, 0) = 1
      ) AS post_start_cancellations,
      uniqExactIf(sf.job, status = 'failed') AS failed_shifts
    FROM shift_facts AS sf
    LEFT JOIN cancellation_flags AS cf ON cf.job = sf.job
    GROUP BY sf.worker_id
  )
  SELECT
    wm.worker_id AS worker_id,
    coalesce(
      nullIf(trim(concat(ifNull(u.lastname, ''), ' ', ifNull(u.firstname, ''), ' ', ifNull(u.middlename, ''))), ''),
      nullIf(trim(ifNull(w.full_name, '')), ''),
      wm.worker_id
    ) AS full_name,
    ifNull(u.phone, '') AS phone,
    ifNull(w.full_address__city, '') AS city,
    wm.confirmed_shifts AS confirmed_shifts,
    wm.worker_cancellations AS worker_cancellations,
    wm.worker_cancellations_24h AS worker_cancellations_24h,
    wm.post_start_cancellations AS post_start_cancellations,
    wm.failed_shifts AS failed_shifts
  FROM worker_metrics AS wm
  LEFT JOIN mg_workers AS w ON wm.worker_id = w._id
  LEFT JOIN mg_users AS u ON w.user = u._id`;
}

function totalWorkersQuery() {
  return `WITH shift_facts AS (
    SELECT
      j.worker AS worker_id
    FROM mg_jobs AS j
    WHERE j.start >= {from:DateTime}
      AND j.start < {to:DateTime}
      AND ifNull(j.worker, '') != ''
      AND ifNull(j.deleted, 0) = 0
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
  return `${workerCancellationMetricsSelect()}
  ORDER BY ${orderByForFilters(filters)}
  LIMIT {limit:UInt64} OFFSET {offset:UInt64}
  FORMAT JSONEachRow`;
}

async function loadWorkerCancellationRows(client, filters) {
  const params = paramsForFilters(filters);
  const [totalRows, workerRows] = await Promise.all([
    client.queryJSONEachRow(
      totalWorkersQuery(),
      params,
      'worker cancellations total workers'
    ),
    client.queryJSONEachRow(
      workersQuery(filters),
      params,
      'worker cancellations workers'
    )
  ]);

  return { totalRows, workerRows };
}

async function loadWorkerCancellationsDashboardShell(client, input = {}, now = new Date()) {
  const filters = normalizeWorkerCancellationFilters(input, now);

  return emptyWorkerCancellationsDashboard(filters);
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
  const rows = await readThroughCache(
    options.cache,
    cacheKeyForWorkerCancellationsSection(section, filters),
    () => loadWorkerCancellationRows(client, filters)
  );

  return mergeWorkerCancellationRows(filters, rows.workerRows || [], rows.totalRows || []);
}

module.exports = {
  WORKER_CANCELLATIONS_SECTIONS,
  loadWorkerCancellationsDashboardSection,
  loadWorkerCancellationsDashboardShell,
  mergeWorkerCancellationRows,
  normalizeWorkerCancellationFilters
};
