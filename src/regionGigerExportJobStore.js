const crypto = require('node:crypto');

const DEFAULT_TTL_MS = 60 * 60 * 1000;

function clampProgress(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function snapshot(job) {
  if (!job) return null;
  return { jobId: job.id, status: job.status, progress: clampProgress(job.progress), stage: job.stage, detail: job.detail, downloadUrl: job.downloadUrl, error: job.error };
}

function createRegionGigerExportJobStore({ now = () => Date.now(), ttlMs = DEFAULT_TTL_MS, randomUUID = crypto.randomUUID } = {}) {
  const jobs = new Map();
  function createJob({ ownerId = '' } = {}) {
    const current = now();
    const job = { id: `region-giger-export-${randomUUID()}`, ownerId: String(ownerId || ''), status: 'queued', progress: 0, stage: 'Ожидает запуска', detail: 'Запрос принят', downloadUrl: '', error: '', updatedAt: current };
    jobs.set(job.id, job);
    return snapshot(job);
  }
  function getJob(id) { return jobs.get(String(id || '')) || null; }
  function updateJob(id, patch = {}) {
    const job = getJob(id); if (!job) return null;
    job.status = String(patch.status || job.status);
    job.progress = clampProgress(typeof patch.progress === 'undefined' ? job.progress : patch.progress);
    job.stage = String(patch.stage || job.stage); job.detail = String(patch.detail || job.detail); job.updatedAt = now();
    return snapshot(job);
  }
  function completeJob(id, { downloadUrl, filePath, detail = 'Файл готов к скачиванию' } = {}) {
    const job = getJob(id); if (!job) return null;
    job.status = 'done'; job.progress = 100; job.stage = 'Готово'; job.detail = String(detail); job.downloadUrl = String(downloadUrl || ''); job.filePath = String(filePath || ''); job.error = ''; job.updatedAt = now();
    return snapshot(job);
  }
  function failJob(id, error) {
    const job = getJob(id); if (!job) return null;
    job.status = 'failed'; job.progress = 100; job.stage = 'Ошибка'; job.detail = String(error || 'Не удалось подготовить файл.'); job.error = job.detail; job.updatedAt = now();
    return snapshot(job);
  }
  function getSnapshot(id, ownerId = '') { const job = getJob(id); return !job || job.ownerId !== String(ownerId || '') ? null : snapshot(job); }
  function getFilePath(id, ownerId = '') { const job = getJob(id); return !job || job.ownerId !== String(ownerId || '') ? '' : job.filePath || ''; }
  function pruneExpired() { const current = now(); for (const [id, job] of jobs) if ((job.status === 'done' || job.status === 'failed') && current - job.updatedAt > ttlMs) jobs.delete(id); }
  return { createJob, updateJob, completeJob, failJob, getSnapshot, getFilePath, pruneExpired };
}

module.exports = { createRegionGigerExportJobStore };
