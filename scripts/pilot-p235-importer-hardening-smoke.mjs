import assert from 'node:assert/strict';
import { mapColumns } from '../src/import-engine/mapColumns.js';
import { rowToItem } from '../src/import-engine/extractItems.js';

function row(r, cells) {
  const max = Math.max(...Object.keys(cells).map(Number), 0);
  const text = Array(max + 1).fill('');
  for (const [k, v] of Object.entries(cells)) text[Number(k)] = String(v);
  return { r, text, joined: text.filter(Boolean).join(' '), filled: text.filter(Boolean).length, cells: [] };
}

// 1) A supplier catalog with a single generic ĐƠN GIÁ column is financially ambiguous.
// RC13 requires one file-level user decision before it can become cost or list price.
{
  const header = row(0, { 0: 'Mã SP', 1: 'Tên sản phẩm', 2: 'ĐƠN GIÁ' });
  const data = [
    row(1, { 0: 'FW741', 1: 'FLOWER 1', 2: '1090000' }),
    row(2, { 0: 'FW742', 1: 'FLOWER 1', 2: '1090000' }),
    row(3, { 0: 'FW743', 1: 'FLOWER 1', 2: '1090000' }),
  ];
  const { map } = mapColumns(header, data, 2);
  assert.equal(map.price, 2);
  assert.equal(map._singleSourceUnitPrice, true);
  assert.equal(map._priceColUncertain, true);
}

// 2) Concise source commercial label beats the opaque fallback "Sản phẩm <SKU>".
{
  const item = rowToItem(
    row(17, { 0: '3', 1: 'PA091', 2: 'PLAIN', 3: 'M2', 4: '1050000' }),
    { sku: 1, unit: 3, price: 4, _featureCols: [2], _deriveNameFromFeature: true, _priceColUncertain: false },
    'DL GIÁ 1', '', 'NGUYEN DA', {}
  );
  assert.ok(item);
  assert.equal(item.sku, 'PA091');
  assert.equal(item.name, 'PLAIN PA091');
  assert.equal(item.price, 1050000);
}

// 3) Another source family/name must remain visible instead of generic fallback.
{
  const item = rowToItem(
    row(27, { 0: '6', 1: 'CT701', 2: 'CUTIE', 3: 'M2', 4: '920000' }),
    { sku: 1, unit: 3, price: 4, _nameSourceCols: [2], _deriveNameFromFeature: true, _priceColUncertain: false },
    'DL GIÁ 1', '', 'NGUYEN DA', {}
  );
  assert.ok(item);
  assert.equal(item.sku, 'CT701');
  assert.equal(item.name, 'CUTIE CT701');
}

// 4) If a badly labelled Mã column contains a natural-language product name,
// keep it as name and do not invent a canonical SKU from that phrase.
{
  const item = rowToItem(
    row(29, { 0: '24', 1: 'Thẻ từ Mifare 13.56Mhz', 2: '75000' }),
    { sku: 1, price: 2, _deriveNameFromSku: true, _priceColUncertain: false },
    'KHÓA KHÁCH SẠN', '', 'Supplier', {}
  );
  assert.ok(item);
  assert.equal(item.name, 'Thẻ từ Mifare 13.56Mhz');
  assert.equal(item.sku, '');
}

// 5) Tax/subtotal rows are document economics, never catalog products.
{
  const item = rowToItem(
    row(20, { 0: 'Thuế', 1: 'Thuế', 2: '771500' }),
    { name: 0, sku: 1, price: 2, _priceColUncertain: false },
    'Báo gọi nhà hàng', '', 'Supplier', {}
  );
  assert.equal(item, null);
}

console.log('✓ P2.3.5 RC5 importer hardening smoke PASS');
console.log('  - single source ĐƠN GIÁ stays REVIEW until user selects cost vs list price');
console.log('  - source commercial labels preserved over generic SKU fallback');
console.log('  - natural-language pseudo-SKU is not promoted to identity');
console.log('  - tax/subtotal pseudo-products are blocked');
