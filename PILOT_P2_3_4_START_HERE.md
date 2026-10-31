# P2.3.4 — Pilot Candidate Gate

Do not deploy this tree to pilot users before the gates pass.

## 1. Install
```bash
npm ci
python3 -m venv .venv
source .venv/bin/activate
pip install openpyxl
```

## 2. Run Roger real-file gate
```bash
npm run pilot:gate:roger -- "/absolute/path/Roger_BG - RF - Giá đại lý Cấp 1 - 2026.pdf"
```
Expected: `PILOT REAL-FILE GATE PASS — Roger PDF` and STT coverage `88/88`.

## 3. Run Bisco real-file gate
```bash
npm run pilot:gate:bisco -- "/absolute/path/Form BG _Bisco Tech_V2_2025(1).xlsx"
```

## 4. Build + regression
```bash
npm run smoke:pilot-p23.4
npm run smoke:pilot:offline
npm run build
```

## 5. Freeze exact release commit, then full gate
After the two individual real-file gates pass, commit the exact tree. Then run:
```bash
npm run pilot:gate:local -- \
  "/absolute/path/Form BG _Bisco Tech_V2_2025(1).xlsx" \
  "/absolute/path/Roger_BG - RF - Giá đại lý Cấp 1 - 2026.pdf"
```
The full gate requires a clean Git tree and writes `pilot-artifacts/pilot-local-gate-report.json`.

Only a zero exit code is a local pilot-candidate PASS. Production/Supabase QA and browser UAT remain mandatory before external pilot exposure.
