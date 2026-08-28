# SmartQuote Phase 12.5.6 — UI Spacing & Alignment Cleanup

Scope is UI-only. No import, quote, billing, tenant, or lossless Excel behavior is changed.

## Fixes

- Breadcrumb is rendered as explicit segments with a `/` separator and flex gap.
- Billing/plan banner has dedicated name, status, quota, meter, and action groups; text can no longer concatenate visually.
- Topbar plan is rendered as a compact pill with consistent spacing from cloud status and actions.
- Sidebar child navigation uses one fixed left axis, full-width rows, and left-aligned labels.
- Sidebar usage card uses a stable two-column label/value grid.
- Import chooser cards have equal row heights; icon/title/body/CTA use a consistent vertical rhythm and CTA aligns to the bottom.
- Import hero/note wrapping and mobile behavior are normalized.

## Regression rule

`npm run smoke:phase12.5.6` checks the structural wrappers and CSS contracts that prevent text collision/alignment regressions.
