-- SmartQuote MASTER PILOT MIGRATION (P1.5.3.1 → P2.3.14.1 RC16.1)
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

-- SmartQuote P2.3.12 RC14 — server-side Final quote lock + grounded learning.
-- Idempotent; apply after the base quote + learning schema.

create or replace function public.smartquote_guard_final_quote()
returns trigger
language plpgsql
set search_path = public, auth
as $$
declare
  old_lifecycle text;
  new_lifecycle text;
  allow_finalize boolean := coalesce(current_setting('smartquote.allow_finalize', true), '') = 'on';
  browser_role text := coalesce(auth.role(), '');
begin
  if browser_role = 'service_role' or (auth.uid() is null and current_user = 'postgres') then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_op = 'INSERT' then
    new_lifecycle := lower(coalesce(new.calc->'workflow'->>'lifecycle', 'draft'));
    if new_lifecycle = 'final' and not allow_finalize then
      raise exception 'Dùng finalize_quote để chốt báo giá';
    end if;
    return new;
  end if;

  old_lifecycle := lower(coalesce(old.calc->'workflow'->>'lifecycle', 'draft'));
  if tg_op = 'DELETE' then
    if old_lifecycle = 'final' then raise exception 'Báo giá Final không thể xóa'; end if;
    return old;
  end if;

  new_lifecycle := lower(coalesce(new.calc->'workflow'->>'lifecycle', 'draft'));
  if old_lifecycle = 'final' and not allow_finalize then
    if (to_jsonb(new) - array['status','updated_at','updated_by']::text[]) is distinct from
       (to_jsonb(old) - array['status','updated_at','updated_by']::text[]) then
      raise exception 'Báo giá Final là bất biến; hãy tạo revision mới';
    end if;
  elsif new_lifecycle = 'final' and not allow_finalize then
    raise exception 'Dùng finalize_quote để chốt báo giá';
  end if;
  return new;
end;
$$;

drop trigger if exists smartquote_guard_final_quote on public.quotes;
create trigger smartquote_guard_final_quote
before insert or update or delete on public.quotes
for each row execute function public.smartquote_guard_final_quote();

create or replace function public.finalize_quote(target_quote_id uuid, quote_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid := auth.uid();
  target_dealer_id uuid := nullif(quote_input->>'dealer_id','')::uuid;
  qid uuid := target_quote_id;
  sanitized jsonb;
  room jsonb;
  line jsonb;
  finalized_at_value timestamptz := now();
  current_lifecycle text;
  dealer_plan text;
  dealer_status text;
  trial_end timestamptz;
  period_end timestamptz;
begin
  if current_user_id is null then raise exception 'Not authenticated'; end if;
  if target_dealer_id is null or not public.is_dealer_member(target_dealer_id) then raise exception 'Not a member of this dealer workspace'; end if;

  select plan, subscription_status, trial_ends_at, current_period_end into dealer_plan, dealer_status, trial_end, period_end
  from public.dealers where id=target_dealer_id;
  if lower(coalesce(dealer_plan,'trial'))='expired'
     or lower(coalesce(dealer_status,case when lower(coalesce(dealer_plan,'trial'))='trial' then 'trialing' else 'active' end)) in ('expired','canceled','past_due','unpaid')
     or (lower(coalesce(dealer_plan,'trial'))='trial' and trial_end is not null and trial_end <= now())
     or (lower(coalesce(dealer_plan,'trial'))<>'trial' and period_end is not null and period_end <= now()) then
    raise exception 'Workspace đã hết hạn hoặc bị khóa. Vui lòng nâng cấp/gia hạn gói.';
  end if;

  if qid is not null then
    select lower(coalesce(calc->'workflow'->>'lifecycle','draft')) into current_lifecycle
    from public.quotes where id=qid and dealer_id=target_dealer_id;
    if not found then raise exception 'Quote not found in this dealer workspace'; end if;
    if current_lifecycle <> 'draft' then raise exception 'Chỉ báo giá Draft mới được Final'; end if;
  end if;

  if jsonb_typeof(coalesce(quote_input->'rooms','[]'::jsonb)) <> 'array' then raise exception 'rooms không hợp lệ'; end if;
  if not exists (
    select 1 from jsonb_array_elements(coalesce(quote_input->'rooms','[]'::jsonb)) r,
      jsonb_array_elements(coalesce(r->'lines','[]'::jsonb)) l
    where coalesce((l->>'qty')::numeric,0)>0
  ) then raise exception 'Báo giá phải có ít nhất 1 dòng sản phẩm'; end if;

  for room in select value from jsonb_array_elements(coalesce(quote_input->'rooms','[]'::jsonb)) loop
    for line in select value from jsonb_array_elements(coalesce(room->'lines','[]'::jsonb)) loop
      if coalesce((line->>'qty')::numeric,0) <= 0 then continue; end if;
      if nullif(trim(line->>'productId'),'') is null then raise exception 'Dòng báo giá thiếu productId'; end if;
      if jsonb_typeof(line->'productSnapshot') <> 'object' then raise exception 'Dòng báo giá thiếu productSnapshot'; end if;
      if coalesce((line->>'salePriceSnapshot')::numeric,0) <= 0 then raise exception 'Dòng báo giá thiếu salePriceSnapshot'; end if;
    end loop;
  end loop;

  sanitized := jsonb_set(coalesce(quote_input,'{}'::jsonb), '{calc}', jsonb_set(coalesce(quote_input->'calc','{}'::jsonb), '{workflow}', jsonb_set(coalesce(quote_input->'calc'->'workflow','{}'::jsonb), '{lifecycle}', '"draft"'::jsonb, true), true), true);
  if qid is not null then sanitized := jsonb_set(sanitized,'{id}',to_jsonb(qid::text),true); end if;
  qid := public.save_quote(sanitized);

  perform set_config('smartquote.allow_finalize','on',true);
  update public.quotes
  set calc = jsonb_set(coalesce(calc,'{}'::jsonb), '{workflow}',
        jsonb_set(
          jsonb_set(
            jsonb_set(coalesce(calc->'workflow','{}'::jsonb), '{lifecycle}', '"final"'::jsonb, true),
            '{finalizedAt}', to_jsonb(finalized_at_value::text), true),
          '{finalizedBy}', to_jsonb(current_user_id::text), true), true),
      updated_by=current_user_id
  where id=qid and dealer_id=target_dealer_id;

  return jsonb_build_object('id',qid,'quote_id',qid,'finalized_at',finalized_at_value);
end;
$$;
revoke all on function public.finalize_quote(uuid,jsonb) from public, anon;
grant execute on function public.finalize_quote(uuid,jsonb) to authenticated;

create or replace function public.record_quote_learning_observations(target_dealer_id uuid, target_quote_id uuid, observations_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid := auth.uid(); quote_calc jsonb; quote_rooms jsonb; quote_revision_value integer:=1;
  inserted_count integer:=0; rejected_count integer:=0; x jsonb; pid text; snap jsonb; qty numeric; sale numeric; cost numeric;
  sections jsonb; fin_at timestamptz; pkey text; margin numeric;
begin
  if current_user_id is null then raise exception 'Not authenticated'; end if;
  if target_dealer_id is null or not public.is_dealer_member(target_dealer_id) then raise exception 'Not a member of this dealer workspace'; end if;
  select q.calc,q.rooms into quote_calc,quote_rooms from public.quotes q where q.id=target_quote_id and q.dealer_id=target_dealer_id;
  if not found then raise exception 'Quote not found in this dealer workspace'; end if;
  if lower(coalesce(quote_calc->'workflow'->>'lifecycle','draft'))<>'final' or nullif(quote_calc->'workflow'->>'finalizedBy','') is null then
    raise exception 'Learning requires a server-finalized quote';
  end if;
  quote_revision_value:=greatest(1,coalesce((quote_calc->'workflow'->>'revision')::integer,1));
  fin_at:=coalesce(nullif(quote_calc->'workflow'->>'finalizedAt','')::timestamptz,now());

  for x in select value from jsonb_array_elements(coalesce(observations_input,'[]'::jsonb)) loop
    pid:=nullif(trim(x->>'product_id'),'');
    if pid is null then rejected_count:=rejected_count+1; continue; end if;
    select
      (array_agg(l->'productSnapshot'))[1],
      sum(coalesce((l->>'qty')::numeric,0)),
      case when sum(coalesce((l->>'qty')::numeric,0))>0 then sum(coalesce((l->>'qty')::numeric,0)*coalesce((l->>'salePriceSnapshot')::numeric,0))/sum(coalesce((l->>'qty')::numeric,0)) else 0 end,
      case when sum(case when nullif(l->>'costPriceSnapshot','') is not null then coalesce((l->>'qty')::numeric,0) else 0 end)>0 then sum(coalesce((l->>'qty')::numeric,0)*coalesce((l->>'costPriceSnapshot')::numeric,0))/sum(case when nullif(l->>'costPriceSnapshot','') is not null then coalesce((l->>'qty')::numeric,0) else 0 end) else 0 end,
      coalesce(jsonb_agg(distinct r->>'name') filter (where nullif(trim(r->>'name'),'') is not null),'[]'::jsonb)
    into snap,qty,sale,cost,sections
    from jsonb_array_elements(coalesce(quote_rooms,'[]'::jsonb)) r,
         jsonb_array_elements(coalesce(r->'lines','[]'::jsonb)) l
    where l->>'productId'=pid and coalesce((l->>'qty')::numeric,0)>0;
    if coalesce(qty,0)<=0 then rejected_count:=rejected_count+1; continue; end if;
    pkey:=coalesce(nullif(trim(x->>'product_key'),''),pid);
    margin:=case when cost>0 and sale>0 then ((sale-cost)/sale)*100 else null end;
    insert into public.quote_learning_observations(dealer_id,quote_id,observation_key,quote_revision,product_key,product_id,product_snapshot,customer_category,project_name,industry_profile,section_names,total_qty,sale_price,cost_price,margin_pct,finalized_at,created_by)
    values(target_dealer_id,target_quote_id,coalesce(nullif(trim(x->>'observation_key'),''),target_quote_id::text||'|'||pkey),quote_revision_value,pkey,pid,coalesce(snap,'{}'::jsonb),nullif(trim(x->>'customer_category'),''),nullif(trim(x->>'project_name'),''),coalesce(nullif(trim(x->>'industry_profile'),''),'generic'),sections,qty,sale,cost,margin,fin_at,current_user_id)
    on conflict(dealer_id,quote_id,product_key) do update set product_id=excluded.product_id,product_snapshot=excluded.product_snapshot,section_names=excluded.section_names,total_qty=excluded.total_qty,sale_price=excluded.sale_price,cost_price=excluded.cost_price,margin_pct=excluded.margin_pct,finalized_at=excluded.finalized_at;
    inserted_count:=inserted_count+1;
  end loop;
  return jsonb_build_object('inserted',inserted_count,'rejected',rejected_count,'quote_id',target_quote_id);
end;
$$;
revoke all on function public.record_quote_learning_observations(uuid,uuid,jsonb) from public,anon;
grant execute on function public.record_quote_learning_observations(uuid,uuid,jsonb) to authenticated;

select
  has_function_privilege('authenticated','public.finalize_quote(uuid,jsonb)','EXECUTE') as authenticated_finalize_rpc_should_be_true,
  has_function_privilege('anon','public.finalize_quote(uuid,jsonb)','EXECUTE') as anon_finalize_rpc_should_be_false,
  exists(select 1 from pg_trigger where tgname='smartquote_guard_final_quote' and not tgisinternal) as final_quote_guard_trigger_should_be_true;

-- SmartQuote P2.3.13 RC15 — quote sales status RPC.
-- Idempotent. Final quote content remains protected by smartquote_guard_final_quote.

create or replace function public.set_quote_sales_status(target_quote_id uuid, status_input text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  next_status text := lower(trim(coalesce(status_input, '')));
  target_dealer uuid;
  updated_row public.quotes%rowtype;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if next_status not in ('draft','sent','won','lost') then
    raise exception 'Trạng thái báo giá không hợp lệ';
  end if;
  select dealer_id into target_dealer from public.quotes where id = target_quote_id;
  if target_dealer is null or not public.is_dealer_member(target_dealer) then
    raise exception 'Quote not found in this dealer workspace';
  end if;
  update public.quotes
     set status = next_status, updated_by = auth.uid(), updated_at = now()
   where id = target_quote_id and dealer_id = target_dealer
  returning * into updated_row;
  if not found then raise exception 'Không cập nhật được trạng thái báo giá'; end if;
  return jsonb_build_object('id', updated_row.id, 'status', updated_row.status, 'updated_at', updated_row.updated_at);
end;
$$;

revoke all on function public.set_quote_sales_status(uuid, text) from public, anon;
grant execute on function public.set_quote_sales_status(uuid, text) to authenticated;

select
  has_function_privilege('authenticated','public.set_quote_sales_status(uuid,text)','EXECUTE') as authenticated_status_rpc_should_be_true,
  has_function_privilege('anon','public.set_quote_sales_status(uuid,text)','EXECUTE') as anon_status_rpc_should_be_false;



-- ===========================================================================
-- SmartQuote P2.3.14.1 — RC16.1 PILOT LOCK
-- Safe to re-run. Appended verbatim to supabase/schema.sql (fresh install) and
-- 01_RUN_ON_SUPABASE.sql (upgrade). scripts/pilot-p23141-rc161-smoke.mjs checks
-- that the three copies are identical.
--
-- A. Workspace roles are enforced IN THE DATABASE, for every write path
--    (direct table access, SECURITY DEFINER RPCs and Storage):
--
--    | Thao tác                                             | owner | admin | sales           | viewer |
--    |------------------------------------------------------|-------|-------|-----------------|--------|
--    | Xem dữ liệu workspace                                |  ✓    |  ✓    |  ✓              |  ✓     |
--    | Tạo/sửa/lưu báo giá, chốt Final, đổi trạng thái bán  |  ✓    |  ✓    |  ✓              |  ✗     |
--    | Xóa báo giá Draft (Final: không ai xóa được)         |  ✓    |  ✓    | chỉ báo giá mình tạo |  ✗ |
--    | Nhập/sửa/xóa danh mục, ảnh sản phẩm, lịch sử nhập    |  ✓    |  ✓    |  ✓              |  ✗     |
--    | Khách hàng, dữ liệu học từ báo giá                   |  ✓    |  ✓    |  ✓ (không xóa)  |  ✗     |
--    | Thông tin công ty (ngân hàng, mẫu in) và hệ số giá   |  ✓    |  ✓    |  ✗              |  ✗     |
--    | Yêu cầu / báo đã chuyển khoản gói                    |  ✓    |  ✓    |  ✗              |  ✗     |
--    | Thêm / đổi vai trò / xóa thành viên                  |  ✓    |  ✗    |  ✗              |  ✗     |
--
--    Requests without an end-user (service role, SQL editor, server jobs:
--    auth.uid() is null) are not restricted by these guards.
--
-- B. finalize_quote recomputes the quote totals from the frozen line snapshots
--    (Σ qty × salePriceSnapshot → nhân công → VAT → tổng) and refuses to
--    finalize when the totals sent by the browser differ by more than 1 đ.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- A1. Role helpers
-- ---------------------------------------------------------------------------
create or replace function public.smartquote_member_role(target_dealer_id uuid)
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select dm.role
  from public.dealer_members dm
  where dm.dealer_id = target_dealer_id and dm.user_id = auth.uid()
  limit 1
$$;

create or replace function public.smartquote_has_role(target_dealer_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(public.smartquote_member_role(target_dealer_id) = any(allowed_roles), false)
$$;

revoke all on function public.smartquote_member_role(uuid) from public, anon;
revoke all on function public.smartquote_has_role(uuid, text[]) from public, anon;
grant execute on function public.smartquote_member_role(uuid) to authenticated, service_role;
grant execute on function public.smartquote_has_role(uuid, text[]) to authenticated, service_role;

create or replace function public.smartquote_role_action_label(op text)
returns text
language sql
immutable
as $$
  select case upper(op) when 'INSERT' then 'thêm' when 'UPDATE' then 'sửa' when 'DELETE' then 'xóa' else lower(op) end
$$;

-- ---------------------------------------------------------------------------
-- A2. Generic role guard trigger
--   tg_argv[0] roles allowed to INSERT/UPDATE   (comma separated)
--   tg_argv[1] roles allowed to DELETE          (comma separated)
--   tg_argv[2] Vietnamese label of the data     (for the error message)
--   tg_argv[3] roles allowed to DELETE only rows they created (created_by = auth.uid())
-- ---------------------------------------------------------------------------
create or replace function public.smartquote_role_guard()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
  write_roles text[] := string_to_array(coalesce(tg_argv[0], ''), ',');
  delete_roles text[] := string_to_array(coalesce(tg_argv[1], coalesce(tg_argv[0], '')), ',');
  data_label text := coalesce(nullif(tg_argv[2], ''), tg_table_name);
  own_delete_roles text[] := string_to_array(coalesce(tg_argv[3], ''), ',');
  old_dealer uuid;
  new_dealer uuid;
  role_name text;
begin
  if uid is null then
    -- service role / SQL admin / server jobs
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    old_dealer := nullif(to_jsonb(old)->>'dealer_id', '')::uuid;
    role_name := public.smartquote_member_role(old_dealer);
    if tg_op = 'DELETE' then
      if not (coalesce(role_name = any(delete_roles), false)
              or (coalesce(role_name = any(own_delete_roles), false)
                  and nullif(to_jsonb(old)->>'created_by', '')::uuid = uid)) then
        raise exception 'Vai trò "%" không được phép xóa % trong workspace này.', coalesce(role_name, 'không thuộc workspace'), data_label
          using errcode = '42501';
      end if;
      return old;
    end if;
    if not coalesce(role_name = any(write_roles), false) then
      raise exception 'Vai trò "%" không được phép sửa % trong workspace này.', coalesce(role_name, 'không thuộc workspace'), data_label
        using errcode = '42501';
    end if;
  end if;

  new_dealer := nullif(to_jsonb(new)->>'dealer_id', '')::uuid;
  role_name := public.smartquote_member_role(new_dealer);
  if not coalesce(role_name = any(write_roles), false) then
    raise exception 'Vai trò "%" không được phép % % trong workspace này.', coalesce(role_name, 'không thuộc workspace'), public.smartquote_role_action_label(tg_op), data_label
      using errcode = '42501';
  end if;
  return new;
end;
$$;

do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      ('quotes',                      'owner,admin,sales', 'owner,admin',       'báo giá',              'sales'),
      ('catalog_items',               'owner,admin,sales', 'owner,admin,sales', 'danh mục sản phẩm',    ''),
      ('dealer_app_state',            'owner,admin,sales', 'owner,admin',       'dữ liệu workspace',    ''),
      ('customers',                   'owner,admin,sales', 'owner,admin',       'khách hàng',           ''),
      ('imports',                     'owner,admin,sales', 'owner,admin,sales', 'lịch sử nhập',         ''),
      ('import_rows',                 'owner,admin,sales', 'owner,admin,sales', 'lịch sử nhập',         ''),
      ('quote_learning_observations', 'owner,admin,sales', 'owner,admin',       'dữ liệu học báo giá',  ''),
      ('usage_events',                'owner,admin,sales', 'owner,admin',       'nhật ký sử dụng',      ''),
      ('billing_events',              'owner,admin',       'owner,admin',       'thanh toán gói',       '')
    ) as t(table_name, write_roles, delete_roles, data_label, own_delete_roles)
  loop
    if to_regclass('public.' || spec.table_name) is null then continue; end if;
    execute format('drop trigger if exists smartquote_role_guard on public.%I', spec.table_name);
    execute format(
      'create trigger smartquote_role_guard before insert or update or delete on public.%I for each row execute function public.smartquote_role_guard(%L, %L, %L, %L)',
      spec.table_name, spec.write_roles, spec.delete_roles, spec.data_label, spec.own_delete_roles
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- A3. Company settings (bank account, print template) and price markups are
--     owner/admin only — a sales account must not be able to change the bank
--     account printed on quotes or the pricing policy.
-- ---------------------------------------------------------------------------
create or replace function public.smartquote_app_state_settings_guard()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
  role_name text;
  old_company jsonb;
  old_markups jsonb;
begin
  if uid is null then return new; end if;
  role_name := public.smartquote_member_role(new.dealer_id);
  if coalesce(role_name = any(array['owner','admin']), false) then return new; end if;
  if tg_op = 'INSERT' then
    old_company := '{}'::jsonb;
    old_markups := '[]'::jsonb;
  else
    old_company := coalesce(old.company, '{}'::jsonb);
    old_markups := coalesce(old.markups, '[]'::jsonb);
  end if;
  if coalesce(new.company, '{}'::jsonb) is distinct from old_company then
    raise exception 'Vai trò "%" không được phép đổi thông tin công ty (ngân hàng, mẫu báo giá). Hãy nhờ chủ/quản trị workspace.', coalesce(role_name, 'không thuộc workspace')
      using errcode = '42501';
  end if;
  if coalesce(new.markups, '[]'::jsonb) is distinct from old_markups then
    raise exception 'Vai trò "%" không được phép đổi hệ số giá. Hãy nhờ chủ/quản trị workspace.', coalesce(role_name, 'không thuộc workspace')
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists smartquote_app_state_settings_guard on public.dealer_app_state;
create trigger smartquote_app_state_settings_guard
before insert or update on public.dealer_app_state
for each row execute function public.smartquote_app_state_settings_guard();

-- ---------------------------------------------------------------------------
-- A4. Membership: only an owner manages members. The single exception is the
--     bootstrap row ensure_dealer_workspace() writes for a brand-new workspace
--     (first member, the caller, as owner).
-- ---------------------------------------------------------------------------
create or replace function public.smartquote_members_guard()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
  target_dealer uuid;
begin
  if uid is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  target_dealer := case when tg_op = 'DELETE' then old.dealer_id else new.dealer_id end;
  if tg_op = 'INSERT'
     and new.user_id = uid
     and new.role = 'owner'
     and not exists (select 1 from public.dealer_members dm where dm.dealer_id = new.dealer_id) then
    return new; -- bootstrap of a new workspace
  end if;
  if tg_op = 'UPDATE' and old.dealer_id is distinct from new.dealer_id then
    raise exception 'Không được chuyển thành viên sang workspace khác.' using errcode = '42501';
  end if;
  if not public.smartquote_has_role(target_dealer, array['owner']) then
    raise exception 'Chỉ chủ workspace (owner) mới được quản lý thành viên.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists smartquote_members_guard on public.dealer_members;
create trigger smartquote_members_guard
before insert or update or delete on public.dealer_members
for each row execute function public.smartquote_members_guard();

-- ---------------------------------------------------------------------------
-- A5. Row-level policies mirror the same matrix (defence in depth).
-- ---------------------------------------------------------------------------
drop policy if exists "Quotes deletable by dealer members" on public.quotes;
drop policy if exists "Quotes deletable by dealer owners admins or creator" on public.quotes;
create policy "Quotes deletable by dealer owners admins or creator"
on public.quotes for delete
to authenticated
using (
  public.smartquote_has_role(dealer_id, array['owner','admin'])
  or (public.smartquote_has_role(dealer_id, array['sales']) and created_by = auth.uid())
);

drop policy if exists "Catalog deletable by dealer admins" on public.catalog_items;
drop policy if exists "Catalog deletable by dealer writers" on public.catalog_items;
create policy "Catalog deletable by dealer writers"
on public.catalog_items for delete
to authenticated
using (public.smartquote_has_role(dealer_id, array['owner','admin','sales']));

drop policy if exists "Dealer app state insertable by members" on public.dealer_app_state;
drop policy if exists "Dealer app state insertable by writers" on public.dealer_app_state;
create policy "Dealer app state insertable by writers"
on public.dealer_app_state for insert
to authenticated
with check (public.smartquote_has_role(dealer_id, array['owner','admin','sales']));

drop policy if exists "Dealer app state updatable by members" on public.dealer_app_state;
drop policy if exists "Dealer app state updatable by writers" on public.dealer_app_state;
create policy "Dealer app state updatable by writers"
on public.dealer_app_state for update
to authenticated
using (public.smartquote_has_role(dealer_id, array['owner','admin','sales']))
with check (public.smartquote_has_role(dealer_id, array['owner','admin','sales']));

-- ---------------------------------------------------------------------------
-- A6. Storage (catalog product images): viewers may list/read, not write.
-- ---------------------------------------------------------------------------
create or replace function public.can_write_catalog_image_path(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  dealer_text text;
  dealer_uuid uuid;
begin
  dealer_text := split_part(coalesce(object_name, ''), '/', 1);
  if dealer_text = '' then return false; end if;
  begin
    dealer_uuid := dealer_text::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  return public.smartquote_has_role(dealer_uuid, array['owner','admin','sales']);
end;
$$;
revoke all on function public.can_write_catalog_image_path(text) from public, anon;
grant execute on function public.can_write_catalog_image_path(text) to authenticated, service_role;

do $$
begin
  if to_regclass('storage.objects') is null then return; end if;
  execute 'drop policy if exists "Catalog images insert by dealer members" on storage.objects';
  execute 'drop policy if exists "Catalog images update by dealer members" on storage.objects';
  execute 'drop policy if exists "Catalog images delete by dealer members" on storage.objects';
  execute 'drop policy if exists "Catalog images insert by dealer writers" on storage.objects';
  execute 'drop policy if exists "Catalog images update by dealer writers" on storage.objects';
  execute 'drop policy if exists "Catalog images delete by dealer writers" on storage.objects';
  execute $p$create policy "Catalog images insert by dealer writers" on storage.objects for insert to authenticated
    with check (bucket_id = 'catalog-product-images' and public.can_write_catalog_image_path(name))$p$;
  execute $p$create policy "Catalog images update by dealer writers" on storage.objects for update to authenticated
    using (bucket_id = 'catalog-product-images' and public.can_write_catalog_image_path(name))
    with check (bucket_id = 'catalog-product-images' and public.can_write_catalog_image_path(name))$p$;
  execute $p$create policy "Catalog images delete by dealer writers" on storage.objects for delete to authenticated
    using (bucket_id = 'catalog-product-images' and public.can_write_catalog_image_path(name))$p$;
end;
$$;

-- ---------------------------------------------------------------------------
-- B. finalize_quote: server-side totals verification
-- ---------------------------------------------------------------------------
create or replace function public.finalize_quote(target_quote_id uuid, quote_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid := auth.uid();
  target_dealer_id uuid := nullif(quote_input->>'dealer_id','')::uuid;
  qid uuid := target_quote_id;
  sanitized jsonb;
  room jsonb;
  line jsonb;
  finalized_at_value timestamptz := now();
  current_lifecycle text;
  dealer_plan text;
  dealer_status text;
  trial_end timestamptz;
  period_end timestamptz;
  line_qty numeric;
  line_price numeric;
  client_calc jsonb := coalesce(quote_input->'calc', '{}'::jsonb);
  labor_pct numeric;
  vat_pct numeric;
  server_device numeric := 0;
  server_points numeric := 0;
  server_labor numeric;
  server_pretax numeric;
  server_vat numeric;
  server_grand numeric;
  verified_totals jsonb;
begin
  if current_user_id is null then raise exception 'Not authenticated'; end if;
  if target_dealer_id is null or not public.is_dealer_member(target_dealer_id) then raise exception 'Not a member of this dealer workspace'; end if;
  if not public.smartquote_has_role(target_dealer_id, array['owner','admin','sales']) then
    raise exception 'Vai trò "%" không được phép chốt báo giá trong workspace này.', coalesce(public.smartquote_member_role(target_dealer_id), 'không thuộc workspace')
      using errcode = '42501';
  end if;

  select plan, subscription_status, trial_ends_at, current_period_end into dealer_plan, dealer_status, trial_end, period_end
  from public.dealers where id=target_dealer_id;
  if lower(coalesce(dealer_plan,'trial'))='expired'
     or lower(coalesce(dealer_status,case when lower(coalesce(dealer_plan,'trial'))='trial' then 'trialing' else 'active' end)) in ('expired','canceled','past_due','unpaid')
     or (lower(coalesce(dealer_plan,'trial'))='trial' and trial_end is not null and trial_end <= now())
     or (lower(coalesce(dealer_plan,'trial'))<>'trial' and period_end is not null and period_end <= now()) then
    raise exception 'Workspace đã hết hạn hoặc bị khóa. Vui lòng nâng cấp/gia hạn gói.';
  end if;

  if qid is not null then
    select lower(coalesce(calc->'workflow'->>'lifecycle','draft')) into current_lifecycle
    from public.quotes where id=qid and dealer_id=target_dealer_id;
    if not found then raise exception 'Quote not found in this dealer workspace'; end if;
    if current_lifecycle <> 'draft' then raise exception 'Chỉ báo giá Draft mới được Final'; end if;
  end if;

  if jsonb_typeof(coalesce(quote_input->'rooms','[]'::jsonb)) <> 'array' then raise exception 'rooms không hợp lệ'; end if;
  if not exists (
    select 1 from jsonb_array_elements(coalesce(quote_input->'rooms','[]'::jsonb)) r,
      jsonb_array_elements(coalesce(r->'lines','[]'::jsonb)) l
    where coalesce((l->>'qty')::numeric,0)>0
  ) then raise exception 'Báo giá phải có ít nhất 1 dòng sản phẩm'; end if;

  for room in select value from jsonb_array_elements(coalesce(quote_input->'rooms','[]'::jsonb)) loop
    for line in select value from jsonb_array_elements(coalesce(room->'lines','[]'::jsonb)) loop
      line_qty := coalesce((line->>'qty')::numeric,0);
      if line_qty <= 0 then continue; end if;
      if nullif(trim(line->>'productId'),'') is null then raise exception 'Dòng báo giá thiếu productId'; end if;
      if jsonb_typeof(line->'productSnapshot') <> 'object' then raise exception 'Dòng báo giá thiếu productSnapshot'; end if;
      line_price := coalesce((line->>'salePriceSnapshot')::numeric,0);
      if line_price <= 0 then raise exception 'Dòng báo giá thiếu salePriceSnapshot'; end if;
      -- RC16.1: the money on a Final quote is what the frozen lines say.
      server_device := server_device + line_qty * line_price;
      server_points := server_points + line_qty;
    end loop;
  end loop;

  -- RC16.1: same formula as src/quoteMath.js calculateQuoteTotals().
  labor_pct := coalesce(nullif(client_calc->>'laborPercent','')::numeric, 0);
  vat_pct := coalesce(nullif(client_calc->>'vatPercent','')::numeric, 0);
  if labor_pct < 0 or labor_pct > 100 or vat_pct < 0 or vat_pct > 100 then
    raise exception 'Tỷ lệ nhân công/VAT không hợp lệ (nhân công %%: %, VAT %%: %).', labor_pct, vat_pct;
  end if;
  server_labor := round(server_device * labor_pct / 100);
  server_pretax := server_device + server_labor;
  server_vat := round(server_pretax * vat_pct / 100);
  server_grand := server_pretax + server_vat;

  if nullif(client_calc->>'deviceTotal','') is null or nullif(client_calc->>'grand','') is null
     or abs(coalesce(nullif(client_calc->>'deviceTotal','')::numeric, -1) - server_device) > 1
     or abs(coalesce(nullif(client_calc->>'laborTotal','')::numeric, 0) - server_labor) > 1
     or abs(coalesce(nullif(client_calc->>'vatTotal','')::numeric, 0) - server_vat) > 1
     or abs(coalesce(nullif(client_calc->>'grand','')::numeric, -1) - server_grand) > 1
     or abs(coalesce(nullif(quote_input->>'subtotal','')::numeric, server_device) - server_device) > 1
     or abs(coalesce(nullif(quote_input->>'labor_total','')::numeric, server_labor) - server_labor) > 1
     or abs(coalesce(nullif(quote_input->>'total','')::numeric, server_grand) - server_grand) > 1 then
    raise exception 'Tổng tiền báo giá không khớp với các dòng sản phẩm (server tính % đ, trình duyệt gửi % đ). Hãy tải lại báo giá rồi chốt lại.',
      to_char(server_grand, 'FM999G999G999G990'), coalesce(client_calc->>'grand', '?');
  end if;

  verified_totals := jsonb_build_object(
    'deviceTotal', server_device, 'laborPercent', labor_pct, 'laborTotal', server_labor,
    'preTaxTotal', server_pretax, 'vatPercent', vat_pct, 'vatTotal', server_vat, 'grand', server_grand,
    'pointCount', server_points, 'verifiedAt', finalized_at_value
  );

  sanitized := jsonb_set(coalesce(quote_input,'{}'::jsonb), '{calc}', jsonb_set(client_calc, '{workflow}', jsonb_set(coalesce(client_calc->'workflow','{}'::jsonb), '{lifecycle}', '"draft"'::jsonb, true), true), true);
  if qid is not null then sanitized := jsonb_set(sanitized,'{id}',to_jsonb(qid::text),true); end if;
  qid := public.save_quote(sanitized);

  perform set_config('smartquote.allow_finalize','on',true);
  update public.quotes
  set calc = jsonb_set(
        jsonb_set(coalesce(calc,'{}'::jsonb), '{workflow}',
          jsonb_set(
            jsonb_set(
              jsonb_set(coalesce(calc->'workflow','{}'::jsonb), '{lifecycle}', '"final"'::jsonb, true),
              '{finalizedAt}', to_jsonb(finalized_at_value::text), true),
            '{finalizedBy}', to_jsonb(current_user_id::text), true), true),
        '{serverVerifiedTotals}', verified_totals, true),
      subtotal = server_device,
      labor_total = server_labor,
      total = server_grand,
      updated_by=current_user_id
  where id=qid and dealer_id=target_dealer_id;
  -- RC16.1: close the window immediately. set_config(..., true) would otherwise
  -- keep Final quotes editable until the end of the surrounding transaction.
  perform set_config('smartquote.allow_finalize','off',true);

  return jsonb_build_object('id',qid,'quote_id',qid,'finalized_at',finalized_at_value,'server_verified_totals',verified_totals);
end;
$$;
revoke all on function public.finalize_quote(uuid,jsonb) from public, anon;
grant execute on function public.finalize_quote(uuid,jsonb) to authenticated;

commit;

-- RC16.1 verification — every *_should_be_true column must be t, every *_should_be_false f.
select
  exists(select 1 from pg_trigger where tgname='smartquote_role_guard' and tgrelid='public.quotes'::regclass) as quotes_role_guard_should_be_true,
  exists(select 1 from pg_trigger where tgname='smartquote_role_guard' and tgrelid='public.catalog_items'::regclass) as catalog_role_guard_should_be_true,
  exists(select 1 from pg_trigger where tgname='smartquote_role_guard' and tgrelid='public.dealer_app_state'::regclass) as app_state_role_guard_should_be_true,
  exists(select 1 from pg_trigger where tgname='smartquote_app_state_settings_guard') as app_state_settings_guard_should_be_true,
  exists(select 1 from pg_trigger where tgname='smartquote_role_guard' and tgrelid='public.billing_events'::regclass) as billing_role_guard_should_be_true,
  exists(select 1 from pg_trigger where tgname='smartquote_members_guard') as members_guard_should_be_true,
  exists(select 1 from pg_policies where policyname='Quotes deletable by dealer members') as old_member_delete_policy_should_be_false,
  position('serverVerifiedTotals' in pg_get_functiondef('public.finalize_quote(uuid,jsonb)'::regprocedure)) > 0 as finalize_server_totals_should_be_true,
  has_function_privilege('anon','public.finalize_quote(uuid,jsonb)','EXECUTE') as anon_finalize_rpc_should_be_false,
  has_function_privilege('anon','public.smartquote_has_role(uuid,text[])','EXECUTE') as anon_role_helper_should_be_false;
