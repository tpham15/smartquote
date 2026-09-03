-- SmartQuote Phase 2 — usage/quota table for protected serverless APIs
-- Run this in Supabase SQL Editor if you already ran the original schema.sql before Phase 2.

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  dealer_id uuid not null references public.dealers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  units integer not null default 1 check (units > 0),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists usage_events_dealer_event_created_idx
on public.usage_events(dealer_id, event_type, created_at desc);

create index if not exists usage_events_user_created_idx
on public.usage_events(user_id, created_at desc);

alter table public.usage_events enable row level security;

drop policy if exists "Usage visible to dealer members" on public.usage_events;
create policy "Usage visible to dealer members"
on public.usage_events for select
to authenticated
using (public.is_dealer_member(dealer_id));

-- No insert/update/delete policy for browser clients.
-- Protected serverless APIs write usage_events with SUPABASE_SERVICE_ROLE_KEY.
