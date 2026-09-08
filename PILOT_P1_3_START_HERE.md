# SmartQuote Pilot P1.3 — Digital PDF Column-Aware

P1.3 improves selectable-text / digital PDF reliability without changing Excel or adding OCR/VLM cost.

## What changed

- Detects multiple table regions per page instead of one document-wide table layout.
- Infers columns from real x geometry; STT/header is not required.
- Right-aligned numeric cells are clustered by right edge.
- Unit price / list price / line total are read by column, not by whole-row regex.
- Multiple unlabeled price columns fail safe with `price_column_uncertain`; SmartQuote does not guess dealer price.
- Per-field bbox is retained for name/SKU/price/unit/quantity and price evidence highlights the actual price cell.
- Rows covered by the column path are excluded from legacy heuristic fallback to avoid duplicate/wrong-price competition.
- Legacy heuristic remains for regions where a trustworthy column model cannot be inferred.

## Local gates

```bash
npm ci
npm run build
npm run smoke:pilot-p13
npm run smoke:pilot
```

For a release candidate with the P1.2 private corpus installed:

```bash
npm run smoke:pilot-release
```

## Pilot boundary

- Excel: primary input.
- Digital structured PDF: supported with review gates.
- Ambiguous multi-price PDF: review; no guessed commercial price.
- Scan/image PDF: assisted/review-heavy.
- CAD/DWG/BIM drawing takeoff: not automated.
