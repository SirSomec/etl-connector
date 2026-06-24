const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildRequestReportCheckWorkbook,
  extractRequestsReportRowsFromSheetRows,
  findRequestReportRowsWithoutConfirmedShift,
  parseRequestsReportWorkbook
} = require('../src/requestReportMissingConfirmed');

test('extractRequestsReportRowsFromSheetRows maps request report columns', () => {
  const events = [];
  const result = extractRequestsReportRowsFromSheetRows([
    ['Служебная строка'],
    [
      'ID ЛКК',
      'Организация',
      'Рабочая точка',
      'Адрес',
      'Сотрудник',
      'Дата запроса "с"',
      'Время запроса "с"',
      'Продолжительность запроса (факт) (в часах)',
      'Фактическая продолжительность запроса за вычетом перерыва'
    ],
    [
      101,
      'АО "Тандер"',
      'Екатеринбург-1',
      'ул. Ленина, 1',
      'Иванов Иван',
      46174,
      0.375,
      7.5,
      6.75
    ]
  ], { onProgress: (event) => events.push(event) });

  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.rows, [
    {
      sourceRowNumber: 3,
      idLkk: '101',
      organization: 'АО "Тандер"',
      workplace: 'Екатеринбург-1',
      address: 'ул. Ленина, 1',
      employee: 'Иванов Иван',
      dateFrom: '2026-06-01',
      timeFrom: '09:00',
      startText: '2026-06-01 09:00',
      actualDuration: '6.75'
    }
  ]);
  assert.deepEqual(events.map((event) => event.stage), ['extracting-rows', 'extracting-rows']);
  assert.equal(events[0].progress, 5);
  assert.equal(events[0].counts.total, 3);
  assert.equal(events[0].counts.processed, 0);
  assert.equal(events[1].progress, 15);
  assert.equal(events[1].counts.total, 3);
  assert.equal(events[1].counts.processed, 3);
  assert.equal(events[1].counts.matched, 1);
});

test('request report parsing emits file reading and row extraction progress stages', () => {
  const events = [];
  const workbook = buildRequestReportCheckWorkbook({
    sourceSheet: {
      headers: [
        'ID ЛКК',
        'Организация',
        'Рабочая точка',
        'Адрес',
        'Сотрудник',
        'Дата запроса "с"',
        'Время запроса "с"',
        'Фактическая продолжительность запроса за вычетом перерыва'
      ],
      rows: [
        {
          sourceRowNumber: 2,
          cells: ['101', 'АО "Тандер"', 'Point A', 'Address 1', 'Ivan Ivanov', '2026-06-01', '09:00', '7.5']
        }
      ]
    },
    rows: []
  });

  const result = parseRequestsReportWorkbook(workbook, {
    onProgress: (event) => events.push(event)
  });

  assert.equal(result.rows.length, 1);
  assert.deepEqual(events.map((event) => event.stage), [
    'reading-file',
    'reading-file',
    'extracting-rows',
    'extracting-rows'
  ]);
  assert.deepEqual(events.map((event) => event.progress), [0, 5, 5, 15]);
  assert.equal(events[3].counts.total, 2);
  assert.equal(events[3].counts.processed, 2);
  assert.equal(events[3].counts.matched, 1);

  const resultWithFailingProgress = parseRequestsReportWorkbook(workbook, {
    onProgress() {
      throw new Error('progress callback failed');
    }
  });

  assert.equal(resultWithFailingProgress.rows.length, 1);
});

test('findRequestReportRowsWithoutConfirmedShift returns rows without confirmed jobs by LKK id', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      return [
        { external_id: 'confirmed-id', status: 'confirmed', workplace_id: 'wp-confirmed' },
        { external_id: 'cancelled-id', status: 'cancelled', workplace_id: 'wp-cancelled' },
        { external_id: 'booked-id', status: 'booked', workplace_id: 'wp-booked' }
      ];
    }
  };
  const rows = [
    { idLkk: 'confirmed-id', organization: 'А', workplace: 'Т1' },
    {
      idLkk: 'cancelled-id',
      organization: 'Б',
      workplace: 'Т2',
      dateFrom: '2026-06-08',
      startText: '2026-06-09 09:00',
      actualDuration: '7.5'
    },
    { idLkk: 'missing-id', organization: 'В', workplace: 'Т3' },
    { idLkk: '', organization: 'Г', workplace: 'Т4' }
  ];

  const result = await findRequestReportRowsWithoutConfirmedShift(client, rows, { batchSize: 10 });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].operation, 'request report confirmed shift lookup');
  assert.match(calls[0].query, /mg_orders AS o/);
  assert.match(calls[0].query, /mg_jobs AS j/);
  assert.deepEqual(result.rows.map((row) => row.idLkk), ['cancelled-id', 'missing-id', '']);
  assert.equal(
    result.rows[0].crmUrl,
    'https://crm.mygig.ru/coordination?searchDate[]=2026-06-09&searchDate[]=2026-06-09&workplaceIds[]=wp-cancelled'
  );
  assert.deepEqual(result.summary, {
    totalRows: 4,
    rowsWithId: 3,
    checkedExternalIds: 3,
    confirmedRows: 1,
    missingConfirmedRows: 3
  });
});

test('findRequestReportRowsWithoutConfirmedShift does not query ClickHouse when report has no LKK ids', async () => {
  const client = {
    async queryJSONEachRow() {
      throw new Error('query should not be called');
    }
  };
  const rows = [
    { idLkk: '', organization: 'А', workplace: 'Т1' }
  ];

  const result = await findRequestReportRowsWithoutConfirmedShift(client, rows);

  assert.deepEqual(result.rows, rows);
  assert.deepEqual(result.summary, {
    totalRows: 1,
    rowsWithId: 0,
    checkedExternalIds: 0,
    confirmedRows: 0,
    missingConfirmedRows: 1
  });
});

test('findRequestReportRowsWithoutConfirmedShift ignores progress callback failures', async () => {
  const client = {
    async queryJSONEachRow() {
      throw new Error('query should not be called');
    }
  };
  const rows = [
    { idLkk: '', organization: 'А', workplace: 'Т1' }
  ];

  const result = await findRequestReportRowsWithoutConfirmedShift(client, rows, {
    onProgress() {
      throw new Error('progress callback failed');
    }
  });

  assert.deepEqual(result.rows, rows);
  assert.equal(result.summary.totalRows, 1);
  assert.equal(result.summary.missingConfirmedRows, 1);
});

test('findRequestReportRowsWithoutConfirmedShift counts unique confirmed external id progress matches', async () => {
  const events = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      assert.equal(operation, 'request report confirmed shift lookup');

      return [
        { external_id: 'confirmed-id', status: 'confirmed', workplace_id: 'wp-confirmed-a' },
        { external_id: 'confirmed-id', status: 'confirmed', workplace_id: 'wp-confirmed-b' },
        { external_id: 'cancelled-id', status: 'cancelled', workplace_id: 'wp-cancelled' }
      ];
    }
  };

  await findRequestReportRowsWithoutConfirmedShift(client, [
    { idLkk: 'confirmed-id', organization: 'А', workplace: 'Т1' },
    { idLkk: 'cancelled-id', organization: 'Б', workplace: 'Т2' }
  ], {
    batchSize: 10,
    onProgress: (event) => events.push(event)
  });

  const externalEvents = events.filter((event) => event.stage === 'external-id-lookup');
  const finalExternalEvent = externalEvents.at(-1);

  assert.equal(finalExternalEvent.counts.total, 2);
  assert.equal(finalExternalEvent.counts.processed, 2);
  assert.equal(finalExternalEvent.counts.matched, 1);
  assert.equal(finalExternalEvent.counts.missing, 1);
});

test('findRequestReportRowsWithoutConfirmedShift uses unique confirmed composite fallback without confirmed direct job', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'request report confirmed shift lookup') {
        return [
          { external_id: 'cancelled-id', status: 'cancelled', workplace_id: 'wp-cancelled' }
        ];
      }

      if (operation === 'request report confirmed composite lookup') {
        return [
          {
            start_date: '2026-06-01',
            start_time: '09:00',
            technical_name: 'Точка А',
            confirmed_jobs: 1
          },
          {
            start_date: '2026-06-01',
            start_time: '10:00',
            technical_name: 'Точка Б',
            confirmed_jobs: 2
          }
        ];
      }

      if (operation === 'request report workplace lookup') {
        return [
          {
            technical_name: 'Точка Б',
            workplace_id: 'wp-b'
          }
        ];
      }

      return [];
    }
  };
  const rows = [
    {
      idLkk: 'missing-id',
      dateFrom: '2026-06-01',
      startText: '2026-06-01 09:00',
      timeFrom: '09:00',
      workplace: 'Точка А'
    },
    {
      idLkk: 'cancelled-id',
      dateFrom: '2026-06-01',
      startText: '2026-06-01 09:00',
      timeFrom: '09:00',
      workplace: 'Точка А'
    },
    {
      idLkk: 'ambiguous-id',
      dateFrom: '2026-06-01',
      startText: '2026-06-01 10:00',
      timeFrom: '10:00',
      workplace: 'Точка Б'
    }
  ];

  const result = await findRequestReportRowsWithoutConfirmedShift(client, rows, { batchSize: 10 });

  assert.deepEqual(calls.map((call) => call.operation), [
    'request report confirmed shift lookup',
    'request report confirmed composite lookup',
    'request report workplace lookup'
  ]);
  assert.match(calls[2].query, /any\(workplace_id\) AS resolved_workplace_id/);
  assert.doesNotMatch(calls[2].query, /any\(workplace_id\) AS workplace_id/);
  assert.deepEqual(result.rows.map((row) => row.idLkk), ['ambiguous-id']);
  assert.equal(
    result.rows[0].crmUrl,
    'https://crm.mygig.ru/coordination?searchDate[]=2026-06-01&searchDate[]=2026-06-01&workplaceIds[]=wp-b'
  );
  assert.deepEqual(result.summary, {
    totalRows: 3,
    rowsWithId: 3,
    checkedExternalIds: 3,
    confirmedRows: 2,
    missingConfirmedRows: 1
  });
});

test('findRequestReportRowsWithoutConfirmedShift resolves ambiguous composite fallback by employee full name', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'request report confirmed shift lookup') {
        return [];
      }

      if (operation === 'request report confirmed composite lookup') {
        return [
          {
            start_date: '2026-06-05',
            start_time: '09:00',
            technical_name: 'Рошано',
            confirmed_jobs: 3
          }
        ];
      }

      if (operation === 'request report confirmed employee composite lookup') {
        return [
          {
            start_date: '2026-06-05',
            start_time: '09:00',
            technical_name: 'Рошано',
            employee_name: 'ляликова мария александровна',
            confirmed_jobs: 1
          }
        ];
      }

      if (operation === 'request report workplace lookup') {
        return [
          {
            technical_name: 'Рошано',
            resolved_workplace_id: 'wp-roshano'
          }
        ];
      }

      return [];
    }
  };
  const rows = [
    {
      idLkk: '7838733',
      dateFrom: '2026-06-05',
      startText: '2026-06-05 09:00',
      timeFrom: '09:00',
      workplace: 'Рошано',
      employee: 'Ляликова Мария Александровна'
    },
    {
      idLkk: '7838734',
      dateFrom: '2026-06-05',
      startText: '2026-06-05 09:00',
      timeFrom: '09:00',
      workplace: 'Рошано',
      employee: 'Несовпавший Исполнитель'
    }
  ];

  const result = await findRequestReportRowsWithoutConfirmedShift(client, rows, { batchSize: 10 });

  assert.deepEqual(calls.map((call) => call.operation), [
    'request report confirmed shift lookup',
    'request report confirmed composite lookup',
    'request report confirmed employee composite lookup',
    'request report confirmed employee date lookup',
    'request report workplace lookup'
  ]);
  assert.match(calls[2].query, /LEFT JOIN mg_workers AS wr/);
  assert.match(calls[2].query, /LEFT JOIN mg_users AS u/);
  assert.match(calls[2].query, /ляликова мария александровна/);
  assert.deepEqual(result.rows.map((row) => row.idLkk), ['7838734']);
  assert.equal(
    result.rows[0].crmUrl,
    'https://crm.mygig.ru/coordination?searchDate[]=2026-06-05&searchDate[]=2026-06-05&workplaceIds[]=wp-roshano'
  );
  assert.deepEqual(result.summary, {
    totalRows: 2,
    rowsWithId: 2,
    checkedExternalIds: 2,
    confirmedRows: 1,
    missingConfirmedRows: 1
  });
});

test('findRequestReportRowsWithoutConfirmedShift resolves time mismatch by unique date workplace and employee', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'request report confirmed shift lookup') {
        return [];
      }

      if (operation === 'request report confirmed composite lookup') {
        return [];
      }

      if (operation === 'request report confirmed employee composite lookup') {
        return [];
      }

      if (operation === 'request report confirmed employee date lookup') {
        return [
          {
            start_date: '2026-06-01',
            technical_name: 'Видеокамера',
            employee_name: 'мусурмонов сайдулло абдуллоевич',
            confirmed_jobs: 1
          }
        ];
      }

      return [];
    }
  };
  const rows = [
    {
      idLkk: '7744740',
      dateFrom: '2026-06-01',
      startText: '2026-06-01 11:00',
      timeFrom: '11:00',
      workplace: 'Видеокамера',
      employee: 'Мусурмонов Сайдулло Абдуллоевич'
    }
  ];

  const result = await findRequestReportRowsWithoutConfirmedShift(client, rows, { batchSize: 10 });

  assert.deepEqual(calls.map((call) => call.operation), [
    'request report confirmed shift lookup',
    'request report confirmed composite lookup',
    'request report confirmed employee composite lookup',
    'request report confirmed employee date lookup'
  ]);
  assert.match(calls[3].query, /GROUP BY start_date, technical_name, employee_name/);
  assert.doesNotMatch(calls[3].query, /start_time/);
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.summary, {
    totalRows: 1,
    rowsWithId: 1,
    checkedExternalIds: 1,
    confirmedRows: 1,
    missingConfirmedRows: 0
  });
});

test('findRequestReportRowsWithoutConfirmedShift uses employee date fallback after ambiguous exact-time workplace match', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'request report confirmed shift lookup') {
        return [
          { external_id: '7771582', status: 'cancelled', workplace_id: 'wp-traun' }
        ];
      }

      if (operation === 'request report confirmed composite lookup') {
        return [
          {
            start_date: '2026-06-03',
            start_time: '09:00',
            technical_name: 'Traun',
            confirmed_jobs: 2
          }
        ];
      }

      if (operation === 'request report confirmed employee composite lookup') {
        return [];
      }

      if (operation === 'request report confirmed employee date lookup') {
        return [
          {
            start_date: '2026-06-03',
            technical_name: 'Traun',
            employee_name: 'Magomedova Oksana Anatolyevna',
            confirmed_jobs: 1
          }
        ];
      }

      return [];
    }
  };
  const rows = [
    {
      idLkk: '7771582',
      dateFrom: '2026-06-03',
      startText: '2026-06-03 09:00',
      timeFrom: '09:00',
      workplace: 'Traun',
      employee: 'Magomedova Oksana Anatolyevna'
    }
  ];

  const result = await findRequestReportRowsWithoutConfirmedShift(client, rows, { batchSize: 10 });

  assert.deepEqual(calls.map((call) => call.operation), [
    'request report confirmed shift lookup',
    'request report confirmed composite lookup',
    'request report confirmed employee composite lookup',
    'request report confirmed employee date lookup'
  ]);
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.summary, {
    totalRows: 1,
    rowsWithId: 1,
    checkedExternalIds: 1,
    confirmedRows: 1,
    missingConfirmedRows: 0
  });
});

test('findRequestReportRowsWithoutConfirmedShift builds crm date from startText even without dateFrom', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'request report workplace lookup') {
        return [
          {
            technical_name: 'Точка C',
            resolved_workplace_id: 'wp-c'
          }
        ];
      }

      return [];
    }
  };
  const rows = [
    {
      idLkk: 'no-job-id',
      dateFrom: '',
      startText: '2026-06-10 11:00',
      timeFrom: '11:00',
      workplace: 'Точка C'
    }
  ];

  const result = await findRequestReportRowsWithoutConfirmedShift(client, rows, { batchSize: 10 });

  assert.deepEqual(calls.map((call) => call.operation), [
    'request report confirmed shift lookup',
    'request report workplace lookup'
  ]);
  assert.equal(
    result.rows[0].crmUrl,
    'https://crm.mygig.ru/coordination?searchDate[]=2026-06-10&searchDate[]=2026-06-10&workplaceIds[]=wp-c'
  );
});

test('findRequestReportRowsWithoutConfirmedShift resolves ambiguous technical names by jobs on shift date', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'request report workplace date lookup') {
        return [
          {
            start_date: '2026-06-10',
            technical_name: 'балтиос',
            resolved_workplace_id: 'wp-balti day'
          }
        ];
      }

      return [];
    }
  };
  const rows = [
    {
      idLkk: 'no-job-id',
      dateFrom: '',
      startText: '2026-06-10 11:00',
      timeFrom: '11:00',
      workplace: 'Балтиос'
    }
  ];

  const result = await findRequestReportRowsWithoutConfirmedShift(client, rows, { batchSize: 10 });

  assert.deepEqual(calls.map((call) => call.operation), [
    'request report confirmed shift lookup',
    'request report workplace lookup',
    'request report workplace date lookup'
  ]);
  assert.match(calls[2].query, /FROM mg_jobs AS j/);
  assert.match(calls[2].query, /GROUP BY start_date, technical_name/);
  assert.match(calls[2].query, /HAVING workplace_count = 1/);
  assert.equal(
    result.rows[0].crmUrl,
    'https://crm.mygig.ru/coordination?searchDate[]=2026-06-10&searchDate[]=2026-06-10&workplaceIds[]=wp-balti%20day'
  );
});

test('findRequestReportRowsWithoutConfirmedShift emits monotonic staged progress for lookup fallbacks', async () => {
  const events = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      if (operation === 'request report confirmed shift lookup') {
        return [];
      }

      if (operation === 'request report confirmed composite lookup') {
        return [
          {
            start_date: '2026-06-11',
            start_time: '09:00',
            technical_name: 'Point Alpha',
            confirmed_jobs: 2
          }
        ];
      }

      if (operation === 'request report confirmed employee composite lookup') {
        return [
          {
            start_date: '2026-06-11',
            start_time: '09:00',
            technical_name: 'Point Alpha',
            employee_name: 'alice worker',
            resolved_job_id: 'job-alpha',
            resolved_workplace_id: 'wp-alpha',
            confirmed_jobs: 1
          }
        ];
      }

      if (operation === 'request report workplace date lookup') {
        return [
          {
            start_date: '2026-06-11',
            technical_name: 'Point Beta',
            resolved_workplace_id: 'wp-beta-day'
          }
        ];
      }

      return [];
    }
  };
  const rows = [
    {
      idLkk: 'employee-fallback-id',
      dateFrom: '2026-06-11',
      startText: '2026-06-11 09:00',
      timeFrom: '09:00',
      workplace: 'Point Alpha',
      employee: 'Alice Worker'
    },
    {
      idLkk: 'workplace-date-id',
      dateFrom: '2026-06-11',
      startText: '2026-06-11 10:00',
      timeFrom: '10:00',
      workplace: 'Point Beta',
      employee: 'Bob Worker'
    }
  ];

  const result = await findRequestReportRowsWithoutConfirmedShift(client, rows, {
    batchSize: 1,
    onProgress: (event) => events.push(event)
  });

  const uniqueStages = [...new Set(events.map((event) => event.stage))];

  assert.deepEqual(uniqueStages, [
    'external-id-lookup',
    'composite-lookup',
    'employee-lookup',
    'employee-date-lookup',
    'workplace-lookup',
    'workplace-date-lookup',
    'render-result'
  ]);
  assert.ok(events.every((event, index) => index === 0 || event.progress >= events[index - 1].progress));
  assert.equal(events.at(-1).stage, 'render-result');
  assert.equal(events.at(-1).progress, 100);

  const externalEvents = events.filter((event) => event.stage === 'external-id-lookup');

  assert.ok(externalEvents.length >= 3);
  assert.equal(externalEvents.at(0).counts.total, 2);
  assert.equal(externalEvents.at(-1).counts.processed, 2);
  assert.equal(externalEvents.at(-1).counts.matched, 0);
  assert.ok(externalEvents.at(0).progress < externalEvents.at(-1).progress);
  assert.equal(result.rows.length, 1);
  assert.equal(
    result.rows[0].crmUrl,
    'https://crm.mygig.ru/coordination?searchDate[]=2026-06-11&searchDate[]=2026-06-11&workplaceIds[]=wp-beta-day'
  );
});

test('findRequestReportRowsWithoutConfirmedShift normalizes technical name prefixes for matching and crm links', async () => {
  const calls = [];
  const client = {
    async queryJSONEachRow(query, params, operation) {
      calls.push({ query, params, operation });

      if (operation === 'request report confirmed shift lookup') {
        return [];
      }

      if (operation === 'request report confirmed composite lookup') {
        return [
          {
            start_date: '2026-06-02',
            start_time: '12:00',
            technical_name: 'МК Бутут',
            confirmed_jobs: 1
          }
        ];
      }

      if (operation === 'request report workplace lookup') {
        return [
          {
            technical_name: 'МК Бутут',
            resolved_workplace_id: '643cf6e9afb2f30008c0591b'
          }
        ];
      }

      return [];
    }
  };
  const rows = [
    {
      idLkk: '7764583',
      dateFrom: '2026-06-02',
      startText: '2026-06-02 12:00',
      timeFrom: '12:00',
      workplace: 'Бутут'
    },
    {
      idLkk: 'missing-butut',
      dateFrom: '2026-06-03',
      startText: '2026-06-03 12:00',
      timeFrom: '12:00',
      workplace: 'Бутут'
    }
  ];

  const result = await findRequestReportRowsWithoutConfirmedShift(client, rows, { batchSize: 10 });

  assert.deepEqual(calls.map((call) => call.operation), [
    'request report confirmed shift lookup',
    'request report confirmed composite lookup',
    'request report workplace lookup'
  ]);
  assert.match(calls[1].query, /'бутут'/);
  assert.match(calls[1].query, /replaceRegexpAll/);
  assert.deepEqual(result.rows.map((row) => row.idLkk), ['missing-butut']);
  assert.equal(
    result.rows[0].crmUrl,
    'https://crm.mygig.ru/coordination?searchDate[]=2026-06-03&searchDate[]=2026-06-03&workplaceIds[]=643cf6e9afb2f30008c0591b'
  );
  assert.deepEqual(result.summary, {
    totalRows: 2,
    rowsWithId: 2,
    checkedExternalIds: 2,
    confirmedRows: 1,
    missingConfirmedRows: 1
  });
});

test('findRequestReportRowsWithoutConfirmedShift returns checked rows with matched shift metadata for export', async () => {
  const client = {
    async queryJSONEachRow(query, params, operation) {
      if (operation === 'request report confirmed shift lookup') {
        return [
          {
            external_id: '101',
            job_id: 'job-101',
            status: 'confirmed',
            workplace_id: 'wp-101'
          }
        ];
      }

      return [];
    }
  };
  const rows = [
    {
      sourceRowNumber: 2,
      idLkk: '101',
      dateFrom: '2026-06-01',
      startText: '2026-06-01 09:00',
      timeFrom: '09:00',
      workplace: 'Point A'
    },
    {
      sourceRowNumber: 3,
      idLkk: '102',
      dateFrom: '2026-06-01',
      startText: '2026-06-01 10:00',
      timeFrom: '10:00',
      workplace: 'Point B'
    }
  ];

  const result = await findRequestReportRowsWithoutConfirmedShift(client, rows, { batchSize: 10 });

  assert.equal(result.checkedRows.length, 2);
  assert.deepEqual(
    result.checkedRows.map((row) => ({
      idLkk: row.idLkk,
      checkResult: row.checkResult,
      matchedShiftId: row.matchedShiftId,
      shiftUrl: row.shiftUrl
    })),
    [
      {
        idLkk: '101',
        checkResult: 'confirmed-found',
        matchedShiftId: 'job-101',
        shiftUrl: 'https://crm.mygig.ru/coordination?searchDate[]=2026-06-01&searchDate[]=2026-06-01&workplaceIds[]=wp-101'
      },
      {
        idLkk: '102',
        checkResult: 'confirmed-missing',
        matchedShiftId: '',
        shiftUrl: ''
      }
    ]
  );
});

test('buildRequestReportCheckWorkbook preserves source columns and appends check result columns', () => {
  const workbook = buildRequestReportCheckWorkbook({
    sourceSheet: {
      headers: [
        'ID ЛКК',
        'Организация',
        'Рабочая точка',
        'Адрес',
        'Сотрудник',
        'Дата запроса "с"',
        'Время запроса "с"',
        'Фактическая продолжительность запроса за вычетом перерыва'
      ],
      rows: [
        {
          sourceRowNumber: 2,
          cells: ['101', 'АО "Тандер"', 'Point A', 'Address 1', 'Ivan Ivanov', '2026-06-01', '09:00', '7.5']
        }
      ]
    },
    rows: [
      {
        sourceRowNumber: 2,
        checkResultLabel: 'Найдена confirmed-смена',
        matchedShiftId: 'job-101',
        shiftUrl: 'https://crm.mygig.ru/coordination?searchDate[]=2026-06-01&searchDate[]=2026-06-01&workplaceIds[]=wp-101',
        reviewStatusLabel: 'Проверена'
      }
    ]
  });
  const parsed = parseRequestsReportWorkbook(workbook);
  const exportedRow = parsed.sourceSheet.rows[0];

  assert.deepEqual(parsed.sourceSheet.headers.slice(-4), [
    'Результат проверки',
    'ID смены если найдена',
    'Ссылка на смену',
    'Статус проверки'
  ]);
  assert.deepEqual(exportedRow.cells.slice(0, 8), [
    '101',
    'АО "Тандер"',
    'Point A',
    'Address 1',
    'Ivan Ivanov',
    '2026-06-01',
    '09:00',
    '7.5'
  ]);
  assert.deepEqual(exportedRow.cells.slice(-4), [
    'Найдена confirmed-смена',
    'job-101',
    'https://crm.mygig.ru/coordination?searchDate[]=2026-06-01&searchDate[]=2026-06-01&workplaceIds[]=wp-101',
    'Проверена'
  ]);
});
