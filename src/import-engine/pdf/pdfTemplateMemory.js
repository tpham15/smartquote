// Phase 14.2 — lightweight supplier/layout memory. Best-effort local browser storage;
// never required for correctness and never blocks import.
import { makePdfTemplateFingerprint, summarizePdfDocumentIR } from './pdfDocumentFramework.js';

const KEY = 'smartquote_pdf_template_memory_v1';
function text(v) { return String(v ?? '').replace(/\s+/g, ' ').trim(); }
function supplierKey(v) { return text(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80); }
function readAll() {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch (_) { return {}; }
}
function writeAll(value) { try { if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(value)); } catch (_) {} }

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
