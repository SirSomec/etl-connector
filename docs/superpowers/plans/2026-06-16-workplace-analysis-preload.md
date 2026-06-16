# Workplace Analysis Preload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить дашборд `workplace-analysis` в систему предзагрузки и расширить расписание до ежедневного окна минимум 45 дней назад и 45 дней вперед.

**Architecture:** Общий preload service остается владельцем SQLite store, runs и scheduler. Для `workplace-analysis` добавляется result-preload слой: готовые JSON payload секций сохраняются по стабильному ключу нормализованных фильтров, а дашборд читает их preload-first с ClickHouse fallback.

**Tech Stack:** Node.js 22, Express 4, `node:sqlite`, `node:test`, существующий ClickHouse HTTP client и server-rendered HTML.

---

## File Structure

- Modify: `src/preloadStore.js` - job registry, миграции `refresh_past_days`/`refresh_future_days`, result tables, методы чтения/записи dashboard results.
- Modify: `src/preloadScheduler.js` - scheduled range `past/future`, планирование всех enabled jobs, запуск loader по `jobId`.
- Modify: `src/preloadService.js` - loaders map для `sales-by-project` и `workplace-analysis`, generic schedule/run APIs.
- Create: `src/preloadWorkplaceAnalysis.js` - loader известных ключей `workplace-analysis`, seed inputs и запись готовых section payload.
- Modify: `src/workplaceAnalysisDashboard.js` - стабильные preload keys, preload-first чтение секций, регистрация запросов.
- Modify: `src/server.js` - передача preload service в workplace section route, generic `/admin/preload` routes по `jobId`.
- Modify: `src/render.js` - multi-job управление на `/admin/preload`.
- Modify: `README.md` - описание нескольких витрин и окна `45/45`.
- Test: `test/preloadStore.test.js`, `test/preloadScheduler.test.js`, `test/preloadSalesByProject.test.js`, `test/workplaceAnalysisDashboard.test.js`, `test/server.test.js`, `test/render.test.js`.
- Create test: `test/preloadWorkplaceAnalysis.test.js`.

## Tasks

### Task 1: Schedule Window And Multi-Job Store

- [ ] Write failing tests in `test/preloadStore.test.js`:
  - default `sales-by-project` has `refreshPastDays=45` and `refreshFutureDays=45`;
  - new `workplace-analysis` job exists with the same defaults;
  - `saveJobSchedule(jobId, ...)` updates the selected job only.
- [ ] Write failing tests in `test/preloadScheduler.test.js`:
  - `scheduledRangeForJob({ refreshPastDays: 45, refreshFutureDays: 45 }, 2026-06-16T12:00Z)` returns `2026-05-02..2026-08-01`;
  - `reschedule()` schedules every enabled job returned by `store.listJobs()`.
- [ ] Run targeted tests and verify RED.
- [ ] Implement schema migration and store methods: `listJobs`, `saveJobSchedule(jobId, ...)`, `WORKPLACE_ANALYSIS_PRELOAD_JOB_ID`.
- [ ] Implement scheduler range and multi-job reschedule.
- [ ] Run targeted tests and verify GREEN.

### Task 2: Generic Dashboard Result Store

- [ ] Write failing tests in `test/preloadStore.test.js` for:
  - `registerDashboardPreloadRequest`;
  - `listDashboardPreloadRequests`;
  - `saveDashboardPreloadResult`;
  - `readDashboardPreloadResult`;
  - miss when requested range is not covered.
- [ ] Run store tests and verify RED.
- [ ] Add SQLite tables `preload_dashboard_requests` and `preload_dashboard_results`.
- [ ] Implement result read/write with JSON serialization and range coverage check.
- [ ] Run store tests and verify GREEN.

### Task 3: Workplace Analysis Preload Loader

- [ ] Create `test/preloadWorkplaceAnalysis.test.js`.
- [ ] Write failing tests:
  - loader seeds `points` and `attention` requests when no known keys exist;
  - loader calls `loadWorkplaceAnalysisDashboardSection` for known requests;
  - loader writes successful section payloads and reports `rowsWritten`.
- [ ] Run loader tests and verify RED.
- [ ] Create `src/preloadWorkplaceAnalysis.js`.
- [ ] Implement `refreshWorkplaceAnalysisPreload({ client, store, fromDate, toDate, now, activeGigersCache })`.
- [ ] Run loader tests and verify GREEN.

### Task 4: Workplace Dashboard Preload-First Reads

- [ ] Write failing tests in `test/workplaceAnalysisDashboard.test.js`:
  - `points` section reads from preload service and makes no ClickHouse calls on exact hit;
  - `attention` section reads from preload service and makes no ClickHouse calls on exact hit;
  - ClickHouse fallback still runs and registers request on miss.
- [ ] Run tests and verify RED.
- [ ] Export stable `cacheKeyForWorkplaceAnalysisSection`.
- [ ] Add preload read/register path in `loadWorkplaceAnalysisDashboardSection`.
- [ ] Add `dataSource: 'preload' | 'clickhouse'` to returned section models.
- [ ] Run tests and verify GREEN.

### Task 5: Service And Server Wiring

- [ ] Write failing tests in `test/preloadScheduler.test.js` and `test/server.test.js` for:
  - `createPreloadService().runJob({ jobId, fromDate, toDate })`;
  - admin schedule route accepts `jobId`;
  - admin manual run route accepts `jobId`;
  - workplace section route passes `preloadService`.
- [ ] Run targeted tests and verify RED.
- [ ] Wire `WORKPLACE_ANALYSIS_PRELOAD_JOB_ID` loader in `preloadService`.
- [ ] Generalize server preload routes from sales-only to job-aware.
- [ ] Pass preload service into `/dashboards/workplace-analysis/section`.
- [ ] Run targeted tests and verify GREEN.

### Task 6: Admin UI For Multiple Preloads

- [ ] Write failing render tests:
  - `/admin/preload` renders both `sales-by-project` and `workplace-analysis`;
  - each form includes hidden `jobId`;
  - schedule form renders `refreshPastDays` and `refreshFutureDays`.
- [ ] Run render tests and verify RED.
- [ ] Update `renderPreloadManagement` to render job cards/table sections from `jobs`.
- [ ] Keep permission `preload-admin` unchanged.
- [ ] Run render tests and verify GREEN.

### Task 7: Documentation And Final Verification

- [ ] Update `README.md` with `45/45`, multiple jobs and result-preload behavior.
- [ ] Run focused tests touched by the change.
- [ ] Run full `npm test`.
- [ ] Inspect `git status --short`.
- [ ] Commit the implementation if tests pass.

## Self-Review

Spec coverage:

- `workplace-analysis` preload job: Tasks 1, 3, 5, 6.
- Daily refresh 45 days back and 45 days forward: Tasks 1, 5, 6, 7.
- Manual refresh by period: Tasks 5, 6.
- Existing dashboard behavior without preload: Tasks 4, 5.
- Result-preload instead of raw SQLite facts: Tasks 2, 3, 4.
- Separate permission remains `preload-admin`: Task 6.

Risk controls:

- First production code change follows failing tests.
- ClickHouse fallback remains mandatory on miss or store error.
- Existing `sales-by-project` structured preload is not replaced.
