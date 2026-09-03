# SmartQuote — Design System Cleanup

## Scope
Dọn nợ kỹ thuật nhẹ sau SaaS redesign: gộp hai khối `:root` thành một nguồn token duy nhất và loại bỏ font hệ thống cũ ở rule `.app`.

## Changes
- Removed the older B7 token `:root` block.
- Kept a single unified design-system `:root` block based on `SmartQuote_design_system.md` and `smartquote_saas_redesign.html`.
- Preserved legacy aliases such as `--brand`, `--c-primary`, `--radius`, `--pos`, `--neg`, `--warn` so existing UI classes do not break.
- Updated the global `.app` font rule to use `var(--f)` instead of the older system font stack.
- Added `scripts/design-system-cleanup-smoke.mjs` and `npm run smoke:design-system-cleanup`.

## Non-goals
- No changes to `src/import-engine/**`.
- No data logic changes.
- No new localStorage/sessionStorage.

## Local verification
Run:

```bash
npm ci
npm run build
npm run smoke:design-system-cleanup
npm run smoke:design-system
```
