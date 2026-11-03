import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(String(k), String(v)); }
  removeItem(k) { this.map.delete(String(k)); }
  key(i) { return [...this.map.keys()][i] ?? null; }
  get length() { return this.map.size; }
}

globalThis.localStorage = new MemoryStorage();
globalThis.window = {};

const tenant = await import('../src/storage/tenantStorage.js');
const learning = await import(`../src/learning/quoteLearning.js?smoke=${Date.now()}`);

tenant.setTenantStorageScope('dealer-a');
learning.clearQuoteLearning();

function finalRooms({ sale = 1500000, cost = 1000000, supplier = 'Supplier A', name = 'Downlight 12W 3000K', sku = 'DL12', origin = 'Italia' } = {}) {
  return [{
    id: 'r1', name: 'Chiếu sáng tầng 1', lines: [{
      id: 'l1', productId: 'p1', qty: 2,
      salePriceSnapshot: sale, costPriceSnapshot: cost,
      productSnapshot: { id: 'p1', name, sku, supplier, brand: 'Brand A', origin, category: 'Downlight', unit: 'Cái', specs: '12W 3000K' },
    }],
  }];
}

// 1) One Final quote = observe only.
let obs = learning.buildFinalQuoteLearningObservations({ quoteId: 'q1', revision: 1, rooms: finalRooms(), customer: { category: 'Nhà thầu', project: 'Villa A' }, finalizedAt: '2026-10-01T00:00:00Z', industryId: 'lighting' });
assert.equal(obs.length, 1);
assert.equal(obs[0].product.origin, 'Italia');
assert.equal(obs[0].salePrice, 1500000);
assert.equal(Math.round(obs[0].marginPct * 10) / 10, 33.3);
assert.equal(learning.recordQuoteLearningObservations(obs).added, 1);
let insight = learning.getQuoteLearningInsight({ sku: 'DL12', supplier: 'Supplier A', brand: 'Brand A', name: 'anything' });
assert.equal(insight.quoteCount, 1);
assert.equal(insight.confidenceTier, 'observe');

// Duplicate observation is idempotent.
assert.equal(learning.recordQuoteLearningObservations(obs).added, 0);
assert.equal(learning.getQuoteLearningInsight({ sku: 'DL12', supplier: 'Supplier A', brand: 'Brand A' }).quoteCount, 1);

// 2) 3 Final quotes = suggest, not auto-apply.
for (let i = 2; i <= 3; i++) {
  const rows = learning.buildFinalQuoteLearningObservations({ quoteId: `q${i}`, revision: 1, rooms: finalRooms({ sale: 1500000 + i * 100000 }), finalizedAt: `2026-10-0${i}T00:00:00Z`, industryId: 'lighting' });
  learning.recordQuoteLearningObservations(rows);
}
insight = learning.getQuoteLearningInsight({ sku: 'DL12', supplier: 'Supplier A', brand: 'Brand A' });
assert.equal(insight.quoteCount, 3);
assert.equal(insight.confidenceTier, 'suggest');
let applied = learning.applyQuoteIdentityLearning([{ sku: 'DL12', supplier: 'Supplier A', brand: 'Brand A', name: 'DL12', costPrice: 999 }]);
assert.equal(applied.hits, 0, 'suggest tier must not mutate identity');
assert.equal(applied.suggestions, 1);
assert.equal(applied.products[0].name, 'DL12');
assert.equal(applied.products[0].costPrice, 999, 'learning must never touch current prices');

// 3) 5 Final quotes = trusted identity, still no price auto-apply.
for (let i = 4; i <= 5; i++) {
  const rows = learning.buildFinalQuoteLearningObservations({ quoteId: `q${i}`, revision: 1, rooms: finalRooms({ sale: 1700000 + i * 50000 }), finalizedAt: `2026-10-0${i}T00:00:00Z`, industryId: 'lighting' });
  learning.recordQuoteLearningObservations(rows);
}
insight = learning.getQuoteLearningInsight({ sku: 'DL12', supplier: 'Supplier A', brand: 'Brand A' });
assert.equal(insight.quoteCount, 5);
assert.equal(insight.confidenceTier, 'trusted');
applied = learning.applyQuoteIdentityLearning([{ sku: 'DL12', supplier: 'Supplier A', brand: 'Brand A', name: 'DL12', category: '', unit: '', costPrice: 999, listPrice: 1111 }]);
assert.equal(applied.hits, 1);
assert.equal(applied.products[0].name, 'Downlight 12W 3000K');
assert.equal(applied.products[0].category, 'Downlight');
assert.equal(applied.products[0].origin, 'Italia');
assert.equal(applied.products[0].costPrice, 999, 'trusted memory must not overwrite price');
assert.equal(applied.products[0].listPrice, 1111, 'trusted memory must not overwrite list price');

// 4) Same SKU, different supplier is isolated.
const otherObs = learning.buildFinalQuoteLearningObservations({ quoteId: 'qb1', rooms: finalRooms({ supplier: 'Supplier B', name: 'Smart Lock DL12' }), finalizedAt: '2026-10-10T00:00:00Z', industryId: 'smarthome' });
learning.recordQuoteLearningObservations(otherObs);
const otherInsight = learning.getQuoteLearningInsight({ sku: 'DL12', supplier: 'Supplier B', brand: 'Brand A' });
assert.equal(otherInsight.quoteCount, 1);
assert.equal(learning.getQuoteLearningInsight({ sku: 'DL12', supplier: 'Supplier A', brand: 'Brand A' }).quoteCount, 5);

// 5) Tenant isolation.
tenant.setTenantStorageScope('dealer-b');
assert.equal(learning.listQuoteLearningStats().finalQuotes, 0);
tenant.setTenantStorageScope('dealer-a');
assert.equal(learning.listQuoteLearningStats().finalQuotes, 6);

// 6) SQL safety contract + Final quote guard.
const sql = fs.readFileSync(path.join(root, 'supabase/phase20_quote_learning.sql'), 'utf8');
assert.match(sql, /create table if not exists public\.quote_learning_observations/i);
assert.match(sql, /revoke all on public\.quote_learning_observations from anon, authenticated/i);
assert.match(sql, /grant select on public\.quote_learning_observations to authenticated/i);
assert.match(sql, /lower\(coalesce\(quote_calc->'workflow'->>'lifecycle', 'draft'\)\) <> 'final'/i);
assert.match(sql, /revoke all on function public\.record_quote_learning_observations\(uuid, uuid, jsonb\) from public, anon/i);
assert.match(sql, /grant execute on function public\.record_quote_learning_observations\(uuid, uuid, jsonb\) to authenticated/i);

// 7) UI integration: Finalization records learning and cloud sync is non-blocking.
const app = fs.readFileSync(path.join(root, 'src/SmartQuote.jsx'), 'utf8');
assert.match(app, /buildFinalQuoteLearningObservations\(/);
assert.match(app, /recordQuoteLearningObservations\(observations\)/);
assert.match(app, /recordCloudQuoteLearning\(cloud\.dealerId, savedId, observations\)/);
// RC16 note: the import learning step moved into import-engine/catalogImportPipeline.js
// (applyImportLearning), which the importer calls via applyLearningIfAllowed.
const importPipeline = fs.readFileSync(path.join(root, 'src/import-engine/catalogImportPipeline.js'), 'utf8');
assert.match(importPipeline, /applyQuoteIdentityLearning\(corrected\.products/);
assert.match(app, /return applyImportLearning\(items, meta\)/);
assert.match(app, /SmartQuote Learning/);

console.log('✓ P2.0 Final Quote Learning Memory regression PASS');
