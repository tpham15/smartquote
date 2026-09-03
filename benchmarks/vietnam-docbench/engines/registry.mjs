// Phase 13.1 — benchmark engine registry.
// Registry is descriptive only. Experimental engines are NOT enabled in production.

export const ENGINE_REGISTRY = Object.freeze({
  smartquote_excel_native_v2: Object.freeze({
    id: "smartquote_excel_native_v2", family: "smartquote", status: "production",
    inputKinds: ["xlsx"], strengths: ["native_cells", "merged_cells", "deterministic_first"],
  }),
  smartquote_bom_native_v1: Object.freeze({
    id: "smartquote_bom_native_v1", family: "smartquote", status: "production",
    inputKinds: ["xlsx"], documentTypes: ["bom"], strengths: ["matrix_bom", "area_context"],
  }),
  smartquote_pdf_text_v3: Object.freeze({
    id: "smartquote_pdf_text_v3", family: "smartquote", status: "production",
    inputKinds: ["digital_pdf", "hybrid_pdf"], strengths: ["native_pdf_text", "deterministic_rows"],
  }),
  smartquote_pdf_page_vision_v3: Object.freeze({
    id: "smartquote_pdf_page_vision_v3", family: "smartquote", status: "production",
    inputKinds: ["scan_pdf", "hybrid_pdf"], strengths: ["page_vision", "recovery"],
  }),
  smartquote_image_vision_v1: Object.freeze({
    id: "smartquote_image_vision_v1", family: "smartquote", status: "production",
    inputKinds: ["photo"], strengths: ["image_vision"],
  }),
  paddleocr_vl: Object.freeze({
    id: "paddleocr_vl", family: "paddle", status: "experimental",
    inputKinds: ["digital_pdf", "hybrid_pdf", "scan_pdf", "photo"],
    benchmarkDefaultVersion: "PaddleOCR-VL-1.6",
    fullPipelineRequired: true,
    strengths: ["document_vlm", "layout", "table", "multilingual", "scan_robustness"],
  }),
  pp_structure_v3: Object.freeze({
    id: "pp_structure_v3", family: "paddle", status: "experimental",
    inputKinds: ["digital_pdf", "hybrid_pdf", "scan_pdf", "photo"],
    strengths: ["layout", "table", "reading_order"],
  }),
  mineru: Object.freeze({
    id: "mineru", family: "mineru", status: "experimental",
    inputKinds: ["digital_pdf", "hybrid_pdf", "scan_pdf", "photo"],
    strengths: ["document_structure", "cross_page", "tables"],
  }),
  mineru_office: Object.freeze({
    id: "mineru_office", family: "mineru", status: "experimental",
    inputKinds: ["xlsx"], strengths: ["native_office", "document_structure"],
  }),
  vlm_fallback: Object.freeze({
    id: "vlm_fallback", family: "generic_vlm", status: "experimental",
    inputKinds: ["xlsx", "digital_pdf", "hybrid_pdf", "scan_pdf", "photo"],
    strengths: ["schema_reasoning", "hard_case_fallback"],
  }),
});

export function getEngineDescriptor(id) {
  return ENGINE_REGISTRY[id] || null;
}

export function enginesForInputKind(inputKind, { includeExperimental = true } = {}) {
  return Object.values(ENGINE_REGISTRY)
    .filter((engine) => engine.inputKinds.includes(inputKind))
    .filter((engine) => includeExperimental || engine.status === "production");
}

export function candidateEnginesForRoute(route = {}) {
  const ids = [route.primaryEngine, ...(route.fallbacks || []), ...(route.experimentalCandidates || [])]
    .filter(Boolean);
  const seen = new Set();
  return ids.filter((id) => !seen.has(id) && seen.add(id)).map((id) => getEngineDescriptor(id) || {
    id, family: "unknown", status: "unknown", inputKinds: [route.inputKind], strengths: [],
  });
}
