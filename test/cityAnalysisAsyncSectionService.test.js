const test = require('node:test');
const assert = require('node:assert/strict');

const { createCityAnalysisAsyncSectionService } = require('../src/cityAnalysisAsyncSectionService');

test('city analysis async sections run one expensive calculation at a time', async () => {
  const started = [];
  let releaseFirst;
  const first = new Promise((resolve) => { releaseFirst = resolve; });
  const service = createCityAnalysisAsyncSectionService({ logger: { warn() {} } });

  assert.equal(service.request('first', async () => {
    started.push('first');
    await first;
    return { id: 1 };
  }).state, 'loading');
  assert.equal(service.request('second', async () => {
    started.push('second');
    return { id: 2 };
  }).state, 'loading');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ['first']);

  releaseFirst();
  for (let attempt = 0; attempt < 20 && service.request('second', async () => ({ id: 2 })).state !== 'ready'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.deepEqual(started, ['first', 'second']);
  assert.deepEqual(service.request('first', async () => ({ id: 0 })), { state: 'ready', value: { id: 1 } });
});
