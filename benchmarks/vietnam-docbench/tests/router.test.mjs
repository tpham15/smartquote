import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPdfProbe,
  classifyPdfProbe,
  inferDocumentType,
  planDocumentRoute,
  DOCUMENT_ROUTER_POLICY_V1,
} from "../../../src/import-engine/documentRouter.js";
import { candidateEnginesForRoute, getEngineDescriptor } from "../engines/registry.mjs";

test("PDF router preserves current 80-char scan boundary", () => {
  const scan = classifyPdfProbe({ pageCount: 1, textChars: 79, pages: [{ textChars: 79 }] });
  const digital = classifyPdfProbe({ pageCount: 1, textChars: 80, pages: [{ textChars: 80 }] });
  assert.equal(scan.inputKind, "scan_pdf");
  assert.equal(digital.inputKind, "digital_pdf");
});

test("image-only PDF is scan_pdf", () => {
  const probe = buildPdfProbe({ pageCount: 3, pages: [{ textChars: 0 }, { textChars: 0 }, { textChars: 0 }] });
  const out = classifyPdfProbe(probe);
  assert.equal(out.inputKind, "scan_pdf");
  assert.equal(out.probe.selectablePageCount, 0);
});

test("mixed selectable-text PDF is hybrid_pdf", () => {
  const out = classifyPdfProbe({ pageCount: 3, pages: [{ textChars: 1500 }, { textChars: 0 }, { textChars: 5 }] });
  assert.equal(out.inputKind, "hybrid_pdf");
});

test("native XLSX BOM routes to BOM engine", () => {
  const route = planDocumentRoute({ fileName: "BOM_MEP.xlsx", explicitType: "bom" });
  assert.equal(route.inputKind, "xlsx");
  assert.equal(route.primaryEngine, "smartquote_bom_native_v1");
  assert.equal(route.capabilities.nativeFirst, true);
});

test("digital PDF routes native text first", () => {
  const route = planDocumentRoute({
    fileName: "bang-gia.pdf",
    explicitType: "supplier_price_list",
    pdfProbe: { pageCount: 2, pages: [{ textChars: 900 }, { textChars: 800 }] },
  });
  assert.equal(route.inputKind, "digital_pdf");
  assert.equal(route.primaryEngine, "smartquote_pdf_text_v3");
  assert.equal(route.fallbacks[0], "smartquote_pdf_page_vision_v3");
});

test("scan PDF never routes native text first", () => {
  const route = planDocumentRoute({ fileName: "scan.pdf", pdfProbe: { pageCount: 2, textChars: 0, pages: [{ textChars: 0 }, { textChars: 0 }] } });
  assert.equal(route.primaryEngine, "smartquote_pdf_page_vision_v3");
  assert.equal(route.capabilities.requiresVision, true);
});

test("document type inference is confidence-gated", () => {
  const quote = inferDocumentType({ sampleText: "KHÁCH HÀNG A STT ĐVT SL ĐƠN GIÁ THÀNH TIỀN TỔNG GIÁ TRỊ" });
  const unknown = inferDocumentType({ fileName: "file-2026.xlsx", sampleText: "hello world" });
  assert.equal(quote.documentType, "old_quote");
  assert.equal(unknown.documentType, "other");
});

test("experimental candidates are descriptive, not production primaries", () => {
  const route = planDocumentRoute({ fileName: "scan.pdf", pdfProbe: { pageCount: 1, textChars: 0, pages: [{ textChars: 0 }] } });
  const candidates = candidateEnginesForRoute(route);
  assert.equal(getEngineDescriptor(route.primaryEngine).status, "production");
  assert.ok(candidates.some((e) => e.id === "paddleocr_vl" && e.status === "experimental"));
  assert.notEqual(route.primaryEngine, "paddleocr_vl");
});

test("router policy is explicitly versioned", () => {
  assert.equal(DOCUMENT_ROUTER_POLICY_V1.id, "sq-document-router-v1");
});
