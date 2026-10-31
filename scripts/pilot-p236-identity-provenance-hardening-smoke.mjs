import assert from 'node:assert/strict';
import { mapColumns } from '../src/import-engine/mapColumns.js';
import { rowToItem } from '../src/import-engine/extractItems.js';
import { extractSkuFromText } from '../src/import-engine/productSanitizer.js';
import { recoverPdfProductNameFromRawRow } from '../src/import-engine/pdf/pdfIdentityRecovery.js';

function row(r, cells) {
  const max = Math.max(...Object.keys(cells).map(Number), 0);
  const text = Array(max + 1).fill('');
  for (const [k, v] of Object.entries(cells)) text[Number(k)] = String(v);
  return { r, text, joined: text.filter(Boolean).join(' '), filled: text.filter(Boolean).length, cells: [] };
}

// 1) Explicit SKU header provenance is preserved.
{
  const header = row(0, { 0: 'Mã SP', 1: 'Tên sản phẩm', 2: 'ĐƠN GIÁ' });
  const data = [
    row(1, { 0: 'ABC-01', 1: 'Thiết bị A', 2: '1000000' }),
    row(2, { 0: 'ABC-02', 1: 'Thiết bị B', 2: '1100000' }),
    row(3, { 0: 'ABC-03', 1: 'Thiết bị C', 2: '1200000' }),
  ];
  const { map } = mapColumns(header, data, 2);
  assert.equal(map.sku, 0);
  assert.equal(map._skuHeaderExplicit, true);
}

// 2) Unlabelled feature abbreviations must not become canonical SKU.
{
  const item = rowToItem(
    row(6, { 0: '1', 1: 'Khóa thông minh mẫu A', 2: 'TAY/TH', 3: '4990000' }),
    { name: 1, sku: 2, price: 3, _priceColUncertain: false },
    'KHÓA THÔNG MINH', '', 'Supplier', {}
  );
  assert.ok(item);
  assert.equal(item.sku, '');
  assert.equal(item.name, 'Khóa thông minh mẫu A');
}

// 3) Dimension/material tokens are specs, not free-text SKU candidates.
assert.equal(extractSkuFromText('Kích thước 86X86X45MM, chất liệu SS304'), '');
assert.equal(extractSkuFromText('Kích thước khóa 130LX105WX38H'), '');

// 4) More specific source-leading variant code beats a shorter family code later in the row.
{
  const item = rowToItem(
    row(103, { 0: 'D001-TT', 1: '32', 2: 'RÈM ROMAN HỆ TRUYỀN THỐNG', 3: 'D001', 4: 'M2', 5: '550000' }),
    { name: 2, sku: 3, unit: 4, price: 5, _priceColUncertain: false },
    'DL GIÁ 1', '', 'NGUYEN DA', {}
  );
  assert.ok(item);
  assert.equal(item.sku, 'D001-TT');
  assert.equal(item.name, 'RÈM ROMAN HỆ TRUYỀN THỐNG');
}

// 5) Spaced model suffix remains one SKU/model.
assert.equal(extractSkuFromText('SBX202 - 5C0 50kg Vân tay mật mã'), 'SBX202-5C0');

// 6) Raw-row commercial label recovers MX-BG style names instead of Sản phẩm <SKU>.
{
  const item = rowToItem(
    row(18, { 0: '1', 1: 'Thiết bị liên lạc tại cửa', 2: 'AV-08FBL', 3: 'Nút chuông cửa nhận diện khuôn mặt', 4: '24200000' }),
    { sku: 2, specs: 3, price: 4, _deriveNameFromSku: true, _priceColUncertain: false },
    'Chuông hình BasIP', '', 'Supplier', {}
  );
  assert.ok(item);
  assert.equal(item.sku, 'AV-08FBL');
  assert.equal(item.name, 'Thiết bị liên lạc tại cửa AV-08FBL');
}

// 7) Technical feature sentence must not become the display name when SKU+context are stronger.
{
  const item = rowToItem(
    row(14, { 0: '10', 1: 'HX12', 2: 'Vân tay/ mật mã/ thẻ từ/ chìa cơ Thân Khóa cơ ( thân khóa 5050 )', 3: '1850000' }),
    { sku: 1, price: 3, _featureCols: [2], _deriveNameFromFeature: true, _priceColUncertain: false },
    'Khóa HEXA', '', 'SSEHOME', {}
  );
  assert.ok(item);
  assert.equal(item.sku, 'HX12');
  assert.match(item.name, /HX12/i);
  assert.doesNotMatch(item.name, /^Vân tay/i);
}

// 8) SSEHOME-style technical feature columns must not replace the product identity.
{
  const item = rowToItem(
    row(11, { 0: '2', 1: 'SBX501-5C0', 2: 'Chống cháy/ Vân tay/ mật mã/chìa cơ', 3: '30500000' }),
    { sku: 1, price: 3, _featureCols: [2], _deriveNameFromFeature: true, _priceColUncertain: false },
    'KÉT PHILIPS', '', 'SSEHOME', {}
  );
  assert.ok(item);
  assert.equal(item.sku, 'SBX501-5C0');
  assert.match(item.name, /Két an toàn Philips SBX501-5C0/i);
  assert.doesNotMatch(item.name, /^Chống cháy/i);
}

// 9) No-SKU products keep the source commercial phrase without a synthetic prefix.
{
  const item = rowToItem(
    row(32, { 0: '14', 1: 'Giá đỡ màn hình', 2: '600000' }),
    { price: 2, _featureCols: [1], _deriveNameFromFeature: true, _priceColUncertain: false },
    'Chuông hình BasIP', '', 'Supplier', {}
  );
  assert.ok(item);
  assert.equal(item.name, 'Giá đỡ màn hình');
  assert.equal(item.sku, '');
}

// 10) Tax rows with a percentage are economics, not catalog products.
{
  const item = rowToItem(
    row(40, { 0: 'Thuế 8%', 1: 'Thuế 8%', 2: '13557680' }),
    { name: 0, sku: 1, price: 2, _priceColUncertain: false },
    'Chuông hình BasIP', '', 'Supplier', {}
  );
  assert.equal(item, null);
}

// 11) Debt/bank metadata must not enter the catalog.
{
  const item = rowToItem(
    row(38, { 0: 'Nợ phát sinh: 8247225.6 Vũ Thị Thùy Trí - 190355 Techcombank', 1: '190355' }),
    { name: 0, price: 1, _priceColUncertain: false },
    'TRẦN PHẲNG TỰ ĐỘNG', '', 'NGUYEN DA', {}
  );
  assert.equal(item, null);
}

// 12) PDF code+description rows recover the source description deterministically.
assert.equal(
  recoverPdfProductNameFromRawRow('5 ZTBS Phụ kiện mở cổng bằng điện thoại Cái/chiếc 4,000,000 1,000,000', 'ZTBS'),
  'Phụ kiện mở cổng bằng điện thoại'
);
assert.equal(
  recoverPdfProductNameFromRawRow('7 CHT Chặn hành trình cổng tay đòn Cái/chiếc 500,000 250,000', 'CHT'),
  'Chặn hành trình cổng tay đòn'
);
assert.equal(
  recoverPdfProductNameFromRawRow('10 D003 Đế nắp Inox 201 Cái/chiếc 4,500,000 1,600,000', 'D003'),
  'Đế nắp Inox 201'
);

console.log('✓ P2.3.6 RC6 identity/provenance hardening smoke PASS');
console.log('  - inferred feature abbreviations no longer poison SKU identity');
console.log('  - source-leading variant codes beat shorter stems/ranges');
console.log('  - row-grounded commercial names replace generic fallbacks');
console.log('  - PDF code+description rows recover product names from raw evidence');
console.log('  - dimensions/material grades remain specs, not canonical SKU');
