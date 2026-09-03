import {
  sanitizeCatalogProduct,
  isUnsafeImportedProduct,
  isLikelyOldQuoteSectionRow,
  isLikelyOldQuoteFileName,
  isLikelyOldQuoteAggregateProduct,
} from "../src/import-engine/productSanitizer.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const sectionRaw = "IV/ Hạng mục mẫu 1234500";
assert(isLikelyOldQuoteSectionRow(sectionRaw), "old quote section/subtotal row should be detected");
assert(isLikelyOldQuoteFileName("BG KH DEMO.xlsx"), "BG filename should enable old quote guard");

const sectionProduct = sanitizeCatalogProduct({
  name: "Sản phẩm IV/ Hạng mục mẫu",
  sku: "",
  unit: "",
  costPrice: 1234500,
  _meta: { source: { rawText: sectionRaw, fileName: "BG KH DEMO.xlsx" } },
}, { sourceFileName: "BG KH DEMO.xlsx" });
assert(sectionProduct._meta?.oldQuoteGuardSkipped, "section product should be marked skipped by old quote guard");
assert(sectionProduct._meta?.canonicalStatus === "skipped", "section product should get skipped canonical status");
assert(isUnsafeImportedProduct(sectionProduct), "skipped old quote rows must not be importable");

const packageProduct = sanitizeCatalogProduct({
  name: "Vật tư phụ (Đầu mạng, dây nhảy, băng keo, đinh vít, đầu cos, hộp box chống nước...)",
  sku: "",
  unit: "Gói",
  costPrice: 150000,
  _meta: { source: { rawText: "Vật tư phụ (Đầu mạng, dây nhảy...) Gói 1 150000 150000", fileName: "BG CAN HO DEMO.xlsx" } },
}, { oldQuoteMode: true, sourceFileName: "BG CAN HO DEMO.xlsx" });
assert(packageProduct._meta?.oldQuoteGuardSkipped, "quote-only material package should be skipped in old quote mode");

const realProduct = sanitizeCatalogProduct({
  name: "Thiết bị mạng mẫu DEMO-SW1",
  sku: "DEMO-SW1",
  supplier: "Nhà cung cấp mẫu",
  unit: "Bộ",
  costPrice: 250000,
  specs: "Thông số kỹ thuật mẫu",
  _meta: { source: { rawText: "Thiết bị mạng mẫu DEMO-SW1 Nhà cung cấp mẫu Bộ 1 250000 250000", fileName: "BG KH DEMO.xlsx" } },
}, { oldQuoteMode: true, sourceFileName: "BG KH DEMO.xlsx" });
assert(!realProduct._meta?.oldQuoteGuardSkipped, "real product with SKU must not be skipped");
assert(!isLikelyOldQuoteAggregateProduct(realProduct, { oldQuoteMode: true }), "real SKU product should not look like aggregate");

const normalService = sanitizeCatalogProduct({
  name: "Nhân công lắp đặt hệ thống",
  sku: "",
  unit: "Gói",
  costPrice: 5000000,
  kind: "service",
}, { sourceFileName: "bang-gia-dich-vu.xlsx" });
assert(!normalService._meta?.oldQuoteGuardSkipped, "normal non-quote service import should not be skipped by old quote guard");

console.log("Phase 10.2 old quote catalog guard smoke: PASS");
