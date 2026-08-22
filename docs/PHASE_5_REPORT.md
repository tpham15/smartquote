# SmartQuote Supabase — Phase 5 Report

## Mục tiêu

Tách catalog sản phẩm khỏi JSON snapshot `dealer_app_state.products` để chuẩn bị cho SaaS nhiều đại lý và catalog lớn hơn.

Trước Phase 5, catalog được lưu trong một row JSONB:

```txt
public.dealer_app_state.products
```

Cách này nhanh cho MVP nhưng không bền khi một đại lý có vài nghìn đến vài chục nghìn sản phẩm.

## Đã thêm

### Database

File SQL mới:

```txt
supabase/phase5_catalog_items.sql
```

Tạo các bảng:

```txt
catalog_items
imports
import_rows
```

`catalog_items` dùng khóa chính:

```txt
(dealer_id, id)
```

Lý do: product id hiện tại của frontend là dạng text như `p_...`, không phải UUID. Giữ nguyên id giúp báo giá/template cũ không bị gãy tham chiếu.

### RPC

Thêm function:

```txt
sync_catalog_items(target_dealer_id, catalog_items_input, sync_mode, import_input)
log_catalog_import(target_dealer_id, import_input)
product_catalog_limit(plan_input)
```

`sync_catalog_items()` kiểm tra:

```txt
- User đã đăng nhập
- User thuộc dealer/workspace
- Workspace chưa hết hạn
- Số sản phẩm không vượt giới hạn gói
```

Giới hạn server-side:

```txt
Trial: 100 sản phẩm
Starter: 1.500 sản phẩm
Pro: 10.000 sản phẩm
Business: 50.000 sản phẩm
```

### Frontend store

File mới:

```txt
src/supabase/catalogStore.js
```

Có các hàm:

```txt
listCloudCatalog()
syncCloudCatalogSnapshot()
logCloudCatalogImport()
normalizeCatalogProducts()
serializeProductsForCatalog()
```

### App sync

Trong Cloud mode:

```txt
- App đọc catalog từ catalog_items
- dealer_app_state chỉ còn giữ settings nhẹ: templates/company/markups/suppliers/nameMap
- Khi catalog thay đổi, app debounce rồi sync vào catalog_items
- Nếu workspace cũ còn products trong dealer_app_state nhưng catalog_items rỗng, app migrate một lần sang catalog_items
```

### Import logs

Khi merge catalog trong importer, app ghi log vào:

```txt
imports
import_rows
```

Điều này giúp sau này làm màn hình lịch sử import, rollback import hoặc audit nguồn dữ liệu.

## File đã sửa/thêm

```txt
src/SmartQuote.jsx
src/supabase/cloudState.js
src/supabase/catalogStore.js
supabase/phase5_catalog_items.sql
supabase/schema.sql
scripts/catalog-store-smoke.mjs
package.json
docs/PHASE_5_REPORT.md
```

## Cần chạy trên Supabase

Nếu project đã chạy Phase 4, mở Supabase SQL Editor và chạy:

```txt
supabase/phase5_catalog_items.sql
```

Nếu tạo project mới từ đầu, chạy lại:

```txt
supabase/schema.sql
```

## Test đã chạy

```bash
npm ci
npm run build
npm run smoke:catalog
npm run smoke:tenant
npm run smoke:plan
npm run smoke:api-auth
npm run smoke:quotes
npm run smoke:import
npm run smoke:bom
npm run smoke:pdf
npm audit --omit=dev
```

Kết quả:

```txt
Build: PASS
Catalog store smoke: PASS
Tenant storage smoke: PASS
Plan gate smoke: PASS
API auth/quota smoke: PASS
Quote cloud smoke: PASS
Import smoke: PASS
BOM smoke: PASS
PDF smoke: PASS
Audit: FAIL do package xlsx có high severity advisory, no fix available
```

## Chưa làm trong Phase 5

Phase 5 hiện là hybrid source-of-truth theo bảng `catalog_items`, nhưng UI vẫn load catalog vào memory để giữ nguyên trải nghiệm hiện tại.

Chưa làm:

```txt
- Phân trang/search server-side cho catalog rất lớn
- Bulk import background job
- Rollback import từ bảng imports/import_rows
- E2E test thật với Supabase production
- Thay package xlsx
```

Các mục này nên xử lý ở Phase 7/8 khi app có dữ liệu thật lớn.
