# REVIEW — NGUYÊN ĐÀ.xlsx

- Products: 169
- Golden: none — unverified supplier file
- Spreadsheet: engine=v2, sourceRows=431, previewLines=170

## Root-cause clusters

- **ENGINE_LINE_REVIEW**: 8
- **UNSAFE_PRODUCT**: 7
- **IDENTITY_COLLISION**: 6
- **NEEDS_REVIEW**: 6
- **IDENTITY_KEY_COLLISION_REVIEW**: 6
- **SUPPLIER_CODE_REUSED**: 6
- **DUPLICATE_PRICE_CONFLICT**: 4
- **ENGINE_PRICE_RECOVERED**: 3
- **MISSING_SKU**: 2
- **ENGINE_MISSING_SKU**: 2

## Row-level diagnostics

### 1. ERROR — UNSAFE_PRODUCT
- Product has a hard sanitizer/validation error.
- Source: sheet=NSX · row=102
- Raw: `D001 28 RÈM CUỐN MÁNG THƯỜNG D001 M2 420000`
- Parsed: `{"name":"RÈM CUỐN MÁNG THƯỜNG","sku":"D001","category":"Rèm thông minh","productType":"","model":"","supplier":"NGUYEN DA","unit":"Cái","costPrice":420000,"listPrice":0}`
- Engine issue codes: identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 2. WARN — IDENTITY_COLLISION
- Same coarse identity has conflicting visible evidence; SmartQuote preserved both rows for review.
- Source: sheet=NSX · row=102
- Raw: `D001 28 RÈM CUỐN MÁNG THƯỜNG D001 M2 420000`
- Parsed: `{"name":"RÈM CUỐN MÁNG THƯỜNG","sku":"D001","category":"Rèm thông minh","productType":"","model":"","supplier":"NGUYEN DA","unit":"Cái","costPrice":420000,"listPrice":0}`
- Engine issue codes: identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 3. ERROR — UNSAFE_PRODUCT
- Product has a hard sanitizer/validation error.
- Source: sheet=NSX · row=103
- Raw: `D028 RÈM CUỐN MÁNG THƯỜNG D028 M2 420000`
- Parsed: `{"name":"RÈM CUỐN MÁNG THƯỜNG","sku":"D028","category":"Rèm thông minh","productType":"","model":"","supplier":"NGUYEN DA","unit":"Cái","costPrice":420000,"listPrice":0}`
- Engine issue codes: identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 4. WARN — IDENTITY_COLLISION
- Same coarse identity has conflicting visible evidence; SmartQuote preserved both rows for review.
- Source: sheet=NSX · row=103
- Raw: `D028 RÈM CUỐN MÁNG THƯỜNG D028 M2 420000`
- Parsed: `{"name":"RÈM CUỐN MÁNG THƯỜNG","sku":"D028","category":"Rèm thông minh","productType":"","model":"","supplier":"NGUYEN DA","unit":"Cái","costPrice":420000,"listPrice":0}`
- Engine issue codes: identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 5. ERROR — UNSAFE_PRODUCT
- Product has a hard sanitizer/validation error.
- Source: sheet=DL GIÁ 1 · row=103
- Raw: `D001 29 RÈM CUỐN MÁNG CẦU VÒNG D001 M2 470000`
- Parsed: `{"name":"RÈM CUỐN MÁNG CẦU VÒNG","sku":"D001","category":"Rèm thông minh","productType":"","model":"","supplier":"NGUYEN DA","unit":"Cái","costPrice":470000,"listPrice":0}`
- Engine issue codes: identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 6. WARN — IDENTITY_COLLISION
- Same coarse identity has conflicting visible evidence; SmartQuote preserved both rows for review.
- Source: sheet=DL GIÁ 1 · row=103
- Raw: `D001 29 RÈM CUỐN MÁNG CẦU VÒNG D001 M2 470000`
- Parsed: `{"name":"RÈM CUỐN MÁNG CẦU VÒNG","sku":"D001","category":"Rèm thông minh","productType":"","model":"","supplier":"NGUYEN DA","unit":"Cái","costPrice":470000,"listPrice":0}`
- Engine issue codes: identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 7. ERROR — UNSAFE_PRODUCT
- Product has a hard sanitizer/validation error.
- Source: sheet=DL GIÁ 1 · row=104
- Raw: `D028 RÈM CUỐN MÁNG CẦU VÒNG D028 M2 470000`
- Parsed: `{"name":"RÈM CUỐN MÁNG CẦU VÒNG","sku":"D028","category":"Rèm thông minh","productType":"","model":"","supplier":"NGUYEN DA","unit":"Cái","costPrice":470000,"listPrice":0}`
- Engine issue codes: identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 8. WARN — IDENTITY_COLLISION
- Same coarse identity has conflicting visible evidence; SmartQuote preserved both rows for review.
- Source: sheet=DL GIÁ 1 · row=104
- Raw: `D028 RÈM CUỐN MÁNG CẦU VÒNG D028 M2 470000`
- Parsed: `{"name":"RÈM CUỐN MÁNG CẦU VÒNG","sku":"D028","category":"Rèm thông minh","productType":"","model":"","supplier":"NGUYEN DA","unit":"Cái","costPrice":470000,"listPrice":0}`
- Engine issue codes: identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 9. ERROR — UNSAFE_PRODUCT
- Product has a hard sanitizer/validation error.
- Source: sheet=NSX · row=150
- Raw: `C002-MCS RÈM CUỐN Rèm cuốn trơn (cản nắng 100%) - máng che sáng C001 - C006, C011 - C017 M2 180000`
- Parsed: `{"name":"RÈM CUỐN","sku":"C002-MCS","category":"Rèm thông minh","productType":"","model":"","supplier":"NGUYEN DA","unit":"Cái","costPrice":180000,"listPrice":0}`
- Engine issue codes: duplicate_identity_price_conflict, duplicate_identity_price_conflict, duplicate_identity_price_conflict, duplicate_identity_price_conflict, sku_extracted_from_text, pilot_business_duplicate_sku_in_import

### 10. WARN — DUPLICATE_PRICE_CONFLICT
- Same canonical identity has conflicting prices; SmartQuote preserved source occurrences and requires review.
- Source: sheet=NSX · row=150
- Raw: `C002-MCS RÈM CUỐN Rèm cuốn trơn (cản nắng 100%) - máng che sáng C001 - C006, C011 - C017 M2 180000`
- Parsed: `{"name":"RÈM CUỐN","sku":"C002-MCS","category":"Rèm thông minh","productType":"","model":"","supplier":"NGUYEN DA","unit":"Cái","costPrice":180000,"listPrice":0}`
- Engine issue codes: duplicate_identity_price_conflict, duplicate_identity_price_conflict, duplicate_identity_price_conflict, duplicate_identity_price_conflict, sku_extracted_from_text, pilot_business_duplicate_sku_in_import

### 11. WARN — NEEDS_REVIEW
- Product is intentionally held for human review; no hard corruption proven.
- Source: sheet=2 · row=18
- Raw: `3 RÈM CUỐN C006 1300 1380 1.794 1 1.794 170000 304980 Rèm cuốn trơn (cản nắng 100%) - máng thường`
- Parsed: `{"name":"RÈM CUỐN","sku":"C006","category":"Rèm thông minh","productType":"","model":"","supplier":"NGUYEN DA","unit":"Cái","costPrice":170000,"listPrice":0}`
- Engine issue codes: duplicate_identity_price_conflict

### 12. WARN — DUPLICATE_PRICE_CONFLICT
- Same canonical identity has conflicting prices; SmartQuote preserved source occurrences and requires review.
- Source: sheet=2 · row=18
- Raw: `3 RÈM CUỐN C006 1300 1380 1.794 1 1.794 170000 304980 Rèm cuốn trơn (cản nắng 100%) - máng thường`
- Parsed: `{"name":"RÈM CUỐN","sku":"C006","category":"Rèm thông minh","productType":"","model":"","supplier":"NGUYEN DA","unit":"Cái","costPrice":170000,"listPrice":0}`
- Engine issue codes: duplicate_identity_price_conflict

### 13. WARN — NEEDS_REVIEW
- Product is intentionally held for human review; no hard corruption proven.
- Source: sheet=NSX · row=162
- Raw: `4 RÈM CUỐN Rèm cuốn lưới máng thường C007 - C008 M2 220000`
- Parsed: `{"name":"RÈM CUỐN","sku":"C007-C008","category":"Rèm thông minh","productType":"","model":"","supplier":"NGUYEN DA","unit":"Cái","costPrice":220000,"listPrice":0}`
- Engine issue codes: duplicate_identity_price_conflict

### 14. WARN — DUPLICATE_PRICE_CONFLICT
- Same canonical identity has conflicting prices; SmartQuote preserved source occurrences and requires review.
- Source: sheet=NSX · row=162
- Raw: `4 RÈM CUỐN Rèm cuốn lưới máng thường C007 - C008 M2 220000`
- Parsed: `{"name":"RÈM CUỐN","sku":"C007-C008","category":"Rèm thông minh","productType":"","model":"","supplier":"NGUYEN DA","unit":"Cái","costPrice":220000,"listPrice":0}`
- Engine issue codes: duplicate_identity_price_conflict

### 15. WARN — NEEDS_REVIEW
- Product is intentionally held for human review; no hard corruption proven.
- Source: sheet=NSX · row=165
- Raw: `5 RÈM CUỐN Rèm cuốn lưới máng thường C018 - C021 M2 210000`
- Parsed: `{"name":"RÈM CUỐN","sku":"C018-C021","category":"Rèm thông minh","productType":"","model":"","supplier":"NGUYEN DA","unit":"Cái","costPrice":210000,"listPrice":0}`
- Engine issue codes: duplicate_identity_price_conflict

### 16. WARN — DUPLICATE_PRICE_CONFLICT
- Same canonical identity has conflicting prices; SmartQuote preserved source occurrences and requires review.
- Source: sheet=NSX · row=165
- Raw: `5 RÈM CUỐN Rèm cuốn lưới máng thường C018 - C021 M2 210000`
- Parsed: `{"name":"RÈM CUỐN","sku":"C018-C021","category":"Rèm thông minh","productType":"","model":"","supplier":"NGUYEN DA","unit":"Cái","costPrice":210000,"listPrice":0}`
- Engine issue codes: duplicate_identity_price_conflict

### 17. ERROR — UNSAFE_PRODUCT
- Product has a hard sanitizer/validation error.
- Source: sheet=NSX · row=104
- Raw: `D001 29 RÈM CUỐN MÁNG CẦU VÒNG D001 M2 470000`
- Parsed: `{"name":"RÈM CUỐN MÁNG CẦU VÒNG","sku":"D001","category":"Rèm thông minh","productType":"","model":"","supplier":"NGUYEN DA","unit":"Cái","costPrice":470000,"listPrice":0}`
- Engine issue codes: identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 18. WARN — IDENTITY_COLLISION
- Same coarse identity has conflicting visible evidence; SmartQuote preserved both rows for review.
- Source: sheet=NSX · row=104
- Raw: `D001 29 RÈM CUỐN MÁNG CẦU VÒNG D001 M2 470000`
- Parsed: `{"name":"RÈM CUỐN MÁNG CẦU VÒNG","sku":"D001","category":"Rèm thông minh","productType":"","model":"","supplier":"NGUYEN DA","unit":"Cái","costPrice":470000,"listPrice":0}`
- Engine issue codes: identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 19. ERROR — UNSAFE_PRODUCT
- Product has a hard sanitizer/validation error.
- Source: sheet=NSX · row=105
- Raw: `D028 RÈM CUỐN MÁNG CẦU VÒNG D028 M2 470000`
- Parsed: `{"name":"RÈM CUỐN MÁNG CẦU VÒNG","sku":"D028","category":"Rèm thông minh","productType":"","model":"","supplier":"NGUYEN DA","unit":"Cái","costPrice":470000,"listPrice":0}`
- Engine issue codes: identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 20. WARN — IDENTITY_COLLISION
- Same coarse identity has conflicting visible evidence; SmartQuote preserved both rows for review.
- Source: sheet=NSX · row=105
- Raw: `D028 RÈM CUỐN MÁNG CẦU VÒNG D028 M2 470000`
- Parsed: `{"name":"RÈM CUỐN MÁNG CẦU VÒNG","sku":"D028","category":"Rèm thông minh","productType":"","model":"","supplier":"NGUYEN DA","unit":"Cái","costPrice":470000,"listPrice":0}`
- Engine issue codes: identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 21. WARN — NEEDS_REVIEW
- Product is intentionally held for human review; no hard corruption proven.
- Source: sheet=TRẦN PHẲNG TỰ ĐỘNG · row=16
- Raw: `1 Phần động cơ và phụ kiện Động cơ cuốn FM45 - 50/12 ( hoặc AM45) , bao gồm bộ thu Cái 1 2592000 2592000`
- Parsed: `{"name":"Phần động cơ và phụ kiện","sku":"FM45-50/12","category":"Phụ kiện","productType":"","model":"","supplier":"NGUYEN DA","unit":"Cái","costPrice":2592000,"listPrice":2592000}`
- Engine issue codes: price_recovered

### 22. WARN — ENGINE_PRICE_RECOVERED
- Giá gốc bị lỗi, đã lấy giá hợp lý từ text
- Source: sheet=TRẦN PHẲNG TỰ ĐỘNG · row=16
- Raw: `1 Phần động cơ và phụ kiện Động cơ cuốn FM45 - 50/12 ( hoặc AM45) , bao gồm bộ thu Cái 1 2592000 2592000`
- Parsed: `{"name":"Phần động cơ và phụ kiện","sku":"FM45-50/12","category":"Phụ kiện","productType":"","model":"","supplier":"NGUYEN DA","unit":"Cái","costPrice":2592000,"listPrice":2592000}`
- Engine issue codes: price_recovered

### 23. WARN — NEEDS_REVIEW
- Product is intentionally held for human review; no hard corruption proven.
- Source: sheet=TRẦN PHẲNG TỰ ĐỘNG · row=17
- Raw: `3 Phần động cơ và phụ kiện Điều khiển từ xa Bộ 1 270000 270000`
- Parsed: `{"name":"Phần động cơ và phụ kiện","sku":"","category":"Phụ kiện","productType":"","model":"","supplier":"NGUYEN DA","unit":"Điều khiển từ xa","costPrice":270000,"listPrice":270000}`
- Engine issue codes: missing_sku, price_recovered

### 24. WARN — MISSING_SKU
- Product has no SKU/model code.
- Source: sheet=TRẦN PHẲNG TỰ ĐỘNG · row=17
- Raw: `3 Phần động cơ và phụ kiện Điều khiển từ xa Bộ 1 270000 270000`
- Parsed: `{"name":"Phần động cơ và phụ kiện","sku":"","category":"Phụ kiện","productType":"","model":"","supplier":"NGUYEN DA","unit":"Điều khiển từ xa","costPrice":270000,"listPrice":270000}`
- Engine issue codes: missing_sku, price_recovered

### 25. WARN — ENGINE_MISSING_SKU
- Thiếu mã SKU — vẫn có thể nhập nếu tên và giá đã rõ
- Source: sheet=TRẦN PHẲNG TỰ ĐỘNG · row=17
- Raw: `3 Phần động cơ và phụ kiện Điều khiển từ xa Bộ 1 270000 270000`
- Parsed: `{"name":"Phần động cơ và phụ kiện","sku":"","category":"Phụ kiện","productType":"","model":"","supplier":"NGUYEN DA","unit":"Điều khiển từ xa","costPrice":270000,"listPrice":270000}`
- Engine issue codes: missing_sku, price_recovered

### 26. WARN — ENGINE_PRICE_RECOVERED
- Giá gốc bị lỗi, đã lấy giá hợp lý từ text
- Source: sheet=TRẦN PHẲNG TỰ ĐỘNG · row=17
- Raw: `3 Phần động cơ và phụ kiện Điều khiển từ xa Bộ 1 270000 270000`
- Parsed: `{"name":"Phần động cơ và phụ kiện","sku":"","category":"Phụ kiện","productType":"","model":"","supplier":"NGUYEN DA","unit":"Điều khiển từ xa","costPrice":270000,"listPrice":270000}`
- Engine issue codes: missing_sku, price_recovered

### 27. WARN — NEEDS_REVIEW
- Product is intentionally held for human review; no hard corruption proven.
- Source: sheet=TRẦN PHẲNG TỰ ĐỘNG · row=22
- Raw: `8 Phần thay đổi theo thực tế Ống nhôm Ø70mm Mét 1.6 210600 336960`
- Parsed: `{"name":"Phần thay đổi theo thực tế","sku":"","category":"Sản phẩm","productType":"","model":"","supplier":"NGUYEN DA","unit":"Ống nhôm Ø70mm","costPrice":210600,"listPrice":210600}`
- Engine issue codes: missing_sku, price_recovered

### 28. WARN — MISSING_SKU
- Product has no SKU/model code.
- Source: sheet=TRẦN PHẲNG TỰ ĐỘNG · row=22
- Raw: `8 Phần thay đổi theo thực tế Ống nhôm Ø70mm Mét 1.6 210600 336960`
- Parsed: `{"name":"Phần thay đổi theo thực tế","sku":"","category":"Sản phẩm","productType":"","model":"","supplier":"NGUYEN DA","unit":"Ống nhôm Ø70mm","costPrice":210600,"listPrice":210600}`
- Engine issue codes: missing_sku, price_recovered

### 29. WARN — ENGINE_MISSING_SKU
- Thiếu mã SKU — vẫn có thể nhập nếu tên và giá đã rõ
- Source: sheet=TRẦN PHẲNG TỰ ĐỘNG · row=22
- Raw: `8 Phần thay đổi theo thực tế Ống nhôm Ø70mm Mét 1.6 210600 336960`
- Parsed: `{"name":"Phần thay đổi theo thực tế","sku":"","category":"Sản phẩm","productType":"","model":"","supplier":"NGUYEN DA","unit":"Ống nhôm Ø70mm","costPrice":210600,"listPrice":210600}`
- Engine issue codes: missing_sku, price_recovered

### 30. WARN — ENGINE_PRICE_RECOVERED
- Giá gốc bị lỗi, đã lấy giá hợp lý từ text
- Source: sheet=TRẦN PHẲNG TỰ ĐỘNG · row=22
- Raw: `8 Phần thay đổi theo thực tế Ống nhôm Ø70mm Mét 1.6 210600 336960`
- Parsed: `{"name":"Phần thay đổi theo thực tế","sku":"","category":"Sản phẩm","productType":"","model":"","supplier":"NGUYEN DA","unit":"Ống nhôm Ø70mm","costPrice":210600,"listPrice":210600}`
- Engine issue codes: missing_sku, price_recovered

### 31. WARN — ENGINE_LINE_REVIEW
- Canonical import line requires human review.
- Source: sheet=DL GIÁ 1 · row=103
- Raw: `D001 29 RÈM CUỐN MÁNG CẦU VÒNG D001 M2 470000`
- Parsed: `{"name":"RÈM CUỐN MÁNG CẦU VÒNG","sku":"D001","category":"Rèm thông minh","productType":"","model":"","supplier":"NGUYEN DA","unit":"Cái","costPrice":470000,"listPrice":0}`
- Engine issue codes: identity_collision_review

### 32. WARN — ENGINE_LINE_REVIEW
- Canonical import line requires human review.
- Source: sheet=DL GIÁ 1 · row=104
- Raw: `D028 RÈM CUỐN MÁNG CẦU VÒNG D028 M2 470000`
- Parsed: `{"name":"RÈM CUỐN MÁNG CẦU VÒNG","sku":"D028","category":"Rèm thông minh","productType":"","model":"","supplier":"NGUYEN DA","unit":"Cái","costPrice":470000,"listPrice":0}`
- Engine issue codes: identity_collision_review

### 33. WARN — ENGINE_LINE_REVIEW
- Canonical import line requires human review.
- Source: sheet=NSX · row=162
- Raw: `4 RÈM CUỐN Rèm cuốn lưới máng thường C007 - C008 M2 220000`
- Parsed: `{"name":"RÈM CUỐN","sku":"C007-C008","category":"Rèm thông minh","productType":"","model":"","supplier":"NGUYEN DA","unit":"Cái","costPrice":220000,"listPrice":0}`
- Engine issue codes: duplicate_identity_price_conflict

### 34. WARN — ENGINE_LINE_REVIEW
- Canonical import line requires human review.
- Source: sheet=NSX · row=165
- Raw: `5 RÈM CUỐN Rèm cuốn lưới máng thường C018 - C021 M2 210000`
- Parsed: `{"name":"RÈM CUỐN","sku":"C018-C021","category":"Rèm thông minh","productType":"","model":"","supplier":"NGUYEN DA","unit":"Cái","costPrice":210000,"listPrice":0}`
- Engine issue codes: duplicate_identity_price_conflict

### 35. WARN — ENGINE_LINE_REVIEW
- Canonical import line requires human review.
- Source: sheet=NSX · row=104
- Raw: `D001 29 RÈM CUỐN MÁNG CẦU VÒNG D001 M2 470000`
- Parsed: `{"name":"RÈM CUỐN MÁNG CẦU VÒNG","sku":"D001","category":"Rèm thông minh","productType":"","model":"","supplier":"NGUYEN DA","unit":"Cái","costPrice":470000,"listPrice":0}`
- Engine issue codes: identity_collision_review

### 36. WARN — ENGINE_LINE_REVIEW
- Canonical import line requires human review.
- Source: sheet=NSX · row=105
- Raw: `D028 RÈM CUỐN MÁNG CẦU VÒNG D028 M2 470000`
- Parsed: `{"name":"RÈM CUỐN MÁNG CẦU VÒNG","sku":"D028","category":"Rèm thông minh","productType":"","model":"","supplier":"NGUYEN DA","unit":"Cái","costPrice":470000,"listPrice":0}`
- Engine issue codes: identity_collision_review

### 37. WARN — ENGINE_LINE_REVIEW
- Canonical import line requires human review.
- Source: sheet=TRẦN PHẲNG TỰ ĐỘNG · row=17
- Raw: `3 Phần động cơ và phụ kiện Điều khiển từ xa Bộ 1 270000 270000`
- Parsed: `{"name":"Phần động cơ và phụ kiện","sku":"","category":"Phụ kiện","productType":"","model":"","supplier":"NGUYEN DA","unit":"Điều khiển từ xa","costPrice":0,"listPrice":270000}`
- Engine issue codes: missing_cost_price, missing_sku

### 38. WARN — ENGINE_LINE_REVIEW
- Canonical import line requires human review.
- Source: sheet=TRẦN PHẲNG TỰ ĐỘNG · row=22
- Raw: `8 Phần thay đổi theo thực tế Ống nhôm Ø70mm Mét 1.6 210600 336960`
- Parsed: `{"name":"Phần thay đổi theo thực tế","sku":"","category":"Sản phẩm","productType":"","model":"","supplier":"NGUYEN DA","unit":"Ống nhôm Ø70mm","costPrice":0,"listPrice":210600}`
- Engine issue codes: missing_cost_price, missing_sku

### 39. WARN — IDENTITY_KEY_COLLISION_REVIEW
- Coarse supplier/SKU key is shared by 3 visibly distinct products; preserve rows and review, do not auto-merge.
- Source: sheet=NSX · row=102
- Raw: `D001 28 RÈM CUỐN MÁNG THƯỜNG D001 M2 420000`
- Parsed: `{"name":"RÈM CUỐN MÁNG THƯỜNG","sku":"D001","category":"Rèm thông minh","productType":"","model":"","supplier":"NGUYEN DA","unit":"Cái","costPrice":420000,"listPrice":0}`
- Engine issue codes: identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 40. WARN — IDENTITY_KEY_COLLISION_REVIEW
- Coarse supplier/SKU key is shared by 3 visibly distinct products; preserve rows and review, do not auto-merge.
- Source: sheet=DL GIÁ 1 · row=103
- Raw: `D001 29 RÈM CUỐN MÁNG CẦU VÒNG D001 M2 470000`
- Parsed: `{"name":"RÈM CUỐN MÁNG CẦU VÒNG","sku":"D001","category":"Rèm thông minh","productType":"","model":"","supplier":"NGUYEN DA","unit":"Cái","costPrice":470000,"listPrice":0}`
- Engine issue codes: identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 41. WARN — IDENTITY_KEY_COLLISION_REVIEW
- Coarse supplier/SKU key is shared by 3 visibly distinct products; preserve rows and review, do not auto-merge.
- Source: sheet=NSX · row=104
- Raw: `D001 29 RÈM CUỐN MÁNG CẦU VÒNG D001 M2 470000`
- Parsed: `{"name":"RÈM CUỐN MÁNG CẦU VÒNG","sku":"D001","category":"Rèm thông minh","productType":"","model":"","supplier":"NGUYEN DA","unit":"Cái","costPrice":470000,"listPrice":0}`
- Engine issue codes: identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 42. WARN — IDENTITY_KEY_COLLISION_REVIEW
- Coarse supplier/SKU key is shared by 3 visibly distinct products; preserve rows and review, do not auto-merge.
- Source: sheet=NSX · row=103
- Raw: `D028 RÈM CUỐN MÁNG THƯỜNG D028 M2 420000`
- Parsed: `{"name":"RÈM CUỐN MÁNG THƯỜNG","sku":"D028","category":"Rèm thông minh","productType":"","model":"","supplier":"NGUYEN DA","unit":"Cái","costPrice":420000,"listPrice":0}`
- Engine issue codes: identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 43. WARN — IDENTITY_KEY_COLLISION_REVIEW
- Coarse supplier/SKU key is shared by 3 visibly distinct products; preserve rows and review, do not auto-merge.
- Source: sheet=DL GIÁ 1 · row=104
- Raw: `D028 RÈM CUỐN MÁNG CẦU VÒNG D028 M2 470000`
- Parsed: `{"name":"RÈM CUỐN MÁNG CẦU VÒNG","sku":"D028","category":"Rèm thông minh","productType":"","model":"","supplier":"NGUYEN DA","unit":"Cái","costPrice":470000,"listPrice":0}`
- Engine issue codes: identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 44. WARN — IDENTITY_KEY_COLLISION_REVIEW
- Coarse supplier/SKU key is shared by 3 visibly distinct products; preserve rows and review, do not auto-merge.
- Source: sheet=NSX · row=105
- Raw: `D028 RÈM CUỐN MÁNG CẦU VÒNG D028 M2 470000`
- Parsed: `{"name":"RÈM CUỐN MÁNG CẦU VÒNG","sku":"D028","category":"Rèm thông minh","productType":"","model":"","supplier":"NGUYEN DA","unit":"Cái","costPrice":470000,"listPrice":0}`
- Engine issue codes: identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 45. INFO — SUPPLIER_CODE_REUSED
- Supplier code is reused across 3 distinct rows; do not merge by bare SKU alone.
- Source: sheet=NSX · row=102
- Raw: `D001 28 RÈM CUỐN MÁNG THƯỜNG D001 M2 420000`
- Parsed: `{"name":"RÈM CUỐN MÁNG THƯỜNG","sku":"D001","category":"Rèm thông minh","productType":"","model":"","supplier":"NGUYEN DA","unit":"Cái","costPrice":420000,"listPrice":0}`
- Engine issue codes: identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 46. INFO — SUPPLIER_CODE_REUSED
- Supplier code is reused across 3 distinct rows; do not merge by bare SKU alone.
- Source: sheet=DL GIÁ 1 · row=103
- Raw: `D001 29 RÈM CUỐN MÁNG CẦU VÒNG D001 M2 470000`
- Parsed: `{"name":"RÈM CUỐN MÁNG CẦU VÒNG","sku":"D001","category":"Rèm thông minh","productType":"","model":"","supplier":"NGUYEN DA","unit":"Cái","costPrice":470000,"listPrice":0}`
- Engine issue codes: identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 47. INFO — SUPPLIER_CODE_REUSED
- Supplier code is reused across 3 distinct rows; do not merge by bare SKU alone.
- Source: sheet=NSX · row=104
- Raw: `D001 29 RÈM CUỐN MÁNG CẦU VÒNG D001 M2 470000`
- Parsed: `{"name":"RÈM CUỐN MÁNG CẦU VÒNG","sku":"D001","category":"Rèm thông minh","productType":"","model":"","supplier":"NGUYEN DA","unit":"Cái","costPrice":470000,"listPrice":0}`
- Engine issue codes: identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 48. INFO — SUPPLIER_CODE_REUSED
- Supplier code is reused across 3 distinct rows; do not merge by bare SKU alone.
- Source: sheet=NSX · row=103
- Raw: `D028 RÈM CUỐN MÁNG THƯỜNG D028 M2 420000`
- Parsed: `{"name":"RÈM CUỐN MÁNG THƯỜNG","sku":"D028","category":"Rèm thông minh","productType":"","model":"","supplier":"NGUYEN DA","unit":"Cái","costPrice":420000,"listPrice":0}`
- Engine issue codes: identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 49. INFO — SUPPLIER_CODE_REUSED
- Supplier code is reused across 3 distinct rows; do not merge by bare SKU alone.
- Source: sheet=DL GIÁ 1 · row=104
- Raw: `D028 RÈM CUỐN MÁNG CẦU VÒNG D028 M2 470000`
- Parsed: `{"name":"RÈM CUỐN MÁNG CẦU VÒNG","sku":"D028","category":"Rèm thông minh","productType":"","model":"","supplier":"NGUYEN DA","unit":"Cái","costPrice":470000,"listPrice":0}`
- Engine issue codes: identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review

### 50. INFO — SUPPLIER_CODE_REUSED
- Supplier code is reused across 3 distinct rows; do not merge by bare SKU alone.
- Source: sheet=NSX · row=105
- Raw: `D028 RÈM CUỐN MÁNG CẦU VÒNG D028 M2 470000`
- Parsed: `{"name":"RÈM CUỐN MÁNG CẦU VÒNG","sku":"D028","category":"Rèm thông minh","productType":"","model":"","supplier":"NGUYEN DA","unit":"Cái","costPrice":470000,"listPrice":0}`
- Engine issue codes: identity_collision_review, pilot_business_duplicate_sku_in_import, identity_collision_review
