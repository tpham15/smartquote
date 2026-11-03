#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync('src/SmartQuote.jsx', 'utf8');
const lifecycle = readFileSync('src/quote/quoteLifecycle.js', 'utf8');
const pricing = readFileSync('src/quote/quoteCommercialSafety.js', 'utf8');
const quote = app.slice(app.indexOf('function QuoteBuilder('), app.indexOf('function SolutionFamilyApplyModal('));
const search = app.slice(app.indexOf('function QuickQuoteProductSearch('), app.indexOf('function ProductPicker('));

assert(quote.includes('sq-quote-workflow-head'), 'quote-first workflow header missing');
assert(quote.includes('advancedQuoteView'), 'progressive advanced controls missing');
assert(quote.includes('QuickQuoteProductSearch'), 'direct catalog search missing');
assert(search.includes('onPick(product.id)'), 'quick search must actually select the product');
assert(search.includes('onKeyDown'), 'quick search should support keyboard operation');
assert(quote.includes('addProductToRoom(room.id, pid)'), 'search selection must add to same room');
assert(quote.includes('QuoteSalePriceInput'), 'editable selling price missing');
assert(quote.includes('setLineManualSalePrice(room.id, l.id, value)'), 'inline selling price must call existing quote-only setter');
assert(quote.includes('manualSalePrice: value !== null'), 'line-specific manual sale price missing');
assert(quote.includes('salePriceSnapshot: undefined'), 'line sale snapshot must invalidate after price edit');
assert(!quote.includes('Tự động lưu'), 'never claim auto-save when server persistence is manual');
assert(quote.includes('Lưu nháp'), 'manual draft save must be available');
assert(quote.includes('(isFinalQuote || showQuoteReview) && <div className={`quote-final-gate'), 'completion gate should not dominate empty quote');
assert(quote.includes('setShowQuoteReview(true)'), 'review trigger must expose blockers');
assert(quote.includes('if (combinedFinalReady) finalizeCurrentQuote()'), 'review must preserve safe finalization path');
assert(quote.includes('confirmCommercialWarnings("chốt báo giá")'), 'manual at-or-below-cost acknowledgement must remain');
assert(quote.includes('finalizeCloudQuote(cloud.dealerId'), 'server-side final lifecycle must remain');
assert(quote.includes('requireFinalForExport("xuất PDF")'), 'PDF export must require Final');
assert(quote.includes('requireFinalForExport("xuất báo giá")'), 'Excel export must require Final');
assert(quote.includes('setRooms(defaultRooms())'), 'new quote reset must remain');
assert(quote.includes('quoteManageOpen &&'), 'previous quote manager must remain accessible');
assert(quote.includes('setEditingLine({ roomId: room.id, line: l })'), 'advanced line editor must remain accessible');
assert(lifecycle.includes('buildFinalQuoteGate'), 'commercial quote gate retained');
assert(pricing.includes('atOrBelowCostCount'), 'commercial below-cost signals retained');

console.log('✓ SmartQuote UX Quick Quote v1 smoke PASS');
console.log('  - first-class search, quantity and quote-only sale price');
console.log('  - progressive customer, section and quote-check controls');
console.log('  - existing Final, export, cloud and commercial gates retained');
