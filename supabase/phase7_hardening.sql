-- Phase 7 — production hardening: DB-backed per-minute rate limit + API logs.
-- Run after Phase 6 if you are upgrading an existing Supabase project.

create table if not exists public.api_rate_limits (
  bucket_key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (bucket_key, window_start)
);

create index if not exists api_rate_limits_updated_at_idx
  on public.api_rate_limits (updated_at desc);

alter table public.api_rate_limits enable row level security;
revoke all on table public.api_rate_limits from anon, authenticated;

create or replace function public.smartquote_increment_rate_limit(
  p_key text,
  p_window_start timestamptz,
  p_limit integer,
  p_increment integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  next_count integer;
  normalized_limit integer := greatest(0, coalesce(p_limit, 0));
  normalized_increment integer := greatest(1, least(coalesce(p_increment, 1), 100));
begin
  if p_key is null or length(trim(p_key)) = 0 then
    raise exception 'Missing rate limit key';
  end if;

  insert into public.api_rate_limits (bucket_key, window_start, count, updated_at)
  values (left(p_key, 300), date_trunc('minute', p_window_start), normalized_increment, now())
  on conflict (bucket_key, window_start)
  do update set
    count = public.api_rate_limits.count + normalized_increment,
    updated_at = now()
  returning count into next_count;

  -- Opportunistic cleanup; keep table small without cron.
  delete from public.api_rate_limits
  where updated_at < now() - interval '2 days';

  return jsonb_build_object(
    'allowed', next_count <= normalized_limit,
    'count', next_count,
    'limit', normalized_limit,
    'reset_at', date_trunc('minute', p_window_start) + interval '1 minute'
  );
end;
$$;

revoke all on function public.smartquote_increment_rate_limit(text, timestamptz, integer, integer) from public;
grant execute on function public.smartquote_increment_rate_limit(text, timestamptz, integer, integer) to service_role;

create table if not exists public.api_logs (
  id uuid primary key default gen_random_uuid(),
  dealer_id uuid references public.dealers(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  request_id text,
  route text not null,
  event_type text,
  method text,
  status_code integer,
  duration_ms integer,
  error_message text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists api_logs_dealer_created_idx
  on public.api_logs (dealer_id, created_at desc);
create index if not exists api_logs_route_created_idx
  on public.api_logs (route, created_at desc);
create index if not exists api_logs_status_created_idx
  on public.api_logs (status_code, created_at desc);

alter table public.api_logs enable row level security;
revoke all on table public.api_logs from anon, authenticated;

-- Optional maintenance helper for SQL Editor/service role.
create or replace function public.admin_prune_api_logs(retention_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.api_logs
  where created_at < now() - make_interval(days => greatest(1, coalesce(retention_days, 30)));
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.admin_prune_api_logs(integer) from public;
