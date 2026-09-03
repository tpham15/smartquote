# Phase 13.1E — Remote Paddle execution evidence trust boundary

## Goal

Turn a PaddleOCR-VL run performed on an external Docker/GPU host into evidence SmartQuote can safely trust **without trusting the remote machine's reported score or routing decision**.

Phase 13.1E does not add PaddleOCR-VL to production routing. It closes the provenance gap between Phase 13.1D's reproducible runtime and a later explicit review-only canary phase.

## Why this phase exists

Phase 13.1D can execute the frozen 92-row PDF slice on a compatible host, but copying back a `report.json` is not sufficient evidence. A remote file can be incomplete, accidentally mixed with another corpus/runtime, or modified after execution.

13.1E therefore treats the remote host as an untrusted transport boundary:

1. run 13.1D on the external host;
2. copy all execution artifacts into an immutable-style evidence bundle;
3. SHA-256 every file and seal an inventory;
4. import the bundle next to the original private frozen corpus;
5. verify the runtime/corpus/adapter identity against local files;
6. re-score imported predictions locally with the frozen scorer and local ground truth;
7. replay row-level error analysis locally;
8. recompute the 13.1C route decision locally;
9. issue a canary handoff only if all evidence checks pass.

The remote `report.json`, `error-analysis.json`, and `route-decision.json` are therefore **claims to verify**, not trusted inputs.

## Added

- `benchmarks/vietnam-docbench/evidence-provenance.mjs`
- `scripts/phase131e-run-remote-host.sh`
- `scripts/phase131e-seal-evidence.mjs`
- `scripts/phase131e-export-evidence.sh`
- `scripts/phase131e-verify-evidence.mjs`
- `scripts/phase131e-smoke.mjs`
- this document

## Remote GPU flow

On a Docker-capable Linux x86_64 host with NVIDIA GPU:

```bash
npm run bench:phase13.1E:remote -- /absolute/path/to/private-corpus gpu-cu126 online
```

This delegates actual inference to the locked 13.1D runtime, then seals the completed 13.1D report directory into:

```text
<private-corpus>/reports/phase13.1E-evidence-bundle/
```

To make one transport file:

```bash
npm run bench:phase13.1E:export -- /absolute/path/to/private-corpus
```

The resulting `.tar.gz` remains **private benchmark evidence** and must not be committed to Git.

## Import verification

After copying/extracting the evidence bundle onto a trusted machine that also has the original frozen private corpus:

```bash
npm run bench:phase13.1E:verify -- \
  --evidence-dir /path/to/phase13.1E-evidence-bundle \
  --private-root /path/to/private-corpus
```

Verification checks:

- every sealed file exists;
- byte size and SHA-256 match the sealed inventory;
- no unlisted artifact file was inserted;
- local runtime-lock hash matches the execution evidence;
- local Paddle adapter hash matches;
- local Paddle subset manifest hash matches;
- local freeze-lock hash matches;
- for `EXECUTED` evidence, predictions are re-scored locally;
- imported score report semantically equals the local re-score;
- error analysis is regenerated locally and compared;
- route decision is regenerated locally and compared.

`generatedAt` timestamps are ignored for semantic replay comparisons; metrics, rows, decisions, gates and all other content remain comparison-sensitive.

## Trust states

### `TRUSTED_EXECUTED`

The bundle is intact, identity hashes match local frozen inputs, and score/error/decision replay all match.

### `TRUSTED_NONEXECUTED`

The bundle is intact and identity-valid but contains no completed inference. It may be useful diagnostic evidence but can never create a canary handoff.

### `REJECTED`

Any integrity, identity, re-score, analysis or decision mismatch rejects the bundle.

## Canary handoff

13.1E writes `canary-handoff.json` only as a design handoff.

`READY_FOR_EXPLICIT_CANARY_DESIGN` requires both:

- `TRUSTED_EXECUTED`; and
- a locally replayed 13.1C decision of `SCAN_REVIEW_CANARY_ELIGIBLE`, `DIGITAL_REVIEW_CANARY_ELIGIBLE`, or `REVIEW_FALLBACK_CANDIDATE`.

Even then:

```text
productionPromotionAllowed = false
autoApprovalAllowed = false
humanReviewRequired = true
productionRoutingChanged = false
```

A later explicit phase is required to design and gate a production canary.

## Tamper test

The 13.1E smoke creates a valid executed benchmark fixture, seals it, verifies it, and confirms deterministic re-score/error/decision replay. It then appends one byte to `predictions.json` after sealing and confirms the evidence is rejected.

This tests the trust boundary rather than only the happy path.
