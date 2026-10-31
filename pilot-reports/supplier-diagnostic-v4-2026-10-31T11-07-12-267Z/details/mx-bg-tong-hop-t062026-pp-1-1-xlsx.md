# REVIEW — MX-BG Tổng Hợp T062026 PP(1)  -1.xlsx

- Products: 40
- Golden: none — unverified supplier file
- Spreadsheet: engine=v2, sourceRows=54, previewLines=40

## Root-cause clusters

- **MISSING_SKU**: 1
- **ENGINE_MISSING_SKU**: 1
- **NEEDS_REVIEW**: 1
- **DUPLICATE_PRICE_CONFLICT**: 1
- **ENGINE_LINE_REVIEW**: 1

## Row-level diagnostics

### 1. WARN — MISSING_SKU
- Product has no SKU/model code.
- Source: sheet=Chuông hình BasIP · row=32
- Raw: `14 Giá đỡ màn hình Chiếc 1 VN 600000 600000`
- Parsed: `{"name":"Giá đỡ màn hình","sku":"","category":"Chuông cửa","productType":"","model":"","supplier":"MX BG T062026 PP(1) 1","unit":"Cái","costPrice":600000,"listPrice":0}`
- Engine issue codes: missing_sku

### 2. WARN — ENGINE_MISSING_SKU
- Thiếu mã SKU — vẫn có thể nhập nếu tên và giá đã rõ
- Source: sheet=Chuông hình BasIP · row=32
- Raw: `14 Giá đỡ màn hình Chiếc 1 VN 600000 600000`
- Parsed: `{"name":"Giá đỡ màn hình","sku":"","category":"Chuông cửa","productType":"","model":"","supplier":"MX BG T062026 PP(1) 1","unit":"Cái","costPrice":600000,"listPrice":0}`
- Engine issue codes: missing_sku

### 3. WARN — NEEDS_REVIEW
- Product is intentionally held for human review; no hard corruption proven.
- Source: sheet=Aiphone  · row=19
- Raw: `4 Bao gồm Màn hình JO-1MD và nút chuông JO-DA - Màn hình LCD: 7 inch, phím bấm cảm ứng - Nút chuông IP54,điều chỉnh được góc quan sát - Lựa chọn thêm màn hình phụ -Giao tiếp không dùng tai nghe ( Press to Talk) - Nút chuông dương tường bằng nhựa, có thể điều chỉnh góc quan sát. - Lăp được ngoài trời ( Chống chịu được nước tràn) - Đèn hỗ trợ quan sát ban đêm Bộ 1 Chuông cửa có hình JOS-1A (Gồm chuông cửa JO-1MD và JO-DA) Aiphone Thái Lan 9849000 7895000`
- Parsed: `{"name":"Chuông cửa có hình JOS-1A","sku":"JOS-1A","category":"Chuông cửa","productType":"","model":"","supplier":"MX BG T062026 PP(1) 1","unit":"Cái","costPrice":7895000,"listPrice":0}`
- Engine issue codes: duplicate_identity_price_conflict, grounded_identity_recovered_from_source_row

### 4. WARN — DUPLICATE_PRICE_CONFLICT
- Same canonical identity has conflicting prices; SmartQuote preserved source occurrences and requires review.
- Source: sheet=Aiphone  · row=19
- Raw: `4 Bao gồm Màn hình JO-1MD và nút chuông JO-DA - Màn hình LCD: 7 inch, phím bấm cảm ứng - Nút chuông IP54,điều chỉnh được góc quan sát - Lựa chọn thêm màn hình phụ -Giao tiếp không dùng tai nghe ( Press to Talk) - Nút chuông dương tường bằng nhựa, có thể điều chỉnh góc quan sát. - Lăp được ngoài trời ( Chống chịu được nước tràn) - Đèn hỗ trợ quan sát ban đêm Bộ 1 Chuông cửa có hình JOS-1A (Gồm chuông cửa JO-1MD và JO-DA) Aiphone Thái Lan 9849000 7895000`
- Parsed: `{"name":"Chuông cửa có hình JOS-1A","sku":"JOS-1A","category":"Chuông cửa","productType":"","model":"","supplier":"MX BG T062026 PP(1) 1","unit":"Cái","costPrice":7895000,"listPrice":0}`
- Engine issue codes: duplicate_identity_price_conflict, grounded_identity_recovered_from_source_row

### 5. WARN — ENGINE_LINE_REVIEW
- Canonical import line requires human review.
- Source: sheet=Aiphone  · row=19
- Raw: `4 Bao gồm Màn hình JO-1MD và nút chuông JO-DA - Màn hình LCD: 7 inch, phím bấm cảm ứng - Nút chuông IP54,điều chỉnh được góc quan sát - Lựa chọn thêm màn hình phụ -Giao tiếp không dùng tai nghe ( Press to Talk) - Nút chuông dương tường bằng nhựa, có thể điều chỉnh góc quan sát. - Lăp được ngoài trời ( Chống chịu được nước tràn) - Đèn hỗ trợ quan sát ban đêm Bộ 1 Chuông cửa có hình JOS-1A (Gồm chuông cửa JO-1MD và JO-DA) Aiphone Thái Lan 9849000 7895000`
- Parsed: `{"name":"Sản phẩm JO-1MD","sku":"","category":"Chuông cửa","productType":"","model":"","supplier":"MX BG T062026 PP(1) 1","unit":"Cái","costPrice":7895000,"listPrice":0}`
- Engine issue codes: missing_sku, duplicate_identity_price_conflict
