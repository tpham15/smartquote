# Multi-tenant QA checklist

Chạy checklist này trước khi đưa khách thật vào.

## Case 1: Cloud mới không copy local legacy

1. Trước khi login, tạo dữ liệu local/offline hoặc để sẵn `sq_products` trong localStorage.
2. Bật Supabase env và đăng ký tài khoản đại lý mới.
3. Kỳ vọng: catalog cloud mới trống, không tự copy dữ liệu từ `sq_products`.

## Case 2: Hai đại lý cùng trình duyệt không lẫn dữ liệu

1. Login đại lý A, import sản phẩm A1/A2/A3.
2. Logout.
3. Login/đăng ký đại lý B.
4. Kỳ vọng: không thấy A1/A2/A3.
5. Import sản phẩm B1/B2.
6. Logout và login lại A.
7. Kỳ vọng: thấy A1/A2/A3, không thấy B1/B2.

## Case 3: Local mode không bị phá

1. Xóa `.env.local` hoặc bỏ Supabase env.
2. Chạy `npm run dev`.
3. Import catalog.
4. Refresh browser.
5. Kỳ vọng: dữ liệu vẫn được giữ bằng key localStorage cũ `sq_*`.

## Automated Phase 1.1 check

Run this before shipping a new build:

```bash
npm run smoke:tenant
```

This verifies that correction learning, BOM learning, import templates, PDF cache, AI quota and temporary catalog backups are scoped to `sq_dealer_<dealerId>_*` in cloud mode and remain legacy `sq_*` in local/offline mode.

## Phase 4 — Cloud quotes QA

```txt
1. Login đại lý A, tạo và lưu 2 báo giá cloud.
2. Logout, login đại lý B trên cùng browser.
3. Bấm “Mở báo giá cũ”: danh sách phải trống hoặc chỉ có báo giá của B.
4. Tạo 1 báo giá cho B, logout.
5. Login lại A: chỉ thấy 2 báo giá của A, không thấy báo giá B.
6. Với trial, tạo đủ 5 báo giá mới; lần tạo thứ 6 phải bị chặn quota.
7. Mở một báo giá cũ, sửa số lượng, bấm “Lưu thay đổi”: không tăng quota báo giá.
8. Bấm “Lưu bản sao”: tăng quota báo giá thêm 1.
```
