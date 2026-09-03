# SmartQuote Dark Mode — Step 5 Self Review

Scope: only the special-case review requested by `SmartQuote-DarkMode-Spec.md` section 5. No Step 6 full-screen QA was performed in this phase.

## What changed

1. Modal/backdrop behavior in dark mode
   - `.ci-overlay`, `.modal-backdrop`, `.pp-modal-bg`, `.sq-confirm-backdrop` use `rgba(0,0,0,.6)` only in dark mode.
   - Light-mode backdrop values remain unchanged.

2. Forms
   - Base `input/select/textarea` now use `var(--card)` + `var(--ink)`.
   - Placeholder uses `var(--faint)` as required by the spec.
   - Native `select option` is dark-aware.
   - Checkbox/radio use `accent-color:var(--primary)`.
   - Dark-mode WebKit autofill is forced onto the dark card surface instead of browser-white.
   - Existing higher-specificity component styles such as transparent `.room-name` remain authoritative.

3. Preview/import tables
   - Dark `.ci-preview-table th`: `--primary-d` + white, measured 5.74:1.
   - Dark clean/BOM preview headers: `--green-bg` + `--green`, measured 7.97:1.
   - Generic `.line-table/.cat-table` headers use `--muted` in dark mode instead of `--faint`; measured 5.11:1 on `--surface2`.

4. Semantic rows/status
   - Blocking rows remain `--red-bg`.
   - Review/uncertain rows remain `--amber-bg`.
   - Success badges remain `--green-bg` + `--green`.
   - Contrast checks: amber pair 9.60:1; red pair 6.15:1; green pair 7.97:1.

5. Primary/semantic controls that became low-contrast after token inversion
   - White-label primary controls use `--primary-d` in dark mode (5.74:1 vs white).
   - Warning/danger import actions use semantic dark background + semantic foreground instead of bright semantic fill + white.
   - Sidebar usage upgrade button no longer uses `--ink` as a background in dark mode (which would become almost white).
   - Avatar uses `--green-bg` + `--green` in dark mode.
   - Destructive confirm button uses `--red-bg` + `--red` in dark mode.
   - Disabled primary/confirm buttons retain disabled background despite the dark overrides.

6. Logo
   - SmartQuote mark is CSS gradient `linear-gradient(135deg,var(--primary),var(--primary-d))`; there is no white-background logo asset that needs a dark variant.

7. Shadows
   - Before Step 5: 29 component `box-shadow` declarations used hard-coded `rgba(...)`.
   - After Step 5: 0 hard-coded RGBA component shadows remain outside token definitions.
   - Components now use `--sh-1`, `--sh-2`, `--primary-ring`, `--green-bg`, or `--amber-line` as appropriate.

## Scope guard

Compared with Step 4 baseline, the complete source before `const CSS = \`` is byte-identical. No React state, business logic, import/export, billing, tenant, Excel/PDF, or JSX rendering logic changed.

## Regression results

PASS:
- Dark Mode Step 5 special-case smoke
- Dark Mode Step 4 inline-style smoke
- Dark Mode Step 3 CSS-token smoke
- Dark Mode Step 2 theme toggle smoke
- Phase 12.5.6 spacing/alignment
- UX B1 navigation
- UX B2 import hub
- UX B3 empty state
- UX B4 wording
- UX B5 progressive disclosure
- UX B6 price warning
- UX B7 design tokens
- UX B7.1 fix pack
- Design system refresh
- Design system cleanup
- Phase 12.3 interaction polish
- Phase 12.4.1 Vercel JSX guard
- Tenant isolation
- White-label scrub

Pre-existing test issue, NOT introduced by Step 5:
- `scripts/upgrade-page-redesign-smoke.mjs` reports `missing meter warning CSS` on both the untouched Step 4 baseline and Step 5. This smoke still expects an older CSS signature that was tokenized in an earlier dark-mode step.

Build limitation:
- `npm run build` cannot run from the source ZIP in this environment because dependencies are not installed (`vite: not found`). This is an environment/dependency absence, not a reported compile result.

## Step 5 verdict

PASS for code-level special-case review. Ready for user review. Step 6 full-screen QA has NOT been started.
