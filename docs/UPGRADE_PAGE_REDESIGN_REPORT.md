# SmartQuote — UpgradePage redesign report

## Scope
Applied the uploaded `UpgradePage_redesign_droplin` handoff to the current SmartQuote UX B7.1 codebase.

## Changed
- Replaced the existing `function UpgradePage(...)` in `src/SmartQuote.jsx` with the redesigned "Gói & Sử dụng" component.
- Added `PLAN_TAGLINES` near the plan/navigation constants.
- Appended the provided `.plan-page` / `.pp-*` CSS block to the `CSS` template string.
- Added `scripts/upgrade-page-redesign-smoke.mjs`.
- Added package script `smoke:upgrade-page`.

## UX outcome
- Pricing and monthly usage are shown first.
- Usage appears as progress bars with warning styling at 80%+.
- Payment and billing history are moved into a collapsed `<details>` section.
- Upgrade form opens only inside a modal after clicking a plan card.
- Technical customer-facing copy from the old plan page is removed: `quota + capability`, `client/server`, and `Deterministic-only · 0 AI cost`.

## Tests run in sandbox
Passed:
- `npm run smoke:upgrade-page`
- `npm run smoke:ux-b7.1`
- `npm run smoke:ux-b7`
- `npm run smoke:ux-b6`
- `npm run smoke:ux-b5`
- `npm run smoke:ux-b4`
- `npm run smoke:ux-b3`
- `npm run smoke:ux-b2`
- `npm run smoke:ux-b1`
- `npm run smoke:phase10`
- `npm run smoke:core-review`
- `npm run smoke:plan-limits`
- `tsc --noEmit --allowJs --jsx react --moduleResolution node --target ES2020 --module ESNext --skipLibCheck src/SmartQuote.jsx`

Not completed in sandbox:
- `npm run build` could not run because `vite` is not installed in the sandbox `node_modules` (`sh: 1: vite: not found`). Run `npm ci && npm run build` locally.
