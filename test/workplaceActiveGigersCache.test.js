const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  ACTIVE_GIGERS_CACHE_TTL_MS,
  createWorkplaceActiveGigersCache
} = require('../src/workplaceActiveGigersCache');

function tempCachePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'active-gigers-cache-'));

  return path.join(dir, 'cache.json');
}

test('workplace active gigers cache returns fresh values and marks stale or missing ids', async () => {
  const filePath = tempCachePath();
  const now = new Date('2026-06-15T12:00:00.000Z');
  const cache = createWorkplaceActiveGigersCache({
    filePath,
    nowFn: () => now
  });

  await cache.writeValues(
    new Map([
      ['fresh', 11],
      ['stale', 7]
    ]),
    new Date(now.getTime() - ACTIVE_GIGERS_CACHE_TTL_MS - 1000)
  );
  await cache.writeValues(new Map([['fresh', 15]]), now);

  const result = await cache.readFresh(['fresh', 'stale', 'missing']);

  assert.deepEqual(result.values, new Map([['fresh', 15]]));
  assert.deepEqual(result.staleWorkplaceIds, ['stale', 'missing']);
});

test('workplace active gigers cache keeps existing values when adding recalculated points', async () => {
  const filePath = tempCachePath();
  const now = new Date('2026-06-15T12:00:00.000Z');
  const cache = createWorkplaceActiveGigersCache({
    filePath,
    nowFn: () => now
  });

  await cache.writeValues(new Map([['wp1', 3]]), now);
  await cache.writeValues(new Map([['wp2', 9]]), now);

  const result = await cache.readFresh(['wp1', 'wp2']);

  assert.deepEqual(result.values, new Map([
    ['wp1', 3],
    ['wp2', 9]
  ]));
  assert.deepEqual(result.staleWorkplaceIds, []);
});
