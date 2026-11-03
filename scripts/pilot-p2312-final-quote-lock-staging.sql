-- RC14 M2 staging acceptance checklist.
-- Run AFTER root 01_RUN_ON_SUPABASE.sql on a staging project.
-- Use an authenticated test user/workspace from the app for M2-1..M2-10.
-- Required outcomes:
-- M2-1 save_quote with calc.workflow.lifecycle='final' -> RAISE "Dùng finalize_quote..."
-- M2-2 finalize_quote(valid draft) -> success + calc.workflow.finalizedBy populated
-- M2-3 save_quote changes Final rooms/total/lifecycle -> RAISE
-- M2-4 direct update of status only on Final -> success
-- M2-5 delete Final -> RAISE
-- M2-6 learning product_id not present in quote -> {inserted:0,rejected:1}
-- M2-7 learning client prices differ -> stored prices come from quote line snapshots
-- M2-8 create revision in app -> new Draft Rev 2; Rev 1 unchanged
-- M2-9 anon execute finalize_quote -> permission denied
-- M2-10 re-run existing security suites E1-E7 / S1-S6 / L1-L9

select
  has_function_privilege('authenticated','public.finalize_quote(uuid,jsonb)','EXECUTE') as authenticated_finalize_rpc_should_be_true,
  has_function_privilege('anon','public.finalize_quote(uuid,jsonb)','EXECUTE') as anon_finalize_rpc_should_be_false,
  exists(select 1 from pg_trigger where tgname='smartquote_guard_final_quote' and not tgisinternal) as final_quote_guard_trigger_should_be_true;
