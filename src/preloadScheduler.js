const {
  SALES_PRELOAD_JOB_ID,
  WORKPLACE_POINT_PRELOAD_JOB_ID,
  WORKER_CANCELLATIONS_PRELOAD_JOB_ID
} = require('./preloadStore');

const MOSCOW_UTC_OFFSET_HOURS = 3;
const MIN_SCHEDULE_REFRESH_DAYS = 45;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_TRANSIENT_MAX_ATTEMPTS = 5;
const DEFAULT_TRANSIENT_RETRY_DELAY_MS = 3 * 60 * 1000;
const TRANSIENT_PRELOAD_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET'
]);
const TRANSIENT_PRELOAD_ERROR_PATTERNS = [
  /\bsocket hang up\b/i,
  /\bresponse aborted\b/i,
  /\bsocket closed\b/i
];

function formatDateUTC(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0')
  ].join('-');
}

function addDaysUTC(date, days) {
  const next = new Date(date.getTime());

  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function scheduledRangeForJob(job, now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const isWorkerCancellations = job.id === WORKER_CANCELLATIONS_PRELOAD_JOB_ID;
  const minRefreshDays = job.id === WORKPLACE_POINT_PRELOAD_JOB_ID ? 30 : isWorkerCancellations ? 60 : MIN_SCHEDULE_REFRESH_DAYS;
  const minFutureDays = isWorkerCancellations ? 0 : minRefreshDays;
  const pastDays = Math.max(
    minRefreshDays,
    Number(job.refreshPastDays ?? job.refreshDays) || minRefreshDays
  );
  const futureDays = Math.max(
    minFutureDays,
    Number(job.refreshFutureDays) || minFutureDays
  );
  const toDate = formatDateUTC(addDaysUTC(today, futureDays + 1));
  const fromDate = formatDateUTC(addDaysUTC(today, -pastDays));

  return { fromDate, toDate };
}

function parseScheduleTime(scheduleTime) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(scheduleTime || '03:00'));

  if (!match) {
    return { hours: 3, minutes: 0 };
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return { hours: 3, minutes: 0 };
  }

  return { hours, minutes };
}

function nextDelayForJob(job, currentDate) {
  const currentTime = currentDate.getTime();
  const { hours, minutes } = parseScheduleTime(job.scheduleTime);
  // First iteration supports the default Europe/Moscow timezone with a fixed UTC+3 offset only.
  const moscowNow = new Date(currentTime + MOSCOW_UTC_OFFSET_HOURS * 60 * 60 * 1000);
  let target = Date.UTC(
    moscowNow.getUTCFullYear(),
    moscowNow.getUTCMonth(),
    moscowNow.getUTCDate(),
    hours - MOSCOW_UTC_OFFSET_HOURS,
    minutes,
    0,
    0
  );

  if (target <= currentTime) {
    target += MS_PER_DAY;
  }

  return Math.max(0, target - currentTime);
}

function errorMessageFrom(error, sanitizeError) {
  try {
    const message = sanitizeError(error);

    return String(message || 'Unknown preload error');
  } catch (sanitizeFailure) {
    return String((error && error.message) || sanitizeFailure.message || 'Unknown preload error');
  }
}

function errorValuesFrom(error, depth = 0) {
  if (!error || depth > 3) {
    return [];
  }

  if (typeof error === 'string') {
    return [error];
  }

  const values = [];

  for (const key of ['code', 'name', 'message']) {
    if (error[key]) {
      values.push(String(error[key]));
    }
  }

  if (error.cause) {
    values.push(...errorValuesFrom(error.cause, depth + 1));
  }

  if (Array.isArray(error.errors)) {
    for (const nested of error.errors) {
      values.push(...errorValuesFrom(nested, depth + 1));
    }
  }

  return values;
}

function isTransientPreloadError(error) {
  return errorValuesFrom(error).some((value) => {
    const normalized = value.toUpperCase();

    return (
      TRANSIENT_PRELOAD_ERROR_CODES.has(normalized) ||
      TRANSIENT_PRELOAD_ERROR_PATTERNS.some((pattern) => pattern.test(value))
    );
  });
}

function normalizeTransientMaxAttempts(value) {
  if (value === undefined) {
    return DEFAULT_TRANSIENT_MAX_ATTEMPTS;
  }

  const attempts = Number(value);

  if (!Number.isInteger(attempts) || attempts < 1) {
    return DEFAULT_TRANSIENT_MAX_ATTEMPTS;
  }

  return attempts;
}

function normalizeTransientRetryDelayMs(value) {
  if (value === undefined) {
    return DEFAULT_TRANSIENT_RETRY_DELAY_MS;
  }

  const delayMs = Number(value);

  if (!Number.isFinite(delayMs) || delayMs < 0) {
    return DEFAULT_TRANSIENT_RETRY_DELAY_MS;
  }

  return delayMs;
}

async function runLoaderWithTransientRetries(
  loader,
  input,
  transientMaxAttempts,
  transientRetryDelayMs,
  retryDelayFn
) {
  let attempt = 1;

  while (true) {
    try {
      return await loader(input);
    } catch (error) {
      if (attempt >= transientMaxAttempts || !isTransientPreloadError(error)) {
        throw error;
      }

      attempt += 1;
      await retryDelayFn(transientRetryDelayMs);
    }
  }
}

function createPreloadScheduler({
  store,
  loaders,
  sanitizeError = (error) => error.message,
  now = () => new Date(),
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  transientRetryAttempts,
  transientMaxAttempts,
  transientRetryDelayMs = DEFAULT_TRANSIENT_RETRY_DELAY_MS,
  retryDelayFn = null
}) {
  const runningByJob = new Map();
  const timersByJob = new Map();
  const retryAttemptsAsMaxAttempts = transientRetryAttempts === undefined
    ? undefined
    : Number(transientRetryAttempts) + 1;
  const normalizedTransientMaxAttempts = normalizeTransientMaxAttempts(
    transientMaxAttempts === undefined ? retryAttemptsAsMaxAttempts : transientMaxAttempts
  );
  const normalizedTransientRetryDelayMs = normalizeTransientRetryDelayMs(transientRetryDelayMs);
  const actualRetryDelayFn = typeof retryDelayFn === 'function'
    ? retryDelayFn
    : (delayMs) => new Promise((resolve) => {
        setTimeoutFn(resolve, delayMs);
      });
  let stopped = false;

  async function runNow({ jobId, trigger, fromDate, toDate }) {
    if (runningByJob.has(jobId)) {
      return { status: 'running', alreadyRunning: true };
    }

    const runPromise = Promise.resolve().then(async () => {
      const run = store.startRun({ jobId, trigger, fromDate, toDate });

      try {
        const loader = loaders[jobId];

        if (typeof loader !== 'function') {
          throw new Error(`No preload loader registered for ${jobId}`);
        }

        const result = await runLoaderWithTransientRetries(
          loader,
          { fromDate, toDate },
          normalizedTransientMaxAttempts,
          normalizedTransientRetryDelayMs,
          actualRetryDelayFn
        );
        const rowsWritten = Number(result && result.rowsWritten) || 0;
        const finished = store.finishRun(run.id, { status: 'success', rowsWritten });

        return finished || { ...run, status: 'success', rowsWritten };
      } catch (error) {
        const errorMessage = errorMessageFrom(error, sanitizeError);
        const payload = { status: 'failed', errorMessage, rowsWritten: 0 };
        const finished = store.finishRun(run.id, payload);

        return finished || { ...run, ...payload };
      } finally {
        runningByJob.delete(jobId);
      }
    });

    runningByJob.set(jobId, runPromise);
    return runPromise;
  }

  function clearTimers() {
    for (const timer of timersByJob.values()) {
      clearTimeoutFn(timer);
    }
    timersByJob.clear();
  }

  function schedulableJobs() {
    if (typeof store.listJobs === 'function') {
      return store.listJobs();
    }

    const job = store.getJob(SALES_PRELOAD_JOB_ID);

    return job ? [job] : [];
  }

  function reschedule() {
    stopped = false;
    clearTimers();

    const jobs = schedulableJobs().filter((job) => job && job.enabled);

    if (jobs.length === 0) {
      return;
    }

    for (const job of jobs) {
      const timer = setTimeoutFn(async () => {
        timersByJob.delete(job.id);

        try {
          await runNow({
            jobId: job.id,
            trigger: 'schedule',
            ...scheduledRangeForJob(job, now())
          });
        } finally {
          if (!stopped) {
            reschedule();
          }
        }
      }, nextDelayForJob(job, now()));

      timersByJob.set(job.id, timer);
    }
  }

  function stop() {
    stopped = true;
    clearTimers();
  }

  function drain() {
    return Promise.allSettled([...runningByJob.values()]);
  }

  return {
    drain,
    runNow,
    reschedule,
    stop
  };
}

module.exports = {
  createPreloadScheduler,
  scheduledRangeForJob
};
