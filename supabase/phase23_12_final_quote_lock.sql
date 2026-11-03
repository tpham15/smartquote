-- SmartQuote P2.3.12 RC14 — server-side Final quote lock + grounded learning.
-- Idempotent; apply after the base quote + learning schema.

create or replace function public.smartquote_guard_final_quote()
returns trigger
language plpgsql
set search_path = public, auth
as $$
declare
  old_lifecycle text;
  new_lifecycle text;
  allow_finalize boolean := coalesce(current_setting('smartquote.allow_finalize', true), '') = 'on';
  browser_role text := coalesce(auth.role(), '');
begin
  if browser_role = 'service_role' or (auth.uid() is null and current_user = 'postgres') then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_op = 'INSERT' then
    new_lifecycle := lower(coalesce(new.calc->'workflow'->>'lifecycle', 'draft'));
    if new_lifecycle = 'final' and not allow_finalize then
      raise exception 'Dùng finalize_quote để chốt báo giá';
    end if;
    return new;
  end if;

  old_lifecycle := lower(coalesce(old.calc->'workflow'->>'lifecycle', 'draft'));
  if tg_op = 'DELETE' then
    if old_lifecycle = 'final' then raise exception 'Báo giá Final không thể xóa'; end if;
    return old;
  end if;

  new_lifecycle := lower(coalesce(new.calc->'workflow'->>'lifecycle', 'draft'));
  if old_lifecycle = 'final' and not allow_finalize then
    if (to_jsonb(new) - array['status','updated_at','updated_by']::text[]) is distinct from
       (to_jsonb(old) - array['status','updated_at','updated_by']::text[]) then
      raise exception 'Báo giá Final là bất biến; hãy tạo revision mới';
    end if;
  elsif new_lifecycle = 'final' and not allow_finalize then
    raise exception 'Dùng finalize_quote để chốt báo giá';
  end if;
  return new;
end;
$$;

drop trigger if exists smartquote_guard_final_quote on public.quotes;
create trigger smartquote_guard_final_quote
before insert or update or delete on public.quotes
for each row execute function public.smartquote_guard_final_quote();

create or replace function public.finalize_quote(target_quote_id uuid, quote_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid := auth.uid();
  target_dealer_id uuid := nullif(quote_input->>'dealer_id','')::uuid;
  qid uuid := target_quote_id;
  sanitized jsonb;
  room jsonb;
  line jsonb;
  finalized_at_value timestamptz := now();
  current_lifecycle text;
  dealer_plan text;
  dealer_status text;
  trial_end timestamptz;
  period_end timestamptz;
begin
  if current_user_id is null then raise exception 'Not authenticated'; end if;
  if target_dealer_id is null or not public.is_dealer_member(target_dealer_id) then raise exception 'Not a member of this dealer workspace'; end if;

  select plan, subscription_status, trial_ends_at, current_period_end into dealer_plan, dealer_status, trial_end, period_end
  from public.dealers where id=target_dealer_id;
  if lower(coalesce(dealer_plan,'trial'))='expired'
     or lower(coalesce(dealer_status,case when lower(coalesce(dealer_plan,'trial'))='trial' then 'trialing' else 'active' end)) in ('expired','canceled','past_due','unpaid')
     or (lower(coalesce(dealer_plan,'trial'))='trial' and trial_end is not null and trial_end <= now())
     or (lower(coalesce(dealer_plan,'trial'))<>'trial' and period_end is not null and period_end <= now()) then
    raise exception 'Workspace đã hết hạn hoặc bị khóa. Vui lòng nâng cấp/gia hạn gói.';
  end if;

  if qid is not null then
    select lower(coalesce(calc->'workflow'->>'lifecycle','draft')) into current_lifecycle
    from public.quotes where id=qid and dealer_id=target_dealer_id;
    if not found then raise exception 'Quote not found in this dealer workspace'; end if;
    if current_lifecycle <> 'draft' then raise exception 'Chỉ báo giá Draft mới được Final'; end if;
  end if;

  if jsonb_typeof(coalesce(quote_input->'rooms','[]'::jsonb)) <> 'array' then raise exception 'rooms không hợp lệ'; end if;
  if not exists (
    select 1 from jsonb_array_elements(coalesce(quote_input->'rooms','[]'::jsonb)) r,
      jsonb_array_elements(coalesce(r->'lines','[]'::jsonb)) l
    where coalesce((l->>'qty')::numeric,0)>0
  ) then raise exception 'Báo giá phải có ít nhất 1 dòng sản phẩm'; end if;

  for room in select value from jsonb_array_elements(coalesce(quote_input->'rooms','[]'::jsonb)) loop
    for line in select value from jsonb_array_elements(coalesce(room->'lines','[]'::jsonb)) loop
      if coalesce((line->>'qty')::numeric,0) <= 0 then continue; end if;
      if nullif(trim(line->>'productId'),'') is null then raise exception 'Dòng báo giá thiếu productId'; end if;
      if jsonb_typeof(line->'productSnapshot') <> 'object' then raise exception 'Dòng báo giá thiếu productSnapshot'; end if;
      if coalesce((line->>'salePriceSnapshot')::numeric,0) <= 0 then raise exception 'Dòng báo giá thiếu salePriceSnapshot'; end if;
    end loop;
  end loop;

  sanitized := jsonb_set(coalesce(quote_input,'{}'::jsonb), '{calc}', jsonb_set(coalesce(quote_input->'calc','{}'::jsonb), '{workflow}', jsonb_set(coalesce(quote_input->'calc'->'workflow','{}'::jsonb), '{lifecycle}', '"draft"'::jsonb, true), true), true);
  if qid is not null then sanitized := jsonb_set(sanitized,'{id}',to_jsonb(qid::text),true); end if;
  qid := public.save_quote(sanitized);

  perform set_config('smartquote.allow_finalize','on',true);
  update public.quotes
  set calc = jsonb_set(coalesce(calc,'{}'::jsonb), '{workflow}',
        jsonb_set(
          jsonb_set(
            jsonb_set(coalesce(calc->'workflow','{}'::jsonb), '{lifecycle}', '"final"'::jsonb, true),
            '{finalizedAt}', to_jsonb(finalized_at_value::text), true),
          '{finalizedBy}', to_jsonb(current_user_id::text), true), true),
      updated_by=current_user_id
  where id=qid and dealer_id=target_dealer_id;

  return jsonb_build_object('id',qid,'quote_id',qid,'finalized_at',finalized_at_value);
end;
$$;
revoke all on function public.finalize_quote(uuid,jsonb) from public, anon;
grant execute on function public.finalize_quote(uuid,jsonb) to authenticated;

create or replace function public.record_quote_learning_observations(target_dealer_id uuid, target_quote_id uuid, observations_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid := auth.uid(); quote_calc jsonb; quote_rooms jsonb; quote_revision_value integer:=1;
  inserted_count integer:=0; rejected_count integer:=0; x jsonb; pid text; snap jsonb; qty numeric; sale numeric; cost numeric;
  sections jsonb; fin_at timestamptz; pkey text; margin numeric;
begin
  if current_user_id is null then raise exception 'Not authenticated'; end if;
  if target_dealer_id is null or not public.is_dealer_member(target_dealer_id) then raise exception 'Not a member of this dealer workspace'; end if;
  select q.calc,q.rooms into quote_calc,quote_rooms from public.quotes q where q.id=target_quote_id and q.dealer_id=target_dealer_id;
  if not found then raise exception 'Quote not found in this dealer workspace'; end if;
  if lower(coalesce(quote_calc->'workflow'->>'lifecycle','draft'))<>'final' or nullif(quote_calc->'workflow'->>'finalizedBy','') is null then
    raise exception 'Learning requires a server-finalized quote';
  end if;
  quote_revision_value:=greatest(1,coalesce((quote_calc->'workflow'->>'revision')::integer,1));
  fin_at:=coalesce(nullif(quote_calc->'workflow'->>'finalizedAt','')::timestamptz,now());

  for x in select value from jsonb_array_elements(coalesce(observations_input,'[]'::jsonb)) loop
    pid:=nullif(trim(x->>'product_id'),'');
    if pid is null then rejected_count:=rejected_count+1; continue; end if;
    select
      (array_agg(l->'productSnapshot'))[1],
      sum(coalesce((l->>'qty')::numeric,0)),
      case when sum(coalesce((l->>'qty')::numeric,0))>0 then sum(coalesce((l->>'qty')::numeric,0)*coalesce((l->>'salePriceSnapshot')::numeric,0))/sum(coalesce((l->>'qty')::numeric,0)) else 0 end,
      case when sum(case when nullif(l->>'costPriceSnapshot','') is not null then coalesce((l->>'qty')::numeric,0) else 0 end)>0 then sum(coalesce((l->>'qty')::numeric,0)*coalesce((l->>'costPriceSnapshot')::numeric,0))/sum(case when nullif(l->>'costPriceSnapshot','') is not null then coalesce((l->>'qty')::numeric,0) else 0 end) else 0 end,
      coalesce(jsonb_agg(distinct r->>'name') filter (where nullif(trim(r->>'name'),'') is not null),'[]'::jsonb)
    into snap,qty,sale,cost,sections
    from jsonb_array_elements(coalesce(quote_rooms,'[]'::jsonb)) r,
         jsonb_array_elements(coalesce(r->'lines','[]'::jsonb)) l
    where l->>'productId'=pid and coalesce((l->>'qty')::numeric,0)>0;
    if coalesce(qty,0)<=0 then rejected_count:=rejected_count+1; continue; end if;
    pkey:=coalesce(nullif(trim(x->>'product_key'),''),pid);
    margin:=case when cost>0 and sale>0 then ((sale-cost)/sale)*100 else null end;
    insert into public.quote_learning_observations(dealer_id,quote_id,observation_key,quote_revision,product_key,product_id,product_snapshot,customer_category,project_name,industry_profile,section_names,total_qty,sale_price,cost_price,margin_pct,finalized_at,created_by)
    values(target_dealer_id,target_quote_id,coalesce(nullif(trim(x->>'observation_key'),''),target_quote_id::text||'|'||pkey),quote_revision_value,pkey,pid,coalesce(snap,'{}'::jsonb),nullif(trim(x->>'customer_category'),''),nullif(trim(x->>'project_name'),''),coalesce(nullif(trim(x->>'industry_profile'),''),'generic'),sections,qty,sale,cost,margin,fin_at,current_user_id)
    on conflict(dealer_id,quote_id,product_key) do update set product_id=excluded.product_id,product_snapshot=excluded.product_snapshot,section_names=excluded.section_names,total_qty=excluded.total_qty,sale_price=excluded.sale_price,cost_price=excluded.cost_price,margin_pct=excluded.margin_pct,finalized_at=excluded.finalized_at;
    inserted_count:=inserted_count+1;
  end loop;
  return jsonb_build_object('inserted',inserted_count,'rejected',rejected_count,'quote_id',target_quote_id);
end;
$$;
revoke all on function public.record_quote_learning_observations(uuid,uuid,jsonb) from public,anon;
grant execute on function public.record_quote_learning_observations(uuid,uuid,jsonb) to authenticated;

select
  has_function_privilege('authenticated','public.finalize_quote(uuid,jsonb)','EXECUTE') as authenticated_finalize_rpc_should_be_true,
  has_function_privilege('anon','public.finalize_quote(uuid,jsonb)','EXECUTE') as anon_finalize_rpc_should_be_false,
  exists(select 1 from pg_trigger where tgname='smartquote_guard_final_quote' and not tgisinternal) as final_quote_guard_trigger_should_be_true;
