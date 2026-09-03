# SmartQuote — Pilot Final Excel Import Reliability Fix

## Goal

Close the remaining production risk seen when importing quotation-style Excel files into Catalog Preview before the controlled pilot.

The failure mode was not OCR. It was a spreadsheet-structure problem: customer/project metadata above the actual table could be treated as product rows, phone numbers could be interpreted as prices, and a clear `Đơn giá` column could still be forced into manual review.

## Root causes fixed

1. **Compact-row index vs worksheet-row coordinate mismatch**
   - `normalizeWorkbook()` removes blank rows.
   - Region detection previously mixed compact array indexes with the original worksheet row number `row.r`.
   - Regions now use source worksheet row coordinates consistently.

2. **Pre-table document metadata entering product regions**
   - A detected product-table header is now a hard lower boundary.
   - Customer, project, address, phone, quote number, date, tax ID, category and similar document metadata are hard non-product rows.

3. **Phone / text tokens becoming prices**
   - Vietnamese phone-number formats are removed before price candidate extraction.
   - `1 Trình bày...` can no longer be interpreted as `1 tr` = 1,000,000 VND.
   - Legitimate `1 tr` remains supported.

4. **Quote column ambiguity**
   - `Số lượng`, `Đơn giá`, and `Thành tiền` are independent fields.
   - A standard quote header with all three is recognized as a quote table.
   - `SL × Đơn giá = Thành tiền` is used as positive evidence when cached totals are present.
   - The quantity column is never treated as a tier-price column.

5. **Commercial product names overwritten by generic derivation**
   - An explicit `Tên hàng hoá / Mô tả` header locks the name column.
   - Original commercial names are preserved instead of being replaced by generic `type + SKU` names.

6. **Historical quote garbage entering product master**
   - Quote section identities stored in name/SKU cells are rejected structurally.
   - Warranty-duration pseudo-SKUs such as `BH 36 tháng` are not treated as catalog identities.
   - Zero-price section/summary/workflow rows are excluded from manual quote mapping.

7. **Manual “Sửa mapping” path diverged from automatic import safety**
   - Header search is semantic over the first 40 rows instead of choosing the row with the most text.
   - AI mapping only fills missing fields and cannot overwrite deterministic header mappings.
   - Manual quote preview follows the same section/warranty/price safety contract.

8. **Stale browser mapping memory**
   - Engine and manual catalog template keys are bumped to v2 so mappings learned by older, unsafe logic cannot silently override the new parser after deployment.

## Real-workbook verification

Two real quotation workbooks using the SmartQuote quotation structure were replayed through the same deterministic mapping/extraction modules using workbook-normalized data generated from the actual `.xlsx` bytes.

### Workbook A — quote-template structural fixture from a real workbook

- Actual product-table header found at worksheet row 13.
- Mapping confidence: 1.00.
- `Tên hàng hoá`, `Mã thiết bị`, `Số lượng`, `Đơn giá`, `Thành tiền`: mapped correctly.
- Customer/project/phone metadata above the table: 0 catalog rows.
- 3 expected product rows: 3 clean/new, 0 review/rejected.
- Original commercial names preserved.

### Workbook B — filled quotation with historical dirty rows

- Actual product-table header found at worksheet row 13.
- 8 historical candidate-like rows reduced to 5 valid product identities.
- Section-like pseudo products and `BH 36 tháng` pseudo SKU excluded.
- Automatic deterministic preview: 5 clean/new, 0 review/rejected.
- Manual “Sửa mapping” preview: same 5 valid products; totals/workflow/zero-price rows excluded.

## Regression coverage

Passed during the final fix cycle:

- Phase 14.0 Excel quote-structure smoke
- Phase 14.0 Pilot Reliability
- Phase 14.0 quote-table PDF
- Phase 14.0 catalog preview
- VAT UI + lossless Excel
- Core import review
- Lumi/Bisco/Forest deterministic PDF
- Dark Mode Step 5/6
- DocBench 32/32
- Auth / billing / plan / quota
- Tenant isolation
- White-label
- Same-origin API
- Hardening
- Phase 12.1 / 12.2 / 12.4 / 12.5 / 12.5.1 / 12.5.2 / 12.5.4

One legacy `phase12.5.3` smoke could not run because its hard-coded private fixture path is not present in this workspace. The adjacent image/SKU-boundary regression (`phase12.5.4`) passed.

## Runtime limitation of this audit environment

A clean `npm ci` timed out because the package registry is unavailable from this environment. Therefore the exact top-level `runImport(file)` path could not be rerun here with the real SheetJS package after the final cleanup.

To avoid claiming a false end-to-end pass, the real `.xlsx` workbooks were parsed with `openpyxl` into the same normalized workbook shape and then replayed through SmartQuote's deterministic header/mapping/region/extraction/validation code. This verifies the parser logic against the actual workbook structure but is not a substitute for the final production acceptance upload.

## Production acceptance gate

After deploying this package, re-upload the same Excel file that previously showed customer/project rows in Catalog Preview. The pilot is GO only if:

1. `Khách hàng`, `Địa điểm công trình`, `Điện thoại`, `Số báo giá`, etc. never appear as catalog products.
2. Phone numbers never appear as prices.
3. Standard quote tables do not show a global `Cần xác nhận cột giá` when `Đơn giá` is explicit.
4. Correct rows with name/SKU/unit price appear as `Sạch` unless they have a real actionable issue.
5. Totals, labor, section summaries, workflow/payment text do not enter catalog.
6. Product names/SKUs/prices match the source workbook.
7. The CTA count equals the valid product identities to be imported, not metadata or summary rows.

