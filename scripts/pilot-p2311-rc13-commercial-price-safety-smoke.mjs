import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mapColumns } from '../src/import-engine/mapColumns.js';
import { rowToItem } from '../src/import-engine/extractItems.js';
import { validateItems } from '../src/import-engine/validateItems.js';
import { scoreConfidence } from '../src/import-engine/scoreConfidence.js';
import { STATUS } from '../src/import-engine/types.js';
import { applyAmbiguousPriceRole } from '../src/import-engine/priceRoleDecision.js';
import { chooseDefaultMarkupFactor } from '../src/quote/quoteCommercialSafety.js';

function row(r, text) {
  return { r, text, cells: text.map((v, c) => v !== '' ? ({ c, v, ref: `${String.fromCharCode(65 + c)}${r + 1}` }) : null).filter(Boolean), joined: text.filter(Boolean).join(' '), filled: text.filter(Boolean).length };
}

function scoreOne(raw, confidence) {
  return scoreConfidence(validateItems([raw]), confidence)[0];
}

// 1) Generic single price is ambiguous and must stay REVIEW.
{
  const header = row(0, ['Mã SP', 'Tên sản phẩm', 'ĐVT', 'Đơn giá (1.000đ)']);
  const data = [row(1, ['A-01', 'Sản phẩm A', 'Cái', '1.200'])];
  const { map, confidence } = mapColumns(header, data, 3);
  assert.equal(map._priceScale, 1000);
  assert.equal(map._priceColUncertain, true, 'generic Đơn giá must be ambiguous');
  const item = scoreOne(rowToItem(data[0], map, 'Sheet1', '', 'NCC'), confidence);
  assert.equal(item.costPrice, 1_200_000);
  assert.equal(item.status, STATUS.REVIEW);
  assert.ok(item.issues.some((i) => i.code === 'price_column_uncertain'));

  const asCost = applyAmbiguousPriceRole([item], 'cost')[0];
  assert.equal(asCost.costPrice, 1_200_000);
  assert.equal(asCost.listPrice || 0, 0);
  assert.equal(asCost._meta.priceColumnRole, 'cost');
  assert.ok(!asCost._meta.issues.some((i) => i.code === 'price_column_uncertain'));

  const asList = applyAmbiguousPriceRole([item], 'list')[0];
  assert.equal(asList.costPrice, 0);
  assert.equal(asList.listPrice, 1_200_000);
  assert.equal(asList.priceMode, 'fixed');
  assert.equal(asList._meta.priceColumnRole, 'list');
  assert.ok(asList._meta.issues.some((i) => i.code === 'missing_cost_price'));
}

// 2) Strong cost labels remain deterministic.
{
  const header = row(0, ['Mã SP', 'Tên sản phẩm', 'Giá nhập']);
  const data = [row(1, ['B-01', 'Sản phẩm B', '900.000'])];
  const { map, confidence } = mapColumns(header, data, 2);
  assert.equal(map._priceColUncertain, false);
  const item = scoreOne(rowToItem(data[0], map, 'Sheet1', '', 'NCC'), confidence);
  assert.ok(!item.issues.some((i) => i.code === 'price_column_uncertain'));
}

// 3) Old quote evidence must still treat unit price as fixed sale price, not ambiguous supplier cost.
{
  const header = row(0, ['Tên sản phẩm', 'Mã SP', 'SL', 'Đơn giá', 'Thành tiền']);
  const data = [row(1, ['Sản phẩm C', 'C-01', '2', '500.000', '1.000.000'])];
  const { map } = mapColumns(header, data, 4);
  assert.equal(map._quoteTable, true);
  assert.equal(map._priceColUncertain, false);
  const item = rowToItem(data[0], map, 'Sheet1', '', 'NCC');
  assert.equal(item.listPrice, 500_000);
  // Existing quote-table compatibility keeps the extracted unit price in costPrice too;
  // priceMode=fixed is the invariant that prevents a second markup from being applied.
  assert.equal(item.costPrice, 500_000);
  assert.equal(item.priceMode, 'fixed');
}

// 4) New/unconfigured workspaces must not default to 0% margin.
assert.equal(chooseDefaultMarkupFactor([]), 1.2);
assert.equal(chooseDefaultMarkupFactor([{ value: 1.2 }]), 1.2);
// Explicit legacy/user setting ×1.0 is preserved; no silent migration of existing pricing policy.
assert.equal(chooseDefaultMarkupFactor([{ value: 1 }]), 1);

const ui = fs.readFileSync(new URL('../src/SmartQuote.jsx', import.meta.url), 'utf8');
assert.ok(ui.includes('label: "Mặc định", value: 1.2'), 'new workspace default markup must be ×1.20');
assert.ok(ui.includes('Giá bán / niêm yết'), 'preview must offer list-price role');
assert.ok(ui.includes('Giá nhập / giá vốn'), 'preview must offer cost-price role');
assert.ok(ui.includes('SmartQuote không tự đoán dữ liệu tài chính'), 'preview must explain financial ambiguity');

console.log('✓ P2.3.11 RC13 commercial price safety smoke PASS');
console.log('  - lone generic Đơn giá stays REVIEW until a file-level role is chosen');
console.log('  - user can classify the whole file as cost or list price');
console.log('  - explicit cost headers and quote-table arithmetic keep deterministic behavior');
console.log('  - new workspace default markup is ×1.20; explicit legacy ×1.00 is preserved');
