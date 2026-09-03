#!/usr/bin/env node
import fs from "node:fs";
import assert from "node:assert/strict";
import { planDocumentRoute, classifyPdfProbe } from "../src/import-engine/documentRouter.js";
import { ENGINE_REGISTRY } from "../benchmarks/vietnam-docbench/engines/registry.mjs";

const api = fs.readFileSync(new URL("../api/pdf-extract.js", import.meta.url), "utf8");
const pipeline = fs.readFileSync(new URL("../src/import-engine/pdf/pdfCatalogPipeline.js", import.meta.url), "utf8");
assert.match(api, /buildPdfProbe/);
assert.match(api, /classifyPdfProbe/);
assert.match(api, /probe:/);
assert.match(pipeline, /planDocumentRoute/);
assert.match(pipeline, /route\.inputKind === "scan_pdf"/);

assert.equal(classifyPdfProbe({ pageCount: 1, textChars: 79, pages: [{ textChars: 79 }] }).inputKind, "scan_pdf");
assert.equal(classifyPdfProbe({ pageCount: 1, textChars: 80, pages: [{ textChars: 80 }] }).inputKind, "digital_pdf");
const scanRoute = planDocumentRoute({ fileName: "x.pdf", pdfProbe: { pageCount: 2, pages: [{ textChars: 0 }, { textChars: 0 }] } });
assert.equal(scanRoute.primaryEngine, "smartquote_pdf_page_vision_v3");
const bomRoute = planDocumentRoute({ fileName: "BOM.xlsx", explicitType: "bom" });
assert.equal(bomRoute.primaryEngine, "smartquote_bom_native_v1");
for (const id of ["paddleocr_vl", "pp_structure_v3", "mineru", "vlm_fallback"]) assert.equal(ENGINE_REGISTRY[id].status, "experimental");

// Guard: experimental engines must not be imported from production source.
for (const file of fs.readdirSync(new URL("../src/import-engine/", import.meta.url), { withFileTypes: true })) {
  if (!file.isFile() || !file.name.endsWith(".js") || file.name === "documentRouter.js") continue;
  const text = fs.readFileSync(new URL(`../src/import-engine/${file.name}`, import.meta.url), "utf8");
  assert.doesNotMatch(text, /paddleocr_vl|pp_structure_v3|mineru_office|\bmineru\b/);
}
console.log("✓ Phase 13.1 document router smoke PASS");
