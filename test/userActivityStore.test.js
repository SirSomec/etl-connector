const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const {
  DEFAULT_USER_ACTIVITY_RETENTION_DAYS,
  createUserActivityStore,
  userActivityStorePathFromEnv
} = require('../src/userActivityStore');

async function withTempStore(callback, { now = () => new Date('2026-06-05T12:00:00.000Z') } = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'activity-store-'));
  const filePath = path.join(tempDir, 'activity.sqlite');
  let store;

  try {
    store = createUserActivityStore({
      filePath,
      now
    });
    await callback(store, filePath);
  } finally {
    if (store) {
      try {
        store.close();
      } catch {
        // The test may close the store itself before inspecting the file.
      }
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function readStoreSchema(filePath) {
  const db = new DatabaseSync(filePath);

  try {
    return {
      columns: db
        .prepare('PRAGMA table_info(user_activity_events)')
        .all()
        .map((row) => row.name),
      indexes: db
        .prepare('PRAGMA index_list(user_activity_events)')
        .all()
        .map((row) => row.name)
        .sort()
    };
  } finally {
    db.close();
  }
}

test('user activity store records events and builds overview levels', async () => {
  await withTempStore(async (store, filePath) => {
    store.recordEvent({
      userId: 'user-1',
      email: 'Analyst@Example.Test',
      role: 'analyst',
      eventType: 'login',
      method: 'POST',
      path: '/login',
      section: 'auth',
      occurredAt: '2026-06-03T09:00:00.000Z'
    });
    store.recordEvent({
      userId: 'user-1',
      email: 'analyst@example.test',
      role: 'analyst',
      eventType: 'page_view',
      method: 'GET',
      path: '/dashboards/sales-by-project',
      section: 'sales-by-project',
      occurredAt: '2026-06-03T09:01:00.000Z'
    });
    for (let index = 0; index < 5; index += 1) {
      store.recordEvent({
        userId: 'user-1',
        email: 'analyst@example.test',
        role: 'analyst',
        eventType: 'dashboard_filter',
        method: 'GET',
        path: '/dashboards/workplace-analysis',
        section: 'workplace-analysis',
        occurredAt: `2026-06-04T10:0${index}:00.000Z`
      });
    }
    store.recordEvent({
      userId: 'user-2',
      email: 'quiet@example.test',
      role: 'analyst',
      eventType: 'page_view',
      method: 'GET',
      path: '/',
      section: 'tables',
      occurredAt: '2026-05-20T08:00:00.000Z'
    });

    const overview = store.getActivityOverview({
      from: '2026-05-18',
      to: '2026-06-05',
      users: [
        { id: 'user-1', email: 'analyst@example.test', name: 'Analyst One', role: 'analyst', source: 'managed' },
        { id: 'user-2', email: 'quiet@example.test', name: '', role: 'analyst', source: 'managed' },
        { id: 'env-admin', email: 'admin@example.test', name: 'Администратор', role: 'admin', source: 'env' }
      ]
    });

    assert.match(filePath, /activity\.sqlite$/);
    assert.equal(overview.retentionDays, DEFAULT_USER_ACTIVITY_RETENTION_DAYS);
    assert.equal(overview.users.length, 3);
    assert.equal(overview.users[0].email, 'analyst@example.test');
    assert.equal(overview.users[0].name, 'Analyst One');
    assert.equal(overview.users[0].status, 'active');
    assert.equal(overview.users[0].activeDays30, 2);
    assert.equal(overview.users[0].activeDays90, 2);
    assert.equal(overview.users[0].days.find((day) => day.date === '2026-06-03').level, 'view');
    assert.equal(overview.users[0].days.find((day) => day.date === '2026-06-04').level, 'intense');
    assert.equal(overview.users[0].recentEvents[0].eventType, 'dashboard_filter');
    assert.equal(overview.users[1].status, 'rare');
    assert.equal(overview.users[2].status, 'new');

    store.close();
  });
});

test('user activity store prunes events older than retention window', async () => {
  let currentNow = new Date('2026-02-10T12:00:00.000Z');

  await withTempStore(async (store) => {
    store.recordEvent({
      userId: 'old-user',
      email: 'old@example.test',
      role: 'analyst',
      eventType: 'page_view',
      method: 'GET',
      path: '/',
      section: 'tables',
      occurredAt: '2026-02-01T10:00:00.000Z'
    });
    currentNow = new Date('2026-06-05T12:00:00.000Z');
    const removed = store.pruneOldEvents(90);

    assert.equal(removed, 1);

    store.recordEvent({
      userId: 'stale-other-user',
      email: 'stale@example.test',
      role: 'analyst',
      eventType: 'page_view',
      method: 'GET',
      path: '/',
      section: 'tables',
      occurredAt: '2026-02-02T10:00:00.000Z'
    });
    store.recordEvent({
      userId: 'fresh-user',
      email: 'fresh@example.test',
      role: 'analyst',
      eventType: 'page_view',
      method: 'GET',
      path: '/',
      section: 'tables',
      occurredAt: '2026-06-01T10:00:00.000Z'
    });

    const removedAfterRecord = store.pruneOldEvents(90);
    const overview = store.getActivityOverview({
      from: '2026-01-01',
      to: '2026-06-05',
      users: [
        { id: 'old-user', email: 'old@example.test', role: 'analyst' },
        { id: 'stale-other-user', email: 'stale@example.test', role: 'analyst' },
        { id: 'fresh-user', email: 'fresh@example.test', role: 'analyst' }
      ]
    });

    assert.equal(removedAfterRecord, 0);
    assert.equal(overview.users.find((user) => user.id === 'old-user').activeDays90, 0);
    assert.equal(overview.users.find((user) => user.id === 'stale-other-user').activeDays90, 0);
    assert.equal(overview.users.find((user) => user.id === 'fresh-user').activeDays90, 1);

    store.close();
  }, { now: () => currentNow });
});

test('user activity store does not retain backdated events older than retention window', async () => {
  await withTempStore(async (store) => {
    store.recordEvent({
      userId: 'backdated-user',
      email: 'backdated@example.test',
      role: 'analyst',
      eventType: 'page_view',
      method: 'GET',
      path: '/',
      section: 'tables',
      occurredAt: '2026-02-02T10:00:00.000Z'
    });

    const removed = store.pruneOldEvents(90);
    const overview = store.getActivityOverview({
      from: '2026-01-01',
      to: '2026-06-05',
      users: [
        { id: 'backdated-user', email: 'backdated@example.test', role: 'analyst' }
      ]
    });
    const user = overview.users.find((item) => item.id === 'backdated-user');

    assert.equal(removed, 0);
    assert.equal(user.status, 'new');
    assert.equal(user.activeDays30, 0);
    assert.equal(user.activeDays90, 0);
    assert.equal(user.recentEvents.length, 0);

    store.close();
  });
});

test('user activity overview ignores stale events from old requested dates', async () => {
  let currentNow = new Date('2026-01-02T12:00:00.000Z');

  await withTempStore(async (store) => {
    store.recordEvent({
      userId: 'stale-overview-user',
      email: 'stale-overview@example.test',
      role: 'analyst',
      eventType: 'page_view',
      method: 'GET',
      path: '/',
      section: 'tables',
      occurredAt: '2026-01-01T10:00:00.000Z'
    });
    currentNow = new Date('2026-06-05T12:00:00.000Z');

    const overview = store.getActivityOverview({
      from: '2026-01-01',
      to: '2026-06-05',
      users: [
        { id: 'stale-overview-user', email: 'stale-overview@example.test', role: 'analyst' }
      ]
    });
    const user = overview.users.find((item) => item.id === 'stale-overview-user');

    assert.equal(user.activeDays90, 0);
    assert.equal(user.status, 'new');
    assert.equal(user.lastEventAt, '');
    assert.equal(user.days.find((day) => day.date === '2026-01-01').level, 'none');

    store.close();
  }, { now: () => currentNow });
});

test('user activity store uses spec schema', async () => {
  await withTempStore(async (store, filePath) => {
    store.close();

    const schema = readStoreSchema(filePath);

    assert.deepEqual(schema.columns, [
      'id',
      'user_id',
      'email',
      'role',
      'event_type',
      'method',
      'path',
      'section',
      'occurred_at'
    ]);
    assert.deepEqual(schema.indexes, [
      'idx_user_activity_events_occurred_at',
      'idx_user_activity_events_user_time'
    ]);
  });
});

test('user activity store rejects events missing required request fields', async () => {
  await withTempStore(async (store) => {
    assert.throws(() => store.recordEvent({
      userId: 'user-1',
      email: 'analyst@example.test',
      eventType: 'page_view',
      occurredAt: '2026-06-01T10:00:00.000Z'
    }), /Activity event requires method/);

    store.close();
  });
});

test('user activity store keeps rare status for retained view activity outside requested range', async () => {
  await withTempStore(async (store) => {
    store.recordEvent({
      userId: 'range-view-user',
      email: 'range-view@example.test',
      role: 'analyst',
      eventType: 'page_view',
      method: 'GET',
      path: '/',
      section: 'tables',
      occurredAt: '2026-05-20T08:00:00.000Z'
    });

    const overview = store.getActivityOverview({
      from: '2026-06-05',
      to: '2026-06-05',
      users: [
        { id: 'range-view-user', email: 'range-view@example.test', role: 'analyst' }
      ]
    });
    const user = overview.users.find((item) => item.id === 'range-view-user');

    assert.equal(user.status, 'rare');
    assert.equal(user.lastEventAt, '2026-05-20T08:00:00.000Z');
    assert.equal(user.activeDays30, 1);
    assert.equal(user.activeDays90, 1);
    assert.equal(user.days.find((day) => day.date === '2026-06-05').level, 'none');
    assert.equal(user.recentEvents.length, 0);

    store.close();
  });
});

test('user activity store keeps active status for recent work outside requested range', async () => {
  await withTempStore(async (store) => {
    store.recordEvent({
      userId: 'range-work-user',
      email: 'range-work@example.test',
      role: 'analyst',
      eventType: 'dashboard_filter',
      method: 'GET',
      path: '/dashboards/workplace-analysis',
      section: 'workplace-analysis',
      occurredAt: '2026-06-01T10:00:00.000Z'
    });

    const overview = store.getActivityOverview({
      from: '2026-06-05',
      to: '2026-06-05',
      users: [
        { id: 'range-work-user', email: 'range-work@example.test', role: 'analyst' }
      ]
    });
    const user = overview.users.find((item) => item.id === 'range-work-user');

    assert.equal(user.status, 'active');
    assert.equal(user.lastEventAt, '2026-06-01T10:00:00.000Z');
    assert.equal(user.activeDays30, 1);
    assert.equal(user.activeDays90, 1);
    assert.equal(user.days.find((day) => day.date === '2026-06-05').level, 'none');
    assert.equal(user.recentEvents.length, 0);

    store.close();
  });
});

test('user activity store keeps silent status for 90-day activity outside last 30 days', async () => {
  await withTempStore(async (store) => {
    store.recordEvent({
      userId: 'ninety-day-user',
      email: 'ninety-day@example.test',
      role: 'analyst',
      eventType: 'page_view',
      method: 'GET',
      path: '/',
      section: 'tables',
      occurredAt: '2026-03-20T08:00:00.000Z'
    });

    const overview = store.getActivityOverview({
      from: '2026-06-05',
      to: '2026-06-05',
      users: [
        { id: 'ninety-day-user', email: 'ninety-day@example.test', role: 'analyst' }
      ]
    });
    const user = overview.users.find((item) => item.id === 'ninety-day-user');

    assert.equal(user.status, 'silent');
    assert.equal(user.lastEventAt, '2026-03-20T08:00:00.000Z');
    assert.equal(user.activeDays30, 0);
    assert.equal(user.activeDays90, 1);
    assert.equal(user.days.find((day) => day.date === '2026-06-05').level, 'none');
    assert.equal(user.recentEvents.length, 0);

    store.close();
  });
});

test('user activity store strips query strings and hashes from persisted paths', async () => {
  await withTempStore(async (store) => {
    store.recordEvent({
      userId: 'path-user',
      email: 'path@example.test',
      role: 'analyst',
      eventType: 'page_view',
      method: 'GET',
      path: '/dashboard?token=secret#x',
      section: 'tables',
      occurredAt: '2026-06-05T10:00:00.000Z'
    });
    store.recordEvent({
      userId: 'path-user',
      email: 'path@example.test',
      role: 'analyst',
      eventType: 'admin_action',
      method: 'POST',
      path: 'https://example.test/admin/users?password=x#section',
      section: 'accounts',
      occurredAt: '2026-06-05T10:01:00.000Z'
    });

    const overview = store.getActivityOverview({
      from: '2026-06-05',
      to: '2026-06-05',
      users: [
        { id: 'path-user', email: 'path@example.test', role: 'admin' }
      ]
    });
    const user = overview.users.find((item) => item.id === 'path-user');

    assert.deepEqual(user.recentEvents.map((event) => event.path), [
      '/admin/users',
      '/dashboard'
    ]);

    store.close();
  });
});

test('userActivityStorePathFromEnv supports override and data default', () => {
  assert.equal(
    userActivityStorePathFromEnv({ USER_ACTIVITY_STORE_PATH: 'C:\\activity\\store.sqlite' }),
    'C:\\activity\\store.sqlite'
  );
  assert.match(userActivityStorePathFromEnv({}), /data[\\/]user-activity\.sqlite$/);
});
