import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, policyFingerprint, FREEZE_LOCK_SCHEMA } from '../lib/freeze.mjs';

test('canonicalJson is key-order stable', () => {
  assert.equal(canonicalJson({ b: 2, a: { d: 4, c: 3 } }), canonicalJson({ a: { c: 3, d: 4 }, b: 2 }));
});

test('policy fingerprint is deterministic and sha256-shaped', () => {
  const a = policyFingerprint('sq-docbench-policy-v1');
  const b = policyFingerprint('sq-docbench-policy-v1');
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
});

test('freeze lock schema is versioned', () => {
  assert.equal(FREEZE_LOCK_SCHEMA, 'sq-docbench-freeze-lock-v1');
});
