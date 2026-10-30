-- SmartQuote Pilot Security Fix — billing privilege hardening
-- Apply this ONCE to the live Supabase project before accepting paid pilot users.
-- Safe to re-run: statements are idempotent/replacing.
--
-- Closes two critical privilege paths:
--  1) authenticated dealer owners/admins must not be able to edit plan/subscription fields directly;
--  2) admin-only billing activation RPCs must not be executable by anon/authenticated browser roles.

-- ---------------------------------------------------------------------------
-- 1. Billing fields on public.dealers are server-controlled.
-- ---------------------------------------------------------------------------

-- Keep the existing owner/admin RLS policy for ordinary dealer-profile edits,
-- but remove table-wide UPDATE from browser roles and grant only safe columns.
revoke insert, update, delete on table public.dealers from anon;
revoke insert, update, delete on table public.dealers from authenticated;
grant select on table public.dealers to authenticated;
grant update (name, phone, address) on table public.dealers to authenticated;

-- Defense in depth: even if a broad table UPDATE grant is accidentally restored
-- later, reject browser attempts to mutate billing-controlled fields.
create or replace function public.smartquote_guard_dealer_billing_fields()
returns trigger
language plpgsql
set search_path = public, auth
as $$
begin
  if new.plan is distinct from old.plan
     or new.subscription_status is distinct from old.subscription_status
     or new.trial_ends_at is distinct from old.trial_ends_at
     or new.current_period_end is distinct from old.current_period_end
     or new.plan_started_at is distinct from old.plan_started_at then
    if coalesce(auth.role(), '') <> 'service_role'
       and session_user not in ('postgres', 'supabase_admin') then
      raise exception 'Billing fields are server-controlled';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.smartquote_guard_dealer_billing_fields() from public;
revoke all on function public.smartquote_guard_dealer_billing_fields() from anon;
revoke all on function public.smartquote_guard_dealer_billing_fields() from authenticated;

-- Trigger runs automatically; browser roles do not need EXECUTE on the function.
drop trigger if exists smartquote_guard_dealer_billing_fields on public.dealers;
create trigger smartquote_guard_dealer_billing_fields
before update on public.dealers
for each row execute function public.smartquote_guard_dealer_billing_fields();

-- ---------------------------------------------------------------------------
-- 2. Admin activation RPCs are service-role / SQL-admin only.
-- ---------------------------------------------------------------------------

-- Defense in depth inside the SECURITY DEFINER function itself. This prevents a
-- future accidental GRANT from turning a browser user into a billing admin.
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
  if coalesce(auth.role(), '') <> 'service_role'
     and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Admin billing activation requires service role';
  end if;

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
  if coalesce(auth.role(), '') <> 'service_role'
     and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Admin billing activation requires service role';
  end if;

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

  amount := public.smartquote_plan_price_vnd(
    normalized_plan,
    case when normalized_months >= 12 then 'annual' else 'monthly' end
  );

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

revoke all on function public.admin_activate_manual_billing_event(uuid, text, text) from public;
revoke all on function public.admin_activate_manual_billing_event(uuid, text, text) from anon;
revoke all on function public.admin_activate_manual_billing_event(uuid, text, text) from authenticated;
grant execute on function public.admin_activate_manual_billing_event(uuid, text, text) to service_role;

revoke all on function public.admin_activate_dealer_plan(uuid, text, integer, text) from public;
revoke all on function public.admin_activate_dealer_plan(uuid, text, integer, text) from anon;
revoke all on function public.admin_activate_dealer_plan(uuid, text, integer, text) from authenticated;
grant execute on function public.admin_activate_dealer_plan(uuid, text, integer, text) to service_role;

-- Customer-facing checkout RPCs remain authenticated-only.
revoke all on function public.create_manual_billing_request(uuid, text, text, text, text) from public;
revoke all on function public.create_manual_billing_request(uuid, text, text, text, text) from anon;
grant execute on function public.create_manual_billing_request(uuid, text, text, text, text) to authenticated;

revoke all on function public.mark_manual_billing_event_paid(uuid, uuid) from public;
revoke all on function public.mark_manual_billing_event_paid(uuid, uuid) from anon;
grant execute on function public.mark_manual_billing_event_paid(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Verification row. After applying in Supabase SQL Editor:
-- every *_should_be_false column must be f;
-- every *_should_be_true column must be t.
-- ---------------------------------------------------------------------------
select
  has_column_privilege('authenticated', 'public.dealers', 'plan', 'UPDATE')
    as authenticated_plan_update_should_be_false,
  has_column_privilege('authenticated', 'public.dealers', 'subscription_status', 'UPDATE')
    as authenticated_subscription_update_should_be_false,
  has_column_privilege('authenticated', 'public.dealers', 'current_period_end', 'UPDATE')
    as authenticated_period_update_should_be_false,
  has_column_privilege('authenticated', 'public.dealers', 'name', 'UPDATE')
    as authenticated_name_update_should_be_true,
  has_function_privilege('anon', 'public.admin_activate_manual_billing_event(uuid,text,text)', 'EXECUTE')
    as anon_admin_activate_event_should_be_false,
  has_function_privilege('authenticated', 'public.admin_activate_manual_billing_event(uuid,text,text)', 'EXECUTE')
    as authenticated_admin_activate_event_should_be_false,
  has_function_privilege('anon', 'public.admin_activate_dealer_plan(uuid,text,integer,text)', 'EXECUTE')
    as anon_admin_activate_plan_should_be_false,
  has_function_privilege('authenticated', 'public.admin_activate_dealer_plan(uuid,text,integer,text)', 'EXECUTE')
    as authenticated_admin_activate_plan_should_be_false,
  has_function_privilege('service_role', 'public.admin_activate_manual_billing_event(uuid,text,text)', 'EXECUTE')
    as service_role_admin_activate_event_should_be_true,
  has_function_privilege('service_role', 'public.admin_activate_dealer_plan(uuid,text,integer,text)', 'EXECUTE')
    as service_role_admin_activate_plan_should_be_true,
  has_function_privilege('authenticated', 'public.create_manual_billing_request(uuid,text,text,text,text)', 'EXECUTE')
    as authenticated_create_billing_request_should_be_true,
  has_function_privilege('authenticated', 'public.mark_manual_billing_event_paid(uuid,uuid)', 'EXECUTE')
    as authenticated_mark_paid_should_be_true;
