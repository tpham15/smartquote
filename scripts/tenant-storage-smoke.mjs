import { setTenantStorageScope, tenantScopedStorageKey, tenantStorageGetItem, tenantStorageSetItem } from "../src/storage/tenantStorage.js";
import { saveCorrection, loadCorrections, normCorrectionKey } from "../src/import-engine/corrections.js";
import { saveProductLearning, listCorrectionLearningStats, clearCorrectionLearning } from "../src/import-engine/correctionLearning.js";
import { saveBomMatchLearning, loadBomMatchLearning } from "../src/import-engine/bom/bomMatcher.js";
import { saveCatalogTemplate, listCatalogTemplates } from "../src/import-engine/templateMemory.js";

class MemoryStorage {
  constructor() { this.store = new Map(); }
  getItem(key) { return this.store.has(key) ? this.store.get(key) : null; }
  setItem(key, value) {
    const k = String(key);
    const v = String(value);
    this.store.set(k, v);
    this[k] = v;
  }
  removeItem(key) {
    const k = String(key);
    this.store.delete(k);
    delete this[k];
  }
  clear() {
    for (const k of Array.from(this.store.keys())) delete this[k];
    this.store.clear();
  }
  key(index) { return Array.from(this.store.keys())[index] || null; }
  get length() { return this.store.size; }
}

globalThis.window = {};
globalThis.localStorage = new MemoryStorage();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function keys() { return Array.from(localStorage.store.keys()).sort(); }

// Local/offline mode keeps legacy keys.
setTenantStorageScope(null);
saveCorrection("Dòng A", "product-local");
assert(localStorage.getItem("sq_import_corrections"), "local mode should write legacy corrections key");
localStorage.clear();

// Cloud mode rewrites all sq_* keys by dealer.
setTenantStorageScope("dealer-A");
assert(tenantScopedStorageKey("sq_ai_quota") === "sq_dealer_dealer-A_ai_quota", "should scope sq_ai_quota");
tenantStorageSetItem("sq_pdf_cache_hash1", JSON.stringify([1]));
saveCorrection("Dòng A", "product-A");
saveProductLearning({ id: "pA", name: "Công tắc A", sku: "A-001", _meta: { source: { rawText: "raw A" } } }, { userEdited: true });
saveBomMatchLearning({ name: "công tắc A", model: "A-001" }, { id: "pA", sku: "A-001", name: "Công tắc A" });
saveCatalogTemplate({ headers: ["Tên", "Mã", "Giá"], fileName: "bang-gia-a.xlsx", colMap: { name: 0, sku: 1, costPrice: 2 } });

assert(keys().every((k) => k.startsWith("sq_dealer_dealer-A_")), "dealer A should only write scoped keys");
assert(tenantStorageGetItem("sq_pdf_cache_hash1"), "dealer A PDF cache should be readable");
assert(loadCorrections()[normCorrectionKey("Dòng A")] === "product-A", "dealer A correction should be readable");
assert(listCorrectionLearningStats().skuRules === 1, "dealer A correction learning should be readable");
assert(loadBomMatchLearning().byModel["a-001"], "dealer A BOM learning should be readable");
assert(listCatalogTemplates().length === 1, "dealer A template should be listed");

setTenantStorageScope("dealer-B");
assert(!tenantStorageGetItem("sq_pdf_cache_hash1"), "dealer B must not read dealer A PDF cache");
assert(!loadCorrections()[normCorrectionKey("Dòng A")], "dealer B must not read dealer A corrections");
assert(listCorrectionLearningStats().skuRules === 0, "dealer B correction learning should start empty");
assert(Object.keys(loadBomMatchLearning().byModel || {}).length === 0, "dealer B BOM learning should start empty");
assert(listCatalogTemplates().length === 0, "dealer B templates should start empty");

saveCorrection("Dòng B", "product-B");
saveProductLearning({ id: "pB", name: "Công tắc B", sku: "B-001", _meta: { source: { rawText: "raw B" } } }, { userEdited: true });
assert(keys().some((k) => k.startsWith("sq_dealer_dealer-A_")) && keys().some((k) => k.startsWith("sq_dealer_dealer-B_")), "both dealers should have isolated namespaces");

setTenantStorageScope("dealer-A");
assert(loadCorrections()[normCorrectionKey("Dòng A")] === "product-A", "dealer A data should remain after dealer switch");
assert(!loadCorrections()[normCorrectionKey("Dòng B")], "dealer A must not see dealer B corrections");
assert(listCorrectionLearningStats().skuRules === 1, "dealer A learning count should remain isolated");

clearCorrectionLearning();
assert(listCorrectionLearningStats().skuRules === 0, "clear should remove only active dealer learning");
setTenantStorageScope("dealer-B");
assert(listCorrectionLearningStats().skuRules === 1, "clearing dealer A must not clear dealer B learning");

console.log("✓ Tenant storage smoke passed — learning/cache/template keys are dealer-scoped in cloud mode.");
