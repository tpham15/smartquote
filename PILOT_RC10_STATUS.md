# Pilot RC10 Status

RC10 is a **candidate**, not yet a final paid-pilot release.

Required acceptance on the user's Mac:

1. `npm run smoke:pilot-p23.8`
2. Bisco real-file golden PASS
3. Roger real-file golden PASS
4. `npm run smoke:pilot:offline` PASS
5. `npm run build` PASS
6. `npm run pilot:diag:suppliers:v4 -- "/Users/vienpham/Desktop/bang-gia"`

Target release signal:

- no structured supplier file remains FAIL;
- unknown supplier files may remain REVIEW;
- image/scan PDFs may remain REVIEW until OCR/vision + reviewed baseline exists.
