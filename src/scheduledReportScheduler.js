const MOSCOW_UTC_OFFSET_HOURS = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_RETRY_DELAY_MS = 3 * 60 * 1000;

function parseScheduleTime(scheduleTime) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(scheduleTime || '09:00'));

  if (!match) {
    return { hours: 9, minutes: 0 };
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return { hours: 9, minutes: 0 };
  }

  return { hours, minutes };
}

function nextDelayForSchedule(schedule, currentDate = new Date()) {
  const currentTime = currentDate.getTime();
  const { hours, minutes } = parseScheduleTime(schedule && schedule.scheduleTime);
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

function scheduleKey(scheduleId) {
  return String(scheduleId);
}

function shouldRetryGeneratedReport(result) {
  return Boolean(result && result.status === 'failed' && !result.filePath);
}

function createScheduledReportScheduler({
  store,
  runner,
  now = () => new Date(),
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout
} = {}) {
  const runningBySchedule = new Map();
  const timersBySchedule = new Map();
  let stopped = false;
  let timerGeneration = 0;

  async function runNow({ scheduleId, trigger = 'manual', userId = 'system' } = {}) {
    const key = scheduleKey(scheduleId);

    if (runningBySchedule.has(key)) {
      return { status: 'running', alreadyRunning: true };
    }

    const runPromise = Promise.resolve()
      .then(() => runner.runSchedule({ scheduleId, trigger, userId }))
      .finally(() => {
        runningBySchedule.delete(key);
      });

    runningBySchedule.set(key, runPromise);
    return runPromise;
  }

  function clearTimers() {
    for (const timer of timersBySchedule.values()) {
      clearTimeoutFn(timer);
    }
    timersBySchedule.clear();
  }

  function enabledSchedules() {
    const schedules = store.listEnabledSchedules();

    return (Array.isArray(schedules) ? schedules : [])
      .filter((schedule) => schedule && schedule.id !== undefined && schedule.enabled !== false);
  }

  function scheduleRunTimer(schedule, delay, generation) {
    const key = scheduleKey(schedule.id);
    let timer;

    timer = setTimeoutFn(() => {
      if (timersBySchedule.get(key) === timer) {
        timersBySchedule.delete(key);
      }

      if (stopped || generation !== timerGeneration) {
        return Promise.resolve();
      }

      return runNow({ scheduleId: schedule.id, trigger: 'schedule', userId: 'system' })
        .catch(() => ({ status: 'failed', filePath: '' }))
        .then((result) => {
          if (stopped || generation !== timerGeneration) {
            return;
          }

          if (shouldRetryGeneratedReport(result)) {
            scheduleRunTimer(schedule, retryDelayMs, generation);
            return;
          }

          reschedule();
        });
    }, delay);

    timersBySchedule.set(key, timer);
  }

  function reschedule() {
    stopped = false;
    clearTimers();
    timerGeneration += 1;
    const generation = timerGeneration;

    for (const schedule of enabledSchedules()) {
      scheduleRunTimer(schedule, nextDelayForSchedule(schedule, now()), generation);
    }
  }

  function stop() {
    stopped = true;
    timerGeneration += 1;
    clearTimers();
  }

  function drain() {
    return Promise.allSettled([...runningBySchedule.values()]);
  }

  return {
    drain,
    reschedule,
    runNow,
    stop
  };
}

module.exports = {
  createScheduledReportScheduler,
  nextDelayForSchedule,
  parseScheduleTime
};
