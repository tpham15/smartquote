# UX B2 — Một cửa “Nhập file”

## Scope

Chỉ sửa lớp UI trong `src/SmartQuote.jsx` và smoke test. Không sửa `src/import-engine/**`, không thêm localStorage/sessionStorage.

## Đã làm

- Tab `Danh mục > Nhập file` không còn mở thẳng màn đọc bóc tách.
- Thêm `UnifiedImportHub` với câu hỏi người dùng dễ hiểu: “Bạn có file gì?”
- Có 2 lựa chọn lớn:
  - `Bảng giá nhà cung cấp`: mở lại luồng import catalog hiện tại bằng `CatalogImporter`.
  - `Bảng bóc tách từ KTS / kỹ sư`: render lại `TakeoffReader` hiện tại.
- Trong `Danh mục > Sản phẩm`, nút import được đổi thành `📥 Nhập file` và chuyển tới `Danh mục > Nhập file` thay vì mở thêm một lối import riêng.
- Empty catalog button `Nhập bảng giá` cũng chuyển qua hub nhập file.

## Test đã chạy

```bash
npm run smoke:ux-b2
npm run smoke:ux-b1
npm run smoke:phase10
npm run smoke:core-review
npm run smoke:plan-limits
```

Kết quả: PASS.

## Syntax parse

```bash
tsc --allowJs --jsx react-jsx --noEmit --skipLibCheck --noResolve --typeRoots /tmp/emptytypes src/SmartQuote.jsx
```

Kết quả: PASS.

## Build

Chưa chạy được `npm run build` trong sandbox vì `npm ci` bị lỗi registry/internal tarball. Cần chạy lại trên máy local hoặc Vercel sau khi tải zip.
