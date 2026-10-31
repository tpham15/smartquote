import assert from 'node:assert/strict';
import { rowToItem } from '../src/import-engine/extractItems.js';
import { sanitizeCatalogProduct } from '../src/import-engine/productSanitizer.js';
import { validateItems } from '../src/import-engine/validateItems.js';

const row = (text, r = 1) => ({
  text,
  joined: text.join(' '),
  r,
  cells: text.map((value, i) => ({ ref: `${String.fromCharCode(65 + i)}${r}`, value })),
});

// NGUYÊN ĐÀ: locked/code-only name must not block grounded commercial-name recovery.
let item = rowToItem(
  row(['PA091', '3', 'PLAIN', 'PA091', 'M2', '1050000']),
  { name: 0, sku: 0, price: 5, _lockedName: true },
  'DL GIÁ 1', '', 'NGUYEN DA',
);
assert.equal(item?.sku, 'PA091');
assert.equal(item?.name, 'PLAIN PA091');

item = rowToItem(
  row(['CT701', '6', 'CUTIE', 'CT701', 'M2', '920000']),
  { name: 0, sku: 0, price: 5, _lockedName: true },
  'DL GIÁ 1', '', 'NGUYEN DA',
);
assert.equal(item?.name, 'CUTIE CT701');

// Long description: preserve concise leading source label instead of Sản phẩm <SKU>.
item = rowToItem(
  row(['DS-1LN6-UE-W', 'Cáp mạng U/UTP Cat6, vỏ PVC, lõi 24AWG Vỏ cáp dày: 0.55 mm, đường kính tổng: 5.8 mm, vật liệu PVC, Chiều dài cáp 305m', '5590000']),
  { name: 0, sku: 0, price: 2, _lockedName: true },
  'Chuông hình BasIP', '', 'MX',
);
assert.equal(item?.name, 'Cáp mạng U/UTP Cat6 DS-1LN6-UE-W');

// Aiphone-style kit: code-only locked name can recover the commercial phrase around the model.
item = rowToItem(
  row(['JO-1MDW', 'Bao gồm Màn hình JO-1MDW và nút chuông JO-DA', '13600000']),
  { name: 0, sku: 0, specs: 1, price: 2, _lockedName: true },
  'Aiphone', '', 'MX',
);
assert.equal(item?.sku, 'JO-1MDW');
assert.match(item?.name || '', /Màn hình JO-1MDW/i);

// NGUYÊN ĐÀ: source-leading sellable variant code beats a mapped fabric-code range.
item = rowToItem(
  row(['C007-MCS', 'RÈM CUỐN', 'Rèm cuốn lưới máng che sáng', 'C007-C008', 'M2', '230000']),
  { name: 1, sku: 3, specs: 2, price: 5, _lockedName: true },
  'NSX', '', 'NGUYEN DA',
);
assert.equal(item?.sku, 'C007-MCS');

// Feature/config tokens may be mapped as SKU, but a real model elsewhere in the row wins.
item = rowToItem(
  row(['TAY/PIN', 'Khoá cửa vân tay S510-II', '4890000']),
  { name: 1, sku: 0, price: 2, _skuHeaderExplicit: true, _lockedName: true },
  'Khóa', '', 'Supplier',
);
assert.equal(item?.sku, 'S510-II');

// Electrical/dimension evidence must never become canonical SKU.
item = rowToItem(
  row(['12VDC-24VDC-D', 'Phương thức mở khóa: vân tay', '4890000']),
  { name: 1, sku: 0, price: 2, _skuHeaderExplicit: true, _lockedName: true },
  'KHÓA CỔNG', '', 'Supplier',
);
assert.notEqual(item?.sku, '12VDC-24VDC-D');

item = rowToItem(
  row(['40-100MM-K', 'Khoá cửa vân tay A110', '4890000']),
  { name: 1, sku: 0, price: 2, _skuHeaderExplicit: true, _lockedName: true },
  'Khóa', '', 'Supplier',
);
assert.equal(item?.sku, 'A110');

// Accounting carry-over rows are not sellable catalog products.
item = rowToItem(
  row(['Nợ cuối kỳ:', '8247225.6', 'Vũ Thị Thùy Trí', '079-ACB']),
  { name: 0, sku: 3, price: 1, _lockedName: true },
  'Đọc Form Đơn', '', 'NGUYEN DA',
);
assert.equal(item, null);

// A row with list/sell price but no cost/SKU is incomplete, not corrupt: keep for review.
const [reviewable] = validateItems([{
  name: 'Điều khiển từ xa', sku: '', price: 0, listPrice: 270000,
  kind: 'catalog_product', issues: [],
}]);
assert(reviewable.issues.some((x) => x.code === 'missing_cost_price' && x.level === 'warning'));
assert(!reviewable.issues.some((x) => x.level === 'error'));

// Later grounded recovery must clear stale missing-field issues from earlier stages.
const sanitized = sanitizeCatalogProduct({
  name: 'Màn hình JO-1MDW', sku: 'JO-1MDW', costPrice: 13600000, listPrice: 0,
  _meta: {
    issues: [
      { code: 'missing_sku', level: 'info', message: 'Thiếu mã SKU' },
      { code: 'missing_price', level: 'error', message: 'Thiếu giá' },
    ],
    source: { rawText: 'Màn hình JO-1MDW 13600000' },
  },
});
assert(!sanitized._meta.issues.some((x) => x.code === 'missing_sku'));
assert(!sanitized._meta.issues.some((x) => x.code === 'missing_price'));

console.log('✓ P2.3.7 RC8 remaining-supplier hardening smoke PASS');
console.log('  - locked/generic names recover source commercial labels');
console.log('  - source-leading sellable codes beat mapped ranges');
console.log('  - feature/electrical/dimension pseudo-SKUs cannot poison identity');
console.log('  - accounting carry-over rows are excluded from catalog');
console.log('  - list-price-only rows stay REVIEW instead of FAILED');
console.log('  - stale missing-field issues are cleared after grounded recovery');
