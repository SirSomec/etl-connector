const test = require('node:test');
const assert = require('node:assert/strict');
const { createRegionGigerExportJobStore } = require('../src/regionGigerExportJobStore');

test('stores export progress and only exposes a file to its owner', () => {
  let current = 100;
  const store = createRegionGigerExportJobStore({ now: () => current, randomUUID: () => 'test-id' });
  const job = store.createJob({ ownerId: 'user-1' });

  store.updateJob(job.jobId, { status: 'running', progress: 55, stage: 'Формируем строки' });
  assert.deepEqual(store.getSnapshot(job.jobId, 'user-2'), null);
  assert.equal(store.getSnapshot(job.jobId, 'user-1').progress, 55);

  store.completeJob(job.jobId, { downloadUrl: '/download', filePath: '/tmp/file.xls' });
  assert.equal(store.getSnapshot(job.jobId, 'user-1').downloadUrl, '/download');
  assert.equal(store.getFilePath(job.jobId, 'user-1'), '/tmp/file.xls');
  assert.equal(store.getFilePath(job.jobId, 'user-2'), '');

  current += 61 * 60 * 1000;
  store.pruneExpired();
  assert.equal(store.getSnapshot(job.jobId, 'user-1'), null);
});
