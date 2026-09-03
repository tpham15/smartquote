# PDF fixtures

- `lumi-smarthome-2026-scan.pdf`: real scanned/image PDF catalog used to validate Lumi Smarthome row-recovery behavior.

Offline `npm run smoke:pdf` cannot call Claude/Vercel, so it locks the deterministic prompt/normalization contract:
- Lumi Smarthome is detected as a scanned table with 49 expected product rows.
- The vision prompt requires one physical table row = one JSONL object.
- Rows with name + price are preserved even when SKU is blurry.
- Simulated 49-row AI output must preserve at least 45 rows after normalization/dedupe.

For end-to-end AI verification, deploy with `ANTHROPIC_API_KEY` and import this PDF through the UI on Vercel.
