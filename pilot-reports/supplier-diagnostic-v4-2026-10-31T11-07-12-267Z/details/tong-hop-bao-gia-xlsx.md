# REVIEW — Tổng hợp báo giá.xlsx

- Products: 100
- Golden: none — unverified supplier file
- Spreadsheet: engine=v2, sourceRows=117, previewLines=101

## Root-cause clusters

- **MISSING_SKU**: 30
- **ENGINE_MISSING_SKU**: 30
- **NEEDS_REVIEW**: 12
- **ENGINE_LINE_REVIEW**: 12
- **DUPLICATE_PRICE_CONFLICT**: 8
- **ENGINE_PRICE_COLUMN_UNCERTAIN**: 4
- **ENGINE_PRICE_RECOVERED**: 3

## Row-level diagnostics

### 1. WARN — MISSING_SKU
- Product has no SKU/model code.
- Source: sheet=KHÓA BIỆT THỰ · row=6
- Raw: `1 Màu sắc: Mạ vàng 24K Chất liệu: Đồng nguyên khối Phụ kiện kèm theo: 02 thẻ từ , 02 chìa cơ , 04 pin AA Phương thức mở khóa: * Vân tay * Mã số * Thẻ từ: Thẻ tần số cao, tích hợp tháng máy * Chìa cơ * Mở khóa từ xa qua App Tuya Mở khóa khẩn cấp: Chìa khóa cơ/Cổng USB Chế độ thông phòng: Khi chế độ thông phòng được kích hoạt, không cần dùng vân tay, mã số vẫn có thể mở được khóa. Dung lượng bộ nhớ: 150 users. Tuổi thọ pin: 5.000 lần mở khóa Kích thước khóa: 84x730mm Chốt an toàn bên trong: Khi bật lên, bên ngoài dù có vân tay cũng không mở khóa được, đảm bảo chế độ riêng tư. Mật khẩu/ Vân tay/Thẻ từ/ Chìa cơ/App 1 38690000 39890000 24 tháng Hết hàng`
- Parsed: `{"name":"Cảm biến - Mật khẩu/Vân tay/Thẻ từ...","sku":"","category":"Cảm biến","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":39890000,"listPrice":39890000}`
- Engine issue codes: missing_sku

### 2. WARN — ENGINE_MISSING_SKU
- Thiếu mã SKU — vẫn có thể nhập nếu tên và giá đã rõ
- Source: sheet=KHÓA BIỆT THỰ · row=6
- Raw: `1 Màu sắc: Mạ vàng 24K Chất liệu: Đồng nguyên khối Phụ kiện kèm theo: 02 thẻ từ , 02 chìa cơ , 04 pin AA Phương thức mở khóa: * Vân tay * Mã số * Thẻ từ: Thẻ tần số cao, tích hợp tháng máy * Chìa cơ * Mở khóa từ xa qua App Tuya Mở khóa khẩn cấp: Chìa khóa cơ/Cổng USB Chế độ thông phòng: Khi chế độ thông phòng được kích hoạt, không cần dùng vân tay, mã số vẫn có thể mở được khóa. Dung lượng bộ nhớ: 150 users. Tuổi thọ pin: 5.000 lần mở khóa Kích thước khóa: 84x730mm Chốt an toàn bên trong: Khi bật lên, bên ngoài dù có vân tay cũng không mở khóa được, đảm bảo chế độ riêng tư. Mật khẩu/ Vân tay/Thẻ từ/ Chìa cơ/App 1 38690000 39890000 24 tháng Hết hàng`
- Parsed: `{"name":"Cảm biến - Mật khẩu/Vân tay/Thẻ từ...","sku":"","category":"Cảm biến","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":39890000,"listPrice":39890000}`
- Engine issue codes: missing_sku

### 3. WARN — MISSING_SKU
- Product has no SKU/model code.
- Source: sheet=KHÓA BIỆT THỰ · row=7
- Raw: `2 Màu sắc: Mạ vàng 24K Chất liệu: Đồng nguyên khối Phụ kiện kèm theo: 02 thẻ từ , 02 chìa cơ , 04 pin AA Phương thức mở khóa: * Vân tay * Mã số * Thẻ từ: Thẻ tần số cao, tích hợp tháng máy * Chìa cơ * Mở khóa từ xa qua App Tuya Mở khóa khẩn cấp: Chìa khóa cơ/Cổng USB Chế độ thông phòng: Khi chế độ thông phòng được kích hoạt, không cần dùng vân tay, mã số vẫn có thể mở được khóa. Dung lượng bộ nhớ: 150 users. Tuổi thọ pin: 5.000 lần mở khóa Kích thước khóa: 84x480mm Chốt an toàn bên trong: Khi bật lên, bên ngoài dù có vân tay cũng không mở khóa được, đảm bảo chế độ riêng tư. Mật khẩu/ Vân tay/Thẻ từ/ Chìa cơ/App 1 36990000 38190000 24 tháng`
- Parsed: `{"name":"Cảm biến - Mật khẩu/Vân tay/Thẻ từ...","sku":"","category":"Cảm biến","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":38190000,"listPrice":38190000}`
- Engine issue codes: missing_sku

### 4. WARN — ENGINE_MISSING_SKU
- Thiếu mã SKU — vẫn có thể nhập nếu tên và giá đã rõ
- Source: sheet=KHÓA BIỆT THỰ · row=7
- Raw: `2 Màu sắc: Mạ vàng 24K Chất liệu: Đồng nguyên khối Phụ kiện kèm theo: 02 thẻ từ , 02 chìa cơ , 04 pin AA Phương thức mở khóa: * Vân tay * Mã số * Thẻ từ: Thẻ tần số cao, tích hợp tháng máy * Chìa cơ * Mở khóa từ xa qua App Tuya Mở khóa khẩn cấp: Chìa khóa cơ/Cổng USB Chế độ thông phòng: Khi chế độ thông phòng được kích hoạt, không cần dùng vân tay, mã số vẫn có thể mở được khóa. Dung lượng bộ nhớ: 150 users. Tuổi thọ pin: 5.000 lần mở khóa Kích thước khóa: 84x480mm Chốt an toàn bên trong: Khi bật lên, bên ngoài dù có vân tay cũng không mở khóa được, đảm bảo chế độ riêng tư. Mật khẩu/ Vân tay/Thẻ từ/ Chìa cơ/App 1 36990000 38190000 24 tháng`
- Parsed: `{"name":"Cảm biến - Mật khẩu/Vân tay/Thẻ từ...","sku":"","category":"Cảm biến","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":38190000,"listPrice":38190000}`
- Engine issue codes: missing_sku

### 5. WARN — MISSING_SKU
- Product has no SKU/model code.
- Source: sheet=KHÓA THÔNG MINH · row=6
- Raw: `1 Điện áp làm việc: 4 Pin AA Tuổi thọ pin: 5.000 lần mở khóa Vân tay cảm biến điện dung: <0.1s Chất liệu: Hợp kim chịu lực Ngôn ngữ: App tiếng Việt Nguồn điện khẩn cấp: Cấp qua cổng USB Tỷ lệ sai số: <0.0001% Dung lượng bộ nhớ: 100 users Kích thước khóa: 60x75mm Độ dày cửa: >35mm Loại cửa: Cửa kim loại, cửa gỗ Màu sắc:Bạc/đen/vàng Mật khẩu/ Vân tay/Thẻ từ// Chìa cơ/App/Remote (mở rộng) 1 4800000 4990000 24 tháng.`
- Parsed: `{"name":"Khóa thông minh - Mật khẩu/Vân tay/Thẻ từ...","sku":"","category":"Khóa thông minh","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":4990000,"listPrice":4990000}`
- Engine issue codes: missing_sku

### 6. WARN — ENGINE_MISSING_SKU
- Thiếu mã SKU — vẫn có thể nhập nếu tên và giá đã rõ
- Source: sheet=KHÓA THÔNG MINH · row=6
- Raw: `1 Điện áp làm việc: 4 Pin AA Tuổi thọ pin: 5.000 lần mở khóa Vân tay cảm biến điện dung: <0.1s Chất liệu: Hợp kim chịu lực Ngôn ngữ: App tiếng Việt Nguồn điện khẩn cấp: Cấp qua cổng USB Tỷ lệ sai số: <0.0001% Dung lượng bộ nhớ: 100 users Kích thước khóa: 60x75mm Độ dày cửa: >35mm Loại cửa: Cửa kim loại, cửa gỗ Màu sắc:Bạc/đen/vàng Mật khẩu/ Vân tay/Thẻ từ// Chìa cơ/App/Remote (mở rộng) 1 4800000 4990000 24 tháng.`
- Parsed: `{"name":"Khóa thông minh - Mật khẩu/Vân tay/Thẻ từ...","sku":"","category":"Khóa thông minh","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":4990000,"listPrice":4990000}`
- Engine issue codes: missing_sku

### 7. WARN — MISSING_SKU
- Product has no SKU/model code.
- Source: sheet=KHÓA THÔNG MINH · row=8
- Raw: `2 Điện áp làm việc: 4 Pin AAA Tuổi thọ pin: 5.000 lần mở khóa Vân tay cảm biến điện dung: <0.1s Chất liệu: Hợp kim chịu lực Ngôn ngữ: App tiếng Việt Nguồn điện khẩn cấp: Cấp điện qua cổng USB Tỷ lệ sai số: <0.0001% Dung lượng bộ nhớ: 100 users Kích thước khóa: 155x29mm Độ dày cửa: >35mm Loại cửa: Cửa kim loại, cửa gỗ Màu sắc:Bạc/đen Mật khẩu/ Vân tay/Thẻ từ// Chìa cơ/App/Remote (mở rộng) 1 4000000 4190000 24 tháng.`
- Parsed: `{"name":"Khóa thông minh - Mật khẩu/Vân tay/Thẻ từ...","sku":"","category":"Khóa thông minh","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":4190000,"listPrice":4190000}`
- Engine issue codes: missing_sku

### 8. WARN — ENGINE_MISSING_SKU
- Thiếu mã SKU — vẫn có thể nhập nếu tên và giá đã rõ
- Source: sheet=KHÓA THÔNG MINH · row=8
- Raw: `2 Điện áp làm việc: 4 Pin AAA Tuổi thọ pin: 5.000 lần mở khóa Vân tay cảm biến điện dung: <0.1s Chất liệu: Hợp kim chịu lực Ngôn ngữ: App tiếng Việt Nguồn điện khẩn cấp: Cấp điện qua cổng USB Tỷ lệ sai số: <0.0001% Dung lượng bộ nhớ: 100 users Kích thước khóa: 155x29mm Độ dày cửa: >35mm Loại cửa: Cửa kim loại, cửa gỗ Màu sắc:Bạc/đen Mật khẩu/ Vân tay/Thẻ từ// Chìa cơ/App/Remote (mở rộng) 1 4000000 4190000 24 tháng.`
- Parsed: `{"name":"Khóa thông minh - Mật khẩu/Vân tay/Thẻ từ...","sku":"","category":"Khóa thông minh","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":4190000,"listPrice":4190000}`
- Engine issue codes: missing_sku

### 9. WARN — MISSING_SKU
- Product has no SKU/model code.
- Source: sheet=KHÓA THÔNG MINH · row=10
- Raw: `4 Điện áp làm việc: 4 Pin AA Tuổi thọ pin: 5.000 lần mở khóa Vân tay cảm biến điện dung: <0.1s Chất liệu: Hợp kim chịu lực Ngôn ngữ: App Tiếng Việt Nguồn điện khẩn cấp: Cấp điện qua cổng USB Tỷ lệ sai số: <0.0001% Dung lượng bộ nhớ: 100 users Kích thước khóa: 60x280mm Độ dày cửa: >35mm Loại cửa: Cửa kim loại, cửa gỗ Màu sắc: Vàng/ đỏ đồng/ đen Mật khẩu/ Vân tay/Thẻ từ// Chìa cơ/App/Remote (mở rộng) 1 3800000 3990000 24 tháng`
- Parsed: `{"name":"Khóa thông minh - Mật khẩu/Vân tay/Thẻ từ...","sku":"","category":"Khóa thông minh","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":3990000,"listPrice":3990000}`
- Engine issue codes: missing_sku

### 10. WARN — ENGINE_MISSING_SKU
- Thiếu mã SKU — vẫn có thể nhập nếu tên và giá đã rõ
- Source: sheet=KHÓA THÔNG MINH · row=10
- Raw: `4 Điện áp làm việc: 4 Pin AA Tuổi thọ pin: 5.000 lần mở khóa Vân tay cảm biến điện dung: <0.1s Chất liệu: Hợp kim chịu lực Ngôn ngữ: App Tiếng Việt Nguồn điện khẩn cấp: Cấp điện qua cổng USB Tỷ lệ sai số: <0.0001% Dung lượng bộ nhớ: 100 users Kích thước khóa: 60x280mm Độ dày cửa: >35mm Loại cửa: Cửa kim loại, cửa gỗ Màu sắc: Vàng/ đỏ đồng/ đen Mật khẩu/ Vân tay/Thẻ từ// Chìa cơ/App/Remote (mở rộng) 1 3800000 3990000 24 tháng`
- Parsed: `{"name":"Khóa thông minh - Mật khẩu/Vân tay/Thẻ từ...","sku":"","category":"Khóa thông minh","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":3990000,"listPrice":3990000}`
- Engine issue codes: missing_sku

### 11. WARN — MISSING_SKU
- Product has no SKU/model code.
- Source: sheet=KHÓA THÔNG MINH · row=14
- Raw: `8 Điện áp làm việc: 4 Pin AA Tuổi thọ pin: 5.000 lần mở khóa Vân tay cảm biến điện dung: <0.1s Chất liệu: Hợp kim chịu lực Ngôn ngữ: Tiếng Anh Nguồn điện khẩn cấp: Cấp điện qua cổng USB Tỷ lệ sai số: <0.0001% Dung lượng bộ nhớ: 88 users Kích thước khóa: 75x370mm Độ dày cửa: >35mm Loại cửa: Cửa kim loại, cửa gỗ Màu sắc: Đen/đỏ đồng/bạc Mật khẩu/ Vân tay/Thẻ từ// Chìa cơ/App Tuya 1 5190000 5490000 24 tháng.`
- Parsed: `{"name":"Khóa thông minh - Mật khẩu/Vân tay/Thẻ từ...","sku":"","category":"Khóa thông minh","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":5490000,"listPrice":5490000}`
- Engine issue codes: missing_sku

### 12. WARN — ENGINE_MISSING_SKU
- Thiếu mã SKU — vẫn có thể nhập nếu tên và giá đã rõ
- Source: sheet=KHÓA THÔNG MINH · row=14
- Raw: `8 Điện áp làm việc: 4 Pin AA Tuổi thọ pin: 5.000 lần mở khóa Vân tay cảm biến điện dung: <0.1s Chất liệu: Hợp kim chịu lực Ngôn ngữ: Tiếng Anh Nguồn điện khẩn cấp: Cấp điện qua cổng USB Tỷ lệ sai số: <0.0001% Dung lượng bộ nhớ: 88 users Kích thước khóa: 75x370mm Độ dày cửa: >35mm Loại cửa: Cửa kim loại, cửa gỗ Màu sắc: Đen/đỏ đồng/bạc Mật khẩu/ Vân tay/Thẻ từ// Chìa cơ/App Tuya 1 5190000 5490000 24 tháng.`
- Parsed: `{"name":"Khóa thông minh - Mật khẩu/Vân tay/Thẻ từ...","sku":"","category":"Khóa thông minh","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":5490000,"listPrice":5490000}`
- Engine issue codes: missing_sku

### 13. WARN — MISSING_SKU
- Product has no SKU/model code.
- Source: sheet=KHÓA THÔNG MINH · row=16
- Raw: `10 Điện áp làm việc: Pin Lithium 4200mAh Tuổi thọ pin: 3.000 lần mở khóa Vân tay cảm biến điện dung: <0.1s Chất liệu: Hợp kim chịu lực Ngôn ngữ: Tiếng Anh Nguồn điện khẩn cấp: Cấp qua cổng USB Tỷ lệ sai số: <0.0001% Dung lượng bộ nhớ: 150 users Kích thước khóa: 80x450mm Độ dày cửa: >35mm Loại cửa: Cửa kim loại, cửa gỗ Màu sắc: Vàng/Đen/Tím cafe Mật khẩu/ Vân tay/Thẻ từ/App Usmartgo/ Chìa cơ 1 9890000 10390000 24 tháng.`
- Parsed: `{"name":"Khóa thông minh - Mật khẩu/Vân tay/Thẻ từ...","sku":"","category":"Khóa thông minh","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":10390000,"listPrice":10390000}`
- Engine issue codes: missing_sku

### 14. WARN — ENGINE_MISSING_SKU
- Thiếu mã SKU — vẫn có thể nhập nếu tên và giá đã rõ
- Source: sheet=KHÓA THÔNG MINH · row=16
- Raw: `10 Điện áp làm việc: Pin Lithium 4200mAh Tuổi thọ pin: 3.000 lần mở khóa Vân tay cảm biến điện dung: <0.1s Chất liệu: Hợp kim chịu lực Ngôn ngữ: Tiếng Anh Nguồn điện khẩn cấp: Cấp qua cổng USB Tỷ lệ sai số: <0.0001% Dung lượng bộ nhớ: 150 users Kích thước khóa: 80x450mm Độ dày cửa: >35mm Loại cửa: Cửa kim loại, cửa gỗ Màu sắc: Vàng/Đen/Tím cafe Mật khẩu/ Vân tay/Thẻ từ/App Usmartgo/ Chìa cơ 1 9890000 10390000 24 tháng.`
- Parsed: `{"name":"Khóa thông minh - Mật khẩu/Vân tay/Thẻ từ...","sku":"","category":"Khóa thông minh","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":10390000,"listPrice":10390000}`
- Engine issue codes: missing_sku

### 15. WARN — NEEDS_REVIEW
- Product is intentionally held for human review; no hard corruption proven.
- Source: sheet=KHÓA NHÔM KÍNH · row=6
- Raw: `1 Điện áp làm việc: 4 Pin AAA Tuổi thọ pin:5.000 lần mở khóa Vân tay cảm biến điện dung: <0.1s Chất liệu: Hợp kim chịu lực Ngôn ngữ: App tiếng Việt Nguồn điện khẩn cấp: Cấp điện qua cổng USB Tỷ lệ sai số: <0.0001% Dung lượng bộ nhớ: 100 users Kích thước khóa: 40x310mm Độ dày cửa: >30mm Loại cửa: Cửa nhôm kính, cửa kim loại Màu sắc:Bạc/đen Mật khẩu/ Vân tay/Thẻ từ/ Chìa cơ/APP/ Remote (mở rộng) 1 4990000 3493000 3243500 2994000 24 tháng`
- Parsed: `{"name":"Khóa thông minh - Mật khẩu/Vân tay/Thẻ từ...","sku":"","category":"Khóa thông minh","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":2994000,"listPrice":4990000}`
- Engine issue codes: missing_sku, duplicate_identity_price_conflict

### 16. WARN — MISSING_SKU
- Product has no SKU/model code.
- Source: sheet=KHÓA NHÔM KÍNH · row=6
- Raw: `1 Điện áp làm việc: 4 Pin AAA Tuổi thọ pin:5.000 lần mở khóa Vân tay cảm biến điện dung: <0.1s Chất liệu: Hợp kim chịu lực Ngôn ngữ: App tiếng Việt Nguồn điện khẩn cấp: Cấp điện qua cổng USB Tỷ lệ sai số: <0.0001% Dung lượng bộ nhớ: 100 users Kích thước khóa: 40x310mm Độ dày cửa: >30mm Loại cửa: Cửa nhôm kính, cửa kim loại Màu sắc:Bạc/đen Mật khẩu/ Vân tay/Thẻ từ/ Chìa cơ/APP/ Remote (mở rộng) 1 4990000 3493000 3243500 2994000 24 tháng`
- Parsed: `{"name":"Khóa thông minh - Mật khẩu/Vân tay/Thẻ từ...","sku":"","category":"Khóa thông minh","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":2994000,"listPrice":4990000}`
- Engine issue codes: missing_sku, duplicate_identity_price_conflict

### 17. WARN — DUPLICATE_PRICE_CONFLICT
- Same canonical identity has conflicting prices; SmartQuote preserved source occurrences and requires review.
- Source: sheet=KHÓA NHÔM KÍNH · row=6
- Raw: `1 Điện áp làm việc: 4 Pin AAA Tuổi thọ pin:5.000 lần mở khóa Vân tay cảm biến điện dung: <0.1s Chất liệu: Hợp kim chịu lực Ngôn ngữ: App tiếng Việt Nguồn điện khẩn cấp: Cấp điện qua cổng USB Tỷ lệ sai số: <0.0001% Dung lượng bộ nhớ: 100 users Kích thước khóa: 40x310mm Độ dày cửa: >30mm Loại cửa: Cửa nhôm kính, cửa kim loại Màu sắc:Bạc/đen Mật khẩu/ Vân tay/Thẻ từ/ Chìa cơ/APP/ Remote (mở rộng) 1 4990000 3493000 3243500 2994000 24 tháng`
- Parsed: `{"name":"Khóa thông minh - Mật khẩu/Vân tay/Thẻ từ...","sku":"","category":"Khóa thông minh","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":2994000,"listPrice":4990000}`
- Engine issue codes: missing_sku, duplicate_identity_price_conflict

### 18. WARN — ENGINE_MISSING_SKU
- Thiếu mã SKU — vẫn có thể nhập nếu tên và giá đã rõ
- Source: sheet=KHÓA NHÔM KÍNH · row=6
- Raw: `1 Điện áp làm việc: 4 Pin AAA Tuổi thọ pin:5.000 lần mở khóa Vân tay cảm biến điện dung: <0.1s Chất liệu: Hợp kim chịu lực Ngôn ngữ: App tiếng Việt Nguồn điện khẩn cấp: Cấp điện qua cổng USB Tỷ lệ sai số: <0.0001% Dung lượng bộ nhớ: 100 users Kích thước khóa: 40x310mm Độ dày cửa: >30mm Loại cửa: Cửa nhôm kính, cửa kim loại Màu sắc:Bạc/đen Mật khẩu/ Vân tay/Thẻ từ/ Chìa cơ/APP/ Remote (mở rộng) 1 4990000 3493000 3243500 2994000 24 tháng`
- Parsed: `{"name":"Khóa thông minh - Mật khẩu/Vân tay/Thẻ từ...","sku":"","category":"Khóa thông minh","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":2994000,"listPrice":4990000}`
- Engine issue codes: missing_sku, duplicate_identity_price_conflict

### 19. WARN — MISSING_SKU
- Product has no SKU/model code.
- Source: sheet=KHÓA NHÔM KÍNH · row=7
- Raw: `1 Điện áp làm việc: 4 Pin AAA Tuổi thọ pin: 5.000 lần mở khóa Vân tay cảm biến điện dung: <0.1s Chất liệu: Hợp kim chịu lực Ngôn ngữ: App tiếng Việt Nguồn điện khẩn cấp:Cấp điện qua cổng USB Tỷ lệ sai số: <0.0001% Dung lượng bộ nhớ: 100 users Kích thước khóa: 43x303mm Độ dày cửa: >30mm Loại cửa:Cửa nhôm kính, cửa kim loại Màu sắc: Bạc/đen/vàng Mật khẩu/ Vân tay/Thẻ từ/ Chìa cơ/APP/ Remote (mở rộng) 1 4990000 5290000 24 tháng`
- Parsed: `{"name":"Khóa thông minh - Mật khẩu/Vân tay/Thẻ từ...","sku":"","category":"Khóa thông minh","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":5290000,"listPrice":5290000}`
- Engine issue codes: missing_sku

### 20. WARN — ENGINE_MISSING_SKU
- Thiếu mã SKU — vẫn có thể nhập nếu tên và giá đã rõ
- Source: sheet=KHÓA NHÔM KÍNH · row=7
- Raw: `1 Điện áp làm việc: 4 Pin AAA Tuổi thọ pin: 5.000 lần mở khóa Vân tay cảm biến điện dung: <0.1s Chất liệu: Hợp kim chịu lực Ngôn ngữ: App tiếng Việt Nguồn điện khẩn cấp:Cấp điện qua cổng USB Tỷ lệ sai số: <0.0001% Dung lượng bộ nhớ: 100 users Kích thước khóa: 43x303mm Độ dày cửa: >30mm Loại cửa:Cửa nhôm kính, cửa kim loại Màu sắc: Bạc/đen/vàng Mật khẩu/ Vân tay/Thẻ từ/ Chìa cơ/APP/ Remote (mở rộng) 1 4990000 5290000 24 tháng`
- Parsed: `{"name":"Khóa thông minh - Mật khẩu/Vân tay/Thẻ từ...","sku":"","category":"Khóa thông minh","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":5290000,"listPrice":5290000}`
- Engine issue codes: missing_sku

### 21. WARN — MISSING_SKU
- Product has no SKU/model code.
- Source: sheet=KHÓA NHÔM KÍNH · row=9
- Raw: `3 Điện áp làm việc: 4 Pin AAA Tuổi thọ pin:5.000 lần mở khóa Vân tay cảm biến điện dung: <0.1s Chất liệu: Hợp kim chịu lực Ngôn ngữ: App Tiếng Việt Nguồn điện khẩn cấp:Cấp điện qua cổng USB Tỷ lệ sai số: <0.0001% Dung lượng bộ nhớ: 100 user Kích thước khóa: 37x330mm Độ dày cửa: >30mm Loại cửa: Cửa nhôm kính, cửa kim loại Màu sắc:Bạc Mật khẩu/ Vân tay/Thẻ từ/ Chìa cơ/APP/ Remote (mở rộng) 1 5690000 5890000 24 tháng`
- Parsed: `{"name":"Khóa thông minh - Mật khẩu/Vân tay/Thẻ từ...","sku":"","category":"Khóa thông minh","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":5890000,"listPrice":5890000}`
- Engine issue codes: missing_sku

### 22. WARN — ENGINE_MISSING_SKU
- Thiếu mã SKU — vẫn có thể nhập nếu tên và giá đã rõ
- Source: sheet=KHÓA NHÔM KÍNH · row=9
- Raw: `3 Điện áp làm việc: 4 Pin AAA Tuổi thọ pin:5.000 lần mở khóa Vân tay cảm biến điện dung: <0.1s Chất liệu: Hợp kim chịu lực Ngôn ngữ: App Tiếng Việt Nguồn điện khẩn cấp:Cấp điện qua cổng USB Tỷ lệ sai số: <0.0001% Dung lượng bộ nhớ: 100 user Kích thước khóa: 37x330mm Độ dày cửa: >30mm Loại cửa: Cửa nhôm kính, cửa kim loại Màu sắc:Bạc Mật khẩu/ Vân tay/Thẻ từ/ Chìa cơ/APP/ Remote (mở rộng) 1 5690000 5890000 24 tháng`
- Parsed: `{"name":"Khóa thông minh - Mật khẩu/Vân tay/Thẻ từ...","sku":"","category":"Khóa thông minh","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":5890000,"listPrice":5890000}`
- Engine issue codes: missing_sku

### 23. WARN — NEEDS_REVIEW
- Product is intentionally held for human review; no hard corruption proven.
- Source: sheet=KHÓA NHÔM KÍNH · row=19
- Raw: `OSN-2606 (bản app TTlock) Điện áp làm việc: Pin lithium 4800m Tuổi thọ pin: 5,000 lần mở khoá ( 6 tháng) Công nghệ vân tay: Live scan Chất liệu: Hợp kim Ngôn ngữ: Tiếng Việt, tiếng Anh Nguồn điện khẩn cấp: Cấp điện qua cổng USB Tỉ lệ sai số: 0,01% Khoảng cách nhận diện khuôn mặt: 0.35-1m Tốc độ nhận diện: <1s Dung lượng bộ nhớ: 200 users Kích thước khoá: Mặt trước 410*37mm, mặt sau 408*36mm Độ dày cửa: >30mm Loại cửa: Cửa nhôm kính Màu sắc: Vàng/Đen/Xám Lõi khoá: 3085/3585 Chống nước IP65 Màu sắc: Đen/Vàng/Xám Nhận diện khuôn mặt/ Mật khẩu/ Vân tay/Thẻ từ/ Chìa cơ/APP/ Remote (mở rộng) 1 5890000 6190000 24 tháng`
- Parsed: `{"name":"Khóa thông minh OSN-2606","sku":"OSN-2606","category":"Khóa thông minh","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":6190000,"listPrice":6190000}`
- Engine issue codes: duplicate_identity_price_conflict

### 24. WARN — DUPLICATE_PRICE_CONFLICT
- Same canonical identity has conflicting prices; SmartQuote preserved source occurrences and requires review.
- Source: sheet=KHÓA NHÔM KÍNH · row=19
- Raw: `OSN-2606 (bản app TTlock) Điện áp làm việc: Pin lithium 4800m Tuổi thọ pin: 5,000 lần mở khoá ( 6 tháng) Công nghệ vân tay: Live scan Chất liệu: Hợp kim Ngôn ngữ: Tiếng Việt, tiếng Anh Nguồn điện khẩn cấp: Cấp điện qua cổng USB Tỉ lệ sai số: 0,01% Khoảng cách nhận diện khuôn mặt: 0.35-1m Tốc độ nhận diện: <1s Dung lượng bộ nhớ: 200 users Kích thước khoá: Mặt trước 410*37mm, mặt sau 408*36mm Độ dày cửa: >30mm Loại cửa: Cửa nhôm kính Màu sắc: Vàng/Đen/Xám Lõi khoá: 3085/3585 Chống nước IP65 Màu sắc: Đen/Vàng/Xám Nhận diện khuôn mặt/ Mật khẩu/ Vân tay/Thẻ từ/ Chìa cơ/APP/ Remote (mở rộng) 1 5890000 6190000 24 tháng`
- Parsed: `{"name":"Khóa thông minh OSN-2606","sku":"OSN-2606","category":"Khóa thông minh","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":6190000,"listPrice":6190000}`
- Engine issue codes: duplicate_identity_price_conflict

### 25. WARN — NEEDS_REVIEW
- Product is intentionally held for human review; no hard corruption proven.
- Source: sheet=KHÓA KÍNH · row=6
- Raw: `2 OSN-3373 Điện áp làm việc: 4 Pin AA Tuổi thọ pin: 10.000 lần mở khóa Vân tay Live-scan: <0.1s Chất liệu: Hợp kim cao cấp Ngôn ngữ: App tiếng Việt Nguồn điện khẩn cấp:Cấp qua cổng USB Tỷ lệ từ chối: <0.15% Tỷ lệ sai số: <0.0004% Dung lượng bộ nhớ: 100 user Kích thước khóa:67x185x38mm Khoảng cách 2 cánh cửa: >5mm Loại cửa: Cửa kính kéo đẩy, cửa lùa Màu sắc: Đen Có chế độ thông phòng Mật khẩu/ Vân tay/Thẻ từ/ Chìa cơ/App/ Điều khiển (mở rộng) 1 4350000 4590000 24 tháng`
- Parsed: `{"name":"Khóa thông minh OSN-3373","sku":"OSN-3373","category":"Khóa thông minh","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":4590000,"listPrice":4590000}`
- Engine issue codes: price_column_uncertain

### 26. WARN — ENGINE_PRICE_COLUMN_UNCERTAIN
- Chưa chắc cột đang dùng là giá mua vào: STT
- Source: sheet=KHÓA KÍNH · row=6
- Raw: `2 OSN-3373 Điện áp làm việc: 4 Pin AA Tuổi thọ pin: 10.000 lần mở khóa Vân tay Live-scan: <0.1s Chất liệu: Hợp kim cao cấp Ngôn ngữ: App tiếng Việt Nguồn điện khẩn cấp:Cấp qua cổng USB Tỷ lệ từ chối: <0.15% Tỷ lệ sai số: <0.0004% Dung lượng bộ nhớ: 100 user Kích thước khóa:67x185x38mm Khoảng cách 2 cánh cửa: >5mm Loại cửa: Cửa kính kéo đẩy, cửa lùa Màu sắc: Đen Có chế độ thông phòng Mật khẩu/ Vân tay/Thẻ từ/ Chìa cơ/App/ Điều khiển (mở rộng) 1 4350000 4590000 24 tháng`
- Parsed: `{"name":"Khóa thông minh OSN-3373","sku":"OSN-3373","category":"Khóa thông minh","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":4590000,"listPrice":4590000}`
- Engine issue codes: price_column_uncertain

### 27. WARN — MISSING_SKU
- Product has no SKU/model code.
- Source: sheet=KHÓA KHÁCH SẠN · row=6
- Raw: `1 Điện áp làm việc: 4 pin AA Tuổi thọ pin: 5.000 lần mở khóa Dung lượng bộ nhớ: 1.000 lần mở khóa Kích thước khóa: 70x300mm Chất liệu: Hợp kim chịu lực Độ dày cửa: >40mm Loại cửa: Cửa gỗ, cửa kim loại Thẻ từ tần số 13.56Mhz Màu sắc: Vàng kim/ bạc/nâu Thẻ từ/chìa cơ 1 3890000 3890000 24 tháng Hàng có sẵn`
- Parsed: `{"name":"Thẻ từ/chìa cơ","sku":"","category":"Phụ kiện","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":3890000,"listPrice":3890000}`
- Engine issue codes: missing_sku

### 28. WARN — ENGINE_MISSING_SKU
- Thiếu mã SKU — vẫn có thể nhập nếu tên và giá đã rõ
- Source: sheet=KHÓA KHÁCH SẠN · row=6
- Raw: `1 Điện áp làm việc: 4 pin AA Tuổi thọ pin: 5.000 lần mở khóa Dung lượng bộ nhớ: 1.000 lần mở khóa Kích thước khóa: 70x300mm Chất liệu: Hợp kim chịu lực Độ dày cửa: >40mm Loại cửa: Cửa gỗ, cửa kim loại Thẻ từ tần số 13.56Mhz Màu sắc: Vàng kim/ bạc/nâu Thẻ từ/chìa cơ 1 3890000 3890000 24 tháng Hàng có sẵn`
- Parsed: `{"name":"Thẻ từ/chìa cơ","sku":"","category":"Phụ kiện","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":3890000,"listPrice":3890000}`
- Engine issue codes: missing_sku

### 29. WARN — MISSING_SKU
- Product has no SKU/model code.
- Source: sheet=KHÓA KHÁCH SẠN · row=7
- Raw: `2 Điện áp làm việc: 4 pin AA Tuổi thọ pin: 5.000 lần mở khóa Dung lượng bộ nhớ: 1.000 lần mở khóa Kích thước khóa: 70x304mm Chất liệu: Hợp kim chịu lực Độ dày cửa: >40mm Loại cửa: Cửa kim loại, cửa gỗ Thẻ từ tần số 13.56Mhz Màu sắc: Vàng kim/bạc Thẻ từ/chìa cơ 1 3490000 3490000 24 tháng Hàng có sẵn`
- Parsed: `{"name":"Thẻ từ/chìa cơ","sku":"","category":"Phụ kiện","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":3490000,"listPrice":3490000}`
- Engine issue codes: missing_sku

### 30. WARN — ENGINE_MISSING_SKU
- Thiếu mã SKU — vẫn có thể nhập nếu tên và giá đã rõ
- Source: sheet=KHÓA KHÁCH SẠN · row=7
- Raw: `2 Điện áp làm việc: 4 pin AA Tuổi thọ pin: 5.000 lần mở khóa Dung lượng bộ nhớ: 1.000 lần mở khóa Kích thước khóa: 70x304mm Chất liệu: Hợp kim chịu lực Độ dày cửa: >40mm Loại cửa: Cửa kim loại, cửa gỗ Thẻ từ tần số 13.56Mhz Màu sắc: Vàng kim/bạc Thẻ từ/chìa cơ 1 3490000 3490000 24 tháng Hàng có sẵn`
- Parsed: `{"name":"Thẻ từ/chìa cơ","sku":"","category":"Phụ kiện","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":3490000,"listPrice":3490000}`
- Engine issue codes: missing_sku

### 31. WARN — MISSING_SKU
- Product has no SKU/model code.
- Source: sheet=KHÓA KHÁCH SẠN · row=8
- Raw: `3 Điện áp làm việc: 4 pin AA Tuổi thọ pin: 5.000 lần mở khóa Dung lượng bộ nhớ: 1.000 lần mở khóa Kích thước khóa: 42x243mm Chất liệu: Hợp kim chịu lực Độ dày cửa: >30mm Loại cửa: Cửa kim loại, cửa gỗ Thẻ từ tần số 125Khz Màu sắc: Bạc Thẻ từ/chìa cơ 1 3190000 3390000 24 tháng Hàng có sẵn`
- Parsed: `{"name":"Thẻ từ/chìa cơ","sku":"","category":"Phụ kiện","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":3390000,"listPrice":3390000}`
- Engine issue codes: missing_sku

### 32. WARN — ENGINE_MISSING_SKU
- Thiếu mã SKU — vẫn có thể nhập nếu tên và giá đã rõ
- Source: sheet=KHÓA KHÁCH SẠN · row=8
- Raw: `3 Điện áp làm việc: 4 pin AA Tuổi thọ pin: 5.000 lần mở khóa Dung lượng bộ nhớ: 1.000 lần mở khóa Kích thước khóa: 42x243mm Chất liệu: Hợp kim chịu lực Độ dày cửa: >30mm Loại cửa: Cửa kim loại, cửa gỗ Thẻ từ tần số 125Khz Màu sắc: Bạc Thẻ từ/chìa cơ 1 3190000 3390000 24 tháng Hàng có sẵn`
- Parsed: `{"name":"Thẻ từ/chìa cơ","sku":"","category":"Phụ kiện","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":3390000,"listPrice":3390000}`
- Engine issue codes: missing_sku

### 33. WARN — MISSING_SKU
- Product has no SKU/model code.
- Source: sheet=KHÓA KHÁCH SẠN · row=9
- Raw: `4 Điện áp làm việc: 4 pin AA Tuổi thọ pin: 5.000 lần mở khóa Dung lượng bộ nhớ: 1.000 lần mở khóa Kích thước khóa: 75x305mm Chất liệu: Hợp kim chịu lực Độ dày cửa: >40mm Loại cửa: Cửa kim loại, cửa gỗ Thẻ từ tần số 13.56Mhz Màu sắc: Vàng/đen/đỏ đồng Thẻ từ/chìa cơ 1 2990000 3190000 24 tháng Hàng có sẵn màu đỏ đồng/đen`
- Parsed: `{"name":"Đèn - Thẻ từ/chìa cơ","sku":"","category":"Đèn","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":3190000,"listPrice":3190000}`
- Engine issue codes: missing_sku

### 34. WARN — ENGINE_MISSING_SKU
- Thiếu mã SKU — vẫn có thể nhập nếu tên và giá đã rõ
- Source: sheet=KHÓA KHÁCH SẠN · row=9
- Raw: `4 Điện áp làm việc: 4 pin AA Tuổi thọ pin: 5.000 lần mở khóa Dung lượng bộ nhớ: 1.000 lần mở khóa Kích thước khóa: 75x305mm Chất liệu: Hợp kim chịu lực Độ dày cửa: >40mm Loại cửa: Cửa kim loại, cửa gỗ Thẻ từ tần số 13.56Mhz Màu sắc: Vàng/đen/đỏ đồng Thẻ từ/chìa cơ 1 2990000 3190000 24 tháng Hàng có sẵn màu đỏ đồng/đen`
- Parsed: `{"name":"Đèn - Thẻ từ/chìa cơ","sku":"","category":"Đèn","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":3190000,"listPrice":3190000}`
- Engine issue codes: missing_sku

### 35. WARN — NEEDS_REVIEW
- Product is intentionally held for human review; no hard corruption proven.
- Source: sheet=KHÓA KHÁCH SẠN · row=25
- Raw: `20 Máy phát thẻ MPT13.56Mhz (Hệ nâng cấp) Tích hợp: Hệ thống phần mềm quản lý khách sạn Loại thẻ đọc: Thẻ RFID Nguồn điện: Nguồn máy tính qua kết nối USB. Tốc độ đọc thẻ: <1s Khoảng cách đọc thẻ: <3cm Tích hợp nhiều loại thẻ như: thẻ dọn phòng, thẻ quản lý, thẻ phục vụ, thẻ khác… Chất liệu: Nhựa ABS. Mã khóa sử dụng: OSN-3381, OSN-3388, OSN-3339, 3331 1 5000000 5500000 4000000 12 tháng Hàng có sẵn`
- Parsed: `{"name":"Khóa thông minh MPT13.56MHZ","sku":"MPT13.56MHZ","category":"Khóa thông minh","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":4000000,"listPrice":5500000}`
- Engine issue codes: duplicate_identity_price_conflict

### 36. WARN — DUPLICATE_PRICE_CONFLICT
- Same canonical identity has conflicting prices; SmartQuote preserved source occurrences and requires review.
- Source: sheet=KHÓA KHÁCH SẠN · row=25
- Raw: `20 Máy phát thẻ MPT13.56Mhz (Hệ nâng cấp) Tích hợp: Hệ thống phần mềm quản lý khách sạn Loại thẻ đọc: Thẻ RFID Nguồn điện: Nguồn máy tính qua kết nối USB. Tốc độ đọc thẻ: <1s Khoảng cách đọc thẻ: <3cm Tích hợp nhiều loại thẻ như: thẻ dọn phòng, thẻ quản lý, thẻ phục vụ, thẻ khác… Chất liệu: Nhựa ABS. Mã khóa sử dụng: OSN-3381, OSN-3388, OSN-3339, 3331 1 5000000 5500000 4000000 12 tháng Hàng có sẵn`
- Parsed: `{"name":"Khóa thông minh MPT13.56MHZ","sku":"MPT13.56MHZ","category":"Khóa thông minh","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":4000000,"listPrice":5500000}`
- Engine issue codes: duplicate_identity_price_conflict

### 37. WARN — NEEDS_REVIEW
- Product is intentionally held for human review; no hard corruption proven.
- Source: sheet=KHÓA KHÁCH SẠN · row=29
- Raw: `24 Thẻ từ Mifare 13.56Mhz Thẻ từ khóa khách sạn OSUNO (Thẻ thiết kế và in theo yêu cầu, số lượng thẻ in bội của 24) 1 70000 75000 40000`
- Parsed: `{"name":"Thẻ từ khóa khách sạn OSUNO (Thẻ thiết kế và in th","sku":"","category":"Sản phẩm","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":40000,"listPrice":75000}`
- Engine issue codes: missing_sku, duplicate_identity_price_conflict

### 38. WARN — MISSING_SKU
- Product has no SKU/model code.
- Source: sheet=KHÓA KHÁCH SẠN · row=29
- Raw: `24 Thẻ từ Mifare 13.56Mhz Thẻ từ khóa khách sạn OSUNO (Thẻ thiết kế và in theo yêu cầu, số lượng thẻ in bội của 24) 1 70000 75000 40000`
- Parsed: `{"name":"Thẻ từ khóa khách sạn OSUNO (Thẻ thiết kế và in th","sku":"","category":"Sản phẩm","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":40000,"listPrice":75000}`
- Engine issue codes: missing_sku, duplicate_identity_price_conflict

### 39. WARN — DUPLICATE_PRICE_CONFLICT
- Same canonical identity has conflicting prices; SmartQuote preserved source occurrences and requires review.
- Source: sheet=KHÓA KHÁCH SẠN · row=29
- Raw: `24 Thẻ từ Mifare 13.56Mhz Thẻ từ khóa khách sạn OSUNO (Thẻ thiết kế và in theo yêu cầu, số lượng thẻ in bội của 24) 1 70000 75000 40000`
- Parsed: `{"name":"Thẻ từ khóa khách sạn OSUNO (Thẻ thiết kế và in th","sku":"","category":"Sản phẩm","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":40000,"listPrice":75000}`
- Engine issue codes: missing_sku, duplicate_identity_price_conflict

### 40. WARN — ENGINE_MISSING_SKU
- Thiếu mã SKU — vẫn có thể nhập nếu tên và giá đã rõ
- Source: sheet=KHÓA KHÁCH SẠN · row=29
- Raw: `24 Thẻ từ Mifare 13.56Mhz Thẻ từ khóa khách sạn OSUNO (Thẻ thiết kế và in theo yêu cầu, số lượng thẻ in bội của 24) 1 70000 75000 40000`
- Parsed: `{"name":"Thẻ từ khóa khách sạn OSUNO (Thẻ thiết kế và in th","sku":"","category":"Sản phẩm","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":40000,"listPrice":75000}`
- Engine issue codes: missing_sku, duplicate_identity_price_conflict

### 41. WARN — MISSING_SKU
- Product has no SKU/model code.
- Source: sheet=KHÓA KHÁCH SẠN · row=32
- Raw: `27 Thẻ từ Mifare 125Khz ( thẻ trắng) 1 50000 55000 35000`
- Parsed: `{"name":"Thẻ từ Mifare 125Khz ( thẻ trắng)","sku":"","category":"Sản phẩm","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":35000,"listPrice":55000}`
- Engine issue codes: missing_sku

### 42. WARN — ENGINE_MISSING_SKU
- Thiếu mã SKU — vẫn có thể nhập nếu tên và giá đã rõ
- Source: sheet=KHÓA KHÁCH SẠN · row=32
- Raw: `27 Thẻ từ Mifare 125Khz ( thẻ trắng) 1 50000 55000 35000`
- Parsed: `{"name":"Thẻ từ Mifare 125Khz ( thẻ trắng)","sku":"","category":"Sản phẩm","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":35000,"listPrice":55000}`
- Engine issue codes: missing_sku

### 43. WARN — MISSING_SKU
- Product has no SKU/model code.
- Source: sheet=KHÓA CỔNG · row=6
- Raw: `1 Phương thức mở khóa: vân tay, thẻ từ, mật khẩu, chìa cơ, app TTLock (điều khiển mở rộng). Tự động khóa khi đóng cửa Chất liệu: Hợp kim cao cấp Điện áp 12VDC – 24VDC – Dòng tĩnh: 16 mA Bộ nhớ quản lý : 100 users Kích thước khóa 130Lx105Wx38H(mm) Trọng lượng: 1.35 Kg Phù hợp lắp cho các loại cửa sắt, cửa gỗ 1 4690000 4890000 24 tháng`
- Parsed: `{"name":"Phương thức mở khóa: vân tay/thẻ từ/mật khẩu...","sku":"","category":"Sản phẩm","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":4890000,"listPrice":4890000}`
- Engine issue codes: missing_sku

### 44. WARN — ENGINE_MISSING_SKU
- Thiếu mã SKU — vẫn có thể nhập nếu tên và giá đã rõ
- Source: sheet=KHÓA CỔNG · row=6
- Raw: `1 Phương thức mở khóa: vân tay, thẻ từ, mật khẩu, chìa cơ, app TTLock (điều khiển mở rộng). Tự động khóa khi đóng cửa Chất liệu: Hợp kim cao cấp Điện áp 12VDC – 24VDC – Dòng tĩnh: 16 mA Bộ nhớ quản lý : 100 users Kích thước khóa 130Lx105Wx38H(mm) Trọng lượng: 1.35 Kg Phù hợp lắp cho các loại cửa sắt, cửa gỗ 1 4690000 4890000 24 tháng`
- Parsed: `{"name":"Phương thức mở khóa: vân tay/thẻ từ/mật khẩu...","sku":"","category":"Sản phẩm","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":4890000,"listPrice":4890000}`
- Engine issue codes: missing_sku

### 45. WARN — NEEDS_REVIEW
- Product is intentionally held for human review; no hard corruption proven.
- Source: sheet=KHÓA CỔNG · row=7
- Raw: `2 OSN-3334 (2 mặt vân tay) Phương thức mở khóa: Vân tay, thẻ từ, mật khẩu, chìa cơ, app TTLock (điều khiển mở rộng). Tự động khóa khi đóng cửa Chất liệu: Hợp kim cao cấp Điện áp 12VDC – 24VDC – Dòng tĩnh: 16 mA Bộ nhớ quản lý : 100 users Kích thước: Mặt ngoài: 59*170mm; Mặt trong: 96*127mm Trọng lượng: 1.35 Kg Phù hợp lắp cho các loại cửa sắt, cửa gỗ 1 6290000 6490000 24 tháng`
- Parsed: `{"name":"Khóa thông minh OSN-3334","sku":"OSN-3334","category":"Khóa thông minh","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":6490000,"listPrice":6490000}`
- Engine issue codes: duplicate_identity_price_conflict

### 46. WARN — DUPLICATE_PRICE_CONFLICT
- Same canonical identity has conflicting prices; SmartQuote preserved source occurrences and requires review.
- Source: sheet=KHÓA CỔNG · row=7
- Raw: `2 OSN-3334 (2 mặt vân tay) Phương thức mở khóa: Vân tay, thẻ từ, mật khẩu, chìa cơ, app TTLock (điều khiển mở rộng). Tự động khóa khi đóng cửa Chất liệu: Hợp kim cao cấp Điện áp 12VDC – 24VDC – Dòng tĩnh: 16 mA Bộ nhớ quản lý : 100 users Kích thước: Mặt ngoài: 59*170mm; Mặt trong: 96*127mm Trọng lượng: 1.35 Kg Phù hợp lắp cho các loại cửa sắt, cửa gỗ 1 6290000 6490000 24 tháng`
- Parsed: `{"name":"Khóa thông minh OSN-3334","sku":"OSN-3334","category":"Khóa thông minh","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":6490000,"listPrice":6490000}`
- Engine issue codes: duplicate_identity_price_conflict

### 47. WARN — NEEDS_REVIEW
- Product is intentionally held for human review; no hard corruption proven.
- Source: sheet=KHÓA CỔNG · row=12
- Raw: `OSN-3335 cửa lùa Khoá cổng cửa lùa Phương thức mở khóa: Vân tay, thẻ từ, mật khẩu, chìa cơ, app TTLock (điều khiển mở rộng). Tự động khóa khi đóng cửa Chất liệu: Inox Điện áp 12VDC – 24VDC – Dòng tĩnh: 16 mA Bộ nhớ quản lý : 100 users Kích thước: Mặt ngoài: 59*170mm; Mặt trong: 96*127mm Trọng lượng: 1.35 Kg Phù hợp lắp cho các loại cửa sắt, cửa gỗ 1 5390000 5590000 24 tháng`
- Parsed: `{"name":"Khóa thông minh OSN-3335","sku":"OSN-3335","category":"Khóa thông minh","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":5590000,"listPrice":5590000}`
- Engine issue codes: duplicate_identity_price_conflict, duplicate_identity_price_conflict

### 48. WARN — DUPLICATE_PRICE_CONFLICT
- Same canonical identity has conflicting prices; SmartQuote preserved source occurrences and requires review.
- Source: sheet=KHÓA CỔNG · row=12
- Raw: `OSN-3335 cửa lùa Khoá cổng cửa lùa Phương thức mở khóa: Vân tay, thẻ từ, mật khẩu, chìa cơ, app TTLock (điều khiển mở rộng). Tự động khóa khi đóng cửa Chất liệu: Inox Điện áp 12VDC – 24VDC – Dòng tĩnh: 16 mA Bộ nhớ quản lý : 100 users Kích thước: Mặt ngoài: 59*170mm; Mặt trong: 96*127mm Trọng lượng: 1.35 Kg Phù hợp lắp cho các loại cửa sắt, cửa gỗ 1 5390000 5590000 24 tháng`
- Parsed: `{"name":"Khóa thông minh OSN-3335","sku":"OSN-3335","category":"Khóa thông minh","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":5590000,"listPrice":5590000}`
- Engine issue codes: duplicate_identity_price_conflict, duplicate_identity_price_conflict

### 49. WARN — NEEDS_REVIEW
- Product is intentionally held for human review; no hard corruption proven.
- Source: sheet=KHÓA CỔNG · row=14
- Raw: `OSN-3336 2 mặt Điện áp làm việc: 4 pin AA Tuổi thọ pin: 5,000 lần mở khoá Công nghệ vân tay: Live scan Chất liệu: Hợp kim Ngôn ngữ: Tiếng Việt, tiếng Anh Nguồn điện khẩn cấp: Cấp điện qua cổng USB Tỉ lệ sai số: 0,0001% Dung lượng bộ nhớ: 100 users Kích thước khoá: 165*56mm Độ dày cửa: >30mm Loại cửa: Cửa cổng kim loại, cửa gỗ Màu sắc: Đen 1 6990000 7190000 24 tháng`
- Parsed: `{"name":"Khóa thông minh OSN-3336","sku":"OSN-3336","category":"Khóa thông minh","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":7190000,"listPrice":7190000}`
- Engine issue codes: duplicate_identity_price_conflict

### 50. WARN — DUPLICATE_PRICE_CONFLICT
- Same canonical identity has conflicting prices; SmartQuote preserved source occurrences and requires review.
- Source: sheet=KHÓA CỔNG · row=14
- Raw: `OSN-3336 2 mặt Điện áp làm việc: 4 pin AA Tuổi thọ pin: 5,000 lần mở khoá Công nghệ vân tay: Live scan Chất liệu: Hợp kim Ngôn ngữ: Tiếng Việt, tiếng Anh Nguồn điện khẩn cấp: Cấp điện qua cổng USB Tỉ lệ sai số: 0,0001% Dung lượng bộ nhớ: 100 users Kích thước khoá: 165*56mm Độ dày cửa: >30mm Loại cửa: Cửa cổng kim loại, cửa gỗ Màu sắc: Đen 1 6990000 7190000 24 tháng`
- Parsed: `{"name":"Khóa thông minh OSN-3336","sku":"OSN-3336","category":"Khóa thông minh","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":7190000,"listPrice":7190000}`
- Engine issue codes: duplicate_identity_price_conflict

### 51. WARN — NEEDS_REVIEW
- Product is intentionally held for human review; no hard corruption proven.
- Source: sheet=KHOÁ CƠ VÀ PHỤ KIỆN CỬA · row=12
- Raw: `5 OSN-KC06 Khóa cơ cao cấp OSN - KC06 Màu sắc: Bạc Chất liệu: hợp kim Ruột khóa: chuẩn EU với 02 chốt an toàn Ổ chìa: Thiết kế chìa vi tính (7 bi) tránh bị trùng chìa, an toàn. Độ dài lõi khóa: 50 mm (từ tay cầm đến đầu lõi khóa) Kích thước: 48mm x 175mm Kiểu dáng: Tay gạt, 1 đầu chìa, 1 đầu vặn Độ dày cửa: >35mm Thân khóa: có thể lắp cùng thân khóa 5050B và 5050C Chìa cơ: 03 chìa Ứng dụng: cửa gỗ, cửa kim loại, cửa thép. 1 770000 462000 24 tháng`
- Parsed: `{"name":"Khóa thông minh OSN-KC06","sku":"OSN-KC06","category":"Khóa thông minh","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":462000,"listPrice":770000}`
- Engine issue codes: duplicate_identity_price_conflict

### 52. WARN — DUPLICATE_PRICE_CONFLICT
- Same canonical identity has conflicting prices; SmartQuote preserved source occurrences and requires review.
- Source: sheet=KHOÁ CƠ VÀ PHỤ KIỆN CỬA · row=12
- Raw: `5 OSN-KC06 Khóa cơ cao cấp OSN - KC06 Màu sắc: Bạc Chất liệu: hợp kim Ruột khóa: chuẩn EU với 02 chốt an toàn Ổ chìa: Thiết kế chìa vi tính (7 bi) tránh bị trùng chìa, an toàn. Độ dài lõi khóa: 50 mm (từ tay cầm đến đầu lõi khóa) Kích thước: 48mm x 175mm Kiểu dáng: Tay gạt, 1 đầu chìa, 1 đầu vặn Độ dày cửa: >35mm Thân khóa: có thể lắp cùng thân khóa 5050B và 5050C Chìa cơ: 03 chìa Ứng dụng: cửa gỗ, cửa kim loại, cửa thép. 1 770000 462000 24 tháng`
- Parsed: `{"name":"Khóa thông minh OSN-KC06","sku":"OSN-KC06","category":"Khóa thông minh","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":462000,"listPrice":770000}`
- Engine issue codes: duplicate_identity_price_conflict

### 53. WARN — MISSING_SKU
- Product has no SKU/model code.
- Source: sheet=KHOÁ CƠ VÀ PHỤ KIỆN CỬA · row=22
- Raw: `Mắt thần (1) Mã sản phẩm: Mắt thần ( Loại 1) Thương hiệu: OSUNO Dòng sản phẩm: Mắt thần Màu sắc: Bạc Chất liệu: SS304 Thấu kính rộng, trong và nét 120000 72000 12 tháng`
- Parsed: `{"name":"Mã sản phẩm: Mắt thần ( Loại 1) Thương hiệu: OSUNO","sku":"","category":"Phụ kiện","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":72000,"listPrice":120000}`
- Engine issue codes: missing_sku

### 54. WARN — ENGINE_MISSING_SKU
- Thiếu mã SKU — vẫn có thể nhập nếu tên và giá đã rõ
- Source: sheet=KHOÁ CƠ VÀ PHỤ KIỆN CỬA · row=22
- Raw: `Mắt thần (1) Mã sản phẩm: Mắt thần ( Loại 1) Thương hiệu: OSUNO Dòng sản phẩm: Mắt thần Màu sắc: Bạc Chất liệu: SS304 Thấu kính rộng, trong và nét 120000 72000 12 tháng`
- Parsed: `{"name":"Mã sản phẩm: Mắt thần ( Loại 1) Thương hiệu: OSUNO","sku":"","category":"Phụ kiện","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":72000,"listPrice":120000}`
- Engine issue codes: missing_sku

### 55. WARN — MISSING_SKU
- Product has no SKU/model code.
- Source: sheet=KHOÁ CƠ VÀ PHỤ KIỆN CỬA · row=23
- Raw: `Mắt thần (2) Mã sản phẩm: Mắt thần (Loại 2) Thương hiệu: OSUNO Dòng sản phẩm: Mắt thần Màu sắc: Bạc Chất liệu: SS304 Thấu kính nhỏ hơn 105000 63000 12 tháng`
- Parsed: `{"name":"Mã sản phẩm: Mắt thần (Loại 2) Thương hiệu: OSUNO","sku":"","category":"Phụ kiện","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":63000,"listPrice":105000}`
- Engine issue codes: missing_sku

### 56. WARN — ENGINE_MISSING_SKU
- Thiếu mã SKU — vẫn có thể nhập nếu tên và giá đã rõ
- Source: sheet=KHOÁ CƠ VÀ PHỤ KIỆN CỬA · row=23
- Raw: `Mắt thần (2) Mã sản phẩm: Mắt thần (Loại 2) Thương hiệu: OSUNO Dòng sản phẩm: Mắt thần Màu sắc: Bạc Chất liệu: SS304 Thấu kính nhỏ hơn 105000 63000 12 tháng`
- Parsed: `{"name":"Mã sản phẩm: Mắt thần (Loại 2) Thương hiệu: OSUNO","sku":"","category":"Phụ kiện","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":63000,"listPrice":105000}`
- Engine issue codes: missing_sku

### 57. WARN — MISSING_SKU
- Product has no SKU/model code.
- Source: sheet=BKS 01 · row=7
- Raw: `2 Tủ nguồn Tủ có đèn báo và lưu điện 12V 7.5AH 1 2300000 2590000 12 tháng`
- Parsed: `{"name":"Tủ nguồn","sku":"","category":"Phụ kiện","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":2590000,"listPrice":2590000}`
- Engine issue codes: missing_sku

### 58. WARN — ENGINE_MISSING_SKU
- Thiếu mã SKU — vẫn có thể nhập nếu tên và giá đã rõ
- Source: sheet=BKS 01 · row=7
- Raw: `2 Tủ nguồn Tủ có đèn báo và lưu điện 12V 7.5AH 1 2300000 2590000 12 tháng`
- Parsed: `{"name":"Tủ nguồn","sku":"","category":"Phụ kiện","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":2590000,"listPrice":2590000}`
- Engine issue codes: missing_sku

### 59. WARN — MISSING_SKU
- Product has no SKU/model code.
- Source: sheet=BKS 01 · row=8
- Raw: `3 Nam châm 1 Trọng tải 280kg 1 1100000 1210000 12 tháng`
- Parsed: `{"name":"Nam châm","sku":"","category":"Sản phẩm","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":1210000,"listPrice":1210000}`
- Engine issue codes: missing_sku

### 60. WARN — ENGINE_MISSING_SKU
- Thiếu mã SKU — vẫn có thể nhập nếu tên và giá đã rõ
- Source: sheet=BKS 01 · row=8
- Raw: `3 Nam châm 1 Trọng tải 280kg 1 1100000 1210000 12 tháng`
- Parsed: `{"name":"Nam châm","sku":"","category":"Sản phẩm","productType":"","model":"","supplier":"Tổng hợp báo giá","unit":"Cái","costPrice":1210000,"listPrice":1210000}`
- Engine issue codes: missing_sku

_Showing 60/99 diagnostics. Full data is in the JSON/CSV report._
