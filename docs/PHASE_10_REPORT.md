# Phase 10 — Free Plan + Capability Gate

## Mục tiêu

Phase 10 triển khai pricing/gating theo 2 tầng:

1. **Quota**: còn lượt/tháng hoặc giới hạn tuyệt đối không.
2. **Capability**: gói hiện tại có quyền mở tính năng không.

SQL tiếp tục là nguồn chân lý. Generated files chỉ là mirror để UI/API/Python dùng nhanh và được smoke-test chống lệch.

## Thay đổi chính

### SQL

Thêm file:

- `supabase/phase10_plan_capabilities.sql`

Nội dung:

- Thêm gói `free`.
- Trial chuyển thành 14 ngày.
- Seed lại quota matrix cho `free/trial/starter/pro/business/expired`.
- Thêm bảng `plan_capability_catalog`.
- Thêm RPC `plan_has_capability(plan_input, capability_input)`.
- Thêm Free budget cho Serper = 0 USD.

### Generated files

`npm run generate:plan-limits` giờ đọc:

- `supabase/phase8_1_plan_limits_source.sql`
- `supabase/phase10_plan_capabilities.sql`

Và generate:

- `src/billing/planCatalog.generated.js`
- `api/_lib/planLimits.generated.js`
- `api/plan_limits_generated.py`

Generated output có thêm:

- `PLAN_CAPABILITIES`
- `PLAN_ORDER = ["free", "starter", "pro", "business"]`

### Client gate

Thêm:

- `src/billing/planCapabilities.js`
- `canAccessCapability()`

Các call-site đã được gate:

- AI import / Claude fallback: `ai_import` + quota `ai_claude_request`
- PDF extraction: `ai_import` + quota `pdf_extract`
- BOM/takeoff import: `bom_import`
- Quote variants A/B/C: `quote_variants_abc`
- Template memory: `template_memory`
- Correction learning: `correction_learning`
- Branded PDF: không chặn export, nhưng Free sẽ có watermark

### API gate

Thêm `assertPlanCapability()` trong:

- `api/_lib/limits.js`

Server-side gate đã cắm vào:

- `/api/claude` → `ai_import`
- `/api/pdf-extract` → `ai_import`

Quota vẫn chạy bằng `consume_usage_quota()`.

### Pricing UI

Trang Upgrade/Pricing giờ hiển thị:

- Free
- Starter
- Pro
- Business

Trial là trạng thái dùng thử 14 ngày, không phải card bán.

## Smoke test

Đã chạy pass:

```bash
npm run generate:plan-limits
npm run smoke:plan-limits
npm run smoke:phase10
node --check src/billing/planCapabilities.js
node --check api/_lib/limits.js
node --check api/claude.js
node --check api/pdf-extract.js
python3 -m py_compile api/auth_guard.py api/excel.py
```

## Lưu ý

Trong phiên này chưa chạy được `npm run build` vì thư mục zip không có `node_modules`, và `npm ci` bị timeout trong sandbox. Cần chạy lại trên máy local hoặc Vercel sau khi install dependencies.

## Cần chạy trên Supabase

Nếu project đang ở Phase 9, chạy:

```txt
supabase/phase10_plan_capabilities.sql
```

Nếu tạo project mới từ đầu, chạy:

```txt
supabase/schema.sql
```
