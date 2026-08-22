# SmartQuote Phase 8 — Product Enrichment from Web

## Mục tiêu

Sau phỏng vấn nhóm nội thất, Phase 8 thêm flow:

> Gõ tên sản phẩm → SmartQuote tìm ứng viên web → lấy ảnh/giá/mã/SKU → user duyệt → lưu vào catalog.

Tính năng này cố tình **không tự nhập thẳng** vào catalog, vì sản phẩm nội thất thường có nhiều biến thể kích thước/màu/vật liệu và giá web có thể là giá khuyến mãi hoặc giá tham khảo.

## File mới / file sửa chính

- `api/product-enrich.js`
- `supabase/phase8_product_enrichment.sql`
- `scripts/phase8-smoke.mjs`
- `src/SmartQuote.jsx`
- `src/billing/planLimits.js`
- `api/_lib/limits.js`
- `api/_lib/rateLimit.js`
- `.env.example`

## API mới

```txt
POST /api/product-enrich
```

Request:

```json
{
  "query": "Ghế ăn Grace bọc nỉ chân sắt",
  "preferredSites": ["moho.com.vn", "noithathoaphat.com.vn"],
  "supplier": "MOHO",
  "category": "Ghế ăn",
  "serperApiKey": "optional-if-server-env-exists",
  "limit": 10
}
```

Response:

```json
{
  "ok": true,
  "searchProvider": "serper",
  "candidates": [
    {
      "name": "...",
      "sku": "...",
      "price": 1250000,
      "imageUrl": "https://...",
      "sourceUrl": "https://...",
      "sourceDomain": "...",
      "confidence": 0.82,
      "reasons": ["Có ảnh", "Có giá"],
      "warnings": ["Không tìm thấy SKU rõ ràng"]
    }
  ]
}
```

## Security / quota

`/api/product-enrich` dùng cùng security stack với Phase 7.1:

- Bắt Supabase JWT.
- Check user thuộc dealer/workspace.
- Check trial/gói còn hiệu lực.
- Rate limit theo dealer/user/IP.
- Consume quota atomic bằng `consume_usage_quota()`.
- Validate URL public.
- Fetch page bằng `redirect: manual`, validate lại từng redirect target để giảm SSRF.
- Giới hạn body size và HTML size.

## Quota mới

```txt
Trial:     5 lượt/tháng
Starter:  50 lượt/tháng
Pro:      250 lượt/tháng
Business: 1000 lượt/tháng
```

Event type:

```txt
product_enrich
```

## Cần chạy SQL

Nếu project Supabase đang ở Phase 7.1, chạy:

```txt
supabase/phase8_product_enrichment.sql
```

Nếu tạo project mới từ đầu, chạy:

```txt
supabase/schema.sql
```

## Env

Khuyến nghị set Serper key trên Vercel server env:

```txt
SERPER_API_KEY=...
```

Nếu chưa set server env, user có thể dán key Serper trong modal hoặc trong Cài đặt.

## UI mới

Trong tab Danh mục:

- Nút `✨ Tìm sản phẩm web`.
- Empty state cũng có nút `✨ Tìm sản phẩm từ web`.
- Modal nhập query, website nguồn ưu tiên, NCC/brand, nhóm, Serper key.
- Hiển thị 5–10 candidate dạng card.
- Mỗi candidate cho sửa tên/SKU/giá/NCC/nhóm/ảnh trước khi lưu.
- Lưu vào catalog tạo product mới có `sourceUrl` và `_meta.source = product_enrichment`.

## Test đã chạy

```bash
npm ci
npm run build
npm run smoke:phase8
npm run smoke:phase71
npm run smoke:hardening
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

Kết quả:

- Build: PASS
- Phase 8 smoke: PASS
- Toàn bộ smoke test cũ: PASS
- Audit: vẫn còn 1 high severity advisory từ `xlsx`, no fix available.

## Tự chấm

```txt
Phase 8: 8/10
```

Chưa chấm cao hơn vì:

- Chưa có E2E test thật với Serper + Supabase production.
- Chưa có ranking model chuyên sâu theo ngành nội thất.
- Chưa có domain allowlist/blacklist theo từng đại lý.
- Chưa có workflow enrichment hàng loạt cho nhiều dòng sản phẩm.
