import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assessQuoteCommercialSafety, buildQuoteSnapshotRooms, quoteLineSalePrice } from '../src/quote/quoteCommercialSafety.js';
import { buildFinalQuoteGate } from '../src/quote/quoteLifecycle.js';

const product = { id: 'p', name: 'Công tắc', costPrice: 1_000_000, listPrice: 1_500_000, priceMode: 'markup' };
const fixed = { ...product, id: 'fixed', priceMode: 'fixed' };
function evaluate(p, line) {
  const rooms = [{ id: 'r', name: 'Công trình', lines: [{ id: 'l', productId: p.id, qty: 1, ...line }] }];
  const map = { [p.id]: p };
  const commercial = assessQuoteCommercialSafety({ rooms, productById: map });
  const frozen = buildQuoteSnapshotRooms(rooms, map);
  const gate = buildFinalQuoteGate({ commercialAssessment: commercial, customer: { name: 'Khách đã duyệt' }, vatPercent: 8, snapshotRooms: frozen });
  return { commercial, frozen, gate };
}
for (const factor of [1, 0.8]) {
  const { commercial, frozen, gate } = evaluate(product, { factor });
  assert.equal(gate.ready, true, `factor ${factor} must allow Final`);
  assert.equal(gate.blockerCount, 0);
  assert.equal(gate.warnings.length, 1);
  assert.equal(frozen[0].lines[0].salePriceSnapshot, factor * 1_000_000);
  assert.equal(commercial.negativeMarginCount, factor < 1 ? 1 : 0);
}
const discounted = evaluate(fixed, { factor: 1, manualSalePrice: 500_000 });
assert.equal(discounted.gate.ready, true, 'fixed price discount allowed');
assert.equal(discounted.frozen[0].lines[0].salePriceSnapshot, 500_000);
assert.equal(discounted.commercial.negativeMarginCount, 1);
assert.equal(quoteLineSalePrice(product, { factor: 1.2, manualSalePrice: 700_000 }), 700_000);
assert.equal(quoteLineSalePrice(product, { factor: 1.2, salePriceSnapshot: 900_000, manualSalePrice: 700_000 }), 900_000, 'Final snapshot must stay immutable');
const missingCost = evaluate({ ...product, costPrice: 0 }, { factor: 1.2 });
assert.equal(missingCost.gate.ready, false, 'unknown cost remains blocked');
const missingCustomer = buildFinalQuoteGate({ commercialAssessment: discounted.commercial, customer: {}, vatPercent: 8, snapshotRooms: discounted.frozen });
assert.equal(missingCustomer.ready, false, 'missing customer remains blocked');
const source = fs.readFileSync('src/SmartQuote.jsx', 'utf8');
assert(source.includes('await confirmCommercialWarnings("chốt báo giá")'), 'must confirm loss strategy before Final');
assert(source.includes('onSetSalePrice='), 'manual discount UI is required');
assert(source.includes('Cảnh báo: {selectedQuoteVariant.pricingNeedsReviewCount}'), 'BOM must only warn');
assert(!source.includes('|| (selectedQuoteVariant?.pricingNeedsReviewCount || 0) > 0}'), 'BOM must not disable create for margin');
console.log('✓ RC16.1.1 flexible selling price regression PASS');
