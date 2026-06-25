const test = require('node:test');
const assert = require('node:assert/strict');

const {
  renderAccountManagement,
  renderHome,
  renderLogin,
  renderPasswordChange
} = require('../src/render');

test('renderLogin escapes values and keeps return path local', () => {
  const html = renderLogin({
    database: 'etl',
    email: '<admin@example.test>',
    error: '<bad password>',
    returnTo: '/dashboards/city-analysis?city=Москва'
  });

  assert.match(html, /Вход/);
  assert.match(html, /&lt;admin@example.test&gt;/);
  assert.match(html, /&lt;bad password&gt;/);
  assert.match(html, /name="returnTo" value="\/dashboards\/city-analysis\?city=Москва"/);
  assert.doesNotMatch(html, /<bad password>/);
});

test('renderAccountManagement shows env admin as read-only and escapes managed users', () => {
  const html = renderAccountManagement({
    database: 'etl',
    currentUser: {
      email: 'admin@example.test',
      role: 'admin',
      permissions: ['tables', 'users']
    },
    csrfToken: 'csrf-token',
    users: [
      {
        id: 'env-admin',
        email: 'admin@example.test',
        name: 'Администратор из ENV',
        role: 'admin',
        permissions: ['tables', 'users', 'sql-inspector'],
        source: 'env',
        createdAt: '2026-06-02T10:00:00.000Z',
        updatedAt: '2026-06-02T10:00:00.000Z'
      },
      {
        id: 'user-1',
        email: 'analyst@example.test',
        name: '<Analyst>',
        role: 'analyst',
        permissions: ['tables', 'brand-analysis', 'worker-cancellations', 'sql-inspector'],
        source: 'managed',
        createdAt: '2026-06-02T10:00:00.000Z',
        updatedAt: '2026-06-02T10:00:00.000Z'
      }
    ],
    message: 'Аккаунт создан',
    error: ''
  });

  assert.match(html, /Учетные записи/);
  assert.match(html, /Администратор из ENV/);
  assert.match(html, /Создается из переменных окружения/);
  assert.match(html, /&lt;Analyst&gt;/);
  assert.match(html, /name="csrfToken" value="csrf-token"/);
  assert.match(html, /action="\/admin\/users\/user-1\/update"/);
  assert.match(html, /action="\/admin\/users\/user-1\/delete"/);
  assert.match(html, /Отмены гигерами/);
  assert.match(html, /Анализ брендов/);
  assert.match(html, /name="permissions" value="brand-analysis" checked/);
  assert.match(html, /name="permissions" value="worker-cancellations" checked/);
  assert.match(html, /SQL метрик/);
  assert.match(html, /name="permissions" value="sql-inspector" checked/);
  assert.match(html, /Предзагрузка витрин/);
  assert.match(html, /name="permissions" value="preload-admin"/);
  assert.match(html, /class="nav-link active" href="\/admin\/users"/);
  assert.doesNotMatch(html, /<Analyst>/);
});

test('renderPasswordChange renders managed form and escapes messages', () => {
  const html = renderPasswordChange({
    database: 'etl',
    currentUser: {
      id: 'user-1',
      email: 'analyst@example.test',
      role: 'analyst',
      permissions: ['tables'],
      source: 'managed'
    },
    csrfToken: 'csrf-token',
    error: '<bad password>',
    message: '<saved>',
    required: true,
    returnTo: '/dashboards/sales-by-project?period=month'
  });

  assert.match(html, /Смена пароля/);
  assert.match(html, /Требуется сменить временный пароль/);
  assert.match(html, /&lt;bad password&gt;/);
  assert.match(html, /&lt;saved&gt;/);
  assert.match(html, /name="csrfToken" value="csrf-token"/);
  assert.match(html, /name="returnTo" value="\/dashboards\/sales-by-project\?period=month"/);
  assert.match(html, /name="currentPassword"/);
  assert.match(html, /name="newPassword"/);
  assert.match(html, /name="confirmPassword"/);
  assert.doesNotMatch(html, /<bad password>/);
});

test('renderPasswordChange shows env admin password as environment-managed', () => {
  const html = renderPasswordChange({
    database: 'etl',
    currentUser: {
      id: 'env-admin',
      email: 'admin@example.test',
      role: 'admin',
      permissions: ['tables', 'users'],
      source: 'env'
    },
    csrfToken: 'csrf-token'
  });

  assert.match(html, /Пароль администратора задается через окружение/);
  assert.doesNotMatch(html, /name="currentPassword"/);
  assert.doesNotMatch(html, /href="\/account\/password"/);
});

test('layout shows password change link only for managed users', () => {
  const managedHtml = renderAccountManagement({
    database: 'etl',
    currentUser: {
      email: 'managed-admin@example.test',
      role: 'admin',
      permissions: ['tables', 'users'],
      source: 'managed'
    },
    csrfToken: 'csrf-token',
    users: [],
    message: '',
    error: ''
  });
  const envHtml = renderAccountManagement({
    database: 'etl',
    currentUser: {
      email: 'admin@example.test',
      role: 'admin',
      permissions: ['tables', 'users'],
      source: 'env'
    },
    csrfToken: 'csrf-token',
    users: [],
    message: '',
    error: ''
  });

  assert.match(managedHtml, /href="\/account\/password"/);
  assert.doesNotMatch(envHtml, /href="\/account\/password"/);
});

test('navigation shows scheduled reports based on report permissions and hides SMTP from analysts', () => {
  const authorHtml = renderHome({
    database: 'etl',
    tables: [],
    currentUser: { role: 'analyst', permissions: ['scheduled-report-author'] }
  });
  const deliveryHtml = renderHome({
    database: 'etl',
    tables: [],
    currentUser: { role: 'analyst', permissions: ['scheduled-report-delivery'] }
  });
  const analystHtml = renderHome({
    database: 'etl',
    tables: [],
    currentUser: {
      role: 'analyst',
      permissions: ['scheduled-report-author', 'scheduled-report-delivery', 'mail-settings-admin']
    }
  });
  const adminHtml = renderHome({
    database: 'etl',
    tables: [],
    currentUser: { role: 'admin', permissions: [] }
  });

  assert.match(authorHtml, /href="\/reports\/scheduled"/);
  assert.match(authorHtml, /Регулярные отчеты/);
  assert.match(deliveryHtml, /href="\/reports\/scheduled"/);
  assert.doesNotMatch(analystHtml, /href="\/admin\/mail-settings"/);
  assert.match(adminHtml, /href="\/admin\/mail-settings"/);
  assert.match(adminHtml, />SMTP<\/a>/);
});
