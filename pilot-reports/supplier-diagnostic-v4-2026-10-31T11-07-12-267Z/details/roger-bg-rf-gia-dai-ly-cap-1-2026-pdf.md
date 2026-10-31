# PASS — Roger_BG - RF - Giá đại lý Cấp 1 - 2026.pdf

- Products: 88
- Golden: PASS (pilot-roger-real-file-gate.mjs)
- PDF: pages=2, textChars=8663, columnModels=3, scanLike=false

## Root-cause clusters

- **NEEDS_REVIEW**: 16
- **IDENTITY_COLLISION**: 16
- **IDENTITY_KEY_COLLISION_REVIEW**: 16
- **SUPPLIER_CODE_REUSED**: 16
- **MISSING_PRICE**: 2
- **ENGINE_PDF_CONFIGURATION_PRICE_OPTIONS**: 2
- **ENGINE_PDF_AI_NEEDS_REVIEW**: 2

## Row-level diagnostics

### 1. WARN — NEEDS_REVIEW
- Product is intentionally held for human review; no hard corruption proven.
- Source: page=1 · row=18
- Raw: `4 BR21/362 Cổng tự động âm sàn Roger Italia BR21/362 - 36V - 1000kg Bộ 304 106,300,000 44,500,000`
- Parsed: `{"name":"Cổng tự động âm sàn Roger Italia BR21/362 - 36V - 1000kg","sku":"BR21/362","category":"Cổng tự động","productType":"","model":"","supplier":"Roger","unit":"Bộ","costPrice":44500000,"listPrice":106300000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 2. WARN — IDENTITY_COLLISION
- Same coarse identity has conflicting visible evidence; SmartQuote preserved both rows for review.
- Source: page=1 · row=18
- Raw: `4 BR21/362 Cổng tự động âm sàn Roger Italia BR21/362 - 36V - 1000kg Bộ 304 106,300,000 44,500,000`
- Parsed: `{"name":"Cổng tự động âm sàn Roger Italia BR21/362 - 36V - 1000kg","sku":"BR21/362","category":"Cổng tự động","productType":"","model":"","supplier":"Roger","unit":"Bộ","costPrice":44500000,"listPrice":106300000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 3. WARN — NEEDS_REVIEW
- Product is intentionally held for human review; no hard corruption proven.
- Source: page=1 · row=60
- Raw: `46 FU Đế Inox FU103/R - 304 (bao gồm đế, ngõng, phụ kiện) Chiếc 10,600,000 3,600,000`
- Parsed: `{"name":"Đế Inox FU103/R - 304 (bao gồm đế, ngõng, phụ kiện)","sku":"FU","category":"Phụ kiện","productType":"","model":"","supplier":"Roger","unit":"Chiếc","costPrice":3600000,"listPrice":10600000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 4. WARN — IDENTITY_COLLISION
- Same coarse identity has conflicting visible evidence; SmartQuote preserved both rows for review.
- Source: page=1 · row=60
- Raw: `46 FU Đế Inox FU103/R - 304 (bao gồm đế, ngõng, phụ kiện) Chiếc 10,600,000 3,600,000`
- Parsed: `{"name":"Đế Inox FU103/R - 304 (bao gồm đế, ngõng, phụ kiện)","sku":"FU","category":"Phụ kiện","productType":"","model":"","supplier":"Roger","unit":"Chiếc","costPrice":3600000,"listPrice":10600000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 5. WARN — NEEDS_REVIEW
- Product is intentionally held for human review; no hard corruption proven.
- Source: page=1 · row=61
- Raw: `47 FU Đế inox FU105/R - 201 (bao gồm đế, ngõng, phụ kiện) Chiếc 9,300,000 3,100,000`
- Parsed: `{"name":"Đế inox FU105/R - 201 (bao gồm đế, ngõng, phụ kiện)","sku":"FU","category":"Phụ kiện","productType":"","model":"","supplier":"Roger","unit":"Chiếc","costPrice":3100000,"listPrice":9300000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 6. WARN — IDENTITY_COLLISION
- Same coarse identity has conflicting visible evidence; SmartQuote preserved both rows for review.
- Source: page=1 · row=61
- Raw: `47 FU Đế inox FU105/R - 201 (bao gồm đế, ngõng, phụ kiện) Chiếc 9,300,000 3,100,000`
- Parsed: `{"name":"Đế inox FU105/R - 201 (bao gồm đế, ngõng, phụ kiện)","sku":"FU","category":"Phụ kiện","productType":"","model":"","supplier":"Roger","unit":"Chiếc","costPrice":3100000,"listPrice":9300000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 7. WARN — NEEDS_REVIEW
- Product is intentionally held for human review; no hard corruption proven.
- Source: page=1 · row=62
- Raw: `48 FU Đế thép FU100/R (bao gồm đế, ngõng, phụ kiện) Chiếc 5,800,000 2,000,000`
- Parsed: `{"name":"Đế thép FU100/R (bao gồm đế, ngõng, phụ kiện)","sku":"FU","category":"Phụ kiện","productType":"","model":"","supplier":"Roger","unit":"Chiếc","costPrice":2000000,"listPrice":5800000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 8. WARN — IDENTITY_COLLISION
- Same coarse identity has conflicting visible evidence; SmartQuote preserved both rows for review.
- Source: page=1 · row=62
- Raw: `48 FU Đế thép FU100/R (bao gồm đế, ngõng, phụ kiện) Chiếc 5,800,000 2,000,000`
- Parsed: `{"name":"Đế thép FU100/R (bao gồm đế, ngõng, phụ kiện)","sku":"FU","category":"Phụ kiện","productType":"","model":"","supplier":"Roger","unit":"Chiếc","costPrice":2000000,"listPrice":5800000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 9. WARN — NEEDS_REVIEW
- Product is intentionally held for human review; no hard corruption proven.
- Source: page=1 · row=63
- Raw: `49 FU Đế thép FU100 (bao gồm đế, ngõng, phụ kiện) Chiếc 7,500,000 2,500,000`
- Parsed: `{"name":"Đế thép FU100 (bao gồm đế, ngõng, phụ kiện)","sku":"FU","category":"Phụ kiện","productType":"","model":"","supplier":"Roger","unit":"Chiếc","costPrice":2500000,"listPrice":7500000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 10. WARN — IDENTITY_COLLISION
- Same coarse identity has conflicting visible evidence; SmartQuote preserved both rows for review.
- Source: page=1 · row=63
- Raw: `49 FU Đế thép FU100 (bao gồm đế, ngõng, phụ kiện) Chiếc 7,500,000 2,500,000`
- Parsed: `{"name":"Đế thép FU100 (bao gồm đế, ngõng, phụ kiện)","sku":"FU","category":"Phụ kiện","productType":"","model":"","supplier":"Roger","unit":"Chiếc","costPrice":2500000,"listPrice":7500000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 11. WARN — NEEDS_REVIEW
- Product is intentionally held for human review; no hard corruption proven.
- Source: page=1 · row=64
- Raw: `50 FU Đế Inox FU103/R - 304 (Đế & Nắp) Chiếc 7,500,000 2,500,000`
- Parsed: `{"name":"Đế Inox FU103/R - 304 (Đế & Nắp)","sku":"FU","category":"Phụ kiện","productType":"","model":"","supplier":"Roger","unit":"Chiếc","costPrice":2500000,"listPrice":7500000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 12. WARN — IDENTITY_COLLISION
- Same coarse identity has conflicting visible evidence; SmartQuote preserved both rows for review.
- Source: page=1 · row=64
- Raw: `50 FU Đế Inox FU103/R - 304 (Đế & Nắp) Chiếc 7,500,000 2,500,000`
- Parsed: `{"name":"Đế Inox FU103/R - 304 (Đế & Nắp)","sku":"FU","category":"Phụ kiện","productType":"","model":"","supplier":"Roger","unit":"Chiếc","costPrice":2500000,"listPrice":7500000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 13. WARN — NEEDS_REVIEW
- Product is intentionally held for human review; no hard corruption proven.
- Source: page=1 · row=70
- Raw: `53 FU Đế thép FU100 (Đế & Nắp) Chiếc 5,800,000 2,000,000`
- Parsed: `{"name":"Đế thép FU100 (Đế & Nắp)","sku":"FU","category":"Phụ kiện","productType":"","model":"","supplier":"Roger","unit":"Chiếc","costPrice":2000000,"listPrice":5800000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 14. WARN — IDENTITY_COLLISION
- Same coarse identity has conflicting visible evidence; SmartQuote preserved both rows for review.
- Source: page=1 · row=70
- Raw: `53 FU Đế thép FU100 (Đế & Nắp) Chiếc 5,800,000 2,000,000`
- Parsed: `{"name":"Đế thép FU100 (Đế & Nắp)","sku":"FU","category":"Phụ kiện","productType":"","model":"","supplier":"Roger","unit":"Chiếc","costPrice":2000000,"listPrice":5800000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 15. WARN — NEEDS_REVIEW
- Product is intentionally held for human review; no hard corruption proven.
- Source: page=1 · row=75
- Raw: `58 R21/351 Mô tơ R21/351 - 230V - 800kg Chiếc 33,000,000 12,500,000`
- Parsed: `{"name":"Mô tơ R21/351 - 230V - 800kg","sku":"R21/351","category":"Chung","productType":"","model":"","supplier":"Roger","unit":"Chiếc","costPrice":12500000,"listPrice":33000000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 16. WARN — IDENTITY_COLLISION
- Same coarse identity has conflicting visible evidence; SmartQuote preserved both rows for review.
- Source: page=1 · row=75
- Raw: `58 R21/351 Mô tơ R21/351 - 230V - 800kg Chiếc 33,000,000 12,500,000`
- Parsed: `{"name":"Mô tơ R21/351 - 230V - 800kg","sku":"R21/351","category":"Chung","productType":"","model":"","supplier":"Roger","unit":"Chiếc","costPrice":12500000,"listPrice":33000000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 17. WARN — NEEDS_REVIEW
- Product is intentionally held for human review; no hard corruption proven.
- Source: page=1 · row=76
- Raw: `59 BR21/351 Mô tơ BR21/351 - 36V - 800kg Chiếc 36,300,000 13,800,000`
- Parsed: `{"name":"Mô tơ BR21/351 - 36V - 800kg","sku":"BR21/351","category":"Chung","productType":"","model":"","supplier":"Roger","unit":"Chiếc","costPrice":13800000,"listPrice":36300000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 18. WARN — IDENTITY_COLLISION
- Same coarse identity has conflicting visible evidence; SmartQuote preserved both rows for review.
- Source: page=1 · row=76
- Raw: `59 BR21/351 Mô tơ BR21/351 - 36V - 800kg Chiếc 36,300,000 13,800,000`
- Parsed: `{"name":"Mô tơ BR21/351 - 36V - 800kg","sku":"BR21/351","category":"Chung","productType":"","model":"","supplier":"Roger","unit":"Chiếc","costPrice":13800000,"listPrice":36300000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 19. WARN — NEEDS_REVIEW
- Product is intentionally held for human review; no hard corruption proven.
- Source: page=1 · row=77
- Raw: `60 BR21/362 Mô tơ BR21/362 - 36V - 1400kg Chiếc 49,500,000 18,800,000`
- Parsed: `{"name":"Mô tơ BR21/362 - 36V - 1400kg","sku":"BR21/362","category":"Chung","productType":"","model":"","supplier":"Roger","unit":"Chiếc","costPrice":18800000,"listPrice":49500000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 20. WARN — IDENTITY_COLLISION
- Same coarse identity has conflicting visible evidence; SmartQuote preserved both rows for review.
- Source: page=1 · row=77
- Raw: `60 BR21/362 Mô tơ BR21/362 - 36V - 1400kg Chiếc 49,500,000 18,800,000`
- Parsed: `{"name":"Mô tơ BR21/362 - 36V - 1400kg","sku":"BR21/362","category":"Chung","productType":"","model":"","supplier":"Roger","unit":"Chiếc","costPrice":18800000,"listPrice":49500000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 21. WARN — NEEDS_REVIEW
- Product is intentionally held for human review; no hard corruption proven.
- Source: page=1 · row=78
- Raw: `61 BR21/351/HS Mô tơ BR21/351/HS - 36V - 800kg Chiếc 36,300,000 13,800,000`
- Parsed: `{"name":"Mô tơ BR21/351/HS - 36V - 800kg","sku":"BR21/351/HS","category":"Chung","productType":"","model":"","supplier":"Roger","unit":"Chiếc","costPrice":13800000,"listPrice":36300000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 22. WARN — IDENTITY_COLLISION
- Same coarse identity has conflicting visible evidence; SmartQuote preserved both rows for review.
- Source: page=1 · row=78
- Raw: `61 BR21/351/HS Mô tơ BR21/351/HS - 36V - 800kg Chiếc 36,300,000 13,800,000`
- Parsed: `{"name":"Mô tơ BR21/351/HS - 36V - 800kg","sku":"BR21/351/HS","category":"Chung","productType":"","model":"","supplier":"Roger","unit":"Chiếc","costPrice":13800000,"listPrice":36300000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 23. WARN — NEEDS_REVIEW
- Product is intentionally held for human review; no hard corruption proven.
- Source: page=1 · row=8
- Raw: `1 R21/351 Cổng tự động âm sàn Roger Italia R21/351 - 230V - 800kg Bộ`
- Parsed: `{"name":"Cổng tự động âm sàn Roger Italia R21/351 - 230V - 800kg","sku":"R21/351","category":"Cổng tự động","productType":"","model":"","supplier":"Roger","unit":"Bộ","costPrice":0,"listPrice":0}`
- Engine issue codes: pdf_configuration_price_options, pdf_ai_needs_review, supplier_sku_reused_for_distinct_products, identity_collision_review

### 24. WARN — MISSING_PRICE
- No usable cost/list price was resolved.
- Source: page=1 · row=8
- Raw: `1 R21/351 Cổng tự động âm sàn Roger Italia R21/351 - 230V - 800kg Bộ`
- Parsed: `{"name":"Cổng tự động âm sàn Roger Italia R21/351 - 230V - 800kg","sku":"R21/351","category":"Cổng tự động","productType":"","model":"","supplier":"Roger","unit":"Bộ","costPrice":0,"listPrice":0}`
- Engine issue codes: pdf_configuration_price_options, pdf_ai_needs_review, supplier_sku_reused_for_distinct_products, identity_collision_review

### 25. WARN — IDENTITY_COLLISION
- Same coarse identity has conflicting visible evidence; SmartQuote preserved both rows for review.
- Source: page=1 · row=8
- Raw: `1 R21/351 Cổng tự động âm sàn Roger Italia R21/351 - 230V - 800kg Bộ`
- Parsed: `{"name":"Cổng tự động âm sàn Roger Italia R21/351 - 230V - 800kg","sku":"R21/351","category":"Cổng tự động","productType":"","model":"","supplier":"Roger","unit":"Bộ","costPrice":0,"listPrice":0}`
- Engine issue codes: pdf_configuration_price_options, pdf_ai_needs_review, supplier_sku_reused_for_distinct_products, identity_collision_review

### 26. WARN — ENGINE_PDF_CONFIGURATION_PRICE_OPTIONS
- Sản phẩm có 2 cấu hình giá trong PDF; cần chọn cấu hình trước khi lưu catalog
- Source: page=1 · row=8
- Raw: `1 R21/351 Cổng tự động âm sàn Roger Italia R21/351 - 230V - 800kg Bộ`
- Parsed: `{"name":"Cổng tự động âm sàn Roger Italia R21/351 - 230V - 800kg","sku":"R21/351","category":"Cổng tự động","productType":"","model":"","supplier":"Roger","unit":"Bộ","costPrice":0,"listPrice":0}`
- Engine issue codes: pdf_configuration_price_options, pdf_ai_needs_review, supplier_sku_reused_for_distinct_products, identity_collision_review

### 27. WARN — ENGINE_PDF_AI_NEEDS_REVIEW
- PDF chưa đủ bằng chứng để tự duyệt dòng này
- Source: page=1 · row=8
- Raw: `1 R21/351 Cổng tự động âm sàn Roger Italia R21/351 - 230V - 800kg Bộ`
- Parsed: `{"name":"Cổng tự động âm sàn Roger Italia R21/351 - 230V - 800kg","sku":"R21/351","category":"Cổng tự động","productType":"","model":"","supplier":"Roger","unit":"Bộ","costPrice":0,"listPrice":0}`
- Engine issue codes: pdf_configuration_price_options, pdf_ai_needs_review, supplier_sku_reused_for_distinct_products, identity_collision_review

### 28. WARN — NEEDS_REVIEW
- Product is intentionally held for human review; no hard corruption proven.
- Source: page=1 · row=13
- Raw: `2 ÂM SÀN BR21/351 Cổng tự động âm sàn Roger Italia BR21/351 - 36V - 800kg Bộ khách trong trường hợp có sự cố`
- Parsed: `{"name":"Cổng tự động âm sàn Roger Italia BR21/351 - 36V - 800kg","sku":"BR21/351","category":"Cổng tự động","productType":"","model":"","supplier":"Roger","unit":"Bộ","costPrice":0,"listPrice":0}`
- Engine issue codes: pdf_configuration_price_options, pdf_ai_needs_review, supplier_sku_reused_for_distinct_products, identity_collision_review

### 29. WARN — MISSING_PRICE
- No usable cost/list price was resolved.
- Source: page=1 · row=13
- Raw: `2 ÂM SÀN BR21/351 Cổng tự động âm sàn Roger Italia BR21/351 - 36V - 800kg Bộ khách trong trường hợp có sự cố`
- Parsed: `{"name":"Cổng tự động âm sàn Roger Italia BR21/351 - 36V - 800kg","sku":"BR21/351","category":"Cổng tự động","productType":"","model":"","supplier":"Roger","unit":"Bộ","costPrice":0,"listPrice":0}`
- Engine issue codes: pdf_configuration_price_options, pdf_ai_needs_review, supplier_sku_reused_for_distinct_products, identity_collision_review

### 30. WARN — IDENTITY_COLLISION
- Same coarse identity has conflicting visible evidence; SmartQuote preserved both rows for review.
- Source: page=1 · row=13
- Raw: `2 ÂM SÀN BR21/351 Cổng tự động âm sàn Roger Italia BR21/351 - 36V - 800kg Bộ khách trong trường hợp có sự cố`
- Parsed: `{"name":"Cổng tự động âm sàn Roger Italia BR21/351 - 36V - 800kg","sku":"BR21/351","category":"Cổng tự động","productType":"","model":"","supplier":"Roger","unit":"Bộ","costPrice":0,"listPrice":0}`
- Engine issue codes: pdf_configuration_price_options, pdf_ai_needs_review, supplier_sku_reused_for_distinct_products, identity_collision_review

### 31. WARN — ENGINE_PDF_CONFIGURATION_PRICE_OPTIONS
- Sản phẩm có 2 cấu hình giá trong PDF; cần chọn cấu hình trước khi lưu catalog
- Source: page=1 · row=13
- Raw: `2 ÂM SÀN BR21/351 Cổng tự động âm sàn Roger Italia BR21/351 - 36V - 800kg Bộ khách trong trường hợp có sự cố`
- Parsed: `{"name":"Cổng tự động âm sàn Roger Italia BR21/351 - 36V - 800kg","sku":"BR21/351","category":"Cổng tự động","productType":"","model":"","supplier":"Roger","unit":"Bộ","costPrice":0,"listPrice":0}`
- Engine issue codes: pdf_configuration_price_options, pdf_ai_needs_review, supplier_sku_reused_for_distinct_products, identity_collision_review

### 32. WARN — ENGINE_PDF_AI_NEEDS_REVIEW
- PDF chưa đủ bằng chứng để tự duyệt dòng này
- Source: page=1 · row=13
- Raw: `2 ÂM SÀN BR21/351 Cổng tự động âm sàn Roger Italia BR21/351 - 36V - 800kg Bộ khách trong trường hợp có sự cố`
- Parsed: `{"name":"Cổng tự động âm sàn Roger Italia BR21/351 - 36V - 800kg","sku":"BR21/351","category":"Cổng tự động","productType":"","model":"","supplier":"Roger","unit":"Bộ","costPrice":0,"listPrice":0}`
- Engine issue codes: pdf_configuration_price_options, pdf_ai_needs_review, supplier_sku_reused_for_distinct_products, identity_collision_review

### 33. WARN — NEEDS_REVIEW
- Product is intentionally held for human review; no hard corruption proven.
- Source: page=1 · row=16
- Raw: `3 BR21/351/HS Cổng tự động âm sàn Roger Italia BR21/351/HS - 36V - 400kg Bộ 304 96,300,000 40,500,000`
- Parsed: `{"name":"Cổng tự động âm sàn Roger Italia BR21/351/HS - 36V - 400kg","sku":"BR21/351/HS","category":"Cổng tự động","productType":"","model":"","supplier":"Roger","unit":"Bộ","costPrice":40500000,"listPrice":96300000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 34. WARN — IDENTITY_COLLISION
- Same coarse identity has conflicting visible evidence; SmartQuote preserved both rows for review.
- Source: page=1 · row=16
- Raw: `3 BR21/351/HS Cổng tự động âm sàn Roger Italia BR21/351/HS - 36V - 400kg Bộ 304 96,300,000 40,500,000`
- Parsed: `{"name":"Cổng tự động âm sàn Roger Italia BR21/351/HS - 36V - 400kg","sku":"BR21/351/HS","category":"Cổng tự động","productType":"","model":"","supplier":"Roger","unit":"Bộ","costPrice":40500000,"listPrice":96300000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 35. WARN — NEEDS_REVIEW
- Product is intentionally held for human review; no hard corruption proven.
- Source: page=1 · row=66
- Raw: `51 FU Đế inox FU105/R - 201 (Đế & Nắp) Chiếc 6,200,000 2,100,000`
- Parsed: `{"name":"Đế inox FU105/R - 201 (Đế & Nắp)","sku":"FU","category":"PHỤ KIỆN","productType":"","model":"","supplier":"Roger","unit":"Chiếc","costPrice":2100000,"listPrice":6200000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 36. WARN — IDENTITY_COLLISION
- Same coarse identity has conflicting visible evidence; SmartQuote preserved both rows for review.
- Source: page=1 · row=66
- Raw: `51 FU Đế inox FU105/R - 201 (Đế & Nắp) Chiếc 6,200,000 2,100,000`
- Parsed: `{"name":"Đế inox FU105/R - 201 (Đế & Nắp)","sku":"FU","category":"PHỤ KIỆN","productType":"","model":"","supplier":"Roger","unit":"Chiếc","costPrice":2100000,"listPrice":6200000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 37. WARN — NEEDS_REVIEW
- Product is intentionally held for human review; no hard corruption proven.
- Source: page=1 · row=68
- Raw: `52 FU Đế thép FU100/R (Đế & Nắp) Chiếc 5,200,000 1,800,000`
- Parsed: `{"name":"Đế thép FU100/R (Đế & Nắp)","sku":"FU","category":"CỔNG TỰ","productType":"","model":"","supplier":"Roger","unit":"Chiếc","costPrice":1800000,"listPrice":5200000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 38. WARN — IDENTITY_COLLISION
- Same coarse identity has conflicting visible evidence; SmartQuote preserved both rows for review.
- Source: page=1 · row=68
- Raw: `52 FU Đế thép FU100/R (Đế & Nắp) Chiếc 5,200,000 1,800,000`
- Parsed: `{"name":"Đế thép FU100/R (Đế & Nắp)","sku":"FU","category":"CỔNG TỰ","productType":"","model":"","supplier":"Roger","unit":"Chiếc","costPrice":1800000,"listPrice":5200000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 39. WARN — IDENTITY_KEY_COLLISION_REVIEW
- Coarse supplier/SKU key is shared by 2 visibly distinct products; preserve rows and review, do not auto-merge.
- Source: page=1 · row=18
- Raw: `4 BR21/362 Cổng tự động âm sàn Roger Italia BR21/362 - 36V - 1000kg Bộ 304 106,300,000 44,500,000`
- Parsed: `{"name":"Cổng tự động âm sàn Roger Italia BR21/362 - 36V - 1000kg","sku":"BR21/362","category":"Cổng tự động","productType":"","model":"","supplier":"Roger","unit":"Bộ","costPrice":44500000,"listPrice":106300000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 40. WARN — IDENTITY_KEY_COLLISION_REVIEW
- Coarse supplier/SKU key is shared by 2 visibly distinct products; preserve rows and review, do not auto-merge.
- Source: page=1 · row=77
- Raw: `60 BR21/362 Mô tơ BR21/362 - 36V - 1400kg Chiếc 49,500,000 18,800,000`
- Parsed: `{"name":"Mô tơ BR21/362 - 36V - 1400kg","sku":"BR21/362","category":"Chung","productType":"","model":"","supplier":"Roger","unit":"Chiếc","costPrice":18800000,"listPrice":49500000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 41. WARN — IDENTITY_KEY_COLLISION_REVIEW
- Coarse supplier/SKU key is shared by 8 visibly distinct products; preserve rows and review, do not auto-merge.
- Source: page=1 · row=60
- Raw: `46 FU Đế Inox FU103/R - 304 (bao gồm đế, ngõng, phụ kiện) Chiếc 10,600,000 3,600,000`
- Parsed: `{"name":"Đế Inox FU103/R - 304 (bao gồm đế, ngõng, phụ kiện)","sku":"FU","category":"Phụ kiện","productType":"","model":"","supplier":"Roger","unit":"Chiếc","costPrice":3600000,"listPrice":10600000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 42. WARN — IDENTITY_KEY_COLLISION_REVIEW
- Coarse supplier/SKU key is shared by 8 visibly distinct products; preserve rows and review, do not auto-merge.
- Source: page=1 · row=61
- Raw: `47 FU Đế inox FU105/R - 201 (bao gồm đế, ngõng, phụ kiện) Chiếc 9,300,000 3,100,000`
- Parsed: `{"name":"Đế inox FU105/R - 201 (bao gồm đế, ngõng, phụ kiện)","sku":"FU","category":"Phụ kiện","productType":"","model":"","supplier":"Roger","unit":"Chiếc","costPrice":3100000,"listPrice":9300000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 43. WARN — IDENTITY_KEY_COLLISION_REVIEW
- Coarse supplier/SKU key is shared by 8 visibly distinct products; preserve rows and review, do not auto-merge.
- Source: page=1 · row=62
- Raw: `48 FU Đế thép FU100/R (bao gồm đế, ngõng, phụ kiện) Chiếc 5,800,000 2,000,000`
- Parsed: `{"name":"Đế thép FU100/R (bao gồm đế, ngõng, phụ kiện)","sku":"FU","category":"Phụ kiện","productType":"","model":"","supplier":"Roger","unit":"Chiếc","costPrice":2000000,"listPrice":5800000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 44. WARN — IDENTITY_KEY_COLLISION_REVIEW
- Coarse supplier/SKU key is shared by 8 visibly distinct products; preserve rows and review, do not auto-merge.
- Source: page=1 · row=63
- Raw: `49 FU Đế thép FU100 (bao gồm đế, ngõng, phụ kiện) Chiếc 7,500,000 2,500,000`
- Parsed: `{"name":"Đế thép FU100 (bao gồm đế, ngõng, phụ kiện)","sku":"FU","category":"Phụ kiện","productType":"","model":"","supplier":"Roger","unit":"Chiếc","costPrice":2500000,"listPrice":7500000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 45. WARN — IDENTITY_KEY_COLLISION_REVIEW
- Coarse supplier/SKU key is shared by 8 visibly distinct products; preserve rows and review, do not auto-merge.
- Source: page=1 · row=64
- Raw: `50 FU Đế Inox FU103/R - 304 (Đế & Nắp) Chiếc 7,500,000 2,500,000`
- Parsed: `{"name":"Đế Inox FU103/R - 304 (Đế & Nắp)","sku":"FU","category":"Phụ kiện","productType":"","model":"","supplier":"Roger","unit":"Chiếc","costPrice":2500000,"listPrice":7500000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 46. WARN — IDENTITY_KEY_COLLISION_REVIEW
- Coarse supplier/SKU key is shared by 8 visibly distinct products; preserve rows and review, do not auto-merge.
- Source: page=1 · row=70
- Raw: `53 FU Đế thép FU100 (Đế & Nắp) Chiếc 5,800,000 2,000,000`
- Parsed: `{"name":"Đế thép FU100 (Đế & Nắp)","sku":"FU","category":"Phụ kiện","productType":"","model":"","supplier":"Roger","unit":"Chiếc","costPrice":2000000,"listPrice":5800000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 47. WARN — IDENTITY_KEY_COLLISION_REVIEW
- Coarse supplier/SKU key is shared by 8 visibly distinct products; preserve rows and review, do not auto-merge.
- Source: page=1 · row=66
- Raw: `51 FU Đế inox FU105/R - 201 (Đế & Nắp) Chiếc 6,200,000 2,100,000`
- Parsed: `{"name":"Đế inox FU105/R - 201 (Đế & Nắp)","sku":"FU","category":"PHỤ KIỆN","productType":"","model":"","supplier":"Roger","unit":"Chiếc","costPrice":2100000,"listPrice":6200000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 48. WARN — IDENTITY_KEY_COLLISION_REVIEW
- Coarse supplier/SKU key is shared by 8 visibly distinct products; preserve rows and review, do not auto-merge.
- Source: page=1 · row=68
- Raw: `52 FU Đế thép FU100/R (Đế & Nắp) Chiếc 5,200,000 1,800,000`
- Parsed: `{"name":"Đế thép FU100/R (Đế & Nắp)","sku":"FU","category":"CỔNG TỰ","productType":"","model":"","supplier":"Roger","unit":"Chiếc","costPrice":1800000,"listPrice":5200000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 49. WARN — IDENTITY_KEY_COLLISION_REVIEW
- Coarse supplier/SKU key is shared by 2 visibly distinct products; preserve rows and review, do not auto-merge.
- Source: page=1 · row=75
- Raw: `58 R21/351 Mô tơ R21/351 - 230V - 800kg Chiếc 33,000,000 12,500,000`
- Parsed: `{"name":"Mô tơ R21/351 - 230V - 800kg","sku":"R21/351","category":"Chung","productType":"","model":"","supplier":"Roger","unit":"Chiếc","costPrice":12500000,"listPrice":33000000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 50. WARN — IDENTITY_KEY_COLLISION_REVIEW
- Coarse supplier/SKU key is shared by 2 visibly distinct products; preserve rows and review, do not auto-merge.
- Source: page=1 · row=8
- Raw: `1 R21/351 Cổng tự động âm sàn Roger Italia R21/351 - 230V - 800kg Bộ`
- Parsed: `{"name":"Cổng tự động âm sàn Roger Italia R21/351 - 230V - 800kg","sku":"R21/351","category":"Cổng tự động","productType":"","model":"","supplier":"Roger","unit":"Bộ","costPrice":0,"listPrice":0}`
- Engine issue codes: pdf_configuration_price_options, pdf_ai_needs_review, supplier_sku_reused_for_distinct_products, identity_collision_review

### 51. WARN — IDENTITY_KEY_COLLISION_REVIEW
- Coarse supplier/SKU key is shared by 2 visibly distinct products; preserve rows and review, do not auto-merge.
- Source: page=1 · row=76
- Raw: `59 BR21/351 Mô tơ BR21/351 - 36V - 800kg Chiếc 36,300,000 13,800,000`
- Parsed: `{"name":"Mô tơ BR21/351 - 36V - 800kg","sku":"BR21/351","category":"Chung","productType":"","model":"","supplier":"Roger","unit":"Chiếc","costPrice":13800000,"listPrice":36300000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 52. WARN — IDENTITY_KEY_COLLISION_REVIEW
- Coarse supplier/SKU key is shared by 2 visibly distinct products; preserve rows and review, do not auto-merge.
- Source: page=1 · row=13
- Raw: `2 ÂM SÀN BR21/351 Cổng tự động âm sàn Roger Italia BR21/351 - 36V - 800kg Bộ khách trong trường hợp có sự cố`
- Parsed: `{"name":"Cổng tự động âm sàn Roger Italia BR21/351 - 36V - 800kg","sku":"BR21/351","category":"Cổng tự động","productType":"","model":"","supplier":"Roger","unit":"Bộ","costPrice":0,"listPrice":0}`
- Engine issue codes: pdf_configuration_price_options, pdf_ai_needs_review, supplier_sku_reused_for_distinct_products, identity_collision_review

### 53. WARN — IDENTITY_KEY_COLLISION_REVIEW
- Coarse supplier/SKU key is shared by 2 visibly distinct products; preserve rows and review, do not auto-merge.
- Source: page=1 · row=78
- Raw: `61 BR21/351/HS Mô tơ BR21/351/HS - 36V - 800kg Chiếc 36,300,000 13,800,000`
- Parsed: `{"name":"Mô tơ BR21/351/HS - 36V - 800kg","sku":"BR21/351/HS","category":"Chung","productType":"","model":"","supplier":"Roger","unit":"Chiếc","costPrice":13800000,"listPrice":36300000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 54. WARN — IDENTITY_KEY_COLLISION_REVIEW
- Coarse supplier/SKU key is shared by 2 visibly distinct products; preserve rows and review, do not auto-merge.
- Source: page=1 · row=16
- Raw: `3 BR21/351/HS Cổng tự động âm sàn Roger Italia BR21/351/HS - 36V - 400kg Bộ 304 96,300,000 40,500,000`
- Parsed: `{"name":"Cổng tự động âm sàn Roger Italia BR21/351/HS - 36V - 400kg","sku":"BR21/351/HS","category":"Cổng tự động","productType":"","model":"","supplier":"Roger","unit":"Bộ","costPrice":40500000,"listPrice":96300000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 55. INFO — SUPPLIER_CODE_REUSED
- Supplier code is reused across 2 distinct rows; do not merge by bare SKU alone.
- Source: page=1 · row=18
- Raw: `4 BR21/362 Cổng tự động âm sàn Roger Italia BR21/362 - 36V - 1000kg Bộ 304 106,300,000 44,500,000`
- Parsed: `{"name":"Cổng tự động âm sàn Roger Italia BR21/362 - 36V - 1000kg","sku":"BR21/362","category":"Cổng tự động","productType":"","model":"","supplier":"Roger","unit":"Bộ","costPrice":44500000,"listPrice":106300000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 56. INFO — SUPPLIER_CODE_REUSED
- Supplier code is reused across 2 distinct rows; do not merge by bare SKU alone.
- Source: page=1 · row=77
- Raw: `60 BR21/362 Mô tơ BR21/362 - 36V - 1400kg Chiếc 49,500,000 18,800,000`
- Parsed: `{"name":"Mô tơ BR21/362 - 36V - 1400kg","sku":"BR21/362","category":"Chung","productType":"","model":"","supplier":"Roger","unit":"Chiếc","costPrice":18800000,"listPrice":49500000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 57. INFO — SUPPLIER_CODE_REUSED
- Supplier code is reused across 8 distinct rows; do not merge by bare SKU alone.
- Source: page=1 · row=60
- Raw: `46 FU Đế Inox FU103/R - 304 (bao gồm đế, ngõng, phụ kiện) Chiếc 10,600,000 3,600,000`
- Parsed: `{"name":"Đế Inox FU103/R - 304 (bao gồm đế, ngõng, phụ kiện)","sku":"FU","category":"Phụ kiện","productType":"","model":"","supplier":"Roger","unit":"Chiếc","costPrice":3600000,"listPrice":10600000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 58. INFO — SUPPLIER_CODE_REUSED
- Supplier code is reused across 8 distinct rows; do not merge by bare SKU alone.
- Source: page=1 · row=61
- Raw: `47 FU Đế inox FU105/R - 201 (bao gồm đế, ngõng, phụ kiện) Chiếc 9,300,000 3,100,000`
- Parsed: `{"name":"Đế inox FU105/R - 201 (bao gồm đế, ngõng, phụ kiện)","sku":"FU","category":"Phụ kiện","productType":"","model":"","supplier":"Roger","unit":"Chiếc","costPrice":3100000,"listPrice":9300000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 59. INFO — SUPPLIER_CODE_REUSED
- Supplier code is reused across 8 distinct rows; do not merge by bare SKU alone.
- Source: page=1 · row=62
- Raw: `48 FU Đế thép FU100/R (bao gồm đế, ngõng, phụ kiện) Chiếc 5,800,000 2,000,000`
- Parsed: `{"name":"Đế thép FU100/R (bao gồm đế, ngõng, phụ kiện)","sku":"FU","category":"Phụ kiện","productType":"","model":"","supplier":"Roger","unit":"Chiếc","costPrice":2000000,"listPrice":5800000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

### 60. INFO — SUPPLIER_CODE_REUSED
- Supplier code is reused across 8 distinct rows; do not merge by bare SKU alone.
- Source: page=1 · row=63
- Raw: `49 FU Đế thép FU100 (bao gồm đế, ngõng, phụ kiện) Chiếc 7,500,000 2,500,000`
- Parsed: `{"name":"Đế thép FU100 (bao gồm đế, ngõng, phụ kiện)","sku":"FU","category":"Phụ kiện","productType":"","model":"","supplier":"Roger","unit":"Chiếc","costPrice":2500000,"listPrice":7500000}`
- Engine issue codes: supplier_sku_reused_for_distinct_products, identity_collision_review

_Showing 60/70 diagnostics. Full data is in the JSON/CSV report._
