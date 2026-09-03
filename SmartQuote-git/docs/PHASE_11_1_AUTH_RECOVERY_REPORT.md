# Phase 11.1 — Auth Recovery

## Scope

Add a password recovery flow to SmartQuote Cloud login without changing import engine, quote calculation, catalog import, billing logic, or storage model.

## Changes

- Added `requestPasswordReset(email, redirectTo)` in `src/supabase/cloudState.js` using Supabase `resetPasswordForEmail`.
- Added `updateCurrentUserPassword(password)` in `src/supabase/cloudState.js` using Supabase `updateUser({ password })`.
- Updated `src/supabase/SupabaseAuthGate.jsx`:
  - Login form now includes `Quên mật khẩu?`.
  - Forgot-password mode sends a reset link to the registered email.
  - `PASSWORD_RECOVERY` auth event opens an in-app password update form.
  - Password confirmation and 6-character minimum validation added.
  - Back-to-login path added.
- Added `npm run smoke:auth-recovery`.

## Supabase setup reminder

Supabase Auth URL Configuration must include the deployed app domain in Redirect URLs, otherwise the email reset link may not return to the app correctly.

## Tests

- `tsc --noEmit --allowJs --jsx react --moduleResolution node --target ES2020 --module ESNext --skipLibCheck src/supabase/SupabaseAuthGate.jsx`
- `npm run smoke:auth-recovery`
- Existing smoke tests should continue to pass.
