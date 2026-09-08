#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { buildBomQuoteVariants, quoteVariantToRooms } from '../src/import-engine/bom/bomQuoteComposer.js';
import {
  assessQuoteCommercialSafety,
  buildQuoteSnapshotRooms,
  buildQuoteProductMap,
} from '../src/quote/quoteCommercialSafety.js';
import {
  QUOTE_LIFECYCLE_FINAL,
  buildFinalQuoteGate,
  buildQuoteWorkflow,
  buildRevisionRooms,
  normalizeQuoteWorkflow,
  snapshotQuoteCompany,
} from '../src/quote/quoteLifecycle.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultFixture = path.join(root, 'benchmarks', 'pilot-golden', 'commercial-scenarios.json');
const fixturePath = path.resolve(process.argv[2] || defaultFixture);
const bundle = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
assert.equal(bundle.schemaVersion, 'sq-pilot-commercial-golden-v1');
assert(Array.isArray(bundle.scenarios) && bundle.scenarios.length >= 5, 'P1.2 requires >=5 frozen commercial scenarios');
assert.equal(new Set(bundle.scenarios.map((x) => x.id)).size, bundle.scenarios.length, 'commercial golden scenario ids must be unique');

const round = (n) => Math.round(Number(n) || 0);
const report = { schemaVersion: 'sq-pilot-commercial-golden-report-v1', generatedAt: new Date().toISOString(), fixture: path.relative(root, fixturePath), scenarios: [] };

for (const scenario of bundle.scenarios) {
  const variants = buildBomQuoteVariants({
    bomPreview: scenario.bomPreview,
    products: scenario.products,
    resolutionMap: scenario.resolutionMap || {},
    ignoredMap: scenario.ignoredMap || {},
    packSelections: scenario.packSelections || {},
    grouping: scenario.grouping || 'scope',
    laborPercent: scenario.laborPercent || 0,
    completenessDecisions: scenario.completenessDecisions || {},
    defaultMarkupFactor: scenario.defaultMarkupFactor || 1,
  });
  const variant = variants.find((v) => v.id === (scenario.variantId || 'standard'));
  assert(variant, `${scenario.id}: standard variant missing`);

  if (scenario.expected?.unmatchedCount != null) assert.equal(variant.unmatchedCount, scenario.expected.unmatchedCount, `${scenario.id}: unmatchedCount`);
  if (scenario.expected?.pricingNeedsReviewCount != null) assert.equal(variant.pricingNeedsReviewCount, scenario.expected.pricingNeedsReviewCount, `${scenario.id}: pricingNeedsReviewCount`);
  if (scenario.expected?.completenessRequiredOpen != null) assert.equal(variant.completenessRequiredOpen, scenario.expected.completenessRequiredOpen, `${scenario.id}: completenessRequiredOpen`);

  const preQuoteBlock = variant.unmatchedCount > 0
    ? 'unmatched'
    : variant.completenessRequiredOpen > 0
      ? 'required_completeness'
      : variant.pricingNeedsReviewCount > 0
        ? 'pricing_review'
        : null;
  const shouldReachQuote = !preQuoteBlock;
  assert.equal(shouldReachQuote, Boolean(scenario.expected?.shouldReachQuote), `${scenario.id}: shouldReachQuote`);
  if (!shouldReachQuote) {
    assert.equal(preQuoteBlock, scenario.expected?.blockReason, `${scenario.id}: blockReason`);
    report.scenarios.push({ id: scenario.id, pass: true, stage: 'pre_quote_block', blockReason: preQuoteBlock });
    continue;
  }

  for (const key of ['deviceTotal','costTotal','laborTotal','grandTotal','marginPercent']) {
    if (scenario.expected?.[key] != null) assert.equal(round(variant[key]), round(scenario.expected[key]), `${scenario.id}: ${key}`);
  }

  const rooms = quoteVariantToRooms(variant, (kind) => `${scenario.id}-${kind}-${Math.random().toString(36).slice(2,7)}`);
  const liveCatalog = Object.fromEntries((scenario.products || []).map((p) => [p.id, p]));
  const productMap = buildQuoteProductMap(liveCatalog, rooms);
  const commercial = assessQuoteCommercialSafety({ rooms, productById: productMap });
  const snapshotRooms = buildQuoteSnapshotRooms(rooms, productMap);
  const frozenProductMap = buildQuoteProductMap(liveCatalog, snapshotRooms);
  const frozenCommercial = assessQuoteCommercialSafety({ rooms: snapshotRooms, productById: frozenProductMap });
  const gate = buildFinalQuoteGate({
    commercialAssessment: frozenCommercial,
    customer: scenario.customer || {},
    vatPercent: scenario.vatPercent,
    snapshotRooms,
  });
  assert.equal(gate.ready, Boolean(scenario.expected?.shouldFinalize), `${scenario.id}: Final gate readiness`);
  if (scenario.expected?.finalBlocker) assert(gate.blockers.some((x) => x.id === scenario.expected.finalBlocker), `${scenario.id}: expected blocker ${scenario.expected.finalBlocker}`);
  if (scenario.expected?.atOrBelowCostCount != null) assert.equal(commercial.atOrBelowCostCount, scenario.expected.atOrBelowCostCount, `${scenario.id}: atOrBelowCostCount`);
  if (scenario.expected?.negativeMarginCount != null) assert.equal(commercial.negativeMarginCount, scenario.expected.negativeMarginCount, `${scenario.id}: negativeMarginCount`);

  if (!gate.ready) {
    report.scenarios.push({ id: scenario.id, pass: true, stage: 'final_block', blockers: gate.blockers.map((x) => x.id) });
    continue;
  }

  const companySnapshot = snapshotQuoteCompany({ name: 'Golden Company', laborPercent: scenario.laborPercent || 0, vatPercent: scenario.vatPercent });
  const workflow = buildQuoteWorkflow({ lifecycle: QUOTE_LIFECYCLE_FINAL, revision: 1, companySnapshot, finalizedAt: '2026-09-07T00:00:00.000Z' });
  assert.equal(normalizeQuoteWorkflow({ workflow }, 'draft').lifecycle, QUOTE_LIFECYCLE_FINAL, `${scenario.id}: workflow must remain Final`);

  if (scenario.expected?.snapshotSaleTotal != null) assert.equal(round(frozenCommercial.saleTotal), round(scenario.expected.snapshotSaleTotal), `${scenario.id}: snapshotSaleTotal`);
  if (scenario.expected?.snapshotCostTotal != null) assert.equal(round(frozenCommercial.knownCostTotal), round(scenario.expected.snapshotCostTotal), `${scenario.id}: snapshotCostTotal`);

  if (scenario.mutatedCatalog) {
    const reopenedMap = buildQuoteProductMap(scenario.mutatedCatalog, snapshotRooms);
    const reopened = assessQuoteCommercialSafety({ rooms: snapshotRooms, productById: reopenedMap });
    assert.equal(round(reopened.saleTotal), round(frozenCommercial.saleTotal), `${scenario.id}: Final sale total changed after catalog repricing`);
    assert.equal(round(reopened.knownCostTotal), round(frozenCommercial.knownCostTotal), `${scenario.id}: Final cost changed after catalog repricing`);

    const revisionRooms = buildRevisionRooms(snapshotRooms, scenario.mutatedCatalog, scenario.defaultMarkupFactor || 1);
    const revisionMap = buildQuoteProductMap(scenario.mutatedCatalog, revisionRooms);
    const revisionCommercial = assessQuoteCommercialSafety({ rooms: revisionRooms, productById: revisionMap });
    if (scenario.expected?.revisionSaleTotal != null) assert.equal(round(revisionCommercial.saleTotal), round(scenario.expected.revisionSaleTotal), `${scenario.id}: revisionSaleTotal`);
  }

  report.scenarios.push({ id: scenario.id, pass: true, stage: 'final', saleTotal: frozenCommercial.saleTotal, costTotal: frozenCommercial.knownCostTotal, blockers: [] });
}

assert(report.scenarios.every((x) => x.pass), 'commercial golden report contains failures');
if (process.env.SQ_PILOT_GOLDEN_REPORT) {
  const out = path.resolve(process.env.SQ_PILOT_GOLDEN_REPORT);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
}
console.log(`✓ Pilot P1.2 Commercial Golden smoke PASS — ${report.scenarios.length} scenarios`);
console.log('  - resolved BOM -> pricing -> snapshot -> Final -> reopen -> revision');
console.log('  - unmatched / x1 markup / required completeness block before quote');
console.log('  - below-cost Draft is blocked by Final Quote Gate');
