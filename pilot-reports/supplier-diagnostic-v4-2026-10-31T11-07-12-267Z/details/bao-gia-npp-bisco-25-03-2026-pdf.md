# REVIEW — Báo giá NPP Bisco 25.03.2026.pdf

- Products: 24
- Golden: none — unverified supplier file
- PDF: pages=1, textChars=3468, columnModels=1, scanLike=false

## Root-cause clusters

- **ENGINE_PDF_NAME_RECOVERED_FROM_RAW_ROW**: 18
- **NEEDS_REVIEW**: 2
- **ENGINE_PDF_OCR_UNCERTAIN**: 2
- **MISSING_SKU**: 1
- **SOURCE_STT_GAP**: 1

## Row-level diagnostics

### 1. WARN — ENGINE_PDF_NAME_RECOVERED_FROM_RAW_ROW
- Đã khôi phục tên sản phẩm từ mô tả cùng hàng thay vì dùng Mã SP làm tên
- Source: page=1 · row=31
- Raw: `1 PHOX2-433 Tay điều khiển 2 nút Vulcan Cái/chiếc 1,000,000 380,000`
- Parsed: `{"name":"Tay điều khiển 2 nút Vulcan","sku":"PHOX2-433","category":"Cổng tự động","productType":"Thiết bị cổng tự động","model":"","supplier":"PDF Catalog","unit":"Cái/chiếc","costPrice":380000,"listPrice":1000000}`
- Engine issue codes: pdf_name_recovered_from_raw_row

### 2. WARN — ENGINE_PDF_NAME_RECOVERED_FROM_RAW_ROW
- Đã khôi phục tên sản phẩm từ mô tả cùng hàng thay vì dùng Mã SP làm tên
- Source: page=1 · row=32
- Raw: `2 PHOX4-433 Tay điều khiển 4 nút Vulcan Cái/chiếc 1,200,000 580,000`
- Parsed: `{"name":"Tay điều khiển 4 nút Vulcan","sku":"PHOX4-433","category":"Cổng tự động","productType":"Thiết bị cổng tự động","model":"","supplier":"PDF Catalog","unit":"Cái/chiếc","costPrice":580000,"listPrice":1200000}`
- Engine issue codes: pdf_name_recovered_from_raw_row

### 3. WARN — ENGINE_PDF_NAME_RECOVERED_FROM_RAW_ROW
- Đã khôi phục tên sản phẩm từ mô tả cùng hàng thay vì dùng Mã SP làm tên
- Source: page=1 · row=33
- Raw: `3 13C002 Cảm biến an toàn Vulcan Bộ 2,000,000 650,000`
- Parsed: `{"name":"Cảm biến an toàn Vulcan","sku":"13C002","category":"Cổng tự động","productType":"Thiết bị cổng tự động","model":"","supplier":"PDF Catalog","unit":"Bộ","costPrice":650000,"listPrice":2000000}`
- Engine issue codes: canonical_product_name_from_semantics, pdf_name_recovered_from_raw_row

### 4. WARN — ENGINE_PDF_NAME_RECOVERED_FROM_RAW_ROW
- Đã khôi phục tên sản phẩm từ mô tả cùng hàng thay vì dùng Mã SP làm tên
- Source: page=1 · row=34
- Raw: `4 MR2 Card thu phát sóng Vulcan Cái/chiếc 3,500,000 1,100,000`
- Parsed: `{"name":"Card thu phát sóng Vulcan","sku":"MR2","category":"Cổng tự động","productType":"Thiết bị cổng tự động","model":"","supplier":"PDF Catalog","unit":"Cái/chiếc","costPrice":1100000,"listPrice":3500000}`
- Engine issue codes: pdf_name_recovered_from_raw_row

### 5. WARN — ENGINE_PDF_NAME_RECOVERED_FROM_RAW_ROW
- Đã khôi phục tên sản phẩm từ mô tả cùng hàng thay vì dùng Mã SP làm tên
- Source: page=1 · row=35
- Raw: `5 ZTBS Phụ kiện mở cổng bằng điện thoại Cái/chiếc 4,000,000 1,000,000`
- Parsed: `{"name":"Phụ kiện mở cổng bằng điện thoại","sku":"ZTBS","category":"B PHỤ KIỆN MUA THÊM","productType":"","model":"","supplier":"PDF Catalog","unit":"Cái/chiếc","costPrice":1000000,"listPrice":4000000}`
- Engine issue codes: pdf_name_recovered_from_raw_row

### 6. WARN — ENGINE_PDF_NAME_RECOVERED_FROM_RAW_ROW
- Đã khôi phục tên sản phẩm từ mô tả cùng hàng thay vì dùng Mã SP làm tên
- Source: page=1 · row=37
- Raw: `7 CHT Chặn hành trình cổng tay đòn Cái/chiếc 500,000 250,000`
- Parsed: `{"name":"Chặn hành trình cổng tay đòn","sku":"CHT","category":"B PHỤ KIỆN MUA THÊM","productType":"","model":"","supplier":"PDF Catalog","unit":"Cái/chiếc","costPrice":250000,"listPrice":500000}`
- Engine issue codes: pdf_name_recovered_from_raw_row

### 7. WARN — ENGINE_PDF_NAME_RECOVERED_FROM_RAW_ROW
- Đã khôi phục tên sản phẩm từ mô tả cùng hàng thay vì dùng Mã SP làm tên
- Source: page=1 · row=38
- Raw: `8 CC180 Phụ kiện mở cổng 180 độ bằng bánh răng Cái/chiếc 3,000,000 1,500,000`
- Parsed: `{"name":"Phụ kiện mở cổng 180 độ bằng bánh răng","sku":"CC180","category":"B PHỤ KIỆN MUA THÊM","productType":"","model":"","supplier":"PDF Catalog","unit":"Cái/chiếc","costPrice":1500000,"listPrice":3000000}`
- Engine issue codes: pdf_name_recovered_from_raw_row

### 8. WARN — ENGINE_PDF_NAME_RECOVERED_FROM_RAW_ROW
- Đã khôi phục tên sản phẩm từ mô tả cùng hàng thay vì dùng Mã SP làm tên
- Source: page=1 · row=39
- Raw: `9 D001 Đế thép nắp thép Cái/chiếc 3,500,000 1,000,000`
- Parsed: `{"name":"Đế thép nắp thép","sku":"D001","category":"B PHỤ KIỆN MUA THÊM","productType":"","model":"","supplier":"PDF Catalog","unit":"Cái/chiếc","costPrice":1000000,"listPrice":3500000}`
- Engine issue codes: pdf_name_recovered_from_raw_row

### 9. WARN — ENGINE_PDF_NAME_RECOVERED_FROM_RAW_ROW
- Đã khôi phục tên sản phẩm từ mô tả cùng hàng thay vì dùng Mã SP làm tên
- Source: page=1 · row=40
- Raw: `10 D003 Đế nắp Inox 201 Cái/chiếc 4,500,000 1,600,000`
- Parsed: `{"name":"Đế nắp Inox 201","sku":"D003","category":"B PHỤ KIỆN MUA THÊM","productType":"","model":"","supplier":"PDF Catalog","unit":"Cái/chiếc","costPrice":1600000,"listPrice":4500000}`
- Engine issue codes: pdf_name_recovered_from_raw_row

### 10. WARN — ENGINE_PDF_NAME_RECOVERED_FROM_RAW_ROW
- Đã khôi phục tên sản phẩm từ mô tả cùng hàng thay vì dùng Mã SP làm tên
- Source: page=1 · row=41
- Raw: `11 D004 Đế nắp Inox 304 Cái/chiếc 5,500,000 2,100,000`
- Parsed: `{"name":"Đế nắp Inox 304","sku":"D004","category":"B PHỤ KIỆN MUA THÊM","productType":"","model":"","supplier":"PDF Catalog","unit":"Cái/chiếc","costPrice":2100000,"listPrice":5500000}`
- Engine issue codes: pdf_name_recovered_from_raw_row

### 11. WARN — ENGINE_PDF_NAME_RECOVERED_FROM_RAW_ROW
- Đã khôi phục tên sản phẩm từ mô tả cùng hàng thay vì dùng Mã SP làm tên
- Source: page=1 · row=42
- Raw: `12 N110 Ngõng 110 độ Cái/chiếc 1,000,000 350,000`
- Parsed: `{"name":"Ngõng 110 độ","sku":"N110","category":"B PHỤ KIỆN MUA THÊM","productType":"","model":"","supplier":"PDF Catalog","unit":"Cái/chiếc","costPrice":350000,"listPrice":1000000}`
- Engine issue codes: pdf_name_recovered_from_raw_row

### 12. WARN — ENGINE_PDF_NAME_RECOVERED_FROM_RAW_ROW
- Đã khôi phục tên sản phẩm từ mô tả cùng hàng thay vì dùng Mã SP làm tên
- Source: page=1 · row=43
- Raw: `13 TBK Tay bắt khóa, bi Cái/chiếc 1,000,000 300,000`
- Parsed: `{"name":"Tay bắt khóa, bi","sku":"TBK","category":"B PHỤ KIỆN MUA THÊM","productType":"","model":"","supplier":"PDF Catalog","unit":"Cái/chiếc","costPrice":300000,"listPrice":1000000}`
- Engine issue codes: pdf_name_recovered_from_raw_row

### 13. WARN — ENGINE_PDF_NAME_RECOVERED_FROM_RAW_ROW
- Đã khôi phục tên sản phẩm từ mô tả cùng hàng thay vì dùng Mã SP làm tên
- Source: page=1 · row=44
- Raw: `14 K001 Ổ Khóa chìa Cái/chiếc 2,000,000 750,000`
- Parsed: `{"name":"Ổ Khóa chìa","sku":"K001","category":"B PHỤ KIỆN MUA THÊM","productType":"","model":"","supplier":"PDF Catalog","unit":"Cái/chiếc","costPrice":750000,"listPrice":2000000}`
- Engine issue codes: pdf_name_recovered_from_raw_row

### 14. WARN — ENGINE_PDF_NAME_RECOVERED_FROM_RAW_ROW
- Đã khôi phục tên sản phẩm từ mô tả cùng hàng thay vì dùng Mã SP làm tên
- Source: page=1 · row=45
- Raw: `15 K002 Ổ Khóa lục Cái/chiếc 1,750,000 500,000`
- Parsed: `{"name":"Ổ Khóa lục","sku":"K002","category":"B PHỤ KIỆN MUA THÊM","productType":"","model":"","supplier":"PDF Catalog","unit":"Cái/chiếc","costPrice":500000,"listPrice":1750000}`
- Engine issue codes: pdf_name_recovered_from_raw_row

### 15. WARN — ENGINE_PDF_NAME_RECOVERED_FROM_RAW_ROW
- Đã khôi phục tên sản phẩm từ mô tả cùng hàng thay vì dùng Mã SP làm tên
- Source: page=1 · row=47
- Raw: `17 TPK Túi Phụ kiện Bộ 300,000 100,000`
- Parsed: `{"name":"Túi Phụ kiện Bộ","sku":"TPK","category":"B PHỤ KIỆN MUA THÊM","productType":"","model":"","supplier":"PDF Catalog","unit":"Bộ","costPrice":100000,"listPrice":300000}`
- Engine issue codes: pdf_name_recovered_from_raw_row

### 16. WARN — ENGINE_PDF_NAME_RECOVERED_FROM_RAW_ROW
- Đã khôi phục tên sản phẩm từ mô tả cùng hàng thay vì dùng Mã SP làm tên
- Source: page=1 · row=48
- Raw: `19 22F005 Motor Vulcan 24V (Cơ cấu chuyển động Việt) Cái/chiếc 12,000,000 6,000,000`
- Parsed: `{"name":"Motor Vulcan 24V (Cơ cấu chuyển động Việt)","sku":"22F005","category":"Cổng tự động","productType":"Thiết bị cổng tự động","model":"VULCAN 24V","supplier":"PDF Catalog","unit":"Cái/chiếc","costPrice":6000000,"listPrice":12000000}`
- Engine issue codes: pdf_name_recovered_from_raw_row

### 17. WARN — ENGINE_PDF_NAME_RECOVERED_FROM_RAW_ROW
- Đã khôi phục tên sản phẩm từ mô tả cùng hàng thay vì dùng Mã SP làm tên
- Source: page=1 · row=49
- Raw: `21 M230 Mạch Vulcan 230V Cái/chiếc 8,000,000 3,500,000`
- Parsed: `{"name":"Mạch Vulcan 230V","sku":"M230","category":"Cổng tự động","productType":"Thiết bị cổng tự động","model":"VULCAN 230V","supplier":"PDF Catalog","unit":"Cái/chiếc","costPrice":3500000,"listPrice":8000000}`
- Engine issue codes: pdf_name_recovered_from_raw_row

### 18. WARN — ENGINE_PDF_NAME_RECOVERED_FROM_RAW_ROW
- Đã khôi phục tên sản phẩm từ mô tả cùng hàng thay vì dùng Mã SP làm tên
- Source: page=1 · row=50
- Raw: `22 M24 Mạch Vulcan 24V Cái/chiếc 10,000,000 4,000,000`
- Parsed: `{"name":"Mạch Vulcan 24V","sku":"M24","category":"Cổng tự động","productType":"Thiết bị cổng tự động","model":"VULCAN 24V","supplier":"PDF Catalog","unit":"Cái/chiếc","costPrice":4000000,"listPrice":10000000}`
- Engine issue codes: pdf_name_recovered_from_raw_row

### 19. WARN — NEEDS_REVIEW
- Product is intentionally held for human review; no hard corruption proven.
- Source: page=1 · row=12
- Raw: `1 CỔNG ÂM SÀN (Cơ cấu chuyển động Việt, Vỏ nhựa Việt, Đế Nắp Inox 201, khóa Bộ 41,900,000 19,765,000 Đế Inox 304 : Thêm 650K/bộ`
- Parsed: `{"name":"Cổng xoay tự động âm sàn","sku":"650K/B","category":"Cổng âm sàn tự động","productType":"Cổng xoay tự động âm sàn","model":"","supplier":"PDF Catalog","unit":"Cái","costPrice":19765000,"listPrice":41900000}`
- Engine issue codes: sku_extracted_from_text, canonical_product_name_from_semantics, pdf_ocr_uncertain

### 20. WARN — ENGINE_PDF_OCR_UNCERTAIN
- PDF/OCR không chắc — kiểm tra lại tên/giá trước khi nhập
- Source: page=1 · row=12
- Raw: `1 CỔNG ÂM SÀN (Cơ cấu chuyển động Việt, Vỏ nhựa Việt, Đế Nắp Inox 201, khóa Bộ 41,900,000 19,765,000 Đế Inox 304 : Thêm 650K/bộ`
- Parsed: `{"name":"Cổng xoay tự động âm sàn","sku":"650K/B","category":"Cổng âm sàn tự động","productType":"Cổng xoay tự động âm sàn","model":"","supplier":"PDF Catalog","unit":"Cái","costPrice":19765000,"listPrice":41900000}`
- Engine issue codes: sku_extracted_from_text, canonical_product_name_from_semantics, pdf_ocr_uncertain

### 21. WARN — NEEDS_REVIEW
- Product is intentionally held for human review; no hard corruption proven.
- Source: page=1 · row=36
- Raw: `6 TR Thanh răng chuyển động bằng thép md 250,000 150,000`
- Parsed: `{"name":"TR Thanh răng chuyển động bằng thép md","sku":"","category":"B PHỤ KIỆN MUA THÊM","productType":"","model":"","supplier":"PDF Catalog","unit":"Cái","costPrice":150000,"listPrice":250000}`
- Engine issue codes: pdf_ocr_uncertain

### 22. WARN — MISSING_SKU
- Product has no SKU/model code.
- Source: page=1 · row=36
- Raw: `6 TR Thanh răng chuyển động bằng thép md 250,000 150,000`
- Parsed: `{"name":"TR Thanh răng chuyển động bằng thép md","sku":"","category":"B PHỤ KIỆN MUA THÊM","productType":"","model":"","supplier":"PDF Catalog","unit":"Cái","costPrice":150000,"listPrice":250000}`
- Engine issue codes: pdf_ocr_uncertain

### 23. WARN — ENGINE_PDF_OCR_UNCERTAIN
- PDF chưa đủ chắc chắn — vui lòng đối chiếu tên, mã và giá với nguồn
- Source: page=1 · row=36
- Raw: `6 TR Thanh răng chuyển động bằng thép md 250,000 150,000`
- Parsed: `{"name":"TR Thanh răng chuyển động bằng thép md","sku":"","category":"B PHỤ KIỆN MUA THÊM","productType":"","model":"","supplier":"PDF Catalog","unit":"Cái","costPrice":150000,"listPrice":250000}`
- Engine issue codes: pdf_ocr_uncertain

### 24. WARN — SOURCE_STT_GAP
- PDF source STT gaps: 6, 16, 18, 20
- Source: document
