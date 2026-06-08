# Password Self Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить самостоятельную смену пароля и принудительную смену временного пароля для managed-пользователей.

**Architecture:** Логика паролей остается в `src/auth.js`, маршруты и принудительный redirect добавляются в `src/server.js`, HTML-форма рендерится в `src/render.js`. Новые поля `mustChangePassword` и `passwordChangedAt` живут в существующем runtime JSON-хранилище пользователей.

**Tech Stack:** Node.js 22, Express, server-rendered HTML, `node:test`, PBKDF2.

---

## File Structure

- Modify `src/auth.js`: валидация качества пароля, публичный флаг `mustChangePassword`, метод `changeOwnPassword`, временный пароль при создании и админском сбросе.
- Modify `test/auth.test.js`: unit tests для качества пароля, временного пароля, самостоятельной смены и совместимости старых записей.
- Modify `src/server.js`: `/account/password` GET/POST, redirect для managed-пользователей с временным паролем, activity classification для смены пароля.
- Modify `test/serverAuth.test.js`: интеграционные auth tests для принудительного redirect, CSRF и успешной смены.
- Modify `src/render.js`: ссылка в topbar и `renderPasswordChange`.
- Modify `test/renderAuth.test.js`: render tests формы и topbar-ссылки.
- Modify `README.md`: документация правил смены и требований к паролю.

---

### Task 1: Password Policy And Store State

**Files:**
- Modify: `src/auth.js`
- Test: `test/auth.test.js`

- [ ] **Step 1: Write failing auth tests**

Add tests that assert:

```js
await assert.rejects(() => store.createUser({ email: 'weak@example.test', role: 'analyst', permissions: ['tables'], password: 'Password1!' }), /at least 12/);
await assert.rejects(() => store.createUser({ email: 'space@example.test', role: 'analyst', permissions: ['tables'], password: 'Strong Pass123!' }), /must not contain spaces/);
await assert.rejects(() => store.createUser({ email: 'analyst@example.test', role: 'analyst', permissions: ['tables'], password: 'analyst@example.test' }), /must not match email/);
```

Add a test that creates a managed user with `StrongerPass123!`, verifies `mustChangePassword === true`, calls `changeOwnPassword(created.id, { currentPassword: 'StrongerPass123!', newPassword: 'BetterPass456!', confirmPassword: 'BetterPass456!' })`, then verifies old credentials fail, new credentials work, `mustChangePassword === false`, and `passwordChangedAt` is populated.

Add a test that `updateUser(id, { ..., password: 'ResetPass123!' })` makes `mustChangePassword === true` again.

Add a test that a legacy store record without password metadata is returned with `mustChangePassword === true`.

- [ ] **Step 2: Run auth tests to verify failure**

Run:

```bash
npm test -- test/auth.test.js
```

Expected: FAIL because strict policy and `changeOwnPassword` do not exist yet.

- [ ] **Step 3: Implement auth policy and state**

In `src/auth.js`:

- raise `MIN_PASSWORD_LENGTH` to `12`;
- add `validatePasswordQuality(password, context = {})`;
- make `assertPassword(password, context)` call the quality validator;
- include `mustChangePassword` and `passwordChangedAt` in `toPublicUser`;
- set `mustChangePassword: true` and `passwordChangedAt: ''` in `createUser`;
- in `updateUser`, only when password is non-empty, set a new hash plus `mustChangePassword: true` and `passwordChangedAt: ''`;
- add `changeOwnPassword(id, input)` for managed users only.

- [ ] **Step 4: Run auth tests**

Run:

```bash
npm test -- test/auth.test.js
```

Expected: PASS.

---

### Task 2: Password Change Renderer

**Files:**
- Modify: `src/render.js`
- Test: `test/renderAuth.test.js`

- [ ] **Step 1: Write failing render tests**

Add tests that assert `renderPasswordChange`:

- escapes `error`, `message`, and `returnTo`;
- renders fields `currentPassword`, `newPassword`, `confirmPassword`;
- renders required-state text when `required: true`;
- renders read-only env-admin text when `currentUser.source === 'env'`.

Update account-management/topbar render assertions so managed users see `href="/account/password"` and env admin does not.

- [ ] **Step 2: Run render auth tests to verify failure**

Run:

```bash
npm test -- test/renderAuth.test.js
```

Expected: FAIL because renderer and topbar link do not exist.

- [ ] **Step 3: Implement renderer**

In `src/render.js`:

- add a managed-only topbar link to `/account/password`;
- add `renderPasswordChange({ database, currentUser, csrfToken, error, message, required, returnTo })`;
- export `renderPasswordChange`.

- [ ] **Step 4: Run render auth tests**

Run:

```bash
npm test -- test/renderAuth.test.js
```

Expected: PASS.

---

### Task 3: Server Routes And Enforcement

**Files:**
- Modify: `src/server.js`
- Test: `test/serverAuth.test.js`

- [ ] **Step 1: Write failing server auth tests**

Add integration tests that:

- create a managed user, login with temporary password, and assert GET `/` redirects to `/account/password?required=1&returnTo=%2F`;
- assert GET `/account/password` renders the form and keeps the session;
- assert POST `/account/password` rejects bad CSRF and keeps old credentials;
- assert POST with current password and strong new password redirects to `/`, clears `mustChangePassword`, invalidates old password, and allows GET `/`;
- assert env-admin login still reaches `/` without password-change redirect.

- [ ] **Step 2: Run server auth tests to verify failure**

Run:

```bash
npm test -- test/serverAuth.test.js
```

Expected: FAIL because routes and enforcement do not exist.

- [ ] **Step 3: Implement server changes**

In `src/server.js`:

- import `renderPasswordChange`;
- add `/account/password` to auth section classification;
- add `password_change` activity event for successful POST `/account/password`;
- in `requireAuth`, after permission checks, redirect managed users with `mustChangePassword` to `/account/password?required=1&returnTo=...`;
- allow `/account/password`, `/logout`, `/healthz`, and `/login` while password change is required;
- add GET `/account/password`;
- add POST `/account/password` with CSRF, `accounts.changeOwnPassword`, activity recording, and redirect to safe `returnTo`.

- [ ] **Step 4: Run server auth tests**

Run:

```bash
npm test -- test/serverAuth.test.js
```

Expected: PASS.

---

### Task 4: Documentation And Full Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README**

Document:

- managed users can change passwords at `/account/password`;
- passwords created or reset by an admin are temporary;
- all managed users without a previous self-service change must change password on next login;
- env-admin password is changed only through `AUTH_ADMIN_PASSWORD`;
- minimum password requirements.

- [ ] **Step 2: Run focused tests**

Run:

```bash
npm test -- test/auth.test.js test/renderAuth.test.js test/serverAuth.test.js
```

Expected: PASS.

- [ ] **Step 3: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Check git status**

Run:

```bash
git status --short
```

Expected: only intentional files changed by this task plus pre-existing unrelated changes.
