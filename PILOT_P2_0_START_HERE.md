# SmartQuote P2.0 — Start Here

1. Run `01_RUN_ON_SUPABASE.sql` in Supabase SQL Editor.
2. Confirm the final P2.0 verification returns:
   - `anon_learning_insert_should_be_false = false`
   - `authenticated_learning_insert_should_be_false = false`
   - `authenticated_learning_select_should_be_true = true`
   - `anon_learning_rpc_should_be_false = false`
   - `authenticated_learning_rpc_should_be_true = true`
3. On Mac:
   - `npm ci`
   - `npm run smoke:pilot-p20`
   - `npm run smoke:pilot-p15.5`
   - `npm run smoke:pilot-p15.4`
   - `npm run build`
4. Deploy.
5. Create and Final several quotes with the same product, then open the line-product editor. Learning insight appears after the first Final quote; trusted identity behavior begins at 5 Final quotes.
