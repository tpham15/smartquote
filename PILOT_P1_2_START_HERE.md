# SmartQuote Pilot P1.2 — START HERE

## Scope completed

P1.2 adds **Golden Corpus + end-to-end commercial regression**. It intentionally does not add product features or change PDF routing.

### What is now protected
- frozen commercial truth for BOM -> pricing -> quote -> Final -> reopen -> revision;
- explicit regressions for unresolved BOM, x1 cost-only pricing, required completeness and below-cost Final;
- immutable commercial scenario hashes;
- exact reuse of the Phase 13 private Vietnam DocBench identity;
- optional-but-required-for-release private native extraction baseline;
- real XLSX -> production BOM parser -> Final Quote E2E when dependencies are installed.

## Fast test (no private data required)

```bash
npm run smoke:pilot-p12
npm run smoke:pilot-p11
npm run smoke:pilot-p0
npm run smoke:phase15
```

## One-time private baseline initialization

Use the already-frozen Phase 13 private corpus. Put it at:

`benchmarks/vietnam-docbench/private/`

It must contain the exact v0.1 `manifest.json`, `freeze-lock.json`, source files and ground truth.

Then on Node 22 with normal `npm ci` dependencies:

```bash
npm run golden:pilot:private
npm run golden:pilot:baseline:create
```

Do not create a baseline from a corpus that has not passed `golden:pilot:private`.

## Every paid-pilot release

```bash
node -v
npm ci
npm run smoke:pilot-release
```

If any command fails, do not deploy that commit to pilot customers.

## Privacy

- Customer source documents are never copied into the GitHub-ready ZIP.
- P1.2 private baselines/reports are gitignored.
- The public commercial scenarios are synthetic and contain no customer names/data.

## Current evidence boundary

The public P1.2 commercial regression can be fully executed without `node_modules`. The dependency-backed XLSX E2E, Vite build and current-native run against the real private corpus require a normal project install on the operator Mac/CI.
