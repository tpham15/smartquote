import { tenantStorageGetItem, tenantStorageSetItem, getTenantStorageScope } from "../storage/tenantStorage.js";

// Phase 14.0 append-only local telemetry. Stores before/after + source evidence,
// not only the learned final value. This is the seed dataset for later product
// knowledge / benchmark work. Tenant-scoped through tenantStorage.
const KEY = "sq_pilot_correction_events_v1";
const MAX_EVENTS = 5000;
const EXPORT_META_KEY = "sq_pilot_correction_export_meta_v1";

function cloneSafe(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch { return null; }
}

function productSnapshot(product = {}) {
  return {
    name: String(product.name || ""),
    sku: String(product.sku || ""),
    category: String(product.category || ""),
    supplier: String(product.supplier || ""),
    unit: String(product.unit || ""),
    costPrice: Number(product.costPrice || product.price || 0) || 0,
    listPrice: Number(product.listPrice || product.publicPrice || 0) || 0,
    minRetailPrice: Number(product.minRetailPrice || 0) || 0,
    specs: String(product.specs || ""),
  };
}

export function loadCorrectionEvents() {
  try {
    const parsed = JSON.parse(tenantStorageGetItem(KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

export function recordCorrectionEvent({ action, before = null, after = null, fileName = "", importId = "", lineId = "", detectedIndustry = "", reason = "", issues = [] } = {}) {
  if (!action) return { ok: false, reason: "missing_action" };
  const source = after?._meta?.source || before?._meta?.source || after?.source || before?.source || {};
  const event = {
    schemaVersion: "sq-pilot-correction-event-v1",
    id: `corr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    action,
    occurredAt: new Date().toISOString(),
    fileName: fileName || source.fileName || "",
    importId: importId || after?._meta?.importId || before?._meta?.importId || "",
    lineId: lineId || after?._meta?.lineId || before?._meta?.lineId || "",
    detectedIndustry,
    before: before ? productSnapshot(before) : null,
    after: after ? productSnapshot(after) : null,
    source: cloneSafe({
      type: source.type || "",
      sheet: source.sheet || source.sheetName || "",
      row: source.row ?? source.rowIndex ?? null,
      page: source.page ?? null,
      rawText: source.rawText || "",
      bbox: source.bbox || null,
      pageWidth: source.pageWidth || null,
      pageHeight: source.pageHeight || null,
    }),
    reason,
    issues: cloneSafe((issues || []).slice(0, 12)) || [],
  };
  try {
    const events = loadCorrectionEvents();
    events.push(event);
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    const ok = tenantStorageSetItem(KEY, JSON.stringify(events));
    return { ok, event };
  } catch (error) {
    return { ok: false, reason: error?.message || "storage_failed" };
  }
}

function loadExportMeta() {
  try {
    const parsed = JSON.parse(tenantStorageGetItem(EXPORT_META_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch { return {}; }
}

export function buildCorrectionEvidenceExport() {
  const events = loadCorrectionEvents();
  const exportedAt = new Date().toISOString();
  const byAction = {};
  for (const event of events) byAction[event.action] = (byAction[event.action] || 0) + 1;
  return {
    schemaVersion: "smartquote-pilot-evidence-v1",
    exportedAt,
    tenantScope: getTenantStorageScope() || "local",
    summary: {
      total: events.length,
      edited: byAction.edit || 0,
      approved: byAction.approve || 0,
      deleted: byAction.delete || 0,
      imported: byAction.import || 0,
    },
    corrections: events,
  };
}

export function markCorrectionEvidenceExported(exportedAt = new Date().toISOString()) {
  return tenantStorageSetItem(EXPORT_META_KEY, JSON.stringify({ exportedAt }));
}

export function getCorrectionTelemetryStats() {
  const events = loadCorrectionEvents();
  const meta = loadExportMeta();
  const lastExportAt = meta.exportedAt || null;
  const byAction = {};
  for (const event of events) byAction[event.action] = (byAction[event.action] || 0) + 1;
  const unexported = lastExportAt ? events.filter((e) => String(e.occurredAt || "") > lastExportAt).length : events.length;
  return {
    total: events.length,
    edited: byAction.edit || 0,
    approved: byAction.approve || 0,
    deleted: byAction.delete || 0,
    imported: byAction.import || 0,
    unexported,
    lastExportAt,
    latestAt: events.at(-1)?.occurredAt || null,
  };
}
