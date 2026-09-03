# SmartQuote Phase 12.5.5 — Orphan Drawing Cleanup

## Problem

Some dealer XLSX templates contain historical product pictures whose drawing anchors sit far below the current product region. Phase 12.5.4 removed pictures by dynamic-region geometry, so a stale picture outside that vertical region could remain visible in the exported quote.

## Fix

Phase 12.5.5 changes historical-picture cleanup to a whitelist model:

- Fresh template analysis builds `staticDrawingWhitelist` from conservative static-picture rules.
- Header pictures such as company logos are preserved.
- Pictures outside the product image/SKU column neighborhood may be preserved as static footer branding/signatures.
- Historical pictures that are not whitelisted are removed regardless of row position.
- Existing `SmartQuote product image ...` pictures from an old export are never auto-whitelisted as template-static content.
- Fresh quote product images are generated after historical cleanup.
- A fail-closed orphan validator rejects the workbook if any visible picture remains that is neither static-whitelisted nor freshly generated.

The cleanup removes drawing anchors, not opaque source media bytes, so untouched XLSX package fidelity remains maximized.

## Regression

`npm run smoke:phase12.5.5`

The regression includes a historical product picture deliberately stranded at row 50, outside the dynamic quote region. It verifies that the picture is removed while a header logo and an identified footer-static picture remain. It also injects an unexpected picture after cleanup to prove that export is rejected by the orphan validator.
