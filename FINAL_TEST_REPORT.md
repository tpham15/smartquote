# SmartQuote Final Pilot v1.0 — RC13 Candidate Test Status

## Verified in this packaging session

PASS:
- P2.3.11 commercial price safety smoke
- core import review smoke
- P2.3.10 supplier-code reuse severity smoke
- P2.3.9 large-Excel browser upload smoke
- P2.3.8 final supplier identity smoke
- P1.5.3.2 Bisco identity regression smoke
- offline chain through RC5 after updating the intentionally changed RC5 generic-price contract

## Environment-blocked here

The packaging container does not contain the full npm dependency tree and `npm ci` could not complete, so the remaining full offline suite and Vite production build were not truthfully re-certified here.

Before deployment, run:

```bash
npm ci
npm run smoke:pilot-p23.11
npm run smoke:core-review
npm run smoke:pilot:offline
npm run build
```

Then run the Bisco/Roger real-file gates and short browser UAT described in `FINAL_PILOT_README.md`.
