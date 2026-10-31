# Final Pilot Acceptance Snapshot

Pilot baseline date: **2026-10-31**  
Current candidate: **P2.3.11 RC13**  
Base acceptance: **P2.3.10 RC12**

## Previously accepted RC12 pilot gates

| Gate | Result |
|---|---|
| Supplier diagnostic corpus | PASS — `PASS=2 · REVIEW=8 · FAIL=0` |
| Bisco golden XLSX | PASS — 9/9 identities, no leakage, stable re-import |
| Roger golden PDF deterministic gate | PASS — 88/88, legitimate supplier-code reuse preserved |
| Local browser Bisco import | PASS — 9/9 |
| Local browser Bisco re-import | PASS — 9 → 9, no duplicate growth |
| Local browser MX-BG | PASS — generic product names reduced to 0 |
| Local browser NGUYÊN ĐÀ | PASS — generic names 0, no accounting-row leakage |
| Large Excel (~37 MiB) browser preview | PASS after RC11 — 100/100 preview |
| Quote creation with positive margin | PASS |
| Final Quote Rev 1 | PASS |
| PDF export trigger | PASS |
| Excel report export | PASS — generated workbook reviewed; formulas/totals valid |
| Cloud quote persistence | PASS — Final R1 quote visible after save/reopen workflow |
| Roger browser/API import | PASS to 88-row preview; RC12 reduces false blocking reuse errors from 16 to 0 |

## RC13 commercial-safety delta

RC13 intentionally changes two behaviors before customer pilot:

1. A lone generic `Đơn giá / Unit price / Price` column is REVIEW until the user chooses its role once for the whole file.
2. New workspaces default to markup ×1.20 instead of ×1.00. Explicit existing workspace settings are preserved.

Focused RC13 gates passed in the packaging environment:

- `smoke:pilot-p23.11`
- `smoke:core-review`
- RC12 supplier-code reuse regression
- RC11 large-Excel regression
- RC10 supplier identity regression
- P1.5.3.2 Bisco identity regression

## RC13 gates still required on the deployment workstation

The packaging container could not restore the full npm dependency tree, so RC13 is a **candidate until these pass on the normal Mac environment**:

```bash
npm ci
npm run smoke:pilot-p23.11
npm run smoke:core-review
npm run smoke:pilot:offline
npm run build
npm run pilot:gate:bisco -- "<PATH_TO_BISCO_XLSX>"
npm run pilot:gate:roger -- "<PATH_TO_ROGER_PDF>"
```

Then perform a short browser UAT for the new generic-price role chooser and default ×1.20 markup.

## Roger expected review semantics remain unchanged

- Total preview: 88
- Blocking duplicate errors caused only by supplier-code reuse: 0
- Reuse warnings remain visible for human awareness
- OCR/price uncertainty may remain `REVIEW`
- `FU` variants must not be merged solely because the supplier code is reused

## Release decision

RC12 remains the last fully observed pilot baseline. RC13 is the safer **Final Pilot v1.0 candidate** and should replace RC12 for customer pilot only after the deployment-workstation gates above pass.
