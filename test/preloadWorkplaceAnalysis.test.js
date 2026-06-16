const test = require('node:test');
const assert = require('node:assert/strict');

const { WORKPLACE_ANALYSIS_PRELOAD_JOB_ID } = require('../src/preloadStore');
const {
  buildWorkplaceAnalysisPreloadInput,
  refreshWorkplaceAnalysisPreload
} = require('../src/preloadWorkplaceAnalysis');

test('buildWorkplaceAnalysisPreloadInput converts exclusive range to dashboard date input', () => {
  assert.deepEqual(
    buildWorkplaceAnalysisPreloadInput({
      input: { city: ['Москва'], from: '2026-01-01', to: '2026-01-31' },
      fromDate: '2026-05-02',
      toDate: '2026-08-01'
    }),
    {
      city: ['Москва'],
      from: '2026-05-02',
      to: '2026-07-31'
    }
  );
});

test('refreshWorkplaceAnalysisPreload seeds default sections when there are no known requests', async () => {
  const calls = [];
  const saved = [];
  const registered = [];
  const store = {
    listDashboardPreloadRequests(jobId) {
      assert.equal(jobId, WORKPLACE_ANALYSIS_PRELOAD_JOB_ID);
      return [];
    },
    registerDashboardPreloadRequest(input) {
      registered.push(input);
      return input;
    },
    saveDashboardPreloadResult(input) {
      saved.push(input);
      return input;
    }
  };

  const result = await refreshWorkplaceAnalysisPreload({
    client: {},
    store,
    fromDate: '2026-05-02',
    toDate: '2026-08-01',
    now: new Date('2026-06-16T12:00:00.000Z'),
    loadSection: async (client, input, section, now, options) => {
      calls.push({ client, input, section, now, options });
      return {
        filters: {
          from: input.from,
          to: input.to,
          currentDate: '2026-06-16',
          section
        },
        payloadSection: section
      };
    },
    cacheKeyForSection: (section, filters) => `${section}:${filters.from}:${filters.to}`
  });

  assert.equal(result.rowsWritten, 2);
  assert.deepEqual(calls.map((call) => call.section), ['points', 'attention']);
  assert.deepEqual(calls.map((call) => call.input), [
    { from: '2026-05-02', to: '2026-07-31' },
    { from: '2026-05-02', to: '2026-07-31' }
  ]);
  assert.deepEqual(saved.map((item) => item.cacheKey), [
    'points:2026-05-02:2026-07-31',
    'attention:2026-05-02:2026-07-31'
  ]);
  assert.deepEqual(registered.map((item) => item.cacheKey), saved.map((item) => item.cacheKey));
  assert.equal(saved[0].jobId, WORKPLACE_ANALYSIS_PRELOAD_JOB_ID);
  assert.equal(saved[0].dashboardId, 'workplace-analysis');
});

test('refreshWorkplaceAnalysisPreload refreshes known requests with the requested range', async () => {
  const calls = [];
  const saved = [];
  const store = {
    listDashboardPreloadRequests() {
      return [
        {
          jobId: WORKPLACE_ANALYSIS_PRELOAD_JOB_ID,
          dashboardId: 'workplace-analysis',
          section: 'points',
          cacheKey: 'old-key',
          input: {
            from: '2026-04-01',
            to: '2026-04-30',
            city: ['Казань'],
            limit: '20'
          }
        }
      ];
    },
    registerDashboardPreloadRequest() {},
    saveDashboardPreloadResult(input) {
      saved.push(input);
      return input;
    }
  };

  const result = await refreshWorkplaceAnalysisPreload({
    client: {},
    store,
    fromDate: '2026-05-02',
    toDate: '2026-08-01',
    now: new Date('2026-06-16T12:00:00.000Z'),
    loadSection: async (client, input, section) => {
      calls.push({ input, section });
      return {
        filters: {
          from: input.from,
          to: input.to,
          city: input.city,
          limit: 20
        },
        points: [{ workplaceId: 'wp1' }]
      };
    },
    cacheKeyForSection: (section, filters) => (
      section === 'points'
        ? `${section}:${filters.city.join(',')}:${filters.from}:${filters.to}`
        : `${section}:${filters.from}:${filters.to}`
    )
  });

  assert.equal(result.rowsWritten, 2);
  assert.deepEqual(calls.slice(0, 1), [
    {
      section: 'points',
      input: {
        from: '2026-05-02',
        to: '2026-07-31',
        city: ['Казань'],
        limit: '20'
      }
    }
  ]);
  assert.equal(saved[0].cacheKey, 'points:Казань:2026-05-02:2026-07-31');
  assert.deepEqual(saved[0].payload.points, [{ workplaceId: 'wp1' }]);
});

test('refreshWorkplaceAnalysisPreload keeps default sections when known requests cover only one tab', async () => {
  const calls = [];
  const saved = [];
  const store = {
    listDashboardPreloadRequests() {
      return [
        {
          jobId: WORKPLACE_ANALYSIS_PRELOAD_JOB_ID,
          dashboardId: 'workplace-analysis',
          section: 'points',
          cacheKey: 'old-key',
          input: { from: '2026-04-01', to: '2026-04-30', limit: '12' }
        }
      ];
    },
    registerDashboardPreloadRequest() {},
    saveDashboardPreloadResult(input) {
      saved.push(input);
      return input;
    }
  };

  const result = await refreshWorkplaceAnalysisPreload({
    client: {},
    store,
    fromDate: '2026-05-02',
    toDate: '2026-08-01',
    now: new Date('2026-06-16T12:00:00.000Z'),
    loadSection: async (client, input, section) => {
      calls.push({ input, section });
      return {
        filters: {
          from: input.from,
          to: input.to,
          currentDate: '2026-06-16',
          attentionFrom: '2026-06-16',
          attentionTo: '2026-06-23',
          section
        }
      };
    },
    cacheKeyForSection: (section) => `${section}-key`
  });

  assert.equal(result.rowsWritten, 2);
  assert.deepEqual(calls.map((call) => call.section), ['points', 'attention']);
  assert.deepEqual(saved.map((item) => item.section), ['points', 'attention']);
});
