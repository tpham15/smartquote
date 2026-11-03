# RC16.1.1 — Patch SmartQuote-git and push existing main

**Use the SMALL patch ZIP** `SmartQuote_RC16_1_1_Flexible_Pricing_PATCH.zip`. No new repo or branch.

Before starting, ensure the ZIP has been downloaded to ~/Downloads, and the current main is clean.

```sh
cd ~/Downloads/SmartQuote-git
git status
git pull --ff-only origin main
unzip -o ~/Downloads/SmartQuote_RC16_1_1_Flexible_Pricing_PATCH.zip -d ~/Downloads/SmartQuote-git
npm ci
npm run smoke:flexible-pricing
npm run smoke:pilot-p11
npm run smoke:pilot-p12
npm run smoke:pilot-p0
npm run build
git diff --check
git status --short
git add -A
git diff --cached --name-only
git commit -m "SmartQuote RC16.1.1 allow strategic below-cost quotes"
git push origin main
```

If any test/build fails, stop before commit/push. If ZIP doesn't exist, downloading inside ChatGPT did not place it on your Mac. Do not add secrets to Git. If Vercel deploys main automatically, push is a production deployment. This patch does not change Supabase SQL, so previously required RC16.1 database migration still applies.
