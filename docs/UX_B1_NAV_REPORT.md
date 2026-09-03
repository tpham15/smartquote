# SmartQuote UX B1 — Gom nav 8→4

## Scope

Chỉ làm B1 theo spec UX: gom điều hướng chính từ các tab cũ sang 4 tab chính + sub-nav. Không đụng `src/import-engine/**`.

## Thay đổi

- Header còn 4 tab chính: Báo giá, Danh mục, Mẫu & Gói, Cài đặt.
- Thêm sub-nav:
  - Danh mục: Sản phẩm / Nhập file / Hỏi Nhà cung cấp
  - Mẫu & Gói: Gói phòng / Mẫu báo giá
  - Cài đặt: Chung / Gói sử dụng
- Giữ mapping tab cũ để các call `setTab("catalog")`, `setTab("takeoff")`, `setTab("upgrade")`... vẫn trỏ đúng màn mới.
- `openUpgrade()` trỏ về `settings > plan`.

## Test đã chạy

```bash
npm run smoke:ux-b1
npm run smoke:phase10
npm run smoke:core-review
npm run smoke:plan-limits
```

Kết quả: PASS.

## Ghi chú

Không chạy được `npm run build` trong sandbox này vì dependency install bị lỗi mạng/registry (`EAI_AGAIN`) và `vite` không có trong `node_modules`. Đã chạy syntax parse bằng TypeScript cho `src/SmartQuote.jsx`.
