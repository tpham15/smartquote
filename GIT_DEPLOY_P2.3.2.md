# SmartQuote P2.3.2 — GitHub deployment

Target repo used previously: `~/Downloads/SmartQuote-git`
Branch: `main`

## 1. Backup current Git working tree

```bash
cd ~/Downloads/SmartQuote-git
git status
git branch --show-current
git remote -v
```

## 2. Copy this GitHubReady source into the existing repo

From the folder containing `SmartQuote-P2.3.2-GitHubReady`:

```bash
rsync -av --delete \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='.env' \
  --exclude='.env.local' \
  --exclude='.DS_Store' \
  SmartQuote-P2.3.2-GitHubReady/ \
  ~/Downloads/SmartQuote-git/
```

The existing `.git` history and your local secret `.env` files stay intact.

## 3. Install + verify

```bash
cd ~/Downloads/SmartQuote-git
npm ci
npm run smoke:pilot-p15.3.2
npm run smoke:pilot-p15.4
npm run smoke:pilot-p15.5
npm run smoke:pilot-p20
npm run smoke:pilot-p23
npm run build
```

Optional full regression:

```bash
npm run smoke:pilot
```

## 4. Review before commit

```bash
git status
git diff --stat
git diff
```

Confirm that `.env`, `.env.local`, `node_modules`, and `dist` are not staged.

## 5. Commit and push

```bash
git add -A
git status
git commit -m "P2.3.2 fix product identity semantics"
git push origin main
```

## Supabase

P2.3.2 adds no new database migration beyond the migrations already included in the baseline. Do not rerun old migrations blindly on an existing production database.
