import assert from 'node:assert/strict';
import { rowToItem } from '../src/import-engine/extractItems.js';

function make(description, alias) {
  const text = ['1', description, alias, 'Italia', 'bộ', '1', '24900000', '24900000', ''];
  const row = { r: 18, text, cells: text.map((v,i)=>({ref:`${String.fromCharCode(65+i)}19`,v})), joined: text.filter(Boolean).join(' | ') };
  const map = { specs:1, sku:2, supplier:3, unit:4, quantity:5, price:6, lineTotal:7, _quoteTable:true, _priceSourceLabel:'Đơn Giá', _nameSourceCols:[1], _deriveNameFromSku:true, _nameWeak:true };
  return rowToItem(row, map, 'VUCAN - 24V', 'ĐỘNG CƠ CỔNG TỰ ĐỘNG', '');
}

const vulcan = make('Cổng xoay tự động âm sàn V2 - VULCAN 24V\nModel : 29G020\nThông số kỹ thuật\nĐộng cơ điện 24V AC', 'Vulcan - 24V (29G020)');
assert.equal(vulcan.sku, '29G020');
assert.equal(vulcan.name, 'Cổng xoay tự động âm sàn V2 - VULCAN 24V');
assert.equal(vulcan.source.rawSku, 'Vulcan - 24V (29G020)');

const ayros = make('MÔ TƠ CỔNG TRƯỢT V2 - AYROS - 1000D\nModel : 30C-074\nThông số kỹ thuật\nĐộng cơ 24V AC', 'AYROS 1000D (30C074)');
assert.equal(ayros.sku, '30C-074');
assert.equal(ayros.name, 'MÔ TƠ CỔNG TRƯỢT V2 - AYROS - 1000D');

const nyk = make('Mô tơ cổng Mở xoay tự động NYK - 24V\nModel : 29H001\nThông số kỹ thuật\nĐộng cơ điện 24V AC', 'NYK - 24V');
assert.equal(nyk.sku, '29H001');
assert.equal(nyk.name, 'Mô tơ cổng Mở xoay tự động NYK - 24V');

const star = make('Mô tơ cổng Mở xoay tự động STAR K3 - 24V\nModel : 29H003\nThông số kỹ thuật\nĐộng cơ điện 24V AC', 'STAR K3- 24V');
assert.equal(star.sku, '29H003');
assert.equal(star.name, 'Mô tơ cổng Mở xoay tự động STAR K3 - 24V');

console.log('✓ P2.3.6 RC7 source alias preservation regression PASS');
console.log('  - bracketed canonical codes survive pseudo-SKU filtering');
console.log('  - commercial names remain source-authoritative');
