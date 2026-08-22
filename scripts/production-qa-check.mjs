import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const requiredEnv = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const missing = requiredEnv.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing env for production QA: ${missing.join(', ')}`);
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, then run npm run qa:production.');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

async function assertTable(table, minRows = 0) {
  const { data, error } = await supabase.from(table).select('*').limit(Math.max(1, minRows || 1));
  if (error) throw new Error(`${table} check failed: ${error.message}`);
  if (minRows && (data || []).length < minRows) throw new Error(`${table} expected at least ${minRows} row(s)`);
  return data || [];
}

async function assertRpc(name, args) {
  const { error } = await supabase.rpc(name, args);
  if (error) throw new Error(`${name} RPC check failed: ${error.message}`);
}

await assertTable('plan_catalog', 1);
await assertTable('plan_limit_catalog', 1);
await assertTable('external_api_budget_catalog', 1);
await assertTable('usage_events', 0);
await assertTable('external_api_usage', 0);
await assertTable('dealers', 0);
await assertTable('dealer_members', 0);
await assertTable('catalog_items', 0);
await assertTable('quotes', 0);
await assertTable('billing_events', 0);
await assertRpc('usage_monthly_limit', { plan_input: 'starter', event_type_input: 'product_enrich' });
await assertRpc('smartquote_plan_price_vnd', { plan_input: 'pro', billing_cycle_input: 'monthly' });

console.log('Production QA schema/env check passed. Now run the manual 2-user checklist in docs/PRODUCTION_QA_2_USER_CHECKLIST.md.');
