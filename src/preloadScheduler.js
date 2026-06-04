const { SALES_PRELOAD_JOB_ID } = require('./preloadStore');

const MOSCOW_UTC_OFFSET_HOURS = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

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
  const toDate = formatDateUTC(addDaysUTC(today, 1));
  const fromDate = formatDateUTC(addDaysUTC(today, -Math.max(1, Number(job.refreshDays) || 45)));

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

function createPreloadScheduler({
  store,
  loaders,
  sanitizeError = (error) => error.message,
  now = () => new Date(),
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout
}) {
  const runningByJob = new Map();
  let timer = null;
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

        const result = await loader({ fromDate, toDate });
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

  function clearTimer() {
    if (timer) {
      clearTimeoutFn(timer);
      timer = null;
    }
  }

  function reschedule() {
    stopped = false;
    clearTimer();

    const job = store.getJob(SALES_PRELOAD_JOB_ID);

    if (!job || !job.enabled) {
      return;
    }

    timer = setTimeoutFn(async () => {
      timer = null;

      try {
        await runNow({
          jobId: SALES_PRELOAD_JOB_ID,
          trigger: 'schedule',
          ...scheduledRangeForJob(job, now())
        });
      } finally {
        if (!stopped) {
          reschedule();
        }
      }
    }, nextDelayForJob(job, now()));
  }

  function stop() {
    stopped = true;
    clearTimer();
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
