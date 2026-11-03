import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyAmbiguousPriceRole } from '../src/import-engine/priceRoleDecision.js';
import { sanitizeCatalogProducts, isUnsafeImportedProduct } from '../src/import-engine/productSanitizer.js';
import { mergeImportedCatalogProduct } from '../src/import-engine/priceRoleMerge.js';

const mk = (i, price=180000, extraIssues=[]) => ({
  id:`i${i}`, sku:`SKU-${i}`, name:`Sản phẩm ${i}`, costPrice:price, price,
  listPrice:0, publicPrice:0, priceMode:'markup',
  _meta:{ status:'review', canonicalStatus:'need_review', source:{rawText:`${i} SKU-${i} Sản phẩm ${i} Cái ${price.toLocaleString('vi-VN')}`}, issues:[
    {code:'price_column_uncertain',level:'warning',message:'Chưa chắc cột Đơn giá'}, ...extraIssues
  ]}
});

// B1-1: choose list -> save path keeps cost blank.
let listRows = applyAmbiguousPriceRole([1,2,3,4,5].map(i=>mk(i)), 'list');
let clean = sanitizeCatalogProducts(listRows);
assert.equal(clean.length,5);
for (const [i,p] of clean.entries()) {
  assert.equal(p.costPrice,0,`B1-1 row ${i+1}: cost must remain 0`);
  assert.equal(p.listPrice,180000);
  assert.equal(p.publicPrice,180000);
  assert.equal(p.priceMode,'fixed');
  assert.equal(isUnsafeImportedProduct(p),false,`B1-1 row ${i+1} must import`);
  assert.equal(Boolean(p._meta?.acceptedAtPreview),false,'role choice must not approve row');
}

// B1-2: no rawText still must not invent cost or price_unreasonable.
const noRaw = mk(6); noRaw._meta.source={};
const noRawSaved = sanitizeCatalogProducts(applyAmbiguousPriceRole([noRaw],'list'))[0];
assert.equal(noRawSaved.costPrice,0);
assert.ok(!(noRawSaved._meta.issues||[]).some(x=>x.code==='price_unreasonable'));

// B1-3: existing cost survives list-price merge.
const mergedList = mergeImportedCatalogProduct({id:'old',sku:'SKU-1',name:'Old',costPrice:120000,listPrice:0,publicPrice:0,priceMode:'markup'}, clean[0]);
assert.equal(mergedList.costPrice,120000);
assert.equal(mergedList.listPrice,180000);
assert.equal(mergedList.publicPrice,180000);
assert.equal(mergedList.priceMode,'fixed');

// B1-4: cost role updates cost, leaves existing list untouched.
const costIncoming = sanitizeCatalogProducts(applyAmbiguousPriceRole([mk(7,150000)],'cost'))[0];
const mergedCost = mergeImportedCatalogProduct({id:'old2',sku:'SKU-7',name:'Old',costPrice:100000,listPrice:220000,publicPrice:220000,priceMode:'fixed'}, costIncoming);
assert.equal(mergedCost.costPrice,150000);
assert.equal(mergedCost.listPrice,220000);
assert.equal(mergedCost.publicPrice,220000);

// B1-5: list price 3bn is a hard list_price_unreasonable error, other rows survive.
const huge = mk(9,3_000_000_000); const ok = mk(10,180000);
const hugeSaved = sanitizeCatalogProducts(applyAmbiguousPriceRole([huge,ok],'list'));
assert.equal(isUnsafeImportedProduct(hugeSaved[0]),true);
assert.ok(hugeSaved[0]._meta.issues.some(x=>x.code==='list_price_unreasonable' && x.level==='error'));
assert.equal(isUnsafeImportedProduct(hugeSaved[1]),false);

// B1-6: list-only rows mean unknown cost, not at/below cost.
const unknownCostCount = clean.filter(p=>!(p.costPrice>0)).length;
const atOrBelowCostCount = clean.filter(p=>p.costPrice>0 && p.listPrice<=p.costPrice).length;
assert.equal(unknownCostCount,5);
assert.equal(atOrBelowCostCount,0);

// B2-1: role choice removes only price_column_uncertain and never sets acceptedAtPreview.
const costRows = applyAmbiguousPriceRole([mk(11)],'cost');
assert.ok(!costRows[0]._meta.issues.some(x=>x.code==='price_column_uncertain'));
assert.equal(Boolean(costRows[0]._meta.acceptedAtPreview),false);

// B2-2: scaled suspect must stay blocked and must never recover the unscaled raw token.
const scaled = mk(12,2_500_000_000,[
  {code:'price_scaled_from_header',level:'info',message:'×1000'},
  {code:'price_scale_suspect',level:'warning',message:'vượt 1 tỷ'},
]);
scaled._meta.source.rawText='12 SKU-12 Sản phẩm 12 2.500.000';
const scaledSaved = sanitizeCatalogProducts(applyAmbiguousPriceRole([scaled],'cost'))[0];
assert.equal(scaledSaved.costPrice,0);
assert.ok(scaledSaved._meta.issues.some(x=>x.code==='price_scale_suspect'));
assert.equal(isUnsafeImportedProduct(scaledSaved),true);
assert.notEqual(scaledSaved.costPrice,2_500_000);

// B2-4 generic name warning remains after role confirmation.
const generic = mk(13,180000,[{code:'generic_product_name',level:'warning',message:'Tên chung chung'}]);
const genericSaved = sanitizeCatalogProducts(applyAmbiguousPriceRole([generic],'list'))[0];
assert.ok(genericSaved._meta.issues.some(x=>x.code==='generic_product_name'));
assert.equal(isUnsafeImportedProduct(genericSaved),true);

// B2-6 any error remains hard even after per-row approval.
const errApproved = mk(14,180000,[{code:'duplicate_sku_in_import',level:'error',message:'Trùng SKU'}]);
errApproved._meta.userApproved=true;
const errSaved=sanitizeCatalogProducts([errApproved])[0];
assert.ok(errSaved._meta.issues.some(x=>x.code==='duplicate_sku_in_import'));
assert.equal(isUnsafeImportedProduct(errSaved),true);

// Static rule: helper modules may not self-approve rows. acceptedAtPreview=true belongs to UI row approval only.
const priceRoleSource=fs.readFileSync(new URL('../src/import-engine/priceRoleDecision.js',import.meta.url),'utf8');
assert.doesNotMatch(priceRoleSource,/acceptedAtPreview\s*:\s*true/);

console.log('✓ P2.3.12 RC14 price-role save-path smoke PASS');
console.log('  - list role preserves costPrice=0 through sanitizer and merge');
console.log('  - price-role confirmation removes only price_column_uncertain');
console.log('  - scaled suspect / errors remain blocking');
