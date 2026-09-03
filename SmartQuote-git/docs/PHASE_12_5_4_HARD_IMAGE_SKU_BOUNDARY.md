# SmartQuote Phase 12.5.4 — Hard Image / SKU Boundary

## Problem

Phase 12.5.3 removed stale image anchors and generated fresh anchors in the image column, but a
picture could still sit visually too close to the SKU column. Cell membership alone was not a
strong enough contract: legacy one-cell/absolute drawings may start outside the image column and
spill into it, and an absolute `ext` can approach the next column even when `from.col` is correct.

## 12.5.4 contract

1. Historical pictures are classified by their **actual sheet-space bounding box**, not only their
   `from` / `to` cell numbers.
2. Every historical picture intersecting the dynamic Image + SKU rectangle is removed before new
   product pictures are written.
3. Product pictures use a fresh `xdr:twoCellAnchor editAs="oneCell"`.
4. Both `from.col` and `to.col` are the image column. Both row markers are the product row.
5. Geometry reserves a large right-side gutter inside the image cell (target ~20–24% of the cell,
   with an 8px+ validator floor).
6. Aspect ratio is preserved inside that hard safe box.
7. Export is **fail-closed**: the final drawing XML is validated before the XLSX is returned. Any
   picture that reaches the SKU hard boundary raises an error instead of downloading a bad quote.

## Runtime report

`report.dynamicMergeNormalization` now contains:

- `version: 4`
- `imageGeometry: hard_cell_boundary_two_marker_v4`
- `imageBoundaryValidation.checked`
- `imageBoundaryValidation.minimumGutterPx`
- `imageBoundaryValidation.requiredGutterPx`
- `imageBoundaryValidation.violations`
- `imageBoundaryValidation.removedHistoricalPictures`
- `imageBoundaryValidation.anchorMode`

The public lossless runtime handshake remains `lossless_xml_v3` / manifest 3 so Phase 12.4.2
production enforcement remains compatible.

## Regression

`npm run smoke:phase12.5.4`

The fixture deliberately adds a pathological picture that starts in column D with a one-cell
absolute extent large enough to visually cross E and F. Phase 12.5.3's cell-index-only cleanup
could miss this class. 12.5.4 must remove it, generate a same-cell two-marker image anchor, maintain
a visible gutter before SKU, and reject a deliberately tampered anchor whose `to` marker is moved
into the SKU column.

Existing Phase 12.4 → 12.5.3, white-label, tenant, runtime-enforcement and same-origin API smoke tests
remain green.
