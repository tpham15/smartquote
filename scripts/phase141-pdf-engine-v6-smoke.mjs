import fs from "node:fs";
import assert from "node:assert/strict";
import { assessPdfVisionTrust } from "../src/import-engine/pdf/pdfEvidence.js";

const strong = {
  name: "Đèn Spotlight âm trần 7W chỉnh hướng, 24D",
  sku: "LM-ST7-55-O / LM-ST7-55-D / LM-ST7-55-T",
  category: "SPOTLIGHT",
  costPrice: 648000,
  variants: [
    { sku: "LM-ST7-55-O", label: "On/off", price: 648000 },
    { sku: "LM-ST7-55-D", label: "Smart dimmable", price: 810000 },
    { sku: "LM-ST7-55-T", label: "Smart Tunable", price: 1080000 },
  ],
  _meta: { engine: "pdf-v6-page-structured", source: { type: "pdf", page: 1, row: 1 }, issues: [] },
};
assert.equal(assessPdfVisionTrust(strong, "pdf-v6-page-structured").trusted, true);
assert.equal(assessPdfVisionTrust({ ...strong, sku: "", variants: [] }, "pdf-v6-page-structured").trusted, false);
assert.equal(assessPdfVisionTrust({ ...strong, costPrice: 0, variants: strong.variants.map(v => ({...v, price: 0})) }, "pdf-v6-page-structured").trusted, false);

const pipeline = fs.readFileSync("src/import-engine/pdf/pdfCatalogPipeline.js", "utf8");
const mapper = fs.readFileSync("src/import-engine/legacy/legacyClaudeMapper.js", "utf8");
const api = fs.readFileSync("api/claude.js", "utf8");
const app = fs.readFileSync("src/SmartQuote.jsx", "utf8");
assert.match(pipeline, /callClaudeStructured/);
assert.match(pipeline, /finalizePdfTrust/);
assert.match(pipeline, /pdf-v6-page-structured/);
assert.match(pipeline, /variants: mergeVariantArrays/);
assert.match(mapper, /PDF_CATALOG_OUTPUT_SCHEMA/);
assert.match(mapper, /claude-sonnet-5/);
assert.match(mapper, /output_config/);
assert.match(api, /claude-sonnet-5/);
assert.match(api, /output_config/);
assert.match(api, /3800000/);
assert.match(app, /v14_1_pdf_engine_v6/);

console.log("✓ Phase 14.1 PDF Engine v6 smoke PASS");
console.log("  Sonnet 5 + Structured Outputs");
console.log("  deterministic row trust (no blanket AI review)");
console.log("  SKU↔price variants preserved");
console.log("  native small-PDF path + page-vision fallback");
console.log("  cache bumped to v14_1_pdf_engine_v6");
