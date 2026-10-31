# REVIEW —  BÁO GIÁ ĐL SSEHOME.xlsx

- Products: 71
- Golden: none — unverified supplier file
- Spreadsheet: engine=v2, sourceRows=76, previewLines=71

## Root-cause clusters

- **ENGINE_LINE_REVIEW**: 12
- **UNSAFE_PRODUCT**: 8
- **IDENTITY_COLLISION**: 6
- **NEEDS_REVIEW**: 6
- **IDENTITY_KEY_COLLISION_REVIEW**: 6
- **SUPPLIER_CODE_REUSED**: 6
- **DUPLICATE_PRICE_CONFLICT**: 4
- **ENGINE_PRICE_COLUMN_UNCERTAIN**: 4
- **ENGINE_PRICE_RECOVERED**: 1
- **MISSING_SKU**: 1
- **ENGINE_MISSING_SKU**: 1
- **MISSING_PRICE**: 1
- **ENGINE_MISSING_PRICE**: 1
- **ENGINE_PRICE_UNREASONABLE**: 1

## Row-level diagnostics

### 1. ERROR — UNSAFE_PRODUCT
- Product has a hard sanitizer/validation error.
- Source: sheet=KÉT PHILIPS · row=11
- Raw: `2 SBX501-5C0 90.9kg Chống cháy/ Vân tay/ mật mã/chìa cơ Xanh ngọc lục bảo/ Thiên hà tím 541.2*461*548.5 Tiêu chuẩn chống cháy UL350 - Mỹ Tiêu chuẩn test 1850°F/1010°C trong 120 phút/ 350°F/177°C ngăn cách 2 khoang 30500000 39700000 49625000 Két sắt chống cháy tiêu chuẩn UL350-2HR 0.2 0.3853904282`
- Parsed: `{"name":"Két an toàn Philips SBX501-5C0","sku":"SBX501-5C0","category":"Két an toàn","productType":"","model":"","supplier":"SSEHOME","unit":"Cái","costPrice":30500000,"listPrice":49625000}`
- Engine issue codes: identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 2. WARN — IDENTITY_COLLISION
- Same coarse identity has conflicting visible evidence; SmartQuote preserved both rows for review.
- Source: sheet=KÉT PHILIPS · row=11
- Raw: `2 SBX501-5C0 90.9kg Chống cháy/ Vân tay/ mật mã/chìa cơ Xanh ngọc lục bảo/ Thiên hà tím 541.2*461*548.5 Tiêu chuẩn chống cháy UL350 - Mỹ Tiêu chuẩn test 1850°F/1010°C trong 120 phút/ 350°F/177°C ngăn cách 2 khoang 30500000 39700000 49625000 Két sắt chống cháy tiêu chuẩn UL350-2HR 0.2 0.3853904282`
- Parsed: `{"name":"Két an toàn Philips SBX501-5C0","sku":"SBX501-5C0","category":"Két an toàn","productType":"","model":"","supplier":"SSEHOME","unit":"Cái","costPrice":30500000,"listPrice":49625000}`
- Engine issue codes: identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 3. WARN — NEEDS_REVIEW
- Product is intentionally held for human review; no hard corruption proven.
- Source: sheet=KÉT PHILIPS · row=16
- Raw: `SBX202 - 7C0 70kg Vân tay/ mật mã/chìa cơ Vàng/ Xám 700*450*420 20500000 26700000 33375000 0.2 0.3857677903`
- Parsed: `{"name":"Két an toàn Philips SBX202-7C0","sku":"SBX202-7C0","category":"Két an toàn","productType":"","model":"","supplier":"SSEHOME","unit":"Cái","costPrice":26700000,"listPrice":33375000}`
- Engine issue codes: price_recovered

### 4. WARN — ENGINE_PRICE_RECOVERED
- Giá gốc bị lỗi, đã lấy giá hợp lý từ text
- Source: sheet=KÉT PHILIPS · row=16
- Raw: `SBX202 - 7C0 70kg Vân tay/ mật mã/chìa cơ Vàng/ Xám 700*450*420 20500000 26700000 33375000 0.2 0.3857677903`
- Parsed: `{"name":"Két an toàn Philips SBX202-7C0","sku":"SBX202-7C0","category":"Két an toàn","productType":"","model":"","supplier":"SSEHOME","unit":"Cái","costPrice":26700000,"listPrice":33375000}`
- Engine issue codes: price_recovered

### 5. ERROR — UNSAFE_PRODUCT
- Product has a hard sanitizer/validation error.
- Source: sheet=KÉT PHILIPS · row=23
- Raw: `8 SBX701-5B0 88Kg Vân tay/ Mật mã / 2 hệ thống mở khóa độc lập khi xây xảy ra sự cố Xám, Bạc 550*430*400 32000000 39100000 48875000 0.2 0.3452685422`
- Parsed: `{"name":"Két an toàn Philips SBX701-5B0","sku":"SBX701-5B0","category":"Két an toàn","productType":"","model":"","supplier":"SSEHOME","unit":"Cái","costPrice":32000000,"listPrice":48875000}`
- Engine issue codes: identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 6. WARN — IDENTITY_COLLISION
- Same coarse identity has conflicting visible evidence; SmartQuote preserved both rows for review.
- Source: sheet=KÉT PHILIPS · row=23
- Raw: `8 SBX701-5B0 88Kg Vân tay/ Mật mã / 2 hệ thống mở khóa độc lập khi xây xảy ra sự cố Xám, Bạc 550*430*400 32000000 39100000 48875000 0.2 0.3452685422`
- Parsed: `{"name":"Két an toàn Philips SBX701-5B0","sku":"SBX701-5B0","category":"Két an toàn","productType":"","model":"","supplier":"SSEHOME","unit":"Cái","costPrice":32000000,"listPrice":48875000}`
- Engine issue codes: identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 7. ERROR — UNSAFE_PRODUCT
- Product has a hard sanitizer/validation error.
- Source: sheet=KÉT PHILIPS · row=27
- Raw: `12 SBX602-5CU 71.5KG Vân tay / mật mã/ chìa cơ App Vàng champagne, Xám 570*400*360 25900000 32100000 40125000 0.2 0.354517134`
- Parsed: `{"name":"Két an toàn Philips SBX602-5CU","sku":"SBX602-5CU","category":"Két an toàn","productType":"","model":"","supplier":"SSEHOME","unit":"Cái","costPrice":25900000,"listPrice":40125000}`
- Engine issue codes: identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 8. WARN — IDENTITY_COLLISION
- Same coarse identity has conflicting visible evidence; SmartQuote preserved both rows for review.
- Source: sheet=KÉT PHILIPS · row=27
- Raw: `12 SBX602-5CU 71.5KG Vân tay / mật mã/ chìa cơ App Vàng champagne, Xám 570*400*360 25900000 32100000 40125000 0.2 0.354517134`
- Parsed: `{"name":"Két an toàn Philips SBX602-5CU","sku":"SBX602-5CU","category":"Két an toàn","productType":"","model":"","supplier":"SSEHOME","unit":"Cái","costPrice":25900000,"listPrice":40125000}`
- Engine issue codes: identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 9. WARN — MISSING_SKU
- Product has no SKU/model code.
- Source: sheet=KÉT PHILIPS · row=31
- Raw: `22 Kệ trưng bày Két Kệ trưng bày Két Tiêu chuẩn 1300*790*30 4000000 #DIV/0! #DIV/0!`
- Parsed: `{"name":"Kệ trưng bày Két","sku":"","category":"Két an toàn","productType":"","model":"","supplier":"SSEHOME","unit":"Cái","costPrice":4000000,"listPrice":0}`
- Engine issue codes: missing_sku

### 10. WARN — ENGINE_MISSING_SKU
- Thiếu mã SKU — vẫn có thể nhập nếu tên và giá đã rõ
- Source: sheet=KÉT PHILIPS · row=31
- Raw: `22 Kệ trưng bày Két Kệ trưng bày Két Tiêu chuẩn 1300*790*30 4000000 #DIV/0! #DIV/0!`
- Parsed: `{"name":"Kệ trưng bày Két","sku":"","category":"Két an toàn","productType":"","model":"","supplier":"SSEHOME","unit":"Cái","costPrice":4000000,"listPrice":0}`
- Engine issue codes: missing_sku

### 11. ERROR — UNSAFE_PRODUCT
- Product has a hard sanitizer/validation error.
- Source: sheet=KHÓA KAADAS · row=4
- Raw: `2 K20- Pro Wooden doors Metal doors L425*W78*H56mm L420.1*W75.1*H56mm Xám/ Đồng đỏ Camera, Vân tay, Mật mã, Thẻ từ, Chìa cơ, Wifi App, Doorbell screen 12100000 11000000 15400000 19250000 Chưa có hàng`
- Parsed: `{"name":"Khóa thông minh Kaadas K20-Pro","sku":"K20-Pro","category":"Khóa thông minh","productType":"","model":"","supplier":"SSEHOME","unit":"Cái","costPrice":12100000,"listPrice":11000000}`
- Engine issue codes: list_price_below_cost, pilot_business_dealer_above_retail

### 12. WARN — NEEDS_REVIEW
- Product is intentionally held for human review; no hard corruption proven.
- Source: sheet=Khóa HEXA · row=4
- Raw: `1 P100M-Pro Max SET Nhận diện gương mặt 3D/ nhận diện bàn tay/ App Hexa mở khóa từ xa/ Đàm thoại 2 chiều/ Màn hình màu 2 mặt/ Vân tay/ mật mã/ thẻ từ/ chìa cơ Chống nước IP66 Thân khóa cơ Đen/ Đen xám/ Đồng đỏ 7300000 11400000 14300000 0.4895104895`
- Parsed: `{"name":"Khóa thông minh Hexa P100M-Pro Max","sku":"P100M-Pro Max","category":"Khóa thông minh","productType":"","model":"","supplier":"SSEHOME","unit":"SET","costPrice":7300000,"listPrice":14300000}`
- Engine issue codes: duplicate_identity_price_conflict

### 13. WARN — DUPLICATE_PRICE_CONFLICT
- Same canonical identity has conflicting prices; SmartQuote preserved source occurrences and requires review.
- Source: sheet=Khóa HEXA · row=4
- Raw: `1 P100M-Pro Max SET Nhận diện gương mặt 3D/ nhận diện bàn tay/ App Hexa mở khóa từ xa/ Đàm thoại 2 chiều/ Màn hình màu 2 mặt/ Vân tay/ mật mã/ thẻ từ/ chìa cơ Chống nước IP66 Thân khóa cơ Đen/ Đen xám/ Đồng đỏ 7300000 11400000 14300000 0.4895104895`
- Parsed: `{"name":"Khóa thông minh Hexa P100M-Pro Max","sku":"P100M-Pro Max","category":"Khóa thông minh","productType":"","model":"","supplier":"SSEHOME","unit":"SET","costPrice":7300000,"listPrice":14300000}`
- Engine issue codes: duplicate_identity_price_conflict

### 14. WARN — NEEDS_REVIEW
- Product is intentionally held for human review; no hard corruption proven.
- Source: sheet=Khóa HEXA · row=6
- Raw: `P100M SET App Hexa mở khóa từ xa/ Vân tay/ mật mã/ thẻ từ/ chìa cơ Chống nước IP66 Thân khóa cơ Đen/ Đen xám/ Đồng đỏ 4900000 7800000 9800000 0.5`
- Parsed: `{"name":"Khóa thông minh Hexa P100M","sku":"P100M","category":"Khóa thông minh","productType":"","model":"","supplier":"SSEHOME","unit":"SET","costPrice":4900000,"listPrice":9800000}`
- Engine issue codes: duplicate_identity_price_conflict

### 15. WARN — DUPLICATE_PRICE_CONFLICT
- Same canonical identity has conflicting prices; SmartQuote preserved source occurrences and requires review.
- Source: sheet=Khóa HEXA · row=6
- Raw: `P100M SET App Hexa mở khóa từ xa/ Vân tay/ mật mã/ thẻ từ/ chìa cơ Chống nước IP66 Thân khóa cơ Đen/ Đen xám/ Đồng đỏ 4900000 7800000 9800000 0.5`
- Parsed: `{"name":"Khóa thông minh Hexa P100M","sku":"P100M","category":"Khóa thông minh","productType":"","model":"","supplier":"SSEHOME","unit":"SET","costPrice":4900000,"listPrice":9800000}`
- Engine issue codes: duplicate_identity_price_conflict

### 16. ERROR — UNSAFE_PRODUCT
- Product has a hard sanitizer/validation error.
- Source: sheet=Khóa HEXA · row=9
- Raw: `3 R100-Pro Max SET #DIV/0!`
- Parsed: `{"name":"Khóa thông minh Hexa R100-Pro Max","sku":"R100-Pro Max","category":"Khóa thông minh","productType":"","model":"","supplier":"SSEHOME","unit":"SET","costPrice":0,"listPrice":0}`
- Engine issue codes: missing_price, price_unreasonable

### 17. WARN — MISSING_PRICE
- No usable cost/list price was resolved.
- Source: sheet=Khóa HEXA · row=9
- Raw: `3 R100-Pro Max SET #DIV/0!`
- Parsed: `{"name":"Khóa thông minh Hexa R100-Pro Max","sku":"R100-Pro Max","category":"Khóa thông minh","productType":"","model":"","supplier":"SSEHOME","unit":"SET","costPrice":0,"listPrice":0}`
- Engine issue codes: missing_price, price_unreasonable

### 18. ERROR — ENGINE_MISSING_PRICE
- Thiếu giá
- Source: sheet=Khóa HEXA · row=9
- Raw: `3 R100-Pro Max SET #DIV/0!`
- Parsed: `{"name":"Khóa thông minh Hexa R100-Pro Max","sku":"R100-Pro Max","category":"Khóa thông minh","productType":"","model":"","supplier":"SSEHOME","unit":"SET","costPrice":0,"listPrice":0}`
- Engine issue codes: missing_price, price_unreasonable

### 19. ERROR — ENGINE_PRICE_UNREASONABLE
- Giá nhập bất thường hoặc bị dính nhiều cột giá
- Source: sheet=Khóa HEXA · row=9
- Raw: `3 R100-Pro Max SET #DIV/0!`
- Parsed: `{"name":"Khóa thông minh Hexa R100-Pro Max","sku":"R100-Pro Max","category":"Khóa thông minh","productType":"","model":"","supplier":"SSEHOME","unit":"SET","costPrice":0,"listPrice":0}`
- Engine issue codes: missing_price, price_unreasonable

### 20. WARN — NEEDS_REVIEW
- Product is intentionally held for human review; no hard corruption proven.
- Source: sheet=Khóa HEXA · row=12
- Raw: `6 L100 SET App Hexa mở khóa từ xa/ Vân tay/ mật mã/ thẻ từ/ chìa cơ Chống nước IP66 Thân Khóa cơ ( thân khóa 6068 ) Vàng 24K 3800000 6400000 8000000 0.525`
- Parsed: `{"name":"Khóa thông minh Hexa L100","sku":"L100","category":"Khóa thông minh","productType":"","model":"","supplier":"SSEHOME","unit":"SET","costPrice":3800000,"listPrice":8000000}`
- Engine issue codes: duplicate_identity_price_conflict

### 21. WARN — DUPLICATE_PRICE_CONFLICT
- Same canonical identity has conflicting prices; SmartQuote preserved source occurrences and requires review.
- Source: sheet=Khóa HEXA · row=12
- Raw: `6 L100 SET App Hexa mở khóa từ xa/ Vân tay/ mật mã/ thẻ từ/ chìa cơ Chống nước IP66 Thân Khóa cơ ( thân khóa 6068 ) Vàng 24K 3800000 6400000 8000000 0.525`
- Parsed: `{"name":"Khóa thông minh Hexa L100","sku":"L100","category":"Khóa thông minh","productType":"","model":"","supplier":"SSEHOME","unit":"SET","costPrice":3800000,"listPrice":8000000}`
- Engine issue codes: duplicate_identity_price_conflict

### 22. WARN — NEEDS_REVIEW
- Product is intentionally held for human review; no hard corruption proven.
- Source: sheet=Khóa HEXA · row=16
- Raw: `13 HX12 SET Vân tay/ mật mã/ thẻ từ/ chìa cơ Thân Khóa cơ ( thân khóa 6068 ) Đồng đỏ 2100000 3950000 4900000 0.5714285714`
- Parsed: `{"name":"Khóa thông minh Hexa HX12","sku":"HX12","category":"Khóa thông minh","productType":"","model":"","supplier":"SSEHOME","unit":"SET","costPrice":2100000,"listPrice":4900000}`
- Engine issue codes: duplicate_identity_price_conflict, duplicate_identity_price_conflict

### 23. WARN — DUPLICATE_PRICE_CONFLICT
- Same canonical identity has conflicting prices; SmartQuote preserved source occurrences and requires review.
- Source: sheet=Khóa HEXA · row=16
- Raw: `13 HX12 SET Vân tay/ mật mã/ thẻ từ/ chìa cơ Thân Khóa cơ ( thân khóa 6068 ) Đồng đỏ 2100000 3950000 4900000 0.5714285714`
- Parsed: `{"name":"Khóa thông minh Hexa HX12","sku":"HX12","category":"Khóa thông minh","productType":"","model":"","supplier":"SSEHOME","unit":"SET","costPrice":2100000,"listPrice":4900000}`
- Engine issue codes: duplicate_identity_price_conflict, duplicate_identity_price_conflict

### 24. ERROR — UNSAFE_PRODUCT
- Product has a hard sanitizer/validation error.
- Source: sheet=Trang tính6 · row=6
- Raw: `SBX501-5C0 90.9kg Chống cháy/ Vân tay/ mật mã/chìa cơ Tím Galaxy 541.2*461*548.5 Tiêu chuẩn chống cháy UL350 - Mỹ Tiêu chuẩn test 1850°F/1010°C trong 120 phút/ 350°F/177°C ngăn cách 2 khoang 37800000 47200000`
- Parsed: `{"name":"Két an toàn SBX501-5C0","sku":"SBX501-5C0","category":"Két an toàn","productType":"","model":"","supplier":"SSEHOME","unit":"Cái","costPrice":37800000,"listPrice":47200000}`
- Engine issue codes: price_column_uncertain, identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 25. WARN — IDENTITY_COLLISION
- Same coarse identity has conflicting visible evidence; SmartQuote preserved both rows for review.
- Source: sheet=Trang tính6 · row=6
- Raw: `SBX501-5C0 90.9kg Chống cháy/ Vân tay/ mật mã/chìa cơ Tím Galaxy 541.2*461*548.5 Tiêu chuẩn chống cháy UL350 - Mỹ Tiêu chuẩn test 1850°F/1010°C trong 120 phút/ 350°F/177°C ngăn cách 2 khoang 37800000 47200000`
- Parsed: `{"name":"Két an toàn SBX501-5C0","sku":"SBX501-5C0","category":"Két an toàn","productType":"","model":"","supplier":"SSEHOME","unit":"Cái","costPrice":37800000,"listPrice":47200000}`
- Engine issue codes: price_column_uncertain, identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 26. WARN — ENGINE_PRICE_COLUMN_UNCERTAIN
- Chưa chắc cột đang dùng là giá mua vào: Giá khuyến mãi 20%
- Source: sheet=Trang tính6 · row=6
- Raw: `SBX501-5C0 90.9kg Chống cháy/ Vân tay/ mật mã/chìa cơ Tím Galaxy 541.2*461*548.5 Tiêu chuẩn chống cháy UL350 - Mỹ Tiêu chuẩn test 1850°F/1010°C trong 120 phút/ 350°F/177°C ngăn cách 2 khoang 37800000 47200000`
- Parsed: `{"name":"Két an toàn SBX501-5C0","sku":"SBX501-5C0","category":"Két an toàn","productType":"","model":"","supplier":"SSEHOME","unit":"Cái","costPrice":37800000,"listPrice":47200000}`
- Engine issue codes: price_column_uncertain, identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 27. ERROR — UNSAFE_PRODUCT
- Product has a hard sanitizer/validation error.
- Source: sheet=Trang tính6 · row=7
- Raw: `SBX701-5B0 88Kg Vân tay/ mật mã/bảo mật cấp 2 Xám/bạc 550*430*400 37300000 46600000`
- Parsed: `{"name":"Két an toàn SBX701-5B0","sku":"SBX701-5B0","category":"Két an toàn","productType":"","model":"","supplier":"SSEHOME","unit":"Cái","costPrice":37300000,"listPrice":46600000}`
- Engine issue codes: price_column_uncertain, identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 28. WARN — IDENTITY_COLLISION
- Same coarse identity has conflicting visible evidence; SmartQuote preserved both rows for review.
- Source: sheet=Trang tính6 · row=7
- Raw: `SBX701-5B0 88Kg Vân tay/ mật mã/bảo mật cấp 2 Xám/bạc 550*430*400 37300000 46600000`
- Parsed: `{"name":"Két an toàn SBX701-5B0","sku":"SBX701-5B0","category":"Két an toàn","productType":"","model":"","supplier":"SSEHOME","unit":"Cái","costPrice":37300000,"listPrice":46600000}`
- Engine issue codes: price_column_uncertain, identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 29. WARN — ENGINE_PRICE_COLUMN_UNCERTAIN
- Chưa chắc cột đang dùng là giá mua vào: Giá khuyến mãi 20%
- Source: sheet=Trang tính6 · row=7
- Raw: `SBX701-5B0 88Kg Vân tay/ mật mã/bảo mật cấp 2 Xám/bạc 550*430*400 37300000 46600000`
- Parsed: `{"name":"Két an toàn SBX701-5B0","sku":"SBX701-5B0","category":"Két an toàn","productType":"","model":"","supplier":"SSEHOME","unit":"Cái","costPrice":37300000,"listPrice":46600000}`
- Engine issue codes: price_column_uncertain, identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 30. ERROR — UNSAFE_PRODUCT
- Product has a hard sanitizer/validation error.
- Source: sheet=Trang tính6 · row=8
- Raw: `SBX602-5CU 71.5KG Vân tay / mật mã/ chìa cơ App Xám/Vàng 570*400*360 30600000 38300000`
- Parsed: `{"name":"Két an toàn SBX602-5CU","sku":"SBX602-5CU","category":"Két an toàn","productType":"","model":"","supplier":"SSEHOME","unit":"Cái","costPrice":30600000,"listPrice":38300000}`
- Engine issue codes: price_column_uncertain, identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 31. WARN — IDENTITY_COLLISION
- Same coarse identity has conflicting visible evidence; SmartQuote preserved both rows for review.
- Source: sheet=Trang tính6 · row=8
- Raw: `SBX602-5CU 71.5KG Vân tay / mật mã/ chìa cơ App Xám/Vàng 570*400*360 30600000 38300000`
- Parsed: `{"name":"Két an toàn SBX602-5CU","sku":"SBX602-5CU","category":"Két an toàn","productType":"","model":"","supplier":"SSEHOME","unit":"Cái","costPrice":30600000,"listPrice":38300000}`
- Engine issue codes: price_column_uncertain, identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 32. WARN — ENGINE_PRICE_COLUMN_UNCERTAIN
- Chưa chắc cột đang dùng là giá mua vào: Giá khuyến mãi 20%
- Source: sheet=Trang tính6 · row=8
- Raw: `SBX602-5CU 71.5KG Vân tay / mật mã/ chìa cơ App Xám/Vàng 570*400*360 30600000 38300000`
- Parsed: `{"name":"Két an toàn SBX602-5CU","sku":"SBX602-5CU","category":"Két an toàn","productType":"","model":"","supplier":"SSEHOME","unit":"Cái","costPrice":30600000,"listPrice":38300000}`
- Engine issue codes: price_column_uncertain, identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 33. WARN — NEEDS_REVIEW
- Product is intentionally held for human review; no hard corruption proven.
- Source: sheet=Trang tính6 · row=9
- Raw: `SBX601-4B0 31kg Vân tay/mật mã.chìa khóa cơ Xám 450*380*560 18800000 15.500.000 23600000`
- Parsed: `{"name":"Két an toàn SBX601-4B0","sku":"SBX601-4B0","category":"Két an toàn","productType":"","model":"","supplier":"SSEHOME","unit":"Cái","costPrice":15500000,"listPrice":23600000}`
- Engine issue codes: price_column_uncertain

### 34. WARN — ENGINE_PRICE_COLUMN_UNCERTAIN
- Chưa chắc cột đang dùng là giá mua vào: Giá khuyến mãi 20%
- Source: sheet=Trang tính6 · row=9
- Raw: `SBX601-4B0 31kg Vân tay/mật mã.chìa khóa cơ Xám 450*380*560 18800000 15.500.000 23600000`
- Parsed: `{"name":"Két an toàn SBX601-4B0","sku":"SBX601-4B0","category":"Két an toàn","productType":"","model":"","supplier":"SSEHOME","unit":"Cái","costPrice":15500000,"listPrice":23600000}`
- Engine issue codes: price_column_uncertain

### 35. WARN — ENGINE_LINE_REVIEW
- Canonical import line requires human review.
- Source: sheet=KÉT PHILIPS · row=11
- Raw: `2 SBX501-5C0 90.9kg Chống cháy/ Vân tay/ mật mã/chìa cơ Xanh ngọc lục bảo/ Thiên hà tím 541.2*461*548.5 Tiêu chuẩn chống cháy UL350 - Mỹ Tiêu chuẩn test 1850°F/1010°C trong 120 phút/ 350°F/177°C ngăn cách 2 khoang 30500000 39700000 49625000 Két sắt chống cháy tiêu chuẩn UL350-2HR 0.2 0.3853904282`
- Parsed: `{"name":"Két an toàn Philips SBX501-5C0","sku":"SBX501-5C0","category":"Két an toàn","productType":"","model":"","supplier":"SSEHOME","unit":"Cái","costPrice":30500000,"listPrice":49625000}`
- Engine issue codes: identity_collision_review

### 36. WARN — ENGINE_LINE_REVIEW
- Canonical import line requires human review.
- Source: sheet=KÉT PHILIPS · row=23
- Raw: `8 SBX701-5B0 88Kg Vân tay/ Mật mã / 2 hệ thống mở khóa độc lập khi xây xảy ra sự cố Xám, Bạc 550*430*400 32000000 39100000 48875000 0.2 0.3452685422`
- Parsed: `{"name":"Két an toàn Philips SBX701-5B0","sku":"SBX701-5B0","category":"Két an toàn","productType":"","model":"","supplier":"SSEHOME","unit":"Cái","costPrice":32000000,"listPrice":48875000}`
- Engine issue codes: identity_collision_review

### 37. WARN — ENGINE_LINE_REVIEW
- Canonical import line requires human review.
- Source: sheet=KÉT PHILIPS · row=27
- Raw: `12 SBX602-5CU 71.5KG Vân tay / mật mã/ chìa cơ App Vàng champagne, Xám 570*400*360 25900000 32100000 40125000 0.2 0.354517134`
- Parsed: `{"name":"Két an toàn Philips SBX602-5CU","sku":"SBX602-5CU","category":"Két an toàn","productType":"","model":"","supplier":"SSEHOME","unit":"Cái","costPrice":25900000,"listPrice":40125000}`
- Engine issue codes: identity_collision_review

### 38. WARN — ENGINE_LINE_REVIEW
- Canonical import line requires human review.
- Source: sheet=Khóa HEXA · row=4
- Raw: `1 P100M-Pro Max SET Nhận diện gương mặt 3D/ nhận diện bàn tay/ App Hexa mở khóa từ xa/ Đàm thoại 2 chiều/ Màn hình màu 2 mặt/ Vân tay/ mật mã/ thẻ từ/ chìa cơ Chống nước IP66 Thân khóa cơ Đen/ Đen xám/ Đồng đỏ 7300000 11400000 14300000 0.4895104895`
- Parsed: `{"name":"Khóa thông minh Hexa P100M-Pro Max","sku":"P100M-Pro Max","category":"Khóa thông minh","productType":"","model":"","supplier":"SSEHOME","unit":"SET","costPrice":7300000,"listPrice":14300000}`
- Engine issue codes: duplicate_identity_price_conflict

### 39. WARN — ENGINE_LINE_REVIEW
- Canonical import line requires human review.
- Source: sheet=Khóa HEXA · row=6
- Raw: `P100M SET App Hexa mở khóa từ xa/ Vân tay/ mật mã/ thẻ từ/ chìa cơ Chống nước IP66 Thân khóa cơ Đen/ Đen xám/ Đồng đỏ 4900000 7800000 9800000 0.5`
- Parsed: `{"name":"Khóa thông minh Hexa P100M","sku":"P100M","category":"Khóa thông minh","productType":"","model":"","supplier":"SSEHOME","unit":"SET","costPrice":4900000,"listPrice":9800000}`
- Engine issue codes: duplicate_identity_price_conflict

### 40. WARN — ENGINE_LINE_REVIEW
- Canonical import line requires human review.
- Source: sheet=Khóa HEXA · row=9
- Raw: `3 R100-Pro Max SET #DIV/0!`
- Parsed: `{"name":"Khóa thông minh Hexa R100-Pro Max","sku":"R100-Pro Max","category":"Khóa thông minh","productType":"","model":"","supplier":"SSEHOME","unit":"SET","costPrice":0,"listPrice":0}`
- Engine issue codes: missing_price

### 41. WARN — ENGINE_LINE_REVIEW
- Canonical import line requires human review.
- Source: sheet=Khóa HEXA · row=12
- Raw: `6 L100 SET App Hexa mở khóa từ xa/ Vân tay/ mật mã/ thẻ từ/ chìa cơ Chống nước IP66 Thân Khóa cơ ( thân khóa 6068 ) Vàng 24K 3800000 6400000 8000000 0.525`
- Parsed: `{"name":"Khóa thông minh Hexa L100","sku":"L100","category":"Khóa thông minh","productType":"","model":"","supplier":"SSEHOME","unit":"SET","costPrice":3800000,"listPrice":8000000}`
- Engine issue codes: duplicate_identity_price_conflict

### 42. WARN — ENGINE_LINE_REVIEW
- Canonical import line requires human review.
- Source: sheet=Khóa HEXA · row=16
- Raw: `13 HX12 SET Vân tay/ mật mã/ thẻ từ/ chìa cơ Thân Khóa cơ ( thân khóa 6068 ) Đồng đỏ 2100000 3950000 4900000 0.5714285714`
- Parsed: `{"name":"Khóa thông minh Hexa HX12","sku":"HX12","category":"Khóa thông minh","productType":"","model":"","supplier":"SSEHOME","unit":"SET","costPrice":2100000,"listPrice":4900000}`
- Engine issue codes: duplicate_identity_price_conflict, duplicate_identity_price_conflict

### 43. WARN — ENGINE_LINE_REVIEW
- Canonical import line requires human review.
- Source: sheet=Trang tính6 · row=6
- Raw: `SBX501-5C0 90.9kg Chống cháy/ Vân tay/ mật mã/chìa cơ Tím Galaxy 541.2*461*548.5 Tiêu chuẩn chống cháy UL350 - Mỹ Tiêu chuẩn test 1850°F/1010°C trong 120 phút/ 350°F/177°C ngăn cách 2 khoang 37800000 47200000`
- Parsed: `{"name":"Két an toàn SBX501-5C0","sku":"SBX501-5C0","category":"Két an toàn","productType":"","model":"","supplier":"SSEHOME","unit":"Cái","costPrice":37800000,"listPrice":47200000}`
- Engine issue codes: price_column_uncertain, identity_collision_review

### 44. WARN — ENGINE_LINE_REVIEW
- Canonical import line requires human review.
- Source: sheet=Trang tính6 · row=7
- Raw: `SBX701-5B0 88Kg Vân tay/ mật mã/bảo mật cấp 2 Xám/bạc 550*430*400 37300000 46600000`
- Parsed: `{"name":"Két an toàn SBX701-5B0","sku":"SBX701-5B0","category":"Két an toàn","productType":"","model":"","supplier":"SSEHOME","unit":"Cái","costPrice":37300000,"listPrice":46600000}`
- Engine issue codes: price_column_uncertain, identity_collision_review

### 45. WARN — ENGINE_LINE_REVIEW
- Canonical import line requires human review.
- Source: sheet=Trang tính6 · row=8
- Raw: `SBX602-5CU 71.5KG Vân tay / mật mã/ chìa cơ App Xám/Vàng 570*400*360 30600000 38300000`
- Parsed: `{"name":"Két an toàn SBX602-5CU","sku":"SBX602-5CU","category":"Két an toàn","productType":"","model":"","supplier":"SSEHOME","unit":"Cái","costPrice":30600000,"listPrice":38300000}`
- Engine issue codes: price_column_uncertain, identity_collision_review

### 46. WARN — ENGINE_LINE_REVIEW
- Canonical import line requires human review.
- Source: sheet=Trang tính6 · row=9
- Raw: `SBX601-4B0 31kg Vân tay/mật mã.chìa khóa cơ Xám 450*380*560 18800000 15.500.000 23600000`
- Parsed: `{"name":"Két an toàn SBX601-4B0","sku":"SBX601-4B0","category":"Két an toàn","productType":"","model":"","supplier":"SSEHOME","unit":"Cái","costPrice":15500000,"listPrice":23600000}`
- Engine issue codes: price_column_uncertain

### 47. WARN — IDENTITY_KEY_COLLISION_REVIEW
- Coarse supplier/SKU key is shared by 2 visibly distinct products; preserve rows and review, do not auto-merge.
- Source: sheet=KÉT PHILIPS · row=11
- Raw: `2 SBX501-5C0 90.9kg Chống cháy/ Vân tay/ mật mã/chìa cơ Xanh ngọc lục bảo/ Thiên hà tím 541.2*461*548.5 Tiêu chuẩn chống cháy UL350 - Mỹ Tiêu chuẩn test 1850°F/1010°C trong 120 phút/ 350°F/177°C ngăn cách 2 khoang 30500000 39700000 49625000 Két sắt chống cháy tiêu chuẩn UL350-2HR 0.2 0.3853904282`
- Parsed: `{"name":"Két an toàn Philips SBX501-5C0","sku":"SBX501-5C0","category":"Két an toàn","productType":"","model":"","supplier":"SSEHOME","unit":"Cái","costPrice":30500000,"listPrice":49625000}`
- Engine issue codes: identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 48. WARN — IDENTITY_KEY_COLLISION_REVIEW
- Coarse supplier/SKU key is shared by 2 visibly distinct products; preserve rows and review, do not auto-merge.
- Source: sheet=Trang tính6 · row=6
- Raw: `SBX501-5C0 90.9kg Chống cháy/ Vân tay/ mật mã/chìa cơ Tím Galaxy 541.2*461*548.5 Tiêu chuẩn chống cháy UL350 - Mỹ Tiêu chuẩn test 1850°F/1010°C trong 120 phút/ 350°F/177°C ngăn cách 2 khoang 37800000 47200000`
- Parsed: `{"name":"Két an toàn SBX501-5C0","sku":"SBX501-5C0","category":"Két an toàn","productType":"","model":"","supplier":"SSEHOME","unit":"Cái","costPrice":37800000,"listPrice":47200000}`
- Engine issue codes: price_column_uncertain, identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 49. WARN — IDENTITY_KEY_COLLISION_REVIEW
- Coarse supplier/SKU key is shared by 2 visibly distinct products; preserve rows and review, do not auto-merge.
- Source: sheet=KÉT PHILIPS · row=23
- Raw: `8 SBX701-5B0 88Kg Vân tay/ Mật mã / 2 hệ thống mở khóa độc lập khi xây xảy ra sự cố Xám, Bạc 550*430*400 32000000 39100000 48875000 0.2 0.3452685422`
- Parsed: `{"name":"Két an toàn Philips SBX701-5B0","sku":"SBX701-5B0","category":"Két an toàn","productType":"","model":"","supplier":"SSEHOME","unit":"Cái","costPrice":32000000,"listPrice":48875000}`
- Engine issue codes: identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 50. WARN — IDENTITY_KEY_COLLISION_REVIEW
- Coarse supplier/SKU key is shared by 2 visibly distinct products; preserve rows and review, do not auto-merge.
- Source: sheet=Trang tính6 · row=7
- Raw: `SBX701-5B0 88Kg Vân tay/ mật mã/bảo mật cấp 2 Xám/bạc 550*430*400 37300000 46600000`
- Parsed: `{"name":"Két an toàn SBX701-5B0","sku":"SBX701-5B0","category":"Két an toàn","productType":"","model":"","supplier":"SSEHOME","unit":"Cái","costPrice":37300000,"listPrice":46600000}`
- Engine issue codes: price_column_uncertain, identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 51. WARN — IDENTITY_KEY_COLLISION_REVIEW
- Coarse supplier/SKU key is shared by 2 visibly distinct products; preserve rows and review, do not auto-merge.
- Source: sheet=KÉT PHILIPS · row=27
- Raw: `12 SBX602-5CU 71.5KG Vân tay / mật mã/ chìa cơ App Vàng champagne, Xám 570*400*360 25900000 32100000 40125000 0.2 0.354517134`
- Parsed: `{"name":"Két an toàn Philips SBX602-5CU","sku":"SBX602-5CU","category":"Két an toàn","productType":"","model":"","supplier":"SSEHOME","unit":"Cái","costPrice":25900000,"listPrice":40125000}`
- Engine issue codes: identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 52. WARN — IDENTITY_KEY_COLLISION_REVIEW
- Coarse supplier/SKU key is shared by 2 visibly distinct products; preserve rows and review, do not auto-merge.
- Source: sheet=Trang tính6 · row=8
- Raw: `SBX602-5CU 71.5KG Vân tay / mật mã/ chìa cơ App Xám/Vàng 570*400*360 30600000 38300000`
- Parsed: `{"name":"Két an toàn SBX602-5CU","sku":"SBX602-5CU","category":"Két an toàn","productType":"","model":"","supplier":"SSEHOME","unit":"Cái","costPrice":30600000,"listPrice":38300000}`
- Engine issue codes: price_column_uncertain, identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 53. INFO — SUPPLIER_CODE_REUSED
- Supplier code is reused across 2 distinct rows; do not merge by bare SKU alone.
- Source: sheet=KÉT PHILIPS · row=11
- Raw: `2 SBX501-5C0 90.9kg Chống cháy/ Vân tay/ mật mã/chìa cơ Xanh ngọc lục bảo/ Thiên hà tím 541.2*461*548.5 Tiêu chuẩn chống cháy UL350 - Mỹ Tiêu chuẩn test 1850°F/1010°C trong 120 phút/ 350°F/177°C ngăn cách 2 khoang 30500000 39700000 49625000 Két sắt chống cháy tiêu chuẩn UL350-2HR 0.2 0.3853904282`
- Parsed: `{"name":"Két an toàn Philips SBX501-5C0","sku":"SBX501-5C0","category":"Két an toàn","productType":"","model":"","supplier":"SSEHOME","unit":"Cái","costPrice":30500000,"listPrice":49625000}`
- Engine issue codes: identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 54. INFO — SUPPLIER_CODE_REUSED
- Supplier code is reused across 2 distinct rows; do not merge by bare SKU alone.
- Source: sheet=Trang tính6 · row=6
- Raw: `SBX501-5C0 90.9kg Chống cháy/ Vân tay/ mật mã/chìa cơ Tím Galaxy 541.2*461*548.5 Tiêu chuẩn chống cháy UL350 - Mỹ Tiêu chuẩn test 1850°F/1010°C trong 120 phút/ 350°F/177°C ngăn cách 2 khoang 37800000 47200000`
- Parsed: `{"name":"Két an toàn SBX501-5C0","sku":"SBX501-5C0","category":"Két an toàn","productType":"","model":"","supplier":"SSEHOME","unit":"Cái","costPrice":37800000,"listPrice":47200000}`
- Engine issue codes: price_column_uncertain, identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 55. INFO — SUPPLIER_CODE_REUSED
- Supplier code is reused across 2 distinct rows; do not merge by bare SKU alone.
- Source: sheet=KÉT PHILIPS · row=23
- Raw: `8 SBX701-5B0 88Kg Vân tay/ Mật mã / 2 hệ thống mở khóa độc lập khi xây xảy ra sự cố Xám, Bạc 550*430*400 32000000 39100000 48875000 0.2 0.3452685422`
- Parsed: `{"name":"Két an toàn Philips SBX701-5B0","sku":"SBX701-5B0","category":"Két an toàn","productType":"","model":"","supplier":"SSEHOME","unit":"Cái","costPrice":32000000,"listPrice":48875000}`
- Engine issue codes: identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 56. INFO — SUPPLIER_CODE_REUSED
- Supplier code is reused across 2 distinct rows; do not merge by bare SKU alone.
- Source: sheet=Trang tính6 · row=7
- Raw: `SBX701-5B0 88Kg Vân tay/ mật mã/bảo mật cấp 2 Xám/bạc 550*430*400 37300000 46600000`
- Parsed: `{"name":"Két an toàn SBX701-5B0","sku":"SBX701-5B0","category":"Két an toàn","productType":"","model":"","supplier":"SSEHOME","unit":"Cái","costPrice":37300000,"listPrice":46600000}`
- Engine issue codes: price_column_uncertain, identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 57. INFO — SUPPLIER_CODE_REUSED
- Supplier code is reused across 2 distinct rows; do not merge by bare SKU alone.
- Source: sheet=KÉT PHILIPS · row=27
- Raw: `12 SBX602-5CU 71.5KG Vân tay / mật mã/ chìa cơ App Vàng champagne, Xám 570*400*360 25900000 32100000 40125000 0.2 0.354517134`
- Parsed: `{"name":"Két an toàn Philips SBX602-5CU","sku":"SBX602-5CU","category":"Két an toàn","productType":"","model":"","supplier":"SSEHOME","unit":"Cái","costPrice":25900000,"listPrice":40125000}`
- Engine issue codes: identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 58. INFO — SUPPLIER_CODE_REUSED
- Supplier code is reused across 2 distinct rows; do not merge by bare SKU alone.
- Source: sheet=Trang tính6 · row=8
- Raw: `SBX602-5CU 71.5KG Vân tay / mật mã/ chìa cơ App Xám/Vàng 570*400*360 30600000 38300000`
- Parsed: `{"name":"Két an toàn SBX602-5CU","sku":"SBX602-5CU","category":"Két an toàn","productType":"","model":"","supplier":"SSEHOME","unit":"Cái","costPrice":30600000,"listPrice":38300000}`
- Engine issue codes: price_column_uncertain, identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review
