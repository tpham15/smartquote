# Phase 12.6.1 — Auth UI Unification

## Scope

Unify the Supabase authentication screens with the current SmartQuote SaaS design system without changing authentication behavior.

## Changes

- Replace the package emoji with the same SmartQuote check-mark brand used in the app sidebar.
- Rename the login title from `SmartQuote Cloud` to `Đăng nhập SmartQuote`.
- Remove Supabase/infrastructure language from user-facing auth copy.
- Rename registration wording from `Tạo đại lý mới` to `Tạo workspace`.
- Use the same light/dark color tokens as the main SmartQuote app.
- Make inputs explicitly theme-aware so a light auth screen cannot render dark native inputs.
- Use SmartQuote blue for primary actions and links instead of the legacy green auth palette.
- Add WebKit autofill styling to prevent browser autofill from forcing an inconsistent surface.
- Reduce auth visual density and standardize card, border, radius, shadow, focus ring, and mobile spacing.
- Apply the same visual system to login, register, forgot-password, and password-recovery modes.

## Non-goals

- No changes to Supabase authentication calls.
- No changes to session, dealer/workspace creation, password recovery, or RLS.
- No changes to billing, catalog, import, quotation, or Excel/PDF export logic.

## QA

Run:

```bash
npm run smoke:phase12.6.1
npm run smoke:auth-recovery
npm run smoke:dark-mode-step6
npm run smoke:phase12.6
```
