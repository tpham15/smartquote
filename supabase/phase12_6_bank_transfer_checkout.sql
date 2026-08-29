-- Phase 12.6 — Embedded bank-transfer checkout
-- 1) New billing requests use VietQR-friendly alphanumeric transfer content.
-- 2) Authenticated dealer members may mark their own pending event as "paid".
--    This is only a customer declaration; plan activation remains admin-only.

create or replace function public.create_manual_billing_request(
  target_dealer_id uuid,
  requested_plan text,
  billing_cycle_input text default 'monthly',
  customer_note_input text default '',
  customer_contact_input text default ''
)
returns table (
  id uuid,
  dealer_id uuid,
  plan text,
  billing_cycle text,
  months integer,
  amount_vnd integer,
  status text,
  transfer_content text,
  customer_note text,
  customer_contact text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_plan text := lower(coalesce(requested_plan, ''));
  normalized_cycle text := lower(coalesce(billing_cycle_input, 'monthly'));
  new_id uuid := gen_random_uuid();
  price integer;
  cycle_months integer;
  content text;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if target_dealer_id is null or not public.is_dealer_member(target_dealer_id) then
    raise exception 'Not a member of this dealer workspace';
  end if;
  if normalized_plan not in ('starter','pro','business') then
    raise exception 'Gói không hợp lệ';
  end if;
  if normalized_cycle not in ('monthly','annual') then
    normalized_cycle := 'monthly';
  end if;

  cycle_months := case when normalized_cycle = 'annual' then 12 else 1 end;
  price := public.smartquote_plan_price_vnd(normalized_plan, normalized_cycle);
  if price <= 0 then
    raise exception 'Không tính được giá gói';
  end if;

  -- VietQR addInfo should be short and free of punctuation/special characters.
  -- Keep 8 random UUID hex chars + plan/cycle for human reconciliation.
  content := 'SQ'
    || upper(substr(replace(new_id::text, '-', ''), 1, 8))
    || upper(normalized_plan)
    || case when normalized_cycle = 'annual' then 'NAM' else 'THANG' end;

  insert into public.billing_events (
    id, dealer_id, user_id, plan, billing_cycle, months, amount_vnd,
    status, transfer_content, customer_note, customer_contact
  ) values (
    new_id, target_dealer_id, current_user_id, normalized_plan, normalized_cycle, cycle_months, price,
    'pending', content, nullif(customer_note_input, ''), nullif(customer_contact_input, '')
  );

  return query
  select be.id, be.dealer_id, be.plan, be.billing_cycle, be.months, be.amount_vnd,
         be.status, be.transfer_content, be.customer_note, be.customer_contact, be.created_at
  from public.billing_events be
  where be.id = new_id;
end;
$$;

create or replace function public.mark_manual_billing_event_paid(
  target_dealer_id uuid,
  target_billing_event_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid := auth.uid();
  event_id uuid;
  current_status text;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if target_dealer_id is null or not public.is_dealer_member(target_dealer_id) then
    raise exception 'Not a member of this dealer workspace';
  end if;

  select be.id, be.status
  into event_id, current_status
  from public.billing_events be
  where be.id = target_billing_event_id
    and be.dealer_id = target_dealer_id;

  if event_id is null then
    raise exception 'Billing event not found';
  end if;

  -- Idempotent: repeated clicks after a successful declaration are harmless.
  if current_status = 'paid' then
    return event_id;
  end if;
  if current_status <> 'pending' then
    raise exception 'Billing event cannot be marked paid from status %', current_status;
  end if;

  update public.billing_events
  set status = 'paid', updated_at = now()
  where id = event_id and dealer_id = target_dealer_id;

  return event_id;
end;
$$;

revoke all on function public.create_manual_billing_request(uuid, text, text, text, text) from public;
grant execute on function public.create_manual_billing_request(uuid, text, text, text, text) to authenticated;

revoke all on function public.mark_manual_billing_event_paid(uuid, uuid) from public;
grant execute on function public.mark_manual_billing_event_paid(uuid, uuid) to authenticated;
