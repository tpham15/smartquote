import assert from 'node:assert/strict';
import {
  normalizeCatalogProducts,
  productToCatalogRpcItem,
  catalogRowToProduct,
  serializeProductsForCatalog,
} from '../src/supabase/catalogStore.js';

const sample = [
  { id: 'p_1', name: 'Công tắc 1 nút', sku: 'LM-S1', supplier: 'Lumi', costPrice: '100000', listPrice: 120000, publicPrice: 150000, image: 'https://x/img.jpg', sourceUrl: 'https://lumi.vn/p' },
  { id: 'p_2', name: 'Cảm biến cửa', sku: '', cost_price: 200000, image_url: 'https://x/door.jpg' },
  { id: '', name: 'Không ID' },
  { id: 'p_1', name: 'Trùng ID' },
];

const normalized = normalizeCatalogProducts(sample);
assert.equal(normalized.length, 2);
assert.equal(normalized[0].costPrice, 100000);
assert.equal(normalized[0].unit, 'Cái');

const row = productToCatalogRpcItem(normalized[0]);
assert.equal(row.id, 'p_1');
assert.equal(row.cost_price, 100000);
assert.equal(row.image_url, 'https://x/img.jpg');
assert.equal(row.raw_product.id, 'p_1');

const back = catalogRowToProduct({
  ...row,
  dealer_id: 'dealer',
  raw_product: row.raw_product,
});
assert.equal(back.id, 'p_1');
assert.equal(back.name, 'Công tắc 1 nút');
assert.equal(back.costPrice, 100000);
assert.equal(back.image, 'https://x/img.jpg');

const jsonA = serializeProductsForCatalog([normalized[0], normalized[1]]);
const jsonB = serializeProductsForCatalog([normalized[0], normalized[1]]);
assert.equal(jsonA, jsonB);
assert.ok(jsonA.includes('LM-S1'));

console.log('✓ Catalog store smoke passed');
