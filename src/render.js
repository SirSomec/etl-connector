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

    @media (max-width: 1120px) {
      .point-detail-grid {
        grid-template-columns: 1fr;
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
        ${navLink({
          href: '/dashboards/city-analysis',
          label: 'Анализ городов',
          id: 'city-analysis',
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
  ${content.includes('data-multi-filter') ? renderMultiFilterScript() : ''}
  ${
    content.includes('data-dashboard-fragment-url') || content.includes('data-city-analysis-fragment-url')
      ? renderDashboardProgressiveScript()
      : ''
  }
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

function renderDashboardProgressiveScript() {
  return `<script>
(function () {
  function replaceWithHtml(root, html) {
    var template = document.createElement('template');

    template.innerHTML = html;
    root.replaceWith(template.content);
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

function renderSalesByProjectDashboardSection({ dashboard, section }) {
  if (section === 'summary') {
    return `<section class="section">
  <h2>Основные показатели</h2>
  ${renderKpiCards(dashboard.summary)}
</section>`;
  }

  if (section === 'trend') {
    return `<section class="section">
  <h2>Динамика</h2>
  ${renderTrendRows(dashboard.trendRows)}
</section>`;
  }

  if (section === 'brands') {
    return `<section class="section">
  <h2>Бренды</h2>
  ${renderBrandRows(dashboard.brandRows)}
</section>`;
  }

  if (section === 'statuses') {
    return `<section class="section">
  <h2>Статусы работ</h2>
  ${renderStatusRows(dashboard.statusRows)}
</section>`;
  }

  return `<section class="section"><div class="error">Неизвестный блок дашборда.</div></section>`;
}

function renderDashboardSectionError({ message }) {
  return `<section class="section"><div class="error">${escapeHtml(message)}</div></section>`;
}

function renderSalesByProjectDashboard({ database, dashboard, progressive = false }) {
  const filters = dashboard.filters;
  const resultsHtml = progressive
    ? renderSalesByProjectProgressiveSections(filters)
    : `<section class="section">
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

function renderPointMetric(label, value) {
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

function renderHeatmap(days) {
  const leadingEmptyCount = days.length > 0 ? weekdayOffsetFromMonday(days[0].date) : 0;
  const totalCells = leadingEmptyCount + days.length;
  const trailingEmptyCount = totalCells > 0 ? (7 - (totalCells % 7)) % 7 : 0;
  const leadingEmptyCells = renderHeatmapEmptyCells(leadingEmptyCount);
  const trailingEmptyCells = renderHeatmapEmptyCells(trailingEmptyCount);
  const cells = days
    .map(
      (day) =>
        `<span class="heatmap-cell" data-level="${escapeHtml(day.level)}" title="${escapeHtml(`${day.date}: заказано ${formatNumber(day.amount)}; выполнено ${formatNumber(day.completedShifts)}`)}"></span>`
    )
    .join('');

  return `<div class="heatmap" aria-label="Календарь заказов">${leadingEmptyCells}${cells}${trailingEmptyCells}</div>`;
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

function renderPointCard(point, filters) {
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
    ${renderHeatmap(point.heatmapDays)}
  </a>
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

function renderPointCards(points, filters) {
  if (points.length === 0) {
    return '<p class="empty">Нет точек с заказами за выбранный период.</p>';
  }

  return `<div class="points-grid">${points.map((point) => renderPointCard(point, filters)).join('')}</div>`;
}

function renderWorkplaceAnalysisPointsSection(dashboard) {
  return `<section class="section">
  ${renderPointCards(dashboard.points || [], dashboard.filters)}
  ${renderWorkplacePagination({ filters: dashboard.filters, pagination: dashboard.pagination })}
</section>`;
}

function formatRadiusWorkerValue(summary, radius) {
  const workers = summary.radiusWorkers ? summary.radiusWorkers[radius] : 0;
  const activeSessionWorkers = summary.radiusActiveSessionWorkers
    ? summary.radiusActiveSessionWorkers[radius]
    : 0;

  return `${formatNumber(workers)} / ${formatNumber(activeSessionWorkers)}`;
}

function renderWorkplacePointKpis(summary) {
  const cards = [
    ['Заказано', formatNumber(summary.orderedShifts)],
    ['Выполнено', formatNumber(summary.completedShifts)],
    ['SLA', formatPercent(summary.slaPercent)],
    ['Стабильность', formatPercent(summary.stabilityPercent)],
    ['Уникальные завершали', formatNumber(summary.uniqueCompletedWorkers)],
    ['Уникальные бронировали', formatNumber(summary.uniqueBookedWorkers)],
    ['Слеты < 24ч', formatNumber(summary.dropoffs24h)],
    ['5 км', formatRadiusWorkerValue(summary, 5)],
    ['10 км', formatRadiusWorkerValue(summary, 10)],
    ['15 км', formatRadiusWorkerValue(summary, 15)],
    ['20 км', formatRadiusWorkerValue(summary, 20)]
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

function renderWorkplacePointSummaryKpis(summary) {
  const cards = [
    ['Заказано', formatNumber(summary.orderedShifts)],
    ['Выполнено', formatNumber(summary.completedShifts)],
    ['SLA', formatPercent(summary.slaPercent)],
    ['Стабильность', formatPercent(summary.stabilityPercent)],
    ['Уникальные завершали', formatNumber(summary.uniqueCompletedWorkers)],
    ['Уникальные бронировали', formatNumber(summary.uniqueBookedWorkers)],
    ['Слеты < 24ч', formatNumber(summary.dropoffs24h)]
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

function renderWorkplacePointRadiusKpis(summary) {
  const cards = [
    [5, '5 км'],
    [10, '10 км'],
    [15, '15 км'],
    [20, '20 км']
  ].map(([radius, label]) => [
    label,
    formatRadiusWorkerValue(summary, radius)
  ]);

  return `<div class="kpi-grid">${cards
    .map(
      ([label, value]) => `<div class="kpi-card">
  <div class="kpi-label">${escapeHtml(label)}</div>
  <div class="kpi-value">${escapeHtml(value)}</div>
</div>`
    )
    .join('')}</div>`;
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

function renderMiniChart({ title, rows, maxValue, valueForRow, labelForRow, textForRow, secondary = false, panelClass = '' }) {
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

      return `<div class="mini-chart-row">
  <div class="mini-chart-label">${escapeHtml(labelForRow(row))}</div>
  <div class="mini-chart-track"><div class="${fillClass}" style="width: ${miniChartWidth(value, maxValue)}%"></div></div>
  <div class="mini-chart-value">${escapeHtml(textForRow(row))}</div>
</div>`;
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

function renderPointCalendarValue(label, value, title = label) {
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

function renderPointCalendarCell(row) {
  const title = `${row.period}: заказ ${formatNumber(row.orderedShifts)}; SLA ${formatPercent(row.slaPercent)}; слеты ${formatNumber(row.dropoffs24h)}; размещение среднее ${formatLeadTimeMinutes(row.orderLeadAvgMinutes)}; размещение минимум ${formatLeadTimeMinutes(row.orderLeadMinMinutes)}`;
  const slaLevel = calendarSlaLevel(row);
  const slaLevelAttribute = slaLevel === null ? '' : ` data-sla-level="${escapeHtml(slaLevel)}"`;

  return `<div class="point-calendar-cell" data-date="${escapeHtml(row.period)}"${slaLevelAttribute} title="${escapeHtml(title)}">
  <div class="point-calendar-date">${escapeHtml(dayLabelFromDateKey(row.period))}</div>
  <div class="point-calendar-values">
    ${renderPointCalendarValue('З', formatNumber(row.orderedShifts), 'Заказ')}
    ${renderPointCalendarValue('SLA', formatPercent(row.slaPercent))}
    ${renderPointCalendarValue('Сл', formatNumber(row.dropoffs24h), 'Слеты')}
    ${renderPointCalendarValue('Ср', formatLeadTimeCompactMinutes(row.orderLeadAvgMinutes), 'Размещение среднее')}
    ${renderPointCalendarValue('М', formatLeadTimeCompactMinutes(row.orderLeadMinMinutes), 'Размещение минимум')}
  </div>
</div>`;
}

function dateKeyFromValue(value) {
  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
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

function renderPointCalendarMonth(group, weekdays) {
  const leadingEmptyCount = weekdayOffsetFromMonday(group.rows[0].period);
  const totalCells = leadingEmptyCount + group.rows.length;
  const trailingEmptyCount = (7 - (totalCells % 7)) % 7;
  const cells = group.rows.map(renderPointCalendarCell).join('');

  return `<div class="point-calendar-month">
    <h3 class="point-calendar-month-title">${escapeHtml(group.label)}</h3>
    <div class="point-calendar-weekdays">${weekdays}</div>
    <div class="point-calendar-grid">${renderPointCalendarEmptyCells(leadingEmptyCount)}${cells}${renderPointCalendarEmptyCells(trailingEmptyCount)}</div>
  </div>`;
}

function renderPointCalendar(rows, filters) {
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
  const months = groupPointCalendarRowsByMonth(calendarRows)
    .map((group) => renderPointCalendarMonth(group, weekdays))
    .join('');

  return `<div class="${detailPanelClass}">
  <h2>Календарь заказа и SLA</h2>
  <div class="point-calendar" aria-label="Календарь заказа, SLA и слетов по дням">
    ${months}
  </div>
</div>`;
}

function renderWorkplacePointCharts(dashboard) {
  const maxProfessionOrders = Math.max(0, ...dashboard.professionRows.map((row) => Number(row.orderedShifts) || 0));

  return `<div class="detail-grid point-detail-grid">
  ${renderPointCalendar(dashboard.dailyRows, dashboard.filters)}
  ${renderMiniChart({
    title: 'Профессии точки',
    rows: dashboard.professionRows,
    maxValue: maxProfessionOrders,
    valueForRow: (row) => row.orderedShifts,
    labelForRow: (row) => row.profession,
    textForRow: (row) => `${formatNumber(row.orderedShifts)} · ${formatPercent(row.sharePercent)}`,
    panelClass: 'profession-panel'
  })}
</div>`;
}

function renderWorkplacePointDashboard({ database, dashboard, progressive = false }) {
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
  ${renderWorkplacePointKpis(dashboard.summary)}
</section>
<section class="section">
  ${renderWorkplacePointCharts(dashboard)}
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
${detailSections}`;

  return layout({
    title: 'Детализация точки',
    database,
    content,
    activeNav: 'workplace-analysis'
  });
}

function renderWorkplacePointDashboardSection({ dashboard, section }) {
  if (section === 'summary') {
    return `<section class="section">
  <h2>Основные показатели</h2>
  ${renderWorkplacePointSummaryKpis(dashboard.summary)}
</section>`;
  }

  if (section === 'radius') {
    return `<section class="section">
  <h2>База вокруг точки</h2>
  ${renderWorkplacePointRadiusKpis(dashboard.summary)}
</section>`;
  }

  if (section === 'charts') {
    return `<section class="section">
  ${renderWorkplacePointCharts(dashboard)}
</section>`;
  }

  return `<section class="section"><div class="error">Неизвестный блок дашборда.</div></section>`;
}

function renderWorkplaceAnalysisDashboard({ database, dashboard, progressive = false }) {
  const filters = dashboard.filters;
  const pointsHtml = progressive
    ? `<div data-dashboard-fragment-url="${escapeHtml(workplaceAnalysisSectionUrl(filters, 'points'))}">
  <section class="section">
    <h2>Точки</h2>
    <p class="loading">Загружается</p>
  </section>
</div>`
    : renderWorkplaceAnalysisPointsSection(dashboard);
  const content = `<section class="section">
  <h1>Анализ точек</h1>
  <p class="technical-note">Стабильность = доля дней с плановым заказом по mg_orders.amount.</p>
  <p class="context-line">Период: ${escapeHtml(filters.from)} - ${escapeHtml(filters.to)} · дней: ${escapeHtml(filters.rangeDays)} · ${escapeHtml(dashboard.context.sortLabel)}</p>
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
    <div class="field">
      <label for="search">Поиск точки</label>
      <input id="search" name="search" value="${escapeHtml(filters.search)}">
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
${pointsHtml}`;

  return layout({
    title: 'Анализ точек',
    database,
    content,
    activeNav: 'workplace-analysis'
  });
}

function renderWorkplaceAnalysisDashboardSection({ dashboard, section }) {
  if (section === 'points') {
    return renderWorkplaceAnalysisPointsSection(dashboard);
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
    { label: 'Откликались', value: formatNumber(summary.bookedUsers) },
    { label: 'Завершали', value: formatNumber(summary.completedUsers) },
    { label: '30д активные / заявка', value: formatNumber(summary.avgDaily30dActiveUsersPerRequest, 1) }
  ];

  return `<div class="kpi-grid">${cards.map((card) => renderCityKpiCard(card)).join('')}</div>`;
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

function renderCityAnalysisDashboardSection({ dashboard, section }) {
  const summary = dashboard.summary || {};
  const context = dashboard.context || {};

  if (section === 'summary-demand') {
    return [
      renderCityKpiCard({ label: 'Заказ', value: formatNumber(summary.orderedShifts) }),
      renderCityKpiCard({
        label: 'Не удаленные заявки',
        value: formatNumber(summary.activeOrderRequests)
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
        detail: coordinateDetail
      }),
      renderCityKpiCard({
        label: 'Активная база',
        value: formatNumber(summary.readyLocatedUsers),
        detail: `ready ${formatNumber(summary.readyStatusLocatedUsers)} · booked ${formatNumber(summary.bookedStatusLocatedUsers)} · worked ${formatNumber(summary.workedStatusLocatedUsers)}`
      })
    ].join('');
  }

  if (section === 'summary-app') {
    return renderCityKpiCard({
      label: 'Входили в приложение',
      value: formatNumber(summary.appActiveUsers)
    });
  }

  if (section === 'summary-responses') {
    return [
      renderCityKpiCard({ label: 'Откликались', value: formatNumber(summary.bookedUsers) }),
      renderCityKpiCard({ label: 'Завершали', value: formatNumber(summary.completedUsers) })
    ].join('');
  }

  if (section === 'summary-ratio') {
    return renderCityKpiCard({
      label: '30д активные / заявка',
      value: formatNumber(summary.avgDaily30dActiveUsersPerRequest, 1)
    });
  }

  if (section === 'composition') {
    return renderCityComposition(dashboard.composition);
  }

  if (section === 'dynamics') {
    return renderCityDynamics(dashboard.dynamics);
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

function renderMiniBarPanel({ title, rows, valueForWidth, metaForRow }) {
  const panelRows = safeRows(rows);

  if (panelRows.length === 0) {
    return `<article class="mini-panel">
  <h3>${escapeHtml(title)}</h3>
  ${renderEmptyDashboardTable()}
</article>`;
  }

  const maxValue = Math.max(...panelRows.map((row) => Number(valueForWidth(row)) || 0), 0);
  const rowsHtml = panelRows
    .map((row) => {
      const rawValue = Number(valueForWidth(row)) || 0;
      const width = maxValue > 0 ? clampPercent((rawValue / maxValue) * 100) : 0;

      return `<div class="mini-bar-row">
    <div class="mini-row-head">
      <span class="mini-label">${escapeHtml(row.label || '')}</span>
      <span class="mini-meta">${escapeHtml(metaForRow(row))}</span>
    </div>
    <div class="mini-bar-track"><div class="mini-bar-fill" style="width: ${escapeHtml(formatNumber(width, 1).replace(',', '.'))}%"></div></div>
  </div>`;
    })
    .join('');

  return `<article class="mini-panel">
  <h3>${escapeHtml(title)}</h3>
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

function cityDynamicRowsForMetric(rows, key) {
  return rows.map((row) => ({
    ...row,
    label: row.period,
    metricValue: Number(row[key]) || 0
  }));
}

function renderCitySmallMultiples(rows) {
  const panels = [
    ['Заказ', 'orderedShifts', 0, 'смен'],
    ['Входили в приложение', 'appActiveUsers', 0, 'польз.'],
    ['Откликались', 'bookedUsers', 0, 'польз.'],
    ['Завершали', 'completedUsers', 0, 'польз.'],
    ['Активные / заявка', 'activeUsersPerRequest', 1, '']
  ];

  return `<div class="mini-panels-grid">${panels
    .map(([title, key, digits, suffix]) =>
      renderMiniBarPanel({
        title,
        rows: cityDynamicRowsForMetric(rows, key),
        valueForWidth: (row) => row.metricValue,
        metaForRow: (row) => `${formatNumber(row.metricValue, digits)}${suffix ? ` ${suffix}` : ''}`
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

function renderCityFunnelStep({ label, value, maxValue, className }) {
  return `<div class="city-funnel-step">
  <span>${escapeHtml(label)}</span>
  <div class="city-funnel-track"><div class="city-funnel-fill ${escapeHtml(className)}" style="width: ${cssPercent(cityDynamicWidth(value, maxValue))}%"></div></div>
  <span class="city-funnel-value">${escapeHtml(formatNumber(value))}</span>
</div>`;
}

function renderCityFunnel(rows) {
  return `<article class="mini-panel">
  <h3>Воронка</h3>
  <div class="city-funnel-list">${rows
    .map((row) => {
      const maxValue = Math.max(row.appActiveUsers, row.bookedUsers, row.completedUsers, 1);

      return `<div class="city-funnel-day">
    <div>
      <div class="city-funnel-date">${escapeHtml(row.period)}</div>
      <div class="city-funnel-meta">заказ ${escapeHtml(formatNumber(row.orderedShifts))}</div>
    </div>
    <div class="city-funnel-main">
      ${renderCityFunnelStep({
        label: 'Входы',
        value: row.appActiveUsers,
        maxValue,
        className: 'city-series-app'
      })}
      ${renderCityFunnelStep({
        label: 'Отклики',
        value: row.bookedUsers,
        maxValue,
        className: 'city-series-booked'
      })}
      ${renderCityFunnelStep({
        label: 'Завершения',
        value: row.completedUsers,
        maxValue,
        className: 'city-series-completed'
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

function renderCityIndexMetric({ rows, label, key, digits, className }) {
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

      return `<span class="city-index-cell" title="${escapeHtml(title)}"><span class="city-index-fill ${escapeHtml(className)}" style="height: ${cssPercent(height)}%"></span></span>`;
    })
    .join('')}</div>
</div>`;
}

function renderCityIndexDynamics(rows) {
  const metrics = [
    ['Заказ', 'orderedShifts', 0, 'city-series-demand'],
    ['Входы', 'appActiveUsers', 0, 'city-series-app'],
    ['Отклики', 'bookedUsers', 0, 'city-series-booked'],
    ['Завершения', 'completedUsers', 0, 'city-series-completed'],
    ['Актив/заявка', 'activeUsersPerRequest', 1, 'city-series-ratio']
  ];

  return `<article class="mini-panel">
  <h3>Индексы</h3>
  <div class="city-index-scroll">
    <div class="city-index-chart">${metrics
      .map(([label, key, digits, className]) => renderCityIndexMetric({ rows, label, key, digits, className }))
      .join('')}</div>
  </div>
</article>`;
}

function renderCityComposition(composition) {
  const safeComposition = composition || {};

  return `<section class="section">
  <h2>Состав заказа</h2>
  <div class="mini-panels-grid">
    ${renderMiniBarPanel({
      title: 'Бренды',
      rows: safeComposition.brands,
      valueForWidth: (row) => row.orderedShifts,
      metaForRow: cityCompositionMeta
    })}
    ${renderMiniBarPanel({
      title: 'Специальности',
      rows: safeComposition.professions,
      valueForWidth: (row) => row.orderedShifts,
      metaForRow: cityCompositionMeta
    })}
    ${renderMiniBarPanel({
      title: 'Ставки',
      rows: safeComposition.rateBuckets,
      valueForWidth: (row) => row.orderedShifts,
      metaForRow: cityRateBucketMeta
    })}
  </div>
</section>`;
}

function renderCityDynamics(dynamics) {
  const rows = safeRows(dynamics).map((row) => ({
    ...row,
    label: row.period
  }));

  if (rows.length === 0) {
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

  return `<section class="section">
  <h2>Динамика</h2>
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
      <div class="city-dynamics-panel city-dynamics-panel-combo">${renderCityComboDynamics(rows)}</div>
      <div class="city-dynamics-panel city-dynamics-panel-multiples">${renderCitySmallMultiples(rows)}</div>
      <div class="city-dynamics-panel city-dynamics-panel-heatmap">${renderCityHeatmap(rows)}</div>
      <div class="city-dynamics-panel city-dynamics-panel-funnel">${renderCityFunnel(rows)}</div>
      <div class="city-dynamics-panel city-dynamics-panel-index">${renderCityIndexDynamics(rows)}</div>
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

function renderCityAnalysisResultSections(dashboard) {
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

  return `${noCoordinatesWarning}${renderCityComposition(dashboard.composition)}${renderCityDynamics(dashboard.dynamics)}`;
}

function renderCityAnalysisDashboard({ database, dashboard, progressive = false }) {
  const filters = dashboard.filters || {};
  const context = dashboard.context || {};
  const summary = dashboard.summary || {};
  const period = context.periodLabel || `${rangeFilterValue(filters.from)} - ${rangeFilterValue(filters.to)}`;
  const resultsHtml = progressive
    ? renderCityProgressiveSections(dashboard)
    : `<section class="section">
  ${progressive ? '' : '<h2>Баланс спроса и базы</h2>'}
  ${progressive ? '' : renderCityKpiCards(summary)}
</section>
${progressive ? renderCityProgressiveSections(dashboard) : renderCityAnalysisResultSections(dashboard)}`;
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
  <h2>Баланс спроса и базы</h2>
  ${progressive ? '' : renderCityKpiCards(summary)}
</section>
${progressive ? renderCityProgressiveSections(dashboard) : renderCityAnalysisResultSections(dashboard)}`;

  return layout({
    title: 'Анализ городов',
    database,
    content,
    activeNav: 'city-analysis'
  });
}

function renderError({ database, title, message, activeNav = 'tables' }) {
  const content = `<section class="section">
  <h1>${escapeHtml(title)}</h1>
  <div class="error">${escapeHtml(message)}</div>
</section>`;

  return layout({ title, database, content, activeNav });
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
  renderDashboardSectionError,
  renderError,
  renderCityAnalysisDashboard: renderCityAnalysisDashboardPage,
  renderCityAnalysisDashboardSection,
  renderCityAnalysisSectionError,
  renderHome,
  renderSalesByProjectDashboard,
  renderSalesByProjectDashboardSection,
  renderTable,
  renderWorkplaceAnalysisDashboard,
  renderWorkplaceAnalysisDashboardSection,
  renderWorkplacePointDashboard,
  renderWorkplacePointDashboardSection
};
