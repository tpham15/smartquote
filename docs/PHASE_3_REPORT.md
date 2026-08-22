# SmartQuote Phase 3 — Trial, Plan Gate, Quota UI

## Mục tiêu

Biến SmartQuote Cloud từ bản có đăng nhập/API quota thành bản SaaS có gói sử dụng:

- Trial 7 ngày
- Starter 499.000đ/tháng
- Pro 899.000đ/tháng
- Business 1.899.000đ/tháng
- Khóa workspace khi trial/gói hết hạn
- Gate theo quota trước khi người dùng import/cào web/xuất Excel/gọi AI

## File chính đã thêm/sửa

- `src/billing/planLimits.js`
- `src/supabase/cloudState.js`
- `src/supabase/SupabaseAuthGate.jsx`
- `src/SmartQuote.jsx`
- `api/_lib/limits.js`
- `api/_lib/auth.js`
- `api/auth_guard.py`
- `supabase/phase3_billing_plans.sql`
- `supabase/schema.sql`
- `scripts/plan-gate-smoke.mjs`
- `package.json`

## Database migration

Nếu project đã chạy schema trước Phase 3, mở Supabase SQL Editor và chạy:

```sql
supabase/phase3_billing_plans.sql
```

Migration thêm vào bảng `dealers`:

- `trial_ends_at`
- `subscription_status`
- `current_period_end`
- `plan_started_at`

và cập nhật function `ensure_dealer_workspace()` để user mới luôn có trial 7 ngày.

## Gói hiện tại

### Trial

- 7 ngày
- 100 sản phẩm catalog
- 5 báo giá/tháng (UI hiển thị, quote cloud sẽ enforce kỹ hơn ở Phase 4)
- 3 web scrape/tháng
- 3 PDF AI/tháng
- 10 export Excel/tháng
- 50 Claude request/tháng

### Starter — 499.000đ/tháng

- 1 user
- 1.500 sản phẩm
- 30 báo giá/tháng
- 20 web scrape/tháng
- 10 PDF AI/tháng
- 100 export Excel/tháng
- 300 Claude request/tháng

### Pro — 899.000đ/tháng

- 3 users
- 10.000 sản phẩm
- Báo giá không giới hạn
- 100 web scrape/tháng
- 50 PDF AI/tháng
- 1.000 export Excel/tháng
- 1.500 Claude request/tháng

### Business — 1.899.000đ/tháng

- 10 users
- 50.000 sản phẩm
- Báo giá không giới hạn
- 500 web scrape/tháng
- 300 PDF AI/tháng
- 5.000 export Excel/tháng
- 6.000 Claude request/tháng

## Gate đã enforce

Frontend gate:

- Trial/plan banner
- Trang Gói sử dụng / Upgrade
- Khóa workspace khi trial expired / canceled / past_due
- Giới hạn số sản phẩm catalog khi thêm thủ công/import/merge/replace
- Gate web scrape trước khi gọi `/api/web-products`
- Gate PDF AI trước khi gọi pipeline PDF
- Gate export Excel trước khi gọi `/api/excel`
- Gate Claude auto-map trong catalog/takeoff/KTS khi hết quota

Server-side gate:

- `/api/claude`
- `/api/pdf-extract`
- `/api/web-products`
- `/api/excel`

Server sẽ trả `402` nếu workspace hết trial/gói, và `403` nếu vượt quota.

## Lưu ý còn lại

- Quote limit mới hiển thị trong pricing/usage. Phase 4 cần lưu quotes cloud để enforce chính xác `quotes_per_month`.
- Seat limit cần Phase Team/Members sau này.
- Payment vẫn là manual upgrade. Phase 6 sẽ thêm payOS/admin billing.
- `xlsx` vẫn có audit advisory và chưa có fix tự động.

## Test đã chạy

```bash
npm ci
node --check api/_lib/limits.js
node --check api/_lib/auth.js
node --check src/billing/planLimits.js
python3 -m py_compile api/excel.py api/auth_guard.py
npm run build
npm run smoke:plan
npm run smoke:api-auth
npm run smoke:tenant
npm run smoke:import
npm run smoke:bom
npm run smoke:pdf
npm audit --omit=dev
```

Kết quả: build/smoke pass. `npm audit --omit=dev` fail do `xlsx` high severity, no fix available.
