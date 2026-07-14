const { EXCLUDED_CLIENT_TITLES } = require('./analyticsDomainSql');

const LOOKUP_BATCH_SIZE = 2000;
const EXCLUDED_CLIENT_TITLES_SET = new Set(EXCLUDED_CLIENT_TITLES);

function toDateTimeParam(dateOnly) {
  return `${dateOnly} 00:00:00`;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatDateUTC(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function addDaysUTC(date, days) {
  const next = new Date(date.getTime());

  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function parseDateOnly(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function escapeClickHouseString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function serializeStringArray(values) {
  return `[${values.map((value) => `'${escapeClickHouseString(value)}'`).join(',')}]`;
}

function textValue(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function numberValue(value) {
  const number = Number(value || 0);

  return Number.isFinite(number) ? number : 0;
}

function dateTimeMs(value) {
  const text = textValue(value);

  if (text === '') {
    return Number.NaN;
  }

  return Date.parse(`${text.includes('T') ? text : text.replace(' ', 'T')}Z`);
}

function uniqueIds(rows, field) {
  return Array.from(new Set(
    rows.map((row) => textValue(row[field])).filter(Boolean)
  ));
}

function indexRows(rows, field) {
  return new Map(rows.map((row) => [textValue(row[field]), row]));
}

function chunk(values, size = LOOKUP_BATCH_SIZE) {
  const chunks = [];

  for (let offset = 0; offset < values.length; offset += size) {
    chunks.push(values.slice(offset, offset + size));
  }

  return chunks;
}

function formatFullName(user, worker, fallback) {
  const fullName = [user && user.lastname, user && user.firstname, user && user.middlename]
    .map(textValue)
    .filter(Boolean)
    .join(' ');

  return fullName || textValue(worker && worker.full_name) || fallback;
}

function workplaceAddress(workplace, fallback) {
  const address = [workplace && workplace.address__city, workplace && workplace.address__street, workplace && workplace.address__house]
    .map(textValue)
    .filter(Boolean)
    .join(', ');

  return address || textValue(workplace && workplace.title) || fallback;
}

function isActualOrder(order, client, contractor) {
  if (!order || numberValue(order.deleted) !== 0 || Number(order.is_hidden) === 1) {
    return false;
  }

  const clientTitle = textValue(client && client.title);

  if (clientTitle !== '' && EXCLUDED_CLIENT_TITLES_SET.has(clientTitle)) {
    return false;
  }

  const contractType = textValue(contractor && contractor.contract_type) || textValue(order.contract_type);

  return contractType !== 'processing';
}

function isSuccessfulConfirmedShift(job, order) {
  if (textValue(job.status) !== 'confirmed') {
    return false;
  }

  const pieceworks = textValue(order && order.pieceworks);
  const hasPieceworks = pieceworks !== '' && pieceworks !== '[]' && pieceworks !== '{}';
  const payment = numberValue(job.payment);

  if (hasPieceworks) {
    return payment > 0;
  }

  const startFact = dateTimeMs(job.start_fact);
  const finishFact = dateTimeMs(job.finish_fact);
  const hasPositiveFactInterval = Number.isFinite(startFact)
    && Number.isFinite(finishFact)
    && finishFact > startFact
    && finishFact - startFact >= 60 * 1000;

  return numberValue(job.hours) > 0
    || payment > 0
    || numberValue(job.salary_per_job) > 0
    || numberValue(job.salary_per_hour) * numberValue(job.hours) > 0
    || hasPositiveFactInterval;
}

function emptyHistory() {
  return {
    bookedAt: '',
    cancelledAt: '',
    cancelledBy: '',
    workerCancelled: 0,
    workerCancelled24h: 0,
    postStartCancelled: 0
  };
}

function historyByJob(historyRows, jobsById) {
  const result = new Map();

  for (const event of historyRows) {
    const jobId = textValue(event.job_id);
    const job = jobsById.get(jobId);

    if (!job) {
      continue;
    }

    if (!result.has(jobId)) {
      result.set(jobId, emptyHistory());
    }

    const history = result.get(jobId);
    const eventAt = textValue(event.event_at);
    const eventMs = dateTimeMs(eventAt);

    if (textValue(event.status) === 'booked' && eventAt !== '' && (history.bookedAt === '' || eventAt < history.bookedAt)) {
      history.bookedAt = eventAt;
    }

    if (textValue(event.status) !== 'cancelled') {
      continue;
    }

    if (eventAt !== '' && (history.cancelledAt === '' || eventAt > history.cancelledAt)) {
      history.cancelledAt = eventAt;
      history.cancelledBy = textValue(event.initiator);
    }

    if (textValue(job.status) !== 'cancelled' || !Number.isFinite(eventMs)) {
      continue;
    }

    const startMs = dateTimeMs(job.planned_start);

    if (textValue(event.initiator) === 'worker') {
      history.workerCancelled = 1;

      if (Number.isFinite(startMs) && eventMs >= startMs - 24 * 60 * 60 * 1000 && eventMs < startMs) {
        history.workerCancelled24h = 1;
      }
    }

    if (Number.isFinite(startMs) && eventMs >= startMs) {
      history.postStartCancelled = 1;
    }
  }

  return result;
}

function buildWorkerCancellationsPreloadQueries() {
  return {
    jobs: `SELECT
  j._id AS job_id,
  ifNull(j.source, '') AS order_id,
  j.worker AS worker_id,
  j.start AS planned_start,
  ifNull(j.status, '') AS status,
  j.hours,
  j.payment,
  j.salary_per_hour,
  j.salary_per_job,
  j.start_fact,
  j.finish_fact
FROM mg_jobs AS j
PREWHERE j.start >= {from:DateTime}
  AND j.start < {to:DateTime}
WHERE ifNull(j.worker, '') != ''
  AND ifNull(j.deleted, 0) = 0
FORMAT JSONEachRow`,
    orders: `SELECT
  o._id AS order_id,
  ifNull(o.client, '') AS client_id,
  ifNull(o.workplace, '') AS workplace_id,
  o.pieceworks,
  ifNull(o.contract_type, '') AS contract_type,
  ifNull(o.deleted, 0) AS deleted,
  ifNull(o.is_hidden, 0) AS is_hidden
FROM mg_orders AS o
WHERE o._id IN {ids:Array(String)}
FORMAT JSONEachRow`,
    clients: `SELECT _id AS client_id, ifNull(title, '') AS title
FROM mg_clients
WHERE _id IN {ids:Array(String)}
FORMAT JSONEachRow`,
    workplaces: `SELECT
  _id AS workplace_id,
  ifNull(contractor, '') AS contractor_id,
  ifNull(title, '') AS title,
  ifNull(address__city, '') AS address__city,
  ifNull(address__street, '') AS address__street,
  ifNull(address__house, '') AS address__house
FROM mg_workplaces
WHERE _id IN {ids:Array(String)}
FORMAT JSONEachRow`,
    contractors: `SELECT _id AS contractor_id, ifNull(contract_type, '') AS contract_type
FROM mg_contractors
WHERE _id IN {ids:Array(String)}
FORMAT JSONEachRow`,
    workers: `SELECT
  _id AS worker_id,
  ifNull(user, '') AS user_id,
  ifNull(full_name, '') AS full_name,
  ifNull(full_address__city, '') AS city
FROM mg_workers
WHERE _id IN {ids:Array(String)}
FORMAT JSONEachRow`,
    users: `SELECT
  _id AS user_id,
  ifNull(firstname, '') AS firstname,
  ifNull(lastname, '') AS lastname,
  ifNull(middlename, '') AS middlename,
  ifNull(phone, '') AS phone
FROM mg_users
WHERE _id IN {ids:Array(String)}
FORMAT JSONEachRow`,
    history: `SELECT
  h.job AS job_id,
  ifNull(h.status, '') AS status,
  ifNull(h.initiator, '') AS initiator,
  coalesce(h.createdAt, h.updatedAt) AS event_at
FROM mg_job_history AS h
PREWHERE h.job IN {ids:Array(String)}
WHERE h.status IN ('booked', 'cancelled')
FORMAT JSONEachRow`
  };
}

async function loadByIds(client, query, ids, operation) {
  const rows = [];

  for (const idsChunk of chunk(ids)) {
    const batchRows = await client.queryJSONEachRow(
      query,
      { param_ids: serializeStringArray(idsChunk) },
      operation
    );
    rows.push(...batchRows);
  }

  return rows;
}

async function loadDayFacts(client, queries, fromDate, toDate) {
  const jobs = await client.queryJSONEachRow(
    queries.jobs,
    { param_from: toDateTimeParam(fromDate), param_to: toDateTimeParam(toDate) },
    'worker cancellations preload jobs'
  );
  const orders = await loadByIds(client, queries.orders, uniqueIds(jobs, 'order_id'), 'worker cancellations preload orders');
  const ordersById = indexRows(orders, 'order_id');
  const clients = await loadByIds(client, queries.clients, uniqueIds(orders, 'client_id'), 'worker cancellations preload clients');
  const workplaces = await loadByIds(client, queries.workplaces, uniqueIds(orders, 'workplace_id'), 'worker cancellations preload workplaces');
  const workers = await loadByIds(client, queries.workers, uniqueIds(jobs, 'worker_id'), 'worker cancellations preload workers');
  const clientsById = indexRows(clients, 'client_id');
  const workplacesById = indexRows(workplaces, 'workplace_id');
  const contractors = await loadByIds(client, queries.contractors, uniqueIds(workplaces, 'contractor_id'), 'worker cancellations preload contractors');
  const workersById = indexRows(workers, 'worker_id');
  const users = await loadByIds(client, queries.users, uniqueIds(workers, 'user_id'), 'worker cancellations preload users');
  const usersById = indexRows(users, 'user_id');
  const contractorsById = indexRows(contractors, 'contractor_id');
  const actualJobs = jobs.filter((job) => {
    const order = ordersById.get(textValue(job.order_id));
    const workplace = order && workplacesById.get(textValue(order.workplace_id));

    return isActualOrder(order, clientsById.get(textValue(order && order.client_id)), contractorsById.get(textValue(workplace && workplace.contractor_id)));
  });
  const historyRows = await loadByIds(client, queries.history, uniqueIds(actualJobs, 'job_id'), 'worker cancellations preload history');
  const actualJobsById = indexRows(actualJobs, 'job_id');
  const history = historyByJob(historyRows, actualJobsById);

  return actualJobs.map((job) => {
    const order = ordersById.get(textValue(job.order_id));
    const worker = workersById.get(textValue(job.worker_id));
    const user = usersById.get(textValue(worker && worker.user_id));
    const workplace = workplacesById.get(textValue(order.workplace_id));
    const jobHistory = history.get(textValue(job.job_id)) || emptyHistory();

    return {
      period_date: fromDate,
      job_id: job.job_id,
      worker_id: job.worker_id,
      user_id: textValue(worker && worker.user_id),
      full_name: formatFullName(user, worker, textValue(job.worker_id)),
      phone: textValue(user && user.phone),
      city: textValue(worker && worker.city),
      client: textValue(clientsById.get(textValue(order.client_id)) && clientsById.get(textValue(order.client_id)).title),
      order_city: textValue(workplace && workplace.address__city),
      address: workplaceAddress(workplace, textValue(order.workplace_id)),
      planned_start: job.planned_start,
      status: job.status,
      is_successful_confirmed_shift: isSuccessfulConfirmedShift(job, order) ? 1 : 0,
      is_worker_cancelled: jobHistory.workerCancelled,
      is_worker_cancelled_24h: jobHistory.workerCancelled24h,
      is_post_start_cancelled: jobHistory.postStartCancelled,
      booked_at: jobHistory.bookedAt,
      cancelled_at: jobHistory.cancelledAt,
      cancelled_by: jobHistory.cancelledBy
    };
  });
}

async function refreshWorkerCancellationsPreload({ client, store, fromDate, toDate }) {
  const queries = buildWorkerCancellationsPreloadQueries();
  let rowsWritten = 0;

  for (let date = parseDateOnly(fromDate); formatDateUTC(date) < toDate; date = addDaysUTC(date, 1)) {
    const dayFrom = formatDateUTC(date);
    const dayTo = formatDateUTC(addDaysUTC(date, 1));
    const shiftFacts = await loadDayFacts(client, queries, dayFrom, dayTo);

    store.replaceWorkerCancellationRange({ fromDate: dayFrom, toDate: dayTo, shiftFacts });
    rowsWritten += shiftFacts.length;
  }

  return { rowsWritten };
}

module.exports = {
  buildWorkerCancellationsPreloadQueries,
  refreshWorkerCancellationsPreload
};
