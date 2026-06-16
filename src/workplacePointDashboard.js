const {
  numericFieldExpression,
  successfulConfirmedShiftFlagExpression
} = require('./successfulConfirmedShift');
const {
  actualOrderDomainCondition,
  actualOrderJoinsSql
} = require('./analyticsDomainSql');
const {
  GIGER_DETAILS_PAGE_SIZE,
  cleanBooleanFlag: cleanGigerDetailsBooleanFlag,
  firstCleanText: firstGigerDetailsText,
  mergeGigerDetails,
  normalizeGigerDetailsPage
} = require('./gigerDetails');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_ORDER_TYPES = new Set(['once', 'regular']);
const FILTER_OPTION_KEYS = ['profession', 'orderType', 'jobStatus'];
const RADIUS_KM = [5, 10, 15, 20];
const WORKPLACE_POINT_SECTION_NAMES = ['summary', 'charts', 'radius'];
const WORKPLACE_POINT_SECTIONS = new Set(WORKPLACE_POINT_SECTION_NAMES);
const DAY_DETAIL_COMPLETED_JOB_STATUSES = new Set(['confirmed', 'completed']);
const DAY_DETAIL_FACTUAL_JOB_STATUSES_SQL = "('confirmed', 'completed')";
const DAY_DETAIL_FACTUAL_TIME_FORMAT_SQL = "'%d.%m.%Y %H:%i'";
const FORECAST_SLA_ACTIVE_STATUSES_SQL =
  "('booked', 'going', 'delayed', 'waiting', 'checkingin', 'inprogress', 'checkingout', 'completed', 'confirmed')";

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatDateUTC(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function formatDateTimeUTC(date) {
  return `${formatDateUTC(date)} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`;
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

function buildDateKeys(from, to) {
  const start = parseDateOnly(from);
  const end = parseDateOnly(to);
  const dates = [];

  for (let current = start; current.getTime() <= end.getTime(); current = addDaysUTC(current, 1)) {
    dates.push(formatDateUTC(current));
  }

  return dates;
}

function toDateTimeParam(dateOnly) {
  return `${dateOnly} 00:00:00`;
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
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

function cleanBooleanFlag(value) {
  const rawValues = Array.isArray(value) ? value : [value];

  return rawValues.some((rawValue) => {
    const text = cleanText(rawValue).toLowerCase();

    return text === '1' || text === 'true' || text === 'on' || text === 'yes';
  });
}

function numberValue(value) {
  const number = Number(value || 0);

  return Number.isFinite(number) ? number : 0;
}

function numberValueOrDefault(value, fallback) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return numberValue(fallback);
  }

  return numberValue(value);
}

function nullableNumberValue(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

function textValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function phoneValue(value) {
  if (value === null || typeof value === 'undefined') {
    return '';
  }

  return String(value).trim().replace(/^(\+?\d+)\.0$/, '$1');
}

function percent(numerator, denominator) {
  const bottom = numberValue(denominator);

  if (bottom <= 0) {
    return 0;
  }

  return (numberValue(numerator) / bottom) * 100;
}

function normalizeWorkplacePointFilters(input = {}, now = new Date()) {
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
  const activeSessionToDate = new Date(now.getTime());
  const activeSessionFromDate = new Date(now.getTime());

  activeSessionFromDate.setUTCDate(activeSessionFromDate.getUTCDate() - 30);

  return {
    workplaceId: cleanText(input.workplaceId),
    from,
    to,
    currentDate: formatDateUTC(today),
    fromDateTime: toDateTimeParam(from),
    toExclusiveDateTime: toDateTimeParam(toExclusive),
    activeSessionFromDateTime: formatDateTimeUTC(activeSessionFromDate),
    activeSessionToDateTime: formatDateTimeUTC(activeSessionToDate),
    rangeDays: buildDateKeys(from, to).length,
    profession: cleanValues(input.profession),
    orderType: cleanValues(input.orderType).filter((value) => ALLOWED_ORDER_TYPES.has(value)),
    jobStatus: cleanValues(input.jobStatus),
    includeDeletedOrders: cleanBooleanFlag(input.includeDeletedOrders),
    includeHiddenOrders: cleanBooleanFlag(input.includeHiddenOrders)
  };
}

function escapeClickHouseString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function serializeStringArray(values) {
  return `[${values.map((value) => `'${escapeClickHouseString(value)}'`).join(',')}]`;
}

function emptyFilterOptions() {
  return FILTER_OPTION_KEYS.reduce((options, key) => {
    options[key] = [];
    return options;
  }, {});
}

function filterOptionsFromRows(rows) {
  const options = emptyFilterOptions();
  const seenByKey = FILTER_OPTION_KEYS.reduce((seen, key) => {
    seen[key] = new Set();
    return seen;
  }, {});

  for (const row of rows) {
    const key = String(row.filter || '');
    const value = cleanText(row.value);

    if (!Object.prototype.hasOwnProperty.call(options, key) || value === '') {
      continue;
    }

    if (key === 'orderType' && !ALLOWED_ORDER_TYPES.has(value)) {
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

function restrictFiltersToOptions(filters, filterOptions) {
  const restricted = { ...filters };

  for (const key of FILTER_OPTION_KEYS) {
    const allowed = new Set(filterOptions[key] || []);

    restricted[key] = filters[key].filter((value) => allowed.has(value));
  }

  return restricted;
}

function titleForPoint(row) {
  return String(row.workplace_title || row.technical_name || row.workplace_id || 'Без названия');
}

function compactAddress(row) {
  return [row.city, row.street].map((part) => String(part || '').trim()).filter(Boolean).join(', ');
}

function mergeWorkplacePointRows(filters, datasets) {
  const metadataRow = (datasets.metadataRows || [])[0] || {};
  const summaryRow = (datasets.summaryRows || [])[0] || {};
  const reviewSummaryRow = (datasets.reviewSummaryRows || [])[0] || {};
  const orderedShifts = numberValue(summaryRow.ordered_shifts);
  const completedShifts = numberValue(summaryRow.completed_shifts);
  const slaOrderedShifts = numberValueOrDefault(summaryRow.sla_ordered_shifts, orderedShifts);
  const slaCompletedShifts = numberValueOrDefault(summaryRow.sla_completed_shifts, completedShifts);
  const slaForecastOrderedShifts = numberValue(summaryRow.forecast_sla_ordered_shifts);
  const slaForecastActiveShifts = numberValue(summaryRow.forecast_sla_active_shifts);
  const activeDays = numberValue(summaryRow.active_days);
  const filterOptions = filterOptionsFromRows(datasets.filterOptionRows || []);
  const radiusWorkers = RADIUS_KM.reduce((values, radius) => {
    values[radius] = 0;
    return values;
  }, {});
  const radiusActiveSessionWorkers = RADIUS_KM.reduce((values, radius) => {
    values[radius] = 0;
    return values;
  }, {});

  for (const row of datasets.radiusRows || []) {
    const radius = numberValue(row.radius_km);

    if (RADIUS_KM.includes(radius)) {
      radiusWorkers[radius] = numberValue(row.workers);
      radiusActiveSessionWorkers[radius] = numberValue(row.active_session_workers);
    }
  }

  const dailyRows = (datasets.dailyRows || []).map((row) => {
    const dailyOrderedShifts = numberValue(row.ordered_shifts);
    const dailyCompletedShifts = numberValue(row.completed_shifts);
    const dailyForecastSlaActiveShifts = numberValue(row.forecast_sla_active_shifts);

    return {
      period: String(row.period || ''),
      orderedShifts: dailyOrderedShifts,
      completedShifts: dailyCompletedShifts,
      slaPercent: percent(dailyCompletedShifts, dailyOrderedShifts),
      forecastSlaActiveShifts: dailyForecastSlaActiveShifts,
      forecastSlaPercent: percent(dailyForecastSlaActiveShifts, dailyOrderedShifts),
      dropoffs24h: numberValue(row.dropoffs_24h),
      orderLeadAvgMinutes: nullableNumberValue(row.avg_order_lead_minutes),
      orderLeadMinMinutes: nullableNumberValue(row.min_order_lead_minutes)
    };
  });
  const totalProfessionOrders = (datasets.professionRows || []).reduce(
    (total, row) => total + numberValue(row.ordered_shifts),
    0
  );
  const professionRows = (datasets.professionRows || []).map((row) => {
    const professionOrders = numberValue(row.ordered_shifts);

    return {
      profession: String(row.profession || 'Без специальности'),
      orderedShifts: professionOrders,
      sharePercent: percent(professionOrders, totalProfessionOrders)
    };
  });

  return {
    filters,
    currentDate: filters.currentDate,
    point: {
      workplaceId: String(metadataRow.workplace_id || filters.workplaceId),
      title: titleForPoint(metadataRow),
      clientTitle: String(metadataRow.client_title || ''),
      city: String(metadataRow.city || ''),
      region: String(metadataRow.region || ''),
      address: compactAddress(metadataRow)
    },
    filterOptions,
    summary: {
      orderedShifts,
      completedShifts,
      slaPercent: percent(slaCompletedShifts, slaOrderedShifts),
      slaPastPercent: percent(slaCompletedShifts, slaOrderedShifts),
      slaForecastPercent: percent(slaForecastActiveShifts, slaForecastOrderedShifts),
      slaOrderedShifts,
      slaCompletedShifts,
      slaForecastOrderedShifts,
      slaForecastActiveShifts,
      stabilityPercent: percent(activeDays, filters.rangeDays),
      activeDays,
      rangeDays: filters.rangeDays,
      uniqueCompletedWorkers: numberValue(summaryRow.unique_completed_workers),
      uniqueBookedWorkers: numberValue(summaryRow.unique_booked_workers),
      dropoffs24h: numberValue(summaryRow.dropoffs_24h),
      ratingAll: nullableNumberValue(reviewSummaryRow.avg_rating_all),
      ratingLast10: nullableNumberValue(reviewSummaryRow.avg_rating_last_10),
      ratingReviewCount: numberValue(reviewSummaryRow.review_count),
      radiusWorkers,
      radiusActiveSessionWorkers
    },
    dailyRows,
    professionRows
  };
}

function normalizeWorkplacePointDayDetailsInput(input = {}, now = new Date()) {
  const filters = normalizeWorkplacePointFilters(input, now);
  const requestedDate = parseDateOnly(input.date);

  if (filters.workplaceId === '') {
    throw httpError(400, 'Missing workplaceId');
  }

  if (!requestedDate) {
    throw httpError(400, 'Missing or invalid date');
  }

  const date = formatDateUTC(requestedDate);
  const toExclusive = formatDateUTC(addDaysUTC(requestedDate, 1));

  return {
    filters,
    date,
    fromDateTime: toDateTimeParam(date),
    toExclusiveDateTime: toDateTimeParam(toExclusive)
  };
}

function mergeWorkplacePointDayDetails(detailInput, detailRows = []) {
  return {
    filters: detailInput.filters,
    workplaceId: detailInput.filters.workplaceId,
    date: detailInput.date,
    rows: detailRows.map((row) => ({
      orderId: textValue(row.order_id),
      jobId: textValue(row.job_id),
      profession: textValue(row.profession) || 'Без специальности',
      orderStartLocal: textValue(row.order_start_local),
      plannedHours: nullableNumberValue(row.planned_hours),
      workerFullName: textValue(row.worker_full_name),
      workerPhone: textValue(row.worker_phone),
      confirmedStatus: textValue(row.confirmed_status),
      actualHours: nullableNumberValue(row.actual_hours),
      actualTimeLocal: textValue(row.actual_time_local),
      paymentAmount: numberValue(row.payment_amount),
      cancelledShifts: numberValue(row.cancelled_shifts),
      lastCancelledAtLocal: textValue(row.last_cancelled_at_local)
    }))
  };
}

function normalizeWorkplacePointReviewsInput(input = {}, now = new Date()) {
  const filters = normalizeWorkplacePointFilters(input, now);

  if (filters.workplaceId === '') {
    throw httpError(400, 'Missing workplaceId');
  }

  return {
    filters,
    workplaceId: filters.workplaceId
  };
}

function mergeWorkplacePointReviews(reviewInput, reviewRows = []) {
  return {
    workplaceId: reviewInput.workplaceId,
    reviews: reviewRows.map((row) => ({
      reviewId: textValue(row.review_id),
      jobId: textValue(row.job_id),
      rating: numberValue(row.rating),
      text: textValue(row.text),
      authorFullName: textValue(row.author_full_name),
      authorPhone: phoneValue(row.author_phone),
      createdAtLocal: textValue(row.created_at_local)
    }))
  };
}

function uniqueTextValues(values) {
  const unique = [];
  const seen = new Set();

  for (const value of values) {
    const text = textValue(value);

    if (text === '' || seen.has(text)) {
      continue;
    }

    seen.add(text);
    unique.push(text);
  }

  return unique;
}

function rowsByKey(rows, key) {
  const byKey = new Map();

  for (const row of rows || []) {
    const text = textValue(row[key]);

    if (text !== '') {
      byKey.set(text, row);
    }
  }

  return byKey;
}

function groupRowsByKey(rows, key) {
  const groups = new Map();

  for (const row of rows || []) {
    const text = textValue(row[key]);

    if (text === '') {
      continue;
    }

    if (!groups.has(text)) {
      groups.set(text, []);
    }

    groups.get(text).push(row);
  }

  return groups;
}

function isFactualDayJob(row) {
  return numberValue(row.is_factual) === 1;
}

function isCompletedDayJobCandidate(row) {
  return DAY_DETAIL_COMPLETED_JOB_STATUSES.has(textValue(row.status)) || isFactualDayJob(row);
}

function isCompletedDayJob(row, paymentRow = {}) {
  return isCompletedDayJobCandidate(row)
    && (
      isFactualDayJob(row)
      || numberValue(row.actual_hours) > 0
      || numberValue(paymentRow.payment_amount) > 0
    );
}

function latestTextValue(values) {
  return uniqueTextValues(values).sort().pop() || '';
}

function expandDayDetailJobStatusFilters(statuses) {
  const expanded = [];
  const seen = new Set();
  const addStatus = (status) => {
    const text = textValue(status);

    if (text === '' || seen.has(text)) {
      return;
    }

    seen.add(text);
    expanded.push(text);
  };

  for (const status of statuses || []) {
    addStatus(status);

    if (status === 'confirmed') {
      addStatus('completed');
    }
  }

  return expanded;
}

function sortDayDetailRows(rows) {
  return rows.sort((left, right) => {
    const leftKey = [
      textValue(left.order_start_local),
      textValue(left.profession),
      textValue(left.order_id),
      textValue(left.job_id)
    ].join('\u0000');
    const rightKey = [
      textValue(right.order_start_local),
      textValue(right.profession),
      textValue(right.order_id),
      textValue(right.job_id)
    ].join('\u0000');

    return leftKey.localeCompare(rightKey);
  });
}

function mergeWorkplacePointDayDetailDatasets(detailInput, datasets) {
  const jobsByOrderId = groupRowsByKey(datasets.jobRows || [], 'order_id');
  const workersById = rowsByKey(datasets.workerRows || [], 'worker_id');
  const paymentsByJobId = rowsByKey(datasets.paymentRows || [], 'job_id');
  const cancelledHistoryByJobId = rowsByKey(datasets.cancelledHistoryRows || [], 'job_id');
  const detailRows = [];

  for (const order of datasets.orderRows || []) {
    const orderId = textValue(order.order_id);
    const jobs = jobsByOrderId.get(orderId) || [];
    const cancelledJobs = jobs.filter((job) => textValue(job.status) === 'cancelled');
    const cancelledShifts = cancelledJobs.length;
    const completedJobs = jobs.filter((job) =>
      isCompletedDayJob(job, paymentsByJobId.get(textValue(job.job_id)) || {})
    );

    if (completedJobs.length > 0) {
      for (const job of completedJobs) {
        const worker = workersById.get(textValue(job.worker_id)) || {};
        const payment = paymentsByJobId.get(textValue(job.job_id)) || {};

        detailRows.push({
          order_id: orderId,
          job_id: textValue(job.job_id),
          profession: textValue(order.profession),
          order_start_local: textValue(order.order_start_local),
          planned_hours: nullableNumberValue(order.planned_hours),
          worker_full_name: textValue(worker.worker_full_name),
          worker_phone: textValue(worker.worker_phone),
          confirmed_status: textValue(job.status),
          actual_hours: nullableNumberValue(job.actual_hours),
          actual_time_local: textValue(job.actual_time_local),
          payment_amount: numberValue(payment.payment_amount),
          cancelled_shifts: cancelledShifts,
          last_cancelled_at_local: ''
        });
      }

      continue;
    }

    detailRows.push({
      order_id: orderId,
      job_id: '',
      profession: textValue(order.profession),
      order_start_local: textValue(order.order_start_local),
      planned_hours: nullableNumberValue(order.planned_hours),
      worker_full_name: '',
      worker_phone: '',
      confirmed_status: '',
      actual_hours: null,
      actual_time_local: '',
      payment_amount: 0,
      cancelled_shifts: cancelledShifts,
      last_cancelled_at_local: latestTextValue(
        cancelledJobs.map((job) => {
          const history = cancelledHistoryByJobId.get(textValue(job.job_id)) || {};

          return history.last_cancelled_at_local;
        })
      )
    });
  }

  return mergeWorkplacePointDayDetails(detailInput, sortDayDetailRows(detailRows));
}

function baseParams(filters) {
  return {
    param_workplace_id: filters.workplaceId,
    param_from: filters.fromDateTime,
    param_to: filters.toExclusiveDateTime,
    param_current_date: filters.currentDate,
    param_active_session_from: filters.activeSessionFromDateTime,
    param_active_session_to: filters.activeSessionToDateTime
  };
}

function addOptionalWhere(filters, where, params) {
  if (filters.profession.length > 0) {
    where.push("if(ifNull(p.caption, '') = '', o.spec, p.caption) IN {professions:Array(String)}");
    params.param_professions = serializeStringArray(filters.profession);
  }
  if (filters.orderType.length > 0) {
    where.push('o.type IN {order_types:Array(String)}');
    params.param_order_types = serializeStringArray(filters.orderType);
  }
  if (filters.jobStatus.length > 0) {
    where.push(`o._id IN (
      SELECT DISTINCT j.source
      FROM mg_jobs AS j
      WHERE j.deleted = 0
        AND ifNull(j.source, '') != ''
        AND ifNull(j.status, '') IN {job_statuses:Array(String)}
    )`);
    params.param_job_statuses = serializeStringArray(filters.jobStatus);
  }
}

function orderWhereForFilters(filters, params) {
  const where = [
    actualOrderDomainCondition('o', 'c', 'ct'),
    'o.workplace = {workplace_id:String}',
    'o.start >= {from:DateTime}',
    'o.start < {to:DateTime}',
    'ifNull(o.amount, 0) > 0'
  ];

  if (!filters.includeDeletedOrders) {
    where.unshift('ifNull(o.deleted, 0) = 0');
  }

  if (!filters.includeHiddenOrders) {
    where.unshift('ifNull(o.is_hidden, 0) = 0');
  }

  addOptionalWhere(filters, where, params);

  return where.join('\n    AND ');
}

function orderDimensionJoinsSql() {
  return `${actualOrderJoinsSql('o')}
  LEFT JOIN mg_professions AS p ON o.spec = p.spec`;
}

function metadataQuery() {
  return `SELECT
    w._id AS workplace_id,
    ifNull(w.title, '') AS workplace_title,
    ifNull(w.technical_name, '') AS technical_name,
    ifNull(w.client, '') AS client_id,
    ifNull(w.address__city, '') AS city,
    ifNull(w.address__region, '') AS region,
    ifNull(w.address__street, '') AS street
  FROM mg_workplaces AS w
  WHERE w._id = {workplace_id:String}
  LIMIT 1
  FORMAT JSONEachRow`;
}

function metadataClientQuery() {
  return `SELECT
    ifNull(title, '') AS client_title
  FROM mg_clients
  WHERE _id = {client_id:String}
  LIMIT 1
  FORMAT JSONEachRow`;
}

function metadataRowFromDirectoryEntry(entry) {
  if (!entry) {
    return null;
  }

  return {
    workplace_id: textValue(entry.workplaceId),
    workplace_title: textValue(entry.title),
    technical_name: textValue(entry.technicalName),
    client_title: textValue(entry.clientTitle),
    city: textValue(entry.city),
    region: textValue(entry.region),
    street: textValue(entry.street)
  };
}

async function loadWorkplacePointMetadataRows(client, filters, options = {}) {
  if (
    options.workplaceDirectoryCache
    && typeof options.workplaceDirectoryCache.getById === 'function'
  ) {
    try {
      const directoryEntry = await options.workplaceDirectoryCache.getById(client, filters.workplaceId);
      const cachedRow = metadataRowFromDirectoryEntry(directoryEntry);

      if (cachedRow && cachedRow.workplace_id !== '') {
        return [cachedRow];
      }
    } catch (_) {
      // Directory cache is an optimization; live metadata remains the source of truth fallback.
    }
  }

  const rows = await client.queryJSONEachRow(
    metadataQuery(),
    baseParams(filters),
    'workplace point metadata'
  );

  if (rows.length === 0) {
    return rows;
  }

  const clientId = textValue(rows[0].client_id);

  if (clientId === '') {
    return rows.map((row) => ({ ...row, client_title: '' }));
  }

  const clientRows = await client.queryJSONEachRow(
    metadataClientQuery(),
    { param_client_id: clientId },
    'workplace point metadata client'
  );

  return rows.map((row) => ({
    ...row,
    client_title: textValue((clientRows[0] || {}).client_title)
  }));
}

function filterOptionsQuery(filters) {
  const params = baseParams(filters);
  const whereSql = orderWhereForFilters(
    {
      ...filters,
      profession: [],
      orderType: [],
      jobStatus: []
    },
    params
  );

  return {
    params,
    query: `WITH filtered_orders AS (
    SELECT
      o._id AS order_id,
      if(ifNull(p.caption, '') = '', o.spec, p.caption) AS profession_value,
      ifNull(o.type, '') AS order_type_value
    FROM mg_orders AS o
    ${orderDimensionJoinsSql()}
    WHERE ${whereSql}
  ),
  order_filter_options AS (
    SELECT
      tupleElement(option, 1) AS filter,
      tupleElement(option, 2) AS value
    FROM filtered_orders
    ARRAY JOIN [
      tuple('profession', profession_value),
      tuple('orderType', order_type_value)
    ] AS option
    WHERE value != ''
    GROUP BY filter, value
  ),
  job_status_options AS (
    SELECT
      'jobStatus' AS filter,
      ifNull(j.status, '') AS value
    FROM mg_jobs AS j
    INNER JOIN (
      SELECT DISTINCT order_id
      FROM filtered_orders
    ) AS fo ON fo.order_id = j.source
    WHERE ifNull(j.deleted, 0) = 0
    GROUP BY value
    HAVING value != ''
  )
  SELECT filter, value FROM order_filter_options
  UNION ALL
  SELECT filter, value FROM job_status_options
  ORDER BY filter, value
  FORMAT JSONEachRow`
  };
}

function filteredOrdersCte(whereSql) {
  return `filtered_orders AS (
    SELECT
      o._id AS order_id,
      toString(toDate(o.start)) AS period,
      o.start AS order_start,
      o.createdAt AS order_created_at,
      if(
        o.createdAt IS NOT NULL
        AND o.start IS NOT NULL
        AND o.createdAt <= o.start,
        dateDiff('minute', o.createdAt, o.start),
        NULL
      ) AS order_lead_minutes,
      ifNull(o.amount, 0) AS amount,
      o.pieceworks AS pieceworks,
      if(ifNull(p.caption, '') = '', o.spec, p.caption) AS profession
    FROM mg_orders AS o
    ${orderDimensionJoinsSql()}
    WHERE ${whereSql}
  )`;
}

function shiftFactsCte() {
  return `shift_facts AS (
    SELECT
      j._id AS job_id,
      j.source AS order_id,
      j.worker AS worker,
      j.status AS status,
      j.start AS start,
      j.hours AS hours,
      j.payment AS payment,
      j.salary_per_hour AS salary_per_hour,
      j.salary_per_job AS salary_per_job,
      j.start_fact AS start_fact,
      j.finish_fact AS finish_fact,
      ${successfulConfirmedShiftFlagExpression('j', { pieceworkExpression: 'fo.pieceworks' })} AS is_successful_confirmed_shift,
      ifNull(j.cancellation_reason, '') AS cancellation_reason,
      ifNull(j.failure_reason, '') AS failure_reason
    FROM mg_jobs AS j
    INNER JOIN filtered_orders AS fo ON j.source = fo.order_id
    WHERE j.deleted = 0
  )`;
}

function dropEventsCte() {
  return `drop_events AS (
    SELECT
      h.job AS job_id,
      minIf(
        coalesce(h.createdAt, h.updatedAt),
        (
          ifNull(h.status, '') IN ('cancelled', 'failed')
          OR ifNull(h.cancellation_reason, '') != ''
          OR ifNull(h.failure_reason, '') != ''
        )
        AND (
          ifNull(h.initiator, '') = 'worker'
          OR ifNull(h.status, '') = 'failed'
          OR ifNull(h.failure_reason, '') != ''
        )
      ) AS drop_at
    FROM mg_job_history AS h
    INNER JOIN shift_facts AS sf ON h.job = sf.job_id
    GROUP BY h.job
  )`;
}

function bookedWorkersCte() {
  return `booked_workers AS (
    SELECT
      1 AS aggregate_join_key,
      uniqExact(ifNull(h.worker, '')) AS unique_booked_workers
    FROM mg_job_history AS h
    INNER JOIN shift_facts AS sf ON h.job = sf.job_id
    WHERE ifNull(h.status, '') = 'booked'
      AND ifNull(h.worker, '') != ''
  )`;
}

function summaryQuery(whereSql) {
  return `WITH ${filteredOrdersCte(whereSql)},
  ${shiftFactsCte()},
  ${dropEventsCte()},
  ${bookedWorkersCte()},
  order_summary AS (
    SELECT
      1 AS aggregate_join_key,
      sum(amount) AS ordered_shifts,
      sumIf(amount, toDate(order_start) < {current_date:Date}) AS sla_ordered_shifts,
      sumIf(amount, toDate(order_start) >= {current_date:Date}) AS forecast_sla_ordered_shifts,
      countDistinct(period) AS active_days
    FROM filtered_orders
  ),
  shift_summary AS (
    SELECT
      1 AS aggregate_join_key,
      countIf(is_successful_confirmed_shift = 1) AS completed_shifts,
      countIf(is_successful_confirmed_shift = 1 AND toDate(start) < {current_date:Date}) AS sla_completed_shifts,
      countIf(ifNull(status, '') IN ${FORECAST_SLA_ACTIVE_STATUSES_SQL} AND toDate(start) >= {current_date:Date}) AS forecast_sla_active_shifts,
      uniqExactIf(worker, is_successful_confirmed_shift = 1 AND worker != '') AS unique_completed_workers,
      uniqExactIf(
        sf.job_id,
        de.drop_at IS NOT NULL
        AND sf.start IS NOT NULL
        AND de.drop_at >= sf.start - INTERVAL 24 HOUR
        AND de.drop_at <= sf.start
      ) AS dropoffs_24h
    FROM shift_facts AS sf
    LEFT JOIN drop_events AS de ON sf.job_id = de.job_id
  )
  SELECT
    os.ordered_shifts AS ordered_shifts,
    ifNull(ss.completed_shifts, 0) AS completed_shifts,
    os.sla_ordered_shifts AS sla_ordered_shifts,
    ifNull(ss.sla_completed_shifts, 0) AS sla_completed_shifts,
    os.forecast_sla_ordered_shifts AS forecast_sla_ordered_shifts,
    ifNull(ss.forecast_sla_active_shifts, 0) AS forecast_sla_active_shifts,
    os.active_days AS active_days,
    ifNull(ss.unique_completed_workers, 0) AS unique_completed_workers,
    ifNull(bw.unique_booked_workers, 0) AS unique_booked_workers,
    ifNull(ss.dropoffs_24h, 0) AS dropoffs_24h
  FROM order_summary AS os
  LEFT JOIN shift_summary AS ss ON os.aggregate_join_key = ss.aggregate_join_key
  LEFT JOIN booked_workers AS bw ON os.aggregate_join_key = bw.aggregate_join_key
  FORMAT JSONEachRow`;
}

function reviewsSummaryQuery() {
  return `SELECT
    count() AS review_count,
    avgOrNull(rating) AS avg_rating_all,
    (
      SELECT avgOrNull(rating)
      FROM (
        SELECT r2.rating AS rating
        FROM mg_reviews AS r2
        INNER JOIN mg_jobs AS j2 ON r2.job = j2._id
        WHERE j2.workplace = {workplace_id:String}
          AND ifNull(r2.rating, 0) > 0
        ORDER BY r2.createdAt DESC, r2._id DESC
        LIMIT 10
      )
    ) AS avg_rating_last_10
  FROM mg_reviews AS r
  INNER JOIN mg_jobs AS j ON r.job = j._id
  WHERE j.workplace = {workplace_id:String}
    AND ifNull(r.rating, 0) > 0
  FORMAT JSONEachRow`;
}

function reviewAuthorFullNameExpression() {
  return `coalesce(
      nullIf(trim(concat(ifNull(wu.lastname, ''), ' ', ifNull(wu.firstname, ''), ' ', ifNull(wu.middlename, ''))), ''),
      nullIf(trim(ifNull(w.full_name, '')), ''),
      ''
    )`;
}

function reviewsQuery() {
  return `SELECT
    r._id AS review_id,
    r.job AS job_id,
    r.rating AS rating,
    ifNull(r.text, '') AS text,
    ${reviewAuthorFullNameExpression()} AS author_full_name,
    ifNull(wu.phone, '') AS author_phone,
    ifNull(formatDateTime(toTimeZone(r.createdAt, 'Europe/Moscow'), '%F %T'), '') AS created_at_local
  FROM mg_reviews AS r
  INNER JOIN mg_jobs AS j ON r.job = j._id
  LEFT JOIN mg_workers AS w ON coalesce(nullIf(ifNull(r.worker, ''), ''), nullIf(ifNull(j.worker, ''), ''), '') = w._id
  LEFT JOIN mg_users AS wu ON w.user = wu._id
  WHERE j.workplace = {workplace_id:String}
  ORDER BY r.createdAt DESC, r._id DESC
  FORMAT JSONEachRow`;
}

function dailyQuery(whereSql) {
  return `WITH ${filteredOrdersCte(whereSql)},
  ${shiftFactsCte()},
  ${dropEventsCte()},
  order_daily AS (
    SELECT
      period,
      sum(amount) AS ordered_shifts,
      avgOrNull(order_lead_minutes) AS avg_order_lead_minutes,
      minOrNull(order_lead_minutes) AS min_order_lead_minutes
    FROM filtered_orders
    GROUP BY period
  ),
  shift_daily AS (
    SELECT
      toString(toDate(sf.start)) AS period,
      countIf(sf.is_successful_confirmed_shift = 1) AS completed_shifts,
      countIf(ifNull(sf.status, '') IN ${FORECAST_SLA_ACTIVE_STATUSES_SQL} AND toDate(sf.start) >= {current_date:Date}) AS forecast_sla_active_shifts,
      uniqExactIf(
        sf.job_id,
        de.drop_at IS NOT NULL
        AND sf.start IS NOT NULL
        AND de.drop_at >= sf.start - INTERVAL 24 HOUR
        AND de.drop_at <= sf.start
      ) AS dropoffs_24h
    FROM shift_facts AS sf
    LEFT JOIN drop_events AS de ON sf.job_id = de.job_id
    GROUP BY period
  )
  SELECT
    od.period AS period,
    od.ordered_shifts AS ordered_shifts,
    od.avg_order_lead_minutes AS avg_order_lead_minutes,
    od.min_order_lead_minutes AS min_order_lead_minutes,
    ifNull(sd.completed_shifts, 0) AS completed_shifts,
    ifNull(sd.forecast_sla_active_shifts, 0) AS forecast_sla_active_shifts,
    ifNull(sd.dropoffs_24h, 0) AS dropoffs_24h
  FROM order_daily AS od
  LEFT JOIN shift_daily AS sd ON od.period = sd.period
  ORDER BY od.period
  FORMAT JSONEachRow`;
}

function professionsQuery(whereSql) {
  return `WITH ${filteredOrdersCte(whereSql)}
  SELECT
    profession AS profession,
    sum(amount) AS ordered_shifts
  FROM filtered_orders
  GROUP BY profession
  ORDER BY ordered_shifts DESC, profession
  FORMAT JSONEachRow`;
}

function radiusWorkersQuery() {
  return `WITH workplace AS (
    SELECT location__coordinates AS workplace_coordinates
    FROM mg_workplaces
    WHERE _id = {workplace_id:String}
      AND length(location__coordinates) >= 2
    LIMIT 1
  ),
  radii AS (
    SELECT arrayJoin([5, 10, 15, 20]) AS radius_km
  ),
  active_workers AS (
    SELECT
      _id AS worker_id,
      user AS user_id,
      location__coordinates AS worker_coordinates
    FROM mg_workers
    WHERE length(location__coordinates) >= 2
      AND ifNull(deleted, 0) = 0
      AND ifNull(status, '') IN ('ready', 'worked', 'booked')
  ),
  active_session_users AS (
    SELECT DISTINCT ifNull(profile_id, '') AS user_id
    FROM appmetrica_sessions
    WHERE ifNull(profile_id, '') != ''
      AND parseDateTimeBestEffortOrNull(session_start_datetime) >= {active_session_from:DateTime}
      AND parseDateTimeBestEffortOrNull(session_start_datetime) < {active_session_to:DateTime}
  )
  SELECT
    r.radius_km AS radius_km,
    uniqExactIf(
      aw.worker_id,
      greatCircleDistance(
        w.workplace_coordinates[1],
        w.workplace_coordinates[2],
        aw.worker_coordinates[1],
        aw.worker_coordinates[2]
      ) <= r.radius_km * 1000
    ) AS workers,
    uniqExactIf(
      aw.worker_id,
      greatCircleDistance(
        w.workplace_coordinates[1],
        w.workplace_coordinates[2],
        aw.worker_coordinates[1],
        aw.worker_coordinates[2]
      ) <= r.radius_km * 1000
      AND asu.user_id != ''
    ) AS active_session_workers
  FROM radii AS r
  CROSS JOIN workplace AS w
  CROSS JOIN active_workers AS aw
  LEFT JOIN active_session_users AS asu ON aw.user_id = asu.user_id
  GROUP BY r.radius_km
  ORDER BY r.radius_km
  FORMAT JSONEachRow`;
}

const WORKPLACE_POINT_GIGER_METRICS = {
  'unique-completed-workers': {
    label: 'Завершавшие',
    kind: 'shift'
  },
  'unique-booked-workers': {
    label: 'Бронировавшие',
    kind: 'shift'
  },
  'radius-workers': {
    label: 'Гигеры в радиусе',
    kind: 'radius',
    activeOnly: false
  },
  'radius-active-session-workers': {
    label: 'Активные в радиусе',
    kind: 'radius',
    activeOnly: true
  }
};

function httpError(status, message) {
  const error = new Error(message);

  error.status = status;
  return error;
}

function normalizeWorkplacePointGigerDetailsInput(input = {}, now = new Date()) {
  const metric = firstGigerDetailsText(input.metric);
  const metricConfig = WORKPLACE_POINT_GIGER_METRICS[metric];

  if (!metricConfig) {
    throw httpError(400, `Unknown workplace point giger metric: ${metric}`);
  }

  const filters = normalizeWorkplacePointFilters(input, now);

  if (filters.workplaceId === '') {
    throw httpError(400, 'workplaceId is required');
  }

  const page = normalizeGigerDetailsPage(input.page);
  const radiusKm = Number(firstGigerDetailsText(input.radiusKm));

  if (metricConfig.kind === 'radius' && !RADIUS_KM.includes(radiusKm)) {
    throw httpError(400, 'radiusKm is required');
  }

  return {
    source: 'workplace-point',
    metric,
    metricLabel: metricConfig.label,
    workplaceId: filters.workplaceId,
    radiusKm: metricConfig.kind === 'radius' ? radiusKm : null,
    radiusM: metricConfig.kind === 'radius' ? radiusKm * 1000 : null,
    page,
    pageSize: GIGER_DETAILS_PAGE_SIZE,
    offset: (page - 1) * GIGER_DETAILS_PAGE_SIZE,
    export: cleanGigerDetailsBooleanFlag(input.export),
    filters
  };
}

function pointGigerFullNameExpression(workerAlias = 'w', userAlias = 'u') {
  return `coalesce(
      nullIf(trim(concat(ifNull(${userAlias}.lastname, ''), ' ', ifNull(${userAlias}.firstname, ''), ' ', ifNull(${userAlias}.middlename, ''))), ''),
      nullIf(trim(ifNull(${workerAlias}.full_name, '')), ''),
      ''
    )`;
}

function workplacePointShiftGigerDetailsCtes(input, whereSql) {
  const eligibleWorkersCte =
    input.metric === 'unique-completed-workers'
      ? `eligible_worker_ids AS (
    SELECT DISTINCT sf.worker AS worker_id
    FROM shift_facts AS sf
    WHERE sf.is_successful_confirmed_shift = 1
      AND ifNull(sf.worker, '') != ''
  )`
      : `eligible_worker_ids AS (
    SELECT DISTINCT h.worker AS worker_id
    FROM mg_job_history AS h
    INNER JOIN shift_facts AS sf ON h.job = sf.job_id
    WHERE ifNull(h.status, '') = 'booked'
      AND ifNull(h.worker, '') != ''
  )`;

  return `${filteredOrdersCte(whereSql)},
  ${shiftFactsCte()},
  ${eligibleWorkersCte},
  eligible_gigers AS (
    SELECT
      ifNull(w.user, '') AS user_id,
      w._id AS worker_id,
      ${pointGigerFullNameExpression('w', 'u')} AS full_name,
      ifNull(u.phone, '') AS phone,
      ifNull(w.status, '') AS status
    FROM eligible_worker_ids AS eligible
    INNER JOIN mg_workers AS w ON eligible.worker_id = w._id
    LEFT JOIN mg_users AS u ON w.user = u._id
    WHERE ifNull(w.deleted, 0) = 0
  )`;
}

function workplacePointRadiusGigerDetailsCtes(input) {
  const activeWhere = WORKPLACE_POINT_GIGER_METRICS[input.metric].activeOnly
    ? '\n      AND user_id IN (SELECT user_id FROM active_session_users)'
    : '';

  return `workplace AS (
    SELECT location__coordinates AS workplace_coordinates
    FROM mg_workplaces
    WHERE _id = {workplace_id:String}
      AND length(location__coordinates) >= 2
    LIMIT 1
  ),
  active_session_users AS (
    SELECT DISTINCT ifNull(profile_id, '') AS user_id
    FROM appmetrica_sessions
    WHERE ifNull(profile_id, '') != ''
      AND parseDateTimeBestEffortOrNull(session_start_datetime) >= {active_session_from:DateTime}
      AND parseDateTimeBestEffortOrNull(session_start_datetime) < {active_session_to:DateTime}
  ),
  raw_gigers AS (
    SELECT
      worker.user AS user_id,
      worker._id AS worker_id,
      ${pointGigerFullNameExpression('worker', 'u')} AS full_name,
      ifNull(u.phone, '') AS phone,
      ifNull(worker.status, '') AS status,
      greatCircleDistance(
        workplace.workplace_coordinates[1],
        workplace.workplace_coordinates[2],
        worker.location__coordinates[1],
        worker.location__coordinates[2]
      ) AS distance_m
    FROM workplace
    CROSS JOIN mg_workers AS worker
    LEFT JOIN mg_users AS u ON worker.user = u._id
    WHERE length(worker.location__coordinates) >= 2
      AND ifNull(worker.deleted, 0) = 0
      AND ifNull(worker.status, '') IN ('ready', 'worked', 'booked')
      AND ifNull(worker.user, '') != ''
  ),
  eligible_gigers AS (
    SELECT
      user_id,
      worker_id,
      full_name,
      phone,
      status
    FROM raw_gigers
    WHERE distance_m <= {radius_m:UInt64}${activeWhere}
  )`;
}

function workplacePointGigerDetailsCtes(input, whereSql) {
  if (WORKPLACE_POINT_GIGER_METRICS[input.metric].kind === 'radius') {
    return workplacePointRadiusGigerDetailsCtes(input);
  }

  return workplacePointShiftGigerDetailsCtes(input, whereSql);
}

function workplacePointGigerDetailsLimitClause(input) {
  return input.export ? '' : '\n  LIMIT {limit:UInt64} OFFSET {offset:UInt64}';
}

function workplacePointGigerDetailsTotalQuery(input, whereSql) {
  return `WITH ${workplacePointGigerDetailsCtes(input, whereSql)}
  SELECT count() AS total_gigers
  FROM eligible_gigers
  FORMAT JSONEachRow`;
}

function workplacePointGigerDetailsQuery(input, whereSql) {
  return `WITH ${workplacePointGigerDetailsCtes(input, whereSql)}
  SELECT
    user_id,
    worker_id,
    full_name,
    phone,
    status
  FROM eligible_gigers
  ORDER BY full_name ASC, user_id ASC, worker_id ASC${workplacePointGigerDetailsLimitClause(input)}
  FORMAT JSONEachRow`;
}

function workplacePointGigerDetailsParams(input) {
  const { params } = paramsAndWhere(input.filters);
  const detailParams = {
    ...params,
    param_limit: input.pageSize,
    param_offset: input.offset
  };

  if (input.radiusM !== null) {
    detailParams.param_radius_m = input.radiusM;
  }

  return detailParams;
}

async function loadWorkplacePointGigerDetails(client, input = {}, now = new Date()) {
  const detailInput = normalizeWorkplacePointGigerDetailsInput(input, now);
  const { whereSql } = paramsAndWhere(detailInput.filters);
  const params = workplacePointGigerDetailsParams(detailInput);
  const totalRows = await client.queryJSONEachRow(
    workplacePointGigerDetailsTotalQuery(detailInput, whereSql),
    params,
    'workplace point giger details total'
  );
  const gigerRows = await client.queryJSONEachRow(
    workplacePointGigerDetailsQuery(detailInput, whereSql),
    params,
    'workplace point giger details'
  );

  return mergeGigerDetails(detailInput, totalRows, gigerRows);
}

function plannedHoursExpression(alias = 'fo', startField = 'order_start', finishField = 'order_finish') {
  const hours = numericFieldExpression(alias, 'hours');

  return `if(
      ${hours} > 0,
      toNullable(${hours}),
      if(
        ${alias}.${finishField} > ${alias}.${startField},
        toNullable(dateDiff('minute', ${alias}.${startField}, ${alias}.${finishField}) / 60.0),
        CAST(NULL, 'Nullable(Float64)')
      )
    )`;
}

function dayDetailsOrdersQuery(whereSql) {
  return `SELECT
    o._id AS order_id,
    if(ifNull(p.caption, '') = '', o.spec, p.caption) AS profession,
    formatDateTime(toTimeZone(o.start, 'Europe/Moscow'), '%F %T') AS order_start_local,
    ${plannedHoursExpression('o', 'start', 'finish')} AS planned_hours
  FROM mg_orders AS o
  ${orderDimensionJoinsSql()}
  WHERE ${whereSql}
  ORDER BY order_start_local ASC, profession ASC, order_id ASC
  FORMAT JSONEachRow`;
}

function dayDetailsJobsQuery(hasJobStatusFilter) {
  const statusWhere = hasJobStatusFilter
    ? "\n    AND ifNull(status, '') IN {job_statuses:Array(String)}"
    : '';

  return `SELECT
    _id AS job_id,
    source AS order_id,
    status AS status,
    ifNull(worker, '') AS worker_id,
    hours AS actual_hours,
    if(
      ifNull(status, '') IN ${DAY_DETAIL_FACTUAL_JOB_STATUSES_SQL}
      AND start_fact IS NOT NULL
      AND finish_fact IS NOT NULL
      AND finish_fact > start_fact
      AND dateDiff('second', start_fact, finish_fact) != 0,
      1,
      0
    ) AS is_factual,
    if(
      ifNull(status, '') IN ${DAY_DETAIL_FACTUAL_JOB_STATUSES_SQL}
      AND start_fact IS NOT NULL
      AND finish_fact IS NOT NULL
      AND finish_fact > start_fact
      AND dateDiff('second', start_fact, finish_fact) != 0,
      concat(
        formatDateTime(toTimeZone(start_fact, 'Europe/Moscow'), ${DAY_DETAIL_FACTUAL_TIME_FORMAT_SQL}),
        ' - ',
        formatDateTime(toTimeZone(finish_fact, 'Europe/Moscow'), ${DAY_DETAIL_FACTUAL_TIME_FORMAT_SQL})
      ),
      ''
    ) AS actual_time_local
  FROM mg_jobs
  WHERE ifNull(deleted, 0) = 0
    AND source IN {order_ids:Array(String)}${statusWhere}
  ORDER BY order_id ASC, job_id ASC
  FORMAT JSONEachRow`;
}

function dayDetailsWorkersQuery() {
  return `SELECT
    w._id AS worker_id,
    coalesce(
      nullIf(trim(concat(ifNull(u.lastname, ''), ' ', ifNull(u.firstname, ''), ' ', ifNull(u.middlename, ''))), ''),
      nullIf(trim(ifNull(w.full_name, '')), ''),
      ''
    ) AS worker_full_name,
    ifNull(u.phone, '') AS worker_phone
  FROM mg_workers AS w
  LEFT JOIN mg_users AS u ON w.user = u._id
  WHERE w._id IN {worker_ids:Array(String)}
  FORMAT JSONEachRow`;
}

function dayDetailsPaymentsQuery() {
  return `SELECT
    job_id,
    sumIf(amount, ifNull(payment_status, '') IN ('done', 'bank_done')) AS payment_amount
  FROM (
    SELECT
      arrayJoin(arrayDistinct([ifNull(job, ''), ifNull(entityId, '')])) AS job_id,
      ifNull(amount, 0) AS amount,
      ifNull(payment_status, '') AS payment_status
    FROM mg_payments
    WHERE ifNull(job, '') IN {job_ids:Array(String)}
      OR ifNull(entityId, '') IN {job_ids:Array(String)}
  )
  WHERE job_id != ''
    AND job_id IN {job_ids:Array(String)}
  GROUP BY job_id
  FORMAT JSONEachRow`;
}

function dayDetailsCancelledHistoryQuery() {
  return `SELECT
    job AS job_id,
    ifNull(formatDateTime(toTimeZone(max(coalesce(createdAt, updatedAt)), 'Europe/Moscow'), '%F %T'), '') AS last_cancelled_at_local
  FROM mg_job_history
  WHERE ifNull(status, '') = 'cancelled'
    AND job IN {cancelled_job_ids:Array(String)}
  GROUP BY job
  FORMAT JSONEachRow`;
}

function paramsAndWhere(filters) {
  const params = baseParams(filters);
  const whereSql = orderWhereForFilters(filters, params);

  return { params, whereSql };
}

function assertWorkplacePointSection(section) {
  if (WORKPLACE_POINT_SECTIONS.has(section)) {
    return;
  }

  throw httpError(400, `Unknown workplace point section: ${section}`);
}

async function readThroughCache(cache, key, loader) {
  if (!cache || typeof cache.getOrLoad !== 'function') {
    return loader();
  }

  return cache.getOrLoad(key, loader);
}

function cacheKeyForWorkplacePointSection(section, filters) {
  return JSON.stringify({
    board: 'workplace-point',
    section,
    filters: {
      workplaceId: filters.workplaceId,
      from: filters.from,
      to: filters.to,
      currentDate: filters.currentDate,
      activeSessionFromDateTime: filters.activeSessionFromDateTime,
      activeSessionToDateTime: filters.activeSessionToDateTime,
      profession: filters.profession,
      orderType: filters.orderType,
      jobStatus: filters.jobStatus,
      includeDeletedOrders: filters.includeDeletedOrders,
      includeHiddenOrders: filters.includeHiddenOrders
    }
  });
}

function metadataRowsForSection(filters) {
  return [{ workplace_id: filters.workplaceId }];
}

async function loadWorkplacePointSectionRows(client, filters, section) {
  assertWorkplacePointSection(section);

  const { params, whereSql } = paramsAndWhere(filters);

  if (section === 'summary') {
    const [summaryRows, reviewSummaryRows] = await Promise.all([
      client.queryJSONEachRow(
        summaryQuery(whereSql),
        params,
        'workplace point summary'
      ),
      client.queryJSONEachRow(
        reviewsSummaryQuery(),
        params,
        'workplace point review summary'
      )
    ]);

    return { summaryRows, reviewSummaryRows };
  }

  if (section === 'charts') {
    const [dailyRows, professionRows] = await Promise.all([
      client.queryJSONEachRow(dailyQuery(whereSql), params, 'workplace point daily'),
      client.queryJSONEachRow(professionsQuery(whereSql), params, 'workplace point professions')
    ]);

    return { dailyRows, professionRows };
  }

  const radiusRows = await client.queryJSONEachRow(
    radiusWorkersQuery(),
    params,
    'workplace point radius workers'
  );

  return { radiusRows };
}

async function loadWorkplacePointReviews(client, input = {}, now = new Date()) {
  const reviewInput = normalizeWorkplacePointReviewsInput(input, now);
  const reviewRows = await client.queryJSONEachRow(
    reviewsQuery(),
    { param_workplace_id: reviewInput.workplaceId },
    'workplace point reviews'
  );

  return mergeWorkplacePointReviews(reviewInput, reviewRows);
}

async function loadWorkplacePointDayDetails(client, input = {}, now = new Date()) {
  const detailInput = normalizeWorkplacePointDayDetailsInput(input, now);
  const orderParams = baseParams(detailInput.filters);

  orderParams.param_from = detailInput.fromDateTime;
  orderParams.param_to = detailInput.toExclusiveDateTime;

  const orderWhereSql = orderWhereForFilters(
    { ...detailInput.filters, jobStatus: [] },
    orderParams
  );

  const orderRows = await client.queryJSONEachRow(
    dayDetailsOrdersQuery(orderWhereSql),
    orderParams,
    'workplace point day orders'
  );
  const orderIds = uniqueTextValues(orderRows.map((row) => row.order_id));

  if (orderIds.length === 0) {
    return mergeWorkplacePointDayDetailDatasets(detailInput, { orderRows });
  }

  const jobParams = {
    param_order_ids: serializeStringArray(orderIds)
  };
  const dayDetailJobStatuses = expandDayDetailJobStatusFilters(detailInput.filters.jobStatus);

  if (dayDetailJobStatuses.length > 0) {
    jobParams.param_job_statuses = serializeStringArray(dayDetailJobStatuses);
  }

  const jobRows = await client.queryJSONEachRow(
    dayDetailsJobsQuery(dayDetailJobStatuses.length > 0),
    jobParams,
    'workplace point day jobs'
  );
  const completedJobCandidates = jobRows.filter(isCompletedDayJobCandidate);
  const completedJobIds = uniqueTextValues(completedJobCandidates.map((row) => row.job_id));
  const workerIds = uniqueTextValues(completedJobCandidates.map((row) => row.worker_id));
  const cancelledJobIds = uniqueTextValues(
    jobRows
      .filter((row) => textValue(row.status) === 'cancelled')
      .map((row) => row.job_id)
  );
  const [workerRows, paymentRows, cancelledHistoryRows] = await Promise.all([
    workerIds.length > 0
      ? client.queryJSONEachRow(
        dayDetailsWorkersQuery(),
        { param_worker_ids: serializeStringArray(workerIds) },
        'workplace point day workers'
      )
      : Promise.resolve([]),
    completedJobIds.length > 0
      ? client.queryJSONEachRow(
        dayDetailsPaymentsQuery(),
        { param_job_ids: serializeStringArray(completedJobIds) },
        'workplace point day payments'
      )
      : Promise.resolve([]),
    cancelledJobIds.length > 0
      ? client.queryJSONEachRow(
        dayDetailsCancelledHistoryQuery(),
        { param_cancelled_job_ids: serializeStringArray(cancelledJobIds) },
        'workplace point day cancelled history'
      )
      : Promise.resolve([])
  ]);

  return mergeWorkplacePointDayDetailDatasets(detailInput, {
    orderRows,
    jobRows,
    workerRows,
    paymentRows,
    cancelledHistoryRows
  });
}

function mergeWorkplacePointSection(filters, sectionRows, shellRows = {}) {
  return mergeWorkplacePointRows(filters, {
    metadataRows: shellRows.metadataRows || metadataRowsForSection(filters),
    filterOptionRows: shellRows.filterOptionRows || [],
    ...sectionRows
  });
}

async function loadWorkplacePointDashboardShell(client, input = {}, now = new Date(), options = {}) {
  let filters = normalizeWorkplacePointFilters(input, now);

  if (filters.workplaceId === '') {
    throw httpError(400, 'Missing workplaceId');
  }

  const metadataRows = await loadWorkplacePointMetadataRows(client, filters, options);

  if (metadataRows.length === 0) {
    throw httpError(404, `Workplace not found: ${filters.workplaceId}`);
  }

  const filterOptionsRequest = filterOptionsQuery(filters);
  let filterOptionRows = [];

  try {
    filterOptionRows = await client.queryJSONEachRow(
      filterOptionsRequest.query,
      filterOptionsRequest.params,
      'workplace point filter options'
    );
  } catch (_) {
    filterOptionRows = [];
  }
  const filterOptions = filterOptionsFromRows(filterOptionRows);

  filters = restrictFiltersToOptions(filters, filterOptions);

  return {
    ...mergeWorkplacePointRows(filters, {
      metadataRows,
      filterOptionRows
    }),
    _metadataRows: metadataRows,
    _filterOptionRows: filterOptionRows
  };
}

async function loadWorkplacePointDashboardSection(
  client,
  input = {},
  section,
  now = new Date(),
  options = {}
) {
  assertWorkplacePointSection(section);

  const filters = normalizeWorkplacePointFilters(input, now);

  if (filters.workplaceId === '') {
    throw httpError(400, 'Missing workplaceId');
  }

  const sectionRows = await readThroughCache(
    options.cache,
    cacheKeyForWorkplacePointSection(section, filters),
    () => loadWorkplacePointSectionRows(client, filters, section)
  );

  return mergeWorkplacePointSection(filters, sectionRows);
}

async function loadWorkplacePointDashboard(client, input = {}, now = new Date()) {
  const shell = await loadWorkplacePointDashboardShell(client, input, now);
  const sectionRows = await Promise.all(
    WORKPLACE_POINT_SECTION_NAMES.map((section) =>
      loadWorkplacePointSectionRows(client, shell.filters, section)
    )
  );

  return mergeWorkplacePointSection(
    shell.filters,
    Object.assign({}, ...sectionRows),
    {
      metadataRows: shell._metadataRows,
      filterOptionRows: shell._filterOptionRows
    }
  );
}

module.exports = {
  WORKPLACE_POINT_SECTIONS,
  loadWorkplacePointDashboard,
  loadWorkplacePointDashboardSection,
  loadWorkplacePointDashboardShell,
  loadWorkplacePointDayDetails,
  loadWorkplacePointGigerDetails,
  loadWorkplacePointReviews,
  mergeWorkplacePointDayDetails,
  mergeWorkplacePointReviews,
  mergeWorkplacePointRows,
  normalizeWorkplacePointGigerDetailsInput,
  normalizeWorkplacePointDayDetailsInput,
  normalizeWorkplacePointReviewsInput,
  normalizeWorkplacePointFilters
};
