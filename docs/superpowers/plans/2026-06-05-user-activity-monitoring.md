# User Activity Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить администраторский мониторинг активности пользователей ETL Analytics Service на базе локального SQLite runtime-хранилища.

**Architecture:** Сервер пишет только собственные auth/UI события в `data/user-activity.sqlite`, не обращаясь к ClickHouse и не сохраняя чувствительные query/body/header данные. `/admin/activity` объединяет агрегаты событий с `userStore.listUsers()` и рендерит матрицу пользователей за 90 дней.

**Tech Stack:** Node.js 22, Express, `node:sqlite`, server-rendered HTML, `node:test`.

---

## File Structure

- Create `src/userActivityStore.js`: SQLite schema, запись событий, очистка 90 дней, агрегация по пользователям/дням, env helper.
- Create `test/userActivityStore.test.js`: unit tests для store и агрегации.
- Modify `src/config.js`: добавить `activity.storePath`.
- Modify `test/config.test.js`: проверить `USER_ACTIVITY_STORE_PATH` и default `data/user-activity.sqlite`.
- Modify `src/server.js`: подключить store, классифицировать события, писать их non-blocking, добавить `/admin/activity`, закрывать store при shutdown.
- Modify `test/serverAuth.test.js`: проверить запись событий и доступ admin-only.
- Modify `src/render.js`: навигация admin-only, `renderUserActivityDashboard`, CSS матрицы.
- Modify `test/render.test.js`: проверить рендер матрицы, пустое состояние, escaping.
- Modify `.env.example` and `README.md`: documented runtime path, route, Docker `data` права.

---

### Task 1: Activity Store

**Files:**
- Create: `src/userActivityStore.js`
- Test: `test/userActivityStore.test.js`

- [ ] **Step 1: Write failing store tests**

Create `test/userActivityStore.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  DEFAULT_USER_ACTIVITY_RETENTION_DAYS,
  createUserActivityStore,
  userActivityStorePathFromEnv
} = require('../src/userActivityStore');

async function withTempStore(callback) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'activity-store-'));
  const filePath = path.join(tempDir, 'activity.sqlite');

  try {
    await callback(createUserActivityStore({
      filePath,
      now: () => new Date('2026-06-05T12:00:00.000Z')
    }), filePath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
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

    const removed = store.pruneOldEvents(90);
    const overview = store.getActivityOverview({
      from: '2026-01-01',
      to: '2026-06-05',
      users: [
        { id: 'old-user', email: 'old@example.test', role: 'analyst' },
        { id: 'fresh-user', email: 'fresh@example.test', role: 'analyst' }
      ]
    });

    assert.equal(removed, 1);
    assert.equal(overview.users.find((user) => user.id === 'old-user').activeDays90, 0);
    assert.equal(overview.users.find((user) => user.id === 'fresh-user').activeDays90, 1);

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
```

- [ ] **Step 2: Run store test to verify it fails**

Run:

```bash
npm test -- test/userActivityStore.test.js
```

Expected: FAIL with `Cannot find module '../src/userActivityStore'`.

- [ ] **Step 3: Implement `src/userActivityStore.js`**

Create `src/userActivityStore.js`:

```js
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_USER_ACTIVITY_STORE_PATH = path.join(process.cwd(), 'data', 'user-activity.sqlite');
const DEFAULT_USER_ACTIVITY_RETENTION_DAYS = 90;
const INTENSE_WORK_EVENT_THRESHOLD = 5;
const WORK_EVENT_TYPES = new Set(['dashboard_filter', 'detail_open', 'export', 'admin_action']);
const VIEW_EVENT_TYPES = new Set(['login', 'logout', 'page_view']);

function userActivityStorePathFromEnv(env = process.env) {
  return env.USER_ACTIVITY_STORE_PATH || DEFAULT_USER_ACTIVITY_STORE_PATH;
}

function formatDateUTC(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0')
  ].join('-');
}

function parseDateOnly(value) {
  const text = String(value || '');
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(text)) {
    throw new Error(`Invalid date: ${value}`);
  }

  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || formatDateUTC(date) !== text) {
    throw new Error(`Invalid date: ${value}`);
  }

  return date;
}

function addDaysUTC(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function enumerateDates(from, to) {
  const dates = [];
  const start = parseDateOnly(from);
  const end = parseDateOnly(to);

  for (let cursor = start; cursor.getTime() <= end.getTime(); cursor = addDaysUTC(cursor, 1)) {
    dates.push(formatDateUTC(cursor));
  }

  return dates;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeEvent(input) {
  return {
    userId: normalizeText(input && input.userId),
    email: normalizeEmail(input && input.email),
    role: normalizeText(input && input.role) || 'analyst',
    eventType: normalizeText(input && input.eventType),
    method: normalizeText(input && input.method).toUpperCase() || 'GET',
    path: normalizeText(input && input.path) || '/',
    section: normalizeText(input && input.section) || 'other',
    occurredAt: normalizeText(input && input.occurredAt)
  };
}

function assertEvent(event) {
  for (const key of ['userId', 'email', 'eventType', 'method', 'path', 'section', 'occurredAt']) {
    if (!event[key]) {
      throw new Error(`Activity event requires ${key}`);
    }
  }
}

function initializeSchema(db) {
  db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS user_activity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  event_type TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  section TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_activity_events_occurred_at
  ON user_activity_events (occurred_at);

CREATE INDEX IF NOT EXISTS idx_user_activity_events_user_time
  ON user_activity_events (user_id, occurred_at);
`);
}

function normalizeDbEvent(row) {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    role: row.role,
    eventType: row.event_type,
    method: row.method,
    path: row.path,
    section: row.section,
    occurredAt: row.occurred_at
  };
}

function classifyDay({ viewEvents, workEvents }) {
  if (workEvents >= INTENSE_WORK_EVENT_THRESHOLD) return 'intense';
  if (workEvents > 0) return 'work';
  if (viewEvents > 0) return 'view';
  return 'none';
}

function userStatus({ user, lastEventAt, workDays14, activeDays30 }) {
  if (!lastEventAt && user && user.createdAt) return 'new';
  if (!lastEventAt) return 'new';
  if (workDays14 > 0) return 'active';
  if (activeDays30 === 0) return 'silent';
  return 'rare';
}

function createUserActivityStore({
  filePath = DEFAULT_USER_ACTIVITY_STORE_PATH,
  retentionDays = DEFAULT_USER_ACTIVITY_RETENTION_DAYS,
  now = () => new Date()
} = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const db = new DatabaseSync(filePath);
  initializeSchema(db);

  function cutoffIso(days) {
    const cutoff = now();
    cutoff.setUTCDate(cutoff.getUTCDate() - days);
    return cutoff.toISOString();
  }

  function pruneOldEvents(days = retentionDays) {
    const result = db
      .prepare('DELETE FROM user_activity_events WHERE occurred_at < ?')
      .run(cutoffIso(days));

    return Number(result.changes || 0);
  }

  function recordEvent(input) {
    pruneOldEvents(retentionDays);
    const event = normalizeEvent(input);
    assertEvent(event);

    db.prepare(`
INSERT INTO user_activity_events (
  user_id, email, role, event_type, method, path, section, occurred_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`).run(
      event.userId,
      event.email,
      event.role,
      event.eventType,
      event.method,
      event.path,
      event.section,
      event.occurredAt
    );
  }

  function eventRows(from, to) {
    return db.prepare(`
SELECT *
FROM user_activity_events
WHERE occurred_at >= ? AND occurred_at < ?
ORDER BY occurred_at DESC, id DESC
`).all(`${from}T00:00:00.000Z`, `${formatDateUTC(addDaysUTC(parseDateOnly(to), 1))}T00:00:00.000Z`)
      .map(normalizeDbEvent);
  }

  function getActivityOverview({ from, to, users = [] }) {
    const dates = enumerateDates(from, to);
    const events = eventRows(from, to);
    const eventsByUser = new Map();
    const userById = new Map();

    for (const user of users) {
      if (user && user.id) {
        userById.set(user.id, { ...user, email: normalizeEmail(user.email) });
      }
    }

    for (const event of events) {
      if (!userById.has(event.userId)) {
        userById.set(event.userId, {
          id: event.userId,
          email: event.email,
          name: '',
          role: event.role,
          source: 'event'
        });
      }

      if (!eventsByUser.has(event.userId)) {
        eventsByUser.set(event.userId, []);
      }

      eventsByUser.get(event.userId).push(event);
    }

    const today = parseDateOnly(to);
    const day14Start = formatDateUTC(addDaysUTC(today, -13));
    const day30Start = formatDateUTC(addDaysUTC(today, -29));
    const rows = [...userById.values()].map((user) => {
      const userEvents = eventsByUser.get(user.id) || [];
      const byDate = new Map();

      for (const event of userEvents) {
        const date = event.occurredAt.slice(0, 10);
        if (!byDate.has(date)) {
          byDate.set(date, { viewEvents: 0, workEvents: 0, sections: new Set() });
        }
        const bucket = byDate.get(date);

        if (WORK_EVENT_TYPES.has(event.eventType)) bucket.workEvents += 1;
        else if (VIEW_EVENT_TYPES.has(event.eventType)) bucket.viewEvents += 1;
        bucket.sections.add(event.section);
      }

      const days = dates.map((date) => {
        const bucket = byDate.get(date) || { viewEvents: 0, workEvents: 0, sections: new Set() };
        return {
          date,
          level: classifyDay(bucket),
          viewEvents: bucket.viewEvents,
          workEvents: bucket.workEvents,
          sections: [...bucket.sections].sort()
        };
      });
      const activeDays30 = days.filter((day) => day.date >= day30Start && day.level !== 'none').length;
      const activeDays90 = days.filter((day) => day.level !== 'none').length;
      const workDays14 = days.filter((day) => day.date >= day14Start && ['work', 'intense'].includes(day.level)).length;
      const recentEvents = userEvents.slice(0, 8);
      const lastEventAt = recentEvents.length > 0 ? recentEvents[0].occurredAt : '';

      return {
        id: user.id,
        email: user.email,
        name: user.name || '',
        role: user.role || 'analyst',
        source: user.source || 'managed',
        createdAt: user.createdAt || '',
        status: userStatus({ user, lastEventAt, workDays14, activeDays30 }),
        lastEventAt,
        activeDays30,
        activeDays90,
        days,
        recentEvents
      };
    });

    rows.sort((left, right) => {
      if (left.status === 'active' && right.status !== 'active') return -1;
      if (right.status === 'active' && left.status !== 'active') return 1;
      return String(right.lastEventAt).localeCompare(String(left.lastEventAt));
    });

    return {
      from,
      to,
      retentionDays,
      users: rows
    };
  }

  return {
    recordEvent,
    pruneOldEvents,
    getActivityOverview,
    close() {
      db.close();
    }
  };
}

module.exports = {
  DEFAULT_USER_ACTIVITY_RETENTION_DAYS,
  DEFAULT_USER_ACTIVITY_STORE_PATH,
  createUserActivityStore,
  userActivityStorePathFromEnv
};
```

- [ ] **Step 4: Run store test to verify it passes**

Run:

```bash
npm test -- test/userActivityStore.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit store**

```bash
git add src/userActivityStore.js test/userActivityStore.test.js
git commit -m "Add user activity store"
```

---

### Task 2: Config Path

**Files:**
- Modify: `src/config.js`
- Test: `test/config.test.js`

- [ ] **Step 1: Write failing config test**

In `test/config.test.js`, add assertions near existing `loadConfig` tests:

```js
test('loadConfig includes user activity store path', () => {
  const config = loadConfig({
    CLICKHOUSE_HOST: 'clickhouse.example.test',
    CLICKHOUSE_USER: 'rouser',
    CLICKHOUSE_PASSWORD: 'secret',
    AUTH_ADMIN_EMAIL: 'admin@example.test',
    AUTH_ADMIN_PASSWORD: 'AdminPass123',
    USER_ACTIVITY_STORE_PATH: 'C:\\activity\\user-activity.sqlite'
  });

  assert.equal(config.activity.storePath, 'C:\\activity\\user-activity.sqlite');
});

test('loadConfig defaults user activity store to data directory', () => {
  const config = loadConfig({
    CLICKHOUSE_HOST: 'clickhouse.example.test',
    CLICKHOUSE_USER: 'rouser',
    CLICKHOUSE_PASSWORD: 'secret',
    AUTH_ADMIN_EMAIL: 'admin@example.test',
    AUTH_ADMIN_PASSWORD: 'AdminPass123'
  });

  assert.match(config.activity.storePath, /data[\\/]user-activity\.sqlite$/);
});
```

- [ ] **Step 2: Run config tests to verify failure**

Run:

```bash
npm test -- test/config.test.js
```

Expected: FAIL because `config.activity` is undefined.

- [ ] **Step 3: Implement config**

In `src/config.js`, add:

```js
const DEFAULT_USER_ACTIVITY_STORE_PATH = path.join(process.cwd(), 'data', 'user-activity.sqlite');
```

Then add to the returned config object after `preload`:

```js
    activity: {
      storePath: env.USER_ACTIVITY_STORE_PATH || DEFAULT_USER_ACTIVITY_STORE_PATH
    },
```

- [ ] **Step 4: Run config tests**

Run:

```bash
npm test -- test/config.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit config**

```bash
git add src/config.js test/config.test.js
git commit -m "Configure user activity store path"
```

---

### Task 3: Server Event Classification And Recording

**Files:**
- Modify: `src/server.js`
- Test: `test/serverAuth.test.js`

- [ ] **Step 1: Write failing server activity tests**

In `test/serverAuth.test.js`, update `withAuthServer` so it accepts overrides:

```js
async function withAuthServer(callback, overrides = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'server-auth-test-'));
  const filePath = path.join(tempDir, 'users.json');
  const config = authConfig(filePath);
  const client = createFakeClient();
  const userStore = createUserStore({
    filePath,
    adminEmail: config.auth.adminEmail,
    adminPassword: config.auth.adminPassword,
    passwordHashOptions: {
      iterations: config.auth.passwordHashIterations,
      salt: '0123456789abcdef'
    }
  });
  const sessionManager = createSessionManager({
    cookieName: config.auth.sessionCookieName,
    ttlMs: config.auth.sessionTtlMs,
    secret: config.auth.sessionSecret
  });
  const app = createApp({
    config,
    client,
    userStore,
    sessionManager,
    preloadService: createFakePreloadService(),
    ...overrides
  });
  const server = http.createServer(app);

  try {
    server.listen(0);
    await waitForListening(server);
    const { port } = server.address();

    await callback({
      baseUrl: `http://127.0.0.1:${port}`,
      client,
      userStore
    });
  } finally {
    await closeServer(server);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
```

Add a spy store helper:

```js
function createActivitySpy() {
  return {
    events: [],
    recordEvent(event) {
      this.events.push(event);
    },
    pruneOldEvents() {
      return 0;
    },
    getActivityOverview() {
      return { from: '2026-03-08', to: '2026-06-05', retentionDays: 90, users: [] };
    },
    close() {}
  };
}
```

Add tests:

```js
test('auth server records login page view and logout activity', async () => {
  const activityStore = createActivitySpy();

  await withAuthServer(async ({ baseUrl }) => {
    const loginResponse = await login(baseUrl, 'admin@example.test', 'EnvAdminPass123');
    const cookie = cookieFrom(loginResponse);
    assert.equal(loginResponse.status, 303);

    const home = await fetchText(baseUrl, '/', { headers: { cookie } });
    const csrf = csrfFrom(home.text);
    await fetchText(baseUrl, '/logout', {
      method: 'POST',
      redirect: 'manual',
      headers: {
        cookie,
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: formBody({ csrfToken: csrf })
    });

    assert.deepEqual(
      activityStore.events.map((event) => event.eventType),
      ['login', 'page_view', 'logout']
    );
    assert.equal(activityStore.events[0].userId, 'env-admin');
    assert.equal(activityStore.events[1].path, '/');
    assert.equal(activityStore.events[1].section, 'tables');
  }, { activityStore });
});

test('auth server records dashboard filter detail export and admin actions without progressive sections', async () => {
  const activityStore = createActivitySpy();

  await withAuthServer(async ({ baseUrl }) => {
    const response = await login(baseUrl, 'admin@example.test', 'EnvAdminPass123');
    const cookie = cookieFrom(response);
    const usersPage = await fetchText(baseUrl, '/admin/users', { headers: { cookie } });
    const csrf = csrfFrom(usersPage.text);

    await fetchText(baseUrl, '/dashboards/sales-by-project?period=month&from=2026-05-01&to=2026-05-31', { headers: { cookie } });
    await fetchText(baseUrl, '/dashboards/sales-by-project/section?section=summary&period=month', { headers: { cookie } });
    await fetchText(baseUrl, '/dashboards/city-analysis/gigers?city=Москва&metric=total-located-users', { headers: { cookie } });
    await fetchText(baseUrl, '/dashboards/city-analysis/gigers/export?city=Москва&metric=total-located-users', { headers: { cookie } });
    await fetchText(baseUrl, '/admin/preload/schedule', {
      method: 'POST',
      redirect: 'manual',
      headers: {
        cookie,
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: formBody({
        csrfToken: csrf,
        enabled: '1',
        scheduleTime: '03:00',
        refreshDays: '45'
      })
    });

    assert.deepEqual(
      activityStore.events.map((event) => event.eventType),
      ['login', 'page_view', 'dashboard_filter', 'detail_open', 'export', 'admin_action']
    );
    assert.equal(activityStore.events.some((event) => event.path.includes('/section')), false);
    assert.equal(activityStore.events.find((event) => event.eventType === 'dashboard_filter').path, '/dashboards/sales-by-project');
  }, { activityStore });
});

test('auth server ignores anonymous requests and health checks for activity', async () => {
  const activityStore = createActivitySpy();

  await withAuthServer(async ({ baseUrl }) => {
    await fetchText(baseUrl, '/healthz');
    await fetchText(baseUrl, '/', { redirect: 'manual' });

    assert.deepEqual(activityStore.events, []);
  }, { activityStore });
});
```

- [ ] **Step 2: Run server auth tests to verify failure**

Run:

```bash
npm test -- test/serverAuth.test.js
```

Expected: FAIL because `createApp` does not accept or call `activityStore`.

- [ ] **Step 3: Implement server recording helpers**

In `src/server.js`, add import:

```js
const {
  createUserActivityStore,
  DEFAULT_USER_ACTIVITY_RETENTION_DAYS
} = require('./userActivityStore');
```

Extend `createApp` options:

```js
  activityStore = null,
  now = () => new Date()
```

After session setup, create local store:

```js
  const activity = activityStore || (authEnabled && authConfig.enabled !== false
    ? createUserActivityStore({
        filePath: (config.activity && config.activity.storePath) || undefined,
        now
      })
    : null);
```

Add helper functions inside `createApp` before routes:

```js
  function sanitizedPath(req) {
    return String((req && req.path) || '/');
  }

  function sectionForPath(pathName) {
    const normalized = normalizePathForNav(pathName);

    if (normalized === '/login' || normalized === '/logout') return 'auth';
    if (normalized.startsWith('/admin/activity')) return 'activity';
    if (normalized.startsWith('/admin/users')) return 'users';
    if (normalized.startsWith('/admin/preload')) return 'preload-admin';
    if (normalized.startsWith('/dashboards/sales-by-project')) return 'sales-by-project';
    if (normalized.startsWith('/dashboards/workplace-analysis')) return 'workplace-analysis';
    if (normalized.startsWith('/dashboards/city-analysis')) return 'city-analysis';
    if (normalized.startsWith('/dashboards/heatmap')) return 'heatmap';
    if (normalized.startsWith('/dashboards/worker-cancellations')) return 'worker-cancellations';
    if (normalized.startsWith('/tables') || normalized === '/') return 'tables';

    return 'other';
  }

  function isProgressiveSectionPath(pathName) {
    return /\\/section$/.test(String(pathName || ''));
  }

  function isExportPath(pathName) {
    return /\\/export$/.test(String(pathName || ''));
  }

  function isDetailPath(pathName) {
    return /\\/(gigers|details)$/.test(String(pathName || '')) && !isExportPath(pathName);
  }

  function requestHasFilters(req) {
    const query = (req && req.query) || {};
    const keys = Object.keys(query).filter((key) => key !== 'section');

    return keys.length > 0;
  }

  function activityEventType(req) {
    const pathName = sanitizedPath(req);

    if (pathName === '/login' && req.method === 'POST') return 'login';
    if (pathName === '/logout' && req.method === 'POST') return 'logout';
    if (req.method === 'POST' && pathName.startsWith('/admin/')) return 'admin_action';
    if (req.method !== 'GET') return '';
    if (isProgressiveSectionPath(pathName)) return '';
    if (isExportPath(pathName)) return 'export';
    if (isDetailPath(pathName)) return 'detail_open';
    if (pathName.startsWith('/dashboards/') && requestHasFilters(req)) return 'dashboard_filter';

    return 'page_view';
  }

  function recordActivity(req, user, eventType) {
    if (!activity || !user || !eventType) {
      return;
    }

    try {
      activity.recordEvent({
        userId: user.id,
        email: user.email,
        role: user.role,
        eventType,
        method: req.method,
        path: sanitizedPath(req),
        section: sectionForPath(req.path),
        occurredAt: now().toISOString()
      });
    } catch (error) {
      console.warn(`User activity write failed: ${sanitizeForResponse(error && error.message, config)}`);
    }
  }

  function recordCurrentUserActivity(req, eventType) {
    if (!req || !req.auth || !req.auth.user) {
      return;
    }

    recordActivity(req, req.auth.user, eventType || activityEventType(req));
  }
```

- [ ] **Step 4: Record login/logout and successful responses**

In POST `/login`, after `const session = sessions.createSession(user);`, add:

```js
      recordActivity(req, user, 'login');
```

In POST `/logout`, before `sessions.destroySession(req)`, add:

```js
      recordCurrentUserActivity(req, 'logout');
```

For successful admin actions, add `recordCurrentUserActivity(req, 'admin_action');` immediately before each success redirect:

```js
        await accounts.createUser({
          email: req.body.email,
          name: req.body.name,
          role: req.body.role,
          permissions: permissionsFromBody(req.body),
          password: req.body.password
        });

        recordCurrentUserActivity(req, 'admin_action');
        res.redirect(303, '/admin/users?message=created');
```

```js
        await accounts.updateUser(req.params.id, {
          email: req.body.email,
          name: req.body.name,
          role: req.body.role,
          permissions: permissionsFromBody(req.body),
          password: req.body.password
        });

        recordCurrentUserActivity(req, 'admin_action');
        res.redirect(303, '/admin/users?message=updated');
```

```js
        await accounts.deleteUser(req.params.id);

        recordCurrentUserActivity(req, 'admin_action');
        res.redirect(303, '/admin/users?message=deleted');
```

```js
      preloads.saveSchedule(preloadScheduleFromBody(req.body));

      recordCurrentUserActivity(req, 'admin_action');
      res.redirect(303, '/admin/preload?message=schedule-saved');
```

```js
      const result = await preloads.runSalesByProject(normalizeManualPreloadRange(req.body));
      const message = result && (result.status === 'already-running' || result.alreadyRunning)
        ? 'already-running'
        : 'run-started';

      recordCurrentUserActivity(req, 'admin_action');
      res.redirect(303, `/admin/preload?message=${message}`);
```

For GET routes that return full HTML pages, add `recordCurrentUserActivity(req);` immediately before their final `.send(...)`. Use these exact placements:

```js
      recordCurrentUserActivity(req);
```

Add it in these handlers:

- `GET /admin/users`, before `sendAccountManagement(...)` returns its HTML response. If the helper owns `.send(...)`, add an optional `beforeSend` callback to `sendAccountManagement` and call it after `accounts.listUsers()` succeeds but before `res.send(...)`.
- `GET /admin/preload`, before `sendPreloadManagement(...)` returns its HTML response. If the helper owns `.send(...)`, add the same `beforeSend` option to `sendPreloadManagement`.
- `GET /`, after `const tables = await client.listTables();` and before `res.status(200).type('html').send(...)`.
- `GET /dashboards/sales-by-project`, `/dashboards/city-analysis`, `/dashboards/heatmap`, `/dashboards/workplace-analysis`, `/dashboards/workplace-analysis/point`, `/dashboards/worker-cancellations`, after shell data is loaded and before `.send(...)`.
- `GET /tables`, inside `renderNamedTable`, after columns/rows are loaded and before `renderTable(...)`.
- `GET /dashboards/city-analysis/gigers` and `/dashboards/city-analysis/gigers/export`, after detail rows are loaded and before `renderGigerDetails(...)` or `sendGigerDetailsWorkbook(...)`.
- `GET /dashboards/workplace-analysis/gigers`, `/dashboards/workplace-analysis/point/gigers`, `/dashboards/workplace-analysis/point/details`, `/dashboards/worker-cancellations/details`, after detail data is loaded and before rendering the fragment/workbook.

Do not add recording to any `/dashboards/*/section` route.

- [ ] **Step 5: Run server auth tests**

Run:

```bash
npm test -- test/serverAuth.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit server recording**

```bash
git add src/server.js test/serverAuth.test.js
git commit -m "Record service user activity"
```

---

### Task 4: Activity Admin Route

**Files:**
- Modify: `src/server.js`
- Test: `test/serverAuth.test.js`

- [ ] **Step 1: Write failing route access tests**

In `test/serverAuth.test.js`, add:

```js
test('admin activity page is visible only to admins', async () => {
  const activityStore = createActivitySpy();
  activityStore.getActivityOverview = ({ users }) => ({
    from: '2026-03-08',
    to: '2026-06-05',
    retentionDays: 90,
    users: users.map((user) => ({
      ...user,
      status: user.role === 'admin' ? 'active' : 'new',
      lastEventAt: '',
      activeDays30: 0,
      activeDays90: 0,
      days: [{ date: '2026-06-05', level: 'none', viewEvents: 0, workEvents: 0, sections: [] }],
      recentEvents: []
    }))
  });

  await withAuthServer(async ({ baseUrl, userStore }) => {
    await userStore.createUser({
      email: 'analyst@example.test',
      name: 'Analyst',
      role: 'analyst',
      permissions: ['tables', 'users', 'preload-admin'],
      password: 'AnalystPass123'
    });

    const adminLogin = await login(baseUrl, 'admin@example.test', 'EnvAdminPass123');
    const adminCookie = cookieFrom(adminLogin);
    const adminPage = await fetchText(baseUrl, '/admin/activity', { headers: { cookie: adminCookie } });

    assert.equal(adminPage.response.status, 200);
    assert.match(adminPage.text, /Активность пользователей/);
    assert.match(adminPage.text, /admin@example\.test/);
    assert.match(adminPage.text, /analyst@example\.test/);

    const analystLogin = await login(baseUrl, 'analyst@example.test', 'AnalystPass123');
    const analystCookie = cookieFrom(analystLogin);
    const analystPage = await fetchText(baseUrl, '/admin/activity', { headers: { cookie: analystCookie } });

    assert.equal(analystPage.response.status, 403);
  }, { activityStore });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm test -- test/serverAuth.test.js
```

Expected: FAIL with 404 for `/admin/activity` or missing renderer.

- [ ] **Step 3: Implement admin-only route**

In imports from `./render`, add:

```js
  renderUserActivityDashboard,
```

Add active nav mapping:

```js
    '/admin/activity': 'activity',
```

and before `/admin/users` route, add:

```js
  app.get(
    '/admin/activity',
    requireAuth(),
    asyncRoute(async (req, res) => {
      const auth = await loadRequestAuth(req);

      if (!auth || auth.user.role !== 'admin') {
        sendError(
          res,
          403,
          'Недостаточно прав',
          'Раздел активности доступен только администраторам.',
          'activity',
          viewContext(req)
        );
        return;
      }

      if (!activity) {
        res
          .status(200)
          .type('html')
          .send(renderUserActivityDashboard({
            database,
            overview: null,
            disabled: true,
            ...viewContext(req)
          }));
        return;
      }

      try {
        activity.pruneOldEvents(DEFAULT_USER_ACTIVITY_RETENTION_DAYS);
        const to = formatDateUTC(now());
        const fromDate = new Date(`${to}T00:00:00.000Z`);
        fromDate.setUTCDate(fromDate.getUTCDate() - (DEFAULT_USER_ACTIVITY_RETENTION_DAYS - 1));
        const users = await accounts.listUsers();
        const overview = activity.getActivityOverview({
          from: formatDateUTC(fromDate),
          to,
          users
        });

        recordCurrentUserActivity(req, 'page_view');
        res
          .status(200)
          .type('html')
          .send(renderUserActivityDashboard({ database, overview, ...viewContext(req) }));
      } catch (error) {
        sendError(res, 502, 'Activity Store Error', error && error.message, 'activity', viewContext(req));
      }
    })
  );
```

- [ ] **Step 4: Run route tests**

Run:

```bash
npm test -- test/serverAuth.test.js
```

Expected: still FAIL until renderer exists in Task 5. Keep route code in place.

Do not commit this task separately unless Task 5 is implemented in the same branch; the app should not be left with missing render exports.

---

### Task 5: Activity Matrix Renderer

**Files:**
- Modify: `src/render.js`
- Test: `test/render.test.js`
- Continue: `test/serverAuth.test.js`

- [ ] **Step 1: Write failing render tests**

In `test/render.test.js`, add:

```js
test('renderUserActivityDashboard renders escaped matrix and disabled state', () => {
  const { renderUserActivityDashboard } = require('../src/render');
  const html = renderUserActivityDashboard({
    database: 'etl',
    currentUser: { id: 'env-admin', email: 'admin@example.test', role: 'admin', permissions: [] },
    csrfToken: 'csrf-token',
    overview: {
      from: '2026-06-03',
      to: '2026-06-05',
      retentionDays: 90,
      users: [
        {
          id: 'user-1',
          email: 'analyst<script>@example.test',
          name: 'Analyst <One>',
          role: 'analyst',
          source: 'managed',
          status: 'active',
          lastEventAt: '2026-06-05T10:00:00.000Z',
          activeDays30: 2,
          activeDays90: 2,
          days: [
            { date: '2026-06-03', level: 'view', viewEvents: 2, workEvents: 0, sections: ['tables'] },
            { date: '2026-06-04', level: 'work', viewEvents: 1, workEvents: 2, sections: ['city-analysis'] },
            { date: '2026-06-05', level: 'intense', viewEvents: 1, workEvents: 5, sections: ['workplace-analysis'] }
          ],
          recentEvents: [
            {
              eventType: 'dashboard_filter',
              section: 'workplace-analysis',
              path: '/dashboards/workplace-analysis?<bad>',
              occurredAt: '2026-06-05T10:00:00.000Z'
            }
          ]
        }
      ]
    }
  });

  assert.match(html, /Активность пользователей/);
  assert.match(html, /class="nav-link active" href="\/admin\/activity"/);
  assert.match(html, /Analyst &lt;One&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /analyst&lt;script&gt;@example\.test/);
  assert.match(html, /data-activity-level="intense"/);
  assert.match(html, /\/dashboards\/workplace-analysis\?&lt;bad&gt;/);

  const disabled = renderUserActivityDashboard({
    database: 'etl',
    currentUser: { id: 'env-admin', email: 'admin@example.test', role: 'admin', permissions: [] },
    disabled: true
  });

  assert.match(disabled, /Авторизация отключена/);
});
```

- [ ] **Step 2: Run render test to verify failure**

Run:

```bash
npm test -- test/render.test.js
```

Expected: FAIL because `renderUserActivityDashboard` is not exported.

- [ ] **Step 3: Add nav link and renderer helpers**

In `src/render.js`, add admin-only nav link after `Учетные записи`:

```js
  {
    href: '/admin/activity',
    label: 'Активность',
    id: 'activity',
    permission: 'admin-only'
  },
```

Update `navLinksForUser`:

```js
  return NAV_LINKS.filter((link) => {
    if (link.permission === 'admin-only') {
      return currentUser.role === 'admin';
    }

    return hasPermission(currentUser, link.permission);
  });
```

Add render helpers near account/preload renderers:

```js
function activityStatusLabel(status) {
  const labels = {
    active: 'активен',
    rare: 'редко',
    silent: 'молчит',
    new: 'новый'
  };

  return labels[status] || 'нет данных';
}

function activityEventLabel(eventType) {
  const labels = {
    login: 'вход',
    logout: 'выход',
    page_view: 'просмотр',
    dashboard_filter: 'фильтр',
    detail_open: 'детализация',
    export: 'экспорт',
    admin_action: 'админ-действие'
  };

  return labels[eventType] || eventType;
}

function renderActivityDay(day) {
  const title = `${day.date}: ${activityStatusLabel(day.level)}; просмотров ${day.viewEvents}; рабочих действий ${day.workEvents}`;

  return `<span class="activity-day" data-activity-level="${escapeHtml(day.level)}" title="${escapeHtml(title)}"></span>`;
}

function renderRecentActivity(events) {
  if (!events || events.length === 0) {
    return '<div class="activity-recent-empty">Действий за период нет.</div>';
  }

  return `<div class="activity-recent">${events.map((event) => `<div class="activity-recent-row">
    <span>${escapeHtml(event.occurredAt || '-')}</span>
    <strong>${escapeHtml(activityEventLabel(event.eventType))}</strong>
    <span>${escapeHtml(event.section || '-')}</span>
    <code>${escapeHtml(event.path || '/')}</code>
  </div>`).join('')}</div>`;
}

function renderActivityUserRow(user) {
  const name = user.name || user.email;
  const days = (user.days || []).map(renderActivityDay).join('');

  return `<details class="activity-user-row">
  <summary>
    <span class="activity-user-main">
      <strong>${escapeHtml(name)}</strong>
      <span>${escapeHtml(user.email)}</span>
    </span>
    <span class="activity-role">${escapeHtml(user.role || '-')}</span>
    <span class="activity-status activity-status-${escapeHtml(user.status || 'new')}">${escapeHtml(activityStatusLabel(user.status))}</span>
    <span class="activity-days">${days}</span>
    <span class="activity-last">Последний раз: ${escapeHtml(user.lastEventAt || '-')}</span>
    <span class="activity-counts">${escapeHtml(user.activeDays30 || 0)} / ${escapeHtml(user.activeDays90 || 0)} дней</span>
  </summary>
  ${renderRecentActivity(user.recentEvents)}
</details>`;
}

function renderActivityLegend() {
  return `<div class="activity-legend">
    <span><i data-activity-level="none"></i> нет</span>
    <span><i data-activity-level="view"></i> просмотр</span>
    <span><i data-activity-level="work"></i> работа</span>
    <span><i data-activity-level="intense"></i> интенсивно</span>
  </div>`;
}

function renderUserActivityDashboard({
  database,
  currentUser,
  csrfToken = '',
  overview = null,
  disabled = false
}) {
  const disabledHtml = disabled
    ? '<p class="empty">Авторизация отключена, поэтому мониторинг активности пользователей сервиса не ведется.</p>'
    : '';
  const users = overview && Array.isArray(overview.users) ? overview.users : [];
  const rows = users.map(renderActivityUserRow).join('');
  const content = `<section class="section">
  <h1>Активность пользователей</h1>
  <p class="technical-note">Матрица показывает активность пользователей самого аналитического сервиса за последние ${escapeHtml((overview && overview.retentionDays) || 90)} дней.</p>
  ${disabledHtml}
</section>
${disabled ? '' : `<section class="section">
  ${renderActivityLegend()}
  <div class="activity-matrix">${rows || '<p class="empty">За период нет пользователей или событий активности.</p>'}</div>
</section>`}`;

  return layout({
    title: 'Активность пользователей',
    database,
    content,
    activeNav: 'activity',
    currentUser,
    csrfToken
  });
}
```

- [ ] **Step 4: Add CSS for matrix**

Inside `layout` CSS in `src/render.js`, add:

```css
    .activity-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 14px;
      margin-bottom: 12px;
      color: var(--muted);
      font-size: 13px;
    }

    .activity-legend span {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .activity-legend i,
    .activity-day {
      display: inline-block;
      width: 10px;
      height: 16px;
      border-radius: 3px;
      border: 1px solid rgba(31, 41, 55, 0.08);
    }

    [data-activity-level="none"] {
      background: #e5e7eb;
    }

    [data-activity-level="view"] {
      background: #bfdbfe;
    }

    [data-activity-level="work"] {
      background: #5ea6b8;
    }

    [data-activity-level="intense"] {
      background: #256d85;
    }

    .activity-matrix {
      display: grid;
      gap: 8px;
    }

    .activity-user-row {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
    }

    .activity-user-row summary {
      display: grid;
      grid-template-columns: minmax(170px, 1.4fr) 78px 82px minmax(260px, 2fr) 150px 84px;
      gap: 10px;
      align-items: center;
      padding: 10px 12px;
      cursor: pointer;
      list-style: none;
    }

    .activity-user-row summary::-webkit-details-marker {
      display: none;
    }

    .activity-user-main {
      display: grid;
      min-width: 0;
    }

    .activity-user-main strong,
    .activity-user-main span,
    .activity-last,
    .activity-counts {
      overflow-wrap: anywhere;
    }

    .activity-user-main span,
    .activity-last,
    .activity-counts,
    .activity-role {
      color: var(--muted);
      font-size: 13px;
    }

    .activity-status {
      justify-self: start;
      padding: 2px 7px;
      border-radius: 999px;
      background: var(--accent-bg);
      color: var(--accent);
      font-size: 12px;
      font-weight: 700;
    }

    .activity-status-silent {
      background: #f3f4f6;
      color: #6b7280;
    }

    .activity-status-rare {
      background: #fff7ed;
      color: #9a3412;
    }

    .activity-days {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(6px, 1fr));
      gap: 2px;
      min-width: 0;
    }

    .activity-recent {
      border-top: 1px solid var(--line);
      padding: 8px 12px 12px;
      display: grid;
      gap: 6px;
    }

    .activity-recent-row {
      display: grid;
      grid-template-columns: 190px 110px 140px 1fr;
      gap: 8px;
      color: var(--muted);
      font-size: 13px;
    }

    .activity-recent-row code {
      white-space: normal;
      overflow-wrap: anywhere;
    }

    .activity-recent-empty {
      border-top: 1px solid var(--line);
      padding: 10px 12px;
      color: var(--muted);
      font-size: 13px;
    }
```

In existing mobile media query, add:

```css
      .activity-user-row summary,
      .activity-recent-row {
        grid-template-columns: 1fr;
      }

      .activity-days {
        grid-template-columns: repeat(30, minmax(6px, 1fr));
      }
```

- [ ] **Step 5: Export renderer**

At the bottom `module.exports`, add:

```js
  renderUserActivityDashboard,
```

- [ ] **Step 6: Run render and server auth tests**

Run:

```bash
npm test -- test/render.test.js test/serverAuth.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit route and renderer**

```bash
git add src/server.js src/render.js test/render.test.js test/serverAuth.test.js
git commit -m "Add activity monitoring admin page"
```

---

### Task 6: Startup Wiring And Shutdown

**Files:**
- Modify: `src/server.js`
- Test: `test/server.test.js`

- [ ] **Step 1: Write failing startup wiring test**

In `test/server.test.js`, add:

```js
test('start wires user activity store path and closes it with server', async () => {
  const config = {
    port: 0,
    clickhouse: {
      host: 'clickhouse.example.test',
      database: 'etl',
      user: 'rouser',
      password: 'super-secret'
    },
    preload: {
      storePath: 'C:\\runtime\\preload.sqlite'
    },
    auth: {
      enabled: true
    },
    activity: {
      storePath: 'C:\\activity\\user-activity.sqlite'
    }
  };
  const createdStores = [];
  const server = start({
    loadConfigFn: () => config,
    ClientClass: class {
      constructor(config) {
        this.config = config;
      }
    },
    createPreloadServiceFn: () => null,
    createUserActivityStoreFn: (options) => {
      const store = {
        options,
        closed: false,
        close() {
          this.closed = true;
        }
      };
      createdStores.push(store);
      return store;
    },
    createAppFn: ({ activityStore }) => {
      assert.equal(activityStore, createdStores[0]);
      const app = require('express')();
      app.get('/healthz', (req, res) => res.send('ok'));
      return app;
    },
    logger: { log() {}, warn() {} }
  });

  await new Promise((resolve) => server.close(resolve));

  assert.equal(createdStores[0].options.filePath, 'C:\\activity\\user-activity.sqlite');
  assert.equal(createdStores[0].closed, true);
});
```

- [ ] **Step 2: Run startup test to verify failure**

Run:

```bash
npm test -- test/server.test.js
```

Expected: FAIL because `start` does not accept `createUserActivityStoreFn`.

- [ ] **Step 3: Implement startup wiring**

In `src/server.js`, update imports:

```js
const {
  createUserActivityStore,
  DEFAULT_USER_ACTIVITY_RETENTION_DAYS
} = require('./userActivityStore');
```

In `start(options = {})`, destructure:

```js
    createUserActivityStoreFn = createUserActivityStore,
```

Before `createAppFn`, create:

```js
  const activityStore = config.auth && config.auth.enabled
    ? createUserActivityStoreFn({
        filePath: config.activity.storePath
      })
    : null;
```

Pass to `createAppFn`:

```js
    activityStore,
```

In `server.on('close')`, before preload close, add:

```js
    if (activityStore && typeof activityStore.close === 'function') {
      try {
        activityStore.close();
      } catch (error) {
        warn(`User activity store close failed: ${sanitizeForResponse(error && error.message, config)}`);
      }
    }
```

Also adjust `createApp` so it no longer creates its own default store when `activityStore` is passed from `start`. Keep fallback creation only for tests that call `createApp` directly.

- [ ] **Step 4: Run startup tests**

Run:

```bash
npm test -- test/server.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit startup wiring**

```bash
git add src/server.js test/server.test.js
git commit -m "Wire user activity store at startup"
```

---

### Task 7: Documentation

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Update `.env.example`**

Add near other runtime store paths:

```dotenv
USER_ACTIVITY_STORE_PATH=./data/user-activity.sqlite
```

- [ ] **Step 2: Update README configuration and dashboards**

In `README.md`, add `USER_ACTIVITY_STORE_PATH=./data/user-activity.sqlite` to the env example.

Add `/admin/activity` to the dashboard/admin route list:

```md
- `http://localhost:3000/admin/activity` - администраторский мониторинг активности пользователей самого сервиса.
```

Add a configuration note:

```md
Мониторинг активности пользователей сервиса хранится в SQLite-файле `./data/user-activity.sqlite`; путь можно переопределить через `USER_ACTIVITY_STORE_PATH`. Это runtime-состояние деплоя, файл не нужно коммитить. Экран `/admin/activity` доступен только администраторам и показывает активность пользователей самого аналитического сервиса, не пользователей MyGig из `mg_users`.
```

Add Docker permission reminder to the existing `data` paragraph:

```md
К этому же volume относится `user-activity.sqlite`; перед деплоем проверьте, что `./data` доступен на запись пользователю контейнера `node`.
```

- [ ] **Step 3: Commit docs**

```bash
git add .env.example README.md
git commit -m "Document user activity monitoring"
```

---

### Task 8: Final Verification

**Files:**
- No planned file edits unless verification exposes defects.

- [ ] **Step 1: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 2: Start local app**

Run:

```bash
npm start
```

Expected: server logs `ETL Analytics listening on port 3000` or configured port. If port 3000 is busy, set `PORT=3001` for this verification.

- [ ] **Step 3: Manual browser verification**

Open `http://localhost:3000/login`, login as env admin, then visit:

```text
http://localhost:3000/
http://localhost:3000/dashboards/sales-by-project?period=month
http://localhost:3000/admin/activity
```

Expected:

- `/admin/activity` loads only for admin.
- Activity matrix includes env admin.
- Opening a progressive `/section` URL does not add visible day intensity.
- `data/user-activity.sqlite` exists locally and `git status --short` does not list it because `data/` is ignored.

- [ ] **Step 4: Final status**

Run:

```bash
git status --short
```

Expected: clean working tree after commits.
