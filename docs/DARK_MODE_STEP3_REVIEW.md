# SmartQuote Dark Mode — Step 3 Self Review

## Scope
Implemented only Step 3 from `SmartQuote-DarkMode-Spec.md`: migrate hard-coded UI colors inside `const CSS` to the existing design-token system.

Not included in this step:
- JSX inline `style={{...}}` color migration (Step 4)
- manual modal/table/form/shadow QA and special dark overrides (Step 5)
- final screen-by-screen QA (Step 6)
- any business logic change

## Changes
- Converted white UI surfaces from `#fff/#FFFFFF` to `var(--card)` while preserving white foreground text on primary/dark controls.
- Neutral text migrated to `--ink`, `--ink-2`, `--muted`, `--faint`.
- Neutral surfaces/dividers migrated to `--canvas`, `--surface2`, `--hair`, `--line`.
- Success colors migrated to `--green` / `--green-bg`.
- Warning/orange colors migrated to `--amber` / `--amber-bg` / `--amber-line`.
- Error colors migrated to `--red` / `--red-bg`.
- Blue/indigo/purple UI accents migrated to `--brand` / `--primary-soft` / `--line`.
- Removed legacy CSS variable fallback hex literals where the token is guaranteed by `:root`.
- Removed two light-only RGBA surfaces that would remain bright in dark mode:
  - sub-nav `rgba(255,255,255,.96)` -> `var(--card)`
  - app-shell topbar `rgba(246,247,249,.85)` -> `var(--canvas)`
- Preserved the light and dark `:root` token blocks unchanged.

## Hard-code audit
Before Step 3:
- 553 total hex occurrences in `const CSS`
- 499 hex occurrences outside the two `:root` token blocks

After Step 3:
- 71 total hex occurrences in `const CSS`
- 17 hex occurrences outside the token blocks
- all 17 remaining occurrences are `color:#fff` foregrounds on primary/dark controls and are intentionally retained per spec
- 0 disallowed hard-coded hex UI colors remain outside token declarations

This removes 482 disallowed/replaceable hex occurrences from CSS.

## Scope isolation
A byte-level comparison around the CSS block confirms the prefix and suffix of `src/SmartQuote.jsx` are unchanged. JSX inline colors are intentionally still present for Step 4.

## Automated tests
PASS:
- `dark-mode-step3-css-token-smoke.mjs`
- Dark Mode Step 2 smoke
- Phase 12.5.6 UI spacing/alignment
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
- tenant storage
- white-label scrub

`npm run build` could not execute because the source ZIP does not include installed `node_modules`; shell result is `vite: not found`. This is an environment/dependency absence, not a Vite compile error.

## Accessibility review note
The semantic dark pairs are strong:
- green on green-bg: ~7.97:1
- amber on amber-bg: ~9.60:1
- red on red-bg: ~6.15:1
- ink on card: ~14.19:1
- muted on card: ~5.45:1

One spec-level issue was found: the exact Step 1 values `--primary:#5B76F0` on `--primary-soft:#1E2437` are ~3.89:1, below WCAG AA 4.5:1 for small body text. Step 3 intentionally did not change the provided token table. This should be resolved in the manual accessibility/special-case review before final QA.

## Review result
Step 3 implementation: PASS.
Stop here for user review before Step 4.
