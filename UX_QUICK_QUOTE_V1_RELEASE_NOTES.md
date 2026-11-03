# SmartQuote — UX Quick Quote v1

**Code base:** RC16.1.1 Golden Fix FULL. This is a focused front-end UX change, not a new pricing policy, database migration or billing release.

## Goal

Make the default quotation form easy to learn: customer → search/add products → quantity/sale price → finish quote. Keep all specialized capabilities under **Tùy chọn nâng cao** or contextual controls.

## Implemented

- Removed the large visible trial/upgrade quota widget *while inside the Quote tab*. Billing and upgrade remain accessible through the Settings tabs; any lock remains enforced by the existing code.
- Put a clear “Tạo báo giá” title and a minimal toolbar above the workflow. Explicit `Lưu nháp` still saves to Cloud; **no auto-save is claimed or added**.
- Customer name shown first; phone, project, address, quote number and section details appear via “Thông tin thêm” or Advanced.
- One search field for product name/SKU, with keyboard navigation, 6 suggestions, and access to existing browse/create product picker.
- Default product table has name, quantity, **editable selling price** and line total. Advanced reveals section notes, list/cost price, line reorder and existing product templates. Price edits call the existing `setLineManualSalePrice` setter, never directly changing Catalog cost.
- Default new quote does not show the Final gate/checklist. Click “Hoàn tất báo giá” to reveal actionable blockers. Successful ready-to-Final quotes follow existing server-side validation/acknowledgement flow.
- Below/at-cost warnings stay visible when relevant; the explicit human acknowledgement, server-side Final, immutable snapshot, revision and Final-only export remain unchanged.
- Excel template selector and explanatory notes moved into Advanced; Excel/PDF export still requires Final.
- Responsive spacing / table scrolling added; dark/light theme tokens remain unchanged.

## Important boundaries

- **Do not represent auto-save as implemented.** Manual cloud save and Final save behavior are unchanged.
- No Supabase SQL files or schema were modified for this UX release. Continue checking existing RC16.1 migration and permissions before opening customer pilots.
- The Advanced option, quote manager and existing importer/cost rules must remain available, not deleted.
- The UX patch is intended for an RC16.1.1 Golden Fix source tree. Do **not** apply it to RC13 directly.

## Validation

Verified here (without project npm dependencies):

- TSX/JSX parser diagnostic count = 0 (using TypeScript 5 parser).
- `smoke:ux-quick-quote-v1`
- `smoke:ux-b3`, `smoke:ux-b4`, `smoke:ux-b5`, `smoke:ux-b6`, `smoke:ux-b7.1`
- `smoke:pilot-p14`, `smoke:pilot-p11`, `smoke:pilot-p12`
- `smoke:flexible-pricing`, `smoke:pilot-p23.11`, `smoke:pilot-p23.12`, `smoke:pilot-p23.13`

**Not validated here:** `npm run build`, `smoke:pilot-p23.14.1`, `smoke:e2e-import`, private golden checks or real browser UAT because `npm ci` could not complete within this environment. Run all release checks on your Mac before push. `smoke:pilot-p12` ran the public fixture while private golden files were absent.

## Suggested 5-minute manual UAT

1. Open a new quote. Confirm only name, search and clean total summary are visible.
2. Select 3 products with search / keyboard, edit quantities and a selling price; confirm total recalculates and Catalog cost remains intact.
3. Type customer, then open Advanced, add a section and a template; switch back to Simple and confirm all rows persist.
4. Click Final with a missing customer to surface blockers. Fill requirements; below-cost sale must require explicit acknowledgement, not silently block.
5. Save/open draft and Final, export Excel/PDF after Final, create revision from Final, and test on mobile/dark theme.
