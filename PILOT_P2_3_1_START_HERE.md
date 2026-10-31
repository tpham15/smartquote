# SmartQuote P2.3.1 — Start Here

1. Deploy this package over the P2.3 application.
2. No Supabase migration is needed.
3. Re-import the Bisco old quotation that previously showed `Vulcan-24V (29G020)` as SKU.
4. In preview, verify the first rows now look like:
   - Name: `Cổng xoay tự động âm sàn V2 - VULCAN 24V`
   - SKU: `29G020`
   - Category remains: `Cổng tự động`
5. For catalog rows already saved with wrong identity, remove/edit them or use Replace mode with the corrected source import.
6. Before deployment on your machine, run:

```bash
npm ci
npm run build
node scripts/pilot-p231-product-identity-canonicalization-smoke.mjs
node scripts/pilot-p155-identity-learning-safety-smoke.mjs
node scripts/pilot-p20-learning-memory-smoke.mjs
node scripts/pilot-p23-engineering-rules-smoke.mjs
```
