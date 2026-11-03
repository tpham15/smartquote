# Retired / skipped smoke policy — RC15

No business-relevant smoke test was retired in RC15.

- Stale assertions were repaired in place when production behavior had intentionally changed.
- `phase12.5.3` is **SKIPPED** with exit code 0 only when the private fixture is unavailable and prints: `SKIPPED (private corpus): ...`.
- `smoke:pilot` and `smoke:pilot-release` are excluded by `smoke:all` with explicit staging-only reasons because they require live Supabase/private data.
- `smoke:pilot:offline` remains inside `smoke:all` and must PASS before Candidate promotion.
