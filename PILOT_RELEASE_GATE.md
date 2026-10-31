# SmartQuote P2.3.3 RC1 — Pilot Release Gate

This package changes **test/release tooling only**. Product code remains P2.3.3.
Do not continue P2.4 until the pilot gates below pass.

## Gate 0 — Freeze

No feature work during hardening. The exact tested commit must be clean and tagged.

## Gate 1 — Local automated gate (mandatory)

Use the real Bisco workbook, not synthetic rows:

```bash
cd ~/Downloads/SmartQuote-git
python3 -m venv .venv
source .venv/bin/activate
pip install openpyxl
npm ci
npm run pilot:gate:local -- "/Users/vienpham/Downloads/Form BG _Bisco Tech_V2_2025(1).xlsx"
```

PASS requires all of these:
- Vite production build succeeds.
- Existing offline pilot regressions succeed.
- The **production import engine** reads the actual Bisco XLSX.
- Exactly 9 sellable products are produced.
- Exact Name / SKU / Model / Category / Product Type / price / source sheet matches the frozen expectation for all 9.
- No labor/material/subtotal row leaks into catalog.
- A simulated legacy catalog repairs to the same 9 identities.
- Importing the same file again does not create duplicates.
- Git working tree is clean, so the tested bits equal the release commit.

Output evidence is saved to `pilot-artifacts/pilot-local-gate-report.json`.

## Gate 2 — Production/Supabase QA (mandatory)

With production/staging environment variables loaded:

```bash
npm run qa:production
```

Then complete `docs/PRODUCTION_QA_2_USER_CHECKLIST.md` with two separate users/workspaces. Tenant isolation is a release blocker.

## Gate 3 — Browser UAT on deployed RC (mandatory)

Use a fresh test workspace and the real Bisco file.

1. Import Bisco file -> preview must show 9 clean products.
2. Verify VULCAN 24V: category `Cổng âm sàn tự động`, type `Cổng xoay tự động âm sàn`, SKU `29G020`, price 42,900,000.
3. Verify TORQ 500D: category `Cổng trượt tự động`, type `Mô tơ cổng trượt`, SKU `30C109`, price 24,900,000.
4. Verify NYK 24V: category `Cổng tay đòn tự động`, type `Mô tơ cổng mở xoay tự động`, SKU `29H001`, price 29,900,000.
5. Open source grounding for at least one product from each category and compare with Excel.
6. Merge into empty catalog -> catalog count becomes 9.
7. Import the same file again in Merge -> catalog count stays 9.
8. Re-import over a legacy/coarse catalog -> taxonomy is repaired, no duplicate SKU.
9. Create a quote from at least 3 imported products; totals and current prices must match catalog.
10. Finalize quote; reopen it; final snapshot must not mutate after changing catalog price.
11. Export quote to the formats used in the pilot and manually open the output.
12. User B must not see User A/workspace A catalog or quotes.

Any failure = **NO-GO**. Fix, reset the RC, and rerun the full gate from the beginning.

## Gate 4 — Security/dependency review (mandatory before external paid pilot)

`npm ci` previously reported high-severity audit findings. Capture and review:

```bash
npm audit --json > pilot-artifacts/npm-audit.json
npm audit
```

Do not blindly run `npm audit fix --force`; document whether each high finding is runtime-exploitable and the mitigation/version decision.

## Gate 5 — Release + rollback

Only after Gates 1–4 pass:

```bash
git tag -a pilot-p2.3.3-rc1 -m "SmartQuote pilot P2.3.3 RC1"
git push origin pilot-p2.3.3-rc1
```

Before inviting pilot users, export/back up the pilot workspace/catalog or database according to the deployment procedure. Rollback target is this exact tag, not an uncommitted local folder.

## Release rule

A smoke test PASS is **not** equivalent to pilot-ready. SmartQuote may be called `PILOT CANDIDATE` only when automated real-file gate, deployed browser UAT, tenant isolation, production QA, and security review are all green.
