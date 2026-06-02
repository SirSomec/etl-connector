const test = require('node:test');
const assert = require('node:assert/strict');

const {
  renderAccountManagement,
  renderLogin
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
        permissions: ['tables', 'users'],
        source: 'env',
        createdAt: '2026-06-02T10:00:00.000Z',
        updatedAt: '2026-06-02T10:00:00.000Z'
      },
      {
        id: 'user-1',
        email: 'analyst@example.test',
        name: '<Analyst>',
        role: 'analyst',
        permissions: ['tables'],
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
  assert.match(html, /class="nav-link active" href="\/admin\/users"/);
  assert.doesNotMatch(html, /<Analyst>/);
});
