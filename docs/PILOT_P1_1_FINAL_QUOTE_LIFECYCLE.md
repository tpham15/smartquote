# Pilot P1.1 — Final Quote Lifecycle

## Commercial invariant
A customer-facing quote must never be exported from an editable Draft.

`Draft -> Final Gate -> Final snapshot -> Export`

Any commercial change after Final creates a new revision:

`Final Rev N -> Create Revision -> Draft Rev N+1 -> Final Gate -> Final Rev N+1`

The previous Final record is not overwritten by revision creation.

## Persistence model
No Supabase migration is required. Lifecycle metadata is stored in the existing `quotes.calc` JSONB payload:

```json
{
  "workflow": {
    "lifecycle": "final",
    "revision": 2,
    "parentQuoteId": "...",
    "rootQuoteId": "...",
    "finalizedAt": "...",
    "companySnapshot": {
      "name": "...",
      "laborPercent": 10
    },
    "snapshotVersion": 1
  }
}
```

Legacy quotes without `calc.workflow.lifecycle=final` open as Draft even when their old sales status is `sent` or `won`. This is intentional: old quotes may predate immutable snapshots and must pass the new Final gate explicitly.

## Final immutability boundary
Frozen on Final:

- line product snapshot;
- cost price snapshot;
- sale price snapshot;
- customer fields + quote VAT;
- company identity / salesperson contact fields;
- labor percent used by quote totals.

Not frozen in P1.1:

- presentation template selection;
- sales outcome status (`draft/sent/won/lost` metadata);
- audit trail of each state transition (planned P1.4).

## Regression
Primary smoke: `scripts/pilot-p11-final-quote-lifecycle-smoke.mjs`.
