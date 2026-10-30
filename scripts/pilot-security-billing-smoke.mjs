#!/usr/bin/env node
import fs from 'node:fs';
import assert from 'node:assert/strict';

const fix = fs.readFileSync('supabase/smartquote_pilot_security_fix.sql', 'utf8');
const schema = fs.readFileSync('supabase/schema.sql', 'utf8');
const phase6 = fs.readFileSync('supabase/phase6_billing_events.sql', 'utf8');
const checkout = fs.readFileSync('supabase/phase12_6_bank_transfer_checkout.sql', 'utf8');
const cloudState = fs.readFileSync('src/supabase/cloudState.js', 'utf8');

function has(text, re, msg) {
  assert.match(text, re, msg);
}

// Browser users may read their dealer through RLS, but only safe profile columns may be updated.
has(fix, /revoke insert, update, delete on table public\.dealers from authenticated;/i,
  'authenticated must lose table-wide dealer mutation privileges');
has(fix, /grant update \(name, phone, address\) on table public\.dealers to authenticated;/i,
  'authenticated may update only safe dealer profile columns');
for (const col of ['plan', 'subscription_status', 'trial_ends_at', 'current_period_end', 'plan_started_at']) {
  has(fix, new RegExp(`new\\.${col} is distinct from old\\.${col}`, 'i'), `billing guard must protect ${col}`);
}
has(fix, /Billing fields are server-controlled/i, 'billing-field trigger must fail closed');
has(fix, /create trigger smartquote_guard_dealer_billing_fields/i, 'billing-field guard trigger must exist');

// Admin RPCs must be denied to both browser roles, not only PUBLIC.
for (const fn of [
  'admin_activate_manual_billing_event\\(uuid, text, text\\)',
  'admin_activate_dealer_plan\\(uuid, text, integer, text\\)',
]) {
  has(fix, new RegExp(`revoke all on function public\\.${fn} from anon;`, 'i'), `${fn} must revoke anon`);
  has(fix, new RegExp(`revoke all on function public\\.${fn} from authenticated;`, 'i'), `${fn} must revoke authenticated`);
  has(fix, new RegExp(`grant execute on function public\\.${fn} to service_role;`, 'i'), `${fn} must grant service_role only`);
}

// SECURITY DEFINER functions also self-check the JWT role in case grants regress later.
const adminGuardCount = (phase6.match(/Admin billing activation requires service role/g) || []).length;
assert.equal(adminGuardCount, 2, 'both admin billing functions must enforce service-role/admin guard');

// Customer checkout remains usable for signed-in workspace members.
has(checkout, /grant execute on function public\.create_manual_billing_request\(uuid, text, text, text, text\) to authenticated;/i,
  'authenticated users must still request manual billing');
has(checkout, /grant execute on function public\.mark_manual_billing_event_paid\(uuid, uuid\) to authenticated;/i,
  'authenticated users must still mark their own event paid');

// Fresh installs must include the hardening too.
has(schema, /Pilot Security Fix — billing privilege hardening/i, 'schema.sql must include pilot security hardening');
has(schema, /grant update \(name, phone, address\) on table public\.dealers to authenticated;/i,
  'fresh schema must restrict dealer updates');
has(schema, /revoke all on function public\.admin_activate_dealer_plan\(uuid, text, integer, text\) from authenticated;/i,
  'fresh schema must revoke admin plan activation from authenticated');

// Current browser code only reads billing state; it must not directly mutate dealer billing columns.
assert.doesNotMatch(cloudState, /\.from\(["']dealers["']\)[\s\S]{0,300}\.update\(/i,
  'browser cloudState must not directly update dealers');

// Migration includes a live verification row with false/true expectations.
for (const marker of [
  'authenticated_plan_update_should_be_false',
  'authenticated_subscription_update_should_be_false',
  'anon_admin_activate_plan_should_be_false',
  'authenticated_admin_activate_plan_should_be_false',
  'service_role_admin_activate_plan_should_be_true',
  'authenticated_create_billing_request_should_be_true',
]) {
  assert.ok(fix.includes(marker), `verification result must include ${marker}`);
}

console.log('✓ Pilot billing security smoke PASS');
console.log('  - authenticated owners cannot directly mutate plan/subscription fields');
console.log('  - billing columns have trigger defense-in-depth');
console.log('  - admin activation RPCs revoke anon/authenticated and allow service_role');
console.log('  - customer request/mark-paid RPCs remain authenticated');
console.log('  - fresh schema carries the same hardening');
