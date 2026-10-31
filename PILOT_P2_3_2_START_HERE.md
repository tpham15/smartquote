# P2.3.2 Start Here

1. Replace the current SmartQuote source with this package.
2. No new Supabase migration is required beyond the migrations already included from P2.0/P2.3.
3. Run:

```bash
npm ci
npm run build
node scripts/pilot-p232-product-semantics-smoke.mjs
```

4. Re-import the Bisco quotation in **Merge** mode. If the previous catalog row still retains explicit Model evidence, SmartQuote will repair the old alias identity and update the same product rather than create a duplicate.
5. In import preview verify a VULCAN row appears as:
   - Category: `Cổng tự động`
   - Product Type: `Động cơ cổng tự động`
   - Subtype: `Âm sàn`
   - Model: `VULCAN 24V`
   - SKU: `29G020`
   - Name: `Động cơ cổng tự động âm sàn VULCAN 24V`

If a legacy catalog row lost all source/model evidence, SmartQuote deliberately will not guess-repair it. That row should be reviewed manually or replaced from the source quotation.
