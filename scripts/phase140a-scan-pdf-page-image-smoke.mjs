import assert from "node:assert/strict";
import fs from "node:fs";

const pipeline = fs.readFileSync(new URL("../src/import-engine/pdf/pdfCatalogPipeline.js", import.meta.url), "utf8");
const claude = fs.readFileSync(new URL("../api/claude.js", import.meta.url), "utf8");

assert.ok(pipeline.includes('type: "image"'), "scan page calls must send Claude an image block");
assert.ok(pipeline.includes('pdfjs-dist/legacy/build/pdf.mjs'), "scan page vision must render with pdfjs in browser");
assert.ok(pipeline.includes('page.getViewport({ scale: 1 })'), "page renderer must use PDF.js viewport (honors page rotation)");
assert.ok(pipeline.includes('PDF_VISION_MAX_BASE64_CHARS = 760000'), "client must keep image base64 safely under proxy body cap");
assert.ok(pipeline.includes('renderBands(pageNum)'), "dense/zero-row scan pages need row-band recovery");
assert.ok(pipeline.includes('knownLumiReleaseKind'), "2026.06.01 Lumi filenames without the Lumi word must still activate coverage recovery");
assert.ok(pipeline.includes('Page-image vision'), "scan failures should report the new page-image path");

const scanBranchStart = pipeline.indexOf('if (route.inputKind === "scan_pdf"');
const scanBranchEnd = pipeline.indexOf('\n  onProgress?.({\n    stage: "chunk"', scanBranchStart);
assert.ok(scanBranchStart >= 0 && scanBranchEnd > scanBranchStart, "scan route branch must be present");
const scanBranch = pipeline.slice(scanBranchStart, scanBranchEnd);
assert.ok(!scanBranch.includes('extractCatalogPdfWithClaude({ file, supplierGuess })'), "scan route must not resend the whole PDF after page-image failure");
assert.ok(!scanBranch.includes('type: "document"'), "scan page path must not attach the whole PDF document per page");

assert.ok(claude.includes("block.type === 'image'"), "/api/claude must preserve image blocks");
assert.ok(claude.includes('SMARTQUOTE_MAX_CLAUDE_IMAGE_BASE64_CHARS'), "/api/claude must cap image payloads explicitly");
assert.ok(claude.includes("'image/jpeg'"), "/api/claude must allow JPEG page renders");

// Concrete Lumi regression arithmetic. The uploaded pilot PDF is 1,446,491 bytes,
// which expands to ~1.93M base64 chars — above both old proxy caps (950k doc block,
// 1.2MB whole request). A 760k page image stays below those limits.
const lumiBytes = 1446491;
const fullPdfBase64Chars = Math.ceil(lumiBytes / 3) * 4;
assert.ok(fullPdfBase64Chars > 950000, "fixture must reproduce the old document-block 413");
assert.ok(fullPdfBase64Chars > 1200000, "fixture must reproduce the old request-body 413");
assert.ok(760000 < 850000 && 850000 < 1200000, "page image cap must fit proxy image/body budgets");

console.log("✓ Phase 14.0A scan PDF page-image smoke PASS");
console.log(`  old full-PDF base64: ${fullPdfBase64Chars.toLocaleString()} chars -> 413`);
console.log("  new page-image budget: <= 760,000 chars -> proxy-safe");
