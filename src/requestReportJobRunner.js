const {
  findRequestReportRowsWithoutConfirmedShift,
  parseRequestsReportWorkbook,
  PROGRESS_POINTS
} = require('./requestReportMissingConfirmed');
const {
  renderRequestReportMissingConfirmedResult
} = require('./render');

function requestReportBufferFromOptions(options) {
  if (options && options.fileBuffer) {
    return options.fileBuffer;
  }

  if (options && options.file && options.file.buffer) {
    return options.file.buffer;
  }

  throw new Error('Request report XLSX buffer is required');
}

function emitRunnerProgress(onProgress, event) {
  if (typeof onProgress !== 'function') {
    return;
  }

  try {
    onProgress(event);
  } catch {
    // Runner progress is best-effort and must not change job execution.
  }
}

function renderProgressCounts(summary) {
  const safeSummary = summary || {};
  const totalRows = Number(safeSummary.totalRows) || 0;

  return {
    total: totalRows,
    processed: totalRows,
    matched: Number(safeSummary.confirmedRows) || 0,
    missing: Number(safeSummary.missingConfirmedRows) || 0
  };
}

function createSafeProgress(onProgress, { suppressRenderResult = false } = {}) {
  return (event) => {
    if (suppressRenderResult && event && event.stage === 'render-result') {
      return;
    }

    emitRunnerProgress(onProgress, event);
  };
}

async function runRequestReportConfirmedCheckJob(options = {}) {
  const {
    client,
    filename = '',
    csrfToken = '',
    statusUserId,
    onProgress,
    parseWorkbook = parseRequestsReportWorkbook,
    findMissingRows = findRequestReportRowsWithoutConfirmedShift,
    attachStatuses = async (_userId, rows) => rows,
    renderResult = renderRequestReportMissingConfirmedResult
  } = options;

  if (!client) {
    throw new Error('ClickHouse client is required');
  }

  const buffer = requestReportBufferFromOptions(options);
  const analysisProgress = createSafeProgress(onProgress, { suppressRenderResult: true });
  const parsed = await parseWorkbook(buffer, { onProgress: analysisProgress });
  const lookup = await findMissingRows(client, parsed.rows, { onProgress: analysisProgress });
  const result = {
    ...lookup,
    warnings: [
      ...(Array.isArray(parsed.warnings) ? parsed.warnings : []),
      ...(Array.isArray(lookup.warnings) ? lookup.warnings : [])
    ],
    rows: await attachStatuses(statusUserId, lookup.rows || [])
  };

  if (Array.isArray(lookup.checkedRows)) {
    result.checkedRows = await attachStatuses(statusUserId, lookup.checkedRows);
  }

  emitRunnerProgress(onProgress, {
    stage: 'render-result',
    progress: PROGRESS_POINTS['render-result'].end,
    detail: PROGRESS_POINTS['render-result'].detail,
    counts: renderProgressCounts(result.summary)
  });

  return renderResult({ filename, result, csrfToken });
}

module.exports = {
  runRequestReportConfirmedCheckJob
};
