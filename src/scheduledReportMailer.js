const nodemailer = require('nodemailer');

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CONTROL_CHAR_RE = /[\x00-\x1F\x7F]/;
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function text(value) {
  return String(value || '').trim();
}

function assertNoControlChars(value, label) {
  if (CONTROL_CHAR_RE.test(String(value || ''))) {
    throw new Error(`Invalid SMTP ${label}`);
  }
}

function assertEmail(value, label) {
  assertNoControlChars(value, label);

  const email = text(value);
  if (!EMAIL_RE.test(email)) {
    throw new Error(`Invalid SMTP ${label}`);
  }

  return email;
}

function smtpSecurityOptions(mode) {
  const secureMode = text(mode || 'starttls');

  if (secureMode === 'ssl') {
    return { secure: true };
  }
  if (secureMode === 'starttls') {
    return { secure: false, requireTLS: true };
  }

  throw new Error('Invalid SMTP secure mode: expected ssl or starttls');
}

function mailAddressFromSettings(settings) {
  const address = assertEmail(settings && settings.fromEmail, 'from email');
  assertNoControlChars(settings && settings.fromName, 'from name');
  const name = text(settings && settings.fromName);

  return name ? { name, address } : address;
}

function recipientList(recipients) {
  const values = Array.isArray(recipients)
    ? recipients
    : String(recipients || '').split(/[;,]/);
  const emails = values
    .map((recipient) => assertEmail(recipient, 'recipient email'));

  if (emails.length === 0) {
    throw new Error('Invalid SMTP recipient email');
  }

  return emails.join(', ');
}

function mailSubject(value) {
  assertNoControlChars(value, 'subject');
  return String(value || '');
}

function attachmentFilename(value) {
  const filename = text(value);

  if (!filename || CONTROL_CHAR_RE.test(String(value || '')) || /[\\/]/.test(filename)) {
    throw new Error('Invalid report filename');
  }

  return filename;
}

function sanitizeMailError(error, settings = {}) {
  let message = String((error && error.message) || error || 'SMTP error');
  const secrets = [];

  for (const secret of [settings.password, settings.username]) {
    const raw = String(secret || '');
    const normalized = raw.trim();

    if (raw) {
      secrets.push(raw);
    }
    if (normalized && normalized !== raw) {
      secrets.push(normalized);
    }
  }

  for (const secret of [...new Set(secrets)].sort((a, b) => b.length - a.length)) {
    message = message.split(secret).join('[redacted]');
  }

  return message;
}

function createScheduledReportMailer({ createTransport = nodemailer.createTransport } = {}) {
  return {
    async sendReport({ settings, recipients, subject, body, filename, fileBuffer }) {
      const host = text(settings && settings.host);
      const fromEmail = text(settings && settings.fromEmail);

      if (!host || !fromEmail) {
        throw new Error('SMTP is not configured');
      }
      if (!Buffer.isBuffer(fileBuffer)) {
        throw new Error('Report attachment must be a Buffer');
      }

      const from = mailAddressFromSettings(settings);
      const to = recipientList(recipients);
      const safeSubject = mailSubject(subject);
      const safeFilename = attachmentFilename(filename);
      const transportOptions = {
        host,
        port: Number(settings.port) || 587,
        ...smtpSecurityOptions(settings.secureMode)
      };
      const username = text(settings.username);

      if (username) {
        transportOptions.auth = {
          user: username,
          pass: settings.password || ''
        };
      }

      try {
        const transport = createTransport(transportOptions);

        return await transport.sendMail({
          from,
          to,
          subject: safeSubject,
          text: body || '',
          attachments: [{
            filename: safeFilename,
            content: fileBuffer,
            contentType: XLSX_CONTENT_TYPE
          }]
        });
      } catch (error) {
        throw new Error(sanitizeMailError(error, settings));
      }
    }
  };
}

module.exports = {
  createScheduledReportMailer,
  sanitizeMailError
};
