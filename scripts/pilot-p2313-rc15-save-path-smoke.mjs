import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyCommercialValidation } from '../src/import-engine/businessValidator.js';
import { applyAmbiguousPriceRole } from '../src/import-engine/priceRoleDecision.js';
import { sanitizeCatalogProducts, isUnsafeImportedProduct } from '../src/import-engine/productSanitizer.js';
import { annotateCatalogMatches, buildCatalogMatchIndex, resolveCatalogMatch, findDuplicateSkuGroups } from '../src/import-engine/productIdentity.js';
import { mergeCatalogImport, projectedCatalogCount } from '../src/import-engine/catalogImportMerge.js';

const root = process.cwd();
function walkJsFiles(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkJsFiles(full));
    else if (/\.(?:js|jsx|mjs)$/.test(ent.name)) out.push(full);
  }
  return out;
}
const issueCodes = (p) => (p?._meta?.issues || []).map((x) => String(x?.code || '').toLowerCase());
const mk = ({ id, sku='DL-12W-30', name='Đèn downlight 12W', supplier='', cost=0, list=0, price=cost, role='', source='column', ambiguous=true }={}) => ({
  ...(id ? { id } : {}), sku, name, supplier, unit:'Cái', costPrice:cost, price, listPrice:list, publicPrice:list,
  specs:'Công suất 12W', priceMode:list>0?'fixed':'markup',
  _meta:{
    ...(role ? { priceColumnRole:role, priceColumnConfirmed:true } : {}),
    issues: ambiguous ? [{code:'price_column_uncertain',level:'warning',message:'Cột Đơn giá chưa rõ vai trò'}] : [],
    source:{ rawText:`${sku} ${name} ${price||list}`, supplierSource:source },
  },
  source:{ rawText:`${sku} ${name} ${price||list}`, supplierSource:source },
});

function roleAndValidate(rows, role, catalog) {
  const sanitized0 = sanitizeCatalogProducts(rows);
  const matched0 = annotateCatalogMatches(sanitized0, catalog);
  const beforeRole = applyCommercialValidation(matched0, { existingProducts: catalog }).products;
  const roleApplied = applyAmbiguousPriceRole(beforeRole, role);
  const matched = annotateCatalogMatches(roleApplied, catalog);
  return applyCommercialValidation(matched, { existingProducts: catalog }).products;
}
function savePath(rows, role, catalog) {
  const preview = roleAndValidate(rows, role, catalog);
  const sanitized = sanitizeCatalogProducts(preview);
  const matched = annotateCatalogMatches(sanitized, catalog);
  const validated = applyCommercialValidation(matched, { existingProducts: catalog }).products;
  const safe = validated.filter((p) => !isUnsafeImportedProduct(p));
  return { preview: validated, safe, merge: mergeCatalogImport(catalog, safe, { idFactory: (_p,i)=>`new-${i}` }) };
}

// F1 — Final sales status must use the dedicated RPC, never a silent table UPDATE.
{
  const quoteStore = fs.readFileSync(path.join(root,'src/supabase/quoteStore.js'),'utf8');
  const smartQuote = fs.readFileSync(path.join(root,'src/SmartQuote.jsx'),'utf8');
  const sql = fs.readFileSync(path.join(root,'01_RUN_ON_SUPABASE.sql'),'utf8');
  assert.match(quoteStore,/rpc\(['"]set_quote_sales_status['"]/);
  assert.match(quoteStore,/data\.status[\s\S]{0,160}nextStatus/);
  assert.match(smartQuote,/setQuoteStatus\(previousStatus\)/, 'UI must roll back status after RPC failure');
  assert.match(sql,/create or replace function public\.set_quote_sales_status\(target_quote_id uuid, status_input text\)/i);
  assert.match(sql,/next_status not in \('draft','sent','won','lost'\)/i);
  assert.match(sql,/not public\.is_dealer_member\(target_dealer\)/i);
  assert.match(sql,/set status = next_status, updated_by = auth\.uid\(\), updated_at = now\(\)/i);
  assert.match(sql,/authenticated_status_rpc_should_be_true/);
  assert.match(sql,/anon_status_rpc_should_be_false/);

  const directQuoteUpdates = [];
  for (const file of walkJsFiles(path.join(root, 'src'))) {
    const source = fs.readFileSync(file, 'utf8');
    if (/\.from\(['"]quotes['"]\)[\s\S]{0,160}\.update\(/.test(source)) directQuoteUpdates.push(path.relative(root, file));
  }
  assert.deepEqual(directQuoteUpdates, [], `direct quotes UPDATE remains in src: ${directQuoteUpdates.join(', ')}`);
}

// F2-1/F2-2: list role compares against previous list, never previous cost.
{
  const catalog=[mk({id:'p1',cost:120000,ambiguous:false})];
  const out=savePath([mk({price:180000,cost:180000})],'list',catalog);
  assert.equal(out.safe.length,1);
  assert.ok(!issueCodes(out.preview[0]).some(c=>c.includes('price_change_')));
  assert.equal(out.merge.products.length,1);
  assert.equal(out.merge.products[0].costPrice,120000);
  assert.equal(out.merge.products[0].listPrice,180000);

  const out2=savePath([mk({price:250000,cost:250000})],'list',[mk({id:'p2',cost:100000,ambiguous:false})]);
  assert.equal(out2.safe.length,1);
  assert.ok(!issueCodes(out2.preview[0]).includes('pilot_business_price_change_extreme'));
}

// F2-3: existing list 200k -> incoming list 500k = hard list price change.
{
  const catalog=[mk({id:'p1',cost:100000,list:200000,ambiguous:false})];
  const out=roleAndValidate([mk({price:500000,cost:500000})],'list',catalog)[0];
  assert.ok(issueCodes(out).includes('pilot_business_list_price_change_extreme'));
  assert.equal(isUnsafeImportedProduct(out),true);
}

// F2-4: list below known cost is a warning; per-row approval may accept it.
{
  const catalog=[mk({id:'p1',cost:120000,ambiguous:false})];
  let out=roleAndValidate([mk({price:90000,cost:90000})],'list',catalog)[0];
  assert.ok(issueCodes(out).includes('pilot_business_list_below_existing_cost'));
  out={...out,_meta:{...out._meta,userApproved:true}};
  const after=applyCommercialValidation(annotateCatalogMatches(sanitizeCatalogProducts([out]),catalog),{existingProducts:catalog}).products[0];
  assert.equal(isUnsafeImportedProduct(after),false);
}

// F2-5/F2-6: cost behavior remains; switching roles recalculates without stale duplicates.
{
  const catalog=[mk({id:'p1',cost:120000,ambiguous:false})];
  let row=roleAndValidate([mk({price:180000,cost:180000})],'cost',catalog)[0];
  assert.ok(issueCodes(row).includes('pilot_business_price_change_outlier'));
  row=applyAmbiguousPriceRole([row],'list')[0];
  row=applyCommercialValidation(annotateCatalogMatches([row],catalog),{existingProducts:catalog}).products[0];
  assert.ok(!issueCodes(row).some(c=>c.includes('price_change_outlier')));
  row=applyAmbiguousPriceRole([row],'cost')[0];
  row=applyCommercialValidation(annotateCatalogMatches([row],catalog),{existingProducts:catalog}).products[0];
  assert.equal(issueCodes(row).filter(c=>c==='pilot_business_price_change_outlier').length,1);
  row=applyAmbiguousPriceRole([row],'list')[0];
  row=applyCommercialValidation(annotateCatalogMatches([row],catalog),{existingProducts:catalog}).products[0];
  assert.equal(issueCodes(row).filter(c=>c.startsWith('pilot_business_list_price_change_')).length,0);
}

// F3-1: supplier guessed from filename is weak. Preview says update and save stays one SKU.
{
  const catalog=[mk({id:'manual',supplier:'',cost:120000,ambiguous:false})];
  const incoming=mk({supplier:'den',cost:180000,price:180000,source:'file_name'});
  const match=resolveCatalogMatch(incoming,buildCatalogMatchIndex(catalog));
  assert.equal(match.kind,'update');
  const result=mergeCatalogImport(catalog,[incoming],{idFactory:()=> 'new'});
  assert.equal(result.products.length,1);
  assert.equal(result.products[0].supplier,'');
}

// F3-2: explicit conflicting supplier is ambiguous; user choice is honored.
{
  const catalog=[mk({id:'rd',supplier:'Rạng Đông',cost:100000,ambiguous:false})];
  const incoming=mk({supplier:'Duhal',cost:110000,price:110000,source:'column'});
  const annotated=annotateCatalogMatches([incoming],catalog)[0];
  assert.equal(annotated._meta.catalogMatch.kind,'ambiguous');
  const addNew={...annotated,_meta:{...annotated._meta,catalogMatchDecision:{kind:'new'}}};
  assert.equal(mergeCatalogImport(catalog,[addNew],{idFactory:()=> 'duhal'}).products.length,2);
  const update={...annotated,_meta:{...annotated._meta,catalogMatchDecision:{kind:'update',targetId:'rd'}}};
  assert.equal(mergeCatalogImport(catalog,[update],{idFactory:()=> 'x'}).products.length,1);
}

// F3-3: same SKU but visibly different product cannot auto-merge.
{
  const catalog=[mk({id:'p1',name:'Đèn downlight 12W',ambiguous:false})];
  const incoming=mk({name:'Đèn ray 10W',ambiguous:false});
  assert.equal(resolveCatalogMatch(incoming,buildCatalogMatchIndex(catalog)).kind,'ambiguous');
}

// F3-4: Roger-style reused FU codes import 0 -> 8, then re-import 8 -> 8.
{
  const catalog=Array.from({length:8},(_,i)=>mk({id:`fu${i}`,sku:'FU',name:`Đế inox FU${100+i}/R - cấu hình ${i+1}`,supplier:'Roger',cost:3000000+i*10000,ambiguous:false}));
  const firstIncoming=catalog.map(({id,...p})=>({...p,_meta:{...p._meta,source:{rawText:p.name,supplierSource:'column'}},source:{rawText:p.name,supplierSource:'column'}}));
  const first=mergeCatalogImport([],firstIncoming,{idFactory:(_p,i)=>`first-${i}`});
  assert.equal(first.products.length,8,'first Roger-style batch must preserve all reused supplier-code products');
  assert.equal(first.added,8);
  assert.equal(first.ambiguous,0);
  const incoming=catalog.map(({id,...p})=>({...p,_meta:{...p._meta,source:{rawText:p.name,supplierSource:'column'}},source:{rawText:p.name,supplierSource:'column'}}));
  const annotated=annotateCatalogMatches(incoming,catalog);
  assert.equal(annotated.filter(p=>p._meta.catalogMatch.kind==='ambiguous').length,0);
  const result=mergeCatalogImport(catalog,incoming,{idFactory:()=> 'new'});
  assert.equal(result.products.length,8);
  assert.equal(result.updated,8);
}

// F3-5: Bisco-style unique SKUs re-import 9 -> 9.
{
  const catalog=Array.from({length:9},(_,i)=>mk({id:`b${i}`,sku:`BISCO-${i}`,name:`Motor Bisco ${i}`,supplier:'Bisco',ambiguous:false}));
  const incoming=catalog.map(({id,...p})=>p);
  assert.equal(projectedCatalogCount(catalog,incoming),9);
}

// F3-6: no SKU, same name + same technical variant updates.
{
  const catalog=[mk({id:'n1',sku:'',name:'Driver LED 12W',cost:50000,ambiguous:false})];
  const incoming=mk({sku:'',name:'Driver LED 12W',cost:52000,price:52000,ambiguous:false});
  assert.equal(resolveCatalogMatch(incoming,buildCatalogMatchIndex(catalog)).kind,'update');
  assert.equal(mergeCatalogImport(catalog,[incoming]).products.length,1);
}

// Workflow-decision warnings cannot be bypassed by generic row approval/edit flags.
{
  const pricePending=mk({price:180000,cost:180000});
  pricePending._meta.userApproved=true;
  assert.equal(isUnsafeImportedProduct(pricePending),true,'price_column_uncertain must require file-level role confirmation');

  const catalog=[mk({id:'a',supplier:'Rạng Đông',ambiguous:false})];
  let conflict=annotateCatalogMatches([mk({supplier:'Duhal',source:'column',ambiguous:false})],catalog)[0];
  conflict={...conflict,_meta:{...conflict._meta,userEdited:true}};
  assert.equal(issueCodes(conflict).includes('catalog_match_ambiguous'),true);
  assert.equal(isUnsafeImportedProduct(conflict),true,'catalog ambiguity must require explicit Update/Add-new decision');
}

// F3-7 + legacy duplicate visibility: button/importable count is new+update,
// and old exact duplicate SKU+name groups are surfaced without flagging Roger-style reuse.
{
  const catalog=[
    mk({id:'u1',sku:'UP-1',name:'Sản phẩm cập nhật',cost:100000,ambiguous:false}),
    mk({id:'keep',sku:'KEEP-1',name:'Sản phẩm giữ nguyên',cost:50000,ambiguous:false}),
  ];
  const incoming=[
    mk({sku:'UP-1',name:'Sản phẩm cập nhật',cost:110000,price:110000,ambiguous:false}),
    mk({sku:'NEW-1',name:'Sản phẩm mới',cost:90000,price:90000,ambiguous:false}),
  ];
  const annotated=annotateCatalogMatches(incoming,catalog);
  assert.equal(annotated.filter(p=>p._meta.catalogMatch.kind==='update').length,1);
  assert.equal(annotated.filter(p=>p._meta.catalogMatch.kind==='new').length,1);
  const importable=annotated.filter(p=>!isUnsafeImportedProduct(p));
  const merged=mergeCatalogImport(catalog,importable,{idFactory:()=> 'new-1'});
  assert.equal(importable.length, merged.added + merged.updated, 'preview import count must equal actual add+update operations');
  assert.equal(projectedCatalogCount(catalog,importable), merged.products.length);

  const legacyDup=[
    mk({id:'d1',sku:'DUP-1',name:'Đèn A',ambiguous:false}),
    mk({id:'d2',sku:'DUP-1',name:'Đèn A',ambiguous:false}),
    mk({id:'r1',sku:'FU',name:'Đế FU103/R',supplier:'Roger',ambiguous:false}),
    mk({id:'r2',sku:'FU',name:'Đế FU105/R',supplier:'Roger',ambiguous:false}),
  ];
  const groups=findDuplicateSkuGroups(legacyDup);
  assert.equal(groups.length,1);
  assert.equal(groups[0].sku,'dup1');
}

// UI must expose an explicit decision for ambiguous catalog matches.
{
  const ui=fs.readFileSync(path.join(root,'src/SmartQuote.jsx'),'utf8');
  assert.match(ui,/Cập nhật \{p\._meta\.catalogMatch\.candidates/);
  assert.match(ui,/Thêm thành sản phẩm mới/);
  assert.match(ui,/catalog-duplicate-warning/);
}

// G1 regression: static fixed readFileSync(path.join(root,...)) targets must exist.
{
  const scriptsDir=path.join(root,'scripts');
  const missing=[];
  for (const name of fs.readdirSync(scriptsDir).filter(n=>n.endsWith('.mjs'))) {
    const source=fs.readFileSync(path.join(scriptsDir,name),'utf8');
    const re=/readFileSync\(path\.join\(root,\s*([^\)]*)\)/g;
    for (const m of source.matchAll(re)) {
      const args=m[1];
      const literals=[...args.matchAll(/['"]([^'"]+)['"]/g)].map(x=>x[1]);
      const residue=args.replace(/['"][^'"]+['"]/g,'').replace(/[\s,]/g,'');
      if (!literals.length || residue) continue;
      const target=path.join(root,...literals);
      if (!fs.existsSync(target)) missing.push(`${name}: ${path.relative(root,target)}`);
    }
  }
  assert.deepEqual(missing,[],`fixed smoke paths missing:\n${missing.join('\n')}`);
}

console.log('✓ P2.3.13 RC15 save-path smoke PASS');
console.log('  - Final sales status uses verified RPC');
console.log('  - list/cost price changes compare like-for-like and recalculate on role switch');
console.log('  - preview/count/save share resolveCatalogMatch; weak filename supplier does not duplicate SKU');
console.log('  - fixed smoke file paths resolve');
