# SmartQuote P1.5 — Industry-Neutral Core + Workspace Industry Profile

## What changed

P1.5 keeps one SmartQuote commercial core and adds a tenant-scoped Industry Profile for:

- Generic / Other
- Lighting
- CCTV & Security
- Smart Home
- Electrical / MEP
- HVAC

The industry profile controls onboarding, terminology, default quote preset, product metadata fields, import hints, template visibility and Smart Home-only solution-family visibility. It does **not** control pricing safety, Final Quote Gate, revision lifecycle, tenant isolation, billing, quote snapshots or API authorization.

## Production migration — run before deploying P1.5

Run this file in Supabase SQL Editor:

```text
supabase/phase15_industry_profiles.sql
```

Run it after the P1.4 billing security migration.

Verification result must be:

```text
authenticated_industry_update_should_be_true       = t
authenticated_business_type_update_should_be_true  = t
authenticated_name_update_should_be_true           = t
authenticated_plan_update_should_be_false          = f
authenticated_subscription_update_should_be_false  = f
authenticated_period_update_should_be_false        = f
```

Existing workspaces are migrated to `smarthome` to preserve their current experience. New workspaces keep `industry_profile = NULL` until the first-time onboarding is completed.

## Mac release check

```bash
npm ci
npm run smoke:pilot-p15
npm run smoke:pilot-security
npm run smoke:pilot-p14
npm run smoke:pilot-p13
npm run smoke:pilot-p12
npm run smoke:pilot-p11
npm run smoke:pilot-p0
npm run smoke:phase15
npm run smoke:phase14.2
npm run smoke:phase14.0:vat
npm run smoke:tenant
npm run smoke:plan-limits
npm run smoke:white-label
npm run smoke:phase12.4.1
npm run smoke:pdf
npm run smoke:billing
npm run smoke:quotes
npm run smoke:api-auth
npm run build
```

`smoke:pilot-p12` may warn that the private golden corpus is not installed. That is expected in the GitHub-ready package.

## Production sanity check

After deployment:

1. Existing Smart Home workspace still opens without onboarding.
2. New workspace sees industry onboarding after login.
3. Select Lighting: quote page contains no Smart Home-specific wording.
4. Select CCTV: same neutral quote engine is used.
5. Change industry in Settings: catalog and historical quotes remain intact.
6. Final/revision behavior is unchanged.
7. Run `npm run qa:production` with the server-side Supabase QA environment; it now verifies the P1.5 dealer columns.
