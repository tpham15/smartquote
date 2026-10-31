# SmartQuote P2.3.3 — Start Here

1. Copy this release into the Git repo (preserve `.git` and local `.env`).
2. Run:

```bash
npm ci
npm run smoke:pilot-p23.3
npm run smoke:pilot-p15.3.2
npm run smoke:pilot-p15.4
npm run smoke:pilot-p20
npm run smoke:pilot-p23
npm run build
```

3. Deploy.
4. Re-import `Form BG _Bisco Tech_V2_2025.xlsx` in **Merge** mode.
5. Confirm preview examples:
   - VULCAN: `Cổng âm sàn tự động · Cổng xoay tự động âm sàn`
   - TORQ/AYROS: `Cổng trượt tự động · Mô tơ cổng trượt`
   - NYK/STAR/STARK: `Cổng tay đòn tự động · Mô tơ cổng mở xoay tự động`
6. Confirm SKU remains canonical (`29G020`, `30C109`, `29H001`, etc.).

Do not continue P2.4 until this source taxonomy check passes in the deployed preview.
