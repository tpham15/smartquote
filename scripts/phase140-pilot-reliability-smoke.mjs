import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyCommercialValidation,
  validateQuoteCommercialMath,
} from "../src/import-engine/businessValidator.js";
import {
  assessPdfPositiveEvidence,
  findPdfRowEvidence,
} from "../src/import-engine/pdf/pdfEvidence.js";
import { productsToImportPreviewResult } from "../src/import-engine/previewResult.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  key(i) { return [...this.map.keys()][i] || null; }
  get length() { return this.map.size; }
}
globalThis.localStorage = new MemoryStorage();
const telemetry = await import(`../src/import-engine/correctionTelemetry.js?smoke=${Date.now()}`);

// 1) Independent business validator: dealer <= retail, duplicates, history anomaly.
const business = applyCommercialValidation([
  { name: "Công tắc Lumi", sku: "LM-S1", costPrice: 1_800_000, listPrice: 1_500_000, _meta: { issues: [] } },
  { name: "Công tắc Lumi duplicate", sku: "LM-S1", costPrice: 1_000_000, listPrice: 1_500_000, _meta: { issues: [] } },
  { name: "Cảm biến", sku: "LM-MS", costPrice: 2_000_000, listPrice: 2_500_000, _meta: { issues: [] } },
], {
  existingProducts: [{ name: "Cảm biến", sku: "LM-MS", costPrice: 1_000_000 }],
});
assert.ok(business.products[0]._meta.issues.some((x) => x.code === "pilot_business_dealer_above_retail"));
assert.ok(business.products[0]._meta.issues.some((x) => x.code === "pilot_business_duplicate_sku_in_import"));
assert.ok(business.products[2]._meta.issues.some((x) => x.code === "pilot_business_price_change_extreme"));
assert.equal(business.products[0]._meta.canonicalStatus, "need_review");

// 1b) Human approval may accept a warning, but never bypass a hard business error.
const acceptedWarning = applyCommercialValidation([{
  name: "Cảm biến", sku: "LM-MS", costPrice: 1_500_000, listPrice: 2_500_000,
  _meta: { issues: [], userApproved: true, canonicalStatus: "auto_approved" },
}], { existingProducts: [{ name: "Cảm biến", sku: "LM-MS", costPrice: 1_000_000 }] });
assert.equal(acceptedWarning.summary.warnings, 0);
assert.equal(acceptedWarning.products[0]._meta.issues?.some((x) => x.code === "pilot_business_price_change_outlier"), false);

const acceptedHardError = applyCommercialValidation([{
  name: "Cảm biến", sku: "LM-X", costPrice: 2_000_000, listPrice: 1_500_000,
  _meta: { issues: [], userApproved: true },
}]);
assert.ok(acceptedHardError.products[0]._meta.issues.some((x) => x.code === "pilot_business_dealer_above_retail"));

// Retail fallback must not be shadowed by a zero listPrice.
const retailFallback = applyCommercialValidation([{
  name: "Fallback", sku: "FB-1", costPrice: 1_600_000, listPrice: 0, minRetailPrice: 1_500_000, _meta: { issues: [] },
}]);
assert.ok(retailFallback.products[0]._meta.issues.some((x) => x.code === "pilot_business_dealer_above_retail"));

// 2) Deterministic quote math is reusable independently from OCR.
const quoteMath = validateQuoteCommercialMath({
  lines: [{ qty: 2, unitPrice: 100_000, lineTotal: 190_000 }],
  subtotal: 190_000,
  vatRate: 0.1,
  vatAmount: 19_000,
  total: 220_000,
});
assert.ok(quoteMath.issues.some((x) => x.code === "grand_total_mismatch"));

// 3) Positive evidence: price-only garbage is not a product candidate.
const weak = assessPdfPositiveEvidence({
  name: "Ghi chú thanh toán",
  costPrice: 200_000,
  _meta: { engine: "pdf-v3-text-heuristic", source: { type: "pdf", rawText: "Ghi chú thanh toán 200,000" } },
}, "pdf-v3-text-heuristic");
assert.equal(weak.positive, false);
assert.equal(weak.autoApprove, false);

const strong = assessPdfPositiveEvidence({
  name: "Công tắc cảm ứng Lumi",
  sku: "LM-S1",
  costPrice: 1_250_000,
  listPrice: 1_690_000,
  category: "CÔNG TẮC",
  _meta: {
    engine: "pdf-v3-text-heuristic",
    source: { type: "pdf", rawText: "Công tắc cảm ứng LM-S1 1,250,000", bbox: { x: 10, y: 20, width: 100, height: 12 } },
    productEvidence: { hasSku: true, hasProductKeyword: true, hasGrounding: true, hasExplicitUnit: true },
  },
}, "pdf-v3-text-heuristic");
assert.equal(strong.positive, true);
assert.equal(strong.autoApprove, true);

// 4) Grounding matches the original pdfjs row and preserves bbox/parts.
const page = {
  page: 2,
  pageWidth: 595,
  pageHeight: 842,
  rows: [
    { text: "STT Tên sản phẩm Mã Giá", bbox: { x: 20, y: 780, width: 500, height: 12 }, parts: [] },
    { text: "1 Công tắc cảm ứng LM-S1 1,250,000", bbox: { x: 20, y: 740, width: 500, height: 12 }, parts: [{ x: 420, width: 70, height: 12, str: "1,250,000" }] },
  ],
};
const evidence = findPdfRowEvidence(page, "Công tắc cảm ứng LM-S1 1,250,000");
assert.equal(evidence.row, 2);
assert.deepEqual(evidence.bbox, page.rows[1].bbox);
assert.equal(evidence.pageWidth, 595);
assert.equal(evidence.parts[0].str, "1,250,000");

// 5) Preview contract keeps grounding coordinates all the way to UI.
const preview = productsToImportPreviewResult({
  products: [{
    name: "Công tắc cảm ứng Lumi", sku: "LM-S1", costPrice: 1_250_000,
    _meta: { source: { type: "pdf", page: 2, row: 2, rawText: page.rows[1].text, bbox: page.rows[1].bbox, parts: page.rows[1].parts, pageWidth: 595, pageHeight: 842 }, issues: [], canonicalStatus: "auto_approved" },
  }],
  fileName: "supplier.pdf",
});
assert.deepEqual(preview.lines[0].source.bbox, page.rows[1].bbox);
assert.equal(preview.lines[0].source.parts[0].str, "1,250,000");
assert.equal(preview.lines[0].source.pageHeight, 842);

// 6) Append-only correction telemetry stores before/after + source.
const before = { name: "Sai tên", sku: "LM-S1", costPrice: 1_200_000, _meta: { source: { type: "pdf", page: 2, row: 2, rawText: page.rows[1].text, bbox: page.rows[1].bbox } } };
const after = { ...before, name: "Công tắc cảm ứng Lumi", costPrice: 1_250_000 };
const saved = telemetry.recordCorrectionEvent({ action: "edit", before, after, fileName: "supplier.pdf", importId: "imp_1", lineId: "line_1" });
assert.equal(saved.ok, true);
const events = telemetry.loadCorrectionEvents();
assert.equal(events.length, 1);
assert.equal(events[0].before.name, "Sai tên");
assert.equal(events[0].after.costPrice, 1_250_000);
assert.equal(events[0].source.page, 2);
assert.deepEqual(events[0].source.bbox, page.rows[1].bbox);

// 7) Static pilot wiring: click-to-source viewer + API coordinates + no new OCR routing.
const smartQuote = fs.readFileSync(path.join(root, "src/SmartQuote.jsx"), "utf8");
const api = fs.readFileSync(path.join(root, "api/pdf-extract.js"), "utf8");
assert.match(smartQuote, /PdfGroundingViewer/);
assert.match(smartQuote, /ci-ground-price/);
assert.match(smartQuote, /applyCommercialValidation/);
assert.match(smartQuote, /recordCorrectionEvent/);
assert.match(api, /pageWidth/);
assert.match(api, /pageHeight/);
assert.match(api, /bbox:/);

console.log("✓ Phase 14.0 Pilot Reliability smoke PASS");
console.log(`  business issues: ${business.summary.errors} errors / ${business.summary.warnings} warnings`);
console.log(`  positive evidence: weak=${weak.score}, strong=${strong.score}`);
console.log(`  grounding: page 2 row ${evidence.row}, bbox preserved`);
console.log(`  correction telemetry: ${events.length} append-only event`);
