# Phase 14.0 — Section Schema Drift / Catalog Identity Fix

## Problem class

Some quotation workbooks change column semantics inside a later section while keeping the same sheet-level header. Typical examples:

- a group/subtotal row carries only a line total and is mistaken for a product;
- the normal `Tên hàng hoá` column contains a model/SKU in one section;
- the normal `Mã thiết bị` column contains warranty text such as `BH 36 tháng`;
- the real product name moves to the specification column;
- the same catalog identity appears in several rooms/areas;
- numeric-looking specification text such as `1.267Gbps` contaminates a manually mapped price.

These are structural import errors, not OCR errors.

## Fix

1. Quote-table group/subtotal rows with a line total but no product identity, quantity or unit price are hard boundaries and never catalog products.
2. When the mapped SKU cell is warranty-only but the mapped name cell is a real SKU/model, SmartQuote recovers the identity and derives the display name from the descriptive specification prefix.
3. Catalog preview deduplicates repeated occurrences by stable SKU identity (supplier + normalized name only when SKU is absent).
4. Conflicting prices for the same identity are never silently accepted: the merged identity is forced to review with `duplicate_identity_price_conflict`.
5. Manual mapping uses the same schema-recovery and dedupe contract as automatic import.
6. Explicitly mapped price cells are parsed before row-wide fallback text so specification numbers cannot override a valid unit price.

## Regression coverage

`npm run smoke:phase14.0:section-drift` uses synthetic data only and verifies:

- aggregate group headers produce zero products;
- section-level SKU/name drift is recovered;
- repeated room/area occurrences collapse to one catalog identity;
- warranty text remains specification metadata;
- manual mapping and automatic mapping agree;
- numeric specification text does not contaminate the mapped unit price;
- conflicting duplicate prices force manual review.

The regression is included in the aggregate `smoke:phase14.0` command.

## Pilot acceptance target for this class

- false group/subtotal products: 0;
- lost identities caused by section schema drift: 0;
- silent conflicting duplicate prices: 0;
- automatic and manual mapping produce the same identity set.
