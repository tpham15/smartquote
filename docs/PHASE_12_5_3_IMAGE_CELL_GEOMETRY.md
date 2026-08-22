# SmartQuote Phase 12.5.3 — Fresh One-Cell Image Anchors

## Why 12.5.3 exists

The exported workbook showed that Image and SKU cells were already separate. The remaining defect came from the **drawing anchor**, not from worksheet merges: legacy product pictures could carry stale `rowOff`/`colOff` values from the dealer's original workbook. A picture could therefore be anchored to the correct column but still render as if it belonged to an adjacent cell or section row.

## New rule

SmartQuote no longer clones a historical picture anchor for generated product images.

For every quote product image the engine now:

1. finds a picture **shape** only (not its old anchor geometry),
2. removes all generated/product-region picture anchors,
3. calculates the target Image cell from the detected header schema,
4. calculates fresh padding + aspect-fit dimensions from the actual target row/column,
5. creates a brand-new `xdr:oneCellAnchor`,
6. updates the picture's internal DrawingML transform to the same dimensions,
7. removes any stale external image relationship from the cloned picture shape.

This means historical coordinates cannot leak into the new quote.

## Result

For the standard template used in regression:

- Image column = E
- SKU column = F
- generated image anchor = `oneCellAnchor`
- product row is the actual generated product row
- no generated image anchor spans into F
- image aspect ratio is preserved
- visual gutter remains before SKU
- static OOXML fidelity remains 100%

## Regression

`python3 scripts/phase1253-image-geometry-smoke.py`

PASS: 8 product images use fresh one-cell anchors in column E and no stale section-row anchors remain.

The older 12.5.2 geometry smoke was updated to accept the stricter one-cell anchor contract and also passes.
