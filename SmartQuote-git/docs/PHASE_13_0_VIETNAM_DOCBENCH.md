# Phase 13.0 — SmartQuote Vietnam Document Intelligence Benchmark

## Purpose

Create a frozen, engine-neutral benchmark before changing OCR/document models. Future engines must win on SmartQuote business outcomes, not on generic OCR leaderboards.

## Benchmark units

1. **Document manifest** — input kind, document type, supplier/industry, difficulty tags, GT pointer.
2. **Ground truth rows** — product identity, pricing, quantity/unit, section, and source grounding.
3. **Prediction contract** — same output shape for current SmartQuote, PaddleOCR-VL, PP-StructureV3, MinerU, or VLMs.
4. **Scoring** — row detection, field accuracy, trust/safety, grounding, and slices.

## Primary metrics

- Product row recall / precision / false-product rate
- SKU exact
- Unit price exact
- Quantity exact
- Product-name token F1
- Trusted-row accuracy
- Auto-approve precision + unsafe auto-approval rate
- Grounding coverage

## Initial release targets

These are R&D targets, not current measured performance:

- Product-row recall >= 98.5%
- Product-row precision >= 99.5%
- SKU exact >= 99.5%
- Unit-price exact >= 99.7%
- Auto-approve precision >= 99.9%
- Unsafe auto-approve rate <= 0.1%
- Grounding coverage >= 98%

The key principle: **SmartQuote does not need to auto-accept everything. What it auto-accepts must be almost never wrong.**

## Privacy / data governance

Real customer documents and labeled ground truth live under `benchmarks/vietnam-docbench/private/` and are excluded from Git. Only synthetic smoke fixtures are committed.

## Phase 13.0 boundary

This phase does **not** replace the OCR engine and does **not** change production import behavior. It builds the measurement system required to make Phase 13.1 model/router decisions objectively.
