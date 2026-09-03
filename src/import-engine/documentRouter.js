// ============================================================
// Phase 13.1 — Native-first Document Router
// Pure routing policy only: no network, no OCR call, no UI side effects.
// The router decides WHICH class of engine should run; it does not execute it.
// ============================================================

export const DOCUMENT_ROUTER_POLICY_V1 = Object.freeze({
  id: "sq-document-router-v1",
  pdf: Object.freeze({
    // Keep compatibility with the current PDF pipeline: <80 chars total is
    // effectively image-only / scan and should go to page vision.
    scanMaxTotalTextChars: 79,
    selectablePageMinChars: 20,
    digitalMinSelectablePageRatio: 0.8,
    digitalMinAverageCharsPerPage: 80,
  }),
  typeInference: Object.freeze({
    strongThreshold: 0.72,
    weakThreshold: 0.52,
  }),
});

const EXCEL_EXTENSIONS = new Set(["xlsx", "xls", "xlsm", "csv"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "tif", "tiff", "heic"]);
const KNOWN_DOCUMENT_TYPES = new Set(["supplier_price_list", "old_quote", "bom", "catalog", "other"]);

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function asciiKey(value) {
  return clean(value)
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extensionOf(fileName = "") {
  const match = String(fileName || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || "";
}

function clamp01(n) {
  return Math.max(0, Math.min(1, Number(n) || 0));
}

export function buildPdfProbe(input = {}, policy = DOCUMENT_ROUTER_POLICY_V1) {
  const pages = Array.isArray(input.pages) ? input.pages : [];
  const pageCount = Math.max(0, Number(input.pageCount || pages.length || 0));
  const pageChars = Array.from({ length: pageCount }, (_, index) => {
    const page = pages[index] || {};
    if (page.textChars != null) return Math.max(0, Number(page.textChars) || 0);
    return clean(page.text).length;
  });
  const inferredTotal = pageChars.reduce((sum, value) => sum + value, 0);
  const textChars = Math.max(0, Number(input.textChars ?? inferredTotal) || 0);
  const selectablePageCount = pageChars.filter((value) => value > policy.pdf.selectablePageMinChars).length;
  const blankPageCount = Math.max(0, pageCount - selectablePageCount);
  const selectablePageRatio = pageCount ? selectablePageCount / pageCount : 0;
  const averageTextCharsPerPage = pageCount ? textChars / pageCount : 0;
  return {
    schemaVersion: "sq-pdf-probe-v1",
    pageCount,
    textChars,
    pageTextChars: pageChars,
    selectablePageCount,
    blankPageCount,
    selectablePageRatio: Number(selectablePageRatio.toFixed(6)),
    averageTextCharsPerPage: Number(averageTextCharsPerPage.toFixed(2)),
  };
}

export function classifyPdfProbe(input = {}, policy = DOCUMENT_ROUTER_POLICY_V1) {
  const probe = input?.schemaVersion === "sq-pdf-probe-v1" ? input : buildPdfProbe(input, policy);
  const reasons = [];
  if (!probe.pageCount) {
    return { inputKind: "unknown_pdf", confidence: 0, reasons: ["pdf_page_count_missing"], probe };
  }
  if (probe.textChars <= policy.pdf.scanMaxTotalTextChars || probe.selectablePageCount === 0) {
    reasons.push("pdf_selectable_text_below_scan_threshold");
    return { inputKind: "scan_pdf", confidence: 0.99, reasons, probe };
  }
  if (
    probe.selectablePageRatio >= policy.pdf.digitalMinSelectablePageRatio &&
    probe.averageTextCharsPerPage >= policy.pdf.digitalMinAverageCharsPerPage
  ) {
    reasons.push("pdf_selectable_text_dense");
    return { inputKind: "digital_pdf", confidence: 0.96, reasons, probe };
  }
  reasons.push("pdf_mixed_selectable_text_density");
  return { inputKind: "hybrid_pdf", confidence: 0.82, reasons, probe };
}

function scoreDocumentTypeSignals(text) {
  const key = asciiKey(text);
  const scores = { supplier_price_list: 0, old_quote: 0, bom: 0, catalog: 0 };
  const reasons = { supplier_price_list: [], old_quote: [], bom: [], catalog: [] };
  const add = (type, amount, reason) => { scores[type] += amount; reasons[type].push(reason); };

  if (/\b(bom|boq|takeoff|khoi luong|bang khoi luong|vat tu|m e|mep)\b/.test(key)) add("bom", 0.75, "bom_keyword");
  if (/\b(bao gia|quotation|quote|khach hang|cong trinh|thanh tien|tong gia tri)\b/.test(key)) add("old_quote", 0.58, "quotation_keyword");
  if (/\b(bang gia|price list|gia npp|gia dai ly|gia si|gia ban le|dealer price|wholesale)\b/.test(key)) add("supplier_price_list", 0.68, "price_list_keyword");
  if (/\b(catalog|catalogue|san pham|product catalog)\b/.test(key)) add("catalog", 0.55, "catalog_keyword");

  if (/\b(stt|ma san pham|ma thiet bi|model)\b/.test(key) && /\b(gia npp|gia dai ly|gia ban le|don gia)\b/.test(key)) {
    add("supplier_price_list", 0.26, "price_table_headers");
  }
  if (/\b(sl|so luong|dvt|don vi)\b/.test(key) && /\b(don gia|thanh tien)\b/.test(key)) {
    add("old_quote", 0.22, "quote_line_headers");
  }
  if (/\b(khu vuc|tang|phong|area|zone)\b/.test(key) && /\b(so luong|qty|quantity)\b/.test(key)) {
    add("bom", 0.2, "area_quantity_structure");
  }
  return { scores, reasons };
}

export function inferDocumentType({ explicitType = "", fileName = "", sampleText = "" } = {}, policy = DOCUMENT_ROUTER_POLICY_V1) {
  const explicit = clean(explicitType);
  if (KNOWN_DOCUMENT_TYPES.has(explicit) && explicit !== "other") {
    return { documentType: explicit, confidence: 1, source: "explicit", reasons: ["explicit_document_type"] };
  }

  const fileSignals = scoreDocumentTypeSignals(fileName);
  const textSignals = scoreDocumentTypeSignals(sampleText);
  const types = ["supplier_price_list", "old_quote", "bom", "catalog"];
  const scored = types.map((type) => {
    const score = clamp01(fileSignals.scores[type] * 0.65 + textSignals.scores[type]);
    return { type, score, reasons: [...fileSignals.reasons[type], ...textSignals.reasons[type]] };
  }).sort((a, b) => b.score - a.score);

  const best = scored[0];
  const second = scored[1];
  if (!best || best.score < policy.typeInference.weakThreshold || best.score - (second?.score || 0) < 0.08) {
    return {
      documentType: "other",
      confidence: best?.score || 0,
      source: "inferred_weak",
      reasons: best?.reasons || ["insufficient_document_type_signal"],
    };
  }
  return {
    documentType: best.type,
    confidence: Number(best.score.toFixed(4)),
    source: best.score >= policy.typeInference.strongThreshold ? "inferred_strong" : "inferred_medium",
    reasons: best.reasons,
  };
}

export function classifyDocumentInput({ fileName = "", mimeType = "", pdfProbe = null } = {}, policy = DOCUMENT_ROUTER_POLICY_V1) {
  const ext = extensionOf(fileName);
  const mime = String(mimeType || "").toLowerCase();
  if (EXCEL_EXTENSIONS.has(ext) || /spreadsheet|excel|csv/.test(mime)) {
    return { inputKind: "xlsx", confidence: 1, reasons: ["native_spreadsheet_file"] };
  }
  if (IMAGE_EXTENSIONS.has(ext) || mime.startsWith("image/")) {
    return { inputKind: "photo", confidence: 1, reasons: ["native_image_file"] };
  }
  if (ext === "pdf" || mime === "application/pdf" || pdfProbe) {
    return classifyPdfProbe(pdfProbe || {}, policy);
  }
  return { inputKind: "other", confidence: 0.5, reasons: ["unsupported_or_unknown_extension"] };
}

const ROUTE_ENGINES = Object.freeze({
  excel: "smartquote_excel_native_v2",
  bom: "smartquote_bom_native_v1",
  pdfText: "smartquote_pdf_text_v3",
  pdfVision: "smartquote_pdf_page_vision_v3",
  imageVision: "smartquote_image_vision_v1",
});

function experimentalCandidates(inputKind) {
  if (inputKind === "xlsx") return ["mineru_office", "vlm_fallback"];
  if (inputKind === "digital_pdf") return ["mineru", "pp_structure_v3", "paddleocr_vl", "vlm_fallback"];
  if (inputKind === "hybrid_pdf") return ["mineru", "paddleocr_vl", "pp_structure_v3", "vlm_fallback"];
  if (inputKind === "scan_pdf" || inputKind === "photo") return ["paddleocr_vl", "pp_structure_v3", "mineru", "vlm_fallback"];
  return ["vlm_fallback"];
}

export function planDocumentRoute(input = {}, policy = DOCUMENT_ROUTER_POLICY_V1) {
  const inputClassification = classifyDocumentInput(input, policy);
  const type = inferDocumentType(input, policy);
  const inputKind = inputClassification.inputKind;
  const documentType = type.documentType;
  let primaryEngine = "manual_review";
  const fallbacks = [];
  const capabilities = { nativeFirst: false, requiresVision: false, sparsePageVisionRecommended: false };

  if (inputKind === "xlsx") {
    capabilities.nativeFirst = true;
    primaryEngine = documentType === "bom" ? ROUTE_ENGINES.bom : ROUTE_ENGINES.excel;
    if (documentType === "other") fallbacks.push(ROUTE_ENGINES.bom);
    fallbacks.push("vlm_fallback");
  } else if (inputKind === "digital_pdf") {
    capabilities.nativeFirst = true;
    primaryEngine = ROUTE_ENGINES.pdfText;
    fallbacks.push(ROUTE_ENGINES.pdfVision);
  } else if (inputKind === "hybrid_pdf") {
    capabilities.nativeFirst = true;
    capabilities.requiresVision = true;
    capabilities.sparsePageVisionRecommended = true;
    primaryEngine = ROUTE_ENGINES.pdfText;
    fallbacks.push(ROUTE_ENGINES.pdfVision);
  } else if (inputKind === "scan_pdf") {
    capabilities.requiresVision = true;
    primaryEngine = ROUTE_ENGINES.pdfVision;
  } else if (inputKind === "photo") {
    capabilities.requiresVision = true;
    primaryEngine = ROUTE_ENGINES.imageVision;
  }

  return {
    schemaVersion: "sq-document-route-v1",
    routerPolicy: policy.id,
    fileName: clean(input.fileName),
    inputKind,
    inputConfidence: inputClassification.confidence,
    documentType,
    documentTypeConfidence: type.confidence,
    documentTypeSource: type.source,
    primaryEngine,
    fallbacks: [...new Set(fallbacks.filter(Boolean))],
    experimentalCandidates: experimentalCandidates(inputKind),
    capabilities,
    reasons: [...(inputClassification.reasons || []), ...(type.reasons || [])],
    probe: inputClassification.probe || null,
  };
}

export function routeRequiresVision(route = {}) {
  return Boolean(route.capabilities?.requiresVision || route.inputKind === "scan_pdf" || route.inputKind === "photo");
}
