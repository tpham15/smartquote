# Phase 12.1 — Smart Excel Template Mapper

## Mục tiêu

Giảm thao tác kỹ thuật khi đại lý upload mẫu Excel báo giá. Thay vì bắt user tự nhập ô/dòng/cột như `A6`, `J15`, SmartQuote tự nhận diện từ một file báo giá Excel đã điền sẵn rồi hiển thị tóm tắt để user xác nhận.

## Phạm vi

- Chỉ xử lý mẫu Excel `.xlsx`.
- Không làm PDF template.
- Không sửa `src/import-engine/**`.
- Không thêm localStorage/sessionStorage mới.
- Giữ Advanced mapping để user chỉnh tay nếu SmartQuote đoán sai.

## Thay đổi chính

### 1. Auto-detect mapping trong frontend

Thêm `detectExcelQuoteTemplateMapping(buffer, fileName)` trong `src/SmartQuote.jsx`.

Nó tự tìm:

- Ô thông tin khách hàng / số điện thoại / địa chỉ / hạng mục / số báo giá / ngày báo giá.
- Dòng header bảng sản phẩm.
- Cột STT, khu vực/phòng, tên sản phẩm, thông số, ảnh, mã thiết bị, hãng/xuất xứ, ĐVT, số lượng, đơn giá, thành tiền.
- Dòng sản phẩm mẫu để copy style.
- Dòng tiêu đề nhóm mẫu nếu có.
- Vùng tổng hợp và các ô tổng tiền.

### 2. UI xác nhận thay vì bắt nhập dòng/cột ngay

Màn `Mẫu & Gói > Mẫu báo giá` giờ hiển thị:

- `SmartQuote đã đoán mẫu này`
- Độ tin cậy
- Dòng header
- Dòng sản phẩm mẫu
- Dòng xoá dữ liệu cũ tới
- Số ô tổng tiền đã nhận diện
- Ghi chú nhận diện

Advanced mapping được gấp trong `<details>`: `Chỉnh tay nếu SmartQuote đoán sai`. Ngoài ra có thêm vùng `Click để sửa nhanh`: user chọn loại dữ liệu cần map rồi bấm trực tiếp vào ô trong preview Excel, không cần nhớ tọa độ như `A6` hay `J15`.

### 3. Preserve label prefix trong các ô thông tin

Nếu mẫu cũ ghi cùng ô như `Khách hàng: CÔNG TRÌNH MẪU`, SmartQuote lưu prefix `Khách hàng: ` để khi export ra vẫn là:

`Khách hàng: Tên khách mới`

Không còn ghi đè trơ trọi chỉ còn tên khách.

### 4. Dọn vùng dữ liệu cũ khi export

Mapping có thêm `items.clearUntilRow`. Khi export theo mẫu, API sẽ clear dữ liệu cũ trong vùng sản phẩm trước khi điền dòng mới. Việc này tránh lỗi báo giá mới còn sót item từ file mẫu đã điền sẵn.

## File sửa

- `src/SmartQuote.jsx`
- `api/excel-template.py`
- `package.json`

## File thêm

- `scripts/phase121-smart-excel-mapper-smoke.mjs`
- `scripts/phase121-api-workbook-smoke.py`
- `docs/PHASE_12_1_SMART_EXCEL_TEMPLATE_MAPPER_REPORT.md`

## Script mới

```bash
npm run smoke:phase12.1
```

## Test đã chạy

```bash
tsc --noEmit --allowJs --jsx react --moduleResolution node --target ES2020 --module ESNext --skipLibCheck src/SmartQuote.jsx
python3 -m py_compile api/excel-template.py
npm run smoke:phase12.1
npm run smoke:phase12
npm run smoke:auth-recovery
npm run smoke:phase11
npm run smoke:phase10.2
npm run smoke:vercel-registry
npm run smoke:design-system-cleanup
npm run smoke:core-review
npm run smoke:plan-limits
```

Kết quả: PASS.

## Giới hạn còn lại

- Auto-detect tốt nhất với file Excel báo giá đã điền sẵn, có nhãn rõ như `Khách hàng`, `STT`, `Tên hàng hoá`, `Số lượng`, `Đơn giá`, `Thành tiền`.
- Click-to-map hiện render preview tối đa khoảng 36 dòng và 12 cột đầu tiên. Nếu mẫu quá rộng hoặc vùng cần chọn nằm xa hơn, user vẫn có thể dùng Advanced mapping.
- Local SheetJS fallback không preserve style tốt bằng Python API `openpyxl`; production nên dùng API server khi chạy HTTPS.
