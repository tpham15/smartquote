# SmartQuote P2.3.5 RC5 — Pilot status

**Status: CANDIDATE / NOT YET PILOT-READY**

RC5 is an importer-hardening release, not a feature release.

Pilot GO requires:

- Bisco real-file golden gate PASS.
- Roger real-file golden gate PASS.
- Supplier Diagnostic v3 reviewed for all top-level supplier files.
- No hard corruption (`NAME_EQUALS_SKU`, `GENERIC_PRODUCT_NAME`, `NON_PRODUCT_LEAKAGE`, `ENGINE_LINE_FAILED`) on structured files intended for pilot.
- Offline regression PASS.
- Production build PASS.
- Browser UAT after deployment.

Scan/image PDFs may remain REVIEW and must not be auto-approved until OCR/vision + human review is implemented.
