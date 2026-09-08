# SmartQuote Pilot P1.2 — Golden Corpus + Commercial Regression

P1.2 protects the **paid-pilot workflow**, not only parser functions.

## Two-layer golden model

### Layer A — extraction truth (private)
P1.2 reuses the already frozen Vietnam DocBench v0.1 rather than copying customer files into a second dataset.

Frozen identity:
- 5 real commercial documents
- 156 product rows
- 23 explicit non-product traps
- 2 XLSX, 2 digital PDF, 1 scan PDF
- 2 supplier price lists, 2 old quotations, 1 BOM
- manifest SHA-256 `55c89d74aff86dd484f48e2fc355f58d5d9a462f132856e5e1f8ee2487bae110`

Private sources / labels stay under `benchmarks/vietnam-docbench/private/` and remain gitignored.

### Layer B — commercial truth (public, synthetic-but-business-exact)
`commercial-scenarios.json` freezes five business-critical flows:
1. happy resolved BOM -> markup/fixed pricing -> Final -> immutable reopen -> revision;
2. unresolved BOM blocks before quote;
3. cost-only x1 blocks before quote;
4. below-cost Draft cannot become Final;
5. required camera completeness decision blocks before quote.

This data contains no customer documents. It tests deterministic business correctness after extraction.

## Public smoke

```bash
npm run smoke:pilot-p12
```

This verifies the commercial golden lock, runs all five scenarios and checks the private-corpus identity if it happens to be installed. Missing private files do not fail a public source checkout.

## Required before a paid-pilot release

Install the frozen private Vietnam DocBench package and run:

```bash
npm run golden:pilot:private
```

The command fails unless the exact frozen manifest + freeze lock are present and verify as 5 docs / 156 product rows / 23 traps.

## Native extraction regression baseline

The first time P1.2 is installed on the operator Mac/CI with normal dependencies and the private corpus:

```bash
npm run golden:pilot:baseline:create
```

Creation is deliberately explicit and reviewer-confirmed. It writes `pilot-p12-current-native-baseline.json` next to the private corpus, not into Git.

Every later release:

```bash
npm run golden:pilot:baseline:verify
```

The runner executes the current native SmartQuote adapter against the same frozen private corpus and fails if row precision/recall, SKU/price/quantity accuracy, trusted-row accuracy or grounding regress, or if false-product / unsafe-auto-approve rates worsen.

## Dependency-backed file E2E

```bash
npm run smoke:pilot-p12:file
```

This creates a real XLSX workbook, sends it through the production BOM parser, resolves it to catalog products, prices the quote, snapshots it and requires the Final Quote Gate to pass.

## One paid-pilot release command

After the private baseline exists:

```bash
npm run smoke:pilot-release
```

This includes Vite build, normal pilot regression, P1.2 file E2E, exact private corpus verification, native golden baseline verification and existing BOM/import/PDF smoke.

## Expansion rule

The 5-document Phase 13 corpus is the **seed**, not the finish line. During the first assisted pilots, add new customer-authorized documents only to a new private dataset version. Target 15–20 representative golden documents before calling the workflow broadly mature. Never silently edit v0.1 labels or commit customer files.
