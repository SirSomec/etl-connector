const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

function tempPathFor(filePath) {
  const directory = path.dirname(filePath);
  const baseName = path.basename(filePath);
  const uniquePart = `${process.pid}-${Date.now()}-${crypto.randomUUID()}`;

  return path.join(directory, `.${baseName}.${uniquePart}.tmp`);
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetryableRenameError(error) {
  return error && ['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code);
}

async function renameWithRetry(sourcePath, targetPath) {
  const maxAttempts = 10;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await fs.rename(sourcePath, targetPath);
      return;
    } catch (error) {
      if (!isRetryableRenameError(error) || attempt === maxAttempts) {
        throw error;
      }

      await delay(attempt * 10);
    }
  }
}

async function writeFileAtomically(filePath, contents, encoding = 'utf8') {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  const tempPath = tempPathFor(filePath);

  try {
    await fs.writeFile(tempPath, contents, encoding);
    await renameWithRetry(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

module.exports = {
  writeFileAtomically
};
