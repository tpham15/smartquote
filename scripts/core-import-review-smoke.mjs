import assert from 'node:assert/strict';
import { mapColumns } from '../src/import-engine/mapColumns.js';
import { rowToItem } from '../src/import-engine/extractItems.js';
import { classifyRow } from '../src/import-engine/classifyRows.js';
import { ROW_CLASS, STATUS } from '../src/import-engine/types.js';
import { validateItems } from '../src/import-engine/validateItems.js';
import { scoreConfidence } from '../src/import-engine/scoreConfidence.js';
import { getPriceCandidates } from '../src/import-engine/productSanitizer.js';

function row(r, text) {
  return { r, text, cells: text.map((v, c) => v ? ({ c, v, ref: `${String.fromCharCode(65 + c)}${r + 1}` }) : null).filter(Boolean), joined: text.filter(Boolean).join(' '), filled: text.filter(Boolean).length };
}

function scoredItem(raw, mapConf = 0.9) {
  return scoreConfidence(validateItems([raw]), mapConf)[0];
}

function testPriceScaleThousand() {
  const header = row(0, ['STT', 'Mã SP', 'Tên sản phẩm', 'ĐVT', 'Đơn giá (1.000đ)']);
  const data = [row(1, ['1', 'LM-SW1', 'Công tắc thông minh 1 nút', 'Cái', '1.200'])];
  const { map, confidence } = mapColumns(header, data, 4);
  assert.equal(map._priceScale, 1000);
  const item = rowToItem(data[0], map, 'Sheet1', '', 'Lumi');
  const scored = scoredItem(item, confidence);
  assert.equal(scored.costPrice, 1_200_000);
  assert.equal(scored.status, STATUS.REVIEW, 'Đơn giá mơ hồ phải cần xác nhận cột giá mua');
  assert.ok(scored.issues.some((i) => i.code === 'price_scaled_from_header'));
  assert.ok(scored.issues.some((i) => i.code === 'price_column_uncertain'));
}

function testPriceScaleMillionDecimal() {
  const header = row(0, ['STT', 'Mã SP', 'Tên sản phẩm', 'ĐVT', 'Giá nhập (triệu)']);
  const data = [row(1, ['1', 'TB-01', 'Tủ bếp mẫu 01', 'm', '1,2'])];
  const { map, confidence } = mapColumns(header, data, 4);
  const item = rowToItem(data[0], map, 'Sheet1', '', 'Xưởng');
  const scored = scoredItem(item, confidence);
  assert.equal(scored.costPrice, 1_200_000);
  assert.ok(!scored.issues.some((i) => i.code === 'price_column_uncertain'), 'Giá nhập rõ ràng không bị uncertain');
}

function testBillableServiceRowKept() {
  const header = row(0, ['Hạng mục', 'ĐVT', 'Đơn giá']);
  const data = row(1, ['Nhân công lắp đặt trọn gói', 'Gói', '5.000.000']);
  const { map, confidence } = mapColumns(header, [data], 2);
  assert.equal(classifyRow(data, { priceCol: map.price, nameCol: map.name }), ROW_CLASS.PRODUCT);
  const item = rowToItem(data, map, 'Sheet1', '', 'Nhà cung cấp mẫu');
  const scored = scoredItem(item, confidence);
  assert.equal(scored.costPrice, 5_000_000);
  assert.equal(scored.kind, 'service');
  assert.ok(!scored.issues.some((i) => i.code === 'missing_sku'));
}

function testUsStyleAndDateGuard() {
  assert.deepEqual(getPriceCandidates('date 20240115 hotline 0901234567'), []);
  // US style is preserved as a numeric candidate instead of becoming 123456.
  assert.equal(getPriceCandidates('price 1,234.56').length, 0, 'US decimal without VND scale should not become a VND price');
}

function main() {
  testPriceScaleThousand();
  testPriceScaleMillionDecimal();
  testBillableServiceRowKept();
  testUsStyleAndDateGuard();
  console.log('core import review smoke: PASS');
}

main();
