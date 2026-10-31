# SmartQuote Final Pilot v1.0 — RC13 Release Gate

Run in this order on the deployment workstation:

```bash
npm ci
npm run smoke:pilot-p23.11
npm run smoke:core-review
npm run pilot:gate:bisco -- "<PATH_TO_BISCO_XLSX>"
npm run pilot:gate:roger -- "<PATH_TO_ROGER_PDF>"
npm run smoke:pilot:offline
npm run build
```

Acceptance requirements:

- generic single `Đơn giá` remains REVIEW until a file-level cost/list role is chosen;
- Bisco golden 9/9 PASS;
- Roger golden 88/88 PASS and supplier-code reuse remains non-blocking;
- offline suite PASS;
- production build PASS;
- browser UAT confirms import, Final Quote, PDF/Excel export, and cloud save/reload.

No hard-coded `/Users/...` path is part of the release contract.
