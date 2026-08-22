# Phase 9 — Custom Quote Template

## Goal
Allow each dealer/company to make SmartQuote quotes match their preferred visual style without hard-coding a custom PDF for every customer.

## Added

### Preset quote layouts
`src/quoteTemplates.js` defines 5 preset templates:

1. SmartHome Pro
2. Lighting Project
3. Interior Visual
4. Camera / Security
5. Minimal Business

Each preset controls:

- layout type
- primary/accent color
- default visible columns
- industry-specific labels
- intro/validity/payment/warranty terms

### Template editor UI
A new tab was added:

`Mẫu báo giá`

The editor allows each dealer to configure:

- preset layout
- logo URL or uploaded logo image
- logo text fallback
- primary color
- accent color
- font family
- visible PDF columns
- section toggles: summary, labor, terms, signature
- title/column labels
- intro/validity/payment/warranty terms
- live PDF preview

### PDF rendering
`buildQuotePrintHTML()` now reads `company.quoteTemplate` and renders PDF using the dealer's template config.

This means the same quote data can look different per dealer/company.

### Storage
Phase 9 stores the template config inside:

`company.quoteTemplate`

This is already persisted through the existing cloud settings sync in `dealer_app_state.company`, so no database migration is required for Phase 9.

### Tests
Added:

`npm run smoke:quote-template`

This validates:

- all 5 presets exist
- default interior/minimal columns behave correctly
- preset switching preserves company logo
- generated config always includes required columns

## Notes
Phase 9.1 intentionally avoids a full drag-and-drop builder. The current version is enough for pilot customers because it solves the main visual-branding problem without making the app too complex.

Future Phase 9.2 can add:

- reorder columns
- separate templates table
- multiple saved templates per dealer
- upload old quote file and AI suggests matching layout
- Excel export respecting the selected quote template
