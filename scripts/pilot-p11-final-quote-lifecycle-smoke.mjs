import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  QUOTE_LIFECYCLE_DRAFT,
  QUOTE_LIFECYCLE_FINAL,
  normalizeQuoteWorkflow,
  buildQuoteWorkflow,
  makeQuoteNumber,
  buildFinalQuoteGate,
  buildRevisionRooms,
  snapshotQuoteCompany,
} from '../src/quote/quoteLifecycle.js';
import {
  assessQuoteCommercialSafety,
  buildQuoteSnapshotRooms,
  buildQuoteProductMap,
} from '../src/quote/quoteCommercialSafety.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(root, 'src', 'SmartQuote.jsx'), 'utf8');
const quoteStore = fs.readFileSync(path.join(root, 'src', 'supabase', 'quoteStore.js'), 'utf8');

const product = {
  id: 'p1',
  name: 'Thiết bị A',
  sku: 'SKU-A',
  unit: 'Cái',
  costPrice: 1_000_000,
  listPrice: 1_500_000,
  priceMode: 'fixed',
};
const catalog = { p1: product };
const rooms = [{ id: 'r1', name: 'Tầng 1', lines: [{ id: 'l1', productId: 'p1', qty: 2, factor: 1, note: '' }] }];
const productMap = buildQuoteProductMap(catalog, rooms);
const commercial = assessQuoteCommercialSafety({ rooms, productById: productMap });
const frozen = buildQuoteSnapshotRooms(rooms, productMap);

const ready = buildFinalQuoteGate({
  commercialAssessment: commercial,
  customer: { name: 'Khách A' },
  vatPercent: 8,
  snapshotRooms: frozen,
});
assert.equal(ready.ready, true, `safe quote must pass Final gate: ${ready.blockers.map((x) => x.id).join(',')}`);
assert.equal(ready.blockerCount, 0);
assert.equal(ready.frozenLineCount, 1);

const missingCustomer = buildFinalQuoteGate({ commercialAssessment: commercial, customer: {}, vatPercent: 8, snapshotRooms: frozen });
assert.equal(missingCustomer.ready, false);
assert(missingCustomer.blockers.some((x) => x.id === 'customer'));

const noCostProduct = { ...product, costPrice: 0 };
const noCostRooms = [{ id: 'r2', name: 'R2', lines: [{ id: 'l2', productId: 'p2', qty: 1, factor: 1 }] }];
const noCostMap = { p2: { ...noCostProduct, id: 'p2' } };
const noCostCommercial = assessQuoteCommercialSafety({ rooms: noCostRooms, productById: noCostMap });
const noCostFrozen = buildQuoteSnapshotRooms(noCostRooms, noCostMap);
const noCostGate = buildFinalQuoteGate({ commercialAssessment: noCostCommercial, customer: { name: 'K' }, vatPercent: 8, snapshotRooms: noCostFrozen });
assert.equal(noCostGate.ready, false);
assert(noCostGate.blockers.some((x) => x.id === 'cost'), 'unknown cost must block Final');
assert(noCostGate.blockers.some((x) => x.id === 'snapshot'), 'incomplete frozen cost snapshot must block Final');

const zeroMarginProduct = { ...product, listPrice: 1_000_000 };
const zeroRooms = [{ id: 'r3', name: 'R3', lines: [{ id: 'l3', productId: 'p3', qty: 1, factor: 1 }] }];
const zeroMap = { p3: { ...zeroMarginProduct, id: 'p3' } };
const zeroCommercial = assessQuoteCommercialSafety({ rooms: zeroRooms, productById: zeroMap });
const zeroFrozen = buildQuoteSnapshotRooms(zeroRooms, zeroMap);
const zeroGate = buildFinalQuoteGate({ commercialAssessment: zeroCommercial, customer: { name: 'K' }, vatPercent: 8, snapshotRooms: zeroFrozen });
assert.equal(zeroGate.ready, false);
assert(zeroGate.blockers.some((x) => x.id === 'margin'), 'at/below cost must block Final');

assert.equal(normalizeQuoteWorkflow({}, 'sent').lifecycle, QUOTE_LIFECYCLE_DRAFT, 'legacy sent quote must require explicit new Final gate');
const wf = buildQuoteWorkflow({ lifecycle: QUOTE_LIFECYCLE_FINAL, revision: 3, parentQuoteId: 'q2', rootQuoteId: 'q1', finalizedAt: '2026-09-06T10:00:00.000Z' });
const normalized = normalizeQuoteWorkflow({ workflow: wf }, 'draft');
assert.equal(normalized.lifecycle, QUOTE_LIFECYCLE_FINAL);
assert.equal(normalized.revision, 3);
assert.equal(normalized.parentQuoteId, 'q2');
assert.equal(normalized.rootQuoteId, 'q1');


const companySnap = snapshotQuoteCompany({ name: 'Demo Co', laborPercent: 10, vatPercent: 8, secret: 'never-copy' });
assert.deepEqual(companySnap, { name: 'Demo Co', laborPercent: 10, vatPercent: 8 });
const wfCompany = buildQuoteWorkflow({ lifecycle: QUOTE_LIFECYCLE_FINAL, revision: 1, companySnapshot: companySnap, finalizedAt: '2026-09-06T10:00:00.000Z' });
assert.equal(normalizeQuoteWorkflow({ workflow: wfCompany }, 'draft').companySnapshot.laborPercent, 10, 'Final must preserve labor percent snapshot');

const quoteNo = makeQuoteNumber(new Date('2026-09-06T10:11:12Z'));
assert.match(quoteNo, /^SQ-20260906-\d{6}$/);

const revisionRooms = buildRevisionRooms(frozen, catalog, 1.2);
assert.equal(revisionRooms[0].lines[0].productSnapshot, undefined, 'live catalog product should rebase revision to live catalog');
assert.equal(revisionRooms[0].lines[0].salePriceSnapshot, undefined);
assert.equal(revisionRooms[0].lines[0].costPriceSnapshot, undefined);
const orphanRevision = buildRevisionRooms(frozen, {}, 1.2);
assert(orphanRevision[0].lines[0].productSnapshot, 'missing live product must preserve frozen snapshot for explicit replacement');

// Static workflow guarantees in the React surface.
for (const needle of [
  'const finalizeCurrentQuote = async () => {',
  'const createRevisionFromFinal = async () => {',
  'const requireFinalForExport = (label = "xuất báo giá") => {',
  'buildFinalQuoteGate({',
  'Final & khóa báo giá',
  'Tạo Rev {quoteRevision + 1}',
  'Báo giá Final đã khóa nội dung',
  'function QuoteListPanel(',
  'disabled={isFinalQuote}',
  'effectiveQuoteCompany?.laborPercent',
  'snapshotQuoteCompany(company)',
]) assert(app.includes(needle), `missing P1.1 surface guarantee: ${needle}`);

assert(app.indexOf('if (!requireFinalForExport("xuất báo giá")) return;') < app.indexOf('await exportQuoteExcel'), 'Excel export must be Final-gated before export implementation');
assert(app.indexOf('if (!requireFinalForExport("xuất PDF")) return;') < app.indexOf('buildQuotePrintHTML({'), 'PDF export must be Final-gated before print HTML generation');
assert(!app.includes('<QuoteListPanel') || app.includes('function QuoteListPanel('), 'cloud quote list component must be defined');
assert(quoteStore.includes('calc,'), 'quoteStore must persist calc JSON containing lifecycle workflow');
assert(quoteStore.includes('rooms, customer, calc'), 'quoteStore list/load must retrieve lifecycle calc JSON');

console.log('✓ Pilot P1.1 Final Quote Lifecycle smoke PASS');
console.log('  - Final gate blocks missing customer/cost/zero-margin');
console.log('  - Final snapshot is required before Ready to send');
console.log('  - legacy sent/won quote is not silently treated as immutable Final');
console.log('  - revision rebases live catalog while preserving orphan snapshots');
console.log('  - Excel/PDF export requires Final');
console.log('  - cloud quote list component exists');
console.log('  - company commercial settings (labor %) are frozen with Final');
