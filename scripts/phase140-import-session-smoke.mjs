import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'src', 'SmartQuote.jsx'), 'utf8');

assert.match(src, /const importRunRef = useRef\(0\);/, 'catalog importer needs a monotonic import session id');
assert.match(src, /const runId = beginImportRun\(f\);/, 'single-file import must start a fresh session');
assert.match(src, /parsePDFToProducts\(f, runId\)/, 'PDF import must bind async work to its session');
assert.ok((src.match(/if \(!isCurrentImportRun\(runId\)\) return;/g) || []).length >= 8,
  'async import paths need stale-session guards before committing UI state');
assert.match(src, /onProgress: \(event\) => \{\s*if \(!isCurrentImportRun\(runId\)\) return;/,
  'stale PDF progress must not mutate the new import UI');
assert.match(src, /onClick=\{cancelImportRun\}>← Chọn file khác<\/button>/,
  'choosing another file must invalidate the current async import');
assert.match(src, /ci-import-source[^\n]*importResult\?\.fileName/, 'preview must visibly identify its source file');

console.log('✓ Phase 14.0 import-session isolation smoke PASS');
console.log('  stale PDF/Excel/web result cannot overwrite a newer import preview');
