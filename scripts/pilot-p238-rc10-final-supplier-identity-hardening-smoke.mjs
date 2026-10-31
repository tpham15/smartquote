import assert from 'node:assert/strict';
import { sanitizeCatalogProduct, recoverGroundedCatalogIdentity } from '../src/import-engine/productSanitizer.js';
import { scoreConfidence } from '../src/import-engine/scoreConfidence.js';

// NGUYÊN ĐÀ — source row explicitly carries commercial series between two
// occurrences of the same SKU.
let recovered = recoverGroundedCatalogIdentity({
  name: 'Sản phẩm PA091',
  sku: 'PA091',
  rawText: 'PA091 3 PLAIN PA091 M2 1050000',
});
assert.equal(recovered.recovered, true);
assert.equal(recovered.name, 'PLAIN PA091');
assert.equal(recovered.sku, 'PA091');

recovered = recoverGroundedCatalogIdentity({
  name: 'Sản phẩm CT701',
  sku: 'CT701',
  rawText: 'CT701 6 CUTIE CT701 M2 920000',
});
assert.equal(recovered.name, 'CUTIE CT701');

// MX-BG / Aiphone — the sellable kit identity is in the trailing
// Unit | Qty | commercial product block, while earlier text names components.
let p = sanitizeCatalogProduct({
  name: 'Sản phẩm JO-1MDW',
  sku: 'JO-1MDW',
  category: 'Chuông cửa',
  costPrice: 14705000,
  supplier: 'MX',
  _meta: {
    source: {
      rawText: '1 Bao gồm Màn hình JO-1MDW và nút chuông JO-DA - Màn hình LCD: 7 inch cảm ứng - Kết nối lên tới 8 điện thoại smart phone Bộ 1 Chuông cửa có hình JOS-1AW (Gồm chuông cửa JO-1MDW và JO-DA) Aiphone Thái Lan 18077000 14705000',
    },
    issues: [],
  },
}, { oldQuoteMode: true });
assert.equal(p.sku, 'JOS-1AW');
assert.equal(p.name, 'Chuông cửa có hình JOS-1AW');

p = sanitizeCatalogProduct({
  name: 'Sản phẩm JO-DVF',
  sku: 'JO-DVF',
  category: 'Chuông cửa',
  costPrice: 17135000,
  supplier: 'MX',
  _meta: {
    source: {
      rawText: '3 Bao gồm Màn hình JO-1MDW và nút chuông JO-DVF - Nút chuông âm tường kim loại Bộ 1 Chuông cửa có hình JOS-1FW (Gồm chuông cửa JO-1MDW và JO-DVF) Aiphone Thái Lan 23150000 17135000',
    },
    issues: [],
  },
}, { oldQuoteMode: true });
assert.equal(p.sku, 'JOS-1FW');
assert.equal(p.name, 'Chuông cửa có hình JOS-1FW');

p = sanitizeCatalogProduct({
  name: 'Sản phẩm JOS-1A',
  sku: 'JOS-1A',
  category: 'Sản phẩm',
  costPrice: 10067000,
  supplier: 'MX',
  _meta: {
    source: {
      rawText: '7 màn hình kết nối điện thoại. Kết nối được 8 app điện thoại Có thể thay thế cho chuông JOS-1A, JOS-!V, JOS-1F Cái 1 Màn hình chính JO-1MDW Aiphone Thái Lan 13600000 10067000',
    },
    issues: [],
  },
}, { oldQuoteMode: true });
assert.equal(p.sku, 'JO-1MDW');
assert.equal(p.name, 'Màn hình chính JO-1MDW');

// Long-description row — recover concise source label before the true SKU.
p = sanitizeCatalogProduct({
  name: 'Sản phẩm DS-1LN6-UE-W',
  sku: 'DS-1LN6-UE-W',
  category: 'Sản phẩm',
  costPrice: 5590000,
  supplier: 'MX',
  _meta: {
    source: {
      rawText: '13 Cáp mạng U/UTP Cat6, vỏ PVC, lõi 24AWG Vỏ cáp dày: 0.55 mm, đường kính tổng: 5.8 mm Thùng 1 DS-1LN6-UE-W (Reel in box) Hikvision TQ 5590000 5590000',
    },
    issues: [],
  },
});
assert.equal(p.sku, 'DS-1LN6-UE-W');
assert.equal(p.name, 'Cáp mạng U/UTP Cat6 DS-1LN6-UE-W');

// Missing SKU can be recovered from the grounded sellable tail without changing
// a good source name into a synthetic label.
p = sanitizeCatalogProduct({
  name: 'Loa mở rộng',
  sku: '',
  category: 'Sản phẩm',
  costPrice: 600000,
  supplier: 'MX',
  _meta: {
    source: {
      rawText: '10 Loa mở rộng Cái 1 Loa mở rộng IER-2 Aiphone Thái Lan 880000 600000',
    },
    issues: [{ code: 'missing_sku', level: 'info', message: 'Thiếu mã SKU' }],
  },
});
assert.equal(p.sku, 'IER-2');
assert.match(p.name, /Loa mở rộng/i);
assert(!p._meta.issues.some((x) => x.code === 'missing_sku'));

// RC8 fixed validation, but scoreConfidence still rejected rows that had only
// list/sell price and no SKU. They must remain reviewable.
const [scored] = scoreConfidence([{
  name: 'Điều khiển từ xa',
  sku: '',
  price: 0,
  costPrice: 0,
  listPrice: 270000,
  category: 'Phụ kiện',
  supplier: 'NGUYEN DA',
  unit: 'Bộ',
  issues: [{ code: 'missing_cost_price', level: 'warning', message: 'Chưa có giá nhập' }],
}], 0.5);
assert.equal(scored.status, 'review');
assert.equal(scored.listPrice, 270000);

// Stale early-stage issues are removed after grounded fields are resolved.
p = sanitizeCatalogProduct({
  name: 'PLAIN PA091',
  sku: 'PA091',
  costPrice: 1050000,
  _meta: {
    source: { rawText: 'PA091 3 PLAIN PA091 M2 1050000' },
    issues: [
      { code: 'missing_product_name', level: 'error', message: 'Thiếu tên' },
      { code: 'generic_product_name', level: 'error', message: 'Tên generic' },
      { code: 'no_price_no_sku', level: 'error', message: 'Không giá & không mã' },
    ],
  },
});
assert(!p._meta.issues.some((x) => ['missing_product_name', 'generic_product_name', 'no_price_no_sku'].includes(x.code)));

console.log('✓ P2.3.8 RC10 final supplier identity hardening smoke PASS');
console.log('  - repeated-SKU source rows recover commercial series names');
console.log('  - trailing Unit/Qty sellable blocks recover kit/product SKU + name');
console.log('  - long description rows keep concise grounded commercial labels');
console.log('  - missing SKU can recover from the source tail');
console.log('  - list-price-only rows stay REVIEW through scoring');
console.log('  - stale early-stage identity issues clear after grounded recovery');
