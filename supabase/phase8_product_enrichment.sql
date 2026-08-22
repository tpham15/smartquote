-- SmartQuote Phase 8 — Product Enrichment quota
-- Run after Phase 8.1. Product enrichment quota now comes from plan_limit_catalog, not hard-coded SQL.

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

revoke all on function public.usage_monthly_limit(text, text) from public;
grant execute on function public.usage_monthly_limit(text, text) to service_role;
