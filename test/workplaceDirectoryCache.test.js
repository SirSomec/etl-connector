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

test('workplaceDirectoryCachePathFromEnv supports env override', () => {
  assert.equal(
    workplaceDirectoryCachePathFromEnv({ WORKPLACE_DIRECTORY_CACHE_PATH: 'C:\\cache\\workplaces.json' }),
    'C:\\cache\\workplaces.json'
  );
});
