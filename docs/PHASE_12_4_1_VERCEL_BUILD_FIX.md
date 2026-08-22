# Phase 12.4.1 — Vercel JSX Build Fix

## Root cause

`src/ui/interaction.js` contains React JSX. Vite 5 performs import analysis on `.js` as JavaScript and failed before the React JSX transform could run.

## Fix

- Renamed `src/ui/interaction.js` to `src/ui/interaction.jsx`.
- Updated `src/SmartQuote.jsx` import.
- Updated the Phase 12.3 interaction smoke test path.
- Added `smoke:phase12.4.1`, which scans `src/**/*.js` and fails if JSX markup is introduced into a `.js` module again.

No interaction behavior or Phase 12.4 Excel logic was changed.
