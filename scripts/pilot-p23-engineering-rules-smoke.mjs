import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildEngineeringAssessment, buildEngineeringValidationSnapshot, getEngineeringAttributes } from '../src/engineering/engineeringRules.js';

const product = (id, role, engineering = {}) => ({
  id,
  name: id,
  sku: id.toUpperCase(),
  category: role,
  attributes: { engineering: { role, ...engineering } },
});
const roomsFor = (rows) => [{ id: 'r1', name: 'CCTV', lines: rows.map(([p, qty]) => ({ id: `l_${p.id}`, productId: p.id, qty })) }];
const mapFor = (products) => Object.fromEntries(products.map((p) => [p.id, p]));

// 1. Channel capacity FAIL is deterministic.
{
  const cam = product('cam', 'ip_camera', { bitrateMbps: 4, poeRequired: true, powerW: 8 });
  const nvr = product('nvr16', 'nvr', { maxChannels: 16, maxIncomingBandwidthMbps: 256 });
  const a = buildEngineeringAssessment({ rooms: roomsFor([[cam, 24], [nvr, 1]]), productById: mapFor([cam, nvr]) });
  const ch = a.checks.find((x) => x.ruleCode === 'CCTV_NVR_CHANNEL_CAPACITY');
  assert.equal(ch.status, 'FAIL');
  assert.equal(ch.evidence.required, 24);
  assert.equal(ch.evidence.available, 16);
  assert.equal(ch.evidence.shortfall, 8);
}

// 2. Channel capacity PASS with larger recorder.
{
  const cam = product('cam2', 'ip_camera', { bitrateMbps: 4 });
  const nvr = product('nvr32', 'nvr', { maxChannels: 32, maxIncomingBandwidthMbps: 256 });
  const a = buildEngineeringAssessment({ rooms: roomsFor([[cam, 24], [nvr, 1]]), productById: mapFor([cam, nvr]) });
  assert.equal(a.checks.find((x) => x.ruleCode === 'CCTV_NVR_CHANNEL_CAPACITY').status, 'PASS');
}

// 3. PoE ports can fail while power budget passes — independent checks.
{
  const cam = product('poecam', 'ip_camera', { poeRequired: true, powerW: 8, networkPortsRequired: 1 });
  const sw = product('sw24', 'poe_switch', { poePorts: 24, reservedPorts: 2, poeBudgetW: 370 });
  const a = buildEngineeringAssessment({ rooms: roomsFor([[cam, 30], [sw, 1]]), productById: mapFor([cam, sw]) });
  assert.equal(a.checks.find((x) => x.ruleCode === 'POE_PORT_CAPACITY').status, 'FAIL');
  assert.equal(a.checks.find((x) => x.ruleCode === 'POE_POWER_BUDGET').status, 'PASS');
}

// 4. Storage estimate reproduces the 40 cam / 4 Mbps / 30 day case with 10% safety.
{
  const cam = product('storecam', 'ip_camera', { bitrateMbps: 4 });
  const hdd = product('hdd8', 'storage_hdd', { capacityTb: 8 });
  const a = buildEngineeringAssessment({
    rooms: roomsFor([[cam, 40], [hdd, 4]]), productById: mapFor([cam, hdd]),
    requirements: { retentionDays: 30, storageSafetyPercent: 10 },
  });
  const st = a.checks.find((x) => x.ruleCode === 'CCTV_STORAGE_RETENTION');
  assert.equal(st.status, 'FAIL');
  assert.ok(st.evidence.required > 56 && st.evidence.required < 58);
  assert.equal(st.evidence.available, 32);
}

// 5. Missing technical attributes yield UNKNOWN, never a fabricated PASS.
{
  const cam = product('unknowncam', 'ip_camera', { poeRequired: true });
  const sw = product('unknownsw', 'poe_switch', { poePorts: 24 });
  const a = buildEngineeringAssessment({ rooms: roomsFor([[cam, 2], [sw, 1]]), productById: mapFor([cam, sw]) });
  assert.equal(a.checks.find((x) => x.ruleCode === 'POE_POWER_BUDGET').status, 'UNKNOWN');
}

// 6. Explicit dependency quantity rule.
{
  const sensor = product('sensor', 'device', { requiresRoles: 'gateway', unitsPerRequiredRole: 16 });
  const gateway = product('gw', 'gateway', {});
  const a = buildEngineeringAssessment({ rooms: roomsFor([[sensor, 20], [gateway, 1]]), productById: mapFor([sensor, gateway]) });
  const dep = a.checks.find((x) => x.family === 'quantity');
  assert.equal(dep.status, 'FAIL');
  assert.equal(dep.evidence.required, 2);
  assert.equal(dep.evidence.available, 1);
}

// 7. Explicit protocol compatibility.
{
  const endpoint = product('zig-sensor', 'device', { requiresProtocols: 'zigbee' });
  const gateway = product('knx-gw', 'gateway', { protocols: 'KNX' });
  const a = buildEngineeringAssessment({ rooms: roomsFor([[endpoint, 1], [gateway, 1]]), productById: mapFor([endpoint, gateway]) });
  assert.equal(a.checks.find((x) => x.ruleCode === 'COMPAT_PROTOCOL_ZIGBEE').status, 'FAIL');
}

// 8. Snapshot preserves evidence + explicit override reason.
{
  const cam = product('snapcam', 'ip_camera', {});
  const nvr = product('snapnvr', 'nvr', { maxChannels: 1 });
  const a = buildEngineeringAssessment({ rooms: roomsFor([[cam, 2], [nvr, 1]]), productById: mapFor([cam, nvr]) });
  const snap = buildEngineeringValidationSnapshot(a, 'Khách đã có đầu ghi bổ sung ngoài phạm vi báo giá');
  assert.equal(snap.status, 'FAIL');
  assert.equal(snap.override.accepted, true);
  assert.ok(snap.override.reason.length > 8);
  assert.ok(snap.checks.some((x) => x.ruleCode === 'CCTV_NVR_CHANNEL_CAPACITY'));
}

// 9. Engineering attributes remain backward compatible with root attributes.
{
  const attrs = getEngineeringAttributes({ name: 'Camera IP', attributes: { engineeringRole: 'ip_camera', bitrateMbps: 6 } });
  assert.equal(attrs.role, 'ip_camera');
  assert.equal(attrs.bitrateMbps, 6);
}

// 10. Quantity dependency aggregates multiple trigger products instead of validating each SKU in isolation.
{
  const sensorA = product('sensor-a', 'device', { requiresRoles: 'gateway', unitsPerRequiredRole: 16 });
  const sensorB = product('sensor-b', 'device', { requiresRoles: 'gateway', unitsPerRequiredRole: 16 });
  const gateway = product('gw-agg', 'gateway', {});
  const a = buildEngineeringAssessment({ rooms: roomsFor([[sensorA, 10], [sensorB, 10], [gateway, 1]]), productById: mapFor([sensorA, sensorB, gateway]) });
  const dep = a.checks.find((x) => x.family === 'quantity');
  assert.equal(dep.status, 'FAIL');
  assert.equal(dep.evidence.triggerQty, 20);
  assert.equal(dep.evidence.required, 2);
}

// 11. A device cannot satisfy its own required protocol; a real provider is required.
{
  const endpoint = product('zig-self', 'device', { protocols: 'zigbee', requiresProtocols: 'zigbee' });
  const a = buildEngineeringAssessment({ rooms: roomsFor([[endpoint, 1]]), productById: mapFor([endpoint]) });
  assert.equal(a.checks.find((x) => x.ruleCode === 'COMPAT_PROTOCOL_ZIGBEE').status, 'FAIL');
}

// 12. Quote Builder integration is wired into product editing + Final lifecycle.
{
  const ui = fs.readFileSync(new URL('../src/SmartQuote.jsx', import.meta.url), 'utf8');
  for (const required of [
    'Engineering checks',
    'ENGINEERING_ROLE_OPTIONS',
    'buildEngineeringAssessment',
    'buildEngineeringValidationSnapshot',
    'engineeringValidationOverride',
    'engineeringOverrideReason',
    'Chốt báo giá với Engineering override?',
    'Engineering Rules · P2.3',
  ]) assert.ok(ui.includes(required), `missing P2.3 UI/lifecycle integration: ${required}`);
}

console.log('P2.3 engineering rules smoke: PASS');
