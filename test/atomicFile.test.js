const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { writeFileAtomically } = require('../src/atomicFile');

test('atomic file writes tolerate concurrent writes to the same target', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-file-'));
  const filePath = path.join(tempDir, 'cache.json');

  try {
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        writeFileAtomically(filePath, JSON.stringify({ index }), 'utf8')
      )
    );

    const finalBody = await fs.readFile(filePath, 'utf8');
    const leftoverTempFiles = (await fs.readdir(tempDir)).filter((fileName) =>
      fileName.endsWith('.tmp')
    );

    assert.doesNotThrow(() => JSON.parse(finalBody));
    assert.deepEqual(leftoverTempFiles, []);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
