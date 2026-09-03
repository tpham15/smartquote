# Phase 12.5 — Quote → Template Fill

## Goal
Make the dealer Excel template the normal Excel export path, not a separate secondary action.

## Export contract
1. SmartQuote builds the current quote from in-memory/cloud state (`customer`, `rooms`, products, quantities, sale prices, totals).
2. If an Excel template is selected/default, `Xuất Excel` sends that current quote directly to `/api/excel-template` with `exportMode: lossless_xml_v3`.
3. The lossless engine patches dynamic fields/rows/formulas/images into the immutable dealer workbook package.
4. If the template path fails, SmartQuote fails closed and does **not** silently export the generic workbook.
5. Generic Excel is used only when the dealer has no Excel template at all.

## Multiple templates
`company.defaultExcelQuoteTemplateId` stores the dealer's default template. The quote screen may temporarily choose another template from the selector without creating a second export action.

## UX
There is one `Xuất Excel` button. When a template exists, the quote summary explicitly states which template will be filled.

## Regression
`npm run smoke:phase12.5` verifies the unified frontend path and fills a synthetic quote containing one section and eight products into a lossless XLSX fixture. It asserts product values, formulas, totals, footer preservation and 100% fidelity for static OOXML parts.

## Verification completed
- Phase 12.5 unified export smoke: PASS
- Phase 12.5 dynamic 8-product fill smoke: PASS
- Static OOXML fidelity in fill regression: 100%
- Phase 12 through 12.4.3 regressions: PASS
- White-label, tenant isolation, core import, UX/design-system and Vercel registry smokes: PASS

## Local build note
The source change is JSX-only plus tests/docs. A local Vite production build was not completed in the packaging environment because dependency installation timed out before `vite` was installed. Existing Vercel JSX guard and relevant source/regression tests pass; Vercel should still run its normal `npm install` + `npm run build` on deployment.
