const fs = require('node:fs/promises');
const path = require('node:path');

const { actualOrderDomainCondition, actualOrderJoinsSql } = require('./analyticsDomainSql');
const { writeFileAtomically } = require('./atomicFile');
const { successfulConfirmedShiftFlagExpression } = require('./successfulConfirmedShift');
const {
  GIGER_DETAILS_PAGE_SIZE,
  cleanBooleanFlag: cleanGigerDetailsBooleanFlag,
  firstCleanText: firstGigerDetailsText,
  mergeGigerDetails,
  normalizeGigerDetailsPage
} = require('./gigerDetails');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_ORDER_TYPES = new Set(['once', 'regular']);
const FILTER_OPTION_KEYS = ['client', 'profession', 'orderType', 'jobStatus', 'contractor'];
const CITY_ANALYSIS_CACHE_VERSION = 2;
const DEFAULT_CITY_ANALYSIS_CACHE_PATH = path.join(process.cwd(), 'data', 'city-analysis-cache.json');
const CITY_ANALYSIS_SECTION_NAMES = [
  'summary-demand',
  'summary-base',
  'summary-app',
  'summary-responses',
  'summary-ratio',
  'composition',
  'dynamics'
];
const CITY_ANALYSIS_SECTIONS = new Set(CITY_ANALYSIS_SECTION_NAMES);

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

function normalizePositiveNumber(value) {
  const text = firstCleanText(value).replace(',', '.');

  if (text === '') {
    return null;
  }

  const number = Number(text);

  if (!Number.isFinite(number)) {
    return null;
  }

  return Math.max(0, number);
}

function normalizeCityAnalysisFilters(input = {}, now = new Date()) {
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
  const active30dFromDate = addDaysUTC(today, -29);
  const active30dToExclusiveDate = addDaysUTC(today, 1);

  return {
    from,
    to,
    fromDateTime: toDateTimeParam(from),
    toExclusiveDateTime: toDateTimeParam(toExclusive),
    active30dFromDateTime: toDateTimeParam(formatDateUTC(active30dFromDate)),
    active30dToExclusiveDateTime: toDateTimeParam(formatDateUTC(active30dToExclusiveDate)),
    rangeDays: buildDateKeys(from, to).length,
    city: firstCleanText(input.city),
    client: cleanValues(input.client),
    profession: cleanValues(input.profession),
    orderType: cleanValues(input.orderType).filter((value) => ALLOWED_ORDER_TYPES.has(value)),
    jobStatus: cleanValues(input.jobStatus),
    contractor: cleanValues(input.contractor),
    salaryFrom: normalizePositiveNumber(input.salaryFrom),
    salaryTo: normalizePositiveNumber(input.salaryTo),
    includeDeletedOrders: cleanBooleanFlag(input.includeDeletedOrders),
    includeHiddenOrders: cleanBooleanFlag(input.includeHiddenOrders)
  };
}

function numberValue(value) {
  const number = Number(value || 0);

  return Number.isFinite(number) ? number : 0;
}

function percent(numerator, denominator) {
  const bottom = numberValue(denominator);

  if (bottom <= 0) {
    return 0;
  }

  return (numberValue(numerator) / bottom) * 100;
}

function uniqueTextRows(rows, key) {
  const values = [];
  const seen = new Set();

  for (const row of rows) {
    const text = cleanText(row[key]);

    if (text === '' || seen.has(text)) {
      continue;
    }

    seen.add(text);
    values.push(text);
  }

  return values;
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

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidCityOptionRows(value) {
  return Array.isArray(value) && value.every((row) => isPlainObject(row) && typeof row.city === 'string');
}

function isValidFilterOptionRows(value) {
  return Array.isArray(value) && value.every((row) =>
    isPlainObject(row) && typeof row.filter === 'string' && typeof row.value === 'string'
  );
}

function compositionRows(rows) {
  const total = rows.reduce((sum, row) => sum + numberValue(row.ordered_shifts), 0);

  return rows.map((row) => {
    const orderedShifts = numberValue(row.ordered_shifts);

    return {
      label: String(row.label || ''),
      orderedShifts,
      sharePercent: percent(orderedShifts, total)
    };
  });
}

function rateRows(rows) {
  const total = rows.reduce((sum, row) => sum + numberValue(row.ordered_shifts), 0);

  return rows.map((row) => {
    const orderedShifts = numberValue(row.ordered_shifts);

    return {
      label: String(row.label || ''),
      orderedShifts,
      sharePercent: percent(orderedShifts, total),
      avgSalaryPerHour: numberValue(row.avg_salary_per_hour)
    };
  });
}

function dynamicRows(rows) {
  return rows.map((row) => ({
    period: String(row.period || ''),
    orderedShifts: numberValue(row.ordered_shifts),
    appActiveUsers: numberValue(row.app_active_users),
    bookedUsers: numberValue(row.booked_users),
    completedUsers: numberValue(row.completed_users),
    activeUsersPerRequest: numberValue(row.active_users_per_request)
  }));
}

function mergeCityAnalysisRows(filters, datasets) {
  const hasCity = filters.city !== '';
  const summaryRow = hasCity ? (datasets.summaryRows || [])[0] || {} : {};
  const filterOptions = filterOptionsFromRows(datasets.filterOptionRows || []);
  const brandRows = hasCity ? datasets.brandRows || [] : [];
  const professionRows = hasCity ? datasets.professionRows || [] : [];
  const rateBucketRows = hasCity ? datasets.rateRows || [] : [];
  const dynamics = hasCity ? datasets.dynamicRows || [] : [];

  return {
    filters,
    filterOptions: {
      city: uniqueTextRows(datasets.cityOptionRows || [], 'city'),
      ...filterOptions
    },
    context: {
      selectedCity: filters.city,
      hasCity,
      hasCityCoordinates: hasCity && (datasets.cityCoordinateRows || []).length > 0,
      periodLabel: `${filters.from} - ${filters.to}`
    },
    summary: {
      orderedShifts: numberValue(summaryRow.ordered_shifts),
      activeOrderRequests: numberValue(summaryRow.active_order_requests),
      totalLocatedUsers: numberValue(summaryRow.total_located_users),
      readyLocatedUsers: numberValue(summaryRow.ready_located_users),
      readyStatusLocatedUsers: numberValue(summaryRow.ready_status_located_users),
      bookedStatusLocatedUsers: numberValue(summaryRow.booked_status_located_users),
      workedStatusLocatedUsers: numberValue(summaryRow.worked_status_located_users),
      appActiveUsers: numberValue(summaryRow.app_active_users),
      app30dActiveUsers: numberValue(summaryRow.app_30d_active_users),
      app30dReadyStatusUsers: numberValue(summaryRow.app_30d_ready_status_users),
      app30dBookedStatusUsers: numberValue(summaryRow.app_30d_booked_status_users),
      app30dWorkedStatusUsers: numberValue(summaryRow.app_30d_worked_status_users),
      bookedUsers: numberValue(summaryRow.booked_users),
      completedUsers: numberValue(summaryRow.completed_users),
      avgDaily30dActiveUsersPerRequest: numberValue(summaryRow.avg_daily_30d_active_users_per_request)
    },
    composition: {
      brands: compositionRows(brandRows),
      professions: compositionRows(professionRows),
      rateBuckets: rateRows(rateBucketRows)
    },
    dynamics: dynamicRows(dynamics)
  };
}

function escapeClickHouseString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function serializeStringArray(values) {
  return `[${values.map((value) => `'${escapeClickHouseString(value)}'`).join(',')}]`;
}

function cityAnalysisCachePathFromEnv(env = process.env) {
  return env.CITY_ANALYSIS_CACHE_PATH || DEFAULT_CITY_ANALYSIS_CACHE_PATH;
}

function normalizeCityAnalysisCache(data) {
  if (!data || data.version !== CITY_ANALYSIS_CACHE_VERSION || typeof data.entries !== 'object') {
    return {
      version: CITY_ANALYSIS_CACHE_VERSION,
      entries: {}
    };
  }

  return data;
}

async function readCityAnalysisCacheFile(filePath) {
  try {
    const body = await fs.readFile(filePath, 'utf8');

    return normalizeCityAnalysisCache(JSON.parse(body));
  } catch (_) {
    return normalizeCityAnalysisCache();
  }
}

async function writeCityAnalysisCacheFile(filePath, entries) {
  const data = {
    version: CITY_ANALYSIS_CACHE_VERSION,
    entries: {}
  };

  for (const [key, entry] of entries) {
    if (!entry || entry.value === undefined || !Number.isFinite(entry.expiresAt)) {
      continue;
    }

    data.entries[key] = {
      value: entry.value,
      expiresAt: new Date(entry.expiresAt).toISOString()
    };
  }

  await writeFileAtomically(filePath, `${JSON.stringify(data)}\n`, 'utf8');
}

function timeMs(value) {
  const number = value instanceof Date ? value.getTime() : Number(value);

  return Number.isFinite(number) ? number : Date.now();
}

function endOfUtcDayMs(timestamp) {
  const date = new Date(timeMs(timestamp));

  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

function createCityAnalysisCache({
  now = () => Date.now(),
  filePath = null
} = {}) {
  const entries = new Map();
  let fileLoaded = false;
  let fileLoadPromise = null;

  async function loadFileEntries() {
    if (!filePath || fileLoaded) {
      return;
    }

    if (fileLoadPromise) {
      await fileLoadPromise;
      return;
    }

    fileLoadPromise = (async () => {
      const data = await readCityAnalysisCacheFile(filePath);

      for (const [key, entry] of Object.entries(data.entries)) {
        const expiresAt = Date.parse(entry && entry.expiresAt);

        if (Number.isFinite(expiresAt)) {
          entries.set(key, {
            value: entry.value,
            expiresAt
          });
        }
      }

      fileLoaded = true;
    })();

    await fileLoadPromise;
  }

  function pruneExpiredEntries(current) {
    let changed = false;

    for (const [key, entry] of entries) {
      if (entry && entry.value !== undefined && Number.isFinite(entry.expiresAt) && entry.expiresAt <= current) {
        entries.delete(key);
        changed = true;
      }
    }

    return changed;
  }

  async function persistEntries() {
    if (!filePath) {
      return;
    }

    await writeCityAnalysisCacheFile(filePath, entries);
  }

  return {
    async pruneExpired(currentValue = now()) {
      await loadFileEntries();

      const pruned = pruneExpiredEntries(timeMs(currentValue));

      if (pruned) {
        await persistEntries();
      }

      return pruned;
    },

    async getOrLoad(key, loader) {
      await loadFileEntries();

      const current = timeMs(now());
      const pruned = pruneExpiredEntries(current);
      const cached = entries.get(key);

      if (cached && cached.value !== undefined && cached.expiresAt > current) {
        if (pruned) {
          await persistEntries();
        }

        return cached.value;
      }

      if (cached && cached.promise) {
        if (pruned) {
          await persistEntries();
        }

        return cached.promise;
      }

      if (pruned) {
        await persistEntries();
      }

      const promise = Promise.resolve()
        .then(loader)
        .then(
          async (value) => {
            entries.set(key, {
              value,
              expiresAt: endOfUtcDayMs(now())
            });

            await persistEntries();

            return value;
          },
          (error) => {
            entries.delete(key);
            throw error;
          }
        );

      entries.set(key, {
        promise,
        expiresAt: endOfUtcDayMs(current)
      });

      return promise;
    },
    async clear() {
      entries.clear();
      fileLoaded = false;
      fileLoadPromise = null;

      await persistEntries();
    },
    async invalidate(key) {
      await loadFileEntries();

      const deleted = entries.delete(key);

      if (deleted) {
        await persistEntries();
      }

      return deleted;
    }
  };
}

async function readThroughCache(cache, key, loader) {
  if (!cache || typeof cache.getOrLoad !== 'function') {
    return loader();
  }

  return cache.getOrLoad(key, loader);
}

async function readThroughValidatedCache(cache, key, loader, isValidValue) {
  if (!cache || typeof cache.getOrLoad !== 'function') {
    return loader();
  }

  const value = await cache.getOrLoad(key, loader);

  if (isValidValue(value)) {
    return value;
  }

  if (typeof cache.invalidate === 'function') {
    await cache.invalidate(key);
    return cache.getOrLoad(key, loader);
  }

  return loader();
}

function cacheKeyForFilters(scope, filters) {
  return JSON.stringify({
    board: 'city-analysis',
    scope,
    filters: {
      from: filters.from,
      to: filters.to,
      active30dFromDateTime: filters.active30dFromDateTime,
      active30dToExclusiveDateTime: filters.active30dToExclusiveDateTime,
      city: filters.city,
      client: filters.client,
      profession: filters.profession,
      orderType: filters.orderType,
      jobStatus: filters.jobStatus,
      contractor: filters.contractor,
      salaryFrom: filters.salaryFrom,
      salaryTo: filters.salaryTo,
      includeDeletedOrders: filters.includeDeletedOrders,
      includeHiddenOrders: filters.includeHiddenOrders
    }
  });
}

function periodParams(filters) {
  return {
    param_from: filters.fromDateTime,
    param_to: filters.toExclusiveDateTime
  };
}

function baseParams(filters) {
  return {
    ...periodParams(filters),
    param_active_30d_from: filters.active30dFromDateTime,
    param_active_30d_to: filters.active30dToExclusiveDateTime
  };
}

function addOptionalOrderWhere(filters, where, params) {
  if (filters.city) {
    where.push('w.address__city = {city:String}');
    params.param_city = filters.city;
  }
  if (filters.client.length > 0) {
    where.push('c.title IN {clients:Array(String)}');
    params.param_clients = serializeStringArray(filters.client);
  }
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
      WHERE ifNull(j.deleted, 0) = 0
        AND ifNull(j.source, '') != ''
        AND ifNull(j.status, '') IN {job_statuses:Array(String)}
    )`);
    params.param_job_statuses = serializeStringArray(filters.jobStatus);
  }
  if (filters.contractor.length > 0) {
    where.push("ifNull(ct.legal_name, '') IN {contractors:Array(String)}");
    params.param_contractors = serializeStringArray(filters.contractor);
  }
  if (filters.salaryFrom !== null) {
    where.push('ifNull(o.salary_per_hour, 0) >= {salary_from:Float64}');
    params.param_salary_from = filters.salaryFrom;
  }
  if (filters.salaryTo !== null) {
    where.push('ifNull(o.salary_per_hour, 0) <= {salary_to:Float64}');
    params.param_salary_to = filters.salaryTo;
  }
}

function orderWhereForFilters(
  filters,
  params,
  { forceActiveRequests = false, fromParam = 'from', toParam = 'to' } = {}
) {
  const where = [
    actualOrderDomainCondition('o', 'c', 'ct'),
    `o.start >= {${fromParam}:DateTime}`,
    `o.start < {${toParam}:DateTime}`,
    "ifNull(o.workplace, '') != ''",
    'ifNull(o.amount, 0) > 0'
  ];

  if (forceActiveRequests || !filters.includeDeletedOrders) {
    where.unshift('ifNull(o.deleted, 0) = 0');
  }

  if (!filters.includeHiddenOrders) {
    where.unshift('ifNull(o.is_hidden, 0) = 0');
  }

  addOptionalOrderWhere(filters, where, params);

  return where.join('\n    AND ');
}

function paramsAndWhere(filters) {
  const params = baseParams(filters);
  const whereSql = orderWhereForFilters(filters, params);
  const active30dWhereSql = orderWhereForFilters(filters, params, {
    forceActiveRequests: true,
    fromParam: 'active_30d_from',
    toParam: 'active_30d_to'
  });

  return { params, whereSql, active30dWhereSql };
}

function cityOptionsQuery() {
  return `SELECT
    ifNull(w.address__city, '') AS city
  FROM mg_orders AS o
  LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
  ${actualOrderJoinsSql('o', { clientAlias: 'c', contractorAlias: 'ct' })}
  WHERE ${actualOrderDomainCondition('o', 'c', 'ct')}
    AND o.start >= {from:DateTime}
    AND o.start < {to:DateTime}
    AND ifNull(o.amount, 0) > 0
  GROUP BY city
  HAVING city != ''
  ORDER BY city
  FORMAT JSONEachRow`;
}

function filterOptionSelect(filter, valueExpression, whereSql) {
  return `SELECT
    '${filter}' AS filter,
    ${valueExpression} AS value
  FROM mg_orders AS o
  LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
  ${actualOrderJoinsSql('o', { clientAlias: 'c', contractorAlias: 'ct' })}
  LEFT JOIN mg_professions AS p ON o.spec = p.spec
  WHERE ${whereSql}
  GROUP BY value
  HAVING value != ''`;
}

function jobStatusFilterOptionSelect(whereSql) {
  return `SELECT
    'jobStatus' AS filter,
    ifNull(j.status, '') AS value
  FROM mg_orders AS o
  INNER JOIN mg_jobs AS j ON j.source = o._id
  LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
  ${actualOrderJoinsSql('o', { clientAlias: 'c', contractorAlias: 'ct' })}
  LEFT JOIN mg_professions AS p ON o.spec = p.spec
  WHERE ${whereSql}
    AND ifNull(j.deleted, 0) = 0
  GROUP BY value
  HAVING value != ''`;
}

function filterOptionsQuery(whereSql) {
  return `${[
    filterOptionSelect('client', "ifNull(c.title, '')", whereSql),
    filterOptionSelect('profession', "if(ifNull(p.caption, '') = '', o.spec, p.caption)", whereSql),
    filterOptionSelect('orderType', "ifNull(o.type, '')", whereSql),
    jobStatusFilterOptionSelect(whereSql),
    filterOptionSelect('contractor', "ifNull(ct.legal_name, '')", whereSql)
  ].join('\n  UNION ALL\n  ')}
  ORDER BY filter, value
  FORMAT JSONEachRow`;
}

function cityCoordinatesQuery(whereSql) {
  return `SELECT
    w._id AS workplace_id
  FROM mg_orders AS o
  LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
  ${actualOrderJoinsSql('o', { clientAlias: 'c', contractorAlias: 'ct' })}
  LEFT JOIN mg_professions AS p ON o.spec = p.spec
  WHERE ${whereSql}
    AND length(w.location__coordinates) >= 2
    AND w.location__coordinates[1] BETWEEN -180 AND 180
    AND w.location__coordinates[2] BETWEEN -90 AND 90
  LIMIT 1
  FORMAT JSONEachRow`;
}

function demandCityWorkplacesCtes(sourceName = 'filtered_orders') {
  return `raw_city_workplaces AS (
    SELECT DISTINCT
      workplace_coordinates AS workplace_coordinates
    FROM ${sourceName}
    WHERE length(workplace_coordinates) >= 2
      AND workplace_coordinates[1] BETWEEN -180 AND 180
      AND workplace_coordinates[2] BETWEEN -90 AND 90
  ),
  city_coordinate_bounds AS (
    SELECT
      count() AS raw_points,
      quantileExact(0.01)(workplace_coordinates[1]) AS min_lon,
      quantileExact(0.99)(workplace_coordinates[1]) AS max_lon,
      quantileExact(0.01)(workplace_coordinates[2]) AS min_lat,
      quantileExact(0.99)(workplace_coordinates[2]) AS max_lat
    FROM raw_city_workplaces
  ),
  city_workplaces AS (
    SELECT
      raw.workplace_coordinates AS workplace_coordinates
    FROM raw_city_workplaces AS raw
    CROSS JOIN city_coordinate_bounds AS coordinate_bounds
    WHERE coordinate_bounds.raw_points < 100
      OR (
        raw.workplace_coordinates[1] BETWEEN coordinate_bounds.min_lon AND coordinate_bounds.max_lon
        AND raw.workplace_coordinates[2] BETWEEN coordinate_bounds.min_lat AND coordinate_bounds.max_lat
      )
  )`;
}

function cityBoundsCte() {
  return `city_bounds AS (
    SELECT
      bounds_base.robust_points AS robust_points,
      bounds_base.min_lon AS min_lon,
      bounds_base.max_lon AS max_lon,
      bounds_base.min_lat AS min_lat,
      bounds_base.max_lat AS max_lat,
      15000 / 111000 AS lat_margin,
      15000 / (111320 * greatest(abs(cos(((bounds_base.min_lat + bounds_base.max_lat) / 2) * pi() / 180)), 0.2)) AS lon_margin
    FROM (
      SELECT
        count() AS robust_points,
        min(workplace_coordinates[1]) AS min_lon,
        max(workplace_coordinates[1]) AS max_lon,
        min(workplace_coordinates[2]) AS min_lat,
        max(workplace_coordinates[2]) AS max_lat
      FROM city_workplaces
    ) AS bounds_base
  )`;
}

function candidateWorkersCte() {
  return `candidate_workers AS (
    SELECT
      worker.user AS user_id,
      worker.status AS status,
      worker.location__coordinates AS location__coordinates
    FROM mg_workers AS worker
    CROSS JOIN city_bounds AS bounds
    WHERE bounds.robust_points > 0
      AND ifNull(worker.user, '') != ''
      AND length(worker.location__coordinates) >= 2
      AND worker.location__coordinates[1] BETWEEN bounds.min_lon - bounds.lon_margin AND bounds.max_lon + bounds.lon_margin
      AND worker.location__coordinates[2] BETWEEN bounds.min_lat - bounds.lat_margin AND bounds.max_lat + bounds.lat_margin
  )`;
}

function locatedUsersCte() {
  return `located_users AS (
    SELECT
      worker.user_id AS user_id,
      max(ifNull(worker.status, '') IN ('ready', 'booked', 'worked')) AS is_ready_base,
      max(ifNull(worker.status, '') = 'ready') AS is_ready_status,
      max(ifNull(worker.status, '') = 'booked') AS is_booked_status,
      max(ifNull(worker.status, '') = 'worked') AS is_worked_status
    FROM candidate_workers AS worker
    CROSS JOIN city_workplaces AS cw
    WHERE worker.location__coordinates[1] BETWEEN cw.workplace_coordinates[1] - (15000 / (111320 * greatest(abs(cos(cw.workplace_coordinates[2] * pi() / 180)), 0.2)))
      AND cw.workplace_coordinates[1] + (15000 / (111320 * greatest(abs(cos(cw.workplace_coordinates[2] * pi() / 180)), 0.2)))
      AND worker.location__coordinates[2] BETWEEN cw.workplace_coordinates[2] - (15000 / 111000)
      AND cw.workplace_coordinates[2] + (15000 / 111000)
      AND greatCircleDistance(
        cw.workplace_coordinates[1],
        cw.workplace_coordinates[2],
        worker.location__coordinates[1],
        worker.location__coordinates[2]
      ) <= 15000
    GROUP BY user_id
  )`;
}

function filteredOrdersCte(whereSql, name = 'filtered_orders') {
  return `${name} AS (
    SELECT
      o._id AS order_id,
      o.workplace AS workplace_id,
      toString(toDate(o.start)) AS period,
      ifNull(o.amount, 0) AS amount,
      ifNull(o.salary_per_hour, 0) AS salary_per_hour,
      ifNull(c.title, '') AS brand,
      o.pieceworks AS pieceworks,
      if(ifNull(p.caption, '') = '', o.spec, p.caption) AS profession,
      w.location__coordinates AS workplace_coordinates,
      ifNull(o.deleted, 0) = 0 AS is_active_request
    FROM mg_orders AS o
    LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
    ${actualOrderJoinsSql('o', { clientAlias: 'c', contractorAlias: 'ct' })}
    LEFT JOIN mg_professions AS p ON o.spec = p.spec
    WHERE ${whereSql}
  )`;
}

function appActiveUsersCte() {
  return `app_active_users AS (
    SELECT DISTINCT ifNull(s.profile_id, '') AS user_id
    FROM appmetrica_sessions AS s
    INNER JOIN located_users AS located ON located.user_id = ifNull(s.profile_id, '')
    WHERE ifNull(s.profile_id, '') != ''
      AND parseDateTimeBestEffortOrNull(s.session_start_datetime) >= {from:DateTime}
      AND parseDateTimeBestEffortOrNull(s.session_start_datetime) < {to:DateTime}
  )`;
}

function app30dActiveUsersCte() {
  return `app_30d_active_users AS (
    SELECT DISTINCT
      located.user_id AS user_id,
      located.is_ready_status AS is_ready_status,
      located.is_booked_status AS is_booked_status,
      located.is_worked_status AS is_worked_status
    FROM appmetrica_sessions AS s
    INNER JOIN located_users AS located ON located.user_id = ifNull(s.profile_id, '')
    WHERE ifNull(s.profile_id, '') != ''
      AND parseDateTimeBestEffortOrNull(s.session_start_datetime) >= {active_30d_from:DateTime}
      AND parseDateTimeBestEffortOrNull(s.session_start_datetime) < {active_30d_to:DateTime}
  )`;
}

function bookedUsersCte() {
  return `booked_users AS (
    SELECT DISTINCT worker.user AS user_id
    FROM mg_job_history AS history
    INNER JOIN mg_jobs AS job ON history.job = job._id
    INNER JOIN filtered_orders AS fo ON job.source = fo.order_id
    INNER JOIN mg_workers AS worker ON history.worker = worker._id
    WHERE ifNull(history.status, '') = 'booked'
      AND ifNull(job.deleted, 0) = 0
      AND ifNull(worker.user, '') != ''
  )`;
}

function completedUsersCte() {
  return `completed_users AS (
    SELECT DISTINCT worker.user AS user_id
    FROM (
      SELECT
        job.worker AS worker,
        ${successfulConfirmedShiftFlagExpression('job', { pieceworkExpression: 'fo.pieceworks' })} AS is_successful_confirmed_shift
      FROM mg_jobs AS job
      INNER JOIN filtered_orders AS fo ON job.source = fo.order_id
      WHERE ifNull(job.deleted, 0) = 0
    ) AS job
    INNER JOIN mg_workers AS worker ON job.worker = worker._id
    WHERE job.is_successful_confirmed_shift = 1
      AND ifNull(worker.user, '') != ''
  )`;
}

function active30dOrdersCte(active30dWhereSql) {
  return `active_30d_orders AS (
    SELECT
      o._id AS order_id,
      toString(toDate(o.start)) AS period,
      w.location__coordinates AS workplace_coordinates,
      ifNull(o.deleted, 0) = 0 AS is_active_request
    FROM mg_orders AS o
    LEFT JOIN mg_workplaces AS w ON o.workplace = w._id
    ${actualOrderJoinsSql('o', { clientAlias: 'c', contractorAlias: 'ct' })}
    LEFT JOIN mg_professions AS p ON o.spec = p.spec
    WHERE ${active30dWhereSql}
  )`;
}

function daily30dRatioAggregationCtes() {
  return `daily_30d_active AS (
    SELECT
      toString(toDate(parseDateTimeBestEffortOrNull(s.session_start_datetime))) AS period,
      uniqExact(ifNull(s.profile_id, '')) AS active_users
    FROM appmetrica_sessions AS s
    INNER JOIN located_users AS located ON located.user_id = ifNull(s.profile_id, '')
    WHERE ifNull(s.profile_id, '') != ''
      AND parseDateTimeBestEffortOrNull(s.session_start_datetime) >= {active_30d_from:DateTime}
      AND parseDateTimeBestEffortOrNull(s.session_start_datetime) < {active_30d_to:DateTime}
    GROUP BY period
  ),
  daily_30d_requests AS (
    SELECT
      period,
      countDistinctIf(order_id, is_active_request) AS active_requests
    FROM active_30d_orders
    GROUP BY period
  ),
  daily_30d_ratio AS (
    SELECT avg(if(active_requests > 0, ifNull(active_users, 0) / active_requests, NULL)) AS avg_ratio
    FROM daily_30d_requests AS requests
    LEFT JOIN daily_30d_active AS active ON active.period = requests.period
    WHERE active_requests > 0
  )`;
}

function daily30dRatioCte(active30dWhereSql) {
  return `${active30dOrdersCte(active30dWhereSql)},
  ${daily30dRatioAggregationCtes()}`;
}

function summaryQuery(whereSql, active30dWhereSql) {
  return `WITH ${filteredOrdersCte(whereSql)},
  ${demandCityWorkplacesCtes()},
  ${cityBoundsCte()},
  ${candidateWorkersCte()},
  ${locatedUsersCte()},
  ${appActiveUsersCte()},
  ${app30dActiveUsersCte()},
  ${bookedUsersCte()},
  ${completedUsersCte()},
  ${daily30dRatioCte(active30dWhereSql)}
  SELECT
    (SELECT sum(amount) FROM filtered_orders) AS ordered_shifts,
    (SELECT countDistinctIf(order_id, is_active_request) FROM filtered_orders) AS active_order_requests,
    (SELECT uniqExact(user_id) FROM located_users) AS total_located_users,
    (SELECT uniqExactIf(located.user_id, located.is_ready_base) FROM located_users AS located) AS ready_located_users,
    (SELECT uniqExactIf(located.user_id, located.is_ready_status) FROM located_users AS located) AS ready_status_located_users,
    (SELECT uniqExactIf(located.user_id, located.is_booked_status) FROM located_users AS located) AS booked_status_located_users,
    (SELECT uniqExactIf(located.user_id, located.is_worked_status) FROM located_users AS located) AS worked_status_located_users,
    (SELECT uniqExact(user_id) FROM app_active_users) AS app_active_users,
    (SELECT uniqExact(user_id) FROM app_30d_active_users) AS app_30d_active_users,
    (SELECT uniqExactIf(user_id, is_ready_status) FROM app_30d_active_users) AS app_30d_ready_status_users,
    (SELECT uniqExactIf(user_id, is_booked_status) FROM app_30d_active_users) AS app_30d_booked_status_users,
    (SELECT uniqExactIf(user_id, is_worked_status) FROM app_30d_active_users) AS app_30d_worked_status_users,
    (SELECT uniqExact(user_id) FROM booked_users) AS booked_users,
    (SELECT uniqExact(user_id) FROM completed_users) AS completed_users,
    ifNull((SELECT avg_ratio FROM daily_30d_ratio), 0) AS avg_daily_30d_active_users_per_request
  FORMAT JSONEachRow`;
}

function summaryDemandQuery(whereSql) {
  return `WITH ${filteredOrdersCte(whereSql)}
  SELECT
    sum(amount) AS ordered_shifts,
    countDistinctIf(order_id, is_active_request) AS active_order_requests
  FROM filtered_orders
  FORMAT JSONEachRow`;
}

function summaryBaseQuery(whereSql) {
  return `WITH ${filteredOrdersCte(whereSql)},
  ${demandCityWorkplacesCtes()},
  ${cityBoundsCte()},
  ${candidateWorkersCte()},
  ${locatedUsersCte()}
  SELECT
    uniqExact(user_id) AS total_located_users,
    uniqExactIf(located.user_id, located.is_ready_base) AS ready_located_users,
    uniqExactIf(located.user_id, located.is_ready_status) AS ready_status_located_users,
    uniqExactIf(located.user_id, located.is_booked_status) AS booked_status_located_users,
    uniqExactIf(located.user_id, located.is_worked_status) AS worked_status_located_users
  FROM located_users AS located
  FORMAT JSONEachRow`;
}

function summaryAppQuery(whereSql) {
  return `WITH ${filteredOrdersCte(whereSql)},
  ${demandCityWorkplacesCtes()},
  ${cityBoundsCte()},
  ${candidateWorkersCte()},
  ${locatedUsersCte()},
  ${appActiveUsersCte()},
  ${app30dActiveUsersCte()}
  SELECT
    (SELECT uniqExact(user_id) FROM app_active_users) AS app_active_users,
    (SELECT uniqExact(user_id) FROM app_30d_active_users) AS app_30d_active_users,
    (SELECT uniqExactIf(user_id, is_ready_status) FROM app_30d_active_users) AS app_30d_ready_status_users,
    (SELECT uniqExactIf(user_id, is_booked_status) FROM app_30d_active_users) AS app_30d_booked_status_users,
    (SELECT uniqExactIf(user_id, is_worked_status) FROM app_30d_active_users) AS app_30d_worked_status_users
  FORMAT JSONEachRow`;
}

function summaryResponsesQuery(whereSql) {
  return `WITH ${filteredOrdersCte(whereSql)},
  ${bookedUsersCte()},
  ${completedUsersCte()}
  SELECT
    (SELECT uniqExact(user_id) FROM booked_users) AS booked_users,
    (SELECT uniqExact(user_id) FROM completed_users) AS completed_users
  FORMAT JSONEachRow`;
}

function summaryRatioQuery(active30dWhereSql) {
  return `WITH ${active30dOrdersCte(active30dWhereSql)},
  ${demandCityWorkplacesCtes('active_30d_orders')},
  ${cityBoundsCte()},
  ${candidateWorkersCte()},
  ${locatedUsersCte()},
  ${daily30dRatioAggregationCtes()}
  SELECT
    ifNull((SELECT avg_ratio FROM daily_30d_ratio), 0) AS avg_daily_30d_active_users_per_request
  FORMAT JSONEachRow`;
}

function compositionQuery(whereSql, dimensionExpression) {
  return `WITH ${filteredOrdersCte(whereSql)}
  SELECT
    ${dimensionExpression} AS label,
    sum(amount) AS ordered_shifts
  FROM filtered_orders
  GROUP BY label
  HAVING label != ''
  ORDER BY ordered_shifts DESC, label
  LIMIT 8
  FORMAT JSONEachRow`;
}

function rateBucketsQuery(whereSql) {
  return `WITH ${filteredOrdersCte(whereSql)}
  SELECT
    multiIf(
      salary_per_hour < 250, '0-250',
      salary_per_hour < 350, '250-350',
      salary_per_hour < 450, '350-450',
      '450+'
    ) AS label,
    sum(amount) AS ordered_shifts,
    avgIf(salary_per_hour, salary_per_hour > 0) AS avg_salary_per_hour
  FROM filtered_orders
  GROUP BY label
  ORDER BY label
  FORMAT JSONEachRow`;
}

function dynamicsQuery(whereSql) {
  return `WITH ${filteredOrdersCte(whereSql)},
  ${demandCityWorkplacesCtes()},
  ${cityBoundsCte()},
  ${candidateWorkersCte()},
  ${locatedUsersCte()},
  daily_orders AS (
    SELECT
      period,
      sum(amount) AS ordered_shifts,
      countDistinctIf(order_id, is_active_request) AS active_order_requests
    FROM filtered_orders
    GROUP BY period
  ),
  daily_app AS (
    SELECT
      toString(toDate(parseDateTimeBestEffortOrNull(s.session_start_datetime))) AS period,
      uniqExact(ifNull(s.profile_id, '')) AS app_active_users
    FROM appmetrica_sessions AS s
    INNER JOIN located_users AS located ON located.user_id = ifNull(s.profile_id, '')
    WHERE ifNull(s.profile_id, '') != ''
      AND parseDateTimeBestEffortOrNull(s.session_start_datetime) >= {from:DateTime}
      AND parseDateTimeBestEffortOrNull(s.session_start_datetime) < {to:DateTime}
    GROUP BY period
  ),
  daily_booked AS (
    SELECT
      fo.period AS period,
      uniqExact(worker.user) AS booked_users
    FROM mg_job_history AS history
    INNER JOIN mg_jobs AS job ON history.job = job._id
    INNER JOIN filtered_orders AS fo ON job.source = fo.order_id
    INNER JOIN mg_workers AS worker ON history.worker = worker._id
    WHERE ifNull(history.status, '') = 'booked'
      AND ifNull(job.deleted, 0) = 0
      AND ifNull(worker.user, '') != ''
    GROUP BY period
  ),
  daily_completed AS (
    SELECT
      job.period AS period,
      uniqExact(worker.user) AS completed_users
    FROM (
      SELECT
        fo.period AS period,
        job.worker AS worker,
        ${successfulConfirmedShiftFlagExpression('job', { pieceworkExpression: 'fo.pieceworks' })} AS is_successful_confirmed_shift
      FROM mg_jobs AS job
      INNER JOIN filtered_orders AS fo ON job.source = fo.order_id
      WHERE ifNull(job.deleted, 0) = 0
    ) AS job
    INNER JOIN mg_workers AS worker ON job.worker = worker._id
    WHERE job.is_successful_confirmed_shift = 1
      AND ifNull(worker.user, '') != ''
    GROUP BY period
  )
  SELECT
    orders.period AS period,
    orders.ordered_shifts AS ordered_shifts,
    ifNull(app.app_active_users, 0) AS app_active_users,
    ifNull(booked.booked_users, 0) AS booked_users,
    ifNull(completed.completed_users, 0) AS completed_users,
    if(orders.active_order_requests > 0, ifNull(app.app_active_users, 0) / orders.active_order_requests, 0) AS active_users_per_request
  FROM daily_orders AS orders
  LEFT JOIN daily_app AS app ON app.period = orders.period
  LEFT JOIN daily_booked AS booked ON booked.period = orders.period
  LEFT JOIN daily_completed AS completed ON completed.period = orders.period
  ORDER BY orders.period
  FORMAT JSONEachRow`;
}

const CITY_GIGER_METRICS = {
  'total-located-users': { label: 'Общая база', condition: '1 = 1' },
  'ready-located-users': { label: 'Активная база', condition: 'located.is_ready_base = 1' },
  'ready-status-located-users': { label: 'ready', condition: 'located.is_ready_status = 1' },
  'booked-status-located-users': { label: 'booked', condition: 'located.is_booked_status = 1' },
  'worked-status-located-users': { label: 'worked', condition: 'located.is_worked_status = 1' },
  'app-active-users': {
    label: 'Входили в приложение',
    condition: 'located.user_id IN (SELECT user_id FROM app_active_users)'
  },
  'app-30d-active-users': {
    label: 'Активная за 30 дней',
    condition: 'located.user_id IN (SELECT user_id FROM app_30d_active_users)'
  },
  'booked-users': {
    label: 'Откликались',
    condition: 'located.user_id IN (SELECT user_id FROM booked_users)'
  },
  'completed-users': {
    label: 'Завершали',
    condition: 'located.user_id IN (SELECT user_id FROM completed_users)'
  },
  'dynamic-app-active-users': {
    label: 'Входили в приложение',
    condition: 'located.user_id IN (SELECT user_id FROM app_active_users)',
    dynamic: true
  },
  'dynamic-booked-users': {
    label: 'Откликались',
    condition: 'located.user_id IN (SELECT user_id FROM booked_users)',
    dynamic: true
  },
  'dynamic-completed-users': {
    label: 'Завершали',
    condition: 'located.user_id IN (SELECT user_id FROM completed_users)',
    dynamic: true
  }
};
const CITY_GIGER_STATUSES = new Set(['ready', 'booked', 'worked']);

function httpError(status, message) {
  const error = new Error(message);

  error.status = status;
  return error;
}

function normalizeCityGigerDetailsInput(input = {}, now = new Date()) {
  const metric = firstGigerDetailsText(input.metric);
  const metricConfig = CITY_GIGER_METRICS[metric];

  if (!metricConfig) {
    throw httpError(400, `Unknown city giger metric: ${metric}`);
  }

  const filters = normalizeCityAnalysisFilters(input, now);

  if (filters.city === '') {
    throw httpError(400, 'city is required');
  }

  const page = normalizeGigerDetailsPage(input.page);
  const status = firstGigerDetailsText(input.status);
  const date = firstGigerDetailsText(input.date);

  if (metricConfig.dynamic && !parseDateOnly(date)) {
    throw httpError(400, 'date is required for dynamic city giger metric');
  }

  return {
    source: 'city-analysis',
    metric,
    metricLabel: metricConfig.label,
    city: filters.city,
    status: CITY_GIGER_STATUSES.has(status) ? status : '',
    date: metricConfig.dynamic ? date : '',
    page,
    pageSize: GIGER_DETAILS_PAGE_SIZE,
    offset: (page - 1) * GIGER_DETAILS_PAGE_SIZE,
    export: cleanGigerDetailsBooleanFlag(input.export),
    filters
  };
}

function cityGigerAppActiveUsersCte(input) {
  if (input.metric === 'dynamic-app-active-users') {
    return `app_active_users AS (
    SELECT DISTINCT ifNull(s.profile_id, '') AS user_id
    FROM appmetrica_sessions AS s
    INNER JOIN located_users AS located ON located.user_id = ifNull(s.profile_id, '')
    WHERE ifNull(s.profile_id, '') != ''
      AND toDate(parseDateTimeBestEffortOrNull(s.session_start_datetime)) = {metric_date:Date}
  )`;
  }

  return appActiveUsersCte();
}

function cityGigerBookedUsersCte(input) {
  const dateWhere = input.metric === 'dynamic-booked-users' ? '\n      AND fo.period = toString({metric_date:Date})' : '';

  return `booked_users AS (
    SELECT DISTINCT worker.user AS user_id
    FROM mg_job_history AS history
    INNER JOIN mg_jobs AS job ON history.job = job._id
    INNER JOIN filtered_orders AS fo ON job.source = fo.order_id
    INNER JOIN mg_workers AS worker ON history.worker = worker._id
    WHERE ifNull(history.status, '') = 'booked'
      AND ifNull(job.deleted, 0) = 0
      AND ifNull(worker.user, '') != ''${dateWhere}
  )`;
}

function cityGigerCompletedUsersCte(input) {
  const dateWhere = input.metric === 'dynamic-completed-users' ? '\n      AND job.period = toString({metric_date:Date})' : '';

  return `completed_users AS (
    SELECT DISTINCT worker.user AS user_id
    FROM (
      SELECT
        fo.period AS period,
        job.worker AS worker,
        ${successfulConfirmedShiftFlagExpression('job', { pieceworkExpression: 'fo.pieceworks' })} AS is_successful_confirmed_shift
      FROM mg_jobs AS job
      INNER JOIN filtered_orders AS fo ON job.source = fo.order_id
      WHERE ifNull(job.deleted, 0) = 0
    ) AS job
    INNER JOIN mg_workers AS worker ON job.worker = worker._id
    WHERE job.is_successful_confirmed_shift = 1
      AND ifNull(worker.user, '') != ''${dateWhere}
  )`;
}

function cityGigerProfilesCte() {
  return `latest_worker_profiles AS (
    SELECT
      worker.user AS user_id,
      argMax(worker._id, updated_at) AS worker_id,
      argMax(ifNull(worker.status, ''), updated_at) AS status,
      argMax(
        coalesce(
          nullIf(trim(concat(ifNull(u.lastname, ''), ' ', ifNull(u.firstname, ''), ' ', ifNull(u.middlename, ''))), ''),
          nullIf(trim(ifNull(worker.full_name, '')), ''),
          ''
        ),
        updated_at
      ) AS full_name,
      argMax(ifNull(u.phone, ''), updated_at) AS phone
    FROM (
      SELECT
        *,
        ifNull(updatedAt, ifNull(createdAt, toDateTime64('1970-01-01 00:00:00', 3, 'UTC'))) AS updated_at
      FROM mg_workers
    ) AS worker
    LEFT JOIN mg_users AS u ON worker.user = u._id
    WHERE ifNull(worker.user, '') != ''
      AND ifNull(worker.deleted, 0) = 0
    GROUP BY user_id
  )`;
}

function cityGigerDetailsStatusWhere(input) {
  return input.status === '' ? '' : '\n      AND profile.status = {status:String}';
}

function cityGigerDetailsCtes(input, whereSql) {
  const condition = CITY_GIGER_METRICS[input.metric].condition;

  return `${filteredOrdersCte(whereSql)},
  ${demandCityWorkplacesCtes()},
  ${cityBoundsCte()},
  ${candidateWorkersCte()},
  ${locatedUsersCte()},
  ${cityGigerAppActiveUsersCte(input)},
  ${app30dActiveUsersCte()},
  ${cityGigerBookedUsersCte(input)},
  ${cityGigerCompletedUsersCte(input)},
  ${cityGigerProfilesCte()},
  eligible_gigers AS (
    SELECT
      located.user_id AS user_id,
      ifNull(profile.worker_id, '') AS worker_id,
      ifNull(profile.full_name, '') AS full_name,
      ifNull(profile.phone, '') AS phone,
      ifNull(profile.status, '') AS status
    FROM located_users AS located
    LEFT JOIN latest_worker_profiles AS profile ON profile.user_id = located.user_id
    WHERE ${condition}${cityGigerDetailsStatusWhere(input)}
  )`;
}

function cityGigerDetailsLimitClause(input) {
  return input.export ? '' : '\n  LIMIT {limit:UInt64} OFFSET {offset:UInt64}';
}

function cityGigerDetailsTotalQuery(input, whereSql) {
  return `WITH ${cityGigerDetailsCtes(input, whereSql)}
  SELECT count() AS total_gigers
  FROM eligible_gigers
  FORMAT JSONEachRow`;
}

function cityGigerDetailsQuery(input, whereSql) {
  return `WITH ${cityGigerDetailsCtes(input, whereSql)}
  SELECT
    user_id,
    worker_id,
    full_name,
    phone,
    status
  FROM eligible_gigers
  ORDER BY full_name ASC, user_id ASC, worker_id ASC${cityGigerDetailsLimitClause(input)}
  FORMAT JSONEachRow`;
}

function cityGigerDetailsParams(input) {
  const { params } = paramsAndWhere(input.filters);
  const detailParams = {
    ...params,
    param_limit: input.pageSize,
    param_offset: input.offset
  };

  if (input.status !== '') {
    detailParams.param_status = input.status;
  }

  if (input.date !== '') {
    detailParams.param_metric_date = input.date;
  }

  return detailParams;
}

async function loadCityAnalysisGigerDetails(client, input = {}, now = new Date()) {
  const detailInput = normalizeCityGigerDetailsInput(input, now);
  const { whereSql } = paramsAndWhere(detailInput.filters);
  const params = cityGigerDetailsParams(detailInput);
  const totalRows = await client.queryJSONEachRow(
    cityGigerDetailsTotalQuery(detailInput, whereSql),
    params,
    'city analysis giger details total'
  );
  const gigerRows = await client.queryJSONEachRow(
    cityGigerDetailsQuery(detailInput, whereSql),
    params,
    'city analysis giger details'
  );

  return mergeGigerDetails(detailInput, totalRows, gigerRows);
}

function cityAnalysisEmptyDatasets(overrides = {}) {
  return {
    cityOptionRows: [],
    filterOptionRows: [],
    cityCoordinateRows: [],
    summaryRows: [],
    brandRows: [],
    professionRows: [],
    rateRows: [],
    dynamicRows: [],
    ...overrides
  };
}

function filterOptionsBaseFilters(filters) {
  return {
    ...filters,
    client: [],
    profession: [],
    orderType: [],
    jobStatus: [],
    contractor: [],
    salaryFrom: null,
    salaryTo: null,
    includeDeletedOrders: false,
    includeHiddenOrders: false
  };
}

async function loadCityOptionRows(client, filters, cache) {
  return readThroughValidatedCache(
    cache,
    cacheKeyForFilters('city-options', filters),
    () => client.queryJSONEachRow(cityOptionsQuery(), periodParams(filters), 'city analysis city options'),
    isValidCityOptionRows
  );
}

async function loadFilterOptionRows(client, filters, cache) {
  const optionFilters = filterOptionsBaseFilters(filters);
  const { params, whereSql } = paramsAndWhere(optionFilters);

  return readThroughValidatedCache(
    cache,
    cacheKeyForFilters('filter-options', optionFilters),
    () => client.queryJSONEachRow(filterOptionsQuery(whereSql), params, 'city analysis filter options'),
    isValidFilterOptionRows
  );
}

function markProgressiveDashboard(dashboard) {
  return {
    ...dashboard,
    context: {
      ...dashboard.context,
      isProgressive: true
    }
  };
}

async function loadCityAnalysisDashboardShell(client, input = {}, now = new Date(), options = {}) {
  const filters = normalizeCityAnalysisFilters(input, now);
  const cityOptionRows = await loadCityOptionRows(client, filters, options.cache);

  if (filters.city === '') {
    return markProgressiveDashboard(
      mergeCityAnalysisRows(filters, cityAnalysisEmptyDatasets({ cityOptionRows }))
    );
  }

  const filterOptionRows = await loadFilterOptionRows(client, filters, options.cache);

  return markProgressiveDashboard(
    mergeCityAnalysisRows(
      filters,
      cityAnalysisEmptyDatasets({
        cityOptionRows,
        filterOptionRows
      })
    )
  );
}

function assertCityAnalysisSection(section) {
  if (CITY_ANALYSIS_SECTIONS.has(section)) {
    return;
  }

  const error = new Error(`Unknown city analysis section: ${section}`);
  error.status = 400;
  throw error;
}

async function loadCityAnalysisDashboardSection(client, input = {}, section, now = new Date(), options = {}) {
  assertCityAnalysisSection(section);

  const filters = normalizeCityAnalysisFilters(input, now);

  if (filters.city === '') {
    return mergeCityAnalysisRows(filters, cityAnalysisEmptyDatasets());
  }

  const { params, whereSql, active30dWhereSql } = paramsAndWhere(filters);
  const cache = options.cache;

  if (section === 'summary-demand') {
    const summaryRows = await readThroughCache(cache, cacheKeyForFilters(section, filters), () =>
      client.queryJSONEachRow(summaryDemandQuery(whereSql), params, 'city analysis summary demand')
    );

    return mergeCityAnalysisRows(filters, cityAnalysisEmptyDatasets({ summaryRows }));
  }

  if (section === 'summary-base') {
    const [cityCoordinateRows, summaryRows] = await Promise.all([
      readThroughCache(cache, cacheKeyForFilters('city-coordinates', filters), () =>
        client.queryJSONEachRow(cityCoordinatesQuery(whereSql), params, 'city analysis city coordinates')
      ),
      readThroughCache(cache, cacheKeyForFilters(section, filters), () =>
        client.queryJSONEachRow(summaryBaseQuery(whereSql), params, 'city analysis summary base')
      )
    ]);

    return mergeCityAnalysisRows(filters, cityAnalysisEmptyDatasets({ cityCoordinateRows, summaryRows }));
  }

  if (section === 'summary-app') {
    const summaryRows = await readThroughCache(cache, cacheKeyForFilters(section, filters), () =>
      client.queryJSONEachRow(summaryAppQuery(whereSql), params, 'city analysis summary app')
    );

    return mergeCityAnalysisRows(filters, cityAnalysisEmptyDatasets({ summaryRows }));
  }

  if (section === 'summary-responses') {
    const summaryRows = await readThroughCache(cache, cacheKeyForFilters(section, filters), () =>
      client.queryJSONEachRow(summaryResponsesQuery(whereSql), params, 'city analysis summary responses')
    );

    return mergeCityAnalysisRows(filters, cityAnalysisEmptyDatasets({ summaryRows }));
  }

  if (section === 'summary-ratio') {
    const summaryRows = await readThroughCache(cache, cacheKeyForFilters(section, filters), () =>
      client.queryJSONEachRow(summaryRatioQuery(active30dWhereSql), params, 'city analysis summary ratio')
    );

    return mergeCityAnalysisRows(filters, cityAnalysisEmptyDatasets({ summaryRows }));
  }

  if (section === 'composition') {
    const rows = await readThroughCache(cache, cacheKeyForFilters(section, filters), async () => {
      const [brandRows, professionRows, rateRows] = await Promise.all([
        client.queryJSONEachRow(compositionQuery(whereSql, 'brand'), params, 'city analysis brands'),
        client.queryJSONEachRow(compositionQuery(whereSql, 'profession'), params, 'city analysis professions'),
        client.queryJSONEachRow(rateBucketsQuery(whereSql), params, 'city analysis rate buckets')
      ]);

      return { brandRows, professionRows, rateRows };
    });

    return mergeCityAnalysisRows(filters, cityAnalysisEmptyDatasets(rows));
  }

  const dynamicRows = await readThroughCache(cache, cacheKeyForFilters(section, filters), () =>
    client.queryJSONEachRow(dynamicsQuery(whereSql), params, 'city analysis dynamics')
  );

  return mergeCityAnalysisRows(filters, cityAnalysisEmptyDatasets({ dynamicRows }));
}

async function loadCityAnalysisDashboard(client, input = {}, now = new Date()) {
  const filters = normalizeCityAnalysisFilters(input, now);
  const cityOptionRows = await client.queryJSONEachRow(
    cityOptionsQuery(),
    periodParams(filters),
    'city analysis city options'
  );

  if (filters.city === '') {
    return mergeCityAnalysisRows(filters, {
      cityOptionRows,
      filterOptionRows: [],
      cityCoordinateRows: [],
      summaryRows: [],
      brandRows: [],
      professionRows: [],
      rateRows: [],
      dynamicRows: []
    });
  }

  const optionFilters = {
    ...filters,
    client: [],
    profession: [],
    orderType: [],
    jobStatus: [],
    contractor: [],
    salaryFrom: null,
    salaryTo: null,
    includeDeletedOrders: false,
    includeHiddenOrders: false
  };
  const { params: optionParams, whereSql: optionWhereSql } = paramsAndWhere(optionFilters);
  const { params, whereSql, active30dWhereSql } = paramsAndWhere(filters);
  const [
    filterOptionRows,
    cityCoordinateRows,
    summaryRows,
    brandRows,
    professionRows,
    rateRows,
    dynamicRowsResult
  ] = await Promise.all([
    client.queryJSONEachRow(filterOptionsQuery(optionWhereSql), optionParams, 'city analysis filter options'),
    client.queryJSONEachRow(cityCoordinatesQuery(whereSql), params, 'city analysis city coordinates'),
    client.queryJSONEachRow(summaryQuery(whereSql, active30dWhereSql), params, 'city analysis summary'),
    client.queryJSONEachRow(compositionQuery(whereSql, 'brand'), params, 'city analysis brands'),
    client.queryJSONEachRow(compositionQuery(whereSql, 'profession'), params, 'city analysis professions'),
    client.queryJSONEachRow(rateBucketsQuery(whereSql), params, 'city analysis rate buckets'),
    client.queryJSONEachRow(dynamicsQuery(whereSql), params, 'city analysis dynamics')
  ]);

  return mergeCityAnalysisRows(filters, {
    cityOptionRows,
    filterOptionRows,
    cityCoordinateRows,
    summaryRows,
    brandRows,
    professionRows,
    rateRows,
    dynamicRows: dynamicRowsResult
  });
}

module.exports = {
  CITY_ANALYSIS_SECTIONS,
  cityAnalysisCachePathFromEnv,
  createCityAnalysisCache,
  loadCityAnalysisGigerDetails,
  loadCityAnalysisDashboardSection,
  loadCityAnalysisDashboardShell,
  mergeCityAnalysisRows,
  normalizeCityGigerDetailsInput,
  normalizeCityAnalysisFilters,
  loadCityAnalysisDashboard
};
