-- SmartQuote Cloud MVP for Supabase
-- Run this file once in Supabase Dashboard -> SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dealers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  address text,
  plan text not null default 'trial',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dealer_members (
  id uuid primary key default gen_random_uuid(),
  dealer_id uuid not null references public.dealers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','admin','sales','viewer')),
  created_at timestamptz not null default now(),
  unique (dealer_id, user_id)
);

create table if not exists public.dealer_app_state (
  dealer_id uuid primary key references public.dealers(id) on delete cascade,
  products jsonb not null default '[]'::jsonb,
  templates jsonb not null default '[]'::jsonb,
  company jsonb not null default '{}'::jsonb,
  markups jsonb not null default '[]'::jsonb,
  suppliers jsonb not null default '[]'::jsonb,
  name_map jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dealer_members_user_id_idx on public.dealer_members(user_id);
create index if not exists dealer_members_dealer_id_idx on public.dealer_members(dealer_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

drop trigger if exists dealers_touch_updated_at on public.dealers;
create trigger dealers_touch_updated_at
before update on public.dealers
for each row execute function public.touch_updated_at();

drop trigger if exists dealer_app_state_touch_updated_at on public.dealer_app_state;
create trigger dealer_app_state_touch_updated_at
before update on public.dealer_app_state
for each row execute function public.touch_updated_at();

create or replace function public.is_dealer_member(target_dealer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.dealer_members dm
    where dm.dealer_id = target_dealer_id
      and dm.user_id = auth.uid()
  );
$$;

create or replace function public.ensure_dealer_workspace(dealer_name_input text default 'Đại lý SmartQuote')
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid := auth.uid();
  existing_dealer_id uuid;
  new_dealer_id uuid;
  auth_email text;
  auth_full_name text;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select dm.dealer_id
  into existing_dealer_id
  from public.dealer_members dm
  where dm.user_id = current_user_id
  order by dm.created_at asc
  limit 1;

  if existing_dealer_id is not null then
    return existing_dealer_id;
  end if;

  select email, raw_user_meta_data->>'full_name'
  into auth_email, auth_full_name
  from auth.users
  where id = current_user_id;

  insert into public.profiles (id, email, full_name)
  values (current_user_id, auth_email, coalesce(auth_full_name, ''))
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.profiles.full_name);

  insert into public.dealers (name)
  values (coalesce(nullif(trim(dealer_name_input), ''), 'Đại lý SmartQuote'))
  returning id into new_dealer_id;

  insert into public.dealer_members (dealer_id, user_id, role)
  values (new_dealer_id, current_user_id, 'owner');

  insert into public.dealer_app_state (dealer_id)
  values (new_dealer_id);

  return new_dealer_id;
end;
$$;

alter table public.profiles enable row level security;
alter table public.dealers enable row level security;
alter table public.dealer_members enable row level security;
alter table public.dealer_app_state enable row level security;

drop policy if exists "Profiles are readable by owner" on public.profiles;
create policy "Profiles are readable by owner"
on public.profiles for select
to authenticated
using (id = auth.uid());

drop policy if exists "Profiles are updatable by owner" on public.profiles;
create policy "Profiles are updatable by owner"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "Dealers visible to members" on public.dealers;
create policy "Dealers visible to members"
on public.dealers for select
to authenticated
using (public.is_dealer_member(id));

drop policy if exists "Dealer owners can update dealer" on public.dealers;
create policy "Dealer owners can update dealer"
on public.dealers for update
to authenticated
using (exists (
  select 1 from public.dealer_members dm
  where dm.dealer_id = dealers.id and dm.user_id = auth.uid() and dm.role in ('owner','admin')
))
with check (exists (
  select 1 from public.dealer_members dm
  where dm.dealer_id = dealers.id and dm.user_id = auth.uid() and dm.role in ('owner','admin')
));

drop policy if exists "Members can see own memberships" on public.dealer_members;
create policy "Members can see own memberships"
on public.dealer_members for select
to authenticated
using (user_id = auth.uid() or public.is_dealer_member(dealer_id));

drop policy if exists "Dealer app state visible to members" on public.dealer_app_state;
create policy "Dealer app state visible to members"
on public.dealer_app_state for select
to authenticated
using (public.is_dealer_member(dealer_id));

drop policy if exists "Dealer app state insertable by members" on public.dealer_app_state;
create policy "Dealer app state insertable by members"
on public.dealer_app_state for insert
to authenticated
with check (public.is_dealer_member(dealer_id));

drop policy if exists "Dealer app state updatable by members" on public.dealer_app_state;
create policy "Dealer app state updatable by members"
on public.dealer_app_state for update
to authenticated
using (public.is_dealer_member(dealer_id))
with check (public.is_dealer_member(dealer_id));

revoke all on function public.ensure_dealer_workspace(text) from public;
grant execute on function public.ensure_dealer_workspace(text) to authenticated;

-- Phase 2 — API auth usage/quota tracking
create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  dealer_id uuid not null references public.dealers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  units integer not null default 1 check (units > 0),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists usage_events_dealer_event_created_idx
on public.usage_events(dealer_id, event_type, created_at desc);

create index if not exists usage_events_user_created_idx
on public.usage_events(user_id, created_at desc);

alter table public.usage_events enable row level security;

drop policy if exists "Usage visible to dealer members" on public.usage_events;
create policy "Usage visible to dealer members"
on public.usage_events for select
to authenticated
using (public.is_dealer_member(dealer_id));

-- Browser clients do not insert usage directly; serverless API uses service role.
-- This policy is intentionally absent for insert/update/delete from anon/authenticated clients.
-- SmartQuote Phase 3 — trial/subscription fields and plan gates
-- Run this in Supabase SQL Editor if you already ran schema.sql before Phase 3.

alter table public.dealers add column if not exists trial_ends_at timestamptz;
alter table public.dealers add column if not exists subscription_status text not null default 'trialing';
alter table public.dealers add column if not exists current_period_end timestamptz;
alter table public.dealers add column if not exists plan_started_at timestamptz;

update public.dealers
set trial_ends_at = coalesce(trial_ends_at, created_at + interval '7 days'),
    subscription_status = coalesce(nullif(subscription_status, ''), case when plan = 'trial' then 'trialing' else 'active' end),
    plan_started_at = coalesce(plan_started_at, created_at)
where trial_ends_at is null
   or subscription_status is null
   or subscription_status = ''
   or plan_started_at is null;

alter table public.dealers
  alter column trial_ends_at set default (now() + interval '7 days'),
  alter column subscription_status set default 'trialing',
  alter column plan_started_at set default now();

create index if not exists dealers_plan_status_idx on public.dealers(plan, subscription_status, trial_ends_at);

create or replace function public.ensure_dealer_workspace(dealer_name_input text default 'Đại lý SmartQuote')
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid := auth.uid();
  existing_dealer_id uuid;
  new_dealer_id uuid;
  auth_email text;
  auth_full_name text;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select dm.dealer_id
  into existing_dealer_id
  from public.dealer_members dm
  where dm.user_id = current_user_id
  order by dm.created_at asc
  limit 1;

  if existing_dealer_id is not null then
    return existing_dealer_id;
  end if;

  select email, raw_user_meta_data->>'full_name'
  into auth_email, auth_full_name
  from auth.users
  where id = current_user_id;

  insert into public.profiles (id, email, full_name)
  values (current_user_id, auth_email, coalesce(auth_full_name, ''))
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.profiles.full_name);

  insert into public.dealers (name, plan, subscription_status, trial_ends_at, plan_started_at)
  values (
    coalesce(nullif(trim(dealer_name_input), ''), 'Đại lý SmartQuote'),
    'trial',
    'trialing',
    now() + interval '7 days',
    now()
  )
  returning id into new_dealer_id;

  insert into public.dealer_members (dealer_id, user_id, role)
  values (new_dealer_id, current_user_id, 'owner');

  insert into public.dealer_app_state (dealer_id)
  values (new_dealer_id);

  return new_dealer_id;
end;
$$;

revoke all on function public.ensure_dealer_workspace(text) from public;
grant execute on function public.ensure_dealer_workspace(text) to authenticated;
-- SmartQuote Phase 4 — cloud quote history, customers, and quote quota enforcement
-- Run this in Supabase SQL Editor if you already ran schema.sql through Phase 3.

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  dealer_id uuid not null references public.dealers(id) on delete cascade,
  name text not null default '',
  phone text,
  address text,
  meta jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customers_dealer_phone_idx on public.customers(dealer_id, phone);
create index if not exists customers_dealer_name_idx on public.customers(dealer_id, name);

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  dealer_id uuid not null references public.dealers(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  quote_number text,
  customer_name text,
  customer_phone text,
  customer_address text,
  project_name text,
  category text,
  status text not null default 'draft' check (status in ('draft','sent','won','lost')),
  subtotal numeric not null default 0,
  labor_total numeric not null default 0,
  total numeric not null default 0,
  point_count integer not null default 0,
  rooms jsonb not null default '[]'::jsonb,
  customer jsonb not null default '{}'::jsonb,
  calc jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists quotes_dealer_updated_idx on public.quotes(dealer_id, updated_at desc);
create index if not exists quotes_dealer_status_idx on public.quotes(dealer_id, status, updated_at desc);
create index if not exists quotes_customer_idx on public.quotes(customer_id);

alter table public.customers enable row level security;
alter table public.quotes enable row level security;

drop trigger if exists customers_touch_updated_at on public.customers;
create trigger customers_touch_updated_at
before update on public.customers
for each row execute function public.touch_updated_at();

drop trigger if exists quotes_touch_updated_at on public.quotes;
create trigger quotes_touch_updated_at
before update on public.quotes
for each row execute function public.touch_updated_at();

drop policy if exists "Customers visible to dealer members" on public.customers;
create policy "Customers visible to dealer members"
on public.customers for select
to authenticated
using (public.is_dealer_member(dealer_id));

drop policy if exists "Quotes visible to dealer members" on public.quotes;
create policy "Quotes visible to dealer members"
on public.quotes for select
to authenticated
using (public.is_dealer_member(dealer_id));

drop policy if exists "Quotes deletable by dealer members" on public.quotes;
create policy "Quotes deletable by dealer members"
on public.quotes for delete
to authenticated
using (public.is_dealer_member(dealer_id));

-- Quote writes go through this RPC so users cannot bypass quote quota by direct insert.
create or replace function public.quote_monthly_limit(plan_input text)
returns integer
language sql
immutable
as $$
  select case lower(coalesce(plan_input, 'trial'))
    when 'trial' then 5
    when 'starter' then 30
    when 'pro' then -1
    when 'business' then -1
    else 0
  end;
$$;

create or replace function public.save_quote(quote_input jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid := auth.uid();
  target_dealer_id uuid;
  target_quote_id uuid;
  target_customer_id uuid;
  dealer_plan text;
  dealer_status text;
  dealer_trial_ends_at timestamptz;
  dealer_current_period_end timestamptz;
  quote_limit integer;
  quote_used integer;
  customer_name_input text;
  customer_phone_input text;
  is_new boolean := false;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  target_dealer_id := nullif(quote_input->>'dealer_id', '')::uuid;
  if target_dealer_id is null or not public.is_dealer_member(target_dealer_id) then
    raise exception 'Not a member of this dealer workspace';
  end if;

  select plan, subscription_status, trial_ends_at, current_period_end
  into dealer_plan, dealer_status, dealer_trial_ends_at, dealer_current_period_end
  from public.dealers
  where id = target_dealer_id;

  dealer_plan := lower(coalesce(dealer_plan, 'trial'));
  dealer_status := lower(coalesce(dealer_status, case when dealer_plan = 'trial' then 'trialing' else 'active' end));

  if dealer_plan = 'expired'
     or dealer_status in ('expired','canceled','past_due','unpaid')
     or (dealer_plan = 'trial' and dealer_trial_ends_at is not null and dealer_trial_ends_at <= now())
     or (dealer_plan <> 'trial' and dealer_current_period_end is not null and dealer_current_period_end <= now()) then
    raise exception 'Workspace đã hết hạn hoặc bị khóa. Vui lòng nâng cấp/gia hạn gói.';
  end if;

  target_quote_id := nullif(quote_input->>'id', '')::uuid;
  customer_name_input := coalesce(nullif(trim(quote_input->>'customer_name'), ''), nullif(trim((quote_input->'customer'->>'name')), ''), '');
  customer_phone_input := nullif(trim(coalesce(quote_input->>'customer_phone', quote_input->'customer'->>'phone', '')), '');
  target_customer_id := nullif(coalesce(quote_input->>'customer_id', quote_input->'customer'->>'customerId'), '')::uuid;

  if target_customer_id is not null then
    update public.customers
    set name = coalesce(nullif(customer_name_input, ''), name),
        phone = coalesce(customer_phone_input, phone),
        address = coalesce(nullif(quote_input->>'customer_address', ''), address),
        meta = coalesce(quote_input->'customer', meta)
    where id = target_customer_id
      and dealer_id = target_dealer_id;
    if not found then
      target_customer_id := null;
    end if;
  end if;

  if target_customer_id is null and customer_phone_input is not null then
    select id into target_customer_id
    from public.customers
    where dealer_id = target_dealer_id and phone = customer_phone_input
    order by updated_at desc
    limit 1;
  end if;

  if target_customer_id is null and nullif(customer_name_input, '') is not null then
    insert into public.customers (dealer_id, name, phone, address, meta, created_by)
    values (
      target_dealer_id,
      customer_name_input,
      customer_phone_input,
      nullif(quote_input->>'customer_address', ''),
      coalesce(quote_input->'customer', '{}'::jsonb),
      current_user_id
    )
    returning id into target_customer_id;
  elsif target_customer_id is not null then
    update public.customers
    set name = coalesce(nullif(customer_name_input, ''), name),
        phone = coalesce(customer_phone_input, phone),
        address = coalesce(nullif(quote_input->>'customer_address', ''), address),
        meta = coalesce(quote_input->'customer', meta)
    where id = target_customer_id and dealer_id = target_dealer_id;
  end if;

  if target_quote_id is null then
    is_new := true;
    quote_limit := public.quote_monthly_limit(dealer_plan);
    if quote_limit >= 0 then
      select coalesce(sum(units), 0)::integer
      into quote_used
      from public.usage_events
      where dealer_id = target_dealer_id
        and event_type = 'quotes_per_month'
        and created_at >= date_trunc('month', now());
      if quote_used + 1 > quote_limit then
        raise exception 'Đã vượt quota báo giá/tháng của gói %. Đã dùng %/% trong tháng này.', dealer_plan, quote_used, quote_limit;
      end if;
    end if;

    insert into public.quotes (
      dealer_id, customer_id, quote_number, customer_name, customer_phone, customer_address,
      project_name, category, status, subtotal, labor_total, total, point_count,
      rooms, customer, calc, created_by, updated_by
    ) values (
      target_dealer_id,
      target_customer_id,
      nullif(trim(quote_input->>'quote_number'), ''),
      nullif(customer_name_input, ''),
      customer_phone_input,
      nullif(trim(quote_input->>'customer_address'), ''),
      nullif(trim(quote_input->>'project_name'), ''),
      nullif(trim(quote_input->>'category'), ''),
      coalesce(nullif(quote_input->>'status', ''), 'draft'),
      coalesce((quote_input->>'subtotal')::numeric, 0),
      coalesce((quote_input->>'labor_total')::numeric, 0),
      coalesce((quote_input->>'total')::numeric, 0),
      coalesce((quote_input->>'point_count')::integer, 0),
      coalesce(quote_input->'rooms', '[]'::jsonb),
      coalesce(quote_input->'customer', '{}'::jsonb),
      coalesce(quote_input->'calc', '{}'::jsonb),
      current_user_id,
      current_user_id
    ) returning id into target_quote_id;

    insert into public.usage_events (dealer_id, user_id, event_type, units, meta)
    values (target_dealer_id, current_user_id, 'quotes_per_month', 1, jsonb_build_object('quote_id', target_quote_id));
  else
    update public.quotes
    set customer_id = target_customer_id,
        quote_number = nullif(trim(quote_input->>'quote_number'), ''),
        customer_name = nullif(customer_name_input, ''),
        customer_phone = customer_phone_input,
        customer_address = nullif(trim(quote_input->>'customer_address'), ''),
        project_name = nullif(trim(quote_input->>'project_name'), ''),
        category = nullif(trim(quote_input->>'category'), ''),
        status = coalesce(nullif(quote_input->>'status', ''), status),
        subtotal = coalesce((quote_input->>'subtotal')::numeric, subtotal),
        labor_total = coalesce((quote_input->>'labor_total')::numeric, labor_total),
        total = coalesce((quote_input->>'total')::numeric, total),
        point_count = coalesce((quote_input->>'point_count')::integer, point_count),
        rooms = coalesce(quote_input->'rooms', rooms),
        customer = coalesce(quote_input->'customer', customer),
        calc = coalesce(quote_input->'calc', calc),
        updated_by = current_user_id
    where id = target_quote_id
      and dealer_id = target_dealer_id;

    if not found then
      raise exception 'Quote not found in this dealer workspace';
    end if;
  end if;

  return target_quote_id;
end;
$$;

revoke all on function public.save_quote(jsonb) from public;
grant execute on function public.save_quote(jsonb) to authenticated;
-- SmartQuote Phase 5 — catalog_items table + import logs
-- Run this in Supabase SQL Editor if you already ran schema.sql through Phase 4.

create table if not exists public.catalog_items (
  dealer_id uuid not null references public.dealers(id) on delete cascade,
  id text not null,
  name text not null,
  sku text,
  supplier text,
  brand text,
  category text,
  unit text not null default 'Cái',
  cost_price numeric not null default 0,
  list_price numeric not null default 0,
  public_price numeric not null default 0,
  min_retail_price numeric not null default 0,
  price_mode text not null default 'markup',
  image_url text,
  source_url text,
  specs jsonb not null default '{}'::jsonb,
  raw_product jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (dealer_id, id)
);

create index if not exists catalog_items_dealer_updated_idx on public.catalog_items(dealer_id, updated_at desc);
create index if not exists catalog_items_dealer_sku_idx on public.catalog_items(dealer_id, lower(coalesce(sku, '')));
create index if not exists catalog_items_dealer_supplier_idx on public.catalog_items(dealer_id, supplier);
create index if not exists catalog_items_dealer_category_idx on public.catalog_items(dealer_id, category);

create table if not exists public.imports (
  id uuid primary key default gen_random_uuid(),
  dealer_id uuid not null references public.dealers(id) on delete cascade,
  source_type text not null default 'manual',
  source_name text,
  merge_mode text not null default 'merge',
  status text not null default 'applied',
  total_rows integer not null default 0,
  clean_rows integer not null default 0,
  review_rows integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists imports_dealer_created_idx on public.imports(dealer_id, created_at desc);
create index if not exists imports_dealer_source_idx on public.imports(dealer_id, source_type, created_at desc);

create table if not exists public.import_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.imports(id) on delete cascade,
  dealer_id uuid not null references public.dealers(id) on delete cascade,
  product_id text,
  raw_data jsonb not null default '{}'::jsonb,
  parsed_data jsonb not null default '{}'::jsonb,
  status text not null default 'clean',
  issue_reason text,
  created_at timestamptz not null default now()
);

create index if not exists import_rows_import_idx on public.import_rows(import_id);
create index if not exists import_rows_dealer_created_idx on public.import_rows(dealer_id, created_at desc);

alter table public.catalog_items enable row level security;
alter table public.imports enable row level security;
alter table public.import_rows enable row level security;

drop trigger if exists catalog_items_touch_updated_at on public.catalog_items;
create trigger catalog_items_touch_updated_at
before update on public.catalog_items
for each row execute function public.touch_updated_at();

drop policy if exists "Catalog visible to dealer members" on public.catalog_items;
create policy "Catalog visible to dealer members"
on public.catalog_items for select
to authenticated
using (public.is_dealer_member(dealer_id));

drop policy if exists "Catalog deletable by dealer admins" on public.catalog_items;
create policy "Catalog deletable by dealer admins"
on public.catalog_items for delete
to authenticated
using (public.is_dealer_member(dealer_id));

-- Writes go through sync_catalog_items() so plan limits are enforced.

drop policy if exists "Imports visible to dealer members" on public.imports;
create policy "Imports visible to dealer members"
on public.imports for select
to authenticated
using (public.is_dealer_member(dealer_id));

drop policy if exists "Import rows visible to dealer members" on public.import_rows;
create policy "Import rows visible to dealer members"
on public.import_rows for select
to authenticated
using (public.is_dealer_member(dealer_id));

create or replace function public.product_catalog_limit(plan_input text)
returns integer
language sql
immutable
as $$
  select case lower(coalesce(plan_input, 'trial'))
    when 'trial' then 100
    when 'starter' then 1500
    when 'pro' then 10000
    when 'business' then 50000
    else 0
  end;
$$;

create or replace function public.log_catalog_import(target_dealer_id uuid, import_input jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid := auth.uid();
  new_import_id uuid;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if target_dealer_id is null or not public.is_dealer_member(target_dealer_id) then
    raise exception 'Not a member of this dealer workspace';
  end if;

  insert into public.imports (
    dealer_id, source_type, source_name, merge_mode, status,
    total_rows, clean_rows, review_rows, created_by
  ) values (
    target_dealer_id,
    coalesce(nullif(import_input->>'source_type', ''), 'manual'),
    nullif(import_input->>'source_name', ''),
    coalesce(nullif(import_input->>'merge_mode', ''), 'merge'),
    coalesce(nullif(import_input->>'status', ''), 'applied'),
    coalesce((import_input->>'total_rows')::integer, jsonb_array_length(coalesce(import_input->'rows', '[]'::jsonb))),
    coalesce((import_input->>'clean_rows')::integer, jsonb_array_length(coalesce(import_input->'rows', '[]'::jsonb))),
    coalesce((import_input->>'review_rows')::integer, 0),
    current_user_id
  ) returning id into new_import_id;

  insert into public.import_rows (import_id, dealer_id, product_id, raw_data, parsed_data, status, issue_reason)
  select
    new_import_id,
    target_dealer_id,
    nullif(x.id, ''),
    coalesce(x.raw_product, '{}'::jsonb),
    to_jsonb(x),
    coalesce(nullif(x.status, ''), 'clean'),
    nullif(x.issue_reason, '')
  from jsonb_to_recordset(coalesce(import_input->'rows', '[]'::jsonb)) as x(
    id text,
    name text,
    sku text,
    supplier text,
    brand text,
    category text,
    unit text,
    cost_price numeric,
    list_price numeric,
    public_price numeric,
    min_retail_price numeric,
    price_mode text,
    image_url text,
    source_url text,
    specs jsonb,
    raw_product jsonb,
    status text,
    issue_reason text
  );

  return new_import_id;
end;
$$;

create or replace function public.sync_catalog_items(
  target_dealer_id uuid,
  catalog_items_input jsonb,
  sync_mode text default 'snapshot',
  import_input jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid := auth.uid();
  dealer_plan text;
  dealer_status text;
  dealer_trial_ends_at timestamptz;
  dealer_current_period_end timestamptz;
  item_count integer;
  limit_count integer;
  normalized_mode text := lower(coalesce(sync_mode, 'snapshot'));
  import_id uuid;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if target_dealer_id is null or not public.is_dealer_member(target_dealer_id) then
    raise exception 'Not a member of this dealer workspace';
  end if;

  select plan, subscription_status, trial_ends_at, current_period_end
  into dealer_plan, dealer_status, dealer_trial_ends_at, dealer_current_period_end
  from public.dealers
  where id = target_dealer_id;

  dealer_plan := lower(coalesce(dealer_plan, 'trial'));
  dealer_status := lower(coalesce(dealer_status, case when dealer_plan = 'trial' then 'trialing' else 'active' end));

  if dealer_plan = 'expired'
     or dealer_status in ('expired','canceled','past_due','unpaid')
     or (dealer_plan = 'trial' and dealer_trial_ends_at is not null and dealer_trial_ends_at <= now())
     or (dealer_plan <> 'trial' and dealer_current_period_end is not null and dealer_current_period_end <= now()) then
    raise exception 'Workspace đã hết hạn hoặc bị khóa. Vui lòng nâng cấp/gia hạn gói.';
  end if;

  item_count := jsonb_array_length(coalesce(catalog_items_input, '[]'::jsonb));
  limit_count := public.product_catalog_limit(dealer_plan);
  if limit_count >= 0 and item_count > limit_count then
    raise exception 'Đã vượt giới hạn catalog của gói %. Đang có %/% sản phẩm.', dealer_plan, item_count, limit_count;
  end if;

  if normalized_mode in ('replace','snapshot') then
    delete from public.catalog_items ci
    where ci.dealer_id = target_dealer_id
      and not exists (
        select 1
        from jsonb_to_recordset(coalesce(catalog_items_input, '[]'::jsonb)) as x(id text)
        where x.id = ci.id
      );
  end if;

  insert into public.catalog_items (
    dealer_id, id, name, sku, supplier, brand, category, unit,
    cost_price, list_price, public_price, min_retail_price, price_mode,
    image_url, source_url, specs, raw_product, created_by, updated_by
  )
  select
    target_dealer_id,
    nullif(x.id, ''),
    coalesce(nullif(x.name, ''), nullif(x.sku, ''), 'Sản phẩm'),
    nullif(x.sku, ''),
    nullif(x.supplier, ''),
    nullif(x.brand, ''),
    nullif(x.category, ''),
    coalesce(nullif(x.unit, ''), 'Cái'),
    coalesce(x.cost_price, 0),
    coalesce(x.list_price, 0),
    coalesce(x.public_price, 0),
    coalesce(x.min_retail_price, 0),
    coalesce(nullif(x.price_mode, ''), 'markup'),
    nullif(x.image_url, ''),
    nullif(x.source_url, ''),
    coalesce(x.specs, '{}'::jsonb),
    coalesce(x.raw_product, to_jsonb(x)),
    current_user_id,
    current_user_id
  from jsonb_to_recordset(coalesce(catalog_items_input, '[]'::jsonb)) as x(
    id text,
    name text,
    sku text,
    supplier text,
    brand text,
    category text,
    unit text,
    cost_price numeric,
    list_price numeric,
    public_price numeric,
    min_retail_price numeric,
    price_mode text,
    image_url text,
    source_url text,
    specs jsonb,
    raw_product jsonb
  )
  where nullif(x.id, '') is not null
  on conflict (dealer_id, id) do update set
    name = excluded.name,
    sku = excluded.sku,
    supplier = excluded.supplier,
    brand = excluded.brand,
    category = excluded.category,
    unit = excluded.unit,
    cost_price = excluded.cost_price,
    list_price = excluded.list_price,
    public_price = excluded.public_price,
    min_retail_price = excluded.min_retail_price,
    price_mode = excluded.price_mode,
    image_url = excluded.image_url,
    source_url = excluded.source_url,
    specs = excluded.specs,
    raw_product = excluded.raw_product,
    updated_by = current_user_id;

  if import_input is not null then
    import_id := public.log_catalog_import(
      target_dealer_id,
      jsonb_set(
        jsonb_set(import_input, '{total_rows}', to_jsonb(item_count), true),
        '{rows}',
        coalesce(catalog_items_input, '[]'::jsonb),
        true
      )
    );
  end if;

  return jsonb_build_object('count', item_count, 'mode', normalized_mode, 'import_id', import_id);
end;
$$;

revoke all on function public.log_catalog_import(uuid, jsonb) from public;
revoke all on function public.sync_catalog_items(uuid, jsonb, text, jsonb) from public;
grant execute on function public.log_catalog_import(uuid, jsonb) to authenticated;
grant execute on function public.sync_catalog_items(uuid, jsonb, text, jsonb) to authenticated;
-- SmartQuote Phase 6 — manual payment requests and admin activation
-- Run this in Supabase SQL Editor if you already ran schema.sql through Phase 5.

create table if not exists public.billing_events (
  id uuid primary key default gen_random_uuid(),
  dealer_id uuid not null references public.dealers(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  plan text not null check (plan in ('starter','pro','business')),
  billing_cycle text not null default 'monthly' check (billing_cycle in ('monthly','annual')),
  months integer not null default 1 check (months > 0),
  amount_vnd integer not null check (amount_vnd >= 0),
  status text not null default 'pending' check (status in ('pending','paid','approved','activated','rejected','canceled')),
  transfer_content text not null,
  customer_note text,
  customer_contact text,
  admin_note text,
  payment_reference text,
  activated_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists billing_events_dealer_created_idx
on public.billing_events(dealer_id, created_at desc);

create index if not exists billing_events_status_created_idx
on public.billing_events(status, created_at desc);

create unique index if not exists billing_events_transfer_content_uidx
on public.billing_events(transfer_content);

alter table public.billing_events enable row level security;

drop trigger if exists billing_events_touch_updated_at on public.billing_events;
create trigger billing_events_touch_updated_at
before update on public.billing_events
for each row execute function public.touch_updated_at();

drop policy if exists "Billing events visible to dealer members" on public.billing_events;
create policy "Billing events visible to dealer members"
on public.billing_events for select
to authenticated
using (public.is_dealer_member(dealer_id));

-- Browser clients create billing requests through create_manual_billing_request().
-- There is intentionally no insert/update/delete policy for authenticated clients.

create or replace function public.smartquote_plan_price_vnd(plan_input text, billing_cycle_input text default 'monthly')
returns integer
language plpgsql
stable
as $$
declare
  result integer;
begin
  if to_regclass('public.plan_catalog') is null then
    raise exception 'plan_catalog chưa được cấu hình. Hãy chạy supabase/phase8_1_plan_limits_source.sql trước.';
  end if;

  select case lower(coalesce(billing_cycle_input, 'monthly'))
    when 'annual' then pc.price_annual_vnd
    else pc.price_monthly_vnd
  end
  into result
  from public.plan_catalog pc
  where pc.plan = lower(coalesce(plan_input, ''))
    and pc.plan in ('starter','pro','business')
  limit 1;

  return coalesce(result, 0);
end;
$$;

create or replace function public.create_manual_billing_request(
  target_dealer_id uuid,
  requested_plan text,
  billing_cycle_input text default 'monthly',
  customer_note_input text default '',
  customer_contact_input text default ''
)
returns table (
  id uuid,
  dealer_id uuid,
  plan text,
  billing_cycle text,
  months integer,
  amount_vnd integer,
  status text,
  transfer_content text,
  customer_note text,
  customer_contact text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_plan text := lower(coalesce(requested_plan, ''));
  normalized_cycle text := lower(coalesce(billing_cycle_input, 'monthly'));
  new_id uuid := gen_random_uuid();
  price integer;
  cycle_months integer;
  content text;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if target_dealer_id is null or not public.is_dealer_member(target_dealer_id) then
    raise exception 'Not a member of this dealer workspace';
  end if;
  if normalized_plan not in ('starter','pro','business') then
    raise exception 'Gói không hợp lệ';
  end if;
  if normalized_cycle not in ('monthly','annual') then
    normalized_cycle := 'monthly';
  end if;

  cycle_months := case when normalized_cycle = 'annual' then 12 else 1 end;
  price := public.smartquote_plan_price_vnd(normalized_plan, normalized_cycle);
  if price <= 0 then
    raise exception 'Không tính được giá gói';
  end if;

  content := 'SQ-' || upper(substr(replace(new_id::text, '-', ''), 1, 8)) || '-' || upper(normalized_plan) || case when normalized_cycle = 'annual' then '-NAM' else '-THANG' end;

  insert into public.billing_events (
    id, dealer_id, user_id, plan, billing_cycle, months, amount_vnd,
    status, transfer_content, customer_note, customer_contact
  ) values (
    new_id, target_dealer_id, current_user_id, normalized_plan, normalized_cycle, cycle_months, price,
    'pending', content, nullif(customer_note_input, ''), nullif(customer_contact_input, '')
  );

  return query
  select be.id, be.dealer_id, be.plan, be.billing_cycle, be.months, be.amount_vnd,
         be.status, be.transfer_content, be.customer_note, be.customer_contact, be.created_at
  from public.billing_events be
  where be.id = new_id;
end;
$$;

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

  amount := public.smartquote_plan_price_vnd(normalized_plan, case when normalized_months >= 12 then 'annual' else 'monthly' end);

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

revoke all on table public.billing_events from anon, authenticated;
grant select on table public.billing_events to authenticated;

revoke all on function public.create_manual_billing_request(uuid, text, text, text, text) from public;
grant execute on function public.create_manual_billing_request(uuid, text, text, text, text) to authenticated;

-- Admin functions are intentionally NOT granted to anon/authenticated.
-- Run them only from Supabase SQL Editor/service role after you verify payment.
revoke all on function public.admin_activate_manual_billing_event(uuid, text, text) from public;
revoke all on function public.admin_activate_dealer_plan(uuid, text, integer, text) from public;
-- Phase 7 — production hardening: DB-backed per-minute rate limit + API logs.
-- Run after Phase 6 if you are upgrading an existing Supabase project.

create table if not exists public.api_rate_limits (
  bucket_key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (bucket_key, window_start)
);

create index if not exists api_rate_limits_updated_at_idx
  on public.api_rate_limits (updated_at desc);

alter table public.api_rate_limits enable row level security;
revoke all on table public.api_rate_limits from anon, authenticated;

create or replace function public.smartquote_increment_rate_limit(
  p_key text,
  p_window_start timestamptz,
  p_limit integer,
  p_increment integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  next_count integer;
  normalized_limit integer := greatest(0, coalesce(p_limit, 0));
  normalized_increment integer := greatest(1, least(coalesce(p_increment, 1), 100));
begin
  if p_key is null or length(trim(p_key)) = 0 then
    raise exception 'Missing rate limit key';
  end if;

  insert into public.api_rate_limits (bucket_key, window_start, count, updated_at)
  values (left(p_key, 300), date_trunc('minute', p_window_start), normalized_increment, now())
  on conflict (bucket_key, window_start)
  do update set
    count = public.api_rate_limits.count + normalized_increment,
    updated_at = now()
  returning count into next_count;

  -- Opportunistic cleanup; keep table small without cron.
  delete from public.api_rate_limits
  where updated_at < now() - interval '2 days';

  return jsonb_build_object(
    'allowed', next_count <= normalized_limit,
    'count', next_count,
    'limit', normalized_limit,
    'reset_at', date_trunc('minute', p_window_start) + interval '1 minute'
  );
end;
$$;

revoke all on function public.smartquote_increment_rate_limit(text, timestamptz, integer, integer) from public;
grant execute on function public.smartquote_increment_rate_limit(text, timestamptz, integer, integer) to service_role;

create table if not exists public.api_logs (
  id uuid primary key default gen_random_uuid(),
  dealer_id uuid references public.dealers(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  request_id text,
  route text not null,
  event_type text,
  method text,
  status_code integer,
  duration_ms integer,
  error_message text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists api_logs_dealer_created_idx
  on public.api_logs (dealer_id, created_at desc);
create index if not exists api_logs_route_created_idx
  on public.api_logs (route, created_at desc);
create index if not exists api_logs_status_created_idx
  on public.api_logs (status_code, created_at desc);

alter table public.api_logs enable row level security;
revoke all on table public.api_logs from anon, authenticated;

-- Optional maintenance helper for SQL Editor/service role.
create or replace function public.admin_prune_api_logs(retention_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.api_logs
  where created_at < now() - make_interval(days => greatest(1, coalesce(retention_days, 30)));
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.admin_prune_api_logs(integer) from public;


-- SmartQuote Phase 7.1 — Production Must-Fix Pack
-- Run after Phase 7. This file adds atomic API quota consumption.
-- Important: this package also updates phase4_quotes.sql and phase5_catalog_items.sql
-- so paid plans are locked when current_period_end is past even if status is still active.

create or replace function public.usage_monthly_limit(plan_input text, event_type_input text)
returns integer
language plpgsql
stable
as $$
declare
  result integer;
begin
  if to_regclass('public.plan_limit_catalog') is null then
    raise exception 'plan_limit_catalog chưa được cấu hình. Hãy chạy supabase/phase8_1_plan_limits_source.sql trước.';
  end if;

  select plc.limit_value
  into result
  from public.plan_limit_catalog plc
  where plc.plan = lower(coalesce(plan_input, 'trial'))
    and plc.feature = event_type_input
    and plc.limit_scope = 'monthly'
  limit 1;

  return coalesce(result, 0);
end;
$$;

create or replace function public.consume_usage_quota(
  target_dealer_id uuid,
  target_user_id uuid,
  target_event_type text,
  requested_units integer default 1,
  event_meta jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  normalized_units integer := greatest(1, least(coalesce(requested_units, 1), 10000));
  dealer_plan text;
  dealer_status text;
  dealer_trial_ends_at timestamptz;
  dealer_current_period_end timestamptz;
  monthly_limit integer;
  used_units integer;
  event_id uuid;
  month_start timestamptz := date_trunc('month', now());
begin
  if target_dealer_id is null or target_user_id is null then
    raise exception 'Missing dealer/user for quota check';
  end if;

  if not exists (
    select 1 from public.dealer_members dm
    where dm.dealer_id = target_dealer_id and dm.user_id = target_user_id
  ) then
    raise exception 'Not a member of this dealer workspace';
  end if;

  select plan, subscription_status, trial_ends_at, current_period_end
  into dealer_plan, dealer_status, dealer_trial_ends_at, dealer_current_period_end
  from public.dealers
  where id = target_dealer_id;

  dealer_plan := lower(coalesce(dealer_plan, 'trial'));
  dealer_status := lower(coalesce(dealer_status, case when dealer_plan = 'trial' then 'trialing' else 'active' end));

  if dealer_plan = 'expired'
     or dealer_status in ('expired','canceled','past_due','unpaid')
     or (dealer_plan = 'trial' and dealer_trial_ends_at is not null and dealer_trial_ends_at <= now())
     or (dealer_plan <> 'trial' and dealer_current_period_end is not null and dealer_current_period_end <= now()) then
    raise exception 'Workspace đã hết hạn hoặc bị khóa. Vui lòng nâng cấp/gia hạn gói.';
  end if;

  monthly_limit := public.usage_monthly_limit(dealer_plan, target_event_type);
  if monthly_limit < 0 then
    insert into public.usage_events (dealer_id, user_id, event_type, units, meta)
    values (target_dealer_id, target_user_id, target_event_type, normalized_units, coalesce(event_meta, '{}'::jsonb))
    returning id into event_id;
    return jsonb_build_object('allowed', true, 'event_id', event_id, 'plan', dealer_plan, 'limit', monthly_limit, 'used_before', 0, 'remaining', -1, 'consumed_at', now());
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_dealer_id::text || ':' || target_event_type || ':' || month_start::text, 0));

  select coalesce(sum(units), 0)::integer
  into used_units
  from public.usage_events
  where dealer_id = target_dealer_id
    and event_type = target_event_type
    and created_at >= month_start;

  if used_units + normalized_units > monthly_limit then
    raise exception 'Đã vượt quota % của gói %. Đã dùng %/% trong tháng này.', target_event_type, dealer_plan, used_units, monthly_limit;
  end if;

  insert into public.usage_events (dealer_id, user_id, event_type, units, meta)
  values (target_dealer_id, target_user_id, target_event_type, normalized_units, coalesce(event_meta, '{}'::jsonb))
  returning id into event_id;

  return jsonb_build_object(
    'allowed', true,
    'event_id', event_id,
    'plan', dealer_plan,
    'limit', monthly_limit,
    'used_before', used_units,
    'requested', normalized_units,
    'remaining', greatest(0, monthly_limit - used_units - normalized_units),
    'consumed_at', now()
  );
end;
$$;

revoke all on function public.usage_monthly_limit(text, text) from public;
revoke all on function public.consume_usage_quota(uuid, uuid, text, integer, jsonb) from public;
grant execute on function public.consume_usage_quota(uuid, uuid, text, integer, jsonb) to authenticated;
grant execute on function public.consume_usage_quota(uuid, uuid, text, integer, jsonb) to service_role;

-- SmartQuote Phase 8.1 — SQL source of truth for plan prices and quotas
-- Run after Phase 8. From now on, this SQL catalog is the canonical source
-- for plan pricing/quota. JS/Python generated files are smoke-tested against it.

create table if not exists public.plan_catalog (
  plan text primary key,
  label text not null,
  price_monthly_vnd integer not null default 0,
  price_annual_vnd integer not null default 0,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.plan_limit_catalog (
  plan text not null references public.plan_catalog(plan) on delete cascade,
  feature text not null,
  limit_scope text not null check (limit_scope in ('monthly','absolute')),
  limit_value integer not null,
  updated_at timestamptz not null default now(),
  primary key (plan, feature)
);

insert into public.plan_catalog (plan, label, price_monthly_vnd, price_annual_vnd, sort_order)
values
  ('trial', 'Trial', 0, 0, 0),
  ('starter', 'Starter', 499000, 4990000, 1),
  ('pro', 'Pro', 899000, 8990000, 2),
  ('business', 'Business', 1899000, 18990000, 3),
  ('expired', 'Expired', 0, 0, 99)
on conflict (plan) do update set
  label = excluded.label,
  price_monthly_vnd = excluded.price_monthly_vnd,
  price_annual_vnd = excluded.price_annual_vnd,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.plan_limit_catalog (plan, feature, limit_scope, limit_value)
values
  ('trial', 'seats', 'absolute', 1),
  ('trial', 'products', 'absolute', 100),
  ('trial', 'quotes_per_month', 'monthly', 5),
  ('trial', 'ai_claude_request', 'monthly', 50),
  ('trial', 'web_scrape', 'monthly', 3),
  ('trial', 'product_enrich', 'monthly', 5),
  ('trial', 'pdf_extract', 'monthly', 3),
  ('trial', 'excel_export', 'monthly', 10),
  ('starter', 'seats', 'absolute', 1),
  ('starter', 'products', 'absolute', 1500),
  ('starter', 'quotes_per_month', 'monthly', 30),
  ('starter', 'ai_claude_request', 'monthly', 300),
  ('starter', 'web_scrape', 'monthly', 20),
  ('starter', 'product_enrich', 'monthly', 50),
  ('starter', 'pdf_extract', 'monthly', 10),
  ('starter', 'excel_export', 'monthly', 100),
  ('pro', 'seats', 'absolute', 3),
  ('pro', 'products', 'absolute', 10000),
  ('pro', 'quotes_per_month', 'monthly', -1),
  ('pro', 'ai_claude_request', 'monthly', 1500),
  ('pro', 'web_scrape', 'monthly', 100),
  ('pro', 'product_enrich', 'monthly', 250),
  ('pro', 'pdf_extract', 'monthly', 50),
  ('pro', 'excel_export', 'monthly', 1000),
  ('business', 'seats', 'absolute', 10),
  ('business', 'products', 'absolute', 50000),
  ('business', 'quotes_per_month', 'monthly', -1),
  ('business', 'ai_claude_request', 'monthly', 6000),
  ('business', 'web_scrape', 'monthly', 500),
  ('business', 'product_enrich', 'monthly', 1000),
  ('business', 'pdf_extract', 'monthly', 300),
  ('business', 'excel_export', 'monthly', 5000),
  ('expired', 'seats', 'absolute', 0),
  ('expired', 'products', 'absolute', 0),
  ('expired', 'quotes_per_month', 'monthly', 0),
  ('expired', 'ai_claude_request', 'monthly', 0),
  ('expired', 'web_scrape', 'monthly', 0),
  ('expired', 'product_enrich', 'monthly', 0),
  ('expired', 'pdf_extract', 'monthly', 0),
  ('expired', 'excel_export', 'monthly', 0)
on conflict (plan, feature) do update set
  limit_scope = excluded.limit_scope,
  limit_value = excluded.limit_value,
  updated_at = now();

create or replace function public.usage_monthly_limit(plan_input text, event_type_input text)
returns integer
language plpgsql
stable
as $$
declare
  result integer;
begin
  if to_regclass('public.plan_limit_catalog') is null then
    raise exception 'plan_limit_catalog chưa được cấu hình. Hãy chạy supabase/phase8_1_plan_limits_source.sql trước.';
  end if;

  select plc.limit_value
  into result
  from public.plan_limit_catalog plc
  where plc.plan = lower(coalesce(plan_input, 'trial'))
    and plc.feature = event_type_input
    and plc.limit_scope = 'monthly'
  limit 1;

  return coalesce(result, 0);
end;
$$;

-- Optional read access: this is pricing/quota metadata, not customer data.
alter table public.plan_catalog enable row level security;
alter table public.plan_limit_catalog enable row level security;

drop policy if exists "plan catalog is readable" on public.plan_catalog;
create policy "plan catalog is readable"
  on public.plan_catalog for select
  using (true);

drop policy if exists "plan limits are readable" on public.plan_limit_catalog;
create policy "plan limits are readable"
  on public.plan_limit_catalog for select
  using (true);

grant select on public.plan_catalog to anon, authenticated;
grant select on public.plan_limit_catalog to anon, authenticated;
revoke all on function public.usage_monthly_limit(text, text) from public;
grant execute on function public.usage_monthly_limit(text, text) to service_role;


-- SmartQuote Phase 8.2 — Quota source cleanup + external API cost tracking
-- Run after Phase 8.1. SQL remains the source of truth for pricing/quota.

-- Billing must read plan_catalog instead of carrying a second price table.
create or replace function public.smartquote_plan_price_vnd(plan_input text, billing_cycle_input text default 'monthly')
returns integer
language plpgsql
stable
as $$
declare
  result integer;
begin
  if to_regclass('public.plan_catalog') is null then
    raise exception 'plan_catalog chưa được cấu hình. Hãy chạy supabase/phase8_1_plan_limits_source.sql trước.';
  end if;

  select case lower(coalesce(billing_cycle_input, 'monthly'))
    when 'annual' then pc.price_annual_vnd
    else pc.price_monthly_vnd
  end
  into result
  from public.plan_catalog pc
  where pc.plan = lower(coalesce(plan_input, ''))
    and pc.plan in ('starter','pro','business')
  limit 1;

  return coalesce(result, 0);
end;
$$;

-- API quota must read plan_limit_catalog instead of CASE hard-codes.
create or replace function public.usage_monthly_limit(plan_input text, event_type_input text)
returns integer
language plpgsql
stable
as $$
declare
  result integer;
begin
  if to_regclass('public.plan_limit_catalog') is null then
    raise exception 'plan_limit_catalog chưa được cấu hình. Hãy chạy supabase/phase8_1_plan_limits_source.sql trước.';
  end if;

  select plc.limit_value
  into result
  from public.plan_limit_catalog plc
  where plc.plan = lower(coalesce(plan_input, 'trial'))
    and plc.feature = event_type_input
    and plc.limit_scope = 'monthly'
  limit 1;

  return coalesce(result, 0);
end;
$$;

revoke all on function public.smartquote_plan_price_vnd(text, text) from public;
grant execute on function public.smartquote_plan_price_vnd(text, text) to authenticated, service_role;
revoke all on function public.usage_monthly_limit(text, text) from public;
grant execute on function public.usage_monthly_limit(text, text) to service_role;

create table if not exists public.external_api_budget_catalog (
  provider text not null,
  plan text not null references public.plan_catalog(plan) on delete cascade,
  monthly_budget_usd numeric(12,6) not null default 0,
  unit_cost_usd numeric(12,6) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (provider, plan)
);

insert into public.external_api_budget_catalog (provider, plan, monthly_budget_usd, unit_cost_usd)
values
  ('serper', 'trial', 0.050000, 0.001000),
  ('serper', 'starter', 0.750000, 0.001000),
  ('serper', 'pro', 3.000000, 0.001000),
  ('serper', 'business', 12.000000, 0.001000),
  ('serper', 'expired', 0.000000, 0.001000)
on conflict (provider, plan) do update set
  monthly_budget_usd = excluded.monthly_budget_usd,
  unit_cost_usd = excluded.unit_cost_usd,
  updated_at = now();

create table if not exists public.external_api_usage (
  id uuid primary key default gen_random_uuid(),
  dealer_id uuid not null references public.dealers(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  provider text not null,
  operation text not null,
  units integer not null default 1 check (units > 0),
  estimated_cost_usd numeric(12,6) not null default 0,
  currency text not null default 'USD',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists external_api_usage_dealer_provider_month_idx
on public.external_api_usage(dealer_id, provider, created_at desc);

create index if not exists external_api_usage_provider_operation_idx
on public.external_api_usage(provider, operation, created_at desc);

alter table public.external_api_budget_catalog enable row level security;
alter table public.external_api_usage enable row level security;

-- Budgets are operational metadata. Browser clients do not need direct access.
drop policy if exists "external api budgets service role only" on public.external_api_budget_catalog;
create policy "external api budgets service role only"
  on public.external_api_budget_catalog for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "external api usage service role only" on public.external_api_usage;
create policy "external api usage service role only"
  on public.external_api_usage for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

revoke all on public.external_api_budget_catalog from anon, authenticated;
revoke all on public.external_api_usage from anon, authenticated;
grant select, insert, update, delete on public.external_api_budget_catalog to service_role;
grant select, insert, update, delete on public.external_api_usage to service_role;

-- SmartQuote Phase 10 — Free plan + capability gate.
-- Run after Phase 8.2/Phase 9. SQL remains the source of truth for plan price, quota, and capability.

insert into public.plan_catalog (plan, label, price_monthly_vnd, price_annual_vnd, sort_order)
values
  ('free', 'Free', 0, 0, 0),
  ('trial', 'Trial', 0, 0, 1),
  ('starter', 'Starter', 499000, 4990000, 2),
  ('pro', 'Pro', 899000, 8990000, 3),
  ('business', 'Business', 1899000, 18990000, 4),
  ('expired', 'Expired', 0, 0, 99)
on conflict (plan) do update set
  label = excluded.label,
  price_monthly_vnd = excluded.price_monthly_vnd,
  price_annual_vnd = excluded.price_annual_vnd,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.plan_limit_catalog (plan, feature, limit_scope, limit_value)
values
  ('free','seats','absolute',1),('free','products','absolute',50),('free','quotes_per_month','monthly',3),('free','ai_claude_request','monthly',0),('free','pdf_extract','monthly',0),('free','web_scrape','monthly',0),('free','product_enrich','monthly',0),('free','excel_export','monthly',5),
  ('trial','seats','absolute',3),('trial','products','absolute',2000),('trial','quotes_per_month','monthly',-1),('trial','ai_claude_request','monthly',200),('trial','pdf_extract','monthly',20),('trial','web_scrape','monthly',20),('trial','product_enrich','monthly',30),('trial','excel_export','monthly',100),
  ('starter','seats','absolute',1),('starter','products','absolute',1500),('starter','quotes_per_month','monthly',30),('starter','ai_claude_request','monthly',300),('starter','pdf_extract','monthly',10),('starter','web_scrape','monthly',20),('starter','product_enrich','monthly',50),('starter','excel_export','monthly',100),
  ('pro','seats','absolute',3),('pro','products','absolute',10000),('pro','quotes_per_month','monthly',-1),('pro','ai_claude_request','monthly',1500),('pro','pdf_extract','monthly',50),('pro','web_scrape','monthly',100),('pro','product_enrich','monthly',250),('pro','excel_export','monthly',1000),
  ('business','seats','absolute',10),('business','products','absolute',50000),('business','quotes_per_month','monthly',-1),('business','ai_claude_request','monthly',6000),('business','pdf_extract','monthly',300),('business','web_scrape','monthly',500),('business','product_enrich','monthly',1000),('business','excel_export','monthly',5000),
  ('expired','seats','absolute',0),('expired','products','absolute',0),('expired','quotes_per_month','monthly',0),('expired','ai_claude_request','monthly',0),('expired','pdf_extract','monthly',0),('expired','web_scrape','monthly',0),('expired','product_enrich','monthly',0),('expired','excel_export','monthly',0)
on conflict (plan, feature) do update set
  limit_scope = excluded.limit_scope,
  limit_value = excluded.limit_value,
  updated_at = now();

create table if not exists public.plan_capability_catalog (
  plan text not null references public.plan_catalog(plan) on delete cascade,
  capability text not null,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (plan, capability)
);

insert into public.plan_capability_catalog (plan, capability, enabled)
values
  ('free','ai_import',false),('free','template_memory',false),('free','correction_learning',false),('free','branded_pdf',false),('free','quote_variants_abc',false),('free','bom_import',false),('free','team_seats',false),('free','price_intelligence',false),('free','api_access',false),('free','priority_support',false),
  ('trial','ai_import',true),('trial','template_memory',true),('trial','correction_learning',true),('trial','branded_pdf',true),('trial','quote_variants_abc',true),('trial','bom_import',true),('trial','team_seats',true),('trial','price_intelligence',false),('trial','api_access',false),('trial','priority_support',false),
  ('starter','ai_import',true),('starter','template_memory',true),('starter','correction_learning',true),('starter','branded_pdf',true),('starter','quote_variants_abc',false),('starter','bom_import',false),('starter','team_seats',false),('starter','price_intelligence',false),('starter','api_access',false),('starter','priority_support',false),
  ('pro','ai_import',true),('pro','template_memory',true),('pro','correction_learning',true),('pro','branded_pdf',true),('pro','quote_variants_abc',true),('pro','bom_import',true),('pro','team_seats',true),('pro','price_intelligence',false),('pro','api_access',false),('pro','priority_support',true),
  ('business','ai_import',true),('business','template_memory',true),('business','correction_learning',true),('business','branded_pdf',true),('business','quote_variants_abc',true),('business','bom_import',true),('business','team_seats',true),('business','price_intelligence',true),('business','api_access',true),('business','priority_support',true),
  ('expired','ai_import',false),('expired','template_memory',false),('expired','correction_learning',false),('expired','branded_pdf',false),('expired','quote_variants_abc',false),('expired','bom_import',false),('expired','team_seats',false),('expired','price_intelligence',false),('expired','api_access',false),('expired','priority_support',false)
on conflict (plan, capability) do update set
  enabled = excluded.enabled,
  updated_at = now();

create or replace function public.plan_has_capability(plan_input text, capability_input text)
returns boolean language sql stable as $$
  select coalesce((
    select enabled from public.plan_capability_catalog
    where plan = lower(coalesce(plan_input, 'free')) and capability = capability_input
    limit 1
  ), false);
$$;

alter table public.plan_capability_catalog enable row level security;
drop policy if exists "plan capabilities are readable" on public.plan_capability_catalog;
create policy "plan capabilities are readable" on public.plan_capability_catalog for select using (true);
grant select on public.plan_capability_catalog to anon, authenticated;
revoke all on function public.plan_has_capability(text, text) from public;
grant execute on function public.plan_has_capability(text, text) to service_role, authenticated;

alter table public.dealers alter column trial_ends_at set default (now() + interval '14 days');
update public.dealers set trial_ends_at = created_at + interval '14 days', updated_at = now()
where plan = 'trial' and trial_ends_at is not null and trial_ends_at <= created_at + interval '8 days';

create or replace function public.ensure_dealer_workspace(dealer_name_input text default 'Đại lý SmartQuote')
returns uuid language plpgsql security definer set search_path = public, auth as $$
declare
  current_user_id uuid := auth.uid(); existing_dealer_id uuid; new_dealer_id uuid; auth_email text; auth_full_name text;
begin
  if current_user_id is null then raise exception 'Not authenticated'; end if;
  select dm.dealer_id into existing_dealer_id from public.dealer_members dm where dm.user_id = current_user_id order by dm.created_at asc limit 1;
  if existing_dealer_id is not null then return existing_dealer_id; end if;
  select email, raw_user_meta_data->>'full_name' into auth_email, auth_full_name from auth.users where id = current_user_id;
  insert into public.profiles (id, email, full_name) values (current_user_id, auth_email, coalesce(auth_full_name, ''))
  on conflict (id) do update set email = excluded.email, full_name = coalesce(excluded.full_name, public.profiles.full_name);
  insert into public.dealers (name, plan, subscription_status, trial_ends_at, plan_started_at)
  values (coalesce(nullif(trim(dealer_name_input), ''), 'Đại lý SmartQuote'), 'trial', 'trialing', now() + interval '14 days', now()) returning id into new_dealer_id;
  insert into public.dealer_members (dealer_id, user_id, role) values (new_dealer_id, current_user_id, 'owner');
  insert into public.dealer_app_state (dealer_id) values (new_dealer_id);
  return new_dealer_id;
end;
$$;
revoke all on function public.ensure_dealer_workspace(text) from public;
grant execute on function public.ensure_dealer_workspace(text) to authenticated;

-- Phase 10 addendum: Free external API budget.
insert into public.external_api_budget_catalog (provider, plan, monthly_budget_usd, unit_cost_usd)
values ('serper', 'free', 0.000000, 0.001000)
on conflict (provider, plan) do update set
  monthly_budget_usd = excluded.monthly_budget_usd,
  unit_cost_usd = excluded.unit_cost_usd,
  updated_at = now();
