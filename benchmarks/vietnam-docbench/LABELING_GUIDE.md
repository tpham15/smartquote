# Ground-truth labeling guide

The benchmark is only useful if ground truth is stricter than the model being evaluated.

## One physical commercial row = one GT product row

Use the business row visible to a human reviewer. Do not split one physical row into multiple products merely because the row contains variant text. Do not merge separate product rows because names are similar.

## Copy factual values, do not infer silently

- `name`: the product name supported by the document.
- `sku`: exact visible SKU/model. Use `""` when genuinely absent/unreadable in the source; do not invent it from catalog knowledge.
- `unitPrice`: the price column that the benchmark case declares as the commercial price of interest.
- `listPrice`: only when a distinct public/list price is present.
- `quantity`, `lineTotal`: only when present or deterministically represented by the source.
- `section`: nearest valid section/category heading.

## Critical fields

Set `acceptance.criticalFields` per document type:

- Supplier price list: usually `sku`, `unitPrice`; omit `sku` when source truly has none.
- BOM: usually `sku`, `quantity`, and `unitPrice` when price exists.
- Old quote: usually `sku` (if present), `quantity`, `unitPrice`, `lineTotal`.

A predicted row can only be considered safe to auto-approve if every populated critical GT field is correct.

## Grounding

Record the strongest available source location:

- XLSX: `sheet` + physical `row`.
- PDF/photo: `page` + physical row and preferably `bbox`.
- `bbox` should be `[x1,y1,x2,y2]` normalized to 0..1 when practical.

## Non-product rows

You may label headers, subtotals, warranty/payment notes, labor rows, and terms as `kind: "non_product"` when they are likely false-positive traps. They are not required for every document; predicted product rows with no GT product match are already counted as false positives.

## Review protocol for the real benchmark

1. Annotator A labels the document.
2. Annotator B independently checks every product row and every price.
3. Disagreements are resolved against the original document, not against SmartQuote output.
4. Freeze dataset version before comparing engines.
5. Never edit ground truth to make a particular engine score better.

Recommended first corpus: 30–50 real documents, then grow toward 100+ while preserving a frozen holdout split.

## Numeric ambiguity policy

Ground truth should be stored as numeric JSON, not localized numeric strings, whenever a human can determine the value from the document. For predictions and imported fixtures, DocBench policy v1 is field-aware:

- price: `12.345` is interpreted as 12,345 VND;
- quantity: `12.345` is interpreted as decimal 12.345;
- repeated three-digit groups (`1.234.567`) are thousands grouping;
- mixed separators use the last separator as decimal.

If the source itself is genuinely ambiguous, mark the case for human adjudication rather than choosing the interpretation that favors an engine.

## Phase 13.0B frozen-corpus clarifications

These rules were added after the second-pass review of the first real Vietnamese corpus. They clarify source fidelity; they do not change scoring policy `sq-docbench-policy-v1`.

### Merged family labels versus row-specific product names

When a broad family label is merged across several physical rows but another source column contains a row-specific descriptor, label `name` with the row-specific descriptor and keep the broader family/category in `section`. Do not force every variant to share the merged family name.

### XLSX formula cells with cached source values

A formula-backed XLSX cell may have a valid cached value stored in the OOXML package even when an external workbook link cannot be recalculated in the benchmark environment. Ground truth may use that cached value because it is part of the submitted source file. Do not recompute the external link or substitute catalog knowledge. If neither a visible/cached value nor deterministic source representation exists, leave the field unknown.

### Multiple commercial price columns

The manifest must state the field semantics before freeze. For example, a distributor sheet can declare `unitPrice = distributor/NPP price` and `listPrice = retail/list price`. Never choose the column that makes a particular engine score higher.

### Duplicate SKU rows

Keep duplicate SKU rows when the source contains separate physical commercial rows, even if the SKU repeats with a different offer, description, unit, or price. Row identity is physical-source identity, not catalog de-duplication.

## Frozen benchmark change control

Once `freeze-lock.json` has been created, the source files, ground truth, manifest, benchmark policy id, and review metadata are immutable for that benchmark version. Any factual label correction after freeze requires a new benchmark dataset version and a new freeze lock. Do not overwrite a frozen v0.1 result in place.
