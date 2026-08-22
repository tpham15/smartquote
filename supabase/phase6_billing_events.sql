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
