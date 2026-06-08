const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { createUserStore, createSessionManager } = require('../src/auth');
const { createApp, sanitizeForResponse } = require('../src/server');

function createFakeClient() {
  return {
    calls: [],
    async listTables() {
      this.calls.push(['listTables']);
      return ['mg_orders'];
    },
    async getColumns(tableName) {
      this.calls.push(['getColumns', tableName]);
      return [{ name: '_id', type: 'String', position: 1 }];
    },
    async getPreview(tableName) {
      this.calls.push(['getPreview', tableName]);
      return [{ _id: 'order-1' }];
    },
    async queryJSONEachRow(query, params, operation) {
      this.calls.push(['queryJSONEachRow', operation, params]);

      if (operation === 'sales by project orders summary') {
        return [{ ordered_shifts: 10, workplaces_with_orders: 3, avg_worker_rate_hour: 250 }];
      }

      if (operation === 'sales by project shifts summary') {
        return [
          {
            worked_shifts: 8,
            revenue_rub: 12000,
            unique_workers: 5,
            workplaces_with_worked_shifts: 2,
            cancelled_shifts: 1,
            self_booked_confirmed_shifts: 4
          }
        ];
      }

      return [];
    }
  };
}

function createFakePreloadService() {
  return {
    getOverview() {
      return {
        coveredFrom: '2026-05-01',
        coveredTo: '2026-06-04',
        lastSuccessAt: '',
        lastError: ''
      };
    },
    getJob() {
      return {
        id: 'sales-by-project',
        enabled: true,
        scheduleTime: '03:00',
        timezone: 'Europe/Moscow',
        refreshDays: 45
      };
    },
    listRuns() {
      return [];
    },
    saveSchedule(input) {
      return { id: 'sales-by-project', ...input };
    },
    async runSalesByProject() {
      return { status: 'success', rowsWritten: 1 };
    },
    close() {}
  };
}

function createActivitySpy() {
  return {
    events: [],
    prunedRetentions: [],
    recordEvent(event) {
      this.events.push(event);
    },
    pruneOldEvents(retentionDays) {
      this.prunedRetentions.push(retentionDays);
      return 0;
    },
    getActivityOverview() {
      return { from: '2026-03-08', to: '2026-06-05', retentionDays: 90, users: [] };
    },
    close() {}
  };
}

function authConfig(filePath) {
  return {
    port: 0,
    clickhouse: {
      database: 'etl',
      password: 'clickhouse-secret'
    },
    auth: {
      enabled: true,
      adminEmail: 'admin@example.test',
      adminPassword: 'EnvAdminPass123',
      userStorePath: filePath,
      sessionSecret: 'session-secret',
      sessionCookieName: 'test_session',
      sessionTtlMs: 12 * 60 * 60 * 1000,
      passwordHashIterations: 1000
    }
  };
}

async function waitForListening(server) {
  if (server.listening) {
    return;
  }

  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

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
    activityStore: createActivitySpy(),
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

async function fetchText(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();

  return { response, text };
}

function formBody(values) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(values)) {
    const valuesList = Array.isArray(value) ? value : [value];

    for (const item of valuesList) {
      params.append(key, item);
    }
  }

  return params.toString();
}

async function login(baseUrl, email, password) {
  const { response } = await fetchText(baseUrl, '/login', {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: formBody({ email, password, returnTo: '/' })
  });

  return response;
}

async function createReadyUser(userStore, input, readyPassword) {
  const created = await userStore.createUser(input);

  await userStore.changeOwnPassword(created.id, {
    currentPassword: input.password,
    newPassword: readyPassword,
    confirmPassword: readyPassword
  });

  return created;
}

function cookieFrom(response) {
  return String(response.headers.get('set-cookie') || '').split(';')[0];
}

function csrfFrom(html) {
  const match = html.match(/name="csrfToken" value="([^"]+)"/);

  assert.ok(match, 'csrf token should be rendered');

  return match[1];
}

test('auth redirects anonymous users to login and allows env admin login', async () => {
  await withAuthServer(async ({ baseUrl, client }) => {
    const anonymous = await fetchText(baseUrl, '/', { redirect: 'manual' });

    assert.equal(anonymous.response.status, 302);
    assert.equal(anonymous.response.headers.get('location'), '/login?returnTo=%2F');
    assert.deepEqual(client.calls, []);

    const failedLogin = await fetchText(baseUrl, '/login', {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: formBody({ email: 'admin@example.test', password: 'wrong', returnTo: '/' })
    });

    assert.equal(failedLogin.response.status, 401);
    assert.match(failedLogin.text, /Неверная почта или пароль/);

    const loginResponse = await login(baseUrl, 'ADMIN@example.test', 'EnvAdminPass123');
    const cookie = cookieFrom(loginResponse);

    assert.equal(loginResponse.status, 303);
    assert.equal(loginResponse.headers.get('location'), '/');
    assert.match(cookie, /^test_session=/);

    const home = await fetchText(baseUrl, '/', {
      headers: {
        cookie
      }
    });

    assert.equal(home.response.status, 200);
    assert.match(home.text, /Available Tables/);
    assert.match(home.text, /admin@example.test/);
    assert.match(home.text, /href="\/admin\/users"/);
    assert.deepEqual(client.calls, [['listTables']]);
  });
});

test('managed user with temporary password must change it before using the app', async () => {
  await withAuthServer(async ({ baseUrl, userStore }) => {
    const created = await userStore.createUser({
      email: 'analyst@example.test',
      name: 'Analyst',
      role: 'analyst',
      permissions: ['tables'],
      password: 'TempPass123!'
    });
    const analystLogin = await login(baseUrl, 'analyst@example.test', 'TempPass123!');
    const cookie = cookieFrom(analystLogin);
    const blockedHome = await fetchText(baseUrl, '/', {
      redirect: 'manual',
      headers: { cookie }
    });

    assert.equal(analystLogin.status, 303);
    assert.equal(blockedHome.response.status, 302);
    assert.equal(blockedHome.response.headers.get('location'), '/account/password?required=1&returnTo=%2F');

    const passwordPage = await fetchText(baseUrl, '/account/password?required=1&returnTo=%2F', {
      headers: { cookie }
    });
    const csrfToken = csrfFrom(passwordPage.text);

    assert.equal(passwordPage.response.status, 200);
    assert.match(passwordPage.text, /Смена пароля/);
    assert.match(passwordPage.text, /Требуется сменить временный пароль/);

    const badCsrf = await fetchText(baseUrl, '/account/password', {
      method: 'POST',
      redirect: 'manual',
      headers: {
        cookie,
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: formBody({
        csrfToken: 'bad-token',
        currentPassword: 'TempPass123!',
        newPassword: 'FreshPass456!',
        confirmPassword: 'FreshPass456!',
        returnTo: '/'
      })
    });

    assert.equal(badCsrf.response.status, 403);
    assert.equal((await userStore.verifyCredentials('analyst@example.test', 'TempPass123!')).id, created.id);

    const changed = await fetchText(baseUrl, '/account/password', {
      method: 'POST',
      redirect: 'manual',
      headers: {
        cookie,
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: formBody({
        csrfToken,
        currentPassword: 'TempPass123!',
        newPassword: 'FreshPass456!',
        confirmPassword: 'FreshPass456!',
        returnTo: '/'
      })
    });

    assert.equal(changed.response.status, 303);
    assert.equal(changed.response.headers.get('location'), '/');
    assert.equal(await userStore.verifyCredentials('analyst@example.test', 'TempPass123!'), null);
    assert.equal(
      (await userStore.verifyCredentials('analyst@example.test', 'FreshPass456!')).mustChangePassword,
      false
    );

    const allowedHome = await fetchText(baseUrl, '/', {
      headers: { cookie }
    });

    assert.equal(allowedHome.response.status, 200);
    assert.match(allowedHome.text, /mg_orders/);
  });
});

test('admin can create, edit, and delete managed accounts with csrf protection', async () => {
  await withAuthServer(async ({ baseUrl, userStore }) => {
    const adminLogin = await login(baseUrl, 'admin@example.test', 'EnvAdminPass123');
    const adminCookie = cookieFrom(adminLogin);
    const usersPage = await fetchText(baseUrl, '/admin/users', {
      headers: {
        cookie: adminCookie
      }
    });
    const csrfToken = csrfFrom(usersPage.text);

    const rejected = await fetchText(baseUrl, '/admin/users/create', {
      method: 'POST',
      redirect: 'manual',
      headers: {
        cookie: adminCookie,
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: formBody({
        csrfToken: 'bad-token',
        email: 'analyst@example.test',
        name: 'Analyst',
        role: 'analyst',
        permissions: ['tables'],
        password: 'WorkerPass123!'
      })
    });

    assert.equal(rejected.response.status, 403);
    assert.equal(await userStore.verifyCredentials('analyst@example.test', 'WorkerPass123!'), null);

    const created = await fetchText(baseUrl, '/admin/users/create', {
      method: 'POST',
      redirect: 'manual',
      headers: {
        cookie: adminCookie,
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: formBody({
        csrfToken,
        email: 'analyst@example.test',
        name: 'Analyst',
        role: 'analyst',
        permissions: ['tables'],
        password: 'WorkerPass123!'
      })
    });

    assert.equal(created.response.status, 303);
    assert.equal(created.response.headers.get('location'), '/admin/users?message=created');

    const users = await userStore.listUsers();
    const analyst = users.find((user) => user.email === 'analyst@example.test');

    assert.ok(analyst);
    assert.equal(analyst.role, 'analyst');
    assert.deepEqual(analyst.permissions, ['tables']);

    const updated = await fetchText(baseUrl, `/admin/users/${analyst.id}/update`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        cookie: adminCookie,
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: formBody({
        csrfToken,
        email: 'analyst@example.test',
        name: 'Updated Analyst',
        role: 'admin',
        permissions: ['tables'],
        password: 'SeniorPass123!'
      })
    });

    assert.equal(updated.response.status, 303);
    assert.equal((await userStore.verifyCredentials('analyst@example.test', 'SeniorPass123!')).role, 'admin');

    const deleted = await fetchText(baseUrl, `/admin/users/${analyst.id}/delete`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        cookie: adminCookie,
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: formBody({ csrfToken })
    });

    assert.equal(deleted.response.status, 303);
    assert.equal(await userStore.verifyCredentials('analyst@example.test', 'SeniorPass123!'), null);
  });
});

test('managed users only access granted sections', async () => {
  await withAuthServer(async ({ baseUrl, userStore }) => {
    await createReadyUser(userStore, {
      email: 'analyst@example.test',
      name: 'Analyst',
      role: 'analyst',
      permissions: ['tables'],
      password: 'WorkerPass123!'
    }, 'WorkerReady123!');
    await createReadyUser(userStore, {
      email: 'preload@example.test',
      name: 'Preload Analyst',
      role: 'analyst',
      permissions: ['preload-admin'],
      password: 'PreloadWork123!'
    }, 'PreloadReady123!');

    const analystLogin = await login(baseUrl, 'analyst@example.test', 'WorkerReady123!');
    const analystCookie = cookieFrom(analystLogin);
    const home = await fetchText(baseUrl, '/', {
      headers: {
        cookie: analystCookie
      }
    });
    const users = await fetchText(baseUrl, '/admin/users', {
      headers: {
        cookie: analystCookie
      }
    });
    const preloadDenied = await fetchText(baseUrl, '/admin/preload', {
      headers: {
        cookie: analystCookie
      }
    });
    const preloadLogin = await login(baseUrl, 'preload@example.test', 'PreloadReady123!');
    const preloadAllowed = await fetchText(baseUrl, '/admin/preload', {
      headers: {
        cookie: cookieFrom(preloadLogin)
      }
    });

    assert.equal(home.response.status, 200);
    assert.match(home.text, /mg_orders/);
    assert.doesNotMatch(home.text, /href="\/admin\/users"/);
    assert.equal(users.response.status, 403);
    assert.match(users.text, /Недостаточно прав/);
    assert.equal(preloadDenied.response.status, 403);
    assert.match(preloadDenied.text, /Недостаточно прав/);
    assert.equal(preloadAllowed.response.status, 200);
    assert.match(preloadAllowed.text, /Предзагрузка витрин/);
  });
});

test('admin can open /admin/activity', async () => {
  const activityStore = createActivitySpy();
  let capturedOverviewInput = null;
  let nowCalls = 0;
  const nowValues = [
    new Date('2026-06-05T10:00:00.000Z'),
    new Date('2026-06-05T23:59:59.999Z'),
    new Date('2026-06-06T00:00:00.000Z')
  ];
  const currentNow = () => {
    const value = nowValues[nowCalls] || nowValues[nowValues.length - 1];

    nowCalls += 1;
    return new Date(value.getTime());
  };

  activityStore.getActivityOverview = (input) => {
    capturedOverviewInput = input;
    return {
      from: input.from,
      to: input.to,
      retentionDays: 90,
      users: [
        {
          id: 'env-admin',
          email: 'admin@example.test',
          name: 'Env Admin',
          role: 'admin',
          status: 'active',
          lastEventAt: '2026-06-05T10:00:00.000Z',
          activeDays30: 1,
          activeDays90: 1,
          days: [{ date: '2026-06-05', level: 'view', viewEvents: 1, workEvents: 0, sections: ['activity'] }],
          recentEvents: []
        }
      ]
    };
  };

  await withAuthServer(async ({ baseUrl }) => {
    const adminLogin = await login(baseUrl, 'admin@example.test', 'EnvAdminPass123');
    const activityPage = await fetchText(baseUrl, '/admin/activity', {
      headers: {
        cookie: cookieFrom(adminLogin)
      }
    });

    assert.equal(activityPage.response.status, 200);
    assert.match(activityPage.text, /Активность пользователей/);
    assert.equal(capturedOverviewInput.from, '2026-03-08');
    assert.equal(capturedOverviewInput.to, '2026-06-05');
    assert.ok(capturedOverviewInput.users.some((user) => user.id === 'env-admin'));
    const activityPageEvents = activityStore.events.filter((event) => (
      event.eventType === 'page_view' &&
      event.path === '/admin/activity' &&
      event.section === 'activity'
    ));

    assert.equal(activityPageEvents.length, 1);
    assert.deepEqual(activityStore.prunedRetentions, [90]);
    assert.equal(nowCalls, 3);
  }, {
    activityStore,
    now: currentNow
  });
});

test('/admin/activity is admin-only by role', async () => {
  const activityStore = createActivitySpy();
  const wideAnalyst = {
    id: 'wide-analyst',
    email: 'wide-analyst@example.test',
    name: 'Wide Analyst',
    role: 'analyst',
    permissions: ['tables', 'preload-admin', 'users']
  };
  const userStore = {
    async listUsers() {
      return [wideAnalyst];
    },
    async findByEmail(email) {
      return email === wideAnalyst.email ? wideAnalyst : null;
    },
    async verifyCredentials(email, password) {
      return email === wideAnalyst.email && password === 'WorkerPass123!' ? wideAnalyst : null;
    }
  };

  await withAuthServer(async ({ baseUrl }) => {
    const analystLogin = await login(baseUrl, 'wide-analyst@example.test', 'WorkerPass123!');
    const activityPage = await fetchText(baseUrl, '/admin/activity', {
      headers: {
        cookie: cookieFrom(analystLogin)
      }
    });

    assert.equal(activityPage.response.status, 403);
    assert.match(activityPage.text, /Недостаточно прав/);
    assert.equal(activityStore.events.filter((event) => event.path === '/admin/activity').length, 0);
  }, { activityStore, userStore });
});

test('/admin/activity renders sanitized store errors', async () => {
  const activityStore = createActivitySpy();

  activityStore.getActivityOverview = () => {
    throw new Error('store failed with EnvAdminPass123');
  };

  await withAuthServer(async ({ baseUrl }) => {
    const adminLogin = await login(baseUrl, 'admin@example.test', 'EnvAdminPass123');
    const activityPage = await fetchText(baseUrl, '/admin/activity', {
      headers: {
        cookie: cookieFrom(adminLogin)
      }
    });

    assert.equal(activityPage.response.status, 502);
    assert.match(activityPage.text, /Activity Store Error/);
    assert.match(activityPage.text, /store failed with \[redacted\]/);
    assert.doesNotMatch(activityPage.text, /EnvAdminPass123/);
  }, { activityStore });
});

test('dashboard section fragments respect sql-inspector permission', async () => {
  await withAuthServer(async ({ baseUrl, userStore }) => {
    await createReadyUser(userStore, {
      email: 'plain@example.test',
      name: 'Plain Analyst',
      role: 'analyst',
      permissions: ['sales-by-project'],
      password: 'PlainUser123!'
    }, 'PlainReady123!');
    await createReadyUser(userStore, {
      email: 'sql@example.test',
      name: 'SQL Analyst',
      role: 'analyst',
      permissions: ['sales-by-project', 'sql-inspector'],
      password: 'SqlViewer123!'
    }, 'SqlViewerReady123!');

    const plainLogin = await login(baseUrl, 'plain@example.test', 'PlainReady123!');
    const sqlLogin = await login(baseUrl, 'sql@example.test', 'SqlViewerReady123!');
    const sectionPath = '/dashboards/sales-by-project/section?section=summary&period=month&from=2026-04-01&to=2026-04-30';
    const plain = await fetchText(baseUrl, sectionPath, {
      headers: {
        cookie: cookieFrom(plainLogin)
      }
    });
    const sql = await fetchText(baseUrl, sectionPath, {
      headers: {
        cookie: cookieFrom(sqlLogin)
      }
    });

    assert.equal(plain.response.status, 200);
    assert.equal(sql.response.status, 200);
    assert.doesNotMatch(plain.text, /data-sql-inspector-open/);
    assert.doesNotMatch(plain.text, /shift_facts/);
    assert.match(sql.text, /data-sql-inspector-open/);
    assert.match(sql.text, /shift_facts/);
  });
});

test('auth server records login page view and logout activity', async () => {
  const activityStore = createActivitySpy();

  await withAuthServer(async ({ baseUrl }) => {
    const loginResponse = await login(baseUrl, 'admin@example.test', 'EnvAdminPass123');
    const cookie = cookieFrom(loginResponse);
    const home = await fetchText(baseUrl, '/', {
      headers: {
        cookie
      }
    });
    const csrfToken = csrfFrom(home.text);
    const logout = await fetchText(baseUrl, '/logout', {
      method: 'POST',
      redirect: 'manual',
      headers: {
        cookie,
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: formBody({ csrfToken })
    });

    assert.equal(logout.response.status, 303);
    assert.deepEqual(activityStore.events.map((event) => event.eventType), ['login', 'page_view', 'logout']);
    assert.equal(activityStore.events[0].userId, 'env-admin');
    assert.equal(activityStore.events[1].path, '/');
    assert.equal(activityStore.events[1].section, 'tables');
  }, { activityStore });
});

test('auth server records dashboard filter detail export and admin actions without progressive sections', async () => {
  const activityStore = createActivitySpy();

  await withAuthServer(async ({ baseUrl }) => {
    const loginResponse = await login(baseUrl, 'admin@example.test', 'EnvAdminPass123');
    const cookie = cookieFrom(loginResponse);
    const usersPage = await fetchText(baseUrl, '/admin/users', {
      headers: {
        cookie
      }
    });
    const csrfToken = csrfFrom(usersPage.text);
    const dashboard = await fetchText(
      baseUrl,
      '/dashboards/sales-by-project?period=month&from=2026-05-01&to=2026-05-31',
      {
        headers: {
          cookie
        }
      }
    );
    const section = await fetchText(baseUrl, '/dashboards/sales-by-project/section?section=summary&period=month', {
      headers: {
        cookie
      }
    });
    const details = await fetchText(
      baseUrl,
      '/dashboards/city-analysis/gigers?city=Москва&metric=total-located-users',
      {
        headers: {
          cookie
        }
      }
    );
    const exported = await fetchText(
      baseUrl,
      '/dashboards/city-analysis/gigers/export?city=Москва&metric=total-located-users',
      {
        headers: {
          cookie
        }
      }
    );
    const scheduled = await fetchText(baseUrl, '/admin/preload/schedule', {
      method: 'POST',
      redirect: 'manual',
      headers: {
        cookie,
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: formBody({
        csrfToken,
        enabled: '1',
        scheduleTime: '03:00',
        refreshDays: '45'
      })
    });

    assert.equal(dashboard.response.status, 200);
    assert.equal(section.response.status, 200);
    assert.equal(details.response.status, 200);
    assert.equal(exported.response.status, 200);
    assert.equal(scheduled.response.status, 303);
    assert.deepEqual(activityStore.events.map((event) => event.eventType), [
      'login',
      'page_view',
      'dashboard_filter',
      'detail_open',
      'export',
      'admin_action'
    ]);
    assert.equal(activityStore.events.some((event) => event.path.includes('/section')), false);
    assert.equal(activityStore.events[2].path, '/dashboards/sales-by-project');
  }, { activityStore });
});

test('auth server ignores anonymous requests and health checks for activity', async () => {
  const activityStore = createActivitySpy();

  await withAuthServer(async ({ baseUrl }) => {
    const health = await fetchText(baseUrl, '/healthz');
    const anonymous = await fetchText(baseUrl, '/', { redirect: 'manual' });

    assert.equal(health.response.status, 200);
    assert.equal(anonymous.response.status, 302);
    assert.deepEqual(activityStore.events, []);
  }, { activityStore });
});

test('sanitizeForResponse redacts auth secrets', () => {
  const config = authConfig('C:\\auth\\users.json');

  assert.equal(
    sanitizeForResponse('failed EnvAdminPass123 and session-secret and clickhouse-secret', config),
    'failed [redacted] and [redacted] and [redacted]'
  );
});
