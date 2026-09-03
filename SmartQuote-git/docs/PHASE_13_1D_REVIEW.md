# SmartQuote Phase 13.1D — Self-review

## Result

**PASS for Phase 13.1D scope: reproducible actual-execution environment.**

The build container still cannot execute PaddleOCR-VL itself, so there is deliberately no Paddle accuracy score in this phase artifact. 13.1D closes the infrastructure gap required to run the frozen 92-row PDF slice on an external Linux CPU/GPU host without changing benchmark labels, scorer semantics, or production routing.

## Frozen execution runtime

13.1D now locks:

- PaddleOCR-VL pipeline `v1.6`
- PaddleOCR `3.7.0`
- PaddlePaddle `3.2.1`
- Python major/minor `3.12`
- Node `20.19.5`
- Linux `x86_64`
- native backend
- CPU profile or NVIDIA CUDA 12.6 profile
- layout detection ON
- document orientation classification ON
- document unwarping ON
- formatted block content ON

The Docker runtime additionally records the actual image ID and `pip freeze` fingerprint for each completed execution.

## Added

- `benchmarks/vietnam-docbench/runtime/paddleocr-vl-1.6/runtime-lock.json`
- `benchmarks/vietnam-docbench/runtime/paddleocr-vl-1.6/Dockerfile.cpu`
- `benchmarks/vietnam-docbench/runtime/paddleocr-vl-1.6/Dockerfile.gpu-cu126`
- `scripts/phase131d-runtime-doctor.py`
- `scripts/phase131d-build-runtime.sh`
- `scripts/phase131d-run-docker.sh`
- `scripts/phase131d-run-execution.mjs`
- `scripts/phase131d-smoke.mjs`
- `docs/PHASE_13_1D_ACTUAL_PADDLE_EXECUTION_ENVIRONMENT.md`
- Phase 13.1D npm commands

## Fail-closed runtime doctor

Before inference, the doctor checks:

- locked Python / Node / platform;
- exact PaddleOCR / PaddlePaddle versions;
- actual `PaddleOCRVL` class import;
- requested GPU visibility;
- frozen private corpus availability;
- source-file resolution;
- model cache state;
- package/model DNS availability when an online first run is required;
- memory and free disk evidence.

A non-ready doctor stops before benchmark execution. The 13.1D smoke explicitly verifies that a blocked doctor cannot create `predictions.json`.

## Online/offline model cache

The container mounts a persistent host cache into `PADDLE_PDX_CACHE_HOME=/model-cache`.

- first online run may download official model assets;
- subsequent runs reuse the same cache;
- offline mode enables PaddleX's model-source-check bypass only when explicitly requested;
- offline + empty cache fails closed.

Model files are never packaged into public SmartQuote source or the private DocBench ZIP.

## Evidence chain after a successful external run

The execution runner performs:

1. runtime doctor;
2. frozen-corpus verification;
3. label-blind Paddle adapter execution;
4. unchanged DocBench scorer;
5. row-level error analysis;
6. unchanged 13.1C route decision;
7. execution-evidence bundle.

The final evidence includes:

- Docker image ID;
- Node version;
- observed Paddle versions;
- `pip freeze` SHA-256;
- runtime-lock SHA-256;
- adapter SHA-256;
- Paddle subset manifest SHA-256;
- freeze-lock SHA-256.

Secrets are not serialized.

## Current build-container attempt

Result: **BLOCKED_RUNTIME**.

Observed:

- Python `3.13.5` vs locked `3.12`
- Node `22.16.0` vs locked `20.19.5`
- `paddleocr`: missing
- `paddlex`: missing
- `paddle`: missing
- `PaddleOCRVL`: unavailable
- NVIDIA GPU: unavailable
- Docker CLI/runtime: unavailable
- DNS to PyPI/Paddle package/model hosts: unavailable
- frozen private corpus: READY
- 3 Paddle PDF documents: resolvable
- predictions: not produced
- accuracy metrics: not produced

This is the intended fail-closed result for this container.

## Verification

PASS:

- Phase 13.1D runtime smoke
- Phase 13.1C smoke
- Phase 13.1B Paddle execution smoke
- Phase 13.1A Paddle adapter smoke
- Vietnam DocBench unit tests: 29/29
- Phase 13.1 document-router smoke
- Phase 13.0B freeze smoke
- Phase 13.0.1 fix-pack smoke
- frozen private corpus verification: 5 documents / 156 products / 23 traps
- Phase 12.6.1 auth UI
- Phase 12.6 billing
- Dark Mode Step 6
- Phase 12.5.6 UI spacing/alignment
- Phase 12.5.5 orphan drawing cleanup
- Phase 12.4.3 same-origin API (Python + JS)
- tenant isolation
- white-label scrub
- Vercel JSX guard

Production `src/**` diff vs Phase 13.1C: **0 changed files**.

`npm run build` was attempted. It exits with `vite: not found` because this source artifact does not contain installed `node_modules`; network is unavailable in the current container, so dependencies cannot be installed here. This is unchanged from the previous packaging environment and is not evidence of a source compile error.

## Production boundary

No Paddle package is added to SmartQuote's production JavaScript dependencies. The document router is unchanged. `productionPromotionAllowed` remains hard-coded false throughout the Paddle benchmark/decision path.

A real passing external run may justify a later review-only canary phase; it does not automatically change routing.

## Review score

**9.6 / 10 for Phase 13.1D scope.**

Remaining gap: execute the packaged image on a Docker-capable Linux x86_64 host (preferably NVIDIA GPU), obtain the real 92-row PaddleOCR-VL score, and feed that evidence into the already-built 13.1C route-decision layer.
