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
language sql
stable
as $$
  select coalesce((
    select plc.limit_value
    from public.plan_limit_catalog plc
    where plc.plan = lower(coalesce(plan_input, 'trial'))
      and plc.feature = event_type_input
      and plc.limit_scope = 'monthly'
    limit 1
  ), 0);
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
