// Phase 14.2 — lightweight supplier/layout memory. Best-effort local browser storage;
// never required for correctness and never blocks import.
import { makePdfTemplateFingerprint, summarizePdfDocumentIR } from './pdfDocumentFramework.js';

import { tenantStorageGetItem, tenantStorageSetItem, isTenantStorageScoped } from '../../storage/tenantStorage.js';

// RC16.1: PDF template hints are dealer data. They live in the per-dealer
// tenant namespace (sq_dealer_<id>_pdf_template_memory_v1 in cloud mode,
// sq_pdf_template_memory_v1 in local single-user mode), never in a key shared
// by every workspace that signs in on the same browser.
const KEY = 'sq_pdf_template_memory_v1';
// Pre-RC16.1 builds wrote one GLOBAL key for every workspace. Its content
// cannot be attributed to a dealer, so a signed-in (cloud) workspace never
// reads it and deletes it; local single-user mode migrates it once.
const LEGACY_GLOBAL_KEY = 'smartquote_pdf_template_memory_v1';

function text(v) { return String(v ?? '').replace(/\s+/g, ' ').trim(); }
function supplierKey(v) { return text(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80); }

function rawStorage() {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch (_) { return null; }
}

function handleLegacyGlobalMemory() {
  const ls = rawStorage();
  if (!ls) return;
  try {
    const legacy = ls.getItem(LEGACY_GLOBAL_KEY);
    if (legacy == null) return;
    if (!isTenantStorageScoped() && tenantStorageGetItem(KEY) == null) tenantStorageSetItem(KEY, legacy);
    ls.removeItem(LEGACY_GLOBAL_KEY);
  } catch (_) {}
}

function readAll() {
  try {
    handleLegacyGlobalMemory();
    const raw = JSON.parse(tenantStorageGetItem(KEY) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch (_) { return {}; }
}
function writeAll(value) { try { tenantStorageSetItem(KEY, JSON.stringify(value)); } catch (_) {} }

export function rememberPdfTemplate({ supplierGuess = '', fileName = '', pageIrs = [] } = {}) {
  const summary = summarizePdfDocumentIR(pageIrs);
  if (!summary.tables || !summary.roles.length) return null;
  const fp = makePdfTemplateFingerprint(summary);
  const all = readAll();
  const sk = supplierKey(supplierGuess || fileName || 'unknown');
  const list = Array.isArray(all[sk]) ? all[sk] : [];
  const entry = { fingerprint: fp, roles: summary.roles, rowModels: summary.rowModels, mergedSpecSections: summary.mergedSpecSections, updatedAt: Date.now() };
  all[sk] = [entry, ...list.filter((x) => x?.fingerprint !== fp)].slice(0, 6);
  writeAll(all);
  return entry;
}

export function getPdfTemplateHint({ supplierGuess = '', fileName = '' } = {}) {
  const all = readAll();
  const sk = supplierKey(supplierGuess || fileName || 'unknown');
  const entry = (Array.isArray(all[sk]) ? all[sk] : [])[0];
  if (!entry) return '';
  return `Template memory (chỉ là gợi ý, phải ưu tiên nội dung nhìn thấy): roles=${(entry.roles || []).join(',')}; rowModels=${(entry.rowModels || []).join(',')}; mergedSpecs=${Number(entry.mergedSpecSections || 0) > 0 ? 'yes' : 'no'}.`;
}
