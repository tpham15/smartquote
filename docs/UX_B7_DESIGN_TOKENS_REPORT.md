# UX B7 — Token hệ hình

## Phạm vi

- Chỉ sửa lớp UI trong `src/SmartQuote.jsx`.
- Không sửa `src/import-engine/**`.
- Không thêm `localStorage` / `sessionStorage`.

## Đã làm

- Thêm token CSS vào `:root`:
  - type scale: `--fs-*`
  - spacing: `--sp-*`
  - radius: `--r-*`
  - màu: `--c-primary`, `--c-text`, `--c-muted`, `--c-line`, `--c-bg`, warning/danger/success tokens.
- Giữ legacy aliases (`--brand`, `--bg`, `--line`, `--warn-bg`, ...) trỏ về token mới để không phá component cũ.
- Chuẩn hóa nút chính:
  - `.btn-primary` dùng `--c-primary`.
  - `.btn-pdf` dùng `--c-primary` để là hành động chính duy nhất ở màn báo giá.
  - `.btn-excel` chuyển sang nút phụ dạng viền, không còn nút xanh đặc.
- Chuẩn hóa một số typography/spacing lặp lại bằng token:
  - `.app`
  - `.card h2`
  - `.section-title`
  - bảng preview/danh mục cơ bản.

## Test

Chạy:

```bash
npm run smoke:ux-b7
npm run smoke:ux-b6
npm run smoke:ux-b5
npm run smoke:ux-b4
npm run smoke:ux-b3
npm run smoke:ux-b2
npm run smoke:ux-b1
npm run smoke:phase10
npm run smoke:core-review
npm run smoke:plan-limits
```

Trong sandbox hiện thiếu `vite` trong `node_modules`, nên cần chạy lại `npm ci && npm run build` trên máy local/Vercel.
