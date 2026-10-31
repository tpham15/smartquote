# SmartQuote P2.3.6 RC6 — Pilot hardening status

RC6 is a root-cause identity/provenance hardening candidate. No new product feature is added.

## Acceptance gate
- Bisco XLSX golden remains PASS 9/9.
- Roger PDF golden remains PASS 88/88.
- Diagnostic v4 shows no regression in golden files.
- Structured supplier corruption decreases materially, especially:
  - NPP Bisco `NAME_EQUALS_SKU`
  - MX-BG `GENERIC_PRODUCT_NAME`
  - NGUYÊN ĐÀ false identity collision caused by lost SKU suffixes
  - Tổng hợp báo giá false SKU from feature/dimension/material values
- Scan-only PDFs may remain REVIEW.
- Missing SKU alone may remain REVIEW when source truly has no SKU.

Do not promote RC6 to pilot until the real-file corpus is rerun on the user's machine.
