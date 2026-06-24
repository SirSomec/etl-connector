const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractRequestsReportRowsFromSheetRows,
  findRequestReportRowsWithoutConfirmedShift
} = require('../src/requestReportMissingConfirmed');

test('extractRequestsReportRowsFromSheetRows maps request report columns', () => {
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
  ]);

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

test('findRequestReportRowsWithoutConfirmedShift uses unique confirmed composite fallback only without direct job', async () => {
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
  assert.deepEqual(result.rows.map((row) => row.idLkk), ['cancelled-id', 'ambiguous-id']);
  assert.equal(
    result.rows[1].crmUrl,
    'https://crm.mygig.ru/coordination?searchDate[]=2026-06-01&searchDate[]=2026-06-01&workplaceIds[]=wp-b'
  );
  assert.deepEqual(result.summary, {
    totalRows: 3,
    rowsWithId: 3,
    checkedExternalIds: 3,
    confirmedRows: 1,
    missingConfirmedRows: 2
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
