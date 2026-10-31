# SmartQuote P2.3.4 RC2 — Pilot Hardening

This RC contains no P2.4 feature work. It only fixes release-gate defects found by the real Roger PDF and Bisco XLSX golden files.

Required GO gates on the exact golden files:

```bash
npm run pilot:gate:roger -- "/absolute/path/Roger_BG - RF - Giá đại lý Cấp 1 - 2026.pdf"
npm run pilot:gate:bisco -- "/absolute/path/Form BG _Bisco Tech_V2_2025.xlsx"
npm run smoke:pilot:offline
npm run build
```

Do not deploy/pilot if any gate is non-zero.
