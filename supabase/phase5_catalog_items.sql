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
