-- SmartQuote RC16.1 — database acceptance: workspace roles + Final quote totals.
--
-- Run AFTER 01_RUN_ON_SUPABASE.sql (twice) on STAGING, as the SQL-editor user
-- (postgres). Everything happens inside one transaction that is ROLLED BACK at
-- the end: fixture users/workspaces/quotes are never kept.
--
-- Expected result: the last query prints one row per case with ok = true,
-- followed by a summary row "TOTAL" with failed = 0.
-- auth.uid() is simulated exactly like PostgREST does (request.jwt.claim.sub
-- and request.jwt.claims) and statements run as role "authenticated", so RLS,
-- grants, triggers and SECURITY DEFINER RPCs are all exercised.

begin;

create temp table rc161_results (n serial, code text, expectation text, ok boolean, detail text) on commit drop;
grant all on rc161_results to authenticated;
grant usage, select on sequence rc161_results_n_seq to authenticated;

-- Run one statement as a given user. Returns NULL on success or the error text.
create or replace function pg_temp.run_as(uid uuid, stmt text) returns text
language plpgsql as $$
declare err text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  perform set_config('request.jwt.claims', case when uid is null then '' else json_build_object('sub', uid, 'role', 'authenticated')::text end, true);
  begin
    execute 'set local role authenticated';
    execute stmt;
  exception when others then
    err := sqlerrm;
  end;
  -- Back to the SQL-editor identity: no end-user claims, original role.
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  return err;
end;
$$;

create or replace function pg_temp.expect_ok(code text, uid uuid, stmt text) returns void
language plpgsql as $$
declare err text := pg_temp.run_as(uid, stmt);
begin
  insert into rc161_results(code, expectation, ok, detail) values (code, 'thành công', err is null, coalesce(err, ''));
end;
$$;

create or replace function pg_temp.expect_fail(code text, uid uuid, stmt text, pattern text) returns void
language plpgsql as $$
declare err text := pg_temp.run_as(uid, stmt);
begin
  insert into rc161_results(code, expectation, ok, detail)
  values (code, 'bị chặn: ' || pattern, err is not null and err ~* pattern, coalesce(err, '(không có lỗi — lẽ ra phải bị chặn)'));
end;
$$;

create or replace function pg_temp.expect_true(code text, label text, cond boolean) returns void
language plpgsql as $$
begin
  insert into rc161_results(code, expectation, ok, detail) values (code, label, coalesce(cond, false), case when coalesce(cond,false) then '' else 'điều kiện sai' end);
end;
$$;

-- Fixture users -------------------------------------------------------------
create temp table rc161_ids on commit drop as
select gen_random_uuid() as owner_id, gen_random_uuid() as admin_id, gen_random_uuid() as sales_id,
       gen_random_uuid() as sales2_id, gen_random_uuid() as viewer_id, gen_random_uuid() as outsider_id,
       null::uuid as dealer_a, null::uuid as dealer_b, null::uuid as q_sales, null::uuid as q_owner, null::uuid as q_final;
grant all on rc161_ids to authenticated;

insert into auth.users (id, email)
select unnest(array[owner_id, admin_id, sales_id, sales2_id, viewer_id, outsider_id]),
       unnest(array['rc161-owner@test.local','rc161-admin@test.local','rc161-sales@test.local','rc161-sales2@test.local','rc161-viewer@test.local','rc161-outsider@test.local'])
from rc161_ids;

-- Workspaces are created through the real bootstrap RPC (tests the member-guard bootstrap path).
select pg_temp.expect_ok('W1 owner tạo workspace A', owner_id,
  'select public.ensure_dealer_workspace(''RC161 A'')') from rc161_ids;
update rc161_ids set dealer_a = (select dealer_id from public.dealer_members where user_id = rc161_ids.owner_id limit 1);
select pg_temp.expect_ok('W2 outsider tạo workspace B', outsider_id,
  'select public.ensure_dealer_workspace(''RC161 B'')') from rc161_ids;
update rc161_ids set dealer_b = (select dealer_id from public.dealer_members where user_id = rc161_ids.outsider_id limit 1);

-- Members are added by the service role (no invite UI yet).
insert into public.dealer_members (dealer_id, user_id, role)
select dealer_a, admin_id, 'admin' from rc161_ids union all
select dealer_a, sales_id, 'sales' from rc161_ids union all
select dealer_a, sales2_id, 'sales' from rc161_ids union all
select dealer_a, viewer_id, 'viewer' from rc161_ids;

-- Quote payload helper ------------------------------------------------------
create or replace function pg_temp.quote_json(dealer uuid, qid uuid, calc_override jsonb default null, rooms_override jsonb default null) returns text
language sql as $$
  select jsonb_build_object(
    'id', qid, 'dealer_id', dealer, 'customer_name', 'Khách RC16.1', 'status', 'draft',
    'subtotal', 1250999, 'labor_total', 93825, 'total', 1452410, 'point_count', 5,
    'customer', jsonb_build_object('name', 'Khách RC16.1', 'quoteNumber', 'RC161-TEST'),
    'rooms', coalesce(rooms_override, jsonb_build_array(jsonb_build_object('name', 'Phòng khách', 'lines', jsonb_build_array(
        jsonb_build_object('productId', 'p1', 'qty', 3, 'salePriceSnapshot', 333333, 'productSnapshot', jsonb_build_object('id','p1','name','Đèn A','sku','DL-1')),
        jsonb_build_object('productId', 'p2', 'qty', 2, 'salePriceSnapshot', 125500, 'productSnapshot', jsonb_build_object('id','p2','name','Đèn B','sku','DL-2')),
        jsonb_build_object('productId', 'p3', 'qty', 0, 'salePriceSnapshot', 999999, 'productSnapshot', jsonb_build_object('id','p3','name','Dòng SL 0','sku','DL-3'))
    )))),
    -- Reference values from src/quoteMath.js calculateQuoteTotals({deviceTotal: 1250999, laborPercent: 7.5, vatPercent: 8})
    'calc', coalesce(calc_override, jsonb_build_object('deviceTotal', 1250999, 'laborPercent', 7.5, 'laborTotal', 93825, 'preTaxTotal', 1344824,
      'vatPercent', 8, 'vatTotal', 107586, 'grand', 1452410, 'pointCount', 5, 'workflow', jsonb_build_object('lifecycle', 'draft')))
  )::text
$$;

-- R: quotes --------------------------------------------------------------------
select pg_temp.expect_fail('R01 viewer lưu báo giá', viewer_id,
  format('select public.save_quote(%L::jsonb)', pg_temp.quote_json(dealer_a, null)), 'không được phép') from rc161_ids;
select pg_temp.expect_ok('R02 sales lưu báo giá Draft', sales_id,
  format('select public.save_quote(%L::jsonb)', pg_temp.quote_json(dealer_a, null))) from rc161_ids;
update rc161_ids set q_sales = (select id from public.quotes where created_by = rc161_ids.sales_id order by created_at desc limit 1);
select pg_temp.expect_ok('R03 owner lưu báo giá Draft', owner_id,
  format('select public.save_quote(%L::jsonb)', pg_temp.quote_json(dealer_a, null))) from rc161_ids;
update rc161_ids set q_owner = (select id from public.quotes where created_by = rc161_ids.owner_id order by created_at desc limit 1);
select pg_temp.expect_fail('R04 người ngoài lưu báo giá vào workspace A', outsider_id,
  format('select public.save_quote(%L::jsonb)', pg_temp.quote_json(dealer_a, null)), 'not a member') from rc161_ids;

select pg_temp.expect_ok('R05 viewer thử xóa Draft của sales (RLS lọc, không lỗi)', viewer_id, format('delete from public.quotes where id = %L', q_sales)) from rc161_ids;
select pg_temp.expect_true('R05b Draft của sales vẫn còn sau khi viewer xóa', 'còn dòng', exists(select 1 from public.quotes where id = (select q_sales from rc161_ids)));
select pg_temp.expect_ok('R06 sales khác thử xóa Draft không phải của mình', sales2_id, format('delete from public.quotes where id = %L', q_sales)) from rc161_ids;
select pg_temp.expect_true('R06b Draft vẫn còn sau khi sales khác xóa', 'còn dòng', exists(select 1 from public.quotes where id = (select q_sales from rc161_ids)));
select pg_temp.expect_fail('R07 viewer đổi trạng thái bán hàng', viewer_id, format('select public.set_quote_sales_status(%L, ''sent'')', q_sales), 'không được phép') from rc161_ids;
select pg_temp.expect_ok('R08 sales đổi trạng thái bán hàng', sales_id, format('select public.set_quote_sales_status(%L, ''sent'')', q_sales)) from rc161_ids;
select pg_temp.expect_ok('R09 sales xóa Draft của chính mình', sales_id, format('delete from public.quotes where id = %L', q_sales)) from rc161_ids;
select pg_temp.expect_true('R09b Draft của sales đã bị xóa', 'không còn dòng', not exists(select 1 from public.quotes where id = (select q_sales from rc161_ids)));

-- F: Final quote totals -------------------------------------------------------
select pg_temp.expect_fail('F01 viewer chốt báo giá', viewer_id,
  format('select public.finalize_quote(%L, %L::jsonb)', q_owner, pg_temp.quote_json(dealer_a, q_owner)), 'không được phép') from rc161_ids;
select pg_temp.expect_fail('F02 chốt với tổng cộng bị sửa (grand +1.000đ)', owner_id,
  format('select public.finalize_quote(%L, %L::jsonb)', q_owner, pg_temp.quote_json(dealer_a, q_owner,
    jsonb_build_object('deviceTotal',1250999,'laborPercent',7.5,'laborTotal',93825,'vatPercent',8,'vatTotal',107586,'grand',1453410,'workflow',jsonb_build_object('lifecycle','draft')))), 'không khớp') from rc161_ids;
select pg_temp.expect_fail('F03 chốt khi tiền hàng khai thấp hơn các dòng (tổng nhất quán nhưng sai)', owner_id,
  format('select public.finalize_quote(%L, %L::jsonb)', q_owner, pg_temp.quote_json(dealer_a, q_owner,
    jsonb_build_object('deviceTotal',1000000,'laborPercent',7.5,'laborTotal',75000,'vatPercent',8,'vatTotal',86000,'grand',1161000,'workflow',jsonb_build_object('lifecycle','draft')))), 'không khớp') from rc161_ids;
select pg_temp.expect_fail('F04 chốt với % nhân công ngoài 0–100', owner_id,
  format('select public.finalize_quote(%L, %L::jsonb)', q_owner, pg_temp.quote_json(dealer_a, q_owner,
    jsonb_build_object('deviceTotal',1250999,'laborPercent',150,'laborTotal',1876499,'vatPercent',8,'vatTotal',0,'grand',0,'workflow',jsonb_build_object('lifecycle','draft')))), 'không hợp lệ') from rc161_ids;
select pg_temp.expect_fail('F05 chốt khi thiếu tổng tiền (calc rỗng)', owner_id,
  format('select public.finalize_quote(%L, %L::jsonb)', q_owner, pg_temp.quote_json(dealer_a, q_owner, jsonb_build_object('workflow',jsonb_build_object('lifecycle','draft')))), 'không khớp') from rc161_ids;
select pg_temp.expect_fail('F06 chốt khi cột total bên ngoài calc bị sửa', owner_id,
  format('select public.finalize_quote(%L, %L::jsonb)', q_owner, (pg_temp.quote_json(dealer_a, q_owner)::jsonb || jsonb_build_object('total', 1))::text), 'không khớp') from rc161_ids;
select pg_temp.expect_true('F06b báo giá vẫn là Draft sau các lần chốt bị từ chối', 'lifecycle = draft',
  (select lower(coalesce(calc->'workflow'->>'lifecycle','draft')) from public.quotes where id = (select q_owner from rc161_ids)) = 'draft');
select pg_temp.expect_ok('F07 sales chốt với tổng đúng (7,5% nhân công, 8% VAT, có làm tròn)', sales_id,
  format('select public.finalize_quote(%L, %L::jsonb)', q_owner, pg_temp.quote_json(dealer_a, q_owner))) from rc161_ids;
select pg_temp.expect_true('F07b Final lưu tổng do server tính', 'total = 1.452.410; serverVerifiedTotals có',
  (select total = 1452410 and subtotal = 1250999 and labor_total = 93825
          and (calc->'serverVerifiedTotals'->>'grand')::numeric = 1452410
          and lower(calc->'workflow'->>'lifecycle') = 'final'
   from public.quotes where id = (select q_owner from rc161_ids)));
select pg_temp.expect_fail('F08 owner xóa báo giá Final', owner_id, format('delete from public.quotes where id = %L', q_owner), 'không thể xóa') from rc161_ids;

-- Regression of RC14 M2 / RC15 F1 on the Final quote (now with role guards).
select pg_temp.expect_fail('F09 sửa nội dung Final bằng save_quote (bất biến)', owner_id,
  format('select public.save_quote(%L::jsonb)', (pg_temp.quote_json(dealer_a, q_owner)::jsonb || jsonb_build_object('total', 1))::text), 'bất biến|Final') from rc161_ids;
select pg_temp.expect_ok('F10 sales đánh dấu Final là đã gửi', sales_id, format('select public.set_quote_sales_status(%L, ''sent'')', q_owner)) from rc161_ids;
select pg_temp.expect_true('F10b nội dung Final không đổi khi đổi trạng thái', 'status = sent, total giữ nguyên',
  (select status = 'sent' and total = 1452410 from public.quotes where id = (select q_owner from rc161_ids)));
select pg_temp.expect_fail('F11 trạng thái không hợp lệ', owner_id, format('select public.set_quote_sales_status(%L, ''paid'')', q_owner), 'không hợp lệ') from rc161_ids;
select pg_temp.expect_fail('F12 viewer ghi dữ liệu học từ Final', viewer_id,
  format('select public.record_quote_learning_observations(%L, %L, ''[{"product_id":"p1"}]''::jsonb)', dealer_a, q_owner), 'không được phép') from rc161_ids;
select pg_temp.expect_ok('F13 sales ghi dữ liệu học từ Final', sales_id,
  format('select public.record_quote_learning_observations(%L, %L, ''[{"product_id":"p1"}]''::jsonb)', dealer_a, q_owner)) from rc161_ids;
select pg_temp.expect_true('F13b đúng 1 dòng học được lưu (từ snapshot, không phải từ trình duyệt)', '1 dòng, giá 333.333',
  (select count(*) = 1 and min(sale_price) = 333333 from public.quote_learning_observations where quote_id = (select q_owner from rc161_ids)));
select pg_temp.expect_fail('F14 anon chốt báo giá', null,
  format('select public.finalize_quote(null, %L::jsonb)', pg_temp.quote_json(dealer_a, null)), 'permission denied|not authenticated') from rc161_ids;

-- C: catalog / app state / storage -------------------------------------------
select pg_temp.expect_fail('C01 viewer đồng bộ danh mục', viewer_id,
  format('select public.sync_catalog_items(%L, ''[{"id":"x1","name":"Đèn X","sku":"X-1"}]''::jsonb, ''merge'', ''{}''::jsonb)', dealer_a), 'không được phép') from rc161_ids;
select pg_temp.expect_ok('C02 sales đồng bộ danh mục', sales_id,
  format('select public.sync_catalog_items(%L, ''[{"id":"x1","name":"Đèn X","sku":"X-1"}]''::jsonb, ''merge'', ''{}''::jsonb)', dealer_a)) from rc161_ids;
select pg_temp.expect_fail('C03 viewer ghi log nhập danh mục', viewer_id,
  format('select public.log_catalog_import(%L, ''{"source_type":"excel","source_name":"f.xlsx","merge_mode":"merge","status":"applied","products":[]}''::jsonb)', dealer_a), 'không được phép') from rc161_ids;
select pg_temp.expect_ok('C04 viewer thử sửa products trong dealer_app_state (RLS lọc)', viewer_id,
  format('update public.dealer_app_state set products = ''[{"id":"hack"}]''::jsonb where dealer_id = %L', dealer_a)) from rc161_ids;
select pg_temp.expect_true('C04b products không bị viewer sửa', 'không có hack',
  not exists(select 1 from public.dealer_app_state where dealer_id = (select dealer_a from rc161_ids) and products @> '[{"id":"hack"}]'::jsonb));
select pg_temp.expect_fail('C05 sales đổi thông tin công ty (số tài khoản in trên báo giá)', sales_id,
  format('update public.dealer_app_state set company = ''{"bankInfo":"STK lạ"}''::jsonb where dealer_id = %L', dealer_a), 'thông tin công ty') from rc161_ids;
select pg_temp.expect_fail('C06 sales đổi hệ số giá', sales_id,
  format('update public.dealer_app_state set markups = ''[{"name":"x","factor":0.5}]''::jsonb where dealer_id = %L', dealer_a), 'hệ số giá') from rc161_ids;
select pg_temp.expect_ok('C07 sales lưu dữ liệu workspace khác (templates)', sales_id,
  format('update public.dealer_app_state set templates = ''[{"id":"t1"}]''::jsonb where dealer_id = %L', dealer_a)) from rc161_ids;
select pg_temp.expect_ok('C08 admin đổi thông tin công ty', admin_id,
  format('update public.dealer_app_state set company = ''{"bankInfo":"STK công ty"}''::jsonb where dealer_id = %L', dealer_a)) from rc161_ids;
select pg_temp.expect_true('C08b thông tin công ty đã đổi bởi admin', 'bankInfo = STK công ty',
  (select company->>'bankInfo' from public.dealer_app_state where dealer_id = (select dealer_a from rc161_ids)) = 'STK công ty');
select pg_temp.expect_fail('C09 viewer tải ảnh sản phẩm lên', viewer_id,
  format('insert into storage.objects (bucket_id, name) values (''catalog-product-images'', %L)', dealer_a::text || '/p1/a.webp'), 'row-level security|policy') from rc161_ids;
select pg_temp.expect_ok('C10 sales tải ảnh sản phẩm lên', sales_id,
  format('insert into storage.objects (bucket_id, name) values (''catalog-product-images'', %L)', dealer_a::text || '/p1/a.webp')) from rc161_ids;

-- B: billing ----------------------------------------------------------------
select pg_temp.expect_fail('B01 sales yêu cầu nâng gói', sales_id,
  format('select public.create_manual_billing_request(%L, ''pro'', ''monthly'', '''', '''')', dealer_a), 'không được phép') from rc161_ids;
select pg_temp.expect_ok('B02 owner yêu cầu nâng gói', owner_id,
  format('select public.create_manual_billing_request(%L, ''pro'', ''monthly'', '''', '''')', dealer_a)) from rc161_ids;

-- M: membership ---------------------------------------------------------------
select pg_temp.expect_fail('M01 viewer tự thêm mình làm owner', viewer_id,
  format('insert into public.dealer_members (dealer_id, user_id, role) values (%L, %L, ''owner'')', dealer_a, viewer_id), 'row-level security|quản lý thành viên|duplicate|unique') from rc161_ids;
select pg_temp.expect_ok('M02 sales thử tự nâng vai trò (RLS lọc)', sales_id,
  format('update public.dealer_members set role = ''owner'' where user_id = %L', sales_id)) from rc161_ids;
select pg_temp.expect_true('M02b vai trò sales không đổi', 'role = sales',
  (select role from public.dealer_members where user_id = (select sales_id from rc161_ids)) = 'sales');
select pg_temp.expect_fail('M03 owner workspace B thêm mình vào workspace A', outsider_id,
  format('insert into public.dealer_members (dealer_id, user_id, role) values (%L, %L, ''owner'')', dealer_a, outsider_id), 'row-level security|quản lý thành viên') from rc161_ids;

-- Summary ------------------------------------------------------------------------
select code, ok, expectation, detail from rc161_results
union all
select 'TOTAL', count(*) filter (where not ok) = 0, count(*)::text || ' ca', 'failed = ' || count(*) filter (where not ok) from rc161_results
order by 1;

rollback;
