const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createWorkplaceDirectoryCache,
  filterWorkplaceDirectorySuggestions,
  normalizeWorkplaceDirectoryRows,
  workplaceDirectoryCachePathFromEnv
} = require('../src/workplaceDirectoryCache');

async function tempCachePath() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workplace-directory-cache-'));

  return path.join(tempDir, 'cache.json');
}

function fakeClient(rows, calls) {
  return {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'workplace directory refresh') {
        return rows;
      }

      throw new Error(`Unexpected operation: ${operation}`);
    }
  };
}

test('filterWorkplaceDirectorySuggestions matches partial address, id, title, and technical name after 4 chars', () => {
  const entries = normalizeWorkplaceDirectoryRows([
    {
      workplace_id: 'wp-lenina-10',
      workplace_title: 'Северный хаб',
      technical_name: 'north-hub',
      client_title: 'Brand A',
      region: 'Москва',
      city: 'Москва',
      street: 'Ленина 10'
    },
    {
      workplace_id: 'wp-tverskaya',
      workplace_title: 'Южная точка',
      technical_name: 'south-point',
      client_title: 'Brand B',
      region: 'Москва',
      city: 'Москва',
      street: 'Тверская 1'
    }
  ]);

  assert.deepEqual(filterWorkplaceDirectorySuggestions(entries, 'Лени', 10), []);
  assert.deepEqual(filterWorkplaceDirectorySuggestions(entries, 'Ленин', 10).map((row) => row.workplaceId), ['wp-lenina-10']);
  assert.deepEqual(filterWorkplaceDirectorySuggestions(entries, 'lenina', 10).map((row) => row.workplaceId), ['wp-lenina-10']);
  assert.deepEqual(filterWorkplaceDirectorySuggestions(entries, 'северн', 10).map((row) => row.workplaceId), ['wp-lenina-10']);
  assert.deepEqual(filterWorkplaceDirectorySuggestions(entries, 'north', 10).map((row) => row.workplaceId), ['wp-lenina-10']);
});

test('workplace directory cache persists refreshed rows for 7 days and refreshes stale rows', async () => {
  const filePath = await tempCachePath();
  let timestamp = Date.parse('2026-06-03T10:00:00.000Z');
  const calls = [];
  const client = fakeClient(
    [
      {
        workplace_id: 'wp1',
        workplace_title: 'Северный хаб',
        technical_name: 'north',
        client_title: 'Brand A',
        region: 'Москва',
        city: 'Москва',
        street: 'Ленина 10'
      }
    ],
    calls
  );
  const cache = createWorkplaceDirectoryCache({
    filePath,
    now: () => timestamp
  });

  const first = await cache.suggest(client, 'Ленин', 5);
  assert.equal(first.length, 1);
  assert.equal(first[0].workplaceId, 'wp1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].operation, 'workplace directory refresh');

  const recreated = createWorkplaceDirectoryCache({
    filePath,
    now: () => timestamp + 6 * 24 * 60 * 60 * 1000
  });
  const second = await recreated.suggest(fakeClient([], calls), 'северн', 5);
  assert.equal(second.length, 1);
  assert.equal(second[0].workplaceId, 'wp1');
  assert.equal(calls.length, 1);

  timestamp += 8 * 24 * 60 * 60 * 1000;
  await cache.refreshIfStale(fakeClient(
    [
      {
        workplace_id: 'wp2',
        workplace_title: 'Обновленная точка',
        technical_name: 'updated',
        client_title: 'Brand B',
        region: 'Татарстан',
        city: 'Казань',
        street: 'Баумана 5'
      }
    ],
    calls
  ));
  const staleRefreshed = await cache.suggest(fakeClient([], calls), 'Бауман', 5);

  assert.equal(staleRefreshed.length, 1);
  assert.equal(staleRefreshed[0].workplaceId, 'wp2');
  assert.equal(calls.length, 2);
});

test('workplace directory cache returns a point by id from persisted entries', async () => {
  const filePath = await tempCachePath();
  const calls = [];
  const cache = createWorkplaceDirectoryCache({ filePath });

  await cache.refreshIfStale(fakeClient(
    [
      {
        workplace_id: 'wp1',
        workplace_title: 'Point 1',
        technical_name: 'point-technical',
        client_title: 'Brand A',
        region: 'Region',
        city: 'City',
        street: 'Street'
      }
    ],
    calls
  ));

  const recreated = createWorkplaceDirectoryCache({ filePath });
  const entry = await recreated.getById(fakeClient([], calls), 'wp1');

  assert.equal(entry.workplaceId, 'wp1');
  assert.equal(entry.title, 'Point 1');
  assert.equal(entry.clientTitle, 'Brand A');
  assert.equal(calls.length, 1);
});

test('workplace directory cache can read cached point metadata without source refresh', async () => {
  const filePath = await tempCachePath();
  const calls = [];
  const cache = createWorkplaceDirectoryCache({ filePath });

  await cache.refreshIfStale(fakeClient(
    [
      {
        workplace_id: 'wp1',
        workplace_title: 'Point 1',
        technical_name: 'point-technical',
        client_title: 'Brand A',
        region: 'Region',
        city: 'City',
        street: 'Street'
      }
    ],
    calls
  ));

  const recreated = createWorkplaceDirectoryCache({
    filePath,
    now: () => Date.parse('2026-08-10T10:00:00.000Z')
  });
  const entry = await recreated.getCachedById(fakeClient([], calls), 'wp1');
  const missing = await recreated.getCachedById(fakeClient([], calls), 'wp-missing');

  assert.equal(entry.workplaceId, 'wp1');
  assert.equal(entry.title, 'Point 1');
  assert.equal(missing, null);
  assert.equal(calls.length, 1);
});

test('disabled workplace directory cache loads suggestions and point metadata from source every time', async () => {
  const calls = [];
  const cache = createWorkplaceDirectoryCache({
    filePath: null,
    disabled: true
  });

  const first = await cache.suggest(fakeClient(
    [
      {
        workplace_id: 'wp1',
        workplace_title: 'Северный хаб',
        technical_name: 'north',
        client_title: 'Brand A',
        region: 'Москва',
        city: 'Москва',
        street: 'Ленина 10'
      }
    ],
    calls
  ), 'Ленин', 5);
  const second = await cache.suggest(fakeClient(
    [
      {
        workplace_id: 'wp2',
        workplace_title: 'Южный хаб',
        technical_name: 'south',
        client_title: 'Brand B',
        region: 'Москва',
        city: 'Москва',
        street: 'Ленина 20'
      }
    ],
    calls
  ), 'Ленин', 5);
  const entry = await cache.getById(fakeClient(
    [
      {
        workplace_id: 'wp3',
        workplace_title: 'Point 3',
        technical_name: 'point-3',
        client_title: 'Brand C',
        region: 'Region',
        city: 'City',
        street: 'Street'
      }
    ],
    calls
  ), 'wp3');

  assert.deepEqual(first.map((row) => row.workplaceId), ['wp1']);
  assert.deepEqual(second.map((row) => row.workplaceId), ['wp2']);
  assert.equal(entry.workplaceId, 'wp3');
  assert.equal(calls.length, 3);
  assert.equal(cache.scheduleRefresh({}).stop(), undefined);
});

test('workplace directory scheduled refresh does not run on the startup tick', async () => {
  const calls = [];
  const cache = createWorkplaceDirectoryCache({
    filePath: await tempCachePath()
  });
  const scheduled = cache.scheduleRefresh(fakeClient(
    [
      {
        workplace_id: 'wp1',
        workplace_title: 'Point 1'
      }
    ],
    calls
  ), { intervalMs: 1000 });

  try {
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(calls.length, 0);
  } finally {
    scheduled.stop();
  }
});

test('workplaceDirectoryCachePathFromEnv supports env override', () => {
  assert.equal(
    workplaceDirectoryCachePathFromEnv({ WORKPLACE_DIRECTORY_CACHE_PATH: 'C:\\cache\\workplaces.json' }),
    'C:\\cache\\workplaces.json'
  );
});
