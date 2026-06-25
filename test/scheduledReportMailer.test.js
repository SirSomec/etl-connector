const test = require('node:test');
const assert = require('node:assert/strict');

const { createScheduledReportMailer, sanitizeMailError } = require('../src/scheduledReportMailer');

function reportInput(overrides = {}) {
  return {
    settings: {
      host: 'smtp.example.test',
      port: 465,
      secureMode: 'ssl',
      username: 'sender',
      password: 'Secret123!',
      fromEmail: 'sender@example.test',
      fromName: 'Reports',
      ...(overrides.settings || {})
    },
    recipients: ['a@example.test'],
    subject: 'Report',
    body: 'Attached',
    filename: 'report.xlsx',
    fileBuffer: Buffer.from('xlsx'),
    ...Object.fromEntries(
      Object.entries(overrides).filter(([key]) => key !== 'settings')
    )
  };
}

test('scheduled report mailer sends xlsx attachment through injected transport', async () => {
  const transports = [];
  const sent = [];
  const mailer = createScheduledReportMailer({
    createTransport(options) {
      transports.push(options);
      return {
        async sendMail(message) {
          sent.push(message);
          return { messageId: 'msg-1' };
        }
      };
    }
  });

  const result = await mailer.sendReport({
    settings: {
      host: 'smtp.example.test',
      port: 465,
      secureMode: 'ssl',
      username: 'sender',
      password: 'Secret123!',
      fromEmail: 'sender@example.test',
      fromName: 'Reports'
    },
    recipients: ['a@example.test', 'b@example.test'],
    subject: 'Report',
    body: 'Attached',
    filename: 'report.xlsx',
    fileBuffer: Buffer.from('xlsx')
  });

  assert.equal(result.messageId, 'msg-1');
  assert.deepEqual(transports[0], {
    host: 'smtp.example.test',
    port: 465,
    secure: true,
    auth: {
      user: 'sender',
      pass: 'Secret123!'
    }
  });
  assert.deepEqual(sent[0].from, { name: 'Reports', address: 'sender@example.test' });
  assert.equal(sent[0].to, 'a@example.test, b@example.test');
  assert.equal(sent[0].subject, 'Report');
  assert.equal(sent[0].text, 'Attached');
  assert.equal(sent[0].attachments[0].filename, 'report.xlsx');
  assert.deepEqual(sent[0].attachments[0].content, Buffer.from('xlsx'));
  assert.equal(
    sent[0].attachments[0].contentType,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
});

test('scheduled report mailer omits auth when username is empty', async () => {
  const transports = [];
  const mailer = createScheduledReportMailer({
    createTransport(options) {
      transports.push(options);
      return {
        async sendMail() {
          return { messageId: 'msg-2' };
        }
      };
    }
  });

  await mailer.sendReport({
    settings: {
      host: 'smtp.example.test',
      port: 587,
      secureMode: 'starttls',
      username: '',
      password: 'Secret123!',
      fromEmail: 'sender@example.test',
      fromName: ''
    },
    recipients: ['a@example.test'],
    subject: 'Report',
    body: '',
    filename: 'report.xlsx',
    fileBuffer: Buffer.from('xlsx')
  });

  assert.equal(transports[0].secure, false);
  assert.equal(transports[0].requireTLS, true);
  assert.equal(Object.prototype.hasOwnProperty.call(transports[0], 'auth'), false);
});

test('scheduled report mailer rejects plaintext and unknown secure modes', async () => {
  const mailer = createScheduledReportMailer({
    createTransport() {
      throw new Error('transport should not be created');
    }
  });

  for (const secureMode of ['plain', 'other']) {
    await assert.rejects(
      () => mailer.sendReport(reportInput({
        settings: { secureMode }
      })),
      /Invalid SMTP secure mode: expected ssl or starttls/
    );
  }
});

test('scheduled report mailer rejects header injection and invalid addresses', async () => {
  const mailer = createScheduledReportMailer({
    createTransport() {
      throw new Error('transport should not be created');
    }
  });

  const invalidInputs = [
    reportInput({ recipients: ['a@example.test\r\nBcc: attacker@example.test'] }),
    reportInput({ settings: { fromEmail: 'sender@example.test\r\nBcc: attacker@example.test' } }),
    reportInput({ settings: { fromName: 'Reports\r\nBcc: attacker@example.test' } }),
    reportInput({ recipients: ['not-an-email'] })
  ];

  for (const input of invalidInputs) {
    await assert.rejects(
      () => mailer.sendReport(input),
      /Invalid SMTP/
    );
  }
});

test('scheduled report mailer rejects header injection in subject', async () => {
  const mailer = createScheduledReportMailer({
    createTransport() {
      throw new Error('transport should not be created');
    }
  });

  await assert.rejects(
    () => mailer.sendReport(reportInput({
      subject: 'Report\r\nBcc: attacker@example.test'
    })),
    /Invalid SMTP subject/
  );
});

test('scheduled report mailer rejects unsafe attachment filename', async () => {
  const mailer = createScheduledReportMailer({
    createTransport() {
      throw new Error('transport should not be created');
    }
  });

  const invalidFilenames = [
    'report\r\nbad.xlsx',
    '../report.xlsx',
    'nested/report.xlsx',
    'nested\\report.xlsx',
    ''
  ];

  for (const filename of invalidFilenames) {
    await assert.rejects(
      () => mailer.sendReport(reportInput({ filename })),
      /Invalid report filename/
    );
  }
});

test('scheduled report mailer requires xlsx attachment buffer', async () => {
  const mailer = createScheduledReportMailer({
    createTransport() {
      throw new Error('transport should not be created');
    }
  });

  await assert.rejects(
    () => mailer.sendReport(reportInput({ fileBuffer: 'xlsx' })),
    /Report attachment must be a Buffer/
  );
});

test('scheduled report mailer sanitizes transport errors before throwing', async () => {
  const sendMailMailer = createScheduledReportMailer({
    createTransport() {
      return {
        async sendMail() {
          throw new Error('auth failed for sender with Secret123!');
        }
      };
    }
  });
  const createTransportMailer = createScheduledReportMailer({
    createTransport() {
      throw new Error('connect failed for sender using Secret123!');
    }
  });

  for (const mailer of [sendMailMailer, createTransportMailer]) {
    await assert.rejects(
      () => mailer.sendReport(reportInput()),
      (error) => {
        assert.equal(error instanceof Error, true);
        assert.equal(error.message.includes('Secret123!'), false);
        assert.equal(error.message.includes('sender'), false);
        assert.match(error.message, /\[redacted\]/);
        return true;
      }
    );
  }
});

test('scheduled report mailer sanitizes normalized SMTP username before throwing', async () => {
  const mailer = createScheduledReportMailer({
    createTransport(options) {
      assert.deepEqual(options.auth, {
        user: 'sender',
        pass: 'Secret123!'
      });
      return {
        async sendMail() {
          throw new Error('auth failed for user=sender');
        }
      };
    }
  });

  await assert.rejects(
    () => mailer.sendReport(reportInput({
      settings: {
        username: ' sender '
      }
    })),
    (error) => {
      assert.equal(error.message.includes('sender'), false);
      assert.match(error.message, /\[redacted\]/);
      return true;
    }
  );
});

test('scheduled report mailer requires configured SMTP host and from email', async () => {
  const mailer = createScheduledReportMailer({
    createTransport() {
      throw new Error('transport should not be created');
    }
  });

  await assert.rejects(
    () => mailer.sendReport({
      settings: { fromEmail: 'sender@example.test' },
      recipients: ['a@example.test'],
      subject: 'Report',
      body: '',
      filename: 'report.xlsx',
      fileBuffer: Buffer.from('xlsx')
    }),
    /SMTP is not configured/
  );

  await assert.rejects(
    () => mailer.sendReport({
      settings: { host: 'smtp.example.test' },
      recipients: ['a@example.test'],
      subject: 'Report',
      body: '',
      filename: 'report.xlsx',
      fileBuffer: Buffer.from('xlsx')
    }),
    /SMTP is not configured/
  );
});

test('sanitizeMailError redacts SMTP password and username', () => {
  const message = sanitizeMailError(
    new Error('auth failed for sender with Secret123! using sender@example.test'),
    { username: 'sender', password: 'Secret123!' }
  );

  assert.equal(message.includes('Secret123!'), false);
  assert.equal(message.includes('sender'), false);
  assert.match(message, /\[redacted\]/);
});
