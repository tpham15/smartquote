import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchCatalog } from "../src/import-engine/matchCatalog.js";
import { mapColumns } from "../src/import-engine/mapColumns.js";
import { sanitizeCatalogProducts, dedupeCatalogIdentities, extractCommercialNameFromSpecs } from "../src/import-engine/productSanitizer.js";
import { productIdentityKey, technicalVariantSignature } from "../src/import-engine/productIdentity.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// P0-1: same SKU across suppliers must not collide.
const catalog = [
  { id: "A", sku: "ABC-100", name: "Motor Gate", supplier: "Supplier A" },
  { id: "B", sku: "ABC-100", name: "Smart Lock", supplier: "Supplier B" },
];
assert.equal(matchCatalog([{ sku: "ABC-100", name: "Motor Gate", supplier: "Supplier A" }], catalog)[0].matchedProductId, "A");
assert.equal(matchCatalog([{ sku: "ABC-100", name: "Smart Lock", supplier: "Supplier B" }], catalog)[0].matchedProductId, "B");
const unknown = matchCatalog([{ sku: "ABC-100", name: "Unknown product" }], catalog)[0];
assert.equal(unknown.matchedProductId, null);
assert.equal(unknown._matchType, "ambiguous_sku");
const cross = dedupeCatalogIdentities(catalog);
assert.equal(cross.products.length, 2);
assert.equal(cross.deduped, 0);

// Same SKU + same supplier + conflicting names must fail closed.
const conflict = dedupeCatalogIdentities([
  { id: "1", sku: "X-1", name: "Motor Gate", supplier: "Same Supplier", costPrice: 100 },
  { id: "2", sku: "X-1", name: "Smart Lock", supplier: "Same Supplier", costPrice: 100 },
]);
assert.equal(conflict.products.length, 2);
assert.equal(conflict.conflicts, 1);
assert.ok(conflict.products.every((p) => (p.issues || []).some((x) => x.code === "identity_collision_review")));

// P0-2: explicit product-name header must beat a left-side Hạng mục column.
const header = { text: ["Hạng mục", "Tên sản phẩm", "Mã SP", "Đơn Giá"] };
const rows = [
  { text: ["Chiếu sáng", "Downlight 12W 3000K", "DL12-3K", "100000"] },
  { text: ["Chiếu sáng", "Downlight 18W 4000K", "DL18-4K", "120000"] },
  { text: ["Chiếu sáng", "Spotlight 12W 3000K", "SP12-3K", "130000"] },
];
const mapped = mapColumns(header, rows, 3).map;
assert.equal(mapped.name, 1);
assert.equal(mapped.category, 0);
assert.equal(mapped.sku, 2);

// P0-3: technical variants must survive sanitizer + dedupe.
const variants = sanitizeCatalogProducts([
  { name: "Đèn Downlight Công suất 12W", supplier: "Lighting A", costPrice: 100000 },
  { name: "Đèn Downlight Công suất 18W", supplier: "Lighting A", costPrice: 120000 },
]);
assert.equal(variants[0].name, "Đèn Downlight Công suất 12W");
assert.equal(variants[1].name, "Đèn Downlight Công suất 18W");
assert.notEqual(technicalVariantSignature(variants[0]), technicalVariantSignature(variants[1]));
assert.notEqual(productIdentityKey(variants[0]), productIdentityKey(variants[1]));
assert.equal(dedupeCatalogIdentities(variants).products.length, 2);

const colorTemp = dedupeCatalogIdentities([
  { name: "Downlight 12W 3000K", supplier: "Lighting A" },
  { name: "Downlight 12W 4000K", supplier: "Lighting A" },
]);
assert.equal(colorTemp.products.length, 2);

// Commercial name can be recovered from Specs without using category as name.
assert.equal(
  extractCommercialNameFromSpecs("MÔ TƠ CỔNG TRƯỢT V2 - TORQ - 500D\nModel: 30C109\nThông số kỹ thuật"),
  "MÔ TƠ CỔNG TRƯỢT V2 - TORQ - 500D"
);

// P0-4: manual mapping must never synthesize category + SKU identity.
const legacy = fs.readFileSync(path.join(root, "src/import-engine/legacy/legacyCatalogImport.js"), "utf8");
assert.ok(legacy.includes("const recoveredSpecName = extractCommercialNameFromSpecs"));
assert.ok(legacy.includes("(sku ? `Sản phẩm ${sku}` : \"\")"));
assert.ok(!legacy.includes("`${category !== \"Chung\" ? category : \"Sản phẩm\"} ${sku}`"));

// P0-5: batch import must not use bare-SKU last-file-wins replacement.
const adapter = fs.readFileSync(path.join(root, "src/import-engine/uiAdapter.js"), "utf8");
assert.ok(adapter.includes("dedupeCatalogIdentities(all)"));
assert.ok(!adapter.includes("all[seen.get(key)] = p"));
assert.ok(!adapter.includes("bản sau ghi đè"));

// UI merge must also use canonical identity instead of skuMap[sku].
const app = fs.readFileSync(path.join(root, "src/SmartQuote.jsx"), "utf8");
assert.ok(app.includes("productIdentityKey(np)"));
assert.ok(app.includes("canAutoMergeIdentity(p, np)"));
assert.ok(!app.includes("skuMap[np.sku.toLowerCase()]"));

// The host app has a second mixed Excel/PDF batch path; it must use the same deduper.
assert.ok(app.includes("const identityBatch = dedupeCatalogIdentities(allProducts)"));
assert.ok(!app.includes("deduped[seen[key]] = p"));

// Supplier price updates must fail closed when a bare SKU maps to multiple catalog rows.
assert.ok(legacy.includes("const ambiguousItems = []"));
assert.ok(legacy.includes("if (!existing && candidates.length > 1)"));
assert.ok(legacy.includes("ambiguousItems.push({ item: it, candidates })"));

console.log("✓ Pilot P1.5.4 P0 identity safety PASS");
