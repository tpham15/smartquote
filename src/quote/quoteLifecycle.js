// SmartQuote Pilot P1.1 — Final Quote Gate + Draft/Final/Revision lifecycle.
// Pure helpers so commercial lifecycle rules can be regression-tested without React/Supabase.

const finiteNumber = (value, fallback = NaN) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export const QUOTE_LIFECYCLE_DRAFT = "draft";
export const QUOTE_LIFECYCLE_FINAL = "final";

export function snapshotQuoteCompany(company = {}) {
  const allowed = [
    "name", "taxCode", "phone", "address", "website",
    "salesPerson", "salesPhone", "laborPercent", "vatPercent",
  ];
  const out = {};
  for (const key of allowed) {
    if (company?.[key] !== undefined) out[key] = company[key];
  }
  return out;
}

export function normalizeQuoteWorkflow(calc = {}, status = "draft") {
  const raw = calc?.workflow && typeof calc.workflow === "object" ? calc.workflow : {};
  // Legacy quotes may have status=sent/won but predate immutable workflow snapshots.
  // Treat them as Draft until they pass the new Final gate and are explicitly finalized.
  const lifecycle = raw.lifecycle === QUOTE_LIFECYCLE_FINAL
    ? QUOTE_LIFECYCLE_FINAL
    : QUOTE_LIFECYCLE_DRAFT;
  const revision = Math.max(1, Math.trunc(finiteNumber(raw.revision, 1)) || 1);
  return {
    lifecycle,
    revision,
    parentQuoteId: raw.parentQuoteId || null,
    rootQuoteId: raw.rootQuoteId || null,
    finalizedAt: lifecycle === QUOTE_LIFECYCLE_FINAL ? (raw.finalizedAt || null) : null,
    companySnapshot: raw.companySnapshot && typeof raw.companySnapshot === "object" ? { ...raw.companySnapshot } : null,
    snapshotVersion: Math.max(1, Math.trunc(finiteNumber(raw.snapshotVersion, 1)) || 1),
  };
}

export function buildQuoteWorkflow({
  lifecycle = QUOTE_LIFECYCLE_DRAFT,
  revision = 1,
  parentQuoteId = null,
  rootQuoteId = null,
  finalizedAt = null,
  companySnapshot = null,
} = {}) {
  const normalizedLifecycle = lifecycle === QUOTE_LIFECYCLE_FINAL ? QUOTE_LIFECYCLE_FINAL : QUOTE_LIFECYCLE_DRAFT;
  return {
    lifecycle: normalizedLifecycle,
    revision: Math.max(1, Math.trunc(finiteNumber(revision, 1)) || 1),
    parentQuoteId: parentQuoteId || null,
    rootQuoteId: rootQuoteId || null,
    finalizedAt: normalizedLifecycle === QUOTE_LIFECYCLE_FINAL ? (finalizedAt || new Date().toISOString()) : null,
    companySnapshot: normalizedLifecycle === QUOTE_LIFECYCLE_FINAL && companySnapshot && typeof companySnapshot === "object" ? { ...companySnapshot } : null,
    snapshotVersion: 1,
  };
}

export function makeQuoteNumber(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const safe = Number.isFinite(d.getTime()) ? d : new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `SQ-${safe.getFullYear()}${pad(safe.getMonth() + 1)}${pad(safe.getDate())}-${pad(safe.getHours())}${pad(safe.getMinutes())}${pad(safe.getSeconds())}`;
}

function activeSnapshotLines(snapshotRooms = []) {
  const out = [];
  for (const room of Array.isArray(snapshotRooms) ? snapshotRooms : []) {
    for (const line of Array.isArray(room?.lines) ? room.lines : []) {
      if (finiteNumber(line?.qty, 0) > 0) out.push(line);
    }
  }
  return out;
}

export function buildFinalQuoteGate({
  commercialAssessment = {},
  customer = {},
  vatPercent = 0,
  snapshotRooms = [],
} = {}) {
  const lineCount = Math.max(0, finiteNumber(commercialAssessment?.lineCount, 0));
  const missingProductCount = Math.max(0, finiteNumber(commercialAssessment?.missingProductCount, 0));
  const missingSalePriceCount = Math.max(0, finiteNumber(commercialAssessment?.missingSalePriceCount, 0));
  const unknownCostCount = Math.max(0, finiteNumber(commercialAssessment?.unknownCostCount, 0));
  const atOrBelowCostCount = Math.max(0, finiteNumber(commercialAssessment?.atOrBelowCostCount, 0));
  const negativeMarginCount = Math.max(0, finiteNumber(commercialAssessment?.negativeMarginCount, 0));
  const vat = finiteNumber(vatPercent, NaN);
  const frozenLines = activeSnapshotLines(snapshotRooms);
  const frozenLineCount = frozenLines.filter((line) => (
    line?.snapshotVersion >= 1
    && line?.productSnapshot && typeof line.productSnapshot === "object"
    && Number.isFinite(Number(line?.salePriceSnapshot)) && Number(line.salePriceSnapshot) > 0
    && Number.isFinite(Number(line?.costPriceSnapshot)) && Number(line.costPriceSnapshot) > 0
  )).length;

  const checks = [
    { id: "lines", label: "Có thiết bị trong báo giá", pass: lineCount > 0, detail: lineCount > 0 ? `${lineCount} dòng` : "Chưa có dòng thiết bị" },
    { id: "customer", label: "Đã chọn khách hàng / công trình", pass: Boolean(String(customer?.name || "").trim()), detail: String(customer?.name || "").trim() || "Thiếu tên khách hàng / công trình" },
    { id: "vat", label: "VAT hợp lệ", pass: Number.isFinite(vat) && vat >= 0 && vat <= 100, detail: Number.isFinite(vat) ? `${vat}%` : "VAT không hợp lệ" },
    { id: "product", label: "Không có dòng mất sản phẩm", pass: missingProductCount === 0, detail: missingProductCount ? `${missingProductCount} dòng` : "0 dòng" },
    { id: "sale_price", label: "Không có dòng thiếu giá bán", pass: missingSalePriceCount === 0, detail: missingSalePriceCount ? `${missingSalePriceCount} dòng` : "0 dòng" },
    { id: "cost", label: "Đủ giá vốn để kiểm tra margin", pass: unknownCostCount === 0, detail: unknownCostCount ? `${unknownCostCount} dòng thiếu giá vốn` : "Đầy đủ" },
    { id: "margin", label: "Không bán bằng / dưới giá vốn", pass: atOrBelowCostCount === 0, detail: atOrBelowCostCount ? `${atOrBelowCostCount} dòng (${negativeMarginCount} dòng bán lỗ)` : "0 dòng" },
    { id: "snapshot", label: "Snapshot sản phẩm / giá đã sẵn sàng", pass: lineCount > 0 && frozenLineCount === lineCount, detail: `${frozenLineCount}/${lineCount} dòng` },
  ];
  const blockers = checks.filter((check) => !check.pass);
  return {
    ready: blockers.length === 0,
    checks,
    blockers,
    blockerCount: blockers.length,
    frozenLineCount,
    lineCount,
  };
}

export function buildRevisionRooms(finalRooms = [], liveCatalogById = {}, defaultMarkupFactor = 1) {
  return (Array.isArray(finalRooms) ? finalRooms : []).map((room) => ({
    ...room,
    id: room?.id || `room_revision_${Math.random().toString(36).slice(2, 8)}`,
    lines: (Array.isArray(room?.lines) ? room.lines : []).map((line) => {
      const liveProduct = line?.productId ? liveCatalogById?.[line.productId] : null;
      if (!liveProduct) {
        // Product disappeared from the live catalog: preserve the frozen product so the operator can replace it deliberately.
        return { ...line, id: line?.id || `ln_revision_${Math.random().toString(36).slice(2, 8)}` };
      }
      const factor = liveProduct.priceMode === "fixed"
        ? 1
        : (finiteNumber(line?.factor, NaN) > 0 ? Number(line.factor) : Math.max(1, finiteNumber(defaultMarkupFactor, 1)));
      const next = { ...line, factor };
      delete next.snapshotVersion;
      delete next.productSnapshot;
      delete next.salePriceSnapshot;
      delete next.costPriceSnapshot;
      return next;
    }),
  }));
}
