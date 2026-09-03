# SmartQuote Phase 7.1 — Production Must-Fix Pack

## Mục tiêu

Phase 7.1 sửa các lỗi production quan trọng phát hiện sau review Phase 7:

1. Gói trả phí phải bị khóa khi `current_period_end` đã qua, kể cả `subscription_status = active`.
2. Web scrape và image proxy không được tự động follow redirect sang URL private/internal.
3. API quota phải consume atomically trong Postgres thay vì check-then-insert rời rạc.
4. Claude proxy phải whitelist/clamp payload để tránh user đã login gửi request quá rộng.
5. Upload Excel/PDF/ảnh phải có file-size guard trước khi parser đụng vào file.
6. Catalog autosave không được dùng snapshot-delete mặc định vì có thể xóa nhầm dữ liệu từ tab khác.

## File chính đã sửa

- `src/billing/planLimits.js`
- `api/_lib/limits.js`
- `api/auth_guard.py`
- `api/_lib/usage.js`
- `api/web-products.js`
- `api/img.js`
- `api/claude.js`
- `src/import-engine/fileGuards.js`
- `src/SmartQuote.jsx`
- `src/supabase/catalogStore.js`
- `supabase/phase7_1_must_fix.sql`
- `supabase/schema.sql`
- `supabase/phase4_quotes.sql`
- `supabase/phase5_catalog_items.sql`

## Supabase migration

Nếu project đã chạy tới Phase 7, chạy trong SQL Editor:

1. `supabase/phase4_quotes.sql`
2. `supabase/phase5_catalog_items.sql`
3. `supabase/phase7_1_must_fix.sql`

Lý do cần chạy lại Phase 4/5: các function SQL `save_quote()` và `sync_catalog_items()` được re-created với logic khóa gói trả phí đã hết hạn.

Nếu tạo project mới từ đầu, chạy `supabase/schema.sql` là đủ.

## Ghi chú quota

`/api/claude`, `/api/pdf-extract`, `/api/web-products`, `/api/excel` giờ gọi RPC `consume_usage_quota()` trước khi chạy tác vụ. RPC dùng `pg_advisory_xact_lock` theo dealer/event/month để tránh race condition quota khi user bấm nhiều request song song.

Quota sẽ bị trừ khi request được server chấp nhận xử lý. Nếu upstream sau đó lỗi, usage vẫn có thể được ghi nhận. Đây là trade-off có chủ đích để chống abuse.

## Ghi chú catalog autosave

Autosave catalog chuyển từ `snapshot` sang `merge`. Điều này tránh tab cũ xóa nhầm sản phẩm tab mới thêm. Các thao tác xóa rõ ràng dùng:

- `deleteCloudCatalogItems()` cho xóa từng sản phẩm / dọn rác
- `replaceCloudCatalog()` cho xóa toàn bộ catalog

## Chưa xử lý hoàn toàn

- Chưa thay package `xlsx`; mới guard file size và cô lập rủi ro.
- Chưa có browser E2E thật trên Vercel + Supabase production.
- Chưa có payment tự động payOS/webhook.
