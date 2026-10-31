SmartQuote FINAL P1.5.3.1 — PILOT MASTER

1) SUPABASE
   Open Supabase > SQL Editor > New query.
   Run the ENTIRE file: 01_RUN_ON_SUPABASE.sql

   Final result rule:
   - every *_should_be_false = false
   - every *_should_be_true  = true

2) MAC
   npm ci
   npm run smoke:pilot-p15.3.1
   npm run smoke:pilot-p15.3
   npm run smoke:pilot-p15.2
   npm run smoke:pilot-p15.1
   npm run smoke:pilot-p15
   npm run smoke:pilot-security
   npm run build

3) DEPLOY
   Commit/push only after the checks above pass.

P1.5.3.1 changes only:
- fixes business-type onboarding submit event bug;
- consolidates all required pilot DB migrations into one master SQL.
