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
