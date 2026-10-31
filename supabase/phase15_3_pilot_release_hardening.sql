-- SmartQuote P1.5.3 — Pilot release hardening
-- Run on the live Supabase project before pilot deployment.
-- Safe to re-run.
--
-- These RPCs are server-only. PostgreSQL grants EXECUTE on new functions to PUBLIC
-- by default, so revoking only PUBLIC is not enough once anon/authenticated have
-- explicit/default grants in Supabase. Revoke every browser role explicitly.

revoke all on function public.smartquote_increment_rate_limit(text, timestamptz, integer, integer) from public;
revoke all on function public.smartquote_increment_rate_limit(text, timestamptz, integer, integer) from anon;
revoke all on function public.smartquote_increment_rate_limit(text, timestamptz, integer, integer) from authenticated;
grant execute on function public.smartquote_increment_rate_limit(text, timestamptz, integer, integer) to service_role;

revoke all on function public.admin_prune_api_logs(integer) from public;
revoke all on function public.admin_prune_api_logs(integer) from anon;
revoke all on function public.admin_prune_api_logs(integer) from authenticated;
grant execute on function public.admin_prune_api_logs(integer) to service_role;

revoke all on function public.consume_usage_quota(uuid, uuid, text, integer, jsonb) from public;
revoke all on function public.consume_usage_quota(uuid, uuid, text, integer, jsonb) from anon;
revoke all on function public.consume_usage_quota(uuid, uuid, text, integer, jsonb) from authenticated;
grant execute on function public.consume_usage_quota(uuid, uuid, text, integer, jsonb) to service_role;

-- Verification: every *_should_be_false must be false; every *_should_be_true must be true.
select
  has_function_privilege('anon', 'public.smartquote_increment_rate_limit(text,timestamptz,integer,integer)', 'EXECUTE')
    as anon_rate_limit_should_be_false,
  has_function_privilege('authenticated', 'public.smartquote_increment_rate_limit(text,timestamptz,integer,integer)', 'EXECUTE')
    as authenticated_rate_limit_should_be_false,
  has_function_privilege('service_role', 'public.smartquote_increment_rate_limit(text,timestamptz,integer,integer)', 'EXECUTE')
    as service_role_rate_limit_should_be_true,
  has_function_privilege('anon', 'public.admin_prune_api_logs(integer)', 'EXECUTE')
    as anon_prune_logs_should_be_false,
  has_function_privilege('authenticated', 'public.admin_prune_api_logs(integer)', 'EXECUTE')
    as authenticated_prune_logs_should_be_false,
  has_function_privilege('service_role', 'public.admin_prune_api_logs(integer)', 'EXECUTE')
    as service_role_prune_logs_should_be_true,
  has_function_privilege('anon', 'public.consume_usage_quota(uuid,uuid,text,integer,jsonb)', 'EXECUTE')
    as anon_consume_quota_should_be_false,
  has_function_privilege('authenticated', 'public.consume_usage_quota(uuid,uuid,text,integer,jsonb)', 'EXECUTE')
    as authenticated_consume_quota_should_be_false,
  has_function_privilege('service_role', 'public.consume_usage_quota(uuid,uuid,text,integer,jsonb)', 'EXECUTE')
    as service_role_consume_quota_should_be_true;
