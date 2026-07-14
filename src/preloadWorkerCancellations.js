const { successfulConfirmedShiftFlagExpression } = require('./successfulConfirmedShift');
const {
  actualOrderDomainCondition,
  actualOrderJoinsSql
} = require('./analyticsDomainSql');

function toDateTimeParam(dateOnly) {
  return `${dateOnly} 00:00:00`;
}

function workerFullNameExpression() {
  return `coalesce(
    nullIf(trim(concat(ifNull(u.lastname, ''), ' ', ifNull(u.firstname, ''), ' ', ifNull(u.middlename, ''))), ''),
    nullIf(trim(ifNull(w.full_name, '')), ''),
    j.worker
  )`;
}

function workerCancellationOrderJoinsSql() {
  return `INNER JOIN mg_orders AS o ON o._id = j.source
  ${actualOrderJoinsSql('o', { clientAlias: 'c', workplaceAlias: 'ow', contractorAlias: 'ct' })}
  LEFT JOIN mg_workers AS w ON j.worker = w._id
  LEFT JOIN mg_users AS u ON w.user = u._id`;
}

function activeWorkersCte() {
  return `active_workers AS (
    SELECT DISTINCT
      active_j.worker AS worker_id
    FROM mg_jobs AS active_j
    INNER JOIN mg_orders AS active_o ON active_o._id = active_j.source
    ${actualOrderJoinsSql('active_o', {
      clientAlias: 'active_c',
      workplaceAlias: 'active_ow',
      contractorAlias: 'active_ct'
    })}
    WHERE active_j.start >= {from:DateTime}
      AND active_j.start < {to:DateTime}
      AND ifNull(active_j.worker, '') != ''
      AND ifNull(active_j.deleted, 0) = 0
      AND ${actualOrderDomainCondition('active_o', 'active_c', 'active_ct')}
  )`;
}

function workerCancellationFactsQuery() {
  const activeWorkers = activeWorkersCte();
  const shiftFacts = `shift_facts AS (
    SELECT
      toString(toDate(j.start)) AS period_date,
      j._id AS job_id,
      j.worker AS worker_id,
      ifNull(w.user, '') AS user_id,
      ${workerFullNameExpression()} AS full_name,
      ifNull(u.phone, '') AS phone,
      ifNull(w.full_address__city, '') AS city,
      ifNull(c.title, '') AS client,
      ifNull(ow.address__city, '') AS order_city,
      coalesce(
        nullIf(arrayStringConcat(arrayFilter(x -> x != '', [
          ifNull(ow.address__city, ''),
          ifNull(ow.address__street, ''),
          ifNull(ow.address__house, '')
        ]), ', '), ''),
        nullIf(trim(ifNull(ow.title, '')), ''),
        ifNull(o.workplace, ''),
        ''
      ) AS address,
      j.start AS planned_start,
      ifNull(j.status, '') AS status,
      ${successfulConfirmedShiftFlagExpression('j', { pieceworkExpression: 'o.pieceworks' })} AS is_successful_confirmed_shift
    FROM mg_jobs AS j
    INNER JOIN active_workers AS aw ON j.worker = aw.worker_id
    ${workerCancellationOrderJoinsSql()}
    WHERE j.start >= {from:DateTime}
      AND j.start < {to:DateTime}
      AND ifNull(j.deleted, 0) = 0
      AND ${actualOrderDomainCondition('o', 'c', 'ct')}
  ),
  cancelled_shift_facts AS (
    SELECT job_id, planned_start
    FROM shift_facts
    WHERE status = 'cancelled'
  ),
  cancellation_events AS (
    SELECT
      h.job AS job_id,
      h.initiator = 'worker' AS is_worker_event,
      coalesce(h.createdAt, h.updatedAt) AS event_at,
      csf.planned_start AS planned_start
    FROM mg_job_history AS h
    INNER JOIN cancelled_shift_facts AS csf ON h.job = csf.job_id
    WHERE h.status = 'cancelled'
  ),
  cancellation_flags AS (
    SELECT
      job_id,
      max(if(is_worker_event, 1, 0)) AS is_worker_cancelled,
      max(if(
        is_worker_event
          AND event_at >= planned_start - INTERVAL 24 HOUR
          AND event_at < planned_start,
        1,
        0
      )) AS is_worker_cancelled_24h,
      max(if(event_at >= planned_start, 1, 0)) AS is_post_start_cancelled
    FROM cancellation_events
    GROUP BY job_id
  ),
  booking_events AS (
    SELECT
      h.job AS job_id,
      min(coalesce(h.createdAt, h.updatedAt)) AS booked_at
    FROM mg_job_history AS h
    INNER JOIN shift_facts AS sf ON h.job = sf.job_id
    WHERE h.status = 'booked'
    GROUP BY h.job
  ),
  cancel_events AS (
    SELECT
      h.job AS job_id,
      max(coalesce(h.createdAt, h.updatedAt)) AS cancelled_at,
      argMax(ifNull(h.initiator, ''), coalesce(h.createdAt, h.updatedAt)) AS cancelled_by
    FROM mg_job_history AS h
    INNER JOIN shift_facts AS sf ON h.job = sf.job_id
    WHERE h.status = 'cancelled'
    GROUP BY h.job
  )`;

  return `WITH ${activeWorkers},
  ${shiftFacts}
SELECT
  sf.period_date,
  sf.job_id,
  sf.worker_id,
  sf.user_id,
  sf.full_name,
  sf.phone,
  sf.city,
  sf.client,
  sf.order_city,
  sf.address,
  sf.planned_start,
  sf.status,
  sf.is_successful_confirmed_shift,
  ifNull(cf.is_worker_cancelled, 0) AS is_worker_cancelled,
  ifNull(cf.is_worker_cancelled_24h, 0) AS is_worker_cancelled_24h,
  ifNull(cf.is_post_start_cancelled, 0) AS is_post_start_cancelled,
  be.booked_at,
  ce.cancelled_at,
  ce.cancelled_by
FROM shift_facts AS sf
LEFT JOIN cancellation_flags AS cf ON sf.job_id = cf.job_id
LEFT JOIN booking_events AS be ON sf.job_id = be.job_id
LEFT JOIN cancel_events AS ce ON sf.job_id = ce.job_id
SETTINGS
  join_algorithm = 'grace_hash',
  grace_hash_join_initial_buckets = 256
FORMAT JSONEachRow`;
}

function buildWorkerCancellationsPreloadQueries() {
  return {
    shiftFacts: workerCancellationFactsQuery()
  };
}

async function refreshWorkerCancellationsPreload({ client, store, fromDate, toDate }) {
  const params = {
    param_from: toDateTimeParam(fromDate),
    param_to: toDateTimeParam(toDate)
  };
  const queries = buildWorkerCancellationsPreloadQueries();
  const shiftFacts = await client.queryJSONEachRow(
    queries.shiftFacts,
    params,
    'worker cancellations preload shift facts'
  );

  store.replaceWorkerCancellationRange({ fromDate, toDate, shiftFacts });

  return { rowsWritten: shiftFacts.length };
}

module.exports = {
  buildWorkerCancellationsPreloadQueries,
  refreshWorkerCancellationsPreload
};
