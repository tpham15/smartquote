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

-- Free has zero external API budget so Product Enrichment fails closed before spending Serper credits.
insert into public.external_api_budget_catalog (provider, plan, monthly_budget_usd, unit_cost_usd)
values ('serper', 'free', 0.000000, 0.001000)
on conflict (provider, plan) do update set
  monthly_budget_usd = excluded.monthly_budget_usd,
  unit_cost_usd = excluded.unit_cost_usd,
  updated_at = now();
