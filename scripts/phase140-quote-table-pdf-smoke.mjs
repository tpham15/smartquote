#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  heuristicExtractProductsFromPdfPages,
  normalizePdfItems,
  dedupeProducts,
  inferPdfQuoteRowEconomics,
  classifyPdfStructuralRow,
  repairVietnameseGlyphSpacing,
  normalizePdfSku,
  skuIdentityCompatible,
  mergeQuoteTableCandidates,
} from "../src/import-engine/pdf/pdfCatalogPipeline.js";

const part = (x, str) => ({ x, width: Math.max(6, str.length * 5), height: 10, str });
const row = (text, parts) => ({ text, parts, bbox: { x: 40, y: 100, width: 510, height: 12 } });
const header = row("STT Tên hàng hoá Mã thiết bị Xuất xứ ĐVT SL Đơn giá Thành tiền", [
  part(46, "STT"), part(76, "Tên"), part(95, "hàng"), part(117, "hoá"),
  part(235, "Mã"), part(251, "thiết"), part(272, "bị"), part(309, "Xuất"), part(331, "xứ"),
  part(374, "ĐVT"), part(408, "SL"), part(449, "Đơn"), part(469, "giá"), part(504, "Thành"), part(534, "tiền"),
]);
const productRow = (stt, nameParts, skuParts, supplier, unit, qty, unitPrice, total) => row(
  `${stt} ${nameParts.join(" ")} ${skuParts.join(" ")} ${supplier} ${unit} ${qty} ${unitPrice}đ ${total}đ`,
  [part(53, String(stt)), ...nameParts.map((v, i) => part(76 + i * 20, v)), ...skuParts.map((v, i) => part(235 + i * 18, v)), part(309, supplier), part(374, unit), part(408, String(qty)), part(437, `${unitPrice}đ`), part(500, `${total}đ`)],
);


assert.equal(repairVietnameseGlyphSpacing("Công t ắ c c ơ thông minh"), "Công tắc cơ thông minh");
assert.equal(normalizePdfSku("LM-2G2W\uFFFE C(G)"), "LM-2G2W-C(G)");
assert.equal(normalizePdfSku("DS- 2CD1047G2H- LIUF"), "DS-2CD1047G2H-LIUF");
assert.equal(skuIdentityCompatible("LM-2G2W", "LM-2G2W-C(G)"), true);
assert.equal(skuIdentityCompatible("LM-2G2W", "LM-3G2W-C(G)"), false);
assert.deepEqual(classifyPdfStructuralRow("MST: 0123456789 · ĐT: 0900 123 456").kind, "header_contact");
assert.deepEqual(classifyPdfStructuralRow("II. Tầng 2 86.004.000đ"), { kind: "section_subtotal", catalogEligible: false, category: "Tầng 2" });
assert.deepEqual(classifyPdfStructuralRow("Nhân công, lập trình hệ thống (10%): 26.920.700đ").kind, "quote_summary_or_service");
assert.deepEqual(inferPdfQuoteRowEconomics("2 Công tắc Lumes 2 nút LM-2G2W-C(G) Lumi Chiếc 18 1.080.000đ 19.440.000đ"), {
  matched: true, quantity: 18, unitPrice: 1080000, lineTotal: 19440000, unitPriceRaw: "1.080.000đ", lineTotalRaw: "19.440.000đ",
});

const pages = [{
  page: 1, pageWidth: 595, pageHeight: 842,
  rows: [
    row("MST: 0123456789 · ĐT: 0900 123 456", [part(45, "MST:"), part(75, "0123456789"), part(140, "ĐT:"), part(165, "0900 123 456")]),
    header,
    row("II. Tầng 2 86.004.000đ", [part(20, "II."), part(40, "Tầng 2"), part(500, "86.004.000đ")]),
    productRow(2, ["Công", "tắc", "cơ", "thông", "minh", "Lumes", "2"], ["LM-2G2W-"], "Lumi", "Chiếc", 18, "1.080.000", "19.440.000"),
    row("nút C(G)", [part(76, "nút"), part(235, "C(G)")]),
    productRow(5, ["Cảm", "biến", "hiện", "diện", "BLE", "(âm", "trần)"], ["LM-PCB"], "Lumi", "Bộ", 12, "1.593.000", "19.116.000"),
    row("Cảm biến hiện diện BLE âm trần ·", [part(76, "Cảm"), part(96, "biến"), part(116, "hiện"), part(136, "diện"), part(156, "BLE"), part(176, "âm trần")]),
    row("220VAC/50Hz · tự bật/tắt đèn khi có người", [part(76, "220VAC/50Hz"), part(140, "tự bật/tắt đèn khi có người")]),
    row("Nhân công, lập trình hệ thống (10%): 26.920.700đ", [part(20, "Nhân công"), part(500, "26.920.700đ")]),
  ],
}];
pages[0].text = pages[0].rows.map((r) => r.text).join("\n");

const heuristic = heuristicExtractProductsFromPdfPages(pages, "Báo giá khách hàng");
assert.equal(heuristic.length, 2, "header/subtotal/service must not become products");
const switch2 = heuristic.find((x) => x.name.includes("Lumes 2"));
assert.equal(switch2.name, "Công tắc cơ thông minh Lumes 2 nút");
assert.equal(switch2.sku, "LM-2G2W-C(G)");
assert.equal(switch2.costPrice, 1080000);
assert.equal(switch2.listPrice, 0, "Thành tiền must not become list price");
assert.equal(switch2.quoteLineTotal, 19440000);
const sensor = heuristic.find((x) => x.name.includes("Cảm biến"));
assert.equal(sensor.sku, "LM-PCB", "letter-only model SKU must survive");
assert.equal(sensor.costPrice, 1593000);

const normalized = normalizePdfItems(heuristic, "Báo giá khách hàng", "pdf-v3-text-heuristic");
assert.ok(normalized.every((x) => x._meta.canonicalStatus === "auto_approved"));

// Simulate a stale/bad AI duplicate that previously made a correct deterministic row red.
const badAi = normalizePdfItems([{
  name: "Công tắc cơ thông minh Lumes 2 nút", sku: "", costPrice: 108000019440000,
  rawText: "Công tắc cơ thông minh Lumes 2 nút", sourcePage: 1,
}], "Báo giá khách hàng", "pdf-v3-ai-jsonl");
const deduped = dedupeProducts([...normalized, ...badAi], { fileName: "Báo giá khách hàng.pdf", supplierGuess: "Báo giá khách hàng" });
const merged = deduped.find((x) => x.name.includes("Lumes 2"));
assert.equal(merged.costPrice, 1080000);
assert.equal(merged.sku, "LM-2G2W-C(G)");
assert.equal(merged._meta.canonicalStatus, "auto_approved");
assert.ok(!(merged._meta.issues || []).some((i) => ["price_unreasonable", "pdf_ocr_uncertain"].includes(i.code)));

// Strong arithmetic-grounded quote tables use deterministic identities as the
// catalog source of truth. AI may enrich a matching truncated SKU but cannot
// append hallucinated products.
const truncatedAi = normalizePdfItems([{
  name: "Công t ắ c c ơ thông minh Lumes 2 nút", sku: "LM-2G2W", costPrice: 1080000,
  rawText: "Công tắc cơ thông minh Lumes 2 nút", sourcePage: 1,
}], "Báo giá khách hàng", "pdf-v3-ai-jsonl");
const hallucinatedAi = normalizePdfItems([{
  name: "Phí cấu hình hệ thống", sku: "AI-FAKE-01", costPrice: 999000,
  rawText: "Phí cấu hình hệ thống 999.000đ", sourcePage: 1,
}, {
  // AI can occasionally emit the same product with missing SKU/price; the
  // deterministic LM-PCB row must remain the identity source of truth.
  name: "Cảm biến hiện diện BLE âm trần", sku: "", costPrice: 0,
  rawText: "Cảm biến hiện diện BLE âm trần", sourcePage: 1,
}], "Báo giá khách hàng", "pdf-v3-ai-jsonl");
const thirdDeterministic = {
  ...normalized[0],
  id: "third",
  name: "Camera ngoài trời",
  sku: "DS-TEST-01",
  costPrice: 1935000,
  _meta: {
    ...(normalized[0]._meta || {}),
    source: { ...(normalized[0]._meta?.source || {}), row: 9 },
    productEvidence: { ...(normalized[0]._meta?.productEvidence || {}), quoteArithmeticMatched: true },
    issues: [],
    canonicalStatus: "auto_approved",
    status: "new",
  },
};
const deterministicQuote = [...normalized, thirdDeterministic];
const quoteMerged = mergeQuoteTableCandidates(deterministicQuote, [...truncatedAi, ...hallucinatedAi], { fileName: "Báo giá khách hàng.pdf", supplierGuess: "Báo giá khách hàng", structuredQuoteTable: true });
assert.equal(quoteMerged.length, 3, "AI-only identities must not inflate an arithmetic-verified quote table");
const quoteSwitch = quoteMerged.find((x) => x.name.includes("Lumes 2"));
assert.equal(quoteSwitch.sku, "LM-2G2W-C(G)", "full deterministic SKU must beat truncated AI SKU");
assert.equal(quoteSwitch._meta.canonicalStatus, "auto_approved");
assert.equal((quoteSwitch._meta.issues || []).filter((i) => i.level !== "info").length, 0);
const quoteSensor = quoteMerged.find((x) => x.sku === "LM-PCB");
assert.equal(quoteSensor.costPrice, 1593000);
assert.equal(quoteSensor._meta.canonicalStatus, "auto_approved");


// Catalog preview must collapse repeated quotation line-items into product
// identities. The real pilot quotation has 28 line-items but 17 unique models.
const identitySkus = [
  "LM-1G2W-C(G)", "LM-2G2W-C(G)", "LM-3G2W-C(G)", "LM-SK4/S-PC(G)",
  "DS-2CD1047G2H-LIUF", "DS-2CD1347G2H-LIUF", "LM-PCB", "RG-AP2200E",
  "LM-HC/4.0", "DS-7616NXI-K1", "WD43PURZ", "RG-EG105G", "DS-3E1518P-EI/M",
  "22F005", "LM-S2N/S", "TU-DAUGHI", "DS-3E1318P-EI/M",
];
const identityRows = identitySkus.map((sku, index) => ({
  ...normalized[0],
  id: `identity_${index}`,
  name: `Thiết bị ${sku}`,
  sku,
  costPrice: 1000000 + index * 1000,
  _meta: {
    ...(normalized[0]._meta || {}),
    source: { ...(normalized[0]._meta?.source || {}), page: 1 + Math.floor(index / 8), row: index + 1 },
    productEvidence: { ...(normalized[0]._meta?.productEvidence || {}), quoteArithmeticMatched: true },
    issues: [], canonicalStatus: "auto_approved", status: "new",
  },
}));
const repeatedLineItems = identityRows.slice(0, 11).map((item, index) => ({
  ...item, id: `repeat_${index}`,
  _meta: { ...(item._meta || {}), source: { ...(item._meta?.source || {}), page: 3, row: 40 + index } },
}));
const collapsedCatalog = dedupeProducts([...identityRows, ...repeatedLineItems], { fileName: "Báo giá khách hàng.pdf", supplierGuess: "Báo giá khách hàng" });
assert.equal(identityRows.length + repeatedLineItems.length, 28);
assert.equal(collapsedCatalog.length, 17, "28 quotation line-items must collapse to 17 catalog identities");

// AI-only PDF rows may be useful fallback evidence but are not silently clean.
const aiOnly = normalizePdfItems([{ name: "Thiết bị do AI đọc", sku: "AI-ONLY-01", costPrice: 123000, rawText: "Thiết bị do AI đọc AI-ONLY-01 123.000đ", sourcePage: 1 }], "Báo giá khách hàng", "pdf-v3-ai-jsonl");
assert.equal(aiOnly[0]._meta.canonicalStatus, "need_review");
assert.ok((aiOnly[0]._meta.issues || []).some((x) => x.code === "pdf_ai_needs_review"));

console.log("✓ Phase 14.0 quote-table PDF fix smoke PASS");
console.log("  SL × đơn giá = thành tiền confirms unit price");
console.log("  MST/subtotal/labor excluded; wrapped SKU reconstructed; stale AI error resolved");
