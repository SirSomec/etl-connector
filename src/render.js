const {
  PERMISSION_DEFINITIONS,
  hasPermission
} = require('./auth');
const {
  getSqlMetricInfo,
  highlightSql
} = require('./sqlMetricInfo');

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function navLink({ href, label, id, activeNav }) {
  const className = id === activeNav ? 'nav-link active' : 'nav-link';

  return `<a class="${className}" href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
}

const NAV_LINKS = [
  {
    href: '/',
    label: 'Таблицы',
    id: 'tables',
    permission: 'tables'
  },
  {
    href: '/dashboards/sales-by-project',
    label: 'Продажи по проектам',
    id: 'sales-by-project',
    permission: 'sales-by-project'
  },
  {
    href: '/dashboards/workplace-analysis',
    label: 'Анализ точек',
    id: 'workplace-analysis',
    permission: 'workplace-analysis'
  },
  {
    href: '/dashboards/city-analysis',
    label: 'Анализ городов',
    id: 'city-analysis',
    permission: 'city-analysis'
  },
  {
    href: '/dashboards/heatmap',
    label: 'Тепловая карта',
    id: 'heatmap',
    permission: 'heatmap'
  },
  {
    href: '/dashboards/worker-cancellations',
    label: 'Отмены гигерами',
    id: 'worker-cancellations',
    permission: 'worker-cancellations'
  },
  {
    href: '/admin/users',
    label: 'Учетные записи',
    id: 'users',
    permission: 'users'
  },
  {
    href: '/admin/activity',
    label: 'Активность',
    id: 'activity',
    permission: 'admin-only'
  },
  {
    href: '/admin/preload',
    label: 'Предзагрузка',
    id: 'preload-admin',
    permission: 'preload-admin'
  }
];

function navLinksForUser(currentUser) {
  if (currentUser === undefined) {
    return NAV_LINKS;
  }

  if (!currentUser) {
    return [];
  }

  return NAV_LINKS.filter((link) => {
    if (link.permission === 'admin-only') {
      return currentUser.role === 'admin';
    }

    return hasPermission(currentUser, link.permission);
  });
}

function renderHiddenCsrf(csrfToken) {
  return `<input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken || '')}">`;
}

function canViewSqlInspector(currentUser) {
  if (currentUser === undefined) {
    return false;
  }

  return hasPermission(currentUser, 'sql-inspector');
}

function renderSqlInspectorTrigger(metricId, currentUser) {
  const info = getSqlMetricInfo(metricId);

  if (!info || !canViewSqlInspector(currentUser)) {
    return '';
  }

  return `<button type="button" class="sql-inspector-button" data-sql-inspector-open="${escapeHtml(info.id)}" aria-label="Показать SQL метрики: ${escapeHtml(info.title)}">i</button>`;
}

function renderSqlInspectorModal(metricId, currentUser) {
  const info = getSqlMetricInfo(metricId);

  if (!info || !canViewSqlInspector(currentUser)) {
    return '';
  }

  return `<div class="sql-inspector-modal" data-sql-inspector-modal="${escapeHtml(info.id)}" hidden>
  <div class="sql-inspector-backdrop" data-sql-inspector-close></div>
  <div class="sql-inspector-dialog" role="dialog" aria-modal="true" aria-labelledby="sql-inspector-title-${escapeHtml(info.id)}">
    <div class="sql-inspector-head">
      <h2 id="sql-inspector-title-${escapeHtml(info.id)}">${escapeHtml(info.title)}</h2>
      <button type="button" class="sql-inspector-close" data-sql-inspector-close aria-label="Закрыть">×</button>
    </div>
    <div class="sql-inspector-body">
      <p class="sql-inspector-description">${escapeHtml(info.description)}</p>
      <pre class="sql-code-block"><code>${highlightSql(info.sql)}</code></pre>
    </div>
  </div>
</div>`;
}

function renderSqlInspector(metricId, currentUser) {
  return `${renderSqlInspectorTrigger(metricId, currentUser)}${renderSqlInspectorModal(metricId, currentUser)}`;
}

function renderMetricInfoScope({
  className,
  metricId,
  currentUser,
  content,
  tag = 'div',
  attributes = '',
  inlineInspector = false,
  inlineClassName = 'metric-info-inline'
}) {
  const inspectorTrigger = renderSqlInspectorTrigger(metricId, currentUser);
  const inspectorModal = renderSqlInspectorModal(metricId, currentUser);
  const inspector = `${inspectorTrigger}${inspectorModal}`;
  const scopeClass = inspector ? `${className} metric-info-scope` : className;
  const attributeText = attributes ? ` ${attributes}` : '';

  if (inlineInspector && inspectorTrigger) {
    return `<${tag} class="${escapeHtml(scopeClass)}"${attributeText}><div class="${escapeHtml(inlineClassName)}">${content}${inspectorTrigger}</div>${inspectorModal}</${tag}>`;
  }

  return `<${tag} class="${escapeHtml(scopeClass)}"${attributeText}>${content}${inspector}</${tag}>`;
}

function renderMetricPanelHead(title, metricId, currentUser) {
  return `<div class="metric-panel-head">
  <h2>${escapeHtml(title)}</h2>
  ${renderSqlInspector(metricId, currentUser)}
</div>`;
}

function renderDashboardHeader({
  title,
  eyebrow = 'Дашборд',
  period = '',
  details = []
}) {
  const detailItems = [period, ...details]
    .filter((item) => String(item || '').trim() !== '')
    .map((item) => `<span>${escapeHtml(item)}</span>`)
    .join('');

  return `<div class="dashboard-header">
  <div>
    <div class="dashboard-eyebrow">${escapeHtml(eyebrow)}</div>
    <h1>${escapeHtml(title)}</h1>
  </div>
  ${detailItems ? `<div class="dashboard-meta">${detailItems}</div>` : ''}
</div>`;
}

function activeFilterChipItems(filters = {}) {
  const items = [];
  const pushArray = (label, values) => {
    for (const value of Array.isArray(values) ? values : []) {
      if (String(value || '').trim() !== '') {
        items.push(`${label}: ${value}`);
      }
    }
  };

  pushArray('Бренд', filters.client);
  pushArray('Город', filters.city);
  pushArray('Регион', filters.region);
  pushArray('Профессия', filters.profession);
  pushArray('Тип заказа', (filters.orderType || []).map(orderTypeLabel));
  pushArray('Статус', filters.jobStatus);
  pushArray('Контрагент', filters.contractor);

  if (String(filters.search || '').trim() !== '') {
    items.push(`Поиск: ${filters.search}`);
  }

  if (filters.includeDeletedOrders) {
    items.push('Удаленные включены');
  }

  if (filters.includeHiddenOrders) {
    items.push('Скрытые включены');
  }

  return items;
}

function renderActiveFilterChips(filters = {}) {
  const items = activeFilterChipItems(filters);

  if (items.length === 0) {
    return '<div class="active-filter-chips"><span class="filter-chip muted-chip">Фильтры не выбраны</span></div>';
  }

  return `<div class="active-filter-chips">${items
    .map((item) => `<span class="filter-chip">${escapeHtml(item)}</span>`)
    .join('')}</div>`;
}

function renderDashboardLoadingState(label = 'Загружается') {
  return `<div class="dashboard-loading-state"><p class="loading">${escapeHtml(label)}</p></div>`;
}

function renderDashboardEmptyState(label) {
  return `<div class="dashboard-empty-state"><p class="empty">${escapeHtml(label)}</p></div>`;
}

function renderDashboardErrorState(message) {
  return `<div class="dashboard-error-state"><div class="error">${escapeHtml(message)}</div></div>`;
}

function layout({
  title,
  database,
  content,
  activeNav = 'tables',
  currentUser,
  csrfToken = '',
  showNav = true
}) {
  const navLinks = navLinksForUser(currentUser);
  const sidebar = showNav
    ? `<aside class="sidebar" aria-label="Основная навигация">
      <div class="sidebar-title">ETL Analytics</div>
      <nav class="nav-list">
        ${navLinks.map((link) => navLink({ ...link, activeNav })).join('')}
      </nav>
    </aside>`
    : '';
  const topbarActions = currentUser
    ? `<div class="topbar-actions">
            <span class="user-email">${escapeHtml(currentUser.email)}</span>
            <form class="logout-form" action="/logout" method="post">
              ${renderHiddenCsrf(csrfToken)}
              <button class="logout-button" type="submit">Выйти</button>
            </form>
          </div>`
    : '';
  const appShellClass = showNav ? 'app-shell' : 'app-shell app-shell-plain';

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - ETL Analytics</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f8fa;
      --surface: #ffffff;
      --text: #1f2937;
      --muted: #5f6b7a;
      --line: #d6dde6;
      --link: #075cab;
      --link-bg: #eef6ff;
      --accent: #256d85;
      --accent-bg: #e8f4f6;
      --error-bg: #fff4f2;
      --error-line: #f1aaa2;
      --error-text: #a22216;
      --sidebar: #10212b;
      --sidebar-text: #e8eef2;
      --sidebar-muted: #a8b7c1;
      --sidebar-active: #ffffff;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: Arial, Helvetica, sans-serif;
      font-size: 16px;
      line-height: 1.5;
    }

    a {
      color: var(--link);
    }

    .app-shell {
      display: flex;
      min-height: 100vh;
    }

    .app-shell-plain {
      display: block;
    }

    .sidebar {
      width: 240px;
      flex: 0 0 240px;
      padding: 18px 14px;
      background: var(--sidebar);
      color: var(--sidebar-text);
    }

    .sidebar-title {
      margin-bottom: 18px;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0;
    }

    .nav-list {
      display: grid;
      gap: 6px;
    }

    .nav-link {
      display: block;
      min-height: 38px;
      padding: 8px 10px;
      border-radius: 6px;
      color: var(--sidebar-muted);
      text-decoration: none;
      overflow-wrap: anywhere;
    }

    .nav-link:hover,
    .nav-link:focus {
      background: rgba(255, 255, 255, 0.08);
      color: var(--sidebar-active);
      outline: none;
    }

    .nav-link.active {
      background: var(--sidebar-active);
      color: var(--sidebar);
      font-weight: 700;
    }

    .page-shell {
      min-width: 0;
      flex: 1;
    }

    header {
      background: var(--surface);
      border-bottom: 1px solid var(--line);
    }

    .topbar,
    main {
      width: min(1180px, calc(100% - 32px));
      margin: 0 auto;
    }

    .topbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px 18px;
      min-height: 64px;
      padding: 10px 0;
    }

    .app-title {
      font-size: 18px;
      font-weight: 700;
    }

    .topbar-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 12px;
    }

    .user-email {
      color: var(--muted);
      font-size: 14px;
      overflow-wrap: anywhere;
    }

    .logout-form {
      margin: 0;
    }

    .logout-button,
    .secondary-button {
      border-color: var(--line);
      background: var(--surface);
      color: var(--text);
    }

    .logout-button:hover,
    .logout-button:focus,
    .secondary-button:hover,
    .secondary-button:focus {
      border-color: var(--accent);
      background: var(--link-bg);
      color: var(--text);
      outline: none;
    }

    .danger-button {
      border-color: #b42318;
      background: #b42318;
      color: #ffffff;
    }

    .danger-button:hover,
    .danger-button:focus {
      border-color: #8f1d14;
      background: #8f1d14;
      color: #ffffff;
      outline: none;
    }

    .database,
    .muted,
    .empty,
    .loading,
    .technical-note {
      color: var(--muted);
    }

    main {
      padding: 28px 0 44px;
    }

    .section {
      margin-bottom: 28px;
    }

    h1,
    h2 {
      margin: 0 0 14px;
      overflow-wrap: anywhere;
    }

    h1 {
      font-size: 28px;
      line-height: 1.2;
    }

    h2 {
      font-size: 20px;
      line-height: 1.25;
    }

    .dashboard-header {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      justify-content: space-between;
      gap: 10px 18px;
      margin-bottom: 12px;
    }

    .dashboard-eyebrow {
      margin-bottom: 4px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0;
    }

    .dashboard-meta {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 6px 10px;
      color: var(--muted);
      font-size: 13px;
    }

    .dashboard-meta span {
      overflow-wrap: anywhere;
    }

    .active-filter-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: -6px 0 14px;
    }

    .filter-chip {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 3px 8px;
      border: 1px solid #c7d4df;
      border-radius: 999px;
      background: #f6f9fb;
      color: var(--text);
      font-size: 12px;
      font-weight: 700;
      overflow-wrap: anywhere;
    }

    .muted-chip {
      color: var(--muted);
      font-weight: 400;
    }

    .dashboard-loading-state,
    .dashboard-empty-state,
    .dashboard-error-state {
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
    }

    p {
      margin: 0;
    }

    .filter-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      gap: 10px;
      margin-bottom: 18px;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
    }

    .auth-page {
      display: grid;
      min-height: calc(100vh - 136px);
      align-items: center;
      justify-content: center;
    }

    .auth-card,
    .form-panel {
      width: min(100%, 460px);
      padding: 18px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
    }

    .form-panel {
      width: 100%;
      margin-bottom: 18px;
    }

    .form-grid,
    .account-row-fields {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 10px;
    }

    .auth-card .form-grid {
      grid-template-columns: 1fr;
    }

    .form-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-top: 12px;
    }

    .inline-error,
    .success {
      margin-bottom: 12px;
      padding: 10px 12px;
      border-radius: 6px;
      overflow-wrap: anywhere;
      font-size: 14px;
    }

    .inline-error {
      border: 1px solid var(--error-line);
      background: var(--error-bg);
      color: var(--error-text);
    }

    .success {
      border: 1px solid #9bd0af;
      background: #effaf3;
      color: #1f6b3a;
    }

    .permission-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 8px;
      margin-top: 8px;
    }

    .permission-option {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 8px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fbfcfd;
      font-weight: 400;
    }

    .permission-option input {
      width: 16px;
      min-height: 16px;
      margin: 2px 0 0;
      padding: 0;
    }

    .permission-option strong,
    .permission-option span {
      display: block;
      overflow-wrap: anywhere;
    }

    .permission-option span {
      margin-top: 2px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.25;
    }

    .account-list {
      display: grid;
      gap: 12px;
    }

    .account-row {
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
    }

    .account-row-head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px 12px;
      margin-bottom: 10px;
    }

    .account-title {
      font-weight: 700;
      overflow-wrap: anywhere;
    }

    .account-meta,
    .readonly-badge {
      color: var(--muted);
      font-size: 13px;
    }

    .readonly-badge {
      display: inline-block;
      padding: 2px 7px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: #f3f5f7;
    }

    .account-edit-form,
    .account-delete-form {
      margin: 0;
    }

    .account-delete-form {
      margin-top: 8px;
    }

    .activity-head {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      justify-content: space-between;
      gap: 10px 16px;
      margin-bottom: 10px;
    }

    .activity-period {
      color: var(--muted);
      font-size: 13px;
      font-weight: 700;
    }

    .activity-legend {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 7px 12px;
      margin-top: 12px;
      color: var(--muted);
      font-size: 12px;
    }

    .activity-legend-item {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      min-width: 0;
    }

    .activity-users {
      display: grid;
      gap: 8px;
    }

    .activity-user-row {
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
    }

    .activity-user-row[open] {
      border-color: #b6c7d6;
    }

    .activity-user-summary {
      display: grid;
      grid-template-columns: minmax(180px, 1.35fr) minmax(92px, auto) minmax(92px, auto) minmax(220px, 1fr) repeat(3, minmax(92px, auto));
      gap: 8px 12px;
      align-items: center;
      min-height: 52px;
      padding: 9px 12px;
      cursor: pointer;
      list-style: none;
    }

    .activity-user-summary::-webkit-details-marker {
      display: none;
    }

    .activity-user-summary:hover,
    .activity-user-summary:focus {
      background: #f5f8fb;
      outline: none;
    }

    .activity-user-name {
      min-width: 0;
      font-weight: 700;
      overflow-wrap: anywhere;
    }

    .activity-user-email {
      display: block;
      margin-top: 2px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 400;
      overflow-wrap: anywhere;
    }

    .activity-pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 24px;
      padding: 3px 7px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: #f3f5f7;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      text-align: center;
      overflow-wrap: anywhere;
    }

    .activity-metric {
      min-width: 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.25;
      overflow-wrap: anywhere;
    }

    .activity-metric strong {
      display: block;
      color: var(--text);
      font-size: 14px;
      line-height: 1.2;
    }

    .activity-day-strip {
      display: flex;
      align-items: center;
      gap: 2px;
      min-width: 0;
      overflow-x: auto;
      padding: 2px 0;
    }

    .activity-day {
      flex: 0 0 7px;
      width: 7px;
      height: 18px;
      border: 1px solid #d2d9e2;
      border-radius: 2px;
      background: #eef2f6;
    }

    .activity-day[data-activity-level="view"] {
      border-color: #95b8d8;
      background: #b9d8f0;
    }

    .activity-day[data-activity-level="work"] {
      border-color: #78b58d;
      background: #8fd0a3;
    }

    .activity-day[data-activity-level="intense"] {
      border-color: #bf7b4d;
      background: #e49a5e;
    }

    .activity-day[data-activity-level="none"] {
      border-color: #d2d9e2;
      background: #eef2f6;
    }

    .activity-details {
      padding: 0 12px 12px;
    }

    .activity-event-table {
      min-width: 720px;
    }

    .activity-event-table th,
    .activity-event-table td {
      padding: 7px 8px;
      font-size: 12px;
      line-height: 1.3;
    }

    .activity-path-cell {
      max-width: 420px;
      overflow-wrap: anywhere;
    }

    .activity-disabled {
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
      color: var(--muted);
    }

    .field {
      display: grid;
      gap: 4px;
    }

    label {
      font-size: 13px;
      font-weight: 700;
      color: var(--muted);
    }

    select,
    input,
    button {
      min-height: 36px;
      border: 1px solid var(--line);
      border-radius: 6px;
      font: inherit;
      font-size: 14px;
    }

    select,
    input {
      padding: 6px 8px;
      background: var(--surface);
      color: var(--text);
    }

    .filter-field {
      min-width: 190px;
    }

    .multi-filter {
      position: relative;
    }

    .multi-filter-trigger {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      width: 100%;
      min-width: 190px;
      padding: 6px 8px;
      border-color: var(--line);
      background: var(--surface);
      color: var(--text);
      text-align: left;
    }

    .multi-filter-trigger:hover,
    .multi-filter-trigger:focus {
      border-color: var(--accent);
      background: var(--surface);
      color: var(--text);
      outline: none;
    }

    .multi-filter-trigger-label,
    .multi-filter-summary {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .multi-filter-trigger-label {
      min-width: 0;
      font-weight: 700;
    }

    .multi-filter-summary {
      flex: 0 0 auto;
      color: var(--muted);
      font-size: 13px;
    }

    .multi-filter-panel {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      z-index: 20;
      width: max(260px, 100%);
      padding: 8px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
      box-shadow: 0 14px 32px rgba(31, 41, 55, 0.16);
    }

    .multi-filter-panel[hidden],
    .multi-filter-option[hidden] {
      display: none;
    }

    .multi-filter-search {
      width: 100%;
      margin-bottom: 8px;
    }

    .multi-filter-options {
      display: grid;
      gap: 2px;
      max-height: 190px;
      overflow: auto;
    }

    .multi-filter-option {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 30px;
      padding: 5px 6px;
      border-radius: 4px;
      color: var(--text);
      font-weight: 400;
    }

    .multi-filter-option:hover,
    .multi-filter-option:focus-within {
      background: var(--link-bg);
    }

    .multi-filter-option input[type="checkbox"] {
      width: 16px;
      min-height: 16px;
      margin: 0;
      padding: 0;
    }

    .checkbox-field {
      min-height: 36px;
      align-content: end;
    }

    .checkbox-label {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 36px;
      color: var(--text);
    }

    .checkbox-label input[type="checkbox"] {
      width: 16px;
      min-height: 16px;
      margin: 0;
      padding: 0;
    }

    .metric-range-field {
      width: 116px;
    }

    .worker-search-field {
      flex: 1 1 260px;
      min-width: 260px;
    }

    .workplace-search-field {
      flex: 1 1 260px;
      min-width: 260px;
    }

    .metric-range-input {
      width: 100%;
    }

    .multi-filter-option span {
      min-width: 0;
      overflow-wrap: anywhere;
    }

    .multi-filter-empty {
      padding: 6px;
      color: var(--muted);
      font-size: 13px;
    }

    .multi-filter-clear {
      width: 100%;
      margin-top: 8px;
      padding: 5px 8px;
      border-color: var(--line);
      background: var(--surface);
      color: var(--text);
    }

    .multi-filter-clear:hover,
    .multi-filter-clear:focus {
      border-color: var(--accent);
      background: var(--link-bg);
      color: var(--text);
      outline: none;
    }

    button {
      padding: 6px 14px;
      border-color: var(--accent);
      background: var(--accent);
      color: #ffffff;
      cursor: pointer;
    }

    button:hover,
    button:focus {
      background: #1d5b70;
      outline: none;
    }

    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 10px;
      margin-bottom: 24px;
    }

    .kpi-card {
      min-height: 78px;
      padding: 11px 12px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
    }

    .kpi-label {
      margin-bottom: 6px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 700;
      overflow-wrap: anywhere;
    }

    .kpi-value {
      font-size: 24px;
      font-weight: 700;
      line-height: 1.15;
      overflow-wrap: anywhere;
    }

    .kpi-subvalue {
      margin-top: 4px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.25;
      overflow-wrap: anywhere;
    }

    .metric-panel-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
    }

    .metric-panel-head h2 {
      margin-bottom: 14px;
    }

    .metric-info-scope {
      position: relative;
    }

    .metric-info-scope > .sql-inspector-button {
      position: absolute;
      top: 6px;
      right: 6px;
      z-index: 2;
    }

    .metric-info-scope .kpi-value,
    .metric-info-scope .point-metric-value,
    .metric-info-scope .mini-chart-value,
    .metric-info-scope .compact-value,
    .metric-info-scope .city-metric-value,
    .metric-info-scope .city-funnel-value {
      padding-right: 24px;
    }

    .mini-panel-title.metric-info-scope,
    .metric-info-scope .mini-meta,
    .city-funnel-meta.metric-info-scope {
      padding-right: 24px;
    }

    td.metric-info-scope {
      padding-right: 32px;
    }

    .sql-inspector-button {
      width: 22px;
      min-width: 22px;
      min-height: 22px;
      padding: 0;
      border-color: var(--line);
      border-radius: 50%;
      background: #f0f2f4;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      line-height: 1;
    }

    .sql-inspector-button:hover,
    .sql-inspector-button:focus {
      border-color: var(--accent);
      background: var(--link-bg);
      color: var(--text);
      outline: none;
    }

    .sql-inspector-modal[hidden] {
      display: none;
    }

    .sql-inspector-modal {
      position: fixed;
      inset: 0;
      z-index: 80;
      display: grid;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }

    .sql-inspector-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(16, 33, 43, 0.42);
    }

    .sql-inspector-dialog {
      position: relative;
      width: min(900px, calc(100vw - 32px));
      max-height: calc(100vh - 48px);
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
      box-shadow: 0 18px 50px rgba(31, 41, 55, 0.24);
    }

    .sql-inspector-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--line);
      background: var(--surface);
    }

    .sql-inspector-head h2 {
      margin: 0;
      font-size: 18px;
    }

    .sql-inspector-close {
      width: 34px;
      min-width: 34px;
      padding: 0;
      border-color: var(--line);
      background: var(--surface);
      color: var(--text);
      font-size: 22px;
      line-height: 1;
    }

    .sql-inspector-body {
      max-height: calc(100vh - 126px);
      overflow: auto;
      padding: 16px;
    }

    .sql-inspector-description {
      margin-bottom: 12px;
      color: var(--text);
    }

    .sql-code-block {
      margin: 0;
      overflow: auto;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #0f1720;
      color: #d8e2ea;
      font-family: Consolas, "Liberation Mono", monospace;
      font-size: 13px;
      line-height: 1.45;
    }

    .sql-keyword {
      color: #8bd3ff;
      font-weight: 700;
    }

    .sql-param {
      color: #f5c16c;
    }

    .sql-string {
      color: #9bd48b;
    }

    .table-list {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 8px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .table-link {
      display: block;
      min-height: 42px;
      padding: 9px 11px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
      overflow-wrap: anywhere;
      text-decoration: none;
    }

    .table-link:hover,
    .table-link:focus {
      border-color: var(--link);
      background: var(--link-bg);
      outline: none;
    }

    .back-link {
      display: inline-block;
      margin-bottom: 12px;
    }

    .table-wrap {
      overflow-x: auto;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
    }

    .table-scroll {
      max-width: 100%;
      overflow-x: auto;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
    }

    table {
      width: 100%;
      min-width: 560px;
      border-collapse: collapse;
    }

    th,
    td {
      padding: 9px 10px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
      font-size: 14px;
      overflow-wrap: anywhere;
    }

    th {
      background: #eef2f6;
      font-weight: 700;
    }

    .sortable-header {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: var(--text);
      text-decoration: none;
    }

    .sortable-header:hover,
    .sortable-header:focus {
      color: var(--link);
      outline: none;
    }

    .sort-indicator {
      color: var(--muted);
      font-size: 12px;
    }

    tr:last-child td {
      border-bottom: 0;
    }

    .number-cell {
      text-align: right;
      white-space: nowrap;
    }

    .attention-table {
      width: 100%;
      min-width: 0;
      table-layout: fixed;
    }

    .attention-table-wrap {
      max-width: 100%;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
    }

    .attention-table th,
    .attention-table td {
      padding: 8px 7px;
      font-size: 12px;
      overflow-wrap: anywhere;
      word-break: normal;
    }

    .attention-table .sortable-header {
      align-items: flex-start;
      white-space: normal;
    }

    .attention-point-cell {
      width: 18%;
    }

    .attention-risk-cell {
      width: 8%;
    }

    .attention-stack-cell {
      width: 12%;
    }

    .attention-reason-cell {
      width: 14%;
    }

    .attention-table .muted {
      margin-top: 3px;
      font-size: 11px;
      line-height: 1.25;
    }

    .attention-table td.metric-info-scope {
      padding-right: 7px;
    }

    .attention-metric-inline {
      display: flex;
      align-items: flex-start;
      justify-content: flex-end;
      gap: 6px;
      min-width: 0;
    }

    .attention-metric-inline > .sql-inspector-button {
      position: static;
      flex: 0 0 auto;
      margin-top: -2px;
    }

    .attention-metric-content {
      min-width: 0;
      flex: 1 1 auto;
    }

    .attention-status-breakdown,
    .attention-profession-breakdown {
      display: grid;
      gap: 2px;
      margin-top: 4px;
      white-space: normal;
    }

    .attention-status-line,
    .attention-profession-line {
      display: block;
    }

    .risk-badge,
    .attention-reason {
      display: inline-flex;
      align-items: center;
      min-height: 22px;
      padding: 2px 7px;
      border: 1px solid var(--line);
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      white-space: nowrap;
    }

    .risk-high {
      border-color: #d49386;
      background: #fff0ed;
      color: #9f2a1d;
    }

    .risk-medium {
      border-color: #ddbf75;
      background: #fff8e6;
      color: #7a5400;
    }

    .risk-low {
      border-color: #a8cdb6;
      background: #effaf3;
      color: #24613a;
    }

    .attention-reasons {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      min-width: 0;
    }

    .attention-reason {
      background: #f6f9fb;
      color: var(--text);
      font-weight: 600;
      white-space: normal;
    }

    .attention-reason-muted {
      color: var(--muted);
      font-weight: 400;
    }

    .phone-cell,
    .nowrap-cell {
      white-space: nowrap;
    }

    .metric-detail-trigger {
      width: auto;
      min-height: 0;
      padding: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
      color: var(--link);
      font: inherit;
      font-weight: 700;
      text-align: right;
      text-decoration: underline;
      text-underline-offset: 2px;
      cursor: pointer;
    }

    .metric-detail-trigger:hover,
    .metric-detail-trigger:focus {
      background: transparent;
      color: var(--accent);
      outline: none;
    }

    .giger-list-modal[hidden],
    .worker-cancellation-modal[hidden],
    .workplace-point-day-modal[hidden],
    .workplace-point-review-modal[hidden] {
      display: none;
    }

    .giger-list-modal,
    .worker-cancellation-modal,
    .workplace-point-day-modal,
    .workplace-point-review-modal {
      position: fixed;
      inset: 0;
      z-index: 60;
      display: grid;
      align-items: center;
      padding: 24px;
    }

    .giger-list-modal-backdrop,
    .worker-cancellation-modal-backdrop,
    .workplace-point-day-modal-backdrop,
    .workplace-point-review-modal-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(16, 33, 43, 0.42);
    }

    .giger-list-modal-dialog,
    .worker-cancellation-modal-dialog,
    .workplace-point-day-modal-dialog,
    .workplace-point-review-modal-dialog {
      position: relative;
      width: min(1120px, 100%);
      max-height: calc(100vh - 48px);
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
      box-shadow: 0 18px 50px rgba(31, 41, 55, 0.24);
    }

    .workplace-point-day-modal-dialog {
      width: min(1320px, 100%);
    }

    .workplace-point-review-modal-dialog {
      width: min(1280px, 100%);
    }

    .giger-list-modal-head,
    .worker-cancellation-modal-head,
    .workplace-point-day-modal-head,
    .workplace-point-review-modal-head {
      position: sticky;
      top: 0;
      z-index: 1;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--line);
      background: var(--surface);
    }

    .giger-list-modal-head h2,
    .worker-cancellation-modal-head h2,
    .workplace-point-day-modal-head h2,
    .workplace-point-review-modal-head h2 {
      margin: 0;
      font-size: 18px;
    }

    .giger-list-modal-close,
    .worker-cancellation-modal-close,
    .workplace-point-day-modal-close,
    .workplace-point-review-modal-close {
      width: 36px;
      min-width: 36px;
      padding: 0;
      border-color: var(--line);
      background: var(--surface);
      color: var(--text);
      font-size: 22px;
      line-height: 1;
    }

    .giger-list-modal-close:hover,
    .giger-list-modal-close:focus,
    .worker-cancellation-modal-close:hover,
    .worker-cancellation-modal-close:focus,
    .workplace-point-day-modal-close:hover,
    .workplace-point-day-modal-close:focus,
    .workplace-point-review-modal-close:hover,
    .workplace-point-review-modal-close:focus {
      border-color: var(--accent);
      background: var(--link-bg);
      color: var(--text);
    }

    .giger-list-modal-body,
    .worker-cancellation-modal-body,
    .workplace-point-day-modal-body,
    .workplace-point-review-modal-body {
      padding: 16px;
    }

    .kpi-card[data-workplace-point-review-trigger] {
      cursor: pointer;
    }

    .kpi-card[data-workplace-point-review-trigger]:hover,
    .kpi-card[data-workplace-point-review-trigger]:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 2px var(--link-bg);
      outline: none;
    }

    .review-text-cell {
      min-width: 280px;
      max-width: 560px;
      white-space: normal;
    }

    .giger-details-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 10px 14px;
      margin-bottom: 12px;
    }

    .giger-details-head h2 {
      margin: 0;
      font-size: 18px;
    }

    .giger-details-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }

    .giger-details-table th,
    .giger-details-table td {
      white-space: nowrap;
    }

    .worker-cancellation-details,
    .workplace-point-day-details {
      display: grid;
      gap: 12px;
    }

    .worker-cancellation-details h2,
    .workplace-point-day-details h2 {
      margin: 0;
      font-size: 18px;
    }

    .compact-detail-table-wrap {
      overflow-x: auto;
    }

    .compact-detail-table {
      width: 100%;
      min-width: 1200px;
      table-layout: fixed;
    }

    .compact-detail-table .order-id-col {
      width: 8%;
    }

    .compact-detail-table .profession-col {
      width: 10%;
    }

    .compact-detail-table .start-col {
      width: 9%;
    }

    .compact-detail-table .hours-col {
      width: 5%;
    }

    .compact-detail-table .worker-col {
      width: 10%;
    }

    .compact-detail-table .phone-col {
      width: 9%;
    }

    .compact-detail-table .status-col {
      width: 7%;
    }

    .compact-detail-table .actual-hours-col {
      width: 6%;
    }

    .compact-detail-table .actual-time-col {
      width: 16%;
    }

    .compact-detail-table .payment-col {
      width: 8%;
    }

    .compact-detail-table .cancelled-col {
      width: 6%;
    }

    .compact-detail-table .last-cancelled-col {
      width: 6%;
    }

    .compact-detail-table th,
    .compact-detail-table td {
      padding: 7px 8px;
      font-size: 12px;
      line-height: 1.25;
      vertical-align: middle;
    }

    .compact-detail-table .compact-text-cell {
      max-width: 150px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .compact-detail-table .actual-time-cell {
      overflow-wrap: anywhere;
      white-space: normal;
    }

    .bar-cell {
      min-width: 130px;
    }

    .bar-track {
      width: 100%;
      height: 10px;
      border-radius: 999px;
      background: #dce6ed;
      overflow: hidden;
    }

    .bar-fill {
      height: 100%;
      border-radius: 999px;
      background: var(--accent);
    }

    .mini-panels-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 12px;
    }

    .mini-panel {
      min-width: 0;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
    }

    .mini-panel h3 {
      margin: 0 0 10px;
      font-size: 15px;
      line-height: 1.25;
      overflow-wrap: anywhere;
    }

    .mini-bar-list {
      display: grid;
      gap: 9px;
    }

    .mini-row-head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: 2px 10px;
      margin-bottom: 4px;
      font-size: 13px;
    }

    .mini-label {
      min-width: 0;
      font-weight: 700;
      overflow-wrap: anywhere;
    }

    .mini-meta {
      flex: 0 1 auto;
      min-width: 0;
      max-width: 100%;
      color: var(--muted);
      text-align: right;
      overflow-wrap: anywhere;
    }

    .mini-bar-track {
      width: 100%;
      height: 8px;
      border-radius: 999px;
      background: #dce6ed;
      overflow: hidden;
    }

    .mini-bar-fill {
      height: 100%;
      border-radius: 999px;
      background: var(--accent);
    }

    .city-dynamics-tabs {
      display: grid;
      gap: 12px;
    }

    .city-dynamics-tab-input {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }

    .city-dynamics-tab-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .city-dynamics-tab {
      min-height: 34px;
      padding: 6px 10px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
      color: var(--text);
      cursor: pointer;
      font-size: 13px;
      font-weight: 700;
    }

    .city-dynamics-tab:hover,
    .city-dynamics-tab:focus-within {
      border-color: var(--accent);
      background: var(--accent-bg);
    }

    .city-dynamics-panel {
      display: none;
    }

    #city-dynamics-tab-combo:checked ~ .city-dynamics-tab-list label[for="city-dynamics-tab-combo"],
    #city-dynamics-tab-multiples:checked ~ .city-dynamics-tab-list label[for="city-dynamics-tab-multiples"],
    #city-dynamics-tab-heatmap:checked ~ .city-dynamics-tab-list label[for="city-dynamics-tab-heatmap"],
    #city-dynamics-tab-funnel:checked ~ .city-dynamics-tab-list label[for="city-dynamics-tab-funnel"],
    #city-dynamics-tab-index:checked ~ .city-dynamics-tab-list label[for="city-dynamics-tab-index"] {
      border-color: var(--accent);
      background: var(--accent);
      color: #ffffff;
    }

    #city-dynamics-tab-combo:checked ~ .city-dynamics-panels .city-dynamics-panel-combo,
    #city-dynamics-tab-multiples:checked ~ .city-dynamics-panels .city-dynamics-panel-multiples,
    #city-dynamics-tab-heatmap:checked ~ .city-dynamics-panels .city-dynamics-panel-heatmap,
    #city-dynamics-tab-funnel:checked ~ .city-dynamics-panels .city-dynamics-panel-funnel,
    #city-dynamics-tab-index:checked ~ .city-dynamics-panels .city-dynamics-panel-index {
      display: block;
    }

    .city-combo-chart,
    .city-funnel-list,
    .city-index-chart,
    .city-heatmap {
      min-width: 0;
    }

    .city-combo-chart,
    .city-funnel-list,
    .city-index-chart {
      display: grid;
      gap: 10px;
    }

    .city-combo-row,
    .city-funnel-day {
      display: grid;
      grid-template-columns: minmax(88px, 116px) minmax(0, 1fr);
      gap: 10px;
      align-items: start;
    }

    .city-combo-date,
    .city-funnel-date,
    .city-index-label,
    .city-heatmap-label {
      color: var(--text);
      font-size: 13px;
      font-weight: 700;
      overflow-wrap: anywhere;
    }

    .city-combo-main,
    .city-funnel-main {
      display: grid;
      gap: 5px;
      min-width: 0;
    }

    .city-combo-demand,
    .city-metric-line,
    .city-funnel-step {
      display: grid;
      grid-template-columns: minmax(72px, 112px) minmax(0, 1fr) auto;
      gap: 7px;
      align-items: center;
      min-height: 20px;
      font-size: 12px;
    }

    .city-combo-demand strong,
    .city-metric-value,
    .city-funnel-value {
      color: var(--muted);
      font-size: 12px;
      white-space: nowrap;
    }

    .city-metric-track,
    .city-funnel-track,
    .city-combo-demand-track {
      height: 8px;
      border-radius: 999px;
      background: #dce6ed;
      overflow: hidden;
    }

    .city-combo-demand-fill,
    .city-metric-fill,
    .city-funnel-fill {
      height: 100%;
      border-radius: 999px;
    }

    .city-series-demand { background: #256d85; }
    .city-series-app { background: #2f855a; }
    .city-series-booked { background: #b7791f; }
    .city-series-completed { background: #7f5a83; }
    .city-series-ratio { background: #4b5563; }

    .city-heatmap-scroll,
    .city-index-scroll {
      overflow-x: auto;
    }

    .city-heatmap-grid {
      display: grid;
      gap: 4px;
      min-width: max-content;
    }

    .city-heatmap-row {
      display: grid;
      gap: 4px;
      align-items: center;
    }

    .city-heatmap-cell {
      min-width: 30px;
      min-height: 28px;
      border: 1px solid var(--line);
      border-radius: 4px;
      background: #f3f5f7;
    }

    .city-heatmap-cell[data-level="1"] { background: #dbeafe; border-color: #bfdbfe; }
    .city-heatmap-cell[data-level="2"] { background: #bfdbfe; border-color: #93c5fd; }
    .city-heatmap-cell[data-level="3"] { background: #93c5fd; border-color: #60a5fa; }
    .city-heatmap-cell[data-level="4"] { background: #3b82f6; border-color: #2563eb; }

    .city-funnel-meta {
      color: var(--muted);
      font-size: 12px;
    }

    .city-index-row {
      display: grid;
      grid-template-columns: minmax(110px, 140px) minmax(0, 1fr);
      gap: 10px;
      align-items: end;
    }

    .city-index-cells {
      display: grid;
      gap: 4px;
      min-width: max-content;
      align-items: end;
    }

    .city-index-cell {
      position: relative;
      display: flex;
      align-items: end;
      justify-content: center;
      width: 28px;
      height: 58px;
      border: 1px solid var(--line);
      border-radius: 4px;
      background: #f3f5f7;
      overflow: hidden;
    }

    .city-index-fill {
      width: 100%;
      min-height: 2px;
      border-radius: 3px 3px 0 0;
    }

    .checkbox-field input[type="checkbox"] {
      width: 16px;
      min-height: 16px;
      margin: 0;
      padding: 0;
    }

    .error {
      border: 1px solid var(--error-line);
      border-radius: 6px;
      padding: 12px;
      background: var(--error-bg);
      color: var(--error-text);
      overflow-wrap: anywhere;
    }

    .context-line {
      margin-top: 8px;
      color: var(--muted);
      font-size: 14px;
    }

    .detail-header {
      display: grid;
      gap: 4px;
    }

    .point-card-link {
      display: block;
      color: inherit;
      text-decoration: none;
    }

    .point-card-link:hover,
    .point-card-link:focus {
      border-color: var(--accent);
      background: #fbfdff;
    }

    .points-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 12px;
    }

    .dashboard-tabs {
      display: grid;
      gap: 12px;
    }

    .dashboard-tab-input {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }

    .dashboard-tab-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      border-bottom: 1px solid var(--line);
    }

    .dashboard-tab {
      display: inline-flex;
      align-items: center;
      min-height: 36px;
      padding: 7px 10px;
      border: 1px solid var(--line);
      border-bottom: 0;
      border-radius: 6px 6px 0 0;
      background: #f3f5f7;
      color: var(--muted);
      cursor: pointer;
    }

    .dashboard-tab-panel {
      display: none;
    }

    #workplace-tab-points:checked ~ .dashboard-tab-list label[for="workplace-tab-points"],
    #workplace-tab-attention:checked ~ .dashboard-tab-list label[for="workplace-tab-attention"] {
      background: var(--surface);
      color: var(--text);
      font-weight: 700;
    }

    #workplace-tab-points:checked ~ .dashboard-tab-panels .dashboard-tab-panel-points,
    #workplace-tab-attention:checked ~ .dashboard-tab-panels .dashboard-tab-panel-attention {
      display: block;
    }

    .point-card {
      min-width: 0;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
    }

    .point-card.pinned {
      border-color: #94a3b8;
      background: #f8fafc;
    }

    .point-card-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 8px;
    }

    .point-card-title-block {
      min-width: 0;
    }

    .point-title {
      font-weight: 700;
      line-height: 1.25;
      overflow-wrap: anywhere;
    }

    .point-pin-form {
      flex: 0 0 auto;
      margin: 0;
    }

    .point-pin-label {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--muted);
      cursor: pointer;
      font-size: 12px;
      font-weight: 700;
      line-height: 1.2;
      white-space: nowrap;
    }

    .point-pin-label input {
      width: 16px;
      height: 16px;
      margin: 0;
    }

    .point-metrics {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
      margin-bottom: 10px;
    }

    .point-metric {
      min-width: 0;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 6px;
      background: #fbfcfd;
    }

    .point-metric-label {
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
    }

    .point-metric-value {
      margin-top: 2px;
      font-size: 15px;
      font-weight: 700;
      overflow-wrap: anywhere;
    }

    .heatmap {
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: 10px;
      grid-template-rows: repeat(7, 10px);
      gap: 3px;
      justify-content: start;
      overflow-x: auto;
    }

    .heatmap-cell {
      width: 10px;
      height: 10px;
      border-radius: 2px;
      background: #e5e7eb;
    }

    .heatmap-cell.empty {
      background: transparent;
    }

    .heatmap-cell[data-level="1"] { background: #bfdbfe; }
    .heatmap-cell[data-level="2"] { background: #60a5fa; }
    .heatmap-cell[data-level="3"] { background: #2563eb; }
    .heatmap-cell[data-level="4"] { background: #1d4ed8; }

    .heatmap-cell.is-current-day {
      outline: 2px solid #111827;
      outline-offset: 1px;
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.9);
    }

    .detail-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 14px;
    }

    .detail-panel {
      min-width: 0;
    }

    .point-detail-grid {
      align-items: start;
      grid-template-columns: minmax(0, 1fr) minmax(260px, 0.32fr);
    }

    .calendar-panel {
      min-width: 0;
    }

    .point-calendar {
      display: grid;
      gap: 14px;
      overflow-x: auto;
    }

    .point-calendar-month {
      display: grid;
      gap: 6px;
    }

    .point-calendar-month-title {
      margin: 0;
      color: var(--text);
      font-size: 16px;
      line-height: 1.25;
    }

    .point-calendar-weekdays,
    .point-calendar-grid {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      gap: 5px;
      min-width: 0;
    }

    .point-calendar-weekdays {
      margin-bottom: 6px;
    }

    .point-calendar-weekday {
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      text-align: center;
    }

    .point-calendar-cell {
      min-width: 0;
      min-height: 82px;
      padding: 6px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fbfcfd;
    }

    .point-calendar-cell-button {
      display: block;
      width: 100%;
      min-height: 68px;
      padding: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }

    .point-calendar-cell-button:hover,
    .point-calendar-cell-button:focus {
      background: transparent;
      color: inherit;
      outline: none;
    }

    .point-calendar-cell:focus-within {
      border-color: var(--accent);
      box-shadow: inset 0 0 0 2px rgba(37, 109, 133, 0.42);
    }

    .point-calendar-cell.empty {
      border-style: dashed;
      background: transparent;
    }

    .point-calendar-cell[data-sla-level="1"] {
      border-color: rgba(248, 113, 113, 0.28);
      background: rgba(248, 113, 113, 0.18);
    }

    .point-calendar-cell[data-sla-level="2"] {
      border-color: rgba(251, 146, 60, 0.28);
      background: rgba(251, 146, 60, 0.17);
    }

    .point-calendar-cell[data-sla-level="3"] {
      border-color: rgba(250, 204, 21, 0.30);
      background: rgba(250, 204, 21, 0.16);
    }

    .point-calendar-cell[data-sla-level="4"] {
      border-color: rgba(132, 204, 22, 0.28);
      background: rgba(132, 204, 22, 0.16);
    }

    .point-calendar-cell[data-sla-level="5"] {
      border-color: rgba(34, 197, 94, 0.30);
      background: rgba(34, 197, 94, 0.18);
    }

    .point-calendar-cell.is-current-day {
      border-color: #111827;
      box-shadow: inset 0 0 0 2px rgba(17, 24, 39, 0.78), 0 0 0 1px rgba(255, 255, 255, 0.9);
    }

    .point-calendar-date {
      margin-bottom: 4px;
      color: var(--text);
      font-size: 12px;
      font-weight: 700;
      line-height: 1.2;
    }

    .point-calendar-values {
      display: grid;
      gap: 3px;
    }

    .point-calendar-value {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      align-items: baseline;
      gap: 2px;
      font-size: 10px;
      line-height: 1.1;
    }

    .point-calendar-value span {
      color: var(--muted);
      font-weight: 700;
    }

    .point-calendar-value strong {
      min-width: 0;
      font-size: 10px;
      overflow-wrap: anywhere;
      white-space: nowrap;
    }

    .mini-chart {
      display: grid;
      gap: 8px;
    }

    .mini-chart-row {
      display: grid;
      grid-template-columns: minmax(92px, 132px) minmax(0, 1fr) auto;
      align-items: center;
      gap: 8px;
      min-height: 28px;
      font-size: 14px;
    }

    .mini-chart-label {
      overflow-wrap: anywhere;
    }

    .mini-chart-value {
      color: var(--muted);
      white-space: nowrap;
    }

    .mini-chart-track {
      min-width: 0;
      height: 10px;
      border-radius: 999px;
      background: #dce6ed;
      overflow: hidden;
    }

    .mini-chart-fill {
      height: 100%;
      border-radius: 999px;
      background: var(--accent);
    }

    .mini-chart-fill.secondary {
      background: #4b5563;
    }

    .compact-value-list {
      display: grid;
      gap: 8px;
    }

    .compact-value-row {
      display: grid;
      grid-template-columns: minmax(92px, 1fr) auto;
      align-items: center;
      gap: 8px;
      min-height: 28px;
      font-size: 14px;
    }

    .compact-value {
      color: var(--muted);
      font-weight: 700;
      text-align: right;
      white-space: nowrap;
    }

    .pagination {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-top: 14px;
      padding-top: 12px;
      border-top: 1px solid var(--line);
    }

    .pagination-meta {
      color: var(--muted);
      font-size: 14px;
      font-weight: 700;
    }

    .pagination-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .pagination-pages {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
    }

    .pagination-link {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 36px;
      padding: 6px 11px;
      border: 1px solid var(--accent);
      border-radius: 6px;
      background: var(--surface);
      color: var(--accent);
      font-size: 14px;
      font-weight: 700;
      text-decoration: none;
    }

    .pagination-link:hover,
    .pagination-link:focus {
      background: var(--accent-bg);
      outline: none;
    }

    .pagination-link.disabled {
      border-color: var(--line);
      color: var(--muted);
      pointer-events: none;
    }

    .pagination-page {
      min-width: 36px;
      padding: 6px 8px;
    }

    .pagination-current {
      background: var(--accent);
      color: #ffffff;
      pointer-events: none;
    }

    .pagination-ellipsis {
      display: inline-flex;
      align-items: center;
      min-height: 36px;
      color: var(--muted);
      font-weight: 700;
    }

    .pagination-jump {
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      gap: 6px;
    }

    .pagination-jump .field {
      gap: 3px;
    }

    .pagination-page-input {
      width: 88px;
    }

    .heatmap-mode-group {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      min-width: 280px;
    }

    .heatmap-mode-option {
      display: flex;
      align-items: center;
      gap: 6px;
      min-height: 36px;
      padding: 6px 9px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
      color: var(--text);
      font-size: 13px;
      font-weight: 700;
    }

    .heatmap-mode-option:has(input:checked) {
      border-color: var(--accent);
      background: var(--accent-bg);
      color: var(--text);
    }

    .heatmap-mode-option input {
      width: 16px;
      min-height: 16px;
      margin: 0;
      padding: 0;
    }

    .country-heatmap-layout {
      display: grid;
      grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.8fr);
      gap: 14px;
      align-items: start;
    }

    .country-heatmap-panel {
      min-width: 0;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
    }

    .country-heatmap-map-wrap {
      overflow-x: auto;
    }

    .country-heatmap-map {
      display: block;
      width: 100%;
      min-width: 620px;
      height: 560px;
      min-height: 420px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #f5f8fb;
    }

    .country-heatmap-land {
      fill: #e9eef3;
      stroke: #c9d3df;
      stroke-width: 1;
    }

    .country-heatmap-gridline {
      stroke: #d7e0ea;
      stroke-width: 1;
    }

    .country-heatmap-region {
      fill: var(--region-color);
      stroke: #ffffff;
      stroke-width: 2;
    }

    .country-heatmap-region[data-balance-level="no-order"] {
      stroke: #aeb8c4;
      stroke-dasharray: 3 3;
    }

    .country-heatmap-label {
      fill: var(--text);
      font-size: 12px;
      font-weight: 700;
      paint-order: stroke;
      stroke: #ffffff;
      stroke-width: 3px;
      stroke-linejoin: round;
    }

    .heatmap-legend {
      display: grid;
      gap: 8px;
      margin-top: 10px;
    }

    .heatmap-gradient {
      height: 12px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: linear-gradient(90deg, #b42318, #d8a100, #16803a);
    }

    .heatmap-legend-labels {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      color: var(--muted);
      font-size: 12px;
    }

    @media (max-width: 980px) {
      .country-heatmap-layout {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 1120px) {
      .point-detail-grid {
        grid-template-columns: 1fr;
      }

      .activity-user-summary {
        grid-template-columns: minmax(180px, 1fr) minmax(90px, auto) minmax(90px, auto);
      }

      .activity-day-strip {
        grid-column: 1 / -1;
        width: 100%;
      }

      .activity-event-table {
        min-width: 640px;
      }
    }

    @media (max-width: 820px) {
      .app-shell {
        display: block;
      }

      .sidebar {
        width: auto;
        padding: 12px 10px;
      }

      .sidebar-title {
        margin-bottom: 10px;
      }

      .nav-list {
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      }

      .activity-user-summary {
        grid-template-columns: 1fr;
      }

      .activity-day-strip {
        width: 100%;
      }
    }

    @media (max-width: 640px) {
      .topbar,
      main {
        width: min(100% - 20px, 1180px);
      }

      .topbar {
        align-items: flex-start;
        flex-direction: column;
      }

      h1 {
        font-size: 23px;
      }

      .filter-bar {
        align-items: stretch;
        flex-direction: column;
      }

      .worker-search-field,
      .workplace-search-field,
      .metric-range-field {
        width: 100%;
        min-width: 0;
      }

      button {
        width: 100%;
      }

      .metric-detail-trigger,
      .giger-list-modal-close,
      .worker-cancellation-modal-close,
      .workplace-point-day-modal-close,
      .workplace-point-review-modal-close {
        width: auto;
      }

      .giger-list-modal,
      .worker-cancellation-modal,
      .workplace-point-day-modal,
      .workplace-point-review-modal {
        padding: 10px;
      }

      .giger-list-modal-dialog,
      .worker-cancellation-modal-dialog,
      .workplace-point-day-modal-dialog,
      .workplace-point-review-modal-dialog {
        max-height: calc(100vh - 20px);
      }
    }
  </style>
</head>
<body>
  <div class="${appShellClass}">
    ${sidebar}
    <div class="page-shell">
      <header>
        <div class="topbar">
          <div class="app-title">ETL Analytics</div>
          <div class="database">Database: ${escapeHtml(database)}</div>
          ${topbarActions}
        </div>
      </header>
      <main>${content}</main>
    </div>
  </div>
  ${content.includes('data-multi-filter') ? renderMultiFilterScript() : ''}
  ${content.includes('data-workplace-suggest-url') ? renderWorkplaceSuggestScript() : ''}
  ${
    content.includes('data-dashboard-fragment-url') || content.includes('data-city-analysis-fragment-url')
      ? renderDashboardProgressiveScript()
      : ''
  }
  ${content.includes('data-worker-cancellation-modal') ? renderWorkerCancellationDetailsScript() : ''}
  ${content.includes('data-giger-list-modal') ? renderGigerDetailsScript() : ''}
  ${content.includes('data-workplace-point-day-modal') ? renderWorkplacePointDayDetailsScript() : ''}
  ${content.includes('data-workplace-point-review-modal') ? renderWorkplacePointReviewsScript() : ''}
  ${content.includes('data-sql-inspector-modal') || canViewSqlInspector(currentUser) ? renderSqlInspectorScript() : ''}
</body>
</html>`;
}

function renderMultiFilterScript() {
  return `<script>
(function () {
  function closeMultiFilter(root) {
    var panel = root.querySelector('[data-multi-filter-panel]');
    var trigger = root.querySelector('[data-multi-filter-trigger]');

    if (!panel || !trigger) {
      return;
    }

    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  }

  function updateMultiFilterSummary(root) {
    var summary = root.querySelector('[data-multi-filter-summary]');
    var checkedCount = root.querySelectorAll('[data-multi-filter-checkbox]:checked').length;

    if (!summary) {
      return;
    }

    summary.textContent = checkedCount > 0 ? checkedCount + ' выбрано' : summary.dataset.emptyLabel;
  }

  function filterMultiFilterOptions(root) {
    var search = root.querySelector('[data-multi-filter-search]');
    var needle = search ? search.value.trim().toLocaleLowerCase('ru-RU') : '';

    root.querySelectorAll('[data-multi-filter-option]').forEach(function (option) {
      var text = option.dataset.filterText || '';
      option.hidden = needle.length > 0 && !text.includes(needle);
    });
  }

  function initMultiFilter(root) {
    var trigger = root.querySelector('[data-multi-filter-trigger]');
    var panel = root.querySelector('[data-multi-filter-panel]');
    var search = root.querySelector('[data-multi-filter-search]');
    var clear = root.querySelector('[data-multi-filter-clear]');

    if (!trigger || !panel) {
      return;
    }

    trigger.addEventListener('click', function () {
      var willOpen = panel.hidden;

      document.querySelectorAll('[data-multi-filter]').forEach(function (otherRoot) {
        if (otherRoot !== root) {
          closeMultiFilter(otherRoot);
        }
      });

      panel.hidden = !willOpen;
      trigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');

      if (willOpen && search) {
        search.focus();
      }
    });

    if (search) {
      search.addEventListener('input', function () {
        filterMultiFilterOptions(root);
      });
    }

    if (clear) {
      clear.addEventListener('click', function () {
        root.querySelectorAll('[data-multi-filter-checkbox]:checked').forEach(function (checkbox) {
          checkbox.checked = false;
        });
        updateMultiFilterSummary(root);
      });
    }

    root.querySelectorAll('[data-multi-filter-checkbox]').forEach(function (checkbox) {
      checkbox.addEventListener('change', function () {
        updateMultiFilterSummary(root);
      });
    });

    updateMultiFilterSummary(root);
  }

  document.addEventListener('click', function (event) {
    document.querySelectorAll('[data-multi-filter]').forEach(function (root) {
      if (!root.contains(event.target)) {
        closeMultiFilter(root);
      }
    });
  });

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') {
      return;
    }

    document.querySelectorAll('[data-multi-filter]').forEach(function (root) {
      closeMultiFilter(root);
    });
  });

  document.querySelectorAll('[data-multi-filter]').forEach(function (root) {
    initMultiFilter(root);
  });
})();
</script>`;
}

function renderWorkplaceSuggestScript() {
  return `<script>
(function () {
  function labelForSuggestion(item) {
    return [item.title || item.technicalName || item.workplaceId, item.address, item.clientTitle, item.workplaceId]
      .filter(function (part) {
        return String(part || '').trim() !== '';
      })
      .join(' · ');
  }

  function fillOptions(list, suggestions) {
    list.innerHTML = '';

    suggestions.forEach(function (item) {
      var option = document.createElement('option');
      var label = labelForSuggestion(item);

      option.value = item.workplaceId || '';
      option.label = label;
      option.textContent = label;
      list.appendChild(option);
    });
  }

  document.querySelectorAll('[data-workplace-suggest-url]').forEach(function (input) {
    var listId = input.getAttribute('list');
    var list = listId ? document.getElementById(listId) : null;
    var url = input.getAttribute('data-workplace-suggest-url');
    var timer = null;

    if (!list || !url) {
      return;
    }

    input.addEventListener('input', function () {
      var query = input.value.trim();

      window.clearTimeout(timer);

      if (query.length <= 4) {
        fillOptions(list, []);
        return;
      }

      timer = window.setTimeout(function () {
        fetch(url + '?q=' + encodeURIComponent(query))
          .then(function (response) {
            if (!response.ok) {
              return { suggestions: [] };
            }

            return response.json();
          })
          .then(function (body) {
            fillOptions(list, Array.isArray(body.suggestions) ? body.suggestions : []);
          })
          .catch(function () {
            fillOptions(list, []);
          });
      }, 220);
    });
  });
})();
</script>`;
}

function renderDashboardProgressiveScript() {
  return `<script>
(function () {
  function replaceWithHtml(root, html) {
    var template = document.createElement('template');

    template.innerHTML = html;
    root.replaceWith(template.content);

    if (typeof window.initHeatmapLeafletMaps === 'function') {
      window.initHeatmapLeafletMaps();
    }
  }

  function renderError(root, message) {
    replaceWithHtml(root, '<section class="section"><div class="error">' + message + '</div></section>');
  }

  document.querySelectorAll('[data-dashboard-fragment-url], [data-city-analysis-fragment-url]').forEach(function (root) {
    var url = root.getAttribute('data-dashboard-fragment-url') || root.getAttribute('data-city-analysis-fragment-url');

    fetch(url)
      .then(function (response) {
        return response.text().then(function (html) {
          if (!response.ok) {
            replaceWithHtml(root, html || '<section class="section"><div class="error">Не удалось загрузить блок.</div></section>');
            return;
          }

          replaceWithHtml(root, html);
        });
      })
      .catch(function (error) {
        var message = error && error.message ? error.message : 'Не удалось загрузить блок.';

        renderError(root, message);
      });
  });

  document.addEventListener('click', function (event) {
    var link = event.target.closest('[data-dashboard-fragment-link]');

    if (!link) {
      return;
    }

    var section = link.closest('section.section');

    if (!section) {
      return;
    }

    event.preventDefault();

    fetch(link.getAttribute('href'))
      .then(function (response) {
        return response.text().then(function (html) {
          replaceWithHtml(section, html);
        });
      })
      .catch(function (error) {
        var message = error && error.message ? error.message : 'Не удалось загрузить блок.';

        renderError(section, message);
      });
  });
})();
</script>`;
}

function renderSqlInspectorScript() {
  return `<script>
(function () {
  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(value);
    }

    return String(value).replace(/"/g, '\\\\"');
  }

  document.addEventListener('click', function (event) {
    var open = event.target.closest('[data-sql-inspector-open]');

    if (open) {
      var id = open.getAttribute('data-sql-inspector-open');
      var modal = document.querySelector('[data-sql-inspector-modal="' + cssEscape(id) + '"]');

      if (modal) {
        modal.hidden = false;
      }

      return;
    }

    if (event.target.closest('[data-sql-inspector-close]')) {
      var current = event.target.closest('[data-sql-inspector-modal]');

      if (current) {
        current.hidden = true;
      }
    }
  });

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') {
      return;
    }

    document.querySelectorAll('[data-sql-inspector-modal]').forEach(function (modal) {
      modal.hidden = true;
    });
  });
})();
</script>`;
}

function renderWorkerCancellationDetailsScript() {
  return `<script>
(function () {
  var modal = document.querySelector('[data-worker-cancellation-modal]');

  if (!modal) {
    return;
  }

  var body = modal.querySelector('[data-worker-cancellation-modal-body]');
  var closeButton = modal.querySelector('[data-worker-cancellation-modal-close]');
  var lastFocused = null;

  function escapeClientHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function openModal() {
    lastFocused = document.activeElement;
    modal.hidden = false;

    if (closeButton) {
      closeButton.focus();
    }
  }

  function closeModal() {
    modal.hidden = true;

    if (body) {
      body.innerHTML = '<p class="loading">Загружается</p>';
    }

    if (lastFocused && typeof lastFocused.focus === 'function') {
      lastFocused.focus();
    }
  }

  function renderModalError(message) {
    if (body) {
      body.innerHTML = '<div class="error">' + escapeClientHtml(message) + '</div>';
    }
  }

  document.addEventListener('click', function (event) {
    if (!event.target || typeof event.target.closest !== 'function') {
      return;
    }

    var trigger = event.target.closest('[data-worker-cancellation-detail-trigger]');

    if (trigger) {
      event.preventDefault();
      openModal();

      if (body) {
        body.innerHTML = '<p class="loading">Загружается</p>';
      }

      fetch(trigger.getAttribute('data-detail-url'))
        .then(function (response) {
          return response.text().then(function (html) {
            if (!response.ok) {
              if (body) {
                body.innerHTML = html || '<div class="error">Не удалось загрузить детализацию.</div>';
              }
              return;
            }

            if (body) {
              body.innerHTML = html;
            }
          });
        })
        .catch(function (error) {
          renderModalError(error && error.message ? error.message : 'Не удалось загрузить детализацию.');
        });

      return;
    }

    if (event.target.closest('[data-worker-cancellation-modal-close]')) {
      closeModal();
    }
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !modal.hidden) {
      closeModal();
    }
  });
})();
</script>`;
}

function renderGigerDetailsScript() {
  return `<script>
(function () {
  var modal = document.querySelector('[data-giger-list-modal]');

  if (!modal) {
    return;
  }

  var body = modal.querySelector('[data-giger-list-modal-body]');
  var closeButton = modal.querySelector('[data-giger-list-modal-close]');
  var lastFocused = null;

  function escapeClientHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function openModal() {
    lastFocused = document.activeElement;
    modal.hidden = false;

    if (closeButton) {
      closeButton.focus();
    }
  }

  function closeModal() {
    modal.hidden = true;

    if (body) {
      body.innerHTML = '<p class="loading">Загружается</p>';
    }

    if (lastFocused && typeof lastFocused.focus === 'function') {
      lastFocused.focus();
    }
  }

  function renderModalError(message) {
    if (body) {
      body.innerHTML = '<div class="error">' + escapeClientHtml(message) + '</div>';
    }
  }

  function loadDetails(url) {
    if (!url) {
      renderModalError('Не удалось загрузить список гигеров.');
      return;
    }

    if (body) {
      body.innerHTML = '<p class="loading">Загружается</p>';
    }

    fetch(url)
      .then(function (response) {
        return response.text().then(function (html) {
          if (!response.ok) {
            if (body) {
              body.innerHTML = html || '<div class="error">Не удалось загрузить список гигеров.</div>';
            }
            return;
          }

          if (body) {
            body.innerHTML = html;
          }
        });
      })
      .catch(function (error) {
        renderModalError(error && error.message ? error.message : 'Не удалось загрузить список гигеров.');
      });
  }

  document.addEventListener('click', function (event) {
    if (!event.target || typeof event.target.closest !== 'function') {
      return;
    }

    var pageLink = event.target.closest('[data-giger-list-page-link]');

    if (pageLink && modal.contains(pageLink)) {
      event.preventDefault();
      loadDetails(pageLink.getAttribute('href'));
      return;
    }

    var trigger = event.target.closest('[data-giger-detail-trigger]');

    if (trigger) {
      event.preventDefault();
      openModal();
      loadDetails(trigger.getAttribute('data-detail-url'));
      return;
    }

    if (event.target.closest('[data-giger-list-modal-close]')) {
      closeModal();
    }
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !modal.hidden) {
      closeModal();
    }
  });
})();
</script>`;
}

function renderWorkplacePointDayDetailsScript() {
  return `<script>
(function () {
  var modal = document.querySelector('[data-workplace-point-day-modal]');

  if (!modal) {
    return;
  }

  var body = modal.querySelector('[data-workplace-point-day-modal-body]');
  var closeButton = modal.querySelector('[data-workplace-point-day-modal-close]');
  var lastFocused = null;

  function escapeClientHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function openModal() {
    lastFocused = document.activeElement;
    modal.hidden = false;

    if (closeButton) {
      closeButton.focus();
    }
  }

  function closeModal() {
    modal.hidden = true;

    if (body) {
      body.innerHTML = '<p class="loading">Загружается</p>';
    }

    if (lastFocused && typeof lastFocused.focus === 'function') {
      lastFocused.focus();
    }
  }

  function renderModalError(message) {
    if (body) {
      body.innerHTML = '<div class="error">' + escapeClientHtml(message) + '</div>';
    }
  }

  document.addEventListener('click', function (event) {
    if (!event.target || typeof event.target.closest !== 'function') {
      return;
    }

    var trigger = event.target.closest('[data-workplace-point-day-detail-trigger]');

    if (trigger) {
      event.preventDefault();
      openModal();

      if (body) {
        body.innerHTML = '<p class="loading">Загружается</p>';
      }

      fetch(trigger.getAttribute('data-detail-url'))
        .then(function (response) {
          return response.text().then(function (html) {
            if (!response.ok) {
              if (body) {
                body.innerHTML = html || '<div class="error">Не удалось загрузить детализацию.</div>';
              }
              return;
            }

            if (body) {
              body.innerHTML = html;
            }
          });
        })
        .catch(function (error) {
          renderModalError(error && error.message ? error.message : 'Не удалось загрузить детализацию.');
        });

      return;
    }

    if (event.target.closest('[data-workplace-point-day-modal-close]')) {
      closeModal();
    }
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !modal.hidden) {
      closeModal();
    }
  });
})();
</script>`;
}

function renderWorkplacePointReviewsScript() {
  return `<script>
(function () {
  var modal = document.querySelector('[data-workplace-point-review-modal]');

  if (!modal) {
    return;
  }

  var body = modal.querySelector('[data-workplace-point-review-modal-body]');
  var closeButton = modal.querySelector('[data-workplace-point-review-modal-close]');
  var lastFocused = null;

  function escapeClientHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function openModal() {
    lastFocused = document.activeElement;
    modal.hidden = false;

    if (closeButton) {
      closeButton.focus();
    }
  }

  function closeModal() {
    modal.hidden = true;

    if (body) {
      body.innerHTML = '<p class="loading">Загружается</p>';
    }

    if (lastFocused && typeof lastFocused.focus === 'function') {
      lastFocused.focus();
    }
  }

  function renderModalError(message) {
    if (body) {
      body.innerHTML = '<div class="error">' + escapeClientHtml(message) + '</div>';
    }
  }

  function loadReviews(url) {
    if (!url) {
      renderModalError('Не удалось загрузить отзывы.');
      return;
    }

    if (body) {
      body.innerHTML = '<p class="loading">Загружается</p>';
    }

    fetch(url)
      .then(function (response) {
        return response.text().then(function (html) {
          if (!response.ok) {
            if (body) {
              body.innerHTML = html || '<div class="error">Не удалось загрузить отзывы.</div>';
            }
            return;
          }

          if (body) {
            body.innerHTML = html;
          }
        });
      })
      .catch(function (error) {
        renderModalError(error && error.message ? error.message : 'Не удалось загрузить отзывы.');
      });
  }

  function openFromTrigger(trigger) {
    openModal();
    loadReviews(trigger.getAttribute('data-detail-url'));
  }

  document.addEventListener('click', function (event) {
    if (!event.target || typeof event.target.closest !== 'function') {
      return;
    }

    var trigger = event.target.closest('[data-workplace-point-review-trigger]');

    if (trigger) {
      event.preventDefault();
      openFromTrigger(trigger);
      return;
    }

    if (event.target.closest('[data-workplace-point-review-modal-close]')) {
      closeModal();
    }
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !modal.hidden) {
      closeModal();
      return;
    }

    if ((event.key === 'Enter' || event.key === ' ') && event.target && typeof event.target.closest === 'function') {
      var trigger = event.target.closest('[data-workplace-point-review-trigger]');

      if (trigger) {
        event.preventDefault();
        openFromTrigger(trigger);
      }
    }
  });
})();
</script>`;
}

function formatNumber(value, digits = 0) {
  const number = Number(value) || 0;

  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })
    .format(number)
    .replace(/\u00a0/g, ' ');
}

function formatNullableNumber(value, digits = 0) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return '-';
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    return '-';
  }

  return formatNumber(number, digits).replace(',', '.');
}

function formatPercent(value) {
  return `${formatNumber(value, 1).replace(',', '.')}%`;
}

function safeReturnPath(returnTo) {
  const text = String(returnTo || '/');

  if (!text.startsWith('/') || text.startsWith('//') || /[\r\n]/.test(text)) {
    return '/';
  }

  return text;
}

function renderLogin({ database, email = '', error = '', returnTo = '/' }) {
  const errorHtml = error ? `<div class="inline-error">${escapeHtml(error)}</div>` : '';
  const content = `<section class="auth-page">
  <form class="auth-card" action="/login" method="post">
    <h1>Вход</h1>
    ${errorHtml}
    <input type="hidden" name="returnTo" value="${escapeHtml(safeReturnPath(returnTo))}">
    <div class="form-grid">
      <div class="field">
        <label for="email">Почта</label>
        <input id="email" name="email" type="email" autocomplete="username" value="${escapeHtml(email)}" required>
      </div>
      <div class="field">
        <label for="password">Пароль</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required>
      </div>
    </div>
    <div class="form-actions">
      <button type="submit">Войти</button>
    </div>
  </form>
</section>`;

  return layout({
    title: 'Вход',
    database,
    content,
    activeNav: 'login',
    currentUser: null,
    showNav: false
  });
}

function renderRoleOptions(role) {
  const normalizedRole = role === 'admin' ? 'admin' : 'analyst';
  const options = [
    ['analyst', 'Аналитик'],
    ['admin', 'Администратор']
  ];

  return options
    .map(([value, label]) => {
      const selected = value === normalizedRole ? ' selected' : '';

      return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(label)}</option>`;
    })
    .join('');
}

function permissionLabel(permissionId) {
  const definition = PERMISSION_DEFINITIONS.find((permission) => permission.id === permissionId);

  return definition ? definition.label : permissionId;
}

function renderPermissionCheckboxes({ selected = [], disabled = false }) {
  const selectedSet = new Set(selected);
  const disabledAttribute = disabled ? ' disabled' : '';

  return `<div class="permission-grid">${PERMISSION_DEFINITIONS.map((permission) => {
    const checked = selectedSet.has(permission.id) ? ' checked' : '';

    return `<label class="permission-option">
      <input type="checkbox" name="permissions" value="${escapeHtml(permission.id)}"${checked}${disabledAttribute}>
      <span><strong>${escapeHtml(permission.label)}</strong><span>${escapeHtml(permission.description)}</span></span>
    </label>`;
  }).join('')}</div>`;
}

function renderPermissionList(permissions) {
  const selected = Array.isArray(permissions) ? permissions : [];
  const labels = selected.length > 0 ? selected.map(permissionLabel).join(', ') : 'Нет доступов';

  return escapeHtml(labels);
}

function renderManagedAccount(user, csrfToken) {
  const id = escapeHtml(user.id);

  return `<article class="account-row">
  <form class="account-edit-form" action="/admin/users/${id}/update" method="post">
    ${renderHiddenCsrf(csrfToken)}
    <div class="account-row-head">
      <div>
        <div class="account-title">${escapeHtml(user.email)}</div>
        <div class="account-meta">Создан: ${escapeHtml(user.createdAt || '-')} · обновлен: ${escapeHtml(user.updatedAt || '-')}</div>
      </div>
      <span class="readonly-badge">Управляемая запись</span>
    </div>
    <div class="account-row-fields">
      <div class="field">
        <label for="email-${id}">Почта</label>
        <input id="email-${id}" name="email" type="email" value="${escapeHtml(user.email)}" required>
      </div>
      <div class="field">
        <label for="name-${id}">Имя</label>
        <input id="name-${id}" name="name" value="${escapeHtml(user.name || '')}">
      </div>
      <div class="field">
        <label for="role-${id}">Роль</label>
        <select id="role-${id}" name="role">${renderRoleOptions(user.role)}</select>
      </div>
      <div class="field">
        <label for="password-${id}">Новый пароль</label>
        <input id="password-${id}" name="password" type="password" autocomplete="new-password" placeholder="Оставить без изменений">
      </div>
    </div>
    ${renderPermissionCheckboxes({ selected: user.permissions })}
    <div class="form-actions">
      <button type="submit">Сохранить</button>
    </div>
  </form>
  <form class="account-delete-form" action="/admin/users/${id}/delete" method="post">
    ${renderHiddenCsrf(csrfToken)}
    <button class="danger-button" type="submit">Удалить</button>
  </form>
</article>`;
}

function renderEnvAdminAccount(user) {
  return `<article class="account-row">
  <div class="account-row-head">
    <div>
      <div class="account-title">${escapeHtml(user.email)}</div>
      <div class="account-meta">${escapeHtml(user.name || 'Администратор из ENV')}</div>
      <div class="account-meta">Создается из переменных окружения. Редактирование и удаление отключены.</div>
    </div>
    <span class="readonly-badge">ENV admin</span>
  </div>
  <div class="account-meta">Доступы: ${renderPermissionList(user.permissions)}</div>
</article>`;
}

function renderAccountManagement({
  database,
  currentUser,
  csrfToken = '',
  users = [],
  message = '',
  error = ''
}) {
  const messageHtml = message ? `<div class="success">${escapeHtml(message)}</div>` : '';
  const errorHtml = error ? `<div class="inline-error">${escapeHtml(error)}</div>` : '';
  const accountRows = users
    .map((user) => (user.source === 'env' ? renderEnvAdminAccount(user) : renderManagedAccount(user, csrfToken)))
    .join('');
  const content = `<section class="section">
  <h1>Учетные записи</h1>
  <p class="technical-note">Администраторы получают все доступы. Аналитикам доступны только выбранные разделы.</p>
</section>
<section class="section">
  ${messageHtml}
  ${errorHtml}
  <form class="form-panel" action="/admin/users/create" method="post">
    ${renderHiddenCsrf(csrfToken)}
    <h2>Создать учетную запись</h2>
    <div class="form-grid">
      <div class="field">
        <label for="new-email">Почта</label>
        <input id="new-email" name="email" type="email" autocomplete="off" required>
      </div>
      <div class="field">
        <label for="new-name">Имя</label>
        <input id="new-name" name="name" autocomplete="off">
      </div>
      <div class="field">
        <label for="new-role">Роль</label>
        <select id="new-role" name="role">${renderRoleOptions('analyst')}</select>
      </div>
      <div class="field">
        <label for="new-password">Пароль</label>
        <input id="new-password" name="password" type="password" autocomplete="new-password" required>
      </div>
    </div>
    ${renderPermissionCheckboxes({ selected: ['tables'] })}
    <div class="form-actions">
      <button type="submit">Создать</button>
    </div>
  </form>
</section>
<section class="section">
  <h2>Пользователи</h2>
  <div class="account-list">${accountRows || '<p class="empty">Нет учетных записей.</p>'}</div>
</section>`;

  return layout({
    title: 'Учетные записи',
    database,
    content,
    activeNav: 'users',
    currentUser,
    csrfToken
  });
}

function renderCheckedAttribute(value) {
  return value ? ' checked' : '';
}

function renderPreloadRunRow(run) {
  return `<tr>
    <td>${escapeHtml(run.id)}</td>
    <td>${escapeHtml(run.trigger)}</td>
    <td>${escapeHtml(run.status)}</td>
    <td>${escapeHtml(run.fromDate)} - ${escapeHtml(run.toDate)}</td>
    <td>${escapeHtml(run.startedAt || '-')}</td>
    <td>${escapeHtml(run.finishedAt || '-')}</td>
    <td>${escapeHtml(run.rowsWritten || 0)}</td>
    <td>${escapeHtml(run.errorMessage || '')}</td>
  </tr>`;
}

function renderPreloadManagement({
  database,
  currentUser,
  csrfToken = '',
  job,
  overview,
  runs = [],
  message = '',
  error = ''
}) {
  const safeJob = job || {};
  const safeOverview = overview || {};
  const messageHtml = message ? `<div class="success">${escapeHtml(message)}</div>` : '';
  const errorHtml = error ? `<div class="inline-error">${escapeHtml(error)}</div>` : '';
  const rowsHtml = runs.map(renderPreloadRunRow).join('');
  const content = `<section class="section">
  <h1>Предзагрузка витрин</h1>
  <p class="technical-note">Управление локальной SQLite-витриной для дашборда Продажи по проектам.</p>
</section>
<section class="section">
  ${messageHtml}
  ${errorHtml}
  <div class="kpi-grid">
    <div class="kpi-card"><div class="kpi-label">Витрина</div><div class="kpi-value">${escapeHtml(safeJob.id || 'sales-by-project')}</div></div>
    <div class="kpi-card"><div class="kpi-label">Покрытие</div><div class="kpi-value">${escapeHtml(safeOverview.coveredFrom || '-')} - ${escapeHtml(safeOverview.coveredTo || '-')}</div></div>
    <div class="kpi-card"><div class="kpi-label">Последний успех</div><div class="kpi-value">${escapeHtml(safeOverview.lastSuccessAt || '-')}</div></div>
    <div class="kpi-card"><div class="kpi-label">Последняя ошибка</div><div class="kpi-value">${escapeHtml(safeOverview.lastError || '-')}</div></div>
  </div>
</section>
<section class="section">
  <h2>Ручной запуск</h2>
  <form class="filter-bar" action="/admin/preload/run" method="post">
    ${renderHiddenCsrf(csrfToken)}
    <div class="field"><label for="preload-from">С</label><input id="preload-from" name="from" type="date" required></div>
    <div class="field"><label for="preload-to">По</label><input id="preload-to" name="to" type="date" required></div>
    <button type="submit">Запустить</button>
  </form>
</section>
<section class="section">
  <h2>Расписание</h2>
  <form class="filter-bar" action="/admin/preload/schedule" method="post">
    ${renderHiddenCsrf(csrfToken)}
    <label class="checkbox-label"><input name="enabled" type="checkbox" value="1"${renderCheckedAttribute(safeJob.enabled)}> Включено</label>
    <div class="field"><label for="schedule-time">Время</label><input id="schedule-time" name="scheduleTime" type="time" value="${escapeHtml(safeJob.scheduleTime || '03:00')}" required></div>
    <div class="field"><label for="refresh-days">Обновлять дней</label><input id="refresh-days" name="refreshDays" type="number" min="1" max="366" value="${escapeHtml(safeJob.refreshDays || 45)}" required></div>
    <button type="submit">Сохранить</button>
  </form>
</section>
<section class="section">
  <h2>История запусков</h2>
  <div class="table-scroll"><table><thead><tr><th>ID</th><th>Тип</th><th>Статус</th><th>Период</th><th>Старт</th><th>Финиш</th><th>Строк</th><th>Ошибка</th></tr></thead><tbody>${rowsHtml || '<tr><td colspan="8">Запусков пока нет.</td></tr>'}</tbody></table></div>
</section>`;

  return layout({
    title: 'Предзагрузка витрин',
    database,
    content,
    activeNav: 'preload-admin',
    currentUser,
    csrfToken
  });
}

const ACTIVITY_LEVEL_LABELS = {
  none: 'нет событий',
  view: 'просмотр',
  work: 'работа',
  intense: 'интенсивно'
};

const ACTIVITY_EVENT_LABELS = {
  login: 'Вход',
  logout: 'Выход',
  page_view: 'Просмотр',
  dashboard_filter: 'Фильтр дашборда',
  detail_open: 'Детализация',
  export: 'Экспорт',
  admin_action: 'Админ-действие'
};

const ACTIVITY_STATUS_LABELS = {
  active: 'активен',
  rare: 'редко',
  silent: 'молчит',
  new: 'новый'
};

function normalizeActivityLevel(level) {
  const text = String(level || 'none');

  return Object.prototype.hasOwnProperty.call(ACTIVITY_LEVEL_LABELS, text) ? text : 'none';
}

function activityEventLabel(eventType) {
  const text = String(eventType || '');

  return ACTIVITY_EVENT_LABELS[text] || text || '-';
}

function activityStatusLabel(status) {
  const text = String(status || '');

  return ACTIVITY_STATUS_LABELS[text] || text || '-';
}

function renderActivityLegend() {
  return `<div class="activity-legend" aria-label="Легенда активности">
  ${Object.entries(ACTIVITY_LEVEL_LABELS).map(([level, label]) => `<span class="activity-legend-item"><span class="activity-day" data-activity-level="${escapeHtml(level)}"></span>${escapeHtml(label)}</span>`).join('')}
</div>`;
}

function renderActivityDay(day) {
  const safeDay = day || {};
  const level = normalizeActivityLevel(safeDay.level);
  const sections = Array.isArray(safeDay.sections) ? safeDay.sections : [];
  const titleParts = [
    safeDay.date || '-',
    ACTIVITY_LEVEL_LABELS[level],
    `просмотры: ${safeDay.viewEvents || 0}`,
    `рабочие действия: ${safeDay.workEvents || 0}`
  ];

  if (sections.length > 0) {
    titleParts.push(`разделы: ${sections.join(', ')}`);
  }

  const title = titleParts.join(' · ');

  return `<span class="activity-day" data-activity-level="${escapeHtml(level)}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}"></span>`;
}

function renderActivityDayStrip(days) {
  const safeDays = Array.isArray(days) ? days : [];

  return `<div class="activity-day-strip" aria-label="Активность за 90 дней">${safeDays.map(renderActivityDay).join('')}</div>`;
}

function renderActivityEventRows(events) {
  const safeEvents = Array.isArray(events) ? events : [];

  if (safeEvents.length === 0) {
    return '<tr><td colspan="4">Последних действий нет.</td></tr>';
  }

  return safeEvents.map((event) => `<tr>
    <td class="nowrap-cell">${escapeHtml(event && event.occurredAt ? event.occurredAt : '-')}</td>
    <td>${escapeHtml(activityEventLabel(event && event.eventType))}</td>
    <td>${escapeHtml(event && event.section ? event.section : '-')}</td>
    <td class="activity-path-cell">${escapeHtml(event && event.path ? event.path : '-')}</td>
  </tr>`).join('');
}

function renderActivityUserRow(user) {
  const safeUser = user || {};
  const title = String(safeUser.name || '').trim() || String(safeUser.email || '').trim() || String(safeUser.id || '').trim() || 'Без имени';
  const email = String(safeUser.email || '').trim();
  const emailHtml = email && email !== title
    ? `<span class="activity-user-email">${escapeHtml(email)}</span>`
    : '';

  return `<details class="activity-user-row">
  <summary class="activity-user-summary">
    <div class="activity-user-name">${escapeHtml(title)}${emailHtml}</div>
    <span class="activity-pill">${escapeHtml(safeUser.role || '-')}</span>
    <span class="activity-pill">${escapeHtml(activityStatusLabel(safeUser.status))}</span>
    ${renderActivityDayStrip(safeUser.days)}
    <div class="activity-metric"><strong>${escapeHtml(safeUser.lastEventAt || '-')}</strong>последнее действие</div>
    <div class="activity-metric"><strong>${escapeHtml(safeUser.activeDays30 || 0)}</strong>активных дней за 30</div>
    <div class="activity-metric"><strong>${escapeHtml(safeUser.activeDays90 || 0)}</strong>активных дней за 90</div>
  </summary>
  <div class="activity-details">
    <div class="table-scroll">
      <table class="activity-event-table">
        <thead><tr><th>Время</th><th>Тип</th><th>Раздел</th><th>Путь</th></tr></thead>
        <tbody>${renderActivityEventRows(safeUser.recentEvents)}</tbody>
      </table>
    </div>
  </div>
</details>`;
}

function renderUserActivityDashboard({
  database,
  currentUser,
  csrfToken = '',
  overview = null,
  disabled = false
}) {
  const safeOverview = overview || {};
  const users = Array.isArray(safeOverview.users) ? safeOverview.users : [];
  const period = safeOverview.from && safeOverview.to
    ? `${safeOverview.from} - ${safeOverview.to}`
    : 'последние 90 дней';
  const body = disabled
    ? `<section class="section">
  <div class="activity-disabled">
    <strong>Авторизация отключена или хранилище активности недоступно</strong>
    <p>Экран доступен без данных, потому что активность пользователей собирается только при включенной авторизации и подключенном store.</p>
  </div>
</section>`
    : `<section class="section">
  <div class="activity-users">${users.map(renderActivityUserRow).join('') || '<p class="empty">Нет данных активности.</p>'}</div>
</section>`;
  const content = `<section class="section">
  <div class="activity-head">
    <div>
      <h1>Активность пользователей</h1>
      <p class="technical-note">Это пользователи аналитического сервиса, а не пользователи MyGig.</p>
    </div>
    <div class="activity-period">${escapeHtml(period)}</div>
  </div>
  ${renderActivityLegend()}
</section>
${body}`;

  return layout({
    title: 'Активность пользователей',
    database,
    content,
    activeNav: 'activity',
    currentUser,
    csrfToken
  });
}

function renderHome({ database, tables, currentUser, csrfToken }) {
  const tableItems = tables
    .map((table) => {
      const tableName = String(table);
      const href = `/tables?name=${encodeURIComponent(tableName)}`;

      return `<li><a class="table-link" href="${href}">${escapeHtml(tableName)}</a></li>`;
    })
    .join('');
  const tableContent =
    tables.length > 0
      ? `<ul class="table-list">${tableItems}</ul>`
      : '<p class="empty">No tables found.</p>';
  const content = `<section class="section">
  <h1>Available Tables</h1>
  ${tableContent}
</section>`;

  return layout({ title: 'Tables', database, content, currentUser, csrfToken });
}

function renderColumns(columns) {
  if (columns.length === 0) {
    return '<p class="empty">No columns found.</p>';
  }

  const rows = columns
    .map(
      (column) =>
        `<tr><td>${escapeHtml(column.position)}</td><td>${escapeHtml(column.name)}</td><td>${escapeHtml(column.type)}</td></tr>`
    )
    .join('');

  return `<div class="table-wrap"><table>
  <thead><tr><th>Position</th><th>Name</th><th>Type</th></tr></thead>
  <tbody>${rows}</tbody>
</table></div>`;
}

function renderCell(value) {
  if (value === null || value === undefined) {
    return '<span class="muted">NULL</span>';
  }

  if (typeof value === 'object') {
    return escapeHtml(JSON.stringify(value));
  }

  return escapeHtml(value);
}

function renderRows(columns, rows) {
  if (rows.length === 0) {
    return '<p class="empty">No preview rows.</p>';
  }

  const names = columns.length > 0 ? columns.map((column) => column.name) : Object.keys(rows[0]);
  const headerCells = names.map((name) => `<th>${escapeHtml(name)}</th>`).join('');
  const bodyRows = rows
    .map(
      (row) =>
        `<tr>${names
          .map((name) => {
            const value = Object.prototype.hasOwnProperty.call(row, name)
              ? row[name]
              : undefined;

            return `<td>${renderCell(value)}</td>`;
          })
          .join('')}</tr>`
    )
    .join('');

  return `<div class="table-wrap"><table>
  <thead><tr>${headerCells}</tr></thead>
  <tbody>${bodyRows}</tbody>
</table></div>`;
}

function renderTable({ database, tableName, columns, rows, currentUser, csrfToken }) {
  const content = `<section class="section">
  <a class="back-link" href="/">Back to tables</a>
  <h1>${escapeHtml(tableName)}</h1>
</section>
<section class="section">
  <h2>Columns</h2>
  ${renderColumns(columns)}
</section>
<section class="section">
  <h2>Preview Rows</h2>
  ${renderRows(columns, rows)}
</section>`;

  return layout({ title: tableName, database, content, currentUser, csrfToken });
}

function renderKpiGrid(cards, currentUser) {
  return `<div class="kpi-grid">${cards
    .map(({ label, value, detail, valueHtml, detailHtml, metricId, fragmentUrl = '', attributes = '' }) => {
      const fragmentAttribute =
        fragmentUrl === '' ? '' : `data-dashboard-fragment-url="${escapeHtml(fragmentUrl)}"`;
      const cardAttributes = [fragmentAttribute, attributes].filter(Boolean).join(' ');
      const content = `<div class="kpi-label">${escapeHtml(label)}</div>
  <div class="kpi-value">${valueHtml || escapeHtml(value)}</div>
  ${detailHtml ? `<div class="kpi-subvalue">${detailHtml}</div>` : detail ? `<div class="kpi-subvalue">${escapeHtml(detail)}</div>` : ''}`;

      return renderMetricInfoScope({
        className: 'kpi-card',
        metricId,
        currentUser,
        content,
        attributes: cardAttributes
      });
    })
    .join('')}</div>`;
}

function renderKpiCards(summary, currentUser) {
  const cards = [
    ['Заказано смен', formatNumber(summary.orderedShifts)],
    ['Отработано смен', formatNumber(summary.workedShifts)],
    ['SLA', formatPercent(summary.slaPercent)],
    ['Выручка, руб.', formatNumber(summary.revenueRub)],
    ['Уникальные исполнители', formatNumber(summary.uniqueWorkers)],
    ['ТТ с заказами', formatNumber(summary.workplacesWithOrders)],
    ['ТТ с выполненными сменами', formatNumber(summary.workplacesWithWorkedShifts)],
    ['Отмены', formatNumber(summary.cancelledShifts)],
    ['Самоброни', formatPercent(summary.selfBookingPercent)],
    ['Средняя ставка в час', formatNumber(summary.avgWorkerRateHour)]
  ];

  const metricIds = [
    'sales-by-project.summary.ordered-shifts',
    'sales-by-project.summary.worked-shifts',
    'sales-by-project.summary.sla',
    'sales-by-project.summary.revenue-rub',
    'sales-by-project.summary.unique-workers',
    'sales-by-project.summary.workplaces-with-orders',
    'sales-by-project.summary.workplaces-with-worked-shifts',
    'sales-by-project.summary.cancelled-shifts',
    'sales-by-project.summary.self-booking-percent',
    'sales-by-project.summary.avg-worker-rate-hour'
  ];

  return renderKpiGrid(
    cards.map(([label, value], index) => ({
      label,
      value,
      metricId: metricIds[index]
    })),
    currentUser
  );
}

function periodLabel(period) {
  const labels = {
    day: 'День',
    week: 'Неделя',
    month: 'Месяц',
    quarter: 'Квартал'
  };

  return labels[period] || labels.day;
}

function renderEmptyDashboardTable() {
  return '<p class="empty">Нет данных за выбранный период.</p>';
}

function numberCell(value, digits = 0, metricId, currentUser) {
  return renderMetricInfoScope({
    tag: 'td',
    className: 'number-cell',
    metricId,
    currentUser,
    content: escapeHtml(formatNumber(value, digits))
  });
}

function percentCell(value, metricId, currentUser) {
  return renderMetricInfoScope({
    tag: 'td',
    className: 'number-cell',
    metricId,
    currentUser,
    content: escapeHtml(formatPercent(value))
  });
}

function clampPercent(value) {
  const number = Number(value) || 0;

  return Math.max(0, Math.min(100, number));
}

function renderTrendRows(rows, currentUser) {
  if (rows.length === 0) {
    return renderEmptyDashboardTable();
  }

  const maxWorked = Math.max(...rows.map((row) => Number(row.workedShifts) || 0), 0);
  const bodyRows = rows
    .map((row) => {
      const width = maxWorked > 0 ? clampPercent(((Number(row.workedShifts) || 0) / maxWorked) * 100) : 0;

      return `<tr>
  <td>${escapeHtml(row.period)}</td>
  ${numberCell(row.orderedShifts, 0, 'sales-by-project.trend.ordered-shifts', currentUser)}
  ${numberCell(row.workedShifts, 0, 'sales-by-project.trend.worked-shifts', currentUser)}
  ${percentCell(row.slaPercent, 'sales-by-project.trend.sla', currentUser)}
  ${numberCell(row.revenueRub, 0, 'sales-by-project.trend.revenue-rub', currentUser)}
  ${numberCell(row.cancelledShifts, 0, 'sales-by-project.trend.cancelled-shifts', currentUser)}
  ${renderMetricInfoScope({
    tag: 'td',
    className: 'bar-cell',
    metricId: 'sales-by-project.trend.chart',
    currentUser,
    content: `<div class="bar-track"><div class="bar-fill" style="width: ${escapeHtml(formatNumber(width, 1).replace(',', '.'))}%"></div></div>`
  })}
</tr>`;
    })
    .join('');

  return `<div class="table-wrap"><table>
  <thead><tr><th>Период</th><th>Заказано</th><th>Отработано</th><th>SLA</th><th>Выручка</th><th>Отмены</th><th>Динамика</th></tr></thead>
  <tbody>${bodyRows}</tbody>
</table></div>`;
}

function renderBrandRows(rows, currentUser) {
  if (rows.length === 0) {
    return renderEmptyDashboardTable();
  }

  const bodyRows = rows
    .map(
      (row) => `<tr>
  <td>${escapeHtml(row.brand)}</td>
  ${numberCell(row.orderedShifts, 0, 'sales-by-project.brands.ordered-shifts', currentUser)}
  ${numberCell(row.workedShifts, 0, 'sales-by-project.brands.worked-shifts', currentUser)}
  ${percentCell(row.slaPercent, 'sales-by-project.brands.sla', currentUser)}
  ${numberCell(row.revenueRub, 0, 'sales-by-project.brands.revenue-rub', currentUser)}
  ${numberCell(row.uniqueWorkers, 0, 'sales-by-project.brands.unique-workers', currentUser)}
  ${numberCell(row.workplacesWithOrders, 0, 'sales-by-project.brands.workplaces-with-orders', currentUser)}
  ${numberCell(row.workplacesWithWorkedShifts, 0, 'sales-by-project.brands.workplaces-with-worked-shifts', currentUser)}
  ${numberCell(row.cancelledShifts, 0, 'sales-by-project.brands.cancelled-shifts', currentUser)}
  ${percentCell(row.selfBookingPercent, 'sales-by-project.brands.self-booking-percent', currentUser)}
  ${numberCell(row.avgWorkerRateHour, 0, 'sales-by-project.brands.avg-worker-rate-hour', currentUser)}
</tr>`
    )
    .join('');

  return `<div class="table-wrap"><table>
  <thead><tr><th>Бренд</th><th>Заказано</th><th>Отработано</th><th>SLA</th><th>Выручка</th><th>Гигеры</th><th>ТТ с заказами</th><th>ТТ выполнены</th><th>Отмены</th><th>Самоброни</th><th>Ставка/час</th></tr></thead>
  <tbody>${bodyRows}</tbody>
</table></div>`;
}

function renderStatusRows(rows, currentUser) {
  if (rows.length === 0) {
    return renderEmptyDashboardTable();
  }

  const bodyRows = rows
    .map(
      (row) => `<tr>
  <td>${escapeHtml(row.status)}</td>
  ${numberCell(row.shifts, 0, 'sales-by-project.statuses.shifts', currentUser)}
</tr>`
    )
    .join('');

  return `<div class="table-wrap"><table>
  <thead><tr><th>Статус</th><th>Смены</th></tr></thead>
  <tbody>${bodyRows}</tbody>
</table></div>`;
}

function renderPeriodOptions(selectedPeriod) {
  return ['day', 'week', 'month', 'quarter']
    .map((period) => {
      const selected = period === selectedPeriod ? ' selected' : '';

      return `<option value="${period}"${selected}>${escapeHtml(periodLabel(period))}</option>`;
    })
    .join('');
}

function addDashboardQueryParam(params, key, value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item !== null && item !== undefined && String(item) !== '') {
        params.append(key, String(item));
      }
    }

    return;
  }

  if (value !== null && value !== undefined && String(value) !== '') {
    params.append(key, String(value));
  }
}

function salesByProjectSectionUrl(filters, section) {
  const params = new URLSearchParams();

  params.set('section', section);
  addDashboardQueryParam(params, 'period', filters.period);
  addDashboardQueryParam(params, 'from', filters.from);
  addDashboardQueryParam(params, 'to', filters.to);

  return `/dashboards/sales-by-project/section?${params.toString()}`;
}

function renderDashboardLoadingSection({ title, url }) {
  return `<div data-dashboard-fragment-url="${escapeHtml(url)}">
  <section class="section">
    <h2>${escapeHtml(title)}</h2>
    <p class="loading">Загружается</p>
  </section>
</div>`;
}

function renderSalesByProjectProgressiveSections(filters) {
  return `<div data-dashboard-fragment-url="${escapeHtml(salesByProjectSectionUrl(filters, 'summary'))}">
  <section class="section">
    <h2>Основные показатели</h2>
    <div class="kpi-grid">
      ${['Заказано смен', 'Отработано смен', 'SLA', 'Выручка, руб.']
        .map((label) => `<div class="kpi-card"><div class="kpi-label">${escapeHtml(label)}</div><div class="kpi-value">Загружается</div></div>`)
        .join('')}
    </div>
  </section>
</div>
${renderDashboardLoadingSection({
  title: 'Динамика',
  url: salesByProjectSectionUrl(filters, 'trend')
})}
${renderDashboardLoadingSection({
  title: 'Бренды',
  url: salesByProjectSectionUrl(filters, 'brands')
})}
${renderDashboardLoadingSection({
  title: 'Статусы работ',
  url: salesByProjectSectionUrl(filters, 'statuses')
})}`;
}

function renderDataSourceBadge(dashboard) {
  if (!dashboard || !dashboard.dataSource) {
    return '';
  }

  const label = dashboard.dataSource === 'preload' ? 'Источник: витрина' : 'Источник: ClickHouse';

  return `<p class="technical-note">${escapeHtml(label)}</p>`;
}

function renderSalesByProjectDashboardSection({ dashboard, section, currentUser }) {
  if (section === 'summary') {
    return `<section class="section">
  ${renderMetricPanelHead('Основные показатели', 'sales-by-project.summary', currentUser)}
  ${renderDataSourceBadge(dashboard)}
  ${renderKpiCards(dashboard.summary, currentUser)}
</section>`;
  }

  if (section === 'trend') {
    return `<section class="section">
  ${renderMetricPanelHead('Динамика', 'sales-by-project.trend', currentUser)}
  ${renderDataSourceBadge(dashboard)}
  ${renderTrendRows(dashboard.trendRows, currentUser)}
</section>`;
  }

  if (section === 'brands') {
    return `<section class="section">
  ${renderMetricPanelHead('Бренды', 'sales-by-project.brands', currentUser)}
  ${renderDataSourceBadge(dashboard)}
  ${renderBrandRows(dashboard.brandRows, currentUser)}
</section>`;
  }

  if (section === 'statuses') {
    return `<section class="section">
  ${renderMetricPanelHead('Статусы работ', 'sales-by-project.statuses', currentUser)}
  ${renderDataSourceBadge(dashboard)}
  ${renderStatusRows(dashboard.statusRows, currentUser)}
</section>`;
  }

  return `<section class="section"><div class="error">Неизвестный блок дашборда.</div></section>`;
}

function renderDashboardSectionError({ message }) {
  return `<section class="section"><div class="error">${escapeHtml(message)}</div></section>`;
}

function renderSalesByProjectDashboard({
  database,
  dashboard,
  progressive = false,
  currentUser,
  csrfToken
}) {
  const filters = dashboard.filters;
  const resultsHtml = progressive
    ? renderSalesByProjectProgressiveSections(filters)
    : `<section class="section">
  ${renderMetricPanelHead('Основные показатели', 'sales-by-project.summary', currentUser)}
  ${renderKpiCards(dashboard.summary, currentUser)}
</section>
<section class="section">
  ${renderMetricPanelHead('Динамика', 'sales-by-project.trend', currentUser)}
  ${renderTrendRows(dashboard.trendRows, currentUser)}
</section>
<section class="section">
  ${renderMetricPanelHead('Бренды', 'sales-by-project.brands', currentUser)}
  ${renderBrandRows(dashboard.brandRows, currentUser)}
</section>
<section class="section">
  ${renderMetricPanelHead('Статусы работ', 'sales-by-project.statuses', currentUser)}
  ${renderStatusRows(dashboard.statusRows, currentUser)}
</section>`;
  const content = `<section class="section">
  <h1>Продажи по проектам</h1>
  <p class="technical-note">Проект = бренд клиента. Заказано считается из mg_orders.amount. Факт и статусы считаются из mg_jobs, самоброни - из mg_job_history.</p>
</section>
<section class="section">
  <form class="filter-bar" action="/dashboards/sales-by-project" method="get">
    <div class="field">
      <label for="period">Период</label>
      <select id="period" name="period">${renderPeriodOptions(filters.period)}</select>
    </div>
    <div class="field">
      <label for="from">С</label>
      <input id="from" name="from" type="date" value="${escapeHtml(filters.from)}">
    </div>
    <div class="field">
      <label for="to">По</label>
      <input id="to" name="to" type="date" value="${escapeHtml(filters.to)}">
    </div>
    <button type="submit">Применить</button>
  </form>
</section>`;
  const fullContent = `${content}
${resultsHtml}`;

  return layout({
    title: 'Продажи по проектам',
    database,
    content: fullContent,
    activeNav: 'sales-by-project',
    currentUser,
    csrfToken
  });
}

function renderOrderTypeOptions(selectedType) {
  const options = [
    ['', 'Все'],
    ['once', 'Разовые'],
    ['regular', 'Регулярные']
  ];

  return options
    .map(([value, label]) => {
      const selected = value === selectedType ? ' selected' : '';

      return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(label)}</option>`;
    })
    .join('');
}

function orderTypeLabel(value) {
  const labels = {
    once: 'Разовые',
    regular: 'Регулярные'
  };

  return labels[value] || value;
}

function selectedSet(values) {
  return new Set(Array.isArray(values) ? values.map((value) => String(value)) : []);
}

function selectedSummary(values) {
  const count = selectedSet(values).size;

  return count > 0 ? `${count} выбрано` : 'Все';
}

function renderMultiSelectOptions({ id, options, selectedValues, labelForValue = String }) {
  const selected = selectedSet(selectedValues);

  return options
    .map((option) => {
      const value = String(option);
      const label = String(labelForValue(value));
      const checkedAttribute = selected.has(value) ? ' checked' : '';
      const filterText = label.toLocaleLowerCase('ru-RU');

      return `<label class="multi-filter-option" data-multi-filter-option data-filter-text="${escapeHtml(filterText)}">
        <input type="checkbox" name="${escapeHtml(id)}" value="${escapeHtml(value)}"${checkedAttribute} data-multi-filter-checkbox>
        <span>${escapeHtml(label)}</span>
      </label>`;
    })
    .join('');
}

function filterOptions(dashboard, key) {
  const options = dashboard.filterOptions && dashboard.filterOptions[key];

  return Array.isArray(options) ? options : [];
}

function renderMultiSelectField({ id, label, options, selected, labelForValue }) {
  const escapedId = escapeHtml(id);
  const escapedLabel = escapeHtml(label);
  const optionsHtml = renderMultiSelectOptions({
    id,
    options,
    selectedValues: selected,
    labelForValue
  });
  const emptyState = '<p class="multi-filter-empty">Нет значений</p>';

  return `<div class="field filter-field">
      <label for="${escapedId}-trigger">${escapedLabel}</label>
      <div class="multi-filter" data-multi-filter>
        <button class="multi-filter-trigger" type="button" id="${escapedId}-trigger" aria-expanded="false" aria-controls="${escapedId}-panel" data-multi-filter-trigger>
          <span class="multi-filter-trigger-label">${escapedLabel}</span>
          <span id="${escapedId}-summary" class="multi-filter-summary" data-multi-filter-summary data-empty-label="Все">${escapeHtml(selectedSummary(selected))}</span>
        </button>
        <div class="multi-filter-panel" id="${escapedId}-panel" data-multi-filter-panel hidden>
          <input class="multi-filter-search" type="search" placeholder="Поиск" aria-label="Поиск: ${escapedLabel}" data-multi-filter-search>
          <div class="multi-filter-options" role="group" aria-label="${escapedLabel}">
            ${optionsHtml || emptyState}
          </div>
          <button class="multi-filter-clear" type="button" data-multi-filter-clear>Очистить</button>
        </div>
      </div>
    </div>`;
}

function renderCheckboxField({ id, label, checked }) {
  const escapedId = escapeHtml(id);
  const checkedAttribute = checked ? ' checked' : '';

  return `<div class="field checkbox-field">
      <label class="checkbox-label" for="${escapedId}">
        <input id="${escapedId}" name="${escapedId}" type="checkbox" value="1"${checkedAttribute}>
        <span>${escapeHtml(label)}</span>
      </label>
    </div>`;
}

function renderLimitOptions(selectedLimit) {
  return [10, 12, 20, 50]
    .map((limit) => {
      const value = String(limit);
      const selected = value === String(selectedLimit) ? ' selected' : '';

      return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(value)}</option>`;
    })
    .join('');
}

function renderSortOptions(selectedSort) {
  const safeSort = ['orders', 'sla', 'stability'].includes(String(selectedSort))
    ? String(selectedSort)
    : 'orders';
  const options = [
    ['orders', 'Заказано'],
    ['sla', 'SLA'],
    ['stability', 'Стабильность']
  ];

  return options
    .map(([value, label]) => {
      const selected = value === safeSort ? ' selected' : '';

      return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(label)}</option>`;
    })
    .join('');
}

function rangeFilterValue(value) {
  return value === null || typeof value === 'undefined' ? '' : String(value);
}

function renderMetricRangeInput({ id, label, min, max = null, step, value }) {
  const maxAttribute = max === null ? '' : ` max="${escapeHtml(max)}"`;

  return `<div class="field metric-range-field">
      <label for="${escapeHtml(id)}">${escapeHtml(label)}</label>
      <input id="${escapeHtml(id)}" name="${escapeHtml(id)}" type="number" min="${escapeHtml(min)}"${maxAttribute} step="${escapeHtml(step)}" value="${escapeHtml(rangeFilterValue(value))}">
    </div>`;
}

function renderMetricRangeFields(filters) {
  return [
    renderMetricRangeInput({
      id: 'slaFrom',
      label: 'SLA от',
      min: 0,
      max: 100,
      step: 0.1,
      value: filters.slaFrom
    }),
    renderMetricRangeInput({
      id: 'slaTo',
      label: 'SLA до',
      min: 0,
      max: 100,
      step: 0.1,
      value: filters.slaTo
    }),
    renderMetricRangeInput({
      id: 'ordersFrom',
      label: 'Заказано от',
      min: 0,
      step: 1,
      value: filters.ordersFrom
    }),
    renderMetricRangeInput({
      id: 'ordersTo',
      label: 'Заказано до',
      min: 0,
      step: 1,
      value: filters.ordersTo
    }),
    renderMetricRangeInput({
      id: 'stabilityFrom',
      label: 'Стабильность от',
      min: 0,
      max: 100,
      step: 0.1,
      value: filters.stabilityFrom
    }),
    renderMetricRangeInput({
      id: 'stabilityTo',
      label: 'Стабильность до',
      min: 0,
      max: 100,
      step: 0.1,
      value: filters.stabilityTo
    })
  ].join('');
}

function renderPointMetric(label, value, metricId, currentUser, detailUrl = '') {
  const content = `<div class="point-metric-label">${escapeHtml(label)}</div>
  <div class="point-metric-value">${renderGigerDetailTrigger(value, detailUrl)}</div>`;

  return renderMetricInfoScope({
    className: 'point-metric',
    metricId,
    currentUser,
    content
  });
}

function renderPointMetricLegacy(label, value) {
  return `<div class="point-metric">
  <div class="point-metric-label">${escapeHtml(label)}</div>
  <div class="point-metric-value">${escapeHtml(value)}</div>
</div>`;
}

function weekdayOffsetFromMonday(dateText) {
  const date = new Date(`${dateText}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    return 0;
  }

  return (date.getUTCDay() + 6) % 7;
}

function renderHeatmapEmptyCells(count) {
  return Array.from(
    { length: count },
    () => '<span class="heatmap-cell empty" aria-hidden="true"></span>'
  ).join('');
}

function renderHeatmap(days, currentDateValue = new Date()) {
  const leadingEmptyCount = days.length > 0 ? weekdayOffsetFromMonday(days[0].date) : 0;
  const totalCells = leadingEmptyCount + days.length;
  const trailingEmptyCount = totalCells > 0 ? (7 - (totalCells % 7)) % 7 : 0;
  const leadingEmptyCells = renderHeatmapEmptyCells(leadingEmptyCount);
  const trailingEmptyCells = renderHeatmapEmptyCells(trailingEmptyCount);
  const currentDateKey = currentDateKeyFromValue(currentDateValue);
  const cells = days
    .map((day) => {
      const isCurrentDay = currentDateKey && day.date === currentDateKey;
      const cellClass = isCurrentDay ? 'heatmap-cell is-current-day' : 'heatmap-cell';
      const currentDayAttribute = isCurrentDay ? ' aria-current="date"' : '';

      return `<span class="${cellClass}" data-date="${escapeHtml(day.date)}" data-level="${escapeHtml(day.level)}"${currentDayAttribute} title="${escapeHtml(`${day.date}: заказано ${formatNumber(day.amount)}; выполнено ${formatNumber(day.completedShifts)}`)}"></span>`;
    })
    .join('');

  return `<div class="heatmap" aria-label="Календарь заказов">${leadingEmptyCells}${cells}${trailingEmptyCells}</div>`;
}

function renderMetricHeatmap(days, currentDateValue, metricId, currentUser) {
  return renderMetricInfoScope({
    className: 'metric-visual-output',
    metricId,
    currentUser,
    content: renderHeatmap(days, currentDateValue)
  });
}

function pinnedWorkplaceIdsFromFilters(filters) {
  return Array.isArray(filters.pinnedWorkplaceIds) ? filters.pinnedWorkplaceIds : [];
}

function renderPinnedWorkplaceHiddenInputs(filters, pinnedWorkplaceIds = pinnedWorkplaceIdsFromFilters(filters)) {
  return pinnedWorkplaceIds
    .filter((value) => String(value || '').trim() !== '')
    .map((value) => renderHiddenInput('pinnedWorkplaceId', value))
    .join('');
}

function renderPointPinForm(point, filters) {
  const workplaceId = String(point.workplaceId || '').trim();

  if (workplaceId === '') {
    return '';
  }

  const pinnedWorkplaceIds = pinnedWorkplaceIdsFromFilters(filters);
  const pinned = pinnedWorkplaceIds.includes(workplaceId);
  const nextPinnedWorkplaceIds = pinned
    ? pinnedWorkplaceIds.filter((id) => id !== workplaceId)
    : pinnedWorkplaceIds;
  const checked = pinned ? ' checked' : '';

  return `<form class="point-pin-form" action="/dashboards/workplace-analysis" method="get">
  ${renderWorkplaceAnalysisHiddenParams(filters, { pinnedWorkplaceIds: nextPinnedWorkplaceIds })}
  <label class="point-pin-label">
    <input name="pinnedWorkplaceId" type="checkbox" value="${escapeHtml(workplaceId)}"${checked} onchange="this.form.submit()">
    <span>Закрепить</span>
  </label>
</form>`;
}

function renderPointCard(point, filters, currentDateValue, currentUser) {
  const cardClass = point.pinned ? 'point-card pinned' : 'point-card';
  const detailHref = escapeHtml(workplacePointPageHref(filters, point.workplaceId));

  return `<article class="${cardClass}">
  <div class="point-card-head">
    <a class="point-card-link point-card-title-block" href="${detailHref}" target="_blank" rel="noopener noreferrer">
      <div class="point-title">${escapeHtml(point.title)}</div>
    </a>
    ${renderPointPinForm(point, filters)}
  </div>
  <a class="point-card-link" href="${detailHref}" target="_blank" rel="noopener noreferrer">
    <div class="point-metrics">
      ${renderPointMetric('Заказано', formatNumber(point.totalOrderedShifts))}
      ${renderPointMetric('SLA', formatPercent(point.slaPercent))}
      ${renderPointMetric('Стабильность', formatPercent(point.stabilityPercent))}
      ${renderPointMetric('Гигеры 5 км', formatNumber(point.activeGigers5km))}
      ${renderPointMetric('Активные дни', `${formatNumber(point.activeDays)} / ${formatNumber(point.rangeDays)}`)}
      ${renderPointMetric('Среднее', formatNumber(point.avgDailyOrder, 1))}
    </div>
    ${renderHeatmap(point.heatmapDays, currentDateValue)}
  </a>
</article>`;
}

function renderPointCard(point, filters, currentDateValue, currentUser) {
  const cardClass = point.pinned ? 'point-card pinned' : 'point-card';
  const detailHref = escapeHtml(workplacePointPageHref(filters, point.workplaceId));
  const activeGigersDetailUrl = workplaceAnalysisGigerUrl(filters, 'points-active-gigers-5km', {
    workplaceId: point.workplaceId
  });
  const metricsHtml = `<div class="point-metrics">
      ${renderPointMetric('Заказано', formatNumber(point.totalOrderedShifts), 'workplace-analysis.points.ordered-shifts', currentUser)}
      ${renderPointMetric('SLA', formatPercent(point.slaPercent), 'workplace-analysis.points.sla', currentUser)}
      ${renderPointMetric('Стабильность', formatPercent(point.stabilityPercent), 'workplace-analysis.points.stability', currentUser)}
      ${renderPointMetric('Гигеры 5 км', formatNumber(point.activeGigers5km), 'workplace-analysis.points.active-gigers-5km', currentUser, activeGigersDetailUrl)}
      ${renderPointMetric('Активные дни', `${formatNumber(point.activeDays)} / ${formatNumber(point.rangeDays)}`, 'workplace-analysis.points.active-days', currentUser)}
      ${renderPointMetric('Среднее', formatNumber(point.avgDailyOrder, 1), 'workplace-analysis.points.avg-daily-order', currentUser)}
    </div>
    ${renderMetricHeatmap(point.heatmapDays, currentDateValue, 'workplace-analysis.points.heatmap', currentUser)}`;
  const bodyHtml = `<div class="point-card-link">${metricsHtml}</div>`;

  return `<article class="${cardClass}">
  <div class="point-card-head">
    <a class="point-card-link point-card-title-block" href="${detailHref}" target="_blank" rel="noopener noreferrer">
      <div class="point-title">${escapeHtml(point.title)}</div>
    </a>
    ${renderPointPinForm(point, filters)}
  </div>
  ${bodyHtml}
</article>`;
}

function appendWorkplaceAnalysisParam(params, name, value) {
  if (value === null || typeof value === 'undefined') {
    return;
  }

  const text = String(value).trim();

  if (text !== '') {
    params.append(name, text);
  }
}

function shouldPreserveWorkplaceSort(sort) {
  return String(sort || 'orders') !== 'orders';
}

function workplaceAnalysisPageHref(filters, page) {
  const params = new URLSearchParams();
  const multiFilterKeys = ['client', 'city', 'region', 'profession', 'orderType', 'jobStatus', 'contractor'];
  const rangeFilterKeys = ['slaFrom', 'slaTo', 'ordersFrom', 'ordersTo', 'stabilityFrom', 'stabilityTo'];

  params.set('from', filters.from);
  params.set('to', filters.to);

  for (const value of pinnedWorkplaceIdsFromFilters(filters)) {
    appendWorkplaceAnalysisParam(params, 'pinnedWorkplaceId', value);
  }

  for (const key of multiFilterKeys) {
    for (const value of Array.isArray(filters[key]) ? filters[key] : []) {
      appendWorkplaceAnalysisParam(params, key, value);
    }
  }

  if (filters.includeDeletedOrders) {
    params.set('includeDeletedOrders', '1');
  }

  if (filters.includeHiddenOrders) {
    params.set('includeHiddenOrders', '1');
  }

  appendWorkplaceAnalysisParam(params, 'search', filters.search);

  if (shouldPreserveWorkplaceSort(filters.sort)) {
    params.set('sort', String(filters.sort));
  }

  for (const key of rangeFilterKeys) {
    appendWorkplaceAnalysisParam(params, key, filters[key]);
  }

  params.set('limit', String(filters.limit));

  if (page > 1) {
    params.set('page', String(page));
  }

  return `/dashboards/workplace-analysis?${params.toString()}`;
}

function workplaceAnalysisSectionUrl(filters, section) {
  const href = workplaceAnalysisPageHref(filters, filters.page);
  const query = href.includes('?') ? href.slice(href.indexOf('?') + 1) : '';
  const suffix = query === '' ? '' : `&${query}`;

  return `/dashboards/workplace-analysis/section?section=${encodeURIComponent(section)}${suffix}`;
}

function workplacePointPageHref(filters, workplaceId) {
  const params = new URLSearchParams();
  const multiFilterKeys = ['profession', 'orderType', 'jobStatus'];

  params.set('workplaceId', String(workplaceId || ''));
  params.set('from', filters.from);
  params.set('to', filters.to);

  for (const key of multiFilterKeys) {
    for (const value of Array.isArray(filters[key]) ? filters[key] : []) {
      appendWorkplaceAnalysisParam(params, key, value);
    }
  }

  if (filters.includeDeletedOrders) {
    params.set('includeDeletedOrders', '1');
  }

  if (filters.includeHiddenOrders) {
    params.set('includeHiddenOrders', '1');
  }

  return `/dashboards/workplace-analysis/point?${params.toString()}`;
}

function workplacePointSectionUrl(filters, section) {
  const href = workplacePointPageHref(filters, filters.workplaceId);
  const query = href.includes('?') ? href.slice(href.indexOf('?') + 1) : '';
  const suffix = query === '' ? '' : `&${query}`;

  return `/dashboards/workplace-analysis/point/section?section=${encodeURIComponent(section)}${suffix}`;
}

function workplacePointDayDetailsUrl(filters, date) {
  const params = new URLSearchParams();

  addDashboardQueryParam(params, 'workplaceId', filters.workplaceId);
  addDashboardQueryParam(params, 'from', filters.from);
  addDashboardQueryParam(params, 'to', filters.to);
  addDashboardQueryParam(params, 'date', date);
  addDashboardQueryParam(params, 'profession', filters.profession);
  addDashboardQueryParam(params, 'orderType', filters.orderType);
  addDashboardQueryParam(params, 'jobStatus', filters.jobStatus);

  if (filters.includeDeletedOrders) {
    params.set('includeDeletedOrders', '1');
  }

  if (filters.includeHiddenOrders) {
    params.set('includeHiddenOrders', '1');
  }

  return `/dashboards/workplace-analysis/point/details?${params.toString()}`;
}

function workplaceAnalysisGigerUrl(filters, metric, overrides = {}) {
  const params = new URLSearchParams();
  const multiFilterKeys = ['client', 'city', 'region', 'profession', 'orderType', 'jobStatus', 'contractor'];
  const rangeFilterKeys = ['slaFrom', 'slaTo', 'ordersFrom', 'ordersTo', 'stabilityFrom', 'stabilityTo'];

  addDashboardQueryParam(params, 'from', filters.from);
  addDashboardQueryParam(params, 'to', filters.to);

  for (const key of multiFilterKeys) {
    addDashboardQueryParam(params, key, filters[key]);
  }

  if (filters.includeDeletedOrders) {
    params.set('includeDeletedOrders', '1');
  }

  if (filters.includeHiddenOrders) {
    params.set('includeHiddenOrders', '1');
  }

  addDashboardQueryParam(params, 'search', filters.search);

  for (const key of rangeFilterKeys) {
    addDashboardQueryParam(params, key, filters[key]);
  }

  addDashboardQueryParam(params, 'metric', metric);
  addDashboardQueryParam(params, 'status', overrides.status);
  addDashboardQueryParam(params, 'workplaceId', overrides.workplaceId);

  return `/dashboards/workplace-analysis/gigers?${params.toString()}`;
}

function workplacePointGigerUrl(filters, metric, overrides = {}) {
  const params = new URLSearchParams();

  addDashboardQueryParam(params, 'workplaceId', filters.workplaceId);
  addDashboardQueryParam(params, 'from', filters.from);
  addDashboardQueryParam(params, 'to', filters.to);
  addDashboardQueryParam(params, 'profession', filters.profession);
  addDashboardQueryParam(params, 'orderType', filters.orderType);
  addDashboardQueryParam(params, 'jobStatus', filters.jobStatus);

  if (filters.includeDeletedOrders) {
    params.set('includeDeletedOrders', '1');
  }

  if (filters.includeHiddenOrders) {
    params.set('includeHiddenOrders', '1');
  }

  addDashboardQueryParam(params, 'metric', metric);
  addDashboardQueryParam(params, 'radiusKm', overrides.radiusKm);

  return `/dashboards/workplace-analysis/point/gigers?${params.toString()}`;
}

function workplacePointReviewsUrl(filters = {}) {
  const params = new URLSearchParams();

  addDashboardQueryParam(params, 'workplaceId', filters.workplaceId);

  return `/dashboards/workplace-analysis/point/reviews?${params.toString()}`;
}

function renderHiddenInput(name, value) {
  return `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`;
}

function renderWorkplaceAnalysisHiddenParams(filters, { pinnedWorkplaceIds = pinnedWorkplaceIdsFromFilters(filters) } = {}) {
  const inputs = [
    renderHiddenInput('from', filters.from),
    renderHiddenInput('to', filters.to)
  ];
  const multiFilterKeys = ['client', 'city', 'region', 'profession', 'orderType', 'jobStatus', 'contractor'];
  const rangeFilterKeys = ['slaFrom', 'slaTo', 'ordersFrom', 'ordersTo', 'stabilityFrom', 'stabilityTo'];

  for (const value of pinnedWorkplaceIds) {
    if (String(value || '').trim() !== '') {
      inputs.push(renderHiddenInput('pinnedWorkplaceId', value));
    }
  }

  for (const key of multiFilterKeys) {
    for (const value of Array.isArray(filters[key]) ? filters[key] : []) {
      if (String(value || '').trim() !== '') {
        inputs.push(renderHiddenInput(key, value));
      }
    }
  }

  if (filters.includeDeletedOrders) {
    inputs.push(renderHiddenInput('includeDeletedOrders', '1'));
  }

  if (filters.includeHiddenOrders) {
    inputs.push(renderHiddenInput('includeHiddenOrders', '1'));
  }

  if (String(filters.search || '').trim() !== '') {
    inputs.push(renderHiddenInput('search', filters.search));
  }

  if (shouldPreserveWorkplaceSort(filters.sort)) {
    inputs.push(renderHiddenInput('sort', filters.sort));
  }

  for (const key of rangeFilterKeys) {
    if (rangeFilterValue(filters[key]) !== '') {
      inputs.push(renderHiddenInput(key, filters[key]));
    }
  }

  inputs.push(renderHiddenInput('limit', filters.limit));

  return inputs.join('');
}

function renderPaginationLink({ href, label, disabled }) {
  if (disabled) {
    return `<span class="pagination-link disabled" aria-disabled="true">${escapeHtml(label)}</span>`;
  }

  return `<a class="pagination-link" href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
}

function renderFragmentPaginationLink({ href, label, disabled }) {
  if (disabled) {
    return `<span class="pagination-link disabled" aria-disabled="true">${escapeHtml(label)}</span>`;
  }

  return `<a class="pagination-link" href="${escapeHtml(href)}" data-dashboard-fragment-link="1">${escapeHtml(label)}</a>`;
}

function paginationPageNumbers(currentPage, totalPages) {
  const pages = new Set([1, totalPages]);

  for (let page = currentPage - 2; page <= currentPage + 2; page += 1) {
    if (page >= 1 && page <= totalPages) {
      pages.add(page);
    }
  }

  return Array.from(pages).sort((left, right) => left - right);
}

function renderPaginationPages({ filters, page, totalPages }) {
  const pageNumbers = paginationPageNumbers(page, totalPages);
  let previousPage = 0;
  const items = [];

  for (const pageNumber of pageNumbers) {
    if (previousPage > 0 && pageNumber - previousPage > 1) {
      items.push('<span class="pagination-ellipsis" aria-hidden="true">...</span>');
    }

    if (pageNumber === page) {
      items.push(`<span class="pagination-link pagination-page pagination-current" aria-current="page">${escapeHtml(pageNumber)}</span>`);
    } else {
      items.push(`<a class="pagination-link pagination-page" href="${escapeHtml(workplaceAnalysisPageHref(filters, pageNumber))}">${escapeHtml(pageNumber)}</a>`);
    }

    previousPage = pageNumber;
  }

  return `<div class="pagination-pages" aria-label="Страницы">${items.join('')}</div>`;
}

function renderPaginationJump({ filters, page, totalPages }) {
  return `<form class="pagination-jump" action="/dashboards/workplace-analysis" method="get">
  ${renderWorkplaceAnalysisHiddenParams(filters)}
  <div class="field">
    <label for="page">Страница</label>
    <input class="pagination-page-input" id="page" name="page" type="number" min="1" max="${escapeHtml(totalPages)}" value="${escapeHtml(page)}">
  </div>
  <button type="submit">Перейти</button>
</form>`;
}

function renderWorkplacePagination({ filters, pagination }) {
  if (!pagination || (!pagination.hasPrevious && !pagination.hasNext)) {
    return '';
  }

  const page = Number(pagination.page) || 1;
  const totalPages = Math.max(page, Number(pagination.totalPages) || page);
  const previousPage = Math.max(1, page - 1);
  const nextPage = Math.min(totalPages, page + 1);
  const totalLabel = Number(pagination.totalWorkplaces) || 0;

  return `<nav class="pagination" aria-label="Пагинация точек">
  <div class="pagination-meta">Страница ${escapeHtml(page)} из ${escapeHtml(totalPages)} · точек: ${escapeHtml(formatNumber(totalLabel))}</div>
  <div class="pagination-actions">
    ${renderPaginationLink({
      href: workplaceAnalysisPageHref(filters, previousPage),
      label: 'Назад',
      disabled: !pagination.hasPrevious
    })}
    ${renderPaginationLink({
      href: workplaceAnalysisPageHref(filters, nextPage),
      label: 'Вперед',
      disabled: !pagination.hasNext
    })}
  </div>
  ${renderPaginationPages({ filters, page, totalPages })}
  ${renderPaginationJump({ filters, page, totalPages })}
</nav>`;
}

function renderPointCards(points, filters, currentDateValue, currentUser) {
  if (points.length === 0) {
    return '<p class="empty">Нет точек с заказами за выбранный период.</p>';
  }

  return `<div class="points-grid">${points
    .map((point) => renderPointCard(point, filters, currentDateValue, currentUser))
    .join('')}</div>`;
}

function renderWorkplaceAnalysisPointsSection(dashboard, currentUser) {
  return `<section class="section">
  ${renderMetricPanelHead('Рабочие места', 'workplace-analysis.points', currentUser)}
  ${renderPointCards(dashboard.points || [], dashboard.filters, dashboard.currentDate, currentUser)}
  ${renderWorkplacePagination({ filters: dashboard.filters, pagination: dashboard.pagination })}
</section>`;
}

function workplaceAttentionSectionUrl(filters, overrides = {}) {
  const href = workplaceAnalysisPageHref(filters, filters.page || 1);
  const query = href.includes('?') ? href.slice(href.indexOf('?') + 1) : '';
  const params = new URLSearchParams(query);
  const nextFilters = { ...filters, ...overrides };
  const page = Number(nextFilters.attentionPage) || 1;

  for (const key of ['from', 'to', 'limit']) {
    if (params.get(key) === 'undefined' || params.get(key) === '') {
      params.delete(key);
    }
  }

  if (page > 1) {
    params.set('attentionPage', String(page));
  } else {
    params.delete('attentionPage');
  }

  params.set('attentionSort', String(nextFilters.attentionSort || 'attentionScore'));
  params.set('attentionDirection', String(nextFilters.attentionDirection || 'desc'));

  return `/dashboards/workplace-analysis/section?section=attention&${params.toString()}`;
}

const WORKPLACE_ATTENTION_COLUMNS = [
  { key: 'title', label: 'Точка', className: 'attention-point-cell' },
  { key: 'riskSeverity', label: 'Риск', className: 'attention-risk-cell', sortable: false },
  { key: 'free7d', label: 'Своб. 7д', className: 'number-cell' },
  { key: 'nearestFreeDate', label: 'Ближ.', className: 'nowrap-cell' },
  { key: 'maxDailyFree', label: 'Пик', className: 'number-cell' },
  { key: 'coveragePercent', label: 'Покр.', className: 'number-cell' },
  { key: 'totalWorkers15km', label: 'База 15км', className: 'number-cell attention-stack-cell' },
  { key: 'activeWorkers30d15km', label: 'Актив 30д', className: 'number-cell attention-stack-cell' },
  { key: 'activeWorkersPerFreeShift', label: 'Акт/своб.', className: 'number-cell' },
  { key: 'riskReasons', label: 'Причины', className: 'attention-reason-cell', sortable: false }
];

function riskSeverityLabel(severity) {
  if (severity === 'high') {
    return 'Высокий';
  }

  if (severity === 'medium') {
    return 'Средний';
  }

  return 'Низкий';
}

function renderRiskBadge(severity) {
  const normalized = ['high', 'medium', 'low'].includes(severity) ? severity : 'low';

  return `<span class="risk-badge risk-${escapeHtml(normalized)}">${escapeHtml(riskSeverityLabel(normalized))}</span>`;
}

function renderAttentionReason(reason) {
  const kind = String(reason && reason.kind ? reason.kind : 'default');
  const label = String(reason && reason.label ? reason.label : '');

  if (label === '') {
    return '';
  }

  return `<span class="attention-reason attention-reason-${escapeHtml(kind)}">${escapeHtml(label)}</span>`;
}

function renderAttentionReasons(reasons) {
  const items = safeRows(reasons)
    .map(renderAttentionReason)
    .filter((item) => item !== '')
    .join('');

  return items === '' ? '<span class="attention-reason attention-reason-muted">Причина не рассчитана</span>' : items;
}

function renderAttentionSortableHeader(filters, column) {
  if (column.sortable === false) {
    return `<th class="${escapeHtml(column.className)}"><span>${escapeHtml(column.label)}</span></th>`;
  }

  const currentSort = String(filters.attentionSort || 'attentionScore');
  const currentDirection = String(filters.attentionDirection || 'desc');
  const isActive = currentSort === column.key;
  const nextDirection = isActive && currentDirection === 'asc' ? 'desc' : 'asc';
  const indicator = isActive
    ? `<span class="sort-indicator" aria-hidden="true">${escapeHtml(currentDirection === 'asc' ? '↑' : '↓')}</span>`
    : '';
  const href = workplaceAttentionSectionUrl(filters, {
    attentionPage: 1,
    attentionSort: column.key,
    attentionDirection: nextDirection
  });

  return `<th class="${escapeHtml(column.className)}"><a class="sortable-header" href="${escapeHtml(href)}" data-dashboard-fragment-link="1"><span>${escapeHtml(column.label)}</span>${indicator}</a></th>`;
}

function renderWorkerStatusBreakdown(statuses = {}) {
  return `ready ${formatNumber(statuses.ready)} · booked ${formatNumber(statuses.booked)} · worked ${formatNumber(statuses.worked)} · прочие ${formatNumber(statuses.other)}`;
}

function renderAttentionStatusBreakdown(statuses = {}, detailUrlForStatus) {
  const rows = [
    ['ready', 'ready', statuses.ready],
    ['booked', 'booked', statuses.booked],
    ['worked', 'worked', statuses.worked],
    ['прочие', 'other', statuses.other]
  ];

  return `<div class="muted attention-status-breakdown">${rows
    .map(([label, status, value]) => {
      const detailUrl = typeof detailUrlForStatus === 'function' ? detailUrlForStatus(status) : '';

      return `<span class="attention-status-line">${escapeHtml(label)} ${renderGigerDetailTrigger(formatNumber(value), detailUrl)}</span>`;
    })
    .join('')}</div>`;
}

function renderAttentionProfessionBreakdown(professions = []) {
  if (!Array.isArray(professions) || professions.length === 0) {
    return '';
  }

  const rows = professions
    .map((row) => {
      const profession = String(row?.profession || '').trim();
      const free7d = Number(row?.free7d || 0);

      if (!profession || !Number.isFinite(free7d) || free7d <= 0) {
        return '';
      }

      return `<span class="attention-profession-line">${escapeHtml(profession)} ${escapeHtml(formatNumber(free7d))}</span>`;
    })
    .filter(Boolean)
    .join('');

  return rows ? `<div class="muted attention-profession-breakdown">${rows}</div>` : '';
}

function renderAttentionNumberCell(value, metricId, currentUser, digits = 0, extraContent = '', className = 'number-cell', detailUrl = '') {
  return renderMetricInfoScope({
    tag: 'td',
    className,
    metricId,
    currentUser,
    inlineInspector: true,
    inlineClassName: 'attention-metric-inline',
    content: `<div class="attention-metric-content"><span class="attention-metric-value">${renderGigerDetailTrigger(formatNumber(value, digits), detailUrl)}</span>${extraContent}</div>`
  });
}

function renderAttentionPercentCell(value, metricId, currentUser) {
  return renderMetricInfoScope({
    tag: 'td',
    className: 'number-cell',
    metricId,
    currentUser,
    inlineInspector: true,
    inlineClassName: 'attention-metric-inline',
    content: `<div class="attention-metric-content"><span class="attention-metric-value">${escapeHtml(formatPercent(value))}</span></div>`
  });
}

function renderAttentionPaginationPages({ filters, page, totalPages }) {
  const pageNumbers = paginationPageNumbers(page, totalPages);
  let previousPage = 0;
  const items = [];

  for (const pageNumber of pageNumbers) {
    if (previousPage > 0 && pageNumber - previousPage > 1) {
      items.push('<span class="pagination-ellipsis" aria-hidden="true">...</span>');
    }

    if (pageNumber === page) {
      items.push(`<span class="pagination-link pagination-page pagination-current" aria-current="page">${escapeHtml(pageNumber)}</span>`);
    } else {
      items.push(`<a class="pagination-link pagination-page" href="${escapeHtml(workplaceAttentionSectionUrl(filters, { attentionPage: pageNumber }))}" data-dashboard-fragment-link="1">${escapeHtml(pageNumber)}</a>`);
    }

    previousPage = pageNumber;
  }

  return `<div class="pagination-pages" aria-label="Страницы">${items.join('')}</div>`;
}

function renderAttentionPagination({ filters, pagination }) {
  if (!pagination || (!pagination.hasPrevious && !pagination.hasNext)) {
    return '';
  }

  const page = Number(pagination.page) || 1;
  const totalPages = Math.max(page, Number(pagination.totalPages) || page);
  const previousPage = Math.max(1, page - 1);
  const nextPage = Math.min(totalPages, page + 1);
  const totalLabel = Number(pagination.totalWorkplaces) || 0;

  return `<nav class="pagination" aria-label="Пагинация точек внимания">
  <div class="pagination-meta">Страница ${escapeHtml(page)} из ${escapeHtml(totalPages)} · точек: ${escapeHtml(formatNumber(totalLabel))}</div>
  <div class="pagination-actions">
    ${renderFragmentPaginationLink({
      href: workplaceAttentionSectionUrl(filters, { attentionPage: previousPage }),
      label: 'Назад',
      disabled: !pagination.hasPrevious
    })}
    ${renderFragmentPaginationLink({
      href: workplaceAttentionSectionUrl(filters, { attentionPage: nextPage }),
      label: 'Вперед',
      disabled: !pagination.hasNext
    })}
  </div>
  ${renderAttentionPaginationPages({ filters, page, totalPages })}
</nav>`;
}

function renderWorkplaceAttentionRows(points, filters, currentUser) {
  if (points.length === 0) {
    return '<p class="empty">Нет точек с незакрытым заказом на ближайшие 7 дней.</p>';
  }

  return `<div class="attention-table-wrap">
  <table class="attention-table">
    <thead>
      <tr>
        ${WORKPLACE_ATTENTION_COLUMNS.map((column) => renderAttentionSortableHeader(filters, column)).join('')}
      </tr>
    </thead>
    <tbody>
      ${points.map((point) => {
        const detailHref = escapeHtml(workplacePointPageHref(filters || {}, point.workplaceId));
        const totalWorkersDetailUrl = workplaceAnalysisGigerUrl(filters || {}, 'attention-total-workers-15km', {
          workplaceId: point.workplaceId
        });
        const activeWorkersDetailUrl = workplaceAnalysisGigerUrl(filters || {}, 'attention-active-workers-30d-15km', {
          workplaceId: point.workplaceId
        });
        const totalStatusDetailUrl = (status) =>
          workplaceAnalysisGigerUrl(filters || {}, 'attention-total-workers-15km', {
            workplaceId: point.workplaceId,
            status
          });
        const activeStatusDetailUrl = (status) =>
          workplaceAnalysisGigerUrl(filters || {}, 'attention-active-workers-30d-15km', {
            workplaceId: point.workplaceId,
            status
          });

        return `<tr>
        <td class="attention-point-cell"><a href="${detailHref}" target="_blank" rel="noopener noreferrer">${escapeHtml(point.title)}</a><div class="muted">${escapeHtml([point.clientTitle, point.city, point.address].filter(Boolean).join(' · '))}</div></td>
        <td class="attention-risk-cell">${renderRiskBadge(point.riskSeverity)}</td>
        ${renderAttentionNumberCell(point.free7d, 'workplace-analysis.attention.free-7d', currentUser, 0, renderAttentionProfessionBreakdown(point.freeProfessions7d))}
        <td>${escapeHtml(point.nearestFreeDate || '')}</td>
        <td class="number-cell">${escapeHtml(formatNumber(point.maxDailyFree))}</td>
        ${renderAttentionPercentCell(point.coveragePercent, 'workplace-analysis.attention.coverage', currentUser)}
        ${renderAttentionNumberCell(
          point.totalWorkers15km,
          'workplace-analysis.attention.total-workers-15km',
          currentUser,
          0,
          renderAttentionStatusBreakdown(point.totalWorkersByStatus15km, totalStatusDetailUrl),
          'number-cell attention-stack-cell',
          totalWorkersDetailUrl
        )}
        ${renderAttentionNumberCell(
          point.activeWorkers30d15km,
          'workplace-analysis.attention.active-workers-30d-15km',
          currentUser,
          0,
          renderAttentionStatusBreakdown(point.activeWorkers30dByStatus15km, activeStatusDetailUrl),
          'number-cell attention-stack-cell',
          activeWorkersDetailUrl
        )}
        ${renderAttentionNumberCell(point.activeWorkersPerFreeShift, 'workplace-analysis.attention.active-workers-per-free-shift', currentUser, 1)}
        <td class="attention-reason-cell"><div class="attention-reasons">${renderAttentionReasons(point.riskReasons)}</div></td>
      </tr>`;
      }).join('')}
    </tbody>
  </table>
</div>`;
}

function renderWorkplaceAttentionSection(dashboard, currentUser) {
  const filters = dashboard.filters || {};

  return `<section class="section">
  ${renderMetricPanelHead('Точки, требующие внимания', 'workplace-analysis.attention', currentUser)}
  <p class="context-line">Период: ${escapeHtml(filters.attentionFrom || '')} - ${escapeHtml(filters.attentionTo || '')} · незакрытый заказ = заказ без смен в закрывающих статусах · база в радиусе 15 км.</p>
  ${renderWorkplaceAttentionRows(dashboard.attentionPoints || [], filters, currentUser)}
  ${renderAttentionPagination({ filters, pagination: dashboard.attentionPagination })}
</section>`;
}

const WORKER_CANCELLATION_PAGE_SIZES = [50, 100, 200, 500];

const WORKER_CANCELLATION_COLUMNS = [
  { key: 'fullName', label: 'ФИО', numeric: false },
  { key: 'phone', label: 'Телефон', numeric: false },
  { key: 'city', label: 'Город', numeric: false },
  { key: 'confirmedShifts', label: 'Выполнено', numeric: true },
  { key: 'workerCancellations', label: 'Отмены worker', numeric: true },
  { key: 'workerCancellations24h', label: 'Отмены worker < 24ч', numeric: true },
  { key: 'postStartCancellations', label: 'Отмены после старта', numeric: true },
  { key: 'failedShifts', label: 'Провалы / failed', numeric: true }
];
const WORKER_CANCELLATION_NUMERIC_COLUMNS = WORKER_CANCELLATION_COLUMNS.filter((column) => column.numeric);

function workerCancellationsColumn(key) {
  return WORKER_CANCELLATION_COLUMNS.find((column) => column.key === key) || WORKER_CANCELLATION_COLUMNS[0];
}

function workerCancellationsPageHref(filters, overrides = {}) {
  const params = new URLSearchParams();
  const nextFilters = { ...filters, ...overrides };

  addDashboardQueryParam(params, 'from', nextFilters.from);
  addDashboardQueryParam(params, 'to', nextFilters.to);

  if (Object.prototype.hasOwnProperty.call(overrides, 'page')) {
    const page = Number(nextFilters.page) || 1;

    if (page > 1) {
      params.set('page', String(page));
    }
  }

  addDashboardQueryParam(params, 'pageSize', nextFilters.pageSize);
  addDashboardQueryParam(params, 'sort', nextFilters.sort);
  addDashboardQueryParam(params, 'direction', nextFilters.direction);
  addDashboardQueryParam(params, 'search', nextFilters.search);

  for (const column of WORKER_CANCELLATION_NUMERIC_COLUMNS) {
    addDashboardQueryParam(params, `${column.key}From`, nextFilters[`${column.key}From`]);
    addDashboardQueryParam(params, `${column.key}To`, nextFilters[`${column.key}To`]);
  }

  const query = params.toString();

  return query === '' ? '/dashboards/worker-cancellations' : `/dashboards/worker-cancellations?${query}`;
}

function workerCancellationsSectionUrl(filters, section) {
  const href = workerCancellationsPageHref(filters, { page: filters.page });
  const query = href.includes('?') ? href.slice(href.indexOf('?') + 1) : '';
  const suffix = query === '' ? '' : `&${query}`;

  return `/dashboards/worker-cancellations/section?section=${encodeURIComponent(section)}${suffix}`;
}

function workerCancellationsDetailUrl(filters, row, metric) {
  const params = new URLSearchParams();

  addDashboardQueryParam(params, 'from', filters.from);
  addDashboardQueryParam(params, 'to', filters.to);
  addDashboardQueryParam(params, 'workerId', row.workerId);
  addDashboardQueryParam(params, 'metric', metric);

  return `/dashboards/worker-cancellations/details?${params.toString()}`;
}

function workerCancellationsSortDirection(filters, column) {
  const currentSort = String(filters.sort || '');
  const currentDirection = String(filters.direction || 'desc') === 'asc' ? 'asc' : 'desc';

  if (currentSort === column.key) {
    return currentDirection === 'asc' ? 'desc' : 'asc';
  }

  return column.numeric ? 'desc' : 'asc';
}

function renderWorkerCancellationsHeaderCell(filters, column) {
  const isActive = String(filters.sort || '') === column.key;
  const direction = workerCancellationsSortDirection(filters, column);
  const href = workerCancellationsPageHref(filters, {
    sort: column.key,
    direction
  });
  const indicator = isActive
    ? `<span class="sort-indicator" aria-hidden="true">${escapeHtml(String(filters.direction || 'desc') === 'asc' ? '↑' : '↓')}</span>`
    : '';

  return `<th><a class="sortable-header" href="${escapeHtml(href)}"><span>${escapeHtml(column.label)}</span>${indicator}</a></th>`;
}

function workerCancellationsPaginationBounds(pagination, filters) {
  const requestedPage = Number((pagination && pagination.page) || filters.page) || 1;
  const totalWorkers = Number(pagination && pagination.totalWorkers) || 0;
  const totalPages = Math.max(1, Number(pagination && pagination.totalPages) || 1);
  const effectivePage = Math.min(Math.max(1, requestedPage), totalPages);

  return {
    requestedPage,
    totalWorkers,
    totalPages,
    effectivePage,
    isOutOfRange: totalWorkers > 0 && requestedPage > totalPages
  };
}

function renderWorkerCancellationsOutOfRangeState({ filters, requestedPage, totalPages }) {
  const href = workerCancellationsPageHref(filters, { page: totalPages });

  return `<p class="empty">Страница ${escapeHtml(requestedPage)} вне диапазона. Доступно страниц: ${escapeHtml(totalPages)}. <a href="${escapeHtml(href)}">Открыть последнюю страницу</a></p>`;
}

function renderWorkerCancellationMetricCell(row, filters, column, currentUser) {
  const value = formatNumber(row[column.key]);
  const metricId = `worker-cancellations.workers.${column.key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`;

  if (!row.workerId) {
    return numberCell(row[column.key], 0, metricId, currentUser);
  }

  const detailUrl = workerCancellationsDetailUrl(filters, row, column.key);

  return renderMetricInfoScope({
    tag: 'td',
    className: 'number-cell',
    metricId,
    currentUser,
    content: `<button type="button" class="metric-detail-trigger" data-worker-cancellation-detail-trigger data-detail-url="${escapeHtml(detailUrl)}">${escapeHtml(value)}</button>`
  });
}

function renderWorkerCancellationsTable(rows, filters, pagination, currentUser) {
  if (rows.length === 0) {
    const bounds = workerCancellationsPaginationBounds(pagination, filters);

    if (bounds.isOutOfRange) {
      return renderWorkerCancellationsOutOfRangeState({
        filters,
        requestedPage: bounds.requestedPage,
        totalPages: bounds.totalPages
      });
    }

    return '<p class="empty">Нет исполнителей со сменами за выбранный период.</p>';
  }

  const headerCells = WORKER_CANCELLATION_COLUMNS
    .map((column) => renderWorkerCancellationsHeaderCell(filters, column))
    .join('');
  const bodyRows = rows
    .map((row) => {
      const cells = WORKER_CANCELLATION_COLUMNS
        .map((column) => {
          const value = row[column.key];

          if (column.numeric) {
            return renderWorkerCancellationMetricCell(row, filters, column, currentUser);
          }

          const classAttribute = column.key === 'phone' ? ' class="phone-cell"' : '';

          return `<td${classAttribute}>${escapeHtml(value || '')}</td>`;
        })
        .join('');

      return `<tr>${cells}</tr>`;
    })
    .join('');

  return `<div class="table-wrap"><table>
  <thead><tr>${headerCells}</tr></thead>
  <tbody>${bodyRows}</tbody>
</table></div>`;
}

function formatDateTimeValue(value) {
  const text = String(value || '').trim();

  if (text === '') {
    return '-';
  }

  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);

  if (!match) {
    return text;
  }

  return `${match[3]}.${match[2]}.${match[1]} ${match[4]}:${match[5]}`;
}

function detailText(value) {
  const text = String(value || '').trim();

  return text === '' ? '-' : text;
}

function renderGigerDetailTrigger(value, detailUrl) {
  const text = String(value || '');

  if (String(detailUrl || '') === '') {
    return escapeHtml(text);
  }

  return `<button type="button" class="metric-detail-trigger" data-giger-detail-trigger data-detail-url="${escapeHtml(detailUrl)}">${escapeHtml(text)}</button>`;
}

function gigerDetailsPageUrl(baseUrl, page) {
  const [path, query = ''] = String(baseUrl || '').split('?');
  const params = new URLSearchParams(query);

  params.set('page', String(page));

  return `${path}?${params.toString()}`;
}

function renderGigerDetailsPagination(details) {
  const pagination = details && details.pagination ? details.pagination : null;

  if (!pagination || (!pagination.hasPrevious && !pagination.hasNext)) {
    return '';
  }

  const page = Number(pagination.page) || 1;
  const totalPages = Math.max(1, Number(pagination.totalPages) || 1);
  const previousPage = Math.max(1, page - 1);
  const nextPage = Math.min(totalPages, page + 1);
  const detailUrl = details.detailUrl || '';

  return `<nav class="pagination" aria-label="Пагинация гигеров">
  <div class="pagination-meta">Страница ${escapeHtml(page)} из ${escapeHtml(totalPages)} · гигеров: ${escapeHtml(formatNumber(pagination.totalGigers))}</div>
  <div class="pagination-actions">
    ${
      pagination.hasPrevious
        ? `<a class="pagination-link" href="${escapeHtml(gigerDetailsPageUrl(detailUrl, previousPage))}" data-giger-list-page-link="1">Назад</a>`
        : '<span class="pagination-link disabled" aria-disabled="true">Назад</span>'
    }
    ${
      pagination.hasNext
        ? `<a class="pagination-link" href="${escapeHtml(gigerDetailsPageUrl(detailUrl, nextPage))}" data-giger-list-page-link="1">Вперед</a>`
        : '<span class="pagination-link disabled" aria-disabled="true">Вперед</span>'
    }
  </div>
</nav>`;
}

function renderGigerRows(gigers) {
  if (!Array.isArray(gigers) || gigers.length === 0) {
    return '<p class="empty">Нет гигеров для выбранной метрики.</p>';
  }

  const rows = gigers
    .map((giger) => `<tr>
  <td class="compact-text-cell" title="${escapeHtml(detailText(giger.userId))}">${escapeHtml(detailText(giger.userId))}</td>
  <td class="compact-text-cell" title="${escapeHtml(detailText(giger.workerId))}">${escapeHtml(detailText(giger.workerId))}</td>
  <td class="compact-text-cell" title="${escapeHtml(detailText(giger.fullName))}">${escapeHtml(detailText(giger.fullName))}</td>
  <td class="phone-cell">${escapeHtml(detailText(giger.phone))}</td>
  <td>${escapeHtml(detailText(giger.status))}</td>
</tr>`)
    .join('');

  return `<div class="table-wrap"><table class="giger-details-table">
  <thead><tr>
    <th>User ID</th>
    <th>Worker ID</th>
    <th>ФИО</th>
    <th>Телефон</th>
    <th>Статус</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table></div>`;
}

function renderGigerDetails({ details }) {
  const safeDetails = details || {};
  const pagination = safeDetails.pagination || {};
  const totalLabel =
    typeof pagination.totalGigers === 'undefined'
      ? ''
      : `<span class="muted">Всего: ${escapeHtml(formatNumber(pagination.totalGigers))}</span>`;

  return `<div class="giger-details">
  <div class="giger-details-head">
    <h2>${escapeHtml(safeDetails.metricLabel || 'Гигеры')}</h2>
    <div class="giger-details-actions">
      ${totalLabel}
      ${safeDetails.exportUrl ? `<a class="secondary-button" href="${escapeHtml(safeDetails.exportUrl)}">Выгрузить в Excel</a>` : ''}
    </div>
  </div>
  ${renderGigerRows(safeDetails.gigers || [])}
  ${renderGigerDetailsPagination(safeDetails)}
</div>`;
}

function renderGigerDetailsWorkbook({ details }) {
  const safeDetails = details || {};
  const rows = (safeDetails.gigers || [])
    .map((giger) => `<tr>
  <td>${escapeHtml(detailText(giger.userId))}</td>
  <td>${escapeHtml(detailText(giger.workerId))}</td>
  <td>${escapeHtml(detailText(giger.fullName))}</td>
  <td>${escapeHtml(detailText(giger.phone))}</td>
  <td>${escapeHtml(detailText(giger.status))}</td>
</tr>`)
    .join('');

  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>${escapeHtml(safeDetails.metricLabel || 'Гигеры')}</title></head>
<body>
<table>
  <thead><tr>
    <th>User ID</th>
    <th>Worker ID</th>
    <th>ФИО</th>
    <th>Телефон</th>
    <th>Статус</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
</body>
</html>`;
}

function renderWorkerCancellationsDetails({ details }) {
  const shifts = (details && details.shifts) || [];
  const metricLabel = details && details.metricLabel ? details.metricLabel : 'метрика';

  if (shifts.length === 0) {
    return `<div class="worker-cancellation-details">
  <h2>Детализация: ${escapeHtml(metricLabel)}</h2>
  <p class="empty">Нет смен для выбранной метрики за период.</p>
</div>`;
  }

  const rows = shifts
    .map((shift) => `<tr>
  <td>${escapeHtml(detailText(shift.shiftId))}</td>
  <td>${escapeHtml(detailText(shift.brand))}</td>
  <td>${escapeHtml(detailText(shift.address))}</td>
  <td class="nowrap-cell">${escapeHtml(formatDateTimeValue(shift.plannedStart))}</td>
  <td class="nowrap-cell">${escapeHtml(formatDateTimeValue(shift.bookedAt))}</td>
  <td class="nowrap-cell">${escapeHtml(formatDateTimeValue(shift.cancelledAt))}</td>
  <td>${escapeHtml(detailText(shift.cancelledBy))}</td>
</tr>`)
    .join('');

  return `<div class="worker-cancellation-details">
  <h2>Детализация: ${escapeHtml(metricLabel)}</h2>
  <div class="table-wrap"><table>
    <thead><tr>
      <th>Смена</th>
      <th>Бренд</th>
      <th>Адрес</th>
      <th>Старт смены</th>
      <th>Забронирована</th>
      <th>Отменена</th>
      <th>Кем отменена</th>
    </tr></thead>
    <tbody>${rows}</tbody>
</table></div>
</div>`;
}

function renderWorkplacePointDayDetails({ details }) {
  const rows = (details && details.rows) || [];
  const date = details && details.date ? details.date : '';

  if (rows.length === 0) {
    return `<div class="workplace-point-day-details">
  <h2>Детализация дня: ${escapeHtml(date)}</h2>
  <p class="empty">Нет заданий за выбранный день.</p>
</div>`;
  }

  const bodyRows = rows
    .map((row) => `<tr>
  <td class="compact-text-cell" title="${escapeHtml(detailText(row.orderId))}">${escapeHtml(detailText(row.orderId))}</td>
  <td class="compact-text-cell" title="${escapeHtml(detailText(row.profession))}">${escapeHtml(detailText(row.profession))}</td>
  <td class="nowrap-cell">${escapeHtml(formatDateTimeValue(row.orderStartLocal))}</td>
  <td class="number-cell">${escapeHtml(formatNullableNumber(row.plannedHours, 1))}</td>
  <td class="compact-text-cell" title="${escapeHtml(detailText(row.workerFullName))}">${escapeHtml(detailText(row.workerFullName))}</td>
  <td class="nowrap-cell">${escapeHtml(detailText(row.workerPhone))}</td>
  <td>${escapeHtml(detailText(row.confirmedStatus))}</td>
  <td class="number-cell">${escapeHtml(formatNullableNumber(row.actualHours, 1))}</td>
  <td class="actual-time-cell">${escapeHtml(detailText(row.actualTimeLocal))}</td>
  <td class="number-cell">${escapeHtml(formatNumber(row.paymentAmount))}</td>
  <td class="number-cell">${escapeHtml(formatNumber(row.cancelledShifts))}</td>
  <td class="nowrap-cell">${escapeHtml(formatDateTimeValue(row.lastCancelledAtLocal))}</td>
</tr>`)
    .join('');

  return `<div class="workplace-point-day-details">
  <h2>Детализация дня: ${escapeHtml(date)}</h2>
  <div class="table-wrap compact-detail-table-wrap"><table class="compact-detail-table">
    <colgroup>
      <col class="order-id-col">
      <col class="profession-col">
      <col class="start-col">
      <col class="hours-col">
      <col class="worker-col">
      <col class="phone-col">
      <col class="status-col">
      <col class="actual-hours-col">
      <col class="actual-time-col">
      <col class="payment-col">
      <col class="cancelled-col">
      <col class="last-cancelled-col">
    </colgroup>
    <thead><tr>
      <th>Заказ</th>
      <th>Профессия</th>
      <th>Старт</th>
      <th>План</th>
      <th>Гигер</th>
      <th>Телефон</th>
      <th>Статус</th>
      <th>Факт, ч</th>
      <th>Факт время</th>
      <th>Начислено</th>
      <th>Cancelled</th>
      <th>Последний cancelled</th>
    </tr></thead>
    <tbody>${bodyRows}</tbody>
  </table></div>
</div>`;
}

function renderWorkplacePointReviews({ details }) {
  const reviews = (details && details.reviews) || [];

  if (reviews.length === 0) {
    return `<div class="workplace-point-reviews">
  <h2>Отзывы точки</h2>
  <p class="empty">Нет отзывов по выбранной точке.</p>
</div>`;
  }

  const rows = reviews
    .map((review) => `<tr>
  <td class="number-cell">${escapeHtml(formatNumber(review.rating))}</td>
  <td class="compact-text-cell" title="${escapeHtml(detailText(review.authorFullName))}">${escapeHtml(detailText(review.authorFullName))}</td>
  <td class="nowrap-cell">${escapeHtml(detailText(review.authorPhone))}</td>
  <td class="nowrap-cell">${escapeHtml(formatDateTimeValue(review.createdAtLocal))}</td>
  <td class="review-text-cell">${escapeHtml(detailText(review.text))}</td>
</tr>`)
    .join('');

  return `<div class="workplace-point-reviews">
  <div class="giger-details-head">
    <h2>Отзывы точки</h2>
    <div class="giger-details-actions"><span class="muted">Всего: ${escapeHtml(formatNumber(reviews.length))}</span></div>
  </div>
  <div class="table-wrap compact-detail-table-wrap"><table class="compact-detail-table workplace-point-reviews-table">
    <thead><tr>
      <th>Оценка</th>
      <th>ФИО</th>
      <th>Телефон</th>
      <th>Дата</th>
      <th>Отзыв</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
</div>`;
}

function renderWorkerCancellationsPaginationPages({ filters, page, totalPages }) {
  const pageNumbers = paginationPageNumbers(page, totalPages);
  let previousPage = 0;
  const items = [];

  for (const pageNumber of pageNumbers) {
    if (previousPage > 0 && pageNumber - previousPage > 1) {
      items.push('<span class="pagination-ellipsis" aria-hidden="true">...</span>');
    }

    if (pageNumber === page) {
      items.push(`<span class="pagination-link pagination-page pagination-current" aria-current="page">${escapeHtml(pageNumber)}</span>`);
    } else {
      items.push(`<a class="pagination-link pagination-page" href="${escapeHtml(workerCancellationsPageHref(filters, { page: pageNumber }))}">${escapeHtml(pageNumber)}</a>`);
    }

    previousPage = pageNumber;
  }

  return `<div class="pagination-pages" aria-label="Страницы">${items.join('')}</div>`;
}

function renderWorkerCancellationsPagination({ filters, pagination }) {
  if (!pagination || (!pagination.hasPrevious && !pagination.hasNext)) {
    return '';
  }

  const bounds = workerCancellationsPaginationBounds(pagination, filters);
  const page = bounds.effectivePage;
  const totalPages = bounds.totalPages;
  const previousPage = Math.max(1, page - 1);
  const nextPage = Math.min(totalPages, page + 1);
  const totalLabel = bounds.totalWorkers;

  return `<nav class="pagination" aria-label="Пагинация исполнителей">
  <div class="pagination-meta">Страница ${escapeHtml(page)} из ${escapeHtml(totalPages)} · исполнителей: ${escapeHtml(formatNumber(totalLabel))}</div>
  <div class="pagination-actions">
    ${renderPaginationLink({
      href: workerCancellationsPageHref(filters, { page: previousPage }),
      label: 'Назад',
      disabled: !pagination.hasPrevious || page <= 1
    })}
    ${renderPaginationLink({
      href: workerCancellationsPageHref(filters, { page: nextPage }),
      label: 'Вперед',
      disabled: !pagination.hasNext || page >= totalPages
    })}
  </div>
  ${renderWorkerCancellationsPaginationPages({ filters, page, totalPages })}
</nav>`;
}

function renderWorkerCancellationsPageSizeOptions(selectedPageSize) {
  return WORKER_CANCELLATION_PAGE_SIZES
    .map((pageSize) => {
      const value = String(pageSize);
      const selected = value === String(selectedPageSize) ? ' selected' : '';

      return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(value)}</option>`;
    })
    .join('');
}

function renderWorkerCancellationRangeInput({ id, label, value }) {
  return `<div class="field metric-range-field">
      <label for="${escapeHtml(id)}">${escapeHtml(label)}</label>
      <input class="metric-range-input" id="${escapeHtml(id)}" name="${escapeHtml(id)}" type="number" min="0" step="1" value="${escapeHtml(rangeFilterValue(value))}">
    </div>`;
}

function renderWorkerCancellationRangeFilters(filters) {
  return WORKER_CANCELLATION_NUMERIC_COLUMNS
    .flatMap((column) => [
      renderWorkerCancellationRangeInput({
        id: `${column.key}From`,
        label: `${column.label} от`,
        value: filters[`${column.key}From`]
      }),
      renderWorkerCancellationRangeInput({
        id: `${column.key}To`,
        label: `${column.label} до`,
        value: filters[`${column.key}To`]
      })
    ])
    .join('');
}

function renderWorkerCancellationsModal() {
  return `<div class="worker-cancellation-modal" data-worker-cancellation-modal hidden>
  <div class="worker-cancellation-modal-backdrop" data-worker-cancellation-modal-close></div>
  <div class="worker-cancellation-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="worker-cancellation-modal-title">
    <div class="worker-cancellation-modal-head">
      <h2 id="worker-cancellation-modal-title">Детализация смен</h2>
      <button type="button" class="worker-cancellation-modal-close" data-worker-cancellation-modal-close aria-label="Закрыть">&times;</button>
    </div>
    <div class="worker-cancellation-modal-body" data-worker-cancellation-modal-body>
      <p class="loading">Загружается</p>
    </div>
  </div>
</div>`;
}

function renderWorkplacePointDayModal() {
  return `<div class="workplace-point-day-modal" data-workplace-point-day-modal hidden>
  <div class="workplace-point-day-modal-backdrop" data-workplace-point-day-modal-close></div>
  <div class="workplace-point-day-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="workplace-point-day-modal-title">
    <div class="workplace-point-day-modal-head">
      <h2 id="workplace-point-day-modal-title">Детализация дня</h2>
      <button type="button" class="workplace-point-day-modal-close" data-workplace-point-day-modal-close aria-label="Закрыть">&times;</button>
    </div>
    <div class="workplace-point-day-modal-body" data-workplace-point-day-modal-body>
      <p class="loading">Загружается</p>
    </div>
  </div>
</div>`;
}

function renderWorkplacePointReviewModal() {
  return `<div class="workplace-point-review-modal" data-workplace-point-review-modal hidden>
  <div class="workplace-point-review-modal-backdrop" data-workplace-point-review-modal-close></div>
  <div class="workplace-point-review-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="workplace-point-review-modal-title">
    <div class="workplace-point-review-modal-head">
      <h2 id="workplace-point-review-modal-title">Отзывы точки</h2>
      <button type="button" class="workplace-point-review-modal-close" data-workplace-point-review-modal-close aria-label="Закрыть">&times;</button>
    </div>
    <div class="workplace-point-review-modal-body" data-workplace-point-review-modal-body>
      <p class="loading">Загружается</p>
    </div>
  </div>
</div>`;
}

function renderGigerListModal() {
  return `<div class="giger-list-modal" data-giger-list-modal hidden>
  <div class="giger-list-modal-backdrop" data-giger-list-modal-close></div>
  <div class="giger-list-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="giger-list-modal-title">
    <div class="giger-list-modal-head">
      <h2 id="giger-list-modal-title">Список гигеров</h2>
      <button type="button" class="giger-list-modal-close" data-giger-list-modal-close aria-label="Закрыть">&times;</button>
    </div>
    <div class="giger-list-modal-body" data-giger-list-modal-body>
      <p class="loading">Загружается</p>
    </div>
  </div>
</div>`;
}

function renderWorkerCancellationsDashboardSection({ dashboard, section, currentUser }) {
  if (section === 'workers') {
    const rows = dashboard.rows || dashboard.workers || [];

    return `<section class="section">
  ${renderMetricPanelHead('Исполнители', 'worker-cancellations.workers', currentUser)}
  ${renderWorkerCancellationsTable(rows, dashboard.filters, dashboard.pagination, currentUser)}
  ${renderWorkerCancellationsPagination({ filters: dashboard.filters, pagination: dashboard.pagination })}
</section>`;
  }

  return '<section class="section"><div class="error">Неизвестный блок дашборда.</div></section>';
}

function renderWorkerCancellationsDashboard({
  database,
  dashboard,
  progressive = false,
  currentUser,
  csrfToken
}) {
  const filters = dashboard.filters;
  const workersHtml = progressive
    ? `<div data-dashboard-fragment-url="${escapeHtml(workerCancellationsSectionUrl(filters, 'workers'))}">
  <section class="section">
    <h2>Исполнители</h2>
    ${renderDashboardLoadingState()}
  </section>
</div>`
    : renderWorkerCancellationsDashboardSection({ dashboard, section: 'workers', currentUser });
  const content = `<section class="section">
  ${renderDashboardHeader({
    title: 'Отмены гигерами',
    eyebrow: 'Операции',
    period: `Период: ${filters.from} - ${filters.to}`,
    details: ['Период по плановому старту смены']
  })}
</section>
<section class="section">
  <form class="filter-bar" action="/dashboards/worker-cancellations" method="get">
    <div class="field">
      <label for="from">С</label>
      <input id="from" name="from" type="date" value="${escapeHtml(filters.from)}">
    </div>
    <div class="field">
      <label for="to">По</label>
      <input id="to" name="to" type="date" value="${escapeHtml(filters.to)}">
    </div>
    <div class="field worker-search-field">
      <label for="search">Поиск</label>
      <input id="search" name="search" type="search" value="${escapeHtml(filters.search || '')}" placeholder="ФИО, телефон, worker/user id, город">
    </div>
    ${renderWorkerCancellationRangeFilters(filters)}
    <div class="field">
      <label for="pageSize">Строк</label>
      <select id="pageSize" name="pageSize">${renderWorkerCancellationsPageSizeOptions(filters.pageSize)}</select>
    </div>
    ${renderHiddenInput('sort', filters.sort || workerCancellationsColumn(filters.sort).key)}
    ${renderHiddenInput('direction', filters.direction || 'desc')}
    <button type="submit">Применить</button>
  </form>
</section>
${workersHtml}
${renderWorkerCancellationsModal()}`;

  return layout({
    title: 'Отмены гигерами',
    database,
    content,
    activeNav: 'worker-cancellations',
    currentUser,
    csrfToken
  });
}

function formatRadiusWorkerValue(summary, radius) {
  const workers = summary.radiusWorkers ? summary.radiusWorkers[radius] : 0;
  const activeSessionWorkers = summary.radiusActiveSessionWorkers
    ? summary.radiusActiveSessionWorkers[radius]
    : 0;

  return `${formatNumber(workers)} / ${formatNumber(activeSessionWorkers)}`;
}

function formatPointRating(value) {
  return value === null || typeof value === 'undefined' || value === ''
    ? '-'
    : formatNullableNumber(value, 1);
}

function workplacePointRatingCard(summary, filters) {
  return {
    label: 'Рейтинг точки',
    value: `${formatPointRating(summary.ratingAll)} / ${formatPointRating(summary.ratingLast10)}`,
    detail: `все / последние 10 · отзывов ${formatNumber(summary.ratingReviewCount)}`,
    metricId: 'workplace-point.summary.rating',
    attributes: `role="button" tabindex="0" data-workplace-point-review-trigger data-detail-url="${escapeHtml(workplacePointReviewsUrl(filters))}"`
  };
}

function renderWorkplacePointKpis(summary, currentUser) {
  const filters = summary.filters || {};

  return renderKpiGrid([
    { label: 'Заказано', value: formatNumber(summary.orderedShifts), metricId: 'workplace-point.summary.ordered-shifts' },
    { label: 'Выполнено', value: formatNumber(summary.completedShifts), metricId: 'workplace-point.summary.completed-shifts' },
    { label: 'SLA', value: formatPercent(summary.slaPercent), metricId: 'workplace-point.summary.sla' },
    { label: 'Стабильность', value: formatPercent(summary.stabilityPercent), metricId: 'workplace-point.summary.stability' },
    {
      label: 'Уникальные завершали',
      value: formatNumber(summary.uniqueCompletedWorkers),
      valueHtml: renderGigerDetailTrigger(formatNumber(summary.uniqueCompletedWorkers), workplacePointGigerUrl(filters, 'unique-completed-workers')),
      metricId: 'workplace-point.summary.unique-completed-workers'
    },
    {
      label: 'Уникальные бронировали',
      value: formatNumber(summary.uniqueBookedWorkers),
      valueHtml: renderGigerDetailTrigger(formatNumber(summary.uniqueBookedWorkers), workplacePointGigerUrl(filters, 'unique-booked-workers')),
      metricId: 'workplace-point.summary.unique-booked-workers'
    },
    workplacePointRatingCard(summary, filters),
    { label: 'Слеты < 24ч', value: formatNumber(summary.dropoffs24h), metricId: 'workplace-point.summary.dropoffs-24h' },
    { label: '5 км', value: formatRadiusWorkerValue(summary, 5), valueHtml: renderRadiusWorkerValue(summary, filters, 5), metricId: 'workplace-point.summary.radius-5km' },
    { label: '10 км', value: formatRadiusWorkerValue(summary, 10), valueHtml: renderRadiusWorkerValue(summary, filters, 10), metricId: 'workplace-point.summary.radius-10km' },
    { label: '15 км', value: formatRadiusWorkerValue(summary, 15), valueHtml: renderRadiusWorkerValue(summary, filters, 15), metricId: 'workplace-point.summary.radius-15km' },
    { label: '20 км', value: formatRadiusWorkerValue(summary, 20), valueHtml: renderRadiusWorkerValue(summary, filters, 20), metricId: 'workplace-point.summary.radius-20km' }
  ], currentUser);
}

function renderWorkplacePointSummaryKpis(summary, currentUser) {
  const filters = summary.filters || {};
  return renderKpiGrid([
    { label: 'Заказано', value: formatNumber(summary.orderedShifts), metricId: 'workplace-point.summary.ordered-shifts' },
    { label: 'Выполнено', value: formatNumber(summary.completedShifts), metricId: 'workplace-point.summary.completed-shifts' },
    { label: 'SLA', value: formatPercent(summary.slaPercent), metricId: 'workplace-point.summary.sla' },
    { label: 'Стабильность', value: formatPercent(summary.stabilityPercent), metricId: 'workplace-point.summary.stability' },
    {
      label: 'Уникальные завершали',
      value: formatNumber(summary.uniqueCompletedWorkers),
      valueHtml: renderGigerDetailTrigger(
        formatNumber(summary.uniqueCompletedWorkers),
        workplacePointGigerUrl(filters, 'unique-completed-workers')
      ),
      metricId: 'workplace-point.summary.unique-completed-workers'
    },
    {
      label: 'Уникальные бронировали',
      value: formatNumber(summary.uniqueBookedWorkers),
      valueHtml: renderGigerDetailTrigger(
        formatNumber(summary.uniqueBookedWorkers),
        workplacePointGigerUrl(filters, 'unique-booked-workers')
      ),
      metricId: 'workplace-point.summary.unique-booked-workers'
    },
    workplacePointRatingCard(summary, filters),
    { label: 'Слеты < 24ч', value: formatNumber(summary.dropoffs24h), metricId: 'workplace-point.summary.dropoffs-24h' }
  ], currentUser);
}

function renderRadiusWorkerValue(summary, filters, radius) {
  const workers = summary.radiusWorkers ? summary.radiusWorkers[radius] : 0;
  const activeSessionWorkers = summary.radiusActiveSessionWorkers
    ? summary.radiusActiveSessionWorkers[radius]
    : 0;

  return `${renderGigerDetailTrigger(
    formatNumber(workers),
    workplacePointGigerUrl(filters, 'radius-workers', { radiusKm: radius })
  )} / ${renderGigerDetailTrigger(
    formatNumber(activeSessionWorkers),
    workplacePointGigerUrl(filters, 'radius-active-session-workers', { radiusKm: radius })
  )}`;
}

function renderWorkplacePointRadiusKpis(summary, currentUser) {
  const filters = summary.filters || {};

  return renderKpiGrid([
    { label: '5 км', value: formatRadiusWorkerValue(summary, 5), valueHtml: renderRadiusWorkerValue(summary, filters, 5), metricId: 'workplace-point.summary.radius-5km' },
    { label: '10 км', value: formatRadiusWorkerValue(summary, 10), valueHtml: renderRadiusWorkerValue(summary, filters, 10), metricId: 'workplace-point.summary.radius-10km' },
    { label: '15 км', value: formatRadiusWorkerValue(summary, 15), valueHtml: renderRadiusWorkerValue(summary, filters, 15), metricId: 'workplace-point.summary.radius-15km' },
    { label: '20 км', value: formatRadiusWorkerValue(summary, 20), valueHtml: renderRadiusWorkerValue(summary, filters, 20), metricId: 'workplace-point.summary.radius-20km' }
  ], currentUser);
}

function miniChartWidth(value, maxValue) {
  const max = Number(maxValue) || 0;

  if (max <= 0) {
    return '0.0';
  }

  return Math.max(0, Math.min(100, (Number(value) || 0) / max * 100)).toFixed(1);
}

function formatLeadTimeMinutes(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return '-';
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    return '-';
  }

  const totalMinutes = Math.max(0, Math.round(number));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];

  if (days > 0) {
    parts.push(`${formatNumber(days)} д`);
  }

  if (hours > 0 || days > 0) {
    parts.push(`${formatNumber(hours)} ч`);
  }

  if (days === 0 && minutes > 0) {
    parts.push(`${formatNumber(minutes)} мин`);
  }

  return parts.length > 0 ? parts.join(' ') : '0 мин';
}

function formatLeadTimeCompactMinutes(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return '-';
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    return '-';
  }

  const totalMinutes = Math.max(0, Math.round(number));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `${formatNumber(days)}д${hours > 0 ? `${formatNumber(hours)}ч` : ''}`;
  }

  if (hours > 0) {
    return `${formatNumber(hours)}ч${minutes > 0 ? `${formatNumber(minutes)}м` : ''}`;
  }

  return `${formatNumber(minutes)}м`;
}

function renderDailyPointChartValue(row) {
  return `${formatNumber(row.orderedShifts)} / ${formatPercent(row.slaPercent)} / разм. ср. ${formatLeadTimeMinutes(row.orderLeadAvgMinutes)} / мин. ${formatLeadTimeMinutes(row.orderLeadMinMinutes)}`;
}

function renderPanelClass(panelClass) {
  return `detail-panel${panelClass ? ` ${panelClass}` : ''}`;
}

function renderMiniChart({ title, rows, maxValue, valueForRow, labelForRow, textForRow, secondary = false, panelClass = '', metricId, currentUser }) {
  const detailPanelClass = renderPanelClass(panelClass);
  if (rows.length === 0) {
    return `<div class="${detailPanelClass}">
  <h2>${escapeHtml(title)}</h2>
  <p class="empty">Нет данных за выбранный период.</p>
</div>`;
  }

  const fillClass = secondary ? 'mini-chart-fill secondary' : 'mini-chart-fill';
  const chartRows = rows
    .map((row) => {
      const value = valueForRow(row);

      return renderMetricInfoScope({
        className: 'mini-chart-row',
        metricId,
        currentUser,
        content: `
  <div class="mini-chart-label">${escapeHtml(labelForRow(row))}</div>
  <div class="mini-chart-track"><div class="${fillClass}" style="width: ${miniChartWidth(value, maxValue)}%"></div></div>
  <div class="mini-chart-value">${escapeHtml(textForRow(row))}</div>`
      });
    })
    .join('');

  return `<div class="${detailPanelClass}">
  <h2>${escapeHtml(title)}</h2>
  <div class="mini-chart">${chartRows}</div>
</div>`;
}

function renderCompactValueList({ title, rows, labelForRow, textForRow, panelClass = '' }) {
  const detailPanelClass = renderPanelClass(panelClass);

  if (rows.length === 0) {
    return `<div class="${detailPanelClass}">
  <h2>${escapeHtml(title)}</h2>
  <p class="empty">Нет данных за выбранный период.</p>
</div>`;
  }

  const valueRows = rows
    .map(
      (row) => `<div class="compact-value-row">
  <div class="mini-chart-label">${escapeHtml(labelForRow(row))}</div>
  <div class="compact-value">${escapeHtml(textForRow(row))}</div>
</div>`
    )
    .join('');

  return `<div class="${detailPanelClass}">
  <h2>${escapeHtml(title)}</h2>
  <div class="compact-value-list">${valueRows}</div>
</div>`;
}

function renderPointCalendarEmptyCells(count) {
  return Array.from(
    { length: count },
    () => '<div class="point-calendar-cell empty" aria-hidden="true"></div>'
  ).join('');
}

function renderPointCalendarValue(label, value, title = label, metricId, currentUser) {
  const content = `<span title="${escapeHtml(title)}">${escapeHtml(label)}</span>
  <strong>${escapeHtml(value)}</strong>`;

  return renderMetricInfoScope({
    className: 'point-calendar-value',
    metricId,
    currentUser,
    content
  });
}

function renderPointCalendarValueLegacy(label, value, title = label) {
  return `<div class="point-calendar-value">
  <span title="${escapeHtml(title)}">${escapeHtml(label)}</span>
  <strong>${escapeHtml(value)}</strong>
</div>`;
}

function dayLabelFromDateKey(value) {
  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    return String(value || '');
  }

  return String(date.getUTCDate());
}

function calendarSlaLevel(row) {
  if ((Number(row.orderedShifts) || 0) <= 0) {
    return null;
  }

  const sla = Number(row.slaPercent) || 0;

  if (sla >= 90) {
    return 5;
  }

  if (sla >= 70) {
    return 4;
  }

  if (sla >= 50) {
    return 3;
  }

  if (sla >= 30) {
    return 2;
  }

  return 1;
}

function renderPointCalendarCell(row, currentDateKey, filters) {
  const title = `${row.period}: заказ ${formatNumber(row.orderedShifts)}; SLA ${formatPercent(row.slaPercent)}; слеты ${formatNumber(row.dropoffs24h)}; размещение среднее ${formatLeadTimeMinutes(row.orderLeadAvgMinutes)}; размещение минимум ${formatLeadTimeMinutes(row.orderLeadMinMinutes)}`;
  const slaLevel = calendarSlaLevel(row);
  const slaLevelAttribute = slaLevel === null ? '' : ` data-sla-level="${escapeHtml(slaLevel)}"`;
  const isCurrentDay = currentDateKey && row.period === currentDateKey;
  const cellClass = isCurrentDay ? 'point-calendar-cell is-current-day' : 'point-calendar-cell';
  const currentDayAttribute = isCurrentDay ? ' aria-current="date"' : '';
  const detailUrl = workplacePointDayDetailsUrl(filters || {}, row.period);

  return `<div class="${cellClass}" data-date="${escapeHtml(row.period)}"${slaLevelAttribute}${currentDayAttribute} title="${escapeHtml(title)}">
  <button type="button" class="point-calendar-cell-button" data-workplace-point-day-detail-trigger data-detail-url="${escapeHtml(detailUrl)}" aria-label="Открыть детализацию за ${escapeHtml(row.period)}">
    <div class="point-calendar-date">${escapeHtml(dayLabelFromDateKey(row.period))}</div>
    <div class="point-calendar-values">
      ${renderPointCalendarValue('З', formatNumber(row.orderedShifts), 'Заказ')}
      ${renderPointCalendarValue('SLA', formatPercent(row.slaPercent))}
      ${renderPointCalendarValue('Сл', formatNumber(row.dropoffs24h), 'Слеты')}
      ${renderPointCalendarValue('Ср', formatLeadTimeCompactMinutes(row.orderLeadAvgMinutes), 'Размещение среднее')}
      ${renderPointCalendarValue('М', formatLeadTimeCompactMinutes(row.orderLeadMinMinutes), 'Размещение минимум')}
    </div>
  </button>
</div>`;
}

function renderPointCalendarCell(row, currentDateKey, filters, currentUser) {
  const title = `${row.period}: заказ ${formatNumber(row.orderedShifts)}; SLA ${formatPercent(row.slaPercent)}; слеты ${formatNumber(row.dropoffs24h)}; размещение среднее ${formatLeadTimeMinutes(row.orderLeadAvgMinutes)}; размещение минимум ${formatLeadTimeMinutes(row.orderLeadMinMinutes)}`;
  const slaLevel = calendarSlaLevel(row);
  const slaLevelAttribute = slaLevel === null ? '' : ` data-sla-level="${escapeHtml(slaLevel)}"`;
  const isCurrentDay = currentDateKey && row.period === currentDateKey;
  const cellClass = isCurrentDay ? 'point-calendar-cell is-current-day' : 'point-calendar-cell';
  const currentDayAttribute = isCurrentDay ? ' aria-current="date"' : '';
  const detailUrl = workplacePointDayDetailsUrl(filters || {}, row.period);
  const hasSqlInspector = canViewSqlInspector(currentUser);
  const controlOpen = hasSqlInspector
    ? `<div class="point-calendar-cell-button" role="button" tabindex="0" data-workplace-point-day-detail-trigger data-detail-url="${escapeHtml(detailUrl)}" aria-label="Открыть детализацию за ${escapeHtml(row.period)}">`
    : `<button type="button" class="point-calendar-cell-button" data-workplace-point-day-detail-trigger data-detail-url="${escapeHtml(detailUrl)}" aria-label="Открыть детализацию за ${escapeHtml(row.period)}">`;
  const controlClose = hasSqlInspector ? '</div>' : '</button>';

  return `<div class="${cellClass}" data-date="${escapeHtml(row.period)}"${slaLevelAttribute}${currentDayAttribute} title="${escapeHtml(title)}">
  ${controlOpen}
    <div class="point-calendar-date">${escapeHtml(dayLabelFromDateKey(row.period))}</div>
    <div class="point-calendar-values">
      ${renderPointCalendarValue('З', formatNumber(row.orderedShifts), 'Заказ', 'workplace-point.charts.calendar-ordered-shifts', currentUser)}
      ${renderPointCalendarValue('SLA', formatPercent(row.slaPercent), 'SLA', 'workplace-point.charts.calendar-sla', currentUser)}
      ${renderPointCalendarValue('Сл', formatNumber(row.dropoffs24h), 'Слеты', 'workplace-point.charts.calendar-dropoffs-24h', currentUser)}
      ${renderPointCalendarValue('Ср', formatLeadTimeCompactMinutes(row.orderLeadAvgMinutes), 'Размещение среднее', 'workplace-point.charts.calendar-order-lead-avg', currentUser)}
      ${renderPointCalendarValue('М', formatLeadTimeCompactMinutes(row.orderLeadMinMinutes), 'Размещение минимум', 'workplace-point.charts.calendar-order-lead-min', currentUser)}
    </div>
  ${controlClose}
</div>`;
}

function dateKeyFromValue(value) {
  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function currentDateKeyFromValue(value = new Date()) {
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);

    if (match) {
      return match[1];
    }
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.year}-${values.month}-${values.day}`;
}

function monthKeyFromDateKey(value) {
  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    return String(value || '');
  }

  return date.toISOString().slice(0, 7);
}

function monthLabelFromDateKey(value) {
  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    return String(value || '');
  }

  const monthNames = [
    'Январь',
    'Февраль',
    'Март',
    'Апрель',
    'Май',
    'Июнь',
    'Июль',
    'Август',
    'Сентябрь',
    'Октябрь',
    'Ноябрь',
    'Декабрь'
  ];

  return `${monthNames[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function buildCalendarDateKeys(from, to) {
  const startKey = dateKeyFromValue(from);
  const endKey = dateKeyFromValue(to);

  if (!startKey || !endKey) {
    return [];
  }

  const date = new Date(`${startKey}T00:00:00.000Z`);
  const endDate = new Date(`${endKey}T00:00:00.000Z`);
  const keys = [];

  while (date <= endDate && keys.length < 370) {
    keys.push(date.toISOString().slice(0, 10));
    date.setUTCDate(date.getUTCDate() + 1);
  }

  return keys;
}

function pointCalendarRows(rows, filters) {
  const rowsByPeriod = new Map(rows.map((row) => [String(row.period || ''), row]));
  const dateKeys = buildCalendarDateKeys(filters.from, filters.to);

  if (dateKeys.length === 0) {
    return rows;
  }

  return dateKeys.map((period) => ({
    period,
    orderedShifts: 0,
    completedShifts: 0,
    slaPercent: 0,
    dropoffs24h: 0,
    orderLeadAvgMinutes: null,
    orderLeadMinMinutes: null,
    ...(rowsByPeriod.get(period) || {})
  }));
}

function groupPointCalendarRowsByMonth(rows) {
  const groups = [];

  for (const row of rows) {
    const monthKey = monthKeyFromDateKey(row.period);
    const lastGroup = groups[groups.length - 1];

    if (!lastGroup || lastGroup.monthKey !== monthKey) {
      groups.push({
        monthKey,
        label: monthLabelFromDateKey(row.period),
        rows: []
      });
    }

    groups[groups.length - 1].rows.push(row);
  }

  return groups;
}

function renderPointCalendarMonth(group, weekdays, currentDateKey, filters, currentUser) {
  const leadingEmptyCount = weekdayOffsetFromMonday(group.rows[0].period);
  const totalCells = leadingEmptyCount + group.rows.length;
  const trailingEmptyCount = (7 - (totalCells % 7)) % 7;
  const cells = group.rows.map((row) => renderPointCalendarCell(row, currentDateKey, filters, currentUser)).join('');

  return `<div class="point-calendar-month">
    <h3 class="point-calendar-month-title">${escapeHtml(group.label)}</h3>
    <div class="point-calendar-weekdays">${weekdays}</div>
    <div class="point-calendar-grid">${renderPointCalendarEmptyCells(leadingEmptyCount)}${cells}${renderPointCalendarEmptyCells(trailingEmptyCount)}</div>
  </div>`;
}

function renderPointCalendar(rows, filters, currentDateValue = new Date(), currentUser) {
  const detailPanelClass = renderPanelClass('calendar-panel');
  const calendarRows = pointCalendarRows(rows, filters);

  if (calendarRows.length === 0) {
    return `<div class="${detailPanelClass}">
  <h2>Календарь заказа и SLA</h2>
  <p class="empty">Нет данных за выбранный период.</p>
</div>`;
  }

  const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
    .map((weekday) => `<div class="point-calendar-weekday">${escapeHtml(weekday)}</div>`)
    .join('');
  const currentDateKey = currentDateKeyFromValue(currentDateValue);
  const months = groupPointCalendarRowsByMonth(calendarRows)
    .map((group) => renderPointCalendarMonth(group, weekdays, currentDateKey, filters, currentUser))
    .join('');

  return `<div class="${detailPanelClass}">
  <h2>Календарь заказа и SLA</h2>
  <div class="point-calendar" aria-label="Календарь заказа, SLA и слетов по дням">
    ${months}
  </div>
</div>`;
}

function renderWorkplacePointCharts(dashboard, currentUser) {
  const maxProfessionOrders = Math.max(0, ...dashboard.professionRows.map((row) => Number(row.orderedShifts) || 0));

  return `<div class="detail-grid point-detail-grid">
  ${renderPointCalendar(dashboard.dailyRows, dashboard.filters, dashboard.currentDate, currentUser)}
  ${renderMiniChart({
    title: 'Профессии точки',
    rows: dashboard.professionRows,
    maxValue: maxProfessionOrders,
    valueForRow: (row) => row.orderedShifts,
    labelForRow: (row) => row.profession,
    textForRow: (row) => `${formatNumber(row.orderedShifts)} · ${formatPercent(row.sharePercent)}`,
    panelClass: 'profession-panel',
    metricId: 'workplace-point.charts.professions',
    currentUser
  })}
</div>`;
}

function renderWorkplacePointDashboard({
  database,
  dashboard,
  progressive = false,
  currentUser,
  csrfToken
}) {
  const filters = dashboard.filters;
  const point = dashboard.point;
  const detailSections = progressive
    ? `<div data-dashboard-fragment-url="${escapeHtml(workplacePointSectionUrl(filters, 'summary'))}">
  <section class="section">
    <h2>Основные показатели</h2>
    <p class="loading">Загружается</p>
  </section>
</div>
<div data-dashboard-fragment-url="${escapeHtml(workplacePointSectionUrl(filters, 'radius'))}">
  <section class="section">
    <h2>База вокруг точки</h2>
    <p class="loading">Загружается</p>
  </section>
</div>
<div data-dashboard-fragment-url="${escapeHtml(workplacePointSectionUrl(filters, 'charts'))}">
  <section class="section">
    <h2>Календарь и профессии</h2>
    <p class="loading">Загружается</p>
  </section>
</div>`
    : `<section class="section">
  ${renderMetricPanelHead('Основные показатели', 'workplace-point.summary', currentUser)}
  ${renderWorkplacePointKpis({ ...dashboard.summary, filters }, currentUser)}
</section>
<section class="section">
  ${renderWorkplacePointCharts(dashboard, currentUser)}
</section>`;
  const content = `<section class="section">
  <a class="back-link" href="/dashboards/workplace-analysis">Анализ точек</a>
  <div class="detail-header">
    <h1>Детализация точки</h1>
    <h2>${escapeHtml(point.title)}</h2>
    <p class="context-line">${escapeHtml([point.clientTitle, point.city, point.region, point.address].filter(Boolean).join(' · '))}</p>
  </div>
</section>
<section class="section">
  <form class="filter-bar" action="/dashboards/workplace-analysis/point" method="get">
    <input type="hidden" name="workplaceId" value="${escapeHtml(filters.workplaceId)}">
    <div class="field">
      <label for="from">С</label>
      <input id="from" name="from" type="date" value="${escapeHtml(filters.from)}">
    </div>
    <div class="field">
      <label for="to">По</label>
      <input id="to" name="to" type="date" value="${escapeHtml(filters.to)}">
    </div>
    ${renderMultiSelectField({
      id: 'profession',
      label: 'Профессия',
      options: filterOptions(dashboard, 'profession'),
      selected: filters.profession
    })}
    ${renderMultiSelectField({
      id: 'orderType',
      label: 'Тип заказа',
      options: filterOptions(dashboard, 'orderType'),
      selected: filters.orderType,
      labelForValue: orderTypeLabel
    })}
    ${renderMultiSelectField({
      id: 'jobStatus',
      label: 'Статус задания',
      options: filterOptions(dashboard, 'jobStatus'),
      selected: filters.jobStatus
    })}
    ${renderCheckboxField({
      id: 'includeDeletedOrders',
      label: 'Учитывать удаленные',
      checked: filters.includeDeletedOrders
    })}
    ${renderCheckboxField({
      id: 'includeHiddenOrders',
      label: 'Учитывать скрытые',
      checked: filters.includeHiddenOrders
    })}
    <button type="submit">Применить</button>
  </form>
</section>
${detailSections}
${renderWorkplacePointDayModal()}
${renderWorkplacePointReviewModal()}
${renderGigerListModal()}`;

  return layout({
    title: 'Детализация точки',
    database,
    content,
    activeNav: 'workplace-analysis',
    currentUser,
    csrfToken
  });
}

function renderWorkplacePointDashboardSection({ dashboard, section, currentUser }) {
  if (section === 'summary') {
    return `<section class="section">
  ${renderMetricPanelHead('Основные показатели', 'workplace-point.summary', currentUser)}
  ${renderWorkplacePointSummaryKpis({ ...dashboard.summary, filters: dashboard.filters }, currentUser)}
</section>`;
  }

  if (section === 'radius') {
    return `<section class="section">
  ${renderMetricPanelHead('База вокруг точки', 'workplace-point.radius', currentUser)}
  ${renderWorkplacePointRadiusKpis({ ...dashboard.summary, filters: dashboard.filters }, currentUser)}
</section>`;
  }

  if (section === 'charts') {
    return `<section class="section">
  ${renderWorkplacePointCharts(dashboard, currentUser)}
</section>`;
  }

  return `<section class="section"><div class="error">Неизвестный блок дашборда.</div></section>`;
}

function renderWorkplaceAnalysisDashboard({
  database,
  dashboard,
  progressive = false,
  currentUser,
  csrfToken
}) {
  const filters = dashboard.filters;
  const pointsHtml = progressive
    ? `<div data-dashboard-fragment-url="${escapeHtml(workplaceAnalysisSectionUrl(filters, 'points'))}">
  <section class="section">
    <h2>Точки</h2>
    ${renderDashboardLoadingState()}
  </section>
</div>`
    : renderWorkplaceAnalysisPointsSection(dashboard, currentUser);
  const attentionHtml = progressive
    ? `<div data-dashboard-fragment-url="${escapeHtml(workplaceAnalysisSectionUrl(filters, 'attention'))}">
  <section class="section">
    <h2>Точки, требующие внимания</h2>
    ${renderDashboardLoadingState()}
  </section>
</div>`
    : renderWorkplaceAttentionSection(dashboard, currentUser);
  const content = `<section class="section">
  ${renderDashboardHeader({
    title: 'Анализ точек',
    eyebrow: 'Операции',
    period: `Период: ${filters.from} - ${filters.to}`,
    details: [`Дней: ${filters.rangeDays}`, dashboard.context && dashboard.context.sortLabel ? dashboard.context.sortLabel : '']
  })}
  ${renderActiveFilterChips(filters)}
  <p class="technical-note">Стабильность = доля дней с плановым заказом по mg_orders.amount.</p>
</section>
<section class="section">
  <form class="filter-bar" action="/dashboards/workplace-analysis" method="get">
    ${renderPinnedWorkplaceHiddenInputs(filters)}
    <div class="field">
      <label for="from">С</label>
      <input id="from" name="from" type="date" value="${escapeHtml(filters.from)}">
    </div>
    <div class="field">
      <label for="to">По</label>
      <input id="to" name="to" type="date" value="${escapeHtml(filters.to)}">
    </div>
    ${renderMultiSelectField({
      id: 'client',
      label: 'Бренд',
      options: filterOptions(dashboard, 'client'),
      selected: filters.client
    })}
    ${renderMultiSelectField({
      id: 'city',
      label: 'Город',
      options: filterOptions(dashboard, 'city'),
      selected: filters.city
    })}
    ${renderMultiSelectField({
      id: 'region',
      label: 'Регион',
      options: filterOptions(dashboard, 'region'),
      selected: filters.region
    })}
    ${renderMultiSelectField({
      id: 'profession',
      label: 'Специальность',
      options: filterOptions(dashboard, 'profession'),
      selected: filters.profession
    })}
    ${renderMultiSelectField({
      id: 'orderType',
      label: 'Тип заказа',
      options: filterOptions(dashboard, 'orderType'),
      selected: filters.orderType,
      labelForValue: orderTypeLabel
    })}
    ${renderMultiSelectField({
      id: 'jobStatus',
      label: 'Статус задания',
      options: filterOptions(dashboard, 'jobStatus'),
      selected: filters.jobStatus
    })}
    ${renderMultiSelectField({
      id: 'contractor',
      label: 'Контрагент',
      options: filterOptions(dashboard, 'contractor'),
      selected: filters.contractor
    })}
    ${renderCheckboxField({
      id: 'includeDeletedOrders',
      label: 'Учитывать удаленные',
      checked: filters.includeDeletedOrders
    })}
    ${renderCheckboxField({
      id: 'includeHiddenOrders',
      label: 'Учитывать скрытые',
      checked: filters.includeHiddenOrders
    })}
    <div class="field workplace-search-field">
      <label for="search">Поиск точки</label>
      <input id="search" name="search" type="search" list="workplace-search-suggestions" value="${escapeHtml(filters.search)}" placeholder="ID, название или адрес" autocomplete="off" data-workplace-suggest-url="/dashboards/workplace-analysis/workplaces/suggest">
      <datalist id="workplace-search-suggestions"></datalist>
    </div>
    <div class="field">
      <label for="sort">Сортировка</label>
      <select id="sort" name="sort">${renderSortOptions(filters.sort)}</select>
    </div>
    ${renderMetricRangeFields(filters)}
    <div class="field">
      <label for="limit">Лимит</label>
      <select id="limit" name="limit">${renderLimitOptions(filters.limit)}</select>
    </div>
    <button type="submit">Применить</button>
  </form>
</section>
<section class="section dashboard-tabs">
  <input class="dashboard-tab-input" type="radio" id="workplace-tab-points" name="workplace-analysis-tab" checked>
  <input class="dashboard-tab-input" type="radio" id="workplace-tab-attention" name="workplace-analysis-tab">
  <div class="dashboard-tab-list" role="tablist" aria-label="Подвкладки анализа точек">
    <label class="dashboard-tab" for="workplace-tab-points" role="tab">Обзор точек</label>
    <label class="dashboard-tab" for="workplace-tab-attention" role="tab">Требуют внимания</label>
  </div>
  <div class="dashboard-tab-panels">
    <div class="dashboard-tab-panel dashboard-tab-panel-points">${pointsHtml}</div>
    <div class="dashboard-tab-panel dashboard-tab-panel-attention">${attentionHtml}</div>
  </div>
</section>
${renderGigerListModal()}`;

  return layout({
    title: 'Анализ точек',
    database,
    content,
    activeNav: 'workplace-analysis',
    currentUser,
    csrfToken
  });
}

function renderWorkplaceAnalysisDashboardSection({ dashboard, section, currentUser }) {
  if (section === 'points') {
    return renderWorkplaceAnalysisPointsSection(dashboard, currentUser);
  }

  if (section === 'attention') {
    return renderWorkplaceAttentionSection(dashboard, currentUser);
  }

  return `<section class="section"><div class="error">Неизвестный блок дашборда.</div></section>`;
}

function rangeFilterValue(value) {
  return value === null || value === undefined ? '' : String(value);
}

function renderCityOptions(dashboard, selectedCity) {
  const selected = String(selectedCity || '');
  const options = filterOptions(dashboard, 'city');
  const values = [];
  const seen = new Set();

  for (const option of options) {
    const value = String(option);

    if (value === '' || seen.has(value)) {
      continue;
    }

    seen.add(value);
    values.push(value);
  }

  if (selected !== '' && !seen.has(selected)) {
    values.push(selected);
  }

  return [
    `<option value=""${selected === '' ? ' selected' : ''}>Выберите город</option>`,
    ...values.map((value) => {
      const selectedAttribute = value === selected ? ' selected' : '';

      return `<option value="${escapeHtml(value)}"${selectedAttribute}>${escapeHtml(value)}</option>`;
    })
  ].join('');
}

function renderNumberField({ id, label, value }) {
  return `<div class="field">
      <label for="${escapeHtml(id)}">${escapeHtml(label)}</label>
      <input id="${escapeHtml(id)}" name="${escapeHtml(id)}" type="number" min="0" step="any" value="${escapeHtml(rangeFilterValue(value))}">
    </div>`;
}

function renderCheckboxField({ id, label, checked }) {
  const checkedAttribute = checked ? ' checked' : '';

  return `<div class="field checkbox-field">
      <label for="${escapeHtml(id)}">${escapeHtml(label)}</label>
      <input id="${escapeHtml(id)}" name="${escapeHtml(id)}" type="checkbox" value="1"${checkedAttribute}>
    </div>`;
}

function renderCityKpiCard({ label, value, detail, fragmentUrl = '' }) {
  const fragmentAttribute =
    fragmentUrl === '' ? '' : ` data-dashboard-fragment-url="${escapeHtml(fragmentUrl)}"`;

  return `<div class="kpi-card"${fragmentAttribute}>
  <div class="kpi-label">${escapeHtml(label)}</div>
  <div class="kpi-value">${escapeHtml(value)}</div>
  ${detail ? `<div class="kpi-subvalue">${escapeHtml(detail)}</div>` : ''}
</div>`;
}

function renderCityKpiCards(summary) {
  const cards = [
    { label: 'Заказ', value: formatNumber(summary.orderedShifts) },
    { label: 'Не удаленные заявки', value: formatNumber(summary.activeOrderRequests) },
    { label: 'Общая база', value: formatNumber(summary.totalLocatedUsers) },
    {
      label: 'Активная база',
      value: formatNumber(summary.readyLocatedUsers),
      detail: `ready ${formatNumber(summary.readyStatusLocatedUsers)} · booked ${formatNumber(summary.bookedStatusLocatedUsers)} · worked ${formatNumber(summary.workedStatusLocatedUsers)}`
    },
    { label: 'Входили в приложение', value: formatNumber(summary.appActiveUsers) },
    {
      label: 'Активная за 30 дней',
      value: formatNumber(summary.app30dActiveUsers),
      detail: `ready ${formatNumber(summary.app30dReadyStatusUsers)} · booked ${formatNumber(summary.app30dBookedStatusUsers)} · worked ${formatNumber(summary.app30dWorkedStatusUsers)}`
    },
    { label: 'Откликались', value: formatNumber(summary.bookedUsers) },
    { label: 'Завершали', value: formatNumber(summary.completedUsers) },
    { label: '30д активные / заявка', value: formatNumber(summary.avgDaily30dActiveUsersPerRequest, 1) }
  ];

  return `<div class="kpi-grid">${cards.map((card) => renderCityKpiCard(card)).join('')}</div>`;
}

function renderCityKpiCard({ label, value, detail, valueHtml, detailHtml, fragmentUrl = '', metricId, currentUser }) {
  return renderKpiGrid([{ label, value, detail, valueHtml, detailHtml, fragmentUrl, metricId }], currentUser).replace(/^<div class="kpi-grid">|<\/div>$/g, '');
}

function cityGigerValueHtml(filters, metric, value, overrides = {}) {
  return renderGigerDetailTrigger(formatNumber(value), cityAnalysisGigerUrl(filters, metric, overrides));
}

function cityGigerStatusDetailHtml(filters, metric, statuses) {
  return [
    ['ready', 'ready', statuses.ready],
    ['booked', 'booked', statuses.booked],
    ['worked', 'worked', statuses.worked]
  ]
    .map(([label, status, value]) => `${escapeHtml(label)} ${renderGigerDetailTrigger(formatNumber(value), cityAnalysisGigerUrl(filters, metric, { status }))}`)
    .join(' · ');
}

function renderCityKpiCards(summary, currentUser, filters = {}) {
  return renderKpiGrid([
    { label: 'Заказ', value: formatNumber(summary.orderedShifts), metricId: 'city-analysis.summary.ordered-shifts' },
    { label: 'Не удаленные заявки', value: formatNumber(summary.activeOrderRequests), metricId: 'city-analysis.summary.active-order-requests' },
    {
      label: 'Общая база',
      value: formatNumber(summary.totalLocatedUsers),
      valueHtml: cityGigerValueHtml(filters, 'total-located-users', summary.totalLocatedUsers),
      metricId: 'city-analysis.summary.total-located-users'
    },
    {
      label: 'Активная база',
      value: formatNumber(summary.readyLocatedUsers),
      detail: `ready ${formatNumber(summary.readyStatusLocatedUsers)} · booked ${formatNumber(summary.bookedStatusLocatedUsers)} · worked ${formatNumber(summary.workedStatusLocatedUsers)}`,
      valueHtml: cityGigerValueHtml(filters, 'ready-located-users', summary.readyLocatedUsers),
      detailHtml: cityGigerStatusDetailHtml(filters, 'ready-located-users', {
        ready: summary.readyStatusLocatedUsers,
        booked: summary.bookedStatusLocatedUsers,
        worked: summary.workedStatusLocatedUsers
      }),
      metricId: 'city-analysis.summary.ready-located-users'
    },
    {
      label: 'Входили в приложение',
      value: formatNumber(summary.appActiveUsers),
      valueHtml: cityGigerValueHtml(filters, 'app-active-users', summary.appActiveUsers),
      metricId: 'city-analysis.summary.app-active-users'
    },
    {
      label: 'Активная за 30 дней',
      value: formatNumber(summary.app30dActiveUsers),
      detail: `ready ${formatNumber(summary.app30dReadyStatusUsers)} · booked ${formatNumber(summary.app30dBookedStatusUsers)} · worked ${formatNumber(summary.app30dWorkedStatusUsers)}`,
      valueHtml: cityGigerValueHtml(filters, 'app-30d-active-users', summary.app30dActiveUsers),
      detailHtml: cityGigerStatusDetailHtml(filters, 'app-30d-active-users', {
        ready: summary.app30dReadyStatusUsers,
        booked: summary.app30dBookedStatusUsers,
        worked: summary.app30dWorkedStatusUsers
      }),
      metricId: 'city-analysis.summary.app-30d-active-users'
    },
    {
      label: 'Откликались',
      value: formatNumber(summary.bookedUsers),
      valueHtml: cityGigerValueHtml(filters, 'booked-users', summary.bookedUsers),
      metricId: 'city-analysis.summary.booked-users'
    },
    {
      label: 'Завершали',
      value: formatNumber(summary.completedUsers),
      valueHtml: cityGigerValueHtml(filters, 'completed-users', summary.completedUsers),
      metricId: 'city-analysis.summary.completed-users'
    },
    { label: '30д активные / заявка', value: formatNumber(summary.avgDaily30dActiveUsersPerRequest, 1), metricId: 'city-analysis.summary.avg-daily-30d-active-users-per-request' }
  ], currentUser);
}

function addCityAnalysisQueryParam(params, key, value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item !== null && item !== undefined && String(item) !== '') {
        params.append(key, String(item));
      }
    }

    return;
  }

  if (value !== null && value !== undefined && String(value) !== '') {
    params.append(key, String(value));
  }
}

function cityAnalysisGigerUrl(filters = {}, metric, overrides = {}) {
  const params = new URLSearchParams();

  addCityAnalysisQueryParam(params, 'from', filters.from);
  addCityAnalysisQueryParam(params, 'to', filters.to);
  addCityAnalysisQueryParam(params, 'city', filters.city);
  addCityAnalysisQueryParam(params, 'client', filters.client);
  addCityAnalysisQueryParam(params, 'profession', filters.profession);
  addCityAnalysisQueryParam(params, 'orderType', filters.orderType);
  addCityAnalysisQueryParam(params, 'jobStatus', filters.jobStatus);
  addCityAnalysisQueryParam(params, 'contractor', filters.contractor);
  addCityAnalysisQueryParam(params, 'salaryFrom', filters.salaryFrom);
  addCityAnalysisQueryParam(params, 'salaryTo', filters.salaryTo);

  if (filters.includeDeletedOrders) {
    params.set('includeDeletedOrders', '1');
  }

  if (filters.includeHiddenOrders) {
    params.set('includeHiddenOrders', '1');
  }

  addCityAnalysisQueryParam(params, 'metric', metric);
  addCityAnalysisQueryParam(params, 'status', overrides.status);
  addCityAnalysisQueryParam(params, 'date', overrides.date);

  return `/dashboards/city-analysis/gigers?${params.toString()}`;
}

function cityAnalysisSectionUrl(filters, section) {
  const params = new URLSearchParams();

  params.set('section', section);
  addCityAnalysisQueryParam(params, 'from', filters.from);
  addCityAnalysisQueryParam(params, 'to', filters.to);
  addCityAnalysisQueryParam(params, 'city', filters.city);
  addCityAnalysisQueryParam(params, 'client', filters.client);
  addCityAnalysisQueryParam(params, 'profession', filters.profession);
  addCityAnalysisQueryParam(params, 'orderType', filters.orderType);
  addCityAnalysisQueryParam(params, 'jobStatus', filters.jobStatus);
  addCityAnalysisQueryParam(params, 'contractor', filters.contractor);
  addCityAnalysisQueryParam(params, 'salaryFrom', filters.salaryFrom);
  addCityAnalysisQueryParam(params, 'salaryTo', filters.salaryTo);

  if (filters.includeDeletedOrders) {
    params.set('includeDeletedOrders', '1');
  }

  if (filters.includeHiddenOrders) {
    params.set('includeHiddenOrders', '1');
  }

  return `/dashboards/city-analysis/section?${params.toString()}`;
}

function renderCityLoadingKpiCard({ label, section, filters }) {
  return renderCityKpiCard({
    label,
    value: 'Загружается',
    fragmentUrl: cityAnalysisSectionUrl(filters, section)
  });
}

function renderCityProgressiveSections(dashboard) {
  const filters = dashboard.filters || {};
  const context = dashboard.context || {};
  const hasCity =
    typeof context.hasCity === 'boolean' ? context.hasCity : String(filters.city || '') !== '';

  if (!hasCity) {
    return `<section class="section">
  <p class="empty">Выберите город для анализа.</p>
</section>`;
  }

  return `<section class="section" data-city-analysis-progressive>
  <h2>Баланс спроса и базы</h2>
  <div class="kpi-grid">
    ${renderCityLoadingKpiCard({ label: 'Заказ', section: 'summary-demand', filters })}
    ${renderCityLoadingKpiCard({ label: 'Общая база', section: 'summary-base', filters })}
    ${renderCityLoadingKpiCard({ label: 'Входили в приложение', section: 'summary-app', filters })}
    ${renderCityLoadingKpiCard({ label: 'Отклики / завершения', section: 'summary-responses', filters })}
    ${renderCityLoadingKpiCard({ label: '30д активные / заявка', section: 'summary-ratio', filters })}
  </div>
</section>
<div data-dashboard-fragment-url="${escapeHtml(cityAnalysisSectionUrl(filters, 'composition'))}">
  <section class="section">
    <h2>Состав заказа</h2>
    <p class="loading">Загружается</p>
  </section>
</div>
<div data-dashboard-fragment-url="${escapeHtml(cityAnalysisSectionUrl(filters, 'dynamics'))}">
  <section class="section">
    <h2>Динамика</h2>
    <p class="loading">Загружается</p>
  </section>
</div>`;
}

function renderCityAnalysisDashboardSection({ dashboard, section, currentUser }) {
  const summary = dashboard.summary || {};
  const context = dashboard.context || {};
  const filters = dashboard.filters || {};

  if (section === 'summary-demand') {
    return [
      renderCityKpiCard({
        label: 'Заказ',
        value: formatNumber(summary.orderedShifts),
        metricId: 'city-analysis.summary.ordered-shifts',
        currentUser
      }),
      renderCityKpiCard({
        label: 'Не удаленные заявки',
        value: formatNumber(summary.activeOrderRequests),
        metricId: 'city-analysis.summary.active-order-requests',
        currentUser
      })
    ].join('');
  }

  if (section === 'summary-base') {
    const coordinateDetail =
      context.hasCityCoordinates === false
        ? 'Нет координат точек для расчета базы в радиусе 15 км.'
        : '';

    return [
      renderCityKpiCard({
        label: 'Общая база',
        value: formatNumber(summary.totalLocatedUsers),
        valueHtml: cityGigerValueHtml(filters, 'total-located-users', summary.totalLocatedUsers),
        detail: coordinateDetail,
        metricId: 'city-analysis.summary.total-located-users',
        currentUser
      }),
      renderCityKpiCard({
        label: 'Активная база',
        value: formatNumber(summary.readyLocatedUsers),
        detail: `ready ${formatNumber(summary.readyStatusLocatedUsers)} · booked ${formatNumber(summary.bookedStatusLocatedUsers)} · worked ${formatNumber(summary.workedStatusLocatedUsers)}`,
        valueHtml: cityGigerValueHtml(filters, 'ready-located-users', summary.readyLocatedUsers),
        detailHtml: cityGigerStatusDetailHtml(filters, 'ready-located-users', {
          ready: summary.readyStatusLocatedUsers,
          booked: summary.bookedStatusLocatedUsers,
          worked: summary.workedStatusLocatedUsers
        }),
        metricId: 'city-analysis.summary.ready-located-users',
        currentUser
      })
    ].join('');
  }

  if (section === 'summary-app') {
    return [
      renderCityKpiCard({
        label: 'Входили в приложение',
        value: formatNumber(summary.appActiveUsers),
        valueHtml: cityGigerValueHtml(filters, 'app-active-users', summary.appActiveUsers),
        metricId: 'city-analysis.summary.app-active-users',
        currentUser
      }),
      renderCityKpiCard({
        label: 'Активная за 30 дней',
        value: formatNumber(summary.app30dActiveUsers),
        detail: `ready ${formatNumber(summary.app30dReadyStatusUsers)} · booked ${formatNumber(summary.app30dBookedStatusUsers)} · worked ${formatNumber(summary.app30dWorkedStatusUsers)}`,
        valueHtml: cityGigerValueHtml(filters, 'app-30d-active-users', summary.app30dActiveUsers),
        detailHtml: cityGigerStatusDetailHtml(filters, 'app-30d-active-users', {
          ready: summary.app30dReadyStatusUsers,
          booked: summary.app30dBookedStatusUsers,
          worked: summary.app30dWorkedStatusUsers
        }),
        metricId: 'city-analysis.summary.app-30d-active-users',
        currentUser
      })
    ].join('');
  }

  if (section === 'summary-responses') {
    return [
      renderCityKpiCard({
        label: 'Откликались',
        value: formatNumber(summary.bookedUsers),
        valueHtml: cityGigerValueHtml(filters, 'booked-users', summary.bookedUsers),
        metricId: 'city-analysis.summary.booked-users',
        currentUser
      }),
      renderCityKpiCard({
        label: 'Завершали',
        value: formatNumber(summary.completedUsers),
        valueHtml: cityGigerValueHtml(filters, 'completed-users', summary.completedUsers),
        metricId: 'city-analysis.summary.completed-users',
        currentUser
      })
    ].join('');
  }

  if (section === 'summary-ratio') {
    return renderCityKpiCard({
      label: '30д активные / заявка',
      value: formatNumber(summary.avgDaily30dActiveUsersPerRequest, 1),
      metricId: 'city-analysis.summary.avg-daily-30d-active-users-per-request',
      currentUser
    });
  }

  if (section === 'composition') {
    return renderCityComposition(dashboard.composition, currentUser);
  }

  if (section === 'dynamics') {
    return renderCityDynamics(dashboard.dynamics, currentUser, filters);
  }

  return `<section class="section"><div class="error">Неизвестный блок дашборда.</div></section>`;
}

function renderCityAnalysisSectionError({ message, section }) {
  if (String(section || '').startsWith('summary-')) {
    return renderCityKpiCard({
      label: 'Ошибка загрузки',
      value: '-',
      detail: message
    });
  }

  return `<section class="section"><div class="error">${escapeHtml(message)}</div></section>`;
}

function safeRows(rows) {
  return Array.isArray(rows) ? rows : [];
}

function renderMiniBarPanel({ title, rows, valueForWidth, metaForRow, metaHtmlForRow, metricId, rowMetricId, currentUser }) {
  const panelRows = safeRows(rows);
  const titleHtml = renderMetricInfoScope({
    tag: 'h3',
    className: 'mini-panel-title',
    metricId,
    currentUser,
    content: escapeHtml(title)
  });

  if (panelRows.length === 0) {
    return `<article class="mini-panel">
  ${titleHtml}
  ${renderEmptyDashboardTable()}
</article>`;
  }

  const maxValue = Math.max(...panelRows.map((row) => Number(valueForWidth(row)) || 0), 0);
  const rowsHtml = panelRows
    .map((row) => {
      const rawValue = Number(valueForWidth(row)) || 0;
      const width = maxValue > 0 ? clampPercent((rawValue / maxValue) * 100) : 0;

      const metricIdForRow = typeof rowMetricId === 'function' ? rowMetricId(row) : rowMetricId;
      const metaHtml = typeof metaHtmlForRow === 'function'
        ? metaHtmlForRow(row)
        : escapeHtml(metaForRow(row));
      const content = `<div class="mini-row-head">
      <span class="mini-label">${escapeHtml(row.label || '')}</span>
      <span class="mini-meta">${metaHtml}</span>
    </div>
    <div class="mini-bar-track"><div class="mini-bar-fill" style="width: ${escapeHtml(formatNumber(width, 1).replace(',', '.'))}%"></div></div>`;

      return renderMetricInfoScope({
        className: 'mini-bar-row',
        metricId: metricIdForRow,
        currentUser,
        content
      });
    })
    .join('');

  return `<article class="mini-panel">
  ${titleHtml}
  <div class="mini-bar-list">${rowsHtml}</div>
</article>`;
}

function cityCompositionMeta(row) {
  return `${formatNumber(row.orderedShifts)} смен · ${formatPercent(row.sharePercent)}`;
}

function cityRateBucketMeta(row) {
  return `${formatNumber(row.orderedShifts)} смен · ${formatPercent(row.sharePercent)} · средняя ставка ${formatNumber(row.avgSalaryPerHour)}`;
}

function cityDynamicsMeta(row) {
  return `заказ ${formatNumber(row.orderedShifts)} · входы ${formatNumber(row.appActiveUsers)} · отклики ${formatNumber(row.bookedUsers)} · завершения ${formatNumber(row.completedUsers)} · актив/заявка ${formatNumber(row.activeUsersPerRequest, 1)}`;
}

function cssPercent(value) {
  return escapeHtml(formatNumber(clampPercent(value), 1).replace(',', '.'));
}

function maxCityDynamicValue(rows, key) {
  return Math.max(...rows.map((row) => Number(row[key]) || 0), 0);
}

function cityDynamicWidth(value, maxValue) {
  return maxValue > 0 ? ((Number(value) || 0) / maxValue) * 100 : 0;
}

function cityHeatmapLevel(value, maxValue) {
  if (maxValue <= 0 || Number(value) <= 0) {
    return 0;
  }

  return Math.max(1, Math.min(4, Math.ceil((Number(value) / maxValue) * 4)));
}

function renderCityMetricLine({ label, value, maxValue, className }) {
  return `<div class="city-metric-line">
  <span>${escapeHtml(label)}</span>
  <div class="city-metric-track"><div class="city-metric-fill ${escapeHtml(className)}" style="width: ${cssPercent(cityDynamicWidth(value, maxValue))}%"></div></div>
  <span class="city-metric-value">${escapeHtml(formatNumber(value))}</span>
</div>`;
}

function renderCityComboDynamics(rows) {
  const maxOrder = maxCityDynamicValue(rows, 'orderedShifts');
  const maxUsers = Math.max(
    maxCityDynamicValue(rows, 'appActiveUsers'),
    maxCityDynamicValue(rows, 'bookedUsers'),
    maxCityDynamicValue(rows, 'completedUsers')
  );

  return `<article class="mini-panel">
  <h3>Спрос vs исполнители</h3>
  <div class="city-combo-chart">${rows
    .map(
      (row) => `<div class="city-combo-row">
    <div class="city-combo-date">${escapeHtml(row.period)}</div>
    <div class="city-combo-main">
      <span hidden>${escapeHtml(cityDynamicsMeta(row))}</span>
      <div class="city-combo-demand">
        <span>Заказ</span>
        <div class="city-combo-demand-track"><div class="city-combo-demand-fill city-series-demand" style="width: ${cssPercent(cityDynamicWidth(row.orderedShifts, maxOrder))}%"></div></div>
        <strong>${escapeHtml(formatNumber(row.orderedShifts))}</strong>
      </div>
      ${renderCityMetricLine({
        label: 'Входы',
        value: row.appActiveUsers,
        maxValue: maxUsers,
        className: 'city-series-app'
      })}
      ${renderCityMetricLine({
        label: 'Отклики',
        value: row.bookedUsers,
        maxValue: maxUsers,
        className: 'city-series-booked'
      })}
      ${renderCityMetricLine({
        label: 'Завершения',
        value: row.completedUsers,
        maxValue: maxUsers,
        className: 'city-series-completed'
      })}
    </div>
  </div>`
    )
    .join('')}</div>
</article>`;
}

function renderCityComboDynamics(rows, currentUser, filters = {}) {
  const maxOrder = maxCityDynamicValue(rows, 'orderedShifts');
  const maxUsers = Math.max(
    maxCityDynamicValue(rows, 'appActiveUsers'),
    maxCityDynamicValue(rows, 'bookedUsers'),
    maxCityDynamicValue(rows, 'completedUsers')
  );

  function comboMetric(label, value, maxValue, className, metricId, digits = 0, detailUrl = '') {
    return renderMetricInfoScope({
      className: 'city-metric-line',
      metricId,
      currentUser,
      content: `
        <span>${escapeHtml(label)}</span>
        <div class="city-metric-track"><div class="city-metric-fill ${escapeHtml(className)}" style="width: ${cssPercent(cityDynamicWidth(value, maxValue))}%"></div></div>
        <span class="city-metric-value">${detailUrl ? renderGigerDetailTrigger(formatNumber(value, digits), detailUrl) : escapeHtml(formatNumber(value, digits))}</span>`
    });
  }

  return `<article class="mini-panel">
  <h3>Спрос vs исполнители</h3>
  <div class="city-combo-chart">${rows
    .map((row) => `<div class="city-combo-row">
    <div class="city-combo-date">${escapeHtml(row.period)}</div>
    <div class="city-combo-main">
      <span hidden>${escapeHtml(cityDynamicsMeta(row))}</span>
      ${comboMetric('Заказ', row.orderedShifts, maxOrder, 'city-series-demand', 'city-analysis.dynamics.combo-ordered-shifts')}
      ${comboMetric('Входы', row.appActiveUsers, maxUsers, 'city-series-app', 'city-analysis.dynamics.combo-app-active-users', 0, cityAnalysisGigerUrl(filters, 'dynamic-app-active-users', { date: row.period }))}
      ${comboMetric('Отклики', row.bookedUsers, maxUsers, 'city-series-booked', 'city-analysis.dynamics.combo-booked-users', 0, cityAnalysisGigerUrl(filters, 'dynamic-booked-users', { date: row.period }))}
      ${comboMetric('Завершения', row.completedUsers, maxUsers, 'city-series-completed', 'city-analysis.dynamics.combo-completed-users', 0, cityAnalysisGigerUrl(filters, 'dynamic-completed-users', { date: row.period }))}
    </div>
  </div>`)
    .join('')}</div>
</article>`;
}

function cityDynamicRowsForMetric(rows, key) {
  return rows.map((row) => ({
    ...row,
    label: row.period,
    metricValue: Number(row[key]) || 0
  }));
}

function renderCitySmallMultiples(rows, currentUser, filters = {}) {
  const panels = [
    ['Заказ', 'orderedShifts', 0, 'смен', 'city-analysis.dynamics.multiples-ordered-shifts', ''],
    ['Входили в приложение', 'appActiveUsers', 0, 'польз.', 'city-analysis.dynamics.multiples-app-active-users', 'dynamic-app-active-users'],
    ['Откликались', 'bookedUsers', 0, 'польз.', 'city-analysis.dynamics.multiples-booked-users', 'dynamic-booked-users'],
    ['Завершали', 'completedUsers', 0, 'польз.', 'city-analysis.dynamics.multiples-completed-users', 'dynamic-completed-users'],
    ['Активные / заявка', 'activeUsersPerRequest', 1, '', 'city-analysis.dynamics.multiples-active-users-per-request', '']
  ];

  return `<div class="mini-panels-grid">${panels
    .map(([title, key, digits, suffix, metricId, gigerMetric]) =>
      renderMiniBarPanel({
        title,
        rows: cityDynamicRowsForMetric(rows, key),
        valueForWidth: (row) => row.metricValue,
        metaForRow: (row) => `${formatNumber(row.metricValue, digits)}${suffix ? ` ${suffix}` : ''}`,
        metaHtmlForRow: gigerMetric
          ? (row) => `${renderGigerDetailTrigger(formatNumber(row.metricValue, digits), cityAnalysisGigerUrl(filters, gigerMetric, { date: row.period }))}${suffix ? ` ${escapeHtml(suffix)}` : ''}`
          : null,
        metricId,
        rowMetricId: metricId,
        currentUser
      })
    )
    .join('')}</div>`;
}

function renderCityHeatmap(rows) {
  const metrics = [
    ['Заказ', 'orderedShifts', 0],
    ['Входы', 'appActiveUsers', 0],
    ['Отклики', 'bookedUsers', 0],
    ['Завершения', 'completedUsers', 0],
    ['Актив/заявка', 'activeUsersPerRequest', 1]
  ];
  const gridStyle = `grid-template-columns: 128px repeat(${Math.max(rows.length, 1)}, minmax(30px, 1fr));`;
  const header = `<div class="city-heatmap-row" style="${escapeHtml(gridStyle)}">
  <div class="city-heatmap-label">Метрика</div>
  ${rows.map((row) => `<div class="city-heatmap-label">${escapeHtml(row.period.slice(5))}</div>`).join('')}
</div>`;

  return `<article class="mini-panel">
  <h3>Тепловая карта</h3>
  <div class="city-heatmap-scroll">
    <div class="city-heatmap-grid">
      ${header}
      ${metrics
        .map(([label, key, digits]) => {
          const maxValue = maxCityDynamicValue(rows, key);

          return `<div class="city-heatmap-row" style="${escapeHtml(gridStyle)}">
  <div class="city-heatmap-label">${escapeHtml(label)}</div>
  ${rows
    .map((row) => {
      const value = Number(row[key]) || 0;
      const title = `${row.period}: ${label} ${formatNumber(value, digits)}`;

      return `<div class="city-heatmap-cell" data-level="${escapeHtml(cityHeatmapLevel(value, maxValue))}" title="${escapeHtml(title)}"></div>`;
    })
    .join('')}
</div>`;
        })
        .join('')}
    </div>
  </div>
</article>`;
}

function renderCityHeatmap(rows, currentUser) {
  const metrics = [
    ['Заказ', 'orderedShifts', 0, 'city-analysis.dynamics.heatmap-ordered-shifts'],
    ['Входы', 'appActiveUsers', 0, 'city-analysis.dynamics.heatmap-app-active-users'],
    ['Отклики', 'bookedUsers', 0, 'city-analysis.dynamics.heatmap-booked-users'],
    ['Завершения', 'completedUsers', 0, 'city-analysis.dynamics.heatmap-completed-users'],
    ['Актив/заявка', 'activeUsersPerRequest', 1, 'city-analysis.dynamics.heatmap-active-users-per-request']
  ];
  const gridStyle = `grid-template-columns: 128px repeat(${Math.max(rows.length, 1)}, minmax(30px, 1fr));`;
  const header = `<div class="city-heatmap-row" style="${escapeHtml(gridStyle)}">
  <div class="city-heatmap-label">Метрика</div>
  ${rows.map((row) => `<div class="city-heatmap-label">${escapeHtml(row.period.slice(5))}</div>`).join('')}
</div>`;

  return `<article class="mini-panel">
  <h3>Тепловая карта</h3>
  <div class="city-heatmap-scroll">
    <div class="city-heatmap-grid">
      ${header}
      ${metrics
        .map(([label, key, digits, metricId]) => {
          const maxValue = maxCityDynamicValue(rows, key);

          return `<div class="city-heatmap-row" style="${escapeHtml(gridStyle)}">
  <div class="city-heatmap-label">${escapeHtml(label)}</div>
  ${rows
    .map((row) => {
      const value = Number(row[key]) || 0;
      const title = `${row.period}: ${label} ${formatNumber(value, digits)}`;

      return renderMetricInfoScope({
        className: 'city-heatmap-cell',
        metricId,
        currentUser,
        content: '',
        attributes: `data-level="${escapeHtml(cityHeatmapLevel(value, maxValue))}" title="${escapeHtml(title)}"`
      });
    })
    .join('')}
</div>`;
        })
        .join('')}
    </div>
  </div>
</article>`;
}

function renderCityFunnelStep({ label, value, maxValue, className, metricId, currentUser, detailUrl = '' }) {
  return renderMetricInfoScope({
    className: 'city-funnel-step',
    metricId,
    currentUser,
    content: `<span>${escapeHtml(label)}</span>
  <div class="city-funnel-track"><div class="city-funnel-fill ${escapeHtml(className)}" style="width: ${cssPercent(cityDynamicWidth(value, maxValue))}%"></div></div>
  <span class="city-funnel-value">${detailUrl ? renderGigerDetailTrigger(formatNumber(value), detailUrl) : escapeHtml(formatNumber(value))}</span>`
  });
}

function renderCityFunnel(rows, currentUser, filters = {}) {
  return `<article class="mini-panel">
  <h3>Воронка</h3>
  <div class="city-funnel-list">${rows
    .map((row) => {
      const maxValue = Math.max(row.appActiveUsers, row.bookedUsers, row.completedUsers, 1);

      return `<div class="city-funnel-day">
    <div>
      <div class="city-funnel-date">${escapeHtml(row.period)}</div>
      ${renderMetricInfoScope({
        className: 'city-funnel-meta',
        metricId: 'city-analysis.dynamics.funnel-ordered-shifts',
        currentUser,
        content: `заказ ${escapeHtml(formatNumber(row.orderedShifts))}`
      })}
    </div>
    <div class="city-funnel-main">
      ${renderCityFunnelStep({
        label: 'Входы',
        value: row.appActiveUsers,
        maxValue,
        className: 'city-series-app',
        metricId: 'city-analysis.dynamics.funnel-app-active-users',
        currentUser,
        detailUrl: cityAnalysisGigerUrl(filters, 'dynamic-app-active-users', { date: row.period })
      })}
      ${renderCityFunnelStep({
        label: 'Отклики',
        value: row.bookedUsers,
        maxValue,
        className: 'city-series-booked',
        metricId: 'city-analysis.dynamics.funnel-booked-users',
        currentUser,
        detailUrl: cityAnalysisGigerUrl(filters, 'dynamic-booked-users', { date: row.period })
      })}
      ${renderCityFunnelStep({
        label: 'Завершения',
        value: row.completedUsers,
        maxValue,
        className: 'city-series-completed',
        metricId: 'city-analysis.dynamics.funnel-completed-users',
        currentUser,
        detailUrl: cityAnalysisGigerUrl(filters, 'dynamic-completed-users', { date: row.period })
      })}
    </div>
  </div>`;
    })
    .join('')}</div>
</article>`;
}

function firstPositiveCityDynamicValue(rows, key) {
  const row = rows.find((item) => Number(item[key]) > 0);

  return row ? Number(row[key]) : 1;
}

function renderCityIndexMetric({ rows, label, key, digits, className, metricId, currentUser }) {
  const base = firstPositiveCityDynamicValue(rows, key);
  const cellsStyle = `grid-template-columns: repeat(${Math.max(rows.length, 1)}, 28px);`;

  return `<div class="city-index-row">
  <div class="city-index-label">${escapeHtml(label)}</div>
  <div class="city-index-cells" style="${escapeHtml(cellsStyle)}">${rows
    .map((row) => {
      const value = Number(row[key]) || 0;
      const indexValue = base > 0 ? (value / base) * 100 : 0;
      const height = Math.min(100, indexValue / 2);
      const title = `${row.period}: ${label} ${formatNumber(value, digits)}; индекс ${formatNumber(indexValue, 0)}`;

      return renderMetricInfoScope({
        className: 'city-index-cell',
        metricId,
        currentUser,
        content: `<span class="city-index-fill ${escapeHtml(className)}" style="height: ${cssPercent(height)}%"></span>`,
        attributes: `title="${escapeHtml(title)}"`
      });
    })
    .join('')}</div>
</div>`;
}

function renderCityIndexDynamics(rows, currentUser) {
  const metrics = [
    ['Заказ', 'orderedShifts', 0, 'city-series-demand', 'city-analysis.dynamics.index-ordered-shifts'],
    ['Входы', 'appActiveUsers', 0, 'city-series-app', 'city-analysis.dynamics.index-app-active-users'],
    ['Отклики', 'bookedUsers', 0, 'city-series-booked', 'city-analysis.dynamics.index-booked-users'],
    ['Завершения', 'completedUsers', 0, 'city-series-completed', 'city-analysis.dynamics.index-completed-users'],
    ['Актив/заявка', 'activeUsersPerRequest', 1, 'city-series-ratio', 'city-analysis.dynamics.index-active-users-per-request']
  ];

  return `<article class="mini-panel">
  <h3>Индексы</h3>
  <div class="city-index-scroll">
    <div class="city-index-chart">${metrics
      .map(([label, key, digits, className, metricId]) =>
        renderCityIndexMetric({ rows, label, key, digits, className, metricId, currentUser })
      )
      .join('')}</div>
  </div>
</article>`;
}

function renderCityComposition(composition, currentUser) {
  const safeComposition = composition || {};

  return `<section class="section">
  ${renderMetricPanelHead('Состав заказа', 'city-analysis.composition', currentUser)}
  <div class="mini-panels-grid">
    ${renderMiniBarPanel({
      title: 'Бренды',
      rows: safeComposition.brands,
      valueForWidth: (row) => row.orderedShifts,
      metaForRow: cityCompositionMeta,
      metricId: 'city-analysis.composition.brands',
      rowMetricId: 'city-analysis.composition.brands.ordered-shifts',
      currentUser
    })}
    ${renderMiniBarPanel({
      title: 'Специальности',
      rows: safeComposition.professions,
      valueForWidth: (row) => row.orderedShifts,
      metaForRow: cityCompositionMeta,
      metricId: 'city-analysis.composition.professions',
      rowMetricId: 'city-analysis.composition.professions.ordered-shifts',
      currentUser
    })}
    ${renderMiniBarPanel({
      title: 'Ставки',
      rows: safeComposition.rateBuckets,
      valueForWidth: (row) => row.orderedShifts,
      metaForRow: cityRateBucketMeta,
      metricId: 'city-analysis.composition.rate-buckets',
      rowMetricId: 'city-analysis.composition.rate-buckets.ordered-shifts',
      currentUser
    })}
  </div>
</section>`;
}

function renderCityDynamics(dynamics, currentUser, filters = {}) {
  const rows = safeRows(dynamics).map((row) => ({
    ...row,
    label: row.period
  }));

  if (rows.length === 0) {
    return `<section class="section">
  ${renderMetricPanelHead('Динамика', 'city-analysis.dynamics', currentUser)}
  ${renderMiniBarPanel({
    title: 'По дням',
    rows,
    valueForWidth: (row) => row.orderedShifts,
    metaForRow: cityDynamicsMeta,
    metricId: 'city-analysis.dynamics',
    currentUser
  })}
</section>`;
  }

  return `<section class="section">
  ${renderMetricPanelHead('Динамика', 'city-analysis.dynamics', currentUser)}
  <div class="city-dynamics-tabs">
    <input class="city-dynamics-tab-input" type="radio" id="city-dynamics-tab-combo" name="city-dynamics-tab" checked>
    <input class="city-dynamics-tab-input" type="radio" id="city-dynamics-tab-multiples" name="city-dynamics-tab">
    <input class="city-dynamics-tab-input" type="radio" id="city-dynamics-tab-heatmap" name="city-dynamics-tab">
    <input class="city-dynamics-tab-input" type="radio" id="city-dynamics-tab-funnel" name="city-dynamics-tab">
    <input class="city-dynamics-tab-input" type="radio" id="city-dynamics-tab-index" name="city-dynamics-tab">
    <div class="city-dynamics-tab-list" role="tablist" aria-label="Варианты динамики">
      <label class="city-dynamics-tab" for="city-dynamics-tab-combo">Спрос vs исполнители</label>
      <label class="city-dynamics-tab" for="city-dynamics-tab-multiples">Small multiples</label>
      <label class="city-dynamics-tab" for="city-dynamics-tab-heatmap">Тепловая карта</label>
      <label class="city-dynamics-tab" for="city-dynamics-tab-funnel">Воронка</label>
      <label class="city-dynamics-tab" for="city-dynamics-tab-index">Индексы</label>
    </div>
    <div class="city-dynamics-panels">
      <div class="city-dynamics-panel city-dynamics-panel-combo">${renderCityComboDynamics(rows, currentUser, filters)}</div>
      <div class="city-dynamics-panel city-dynamics-panel-multiples">${renderCitySmallMultiples(rows, currentUser, filters)}</div>
      <div class="city-dynamics-panel city-dynamics-panel-heatmap">${renderCityHeatmap(rows, currentUser)}</div>
      <div class="city-dynamics-panel city-dynamics-panel-funnel">${renderCityFunnel(rows, currentUser, filters)}</div>
      <div class="city-dynamics-panel city-dynamics-panel-index">${renderCityIndexDynamics(rows, currentUser)}</div>
    </div>
  </div>
</section>`;

  return `<section class="section">
  <h2>Динамика</h2>
  ${renderMiniBarPanel({
    title: 'По дням',
    rows,
    valueForWidth: (row) => row.orderedShifts,
    metaForRow: cityDynamicsMeta
  })}
</section>`;
}

function renderCityAnalysisResultSections(dashboard, currentUser) {
  const filters = dashboard.filters || {};
  const context = dashboard.context || {};
  const hasCity =
    typeof context.hasCity === 'boolean' ? context.hasCity : String(filters.city || '') !== '';

  if (!hasCity) {
    return `<section class="section">
  <p class="empty">Выберите город для анализа.</p>
</section>`;
  }

  const noCoordinatesWarning =
    context.hasCityCoordinates === false
      ? `<section class="section">
  <p class="empty">Нет координат точек для расчета базы в радиусе 15 км.</p>
</section>`
      : '';

  return `${noCoordinatesWarning}${renderCityComposition(dashboard.composition, currentUser)}${renderCityDynamics(dashboard.dynamics, currentUser, filters)}`;
}

function renderCityAnalysisDashboard({
  database,
  dashboard,
  progressive = false,
  currentUser,
  csrfToken
}) {
  const filters = dashboard.filters || {};
  const context = dashboard.context || {};
  const summary = dashboard.summary || {};
  const period = context.periodLabel || `${rangeFilterValue(filters.from)} - ${rangeFilterValue(filters.to)}`;
  const content = `<section class="section">
  <h1>Анализ городов</h1>
  <p class="technical-note">Период: ${escapeHtml(period)} · логика базы: пользователи с последней локацией в радиусе 15 км от точек города.</p>
</section>
<section class="section">
  <form class="filter-bar" action="/dashboards/city-analysis" method="get">
    <div class="field">
      <label for="city">Город</label>
      <select id="city" name="city">${renderCityOptions(dashboard, filters.city)}</select>
    </div>
    <div class="field">
      <label for="from">С</label>
      <input id="from" name="from" type="date" value="${escapeHtml(rangeFilterValue(filters.from))}">
    </div>
    <div class="field">
      <label for="to">По</label>
      <input id="to" name="to" type="date" value="${escapeHtml(rangeFilterValue(filters.to))}">
    </div>
    ${renderMultiSelectField({
      id: 'client',
      label: 'Бренд',
      options: filterOptions(dashboard, 'client'),
      selected: filters.client
    })}
    ${renderMultiSelectField({
      id: 'profession',
      label: 'Специальность',
      options: filterOptions(dashboard, 'profession'),
      selected: filters.profession
    })}
    ${renderMultiSelectField({
      id: 'orderType',
      label: 'Тип заказа',
      options: filterOptions(dashboard, 'orderType'),
      selected: filters.orderType,
      labelForValue: orderTypeLabel
    })}
    ${renderMultiSelectField({
      id: 'jobStatus',
      label: 'Статус задания',
      options: filterOptions(dashboard, 'jobStatus'),
      selected: filters.jobStatus
    })}
    ${renderMultiSelectField({
      id: 'contractor',
      label: 'Контрагент',
      options: filterOptions(dashboard, 'contractor'),
      selected: filters.contractor
    })}
    ${renderNumberField({
      id: 'salaryFrom',
      label: 'Ставка от',
      value: filters.salaryFrom
    })}
    ${renderNumberField({
      id: 'salaryTo',
      label: 'Ставка до',
      value: filters.salaryTo
    })}
    ${renderCheckboxField({
      id: 'includeDeletedOrders',
      label: 'Включать удаленные',
      checked: filters.includeDeletedOrders
    })}
    ${renderCheckboxField({
      id: 'includeHiddenOrders',
      label: 'Включать скрытые',
      checked: filters.includeHiddenOrders
    })}
    <button type="submit">Применить</button>
  </form>
  ${renderMetricPanelHead('Баланс спроса и базы', 'city-analysis.summary', currentUser)}
  ${progressive ? '' : renderCityKpiCards(summary, currentUser, filters)}
</section>
${progressive ? renderCityProgressiveSections(dashboard) : renderCityAnalysisResultSections(dashboard, currentUser)}
${renderGigerListModal()}`;

  return layout({
    title: 'Анализ городов',
    database,
    content,
    activeNav: 'city-analysis',
    currentUser,
    csrfToken
  });
}

const HEATMAP_MONTH_LABELS = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь'
];

function renderHeatmapYearOptions(selectedYear) {
  const year = Number(selectedYear) || new Date().getUTCFullYear();
  const currentYear = new Date().getUTCFullYear();
  const years = [];
  const maxYear = Math.max(currentYear + 1, year);

  for (let value = 2020; value <= maxYear; value += 1) {
    years.push(value);
  }

  if (!years.includes(year)) {
    years.push(year);
    years.sort((left, right) => left - right);
  }

  return years
    .map((value) => {
      const selected = value === year ? ' selected' : '';

      return `<option value="${value}"${selected}>${value}</option>`;
    })
    .join('');
}

function renderHeatmapMonthOptions(selectedMonth) {
  const month = Number(selectedMonth) || 1;

  return HEATMAP_MONTH_LABELS.map((label, index) => {
    const value = index + 1;
    const selected = value === month ? ' selected' : '';

    return `<option value="${value}"${selected}>${escapeHtml(label)}</option>`;
  }).join('');
}

function renderHeatmapActiveMode(filters) {
  const selected = String((filters && filters.activeBaseMode) || 'all');
  const modes = [
    ['all', 'Все зарегистрированные'],
    ['ready', 'ready, booked, worked']
  ];

  return `<div class="field">
      <label>Активная база</label>
      <div class="heatmap-mode-group">
        ${modes
          .map(([value, label]) => {
            const checked = value === selected ? ' checked' : '';

            return `<label class="heatmap-mode-option"><input type="radio" name="activeBaseMode" value="${escapeHtml(value)}"${checked}>${escapeHtml(label)}</label>`;
          })
          .join('')}
      </div>
    </div>`;
}

function renderHeatmapActivePeriod(filters) {
  const selected = String((filters && filters.activeBasePeriod) || 'last30d');
  const modes = [
    ['last30d', 'Последние 30 дней'],
    ['selected', 'Выбранный месяц']
  ];

  return `<div class="field">
      <label>Период входов в приложение</label>
      <div class="heatmap-mode-group">
        ${modes
          .map(([value, label]) => {
            const checked = value === selected ? ' checked' : '';

            return `<label class="heatmap-mode-option"><input type="radio" name="activeBasePeriod" value="${escapeHtml(value)}"${checked}>${escapeHtml(label)}</label>`;
          })
          .join('')}
      </div>
    </div>`;
}

function addHeatmapQueryParam(params, key, value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item !== null && item !== undefined && String(item) !== '') {
        params.append(key, String(item));
      }
    }

    return;
  }

  if (value !== null && value !== undefined && String(value) !== '') {
    params.append(key, String(value));
  }
}

function heatmapSectionUrl(filters, section) {
  const params = new URLSearchParams();

  params.set('section', section);
  addHeatmapQueryParam(params, 'year', filters.year);
  addHeatmapQueryParam(params, 'month', filters.month);
  addHeatmapQueryParam(params, 'client', filters.client);
  addHeatmapQueryParam(params, 'excludedProfession', filters.excludedProfession);
  addHeatmapQueryParam(params, 'addressSearch', filters.addressSearch);
  addHeatmapQueryParam(params, 'activeBaseMode', filters.activeBaseMode);
  addHeatmapQueryParam(params, 'activeBasePeriod', filters.activeBasePeriod);

  return `/dashboards/heatmap/section?${params.toString()}`;
}

function renderHeatmapKpis(summary) {
  const safeSummary = summary || {};
  const cards = [
    { label: 'Точки с заказом', value: formatNumber(safeSummary.pointsWithOrder) },
    { label: 'Заказано смен', value: formatNumber(safeSummary.orderedShifts) },
    { label: 'Взвешенная база', value: formatNumber(safeSummary.weightedActiveUsers, 1) },
    { label: 'Взвешенная база / смена', value: formatNumber(safeSummary.avgWeightedActiveUsersPerShift, 1) }
  ];

  return `<div class="kpi-grid">${cards
    .map((card) => `<div class="kpi-card"><div class="kpi-label">${escapeHtml(card.label)}</div><div class="kpi-value">${escapeHtml(card.value)}</div></div>`)
    .join('')}</div>`;
}

function renderHeatmapKpis(summary, currentUser) {
  const safeSummary = summary || {};

  return renderKpiGrid([
    { label: 'Точки с заказом', value: formatNumber(safeSummary.pointsWithOrder), metricId: 'heatmap.map.points-with-order' },
    { label: 'Заказано смен', value: formatNumber(safeSummary.orderedShifts), metricId: 'heatmap.map.ordered-shifts' },
    { label: 'Взвешенная база', value: formatNumber(safeSummary.weightedActiveUsers, 1), metricId: 'heatmap.map.weighted-active-users' },
    { label: 'Взвешенная база / смена', value: formatNumber(safeSummary.avgWeightedActiveUsersPerShift, 1), metricId: 'heatmap.map.avg-weighted-active-users-per-shift' }
  ], currentUser);
}

function validHeatmapPoint(point) {
  const lat = Number(point.lat);
  const lon = Number(point.lon);

  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

function heatmapPointRadius(point) {
  const ordered = Number(point.orderedShifts) || 0;

  return Math.max(7, Math.min(24, 6 + Math.sqrt(ordered)));
}

function heatmapPointAddress(point) {
  return [point.city, point.street, point.region].filter((part) => String(part || '').trim() !== '').join(', ');
}

function heatmapPointTitle(point) {
  const place = point.workplaceTitle || heatmapPointAddress(point) || point.region || 'Точка заказа';

  return `${place}: заказ ${formatNumber(point.orderedShifts)}; взвешенная база ${formatNumber(point.weightedActiveUsers, 1)}; база/смена ${formatNumber(point.weightedActiveUsersPerShift, 1)}`;
}

function heatmapPointDetailHref(point, filters) {
  const workplaceId = String(point.workplaceId || '').trim();

  return workplaceId === '' ? '' : workplacePointPageHref(filters, workplaceId);
}

function heatmapMapPoints(points, filters) {
  return safeRows(points)
    .filter(validHeatmapPoint)
    .map((point) => ({
      lat: Number(point.lat),
      lon: Number(point.lon),
      color: String(point.color || '#e5e7eb'),
      radius: heatmapPointRadius(point),
      title: heatmapPointTitle(point),
      address: heatmapPointAddress(point),
      orderedShifts: Number(point.orderedShifts) || 0,
      weightedActiveUsers: Number(point.weightedActiveUsers) || 0,
      weightedActiveUsersPerShift: Number(point.weightedActiveUsersPerShift) || 0,
      radiusUsers: point.radiusUsers || { near: 0, medium: 0, far: 0 },
      detailHref: heatmapPointDetailHref(point, filters)
    }));
}

function renderHeatmapLeafletAssets() {
  return `<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>`;
}

function renderHeatmapLeafletScript() {
  return `<script>
(function () {
  var tileUrl = window.ETL_HEATMAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  var tileAttribution = window.ETL_HEATMAP_TILE_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

  function formatNumber(value, digits) {
    return new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: digits || 0,
      maximumFractionDigits: digits || 0
    }).format(Number(value) || 0).replace(/\\u00a0/g, ' ');
  }

  function escapeClientHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function popupHtml(point) {
    var detailLink = point.detailHref
      ? '<br><a href="' + escapeClientHtml(point.detailHref) + '" target="_blank" rel="noopener noreferrer">Открыть анализ точки</a>'
      : '';

    return '<strong>' + escapeClientHtml(point.title) + '</strong>' +
      (point.address ? '<br>' + escapeClientHtml(point.address) : '') +
      '<br>0-5 км: ' + formatNumber(point.radiusUsers.near) +
      '; 5-10 км: ' + formatNumber(point.radiusUsers.medium) +
      '; 10-15 км: ' + formatNumber(point.radiusUsers.far) +
      detailLink;
  }

  window.initHeatmapLeafletMaps = function initHeatmapLeafletMaps() {
    if (!window.L) {
      window.setTimeout(window.initHeatmapLeafletMaps, 80);
      return;
    }

    document.querySelectorAll('[data-heatmap-leaflet-map]').forEach(function (root) {
      if (root.dataset.initialized === 'true') {
        return;
      }

      var points = [];

      try {
        points = JSON.parse(root.getAttribute('data-heatmap-points') || '[]');
      } catch (error) {
        points = [];
      }

      root.dataset.initialized = 'true';

      var map = L.map(root, {
        preferCanvas: true,
        zoomControl: true
      });

      L.tileLayer(tileUrl, {
        maxZoom: 19,
        attribution: tileAttribution
      }).addTo(map);

      if (points.length === 0) {
        map.setView([55.751244, 37.618423], 5);
        return;
      }

      var bounds = [];

      points.forEach(function (point) {
        var marker = L.circleMarker([point.lat, point.lon], {
          radius: point.radius,
          color: '#ffffff',
          weight: 1,
          fillColor: point.color,
          fillOpacity: 0.72
        }).addTo(map);

        marker.bindPopup(popupHtml(point));
        bounds.push([point.lat, point.lon]);
      });

      map.fitBounds(bounds, {
        padding: [28, 28],
        maxZoom: 12
      });
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', window.initHeatmapLeafletMaps);
  } else {
    window.initHeatmapLeafletMaps();
  }
})();
</script>`;
}

function renderHeatmapMap(points, filters) {
  const rows = safeRows(points);
  const mapPoints = heatmapMapPoints(rows, filters || {});

  if (rows.length === 0) {
    return `<div class="country-heatmap-panel">
  <p class="empty">Нет точек заказа с координатами за выбранный период.</p>
</div>`;
  }

  return `<div class="country-heatmap-panel">
  <h2>Карта баланса по точкам заказа</h2>
  <div class="country-heatmap-map-wrap">
    <div class="country-heatmap-map" data-heatmap-leaflet-map data-heatmap-points="${escapeHtml(JSON.stringify(mapPoints))}" role="img" aria-label="Реалистичная карта баланса активной базы и заказа"></div>
  </div>
  <div class="heatmap-legend" aria-hidden="true">
    <div class="heatmap-gradient"></div>
    <div class="heatmap-legend-labels">
      <span>Меньше базы к заказу</span>
      <span>Больше базы к заказу</span>
    </div>
  </div>
</div>`;
}

function renderHeatmapDashboardSection({ dashboard, section, currentUser }) {
  if (section !== 'map') {
    return `<section class="section"><div class="error">Неизвестный блок дашборда.</div></section>`;
  }

  return `<section class="section">
  ${renderHeatmapLeafletAssets()}
  ${renderMetricPanelHead('Карта баланса по точкам заказа', 'heatmap.map', currentUser)}
  ${renderHeatmapKpis(dashboard.summary, currentUser)}
  ${renderHeatmapMap(dashboard.points, dashboard.filters)}
  ${renderHeatmapLeafletScript()}
</section>`;
}

function renderHeatmapProgressiveSection(filters) {
  return `${renderHeatmapLeafletAssets()}
<div data-dashboard-fragment-url="${escapeHtml(heatmapSectionUrl(filters, 'map'))}">
  <section class="section">
    <h2>Карта баланса по точкам заказа</h2>
    <p class="loading">Загружается</p>
  </section>
</div>
${renderHeatmapLeafletScript()}`;
}

function renderHeatmapDashboard({
  database,
  dashboard,
  progressive = false,
  currentUser,
  csrfToken
}) {
  const filters = dashboard.filters || {};
  const content = `<section class="section">
  <h1>Тепловая карта</h1>
  <p class="technical-note">Период заказа: ${escapeHtml(filters.from)} - ${escapeHtml(filters.to)} · Активная база: ${escapeHtml(filters.activeFromDateTime)} - ${escapeHtml(filters.activeToExclusiveDateTime)}.</p>
</section>
<section class="section">
  <form class="filter-bar" action="/dashboards/heatmap" method="get">
    <div class="field">
      <label for="year">Год</label>
      <select id="year" name="year">${renderHeatmapYearOptions(filters.year)}</select>
    </div>
    <div class="field">
      <label for="month">Месяц</label>
      <select id="month" name="month">${renderHeatmapMonthOptions(filters.month)}</select>
    </div>
    <div class="field">
      <label for="addressSearch">Поиск по адресу</label>
      <input id="addressSearch" name="addressSearch" type="search" value="${escapeHtml(filters.addressSearch || '')}" placeholder="Город, улица или точка">
    </div>
    ${renderMultiSelectField({
      id: 'client',
      label: 'Бренды заказа',
      options: filterOptions(dashboard, 'client'),
      selected: filters.client
    })}
    ${renderMultiSelectField({
      id: 'excludedProfession',
      label: 'Исключить профессии',
      options: filterOptions(dashboard, 'excludedProfession'),
      selected: filters.excludedProfession
    })}
    ${renderHeatmapActiveMode(filters)}
    ${renderHeatmapActivePeriod(filters)}
    <button type="submit">Применить</button>
  </form>
</section>
${progressive ? renderHeatmapProgressiveSection(filters) : renderHeatmapDashboardSection({ dashboard, section: 'map', currentUser })}`;

  return layout({
    title: 'Тепловая карта',
    database,
    content,
    activeNav: 'heatmap',
    currentUser,
    csrfToken
  });
}

function renderError({ database, title, message, activeNav = 'tables', currentUser, csrfToken }) {
  const content = `<section class="section">
  <h1>${escapeHtml(title)}</h1>
  <div class="error">${escapeHtml(message)}</div>
</section>`;

  return layout({ title, database, content, activeNav, currentUser, csrfToken });
}

function renderCityAnalysisDashboardPage(options) {
  const html = renderCityAnalysisDashboard(options);

  if (!options || !options.progressive) {
    return html;
  }

  return html.replace(
    /\n  <h2>[^<]*<\/h2>\n\s*<\/section>\n<section class="section" data-city-analysis-progressive>/,
    '\n</section>\n<section class="section" data-city-analysis-progressive>'
  );
}

module.exports = {
  escapeHtml,
  renderAccountManagement,
  renderDashboardSectionError,
  renderError,
  renderGigerDetails,
  renderGigerDetailsWorkbook,
  renderCityAnalysisDashboard: renderCityAnalysisDashboardPage,
  renderCityAnalysisDashboardSection,
  renderCityAnalysisSectionError,
  renderHeatmapDashboard,
  renderHeatmapDashboardSection,
  renderHome,
  renderLogin,
  renderPreloadManagement,
  renderSalesByProjectDashboard,
  renderSalesByProjectDashboardSection,
  renderTable,
  renderUserActivityDashboard,
  renderWorkerCancellationsDetails,
  renderWorkerCancellationsDashboard,
  renderWorkerCancellationsDashboardSection,
  renderWorkplaceAnalysisDashboard,
  renderWorkplaceAnalysisDashboardSection,
  renderWorkplacePointDayDetails,
  renderWorkplacePointDashboard,
  renderWorkplacePointDashboardSection,
  renderWorkplacePointReviews
};
