# Phase 13.1F — PaddleOCR Official API Benchmark

## Goal

Obtain a real PaddleOCR-VL-1.6 Vietnam DocBench result **without requiring the SmartQuote operator to own a GPU**.

13.1F uses PaddleOCR's hosted official API only as an inference backend. SmartQuote keeps the frozen labels, scoring, error analysis and route decision local and unchanged.

## Frozen scope

- Backend: `paddleocr-official-api`
- Task: `doc_parsing`
- Model: `PaddleOCR-VL-1.6`
- Frozen slice: 3 PDFs / 92 product rows / 8 non-product traps
- Production routing: unchanged
- Auto approval: forbidden; all normalized rows remain `need_review`

## Important privacy boundary

The official API uploads the benchmark PDFs to a hosted PaddleOCR service. 13.1F therefore refuses to execute unless the operator explicitly sets:

```bash
export SQ_PADDLEOCR_OFFICIAL_API_ACK_UPLOAD=YES
```

This acknowledgement is intentionally separate from the API token. Do not use hosted execution for documents that you are not authorized to send to an external service.

## Setup

```bash
npm run setup:phase13.1F:paddle-api
```

This creates `.venv_paddleocr_api` and installs the pinned PaddleOCR 3.7.0 client. No PaddlePaddle/GPU runtime is required because inference happens remotely.

Obtain an AI Studio access token and set it only in the shell:

```bash
export PADDLEOCR_ACCESS_TOKEN="..."
export SQ_PADDLEOCR_OFFICIAL_API_ACK_UPLOAD=YES
```

The token value is never serialized into benchmark evidence.

## Doctor

```bash
npm run doctor:phase13.1F:paddle-api
```

The doctor reports only booleans for client/token/upload acknowledgement.

## Run

```bash
npm run bench:phase13.1F:paddle-api -- /absolute/path/to/private-corpus
```

The runner:

1. verifies the frozen v0.1 corpus;
2. probes the official API client, token presence and explicit upload acknowledgement;
3. submits each of the 3 PDF files using model `PaddleOCR-VL-1.6`;
4. stores raw hosted response under the private report directory;
5. converts page `markdownText` tables into the existing DocBench predictions contract;
6. runs the unchanged frozen scorer;
7. runs Phase 13.1C row-level error analysis;
8. recomputes the review-only route decision;
9. records a hosted execution identity fingerprint without secrets.

## Output

Default output:

```text
<private-root>/reports/phase13.1F-paddleocr-official-api-1.6/
```

Expected files after a successful execution include:

- `hosted-execution-identity.json`
- `execution-status.json`
- `predictions.json`
- `score/report.json`
- `error-analysis.json`
- `route-decision.json`
- `phase13.1F-summary.json`
- `raw/*.json`

A blocked client/auth/privacy precondition emits status/decision metadata only. It does not create fake predictions or accuracy values.

## Official API output normalization

The hosted document-parsing API returns per-page `markdownText`, unlike the local PaddleOCR-VL pipeline's `parsing_res_list`. 13.1F therefore has a dedicated official-API normalizer. It detects HTML/Markdown tables, applies the same deterministic SmartQuote table-field mapping, and never invents field confidence.

## Promotion boundary

Even if all frozen metrics pass:

```text
productionPromotionAllowed = false
productionRoutingChanged = false
autoApprovalAllowed = false
```

A successful 13.1F result is evidence for deciding whether to design a later review-only canary. It does not alter production routing.
