const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

function parseBoundary(contentType) {
  const match = String(contentType || '').match(/(?:^|;)\s*boundary=(?:"([^"]+)"|([^;]+))/i);

  return match ? (match[1] || match[2] || '').trim() : '';
}

async function readRequestBuffer(req, maxBytes) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

    totalBytes += buffer.length;

    if (totalBytes > maxBytes) {
      const error = new Error('Загруженный файл слишком большой.');

      error.statusCode = 413;
      throw error;
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

function indexOfBuffer(buffer, search, start = 0) {
  return buffer.indexOf(search, start);
}

function trimPartBody(buffer) {
  if (buffer.length >= 2 && buffer[buffer.length - 2] === 13 && buffer[buffer.length - 1] === 10) {
    return buffer.subarray(0, buffer.length - 2);
  }

  return buffer;
}

function headerParameter(value, name) {
  const pattern = new RegExp(`(?:^|;)\\s*${name}=("([^"]*)"|[^;]*)`, 'i');
  const match = String(value || '').match(pattern);

  if (!match) {
    return '';
  }

  const raw = match[2] !== undefined ? match[2] : match[1];

  return String(raw || '').replace(/^"|"$/g, '');
}

function parsePartHeaders(text) {
  const headers = {};

  for (const line of String(text || '').split(/\r?\n/)) {
    const separator = line.indexOf(':');

    if (separator <= 0) {
      continue;
    }

    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    headers[name] = value;
  }

  return headers;
}

function parseMultipartBuffer(buffer, boundary) {
  const delimiter = Buffer.from(`--${boundary}`);
  const fields = {};
  const files = {};
  let cursor = 0;

  while (cursor < buffer.length) {
    const delimiterIndex = indexOfBuffer(buffer, delimiter, cursor);

    if (delimiterIndex < 0) {
      break;
    }

    const partStart = delimiterIndex + delimiter.length;

    if (buffer.subarray(partStart, partStart + 2).toString('latin1') === '--') {
      break;
    }

    let contentStart = partStart;

    if (buffer.subarray(contentStart, contentStart + 2).toString('latin1') === '\r\n') {
      contentStart += 2;
    }

    const nextDelimiter = indexOfBuffer(buffer, delimiter, contentStart);

    if (nextDelimiter < 0) {
      break;
    }

    const part = buffer.subarray(contentStart, nextDelimiter);
    const headerEnd = indexOfBuffer(part, Buffer.from('\r\n\r\n'));

    if (headerEnd >= 0) {
      const headers = parsePartHeaders(part.subarray(0, headerEnd).toString('latin1'));
      const body = trimPartBody(part.subarray(headerEnd + 4));
      const disposition = headers['content-disposition'] || '';
      const name = headerParameter(disposition, 'name');
      const filename = headerParameter(disposition, 'filename');

      if (name) {
        if (filename) {
          files[name] = {
            filename,
            contentType: headers['content-type'] || 'application/octet-stream',
            buffer: body
          };
        } else {
          fields[name] = body.toString('utf8');
        }
      }
    }

    cursor = nextDelimiter;
  }

  return { fields, files };
}

async function parseMultipartFormData(req, options = {}) {
  const boundary = parseBoundary(req.headers && req.headers['content-type']);

  if (!boundary) {
    const error = new Error('Ожидался multipart/form-data запрос.');

    error.statusCode = 400;
    throw error;
  }

  const maxBytes = Number.isInteger(options.maxBytes) && options.maxBytes > 0
    ? options.maxBytes
    : DEFAULT_MAX_BYTES;
  const body = await readRequestBuffer(req, maxBytes);

  return parseMultipartBuffer(body, boundary);
}

module.exports = {
  parseMultipartFormData
};
