import test from "node:test";
import assert from "node:assert/strict";
import {
  htmlTableToGrid,
  inferHeaderMap,
  normalizePaddleOcrVlResult,
} from "../engines/paddleocr-vl-normalize.mjs";
import { blindBenchmarkMeta, blindDocumentContext } from "../engines/protocol.mjs";

const biscoHtml = `<table>
<tr><th>STT</th><th>Tên sản phẩm</th><th>Mã</th><th>ĐVT</th><th>Giá bán lẻ</th><th>Giá NPP (&gt;30 bộ)</th></tr>
<tr><td>1</td><td>Cổng mở xoay âm sàn VULCAN - 24V, 600kg</td><td>22F005</td><td>Bộ</td><td>41.900.000</td><td>19.765.000</td></tr>
</table>`;

test("Paddle table normalizer maps retail and distributor price columns correctly", () => {
  const grid = htmlTableToGrid(biscoHtml);
  const header = inferHeaderMap(grid);
  assert.equal(header.map.name, 1);
  assert.equal(header.map.sku, 2);
  assert.equal(header.map.listPrice, 4);
  assert.equal(header.map.unitPrice, 5);
  const rows = normalizePaddleOcrVlResult({ pages: [{ res: { page_index: 0, parsing_res_list: [{ block_label: "table", block_bbox: [10, 20, 900, 400], block_content: biscoHtml }] } }] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "product");
  assert.equal(rows[0].fields.sku, "22F005");
  assert.equal(rows[0].fields.unitPrice, 19765000);
  assert.equal(rows[0].fields.listPrice, 41900000);
  assert.equal(rows[0].source.page, 1);
  assert.deepEqual(rows[0].source.bbox, [10, 20, 900, 400]);
  assert.equal(rows[0].status, "need_review");
});

test("Paddle table normalizer preserves section rows as non-product traps", () => {
  const html = `<table>
<tr><th>STT</th><th>Tên sản phẩm</th><th>Mã sản phẩm</th><th>Giá bán</th></tr>
<tr><td>1</td><td>Công tắc Luto 1 nút</td><td>LM-S1N/S</td><td>1.944.000</td></tr>
<tr><td colspan="4">CẢM BIẾN</td></tr>
<tr><td>2</td><td>Cảm biến chuyển động</td><td>LM-MDZ/2.0</td><td>1.540.000</td></tr>
</table>`;
  const rows = normalizePaddleOcrVlResult({ pages: [{ res: { page_index: 1, parsing_res_list: [{ block_label: "table", block_id: 7, block_bbox: [1, 2, 3, 4], block_content: html }] } }] });
  assert.deepEqual(rows.map((r) => r.kind), ["product", "non_product", "product"]);
  assert.equal(rows[1].fields.name, "CẢM BIẾN");
  assert.equal(rows[2].fields.section, "CẢM BIẾN");
  assert.equal(rows[0].source.page, 2);
});

test("Paddle table normalizer does not auto-approve because VL output has no field confidence", () => {
  const rows = normalizePaddleOcrVlResult({ pages: [{ res: { page_index: 0, parsing_res_list: [{ block_label: "table", block_content: biscoHtml }] } }] });
  assert.ok(rows.every((r) => r.status === "need_review"));
  assert.ok(rows.every((r) => r.confidence == null));
});

test("candidate engine benchmark context is blind to ground truth and expected counts", () => {
  const doc = blindDocumentContext({
    id: "d1", inputKind: "scan_pdf", documentType: "supplier_price_list", industry: "smarthome", supplier: "Lumi", tags: ["scan"],
    groundTruth: "secret.json", expectedProductRows: 53, reviewEvidence: { pageProductCounts: { 1: 21 } }, sourceSha256: "x".repeat(64),
  });
  assert.deepEqual(doc, { id: "d1", inputKind: "scan_pdf", documentType: "supplier_price_list", industry: "smarthome", supplier: "Lumi", tags: ["scan"] });
  assert.equal("groundTruth" in doc, false);
  assert.equal("expectedProductRows" in doc, false);
  const meta = blindBenchmarkMeta({ id: "bench", version: "0.1.0", benchmarkPolicy: "sq-docbench-policy-v1", releaseGates: { rowRecall: 1 }, documents: [doc] });
  assert.deepEqual(meta, { id: "bench", version: "0.1.0", benchmarkPolicy: "sq-docbench-policy-v1" });
});
