# SmartQuote P2.3 — Start Here

P2.3 is based on `SmartQuote-FINAL-P2.0-Learning-Memory-Foundation`.

## 1. Install

```bash
npm ci
```

P2.3 v1 needs no new npm dependencies and no new Supabase migration.

## 2. Run focused checks

```bash
npm run smoke:pilot-p23
npm run smoke:pilot-p20
npm run smoke:phase15
npm run smoke:pilot-p11
npm run smoke:pilot-p15.5
npm run smoke:pilot-p15.4
```

## 3. Production build

```bash
npm run build
```

Do not deploy until build succeeds on your development machine.

## 4. Configure technical attributes

In SmartQuote:

1. Open Catalog.
2. Edit a product.
3. Open `Engineering Rules · P2.3`.
4. Select the engineering role.
5. Enter only verified datasheet/manufacturer values.

Typical CCTV setup:

### Camera IP

- role: `ip_camera`
- PoE required: yes/no
- power W
- bitrate Mbps
- network ports required

### NVR

- role: `nvr`
- max channels
- max incoming bandwidth Mbps
- optional integrated PoE ports/budget
- optional installed storage TB

### PoE switch

- role: `poe_switch`
- PoE ports
- reserved/uplink ports
- PoE budget W

### HDD

- role: `storage_hdd`
- capacity TB

## 5. Use Engineering checks in a quote

The right-side Quote Builder panel evaluates deterministic rules automatically.

For CCTV storage, enter project requirements in the panel:

- retention days
- default bitrate if individual cameras do not have bitrate data
- storage safety percentage

## 6. PASS / FAIL / UNKNOWN

- `PASS`: enough verified data exists and the constraint passes.
- `FAIL`: enough verified data exists and the configuration violates the constraint.
- `UNKNOWN`: technical data is missing. SmartQuote does not guess.

## 7. Final Quote override

A Final Quote with Engineering `ERROR` requires an override reason of at least 8 characters and an explicit confirmation.

Example legitimate reason:

`Khách đã có NVR bổ sung ngoài phạm vi báo giá.`

The reason is stored in the Final Quote engineering snapshot.

## 8. Important boundary

Phase 15 completeness recommendations and P2.0 historical learning remain separate from P2.3 engineering truth.

Historical co-occurrence must never silently become a technical requirement.
