-- ===========================================================================
-- SmartQuote P2.3.14.1 — RC16.1 PILOT LOCK
-- Safe to re-run. Appended verbatim to supabase/schema.sql (fresh install) and
-- 01_RUN_ON_SUPABASE.sql (upgrade). scripts/pilot-p23141-rc161-smoke.mjs checks
-- that the three copies are identical.
--
-- A. Workspace roles are enforced IN THE DATABASE, for every write path
--    (direct table access, SECURITY DEFINER RPCs and Storage):
--
--    | Thao tác                                             | owner | admin | sales           | viewer |
--    |------------------------------------------------------|-------|-------|-----------------|--------|
--    | Xem dữ liệu workspace                                |  ✓    |  ✓    |  ✓              |  ✓     |
--    | Tạo/sửa/lưu báo giá, chốt Final, đổi trạng thái bán  |  ✓    |  ✓    |  ✓              |  ✗     |
--    | Xóa báo giá Draft (Final: không ai xóa được)         |  ✓    |  ✓    | chỉ báo giá mình tạo |  ✗ |
--    | Nhập/sửa/xóa danh mục, ảnh sản phẩm, lịch sử nhập    |  ✓    |  ✓    |  ✓              |  ✗     |
--    | Khách hàng, dữ liệu học từ báo giá                   |  ✓    |  ✓    |  ✓ (không xóa)  |  ✗     |
--    | Thông tin công ty (ngân hàng, mẫu in) và hệ số giá   |  ✓    |  ✓    |  ✗              |  ✗     |
--    | Yêu cầu / báo đã chuyển khoản gói                    |  ✓    |  ✓    |  ✗              |  ✗     |
--    | Thêm / đổi vai trò / xóa thành viên                  |  ✓    |  ✗    |  ✗              |  ✗     |
--
--    Requests without an end-user (service role, SQL editor, server jobs:
--    auth.uid() is null) are not restricted by these guards.
--
-- B. finalize_quote recomputes the quote totals from the frozen line snapshots
--    (Σ qty × salePriceSnapshot → nhân công → VAT → tổng) and refuses to
--    finalize when the totals sent by the browser differ by more than 1 đ.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- A1. Role helpers
-- ---------------------------------------------------------------------------
create or replace function public.smartquote_member_role(target_dealer_id uuid)
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select dm.role
  from public.dealer_members dm
  where dm.dealer_id = target_dealer_id and dm.user_id = auth.uid()
  limit 1
$$;

create or replace function public.smartquote_has_role(target_dealer_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(public.smartquote_member_role(target_dealer_id) = any(allowed_roles), false)
$$;

revoke all on function public.smartquote_member_role(uuid) from public, anon;
revoke all on function public.smartquote_has_role(uuid, text[]) from public, anon;
grant execute on function public.smartquote_member_role(uuid) to authenticated, service_role;
grant execute on function public.smartquote_has_role(uuid, text[]) to authenticated, service_role;

create or replace function public.smartquote_role_action_label(op text)
returns text
language sql
immutable
as $$
  select case upper(op) when 'INSERT' then 'thêm' when 'UPDATE' then 'sửa' when 'DELETE' then 'xóa' else lower(op) end
$$;

-- ---------------------------------------------------------------------------
-- A2. Generic role guard trigger
--   tg_argv[0] roles allowed to INSERT/UPDATE   (comma separated)
--   tg_argv[1] roles allowed to DELETE          (comma separated)
--   tg_argv[2] Vietnamese label of the data     (for the error message)
--   tg_argv[3] roles allowed to DELETE only rows they created (created_by = auth.uid())
-- ---------------------------------------------------------------------------
create or replace function public.smartquote_role_guard()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
  write_roles text[] := string_to_array(coalesce(tg_argv[0], ''), ',');
  delete_roles text[] := string_to_array(coalesce(tg_argv[1], coalesce(tg_argv[0], '')), ',');
  data_label text := coalesce(nullif(tg_argv[2], ''), tg_table_name);
  own_delete_roles text[] := string_to_array(coalesce(tg_argv[3], ''), ',');
  old_dealer uuid;
  new_dealer uuid;
  role_name text;
begin
  if uid is null then
    -- service role / SQL admin / server jobs
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    old_dealer := nullif(to_jsonb(old)->>'dealer_id', '')::uuid;
    role_name := public.smartquote_member_role(old_dealer);
    if tg_op = 'DELETE' then
      if not (coalesce(role_name = any(delete_roles), false)
              or (coalesce(role_name = any(own_delete_roles), false)
                  and nullif(to_jsonb(old)->>'created_by', '')::uuid = uid)) then
        raise exception 'Vai trò "%" không được phép xóa % trong workspace này.', coalesce(role_name, 'không thuộc workspace'), data_label
          using errcode = '42501';
      end if;
      return old;
    end if;
    if not coalesce(role_name = any(write_roles), false) then
      raise exception 'Vai trò "%" không được phép sửa % trong workspace này.', coalesce(role_name, 'không thuộc workspace'), data_label
        using errcode = '42501';
    end if;
  end if;

  new_dealer := nullif(to_jsonb(new)->>'dealer_id', '')::uuid;
  role_name := public.smartquote_member_role(new_dealer);
  if not coalesce(role_name = any(write_roles), false) then
    raise exception 'Vai trò "%" không được phép % % trong workspace này.', coalesce(role_name, 'không thuộc workspace'), public.smartquote_role_action_label(tg_op), data_label
      using errcode = '42501';
  end if;
  return new;
end;
$$;

do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      ('quotes',                      'owner,admin,sales', 'owner,admin',       'báo giá',              'sales'),
      ('catalog_items',               'owner,admin,sales', 'owner,admin,sales', 'danh mục sản phẩm',    ''),
      ('dealer_app_state',            'owner,admin,sales', 'owner,admin',       'dữ liệu workspace',    ''),
      ('customers',                   'owner,admin,sales', 'owner,admin',       'khách hàng',           ''),
      ('imports',                     'owner,admin,sales', 'owner,admin,sales', 'lịch sử nhập',         ''),
      ('import_rows',                 'owner,admin,sales', 'owner,admin,sales', 'lịch sử nhập',         ''),
      ('quote_learning_observations', 'owner,admin,sales', 'owner,admin',       'dữ liệu học báo giá',  ''),
      ('usage_events',                'owner,admin,sales', 'owner,admin',       'nhật ký sử dụng',      ''),
      ('billing_events',              'owner,admin',       'owner,admin',       'thanh toán gói',       '')
    ) as t(table_name, write_roles, delete_roles, data_label, own_delete_roles)
  loop
    if to_regclass('public.' || spec.table_name) is null then continue; end if;
    execute format('drop trigger if exists smartquote_role_guard on public.%I', spec.table_name);
    execute format(
      'create trigger smartquote_role_guard before insert or update or delete on public.%I for each row execute function public.smartquote_role_guard(%L, %L, %L, %L)',
      spec.table_name, spec.write_roles, spec.delete_roles, spec.data_label, spec.own_delete_roles
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- A3. Company settings (bank account, print template) and price markups are
--     owner/admin only — a sales account must not be able to change the bank
--     account printed on quotes or the pricing policy.
-- ---------------------------------------------------------------------------
create or replace function public.smartquote_app_state_settings_guard()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
  role_name text;
  old_company jsonb;
  old_markups jsonb;
begin
  if uid is null then return new; end if;
  role_name := public.smartquote_member_role(new.dealer_id);
  if coalesce(role_name = any(array['owner','admin']), false) then return new; end if;
  if tg_op = 'INSERT' then
    old_company := '{}'::jsonb;
    old_markups := '[]'::jsonb;
  else
    old_company := coalesce(old.company, '{}'::jsonb);
    old_markups := coalesce(old.markups, '[]'::jsonb);
  end if;
  if coalesce(new.company, '{}'::jsonb) is distinct from old_company then
    raise exception 'Vai trò "%" không được phép đổi thông tin công ty (ngân hàng, mẫu báo giá). Hãy nhờ chủ/quản trị workspace.', coalesce(role_name, 'không thuộc workspace')
      using errcode = '42501';
  end if;
  if coalesce(new.markups, '[]'::jsonb) is distinct from old_markups then
    raise exception 'Vai trò "%" không được phép đổi hệ số giá. Hãy nhờ chủ/quản trị workspace.', coalesce(role_name, 'không thuộc workspace')
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists smartquote_app_state_settings_guard on public.dealer_app_state;
create trigger smartquote_app_state_settings_guard
before insert or update on public.dealer_app_state
for each row execute function public.smartquote_app_state_settings_guard();

-- ---------------------------------------------------------------------------
-- A4. Membership: only an owner manages members. The single exception is the
--     bootstrap row ensure_dealer_workspace() writes for a brand-new workspace
--     (first member, the caller, as owner).
-- ---------------------------------------------------------------------------
create or replace function public.smartquote_members_guard()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
  target_dealer uuid;
begin
  if uid is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  target_dealer := case when tg_op = 'DELETE' then old.dealer_id else new.dealer_id end;
  if tg_op = 'INSERT'
     and new.user_id = uid
     and new.role = 'owner'
     and not exists (select 1 from public.dealer_members dm where dm.dealer_id = new.dealer_id) then
    return new; -- bootstrap of a new workspace
  end if;
  if tg_op = 'UPDATE' and old.dealer_id is distinct from new.dealer_id then
    raise exception 'Không được chuyển thành viên sang workspace khác.' using errcode = '42501';
  end if;
  if not public.smartquote_has_role(target_dealer, array['owner']) then
    raise exception 'Chỉ chủ workspace (owner) mới được quản lý thành viên.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists smartquote_members_guard on public.dealer_members;
create trigger smartquote_members_guard
before insert or update or delete on public.dealer_members
for each row execute function public.smartquote_members_guard();

-- ---------------------------------------------------------------------------
-- A5. Row-level policies mirror the same matrix (defence in depth).
-- ---------------------------------------------------------------------------
drop policy if exists "Quotes deletable by dealer members" on public.quotes;
drop policy if exists "Quotes deletable by dealer owners admins or creator" on public.quotes;
create policy "Quotes deletable by dealer owners admins or creator"
on public.quotes for delete
to authenticated
using (
  public.smartquote_has_role(dealer_id, array['owner','admin'])
  or (public.smartquote_has_role(dealer_id, array['sales']) and created_by = auth.uid())
);

drop policy if exists "Catalog deletable by dealer admins" on public.catalog_items;
drop policy if exists "Catalog deletable by dealer writers" on public.catalog_items;
create policy "Catalog deletable by dealer writers"
on public.catalog_items for delete
to authenticated
using (public.smartquote_has_role(dealer_id, array['owner','admin','sales']));

drop policy if exists "Dealer app state insertable by members" on public.dealer_app_state;
drop policy if exists "Dealer app state insertable by writers" on public.dealer_app_state;
create policy "Dealer app state insertable by writers"
on public.dealer_app_state for insert
to authenticated
with check (public.smartquote_has_role(dealer_id, array['owner','admin','sales']));

drop policy if exists "Dealer app state updatable by members" on public.dealer_app_state;
drop policy if exists "Dealer app state updatable by writers" on public.dealer_app_state;
create policy "Dealer app state updatable by writers"
on public.dealer_app_state for update
to authenticated
using (public.smartquote_has_role(dealer_id, array['owner','admin','sales']))
with check (public.smartquote_has_role(dealer_id, array['owner','admin','sales']));

-- ---------------------------------------------------------------------------
-- A6. Storage (catalog product images): viewers may list/read, not write.
-- ---------------------------------------------------------------------------
create or replace function public.can_write_catalog_image_path(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  dealer_text text;
  dealer_uuid uuid;
begin
  dealer_text := split_part(coalesce(object_name, ''), '/', 1);
  if dealer_text = '' then return false; end if;
  begin
    dealer_uuid := dealer_text::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  return public.smartquote_has_role(dealer_uuid, array['owner','admin','sales']);
end;
$$;
revoke all on function public.can_write_catalog_image_path(text) from public, anon;
grant execute on function public.can_write_catalog_image_path(text) to authenticated, service_role;

do $$
begin
  if to_regclass('storage.objects') is null then return; end if;
  execute 'drop policy if exists "Catalog images insert by dealer members" on storage.objects';
  execute 'drop policy if exists "Catalog images update by dealer members" on storage.objects';
  execute 'drop policy if exists "Catalog images delete by dealer members" on storage.objects';
  execute 'drop policy if exists "Catalog images insert by dealer writers" on storage.objects';
  execute 'drop policy if exists "Catalog images update by dealer writers" on storage.objects';
  execute 'drop policy if exists "Catalog images delete by dealer writers" on storage.objects';
  execute $p$create policy "Catalog images insert by dealer writers" on storage.objects for insert to authenticated
    with check (bucket_id = 'catalog-product-images' and public.can_write_catalog_image_path(name))$p$;
  execute $p$create policy "Catalog images update by dealer writers" on storage.objects for update to authenticated
    using (bucket_id = 'catalog-product-images' and public.can_write_catalog_image_path(name))
    with check (bucket_id = 'catalog-product-images' and public.can_write_catalog_image_path(name))$p$;
  execute $p$create policy "Catalog images delete by dealer writers" on storage.objects for delete to authenticated
    using (bucket_id = 'catalog-product-images' and public.can_write_catalog_image_path(name))$p$;
end;
$$;

-- ---------------------------------------------------------------------------
-- B. finalize_quote: server-side totals verification
-- ---------------------------------------------------------------------------
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
  line_qty numeric;
  line_price numeric;
  client_calc jsonb := coalesce(quote_input->'calc', '{}'::jsonb);
  labor_pct numeric;
  vat_pct numeric;
  server_device numeric := 0;
  server_points numeric := 0;
  server_labor numeric;
  server_pretax numeric;
  server_vat numeric;
  server_grand numeric;
  verified_totals jsonb;
begin
  if current_user_id is null then raise exception 'Not authenticated'; end if;
  if target_dealer_id is null or not public.is_dealer_member(target_dealer_id) then raise exception 'Not a member of this dealer workspace'; end if;
  if not public.smartquote_has_role(target_dealer_id, array['owner','admin','sales']) then
    raise exception 'Vai trò "%" không được phép chốt báo giá trong workspace này.', coalesce(public.smartquote_member_role(target_dealer_id), 'không thuộc workspace')
      using errcode = '42501';
  end if;

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
      line_qty := coalesce((line->>'qty')::numeric,0);
      if line_qty <= 0 then continue; end if;
      if nullif(trim(line->>'productId'),'') is null then raise exception 'Dòng báo giá thiếu productId'; end if;
      if jsonb_typeof(line->'productSnapshot') <> 'object' then raise exception 'Dòng báo giá thiếu productSnapshot'; end if;
      line_price := coalesce((line->>'salePriceSnapshot')::numeric,0);
      if line_price <= 0 then raise exception 'Dòng báo giá thiếu salePriceSnapshot'; end if;
      -- RC16.1: the money on a Final quote is what the frozen lines say.
      server_device := server_device + line_qty * line_price;
      server_points := server_points + line_qty;
    end loop;
  end loop;

  -- RC16.1: same formula as src/quoteMath.js calculateQuoteTotals().
  labor_pct := coalesce(nullif(client_calc->>'laborPercent','')::numeric, 0);
  vat_pct := coalesce(nullif(client_calc->>'vatPercent','')::numeric, 0);
  if labor_pct < 0 or labor_pct > 100 or vat_pct < 0 or vat_pct > 100 then
    raise exception 'Tỷ lệ nhân công/VAT không hợp lệ (nhân công %%: %, VAT %%: %).', labor_pct, vat_pct;
  end if;
  server_labor := round(server_device * labor_pct / 100);
  server_pretax := server_device + server_labor;
  server_vat := round(server_pretax * vat_pct / 100);
  server_grand := server_pretax + server_vat;

  if nullif(client_calc->>'deviceTotal','') is null or nullif(client_calc->>'grand','') is null
     or abs(coalesce(nullif(client_calc->>'deviceTotal','')::numeric, -1) - server_device) > 1
     or abs(coalesce(nullif(client_calc->>'laborTotal','')::numeric, 0) - server_labor) > 1
     or abs(coalesce(nullif(client_calc->>'vatTotal','')::numeric, 0) - server_vat) > 1
     or abs(coalesce(nullif(client_calc->>'grand','')::numeric, -1) - server_grand) > 1
     or abs(coalesce(nullif(quote_input->>'subtotal','')::numeric, server_device) - server_device) > 1
     or abs(coalesce(nullif(quote_input->>'labor_total','')::numeric, server_labor) - server_labor) > 1
     or abs(coalesce(nullif(quote_input->>'total','')::numeric, server_grand) - server_grand) > 1 then
    raise exception 'Tổng tiền báo giá không khớp với các dòng sản phẩm (server tính % đ, trình duyệt gửi % đ). Hãy tải lại báo giá rồi chốt lại.',
      to_char(server_grand, 'FM999G999G999G990'), coalesce(client_calc->>'grand', '?');
  end if;

  verified_totals := jsonb_build_object(
    'deviceTotal', server_device, 'laborPercent', labor_pct, 'laborTotal', server_labor,
    'preTaxTotal', server_pretax, 'vatPercent', vat_pct, 'vatTotal', server_vat, 'grand', server_grand,
    'pointCount', server_points, 'verifiedAt', finalized_at_value
  );

  sanitized := jsonb_set(coalesce(quote_input,'{}'::jsonb), '{calc}', jsonb_set(client_calc, '{workflow}', jsonb_set(coalesce(client_calc->'workflow','{}'::jsonb), '{lifecycle}', '"draft"'::jsonb, true), true), true);
  if qid is not null then sanitized := jsonb_set(sanitized,'{id}',to_jsonb(qid::text),true); end if;
  qid := public.save_quote(sanitized);

  perform set_config('smartquote.allow_finalize','on',true);
  update public.quotes
  set calc = jsonb_set(
        jsonb_set(coalesce(calc,'{}'::jsonb), '{workflow}',
          jsonb_set(
            jsonb_set(
              jsonb_set(coalesce(calc->'workflow','{}'::jsonb), '{lifecycle}', '"final"'::jsonb, true),
              '{finalizedAt}', to_jsonb(finalized_at_value::text), true),
            '{finalizedBy}', to_jsonb(current_user_id::text), true), true),
        '{serverVerifiedTotals}', verified_totals, true),
      subtotal = server_device,
      labor_total = server_labor,
      total = server_grand,
      updated_by=current_user_id
  where id=qid and dealer_id=target_dealer_id;
  -- RC16.1: close the window immediately. set_config(..., true) would otherwise
  -- keep Final quotes editable until the end of the surrounding transaction.
  perform set_config('smartquote.allow_finalize','off',true);

  return jsonb_build_object('id',qid,'quote_id',qid,'finalized_at',finalized_at_value,'server_verified_totals',verified_totals);
end;
$$;
revoke all on function public.finalize_quote(uuid,jsonb) from public, anon;
grant execute on function public.finalize_quote(uuid,jsonb) to authenticated;

commit;

-- RC16.1 verification — every *_should_be_true column must be t, every *_should_be_false f.
select
  exists(select 1 from pg_trigger where tgname='smartquote_role_guard' and tgrelid='public.quotes'::regclass) as quotes_role_guard_should_be_true,
  exists(select 1 from pg_trigger where tgname='smartquote_role_guard' and tgrelid='public.catalog_items'::regclass) as catalog_role_guard_should_be_true,
  exists(select 1 from pg_trigger where tgname='smartquote_role_guard' and tgrelid='public.dealer_app_state'::regclass) as app_state_role_guard_should_be_true,
  exists(select 1 from pg_trigger where tgname='smartquote_app_state_settings_guard') as app_state_settings_guard_should_be_true,
  exists(select 1 from pg_trigger where tgname='smartquote_role_guard' and tgrelid='public.billing_events'::regclass) as billing_role_guard_should_be_true,
  exists(select 1 from pg_trigger where tgname='smartquote_members_guard') as members_guard_should_be_true,
  exists(select 1 from pg_policies where policyname='Quotes deletable by dealer members') as old_member_delete_policy_should_be_false,
  position('serverVerifiedTotals' in pg_get_functiondef('public.finalize_quote(uuid,jsonb)'::regprocedure)) > 0 as finalize_server_totals_should_be_true,
  has_function_privilege('anon','public.finalize_quote(uuid,jsonb)','EXECUTE') as anon_finalize_rpc_should_be_false,
  has_function_privilege('anon','public.smartquote_has_role(uuid,text[])','EXECUTE') as anon_role_helper_should_be_false;
