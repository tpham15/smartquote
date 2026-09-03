// ============================================================
// tenantStorage — per-dealer localStorage namespace for SaaS mode.
//
// Local/offline mode keeps the legacy sq_* keys.
// Cloud mode rewrites sq_* keys to sq_dealer_<dealerId>_* so learning,
// import templates, PDF cache and temporary backups cannot bleed between
// dealers using the same browser profile.
// ============================================================

let activeDealerId = "";

function sanitizeDealerId(dealerId) {
  return String(dealerId || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 96);
}

function safeLocalStorage() {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function setTenantStorageScope(dealerId) {
  activeDealerId = sanitizeDealerId(dealerId);
  try {
    if (typeof window !== "undefined") window.__SMARTQUOTE_DEALER_STORAGE_SCOPE__ = activeDealerId;
  } catch {}
}

export function getTenantStorageScope() {
  if (activeDealerId) return activeDealerId;
  try {
    if (typeof window !== "undefined") return sanitizeDealerId(window.__SMARTQUOTE_DEALER_STORAGE_SCOPE__ || "");
  } catch {}
  return "";
}

export function isTenantStorageScoped() {
  return Boolean(getTenantStorageScope());
}

export function tenantScopedStorageKey(key) {
  const raw = String(key || "");
  const dealerId = getTenantStorageScope();
  if (!dealerId) return raw;
  if (raw.startsWith(`sq_dealer_${dealerId}_`)) return raw;
  if (raw.startsWith("sq_dealer_")) return raw;
  if (raw.startsWith("sq_")) return `sq_dealer_${dealerId}_${raw.slice(3)}`;
  return `sq_dealer_${dealerId}_${raw}`;
}

export function tenantStorageGetItem(key) {
  const ls = safeLocalStorage();
  if (!ls) return null;
  try { return ls.getItem(tenantScopedStorageKey(key)); } catch { return null; }
}

export function tenantStorageSetItem(key, value) {
  const ls = safeLocalStorage();
  if (!ls) return false;
  try {
    ls.setItem(tenantScopedStorageKey(key), value);
    return true;
  } catch {
    return false;
  }
}

export function tenantStorageRemoveItem(key) {
  const ls = safeLocalStorage();
  if (!ls) return false;
  try {
    ls.removeItem(tenantScopedStorageKey(key));
    return true;
  } catch {
    return false;
  }
}

export function tenantStorageKeysWithPrefix(prefix) {
  const ls = safeLocalStorage();
  if (!ls) return [];
  const scopedPrefix = tenantScopedStorageKey(prefix);
  try { return Object.keys(ls).filter((k) => k.startsWith(scopedPrefix)); } catch { return []; }
}

export function tenantStorageGetJson(key, fallback = null) {
  try {
    const raw = tenantStorageGetItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function tenantStorageSetJson(key, value) {
  return tenantStorageSetItem(key, JSON.stringify(value));
}
