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

function layout({ title, database, content, activeNav = 'tables' }) {
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

    .database,
    .muted,
    .empty,
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

    tr:last-child td {
      border-bottom: 0;
    }

    .number-cell {
      text-align: right;
      white-space: nowrap;
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

    .points-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 12px;
    }

    .point-card {
      min-width: 0;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
    }

    .point-card-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 8px;
    }

    .point-title {
      font-weight: 700;
      line-height: 1.25;
      overflow-wrap: anywhere;
    }

    .stability-badge {
      flex: 0 0 auto;
      border-radius: 999px;
      padding: 2px 7px;
      background: var(--accent-bg);
      color: var(--accent);
      font-size: 12px;
      font-weight: 700;
      white-space: nowrap;
    }

    .point-subtitle {
      min-height: 40px;
      margin-bottom: 10px;
      color: var(--muted);
      font-size: 13px;
      overflow-wrap: anywhere;
    }

    .point-metrics {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
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
      grid-template-columns: repeat(auto-fill, minmax(10px, 1fr));
      gap: 3px;
      align-items: center;
    }

    .heatmap-cell {
      aspect-ratio: 1;
      min-width: 10px;
      border-radius: 2px;
      background: #e5e7eb;
    }

    .heatmap-cell[data-level="1"] { background: #bfdbfe; }
    .heatmap-cell[data-level="2"] { background: #60a5fa; }
    .heatmap-cell[data-level="3"] { background: #2563eb; }
    .heatmap-cell[data-level="4"] { background: #1d4ed8; }

    .heatmap-legend {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 5px;
      margin-top: 8px;
      color: var(--muted);
      font-size: 12px;
    }

    .legend-cell {
      width: 10px;
      height: 10px;
      border-radius: 2px;
      background: #e5e7eb;
    }

    .legend-cell[data-level="1"] { background: #bfdbfe; }
    .legend-cell[data-level="2"] { background: #60a5fa; }
    .legend-cell[data-level="3"] { background: #2563eb; }
    .legend-cell[data-level="4"] { background: #1d4ed8; }

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

      button {
        width: 100%;
      }
    }
  </style>
</head>
<body>
  <div class="app-shell">
    <aside class="sidebar" aria-label="Основная навигация">
      <div class="sidebar-title">ETL Analytics</div>
      <nav class="nav-list">
        ${navLink({ href: '/', label: 'Таблицы', id: 'tables', activeNav })}
        ${navLink({
          href: '/dashboards/sales-by-project',
          label: 'Продажи по проектам',
          id: 'sales-by-project',
          activeNav
        })}
        ${navLink({
          href: '/dashboards/workplace-analysis',
          label: 'Анализ точек',
          id: 'workplace-analysis',
          activeNav
        })}
      </nav>
    </aside>
    <div class="page-shell">
      <header>
        <div class="topbar">
          <div class="app-title">ETL Analytics</div>
          <div class="database">Database: ${escapeHtml(database)}</div>
        </div>
      </header>
      <main>${content}</main>
    </div>
  </div>
</body>
</html>`;
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

function formatPercent(value) {
  return `${formatNumber(value, 1).replace(',', '.')}%`;
}

function renderHome({ database, tables }) {
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

  return layout({ title: 'Tables', database, content });
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

function renderTable({ database, tableName, columns, rows }) {
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

  return layout({ title: tableName, database, content });
}

function renderKpiCards(summary) {
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

  return `<div class="kpi-grid">${cards
    .map(
      ([label, value]) => `<div class="kpi-card">
  <div class="kpi-label">${escapeHtml(label)}</div>
  <div class="kpi-value">${escapeHtml(value)}</div>
</div>`
    )
    .join('')}</div>`;
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

function numberCell(value, digits = 0) {
  return `<td class="number-cell">${escapeHtml(formatNumber(value, digits))}</td>`;
}

function percentCell(value) {
  return `<td class="number-cell">${escapeHtml(formatPercent(value))}</td>`;
}

function clampPercent(value) {
  const number = Number(value) || 0;

  return Math.max(0, Math.min(100, number));
}

function renderTrendRows(rows) {
  if (rows.length === 0) {
    return renderEmptyDashboardTable();
  }

  const maxWorked = Math.max(...rows.map((row) => Number(row.workedShifts) || 0), 0);
  const bodyRows = rows
    .map((row) => {
      const width = maxWorked > 0 ? clampPercent(((Number(row.workedShifts) || 0) / maxWorked) * 100) : 0;

      return `<tr>
  <td>${escapeHtml(row.period)}</td>
  ${numberCell(row.orderedShifts)}
  ${numberCell(row.workedShifts)}
  ${percentCell(row.slaPercent)}
  ${numberCell(row.revenueRub)}
  ${numberCell(row.cancelledShifts)}
  <td class="bar-cell"><div class="bar-track"><div class="bar-fill" style="width: ${escapeHtml(formatNumber(width, 1).replace(',', '.'))}%"></div></div></td>
</tr>`;
    })
    .join('');

  return `<div class="table-wrap"><table>
  <thead><tr><th>Период</th><th>Заказано</th><th>Отработано</th><th>SLA</th><th>Выручка</th><th>Отмены</th><th>Динамика</th></tr></thead>
  <tbody>${bodyRows}</tbody>
</table></div>`;
}

function renderBrandRows(rows) {
  if (rows.length === 0) {
    return renderEmptyDashboardTable();
  }

  const bodyRows = rows
    .map(
      (row) => `<tr>
  <td>${escapeHtml(row.brand)}</td>
  ${numberCell(row.orderedShifts)}
  ${numberCell(row.workedShifts)}
  ${percentCell(row.slaPercent)}
  ${numberCell(row.revenueRub)}
  ${numberCell(row.uniqueWorkers)}
  ${numberCell(row.workplacesWithOrders)}
  ${numberCell(row.workplacesWithWorkedShifts)}
  ${numberCell(row.cancelledShifts)}
  ${percentCell(row.selfBookingPercent)}
  ${numberCell(row.avgWorkerRateHour)}
</tr>`
    )
    .join('');

  return `<div class="table-wrap"><table>
  <thead><tr><th>Бренд</th><th>Заказано</th><th>Отработано</th><th>SLA</th><th>Выручка</th><th>Гигеры</th><th>ТТ с заказами</th><th>ТТ выполнены</th><th>Отмены</th><th>Самоброни</th><th>Ставка/час</th></tr></thead>
  <tbody>${bodyRows}</tbody>
</table></div>`;
}

function renderStatusRows(rows) {
  if (rows.length === 0) {
    return renderEmptyDashboardTable();
  }

  const bodyRows = rows
    .map(
      (row) => `<tr>
  <td>${escapeHtml(row.status)}</td>
  ${numberCell(row.shifts)}
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

function renderSalesByProjectDashboard({ database, dashboard }) {
  const filters = dashboard.filters;
  const content = `<section class="section">
  <h1>Продажи по проектам</h1>
  <p class="technical-note">Проект = бренд клиента. Заказано считается из mg_orders.amount. Факт, статусы и самоброни считаются из mg_job_history.</p>
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
  ${renderKpiCards(dashboard.summary)}
</section>
<section class="section">
  <h2>Динамика</h2>
  ${renderTrendRows(dashboard.trendRows)}
</section>
<section class="section">
  <h2>Бренды</h2>
  ${renderBrandRows(dashboard.brandRows)}
</section>
<section class="section">
  <h2>Статусы работ</h2>
  ${renderStatusRows(dashboard.statusRows)}
</section>`;

  return layout({
    title: 'Продажи по проектам',
    database,
    content,
    activeNav: 'sales-by-project'
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

function renderPointMetric(label, value) {
  return `<div class="point-metric">
  <div class="point-metric-label">${escapeHtml(label)}</div>
  <div class="point-metric-value">${escapeHtml(value)}</div>
</div>`;
}

function renderHeatmap(days) {
  const cells = days
    .map(
      (day) =>
        `<span class="heatmap-cell" data-level="${escapeHtml(day.level)}" title="${escapeHtml(`${day.date}: ${formatNumber(day.amount)}`)}"></span>`
    )
    .join('');

  return `<div class="heatmap" aria-label="Календарь заказов">${cells}</div>
<div class="heatmap-legend">
  <span>Меньше</span>
  <span class="legend-cell" data-level="0"></span>
  <span class="legend-cell" data-level="1"></span>
  <span class="legend-cell" data-level="2"></span>
  <span class="legend-cell" data-level="3"></span>
  <span class="legend-cell" data-level="4"></span>
  <span>Больше</span>
</div>`;
}

function renderPointCard(point) {
  const subtitle = [point.clientTitle, point.city, point.region, point.address]
    .filter((value) => String(value || '').trim() !== '')
    .join(' · ');

  return `<article class="point-card">
  <div class="point-card-head">
    <div class="point-title">${escapeHtml(point.title)}</div>
    <div class="stability-badge">${escapeHtml(formatPercent(point.stabilityPercent))}</div>
  </div>
  <div class="point-subtitle">${escapeHtml(subtitle || 'Без адреса')}</div>
  <div class="point-metrics">
    ${renderPointMetric('Заказано', formatNumber(point.totalOrderedShifts))}
    ${renderPointMetric('Активные дни', `${formatNumber(point.activeDays)} / ${formatNumber(point.rangeDays)}`)}
    ${renderPointMetric('Среднее', formatNumber(point.avgDailyOrder, 1))}
  </div>
  ${renderHeatmap(point.heatmapDays)}
</article>`;
}

function renderPointCards(points) {
  if (points.length === 0) {
    return '<p class="empty">Нет точек с заказами за выбранный период.</p>';
  }

  return `<div class="points-grid">${points.map(renderPointCard).join('')}</div>`;
}

function renderWorkplaceAnalysisDashboard({ database, dashboard }) {
  const filters = dashboard.filters;
  const content = `<section class="section">
  <h1>Анализ точек</h1>
  <p class="technical-note">Стабильность = доля дней с плановым заказом по mg_orders.amount.</p>
  <p class="context-line">Период: ${escapeHtml(filters.from)} - ${escapeHtml(filters.to)} · дней: ${escapeHtml(filters.rangeDays)} · ${escapeHtml(dashboard.context.sortLabel)}</p>
</section>
<section class="section">
  <form class="filter-bar" action="/dashboards/workplace-analysis" method="get">
    <div class="field">
      <label for="from">С</label>
      <input id="from" name="from" type="date" value="${escapeHtml(filters.from)}">
    </div>
    <div class="field">
      <label for="to">По</label>
      <input id="to" name="to" type="date" value="${escapeHtml(filters.to)}">
    </div>
    <div class="field">
      <label for="client">Бренд</label>
      <input id="client" name="client" value="${escapeHtml(filters.client)}">
    </div>
    <div class="field">
      <label for="city">Город</label>
      <input id="city" name="city" value="${escapeHtml(filters.city)}">
    </div>
    <div class="field">
      <label for="region">Регион</label>
      <input id="region" name="region" value="${escapeHtml(filters.region)}">
    </div>
    <div class="field">
      <label for="profession">Специальность</label>
      <input id="profession" name="profession" value="${escapeHtml(filters.profession)}">
    </div>
    <div class="field">
      <label for="orderType">Тип заказа</label>
      <select id="orderType" name="orderType">${renderOrderTypeOptions(filters.orderType)}</select>
    </div>
    <div class="field">
      <label for="contractor">Контрагент</label>
      <input id="contractor" name="contractor" value="${escapeHtml(filters.contractor)}">
    </div>
    <div class="field">
      <label for="search">Поиск точки</label>
      <input id="search" name="search" value="${escapeHtml(filters.search)}">
    </div>
    <button type="submit">Применить</button>
  </form>
</section>
<section class="section">
  ${renderPointCards(dashboard.points)}
</section>`;

  return layout({
    title: 'Анализ точек',
    database,
    content,
    activeNav: 'workplace-analysis'
  });
}

function renderError({ database, title, message, activeNav = 'tables' }) {
  const content = `<section class="section">
  <h1>${escapeHtml(title)}</h1>
  <div class="error">${escapeHtml(message)}</div>
</section>`;

  return layout({ title, database, content, activeNav });
}

module.exports = {
  escapeHtml,
  renderError,
  renderHome,
  renderSalesByProjectDashboard,
  renderTable,
  renderWorkplaceAnalysisDashboard
};
