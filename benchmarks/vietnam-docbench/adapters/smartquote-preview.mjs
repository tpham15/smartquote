// Adapter from SmartQuote canonical ImportPreviewResult -> DocBench prediction rows.
// It is intentionally pure and can be used on JSON exported from current SmartQuote.
const PRODUCT_KINDS = new Set(["bom_item", "catalog_product", "price_update"]);

export function smartQuoteLineKind(line = {}) {
  // Explicit benchmark-compatible non-product classification wins.
  if (line.kind === "non_product") return "non_product";

  // Canonical preview kinds represent commercial product candidates, but skipped /
  // note/header/etc. rows are not product predictions and must remain visible to
  // DocBench so false-positive / filtering behavior can be measured correctly.
  const rowType = String(line.rowType || "").toLowerCase();
  const status = String(line.status || "").toLowerCase();
  if (status === "skipped" || ["skipped", "note", "header", "subtotal", "total", "term", "terms", "footer", "section"].includes(rowType)) {
    return "non_product";
  }
  if (PRODUCT_KINDS.has(line.kind)) return "product";

  // Legacy previews may omit `kind`. Preserve product candidates only when the
  // row carries actual product evidence; unknown explicit kinds stay non-product.
  if (line.kind == null || line.kind === "") {
    const hasProductEvidence = Boolean(
      line.parsed?.productName || line.parsed?.sku || line.parsed?.unitPrice || line.parsed?.costPrice ||
      line.raw?.productName || line.raw?.sku || line.raw?.price
    );
    return hasProductEvidence ? "product" : "non_product";
  }
  return "non_product";
}

export function smartQuotePreviewToPredictionDocument(preview, documentId, runtime = {}) {
  return {
    documentId,
    runtimeMs: runtime.runtimeMs ?? null,
    estimatedCostVnd: runtime.estimatedCostVnd ?? null,
    rows: (preview?.lines || []).map((line, index) => ({
      predictionId: line.lineId || `pred_${index + 1}`,
      kind: smartQuoteLineKind(line),
      status: line.status || "need_review",
      confidence: Number(line.confidence ?? 0),
      source: {
        page: line.source?.page ?? null,
        sheet: line.source?.sheet || "",
        row: line.source?.row ?? null,
        bbox: line.source?.bbox || null,
      },
      fields: {
        name: line.parsed?.productName ?? line.raw?.productName ?? "",
        sku: line.parsed?.sku ?? line.raw?.sku ?? "",
        category: line.parsed?.category ?? "",
        section: line.parsed?.section ?? line.parsed?.category ?? "",
        unit: line.parsed?.unit ?? line.raw?.unit ?? "",
        quantity: line.parsed?.quantity ?? line.parsed?.qty ?? null,
        unitPrice: line.parsed?.unitPrice ?? line.parsed?.costPrice ?? line.raw?.price ?? null,
        listPrice: line.parsed?.listPrice ?? line.parsed?.publicPrice ?? null,
        lineTotal: line.parsed?.lineTotal ?? line.parsed?.total ?? null,
        specs: line.parsed?.specs ?? "",
      },
    })),
  };
}
