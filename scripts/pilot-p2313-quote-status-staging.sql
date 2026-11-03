-- SmartQuote P2.3.13 RC15 — F1 + RC14 M2 staging acceptance.
-- Run AFTER root 01_RUN_ON_SUPABASE.sql has been executed twice successfully.
-- This file intentionally does not create fixture users/workspaces. Use two real
-- staging users/workspaces and the app/API so auth.uid() / RLS are exercised.
--
-- F1 required outcomes (authenticated):
-- F1-1 set_quote_sales_status(final_quote_id, 'sent') -> status=sent;
--      reread quote: rooms/calc/total unchanged.
-- F1-2 set_quote_sales_status(..., 'paid') -> RAISE "Trạng thái báo giá không hợp lệ".
-- F1-3 user from workspace B calls quote in workspace A -> RAISE not found/member.
-- F1-4 anon execute -> permission denied.
-- F1-5 draft quote + valid sales status -> success; only status/audit fields change.
-- F1-6 after F1-1, save_quote that changes Final total/rooms/lifecycle -> RAISE immutable.
-- F1-7 rerun RC14 M2-1..M2-9; all must still pass.
--
-- RC14 M2 required outcomes:
-- M2-1 save_quote lifecycle=final -> RAISE "Dùng finalize_quote..."
-- M2-2 finalize_quote(valid draft) -> success + finalizedBy populated
-- M2-3 save_quote changes Final content/lifecycle -> RAISE
-- M2-4 sales status-only change on Final -> success (through RC15 RPC)
-- M2-5 delete Final -> RAISE
-- M2-6 learning product_id absent from quote -> {inserted:0,rejected:1}
-- M2-7 learning client price differs -> stored value comes from quote snapshot
-- M2-8 app revision -> new Draft Rev 2; Rev 1 unchanged
-- M2-9 anon finalize_quote -> permission denied
--
-- Static privilege/trigger checks: *_should_be_true => true; *_should_be_false => false.
select
  has_function_privilege('authenticated','public.set_quote_sales_status(uuid,text)','EXECUTE') as authenticated_status_rpc_should_be_true,
  has_function_privilege('anon','public.set_quote_sales_status(uuid,text)','EXECUTE') as anon_status_rpc_should_be_false,
  has_function_privilege('authenticated','public.finalize_quote(uuid,jsonb)','EXECUTE') as authenticated_finalize_rpc_should_be_true,
  has_function_privilege('anon','public.finalize_quote(uuid,jsonb)','EXECUTE') as anon_finalize_rpc_should_be_false,
  exists(select 1 from pg_trigger where tgname='smartquote_guard_final_quote' and not tgisinternal) as final_quote_guard_trigger_should_be_true;
