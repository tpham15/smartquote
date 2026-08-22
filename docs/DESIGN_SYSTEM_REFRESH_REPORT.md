# SmartQuote — Design System Refresh Report

## Scope
Applied the SaaS design-system document and the senior UI HTML reference to the existing SmartQuote UI layer.

## Changed
- Added Be Vietnam Pro loading in `index.html`.
- Added new functional tokens and legacy aliases in `src/SmartQuote.jsx` CSS.
- Changed the outer app shell from horizontal top tabs into a left sidebar + sticky topbar.
- Added compact sidebar usage card with two progress bars and upgrade CTA.
- Preserved the 4 primary tabs and sub-nav introduced by the previous UX restructure.
- Restyled quote screen around a two-column layout with sticky quote total panel.
- Added tabular number styling and focus ring rules.
- Added smoke script `smoke:design-system`.

## Guardrails
- Did not edit `src/import-engine/**`.
- Did not add sessionStorage/localStorage for the redesign.
- Did not rewrite data, billing, cloud, import, or quote calculation logic.

## Tests run in sandbox
- `tsc --noEmit --allowJs --jsx react --moduleResolution node --target ES2020 --module ESNext --skipLibCheck src/SmartQuote.jsx`
- `npm run smoke:design-system`
- Existing UX/plan/import smoke tests listed in the assistant response.

## Build note
Full `npm run build` depends on Vite in `node_modules`. In the sandbox this may still fail if dependencies are unavailable. Run `npm ci && npm run build` locally before deploy.
