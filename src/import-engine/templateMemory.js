// ============================================================
// templateMemory — centralized local template mapping memory.
// Phase 2.8: keep all catalog/import template persistence here so
// UI and import engine do not each invent their own storage logic.
// Browser/localStorage first; later this can be swapped for backend DB.
// ============================================================

const ENGINE_TPL_KEY = "sq_import_templates";
const CATALOG_TPL_PREFIX = "sq_catalog_template_";
const MAX_ENGINE_TEMPLATES = 80;
const MAX_CATALOG_TEMPLATES = 80;

function safeLocalStorage() {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function hashText(str) {
  let h = 2166136261;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function normalizeTemplateText(v) {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function supplierKeyFromFileName(fileName = "") {
  return normalizeTemplateText(fileName)
    .replace(/\.(xlsx|xls|pdf)$/i, "")
    .replace(/\b(20\d{2}|19\d{2}|\d{1,2}[._-]\d{1,2}[._-]\d{2,4}|bang gia|bao gia|catalog|price|dl|dai ly|cap nhat|update|file|xlsx|xls|pdf)\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export function buildCatalogTemplateSignature(headers = [], fileName = "") {
  const labels = (headers || [])
    .map((h) => normalizeTemplateText(h?.label ?? h))
    .filter(Boolean)
    .join("|");
  const supplierKey = supplierKeyFromFileName(fileName);
  return `${supplierKey}::${headers.length}::${labels}`;
}

export function catalogTemplateKey(headers = [], fileName = "") {
  return CATALOG_TPL_PREFIX + hashText(buildCatalogTemplateSignature(headers, fileName));
}

function pruneByPrefix(prefix, max = 80) {
  const ls = safeLocalStorage();
  if (!ls) return;
  try {
    const keys = Object.keys(ls).filter((k) => k.startsWith(prefix));
    if (keys.length <= max) return;
    const withTime = keys.map((key) => {
      try {
        const data = JSON.parse(ls.getItem(key) || "{}");
        return { key, t: Number(data.savedAt || data.createdAt || 0) || 0 };
      } catch {
        return { key, t: 0 };
      }
    }).sort((a, b) => a.t - b.t);
    for (const item of withTime.slice(0, Math.max(0, keys.length - max))) ls.removeItem(item.key);
  } catch {}
}

// ---- Engine-level mapping by fingerprint ----
export function loadEngineTemplateMap() {
  const ls = safeLocalStorage();
  if (!ls) return {};
  try { return JSON.parse(ls.getItem(ENGINE_TPL_KEY) || "{}"); }
  catch { return {}; }
}

export function saveEngineTemplateMapping(templateId, mappingBySheet, meta = {}) {
  if (!templateId || !mappingBySheet) return false;
  const ls = safeLocalStorage();
  if (!ls) return false;
  try {
    const all = loadEngineTemplateMap();
    all[templateId] = {
      mappingBySheet,
      savedAt: Date.now(),
      version: 1,
      ...meta,
    };
    const keys = Object.keys(all);
    if (keys.length > MAX_ENGINE_TEMPLATES) {
      keys.sort((a, b) => Number(all[a]?.savedAt || 0) - Number(all[b]?.savedAt || 0));
      for (const key of keys.slice(0, keys.length - MAX_ENGINE_TEMPLATES)) delete all[key];
    }
    ls.setItem(ENGINE_TPL_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

export function getEngineTemplateMapping(templateId) {
  const all = loadEngineTemplateMap();
  return all[templateId]?.mappingBySheet || null;
}

// ---- Catalog UI/manual mapping templates ----
export function loadCatalogTemplate(headers = [], fileName = "") {
  const ls = safeLocalStorage();
  if (!ls) return null;
  try { return JSON.parse(ls.getItem(catalogTemplateKey(headers, fileName)) || "null"); }
  catch { return null; }
}

export function saveCatalogTemplate({ headers = [], fileName = "", colMap = {}, manualStartRow = "", manualEndRow = "", name = "", extra = {} } = {}) {
  if (!headers?.length) return { ok: false, error: "missing_headers" };
  const ls = safeLocalStorage();
  if (!ls) return { ok: false, error: "no_storage" };
  const payload = {
    name: name || supplierKeyFromFileName(fileName) || fileName || "Template catalog",
    fileName,
    savedAt: Date.now(),
    version: 1,
    signature: buildCatalogTemplateSignature(headers, fileName),
    colMap: { ...(colMap || {}) },
    manualStartRow,
    manualEndRow,
    ...extra,
  };
  try {
    ls.setItem(catalogTemplateKey(headers, fileName), JSON.stringify(payload));
    pruneByPrefix(CATALOG_TPL_PREFIX, MAX_CATALOG_TEMPLATES);
    return { ok: true, template: payload };
  } catch (error) {
    return { ok: false, error: error?.message || "save_failed" };
  }
}

export function listCatalogTemplates() {
  const ls = safeLocalStorage();
  if (!ls) return [];
  try {
    return Object.keys(ls)
      .filter((k) => k.startsWith(CATALOG_TPL_PREFIX))
      .map((key) => {
        try { return { key, ...JSON.parse(ls.getItem(key) || "{}") }; }
        catch { return { key }; }
      })
      .sort((a, b) => Number(b.savedAt || 0) - Number(a.savedAt || 0));
  } catch {
    return [];
  }
}

export function deleteCatalogTemplate(key) {
  const ls = safeLocalStorage();
  if (!ls || !key) return false;
  try {
    if (!String(key).startsWith(CATALOG_TPL_PREFIX)) return false;
    ls.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function similarityScore(a = "", b = "") {
  const A = new Set(normalizeTemplateText(a).split(/\s+/).filter(Boolean));
  const B = new Set(normalizeTemplateText(b).split(/\s+/).filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / Math.max(A.size, B.size);
}

export function suggestCatalogTemplates(headers = [], fileName = "", limit = 8) {
  const signature = buildCatalogTemplateSignature(headers, fileName);
  const supplierKey = supplierKeyFromFileName(fileName);
  const currentLabels = (headers || []).map((h) => normalizeTemplateText(h?.label ?? h)).filter(Boolean).join(" ");
  return listCatalogTemplates()
    .map((tpl) => {
      const sameExact = tpl.signature === signature;
      const sameSupplier = supplierKey && normalizeTemplateText(tpl.name || tpl.fileName || "").includes(supplierKey);
      const tplLabels = String(tpl.signature || "").split("::").slice(2).join(" ");
      const headerScore = similarityScore(currentLabels, tplLabels);
      const score = (sameExact ? 1 : 0) + (sameSupplier ? 0.35 : 0) + headerScore;
      return { ...tpl, matchScore: Math.round(score * 100) / 100 };
    })
    .filter((tpl) => tpl.matchScore > 0.15)
    .sort((a, b) => b.matchScore - a.matchScore || Number(b.savedAt || 0) - Number(a.savedAt || 0))
    .slice(0, limit);
}
