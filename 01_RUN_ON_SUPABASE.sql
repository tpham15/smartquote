-- SmartQuote P1.5.3.1 — MASTER PILOT MIGRATION
-- Run this ONE file in Supabase SQL Editor.
-- Order: security -> industry profiles -> catalog image storage -> release hardening -> P2.0 Final Quote Learning.
-- Designed to be safe to re-run on the current pilot schema.

begin;

-- ===========================================================================
-- 1. PILOT SECURITY FIX
-- ===========================================================================
-- SmartQuote Pilot Security Fix — billing privilege hardening
-- Apply this ONCE to the live Supabase project before accepting paid pilot users.
-- Safe to re-run: statements are idempotent/replacing.
--
-- Closes two critical privilege paths:
--  1) authenticated dealer owners/admins must not be able to edit plan/subscription fields directly;
--  2) admin-only billing activation RPCs must not be executable by anon/authenticated browser roles.

-- ---------------------------------------------------------------------------
-- 1. Billing fields on public.dealers are server-controlled.
-- ---------------------------------------------------------------------------

-- Keep the existing owner/admin RLS policy for ordinary dealer-profile edits,
-- but remove table-wide UPDATE from browser roles and grant only safe columns.
revoke insert, update, delete on table public.dealers from anon;
revoke insert, update, delete on table public.dealers from authenticated;
grant select on table public.dealers to authenticated;
grant update (name, phone, address) on table public.dealers to authenticated;

-- Defense in depth: even if a broad table UPDATE grant is accidentally restored
-- later, reject browser attempts to mutate billing-controlled fields.
create or replace function public.smartquote_guard_dealer_billing_fields()
returns trigger
language plpgsql
set search_path = public, auth
as $$
begin
  if new.plan is distinct from old.plan
     or new.subscription_status is distinct from old.subscription_status
     or new.trial_ends_at is distinct from old.trial_ends_at
     or new.current_period_end is distinct from old.current_period_end
     or new.plan_started_at is distinct from old.plan_started_at then
    if coalesce(auth.role(), '') <> 'service_role'
       and session_user not in ('postgres', 'supabase_admin') then
      raise exception 'Billing fields are server-controlled';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.smartquote_guard_dealer_billing_fields() from public;
revoke all on function public.smartquote_guard_dealer_billing_fields() from anon;
revoke all on function public.smartquote_guard_dealer_billing_fields() from authenticated;

-- Trigger runs automatically; browser roles do not need EXECUTE on the function.
drop trigger if exists smartquote_guard_dealer_billing_fields on public.dealers;
create trigger smartquote_guard_dealer_billing_fields
before update on public.dealers
for each row execute function public.smartquote_guard_dealer_billing_fields();

-- ---------------------------------------------------------------------------
-- 2. Admin activation RPCs are service-role / SQL-admin only.
-- ---------------------------------------------------------------------------

-- Defense in depth inside the SECURITY DEFINER function itself. This prevents a
-- future accidental GRANT from turning a browser user into a billing admin.
create or replace function public.admin_activate_manual_billing_event(
  target_billing_event_id uuid,
  payment_reference_input text default null,
  admin_note_input text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  event_row public.billing_events%rowtype;
  new_period_end timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Admin billing activation requires service role';
  end if;

  select * into event_row
  from public.billing_events
  where id = target_billing_event_id
  for update;

  if not found then
    raise exception 'Không tìm thấy billing event';
  end if;

  new_period_end := case
    when exists (
      select 1 from public.dealers d
      where d.id = event_row.dealer_id
        and d.subscription_status = 'active'
        and d.current_period_end is not null
        and d.current_period_end > now()
    ) then (
      select d.current_period_end + make_interval(months => event_row.months)
      from public.dealers d where d.id = event_row.dealer_id
    )
    else now() + make_interval(months => event_row.months)
  end;

  update public.dealers
  set plan = event_row.plan,
      subscription_status = 'active',
      plan_started_at = now(),
      current_period_end = new_period_end,
      updated_at = now()
  where id = event_row.dealer_id;

  update public.billing_events
  set status = 'activated',
      payment_reference = coalesce(payment_reference_input, payment_reference),
      admin_note = coalesce(admin_note_input, admin_note),
      activated_at = now(),
      expires_at = new_period_end
  where id = target_billing_event_id;

  return event_row.dealer_id;
end;
$$;

create or replace function public.admin_activate_dealer_plan(
  target_dealer_id uuid,
  target_plan text,
  months_input integer default 1,
  admin_note_input text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  normalized_plan text := lower(coalesce(target_plan, ''));
  normalized_months integer := greatest(1, coalesce(months_input, 1));
  new_period_end timestamptz;
  new_event_id uuid := gen_random_uuid();
  amount integer;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Admin billing activation requires service role';
  end if;

  if normalized_plan not in ('starter','pro','business') then
    raise exception 'Gói không hợp lệ';
  end if;

  new_period_end := case
    when exists (
      select 1 from public.dealers d
      where d.id = target_dealer_id
        and d.subscription_status = 'active'
        and d.current_period_end is not null
        and d.current_period_end > now()
    ) then (
      select d.current_period_end + make_interval(months => normalized_months)
      from public.dealers d where d.id = target_dealer_id
    )
    else now() + make_interval(months => normalized_months)
  end;

  amount := public.smartquote_plan_price_vnd(
    normalized_plan,
    case when normalized_months >= 12 then 'annual' else 'monthly' end
  );

  insert into public.billing_events (
    id, dealer_id, user_id, plan, billing_cycle, months, amount_vnd, status,
    transfer_content, admin_note, activated_at, expires_at
  ) values (
    new_event_id, target_dealer_id, null, normalized_plan,
    case when normalized_months >= 12 then 'annual' else 'monthly' end,
    normalized_months, amount, 'activated',
    'ADMIN-' || upper(substr(replace(new_event_id::text, '-', ''), 1, 8)),
    admin_note_input, now(), new_period_end
  );

  update public.dealers
  set plan = normalized_plan,
      subscription_status = 'active',
      plan_started_at = now(),
      current_period_end = new_period_end,
      updated_at = now()
  where id = target_dealer_id;

  return target_dealer_id;
end;
$$;

revoke all on function public.admin_activate_manual_billing_event(uuid, text, text) from public;
revoke all on function public.admin_activate_manual_billing_event(uuid, text, text) from anon;
revoke all on function public.admin_activate_manual_billing_event(uuid, text, text) from authenticated;
grant execute on function public.admin_activate_manual_billing_event(uuid, text, text) to service_role;

revoke all on function public.admin_activate_dealer_plan(uuid, text, integer, text) from public;
revoke all on function public.admin_activate_dealer_plan(uuid, text, integer, text) from anon;
revoke all on function public.admin_activate_dealer_plan(uuid, text, integer, text) from authenticated;
grant execute on function public.admin_activate_dealer_plan(uuid, text, integer, text) to service_role;

-- Customer-facing checkout RPCs remain authenticated-only.
revoke all on function public.create_manual_billing_request(uuid, text, text, text, text) from public;
revoke all on function public.create_manual_billing_request(uuid, text, text, text, text) from anon;
grant execute on function public.create_manual_billing_request(uuid, text, text, text, text) to authenticated;

revoke all on function public.mark_manual_billing_event_paid(uuid, uuid) from public;
revoke all on function public.mark_manual_billing_event_paid(uuid, uuid) from anon;
grant execute on function public.mark_manual_billing_event_paid(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. P1.5 industry profiles (re-run safe)
-- ---------------------------------------------------------------------------
-- If this is the first time industry_profile is introduced, preserve existing
-- workspaces as Smart Home. On later re-runs, do NOT convert new NULL tenants,
-- because NULL is the intentional "needs onboarding" state.
do $$
declare
  industry_column_was_present boolean;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'dealers'
      and column_name = 'industry_profile'
  ) into industry_column_was_present;

  execute 'alter table public.dealers add column if not exists industry_profile text';
  execute 'alter table public.dealers add column if not exists business_type text';
  execute 'alter table public.dealers add column if not exists industry_profile_version integer not null default 1';

  if not industry_column_was_present then
    update public.dealers
    set industry_profile = 'smarthome',
        industry_profile_version = 1,
        updated_at = now()
    where industry_profile is null;
  end if;
end;
$$;

alter table public.dealers alter column industry_profile drop default;

alter table public.dealers drop constraint if exists dealers_industry_profile_check;
alter table public.dealers add constraint dealers_industry_profile_check
  check (industry_profile is null or industry_profile in ('generic','lighting','cctv','smarthome','electrical','hvac'));

alter table public.dealers drop constraint if exists dealers_business_type_check;
alter table public.dealers add constraint dealers_business_type_check
  check (business_type is null or business_type in ('distributor','dealer','system_integrator','contractor','manufacturer','other'));

alter table public.dealers drop constraint if exists dealers_industry_profile_version_check;
alter table public.dealers add constraint dealers_industry_profile_version_check
  check (industry_profile_version >= 1 and industry_profile_version <= 1000);

revoke update on table public.dealers from authenticated;
grant update (name, phone, address, industry_profile, business_type, industry_profile_version) on table public.dealers to authenticated;


-- ===========================================================================
-- 3. P1.5.2 CATALOG IMAGE OVERRIDES
-- ===========================================================================
-- SmartQuote P1.5.2 — Dealer product-image overrides
-- Public-read / tenant-write bucket: product photos are intended to appear in customer quotations.
-- Only authenticated members of the dealer workspace can upload, replace or delete objects
-- under that dealer's UUID prefix.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'catalog-product-images',
  'catalog-product-images',
  true,
  4194304,
  array['image/jpeg','image/png','image/webp']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.can_manage_catalog_image_path(object_name text)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  dealer_text text;
  dealer_uuid uuid;
begin
  dealer_text := split_part(coalesce(object_name, ''), '/', 1);
  if dealer_text = '' then
    return false;
  end if;
  begin
    dealer_uuid := dealer_text::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  return public.is_dealer_member(dealer_uuid);
end;
$$;

revoke all on function public.can_manage_catalog_image_path(text) from public;
grant execute on function public.can_manage_catalog_image_path(text) to authenticated;

drop policy if exists "Catalog images insert by dealer members" on storage.objects;
create policy "Catalog images insert by dealer members"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'catalog-product-images'
  and public.can_manage_catalog_image_path(name)
);

drop policy if exists "Catalog images update by dealer members" on storage.objects;
create policy "Catalog images update by dealer members"
on storage.objects for update
to authenticated
using (
  bucket_id = 'catalog-product-images'
  and public.can_manage_catalog_image_path(name)
)
with check (
  bucket_id = 'catalog-product-images'
  and public.can_manage_catalog_image_path(name)
);

drop policy if exists "Catalog images delete by dealer members" on storage.objects;
create policy "Catalog images delete by dealer members"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'catalog-product-images'
  and public.can_manage_catalog_image_path(name)
);

-- Authenticated members may list/read their own workspace objects through Storage APIs.
-- The bucket itself is public-read so generated quotation files can embed the image URL.
drop policy if exists "Catalog images list by dealer members" on storage.objects;
create policy "Catalog images list by dealer members"
on storage.objects for select
to authenticated
using (
  bucket_id = 'catalog-product-images'
  and public.can_manage_catalog_image_path(name)
);

-- ===========================================================================
-- 4. P1.5.3 RELEASE HARDENING (server-only operational RPCs)
-- ===========================================================================
-- SmartQuote P1.5.3 — Pilot release hardening
-- Run on the live Supabase project before pilot deployment.
-- Safe to re-run.
--
-- These RPCs are server-only. PostgreSQL grants EXECUTE on new functions to PUBLIC
-- by default, so revoking only PUBLIC is not enough once anon/authenticated have
-- explicit/default grants in Supabase. Revoke every browser role explicitly.

revoke all on function public.smartquote_increment_rate_limit(text, timestamptz, integer, integer) from public;
revoke all on function public.smartquote_increment_rate_limit(text, timestamptz, integer, integer) from anon;
revoke all on function public.smartquote_increment_rate_limit(text, timestamptz, integer, integer) from authenticated;
grant execute on function public.smartquote_increment_rate_limit(text, timestamptz, integer, integer) to service_role;

revoke all on function public.admin_prune_api_logs(integer) from public;
revoke all on function public.admin_prune_api_logs(integer) from anon;
revoke all on function public.admin_prune_api_logs(integer) from authenticated;
grant execute on function public.admin_prune_api_logs(integer) to service_role;

revoke all on function public.consume_usage_quota(uuid, uuid, text, integer, jsonb) from public;
revoke all on function public.consume_usage_quota(uuid, uuid, text, integer, jsonb) from anon;
revoke all on function public.consume_usage_quota(uuid, uuid, text, integer, jsonb) from authenticated;
grant execute on function public.consume_usage_quota(uuid, uuid, text, integer, jsonb) to service_role;

commit;

-- ---------------------------------------------------------------------------
-- 5. FINAL VERIFICATION — one result row
-- Every *_should_be_false must be false; every *_should_be_true must be true.
-- ---------------------------------------------------------------------------
select
  has_column_privilege('authenticated', 'public.dealers', 'plan', 'UPDATE')
    as authenticated_plan_update_should_be_false,
  has_column_privilege('authenticated', 'public.dealers', 'subscription_status', 'UPDATE')
    as authenticated_subscription_update_should_be_false,
  has_column_privilege('authenticated', 'public.dealers', 'current_period_end', 'UPDATE')
    as authenticated_period_update_should_be_false,
  has_column_privilege('authenticated', 'public.dealers', 'name', 'UPDATE')
    as authenticated_name_update_should_be_true,
  has_column_privilege('authenticated', 'public.dealers', 'industry_profile', 'UPDATE')
    as authenticated_industry_update_should_be_true,
  has_column_privilege('authenticated', 'public.dealers', 'business_type', 'UPDATE')
    as authenticated_business_type_update_should_be_true,

  has_function_privilege('anon', 'public.admin_activate_manual_billing_event(uuid,text,text)', 'EXECUTE')
    as anon_admin_activate_event_should_be_false,
  has_function_privilege('authenticated', 'public.admin_activate_manual_billing_event(uuid,text,text)', 'EXECUTE')
    as authenticated_admin_activate_event_should_be_false,
  has_function_privilege('service_role', 'public.admin_activate_manual_billing_event(uuid,text,text)', 'EXECUTE')
    as service_role_admin_activate_event_should_be_true,
  has_function_privilege('anon', 'public.admin_activate_dealer_plan(uuid,text,integer,text)', 'EXECUTE')
    as anon_admin_activate_plan_should_be_false,
  has_function_privilege('authenticated', 'public.admin_activate_dealer_plan(uuid,text,integer,text)', 'EXECUTE')
    as authenticated_admin_activate_plan_should_be_false,
  has_function_privilege('service_role', 'public.admin_activate_dealer_plan(uuid,text,integer,text)', 'EXECUTE')
    as service_role_admin_activate_plan_should_be_true,
  has_function_privilege('authenticated', 'public.create_manual_billing_request(uuid,text,text,text,text)', 'EXECUTE')
    as authenticated_create_billing_request_should_be_true,
  has_function_privilege('authenticated', 'public.mark_manual_billing_event_paid(uuid,uuid)', 'EXECUTE')
    as authenticated_mark_paid_should_be_true,

  exists (
    select 1 from storage.buckets
    where id = 'catalog-product-images'
      and public = true
      and file_size_limit = 4194304
  ) as catalog_image_bucket_should_be_true,
  exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'Catalog images insert by dealer members'
  ) as catalog_image_insert_policy_should_be_true,
  has_function_privilege('authenticated', 'public.can_manage_catalog_image_path(text)', 'EXECUTE')
    as authenticated_image_path_guard_should_be_true,

  has_function_privilege('anon', 'public.smartquote_increment_rate_limit(text,timestamptz,integer,integer)', 'EXECUTE')
    as anon_rate_limit_should_be_false,
  has_function_privilege('authenticated', 'public.smartquote_increment_rate_limit(text,timestamptz,integer,integer)', 'EXECUTE')
    as authenticated_rate_limit_should_be_false,
  has_function_privilege('service_role', 'public.smartquote_increment_rate_limit(text,timestamptz,integer,integer)', 'EXECUTE')
    as service_role_rate_limit_should_be_true,
  has_function_privilege('anon', 'public.admin_prune_api_logs(integer)', 'EXECUTE')
    as anon_prune_logs_should_be_false,
  has_function_privilege('authenticated', 'public.admin_prune_api_logs(integer)', 'EXECUTE')
    as authenticated_prune_logs_should_be_false,
  has_function_privilege('service_role', 'public.admin_prune_api_logs(integer)', 'EXECUTE')
    as service_role_prune_logs_should_be_true,
  has_function_privilege('anon', 'public.consume_usage_quota(uuid,uuid,text,integer,jsonb)', 'EXECUTE')
    as anon_consume_quota_should_be_false,
  has_function_privilege('authenticated', 'public.consume_usage_quota(uuid,uuid,text,integer,jsonb)', 'EXECUTE')
    as authenticated_consume_quota_should_be_false,
  has_function_privilege('service_role', 'public.consume_usage_quota(uuid,uuid,text,integer,jsonb)', 'EXECUTE')
    as service_role_consume_quota_should_be_true;


-- ===========================================================================
-- P2.0 Final Quote Learning Memory
-- ===========================================================================
-- SmartQuote P2.0 — Final Quote Learning Memory
-- Idempotent migration. Run after the existing P1.5.3.1 master migration.

create table if not exists public.quote_learning_observations (
  id uuid primary key default gen_random_uuid(),
  dealer_id uuid not null references public.dealers(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  observation_key text not null,
  quote_revision integer not null default 1,
  product_key text not null,
  product_id text,
  product_snapshot jsonb not null default '{}'::jsonb,
  customer_category text,
  project_name text,
  industry_profile text,
  section_names jsonb not null default '[]'::jsonb,
  total_qty numeric not null default 0,
  sale_price numeric not null default 0,
  cost_price numeric not null default 0,
  margin_pct numeric,
  finalized_at timestamptz not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (dealer_id, quote_id, product_key)
);

create index if not exists quote_learning_dealer_finalized_idx
  on public.quote_learning_observations(dealer_id, finalized_at desc);
create index if not exists quote_learning_dealer_product_idx
  on public.quote_learning_observations(dealer_id, product_key, finalized_at desc);

alter table public.quote_learning_observations enable row level security;

drop policy if exists "Quote learning visible to dealer members" on public.quote_learning_observations;
create policy "Quote learning visible to dealer members"
on public.quote_learning_observations for select
to authenticated
using (public.is_dealer_member(dealer_id));

-- Browser clients may read their own workspace observations, but writes must go
-- through the guarded RPC below so only a real Final quote can create learning.
revoke all on public.quote_learning_observations from anon, authenticated;
grant select on public.quote_learning_observations to authenticated;

create or replace function public.record_quote_learning_observations(
  target_dealer_id uuid,
  target_quote_id uuid,
  observations_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid := auth.uid();
  quote_calc jsonb;
  quote_rooms jsonb;
  quote_revision_value integer := 1;
  inserted_count integer := 0;
  x jsonb;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if target_dealer_id is null or not public.is_dealer_member(target_dealer_id) then
    raise exception 'Not a member of this dealer workspace';
  end if;

  select q.calc, q.rooms
  into quote_calc, quote_rooms
  from public.quotes q
  where q.id = target_quote_id
    and q.dealer_id = target_dealer_id;

  if not found then
    raise exception 'Quote not found in this dealer workspace';
  end if;

  if lower(coalesce(quote_calc->'workflow'->>'lifecycle', 'draft')) <> 'final' then
    raise exception 'Learning requires a Final quote';
  end if;

  quote_revision_value := greatest(1, coalesce((quote_calc->'workflow'->>'revision')::integer, 1));

  for x in select value from jsonb_array_elements(coalesce(observations_input, '[]'::jsonb))
  loop
    if nullif(trim(x->>'product_key'), '') is null then
      continue;
    end if;

    insert into public.quote_learning_observations (
      dealer_id, quote_id, observation_key, quote_revision, product_key, product_id,
      product_snapshot, customer_category, project_name, industry_profile,
      section_names, total_qty, sale_price, cost_price, margin_pct,
      finalized_at, created_by
    ) values (
      target_dealer_id,
      target_quote_id,
      coalesce(nullif(trim(x->>'observation_key'), ''), target_quote_id::text || '|' || trim(x->>'product_key')),
      quote_revision_value,
      trim(x->>'product_key'),
      nullif(trim(x->>'product_id'), ''),
      coalesce(x->'product_snapshot', '{}'::jsonb),
      nullif(trim(x->>'customer_category'), ''),
      nullif(trim(x->>'project_name'), ''),
      coalesce(nullif(trim(x->>'industry_profile'), ''), 'generic'),
      coalesce(x->'section_names', '[]'::jsonb),
      greatest(0, coalesce((x->>'total_qty')::numeric, 0)),
      greatest(0, coalesce((x->>'sale_price')::numeric, 0)),
      greatest(0, coalesce((x->>'cost_price')::numeric, 0)),
      case when nullif(x->>'margin_pct', '') is null then null else (x->>'margin_pct')::numeric end,
      coalesce(nullif(x->>'finalized_at', '')::timestamptz, now()),
      current_user_id
    )
    on conflict (dealer_id, quote_id, product_key) do update set
      observation_key = excluded.observation_key,
      quote_revision = excluded.quote_revision,
      product_id = excluded.product_id,
      product_snapshot = excluded.product_snapshot,
      customer_category = excluded.customer_category,
      project_name = excluded.project_name,
      industry_profile = excluded.industry_profile,
      section_names = excluded.section_names,
      total_qty = excluded.total_qty,
      sale_price = excluded.sale_price,
      cost_price = excluded.cost_price,
      margin_pct = excluded.margin_pct,
      finalized_at = excluded.finalized_at;

    inserted_count := inserted_count + 1;
  end loop;

  return jsonb_build_object('inserted', inserted_count, 'quote_id', target_quote_id);
end;
$$;

revoke all on function public.record_quote_learning_observations(uuid, uuid, jsonb) from public, anon;
grant execute on function public.record_quote_learning_observations(uuid, uuid, jsonb) to authenticated;

-- Verification: browser roles may read tenant-scoped rows but cannot bypass the RPC.
select
  has_table_privilege('anon', 'public.quote_learning_observations', 'INSERT') as anon_learning_insert_should_be_false,
  has_table_privilege('authenticated', 'public.quote_learning_observations', 'INSERT') as authenticated_learning_insert_should_be_false,
  has_table_privilege('authenticated', 'public.quote_learning_observations', 'SELECT') as authenticated_learning_select_should_be_true,
  has_function_privilege('anon', 'public.record_quote_learning_observations(uuid,uuid,jsonb)', 'EXECUTE') as anon_learning_rpc_should_be_false,
  has_function_privilege('authenticated', 'public.record_quote_learning_observations(uuid,uuid,jsonb)', 'EXECUTE') as authenticated_learning_rpc_should_be_true;
