# SmartQuote Supplier Diagnostic Gate v4

- Folder: `/Users/vienpham/Desktop/bang-gia`
- Generated: 2026-10-31T11:07:12.281Z
- Scope: top-level `.pdf/.xls/.xlsx` only; all subfolders are excluded.
- Policy: a known golden PASS is authoritative; unknown supplier files never auto-PASS.
- Result: **PASS=2 · REVIEW=8 · FAIL=0**

| Status | File | Products | Errors | Warnings | Golden | Main root causes |
|---|---|---:|---:|---:|---|---|
| REVIEW |  BÁO GIÁ ĐL SSEHOME.xlsx | 71 | 10 | 42 | — | ENGINE_LINE_REVIEW=12; UNSAFE_PRODUCT=8; IDENTITY_COLLISION=6; NEEDS_REVIEW=6; IDENTITY_KEY_COLLISION_REVIEW=6 |
| REVIEW | Bảng giá Lighting 2026.06.01.pdf | 0 | 0 | 1 | — | SCAN_OR_IMAGE_PDF=1 |
| REVIEW | Bảng giá Smarthome 2026.06.01.pdf | 0 | 0 | 1 | — | SCAN_OR_IMAGE_PDF=1 |
| REVIEW | Báo giá NPP Bisco 25.03.2026.pdf | 24 | 0 | 24 | — | ENGINE_PDF_NAME_RECOVERED_FROM_RAW_ROW=18; NEEDS_REVIEW=2; ENGINE_PDF_OCR_UNCERTAIN=2; MISSING_SKU=1; SOURCE_STT_GAP=1 |
| REVIEW | BBG THANH RAY KÉO TAY FOREST GSTAR VIỆT NAM 2024.pdf | 5 | 0 | 5 | — | MISSING_SKU=5 |
| PASS | Form BG _Bisco Tech_V2_2025.xlsx | 9 | 0 | 0 | PASS |  |
| REVIEW | MX-BG Tổng Hợp T062026 PP(1)  -1.xlsx | 40 | 0 | 5 | — | MISSING_SKU=1; ENGINE_MISSING_SKU=1; NEEDS_REVIEW=1; DUPLICATE_PRICE_CONFLICT=1; ENGINE_LINE_REVIEW=1 |
| REVIEW | NGUYÊN ĐÀ.xlsx | 169 | 7 | 37 | — | ENGINE_LINE_REVIEW=8; UNSAFE_PRODUCT=7; IDENTITY_COLLISION=6; NEEDS_REVIEW=6; IDENTITY_KEY_COLLISION_REVIEW=6 |
| PASS | Roger_BG - RF - Giá đại lý Cấp 1 - 2026.pdf | 88 | 0 | 54 | PASS | NEEDS_REVIEW=16; IDENTITY_COLLISION=16; IDENTITY_KEY_COLLISION_REVIEW=16; SUPPLIER_CODE_REUSED=16; MISSING_PRICE=2 |
| REVIEW | Tổng hợp báo giá.xlsx | 100 | 0 | 99 | — | MISSING_SKU=30; ENGINE_MISSING_SKU=30; NEEDS_REVIEW=12; ENGINE_LINE_REVIEW=12; DUPLICATE_PRICE_CONFLICT=8 |

## What to send back for parser hardening

Send `SUMMARY.md` plus `ALL_ISSUES.csv`. For a specific failing supplier, also send its file from `details/`.

## Release interpretation

- **PASS** = exact golden gate passed. Generic warnings remain visible but do not override verified evidence.
- **REVIEW** = no proven corruption blocker, but this supplier file has no reviewed golden baseline or is image/scan based.
- **FAIL** = deterministic evidence of identity/data corruption or a golden gate failure.