# SmartQuote SaaS — Phase 0 & Phase 1 Report

## Phase 0 — Baseline / build check

Đã chạy trên bản `SmartQuote-Supabase-Cloud-MVP` trước khi sửa Phase 1:

```bash
npm ci
npm run build
node scripts/import-smoke.mjs
node scripts/bom-smoke.mjs
node scripts/pdf-smoke.mjs
npm audit --omit=dev
```

Kết quả:

- `npm run build`: PASS
- `scripts/import-smoke.mjs`: PASS guardrail
- `scripts/bom-smoke.mjs`: PASS với fixture BOM thật
- `scripts/pdf-smoke.mjs`: PASS deterministic offline parser
- `npm audit --omit=dev`: còn 1 high severity vulnerability từ `xlsx`, hiện npm báo `No fix available`

Ghi chú: warning Vite chunk >500KB vẫn là warning bundle size, không phải lỗi build.

## Phase 1 — Fix data isolation giữa các đại lý

File sửa chính:

```txt
src/SmartQuote.jsx
```

### Lỗi cũ

Trước đây app luôn đọc các key localStorage global:

```txt
sq_products
sq_templates
sq_company
sq_markups
sq_suppliers
sq_nameMap
```

Khi đại lý A dùng chung trình duyệt với đại lý B, cloud B rỗng có thể khiến dữ liệu local của A vẫn nằm trong state rồi bị autosave lên cloud B.

### Cách đã sửa

1. Khi Cloud/Supabase mode đang bật, app **không đọc localStorage global** nữa.
2. Khi đổi workspace/dealer, app reset màn hình về snapshot sạch ngay trong lúc chờ Supabase trả dữ liệu.
3. Cloud state luôn overwrite state frontend, kể cả khi mảng rỗng.
4. Local cache trong Cloud mode chỉ ghi theo `dealer_id`, dạng:

```txt
sq_dealer_<dealer_id>_products
sq_dealer_<dealer_id>_templates
sq_dealer_<dealer_id>_company
sq_dealer_<dealer_id>_markups
sq_dealer_<dealer_id>_suppliers
sq_dealer_<dealer_id>_nameMap
```

5. Local mode vẫn giữ tương thích key cũ `sq_*` để không phá bản chạy offline.

### Test thủ công cần chạy trên Supabase thật

```txt
1. Đăng ký đại lý A
2. Import 5 sản phẩm
3. Đăng xuất
4. Đăng ký đại lý B trên cùng trình duyệt
5. Catalog B phải trống
6. Import 2 sản phẩm cho B
7. Đăng xuất
8. Đăng nhập lại A
9. A vẫn thấy 5 sản phẩm, không thấy sản phẩm của B
10. Đăng nhập lại B
11. B vẫn thấy 2 sản phẩm, không thấy sản phẩm của A
```

### Chưa làm trong bản này

Các việc này thuộc Phase 2 trở đi:

- Auth protect `/api/claude`, `/api/web-products`, `/api/pdf-extract`
- Quota usage theo dealer
- Trial/plan gate
- Lưu báo giá cloud bằng bảng riêng
- Tách catalog khỏi JSON snapshot
