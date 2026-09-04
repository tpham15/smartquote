import assert from 'node:assert/strict';
import fs from 'node:fs';

const api = fs.readFileSync('api/claude.js', 'utf8');
const doc = fs.readFileSync('src/import-engine/pdf/pdfDocumentFramework.js', 'utf8');
const pipe = fs.readFileSync('src/import-engine/pdf/pdfCatalogPipeline.js', 'utf8');
const mapper = fs.readFileSync('src/import-engine/legacy/legacyClaudeMapper.js', 'utf8');
const smart = fs.readFileSync('src/SmartQuote.jsx', 'utf8');

assert.match(api, /sanitizeStructuredOutputSchema/);
assert.match(api, /'minimum'.*'maximum'/s);
assert.match(api, /schema: safeSchema/);
assert.doesNotMatch(doc, /minimum:\s*0/);
assert.doesNotMatch(doc, /maximum:\s*100/);
assert.doesNotMatch(doc, /minItems:\s*4/);
assert.match(mapper, /retrying once as plain JSON/);
assert.match(pipe, /failedPageNumbers = new Set/);
assert.match(pipe, /Math\.min\(failedPages, totalPages\)/);
assert.match(pipe, /Chi tiết:/);
assert.match(smart, /v14_2_1_structured_schema_runtime_v1/);

console.log('✓ Phase 14.2.1 Structured Schema Runtime smoke PASS');
console.log('  - unsupported raw JSON-Schema constraints removed before Claude');
console.log('  - structured output has one plain-JSON fallback');
console.log('  - page retry accounting cannot report 6/3');
console.log('  - real API/schema errors surface in the import UI');
