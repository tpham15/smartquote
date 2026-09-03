# Phase 13.0.1 — Vietnam DocBench FixPack

## Accepted review findings fixed now

1. **Adapter non-product bug** — removed the tautological `product : product` mapping. Canonical skipped/header/note/subtotal/terms rows and unknown explicit non-product kinds now emit `kind: non_product`; legacy kind-less rows require product evidence to remain product.
2. **Field-aware numeric parsing** — price and quantity no longer share the ambiguous `12.345` interpretation.
3. **Strict + within-rounding price reporting** — exact remains strict; a diagnostic ±1,000 VND metric is reported separately.
4. **Frozen match policy** — threshold and weights moved to `sq-docbench-policy-v1`; every manifest must pin the policy id.
5. **Unit tests** — Node `node:test` coverage added for numeric parsing, `normalizeUnit`, `tokenF1`, adapter classification, `pairAffinity`, row alignment, and strict-vs-rounding price metrics.
6. **CORS default closed** — cross-origin access is denied when no allowlist is configured; same-origin app/API calls remain allowed. Explicit `*` remains possible only when deliberately configured (e.g. local/dev).

## Deliberately deferred

### SmartQuote.jsx modularization

Confirmed as repo-wide architecture debt, not a DocBench correctness fix. It should be a separately reviewed refactor so import/quote/catalog/billing behavior can be frozen with regression tests before files move.

### SheetJS/xlsx upgrade

Confirmed current dependency is `xlsx ^0.18.5`, but no blind upgrade is included here. SmartQuote has lossless Excel/template behavior whose regression surface is large. Dependency/advisory verification and a migration matrix belong in a dedicated security phase.

## Benchmark invariants

- Changing match weights/thresholds/numeric rules/rounding tolerance requires a new benchmark policy id.
- `exact` price correctness remains zero-tolerance.
- `withinRoundingRate` is diagnostic only and must not hide an exact-price regression.
- Customer/private benchmark material remains gitignored.
