# SmartQuote Phase 6 — Manual Payment + Admin Plan Operations

## Mục tiêu

Phase 6 biến pricing/upgrade từ màn hình giới thiệu thành một flow vận hành được trong beta:

1. Đại lý chọn gói Starter / Pro / Business.
2. App tạo yêu cầu thanh toán thủ công với mã chuyển khoản riêng.
3. Admin đối soát chuyển khoản.
4. Admin kích hoạt/gia hạn gói bằng Supabase SQL Editor hoặc service role.

Chưa tích hợp payOS/webhook tự động ở phase này.

---

## File đã thêm/sửa

```txt
src/supabase/billingStore.js
supabase/phase6_billing_events.sql
scripts/billing-smoke.mjs
docs/PHASE_6_REPORT.md
.env.example
src/SmartQuote.jsx
src/billing/planLimits.js
supabase/schema.sql
package.json
```

---

## Bảng mới

```txt
billing_events
- id
- dealer_id
- user_id
- plan: starter / pro / business
- billing_cycle: monthly / annual
- months
- amount_vnd
- status: pending / paid / approved / activated / rejected / canceled
- transfer_content
- customer_note
- customer_contact
- admin_note
- payment_reference
- activated_at
- expires_at
- created_at / updated_at
```

RLS: member của dealer chỉ được `select`. Browser không được insert/update trực tiếp; tạo yêu cầu qua RPC `create_manual_billing_request()`.

---

## RPC mới

### User-facing

```sql
select * from public.create_manual_billing_request(
  '<DEALER_ID>',
  'pro',
  'monthly',
  'Đã chuyển khoản lúc 10:30',
  '090xxxxxxx'
);
```

RPC này chỉ chạy nếu user hiện tại là member của workspace.

### Admin-only

Các function dưới đây **không grant cho authenticated/anon**. Chỉ chạy từ Supabase SQL Editor hoặc service role sau khi đã xác minh thanh toán.

Kích hoạt từ một billing event:

```sql
select public.admin_activate_manual_billing_event(
  '<BILLING_EVENT_ID>',
  'bank_txn_123',
  'Đã nhận tiền, kích hoạt thủ công'
);
```

Kích hoạt thẳng dealer nếu không dùng billing event:

```sql
select public.admin_activate_dealer_plan(
  '<DEALER_ID>',
  'pro',
  1,
  'Kích hoạt thủ công 1 tháng'
);
```

Gia hạn 12 tháng:

```sql
select public.admin_activate_dealer_plan(
  '<DEALER_ID>',
  'business',
  12,
  'Thanh toán năm'
);
```

---

## Giá đang cấu hình

```txt
Starter monthly:   499.000đ
Starter annual:    4.990.000đ
Pro monthly:       899.000đ
Pro annual:        8.990.000đ
Business monthly:  1.899.000đ
Business annual:   18.990.000đ
```

Giá được mirror ở:

```txt
src/supabase/billingStore.js
src/billing/planLimits.js
supabase/phase6_billing_events.sql
```

Nếu đổi giá, cần đổi đồng bộ cả frontend và SQL.

---

## Env frontend tùy chọn

```bash
VITE_SQ_SUPPORT_CONTACT=Zalo/Hotline: 090x xxx xxx
VITE_SQ_PAYMENT_BANK=Ngân hàng: MB Bank / Vietcombank / ...
VITE_SQ_PAYMENT_ACCOUNT=0123456789
VITE_SQ_PAYMENT_OWNER=SMARTQUOTE VIET NAM
```

Các biến này chỉ dùng để hiển thị hướng dẫn trên trang Upgrade, không chứa secret.

---

## Test đã chạy

```bash
npm run build
npm run smoke:billing
npm run smoke:catalog
npm run smoke:quotes
npm run smoke:plan
npm run smoke:api-auth
npm run smoke:tenant
npm run smoke:import
npm run smoke:bom
npm run smoke:pdf
npm audit --omit=dev
```

Kết quả mong đợi: build/smoke pass. `npm audit` vẫn fail do `xlsx` high severity advisory và hiện package báo no fix available.

---

## Chưa làm ở Phase 6

- Chưa tích hợp payOS webhook tự động.
- Chưa có admin dashboard riêng.
- Chưa có email/Zalo notification tự động cho pending payment.
- Chưa enforce seat limit/team invitation vì chưa có team UI.
