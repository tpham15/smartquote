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
