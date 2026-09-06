import { tenantStorageGetJson, tenantStorageSetJson } from "../../storage/tenantStorage.js";

// Phase 15 — company/dealer-scoped learning for quote-completeness decisions.
// tenantStorage namespaces the key by dealer in cloud mode, so two dealers using
// the same browser do not teach each other accessory habits.
const LEARNING_KEY = "sq_quote_completeness_learning_v1";
const MAX_RULES = 180;

function nowIso() {
  try { return new Date().toISOString(); } catch { return ""; }
}

export function loadQuoteCompletenessLearning() {
  const raw = tenantStorageGetJson(LEARNING_KEY, {});
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

export function getQuoteCompletenessLearning(ruleId = "") {
  if (!ruleId) return null;
  return loadQuoteCompletenessLearning()[String(ruleId)] || null;
}

export function rememberQuoteCompletenessDecision({
  ruleId = "",
  familyKey = "",
  action = "",
  productId = "",
  label = "",
} = {}) {
  if (!ruleId || !["always_add", "never_add"].includes(action)) return false;
  const all = loadQuoteCompletenessLearning();
  const prev = all[ruleId] || {};
  all[ruleId] = {
    ...prev,
    ruleId,
    familyKey: familyKey || prev.familyKey || "",
    label: label || prev.label || "",
    action,
    preferredProductId: productId || prev.preferredProductId || "",
    times: Number(prev.times || 0) + 1,
    updatedAt: nowIso(),
  };

  const entries = Object.entries(all)
    .sort((a, b) => String(b[1]?.updatedAt || "").localeCompare(String(a[1]?.updatedAt || "")))
    .slice(0, MAX_RULES);
  return tenantStorageSetJson(LEARNING_KEY, Object.fromEntries(entries));
}

export function forgetQuoteCompletenessDecision(ruleId = "") {
  if (!ruleId) return false;
  const all = loadQuoteCompletenessLearning();
  if (!Object.prototype.hasOwnProperty.call(all, ruleId)) return true;
  delete all[ruleId];
  return tenantStorageSetJson(LEARNING_KEY, all);
}

export function exportQuoteCompletenessLearning() {
  return loadQuoteCompletenessLearning();
}
