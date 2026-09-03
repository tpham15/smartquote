# SmartQuote Supabase — Phase 4 Report

## Mục tiêu

Phase 4 biến SmartQuote từ cloud catalog thành SaaS có lịch sử báo giá thật:

- Lưu báo giá cloud theo từng đại lý.
- Mở lại báo giá cũ.
- Lưu bản sao báo giá.
- Xóa báo giá.
- Theo dõi trạng thái báo giá: nháp / đã gửi / đã chốt / thua.
- Enforce quota `quotes_per_month` ở cả client-side và database RPC.

## File mới

```txt
src/supabase/quoteStore.js
supabase/phase4_quotes.sql
scripts/quote-cloud-smoke.mjs
docs/PHASE_4_REPORT.md
```

## File sửa chính

```txt
src/SmartQuote.jsx
src/billing/planLimits.js
supabase/schema.sql
package.json
```

## Database thêm mới

```txt
customers
quotes
```

### Bảng `quotes`

Lưu snapshot đầy đủ của báo giá:

```txt
- dealer_id
- customer_id
- quote_number
- customer_name / phone / address
- project_name
- category
- status: draft / sent / won / lost
- subtotal / labor_total / total
- point_count
- rooms jsonb
- customer jsonb
- calc jsonb
- created_by / updated_by
```

`rooms` vẫn lưu JSON để ít phá code hiện tại. Phase 5 mới nên tách `quote_items` nếu cần báo cáo sâu.

## RPC mới

```sql
public.save_quote(quote_input jsonb)
```

RPC này chịu trách nhiệm:

1. Xác thực `auth.uid()`.
2. Kiểm tra user thuộc `dealer_id`.
3. Kiểm tra trial/subscription còn hoạt động.
4. Nếu là báo giá mới, check quota `quotes_per_month`.
5. Tạo/cập nhật customer.
6. Insert/update quote.
7. Nếu tạo mới, ghi `usage_events.event_type = 'quotes_per_month'`.

Lý do dùng RPC thay vì cho browser insert trực tiếp vào `quotes`: tránh user bypass quota bằng cách gọi Supabase API trực tiếp.

## RLS

Đã bật RLS cho:

```txt
customers
quotes
```

Policy:

```txt
- Dealer members được select customers/quotes của dealer mình.
- Dealer members được delete quotes của dealer mình.
- Không mở direct insert/update quotes cho browser.
- Write báo giá đi qua RPC save_quote.
```

## UI mới

Trong tab **Báo giá**, khi đang dùng Cloud sẽ có box **Kho báo giá cloud**:

```txt
- Lưu báo giá
- Lưu thay đổi
- Lưu bản sao
- Mở báo giá cũ
- Xóa báo giá
- Đổi trạng thái: Nháp / Đã gửi / Đã chốt / Thua
- Hiển thị quota báo giá tháng này
```

## Test đã chạy

```bash
npm ci
node --check src/supabase/quoteStore.js
python3 -m py_compile api/excel.py api/auth_guard.py
node --check api/_lib/auth.js api/_lib/limits.js api/claude.js api/web-products.js api/pdf-extract.js api/img.js
npm run build
npm run smoke:quotes
npm run smoke:plan
npm run smoke:api-auth
npm run smoke:tenant
npm run smoke:import
npm run smoke:bom
npm run smoke:pdf
npm audit --omit=dev
```

Kết quả:

```txt
Build: PASS
Quote cloud smoke: PASS
Plan gate smoke: PASS
API auth/quota smoke: PASS
Tenant storage smoke: PASS
Import smoke: PASS
BOM smoke: PASS
PDF smoke: PASS
Audit: FAIL do xlsx high severity advisory, no fix available
```

## Chấm điểm

```txt
Phase 0:        8/10
Phase 1 + 1.1:  8.5/10
Phase 2:        8/10
Phase 3:        8/10
Phase 4:        8/10
```

Phase 4 chưa 10/10 vì:

- Chưa có browser E2E test thật với Supabase production.
- `quote_items` chưa tách thành bảng riêng.
- Chưa có filter/search nâng cao theo khách hàng, trạng thái, ngày.
- Chưa có team permission chi tiết cho owner/admin/sales.
- Payment vẫn manual.
- `xlsx` vẫn còn advisory.

## Checklist test thủ công trên Supabase thật

```txt
1. Chạy supabase/phase4_quotes.sql.
2. Login đại lý A.
3. Tạo báo giá có vài dòng thiết bị.
4. Bấm Lưu báo giá.
5. Refresh browser.
6. Bấm Mở báo giá cũ → mở lại báo giá vừa lưu.
7. Bấm Lưu bản sao → thấy thêm một báo giá mới.
8. Đổi trạng thái sang Đã gửi → Lưu thay đổi.
9. Login đại lý B trên cùng browser → không thấy báo giá của A.
10. Với Trial, tạo đủ 5 báo giá mới → báo giá thứ 6 bị chặn.
```
