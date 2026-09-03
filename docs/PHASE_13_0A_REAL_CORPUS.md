# Phase 13.0A — Vietnam DocBench real corpus

## Goal

Phase 13.0A turns Phase 13.0/13.0.1 from a synthetic scorer into a benchmark that can be fed real Vietnamese commercial documents without committing customer or supplier files to Git.

Production import/OCR behavior is intentionally unchanged in this phase.

## Privacy boundary

Real documents and labels live under:

```text
benchmarks/vietnam-docbench/private/
```

The directory is ignored by Git except for `.gitkeep`. Never move customer/source documents into fixtures or docs.

Recommended private layout:

```text
private/
  manifest.json
  corpus-summary.json
  files/
  ground-truth/
  predictions-*.json
  reports/
```

## Install a private corpus

Unzip the private corpus package so that `manifest.json` ends up at:

```text
benchmarks/vietnam-docbench/private/manifest.json
```

Then run:

```bash
npm run smoke:phase13.0A
```

or audit an external corpus without copying it into the repo:

```bash
node scripts/phase130a-private-corpus-audit.mjs --manifest /absolute/path/manifest.json
```

## Run an engine result

```bash
npm run bench:phase13 -- \
  --manifest benchmarks/vietnam-docbench/private/manifest.json \
  --predictions benchmarks/vietnam-docbench/private/predictions-current.json \
  --out benchmarks/vietnam-docbench/private/reports/current
```

## Freeze protocol

A corpus is not a frozen benchmark merely because it passes schema validation.

1. Label product rows and explicit false-positive traps from the original document.
2. Check every SKU, quantity and commercial price against the source.
3. Run numeric consistency checks.
4. Have a second reviewer independently inspect the labels.
5. Record hashes of source files and freeze the manifest version.
6. Only then compare OCR/VLM engines.

Do not modify frozen ground truth after seeing an engine score; create a new benchmark version instead.

## First real-corpus learnings

The first private v0.1 draft built from user-supplied Vietnamese documents contains examples of:

- image-only scanned supplier price lists;
- dense two-price-column distributor tables;
- multi-page quotations with subtotals and labor rows;
- matrix BOMs where rows are areas and columns are product types;
- XLSX quotations with merged cells, embedded product images and long specs.

A real Lumi Smarthome scan exposed an important benchmark-vs-production mismatch: the document contains 53 physical commercial product rows under the Phase 13 labeling rule, while the current PDF recovery hint in `pdfCatalogPipeline.js` still assumes about 49 rows. Phase 13.0A records this as an R&D defect; it does not silently change production OCR behavior.
