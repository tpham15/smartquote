import fs from 'node:fs';
import assert from 'node:assert/strict';
import { normalizeQuoteRecord } from '../src/supabase/quoteStore.js';
import { canUseFeature } from '../src/billing/planLimits.js';

const sql = fs.readFileSync('supabase/phase4_quotes.sql', 'utf8');
assert.match(sql, /create table if not exists public\.quotes/i, 'quotes table SQL missing');
assert.match(sql, /create table if not exists public\.customers/i, 'customers table SQL missing');
assert.match(sql, /create or replace function public\.save_quote/i, 'save_quote RPC missing');
assert.match(sql, /event_type = 'quotes_per_month'/i, 'quote quota usage event missing');
assert.match(sql, /grant execute on function public\.save_quote\(jsonb\) to authenticated/i, 'save_quote grant missing');

const quote = normalizeQuoteRecord({
  id: 'q1',
  quote_number: 'BG-001',
  customer_name: 'Khách A',
  customer_phone: '0900',
  project_name: 'Villa A',
  status: 'sent',
  total: 123000,
  point_count: 3,
  rooms: [{ id: 'room1', lines: [] }],
  calc: { grand: 123000, pointCount: 3 },
});
assert.equal(quote.customer.name, 'Khách A');
assert.equal(quote.customer.quoteNumber, 'BG-001');
assert.equal(quote.rooms.length, 1);

assert.equal(canUseFeature({ dealer: { plan: 'trial', subscription_status: 'trialing', trial_ends_at: '2999-01-01' }, usage: { quotes_per_month: 4 } }, 'quotes_per_month').ok, true);
assert.equal(canUseFeature({ dealer: { plan: 'trial', subscription_status: 'trialing', trial_ends_at: '2999-01-01' }, usage: { quotes_per_month: 5 } }, 'quotes_per_month').ok, false);
assert.equal(canUseFeature({ dealer: { plan: 'pro', subscription_status: 'active' }, usage: { quotes_per_month: 9999 } }, 'quotes_per_month').ok, true);

console.log('quote cloud smoke ok');
