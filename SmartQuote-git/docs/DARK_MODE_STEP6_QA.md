# SmartQuote Dark Mode — Step 6 QA / Acceptance Review

Scope: Step 6 only, following the acceptance checklist in `SmartQuote-DarkMode-Spec.md`. This phase performs final dark-mode QA and fixes dark-mode issues found by QA. No business logic changes are allowed.

## QA finding fixed in Step 6

The Step 1 token values exposed an accessibility conflict during final QA:

- `--primary:#5B76F0` on `--primary-soft:#1E2437` = ~3.89:1, below the spec's WCAG AA 4.5:1 target for body text.
- `--faint:#6A7080` on `--card:#171A21` = ~3.52:1. The codebase uses `--faint` for some small textual labels/headers and placeholders, not decorative icons only.
- Several text selectors used `--primary-d:#4359D8` as foreground in dark mode; that token is intentionally dark enough to be a button fill with white text, so it is not suitable as dark-surface foreground text.

Final QA fix:

- Dark `--primary` / `--brand`: `#5B76F0` → `#6A83F5`.
- Dark `--primary-ring` follows the revised primary RGB.
- Dark `--faint`: `#6A7080` → `#82899A`.
- `--primary-d:#4359D8` remains unchanged and is still used for dark primary button fills.
- Dark-mode text that previously used `--primary-d` is promoted to `--primary` for nav active text, solution-family helper text, Excel detection summary and trial status.

This is a QA/accessibility correction, not a business-logic change. Hue and the visual hierarchy remain consistent with the spec.

## Final contrast measurements

| Pair | Ratio | Result |
|---|---:|---|
| ink / card | 14.19:1 | PASS |
| ink / canvas | 15.42:1 | PASS |
| ink-2 / card | 8.85:1 | PASS |
| muted / card | 5.45:1 | PASS |
| faint / card | 4.97:1 | PASS |
| faint / surface2 | 4.65:1 | PASS |
| primary / card | 5.12:1 | PASS |
| primary / surface2 | 4.80:1 | PASS |
| primary / primary-soft | 4.53:1 | PASS |
| primary / rail | 5.38:1 | PASS |
| green / green-bg | 7.97:1 | PASS |
| amber / amber-bg | 9.60:1 | PASS |
| red / red-bg | 6.15:1 | PASS |
| white / primary-d button fill | 5.74:1 | PASS |

## Acceptance checklist

### Sidebar
PASS (code/static QA)
- Rail uses `--rail` and `--line`.
- Active item uses dark-safe foreground.
- Active SVG remains primary-accented.
- Theme toggle remains in rail footer.

### Báo giá / onboarding
PASS (code/static QA)
- Main surface uses `--canvas`.
- Cards use `--card`.
- Empty/onboarding elements use tokenized primary/semantic surfaces.
- Primary buttons use `--primary-d` in dark mode with white text.

### Danh mục — empty + data
PASS (code/static QA)
- Product table surfaces, lines and text use tokens.
- Table headers use dark-readable foreground.
- No literal white CSS background remains.

### Import preview modal
PASS (code/static QA)
- Dark overlay is `rgba(0,0,0,.6)`.
- Primary preview header is dark-safe.
- Clean/BOM headers use green semantic pair.
- Warning/error/success semantic pairs all exceed 4.5:1.

### Cài đặt
PASS (code/static QA)
- Input/select/textarea use `--card`, `--ink`, `--line`.
- Placeholder/faint text now exceeds 4.5:1 on card/surface2.
- Native options and autofill are dark-aware.

### Mẫu & Gói
PASS (code/static QA)
- Cards/empty states are tokenized.
- Primary-soft text is now AA-safe after Step 6 token correction.

### Mobile 390px
PASS (responsive-rule QA)
- `@media(max-width:640px)` switches shell to one column.
- Rail becomes horizontal.
- Theme/logout controls remain visible as 40×40 icon buttons.
- Main content uses compact 14px padding.
- No literal white UI background was found by the Step 6 scan.

### Light ↔ dark switching
PASS (logic simulation + source QA)
- Toggle changes React `theme` state.
- Effect writes `data-theme` and persists `sq_theme`.

### Reload while dark / no white flash
PASS (bootstrap simulation)
- The inline head script runs before `/src/main.jsx`.
- Saved dark/light wins over system preference.
- With no saved setting, `prefers-color-scheme` is respected.
- Boot dark background is `#0E1116` before React loads.

### No remaining white panels
PASS (static scan)
- No `background:#fff/#FFFFFF/white` remains in the UI CSS.
- No `background:rgba(255,255,255,...)` remains in UI CSS.
- Step 4 already reduced inline JSX color literals to zero.

## Automated regression

PASS:
- Dark Mode Step 2
- Dark Mode Step 3
- Dark Mode Step 4
- Dark Mode Step 5
- Dark Mode Step 6 QA smoke
- Phase 12.5.6 spacing/alignment
- UX B1–B7.1 checks used in the previous phases
- Design system refresh + cleanup
- Phase 12.3 interaction polish
- Phase 12.4.1 Vercel JSX guard
- Tenant isolation
- White-label scrub
- Phase 12.5 quote→template fill
- Phase 12.5.1 dynamic merge normalization
- Phase 12.5.2 image geometry
- Phase 12.5.3 fresh anchors
- Phase 12.5.4 hard image/SKU boundary
- Phase 12.5.5 orphan drawing cleanup

Excel regression retained 100% static fidelity in the existing Phase 12.5 smoke chain.

## Scope guard

The complete `src/SmartQuote.jsx` source before `const CSS = \`` is byte-identical to the Step 5 baseline. Step 6 changed only dark-mode CSS tokens/foreground overrides and added QA artifacts. No React state, billing, tenant, import/export, quote, catalog, Excel or PDF business logic changed.

## Runtime build limitation

A full Vite production build and browser screenshot pass could not be executed in this environment. `npm ci` timed out online; `npm ci --offline` confirmed one package tarball (`yallist-3.1.1`) is not cached. Therefore this review does not claim pixel-level browser rendering. The code/static acceptance checks and existing regression suite pass; final deployed visual inspection should still be done by the user in the target browser.

## Verdict

Step 6 code-level acceptance: PASS.
Dark Mode Steps 1–6 are complete and ready for user review/deployment visual verification.
