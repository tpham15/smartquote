-- SmartQuote P1.5 — Industry-Neutral Core + Workspace Industry Profile
-- Run AFTER smartquote_pilot_security_fix.sql on an existing production project.
-- Existing workspaces keep their historical Smart Home context; new workspaces start with NULL
-- and are sent through the first-time industry onboarding.

alter table public.dealers add column if not exists industry_profile text;
alter table public.dealers add column if not exists business_type text;
alter table public.dealers add column if not exists industry_profile_version integer not null default 1;

-- Existing tenants pre-date industry onboarding. Preserve their current behavior.
update public.dealers
set industry_profile = 'smarthome',
    industry_profile_version = 1,
    updated_at = now()
where industry_profile is null;

-- New workspaces must choose an industry; do not set a default on industry_profile.
alter table public.dealers alter column industry_profile drop default;

alter table public.dealers drop constraint if exists dealers_industry_profile_check;
alter table public.dealers add constraint dealers_industry_profile_check
  check (industry_profile is null or industry_profile in ('generic','lighting','cctv','smarthome','electrical','hvac'));

alter table public.dealers drop constraint if exists dealers_business_type_check;
alter table public.dealers add constraint dealers_business_type_check
  check (business_type is null or business_type in ('distributor','dealer','system_integrator','contractor','manufacturer','other'));

alter table public.dealers drop constraint if exists dealers_industry_profile_version_check;
alter table public.dealers add constraint dealers_industry_profile_version_check
  check (industry_profile_version >= 1 and industry_profile_version <= 1000);

-- Billing security remains intact: browser users still cannot update plan/subscription columns.
-- Owners/admins are allowed to edit only safe profile fields, including the new industry metadata.
revoke update on table public.dealers from authenticated;
grant update (name, phone, address, industry_profile, business_type, industry_profile_version) on table public.dealers to authenticated;

-- Verification row:
-- *_should_be_true must be t; *_should_be_false must be f.
select
  has_column_privilege('authenticated', 'public.dealers', 'industry_profile', 'UPDATE')
    as authenticated_industry_update_should_be_true,
  has_column_privilege('authenticated', 'public.dealers', 'business_type', 'UPDATE')
    as authenticated_business_type_update_should_be_true,
  has_column_privilege('authenticated', 'public.dealers', 'name', 'UPDATE')
    as authenticated_name_update_should_be_true,
  has_column_privilege('authenticated', 'public.dealers', 'plan', 'UPDATE')
    as authenticated_plan_update_should_be_false,
  has_column_privilege('authenticated', 'public.dealers', 'subscription_status', 'UPDATE')
    as authenticated_subscription_update_should_be_false,
  has_column_privilege('authenticated', 'public.dealers', 'current_period_end', 'UPDATE')
    as authenticated_period_update_should_be_false;
