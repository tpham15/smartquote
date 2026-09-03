# Phase 12.2 — Excel Template Fidelity Export

## Mục tiêu

Sửa luồng **Xuất theo mẫu Excel đại lý** để file xuất ra giữ layout của mẫu thật tốt hơn, thay vì tạo bảng Excel kiểu plain table. Phase này tiếp tục giữ scope **Excel-only**, không xử lý PDF template.

## Thay đổi chính

### 1. Clone workbook gốc, không dựng workbook mới

API `/api/excel-template` tiếp tục mở chính file `.xlsx` mẫu bằng `openpyxl`, nhưng Phase 12.2 chuyển sang chế độ fidelity:

- giữ workbook gốc làm nền
- giữ header/logo/footer/print setup/cột/dòng/style có sẵn
- chỉ thay vùng dữ liệu khách hàng, sản phẩm và tổng tiền

### 2. Xoá vùng sản phẩm cũ đúng cách

Với mẫu đã điền sẵn, API xoá vùng sản phẩm cũ theo mapping:

- `items.sectionRow`
- `items.startRow`
- `items.templateRow`
- `items.clearUntilRow`

Các ảnh cũ nằm trong vùng sản phẩm bị gỡ để tránh sót ảnh cũ.

### 3. Copy style dòng mẫu

Khi sinh báo giá mới:

- dòng tiêu đề nhóm copy style từ `sectionRow`
- dòng sản phẩm copy style từ `templateRow`
- giữ row height, font, fill, border, alignment, number format
- recreate merge ngang cho section row
- không recreate merge dọc của item row, vì một số mẫu merge thông số qua nhiều dòng cũ, gây không ghi được sản phẩm mới

### 4. Insert ảnh thật, không ghi URL vào ô Hình ảnh

Nếu cột `image` được mapping:

- data URL image → insert vào Excel như ảnh thật
- HTTP/HTTPS image URL → fetch với guard SSRF cơ bản, giới hạn size/timeouts
- nếu không lấy được ảnh → để trống
- không bao giờ ghi URL dài vào cell ảnh

### 5. Rebuild công thức

API tạo lại:

- line total: `=Số lượng * Đơn giá`
- tổng từng section
- tổng tiền hàng
- nhân công theo tỷ lệ từ báo giá hiện tại
- tổng giá trị hợp đồng

Workbook được set full recalculation khi mở trong Excel.

### 6. Rebuild phần tổng hợp nhóm

Với các mẫu có vùng “TỔNG HỢP CÁC GIẢI PHÁP…”, API xoá summary cũ và điền lại tên section + công thức section total để không còn stale rows từ báo giá mẫu.

## File sửa

- `api/excel-template.py`
- `src/SmartQuote.jsx`
- `package.json`

## File thêm

- `scripts/phase122-api-fidelity-smoke.py`
- `docs/PHASE_12_2_EXCEL_TEMPLATE_FIDELITY_EXPORT_REPORT.md`

## Smoke test

```bash
npm run smoke:phase12.2
npm run smoke:phase12.1
npm run smoke:phase12
npm run smoke:phase11
npm run smoke:core-review
npm run smoke:plan-limits
```

## Ghi chú giới hạn

- Excel output fidelity phụ thuộc định dạng file `.xlsx` gốc. Các object rất đặc biệt như WMF/EMF/shape lạ có thể bị thư viện Excel bỏ qua nếu không được hỗ trợ.
- PDF template vẫn nằm ngoài scope.
- Nếu template có merge dọc phức tạp trong vùng sản phẩm, Phase 12.2 ưu tiên ghi đúng dữ liệu mới và giữ style, không tái tạo merge dọc gây khoá cell.
