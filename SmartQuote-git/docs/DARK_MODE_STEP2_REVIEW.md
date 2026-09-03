# SmartQuote Dark Mode — Step 2 Self Review

## Scope implemented

Only Step 2 of the dark-mode spec was implemented on top of Step 1:

1. Early theme bootstrap in `index.html` before the React bundle.
2. Reads `localStorage['sq_theme']`.
3. Falls back to `prefers-color-scheme: dark` when no preference is saved.
4. Sets `data-theme` on `<html>` before React renders.
5. Adds minimal dark boot background/text so the loading screen does not flash light before the runtime CSS is injected.
6. Adds React `theme` state, persistence effect, and `toggleTheme` handler in the root `SmartQuote` component.
7. Adds the Light/Dark toggle at the bottom of `.rail`.
8. Moves the existing cloud logout action beside the theme toggle in the sidebar footer; the old topbar logout is removed to avoid duplicate actions.
9. Adds responsive behavior: labels collapse at <=1080px; theme/logout actions remain reachable at <=640px.

## Explicitly NOT implemented yet

- No bulk hard-coded color migration.
- No JSX inline-color cleanup.
- No modal/table/input special-case cleanup.
- No business logic changes.
- No final dark-mode visual QA claim yet; many hard-coded light colors intentionally remain until Steps 3–5.

## Self-review findings

### Initialization / no-flash
PASS.

The bootstrap script is before `/src/main.jsx`, so theme selection happens before the app bundle runs. Because SmartQuote injects the main CSS from React, Step 2 also includes a minimal early dark background (`#0E1116`) and boot text (`#8A90A0`) to prevent the initial loading screen from flashing white.

### Persistence
PASS.

The React effect updates `<html data-theme>` and saves `sq_theme` whenever the user toggles the theme.

### Sidebar placement
PASS.

The toggle is at the bottom of `.rail`. In cloud mode the existing logout action now sits in the same footer group. The previous topbar logout was removed rather than duplicated.

### Accessibility
PASS for Step 2 controls.

The toggle has dynamic `aria-label` values (`Chuyển sáng` / `Chuyển tối`) and a title. Logout also has an aria label/title. Both remain keyboard buttons and use the existing focus-visible system.

### Responsive behavior
PASS by structural smoke test.

At <=1080px action labels are hidden and buttons become compact 40x40 controls. At <=640px the footer actions become a horizontal group and remain reachable in the horizontal rail.

### Scope discipline
PASS.

The only removed hard-coded UI colors are the now-dead `.cloud-logout` rules after the logout action was relocated. Step 3 hard-coded color migration has not started.

## Regression tests

PASS:

- `npm run smoke:dark-mode-step2`
- `node scripts/phase1256-ui-spacing-alignment-smoke.mjs`
- `node scripts/ux-b1-nav-smoke.mjs`
- `node scripts/ux-b7-design-tokens-smoke.mjs`
- `node scripts/design-system-refresh-smoke.mjs`
- `node scripts/design-system-cleanup-smoke.mjs`
- `node scripts/phase123-interaction-polish-smoke.mjs`
- `node scripts/phase1241-vercel-jsx-guard-smoke.mjs`
- `node scripts/tenant-storage-smoke.mjs`

Production build was attempted but the provided source ZIP does not include installed `node_modules`; therefore `npm run build` stops with `vite: not found`. No dependency installation was attempted in this review step.

## Review decision

**Step 2: PASS, ready for user review.**

Do not start Step 3 until the user approves this step.
