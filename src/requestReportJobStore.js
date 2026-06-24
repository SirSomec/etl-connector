const crypto = require('node:crypto');

const DEFAULT_TTL_MS = 15 * 60 * 1000;

function clampProgress(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(number)));
}

function calculateEta({ now, startedAt, progress, status }) {
  if (status === 'done' || status === 'failed') {
    return 0;
  }

  if (!startedAt || progress <= 0) {
    return null;
  }

  const elapsedMs = Math.max(0, now - startedAt);

  return Math.max(0, Math.round((elapsedMs * (100 - progress)) / progress));
}

function normalizeCounters(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return { ...value };
}

function snapshotJob(job, now) {
  if (!job) {
    return null;
  }

  const progress = clampProgress(job.progress);

  return {
    jobId: job.id,
    status: job.status,
    progress,
    stage: job.stage,
    detail: job.detail,
    estimatedRemainingMs: calculateEta({
      now,
      startedAt: job.startedAt,
      progress,
      status: job.status
    }),
    counters: job.counters ? { ...job.counters } : undefined,
    html: job.html,
    error: job.error
  };
}

function createRequestReportJobStore({
  now = () => Date.now(),
  ttlMs = DEFAULT_TTL_MS,
  randomBytes = crypto.randomBytes
} = {}) {
  const jobs = new Map();

  function createJob() {
    const current = now();
    const id = `request-report-${randomBytes(16).toString('hex')}`;
    const job = {
      id,
      status: 'queued',
      createdAt: current,
      updatedAt: current,
      startedAt: null,
      progress: 0,
      stage: 'Задача создана',
      detail: '',
      counters: undefined,
      html: undefined,
      error: undefined
    };

    jobs.set(id, job);

    return { id };
  }

  function getJob(id) {
    return jobs.get(String(id ?? '')) || null;
  }

  function updateJob(id, patch = {}) {
    const job = getJob(id);

    if (!job) {
      return null;
    }

    const current = now();

    if (!job.startedAt) {
      job.startedAt = job.createdAt;
    }

    job.status = patch.status ?? job.status;
    job.progress = clampProgress(patch.progress ?? job.progress);
    job.stage = String(patch.stage ?? job.stage ?? '');
    job.detail = String(patch.detail ?? job.detail ?? '');
    job.counters = normalizeCounters(patch.counters) || normalizeCounters(patch.counts) || job.counters;
    job.updatedAt = current;

    return snapshotJob(job, current);
  }

  function completeJob(id, { html = '', detail = '', counters, counts } = {}) {
    const job = getJob(id);

    if (!job) {
      return null;
    }

    const current = now();

    job.status = 'done';
    job.progress = 100;
    job.stage = 'Готово';
    job.detail = String(detail ?? '');
    job.html = String(html ?? '');
    job.counters = normalizeCounters(counters) || normalizeCounters(counts) || job.counters;
    job.error = undefined;
    job.updatedAt = current;

    return snapshotJob(job, current);
  }

  function failJob(id, error) {
    const job = getJob(id);

    if (!job) {
      return null;
    }

    const current = now();
    const message = String(error ?? 'Не удалось проверить отчет.');

    job.status = 'failed';
    job.progress = 100;
    job.stage = 'Ошибка';
    job.detail = message;
    job.error = message;
    job.updatedAt = current;

    return snapshotJob(job, current);
  }

  function getSnapshot(id) {
    return snapshotJob(getJob(id), now());
  }

  function pruneExpired() {
    const current = now();
    let removed = 0;

    for (const [id, job] of jobs.entries()) {
      const terminal = job.status === 'done' || job.status === 'failed';

      if (terminal && current - job.updatedAt > ttlMs) {
        jobs.delete(id);
        removed += 1;
      }
    }

    return removed;
  }

  return {
    createJob,
    updateJob,
    completeJob,
    failJob,
    getSnapshot,
    pruneExpired
  };
}

module.exports = {
  createRequestReportJobStore
};
