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
revoke all on function public.smartquote_increment_rate_limit(text, timestamptz, integer, integer) from anon;
revoke all on function public.smartquote_increment_rate_limit(text, timestamptz, integer, integer) from authenticated;
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
revoke all on function public.admin_prune_api_logs(integer) from anon;
revoke all on function public.admin_prune_api_logs(integer) from authenticated;
grant execute on function public.admin_prune_api_logs(integer) to service_role;


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
revoke all on function public.consume_usage_quota(uuid, uuid, text, integer, jsonb) from anon;
revoke all on function public.consume_usage_quota(uuid, uuid, text, integer, jsonb) from authenticated;
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
-- Phase 12.6 — Embedded bank-transfer checkout
-- 1) New billing requests use VietQR-friendly alphanumeric transfer content.
-- 2) Authenticated dealer members may mark their own pending event as "paid".
--    This is only a customer declaration; plan activation remains admin-only.

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

  -- VietQR addInfo should be short and free of punctuation/special characters.
  -- Keep 8 random UUID hex chars + plan/cycle for human reconciliation.
  content := 'SQ'
    || upper(substr(replace(new_id::text, '-', ''), 1, 8))
    || upper(normalized_plan)
    || case when normalized_cycle = 'annual' then 'NAM' else 'THANG' end;

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

create or replace function public.mark_manual_billing_event_paid(
  target_dealer_id uuid,
  target_billing_event_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid := auth.uid();
  event_id uuid;
  current_status text;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if target_dealer_id is null or not public.is_dealer_member(target_dealer_id) then
    raise exception 'Not a member of this dealer workspace';
  end if;

  select be.id, be.status
  into event_id, current_status
  from public.billing_events be
  where be.id = target_billing_event_id
    and be.dealer_id = target_dealer_id;

  if event_id is null then
    raise exception 'Billing event not found';
  end if;

  -- Idempotent: repeated clicks after a successful declaration are harmless.
  if current_status = 'paid' then
    return event_id;
  end if;
  if current_status <> 'pending' then
    raise exception 'Billing event cannot be marked paid from status %', current_status;
  end if;

  update public.billing_events
  set status = 'paid', updated_at = now()
  where id = event_id and dealer_id = target_dealer_id;

  return event_id;
end;
$$;

revoke all on function public.create_manual_billing_request(uuid, text, text, text, text) from public;
grant execute on function public.create_manual_billing_request(uuid, text, text, text, text) to authenticated;

revoke all on function public.mark_manual_billing_event_paid(uuid, uuid) from public;
grant execute on function public.mark_manual_billing_event_paid(uuid, uuid) to authenticated;

-- ============================================================================
-- Pilot Security Fix — billing privilege hardening
-- Keep this block aligned with supabase/smartquote_pilot_security_fix.sql.
-- ============================================================================

revoke insert, update, delete on table public.dealers from anon;
revoke insert, update, delete on table public.dealers from authenticated;
grant select on table public.dealers to authenticated;
grant update (name, phone, address) on table public.dealers to authenticated;

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

drop trigger if exists smartquote_guard_dealer_billing_fields on public.dealers;
create trigger smartquote_guard_dealer_billing_fields
before update on public.dealers
for each row execute function public.smartquote_guard_dealer_billing_fields();

-- Browser roles must never execute billing activation RPCs.
revoke all on function public.admin_activate_manual_billing_event(uuid, text, text) from public;
revoke all on function public.admin_activate_manual_billing_event(uuid, text, text) from anon;
revoke all on function public.admin_activate_manual_billing_event(uuid, text, text) from authenticated;
grant execute on function public.admin_activate_manual_billing_event(uuid, text, text) to service_role;

revoke all on function public.admin_activate_dealer_plan(uuid, text, integer, text) from public;
revoke all on function public.admin_activate_dealer_plan(uuid, text, integer, text) from anon;
revoke all on function public.admin_activate_dealer_plan(uuid, text, integer, text) from authenticated;
grant execute on function public.admin_activate_dealer_plan(uuid, text, integer, text) to service_role;

-- SmartQuote P1.5 — Industry-Neutral Core + Workspace Industry Profile
alter table public.dealers add column if not exists industry_profile text;
alter table public.dealers add column if not exists business_type text;
alter table public.dealers add column if not exists industry_profile_version integer not null default 1;

-- This update marks only rows that exist when the fresh schema/migration is executed.
-- Future ensure_dealer_workspace inserts leave industry_profile NULL and trigger onboarding.
update public.dealers
set industry_profile = 'smarthome', industry_profile_version = 1, updated_at = now()
where industry_profile is null;

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

-- ============================================================
-- P1.5.2 — Dealer product-image overrides
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('catalog-product-images','catalog-product-images',true,4194304,array['image/jpeg','image/png','image/webp']::text[])
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
  if dealer_text = '' then return false; end if;
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
create policy "Catalog images insert by dealer members" on storage.objects for insert to authenticated
with check (bucket_id = 'catalog-product-images' and public.can_manage_catalog_image_path(name));
drop policy if exists "Catalog images update by dealer members" on storage.objects;
create policy "Catalog images update by dealer members" on storage.objects for update to authenticated
using (bucket_id = 'catalog-product-images' and public.can_manage_catalog_image_path(name))
with check (bucket_id = 'catalog-product-images' and public.can_manage_catalog_image_path(name));
drop policy if exists "Catalog images delete by dealer members" on storage.objects;
create policy "Catalog images delete by dealer members" on storage.objects for delete to authenticated
using (bucket_id = 'catalog-product-images' and public.can_manage_catalog_image_path(name));
drop policy if exists "Catalog images list by dealer members" on storage.objects;
create policy "Catalog images list by dealer members" on storage.objects for select to authenticated
using (bucket_id = 'catalog-product-images' and public.can_manage_catalog_image_path(name));


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
