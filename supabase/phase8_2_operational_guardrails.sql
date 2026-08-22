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
