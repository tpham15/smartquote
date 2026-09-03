# SmartQuote Phase 14.0 — Pilot Reliability

## Why this phase exists

Phase 13.x is frozen. Phase 14.0 deliberately stops OCR/model R&D and ships reliability features that help a real user verify and correct imports today.

North star: messy commercial documents -> trustworthy product / price / quotation data. The moat is created by customer corrections, supplier mapping and price history, not by owning an OCR model.

## Scope

### 1. Deterministic business validator

New module: `src/import-engine/businessValidator.js`.

Runs after extraction and independently from AI/OCR confidence.

Catalog checks shipped in the importer:

- dealer/cost price must not exceed retail/list price;
- duplicate SKU inside one import is blocked;
- price change versus the existing catalog is flagged at >=35% and blocked at >=100%;
- errors/warnings become normal preview issues and participate in the existing review gate.

Reusable math checks are also provided for imported quotation-like data:

- `qty × unitPrice = lineTotal`;
- sum of lines = subtotal;
- VAT amount matches subtotal × VAT rate;
- subtotal + VAT = total.

The current QuoteBuilder computes its own line totals/subtotals deterministically, so these math rules are primarily for imported quotation/BOM data rather than for values already generated inside QuoteBuilder.

### 2. PDF false-product reduction using positive evidence

New pure helper: `src/import-engine/pdf/pdfEvidence.js`.

The heuristic PDF path no longer treats a plausible price by itself as sufficient product evidence. It scores positive signals:

- valid commercial price;
- clear SKU/model;
- product-like name/context;
- grounded row location;
- explicit unit;
- useful section/category.

Low-evidence heuristic rows are marked `skipped` with `pdf_insufficient_product_evidence`. Medium evidence remains `need_review`; strong evidence can retain the existing auto-approved path.

This is not a new OCR engine and does not change Document Router routing.

### 3. Click-to-verify grounding

`/api/pdf-extract` now returns additive geometry:

- page width/height;
- row bbox;
- text-part x/width/height.

The PDF pipeline carries these fields through `_meta.source` -> `ImportPreviewResult.line.source`.

In the catalog preview, clicking an imported price opens the original local PDF page and highlights the exact price text part when coordinates exist. When an image/scan has no selectable-text bbox, SmartQuote still opens the correct page and explicitly labels the evidence as page-level only.

The Phase 14 PDF cache namespace is bumped to `v14_grounding` so old cached rows without evidence do not silently bypass grounding.

### 4. Correction evidence

New module: `src/import-engine/correctionTelemetry.js`.

Existing correction learning stores the learned final rule. Phase 14 additionally stores append-only evidence for user actions:

- edit;
- approve;
- bulk approve;
- delete.

Each event contains:

- before/after product fields;
- file/import/line identity;
- source page/sheet/row/raw text;
- bbox when available;
- issues present before the correction.

Phase 14 storage remains tenant-scoped browser storage. It is intentionally **not uploaded to a new backend** in this pilot phase. Cloud synchronization/consent is a later product decision after real usage proves the data is valuable.

## Pilot gate

Do not open another large R&D phase just because Phase 14 code is complete.

Target before the next architecture phase:

- >= 5 real companies using the importer;
- >= 30 real commercial documents imported;
- >= 10 quotations produced from imported data;
- correction/delete evidence reviewed manually;
- user complaints categorized into extraction quality vs UX/workflow/missing feature.

Reopen OCR/engine work only if real usage shows extraction quality is a material bottleneck (lost deals, high review time, or a large scan-PDF share).

## Pilot metrics to record

For each company/session, record:

- documents imported;
- source type (Excel / digital PDF / scan PDF);
- parsed rows / skipped rows / review rows;
- number of corrections and deletes;
- severe business-validator issues;
- approximate review time per document;
- quote created from the imported catalog: yes/no;
- reason the user abandoned or rejected an import.

The first pilot question is not “is OCR 99%?” It is “can a user get from supplier file to a trusted quote fast enough to keep using SmartQuote?”
