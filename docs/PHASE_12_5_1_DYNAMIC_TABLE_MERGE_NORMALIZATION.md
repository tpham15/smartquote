# SmartQuote Phase 12.5.1 — Dynamic Table Merge Normalization

## Mục tiêu

Giữ fidelity của template Excel lossless nhưng không sao chép các merge/drawing lịch sử làm sập hai trường dữ liệu động vào cùng một vùng hiển thị.

Case điển hình: header định nghĩa `Hình ảnh` và `Mã thiết bị` là hai cột riêng, nhưng một số dòng báo giá lịch sử có ảnh/drawing kéo ngang sang cột SKU hoặc có merge ngang giữa các cột dữ liệu.

## Nguyên tắc mới

**Header là schema; historical product rows chỉ là style donor.**

Nếu header đã map các cột `image`, `sku`, `supplier`, `qty`, `unitPrice`... thành các cột riêng, product row sinh mới không được merge hai semantic columns với nhau.

## Thay đổi

1. Analyzer quét nhiều product candidates và ưu tiên dòng style sạch, không có merge phá schema.
2. Product merge template được lọc trước khi clone. Merge nào bao phủ từ hai mapped product columns trở lên bị loại.
3. Có final fail-safe sau khi rebuild dynamic block để xóa mọi merge còn sót trên product rows nếu merge đó làm sập hai semantic columns.
4. Nếu cell bên phải của merge cũ không tồn tại trong OOXML, engine tạo lại cell và khôi phục body style từ style donor gần nhất.
5. Product image drawing anchor được khóa vào đúng `imageColumn`; `from` và `to` không được kéo sang `skuColumn`.
6. Nếu dòng style sạch không có image drawing, engine có thể lấy image anchor mẫu từ một product row khác trong vùng dynamic rồi normalize về cột ảnh.
7. Static header/footer, logo, styles, theme, printer settings và opaque workbook parts vẫn theo contract lossless.

## Regression

`npm run smoke:phase12.5.1`

Fixture cố ý tạo template lỗi với `E12:F12` và `E13:F13`, xóa cell SKU bên phải, đồng thời dùng drawing mẫu có khả năng span nhiều cột. Test bắt buộc:

- `E` và `F` tồn tại riêng trên mọi product row mới.
- SKU được ghi đúng vào `F`.
- SKU cell có body style.
- Không còn merge `E:F` trên product rows.
- Product image anchor bắt đầu/kết thúc trong column `E`.
- Static OOXML fidelity = 100%.

## Không thay đổi

- Không sửa database.
- Không thay đổi tenant isolation.
- Không sửa pricing/calc logic.
- Không sửa template gốc đã upload.
- Không normalize các merge ở static/footer region.
