const { execFileSync } = require('node:child_process');

let source = execFileSync('git', ['show', ':src/server.js'], { encoding: 'utf8' });
const declaration = "  const regionExportDirectory = path.join(__dirname, '..', 'data', 'region-giger-exports');\n";
const last = source.lastIndexOf(declaration);
if (last < 0) throw new Error('Export directory declaration not found');
source = source.slice(0, last) + source.slice(last + declaration.length);
const anchor = '  const activity = authEnabled ? activityStore : null;\n';
if (!source.includes(anchor)) throw new Error('Activity declaration not found');
source = source.replace(anchor, anchor + declaration);
const hash = execFileSync('git', ['hash-object', '-w', '--stdin'], { input: source, encoding: 'utf8' }).trim();
execFileSync('git', ['update-index', '--cacheinfo', `100644,${hash},src/server.js`]);
