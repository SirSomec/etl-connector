const {
  PERMISSION_DEFINITIONS,
  hasPermission
} = require('./auth');
const {
  getSqlMetricInfo,
  highlightSql
} = require('./sqlMetricInfo');
const {
  REQUEST_REPORT_SHIFT_STATUS_OPTIONS
} = require('./requestReportShiftStatusStore');

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
    href: '/dashboards/underage-completed-shifts',
    label: 'Смены до 18 лет',
    id: 'underage-completed-shifts',
    permission: 'sales-by-project'
  },
  {
    href: '/dashboards/brand-analysis',
    label: 'Анализ брендов',
    id: 'brand-analysis',
    permission: 'brand-analysis'
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
    href: '/dashboards/region-analysis',
    label: 'Анализ регионов',
    id: 'region-analysis',
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
    href: '/tools/request-report-confirmed-check',
    label: 'Проверка отчетов',
    id: 'request-report-matching',
    permission: 'request-report-matching'
  },
  {
    href: '/reports/scheduled',
    label: 'Регулярные отчеты',
    id: 'scheduled-reports',
    permissionAny: ['scheduled-report-author', 'scheduled-report-delivery']
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
  },
  {
    href: '/admin/mail-settings',
    label: 'SMTP',
    id: 'mail-settings',
    permission: 'admin-only'
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

    if (Array.isArray(link.permissionAny)) {
      return link.permissionAny.some((permission) => hasPermission(currentUser, permission));
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
  presenceHeartbeatMs = 15000,
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
  const passwordLink = currentUser && currentUser.source !== 'env'
    ? '<a class="account-link" href="/account/password">Сменить пароль</a>'
    : '';
  const topbarActions = currentUser
    ? `<div class="topbar-actions">
            <span class="user-email">${escapeHtml(currentUser.email)}</span>
            ${passwordLink}
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
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
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

    .account-link,
    .logout-button,
    .secondary-button {
      border-color: var(--line);
      background: var(--surface);
      color: var(--text);
    }

    .account-link {
      display: inline-flex;
      align-items: center;
      min-height: 36px;
      padding: 6px 11px;
      border: 1px solid var(--line);
      border-radius: 6px;
      font-size: 14px;
      font-weight: 700;
      text-decoration: none;
    }

    .account-link:hover,
    .account-link:focus,
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

    .request-report-filter {
      margin: 12px 0 10px;
    }

    .request-report-filter-status {
      align-self: center;
      margin-left: auto;
      font-size: 13px;
    }

    .request-report-status-cell {
      min-width: 168px;
    }

    .request-report-act-cell {
      min-width: 108px;
      white-space: nowrap;
    }

    .request-report-act-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      min-height: 24px;
      padding: 2px 8px;
      border: 1px solid #c7d4df;
      border-radius: 999px;
      background: #f6f9fb;
      color: var(--muted);
      font-size: 13px;
      font-weight: 700;
    }

    .request-report-act-badge-yes {
      border-color: #9bd0af;
      background: #effaf3;
      color: #1f6b3a;
    }

    .request-report-status-select {
      width: 100%;
      min-width: 150px;
    }

    .request-report-row > td {
      transition: background 160ms ease;
    }

    .request-report-row-verified > td {
      background: rgba(34, 197, 94, 0.14);
    }

    .request-report-row-return-later > td {
      background: rgba(239, 68, 68, 0.12);
    }

    .request-report-row-verified:hover > td {
      background: rgba(34, 197, 94, 0.2);
    }

    .request-report-row-return-later:hover > td {
      background: rgba(239, 68, 68, 0.18);
    }

    .request-report-progress-panel {
      display: grid;
      gap: 8px;
      margin-top: -6px;
      margin-bottom: 18px;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
    }

    .request-report-progress-panel[hidden] {
      display: none;
    }

    .request-report-progress-head,
    .request-report-progress-meta,
    .request-report-progress-counters {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 6px 12px;
    }

    .request-report-progress-head {
      font-size: 14px;
    }

    .request-report-progress-percent {
      color: var(--muted);
      font-size: 13px;
      font-weight: 700;
    }

    .request-report-progress-track {
      position: relative;
      height: 8px;
      overflow: hidden;
      border-radius: 999px;
      background: #e5ebf0;
    }

    .request-report-progress-bar {
      width: 0%;
      height: 100%;
      border-radius: inherit;
      background: var(--accent);
      transition: width 220ms ease;
    }

    .request-report-progress-panel[data-request-report-progress-mode="indeterminate"] .request-report-progress-bar {
      width: 42%;
      background-image: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.45), transparent);
      animation: request-report-progress-slide 1.15s linear infinite;
    }

    .request-report-progress-meta,
    .request-report-progress-counters {
      color: var(--muted);
      font-size: 13px;
    }

    .request-report-progress-error {
      margin-bottom: 0;
    }

    @keyframes request-report-progress-slide {
      0% {
        transform: translateX(-110%);
      }

      100% {
        transform: translateX(240%);
      }
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

    .activity-statuses {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .activity-pill[data-availability="online"] {
      border-color: #78b58d;
      background: #e7f6eb;
      color: #1f6b37;
    }

    .activity-pill[data-availability="unavailable"] {
      border-color: #d2d9e2;
      background: #eef2f6;
      color: #5f6b7a;
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
    textarea,
    button {
      min-height: 36px;
      border: 1px solid var(--line);
      border-radius: 6px;
      font: inherit;
      font-size: 14px;
    }

    select,
    input,
    textarea {
      padding: 6px 8px;
      background: var(--surface);
      color: var(--text);
    }

    textarea {
      min-height: 92px;
      resize: vertical;
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
      border: 0;
      padding: 0;
      background: transparent;
      color: var(--text);
      font: inherit;
      font-weight: 700;
      text-decoration: none;
      cursor: pointer;
    }

    .sortable-header:hover,
    .sortable-header:focus {
      color: var(--link);
      outline: none;
    }

    button.sortable-header,
    button.sortable-header:hover,
    button.sortable-header:focus {
      border: 0;
      padding: 0;
      background: transparent;
      color: var(--text);
      box-shadow: none;
    }

    button.sortable-header:hover,
    button.sortable-header:focus {
      color: var(--link);
    }

    .sort-indicator {
      color: var(--muted);
      font-size: 12px;
    }

    .brand-region-name-cell {
      min-width: 180px;
    }

    .brand-region-demand-trend {
      display: inline-block;
      width: 96px;
      height: 10px;
      margin-left: 8px;
      border: 1px solid #cbd5e1;
      border-radius: 999px;
      vertical-align: middle;
    }

    .brand-region-demand-trend-info,
    .brand-region-demand-trend-inline {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      vertical-align: middle;
    }

    .brand-region-demand-trend-info .sql-inspector-button {
      position: static;
      flex: 0 0 auto;
    }

    tr:last-child td {
      border-bottom: 0;
    }

    .number-cell {
      text-align: right;
      white-space: nowrap;
    }

    .city-ranking-toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      justify-content: space-between;
      gap: 12px;
      margin: 0 0 12px;
    }

    .city-ranking-toolbar .field {
      min-width: 220px;
      margin: 0;
    }

    .city-ranking-meta {
      color: var(--muted);
      font-size: 14px;
    }

    .city-ranking-empty {
      display: none;
      margin-top: 10px;
    }

    .city-dashboard-tabs {
      display: block;
    }

    .city-dashboard-tab-input {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }

    .city-dashboard-tab-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 0 0 14px;
      border-bottom: 1px solid var(--line);
    }

    .city-dashboard-tab {
      display: inline-flex;
      min-height: 38px;
      align-items: center;
      padding: 8px 12px;
      border: 1px solid var(--line);
      border-bottom: 0;
      border-radius: 6px 6px 0 0;
      background: #eef2f6;
      color: var(--muted);
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
    }

    .city-dashboard-tab:hover {
      color: var(--link);
      outline: none;
    }

    #city-dashboard-tab-ranking:focus-visible ~ .city-dashboard-tab-list label[for="city-dashboard-tab-ranking"],
    #city-dashboard-tab-city:focus-visible ~ .city-dashboard-tab-list label[for="city-dashboard-tab-city"] {
      color: var(--link);
      outline: 2px solid var(--link);
      outline-offset: 2px;
    }

    .city-dashboard-panels {
      display: block;
    }

    .city-dashboard-panel {
      display: none;
    }

    #city-dashboard-tab-ranking:checked ~ .city-dashboard-tab-list label[for="city-dashboard-tab-ranking"],
    #city-dashboard-tab-city:checked ~ .city-dashboard-tab-list label[for="city-dashboard-tab-city"] {
      background: var(--surface);
      color: var(--text);
    }

    #city-dashboard-tab-ranking:checked ~ .city-dashboard-panels .city-dashboard-panel-ranking,
    #city-dashboard-tab-city:checked ~ .city-dashboard-panels .city-dashboard-panel-city {
      display: block;
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

    .city-line-chart {
      display: grid;
      gap: 12px;
    }

    .city-line-chart-scroll {
      overflow-x: auto;
    }

    .city-line-chart-svg {
      display: block;
      width: 100%;
      min-width: 640px;
      height: auto;
    }

    .underage-shifts-chart-scroll {
      overflow-x: auto;
      padding-bottom: 4px;
    }

    .underage-shifts-chart {
      display: block;
      min-width: 760px;
      width: 100%;
      color: #0f766e;
    }

    .underage-shifts-grid-line {
      stroke: #d7e0e2;
      stroke-width: 1;
    }

    .underage-shifts-axis-label {
      fill: #5b6770;
      font-size: 11px;
    }

    .underage-shifts-line {
      fill: none;
      stroke: currentColor;
      stroke-width: 2.5;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .underage-shifts-point circle {
      fill: #fff;
      stroke: currentColor;
      stroke-width: 2;
    }

    .city-line-grid {
      stroke: #e5edf2;
      stroke-width: 1;
    }

    .city-line-axis {
      stroke: #b8c5cf;
      stroke-width: 1.2;
    }

    .city-line-label {
      fill: var(--muted);
      font-size: 11px;
    }

    .city-line-series {
      fill: none;
      stroke-width: 2.6;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .city-line-point {
      stroke: var(--surface);
      stroke-width: 1.4;
    }

    .city-line-series,
    .city-line-point,
    .city-bar-column,
    .city-line-legend-item,
    .city-bar-legend-item {
      transition: opacity 0.16s ease;
    }

    .city-line-series.city-series-demand { stroke: #256d85; }
    .city-line-series.city-series-app { stroke: #2f855a; }
    .city-line-series.city-series-booked { stroke: #b7791f; }
    .city-line-series.city-series-completed { stroke: #7f5a83; }
    .city-line-series.city-series-ratio { stroke: #4b5563; }

    .city-line-point.city-series-demand { fill: #256d85; }
    .city-line-point.city-series-app { fill: #2f855a; }
    .city-line-point.city-series-booked { fill: #b7791f; }
    .city-line-point.city-series-completed { fill: #7f5a83; }
    .city-line-point.city-series-ratio { fill: #4b5563; }

    .city-line-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 14px;
      align-items: center;
    }

    .city-line-legend-item {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 24px;
      color: var(--text);
      font-size: 13px;
      font-weight: 700;
      overflow-wrap: anywhere;
    }

    .city-line-swatch {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex: 0 0 auto;
    }

    .city-line-legend-value {
      color: var(--muted);
      font-weight: 600;
    }

    .city-series-toggle {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      min-height: 24px;
      padding: 0;
      border: 0;
      background: transparent;
      color: inherit;
      cursor: pointer;
      font: inherit;
      font-weight: inherit;
      text-align: left;
      overflow-wrap: anywhere;
    }

    .city-series-toggle:hover,
    .city-series-toggle:focus-visible,
    .city-series-toggle[aria-pressed="true"] {
      color: var(--accent);
      outline: none;
    }

    .city-series-toggle:focus-visible {
      border-radius: 4px;
      box-shadow: 0 0 0 2px var(--accent-bg), 0 0 0 4px rgba(37, 109, 133, 0.28);
    }

    [data-city-dynamic-chart][data-city-dynamic-has-selection="1"] [data-city-dynamic-series],
    [data-city-dynamic-chart][data-city-dynamic-has-selection="1"] [data-city-dynamic-legend-item] {
      opacity: 0.2;
    }

    [data-city-dynamic-chart][data-city-dynamic-has-selection="1"] [data-city-dynamic-active="1"] {
      opacity: 1;
    }

    .city-chart-variant-tabs {
      display: grid;
      gap: 12px;
      min-width: 0;
    }

    .city-chart-variant-input {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }

    .city-chart-variant-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .city-chart-variant-tab {
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

    .city-chart-variant-tab:hover {
      border-color: var(--accent);
      background: var(--accent-bg);
    }

    .city-chart-variant-panel {
      display: none;
      min-width: 0;
    }

    #city-dynamics-chart-line:checked ~ .city-chart-variant-list label[for="city-dynamics-chart-line"],
    #city-dynamics-chart-bar:checked ~ .city-chart-variant-list label[for="city-dynamics-chart-bar"] {
      border-color: var(--accent);
      background: var(--accent);
      color: #ffffff;
    }

    #city-dynamics-chart-line:focus-visible ~ .city-chart-variant-list label[for="city-dynamics-chart-line"],
    #city-dynamics-chart-bar:focus-visible ~ .city-chart-variant-list label[for="city-dynamics-chart-bar"] {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    #city-dynamics-chart-line:checked ~ .city-chart-variant-panels .city-chart-variant-panel-line,
    #city-dynamics-chart-bar:checked ~ .city-chart-variant-panels .city-chart-variant-panel-bar {
      display: block;
    }

    .city-bar-chart {
      display: grid;
      gap: 12px;
    }

    .city-bar-chart-scroll {
      overflow-x: auto;
    }

    .city-bar-chart-grid {
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: minmax(74px, 1fr);
      gap: 8px;
      min-width: 640px;
      align-items: end;
      padding: 8px 4px 0;
      border-bottom: 1px solid var(--line);
    }

    .city-bar-day {
      display: grid;
      grid-template-rows: 180px auto;
      gap: 7px;
      min-width: 0;
      align-items: end;
    }

    .city-bar-series {
      display: grid;
      grid-template-columns: repeat(5, minmax(7px, 1fr));
      gap: 3px;
      height: 180px;
      align-items: end;
      padding: 0 2px;
    }

    .city-bar-column {
      display: flex;
      height: 100%;
      min-width: 7px;
      align-items: flex-end;
      overflow: hidden;
      border-radius: 3px 3px 0 0;
      background: #edf3f6;
    }

    .city-bar-fill {
      display: block;
      width: 100%;
      min-height: 2px;
      border-radius: 3px 3px 0 0;
    }

    .city-bar-fill-empty {
      min-height: 0;
    }

    .city-bar-date {
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
      overflow: hidden;
      text-align: center;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .city-bar-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 14px;
      align-items: center;
    }

    .city-bar-legend-item {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 24px;
      color: var(--text);
      font-size: 13px;
      font-weight: 700;
      overflow-wrap: anywhere;
    }

    .city-bar-swatch {
      width: 10px;
      height: 10px;
      border-radius: 2px;
      flex: 0 0 auto;
    }

    .city-bar-legend-value {
      color: var(--muted);
      font-weight: 600;
    }

    .brand-trend-charts {
      display: grid;
      gap: 12px;
      margin-bottom: 16px;
    }

    .brand-trend-periods {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
    }

    .brand-trend-period {
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

    .brand-trend-period:hover,
    .brand-trend-period[aria-pressed="true"] {
      border-color: var(--accent);
      background: var(--accent);
      color: #ffffff;
    }

    .brand-trend-chart-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    .brand-trend-chart {
      display: grid;
      gap: 10px;
      min-width: 0;
    }

    .brand-trend-chart-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .brand-trend-chart h3 {
      margin: 0;
      font-size: 15px;
      line-height: 1.25;
    }

    .brand-trend-expand {
      min-width: 34px;
      min-height: 30px;
      padding: 4px 8px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
      color: var(--text);
      cursor: pointer;
      font-size: 16px;
      font-weight: 700;
      line-height: 1;
    }

    .brand-trend-expand:hover,
    .brand-trend-expand:focus {
      border-color: var(--accent);
      background: var(--link-bg);
      outline: none;
    }

    .brand-trend-svg {
      width: 100%;
      min-height: 260px;
      overflow: visible;
    }

    .brand-trend-axis,
    .brand-trend-grid-line {
      stroke: var(--line);
      stroke-width: 1;
    }

    .brand-trend-label {
      fill: var(--muted);
      font-size: 11px;
      font-weight: 700;
    }

    .brand-trend-value-label {
      fill: var(--text);
      font-size: 12px;
      font-weight: 700;
      paint-order: stroke;
      stroke: #ffffff;
      stroke-width: 3px;
      stroke-linejoin: round;
    }

    .brand-trend-label-bg {
      fill: #ffffff;
      stroke: rgba(148, 163, 184, 0.45);
      stroke-width: 1px;
      rx: 4px;
      ry: 4px;
    }

    .brand-trend-callout-line {
      stroke: var(--muted);
      stroke-width: 1.2;
      stroke-dasharray: 3 3;
    }

    .brand-trend-line {
      fill: none;
      stroke-width: 3;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .brand-trend-point {
      stroke: #ffffff;
      stroke-width: 2;
    }

    .brand-trend-bar {
      rx: 3;
      ry: 3;
    }

    .brand-trend-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 12px;
      align-items: center;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }

    .brand-trend-swatch {
      width: 10px;
      height: 10px;
      border-radius: 3px;
      display: inline-block;
      margin-right: 5px;
      vertical-align: -1px;
    }

    .brand-trend-modal {
      position: fixed;
      inset: 0;
      z-index: 80;
      display: none;
      padding: 24px;
    }

    .brand-trend-modal[aria-hidden="false"] {
      display: block;
    }

    .brand-trend-modal-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(16, 33, 43, 0.55);
    }

    .brand-trend-modal-dialog {
      position: relative;
      z-index: 1;
      display: grid;
      gap: 12px;
      width: min(1080px, 100%);
      max-height: calc(100vh - 48px);
      margin: 0 auto;
      padding: 16px;
      overflow: auto;
      border-radius: 8px;
      background: var(--surface);
      box-shadow: 0 18px 50px rgba(15, 23, 42, 0.28);
    }

    .brand-trend-modal-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .brand-trend-modal-head h3 {
      margin: 0;
      font-size: 18px;
      line-height: 1.25;
    }

    .brand-trend-modal-close {
      min-width: 34px;
      min-height: 34px;
      padding: 4px 10px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
      color: var(--text);
      cursor: pointer;
      font-size: 22px;
      line-height: 1;
    }

    .brand-trend-modal-chart .brand-trend-svg {
      min-height: 460px;
    }

    .brand-trend-modal-chart .brand-trend-label {
      font-size: 12px;
    }

    @media (max-width: 900px) {
      .brand-trend-chart-grid {
        grid-template-columns: 1fr;
      }

      .brand-trend-modal {
        padding: 10px;
      }

      .brand-trend-modal-dialog {
        max-height: calc(100vh - 20px);
      }
    }

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
      display: block;
      font-size: 11px;
      line-height: 1.25;
      min-width: 0;
      min-height: calc(3 * 1.25em);
      max-height: calc(3 * 1.25em);
      margin-bottom: 8px;
      overflow: hidden;
    }

    .point-card-title-block {
      display: inline;
      min-width: 0;
      max-width: 100%;
    }

    .point-title {
      font-size: 11px;
      font-weight: 700;
      line-height: 1.25;
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    .point-pin-form {
      float: right;
      margin: 0 0 4px 10px;
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
      min-width: 0;
      margin-top: 2px;
      font-size: 12px;
      font-weight: 700;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .point-metric-value.compact {
      font-size: 10px;
    }

    .point-metric-value .metric-detail-trigger {
      display: inline-block;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      vertical-align: bottom;
      white-space: nowrap;
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
      min-width: 560px;
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

    .point-calendar-cell[data-risk-level="high"] {
      border-color: #d49386;
      background: #fff7f5;
    }

    .point-calendar-cell[data-risk-level="medium"] {
      border-color: #ddbf75;
      background: #fffaf0;
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

    .year-heatmap-panel {
      grid-column: 1 / -1;
      min-width: 0;
    }

    .point-year-heatmap {
      display: grid;
      gap: 10px;
      width: 75%;
      max-width: 100%;
      overflow: hidden;
    }

    .point-year-heatmap-months {
      display: grid;
      grid-template-columns: repeat(var(--point-year-heatmap-week-columns, 63), minmax(0, 1fr));
      gap: 0;
      min-width: 0;
    }

    .point-year-heatmap-month {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      min-width: 0;
      box-shadow: inset 1px 0 0 var(--line);
    }

    .point-year-heatmap-month-label {
      margin-bottom: 5px;
      padding-left: 2px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
      line-height: 1.2;
      min-width: 0;
      overflow: hidden;
      text-overflow: clip;
      white-space: nowrap;
    }

    .point-year-heatmap-grid {
      display: grid;
      grid-template-columns: repeat(var(--point-year-heatmap-month-weeks, 5), minmax(0, 1fr));
      grid-template-rows: repeat(7, minmax(0, 1fr));
      grid-auto-flow: column;
      gap: 0;
      min-width: 0;
    }

    .point-year-heatmap-cell {
      min-width: 0;
      width: 100%;
      aspect-ratio: 1 / 1;
      border-radius: 2px;
      background: #e5e7eb;
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.78);
    }

    .point-year-heatmap-cell.empty {
      background: transparent;
      box-shadow: none;
    }

    .point-year-heatmap-cell[data-level="1"] { background: #bfdbfe; }
    .point-year-heatmap-cell[data-level="2"] { background: #60a5fa; }
    .point-year-heatmap-cell[data-level="3"] { background: #2563eb; }
    .point-year-heatmap-cell[data-level="4"] { background: #1d4ed8; }

    .point-year-heatmap-cell.is-current-day {
      outline: 2px solid #111827;
      outline-offset: 1px;
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.9);
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

    .mini-trend {
      display: block;
      width: 100%;
      max-width: 140px;
      height: 36px;
      margin-top: 8px;
      color: var(--accent);
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

    .heatmap-gradient-workers {
      background: linear-gradient(90deg, #38bdf8, #0ea5e9, #facc15, #f97316, #dc2626);
    }

    .worker-concentration-canvas {
      mix-blend-mode: multiply;
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
  ${currentUser && csrfToken ? renderPresenceScript({ csrfToken, presenceHeartbeatMs }) : ''}
  ${content.includes('data-multi-filter') ? renderMultiFilterScript() : ''}
  ${content.includes('data-workplace-suggest-url') ? renderWorkplaceSuggestScript() : ''}
  ${
    content.includes('data-workplace-pin-form') || content.includes('data-workplace-suggest-url')
      ? renderWorkplacePinScript()
      : ''
  }
  ${
    content.includes('data-dashboard-fragment-url') || content.includes('data-city-analysis-fragment-url')
      ? renderDashboardProgressiveScript()
      : ''
  }
  ${content.includes('data-worker-cancellation-modal') ? renderWorkerCancellationDetailsScript() : ''}
  ${content.includes('data-giger-list-modal') ? renderGigerDetailsScript() : ''}
  ${content.includes('data-workplace-point-day-modal') ? renderWorkplacePointDayDetailsScript() : ''}
  ${content.includes('data-workplace-point-review-modal') ? renderWorkplacePointReviewsScript() : ''}
  ${
    content.includes('data-request-duration-filter') || content.includes('data-request-report-check-form')
      ? renderRequestReportDurationFilterScript()
      : ''
  }
  ${
    content.includes('data-city-dynamic-chart') || content.includes('data-city-analysis-progressive')
      ? renderCityDynamicChartScript()
      : ''
  }
  ${
    content.includes('data-brand-trend-charts') || content.includes('/dashboards/brand-analysis/section?section=trend')
      ? renderBrandTrendChartsScript()
      : ''
  }
  ${content.includes('data-sql-inspector-modal') || canViewSqlInspector(currentUser) ? renderSqlInspectorScript() : ''}
  ${content.includes('data-activity-dashboard') && currentUser ? renderActivityRefreshScript() : ''}
</body>
</html>`;
}

function renderSafeScriptValue(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function renderPresenceScript({ csrfToken, presenceHeartbeatMs }) {
  const heartbeatMs = Math.max(1000, Number(presenceHeartbeatMs) || 15000);

  return `<script>
(function () {
  var csrfToken = ${renderSafeScriptValue(String(csrfToken || ''))};
  var tabId = window.crypto && typeof window.crypto.randomUUID === 'function'
    ? window.crypto.randomUUID()
    : 'tab-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);

  function body() {
    return new URLSearchParams({ csrfToken: csrfToken, tabId: tabId });
  }

  function heartbeat() {
    fetch('/presence/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: body().toString(),
      credentials: 'same-origin'
    }).catch(function () {});
  }

  function leave() {
    var payload = body().toString();

    if (navigator.sendBeacon) {
      navigator.sendBeacon('/presence/leave', new Blob([payload], { type: 'text/plain' }));
      return;
    }

    fetch('/presence/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: payload,
      credentials: 'same-origin',
      keepalive: true
    }).catch(function () {});
  }

  heartbeat();
  window.setInterval(heartbeat, ${heartbeatMs});
  window.addEventListener('pagehide', leave);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') heartbeat();
  });
})();
</script>`;
}

function renderActivityRefreshScript() {
  return `<script>
(function () {
  window.setTimeout(function () {
    window.location.reload();
  }, 15000);
})();
</script>`;
}

function renderBrandTrendChartsScript() {
  return `<script>
(function () {
  if (window.initBrandTrendCharts) {
    window.initBrandTrendCharts(document);
    return;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function numberValue(value) {
    var number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function parseDate(value) {
    var parts = String(value || '').slice(0, 10).split('-').map(Number);
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
      return null;
    }
    return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  }

  function formatDate(date) {
    return date.toISOString().slice(0, 10);
  }

  function startOfWeek(date) {
    var copy = new Date(date.getTime());
    var day = copy.getUTCDay() || 7;
    copy.setUTCDate(copy.getUTCDate() - day + 1);
    return copy;
  }

  function bucketFor(period, value) {
    var date = parseDate(value);
    if (!date) {
      return String(value || '');
    }
    if (period === 'week') {
      return formatDate(startOfWeek(date));
    }
    if (period === 'month') {
      return date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0') + '-01';
    }
    if (period === 'quarter') {
      var quarterMonth = Math.floor(date.getUTCMonth() / 3) * 3 + 1;
      return date.getUTCFullYear() + '-' + String(quarterMonth).padStart(2, '0') + '-01';
    }
    return formatDate(date);
  }

  function uniqueSize(values) {
    return new Set((values || []).filter(function (value) { return value !== ''; })).size;
  }

  function aggregateRows(rows, period) {
    var byPeriod = new Map();
    rows.forEach(function (row) {
      var key = bucketFor(period, row.period);
      var current = byPeriod.get(key);
      if (!current) {
        current = {
          period: key,
          orderedShifts: 0,
          workedShifts: 0,
          coveredShifts: 0,
          respondedUserIds: new Set(),
          workedUserIds: new Set()
        };
        byPeriod.set(key, current);
      }
      current.orderedShifts += numberValue(row.orderedShifts);
      current.workedShifts += numberValue(row.workedShifts);
      current.coveredShifts += numberValue(row.coveredShifts);
      (row.respondedUserIds || []).forEach(function (id) { if (id) current.respondedUserIds.add(String(id)); });
      (row.workedUserIds || []).forEach(function (id) { if (id) current.workedUserIds.add(String(id)); });
    });

    return Array.from(byPeriod.values())
      .sort(function (left, right) { return left.period.localeCompare(right.period); })
      .map(function (row) {
        var responded = uniqueSize(Array.from(row.respondedUserIds));
        var worked = uniqueSize(Array.from(row.workedUserIds));
        return {
          period: row.period,
          orderedShifts: row.orderedShifts,
          workedShifts: row.workedShifts,
          coveredShifts: row.coveredShifts,
          slaPercent: row.orderedShifts > 0 ? (row.workedShifts / row.orderedShifts) * 100 : 0,
          uniqueRespondedUsers: responded,
          uniqueWorkedUsers: worked
        };
      });
  }

  function pointPath(rows, xForIndex, yForValue, valueKey) {
    return rows.map(function (row, index) {
      return (index === 0 ? 'M' : 'L') + xForIndex(index) + ' ' + yForValue(numberValue(row[valueKey]));
    }).join(' ');
  }

  function dynamicRange(rows, keys) {
    var values = [];
    rows.forEach(function (row) {
      keys.forEach(function (key) {
        values.push(numberValue(row[key]));
      });
    });

    var min = Math.min.apply(null, values.concat([0]));
    var max = Math.max.apply(null, values.concat([1]));
    if (max === min) {
      var fallbackPadding = Math.max(1, max * 0.1);
      return {
        min: Math.max(0, min - fallbackPadding),
        max: max + fallbackPadding
      };
    }

    var padding = Math.max(1, (max - min) * 0.18);
    return {
      min: Math.max(0, min - padding),
      max: max + padding
    };
  }

  function rangeScale(range, top, plotHeight) {
    var span = Math.max(1, range.max - range.min);
    return function (value) {
      return top + ((range.max - numberValue(value)) / span) * plotHeight;
    };
  }

  function formatCompactNumber(value) {
    return Math.round(numberValue(value)).toLocaleString('ru-RU');
  }

  function formatCompactPercent(value) {
    return Math.round(numberValue(value)) + '%';
  }

  function shouldShowDenseLabel(rows, index, valueKey) {
    if (rows.length <= 14) {
      return true;
    }

    var value = numberValue(rows[index][valueKey]);
    var maxValue = Math.max.apply(null, rows.map(function (row) {
      return numberValue(row[valueKey]);
    }).concat([0]));
    var step = Math.ceil(rows.length / 7);
    var previous = index > 0 ? numberValue(rows[index - 1][valueKey]) : value;
    var next = index < rows.length - 1 ? numberValue(rows[index + 1][valueKey]) : value;
    var isEdge = index === 0 || index === rows.length - 1;
    var isPeak = value >= previous && value >= next && value >= maxValue * 0.55;

    return isEdge || isPeak || index % step === 0;
  }

  function filterReadableLabels(candidates) {
    var accepted = [];

    candidates
      .filter(function (candidate) {
        return candidate.visible;
      })
      .sort(function (left, right) {
        return right.priority - left.priority;
      })
      .forEach(function (candidate) {
        var overlaps = accepted.some(function (current) {
          return Math.abs(current.x - candidate.x) < 34 && Math.abs(current.y - candidate.y) < 18;
        });

        if (!overlaps) {
          accepted.push(candidate);
        }
      });

    return accepted
      .sort(function (left, right) {
        return left.index - right.index || left.order - right.order;
      })
      .map(function (candidate) {
        var text = '<text class="brand-trend-value-label" x="' + candidate.x + '" y="' + candidate.y + '" text-anchor="' + candidate.anchor + '">' + escapeHtml(candidate.label) + '</text>';
        if (!candidate.callout) {
          return text;
        }

        var width = Math.max(24, String(candidate.label).length * 7 + 10);
        var rectX = candidate.anchor === 'middle' ? candidate.x - width / 2 : candidate.x - 5;
        var rectY = candidate.y - 14;
        return '<g class="brand-trend-callout">' +
          '<line class="brand-trend-callout-line" x1="' + candidate.fromX + '" y1="' + candidate.fromY + '" x2="' + candidate.x + '" y2="' + (candidate.y - 5) + '"></line>' +
          '<rect class="brand-trend-label-bg" x="' + rectX + '" y="' + rectY + '" width="' + width + '" height="18"></rect>' +
          text +
          '</g>';
      })
      .join('');
  }

  function labelsOverlap(left, right, xGap, yGap) {
    return Math.abs(left.x - right.x) < xGap && Math.abs(left.y - right.y) < yGap;
  }

  function withSlaCallouts(barCandidates, slaCandidates, width, top) {
    return slaCandidates.map(function (candidate, offset) {
      var collidesWithBar = barCandidates.some(function (barCandidate) {
        return barCandidate.visible && labelsOverlap(candidate, barCandidate, 44, 24);
      });
      if (!collidesWithBar) {
        return candidate;
      }

      var side = offset % 2 === 0 ? 1 : -1;
      var calloutX = Math.max(54, Math.min(width - 54, candidate.x + side * 30));
      var calloutY = Math.max(top + 12, candidate.y - 28 - (offset % 3) * 8);
      return Object.assign({}, candidate, {
        x: calloutX,
        y: calloutY,
        anchor: 'middle',
        callout: true,
        fromX: candidate.x - 8,
        fromY: candidate.y + 8,
        priority: candidate.priority + 30
      });
    });
  }

  function renderEmpty(svg) {
    svg.innerHTML = '<text class="brand-trend-label" x="380" y="140" text-anchor="middle">Нет данных</text>';
  }

  function renderChart(svg, rows, type, detailed) {
    if (!svg || rows.length === 0) {
      if (svg) renderEmpty(svg);
      return;
    }

    if (detailed) {
      svg.setAttribute('data-brand-trend-detailed', '1');
    } else {
      svg.removeAttribute('data-brand-trend-detailed');
    }

    var width = 760;
    var height = 280;
    var left = 48;
    var right = 22;
    var top = 18;
    var bottom = 42;
    var plotWidth = width - left - right;
    var plotHeight = height - top - bottom;
    var count = rows.length;
    var slot = plotWidth / Math.max(count, 1);
    var xForIndex = function (index) { return left + slot * index + slot / 2; };
    var maxBar = Math.max.apply(null, rows.map(function (row) {
      return Math.max(numberValue(row.orderedShifts), numberValue(row.coveredShifts), numberValue(row.uniqueRespondedUsers), numberValue(row.uniqueWorkedUsers));
    }).concat([1]));
    var yForCount = function (value) { return top + plotHeight - (numberValue(value) / maxBar) * plotHeight; };
    var yForPercent = function (value) { return top + plotHeight - (Math.max(0, Math.min(100, numberValue(value))) / 100) * plotHeight; };
    var labels = rows.map(function (row, index) {
      if (count > 10 && index % Math.ceil(count / 8) !== 0 && index !== count - 1) {
        return '';
      }
      return '<text class="brand-trend-label" x="' + xForIndex(index) + '" y="' + (height - 12) + '" text-anchor="middle">' + escapeHtml(String(row.period).slice(5) || row.period) + '</text>';
    }).join('');
    var grid = [0, 0.5, 1].map(function (step) {
      var y = top + plotHeight * step;
      return '<line class="brand-trend-grid-line" x1="' + left + '" y1="' + y + '" x2="' + (width - right) + '" y2="' + y + '"></line>';
    }).join('');

    if (type === 'fulfillment') {
      var barWidth = Math.max(4, Math.min(18, slot * 0.28));
      var bars = rows.map(function (row, index) {
        var x = xForIndex(index);
        var orderedY = yForCount(row.orderedShifts);
        var coveredY = yForCount(row.coveredShifts);
        return '<rect class="brand-trend-bar" fill="#2563eb" x="' + (x - barWidth - 1) + '" y="' + orderedY + '" width="' + barWidth + '" height="' + (top + plotHeight - orderedY) + '"><title>' + escapeHtml(row.period + ': заказано ' + row.orderedShifts) + '</title></rect>' +
          '<rect class="brand-trend-bar" fill="#14b8a6" x="' + (x + 1) + '" y="' + coveredY + '" width="' + barWidth + '" height="' + (top + plotHeight - coveredY) + '"><title>' + escapeHtml(row.period + ': закрыто ' + row.coveredShifts) + '</title></rect>';
      }).join('');
      var barLabelCandidates = rows.flatMap(function (row, index) {
        var x = xForIndex(index);
        var orderedY = Math.max(12, yForCount(row.orderedShifts) - 7);
        var coveredY = Math.max(12, yForCount(row.coveredShifts) - 7);
        var slaY = yForPercent(row.slaPercent);
        var coveredTouchesSla = Math.abs(coveredY - slaY) < 22;
        return [
          {
            index: index,
            order: 1,
            x: x - barWidth / 2 - 1,
            y: orderedY,
            anchor: 'middle',
            label: formatCompactNumber(row.orderedShifts),
            priority: numberValue(row.orderedShifts),
            visible: shouldShowDenseLabel(rows, index, 'orderedShifts')
          },
          {
            index: index,
            order: 2,
            x: coveredTouchesSla ? Math.min(width - 42, x + 30) : x + barWidth / 2 + 1,
            y: coveredTouchesSla ? Math.min(height - bottom - 6, coveredY + 28) : coveredY,
            anchor: 'middle',
            label: formatCompactNumber(row.coveredShifts),
            priority: numberValue(row.coveredShifts) * 0.85 + (coveredTouchesSla ? 25 : 0),
            visible: shouldShowDenseLabel(rows, index, 'coveredShifts') && Math.abs(coveredY - orderedY) >= 18,
            callout: coveredTouchesSla,
            fromX: x + barWidth / 2 + 1,
            fromY: coveredY + 5
          }
        ];
      });
      var slaPath = pointPath(rows, xForIndex, yForPercent, 'slaPercent');
      var slaPoints = rows.map(function (row, index) {
        return '<circle class="brand-trend-point" fill="#7c3aed" cx="' + xForIndex(index) + '" cy="' + yForPercent(row.slaPercent) + '" r="4"><title>' + escapeHtml(row.period + ': SLA ' + Math.round(row.slaPercent) + '%') + '</title></circle>';
      }).join('');
      var slaLabelCandidates = rows.map(function (row, index) {
        return {
          index: index,
          order: 3,
          x: xForIndex(index) + 8,
          y: Math.max(12, yForPercent(row.slaPercent) - 8),
          anchor: 'start',
          label: formatCompactPercent(row.slaPercent),
          priority: 120 - Math.abs(50 - numberValue(row.slaPercent)),
          visible: shouldShowDenseLabel(rows, index, 'slaPercent')
        };
      });
      var valueLabels = detailed ? filterReadableLabels(barLabelCandidates.concat(withSlaCallouts(barLabelCandidates, slaLabelCandidates, width, top))) : '';
      svg.innerHTML = grid + bars + '<path class="brand-trend-line" stroke="#7c3aed" d="' + slaPath + '"></path>' + slaPoints + valueLabels + labels;
      return;
    }

    var workerRange = dynamicRange(rows, ['uniqueRespondedUsers', 'uniqueWorkedUsers']);
    var yForWorkerCount = rangeScale(workerRange, top, plotHeight);
    var respondedPath = pointPath(rows, xForIndex, yForWorkerCount, 'uniqueRespondedUsers');
    var workedPath = pointPath(rows, xForIndex, yForWorkerCount, 'uniqueWorkedUsers');
    var points = rows.map(function (row, index) {
      return '<circle class="brand-trend-point" fill="#f97316" cx="' + xForIndex(index) + '" cy="' + yForWorkerCount(row.uniqueRespondedUsers) + '" r="4"><title>' + escapeHtml(row.period + ': откликнулись ' + row.uniqueRespondedUsers) + '</title></circle>' +
        '<circle class="brand-trend-point" fill="#16a34a" cx="' + xForIndex(index) + '" cy="' + yForWorkerCount(row.uniqueWorkedUsers) + '" r="4"><title>' + escapeHtml(row.period + ': вышли ' + row.uniqueWorkedUsers) + '</title></circle>';
    }).join('');
    var workerValueLabels = detailed ? filterReadableLabels(rows.flatMap(function (row, index) {
      var x = xForIndex(index);
      return [
        {
          index: index,
          order: 1,
          x: x + 8,
          y: Math.max(12, yForWorkerCount(row.uniqueRespondedUsers) - 8),
          anchor: 'start',
          label: formatCompactNumber(row.uniqueRespondedUsers),
          priority: numberValue(row.uniqueRespondedUsers),
          visible: shouldShowDenseLabel(rows, index, 'uniqueRespondedUsers')
        },
        {
          index: index,
          order: 2,
          x: x + 8,
          y: Math.min(height - 48, yForWorkerCount(row.uniqueWorkedUsers) + 18),
          anchor: 'start',
          label: formatCompactNumber(row.uniqueWorkedUsers),
          priority: numberValue(row.uniqueWorkedUsers) * 0.9,
          visible: shouldShowDenseLabel(rows, index, 'uniqueWorkedUsers')
        }
      ];
    })) : '';
    svg.innerHTML = grid +
      '<path class="brand-trend-line" stroke="#f97316" d="' + respondedPath + '"></path>' +
      '<path class="brand-trend-line" stroke="#16a34a" d="' + workedPath + '"></path>' +
      points + workerValueLabels + labels;
  }

  function init(root) {
    if (root.getAttribute('data-brand-trend-ready') === '1') {
      return;
    }
    root.setAttribute('data-brand-trend-ready', '1');
    var modal = root.querySelector('[data-brand-trend-modal]');
    var modalTitle = root.querySelector('[data-brand-trend-modal-title]');
    var modalChart = root.querySelector('[data-brand-trend-modal-chart]');
    var modalClose = root.querySelector('[data-brand-trend-modal-close]');
    var dataNode = root.querySelector('[data-brand-trend-data]');
    var rows = [];
    try {
      rows = dataNode ? JSON.parse(dataNode.textContent || '[]') : [];
    } catch (error) {
      rows = [];
    }
    var currentPeriod = root.getAttribute('data-brand-trend-initial-period') || 'day';
    var currentGrouped = [];

    function renderModalChart(type) {
      if (!modal || !modalChart || modal.getAttribute('aria-hidden') !== 'false') {
        return;
      }

      var sourceChart = root.querySelector('[data-brand-trend-chart="' + type + '"]');
      var sourceTitle = sourceChart ? sourceChart.querySelector('h3') : null;
      var sourceLegend = sourceChart ? sourceChart.querySelector('.brand-trend-legend') : null;
      var title = sourceTitle ? sourceTitle.textContent : '';

      modal.setAttribute('data-brand-trend-modal-type', type);
      if (modalTitle) {
        modalTitle.textContent = title;
      }
      modalChart.innerHTML = '<svg class="brand-trend-svg" viewBox="0 0 760 280" role="img" aria-label="' + escapeHtml(title) + '"></svg>' + (sourceLegend ? sourceLegend.outerHTML : '');
      renderChart(modalChart.querySelector('svg'), currentGrouped, type, true);
    }

    function closeModal() {
      if (!modal) {
        return;
      }
      modal.setAttribute('aria-hidden', 'true');
      modal.removeAttribute('data-brand-trend-modal-type');
      if (modalChart) {
        modalChart.innerHTML = '';
      }
    }

    function openModal(type) {
      if (!modal || !modalChart) {
        return;
      }
      modal.setAttribute('aria-hidden', 'false');
      renderModalChart(type);
      if (modalClose && typeof modalClose.focus === 'function') {
        modalClose.focus();
      }
    }

    function update(period) {
      currentPeriod = period;
      root.setAttribute('data-brand-trend-current-period', currentPeriod);
      root.querySelectorAll('[data-brand-trend-period]').forEach(function (button) {
        button.setAttribute('aria-pressed', button.getAttribute('data-brand-trend-period') === currentPeriod ? 'true' : 'false');
      });
      currentGrouped = aggregateRows(rows, currentPeriod);
      root.querySelectorAll('[data-brand-trend-chart]').forEach(function (chart) {
        renderChart(chart.querySelector('svg'), currentGrouped, chart.getAttribute('data-brand-trend-chart'));
      });
      if (modal && modal.getAttribute('aria-hidden') === 'false') {
        renderModalChart(modal.getAttribute('data-brand-trend-modal-type') || 'fulfillment');
      }
    }

    root.addEventListener('click', function (event) {
      var button = event.target && event.target.closest ? event.target.closest('[data-brand-trend-period]') : null;
      if (button) {
        update(button.getAttribute('data-brand-trend-period') || 'day');
        return;
      }

      var expand = event.target && event.target.closest ? event.target.closest('[data-brand-trend-expand]') : null;
      if (expand) {
        openModal(expand.getAttribute('data-brand-trend-expand') || 'fulfillment');
        return;
      }

      var close = event.target && event.target.closest ? event.target.closest('[data-brand-trend-modal-close], [data-brand-trend-modal-backdrop]') : null;
      if (close) {
        closeModal();
      }
    });

    root.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        closeModal();
      }
    });

    update(currentPeriod);
  }

  window.initBrandTrendCharts = function (container) {
    var scope = container || document;
    var roots = [];
    if (scope.matches && scope.matches('[data-brand-trend-charts]')) {
      roots.push(scope);
    }
    scope.querySelectorAll('[data-brand-trend-charts]').forEach(function (root) {
      roots.push(root);
    });
    roots.forEach(init);
  };

  window.initBrandTrendCharts(document);
})();
</script>`;
}

function renderCityDynamicChartScript() {
  return `<script>
(function () {
  function selectedSeries(root) {
    return (root.getAttribute('data-city-dynamic-selected-series') || '')
      .split(',')
      .filter(function (key) {
        return key !== '';
      });
  }

  function setActiveState(elements, selected) {
    elements.forEach(function (element) {
      var key = element.getAttribute('data-city-dynamic-series') || element.getAttribute('data-city-dynamic-legend-item') || element.getAttribute('data-city-dynamic-series-toggle');
      var active = selected.indexOf(key) !== -1;

      if (active) {
        element.setAttribute('data-city-dynamic-active', '1');
      } else {
        element.removeAttribute('data-city-dynamic-active');
      }
    });
  }

  function updateChart(root, selected) {
    root.setAttribute('data-city-dynamic-selected-series', selected.join(','));
    root.setAttribute('data-city-dynamic-has-selection', selected.length > 0 ? '1' : '0');

    setActiveState(Array.prototype.slice.call(root.querySelectorAll('[data-city-dynamic-series], [data-city-dynamic-legend-item]')), selected);

    root.querySelectorAll('[data-city-dynamic-series-toggle]').forEach(function (button) {
      var key = button.getAttribute('data-city-dynamic-series-toggle');
      var active = selected.indexOf(key) !== -1;

      button.setAttribute('aria-pressed', active ? 'true' : 'false');

      if (active) {
        button.setAttribute('data-city-dynamic-active', '1');
      } else {
        button.removeAttribute('data-city-dynamic-active');
      }
    });
  }

  document.addEventListener('click', function (event) {
    var button = event.target && event.target.closest ? event.target.closest('[data-city-dynamic-series-toggle]') : null;

    if (!button) {
      return;
    }

    var root = button.closest('[data-city-dynamic-chart]');

    if (!root) {
      return;
    }

    var key = button.getAttribute('data-city-dynamic-series-toggle');
    var selected = selectedSeries(root);
    var index = selected.indexOf(key);

    if (index === -1) {
      selected.push(key);
    } else {
      selected.splice(index, 1);
    }

    updateChart(root, selected);
  });
})();
</script>`;
}

function renderRequestReportDurationFilterScript() {
  return `<script>
(function () {
  function updateRequestReportFilters(root) {
    var durationFilter = root.querySelector('[data-request-duration-filter]');
    var statusFilter = root.querySelector('[data-request-status-filter]');
    var actFilter = root.querySelector('[data-request-act-filter]');
    var rows = Array.prototype.slice.call(root.querySelectorAll('[data-request-duration-category]'));
    var status = root.querySelector('[data-request-duration-filter-status]');
    var empty = root.querySelector('[data-request-duration-filter-empty]');
    var selectedDuration = durationFilter ? durationFilter.value : '';
    var selectedStatus = statusFilter ? statusFilter.value : '';
    var selectedAct = actFilter ? actFilter.value : '';
    var visible = 0;

    rows.forEach(function (row) {
      var category = row.getAttribute('data-request-duration-category') || '';
      var reviewStatus = row.getAttribute('data-request-review-status') || '';
      var actExists = row.getAttribute('data-request-act-exists') || 'no';
      var durationVisible = selectedDuration === '' || category === selectedDuration;
      var statusVisible = selectedStatus === '' || reviewStatus === selectedStatus;
      var actVisible = selectedAct === '' || actExists === selectedAct;
      var isVisible = durationVisible && statusVisible && actVisible;

      row.hidden = !isVisible;

      if (isVisible) {
        visible += 1;
      }
    });

    if (status) {
      status.textContent = 'Показано ' + visible + ' из ' + rows.length;
    }

    if (empty) {
      empty.hidden = visible !== 0;
    }
  }

  function applyRequestReportReviewStatusStyle(row, status) {
    if (!row || !row.classList) {
      return;
    }

    row.classList.add('request-report-row');
    row.classList.remove('request-report-row-verified', 'request-report-row-return-later');

    if (status === 'verified') {
      row.classList.add('request-report-row-verified');
    } else if (status === 'return-later') {
      row.classList.add('request-report-row-return-later');
    }
  }

  function clampPercent(value) {
    var number = Number(value);

    if (!Number.isFinite(number)) {
      return null;
    }

    if (number > 0 && number <= 1) {
      number *= 100;
    }

    return Math.max(0, Math.min(100, Math.round(number)));
  }

  function secondsLabel(value) {
    var seconds = Number(value);

    if (!Number.isFinite(seconds) || seconds < 0) {
      return '';
    }

    seconds = Math.round(seconds);

    if (seconds < 60) {
      return seconds + ' сек.';
    }

    return Math.ceil(seconds / 60) + ' мин.';
  }

  function progressSource(payload) {
    var source = payload && payload.job ? payload.job : payload;
    var progress = source && source.progress && typeof source.progress === 'object' ? source.progress : {};

    return {
      source: source || {},
      progress: progress
    };
  }

  function progressPercent(payload) {
    var parts = progressSource(payload);
    var candidates = [
      parts.progress.percent,
      parts.progress.percentage,
      parts.progress.value,
      parts.source.percent,
      parts.source.percentage,
      parts.source.progress
    ];
    var index;
    var percent;

    for (index = 0; index < candidates.length; index += 1) {
      percent = clampPercent(candidates[index]);

      if (percent !== null) {
        return percent;
      }
    }

    return null;
  }

  function progressText(payload, key, fallback) {
    var parts = progressSource(payload);
    var value = parts.progress[key] || parts.source[key] || (payload && payload[key]);

    return value ? String(value) : fallback;
  }

  function progressEta(payload) {
    var parts = progressSource(payload);
    var text = parts.progress.etaText || parts.progress.remainingText || parts.source.etaText || parts.source.remainingText;
    var seconds = parts.progress.etaSeconds ?? parts.progress.remainingSeconds ?? parts.source.etaSeconds ?? parts.source.remainingSeconds;
    var milliseconds = parts.progress.etaMs ?? parts.progress.remainingMs ?? parts.progress.estimatedRemainingMs ?? parts.source.etaMs ?? parts.source.remainingMs ?? parts.source.estimatedRemainingMs;
    var label = text || secondsLabel(seconds);

    if (!label && Number.isFinite(Number(milliseconds))) {
      label = secondsLabel(Number(milliseconds) / 1000);
    }

    return label ? 'Осталось ' + label : 'Осталось --';
  }

  function progressCounters(payload) {
    var parts = progressSource(payload);
    var counters = parts.progress.counters || parts.source.counters || (payload && payload.counters) || {};
    var total = counters.totalRows ?? counters.total ?? parts.progress.totalRows ?? parts.source.totalRows;
    var processed = counters.processedRows ?? counters.processed ?? counters.checkedRows ?? parts.progress.processedRows ?? parts.source.processedRows;
    var missing = counters.missingConfirmedRows ?? counters.missing ?? parts.progress.missingConfirmedRows ?? parts.source.missingConfirmedRows;
    var failed = counters.failedRows ?? counters.failed ?? counters.errors ?? parts.progress.failedRows ?? parts.source.failedRows;
    var labels = [];

    if (total !== undefined && total !== null) {
      labels.push('Строк: ' + total);
    }

    if (processed !== undefined && processed !== null) {
      labels.push('Проверено: ' + processed);
    }

    if (missing !== undefined && missing !== null) {
      labels.push('Без confirmed: ' + missing);
    }

    if (failed !== undefined && failed !== null) {
      labels.push('Ошибки: ' + failed);
    }

    return labels.length > 0 ? labels.join(' · ') : 'Строк: 0 · Проверено: 0 · Без confirmed: 0';
  }

  function setSubmitting(form, submitting) {
    form.setAttribute('aria-busy', submitting ? 'true' : 'false');
    form.querySelectorAll('button[type="submit"]').forEach(function (button) {
      button.disabled = submitting;
    });
  }

  function setProgressError(panel, message) {
    var error = panel ? panel.querySelector('[data-request-report-progress-error]') : null;

    if (!error) {
      return;
    }

    error.textContent = message || '';
    error.hidden = !message;
  }

  function updateProgressPanel(panel, payload) {
    var percent = progressPercent(payload);
    var bar = panel.querySelector('[data-request-report-progress-bar]');
    var percentLabel = panel.querySelector('[data-request-report-progress-percent]');
    var stage = panel.querySelector('[data-request-report-progress-stage]');
    var detail = panel.querySelector('[data-request-report-progress-detail]');
    var eta = panel.querySelector('[data-request-report-progress-eta]');
    var counters = panel.querySelector('[data-request-report-progress-counters]');

    panel.hidden = false;

    if (percent === null) {
      panel.setAttribute('data-request-report-progress-mode', 'indeterminate');
      if (percentLabel) {
        percentLabel.textContent = '...';
      }
    } else {
      panel.setAttribute('data-request-report-progress-mode', 'determinate');
      if (bar) {
        bar.style.width = percent + '%';
      }
      if (percentLabel) {
        percentLabel.textContent = percent + '%';
      }
    }

    if (stage) {
      stage.textContent = progressText(payload, 'stage', 'Запуск проверки');
    }

    if (detail) {
      detail.textContent = progressText(payload, 'detail', 'Файл отправлен, ожидаем прогресс.');
    }

    if (eta) {
      eta.textContent = progressEta(payload);
    }

    if (counters) {
      counters.textContent = progressCounters(payload);
    }
  }

  function payloadStatus(payload) {
    var source = payload && payload.job ? payload.job : payload;

    return String((source && source.status) || (payload && payload.status) || '').toLowerCase();
  }

  function payloadResultHtml(payload) {
    var source = payload && payload.job ? payload.job : payload;

    return (source && (source.resultHtml || source.html)) || (payload && (payload.resultHtml || payload.html)) || '';
  }

  function responseError(response, fallbackMessage) {
    return response.json().catch(function () {
      return {};
    }).then(function (payload) {
      var source = payload && payload.job ? payload.job : payload;
      var message = (source && (source.error || source.message)) || payload.error || payload.message || fallbackMessage;
      var error = new Error(message || fallbackMessage);

      error.status = response.status;
      error.canFallbackToSync = response.status === 404 || response.status === 405;

      throw error;
    });
  }

  function nativeSubmitRequestReportForm(form, submitter) {
    var hidden;

    if (submitter && submitter.name) {
      hidden = document.createElement('input');
      hidden.type = 'hidden';
      hidden.name = submitter.name;
      hidden.value = submitter.value || '';
      hidden.setAttribute('data-request-report-fallback-action', '1');
      form.appendChild(hidden);
    }

    if (!hidden && !new FormData(form).has('action')) {
      hidden = document.createElement('input');
      hidden.type = 'hidden';
      hidden.name = 'action';
      hidden.value = 'check';
      hidden.setAttribute('data-request-report-fallback-action', '1');
      form.appendChild(hidden);
    }

    HTMLFormElement.prototype.submit.call(form);
  }

  function pollRequestReportJob(form, panel, target, jobUrl) {
    fetch(jobUrl, {
      method: 'GET',
      credentials: 'same-origin',
      headers: {
        accept: 'application/json'
      }
    }).then(function (response) {
      if (!response.ok) {
        return responseError(response, 'Не удалось получить статус проверки.');
      }

      return response.json();
    }).then(function (payload) {
      var status = payloadStatus(payload);
      var html;
      var delay;

      updateProgressPanel(panel, payload);

      if (status === 'done' || status === 'completed' || status === 'success') {
        updateProgressPanel(panel, { status: 'done', percent: 100, stage: 'Готово', detail: 'Результат проверки получен.', counters: (payload.job && payload.job.counters) || payload.counters });
        html = payloadResultHtml(payload);

        if (html && target) {
          target.innerHTML = html;
          target.querySelectorAll('[data-request-report-result]').forEach(updateRequestReportFilters);
        }

        setSubmitting(form, false);
        return;
      }

      if (status === 'failed' || status === 'error') {
        throw new Error(progressText(payload, 'error', progressText(payload, 'message', 'Проверка завершилась ошибкой.')));
      }

      delay = Number((payload.job && payload.job.pollAfterMs) || payload.pollAfterMs || 900);
      window.setTimeout(function () {
        pollRequestReportJob(form, panel, target, jobUrl);
      }, Number.isFinite(delay) ? Math.max(200, Math.min(5000, delay)) : 900);
    }).catch(function (error) {
      setProgressError(panel, error && error.message ? error.message : 'Не удалось выполнить проверку.');
      setSubmitting(form, false);
    });
  }

  document.addEventListener('submit', function (event) {
    var form = event.target && event.target.closest ? event.target.closest('[data-request-report-check-form]') : null;
    var submitter = event.submitter || null;
    if (!submitter && document.activeElement && document.activeElement.closest && document.activeElement.closest('[data-request-report-check-form]') === form) {
      submitter = document.activeElement;
    }

    var action = submitter && submitter.name === 'action' ? submitter.value : '';
    var jobsUrl;
    var panel;
    var target;
    var formData;

    if (!form) {
      return;
    }

    if (action === 'export') {
      return;
    }

    jobsUrl = form.getAttribute('data-request-report-jobs-url') || '';

    if (!jobsUrl || !window.fetch || !window.FormData) {
      return;
    }

    event.preventDefault();

    panel = document.querySelector('[data-request-report-progress]');
    target = document.querySelector('[data-request-report-result-target]');

    if (!panel || !target) {
      nativeSubmitRequestReportForm(form, submitter || { name: 'action', value: 'check' });
      return;
    }

    setSubmitting(form, true);
    setProgressError(panel, '');
    updateProgressPanel(panel, { stage: 'Отправка файла', detail: 'Создаем задачу проверки.', counters: {} });

    try {
      formData = new FormData(form, submitter || undefined);
    } catch (error) {
      formData = new FormData(form);
      if (submitter && submitter.name && !formData.has(submitter.name)) {
        formData.append(submitter.name, submitter.value || '');
      }
    }

    if (!formData.has('action')) {
      formData.append('action', 'check');
    }

    fetch(jobsUrl, {
      method: 'POST',
      credentials: 'same-origin',
      body: formData
    }).then(function (response) {
      if (!response.ok) {
        return responseError(response, 'Не удалось запустить проверку.');
      }

      return response.json();
    }).then(function (payload) {
      var job = payload && payload.job;
      var id = payload && (payload.id || payload.jobId || (job && (job.id || job.jobId)));

      if (!id) {
        throw new Error('Сервер не вернул ID задачи.');
      }

      updateProgressPanel(panel, { stage: 'Проверка запущена', detail: 'Ожидаем первый статус задачи.', counters: {} });
      pollRequestReportJob(form, panel, target, jobsUrl.replace(/\\/$/, '') + '/' + encodeURIComponent(id));
    }).catch(function (error) {
      if (error && error.canFallbackToSync) {
        nativeSubmitRequestReportForm(form, submitter || { name: 'action', value: 'check' });
        return;
      }

      setProgressError(panel, error && error.message ? error.message : 'Не удалось запустить проверку.');
      setSubmitting(form, false);
    });
  });

  document.addEventListener('change', function (event) {
    var filter = event.target && event.target.closest
      ? event.target.closest('[data-request-duration-filter], [data-request-status-filter], [data-request-act-filter]')
      : null;

    if (!filter) {
      return;
    }

    var root = filter.closest('[data-request-report-result]');

    if (root) {
      updateRequestReportFilters(root);
    }
  });

  document.addEventListener('change', function (event) {
    var control = event.target && event.target.closest
      ? event.target.closest('[data-request-report-status-control]')
      : null;

    if (!control) {
      return;
    }

    var root = control.closest('[data-request-report-result]');
    var row = control.closest('[data-request-review-status]');
    var rowKey = control.getAttribute('data-request-report-status-key') || '';
    var previousStatus = control.getAttribute('data-saved-status') || '';
    var nextStatus = control.value || '';

    if (!root || !row || !rowKey) {
      return;
    }

    row.setAttribute('data-request-review-status', nextStatus);
    applyRequestReportReviewStatusStyle(row, nextStatus);
    control.disabled = true;
    updateRequestReportFilters(root);

    var body = new URLSearchParams();
    body.set('rowKey', rowKey);
    body.set('status', nextStatus);
    body.set('csrfToken', root.getAttribute('data-csrf-token') || '');

    fetch(root.getAttribute('data-request-status-url') || '/tools/request-report-confirmed-check/status', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: body.toString()
    }).then(function (response) {
      if (!response.ok) {
        throw new Error('status save failed');
      }

      return response.json();
    }).then(function (payload) {
      var savedStatus = payload && payload.status ? payload.status : '';

      control.setAttribute('data-saved-status', savedStatus);
      row.setAttribute('data-request-review-status', savedStatus);
      applyRequestReportReviewStatusStyle(row, savedStatus);
      control.value = savedStatus;
      updateRequestReportFilters(root);
    }).catch(function () {
      control.value = previousStatus;
      row.setAttribute('data-request-review-status', previousStatus);
      applyRequestReportReviewStatusStyle(row, previousStatus);
      updateRequestReportFilters(root);
    }).finally(function () {
      control.disabled = false;
    });
  });

  document.querySelectorAll('[data-request-review-status]').forEach(function (row) {
    applyRequestReportReviewStatusStyle(row, row.getAttribute('data-request-review-status') || '');
  });
  document.querySelectorAll('[data-request-report-result]').forEach(updateRequestReportFilters);
})();
</script>`;
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

function renderWorkplacePinScript() {
  return `<script>
(function () {
  function uniqueValues(values) {
    var seen = {};
    var result = [];

    values.forEach(function (value) {
      var text = String(value || '').trim();

      if (text === '' || seen[text]) {
        return;
      }

      seen[text] = true;
      result.push(text);
    });

    return result;
  }

  function createPinnedInput(value) {
    var input = document.createElement('input');

    input.type = 'hidden';
    input.name = 'pinnedWorkplaceId';
    input.value = value;
    input.setAttribute('data-workplace-pin-hidden', '1');

    return input;
  }

  function replacePinnedInputs(form, values) {
    var anchor = form.querySelector('.point-pin-label') || form.firstChild;

    form.querySelectorAll('input[type="hidden"][name="pinnedWorkplaceId"]').forEach(function (input) {
      input.remove();
    });

    values.forEach(function (value) {
      form.insertBefore(createPinnedInput(value), anchor);
    });
  }

  function pinnedIdsFromHref(href) {
    var url = new URL(href, window.location.origin);

    return uniqueValues(url.searchParams.getAll('pinnedWorkplaceId'));
  }

  function hrefFromPinForm(form) {
    var params = new URLSearchParams(new FormData(form));
    var currentParams = new URLSearchParams(window.location.search);
    var page = currentParams.get('page');

    if (page && !params.has('page')) {
      params.set('page', page);
    }

    return form.getAttribute('action') + '?' + params.toString();
  }

  function updatePinnedParams(params, pinnedIds) {
    params.delete('pinnedWorkplaceId');
    pinnedIds.forEach(function (id) {
      params.append('pinnedWorkplaceId', id);
    });
  }

  function updateWorkplaceAnalysisHref(link, pinnedIds) {
    var href = link.getAttribute('href');
    var url;

    if (!href) {
      return;
    }

    url = new URL(href, window.location.origin);

    if (url.pathname !== '/dashboards/workplace-analysis' && url.pathname !== '/dashboards/workplace-analysis/section') {
      return;
    }

    updatePinnedParams(url.searchParams, pinnedIds);
    link.setAttribute('href', url.pathname + '?' + url.searchParams.toString());
  }

  function updatePinnedWorkplaceState(form) {
    var href = hrefFromPinForm(form);
    var pinnedIds = pinnedIdsFromHref(href);

    document.querySelectorAll('[data-workplace-pin-form]').forEach(function (pinForm) {
      var checkbox = pinForm.querySelector('input[name="pinnedWorkplaceId"][type="checkbox"]');
      var card = pinForm.closest('.point-card');
      var workplaceId;
      var checked;
      var hiddenValues;

      if (!checkbox) {
        return;
      }

      workplaceId = String(checkbox.value || '').trim();
      checked = pinnedIds.indexOf(workplaceId) !== -1;
      checkbox.checked = checked;

      if (card) {
        card.classList.toggle('pinned', checked);
      }

      hiddenValues = checked
        ? pinnedIds.filter(function (id) { return id !== workplaceId; })
        : pinnedIds;
      replacePinnedInputs(pinForm, hiddenValues);
    });

    document.querySelectorAll('form[action="/dashboards/workplace-analysis"]:not([data-workplace-pin-form])').forEach(function (plainForm) {
      replacePinnedInputs(plainForm, pinnedIds);
    });

    document.querySelectorAll('a[href]').forEach(function (link) {
      updateWorkplaceAnalysisHref(link, pinnedIds);
    });

    window.history.replaceState({}, '', href);
  }

  document.addEventListener('change', function (event) {
    var form = event.target && event.target.closest ? event.target.closest('[data-workplace-pin-form]') : null;

    if (!form || event.target.name !== 'pinnedWorkplaceId') {
      return;
    }

    updatePinnedWorkplaceState(form);
  });

  document.addEventListener('submit', function (event) {
    var form = event.target && event.target.closest ? event.target.closest('[data-workplace-pin-form]') : null;

    if (!form) {
      return;
    }

    event.preventDefault();
    updatePinnedWorkplaceState(form);
  });
})();
</script>`;
}

function renderDashboardProgressiveScript() {
  return `<script>
(function () {
  function normalizeTrendValue(value) {
    var number = Number(value);

    return Number.isFinite(number) ? number : 0;
  }

  function miniTrendSvg(values, label) {
    if (values.length < 2) {
      return '';
    }

    var width = 140;
    var height = 36;
    var paddingX = 2;
    var paddingY = 3;
    var chartWidth = width - paddingX * 2;
    var chartHeight = height - paddingY * 2;
    var minValue = Math.min.apply(Math, values);
    var maxValue = Math.max.apply(Math, values);
    var range = maxValue - minValue;
    var points = values.map(function (value, index) {
      var x = paddingX + (chartWidth * index) / (values.length - 1);
      var y = range === 0
        ? height / 2
        : paddingY + ((maxValue - value) / range) * chartHeight;

      return x.toFixed(2).replace(/\\.?0+$/, '') + ',' + y.toFixed(2).replace(/\\.?0+$/, '');
    }).join(' ');

    return '<svg class="mini-trend" viewBox="0 0 140 36" role="img" aria-label="Динамика ' + label + '">'
      + '<polyline points="' + points + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></polyline>'
      + '</svg>';
  }

  function hydrateSalesMiniTrends() {
    var trendRows = Array.prototype.slice.call(document.querySelectorAll('[data-sales-trend-row]'));

    if (trendRows.length < 2) {
      return;
    }

    document.querySelectorAll('[data-mini-trend-target]').forEach(function (card) {
      var target = card.getAttribute('data-mini-trend-target');
      var label = card.getAttribute('data-mini-trend-label') || '';
      var attribute = target === 'workedShifts' ? 'data-worked-shifts' : 'data-ordered-shifts';
      var values = trendRows.map(function (row) {
        return normalizeTrendValue(row.getAttribute(attribute));
      });
      var svg = miniTrendSvg(values, label);
      var valueNode;
      var subvalue;

      if (svg === '') {
        return;
      }

      subvalue = card.querySelector('.kpi-subvalue');

      if (!subvalue) {
        valueNode = card.querySelector('.kpi-value');
        subvalue = document.createElement('div');
        subvalue.className = 'kpi-subvalue';

        if (valueNode && valueNode.parentNode) {
          valueNode.parentNode.insertBefore(subvalue, valueNode.nextSibling);
        } else {
          card.appendChild(subvalue);
        }
      }

      subvalue.innerHTML = svg;
    });
  }

  function cityRankingNumber(value) {
    var number = Number(value || 0);

    return Number.isFinite(number) ? number : 0;
  }

  function cityRankingFormatNumber(value, digits) {
    return new Intl.NumberFormat('ru-RU', {
      maximumFractionDigits: digits || 0,
      minimumFractionDigits: digits || 0
    }).format(cityRankingNumber(value));
  }

  function cityRankingAggregate(rows, brand) {
    var byCity = new Map();

    rows.forEach(function (row) {
      var city = String(row.city || '').trim();
      var rowBrand = String(row.brand || '').trim();
      var aggregate;

      if (!city || (brand && rowBrand !== brand)) {
        return;
      }

      if (!byCity.has(city)) {
        byCity.set(city, {
          city: city,
          orderedShifts: 0,
          workplaceCount: 0,
          brandCount: 0,
          orderCount: 0,
          coveredShifts: 0,
          brands: new Set()
        });
      }

      aggregate = byCity.get(city);
      aggregate.orderedShifts += cityRankingNumber(row.orderedShifts);
      aggregate.workplaceCount += cityRankingNumber(row.workplaceCount);
      aggregate.orderCount += cityRankingNumber(row.orderCount);
      aggregate.coveredShifts += cityRankingNumber(row.coveredShifts);

      if (rowBrand) {
        aggregate.brands.add(rowBrand);
      }
    });

    return Array.from(byCity.values()).map(function (row) {
      return {
        city: row.city,
        orderedShifts: row.orderedShifts,
        workplaceCount: row.workplaceCount,
        brandCount: row.brands.size,
        orderCount: row.orderCount,
        coveredShifts: row.coveredShifts,
        slaPercent: row.orderedShifts > 0 ? (row.coveredShifts / row.orderedShifts) * 100 : 0
      };
    });
  }

  function cityRankingSortRows(rows, key, direction) {
    return rows.slice().sort(function (left, right) {
      var multiplier = direction === 'asc' ? 1 : -1;
      var leftValue = key === 'city' ? String(left.city || '') : cityRankingNumber(left[key]);
      var rightValue = key === 'city' ? String(right.city || '') : cityRankingNumber(right[key]);

      if (key === 'city') {
        return leftValue.localeCompare(rightValue, 'ru') * multiplier;
      }

      if (leftValue === rightValue) {
        return String(left.city || '').localeCompare(String(right.city || ''), 'ru');
      }

      return (leftValue - rightValue) * multiplier;
    });
  }

  function cityRankingAppendCell(rowNode, text, className) {
    var cell = document.createElement('td');

    if (className) {
      cell.className = className;
    }

    cell.textContent = text;
    rowNode.appendChild(cell);
  }

  function cityRankingCurrentRows(root) {
    var brandSelect = root.querySelector('[data-city-ranking-brand]');
    var rows = root.__cityRankingRows || [];
    var sortKey = root.getAttribute('data-city-ranking-sort-key') || 'orderedShifts';
    var direction = root.getAttribute('data-city-ranking-sort-direction') || 'desc';
    var brand = brandSelect ? brandSelect.value : '';

    return cityRankingSortRows(cityRankingAggregate(rows, brand), sortKey, direction);
  }

  function cityRankingEscapeWorkbookCell(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function cityRankingExportWorkbook(root) {
    var rows = cityRankingCurrentRows(root);
    var headers = ['Город', 'Заказ', 'Точки с заказами', 'Бренды', 'SLA'];
    var workbookRows = rows.map(function (row) {
      return [
        row.city,
        cityRankingFormatNumber(row.orderedShifts),
        cityRankingFormatNumber(row.workplaceCount),
        cityRankingFormatNumber(row.brandCount),
        cityRankingFormatNumber(row.slaPercent, 1) + '%'
      ];
    });
    var html = '<!doctype html><html><head><meta charset="utf-8"></head><body><table><thead><tr>' +
      headers.map(function (header) {
        return '<th>' + cityRankingEscapeWorkbookCell(header) + '</th>';
      }).join('') +
      '</tr></thead><tbody>' +
      workbookRows.map(function (row) {
        return '<tr>' + row.map(function (cell) {
          return '<td>' + cityRankingEscapeWorkbookCell(cell) + '</td>';
        }).join('') + '</tr>';
      }).join('') +
      '</tbody></table></body></html>';
    var blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    var link = document.createElement('a');
    var url = URL.createObjectURL(blob);

    link.href = url;
    link.download = 'city-ranking.xls';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function cityRankingRender(root) {
    var body = root.querySelector('[data-city-ranking-body]');
    var meta = root.querySelector('[data-city-ranking-meta]');
    var empty = root.querySelector('[data-city-ranking-empty]');
    var sortKey = root.getAttribute('data-city-ranking-sort-key') || 'orderedShifts';
    var direction = root.getAttribute('data-city-ranking-sort-direction') || 'desc';
    var aggregated = cityRankingCurrentRows(root);

    if (!body) {
      return;
    }

    body.replaceChildren();

    aggregated.forEach(function (row) {
      var rowNode = document.createElement('tr');

      cityRankingAppendCell(rowNode, row.city, '');
      cityRankingAppendCell(rowNode, cityRankingFormatNumber(row.orderedShifts), 'number-cell');
      cityRankingAppendCell(rowNode, cityRankingFormatNumber(row.workplaceCount), 'number-cell');
      cityRankingAppendCell(rowNode, cityRankingFormatNumber(row.brandCount), 'number-cell');
      cityRankingAppendCell(rowNode, cityRankingFormatNumber(row.slaPercent, 1) + '%', 'number-cell');
      body.appendChild(rowNode);
    });

    if (meta) {
      meta.textContent = 'Городов: ' + cityRankingFormatNumber(aggregated.length);
    }

    if (empty) {
      empty.style.display = aggregated.length === 0 ? 'block' : 'none';
    }

    root.querySelectorAll('[data-city-ranking-sort]').forEach(function (button) {
      var buttonKey = button.getAttribute('data-city-ranking-sort');
      var indicator = button.querySelector('.sort-indicator');
      var active = buttonKey === sortKey;

      button.setAttribute('aria-sort', active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none');

      if (indicator) {
        indicator.textContent = active ? (direction === 'asc' ? '↑' : '↓') : '↕';
      }
    });
  }

  function initCityRankingTables(scope) {
    (scope || document).querySelectorAll('[data-city-ranking-table]').forEach(function (root) {
      if (root.getAttribute('data-city-ranking-ready') === '1') {
        return;
      }

      try {
        root.__cityRankingRows = JSON.parse(root.getAttribute('data-city-ranking-json') || '[]');
      } catch (_) {
        root.__cityRankingRows = [];
      }

      root.setAttribute('data-city-ranking-ready', '1');
      root.setAttribute('data-city-ranking-sort-key', root.getAttribute('data-city-ranking-sort-key') || 'orderedShifts');
      root.setAttribute('data-city-ranking-sort-direction', root.getAttribute('data-city-ranking-sort-direction') || 'desc');

      root.querySelectorAll('[data-city-ranking-sort]').forEach(function (button) {
        button.addEventListener('click', function () {
          var key = button.getAttribute('data-city-ranking-sort');
          var currentKey = root.getAttribute('data-city-ranking-sort-key') || 'orderedShifts';
          var currentDirection = root.getAttribute('data-city-ranking-sort-direction') || 'desc';
          var nextDirection = key === currentKey && currentDirection === 'desc' ? 'asc' : 'desc';

          root.setAttribute('data-city-ranking-sort-key', key);
          root.setAttribute('data-city-ranking-sort-direction', nextDirection);
          cityRankingRender(root);
        });
      });

      root.querySelectorAll('[data-city-ranking-brand]').forEach(function (select) {
        select.addEventListener('change', function () {
          cityRankingRender(root);
        });
      });

      root.querySelectorAll('[data-city-ranking-export]').forEach(function (button) {
        button.addEventListener('click', function () {
          cityRankingExportWorkbook(root);
        });
      });

      cityRankingRender(root);
    });
  }

  function replaceWithHtml(root, html) {
    var template = document.createElement('template');

    template.innerHTML = html;
    root.replaceWith(template.content);
    hydrateSalesMiniTrends();
    initCityRankingTables(document);

    if (typeof window.initHeatmapLeafletMaps === 'function') {
      window.initHeatmapLeafletMaps();
    }
    if (typeof window.initBrandTrendCharts === 'function') {
      window.initBrandTrendCharts(document);
    }
  }

  function renderError(root, message) {
    replaceWithHtml(root, '<section class="section"><div class="error">' + message + '</div></section>');
  }

  var dashboardFragmentQueue = [];
  var dashboardFragmentActive = 0;
  var dashboardFragmentLimit = 2;

  function fetchDashboardFragment(root) {
    var url = root.getAttribute('data-dashboard-fragment-url') || root.getAttribute('data-city-analysis-fragment-url');

    if (!url) {
      return Promise.resolve();
    }

    root.setAttribute('data-dashboard-fragment-loaded', '1');

    return fetch(url)
      .then(function (response) {
        return response.text().then(function (html) {
          if (!response.ok) {
            replaceWithHtml(root, html || '<section class="section"><div class="error">Не удалось загрузить блок.</div></section>');
            return;
          }

          if (response.status === 202) {
            root.innerHTML = html;
            window.setTimeout(function () {
              root.removeAttribute('data-dashboard-fragment-loaded');
              enqueueDashboardFragment(root);
            }, 3000);
            return;
          }

          replaceWithHtml(root, html);
        });
      })
      .catch(function (error) {
        var message = error && error.message ? error.message : 'Не удалось загрузить блок.';

        renderError(root, message);
      });
  }

  function pumpDashboardFragmentQueue() {
    while (dashboardFragmentActive < dashboardFragmentLimit && dashboardFragmentQueue.length > 0) {
      loadQueuedDashboardFragment(dashboardFragmentQueue.shift());
    }
  }

  function loadQueuedDashboardFragment(root) {
    if (!root || root.getAttribute('data-dashboard-fragment-loaded') === '1') {
      return;
    }

    dashboardFragmentActive += 1;
    fetchDashboardFragment(root).finally(function () {
      dashboardFragmentActive -= 1;
      pumpDashboardFragmentQueue();
    });
  }

  function enqueueDashboardFragment(root) {
    if (!root || root.getAttribute('data-dashboard-fragment-loaded') === '1') {
      return;
    }

    dashboardFragmentQueue.push(root);
    pumpDashboardFragmentQueue();
  }

  function loadDeferredDashboardFragment(root) {
    enqueueDashboardFragment(root);
  }

  function scheduleIdleDashboardFragment(root) {
    var runIdle = window.requestIdleCallback || function (callback) {
      return setTimeout(callback, 500);
    };

    runIdle(function () {
      enqueueDashboardFragment(root);
    });
  }

  function scheduleVisibleDashboardFragment(root) {
    if (!('IntersectionObserver' in window)) {
      scheduleIdleDashboardFragment(root);
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) {
          return;
        }

        observer.unobserve(root);
        enqueueDashboardFragment(root);
      });
    }, { rootMargin: '200px 0px' });

    observer.observe(root);
  }

  document.querySelectorAll('[data-dashboard-fragment-url], [data-city-analysis-fragment-url]').forEach(function (root) {
    var deferMode = root.getAttribute('data-dashboard-fragment-defer');

    if (deferMode === 'idle') {
      scheduleIdleDashboardFragment(root);
      return;
    }

    if (deferMode === 'visible') {
      scheduleVisibleDashboardFragment(root);
      return;
    }

    if (deferMode) {
      return;
    }

    enqueueDashboardFragment(root);
  });

  document.addEventListener('change', function () {
    document.querySelectorAll('[data-dashboard-fragment-defer]').forEach(function (root) {
      var selector = root.getAttribute('data-dashboard-fragment-defer');
      if (selector === 'idle' || selector === 'visible') {
        return;
      }
      var trigger = selector ? document.querySelector(selector) : null;

      if (trigger && trigger.checked) {
        loadDeferredDashboardFragment(root);
      }
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

  initCityRankingTables(document);
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
  var title = modal.querySelector('[data-worker-cancellation-modal-title]');
  var lastFocused = null;

  function escapeClientHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function openModal(modalTitle) {
    lastFocused = document.activeElement;
    modal.hidden = false;

    if (title) {
      title.textContent = modalTitle || 'Детализация смен';
    }

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

    var trigger = event.target.closest('[data-worker-cancellation-detail-trigger], [data-worker-blacklists-trigger]');

    if (trigger) {
      event.preventDefault();
      openModal(
        trigger.hasAttribute('data-worker-blacklists-trigger')
          ? 'Чёрные списки'
          : 'Детализация смен'
      );

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
            if (body.querySelector('[data-giger-scope-pending]') && !modal.hidden) {
              window.setTimeout(function () { loadDetails(url); }, 3000);
            }
          }
        });
      })
      .catch(function (error) {
        renderModalError(error && error.message ? error.message : 'Не удалось загрузить список гигеров.');
      });
  }

  function setExportProgress(button, message, disabled) {
    var progress = button.parentElement && button.parentElement.querySelector('[data-region-giger-export-progress]');
    button.disabled = Boolean(disabled);
    if (progress) progress.textContent = message || '';
  }

  function pollExportJob(button, statusUrl) {
    window.setTimeout(function () {
      fetch(statusUrl)
        .then(function (response) { return response.json().then(function (data) { return { response: response, data: data }; }); })
        .then(function (result) {
          var job = result.data || {};
          if (!result.response.ok || job.status === 'failed') {
            setExportProgress(button, job.error || job.detail || 'Не удалось подготовить файл.', false);
            return;
          }
          if (job.status === 'done' && job.downloadUrl) {
            setExportProgress(button, 'Файл готов: ', true);
            var link = document.createElement('a');
            link.className = 'secondary-button'; link.href = job.downloadUrl; link.textContent = 'Скачать Excel';
            button.replaceWith(link);
            return;
          }
          setExportProgress(button, (job.stage || 'Подготавливаем файл') + ' — ' + (job.progress || 0) + '%', true);
          pollExportJob(button, statusUrl);
        })
        .catch(function () { setExportProgress(button, 'Не удалось узнать состояние выгрузки.', false); });
    }, 1000);
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

    var exportButton = event.target.closest('[data-region-giger-export-start]');
    if (exportButton && modal.contains(exportButton)) {
      event.preventDefault();
      var exportUrl = exportButton.getAttribute('data-export-job-url');
      var csrfToken = exportButton.getAttribute('data-csrf-token') || '';
      setExportProgress(exportButton, 'Ставим выгрузку в очередь…', true);
      fetch(exportUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
        body: 'csrfToken=' + encodeURIComponent(csrfToken)
      })
        .then(function (response) { return response.json().then(function (data) { return { response: response, data: data }; }); })
        .then(function (result) {
          if (!result.response.ok || !result.data || !result.data.statusUrl) {
            setExportProgress(exportButton, (result.data && result.data.error) || 'Не удалось запустить выгрузку.', false);
            return;
          }
          pollExportJob(exportButton, result.data.statusUrl);
        })
        .catch(function () { setExportProgress(exportButton, 'Не удалось запустить выгрузку.', false); });
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

    var pageLink = event.target.closest('[data-review-list-page-link]');

    if (pageLink && modal.contains(pageLink)) {
      event.preventDefault();
      loadReviews(pageLink.getAttribute('href'));
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

function formatWholePercent(value) {
  return `${formatNumber(Math.round(Number(value) || 0))}%`;
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

function renderPasswordChange({
  database,
  currentUser,
  csrfToken = '',
  error = '',
  message = '',
  required = false,
  returnTo = '/'
}) {
  const isEnvAdmin = currentUser && currentUser.source === 'env';
  const errorHtml = error ? `<div class="inline-error">${escapeHtml(error)}</div>` : '';
  const messageHtml = message ? `<div class="success">${escapeHtml(message)}</div>` : '';
  const requiredHtml = required
    ? '<div class="inline-error">Требуется сменить временный пароль перед продолжением работы.</div>'
    : '';
  const content = isEnvAdmin
    ? `<section class="auth-page">
  <div class="auth-card">
    <h1>Смена пароля</h1>
    <p class="technical-note">Пароль администратора задается через окружение. Обновите <code>AUTH_ADMIN_PASSWORD</code> в настройках деплоя.</p>
  </div>
</section>`
    : `<section class="auth-page">
  <form class="auth-card" action="/account/password" method="post">
    <h1>Смена пароля</h1>
    ${requiredHtml}
    ${messageHtml}
    ${errorHtml}
    ${renderHiddenCsrf(csrfToken)}
    <input type="hidden" name="returnTo" value="${escapeHtml(safeReturnPath(returnTo))}">
    <div class="form-grid">
      <div class="field">
        <label for="currentPassword">Текущий пароль</label>
        <input id="currentPassword" name="currentPassword" type="password" autocomplete="current-password" required>
      </div>
      <div class="field">
        <label for="newPassword">Новый пароль</label>
        <input id="newPassword" name="newPassword" type="password" autocomplete="new-password" minlength="12" required>
      </div>
      <div class="field">
        <label for="confirmPassword">Повторите новый пароль</label>
        <input id="confirmPassword" name="confirmPassword" type="password" autocomplete="new-password" minlength="12" required>
      </div>
    </div>
    <p class="technical-note">Минимум 12 символов: строчная и заглавная буквы, цифра и спецсимвол. Пароль не должен совпадать с текущим паролем или почтой.</p>
    <div class="form-actions">
      <button type="submit">Сохранить пароль</button>
    </div>
  </form>
</section>`;

  return layout({
    title: 'Смена пароля',
    database,
    content,
    activeNav: 'account-password',
    currentUser,
    csrfToken
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

function scheduledRouteSegment(value) {
  return encodeURIComponent(String(value ?? ''));
}

function scheduleRecipientsText(recipients) {
  if (Array.isArray(recipients)) {
    return recipients.join('\n');
  }

  return String(recipients || '');
}

function scheduleRecipientsDisplay(recipients) {
  if (Array.isArray(recipients)) {
    return recipients.join(', ');
  }

  return String(recipients || '');
}

function scheduledReportValue(value, fallback = '') {
  if (value === undefined || value === null) {
    return fallback;
  }

  return value;
}

function formatScheduledReportFileSize(value) {
  const bytes = Number(value);

  if (!Number.isFinite(bytes) || bytes < 0) {
    return '-';
  }

  if (bytes < 1024) {
    return `${formatNumber(bytes)} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${formatNumber(bytes / 1024, 1)} KB`;
  }

  return `${formatNumber(bytes / 1024 / 1024, 1)} MB`;
}

function renderScheduledPageMessages(message, error) {
  const messageHtml = message ? `<div class="success">${escapeHtml(message)}</div>` : '';
  const errorHtml = error ? `<div class="inline-error">${escapeHtml(error)}</div>` : '';

  return messageHtml || errorHtml ? `<section class="section">${messageHtml}${errorHtml}</section>` : '';
}

function renderScheduledReportList(reports = [], selectedReport = null) {
  const rows = safeRows(reports);
  const selectedId = selectedReport && selectedReport.id !== undefined && selectedReport.id !== null
    ? String(selectedReport.id)
    : '';

  if (rows.length === 0) {
    return '<p class="empty">Отчетов пока нет.</p>';
  }

  return `<ul class="table-list scheduled-report-list">${rows.map((report) => {
    const safeReport = report || {};
    const reportId = String(scheduledReportValue(safeReport.id));
    const isSelected = selectedId !== '' && String(safeReport.id) === selectedId;
    const className = isSelected ? 'scheduled-report-item scheduled-report-selected' : 'scheduled-report-item';
    const marker = isSelected ? '<span class="readonly-badge">выбран</span>' : '';
    const status = safeReport.enabled ? 'включен' : 'выключен';
    const updatedAt = safeReport.updatedAt ? ` · ${safeReport.updatedAt}` : '';

    return `<li class="${className}">
      <a class="table-link" href="/reports/scheduled?reportId=${escapeHtml(scheduledRouteSegment(reportId))}">${escapeHtml(safeReport.title || `Отчет ${reportId}`)}</a>
      ${marker}
      <span class="technical-note">${escapeHtml(`${status}${updatedAt}`)}</span>
    </li>`;
  }).join('')}</ul>`;
}

function renderScheduledReportPreview(preview) {
  if (!preview) {
    return '';
  }

  if (preview.error) {
    return `<div class="inline-error">${escapeHtml(preview.error)}</div>`;
  }

  const rows = safeRows(preview.rows);
  const columns = safeRows(preview.columns).length > 0
    ? safeRows(preview.columns).map((column) => String(column))
    : rows.length > 0
      ? Object.keys(rows[0])
      : [];

  if (columns.length === 0) {
    return '<p class="empty">Preview пуст.</p>';
  }

  const header = columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('');
  const body = rows.map((row) => `<tr>${columns.map((column) => `<td>${renderCell(row[column])}</td>`).join('')}</tr>`).join('');

  return `<div class="table-scroll"><table>
    <thead><tr>${header}</tr></thead>
    <tbody>${body || `<tr><td colspan="${escapeHtml(columns.length)}">Нет строк.</td></tr>`}</tbody>
  </table></div>`;
}

function renderScheduledReportForm({ report = {}, csrfToken = '', mode = 'create', preview }) {
  const safeReport = report || {};
  const isUpdate = mode === 'update';
  const reportId = scheduledReportValue(safeReport.id);

  if (isUpdate && String(reportId) === '') {
    return '';
  }

  const htmlId = isUpdate ? `scheduled-report-${scheduledRouteSegment(reportId)}` : 'scheduled-report-new';
  const action = isUpdate
    ? `/reports/scheduled/${scheduledRouteSegment(reportId)}/update`
    : '/reports/scheduled/create';
  const previewAction = isUpdate
    ? `/reports/scheduled/${scheduledRouteSegment(reportId)}/preview`
    : '';
  const title = isUpdate ? 'Редактировать SQL-отчет' : 'Создать SQL-отчет';
  const enabled = isUpdate ? safeReport.enabled : true;

  return `<form class="form-panel" action="${escapeHtml(action)}" method="post">
    ${renderHiddenCsrf(csrfToken)}
    <h2>${escapeHtml(title)}</h2>
    <div class="form-grid">
      <div class="field">
        <label for="${escapeHtml(htmlId)}-title">Название</label>
        <input id="${escapeHtml(htmlId)}-title" name="title" value="${escapeHtml(scheduledReportValue(safeReport.title))}" required>
      </div>
      <div class="field">
        <label for="${escapeHtml(htmlId)}-row-limit">Лимит строк</label>
        <input id="${escapeHtml(htmlId)}-row-limit" name="rowLimit" type="number" min="1" value="${escapeHtml(scheduledReportValue(safeReport.rowLimit, 10000))}" required>
      </div>
      <div class="field">
        <label for="${escapeHtml(htmlId)}-timeout">Timeout, ms</label>
        <input id="${escapeHtml(htmlId)}-timeout" name="timeoutMs" type="number" min="1" value="${escapeHtml(scheduledReportValue(safeReport.timeoutMs, 120000))}" required>
      </div>
    </div>
    <div class="field">
      <label for="${escapeHtml(htmlId)}-description">Описание</label>
      <textarea id="${escapeHtml(htmlId)}-description" name="description">${escapeHtml(scheduledReportValue(safeReport.description))}</textarea>
    </div>
    <div class="field">
      <label for="${escapeHtml(htmlId)}-sql">SQL</label>
      <textarea id="${escapeHtml(htmlId)}-sql" name="sql" rows="8" required>${escapeHtml(scheduledReportValue(safeReport.sql))}</textarea>
    </div>
    <label class="checkbox-label"><input name="enabled" type="checkbox" value="1"${renderCheckedAttribute(enabled)}> Включен</label>
    ${isUpdate && preview ? `<div class="section">${renderScheduledReportPreview(preview)}</div>` : ''}
    <div class="form-actions">
      <button type="submit">${isUpdate ? 'Сохранить отчет' : 'Создать отчет'}</button>
      ${isUpdate ? `<button class="secondary-button" type="submit" formaction="${escapeHtml(previewAction)}" formmethod="post">Проверить SQL</button>` : ''}
    </div>
  </form>`;
}

function renderScheduledAuthorControls({ selectedReport, csrfToken, preview }) {
  const updateForm = selectedReport
    ? renderScheduledReportForm({ report: selectedReport, csrfToken, mode: 'update', preview })
    : '<p class="technical-note">Выберите отчет в списке, чтобы отредактировать SQL и лимиты.</p>';

  return `<section class="section">
  ${renderScheduledReportForm({ csrfToken, mode: 'create' })}
  ${updateForm}
</section>`;
}

function renderScheduledScheduleForm({ reportId, schedule = {}, csrfToken = '', mode = 'create' }) {
  const safeSchedule = schedule || {};
  const isUpdate = mode === 'update';
  const scheduleId = scheduledReportValue(safeSchedule.id);

  if (String(reportId ?? '') === '' || (isUpdate && String(scheduleId) === '')) {
    return '';
  }

  const reportSegment = scheduledRouteSegment(reportId);
  const scheduleSegment = scheduledRouteSegment(scheduleId);
  const htmlId = isUpdate
    ? `scheduled-report-${reportSegment}-schedule-${scheduleSegment}`
    : `scheduled-report-${reportSegment}-schedule-new`;
  const action = isUpdate
    ? `/reports/scheduled/${reportSegment}/schedules/${scheduleSegment}/update`
    : `/reports/scheduled/${reportSegment}/schedules/create`;
  const title = isUpdate ? `Расписание ${scheduleId}` : 'Новое расписание';
  const enabled = isUpdate ? safeSchedule.enabled : true;

  return `<form class="form-panel" action="${escapeHtml(action)}" method="post">
    ${renderHiddenCsrf(csrfToken)}
    <h2>${escapeHtml(title)}</h2>
    <label class="checkbox-label"><input name="enabled" type="checkbox" value="1"${renderCheckedAttribute(enabled)}> Включено</label>
    <div class="form-grid">
      <div class="field">
        <label for="${escapeHtml(htmlId)}-time">Время</label>
        <input id="${escapeHtml(htmlId)}-time" name="scheduleTime" type="time" value="${escapeHtml(scheduledReportValue(safeSchedule.scheduleTime, '09:00'))}" required>
      </div>
      <div class="field">
        <label for="${escapeHtml(htmlId)}-timezone">Timezone</label>
        <input name="timezone" type="hidden" value="Europe/Moscow">
        <input id="${escapeHtml(htmlId)}-timezone" value="Europe/Moscow" readonly>
      </div>
      <div class="field">
        <label for="${escapeHtml(htmlId)}-subject">Тема письма</label>
        <input id="${escapeHtml(htmlId)}-subject" name="emailSubject" value="${escapeHtml(scheduledReportValue(safeSchedule.emailSubject))}">
      </div>
    </div>
    <div class="field">
      <label for="${escapeHtml(htmlId)}-recipients">Получатели</label>
      <textarea id="${escapeHtml(htmlId)}-recipients" name="recipients" required>${escapeHtml(scheduleRecipientsText(safeSchedule.recipients))}</textarea>
    </div>
    <div class="field">
      <label for="${escapeHtml(htmlId)}-body">Текст письма</label>
      <textarea id="${escapeHtml(htmlId)}-body" name="emailBody">${escapeHtml(scheduledReportValue(safeSchedule.emailBody))}</textarea>
    </div>
    <div class="form-actions">
      <button type="submit">${isUpdate ? 'Сохранить расписание' : 'Создать расписание'}</button>
    </div>
  </form>`;
}

function renderScheduledManualRunForm({ reportId, scheduleId, csrfToken = '' }) {
  if (String(reportId ?? '') === '' || String(scheduleId ?? '') === '') {
    return '';
  }

  return `<form class="filter-bar" action="/reports/scheduled/${escapeHtml(scheduledRouteSegment(reportId))}/schedules/${escapeHtml(scheduledRouteSegment(scheduleId))}/run" method="post">
    ${renderHiddenCsrf(csrfToken)}
    <button type="submit">Запустить сейчас</button>
  </form>`;
}

function renderScheduledRunRow(run) {
  const safeRun = run || {};
  const runId = scheduledReportValue(safeRun.id ?? safeRun.runId);
  const rowCount = safeRun.rowCount ?? safeRun.rowsRead ?? safeRun.rowsWritten ?? 0;
  const recipients = scheduleRecipientsDisplay(safeRun.recipients);
  const error = safeRun.error ?? safeRun.errorMessage ?? '';
  const download = safeRun.canDownload === true && String(runId) !== ''
    ? `<a href="/reports/scheduled/runs/${escapeHtml(scheduledRouteSegment(runId))}/download">Скачать</a>`
    : '';

  return `<tr>
    <td>${escapeHtml(safeRun.status || '')}</td>
    <td>${escapeHtml(safeRun.trigger || '')}</td>
    <td>${escapeHtml(rowCount)}</td>
    <td>${escapeHtml(formatScheduledReportFileSize(safeRun.fileSizeBytes))}${download ? `<br>${download}` : ''}</td>
    <td>${escapeHtml(safeRun.startedAt || '')}</td>
    <td>${escapeHtml(safeRun.finishedAt || '')}</td>
    <td>${escapeHtml(recipients)}</td>
    <td>${escapeHtml(error)}</td>
  </tr>`;
}

function renderScheduledRunHistory(runs = []) {
  const rows = safeRows(runs);
  const body = rows.map(renderScheduledRunRow).join('');

  return `<section class="section">
  <h2>История отправок</h2>
  <div class="table-scroll"><table>
    <thead><tr><th>Статус</th><th>Триггер</th><th>Строк</th><th>Файл</th><th>Старт</th><th>Финиш</th><th>Получатели</th><th>Ошибка</th></tr></thead>
    <tbody>${body || '<tr><td colspan="8">Запусков пока нет.</td></tr>'}</tbody>
  </table></div>
</section>`;
}

function renderScheduledDeliveryControls({ selectedReport, schedules = [], runs = [], csrfToken }) {
  if (!selectedReport || selectedReport.id === undefined || selectedReport.id === null) {
    return `<section class="section"><p class="technical-note">Выберите отчет, чтобы настроить расписание и посмотреть историю отправок.</p></section>
${renderScheduledRunHistory(runs)}`;
  }

  const reportId = selectedReport.id;
  const scheduleForms = safeRows(schedules)
    .map((schedule) => {
      const safeSchedule = schedule || {};

      return `<article class="section">
      ${renderScheduledScheduleForm({ reportId, schedule: safeSchedule, csrfToken, mode: 'update' })}
      ${renderScheduledManualRunForm({ reportId, scheduleId: safeSchedule.id, csrfToken })}
    </article>`;
    })
    .join('');

  return `<section class="section">
  ${renderScheduledScheduleForm({ reportId, csrfToken, mode: 'create' })}
</section>
${scheduleForms || '<section class="section"><p class="empty">Расписаний пока нет.</p></section>'}
${renderScheduledRunHistory(runs)}`;
}

function renderScheduledReportsPage({
  database,
  currentUser,
  csrfToken = '',
  reports = [],
  selectedReport = null,
  schedules = [],
  runs = [],
  canAuthor = false,
  canDeliver = false,
  message = '',
  error = '',
  preview
} = {}) {
  const hasCapability = canAuthor || canDeliver;
  const content = `<section class="section">
  <h1>Регулярные отчеты</h1>
  <p class="technical-note">SQL-отчеты для регулярной email-рассылки с Excel-вложениями.</p>
</section>
${renderScheduledPageMessages(message, error)}
${!hasCapability ? `<section class="section"><p class="empty">Нет доступов для управления регулярными отчетами.</p></section>` : `<section class="section">
  <h2>Отчеты</h2>
  ${renderScheduledReportList(reports, selectedReport)}
</section>
${canAuthor ? renderScheduledAuthorControls({ selectedReport, csrfToken, preview }) : ''}
${canDeliver ? renderScheduledDeliveryControls({ selectedReport, schedules, runs, csrfToken }) : ''}`}`;

  return layout({
    title: 'Регулярные отчеты',
    database,
    content,
    activeNav: 'scheduled-reports',
    currentUser,
    csrfToken
  });
}

function renderSecureModeOptions(selectedMode) {
  const safeMode = ['starttls', 'ssl'].includes(String(selectedMode || ''))
    ? String(selectedMode)
    : 'starttls';

  return [
    ['starttls', 'STARTTLS'],
    ['ssl', 'SSL']
  ]
    .map(([value, label]) => `<option value="${value}"${value === safeMode ? ' selected' : ''}>${label}</option>`)
    .join('');
}

function renderMailSettingsPage({
  database,
  settings = {},
  testRecipient = '',
  message = '',
  error = '',
  csrfToken = '',
  currentUser
} = {}) {
  const safeSettings = settings || {};
  const messageHtml = renderScheduledPageMessages(message, error);
  const hasPasswordText = safeSettings.hasPassword ? 'Пароль сохранен' : 'Пароль не сохранен';
  const content = `<section class="section">
  <h1>SMTP</h1>
  <p class="technical-note">Настройки отправки писем для регулярных отчетов.</p>
</section>
${messageHtml}
<section class="section">
  <form class="form-panel" action="/admin/mail-settings" method="post">
    ${renderHiddenCsrf(csrfToken)}
    <h2>Настройки сервера</h2>
    <div class="form-grid">
      <div class="field">
        <label for="smtp-host">Host</label>
        <input id="smtp-host" name="host" value="${escapeHtml(scheduledReportValue(safeSettings.host))}" required>
      </div>
      <div class="field">
        <label for="smtp-port">Port</label>
        <input id="smtp-port" name="port" type="number" min="1" max="65535" value="${escapeHtml(scheduledReportValue(safeSettings.port, 587))}" required>
      </div>
      <div class="field">
        <label for="smtp-secure-mode">Secure mode</label>
        <select id="smtp-secure-mode" name="secureMode">${renderSecureModeOptions(safeSettings.secureMode)}</select>
      </div>
      <div class="field">
        <label for="smtp-username">Username</label>
        <input id="smtp-username" name="username" autocomplete="off" value="${escapeHtml(scheduledReportValue(safeSettings.username))}">
      </div>
      <div class="field">
        <label for="smtp-password">Password</label>
        <input id="smtp-password" name="password" type="password" autocomplete="new-password" placeholder="${safeSettings.hasPassword ? 'Оставить без изменений' : ''}">
      </div>
      <div class="field">
        <label for="smtp-from-email">From email</label>
        <input id="smtp-from-email" name="fromEmail" type="email" value="${escapeHtml(scheduledReportValue(safeSettings.fromEmail))}">
      </div>
      <div class="field">
        <label for="smtp-from-name">From name</label>
        <input id="smtp-from-name" name="fromName" value="${escapeHtml(scheduledReportValue(safeSettings.fromName))}">
      </div>
    </div>
    <p class="technical-note">${escapeHtml(hasPasswordText)}</p>
    <label class="checkbox-label"><input name="clearPassword" type="checkbox" value="1"> Очистить сохраненный пароль</label>
    <div class="form-actions">
      <button type="submit">Сохранить SMTP</button>
    </div>
  </form>
</section>
<section class="section">
  <form class="form-panel" action="/admin/mail-settings/test" method="post">
    ${renderHiddenCsrf(csrfToken)}
    <h2>Тестовая отправка</h2>
    <div class="field">
      <label for="smtp-test-recipient">Получатель</label>
      <input id="smtp-test-recipient" name="testRecipient" type="email" value="${escapeHtml(testRecipient)}" required>
    </div>
    <div class="form-actions">
      <button type="submit">Отправить тест</button>
    </div>
  </form>
</section>`;

  return layout({
    title: 'SMTP',
    database,
    content,
    activeNav: 'mail-settings',
    currentUser,
    csrfToken
  });
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

function normalizePreloadJobPanels({
  jobs,
  job,
  overview,
  diagnostics,
  runs = []
}) {
  if (Array.isArray(jobs) && jobs.length > 0) {
    return jobs.map((panel) => ({
      job: panel && panel.job ? panel.job : {},
      overview: panel && panel.overview ? panel.overview : {},
      diagnostics: panel && Object.prototype.hasOwnProperty.call(panel, 'diagnostics')
        ? panel.diagnostics
        : diagnostics,
      runs: Array.isArray(panel && panel.runs) ? panel.runs : []
    }));
  }

  return [{
    job: job || {},
    overview: overview || {},
    diagnostics,
    runs: Array.isArray(runs) ? runs : []
  }];
}

function safeHtmlId(value) {
  return String(value || 'preload').replace(/[^a-zA-Z0-9_-]/g, '-');
}

function renderPreloadDiagnostics(diagnostics, jobId) {
  const diagnosticsByJob = {
    'sales-by-project': {
      source: diagnostics && diagnostics.salesByProject ? diagnostics.salesByProject : diagnostics,
      cards: [
        ['Coverage days', 'coverage.days'],
        ['Daily rows', 'tables.dailyRows'],
        ['Order facts', 'tables.orderFacts'],
        ['Shift facts', 'tables.shiftFacts']
      ]
    },
    'workplace-point': {
      source: diagnostics && diagnostics.workplacePoint ? diagnostics.workplacePoint : null,
      cards: [
        ['Coverage days', 'coverage.days'],
        ['Order facts', 'tables.orderFacts'],
        ['Shift facts', 'tables.shiftFacts'],
        ['Radius rollups', 'tables.radiusRollups']
      ]
    },
    'worker-cancellations': {
      source: diagnostics && diagnostics.workerCancellations ? diagnostics.workerCancellations : diagnostics,
      cards: [
        ['Coverage days', 'coverage.days'],
        ['Shift facts', 'tables.shiftFacts']
      ]
    }
  };
  const config = diagnosticsByJob[jobId];
  const selectedDiagnostics = config && config.source ? config.source : null;

  if (!config || !selectedDiagnostics) {
    return '';
  }

  const valueByPath = (source, path) => path
    .split('.')
    .reduce((value, key) => (value && Object.prototype.hasOwnProperty.call(value, key) ? value[key] : 0), source);
  const cardsHtml = config.cards.map(([label, path]) => (
    `<div class="kpi-card"><div class="kpi-label">${escapeHtml(label)}</div><div class="kpi-value">${escapeHtml(valueByPath(selectedDiagnostics, path) || 0)}</div></div>`
  )).join('');

  return `<div class="preload-diagnostics">
  <h3>Состояние SQLite-витрины</h3>
  <div class="kpi-grid">
    ${cardsHtml}
  </div>
</div>`;
}

function preloadScheduleWindowMinimum(jobId) {
  if (jobId === 'worker-cancellations') return 60;
  return jobId === 'workplace-point' ? 30 : 45;
}

function preloadScheduleFutureWindowMinimum(jobId) {
  return jobId === 'worker-cancellations' ? 0 : preloadScheduleWindowMinimum(jobId);
}

function preloadScheduleWindowValue(value, fallback = 45, minimum = 45) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return value;
  }

  return Math.max(minimum, numericValue);
}

function renderPreloadJobPanel(panel, csrfToken) {
  const safeJob = panel.job || {};
  const safeOverview = panel.overview || {};
  const jobId = safeJob.id || 'sales-by-project';
  const title = safeJob.title || jobId;
  const htmlId = safeHtmlId(jobId);
  const rows = Array.isArray(panel.runs) ? panel.runs : [];
  const rowsHtml = rows.map(renderPreloadRunRow).join('');
  const scheduleWindowMinimum = preloadScheduleWindowMinimum(jobId);
  const scheduleFutureWindowMinimum = preloadScheduleFutureWindowMinimum(jobId);
  const refreshPastDays = preloadScheduleWindowValue(
    safeJob.refreshPastDays ?? safeJob.refreshDays,
    scheduleWindowMinimum,
    scheduleWindowMinimum
  );
  const refreshFutureDays = preloadScheduleWindowValue(
    safeJob.refreshFutureDays,
    scheduleFutureWindowMinimum,
    scheduleFutureWindowMinimum
  );
  const diagnosticsHtml = renderPreloadDiagnostics(panel.diagnostics, jobId);

  const panelHtml = `<section class="section">
  <h2>${escapeHtml(title)}</h2>
  <div class="kpi-grid">
    <div class="kpi-card"><div class="kpi-label">Витрина</div><div class="kpi-value">${escapeHtml(jobId)}</div></div>
    <div class="kpi-card"><div class="kpi-label">Покрытие</div><div class="kpi-value">${escapeHtml(safeOverview.coveredFrom || '-')} - ${escapeHtml(safeOverview.coveredTo || '-')}</div></div>
    <div class="kpi-card"><div class="kpi-label">Последний успех</div><div class="kpi-value">${escapeHtml(safeOverview.lastSuccessAt || '-')}</div></div>
    <div class="kpi-card"><div class="kpi-label">Последняя ошибка</div><div class="kpi-value">${escapeHtml(safeOverview.lastError || '-')}</div></div>
  </div>
</section>
<section class="section">
  <h2>Ручной запуск: ${escapeHtml(title)}</h2>
  ${diagnosticsHtml}
  <form class="filter-bar" action="/admin/preload/run" method="post">
    ${renderHiddenCsrf(csrfToken)}
    <input type="hidden" name="jobId" value="${escapeHtml(jobId)}">
    <div class="field"><label for="${escapeHtml(htmlId)}-preload-from">С</label><input id="${escapeHtml(htmlId)}-preload-from" name="from" type="date" required></div>
    <div class="field"><label for="${escapeHtml(htmlId)}-preload-to">По</label><input id="${escapeHtml(htmlId)}-preload-to" name="to" type="date" required></div>
    <button type="submit">Запустить</button>
  </form>
</section>
<section class="section">
  <h2>Расписание: ${escapeHtml(title)}</h2>
  <form class="filter-bar" action="/admin/preload/schedule" method="post">
    ${renderHiddenCsrf(csrfToken)}
    <input type="hidden" name="jobId" value="${escapeHtml(jobId)}">
    <label class="checkbox-label"><input name="enabled" type="checkbox" value="1"${renderCheckedAttribute(safeJob.enabled)}> Включено</label>
    <div class="field"><label for="${escapeHtml(htmlId)}-schedule-time">Время</label><input id="${escapeHtml(htmlId)}-schedule-time" name="scheduleTime" type="time" value="${escapeHtml(safeJob.scheduleTime || '03:00')}" required></div>
    <div class="field"><label for="${escapeHtml(htmlId)}-refresh-past-days">Назад, дней</label><input id="${escapeHtml(htmlId)}-refresh-past-days" name="refreshPastDays" type="number" min="45" max="366" value="${escapeHtml(refreshPastDays)}" required></div>
    <div class="field"><label for="${escapeHtml(htmlId)}-refresh-future-days">Вперед, дней</label><input id="${escapeHtml(htmlId)}-refresh-future-days" name="refreshFutureDays" type="number" min="45" max="366" value="${escapeHtml(refreshFutureDays)}" required></div>
    <button type="submit">Сохранить</button>
  </form>
</section>
<section class="section">
  <h2>История запусков: ${escapeHtml(title)}</h2>
  <div class="table-scroll"><table><thead><tr><th>ID</th><th>Тип</th><th>Статус</th><th>Период</th><th>Старт</th><th>Финиш</th><th>Строк</th><th>Ошибка</th></tr></thead><tbody>${rowsHtml || '<tr><td colspan="8">Запусков пока нет.</td></tr>'}</tbody></table></div>
</section>`;

  if (scheduleWindowMinimum === 45) {
    return panelHtml;
  }

  return panelHtml
    .replace('id="' + escapeHtml(htmlId) + '-refresh-past-days" name="refreshPastDays" type="number" min="45"', `id="${escapeHtml(htmlId)}-refresh-past-days" name="refreshPastDays" type="number" min="${escapeHtml(scheduleWindowMinimum)}"`)
    .replace('id="' + escapeHtml(htmlId) + '-refresh-future-days" name="refreshFutureDays" type="number" min="45"', `id="${escapeHtml(htmlId)}-refresh-future-days" name="refreshFutureDays" type="number" min="${escapeHtml(scheduleFutureWindowMinimum)}"`);
}

function renderPreloadManagement({
  database,
  currentUser,
  csrfToken = '',
  jobs,
  job,
  overview,
  diagnostics,
  runs = [],
  message = '',
  error = ''
}) {
  const messageHtml = message ? `<div class="success">${escapeHtml(message)}</div>` : '';
  const errorHtml = error ? `<div class="inline-error">${escapeHtml(error)}</div>` : '';
  const panels = normalizePreloadJobPanels({
    jobs,
    job,
    overview,
    diagnostics,
    runs
  });
  const jobPanelsHtml = panels.map((panel) => renderPreloadJobPanel(panel, csrfToken)).join('');
  const content = `<section class="section">
  <h1>Предзагрузка витрин</h1>
  <p class="technical-note">Управление локальными предрасчитанными данными для дашбордов. Ручной запуск обновляет выбранный период, расписание поддерживает отдельные окна назад и вперед.</p>
</section>
${messageHtml || errorHtml ? `<section class="section">${messageHtml}${errorHtml}</section>` : ''}
${jobPanelsHtml}
<section class="section">
  <h2>Кеши дашбордов</h2>
  <p class="technical-note">Удаляет файловый и in-memory кеш дашборда Анализ городов. SQLite-витрины, пользователи и журнал активности не затрагиваются.</p>
  <form class="filter-bar" action="/admin/preload/cache/city-analysis/clear" method="post">
    ${renderHiddenCsrf(csrfToken)}
    <button class="danger-button" type="submit">Удалить кеш анализа городов</button>
  </form>
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

const AVAILABILITY_LABELS = {
  online: 'онлайн',
  unavailable: 'недоступен'
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

function operatorStatusLabel(status) {
  const text = String(status || 'unavailable');

  return AVAILABILITY_LABELS[text] || text;
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
    <div class="activity-statuses">
      <span class="activity-pill" data-availability="${escapeHtml(safeUser.operatorStatus || 'unavailable')}">${escapeHtml(operatorStatusLabel(safeUser.operatorStatus))}</span>
      <span class="activity-pill">${escapeHtml(activityStatusLabel(safeUser.status))}</span>
    </div>
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
    : `<section class="section" data-activity-dashboard>
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

function requestReportReviewStatusRowClass(status) {
  const safeStatus = String(status || '');

  if (safeStatus === 'verified') {
    return 'request-report-row request-report-row-verified';
  }

  if (safeStatus === 'return-later') {
    return 'request-report-row request-report-row-return-later';
  }

  return 'request-report-row';
}

function requestReportActExistsValue(row) {
  return row && row.isActExists ? 'yes' : 'no';
}

function renderRequestReportActBadge(row) {
  const value = requestReportActExistsValue(row);
  const label = String((row && row.actExistsLabel) || (value === 'yes' ? 'Есть' : 'Нет'));
  const mark = value === 'yes' ? '✓' : '—';
  const className = value === 'yes'
    ? 'request-report-act-badge request-report-act-badge-yes'
    : 'request-report-act-badge';

  return `<span class="${className}">${mark} ${escapeHtml(label)}</span>`;
}

function renderRequestReportMissingConfirmedRows(rows, csrfToken = '') {
  const safeRows = Array.isArray(rows) ? rows : [];

  if (safeRows.length === 0) {
    return '<p class="empty">Строк без confirmed-смен не найдено.</p>';
  }

  const statusFilterOptions = REQUEST_REPORT_SHIFT_STATUS_OPTIONS
    .map((option) => `<option value="${escapeHtml(option.id)}">${escapeHtml(option.label)}</option>`)
    .join('');
  const statusControlOptions = (selectedStatus) => [
    '<option value="">Без статуса</option>',
    ...REQUEST_REPORT_SHIFT_STATUS_OPTIONS.map((option) => {
      const selected = option.id === selectedStatus ? ' selected' : '';

      return `<option value="${escapeHtml(option.id)}"${selected}>${escapeHtml(option.label)}</option>`;
    })
  ].join('');
  const bodyRows = safeRows
    .map((row) => {
      const durationText = String(row.actualDuration ?? '');
      const durationCategory = requestReportDurationCategory(durationText);
      const reviewStatus = String(row.reviewStatus || '');
      const reviewStatusKey = String(row.reviewStatusKey || '');
      const actExistsValue = requestReportActExistsValue(row);
      const rowClass = requestReportReviewStatusRowClass(reviewStatus);
      const statusDisabled = reviewStatusKey ? '' : ' disabled';
      const actualDuration = row.crmUrl
        ? `<a href="${escapeHtml(row.crmUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(durationText)}</a>`
        : escapeHtml(durationText);

      return `<tr class="${escapeHtml(rowClass)}" data-request-duration-category="${escapeHtml(durationCategory)}" data-request-review-status="${escapeHtml(reviewStatus)}" data-request-act-exists="${escapeHtml(actExistsValue)}">
  <td>${escapeHtml(row.organization || '')}</td>
  <td>${escapeHtml(row.workplace || '')}</td>
  <td>${escapeHtml(row.address || '')}</td>
  <td>${escapeHtml(row.employee || '')}</td>
  <td>${escapeHtml(row.startText || '')}</td>
  <td>${actualDuration}</td>
  <td class="request-report-act-cell">${renderRequestReportActBadge(row)}</td>
  <td class="request-report-status-cell"><select class="request-report-status-select" data-request-report-status-control data-request-report-status-key="${escapeHtml(reviewStatusKey)}" data-saved-status="${escapeHtml(reviewStatus)}"${statusDisabled}>${statusControlOptions(reviewStatus)}</select></td>
</tr>`;
    })
    .join('');

  return `<div data-request-report-result data-request-status-url="/tools/request-report-confirmed-check/status" data-csrf-token="${escapeHtml(csrfToken || '')}">
  <div class="filter-bar request-report-filter">
    <div class="field filter-field">
      <label for="requestDurationFilter">Фактическая продолжительность</label>
      <select id="requestDurationFilter" data-request-duration-filter>
        <option value="">Все</option>
        <option value="non-zero">Есть не 0</option>
        <option value="zero">Есть 0</option>
        <option value="empty">Нет значения</option>
        <option value="absence">Есть неявка</option>
      </select>
    </div>
    <div class="field filter-field">
      <label for="requestActExistsFilter">Лист учета</label>
      <select id="requestActExistsFilter" data-request-act-filter>
        <option value="">Все</option>
        <option value="yes">Есть</option>
        <option value="no">Нет</option>
      </select>
    </div>
    <div class="field filter-field">
      <label for="requestReviewStatusFilter">Статус проверки</label>
      <select id="requestReviewStatusFilter" data-request-status-filter>
        <option value="">Все</option>
        ${statusFilterOptions}
      </select>
    </div>
    <p class="technical-note request-report-filter-status" data-request-duration-filter-status>Показано ${escapeHtml(formatNumber(safeRows.length))} из ${escapeHtml(formatNumber(safeRows.length))}</p>
  </div>
  <p class="empty" data-request-duration-filter-empty hidden>Нет строк для выбранного фильтра.</p>
  <div class="table-wrap"><table>
  <thead><tr><th>Организация</th><th>Рабочая точка</th><th>Адрес</th><th>Сотрудник</th><th>Время с</th><th>Фактическая продолжительность за вычетом перерыва</th><th>Лист учета</th><th>Статус проверки</th></tr></thead>
  <tbody>${bodyRows}</tbody>
</table></div>
</div>`;
}

function requestReportDurationCategory(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();

  if (/неяв/i.test(text)) {
    return 'absence';
  }

  if (text === '') {
    return 'empty';
  }

  const number = Number(text.replace(',', '.'));

  return Number.isFinite(number) && number === 0 ? 'zero' : 'non-zero';
}

function renderRequestReportSummary(summary) {
  const safeSummary = summary || {};

  return `<div class="kpi-grid">
  <div class="kpi-card"><div class="kpi-label">Строк в файле</div><div class="kpi-value">${escapeHtml(formatNumber(safeSummary.totalRows || 0))}</div></div>
  <div class="kpi-card"><div class="kpi-label">С ID ЛКК</div><div class="kpi-value">${escapeHtml(formatNumber(safeSummary.rowsWithId || 0))}</div></div>
  <div class="kpi-card"><div class="kpi-label">Найдены confirmed</div><div class="kpi-value">${escapeHtml(formatNumber(safeSummary.confirmedRows || 0))}</div></div>
  <div class="kpi-card"><div class="kpi-label">Нет confirmed</div><div class="kpi-value">${escapeHtml(formatNumber(safeSummary.missingConfirmedRows || 0))}</div></div>
</div>`;
}

function renderRequestReportWarnings(warnings) {
  const safeWarnings = Array.isArray(warnings) ? warnings.filter(Boolean) : [];

  if (safeWarnings.length === 0) {
    return '';
  }

  return `<p class="technical-note">Предупреждения: ${safeWarnings.map(escapeHtml).join('; ')}</p>`;
}

function renderRequestReportMissingConfirmedResult({ filename = '', result = null, csrfToken = '' } = {}) {
  if (!result) {
    return '';
  }

  return `<section class="section" data-request-report-result-fragment>
  <h2>Результат${filename ? `: ${escapeHtml(filename)}` : ''}</h2>
  ${renderRequestReportSummary(result.summary)}
  ${renderRequestReportWarnings(result.warnings)}
  ${renderRequestReportMissingConfirmedRows(result.rows, csrfToken)}
</section>`;
}

function renderRequestReportMissingConfirmedPage({
  database,
  currentUser,
  csrfToken = '',
  filename = '',
  result = null,
  error = ''
}) {
  const errorHtml = error ? `<div class="inline-error">${escapeHtml(error)}</div>` : '';
  const resultHtml = renderRequestReportMissingConfirmedResult({ filename, result, csrfToken });
  const content = `<section class="section">
  <h1>Смены без confirmed</h1>
  ${errorHtml}
  <form class="filter-bar" action="/tools/request-report-confirmed-check" method="post" enctype="multipart/form-data" data-request-report-check-form data-request-report-jobs-url="/tools/request-report-confirmed-check/jobs">
    ${renderHiddenCsrf(csrfToken)}
    <div class="field">
      <label for="reportFile">Файл отчета</label>
      <input id="reportFile" name="reportFile" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required>
    </div>
    <button type="submit" name="action" value="check">Проверить</button>
    <button type="submit" name="action" value="export">Проверить и скачать Excel</button>
  </form>
  <div class="request-report-progress-panel" data-request-report-progress hidden data-request-report-progress-mode="indeterminate" aria-live="polite">
    <div class="request-report-progress-head">
      <strong data-request-report-progress-stage>Ожидание запуска</strong>
      <span class="request-report-progress-percent" data-request-report-progress-percent>0%</span>
    </div>
    <div class="request-report-progress-track">
      <div class="request-report-progress-bar" data-request-report-progress-bar></div>
    </div>
    <div class="request-report-progress-meta">
      <span data-request-report-progress-detail>Файл еще не отправлен.</span>
      <span data-request-report-progress-eta>Осталось --</span>
    </div>
    <div class="request-report-progress-counters" data-request-report-progress-counters>Строк: 0 · Проверено: 0 · Без confirmed: 0</div>
    <div class="inline-error request-report-progress-error" data-request-report-progress-error hidden></div>
  </div>
</section>
<div data-request-report-result-target>${resultHtml}</div>`;

  return layout({
    title: 'Смены без confirmed',
    database,
    content,
    activeNav: 'request-report-matching',
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

function renderKpiCards(summary, currentUser, trendRows = []) {
  const cards = [
    {
      label: 'Заказано смен',
      value: formatNumber(summary.orderedShifts),
      detailHtml: renderMiniTrend(trendRows, 'orderedShifts', 'заказанных смен'),
      attributes: 'data-mini-trend-target="orderedShifts" data-mini-trend-label="заказанных смен"'
    },
    {
      label: 'Отработано смен',
      value: formatNumber(summary.workedShifts),
      detailHtml: renderMiniTrend(trendRows, 'workedShifts', 'выполненных смен'),
      attributes: 'data-mini-trend-target="workedShifts" data-mini-trend-label="выполненных смен"'
    },
    { label: 'SLA', value: formatPercent(summary.slaPercent) },
    { label: 'Выручка, руб.', value: formatNumber(summary.revenueRub) },
    { label: 'Уникальные исполнители', value: formatNumber(summary.uniqueWorkers) },
    { label: 'ТТ с заказами', value: formatNumber(summary.workplacesWithOrders) },
    { label: 'ТТ с выполненными сменами', value: formatNumber(summary.workplacesWithWorkedShifts) },
    { label: 'Отмены', value: formatNumber(summary.cancelledShifts) },
    { label: 'Самоброни', value: formatPercent(summary.selfBookingPercent) },
    { label: 'Средняя ставка в час', value: formatNumber(summary.avgWorkerRateHour) }
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
    cards.map((card, index) => ({
      label: card.label,
      value: card.value,
      detailHtml: card.detailHtml,
      attributes: card.attributes || '',
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

function trendRowNumber(row, valueKey) {
  const rawValue = row && typeof row === 'object' ? row[valueKey] : 0;
  const number = Number(rawValue);

  return Number.isFinite(number) ? number : 0;
}

function trendRowValue(row, valueKey) {
  return row && typeof row === 'object' ? row[valueKey] : '';
}

function renderMiniTrend(rows, valueKey, label) {
  const values = safeRows(rows).map((row) => trendRowNumber(row, valueKey));

  if (values.length < 2) {
    return '';
  }

  const width = 140;
  const height = 36;
  const paddingX = 2;
  const paddingY = 3;
  const chartWidth = width - paddingX * 2;
  const chartHeight = height - paddingY * 2;
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue;
  const formatPoint = (number) => number.toFixed(2).replace(/\.?0+$/, '');
  const points = values
    .map((value, index) => {
      const x = paddingX + (chartWidth * index) / (values.length - 1);
      const y = range === 0
        ? height / 2
        : paddingY + ((maxValue - value) / range) * chartHeight;

      return `${formatPoint(x)},${formatPoint(y)}`;
    })
    .join(' ');

  return `<svg class="mini-trend" viewBox="0 0 ${escapeHtml(width)} ${escapeHtml(height)}" role="img" aria-label="Динамика ${escapeHtml(label)}">
  <polyline points="${escapeHtml(points)}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></polyline>
</svg>`;
}

function renderTrendRows(rows, currentUser) {
  const trendRows = safeRows(rows);

  if (trendRows.length === 0) {
    return renderEmptyDashboardTable();
  }

  const maxWorked = Math.max(...trendRows.map((row) => trendRowNumber(row, 'workedShifts')), 0);
  const bodyRows = trendRows
    .map((row) => {
      const workedShifts = trendRowNumber(row, 'workedShifts');
      const width = maxWorked > 0 ? clampPercent((workedShifts / maxWorked) * 100) : 0;

      return `<tr data-sales-trend-row data-ordered-shifts="${escapeHtml(trendRowNumber(row, 'orderedShifts'))}" data-worked-shifts="${escapeHtml(workedShifts)}">
  <td>${escapeHtml(trendRowValue(row, 'period'))}</td>
  ${numberCell(trendRowNumber(row, 'orderedShifts'), 0, 'sales-by-project.trend.ordered-shifts', currentUser)}
  ${numberCell(workedShifts, 0, 'sales-by-project.trend.worked-shifts', currentUser)}
  ${percentCell(trendRowNumber(row, 'slaPercent'), 'sales-by-project.trend.sla', currentUser)}
  ${numberCell(trendRowNumber(row, 'revenueRub'), 0, 'sales-by-project.trend.revenue-rub', currentUser)}
  ${numberCell(trendRowNumber(row, 'cancelledShifts'), 0, 'sales-by-project.trend.cancelled-shifts', currentUser)}
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
  ${renderKpiCards(dashboard.summary, currentUser, dashboard.trendRows)}
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

function renderDashboardSectionRefreshing() {
  return `<section class="section"><p class="loading">Данные ETL обновляются. Блок загрузится автоматически после завершения обновления.</p></section>`;
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
  ${renderKpiCards(dashboard.summary, currentUser, dashboard.trendRows)}
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

function underageCompletedShiftValue(row) {
  const value = Number(row && row.completedShifts);

  return Number.isFinite(value) ? value : 0;
}

function renderUnderageCompletedShiftsChart(rows, currentUser) {
  const trendRows = safeRows(rows);

  if (trendRows.length === 0) {
    return renderEmptyDashboardTable();
  }

  const width = Math.max(760, 68 + trendRows.length * 34);
  const height = 270;
  const left = 52;
  const right = 18;
  const top = 20;
  const bottom = 38;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const maxValue = Math.max(...trendRows.map(underageCompletedShiftValue), 1);
  const point = (row, index) => {
    const x = trendRows.length === 1
      ? left + chartWidth / 2
      : left + (chartWidth * index) / (trendRows.length - 1);
    const y = top + ((maxValue - underageCompletedShiftValue(row)) / maxValue) * chartHeight;

    return { x, y };
  };
  const points = trendRows
    .map((row, index) => {
      const current = point(row, index);

      return `${current.x.toFixed(2)},${current.y.toFixed(2)}`;
    })
    .join(' ');
  const gridLines = Array.from({ length: 5 }, (_, index) => {
    const value = Math.round((maxValue * (4 - index)) / 4);
    const y = top + (chartHeight * index) / 4;

    return `<g>
  <line class="underage-shifts-grid-line" x1="${left}" y1="${y.toFixed(2)}" x2="${width - right}" y2="${y.toFixed(2)}"></line>
  <text class="underage-shifts-axis-label" x="${left - 8}" y="${(y + 4).toFixed(2)}" text-anchor="end">${escapeHtml(formatNumber(value, 0))}</text>
</g>`;
  }).join('');
  const markers = trendRows.map((row, index) => {
    const current = point(row, index);
    const week = String(row.week || '');
    const label = week.slice(5);

    return `<g class="underage-shifts-point">
  <title>${escapeHtml(`${week}: ${formatNumber(underageCompletedShiftValue(row), 0)} смен`)}</title>
  <circle cx="${current.x.toFixed(2)}" cy="${current.y.toFixed(2)}" r="3.5"></circle>
  <text class="underage-shifts-axis-label" x="${current.x.toFixed(2)}" y="${height - 14}" text-anchor="middle">${escapeHtml(label)}</text>
</g>`;
  }).join('');

  return renderMetricInfoScope({
    tag: 'div',
    className: 'underage-shifts-chart-scroll',
    metricId: 'underage-completed-shifts.trend.chart',
    currentUser,
    content: `<svg class="underage-shifts-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Недельная динамика завершенных смен исполнителей младше 18 лет">
  ${gridLines}
  <polyline class="underage-shifts-line" points="${escapeHtml(points)}"></polyline>
  ${markers}
</svg>`
  });
}

function renderUnderageCompletedShiftsTable(rows, currentUser) {
  const trendRows = safeRows(rows);

  if (trendRows.length === 0) {
    return renderEmptyDashboardTable();
  }

  const bodyRows = trendRows
    .map((row) => `<tr>
  <td>${escapeHtml(row.week)}</td>
  ${numberCell(underageCompletedShiftValue(row), 0, 'underage-completed-shifts.trend.completed-shifts', currentUser)}
</tr>`)
    .join('');

  return `<div class="table-wrap"><table>
  <thead><tr><th>Неделя с</th><th>Завершенные смены</th></tr></thead>
  <tbody>${bodyRows}</tbody>
</table></div>`;
}

function renderUnderageCompletedShiftsDashboardSection({ dashboard, section, currentUser }) {
  if (section !== 'trend') {
    return `<section class="section"><div class="error">Неизвестный блок дашборда.</div></section>`;
  }

  return `<section class="section">
  ${renderMetricPanelHead('Динамика по неделям', 'underage-completed-shifts.trend', currentUser)}
  ${renderUnderageCompletedShiftsChart(dashboard.trendRows, currentUser)}
  ${renderUnderageCompletedShiftsTable(dashboard.trendRows, currentUser)}
</section>`;
}

function renderUnderageCompletedShiftsDashboard({
  database,
  dashboard,
  progressive = false,
  currentUser,
  csrfToken
}) {
  const sectionUrl = '/dashboards/underage-completed-shifts/section?section=trend';
  const content = progressive
    ? `<section class="section">
  <h1>Завершенные смены исполнителей младше 18 лет</h1>
  <p class="technical-note">С начала ${escapeHtml(dashboard.filters.from.slice(0, 4))} года. Возраст рассчитывается на дату смены; исполнители, которым уже исполнилось 18 лет, исключены.</p>
</section>
<div data-dashboard-fragment-url="${sectionUrl}">
  <section class="section">
    <h2>Динамика по неделям</h2>
    <p class="loading">Загружается</p>
  </section>
</div>`
    : `<section class="section">
  <h1>Завершенные смены исполнителей младше 18 лет</h1>
  <p class="technical-note">С начала ${escapeHtml(dashboard.filters.from.slice(0, 4))} года. Возраст рассчитывается на дату смены; исполнители, которым уже исполнилось 18 лет, исключены.</p>
</section>
${renderUnderageCompletedShiftsDashboardSection({ dashboard, section: 'trend', currentUser })}`;

  return layout({
    title: 'Смены исполнителей младше 18 лет',
    database,
    content,
    activeNav: 'underage-completed-shifts',
    currentUser,
    csrfToken
  });
}

function renderBrandOptions(options, selectedId) {
  const emptySelected = String(selectedId || '') === '' ? ' selected' : '';
  const rows = [
    `<option value=""${emptySelected}>Выберите бренд</option>`,
    ...safeRows(options).map((option) => {
      const id = String(option.id || '');
      const selected = id === String(selectedId || '') ? ' selected' : '';

      return `<option value="${escapeHtml(id)}"${selected}>${escapeHtml(option.title || 'Без бренда')}</option>`;
    })
  ];

  return rows.join('');
}

function brandAnalysisSectionUrl(filters, section) {
  const params = new URLSearchParams();

  params.set('section', section);
  addDashboardQueryParam(params, 'period', filters.period);
  addDashboardQueryParam(params, 'from', filters.from);
  addDashboardQueryParam(params, 'to', filters.to);
  addDashboardQueryParam(params, 'brandId', filters.brandId);
  addDashboardQueryParam(params, 'city', filters.city);
  addDashboardQueryParam(params, 'region', filters.region);

  return `/dashboards/brand-analysis/section?${params.toString()}`;
}

function brandAnalysisReviewsUrl(filters = {}) {
  const params = new URLSearchParams();

  addDashboardQueryParam(params, 'brandId', filters.brandId);
  addDashboardQueryParam(params, 'city', filters.city);
  addDashboardQueryParam(params, 'region', filters.region);
  addDashboardQueryParam(params, 'page', filters.page);

  return `/dashboards/brand-analysis/reviews?${params.toString()}`;
}

function renderBrandAnalysisProgressiveSections(filters) {
  if (String(filters.brandId || '') === '') {
    return `<section class="section">
  <div class="dashboard-empty-state"><p class="empty">Выберите бренд, чтобы загрузить аналитику.</p></div>
</section>`;
  }

  return `<div data-dashboard-fragment-url="${escapeHtml(brandAnalysisSectionUrl(filters, 'summary'))}">
  <section class="section">
    <h2>Основные показатели</h2>
    <div class="kpi-grid">
      ${['Заказано смен', 'Отработано смен', 'SLA', 'Свободный заказ']
        .map((label) => `<div class="kpi-card"><div class="kpi-label">${escapeHtml(label)}</div><div class="kpi-value">Загружается</div></div>`)
        .join('')}
    </div>
  </section>
</div>
${renderDashboardLoadingSection({
  title: 'Динамика',
  url: brandAnalysisSectionUrl(filters, 'trend')
})}
${renderDashboardLoadingSection({
  title: 'Регионы присутствия',
  url: brandAnalysisSectionUrl(filters, 'regions')
})}
${renderDashboardLoadingSection({
  title: 'Точки бренда',
  url: brandAnalysisSectionUrl(filters, 'workplaces')
})}
${renderDashboardLoadingSection({
  title: 'Специальности',
  url: brandAnalysisSectionUrl(filters, 'professions')
})}
${renderDashboardLoadingSection({
  title: 'Статусы работ',
  url: brandAnalysisSectionUrl(filters, 'statuses')
})}`;
}

function renderBrandAnalysisKpiCards(summary, currentUser, filters = {}) {
  return renderKpiGrid([
    { label: 'Заказано смен', value: formatNumber(summary.orderedShifts), metricId: 'brand-analysis.summary.ordered-shifts' },
    { label: 'Отработано смен', value: formatNumber(summary.workedShifts), metricId: 'brand-analysis.summary.worked-shifts' },
    { label: 'Закрыто смен', value: formatNumber(summary.coveredShifts), metricId: 'brand-analysis.summary.covered-shifts' },
    { label: 'Свободный заказ', value: formatNumber(summary.openDemand), metricId: 'brand-analysis.summary.open-demand' },
    { label: 'SLA', value: formatPercent(summary.slaPercent), metricId: 'brand-analysis.summary.sla' },
    { label: 'Покрытие', value: formatPercent(summary.coveragePercent), metricId: 'brand-analysis.summary.coverage' },
    { label: 'Выручка, руб.', value: formatNumber(summary.revenueRub), metricId: 'brand-analysis.summary.revenue-rub' },
    { label: 'Уникальные исполнители', value: formatNumber(summary.uniqueWorkers), metricId: 'brand-analysis.summary.unique-workers' },
    { label: 'ТТ с заказами', value: formatNumber(summary.workplacesWithOrders), metricId: 'brand-analysis.summary.workplaces-with-orders' },
    { label: 'ТТ с выполненными сменами', value: formatNumber(summary.workplacesWithWorkedShifts), metricId: 'brand-analysis.summary.workplaces-with-worked-shifts' },
    { label: 'Отмены', value: formatNumber(summary.cancelledShifts), metricId: 'brand-analysis.summary.cancelled-shifts' },
    { label: 'Самоброни', value: formatPercent(summary.selfBookingPercent), metricId: 'brand-analysis.summary.self-booking-percent' },
    { label: 'Стабильность заказа', value: formatPercent(summary.orderStabilityPercent), metricId: 'brand-analysis.summary.order-stability' },
    { label: 'Ставка гигера/час', value: formatNumber(summary.avgWorkerRateHour), metricId: 'brand-analysis.summary.avg-worker-rate-hour' },
    { label: 'Ставка клиента/час', value: formatNumber(summary.avgCustomerRateHour), metricId: 'brand-analysis.summary.avg-customer-rate-hour' },
    {
      label: '\u0420\u0435\u0439\u0442\u0438\u043d\u0433 \u0431\u0440\u0435\u043d\u0434\u0430',
      value: `${formatPointRating(summary.ratingAll)} / ${formatPointRating(summary.ratingLast10)}`,
      detail: `\u0432\u0441\u0435 / \u043f\u043e\u0441\u043b\u0435\u0434\u043d\u0438\u0435 10 \u00b7 \u043e\u0442\u0437\u044b\u0432\u043e\u0432 ${formatNumber(summary.ratingReviewCount)}`,
      metricId: 'brand-analysis.summary.rating',
      attributes: `role="button" tabindex="0" data-workplace-point-review-trigger data-detail-url="${escapeHtml(brandAnalysisReviewsUrl(filters))}"`
    }
  ], currentUser);
}

function safeJsonScript(value) {
  return JSON.stringify(value)
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function brandTrendChartPayload(rows) {
  return safeRows(rows).map((row) => ({
    period: String(row.period || ''),
    orderedShifts: trendRowNumber(row, 'orderedShifts'),
    workedShifts: trendRowNumber(row, 'workedShifts'),
    coveredShifts: trendRowNumber(row, 'coveredShifts'),
    slaPercent: trendRowNumber(row, 'slaPercent'),
    respondedUserIds: Array.isArray(row.respondedUserIds) ? row.respondedUserIds.map((value) => String(value)) : [],
    workedUserIds: Array.isArray(row.workedUserIds) ? row.workedUserIds.map((value) => String(value)) : []
  }));
}

function renderBrandTrendLegend(items) {
  return `<div class="brand-trend-legend">${items
    .map((item) => `<span><span class="brand-trend-swatch" style="background: ${escapeHtml(item.color)}"></span>${escapeHtml(item.label)}</span>`)
    .join('')}</div>`;
}

function brandTrendNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function brandTrendParseDate(value) {
  const parts = String(value || '').slice(0, 10).split('-').map(Number);
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    return null;
  }
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
}

function brandTrendFormatDate(date) {
  return date.toISOString().slice(0, 10);
}

function brandTrendStartOfWeek(date) {
  const copy = new Date(date.getTime());
  const day = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() - day + 1);
  return copy;
}

function brandTrendBucketFor(period, value) {
  const date = brandTrendParseDate(value);
  if (!date) {
    return String(value || '');
  }
  if (period === 'week') {
    return brandTrendFormatDate(brandTrendStartOfWeek(date));
  }
  if (period === 'month') {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
  }
  if (period === 'quarter') {
    const quarterMonth = Math.floor(date.getUTCMonth() / 3) * 3 + 1;
    return `${date.getUTCFullYear()}-${String(quarterMonth).padStart(2, '0')}-01`;
  }
  return brandTrendFormatDate(date);
}

function aggregateBrandTrendRows(rows, period) {
  const byPeriod = new Map();

  rows.forEach((row) => {
    const key = brandTrendBucketFor(period, row.period);
    if (!byPeriod.has(key)) {
      byPeriod.set(key, {
        period: key,
        orderedShifts: 0,
        workedShifts: 0,
        coveredShifts: 0,
        respondedUserIds: new Set(),
        workedUserIds: new Set()
      });
    }

    const current = byPeriod.get(key);
    current.orderedShifts += brandTrendNumber(row.orderedShifts);
    current.workedShifts += brandTrendNumber(row.workedShifts);
    current.coveredShifts += brandTrendNumber(row.coveredShifts);
    (row.respondedUserIds || []).forEach((id) => {
      if (id) {
        current.respondedUserIds.add(String(id));
      }
    });
    (row.workedUserIds || []).forEach((id) => {
      if (id) {
        current.workedUserIds.add(String(id));
      }
    });
  });

  return Array.from(byPeriod.values())
    .sort((left, right) => left.period.localeCompare(right.period))
    .map((row) => ({
      period: row.period,
      orderedShifts: row.orderedShifts,
      workedShifts: row.workedShifts,
      coveredShifts: row.coveredShifts,
      slaPercent: row.orderedShifts > 0 ? (row.workedShifts / row.orderedShifts) * 100 : 0,
      uniqueRespondedUsers: row.respondedUserIds.size,
      uniqueWorkedUsers: row.workedUserIds.size
    }));
}

function brandTrendSvgNumber(value) {
  return String(Math.round(brandTrendNumber(value) * 100) / 100);
}

function brandTrendPointPath(rows, xForIndex, yForValue, valueKey) {
  return rows
    .map((row, index) => `${index === 0 ? 'M' : 'L'}${brandTrendSvgNumber(xForIndex(index))} ${brandTrendSvgNumber(yForValue(row[valueKey]))}`)
    .join(' ');
}

function brandTrendDynamicRange(rows, keys) {
  const values = rows.flatMap((row) => keys.map((key) => brandTrendNumber(row[key])));
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  if (max === min) {
    const fallbackPadding = Math.max(1, max * 0.1);
    return {
      min: Math.max(0, min - fallbackPadding),
      max: max + fallbackPadding
    };
  }

  const padding = Math.max(1, (max - min) * 0.18);
  return {
    min: Math.max(0, min - padding),
    max: max + padding
  };
}

function brandTrendRangeScale(range, top, plotHeight) {
  const span = Math.max(1, range.max - range.min);
  return (value) => top + ((range.max - brandTrendNumber(value)) / span) * plotHeight;
}

function renderBrandTrendEmptySvg() {
  return '<text class="brand-trend-label" x="380" y="140" text-anchor="middle">\u041d\u0435\u0442 \u0434\u0430\u043d\u043d\u044b\u0445</text>';
}

function renderBrandTrendSvg(rows, type) {
  if (rows.length === 0) {
    return renderBrandTrendEmptySvg();
  }

  const width = 760;
  const height = 280;
  const left = 48;
  const right = 22;
  const top = 18;
  const bottom = 42;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const count = rows.length;
  const slot = plotWidth / Math.max(count, 1);
  const xForIndex = (index) => left + slot * index + slot / 2;
  const maxBar = Math.max(
    1,
    ...rows.map((row) => Math.max(
      brandTrendNumber(row.orderedShifts),
      brandTrendNumber(row.coveredShifts),
      brandTrendNumber(row.uniqueRespondedUsers),
      brandTrendNumber(row.uniqueWorkedUsers)
    ))
  );
  const yForCount = (value) => top + plotHeight - (brandTrendNumber(value) / maxBar) * plotHeight;
  const yForPercent = (value) => top + plotHeight - (Math.max(0, Math.min(100, brandTrendNumber(value))) / 100) * plotHeight;
  const labels = rows
    .map((row, index) => {
      if (count > 10 && index % Math.ceil(count / 8) !== 0 && index !== count - 1) {
        return '';
      }
      const label = String(row.period).slice(5) || row.period;
      return `<text class="brand-trend-label" x="${brandTrendSvgNumber(xForIndex(index))}" y="${height - 12}" text-anchor="middle">${escapeHtml(label)}</text>`;
    })
    .join('');
  const grid = [0, 0.5, 1]
    .map((step) => {
      const y = top + plotHeight * step;
      return `<line class="brand-trend-grid-line" x1="${left}" y1="${brandTrendSvgNumber(y)}" x2="${width - right}" y2="${brandTrendSvgNumber(y)}"></line>`;
    })
    .join('');

  if (type === 'fulfillment') {
    const barWidth = Math.max(4, Math.min(18, slot * 0.28));
    const bars = rows
      .map((row, index) => {
        const x = xForIndex(index);
        const orderedY = yForCount(row.orderedShifts);
        const coveredY = yForCount(row.coveredShifts);
        return `<rect class="brand-trend-bar" fill="#2563eb" x="${brandTrendSvgNumber(x - barWidth - 1)}" y="${brandTrendSvgNumber(orderedY)}" width="${brandTrendSvgNumber(barWidth)}" height="${brandTrendSvgNumber(top + plotHeight - orderedY)}"><title>${escapeHtml(`${row.period}: ordered ${row.orderedShifts}`)}</title></rect>` +
          `<rect class="brand-trend-bar" fill="#14b8a6" x="${brandTrendSvgNumber(x + 1)}" y="${brandTrendSvgNumber(coveredY)}" width="${brandTrendSvgNumber(barWidth)}" height="${brandTrendSvgNumber(top + plotHeight - coveredY)}"><title>${escapeHtml(`${row.period}: closed ${row.coveredShifts}`)}</title></rect>`;
      })
      .join('');
    const slaPath = brandTrendPointPath(rows, xForIndex, yForPercent, 'slaPercent');
    const slaPoints = rows
      .map((row, index) => `<circle class="brand-trend-point" fill="#7c3aed" cx="${brandTrendSvgNumber(xForIndex(index))}" cy="${brandTrendSvgNumber(yForPercent(row.slaPercent))}" r="4"><title>${escapeHtml(`${row.period}: SLA ${Math.round(row.slaPercent)}%`)}</title></circle>`)
      .join('');
    return `${grid}${bars}<path class="brand-trend-line" stroke="#7c3aed" d="${escapeHtml(slaPath)}"></path>${slaPoints}${labels}`;
  }

  const workerRange = brandTrendDynamicRange(rows, ['uniqueRespondedUsers', 'uniqueWorkedUsers']);
  const yForWorkerCount = brandTrendRangeScale(workerRange, top, plotHeight);
  const respondedPath = brandTrendPointPath(rows, xForIndex, yForWorkerCount, 'uniqueRespondedUsers');
  const workedPath = brandTrendPointPath(rows, xForIndex, yForWorkerCount, 'uniqueWorkedUsers');
  const points = rows
    .map((row, index) => `<circle class="brand-trend-point" fill="#f97316" cx="${brandTrendSvgNumber(xForIndex(index))}" cy="${brandTrendSvgNumber(yForWorkerCount(row.uniqueRespondedUsers))}" r="4"><title>${escapeHtml(`${row.period}: responded ${row.uniqueRespondedUsers}`)}</title></circle>` +
      `<circle class="brand-trend-point" fill="#16a34a" cx="${brandTrendSvgNumber(xForIndex(index))}" cy="${brandTrendSvgNumber(yForWorkerCount(row.uniqueWorkedUsers))}" r="4"><title>${escapeHtml(`${row.period}: worked ${row.uniqueWorkedUsers}`)}</title></circle>`)
    .join('');

  return `${grid}<path class="brand-trend-line" stroke="#f97316" d="${escapeHtml(respondedPath)}"></path><path class="brand-trend-line" stroke="#16a34a" d="${escapeHtml(workedPath)}"></path>${points}${labels}`;
}

function renderBrandTrendCharts(rows, filters = {}) {
  const payload = brandTrendChartPayload(rows);
  const initialPeriod = ['day', 'week', 'month', 'quarter'].includes(filters.period) ? filters.period : 'day';
  const initialRows = aggregateBrandTrendRows(payload, initialPeriod);
  const periods = [
    ['day', 'День'],
    ['week', 'Неделя'],
    ['month', 'Месяц'],
    ['quarter', 'Квартал']
  ];

  return `<div class="brand-trend-charts" data-brand-trend-charts data-brand-trend-initial-period="${escapeHtml(initialPeriod)}">
  <div class="brand-trend-periods" role="group" aria-label="Периодичность графиков">
    ${periods
      .map(([period, label]) => `<button type="button" class="brand-trend-period" data-brand-trend-period="${escapeHtml(period)}" aria-pressed="${period === initialPeriod ? 'true' : 'false'}">${escapeHtml(label)}</button>`)
      .join('')}
  </div>
  <div class="brand-trend-chart-grid">
    <article class="mini-panel brand-trend-chart" data-brand-trend-chart="fulfillment">
      <div class="brand-trend-chart-head">
        <h3>Заказ и SLA</h3>
        <button type="button" class="brand-trend-expand" data-brand-trend-expand="fulfillment" aria-label="Раскрыть график Заказ и SLA">↗</button>
      </div>
      <svg class="brand-trend-svg" viewBox="0 0 760 280" role="img" aria-label="Заказано смен, закрыто смен и SLA">${renderBrandTrendSvg(initialRows, 'fulfillment')}</svg>
      ${renderBrandTrendLegend([
        { label: 'Заказано смен', color: '#2563eb' },
        { label: 'Закрыто смен', color: '#14b8a6' },
        { label: 'SLA', color: '#7c3aed' }
      ])}
    </article>
    <article class="mini-panel brand-trend-chart" data-brand-trend-chart="workers">
      <div class="brand-trend-chart-head">
        <h3>Отклики и выходы</h3>
        <button type="button" class="brand-trend-expand" data-brand-trend-expand="workers" aria-label="Раскрыть график Отклики и выходы">↗</button>
      </div>
      <svg class="brand-trend-svg" viewBox="0 0 760 280" role="img" aria-label="Уникальные пользователи откликались и вышли">${renderBrandTrendSvg(initialRows, 'workers')}</svg>
      ${renderBrandTrendLegend([
        { label: 'Уникальные откликнувшиеся', color: '#f97316' },
        { label: 'Уникальные вышедшие', color: '#16a34a' }
      ])}
    </article>
  </div>
  <script type="application/json" data-brand-trend-data>${safeJsonScript(payload)}</script>
  <div class="brand-trend-modal" data-brand-trend-modal aria-hidden="true">
    <div class="brand-trend-modal-backdrop" data-brand-trend-modal-backdrop></div>
    <div class="brand-trend-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="brand-trend-modal-title">
      <div class="brand-trend-modal-head">
        <h3 id="brand-trend-modal-title" data-brand-trend-modal-title></h3>
        <button type="button" class="brand-trend-modal-close" data-brand-trend-modal-close aria-label="Закрыть">×</button>
      </div>
      <div class="brand-trend-modal-chart" data-brand-trend-modal-chart></div>
    </div>
  </div>
</div>`;
}

function renderBrandTrendRows(rows, currentUser) {
  const trendRows = safeRows(rows);

  if (trendRows.length === 0) {
    return renderEmptyDashboardTable();
  }

  const bodyRows = trendRows
    .map((row) => `<tr>
  <td>${escapeHtml(trendRowValue(row, 'period'))}</td>
  ${numberCell(trendRowNumber(row, 'orderedShifts'), 0, 'brand-analysis.trend.ordered-shifts', currentUser)}
  ${numberCell(trendRowNumber(row, 'workedShifts'), 0, 'brand-analysis.trend.worked-shifts', currentUser)}
  ${numberCell(trendRowNumber(row, 'coveredShifts'), 0, 'brand-analysis.trend.covered-shifts', currentUser)}
  ${numberCell(trendRowNumber(row, 'openDemand'), 0, 'brand-analysis.trend.open-demand', currentUser)}
  ${percentCell(trendRowNumber(row, 'slaPercent'), 'brand-analysis.trend.sla', currentUser)}
  ${percentCell(trendRowNumber(row, 'coveragePercent'), 'brand-analysis.trend.coverage', currentUser)}
  ${numberCell(trendRowNumber(row, 'revenueRub'), 0, 'brand-analysis.trend.revenue-rub', currentUser)}
  ${numberCell(trendRowNumber(row, 'cancelledShifts'), 0, 'brand-analysis.trend.cancelled-shifts', currentUser)}
</tr>`)
    .join('');

  return `<div class="table-wrap"><table>
  <thead><tr><th>Период</th><th>Заказано</th><th>Отработано</th><th>Закрыто</th><th>Свободно</th><th>SLA</th><th>Покрытие</th><th>Выручка</th><th>Отмены</th></tr></thead>
  <tbody>${bodyRows}</tbody>
</table></div>`;
}

function renderBrandWorkplaceRows(rows, currentUser) {
  const workplaceRows = safeRows(rows);

  if (workplaceRows.length === 0) {
    return renderEmptyDashboardTable();
  }

  const bodyRows = workplaceRows
    .map((row) => `<tr>
  <td>${escapeHtml(row.workplaceTitle || 'Без точки')}</td>
  <td>${escapeHtml(row.city || '')}</td>
  ${numberCell(row.orderedShifts, 0, 'brand-analysis.workplaces.ordered-shifts', currentUser)}
  ${numberCell(row.workedShifts, 0, 'brand-analysis.workplaces.worked-shifts', currentUser)}
  ${percentCell(row.coveragePercent, 'brand-analysis.workplaces.coverage', currentUser)}
  ${percentCell(row.slaPercent, 'brand-analysis.workplaces.sla', currentUser)}
  ${numberCell(row.revenueRub, 0, 'brand-analysis.workplaces.revenue-rub', currentUser)}
  ${numberCell(row.cancelledShifts, 0, 'brand-analysis.workplaces.cancelled-shifts', currentUser)}
</tr>`)
    .join('');

  return `<div class="table-wrap"><table>
  <thead><tr><th>Точка</th><th>Город</th><th>Заказано</th><th>Отработано</th><th>Покрытие</th><th>SLA</th><th>Выручка</th><th>Отмены</th></tr></thead>
  <tbody>${bodyRows}</tbody>
</table></div>`;
}

const BRAND_REGION_TABLE_COLUMNS = [
  { key: 'region', label: 'Регион', numeric: false },
  { key: 'orderedShifts', label: 'Заказ' },
  { key: 'openDemand', label: 'Свободный заказ' },
  { key: 'slaPercent', label: 'SLA' },
  { key: 'coveragePercent', label: 'Покрытие' },
  { key: 'workedShifts', label: 'Отработано' },
  { key: 'workplaces', label: 'Точки' }
];

function renderBrandRegionTableHeader(column) {
  const active = column.key === 'openDemand';
  const indicator = active ? '↓' : '↕';
  const ariaSort = active ? 'descending' : 'none';

  return `<th><button class="sortable-header" type="button" data-brand-region-sort="${escapeHtml(column.key)}" aria-sort="${ariaSort}"><span>${escapeHtml(column.label)}</span><span class="sort-indicator" aria-hidden="true">${indicator}</span></button></th>`;
}

function renderBrandRegionDemandTrend(row, currentUser) {
  const trend = safeRows(row.orderTrend);

  if (trend.length === 0) {
    return '';
  }

  const values = trend.map((point) => Number(point.orderedShifts) || 0);
  const max = Math.max(...values, 1);
  const colorFor = (value) => {
    const intensity = Math.max(0, Math.min(1, value / max));
    const lightness = Math.round(96 - intensity * 52);

    return `hsl(198 72% ${lightness}%)`;
  };
  const gradient = trend.map((point, index) => {
    const position = Math.round(index / Math.max(trend.length - 1, 1) * 100);

    return `${colorFor(Number(point.orderedShifts) || 0)} ${position}%`;
  }).join(', ');
  const first = values[0];
  const last = values[values.length - 1];
  const min = Math.min(...values);
  const label = `Динамика заказа: ${formatNumber(first)} → ${formatNumber(last)}; минимум ${formatNumber(min)}, максимум ${formatNumber(max)}`;

  return renderMetricInfoScope({
    className: 'brand-region-demand-trend-info',
    metricId: 'brand-analysis.regions.order-trend',
    currentUser,
    content: `<span class="brand-region-demand-trend" style="background: linear-gradient(90deg, ${gradient})" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"></span>`,
    inlineInspector: true,
    inlineClassName: 'brand-region-demand-trend-inline'
  });
}

function renderBrandRegionRows(rows, currentUser) {
  const regionRows = safeRows(rows);

  if (regionRows.length === 0) {
    return renderEmptyDashboardTable();
  }

  const bodyRows = regionRows
    .map((row) => `<tr data-brand-region-region="${escapeHtml(row.region || 'Без региона')}" data-brand-region-ordered-shifts="${escapeHtml(row.orderedShifts)}" data-brand-region-open-demand="${escapeHtml(row.openDemand)}" data-brand-region-sla-percent="${escapeHtml(row.slaPercent)}" data-brand-region-coverage-percent="${escapeHtml(row.coveragePercent)}" data-brand-region-worked-shifts="${escapeHtml(row.workedShifts)}" data-brand-region-workplaces="${escapeHtml(row.workplaces)}">
  <td class="brand-region-name-cell">${escapeHtml(row.region || 'Без региона')}${renderBrandRegionDemandTrend(row, currentUser)}</td>
  ${numberCell(row.orderedShifts, 0, 'brand-analysis.regions.ordered-shifts', currentUser)}
  ${numberCell(row.openDemand, 0, 'brand-analysis.regions.open-demand', currentUser)}
  ${percentCell(row.slaPercent, 'brand-analysis.regions.sla', currentUser)}
  ${percentCell(row.coveragePercent, 'brand-analysis.regions.coverage', currentUser)}
  ${numberCell(row.workedShifts, 0, 'brand-analysis.regions.worked-shifts', currentUser)}
  ${numberCell(row.workplaces, 0, 'brand-analysis.regions.workplaces', currentUser)}
</tr>`)
    .join('');

  return `<div class="table-wrap" data-brand-region-table data-brand-region-sort-key="openDemand" data-brand-region-sort-direction="desc"><table>
  <thead><tr>${BRAND_REGION_TABLE_COLUMNS.map(renderBrandRegionTableHeader).join('')}</tr></thead>
  <tbody data-brand-region-body>${bodyRows}</tbody>
</table></div>`;
}

function renderBrandRegionTableScript() {
  return `<script>
(function () {
  var attributeByKey = {
    region: 'region',
    orderedShifts: 'ordered-shifts',
    openDemand: 'open-demand',
    slaPercent: 'sla-percent',
    coveragePercent: 'coverage-percent',
    workedShifts: 'worked-shifts',
    workplaces: 'workplaces'
  };

  function updateBrandRegionSortHeaders(root, key, direction) {
    root.querySelectorAll('[data-brand-region-sort]').forEach(function (button) {
      var active = button.getAttribute('data-brand-region-sort') === key;
      var indicator = button.querySelector('.sort-indicator');

      button.setAttribute('aria-sort', active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none');
      if (indicator) indicator.textContent = active ? (direction === 'asc' ? '↑' : '↓') : '↕';
    });
  }

  function sortBrandRegionRows(root, key, direction) {
    var body = root.querySelector('[data-brand-region-body]');
    var attribute = attributeByKey[key];

    if (!body || !attribute) return;

    Array.prototype.slice.call(body.querySelectorAll('tr')).sort(function (left, right) {
      var multiplier = direction === 'asc' ? 1 : -1;
      var leftValue = left.getAttribute('data-brand-region-' + attribute) || '';
      var rightValue = right.getAttribute('data-brand-region-' + attribute) || '';

      if (key === 'region') return leftValue.localeCompare(rightValue, 'ru') * multiplier;

      var difference = Number(leftValue) - Number(rightValue);
      if (difference !== 0) return difference * multiplier;
      return (left.getAttribute('data-brand-region-region') || '').localeCompare(right.getAttribute('data-brand-region-region') || '', 'ru');
    }).forEach(function (row) {
      body.appendChild(row);
    });

    root.setAttribute('data-brand-region-sort-key', key);
    root.setAttribute('data-brand-region-sort-direction', direction);
    updateBrandRegionSortHeaders(root, key, direction);
  }

  document.addEventListener('click', function (event) {
    var button = event.target && event.target.closest ? event.target.closest('[data-brand-region-sort]') : null;
    if (!button) return;

    var root = button.closest('[data-brand-region-table]');
    if (!root) return;

    var key = button.getAttribute('data-brand-region-sort');
    var currentKey = root.getAttribute('data-brand-region-sort-key') || 'openDemand';
    var currentDirection = root.getAttribute('data-brand-region-sort-direction') || 'desc';
    var direction = key === currentKey
      ? (currentDirection === 'desc' ? 'asc' : 'desc')
      : (key === 'region' ? 'asc' : 'desc');

    sortBrandRegionRows(root, key, direction);
  });
})();
</script>`;
}

function renderBrandProfessionRows(rows, currentUser) {
  const professionRows = safeRows(rows);

  if (professionRows.length === 0) {
    return renderEmptyDashboardTable();
  }

  const bodyRows = professionRows
    .map((row) => `<tr>
  <td>${escapeHtml(row.profession || 'Без специальности')}</td>
  ${numberCell(row.orderedShifts, 0, 'brand-analysis.professions.ordered-shifts', currentUser)}
  ${numberCell(row.workedShifts, 0, 'brand-analysis.professions.worked-shifts', currentUser)}
  ${percentCell(row.slaPercent, 'brand-analysis.professions.sla', currentUser)}
  ${numberCell(row.revenueRub, 0, 'brand-analysis.professions.revenue-rub', currentUser)}
  ${numberCell(row.cancelledShifts, 0, 'brand-analysis.professions.cancelled-shifts', currentUser)}
</tr>`)
    .join('');

  return `<div class="table-wrap"><table>
  <thead><tr><th>Специальность</th><th>Заказано</th><th>Отработано</th><th>SLA</th><th>Выручка</th><th>Отмены</th></tr></thead>
  <tbody>${bodyRows}</tbody>
</table></div>`;
}

function renderBrandStatusRows(rows, currentUser) {
  const statusRows = safeRows(rows);

  if (statusRows.length === 0) {
    return renderEmptyDashboardTable();
  }

  const bodyRows = statusRows
    .map((row) => `<tr>
  <td>${escapeHtml(row.status)}</td>
  ${numberCell(row.shifts, 0, 'brand-analysis.statuses.shifts', currentUser)}
</tr>`)
    .join('');

  return `<div class="table-wrap"><table>
  <thead><tr><th>Статус</th><th>Смены</th></tr></thead>
  <tbody>${bodyRows}</tbody>
</table></div>`;
}

function renderBrandAnalysisDashboardSection({ dashboard, section, currentUser }) {
  if (section === 'summary') {
    return `<section class="section">
  ${renderMetricPanelHead('Основные показатели', 'brand-analysis.summary', currentUser)}
  ${renderBrandAnalysisKpiCards(dashboard.summary || {}, currentUser, dashboard.filters || {})}
</section>`;
  }

  if (section === 'trend') {
    return `<section class="section">
  ${renderMetricPanelHead('Динамика', 'brand-analysis.trend', currentUser)}
  ${renderBrandTrendCharts(dashboard.trendRows, dashboard.filters || {})}
</section>`;
  }

  if (section === 'regions') {
    return `<section class="section">
  ${renderMetricPanelHead('Регионы присутствия бренда', 'brand-analysis.regions', currentUser)}
  ${renderBrandRegionRows(dashboard.regionRows, currentUser)}
</section>`;
  }

  if (section === 'workplaces') {
    return `<section class="section">
  ${renderMetricPanelHead('Точки бренда', 'brand-analysis.workplaces', currentUser)}
  ${renderBrandWorkplaceRows(dashboard.workplaceRows, currentUser)}
</section>`;
  }

  if (section === 'professions') {
    return `<section class="section">
  ${renderMetricPanelHead('Специальности', 'brand-analysis.professions', currentUser)}
  ${renderBrandProfessionRows(dashboard.professionRows, currentUser)}
</section>`;
  }

  if (section === 'statuses') {
    return `<section class="section">
  ${renderMetricPanelHead('Статусы работ', 'brand-analysis.statuses', currentUser)}
  ${renderBrandStatusRows(dashboard.statusRows, currentUser)}
</section>`;
  }

  return `<section class="section"><div class="error">Неизвестный блок дашборда.</div></section>`;
}

function renderBrandAnalysisDashboard({
  database,
  dashboard,
  progressive = false,
  currentUser,
  csrfToken
}) {
  const filters = dashboard.filters || {};
  const selectedBrandTitle = dashboard.selectedBrandTitle || '';
  const period = `${filters.from || ''} - ${filters.to || ''}`;
  const details = selectedBrandTitle ? [`Бренд: ${selectedBrandTitle}`, `Группировка: ${periodLabel(filters.period)}`] : [`Группировка: ${periodLabel(filters.period)}`];
  const resultsHtml = progressive
    ? renderBrandAnalysisProgressiveSections(filters)
    : `${renderBrandAnalysisDashboardSection({ dashboard, section: 'summary', currentUser })}
${renderBrandAnalysisDashboardSection({ dashboard, section: 'trend', currentUser })}
${renderBrandAnalysisDashboardSection({ dashboard, section: 'regions', currentUser })}
${renderBrandAnalysisDashboardSection({ dashboard, section: 'workplaces', currentUser })}
${renderBrandAnalysisDashboardSection({ dashboard, section: 'professions', currentUser })}
${renderBrandAnalysisDashboardSection({ dashboard, section: 'statuses', currentUser })}`;
  const content = `<section class="section">
  ${renderDashboardHeader({
    title: 'Анализ брендов',
    eyebrow: 'Дашборд',
    period,
    details
  })}
  <p class="technical-note">Экран показывает один выбранный бренд из mg_clients: плановый заказ, выполнение, покрытие, точки, специальности и статусы смен.</p>
</section>
<section class="section">
  <form class="filter-bar" action="/dashboards/brand-analysis" method="get">
    <div class="field">
      <label for="brandId">Бренд</label>
      <select id="brandId" name="brandId">${renderBrandOptions(dashboard.brandOptions || [], filters.brandId)}</select>
    </div>
    <div class="field">
      <label for="period">Период</label>
      <select id="period" name="period">${renderPeriodOptions(filters.period)}</select>
    </div>
    <div class="field">
      <label for="from">С</label>
      <input id="from" name="from" type="date" value="${escapeHtml(filters.from || '')}">
    </div>
    <div class="field">
      <label for="to">По</label>
      <input id="to" name="to" type="date" value="${escapeHtml(filters.to || '')}">
    </div>
    ${renderMultiSelectField({
      id: 'city',
      label: '\u0413\u043e\u0440\u043e\u0434',
      options: filterOptions(dashboard, 'city'),
      selected: filters.city
    })}
    ${renderMultiSelectField({
      id: 'region',
      label: '\u0420\u0435\u0433\u0438\u043e\u043d',
      options: filterOptions(dashboard, 'region'),
      selected: filters.region
    })}
    <button type="submit">Применить</button>
  </form>
</section>
${resultsHtml}${renderBrandRegionTableScript()}
${renderWorkplacePointReviewModal()}
${renderWorkplacePointReviewsScript()}`;

  return layout({
    title: 'Анализ брендов',
    database,
    content,
    activeNav: 'brand-analysis',
    currentUser,
    csrfToken
  });
}

function renderBrandAnalysisReviews({ details }) {
  const reviews = (details && details.reviews) || [];
  const filters = (details && details.filters) || {};
  const pageSize = 50;

  if (reviews.length === 0) {
    return `<div class="workplace-point-reviews">
  <h2>\u041e\u0442\u0437\u044b\u0432\u044b \u0431\u0440\u0435\u043d\u0434\u0430</h2>
  <p class="empty">\u041d\u0435\u0442 \u043e\u0442\u0437\u044b\u0432\u043e\u0432 \u043f\u043e \u0432\u044b\u0431\u0440\u0430\u043d\u043d\u043e\u043c\u0443 \u0431\u0440\u0435\u043d\u0434\u0443.</p>
</div>`;
  }

  const totalReviews = reviews.length;
  const totalPages = Math.max(1, Math.ceil(totalReviews / pageSize));
  const requestedPage = Math.max(1, Math.floor(Number(filters.page) || 1));
  const page = Math.min(requestedPage, totalPages);
  const pageReviews = reviews.slice((page - 1) * pageSize, page * pageSize);
  const previousUrl = brandAnalysisReviewsUrl({ ...filters, page: page - 1 });
  const nextUrl = brandAnalysisReviewsUrl({ ...filters, page: page + 1 });
  const pagination = totalPages > 1
    ? `<nav class="pagination" aria-label="\u041f\u0430\u0433\u0438\u043d\u0430\u0446\u0438\u044f \u043e\u0442\u0437\u044b\u0432\u043e\u0432">
  <div class="pagination-meta">\u0421\u0442\u0440\u0430\u043d\u0438\u0446\u0430 ${escapeHtml(page)} \u0438\u0437 ${escapeHtml(totalPages)} \u00b7 \u043e\u0442\u0437\u044b\u0432\u043e\u0432: ${escapeHtml(formatNumber(totalReviews))}</div>
  <div class="pagination-actions">
    ${page > 1
      ? `<a class="pagination-link" href="${escapeHtml(previousUrl)}" data-review-list-page-link="1">\u041d\u0430\u0437\u0430\u0434</a>`
      : '<span class="pagination-link disabled" aria-disabled="true">\u041d\u0430\u0437\u0430\u0434</span>'}
    ${page < totalPages
      ? `<a class="pagination-link" href="${escapeHtml(nextUrl)}" data-review-list-page-link="1">\u0412\u043f\u0435\u0440\u0435\u0434</a>`
      : '<span class="pagination-link disabled" aria-disabled="true">\u0412\u043f\u0435\u0440\u0435\u0434</span>'}
  </div>
</nav>`
    : '';
  const rows = pageReviews
    .map((review) => `<tr>
  <td class="number-cell">${escapeHtml(formatNumber(review.rating))}</td>
  <td class="compact-text-cell" title="${escapeHtml(detailText(review.workplaceTitle))}">${escapeHtml(detailText(review.workplaceTitle))}</td>
  <td class="compact-text-cell">${escapeHtml(detailText(review.city))}</td>
  <td class="compact-text-cell" title="${escapeHtml(detailText(review.authorFullName))}">${escapeHtml(detailText(review.authorFullName))}</td>
  <td class="nowrap-cell">${escapeHtml(detailText(review.authorPhone))}</td>
  <td class="nowrap-cell">${escapeHtml(formatDateTimeValue(review.createdAtLocal))}</td>
  <td class="review-text-cell">${escapeHtml(detailText(review.text))}</td>
</tr>`)
    .join('');

  return `<div class="workplace-point-reviews">
  <div class="giger-details-head">
    <h2>\u041e\u0442\u0437\u044b\u0432\u044b \u0431\u0440\u0435\u043d\u0434\u0430</h2>
    <div class="giger-details-actions"><span class="muted">\u041f\u043e\u043a\u0430\u0437\u0430\u043d\u043e: ${escapeHtml(formatNumber(pageReviews.length))} \u0438\u0437 ${escapeHtml(formatNumber(totalReviews))}</span></div>
  </div>
  ${pagination}
  <div class="table-wrap compact-detail-table-wrap"><table class="compact-detail-table workplace-point-reviews-table">
    <thead><tr>
      <th>\u041e\u0446\u0435\u043d\u043a\u0430</th>
      <th>\u0422\u043e\u0447\u043a\u0430</th>
      <th>\u0413\u043e\u0440\u043e\u0434</th>
      <th>\u0424\u0418\u041e</th>
      <th>\u0422\u0435\u043b\u0435\u0444\u043e\u043d</th>
      <th>\u0414\u0430\u0442\u0430</th>
      <th>\u041e\u0442\u0437\u044b\u0432</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
  ${pagination}
</div>`;
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
  const availableOptions = Array.isArray(options) ? options.map((option) => String(option)) : [];
  const optionsWithSelected = [...new Set([...availableOptions, ...selected])];

  return optionsWithSelected
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

function renderPointMetric(label, value, metricId, currentUser, detailUrl = '', valueClassName = '') {
  const valueClass = valueClassName ? `point-metric-value ${valueClassName}` : 'point-metric-value';
  const content = `<div class="point-metric-label">${escapeHtml(label)}</div>
  <div class="${escapeHtml(valueClass)}">${renderGigerDetailTrigger(value, detailUrl)}</div>`;

  return renderMetricInfoScope({
    className: 'point-metric',
    metricId,
    currentUser,
    content
  });
}

function renderPointSlaValue(point) {
  const past = typeof point.slaPastPercent === 'undefined' ? point.slaPercent : point.slaPastPercent;
  const forecast = typeof point.slaForecastPercent === 'undefined' ? 0 : point.slaForecastPercent;

  return `${formatWholePercent(past)} / ${formatWholePercent(forecast)}`;
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

  return `<form class="point-pin-form" action="/dashboards/workplace-analysis" method="get" data-workplace-pin-form="1">
  ${renderWorkplaceAnalysisHiddenParams(filters, { pinnedWorkplaceIds: nextPinnedWorkplaceIds })}
  <label class="point-pin-label">
    <input name="pinnedWorkplaceId" type="checkbox" value="${escapeHtml(workplaceId)}"${checked}>
    <span>Закрепить</span>
  </label>
</form>`;
}

function renderPointCard(point, filters, currentDateValue, currentUser) {
  const cardClass = point.pinned ? 'point-card pinned' : 'point-card';
  const detailHref = escapeHtml(workplacePointPageHref(filters, point.workplaceId));

  return `<article class="${cardClass}">
  <div class="point-card-head">
    ${renderPointPinForm(point, filters)}
    <a class="point-card-link point-card-title-block" href="${detailHref}" target="_blank" rel="noopener noreferrer">
      <span class="point-title" title="${escapeHtml(point.title)}">${escapeHtml(point.title)}</span>
    </a>
  </div>
  <a class="point-card-link" href="${detailHref}" target="_blank" rel="noopener noreferrer">
    <div class="point-metrics">
      ${renderPointMetric('Заказано', formatNumber(point.totalOrderedShifts))}
      ${renderPointMetric('SLA', renderPointSlaValue(point), undefined, undefined, '', 'compact')}
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
      ${renderPointMetric('SLA', renderPointSlaValue(point), 'workplace-analysis.points.sla', currentUser, '', 'compact')}
      ${renderPointMetric('Стабильность', formatPercent(point.stabilityPercent), 'workplace-analysis.points.stability', currentUser)}
      ${renderPointMetric('Гигеры 5 км', formatNumber(point.activeGigers5km), 'workplace-analysis.points.active-gigers-5km', currentUser, activeGigersDetailUrl)}
      ${renderPointMetric('Активные дни', `${formatNumber(point.activeDays)} / ${formatNumber(point.rangeDays)}`, 'workplace-analysis.points.active-days', currentUser)}
      ${renderPointMetric('Среднее', formatNumber(point.avgDailyOrder, 1), 'workplace-analysis.points.avg-daily-order', currentUser)}
    </div>
    ${renderMetricHeatmap(point.heatmapDays, currentDateValue, 'workplace-analysis.points.heatmap', currentUser)}`;
  const bodyHtml = `<div class="point-card-link">${metricsHtml}</div>`;

  return `<article class="${cardClass}">
  <div class="point-card-head">
    ${renderPointPinForm(point, filters)}
    <a class="point-card-link point-card-title-block" href="${detailHref}" target="_blank" rel="noopener noreferrer">
      <span class="point-title" title="${escapeHtml(point.title)}">${escapeHtml(point.title)}</span>
    </a>
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

function fallbackAttentionReasons(point = {}) {
  const free7d = Number(point.free7d) || 0;
  const ordered7d = Number(point.ordered7d) || 0;
  const covered7d = Number(point.covered7d) || 0;
  const maxDailyFree = Number(point.maxDailyFree) || 0;
  const activeWorkers30d15km = Number(point.activeWorkers30d15km) || 0;
  const explicitCoveragePercent = Number(point.coveragePercent);
  const explicitActivePerFree = Number(point.activeWorkersPerFreeShift);
  const coveragePercent = Number.isFinite(explicitCoveragePercent)
    ? explicitCoveragePercent
    : (ordered7d > 0 ? covered7d / ordered7d * 100 : 0);
  const activePerFree = Number.isFinite(explicitActivePerFree)
    ? explicitActivePerFree
    : (free7d > 0 ? activeWorkers30d15km / free7d : 0);
  const reasons = [];

  if (free7d > 0) {
    reasons.push({ kind: 'free-order', label: `Свободный заказ ${formatNumber(free7d)} за 7 дней` });
  }

  if ((ordered7d > 0 || Number.isFinite(explicitCoveragePercent)) && coveragePercent < 70) {
    reasons.push({ kind: 'coverage', label: `Покрытие ${formatNumber(coveragePercent)}%` });
  }

  if (free7d > 0 && activePerFree < 1) {
    reasons.push({ kind: 'active-base', label: `Актив ${formatNumber(activePerFree, 1)} на свободную смену` });
  }

  if (maxDailyFree >= 3) {
    reasons.push({ kind: 'peak-day', label: `Пик ${formatNumber(maxDailyFree)} свободных смен в день` });
  }

  return reasons;
}

function renderAttentionReasons(reasons, point = {}) {
  const explicitReasons = safeRows(reasons);
  const effectiveReasons = explicitReasons.length > 0 ? explicitReasons : fallbackAttentionReasons(point);
  const items = effectiveReasons
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
        <td class="attention-reason-cell"><div class="attention-reasons">${renderAttentionReasons(point.riskReasons, point)}</div></td>
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
  { key: 'riskSeverity', label: 'Риск', numeric: false, sortable: false },
  { key: 'riskReasons', label: 'Причины', numeric: false, sortable: false },
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
  addDashboardQueryParam(params, 'client', nextFilters.client);
  addDashboardQueryParam(params, 'city', nextFilters.city);

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
  addDashboardQueryParam(params, 'client', filters.client);
  addDashboardQueryParam(params, 'city', filters.city);

  return `/dashboards/worker-cancellations/details?${params.toString()}`;
}

function workerCancellationBlacklistsUrl(row) {
  const params = new URLSearchParams();

  addDashboardQueryParam(params, 'workerId', row.workerId);

  return `/dashboards/worker-cancellations/blacklists?${params.toString()}`;
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
  if (column.sortable === false) {
    return `<th><span>${escapeHtml(column.label)}</span></th>`;
  }

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

          if (column.key === 'riskSeverity') {
            return `<td>${renderRiskBadge(row.riskSeverity)}</td>`;
          }

          if (column.key === 'riskReasons') {
            return `<td><div class="attention-reasons">${renderAttentionReasons(row.riskReasons, row)}</div></td>`;
          }

          if (column.key === 'fullName') {
            const blacklistsUrl = workerCancellationBlacklistsUrl(row);

            return `<td><button type="button" class="metric-detail-trigger worker-blacklists-trigger" data-worker-blacklists-trigger data-detail-url="${escapeHtml(blacklistsUrl)}">${escapeHtml(value || '')}</button></td>`;
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

function renderGigerDetails({ details, csrfToken = '' }) {
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
      ${safeDetails.exportJobUrl ? `<button type="button" class="secondary-button" data-region-giger-export-start data-export-job-url="${escapeHtml(safeDetails.exportJobUrl)}" data-csrf-token="${escapeHtml(csrfToken)}">Подготовить Excel</button><span class="muted" data-region-giger-export-progress aria-live="polite"></span>` : safeDetails.exportUrl ? `<a class="secondary-button" href="${escapeHtml(safeDetails.exportUrl)}">Выгрузить в Excel</a>` : ''}
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

function renderWorkerBlacklistDetails({ details }) {
  const safeDetails = details || {};
  const blacklists = Array.isArray(safeDetails.blacklists) ? safeDetails.blacklists : [];
  const eventContext = safeDetails.lastEventContext || null;
  const eventContextName = eventContext
    ? detailText(eventContext.contractorName || eventContext.clientName)
    : '';
  const eventContextBlock = eventContext
    ? `<section class="worker-blacklists-event-context">
  <h3>Список по контексту события</h3>
  <p class="context-line"><strong>${escapeHtml(eventContextName)}</strong></p>
  <p>${escapeHtml(detailText(eventContext.workplaceName))}${eventContext.city ? ` · ${escapeHtml(eventContext.city)}` : ''}</p>
  <p class="muted">Название восстановлено по отмене смены, зафиксированной через ${escapeHtml(eventContext.eventDistanceSeconds)} сек. после события <code>ban_list</code>. Это контекст события, а не подтверждение текущего состояния списка.</p>
</section>`
    : '';
  const lastEvent = safeDetails.lastEventAtLocal
    ? `<section class="worker-blacklists-audit">
  <h3>Последнее зафиксированное действие с чёрным списком</h3>
  <p class="context-line">Оператор: ${escapeHtml(detailText(safeDetails.lastEventOperator))} · ${escapeHtml(formatDateTimeValue(safeDetails.lastEventAtLocal))} МСК</p>
  <p class="muted">Журнал не указывает конкретный список и не различает добавление и удаление. Поэтому эти данные нельзя трактовать как автора и дату включения в строке списка.</p>
</section>`
    : `<p class="muted">В журнале действий оператора не найдено событий по чёрным спискам этого исполнителя.</p>`;

  if (blacklists.length === 0) {
    return `<div class="worker-blacklist-details">
  <h2>Чёрные списки исполнителя</h2>
  <p class="empty">В актуальных массивах чёрных списков клиентов и рабочих мест исполнитель не найден.</p>
  ${eventContextBlock}
  ${lastEvent}
</div>`;
  }

  const rows = blacklists
    .map((blacklist) => `<tr>
  <td>${escapeHtml(blacklist.scope === 'workplace' ? 'Рабочее место' : 'Клиент')}</td>
  <td>${escapeHtml(detailText(blacklist.clientName))}</td>
  <td>${escapeHtml(detailText(blacklist.workplaceName))}</td>
  <td>${escapeHtml(detailText(blacklist.city))}</td>
</tr>`)
    .join('');

  return `<div class="worker-blacklist-details">
  <h2>Чёрные списки исполнителя</h2>
  <div class="table-wrap"><table>
    <thead><tr>
      <th>Уровень списка</th>
      <th>Клиент</th>
      <th>Рабочее место</th>
      <th>Город</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
  ${eventContextBlock}
  ${lastEvent}
</div>`;
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
      <h2 id="worker-cancellation-modal-title" data-worker-cancellation-modal-title>Детализация смен</h2>
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
    { label: 'SLA', value: renderPointSlaValue(summary), metricId: 'workplace-point.summary.sla' },
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
    {
      label: 'Вып. смен/исп. в неделю',
      value: formatNumber(summary.avgCompletedShiftsPerActiveWorkerWeek, 1),
      metricId: 'workplace-point.summary.avg-completed-shifts-per-active-worker-week'
    },
    {
      label: 'Вып. смен/исп. в месяц',
      value: formatNumber(summary.avgCompletedShiftsPerActiveWorkerMonth, 1),
      metricId: 'workplace-point.summary.avg-completed-shifts-per-active-worker-month'
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
    { label: 'SLA', value: renderPointSlaValue(summary), metricId: 'workplace-point.summary.sla' },
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
    {
      label: 'Вып. смен/исп. в неделю',
      value: formatNumber(summary.avgCompletedShiftsPerActiveWorkerWeek, 1),
      metricId: 'workplace-point.summary.avg-completed-shifts-per-active-worker-week'
    },
    {
      label: 'Вып. смен/исп. в месяц',
      value: formatNumber(summary.avgCompletedShiftsPerActiveWorkerMonth, 1),
      metricId: 'workplace-point.summary.avg-completed-shifts-per-active-worker-month'
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

function hasForecastSlaPercent(row) {
  return row.forecastSlaPercent !== null
    && typeof row.forecastSlaPercent !== 'undefined'
    && row.forecastSlaPercent !== '';
}

function isPointForecastCalendarDay(row, currentDateKey) {
  return Boolean(currentDateKey && row.period >= currentDateKey);
}

function pointCalendarSlaPercent(row, currentDateKey) {
  if (isPointForecastCalendarDay(row, currentDateKey) && hasForecastSlaPercent(row)) {
    return Number(row.forecastSlaPercent) || 0;
  }

  return Number(row.slaPercent) || 0;
}

function calendarSlaLevel(row, currentDateKey) {
  if ((Number(row.orderedShifts) || 0) <= 0) {
    return null;
  }

  const sla = pointCalendarSlaPercent(row, currentDateKey);

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
  const dailySla = pointCalendarSlaPercent(row, currentDateKey);
  const title = `${row.period}: заказ ${formatNumber(row.orderedShifts)}; SLA ${formatPercent(dailySla)}; слеты ${formatNumber(row.dropoffs24h)}; размещение среднее ${formatLeadTimeMinutes(row.orderLeadAvgMinutes)}; размещение минимум ${formatLeadTimeMinutes(row.orderLeadMinMinutes)}`;
  const slaLevel = calendarSlaLevel(row, currentDateKey);
  const slaLevelAttribute = slaLevel === null ? '' : ` data-sla-level="${escapeHtml(slaLevel)}"`;
  const dropoffs24h = Number(row.dropoffs24h) || 0;
  const orderedShifts = Number(row.orderedShifts) || 0;
  const isForecastDay = isPointForecastCalendarDay(row, currentDateKey);
  const riskLevel = orderedShifts > 0 && (dailySla < 50 || (!isForecastDay && dropoffs24h > 0))
    ? 'high'
    : orderedShifts > 0 && dailySla < 80
      ? 'medium'
      : 'low';
  const isCurrentDay = currentDateKey && row.period === currentDateKey;
  const cellClass = isCurrentDay ? 'point-calendar-cell is-current-day' : 'point-calendar-cell';
  const currentDayAttribute = isCurrentDay ? ' aria-current="date"' : '';
  const detailUrl = workplacePointDayDetailsUrl(filters || {}, row.period);

  return `<div class="${cellClass}" data-date="${escapeHtml(row.period)}"${slaLevelAttribute}${currentDayAttribute} title="${escapeHtml(title)}" data-risk-level="${escapeHtml(riskLevel)}">
  <button type="button" class="point-calendar-cell-button" data-workplace-point-day-detail-trigger data-detail-url="${escapeHtml(detailUrl)}" aria-label="Открыть детализацию за ${escapeHtml(row.period)}">
    <div class="point-calendar-date">${escapeHtml(dayLabelFromDateKey(row.period))}</div>
    <div class="point-calendar-values">
      ${renderPointCalendarValue('З', formatNumber(row.orderedShifts), 'Заказ')}
      ${renderPointCalendarValue('SLA', formatPercent(dailySla))}
      ${renderPointCalendarValue('Сл', formatNumber(row.dropoffs24h), 'Слеты')}
      ${renderPointCalendarValue('Ср', formatLeadTimeCompactMinutes(row.orderLeadAvgMinutes), 'Размещение среднее')}
      ${renderPointCalendarValue('М', formatLeadTimeCompactMinutes(row.orderLeadMinMinutes), 'Размещение минимум')}
    </div>
  </button>
</div>`;
}

function renderPointCalendarCell(row, currentDateKey, filters, currentUser) {
  const dailySla = pointCalendarSlaPercent(row, currentDateKey);
  const title = `${row.period}: заказ ${formatNumber(row.orderedShifts)}; SLA ${formatPercent(dailySla)}; слеты ${formatNumber(row.dropoffs24h)}; размещение среднее ${formatLeadTimeMinutes(row.orderLeadAvgMinutes)}; размещение минимум ${formatLeadTimeMinutes(row.orderLeadMinMinutes)}`;
  const slaLevel = calendarSlaLevel(row, currentDateKey);
  const slaLevelAttribute = slaLevel === null ? '' : ` data-sla-level="${escapeHtml(slaLevel)}"`;
  const dropoffs24h = Number(row.dropoffs24h) || 0;
  const orderedShifts = Number(row.orderedShifts) || 0;
  const isForecastDay = isPointForecastCalendarDay(row, currentDateKey);
  const riskLevel = orderedShifts > 0 && (dailySla < 50 || (!isForecastDay && dropoffs24h > 0))
    ? 'high'
    : orderedShifts > 0 && dailySla < 80
      ? 'medium'
      : 'low';
  const isCurrentDay = currentDateKey && row.period === currentDateKey;
  const cellClass = isCurrentDay ? 'point-calendar-cell is-current-day' : 'point-calendar-cell';
  const currentDayAttribute = isCurrentDay ? ' aria-current="date"' : '';
  const detailUrl = workplacePointDayDetailsUrl(filters || {}, row.period);
  const hasSqlInspector = canViewSqlInspector(currentUser);
  const controlOpen = hasSqlInspector
    ? `<div class="point-calendar-cell-button" role="button" tabindex="0" data-workplace-point-day-detail-trigger data-detail-url="${escapeHtml(detailUrl)}" aria-label="Открыть детализацию за ${escapeHtml(row.period)}">`
    : `<button type="button" class="point-calendar-cell-button" data-workplace-point-day-detail-trigger data-detail-url="${escapeHtml(detailUrl)}" aria-label="Открыть детализацию за ${escapeHtml(row.period)}">`;
  const controlClose = hasSqlInspector ? '</div>' : '</button>';

  return `<div class="${cellClass}" data-date="${escapeHtml(row.period)}"${slaLevelAttribute}${currentDayAttribute} title="${escapeHtml(title)}" data-risk-level="${escapeHtml(riskLevel)}">
  ${controlOpen}
    <div class="point-calendar-date">${escapeHtml(dayLabelFromDateKey(row.period))}</div>
    <div class="point-calendar-values">
      ${renderPointCalendarValue('З', formatNumber(row.orderedShifts), 'Заказ', 'workplace-point.charts.calendar-ordered-shifts', currentUser)}
      ${renderPointCalendarValue('SLA', formatPercent(dailySla), 'SLA', 'workplace-point.charts.calendar-sla', currentUser)}
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

function shortMonthLabelFromDateKey(value) {
  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    return String(value || '');
  }

  const monthNames = [
    'Янв',
    'Фев',
    'Мар',
    'Апр',
    'Май',
    'Июн',
    'Июл',
    'Авг',
    'Сен',
    'Окт',
    'Ноя',
    'Дек'
  ];

  return monthNames[date.getUTCMonth()];
}

function yearRangeFromCurrentDateValue(currentDateValue) {
  const currentDateKey = currentDateKeyFromValue(currentDateValue) || currentDateKeyFromValue(new Date());
  const year = currentDateKey ? currentDateKey.slice(0, 4) : String(new Date().getUTCFullYear());

  return {
    from: `${year}-01-01`,
    to: `${year}-12-31`
  };
}

function yearHeatmapLevel(value, maxValue) {
  const numericValue = Number(value) || 0;
  const numericMax = Number(maxValue) || 0;

  if (numericValue <= 0 || numericMax <= 0) {
    return 0;
  }

  const ratio = numericValue / numericMax;

  if (ratio <= 0.25) {
    return 1;
  }

  if (ratio <= 0.5) {
    return 2;
  }

  if (ratio <= 0.75) {
    return 3;
  }

  return 4;
}

function renderPointYearHeatmapEmptyCells(count) {
  return Array.from(
    { length: count },
    () => '<span class="point-year-heatmap-cell empty" aria-hidden="true"></span>'
  ).join('');
}

function pointYearHeatmapRows(rows, currentDateValue) {
  const range = yearRangeFromCurrentDateValue(currentDateValue);
  const rowsByPeriod = new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row.period || ''), row]));
  const dateKeys = buildCalendarDateKeys(range.from, range.to);

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

function renderPointYearHeatmapCell(row, currentDateKey, maxValue) {
  const level = yearHeatmapLevel(row.orderedShifts, maxValue);
  const title = `${row.period}: заказ ${formatNumber(row.orderedShifts)}; выполнено ${formatNumber(row.completedShifts || 0)}`;
  const isCurrentDay = currentDateKey && row.period === currentDateKey;
  const cellClass = isCurrentDay ? 'point-year-heatmap-cell is-current-day' : 'point-year-heatmap-cell';
  const currentDayAttribute = isCurrentDay ? ' aria-current="date"' : '';

  return `<span class="${cellClass}" data-date="${escapeHtml(row.period)}" data-level="${escapeHtml(level)}"${currentDayAttribute} title="${escapeHtml(title)}"></span>`;
}

function pointYearHeatmapMonthGeometry(group) {
  const leadingEmptyCount = weekdayOffsetFromMonday(group.rows[0].period);
  const totalCells = leadingEmptyCount + group.rows.length;
  const trailingEmptyCount = (7 - (totalCells % 7)) % 7;

  return {
    leadingEmptyCount,
    trailingEmptyCount,
    weekColumns: (totalCells + trailingEmptyCount) / 7
  };
}

function renderPointYearHeatmapMonth(group, currentDateKey, maxValue) {
  const geometry = pointYearHeatmapMonthGeometry(group);
  const cells = group.rows.map((row) => renderPointYearHeatmapCell(row, currentDateKey, maxValue)).join('');
  const monthWeekColumns = String(geometry.weekColumns);

  return `<div class="point-year-heatmap-month" style="grid-column: span ${escapeHtml(monthWeekColumns)}; --point-year-heatmap-month-weeks: ${escapeHtml(monthWeekColumns)};">
    <div class="point-year-heatmap-month-label">${escapeHtml(shortMonthLabelFromDateKey(group.rows[0].period))}</div>
    <div class="point-year-heatmap-grid">${renderPointYearHeatmapEmptyCells(geometry.leadingEmptyCount)}${cells}${renderPointYearHeatmapEmptyCells(geometry.trailingEmptyCount)}</div>
  </div>`;
}

function renderPointYearHeatmap(rows, currentDateValue = new Date(), currentUser) {
  const detailPanelClass = renderPanelClass('year-heatmap-panel');
  const heatmapRows = pointYearHeatmapRows(rows, currentDateValue);
  const currentDateKey = currentDateKeyFromValue(currentDateValue);
  const maxValue = Math.max(0, ...heatmapRows.map((row) => Number(row.orderedShifts) || 0));
  const monthGroups = groupPointCalendarRowsByMonth(heatmapRows);
  const totalWeekColumns = monthGroups.reduce(
    (total, group) => total + pointYearHeatmapMonthGeometry(group).weekColumns,
    0
  );
  const months = monthGroups
    .map((group) => renderPointYearHeatmapMonth(group, currentDateKey, maxValue))
    .join('');

  const heatmap = renderMetricInfoScope({
    className: 'metric-visual-output',
    metricId: 'workplace-point.charts.year-heatmap',
    currentUser,
    content: `<div class="point-year-heatmap" aria-label="Дневная тепловая лента заказа за текущий год">
    <div class="point-year-heatmap-months" style="--point-year-heatmap-week-columns: ${escapeHtml(totalWeekColumns || 63)};">${months}</div>
  </div>`
  });

  return `<div class="${detailPanelClass}">
  <h2>Дневная лента за год</h2>
  ${heatmap}
</div>`;
}

function renderWorkplacePointCharts(dashboard, currentUser) {
  const maxProfessionOrders = Math.max(0, ...dashboard.professionRows.map((row) => Number(row.orderedShifts) || 0));
  const yearHeatmapHtml = Array.isArray(dashboard.yearHeatmapRows)
    ? renderPointYearHeatmap(dashboard.yearHeatmapRows, dashboard.currentDate, currentUser)
    : '';

  return `<div class="detail-grid point-detail-grid">
  ${yearHeatmapHtml}
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
<div data-dashboard-fragment-url="${escapeHtml(workplacePointSectionUrl(filters, 'radius'))}" data-dashboard-fragment-defer="idle">
  <section class="section">
    <h2>База вокруг точки</h2>
    <p class="loading">Загружается</p>
  </section>
</div>
<div data-dashboard-fragment-url="${escapeHtml(workplacePointSectionUrl(filters, 'year-heatmap'))}" data-dashboard-fragment-defer="visible">
  <section class="section">
    <h2>Дневная лента за год</h2>
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
  ${renderDashboardHeader({
    title: point && point.title ? point.title : 'Карточка точки',
    eyebrow: 'Карточка точки',
    period: `Период: ${filters.from} - ${filters.to}`,
    details: [point && point.clientTitle ? point.clientTitle : '', point && point.address ? point.address : '']
  })}
  ${renderActiveFilterChips(filters)}
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

  if (section === 'year-heatmap') {
    return `<section class="section">
  <div class="detail-grid point-detail-grid">
    ${renderPointYearHeatmap(dashboard.yearHeatmapRows || [], dashboard.currentDate, currentUser)}
  </div>
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
    ? `<div data-dashboard-fragment-url="${escapeHtml(workplaceAnalysisSectionUrl(filters, 'attention'))}" data-dashboard-fragment-defer="#workplace-tab-attention">
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

function safeJsonAttribute(value) {
  return escapeHtml(JSON.stringify(value));
}

function renderCityRankingBrandOptions(brands = []) {
  return ['<option value="">Все бренды</option>']
    .concat(
      brands.map((brand) => `<option value="${escapeHtml(brand)}">${escapeHtml(brand)}</option>`)
    )
    .join('');
}

function renderCityRankingSortButton(key, label, activeKey = 'orderedShifts', direction = 'desc') {
  const active = key === activeKey;
  const indicator = active ? (direction === 'asc' ? '↑' : '↓') : '↕';

  return `<button class="sortable-header" type="button" data-city-ranking-sort="${escapeHtml(key)}" aria-sort="${active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}"><span>${escapeHtml(label)}</span><span class="sort-indicator">${escapeHtml(indicator)}</span></button>`;
}

function renderCityRankingTableRows(rows = []) {
  if (rows.length === 0) {
    return '';
  }

  return rows
    .map(
      (row) => `<tr>
  <td>${escapeHtml(row.city)}</td>
  <td class="number-cell">${escapeHtml(formatNumber(row.orderedShifts))}</td>
  <td class="number-cell">${escapeHtml(formatNumber(row.workplaceCount))}</td>
  <td class="number-cell">${escapeHtml(formatNumber(row.brandCount))}</td>
  <td class="number-cell">${escapeHtml(formatPercent(row.slaPercent))}</td>
</tr>`
    )
    .join('');
}

function renderCityRankingSection(dashboard, currentUser) {
  const ranking = dashboard.cityRanking || {};
  const rows = Array.isArray(ranking.summaryRows) ? ranking.summaryRows : [];
  const rawRows = Array.isArray(ranking.rows) ? ranking.rows : [];
  const brands = Array.isArray(ranking.brands) ? ranking.brands : [];
  const emptyStyle = rows.length === 0 ? ' style="display:block"' : '';

  return `<section class="section" data-city-ranking-table data-city-ranking-json="${safeJsonAttribute(rawRows)}">
  ${renderMetricPanelHead('Рейтинг актуальных городов с заказами', 'city-analysis.city-ranking', currentUser)}
  <div class="city-ranking-toolbar">
    <div class="field">
      <label for="cityRankingBrand">Бренд</label>
      <select id="cityRankingBrand" data-city-ranking-brand>${renderCityRankingBrandOptions(brands)}</select>
    </div>
    <button class="secondary-button" type="button" data-city-ranking-export>Выгрузить в Excel</button>
    <div class="city-ranking-meta" data-city-ranking-meta>Городов: ${escapeHtml(formatNumber(rows.length))}</div>
  </div>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>${renderCityRankingSortButton('city', 'Город', 'orderedShifts')}</th>
          <th>${renderCityRankingSortButton('orderedShifts', 'Заказ', 'orderedShifts')}</th>
          <th>${renderCityRankingSortButton('workplaceCount', 'Точки с заказами', 'orderedShifts')}</th>
          <th>${renderCityRankingSortButton('brandCount', 'Бренды', 'orderedShifts')}</th>
          <th>${renderCityRankingSortButton('slaPercent', 'SLA', 'orderedShifts')}</th>
        </tr>
      </thead>
      <tbody data-city-ranking-body>${renderCityRankingTableRows(rows)}</tbody>
    </table>
  </div>
  <p class="empty city-ranking-empty"${emptyStyle} data-city-ranking-empty>Нет городов с заказами за выбранный период.</p>
</section>`;
}

function renderCityRankingProgressiveSection(filters) {
  const rankingFilters = {
    from: filters.from,
    to: filters.to
  };

  return `<div data-dashboard-fragment-url="${escapeHtml(cityAnalysisSectionUrl(rankingFilters, 'city-ranking'))}">
  <section class="section">
    <h2>Рейтинг актуальных городов с заказами</h2>
    <p class="loading">Загружается</p>
  </section>
</div>`;
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

  if (section === 'city-ranking') {
    return renderCityRankingSection(dashboard, currentUser);
  }

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
    return renderCityDynamics(dashboard.dynamics, currentUser);
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

const CITY_DYNAMIC_METRICS = [
  {
    label: 'Заказ',
    key: 'orderedShifts',
    digits: 0,
    className: 'city-series-demand',
    lineMetricId: 'city-analysis.dynamics.line-ordered-shifts',
    barMetricId: 'city-analysis.dynamics.bar-ordered-shifts'
  },
  {
    label: 'Входы',
    key: 'appActiveUsers',
    digits: 0,
    className: 'city-series-app',
    lineMetricId: 'city-analysis.dynamics.line-app-active-users',
    barMetricId: 'city-analysis.dynamics.bar-app-active-users'
  },
  {
    label: 'Отклики',
    key: 'bookedUsers',
    digits: 0,
    className: 'city-series-booked',
    lineMetricId: 'city-analysis.dynamics.line-booked-users',
    barMetricId: 'city-analysis.dynamics.bar-booked-users'
  },
  {
    label: 'Завершения',
    key: 'completedUsers',
    digits: 0,
    className: 'city-series-completed',
    lineMetricId: 'city-analysis.dynamics.line-completed-users',
    barMetricId: 'city-analysis.dynamics.bar-completed-users'
  },
  {
    label: 'Актив/заявка',
    key: 'activeUsersPerRequest',
    digits: 1,
    className: 'city-series-ratio',
    lineMetricId: 'city-analysis.dynamics.line-active-users-per-request',
    barMetricId: 'city-analysis.dynamics.bar-active-users-per-request'
  }
];

function cityDynamicMetricVariant(metricIdKey) {
  return CITY_DYNAMIC_METRICS.map((metric) => ({
    label: metric.label,
    key: metric.key,
    digits: metric.digits,
    className: metric.className,
    metricId: metric[metricIdKey]
  }));
}

const CITY_LINE_DYNAMIC_METRICS = cityDynamicMetricVariant('lineMetricId');
const CITY_BAR_DYNAMIC_METRICS = cityDynamicMetricVariant('barMetricId');

function cssPercent(value) {
  return escapeHtml(formatNumber(clampPercent(value), 1).replace(',', '.'));
}

function maxCityDynamicValue(rows, key) {
  return Math.max(...rows.map((row) => Number(row[key]) || 0), 0);
}

function cityDynamicWidth(value, maxValue) {
  return maxValue > 0 ? ((Number(value) || 0) / maxValue) * 100 : 0;
}

function cityLineValue(row, metric) {
  const value = Number(row[metric.key]);

  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function cityLineX(index, count, left, width) {
  if (count <= 1) {
    return left + width / 2;
  }

  return left + (width * index) / (count - 1);
}

function cityLineY(value, maxValue, top, height) {
  if (maxValue <= 0) {
    return top + height;
  }

  return top + (1 - value / maxValue) * height;
}

function cityLinePoint(value) {
  return formatNumber(value, 2).replace(',', '.');
}

function cityLineTickIndexes(rowCount) {
  if (rowCount <= 8) {
    return Array.from({ length: rowCount }, (_, index) => index);
  }

  const lastIndex = rowCount - 1;
  const indexes = new Set([
    0,
    Math.round(lastIndex * 0.25),
    Math.round(lastIndex * 0.5),
    Math.round(lastIndex * 0.75),
    lastIndex
  ]);

  return Array.from(indexes).sort((left, right) => left - right);
}

function renderCityLineGrid({ width, height, left, right, top, bottom, rows }) {
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const horizontalLines = [0, 0.25, 0.5, 0.75, 1]
    .map((ratio) => {
      const y = top + plotHeight * ratio;

      return `<line class="city-line-grid" x1="${cityLinePoint(left)}" y1="${cityLinePoint(y)}" x2="${cityLinePoint(width - right)}" y2="${cityLinePoint(y)}"></line>`;
    })
    .join('');
  const ticks = cityLineTickIndexes(rows.length)
    .map((index) => {
      const x = cityLineX(index, rows.length, left, plotWidth);
      const label = String(rows[index].period || '').slice(5) || String(rows[index].period || '');

      return `<g>
  <line class="city-line-grid" x1="${cityLinePoint(x)}" y1="${cityLinePoint(top)}" x2="${cityLinePoint(x)}" y2="${cityLinePoint(top + plotHeight)}"></line>
  <text class="city-line-label" x="${cityLinePoint(x)}" y="${cityLinePoint(height - 14)}" text-anchor="middle">${escapeHtml(label)}</text>
</g>`;
    })
    .join('');

  return `${horizontalLines}${ticks}
<line class="city-line-axis" x1="${cityLinePoint(left)}" y1="${cityLinePoint(top + plotHeight)}" x2="${cityLinePoint(width - right)}" y2="${cityLinePoint(top + plotHeight)}"></line>
<line class="city-line-axis" x1="${cityLinePoint(left)}" y1="${cityLinePoint(top)}" x2="${cityLinePoint(left)}" y2="${cityLinePoint(top + plotHeight)}"></line>`;
}

function renderCityLineSeries(rows, metric, dimensions) {
  const maxValue = Math.max(...rows.map((row) => cityLineValue(row, metric)), 0);
  const points = rows
    .map((row, index) => {
      const x = cityLineX(index, rows.length, dimensions.left, dimensions.plotWidth);
      const y = cityLineY(cityLineValue(row, metric), maxValue, dimensions.top, dimensions.plotHeight);

      return `${cityLinePoint(x)},${cityLinePoint(y)}`;
    })
    .join(' ');
  const pointMarkers = rows
    .map((row, index) => {
      const value = cityLineValue(row, metric);
      const x = cityLineX(index, rows.length, dimensions.left, dimensions.plotWidth);
      const y = cityLineY(value, maxValue, dimensions.top, dimensions.plotHeight);

      return `<circle class="city-line-point ${escapeHtml(metric.className)}" data-city-dynamic-series="${escapeHtml(metric.key)}" cx="${cityLinePoint(x)}" cy="${cityLinePoint(y)}" r="3.5">
  <title>${escapeHtml(`${row.period}: ${metric.label} ${formatNumber(value, metric.digits)}`)}</title>
</circle>`;
    })
    .join('');

  return `<polyline class="city-line-series ${escapeHtml(metric.className)}" data-city-dynamic-series="${escapeHtml(metric.key)}" points="${escapeHtml(points)}">
  <title>${escapeHtml(metric.label)}</title>
</polyline>${pointMarkers}`;
}

function renderCityLineLegend(rows, currentUser) {
  return `<div class="city-line-legend">${CITY_LINE_DYNAMIC_METRICS
    .map((metric) => {
      const lastRow = rows[rows.length - 1] || {};
      const lastValue = cityLineValue(lastRow, metric);

      return renderMetricInfoScope({
        className: 'city-line-legend-item',
        metricId: metric.metricId,
        currentUser,
        attributes: `data-city-dynamic-legend-item="${escapeHtml(metric.key)}"`,
        content: `<button type="button" class="city-series-toggle" data-city-dynamic-series-toggle="${escapeHtml(metric.key)}" aria-pressed="false">
<span class="city-line-swatch ${escapeHtml(metric.className)}"></span>
<span>${escapeHtml(metric.label)}</span>
<span class="city-line-legend-value">${escapeHtml(formatNumber(lastValue, metric.digits))}</span>
</button>`
      });
    })
    .join('')}</div>`;
}

function renderCityLineChart(rows, currentUser) {
  if (rows.length === 0) {
    return `<article class="mini-panel city-line-chart">
  <h3>По дням</h3>
  ${renderEmptyDashboardTable()}
</article>`;
  }

  const width = 760;
  const height = 280;
  const dimensions = {
    left: 54,
    right: 24,
    top: 18,
    bottom: 44
  };

  dimensions.plotWidth = width - dimensions.left - dimensions.right;
  dimensions.plotHeight = height - dimensions.top - dimensions.bottom;

  return `<article class="mini-panel city-line-chart">
  <h3>По дням</h3>
  <span hidden>${escapeHtml(rows.map(cityDynamicsMeta).join(' | '))}</span>
  <div class="city-line-chart-scroll">
    <svg class="city-line-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Динамика города по показателям">
      ${renderCityLineGrid({ width, height, rows, ...dimensions })}
      ${CITY_LINE_DYNAMIC_METRICS.map((metric) => renderCityLineSeries(rows, metric, dimensions)).join('')}
    </svg>
  </div>
  ${renderCityLineLegend(rows, currentUser)}
</article>`;
}

function renderCityBarLegend(rows, currentUser) {
  return `<div class="city-bar-legend">${CITY_BAR_DYNAMIC_METRICS
    .map((metric) => {
      const lastRow = rows[rows.length - 1] || {};
      const lastValue = cityLineValue(lastRow, metric);

      return renderMetricInfoScope({
        className: 'city-bar-legend-item',
        metricId: metric.metricId,
        currentUser,
        attributes: `data-city-dynamic-legend-item="${escapeHtml(metric.key)}"`,
        content: `<button type="button" class="city-series-toggle" data-city-dynamic-series-toggle="${escapeHtml(metric.key)}" aria-pressed="false">
<span class="city-bar-swatch ${escapeHtml(metric.className)}"></span>
<span>${escapeHtml(metric.label)}</span>
<span class="city-bar-legend-value">${escapeHtml(formatNumber(lastValue, metric.digits))}</span>
</button>`
      });
    })
    .join('')}</div>`;
}

function renderCityBarChart(rows, currentUser) {
  if (rows.length === 0) {
    return `<article class="mini-panel city-bar-chart">
  <h3>По дням</h3>
  ${renderEmptyDashboardTable()}
</article>`;
  }

  const maxByMetric = new Map(
    CITY_BAR_DYNAMIC_METRICS.map((metric) => [
      metric.key,
      Math.max(...rows.map((row) => cityLineValue(row, metric)), 0)
    ])
  );
  const dayColumns = rows
    .map((row) => {
      const period = String(row.period || '');
      const dateLabel = period.slice(5) || period;
      const columns = CITY_BAR_DYNAMIC_METRICS.map((metric) => {
        const value = cityLineValue(row, metric);
        const maxValue = maxByMetric.get(metric.key) || 0;
        const height = maxValue > 0 ? (value / maxValue) * 100 : 0;
        const title = `${period}: ${metric.label} ${formatNumber(value, metric.digits)}`;
        const emptyClass = value > 0 ? '' : ' city-bar-fill-empty';

        return `<div class="city-bar-column" data-city-dynamic-series="${escapeHtml(metric.key)}" title="${escapeHtml(title)}">
  <span class="city-bar-fill ${escapeHtml(metric.className)}${emptyClass}" style="height: ${cssPercent(height)}%"></span>
</div>`;
      }).join('');

      return `<div class="city-bar-day">
  <span hidden>${escapeHtml(cityDynamicsMeta(row))}</span>
  <div class="city-bar-series">${columns}</div>
  <div class="city-bar-date">${escapeHtml(dateLabel)}</div>
</div>`;
    })
    .join('');

  return `<article class="mini-panel city-bar-chart">
  <h3>По дням</h3>
  <div class="city-bar-chart-scroll">
    <div class="city-bar-chart-grid">${dayColumns}</div>
  </div>
  ${renderCityBarLegend(rows, currentUser)}
</article>`;
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

function renderCityDynamics(dynamics, currentUser) {
  const rows = safeRows(dynamics).map((row) => ({
    ...row,
    label: row.period
  }));

  return `<section class="section">
  ${renderMetricPanelHead('Динамика', 'city-analysis.dynamics', currentUser)}
  <div class="city-chart-variant-tabs" data-city-dynamic-chart data-city-dynamic-has-selection="0" data-city-dynamic-selected-series="">
    <input class="city-chart-variant-input" type="radio" id="city-dynamics-chart-line" name="city-dynamics-chart-variant" checked>
    <input class="city-chart-variant-input" type="radio" id="city-dynamics-chart-bar" name="city-dynamics-chart-variant">
    <div class="city-chart-variant-list" role="tablist" aria-label="Вариант графика динамики">
      <label class="city-chart-variant-tab" for="city-dynamics-chart-line">Линии</label>
      <label class="city-chart-variant-tab" for="city-dynamics-chart-bar">Столбцы</label>
    </div>
    <div class="city-chart-variant-panels">
      <div class="city-chart-variant-panel city-chart-variant-panel-line">${renderCityLineChart(rows, currentUser)}</div>
      <div class="city-chart-variant-panel city-chart-variant-panel-bar">${renderCityBarChart(rows, currentUser)}</div>
    </div>
  </div>
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

  return `${noCoordinatesWarning}${renderCityComposition(dashboard.composition, currentUser)}${renderCityDynamics(dashboard.dynamics, currentUser)}`;
}

function renderCityRankingPeriodForm(filters) {
  return `<section class="section">
  <form class="filter-bar" action="/dashboards/city-analysis" method="get">
    <input type="hidden" name="tab" value="ranking">
    <div class="field">
      <label for="cityRankingFrom">С</label>
      <input id="cityRankingFrom" name="from" type="date" value="${escapeHtml(rangeFilterValue(filters.from))}">
    </div>
    <div class="field">
      <label for="cityRankingTo">По</label>
      <input id="cityRankingTo" name="to" type="date" value="${escapeHtml(rangeFilterValue(filters.to))}">
    </div>
    <button type="submit">Применить</button>
  </form>
</section>`;
}

function renderCityAnalysisFilterSection(dashboard, currentUser, progressive) {
  const filters = dashboard.filters || {};
  const summary = dashboard.summary || {};

  return `<section class="section">
  <form class="filter-bar" action="/dashboards/city-analysis" method="get">
    <input type="hidden" name="tab" value="city">
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
</section>`;
}

function renderCityDashboardTabs(dashboard, currentUser, progressive) {
  const filters = dashboard.filters || {};
  const activeTab = String(filters.city || '') === '' ? 'ranking' : 'city';
  const rankingContent = progressive
    ? renderCityRankingProgressiveSection(filters)
    : renderCityRankingSection(dashboard, currentUser);
  const cityContent = progressive
    ? renderCityProgressiveSections(dashboard)
    : renderCityAnalysisResultSections(dashboard, currentUser);

  return `<div class="city-dashboard-tabs">
  <input class="city-dashboard-tab-input" id="city-dashboard-tab-ranking" type="radio" name="cityDashboardTab"${activeTab === 'ranking' ? ' checked' : ''}>
  <input class="city-dashboard-tab-input" id="city-dashboard-tab-city" type="radio" name="cityDashboardTab"${activeTab === 'city' ? ' checked' : ''}>
  <div class="city-dashboard-tab-list" role="tablist" aria-label="Разделы анализа городов">
    <label class="city-dashboard-tab" for="city-dashboard-tab-ranking" role="tab">Рейтинг городов</label>
    <label class="city-dashboard-tab" for="city-dashboard-tab-city" role="tab">Анализ города</label>
  </div>
  <div class="city-dashboard-panels">
    <div class="city-dashboard-panel city-dashboard-panel-ranking">
      ${renderCityRankingPeriodForm(filters)}
      ${rankingContent}
    </div>
    <div class="city-dashboard-panel city-dashboard-panel-city">
      ${renderCityAnalysisFilterSection(dashboard, currentUser, progressive)}
      ${cityContent}
    </div>
  </div>
</div>`;
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
  const period = context.periodLabel || `${rangeFilterValue(filters.from)} - ${rangeFilterValue(filters.to)}`;
  const content = `<section class="section">
  <h1>Анализ городов</h1>
  <p class="technical-note">Период: ${escapeHtml(period)} · логика базы: пользователи с последней локацией в радиусе 15 км от точек города.</p>
</section>
${renderCityDashboardTabs(dashboard, currentUser, progressive)}
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

function renderHeatmapWorkerConcentrationLayer(filters) {
  const checked = String((filters && filters.workerConcentrationLayer) || 'off') === 'on'
    ? ' checked'
    : '';

  return `<div class="field">
      <label>Слои карты</label>
      <div class="heatmap-mode-group">
        <label class="heatmap-mode-option"><input type="checkbox" name="workerConcentrationLayer" value="on"${checked}>Концентрация исполнителей</label>
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
  addHeatmapQueryParam(params, 'workerConcentrationLayer', filters.workerConcentrationLayer);

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

function heatmapWorkerConcentrationRows(rows) {
  return safeRows(rows)
    .map((row) => ({
      lat: Number(row.lat),
      lon: Number(row.lon),
      activeUsers: Number(row.activeUsers) || 0,
      intensity: Math.max(0, Math.min(1, Number(row.intensity) || 0))
    }))
    .filter((row) => (
      Number.isFinite(row.lat) &&
      Number.isFinite(row.lon) &&
      row.lat >= -90 &&
      row.lat <= 90 &&
      row.lon >= -180 &&
      row.lon <= 180 &&
      row.activeUsers > 0 &&
      row.intensity > 0
    ));
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

  function workerConcentrationColor(intensity, alpha) {
    var value = Math.max(0, Math.min(1, Number(intensity) || 0));

    if (value >= 0.82) {
      return 'rgba(220, 38, 38, ' + alpha + ')';
    }

    if (value >= 0.58) {
      return 'rgba(249, 115, 22, ' + alpha + ')';
    }

    if (value >= 0.34) {
      return 'rgba(250, 204, 21, ' + alpha + ')';
    }

    if (value >= 0.16) {
      return 'rgba(14, 165, 233, ' + alpha + ')';
    }

    return 'rgba(56, 189, 248, ' + alpha + ')';
  }

  function drawWorkerConcentrationLayer(map, root, concentration) {
    if (!concentration.length) {
      return;
    }

    var pane = map.getPanes().overlayPane;
    var canvas = L.DomUtil.create('canvas', 'worker-concentration-canvas', pane);
    var context = canvas.getContext('2d');

    canvas.style.pointerEvents = 'none';
    canvas.style.opacity = '0.9';
    canvas.style.zIndex = '450';

    function redraw() {
      var size = map.getSize();
      var topLeft = map.containerPointToLayerPoint([0, 0]);

      L.DomUtil.setPosition(canvas, topLeft);
      canvas.width = size.x;
      canvas.height = size.y;
      canvas.style.width = size.x + 'px';
      canvas.style.height = size.y + 'px';
      context.clearRect(0, 0, size.x, size.y);
      context.globalCompositeOperation = 'source-over';

      concentration.forEach(function (cell) {
        var point = map.latLngToContainerPoint([cell.lat, cell.lon]);
        var intensity = Math.max(0, Math.min(1, Number(cell.intensity) || 0));
        if (intensity <= 0) {
          return;
        }
        var radius = Math.max(32, Math.min(128, 32 + intensity * 96));
        var coreAlpha = 0.36 + intensity * 0.44;
        var midAlpha = 0.16 + intensity * 0.26;
        var gradient = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);

        gradient.addColorStop(0, workerConcentrationColor(intensity, coreAlpha));
        gradient.addColorStop(0.46, workerConcentrationColor(intensity, midAlpha));
        gradient.addColorStop(1, workerConcentrationColor(intensity, 0));
        context.fillStyle = gradient;
        context.beginPath();
        context.arc(point.x, point.y, radius, 0, Math.PI * 2);
        context.fill();
      });
    }

    map.on('zoomstart zoom zoomend viewreset move resize moveend', redraw);
    root.dataset.workerConcentrationLayer = 'on';
    redraw();
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
      var workerConcentration = [];

      try {
        points = JSON.parse(root.getAttribute('data-heatmap-points') || '[]');
      } catch (error) {
        points = [];
      }

      try {
        workerConcentration = JSON.parse(root.getAttribute('data-worker-concentration') || '[]');
      } catch (error) {
        workerConcentration = [];
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

      if (points.length === 0 && workerConcentration.length === 0) {
        map.setView([55.751244, 37.618423], 5);
        return;
      }

      var bounds = [];

      workerConcentration.forEach(function (cell) {
        bounds.push([cell.lat, cell.lon]);
      });

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

      drawWorkerConcentrationLayer(map, root, workerConcentration);
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

function renderHeatmapMap(points, filters, currentUser) {
  const rows = safeRows(points);
  const mapPoints = heatmapMapPoints(rows, filters || {});
  const workerConcentration = heatmapWorkerConcentrationRows(
    filters && filters.workerConcentrationLayer === 'on'
      ? (filters.workerConcentration || [])
      : []
  );
  const workerLegend = workerConcentration.length > 0
    ? renderMetricInfoScope({
      className: 'heatmap-legend',
      metricId: 'heatmap.map.worker-concentration',
      currentUser,
      content: `<div class="heatmap-gradient heatmap-gradient-workers"></div>
    <div class="heatmap-legend-labels">
      <span>Ниже концентрация исполнителей</span>
      <span>Выше концентрация исполнителей</span>
    </div>`
    })
    : '';

  if (rows.length === 0 && workerConcentration.length === 0) {
    return `<div class="country-heatmap-panel">
  <p class="empty">Нет точек заказа с координатами за выбранный период.</p>
</div>`;
  }

  return `<div class="country-heatmap-panel">
  <h2>Карта баланса по точкам заказа</h2>
  <div class="country-heatmap-map-wrap">
    <div class="country-heatmap-map" data-heatmap-leaflet-map data-heatmap-points="${escapeHtml(JSON.stringify(mapPoints))}" data-worker-concentration="${escapeHtml(JSON.stringify(workerConcentration))}" role="img" aria-label="Реалистичная карта баланса активной базы и заказа"></div>
  </div>
  <div class="heatmap-legend" aria-hidden="true">
    <div class="heatmap-gradient"></div>
    <div class="heatmap-legend-labels">
      <span>Меньше базы к заказу</span>
      <span>Больше базы к заказу</span>
    </div>
  </div>
  ${workerLegend}
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
  ${renderHeatmapMap(dashboard.points, {
    ...(dashboard.filters || {}),
    workerConcentration: dashboard.workerConcentration || []
  }, currentUser)}
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
    ${renderHeatmapWorkerConcentrationLayer(filters)}
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

function regionAnalysisSectionUrl(filters, section) {
  const params = new URLSearchParams({ section, region: filters.region || '', from: filters.from || '', to: filters.to || '', period: filters.period || 'week' });
  params.set('sort', filters.sort || 'openDemand');
  params.set('direction', filters.direction || 'desc');
  for (const key of ['client', 'profession', 'orderType']) {
    for (const value of filters[key] || []) params.append(key, value);
  }
  return `/dashboards/region-analysis/section?${params.toString()}`;
}

const REGION_GIGER_COHORT_OPTIONS = [
  { value: 'registered', label: 'Только зарегистрировались' },
  { value: 'documents', label: 'Загрузили документы' },
  { value: 'self-employed', label: 'Подтверждена самозанятость' },
  { value: 'applied', label: 'Откликались на задания' },
  { value: 'worked', label: 'Выходили на смены' }
];

function regionAnalysisGigerUrl(filters, path = '/dashboards/region-analysis/gigers') {
  const params = new URLSearchParams({ region: filters.region || '', from: filters.from || '', to: filters.to || '', period: filters.period || 'week' });
  for (const key of ['client', 'profession', 'orderType']) {
    for (const value of filters[key] || []) params.append(key, value);
  }
  params.set('activityMode', filters.activityMode || 'all');
  if (filters.activityFrom) params.set('activityFrom', filters.activityFrom);
  if (filters.activityTo) params.set('activityTo', filters.activityTo);
  for (const cohort of filters.cohort || []) params.append('cohort', cohort);
  return `${path}?${params.toString()}`;
}

function renderRegionCohortFunnel({ rows }) {
  const labels = Object.fromEntries(REGION_GIGER_COHORT_OPTIONS.map((item) => [item.value, item.label]));
  const values = Array.isArray(rows) ? rows : [];
  const total = values.reduce((sum, row) => sum + Number(row.users || 0), 0) || 1;
  return `<section class="section"><h2>Воронка пользователей региона</h2><p class="context-line">Когорты взаимоисключающие: пользователь учитывается только на самой дальней достигнутой стадии.</p><div class="table-wrap"><table><thead><tr><th>Когорта</th><th>Пользователи</th><th>Доля</th></tr></thead><tbody>${values.map((row) => `<tr><td><div style="display:flex;align-items:center;gap:8px"><span style="display:inline-block;height:10px;min-width:8px;width:${Math.max(2, Math.round(Number(row.users || 0) / total * 100))}%;background:#0f766e;border-radius:3px"></span>${escapeHtml(labels[row.cohort] || row.cohort)}</div></td><td>${escapeHtml(formatNumber(row.users || 0))}</td><td>${escapeHtml(formatPercent(Number(row.users || 0) / total * 100))}</td></tr>`).join('')}</tbody></table></div></section>`;
}

function renderRegionMetric(label, value, metricId, currentUser) {
  return renderMetricInfoScope({ className: 'kpi-card', metricId, currentUser, content: `<div class="kpi-label">${escapeHtml(label)}</div><div class="kpi-value">${escapeHtml(value)}</div>` });
}

const REGION_CITY_COLUMNS = [
  { key: 'city', label: 'Город', numeric: false },
  { key: 'orderedShifts', label: 'Заказ' },
  { key: 'openDemand', label: 'Свободный заказ' },
  { key: 'slaPercent', label: 'SLA' },
  { key: 'coveragePercent', label: 'Покрытие' },
  { key: 'workedShifts', label: 'Отработано' },
  { key: 'workplaces', label: 'Точки' }
];

function regionCitySortDirection(filters, column) {
  if (filters.sort === column.key) return filters.direction === 'asc' ? 'desc' : 'asc';
  return column.numeric === false ? 'asc' : 'desc';
}

function renderRegionCityHeaderCell(filters, column) {
  const active = filters.sort === column.key;
  const direction = regionCitySortDirection(filters, column);
  const indicator = active ? `<span class="sort-indicator" aria-hidden="true">${escapeHtml(filters.direction === 'asc' ? '↑' : '↓')}</span>` : '';
  const href = regionAnalysisSectionUrl({ ...filters, sort: column.key, direction }, 'cities');
  return `<th aria-sort="${active ? (filters.direction === 'asc' ? 'ascending' : 'descending') : 'none'}"><a class="sortable-header" data-dashboard-fragment-link data-region-city-sort href="${escapeHtml(href)}"><span>${escapeHtml(column.label)}</span>${indicator}</a></th>`;
}

function renderRegionRows(rows, dimension, filters, currentUser, sortable = false) {
  if (!rows.length) return '<p class="empty">Нет данных для выбранного региона и периода.</p>';
  const headers = sortable
    ? REGION_CITY_COLUMNS.map((column) => renderRegionCityHeaderCell(filters, column)).join('')
    : `<th>${escapeHtml(dimension === 'city' ? 'Город' : 'Специальность')}</th><th>Заказ</th><th>Свободный заказ</th><th>SLA</th><th>Покрытие</th><th>Отработано</th><th>Точки</th>`;
  return `<div class="table-wrap"><table><thead><tr>${headers}</tr></thead><tbody>${rows.map((row) => {
    const title = row[dimension] || '';
    const titleHtml = dimension === 'city'
      ? `<a href="/dashboards/city-analysis?city=${encodeURIComponent(title)}&from=${encodeURIComponent(filters.from)}&to=${encodeURIComponent(filters.to)}">${escapeHtml(title)}</a>`
      : escapeHtml(title);
    const base = `region-analysis.${dimension === 'city' ? 'cities' : 'professions'}`;
    return `<tr><td>${titleHtml}</td>${numberCell(row.orderedShifts, 0, `${base}.ordered-shifts`, currentUser)}${numberCell(row.openDemand, 0, `${base}.open-demand`, currentUser)}${percentCell(row.slaPercent, `${base}.sla`, currentUser)}${percentCell(row.coveragePercent, `${base}.coverage`, currentUser)}${numberCell(row.workedShifts, 0, `${base}.worked-shifts`, currentUser)}${numberCell(row.workplaces, 0, `${base}.workplaces`, currentUser)}</tr>`;
  }).join('')}</tbody></table></div>`;
}

function renderRegionAnalysisDashboardSection({ dashboard, section, currentUser }) {
  if (section === 'summary') {
    const s = dashboard.summary || {};
    return `<section class="section">${renderMetricPanelHead('Основные показатели', 'region-analysis.summary', currentUser)}<div class="kpi-grid">${renderRegionMetric('Заказано смен', formatNumber(s.orderedShifts), 'region-analysis.summary.ordered-shifts', currentUser)}${renderRegionMetric('Свободный заказ', formatNumber(s.openDemand), 'region-analysis.summary.open-demand', currentUser)}${renderRegionMetric('SLA', formatPercent(s.slaPercent), 'region-analysis.summary.sla', currentUser)}${renderRegionMetric('Покрытие', formatPercent(s.coveragePercent), 'region-analysis.summary.coverage', currentUser)}${renderRegionMetric('Отработано смен', formatNumber(s.workedShifts), 'region-analysis.summary.worked-shifts', currentUser)}${renderRegionMetric('Отмены', formatNumber(s.cancelledShifts), 'region-analysis.summary.cancelled-shifts', currentUser)}</div></section>`;
  }
  if (section === 'cities') return `<section class="section">${renderMetricPanelHead('Города региона', 'region-analysis.cities', currentUser)}${renderRegionRows(dashboard.cityRows || [], 'city', dashboard.filters || {}, currentUser, true)}</section>`;
  if (section === 'professions') return `<section class="section">${renderMetricPanelHead('Специальности', 'region-analysis.professions', currentUser)}${renderRegionRows(dashboard.professionRows || [], 'profession', dashboard.filters || {}, currentUser)}</section>`;
  if (section === 'attention') return `<section class="section">${renderMetricPanelHead('Требуют внимания', 'region-analysis.attention', currentUser)}<p class="context-line">Города с незакрытым спросом, отсортированные по его объёму.</p>${renderRegionRows(dashboard.attentionRows || [], 'city', dashboard.filters || {}, currentUser)}</section>`;
  const rows = dashboard.trendRows || [];
  return `<section class="section">${renderMetricPanelHead('Динамика', 'region-analysis.trend', currentUser)}<div class="table-wrap"><table><thead><tr><th>Период</th><th>Заказ</th><th>Свободный заказ</th><th>SLA</th><th>Покрытие</th><th>Отработано</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.period || '')}</td>${numberCell(row.orderedShifts, 0, 'region-analysis.trend.ordered-shifts', currentUser)}${numberCell(row.openDemand, 0, 'region-analysis.trend.open-demand', currentUser)}${percentCell(row.slaPercent, 'region-analysis.trend.sla', currentUser)}${percentCell(row.coveragePercent, 'region-analysis.trend.coverage', currentUser)}${numberCell(row.workedShifts, 0, 'region-analysis.trend.worked-shifts', currentUser)}</tr>`).join('')}</tbody></table></div></section>`;
}

function renderRegionAnalysisDashboard({ database, dashboard, progressive = false, currentUser, csrfToken }) {
  const filters = dashboard.filters || {};
  const options = (dashboard.regionOptions || []).map((region) => `<option value="${escapeHtml(region)}"${region === filters.region ? ' selected' : ''}>${escapeHtml(region)}</option>`).join('');
  const brandField = renderMultiSelectField({ id: 'client', label: 'Бренды', options: dashboard.brandOptions || [], selected: filters.client || [] });
  const brandHiddenFields = (filters.client || []).map((brand) => `<input type="hidden" name="client" value="${escapeHtml(brand)}">`).join('');
  const gigerControl = filters.region ? `<div class="context-line">${renderGigerDetailTrigger('Исполнители региона', regionAnalysisGigerUrl(filters))}</div>` : '';
  const cohortField = renderMultiSelectField({ id: 'cohort', label: 'Когорты', options: REGION_GIGER_COHORT_OPTIONS.map((item) => item.value), selected: filters.cohort || [], labelForValue: (value) => (REGION_GIGER_COHORT_OPTIONS.find((item) => item.value === value) || {}).label || value });
  const cohortForm = filters.region ? `<form class="filter-bar" action="/dashboards/region-analysis" method="get"><input type="hidden" name="region" value="${escapeHtml(filters.region)}"><input type="hidden" name="from" value="${escapeHtml(filters.from || '')}"><input type="hidden" name="to" value="${escapeHtml(filters.to || '')}"><input type="hidden" name="period" value="${escapeHtml(filters.period || 'week')}">${brandHiddenFields}<div class="field"><label for="activityMode">Последний вход</label><select id="activityMode" name="activityMode"><option value="all"${filters.activityMode === 'all' ? ' selected' : ''}>За всё время</option><option value="range"${filters.activityMode === 'range' ? ' selected' : ''}>В периоде</option></select></div><div class="field"><label for="activityFrom">Вход с</label><input id="activityFrom" name="activityFrom" type="date" value="${escapeHtml(filters.activityFrom || '')}"></div><div class="field"><label for="activityTo">Вход по</label><input id="activityTo" name="activityTo" type="date" value="${escapeHtml(filters.activityTo || '')}"></div>${cohortField}<button type="submit">Применить фильтры выгрузки</button></form>` : '';
  const funnel = filters.region ? `<div data-dashboard-fragment-url="${escapeHtml(regionAnalysisGigerUrl(filters, '/dashboards/region-analysis/cohort-funnel'))}"><section class="section"><h2>Воронка пользователей региона</h2><p class="loading">Считаем воронку пользователей…</p></section></div>` : '';
  const sections = ['summary', 'trend', 'cities', 'professions', 'attention'];
  const body = filters.region === ''
    ? '<section class="section"><p class="empty">Выберите регион, чтобы увидеть спрос, выполнение и проблемные города.</p></section>'
    : sections.map((section) => progressive ? `<div data-dashboard-fragment-url="${escapeHtml(regionAnalysisSectionUrl(filters, section))}"><section class="section"><h2>${escapeHtml({ summary: 'Основные показатели', trend: 'Динамика', cities: 'Города региона', professions: 'Специальности', attention: 'Требуют внимания' }[section])}</h2><p class="loading">Загружается</p></section></div>` : renderRegionAnalysisDashboardSection({ dashboard, section, currentUser })).join('');
  return layout({ title: 'Анализ регионов', database, activeNav: 'region-analysis', currentUser, csrfToken, content: `<section class="section"><h1>Анализ регионов</h1><p class="technical-note">Регион определяется по адресу рабочей точки. Данные включают только актуальные заказы.</p><form class="filter-bar" action="/dashboards/region-analysis" method="get"><div class="field"><label for="region">Регион</label><select id="region" name="region"><option value="">Выберите регион</option>${options}</select></div>${brandField}<div class="field"><label for="from">С</label><input id="from" name="from" type="date" value="${escapeHtml(filters.from || '')}"></div><div class="field"><label for="to">По</label><input id="to" name="to" type="date" value="${escapeHtml(filters.to || '')}"></div><div class="field"><label for="period">Группировка</label><select id="period" name="period">${['day', 'week', 'month'].map((value) => `<option value="${value}"${filters.period === value ? ' selected' : ''}>${({ day: 'День', week: 'Неделя', month: 'Месяц' })[value]}</option>`).join('')}</select></div><button type="submit">Применить</button></form>${cohortForm}${gigerControl}</section>${funnel}${body}${renderGigerListModal()}` });
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
  renderBrandAnalysisDashboard,
  renderBrandAnalysisReviews,
  renderBrandAnalysisDashboardSection,
  renderDashboardSectionError,
  renderDashboardSectionRefreshing,
  renderError,
  renderGigerDetails,
  renderGigerDetailsWorkbook,
  renderCityAnalysisDashboard: renderCityAnalysisDashboardPage,
  renderCityAnalysisDashboardSection,
  renderCityAnalysisSectionError,
  renderRegionAnalysisDashboard,
  renderRegionAnalysisDashboardSection,
  renderRegionCohortFunnel,
  renderHeatmapDashboard,
  renderHeatmapDashboardSection,
  renderHome,
  renderLogin,
  renderMailSettingsPage,
  renderPasswordChange,
  renderPreloadManagement,
  renderRequestReportMissingConfirmedPage,
  renderRequestReportMissingConfirmedResult,
  renderSalesByProjectDashboard,
  renderSalesByProjectDashboardSection,
  renderScheduledReportsPage,
  renderTable,
  renderUnderageCompletedShiftsDashboard,
  renderUnderageCompletedShiftsDashboardSection,
  renderUserActivityDashboard,
  renderWorkerBlacklistDetails,
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
