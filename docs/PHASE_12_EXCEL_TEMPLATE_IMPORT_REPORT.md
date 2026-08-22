# Phase 12 — Excel Quote Template Import

## Scope

Excel-only quote template support for dealers. This phase deliberately excludes PDF template upload/export.

## What changed

- Added `Mẫu Excel báo giá của đại lý` section under `Mẫu & Gói > Mẫu báo giá`.
- Dealers can upload `.xlsx` quote templates and map:
  - customer/project fields,
  - item table start/template rows,
  - item columns,
  - subtotal/labor/VAT/grand total cells.
- Quote screen now shows `Xuất theo mẫu Excel` when at least one Excel template exists.
- Added `/api/excel-template` Python endpoint using `openpyxl` to fill the original `.xlsx` template and preserve workbook styling better than client-only SheetJS.
- Added client fallback for local dev.

## Constraints kept

- No PDF template support in this phase.
- No changes to `src/import-engine/**`.
- No new localStorage/sessionStorage mechanism; templates are stored inside the existing company/cloud settings snapshot.

## Smoke

```bash
npm run smoke:phase12
```
