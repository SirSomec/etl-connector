const test = require('node:test');
const assert = require('node:assert/strict');

const { createRequestReportJobStore } = require('../src/requestReportJobStore');

test('request report job store tracks progress and calculates ETA', () => {
  let currentTime = 1_000;
  const store = createRequestReportJobStore({
    now: () => currentTime,
    randomBytes: () => Buffer.from('00112233445566778899aabbccddeeff', 'hex')
  });

  const job = store.createJob();

  assert.match(job.id, /^request-report-/);
  assert.equal(store.getSnapshot(job.id).status, 'queued');
  assert.equal(store.getSnapshot(job.id).progress, 0);
  assert.equal(store.getSnapshot(job.id).estimatedRemainingMs, null);

  currentTime = 11_000;
  store.updateJob(job.id, {
    status: 'running',
    progress: 25,
    stage: 'Поиск confirmed-смен по ID ЛКК',
    detail: 'Батч 1 из 4'
  });

  const running = store.getSnapshot(job.id);

  assert.equal(running.status, 'running');
  assert.equal(running.progress, 25);
  assert.equal(running.stage, 'Поиск confirmed-смен по ID ЛКК');
  assert.equal(running.detail, 'Батч 1 из 4');
  assert.equal(running.estimatedRemainingMs, 30_000);

  store.completeJob(job.id, {
    html: '<section>Готово</section>',
    detail: 'Проверено 12 строк'
  });

  const done = store.getSnapshot(job.id);

  assert.equal(done.status, 'done');
  assert.equal(done.progress, 100);
  assert.equal(done.stage, 'Готово');
  assert.equal(done.detail, 'Проверено 12 строк');
  assert.equal(done.estimatedRemainingMs, 0);
  assert.equal(done.html, '<section>Готово</section>');
});

test('request report job store reports failure and prunes completed jobs by ttl', () => {
  let currentTime = 1_000;
  const store = createRequestReportJobStore({
    now: () => currentTime,
    ttlMs: 15 * 60 * 1000,
    randomBytes: () => Buffer.from('ffeeddccbbaa99887766554433221100', 'hex')
  });

  const job = store.createJob();

  store.failJob(job.id, 'Не удалось прочитать XLSX');

  const failed = store.getSnapshot(job.id);

  assert.equal(failed.status, 'failed');
  assert.equal(failed.progress, 100);
  assert.equal(failed.stage, 'Ошибка');
  assert.equal(failed.error, 'Не удалось прочитать XLSX');
  assert.equal(failed.estimatedRemainingMs, 0);

  currentTime += 14 * 60 * 1000;
  assert.equal(store.pruneExpired(), 0);
  assert.notEqual(store.getSnapshot(job.id), null);

  currentTime += 2 * 60 * 1000;
  assert.equal(store.pruneExpired(), 1);
  assert.equal(store.getSnapshot(job.id), null);
});

test('request report job store creates deterministic ids from random bytes', () => {
  const store = createRequestReportJobStore({
    randomBytes: () => Buffer.from('00112233445566778899aabbccddeeff', 'hex')
  });

  assert.equal(store.createJob().id, 'request-report-00112233445566778899aabbccddeeff');
});

test('request report job store clamps progress updates', () => {
  const store = createRequestReportJobStore();
  const job = store.createJob();

  store.updateJob(job.id, { progress: -10 });
  assert.equal(store.getSnapshot(job.id).progress, 0);

  store.updateJob(job.id, { progress: 150 });
  assert.equal(store.getSnapshot(job.id).progress, 100);
});

test('request report job store mutating methods return null for missing jobs', () => {
  const store = createRequestReportJobStore();

  assert.equal(store.updateJob('missing-job', { progress: 50 }), null);
  assert.equal(store.updateJob('missing-job'), null);
  assert.equal(store.completeJob('missing-job'), null);
  assert.equal(store.failJob('missing-job', 'Нет задачи'), null);
});

test('request report job store accepts empty update patches', () => {
  const store = createRequestReportJobStore();
  const job = store.createJob();

  const snapshot = store.updateJob(job.id);

  assert.equal(snapshot.status, 'queued');
  assert.equal(snapshot.progress, 0);
  assert.equal(snapshot.detail, '');
});

test('request report job store keeps non-terminal jobs when pruning expired entries', () => {
  let currentTime = 1_000;
  const store = createRequestReportJobStore({
    now: () => currentTime,
    ttlMs: 1_000
  });
  const job = store.createJob();

  store.updateJob(job.id, { status: 'running', progress: 50 });
  currentTime += 10_000;

  assert.equal(store.pruneExpired(), 0);
  assert.equal(store.getSnapshot(job.id).status, 'running');
});

test('request report job store preserves detail when patch omits it', () => {
  const store = createRequestReportJobStore();
  const job = store.createJob();

  store.updateJob(job.id, {
    status: 'running',
    progress: 25,
    detail: 'Батч 1 из 4'
  });
  store.updateJob(job.id, { progress: 50 });

  const snapshot = store.getSnapshot(job.id);

  assert.equal(snapshot.progress, 50);
  assert.equal(snapshot.detail, 'Батч 1 из 4');
});
