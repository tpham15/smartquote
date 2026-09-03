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
