import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildBomQuoteVariants, quoteVariantToRooms } from '../src/import-engine/bom/bomQuoteComposer.js';
import {
  chooseDefaultMarkupFactor,
  quoteLineSalePrice,
  buildQuoteSnapshotRooms,
  buildQuoteProductMap,
  assessQuoteCommercialSafety,
} from '../src/quote/quoteCommercialSafety.js';

const markupProduct = {
  id: 'p-cost', name: 'Thiết bị cost-only', sku: 'COST-1', unit: 'Cái',
  costPrice: 1_000_000, priceMode: 'markup', supplier: 'Pilot Supplier',
};
const fixedProduct = {
  id: 'p-fixed', name: 'Thiết bị fixed', sku: 'FIX-1', unit: 'Cái',
  costPrice: 1_000_000, listPrice: 1_500_000, publicPrice: 1_500_000, priceMode: 'fixed',
};
const bomPreview = {
  fileName: 'pilot.xlsx',
  lines: [{
    id: 'l1', name: 'Thiết bị cost-only', model: 'COST-1', qty: 2, unit: 'Cái',
    scopeId: 'scope_main', solutionKey: 'camera_security', solutionLabel: 'Camera',
    matchSuggestions: [{ productId: 'p-cost', score: 0.99 }],
  }],
  scopes: [{ id: 'scope_main', label: 'Camera' }],
  solutionPacks: [],
};

assert.equal(chooseDefaultMarkupFactor([{ value: 1 }, { value: 1.2 }]), 1.2, 'prefer configured >1 markup');
assert.equal(chooseDefaultMarkupFactor([{ value: 1 }]), 1, 'do not invent markup when company has not configured one');

const unsafeVariants = buildBomQuoteVariants({
  bomPreview,
  products: [markupProduct],
  resolutionMap: { l1: 'p-cost' },
  defaultMarkupFactor: 1,
});
const unsafeStandard = unsafeVariants.find((v) => v.id === 'standard');
assert.equal(unsafeStandard.pricingNeedsReviewCount, 1, 'cost-only x1 must be pricing-review blocked');
assert.equal(unsafeStandard.deviceTotal, 2_000_000, 'x1 draft total should remain transparent, not silently inflated');

const safeVariants = buildBomQuoteVariants({
  bomPreview,
  products: [markupProduct],
  resolutionMap: { l1: 'p-cost' },
  defaultMarkupFactor: 1.2,
});
const safeStandard = safeVariants.find((v) => v.id === 'standard');
assert.equal(safeStandard.pricingNeedsReviewCount, 0, 'configured markup >1 clears pricing review');
assert.equal(safeStandard.deviceTotal, 2_400_000, 'BOM total must use configured markup');
assert.equal(safeStandard.costTotal, 2_000_000, 'BOM cost stays true cost');
assert.equal(safeStandard.grossProfit, 400_000, 'BOM gross profit must not be clamped/miscomputed');
assert.equal(safeStandard.marginPercent, 17, 'BOM margin should reflect sale vs true cost');
const safeRooms = quoteVariantToRooms(safeStandard, (kind) => `${kind}-id`);
assert.equal(safeRooms[0].lines[0].factor, 1.2, 'BOM -> Quote must preserve configured factor');
assert.equal(quoteLineSalePrice(markupProduct, safeRooms[0].lines[0]), 1_200_000, 'QuoteBuilder price must match BOM composer price');

const fixedAssessment = assessQuoteCommercialSafety({
  rooms: [{ id: 'r', name: 'R', lines: [{ id: 'x', productId: 'p-fixed', qty: 1, factor: 1 }] }],
  productById: { 'p-fixed': fixedProduct },
});
assert.equal(Math.round(fixedAssessment.grossMarginPct), 33, 'fixed product margin must use costPrice, not listPrice as cost');
assert.equal(fixedAssessment.atOrBelowCostCount, 0);

const lossAssessment = assessQuoteCommercialSafety({
  rooms: [{ id: 'r', name: 'R', lines: [{ id: 'x', productId: 'p-cost', qty: 1, factor: 0.8 }] }],
  productById: { 'p-cost': markupProduct },
});
assert(lossAssessment.grossMarginPct < 0, 'negative margin must remain visible, never clamp to zero');
assert.equal(lossAssessment.negativeMarginCount, 1);

const originalRooms = [{ id: 'r1', name: 'Phòng', lines: [{ id: 'ln1', productId: 'p-cost', qty: 2, factor: 1.2, note: 'pilot' }] }];
const snapRooms = buildQuoteSnapshotRooms(originalRooms, { 'p-cost': markupProduct });
assert.equal(snapRooms[0].lines[0].salePriceSnapshot, 1_200_000);
assert.equal(snapRooms[0].lines[0].costPriceSnapshot, 1_000_000);
assert.equal(snapRooms[0].lines[0].productSnapshot.sku, 'COST-1');

const changedCatalog = { 'p-cost': { ...markupProduct, name: 'CHANGED', costPrice: 2_000_000 } };
const hydrated = buildQuoteProductMap(changedCatalog, snapRooms);
assert.equal(hydrated['p-cost'].name, 'Thiết bị cost-only', 'saved product snapshot must win over changed catalog');
assert.equal(quoteLineSalePrice(hydrated['p-cost'], snapRooms[0].lines[0]), 1_200_000, 'saved sale price must remain immutable after catalog repricing');
const reopenedAssessment = assessQuoteCommercialSafety({ rooms: snapRooms, productById: hydrated });
assert.equal(Math.round(reopenedAssessment.grossMarginPct), 17, 'saved margin must remain based on frozen cost/sale snapshot');

const src = fs.readFileSync(new URL('../src/SmartQuote.jsx', import.meta.url), 'utf8');
assert(src.includes('unresolvedCore.length > 0'), 'BOM unresolved core gate missing');
assert(src.includes('completenessGate.counts.required > 0'), 'required completeness decision gate missing');
assert(src.includes('selected?.pricingNeedsReviewCount > 0'), 'BOM commercial pricing gate missing');
assert(src.includes('buildQuoteSnapshotRooms(rooms, productById)'), 'cloud quote snapshot persistence missing');
assert(src.includes('requireFinalForExport("xuất báo giá")'), 'Excel export Final Quote gate missing');
assert(src.includes('requireFinalForExport("xuất PDF")'), 'PDF export Final Quote gate missing');
assert(src.includes('disabled={unmappedCols.length > 0}'), 'matrix takeoff must not silently drop unmapped priced columns');
assert(src.includes('unresolvedForQuote.length > 0'), 'legacy KTS/AIReader must not silently drop unresolved rows');
assert(src.includes('Bộ giải pháp chưa đầy đủ'), 'solution-family partial quote must require explicit confirmation');
assert(src.includes('factor: p?.priceMode === "fixed" ? 1 : defaultMarkupFactor'), 'legacy KTS quote lines must carry pricing factor');
assert(!src.includes('<span>Serper API Key</span>'), 'production UI must not ask user for Serper secret');
assert(!src.includes('fetch("https://google.serper.dev/images"'), 'browser must not call Serper directly');

const enrichApi = fs.readFileSync(new URL('../api/product-enrich.js', import.meta.url), 'utf8');
assert(!enrichApi.includes('body.serperApiKey'), 'server must not accept Serper provider secret from browser payload');
assert(enrichApi.includes('process.env.SERPER_API_KEY'), 'server-side Serper env path missing');

console.log('✓ SmartQuote Pilot P0 Commercial Safety smoke PASS');
console.log('  - BOM cost-only x1 is review-blocked; configured markup flows into quote');
console.log('  - fixed/markup margin uses true cost and negative margin stays visible');
console.log('  - saved quote freezes product, cost and unit sale price snapshots');
console.log('  - unresolved BOM / required completeness / matrix unmapped gates present');
console.log('  - Serper provider secret is server-side only');
