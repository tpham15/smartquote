-- SmartQuote P2.3.13 RC15 — quote sales status RPC.
-- Idempotent. Final quote content remains protected by smartquote_guard_final_quote.

create or replace function public.set_quote_sales_status(target_quote_id uuid, status_input text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  next_status text := lower(trim(coalesce(status_input, '')));
  target_dealer uuid;
  updated_row public.quotes%rowtype;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if next_status not in ('draft','sent','won','lost') then
    raise exception 'Trạng thái báo giá không hợp lệ';
  end if;
  select dealer_id into target_dealer from public.quotes where id = target_quote_id;
  if target_dealer is null or not public.is_dealer_member(target_dealer) then
    raise exception 'Quote not found in this dealer workspace';
  end if;
  update public.quotes
     set status = next_status, updated_by = auth.uid(), updated_at = now()
   where id = target_quote_id and dealer_id = target_dealer
  returning * into updated_row;
  if not found then raise exception 'Không cập nhật được trạng thái báo giá'; end if;
  return jsonb_build_object('id', updated_row.id, 'status', updated_row.status, 'updated_at', updated_row.updated_at);
end;
$$;

revoke all on function public.set_quote_sales_status(uuid, text) from public, anon;
grant execute on function public.set_quote_sales_status(uuid, text) to authenticated;

select
  has_function_privilege('authenticated','public.set_quote_sales_status(uuid,text)','EXECUTE') as authenticated_status_rpc_should_be_true,
  has_function_privilege('anon','public.set_quote_sales_status(uuid,text)','EXECUTE') as anon_status_rpc_should_be_false;
