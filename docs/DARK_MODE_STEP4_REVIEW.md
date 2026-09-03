# SmartQuote Dark Mode — Step 4 Self Review

## Scope

Step 4 only: migrate hard-coded UI colors inside JSX inline `style={{...}}` objects to existing design tokens.

Not included in this step:
- modal/backdrop special-case tuning,
- form/input/placeholder manual tuning,
- table semantic-row manual tuning,
- hard-coded shadow cleanup,
- final screen-by-screen dark QA,
- any business logic,
- any Excel/PDF/print/export document colors,
- dealer brand color defaults.

## Changes

Six UI inline color literals were migrated:

1. unmatched BOM reason `#888` → `var(--muted)`
2. ignored-row text `#aaa` → `var(--faint)`
3. ignored-row chip background `#f1f5f9` → `var(--surface2)`
4. import-preview image background `#fff` → `var(--card)`
5. edit-preview image background `#fff` → `var(--card)`
6. enrichment image background `#fff` → `var(--card)`

## Scope protection

The remaining hex values before `const CSS` are intentionally outside JSX inline UI styling. They include:
- dealer/quote-template brand color defaults (`#1A7A4A`, `#D1FAE5`),
- printable/export HTML document styling.

Those values are deliberately preserved because the Dark Mode spec says not to alter Excel/PDF/export-file colors.

The Step 3 smoke test was adjusted only to remove its old "inline color must still exist" scope guard. Step 3 now validates only its own `const CSS` responsibility, while Step 4 owns inline-style validation.

## Acceptance criteria

- No hex/rgb/hsl literal remains inside any `style={{...}}` UI object.
- Required replacements use existing dark-aware variables.
- Print/export and dealer brand defaults are unchanged.
- Step 2 and Step 3 dark-mode tests continue to pass.
- Existing navigation/design/spacing/tenant/white-label regressions continue to pass.

## Automated review results

- Inline `style={{...}}` objects scanned: **142**
- Hard-coded hex/rgb/hsl literals remaining inside inline style objects: **0**
- Remaining hex literals before `const CSS`: **30**, all intentionally limited to dealer/template brand defaults and printable/export HTML styling; none are React inline UI styles.

Regression PASS:
- Dark Mode Step 4 inline-style smoke
- Dark Mode Step 3 CSS-token smoke
- Dark Mode Step 2 init/state/toggle smoke
- Phase 12.5.6 UI spacing/alignment
- UX B1 navigation
- UX B2 import hub
- UX B7 / B7.1 design tokens
- Design system refresh / cleanup
- Phase 12.3 interaction polish
- Phase 12.4.1 Vercel JSX guard
- Tenant storage isolation
- White-label scrub

## Production build note

The baseline ZIP does not ship with `node_modules`. An attempt to run `npm ci` timed out in the execution environment, so a full Vite production build could not be completed here. No partially installed `node_modules` is included in the deliverable. The existing Vercel JSX guard and source-level regression tests pass.

## Self-review verdict

**PASS for Step 4 scope.** No business logic changed. The source-code diff in `src/SmartQuote.jsx` is exactly six color-literal replacements and nothing else.
