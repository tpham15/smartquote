# SmartQuote Supabase — Phase 1.1 Report

## Goal

Close the remaining Phase 1 multi-tenant gap: local learning/cache data must not bleed across dealers sharing the same browser profile.

Phase 1 already isolated the main app state (`products`, `templates`, `company`, `markups`, `suppliers`, `nameMap`) by `dealer_id`. Phase 1.1 scopes the remaining browser-side memory layers.

## Files changed

- `src/storage/tenantStorage.js` — new tenant-aware localStorage helper.
- `src/SmartQuote.jsx` — sets active dealer storage scope and scopes PDF cache, AI quota, and catalog-clear backup.
- `src/import-engine/bom/bomMatcher.js` — scopes BOM match learning.
- `src/import-engine/correctionLearning.js` — scopes correction learning.
- `src/import-engine/corrections.js` — scopes raw import corrections.
- `src/import-engine/templateMemory.js` — scopes import/catalog template memory.
- `scripts/tenant-storage-smoke.mjs` — automated isolation smoke test.
- `package.json` — adds `npm run smoke:tenant`.

## Scoped keys in cloud mode

When `cloud.enabled` and `cloud.dealerId` are present, legacy keys are rewritten like this:

```txt
sq_bom_match_learning_v1        -> sq_dealer_<dealerId>_bom_match_learning_v1
sq_correction_learning_v1       -> sq_dealer_<dealerId>_correction_learning_v1
sq_import_corrections           -> sq_dealer_<dealerId>_import_corrections
sq_import_templates             -> sq_dealer_<dealerId>_import_templates
sq_catalog_template_<hash>      -> sq_dealer_<dealerId>_catalog_template_<hash>
sq_pdf_cache_<hash>             -> sq_dealer_<dealerId>_pdf_cache_<hash>
sq_ai_quota                     -> sq_dealer_<dealerId>_ai_quota
sq_products_backup_before_clear -> sq_dealer_<dealerId>_products_backup_before_clear
```

When Supabase is not configured or the app runs in local/offline mode, the original `sq_*` keys are preserved for backward compatibility.

## Verification run

```bash
npm ci
npm run build
npm run smoke:tenant
npm run smoke:import
npm run smoke:bom
npm run smoke:pdf
npm audit --omit=dev
```

Result:

```txt
Build: PASS
Tenant storage smoke: PASS
Import smoke: PASS
BOM smoke: PASS
PDF smoke: PASS
npm audit --omit=dev: FAIL because xlsx has known high severity advisories and no fix available
```

## Remaining known risks

- API endpoints are still not protected by Supabase JWT. This is Phase 2.
- Quota is only browser-side for now; server-side quota must be added in Phase 2.
- Main cloud state is still stored as JSON snapshot. This is acceptable for MVP but should be split into proper tables in later phases.
- `xlsx` still has a known advisory with no automatic fix in `npm audit`.
