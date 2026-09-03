# SmartQuote Production Deploy Checklist

## 1. Supabase

Chạy SQL theo thứ tự nếu đang nâng cấp project cũ:

```txt
supabase/phase2_usage_events.sql
supabase/phase3_billing_plans.sql
supabase/phase4_quotes.sql
supabase/phase5_catalog_items.sql
supabase/phase6_billing_events.sql
supabase/phase7_hardening.sql
```

Nếu tạo project mới, chạy một lần:

```txt
supabase/schema.sql
```

Kiểm tra các bảng chính:

```txt
profiles
dealers
dealer_members
dealer_app_state
usage_events
customers
quotes
catalog_items
imports
import_rows
billing_events
api_rate_limits
api_logs
```

## 2. Vercel env

Frontend:

```bash
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY
```

Server-only:

```bash
SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
ANTHROPIC_API_KEY=YOUR_ANTHROPIC_API_KEY
SERPER_API_KEY=YOUR_SERPER_API_KEY # Phase 8 product enrichment
SMARTQUOTE_ALLOWED_ORIGIN=https://app.smartquote.vn
```

Manual payment copy:

```bash
VITE_SQ_SUPPORT_CONTACT=Zalo/Hotline: ...
VITE_SQ_PAYMENT_BANK=Ngân hàng: ...
VITE_SQ_PAYMENT_ACCOUNT=...
VITE_SQ_PAYMENT_OWNER=...
```

Không set trên production:

```bash
SMARTQUOTE_API_AUTH_DISABLED=true
SMARTQUOTE_RATE_LIMIT_DISABLED=true
```

## 3. Smoke test production

Sau deploy:

```txt
1. Đăng ký đại lý A.
2. Import 5 sản phẩm.
3. Tạo/lưu 1 báo giá.
4. Export Excel/PDF.
5. Cào web 1 URL nhỏ.
6. Logout.
7. Đăng ký đại lý B cùng trình duyệt.
8. B không được thấy sản phẩm/báo giá của A.
9. Kiểm tra Supabase api_logs có log request.
10. Test vượt quota/rate limit bằng cách gọi nhanh web scrape nhiều lần.
```

## 4. Cấu hình bảo mật nên bật

- Supabase RLS đã bật cho bảng public.
- Vercel production domain dùng HTTPS.
- `SMARTQUOTE_ALLOWED_ORIGIN` phải là domain thật, không để `*` khi chạy ads.
- Backup Supabase ít nhất daily nếu đã có khách trả tiền.
- Không đưa service role key vào biến `VITE_*`.

## 5. Trước khi chạy ads

Bản hiện tại phù hợp ads nhỏ có kiểm soát nếu đã deploy/test production. Cần có:

```txt
- Landing page / pricing page
- Privacy policy
- Terms of service
- Zalo/support rõ ràng
- Manual payment flow test OK
- Admin runbook kích hoạt gói OK
```

## 6. Rủi ro còn lại

`xlsx` vẫn có security advisory upstream. Không cho upload file Excel từ nguồn lạ vào máy nội bộ quan trọng; khuyến nghị khách chỉ upload bảng giá/BOM từ NCC/đội sales của họ. Phase hardening tiếp theo nên thay parser hoặc chạy parser trong worker sandbox.

## Phase 8.1 plan quota check

Before production deploy, run:

```bash
npm run smoke:plan-limits
```

If you change pricing/quota, edit SQL first:

```txt
supabase/phase8_1_plan_limits_source.sql
```

Then run `npm run generate:plan-limits` and rerun `smoke:plan-limits`. Do not manually change only the client/server JS quota maps.

## Phase 8.2 additions before paid traffic

Run this SQL after Phase 8.1:

```txt
supabase/phase8_2_operational_guardrails.sql
```

Then run:

```bash
npm run generate:plan-limits
npm run smoke:plan-limits
npm run smoke:phase82
npm run qa:production
```

Before launch, complete the manual two-user checklist:

```txt
docs/PRODUCTION_QA_2_USER_CHECKLIST.md
```

Extra env overrides for Serper cost/budget if needed:

```txt
SMARTQUOTE_SERPER_UNIT_COST_USD
SMARTQUOTE_SERPER_MONTHLY_BUDGET_USD
SMARTQUOTE_SERPER_STARTER_MONTHLY_BUDGET_USD
SMARTQUOTE_SERPER_PRO_MONTHLY_BUDGET_USD
SMARTQUOTE_SERPER_BUSINESS_MONTHLY_BUDGET_USD
```

Keep SQL as the source of truth for plan prices/quota. Edit `supabase/phase8_1_plan_limits_source.sql`, run `npm run generate:plan-limits`, then `npm run smoke:plan-limits`.
