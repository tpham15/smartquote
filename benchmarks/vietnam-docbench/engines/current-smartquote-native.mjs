// Current SmartQuote native-only benchmark adapter.
// Requires normal project dependencies (`npm ci`). It intentionally does NOT call
// Claude or any network service, so scan/image documents return zero rows here.
import fs from "node:fs";

export const engine = {
  id: "smartquote-current-native",
  version: "phase13.1",
  config: { network: false, ai: false, nativeFirst: true },
};

export function supports(document) {
  return ["xlsx", "digital_pdf"].includes(document.inputKind);
}

function fileFromPath(sourcePath) {
  const bytes = fs.readFileSync(sourcePath);
  return new File([bytes], sourcePath.split(/[\\/]/).pop(), { type: sourcePath.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function productRows(products = []) {
  return products.map((item, index) => ({
    predictionId: item.id || `pred_${index + 1}`,
    kind: item._skipReason ? "non_product" : "product",
    status: item._meta?.canonicalStatus === "auto_approved" ? "auto_approved" : "need_review",
    confidence: Number(item._meta?.confidence || 0),
    source: {
      page: item._meta?.source?.page ?? null,
      sheet: item._meta?.source?.sheet || "",
      row: item._meta?.source?.row ?? item._meta?.source?.rowIndex ?? null,
      bbox: item._meta?.source?.bbox || null,
    },
    fields: {
      name: item.name || "", sku: item.sku || "", category: item.category || "", section: item.category || "",
      unit: item.unit || "", quantity: item.quantity ?? item.qty ?? null,
      unitPrice: item.costPrice ?? item.price ?? null, listPrice: item.listPrice ?? item.publicPrice ?? null,
      lineTotal: item.lineTotal ?? item.amount ?? null, specs: item.specs || "",
    },
  }));
}

async function pdfPages(sourcePath) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const bytes = fs.readFileSync(sourcePath);
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), disableWorker: true, disableFontFace: true, isEvalSupported: false, useSystemFonts: true });
  const pdf = await task.promise;
  const pages = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
    const rowMap = [];
    for (const item of content.items || []) {
      const str = String(item?.str || "").trim(); if (!str) continue;
      const y = Math.round((item.transform?.[5] || 0) * 10) / 10;
      const x = Math.round((item.transform?.[4] || 0) * 10) / 10;
      let row = rowMap.find((r) => Math.abs(r.y - y) < 2);
      if (!row) { row = { y, parts: [] }; rowMap.push(row); }
      row.parts.push({ x, str });
    }
    rowMap.sort((a, b) => b.y - a.y);
    const text = rowMap.map((row) => row.parts.sort((a, b) => a.x - b.x).map((x) => x.str).join(" ").replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
    pages.push({ page: pageNum, text });
    page.cleanup?.();
  }
  await pdf.destroy?.();
  return pages;
}

export async function runDocument({ document, sourcePath }) {
  const start = Date.now();
  const file = fileFromPath(sourcePath);
  if (document.inputKind === "xlsx") {
    if (document.documentType === "bom") {
      const { parseBomPreviewFile } = await import("../../../src/import-engine/bom/bomPreviewParser.js");
      const result = await parseBomPreviewFile(file, []);
      const rows = result.lines.map((line, index) => ({
        predictionId: line.id || `bom_${index + 1}`, kind: "product",
        status: line.status === "ready" ? "auto_approved" : "need_review",
        confidence: line.status === "ready" ? 0.8 : 0.55,
        source: { page: null, sheet: line.sourceSheet || "", row: line.sourceRow ?? null, bbox: null },
        fields: { name: line.name || "", sku: line.model || "", category: line.category || "", section: line.section || "", unit: line.unit || "", quantity: line.qty ?? null, unitPrice: line.unitPrice || null, listPrice: null, lineTotal: line.amount || null, specs: line.note || "" },
      }));
      return { runtimeMs: Date.now() - start, estimatedCostVnd: 0, rows };
    }
    const { runImport } = await import("../../../src/import-engine/index.js");
    const { smartQuotePreviewToPredictionDocument } = await import("../adapters/smartquote-preview.mjs");
    const result = await runImport(file, { catalog: [] });
    const pred = smartQuotePreviewToPredictionDocument(result.preview || result, document.id);
    return { runtimeMs: Date.now() - start, estimatedCostVnd: 0, rows: pred.rows };
  }
  if (document.inputKind === "digital_pdf") {
    const pages = await pdfPages(sourcePath);
    const { heuristicExtractProductsFromPdfPages, normalizePdfItems, dedupeProducts } = await import("../../../src/import-engine/pdf/pdfCatalogPipeline.js");
    const raw = heuristicExtractProductsFromPdfPages(pages, document.supplier || "PDF Catalog");
    const normalized = normalizePdfItems(raw, document.supplier || "PDF Catalog", "pdf-v3-text-heuristic");
    const items = dedupeProducts(normalized, { fileName: file.name, supplierGuess: document.supplier || "PDF Catalog" });
    return { runtimeMs: Date.now() - start, estimatedCostVnd: 0, rows: productRows(items) };
  }
  return { runtimeMs: Date.now() - start, estimatedCostVnd: 0, rows: [] };
}
