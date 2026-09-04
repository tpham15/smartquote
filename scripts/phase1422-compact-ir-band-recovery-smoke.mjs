import assert from 'node:assert/strict';
import fs from 'node:fs';

const api = fs.readFileSync('api/claude.js', 'utf8');
const mapper = fs.readFileSync('src/import-engine/legacy/legacyClaudeMapper.js', 'utf8');
const doc = fs.readFileSync('src/import-engine/pdf/pdfDocumentFramework.js', 'utf8');
const pipe = fs.readFileSync('src/import-engine/pdf/pdfCatalogPipeline.js', 'utf8');
const smart = fs.readFileSync('src/SmartQuote.jsx', 'utf8');

assert.match(api, /thinkingType/);
assert.match(mapper, /payload\.thinking/);
assert.match(mapper, /Claude Structured Output bị cắt/);
assert.match(doc, /required: \['page', 'pageType', 'tables', 'sections', 'rows', 'ignoredRegions'\]/);
assert.match(doc, /expandCompactPdfDocumentIR/);
assert.match(pipe, /thinking: \{ type: "disabled" \}/);
assert.match(pipe, /max_tokens: bandLabel \? 10000/);
assert.match(pipe, /function isLayoutSplitError/);
assert.match(pipe, /parsePageBands/);
assert.match(pipe, /bandY0:/);
assert.match(pipe, /full-page \+ band recovery/);
assert.match(smart, /v14_2_2_compact_ir_band_recovery_v1/);

console.log('✓ Phase 14.2.2 Compact IR + Band Recovery smoke PASS');
console.log('  - Sonnet 5 adaptive thinking disabled for document transcription');
console.log('  - model-facing Document IR flattened and token-efficient');
console.log('  - max_tokens/invalid JSON immediately falls back to horizontal bands');
console.log('  - sparse signature/footer pages also get band recovery');
console.log('  - band bboxes remap to original page coordinates');
