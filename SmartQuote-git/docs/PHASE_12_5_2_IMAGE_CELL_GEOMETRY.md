# SmartQuote Phase 12.5.2 — Product Image Cell Geometry

## Root cause confirmed from the real exported workbook

Phase 12.5.1 fixed structural Image↔SKU merges, but the real exported workbook showed the cells were already separate:

- header `E = Hình ảnh`, `F = Mã thiết bị`;
- no `E:F` merge on generated product rows;
- product drawing anchors began and ended in column E.

The remaining visual problem came from two different sources:

1. **stale structural mapping** — templates saved by older phases could keep an old `templateRow`, overriding the newly improved analyzer on every export;
2. **historical drawing geometry reuse** — images copied a fixed template rectangle instead of fitting their own aspect ratio inside the target cell.

A wide source image could therefore be stretched into a nearly square frame and visually feel attached to the SKU cell even though the OOXML cells were technically separate.

## Fix

### Fresh structure by default

Every lossless export re-analyzes structural rows from the immutable source workbook. Old saved `startRow/templateRow/clearUntilRow` values are ignored unless the mapping is explicitly marked:

```json
{"structureMode":"manual_v2"}
```

The current UI adds this marker only when a dealer manually edits structural row mapping.

### Representative body row

The analyzer no longer selects the first clean historical product row blindly. It selects a clean row whose height is closest to the median clean product-row height, avoiding one-off 200+ point image rows.

### Image safe box

Each dynamic product image now gets fresh geometry:

- locked to the header-defined image column;
- locked to the target product row;
- aspect ratio preserved;
- centered in the cell;
- visible left/right padding retained before the SKU boundary;
- max image frame capped for stable Excel rendering;
- `editAs="oneCell"`.

No historical image offsets are reused.

## Regression

Run:

```bash
npm run smoke:phase12.5.2
```

The fixture deliberately supplies:

- a stale mapping pointing to a 220pt body row;
- a 4:1 product image;
- adjacent image/SKU columns E/F.

The test verifies fresh 58pt body style selection, separate SKU content, same-column image anchor, safe gutter, preserved ~4:1 aspect ratio, and 100% static OOXML fidelity.
