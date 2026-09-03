import test from "node:test";
import assert from "node:assert/strict";
import { pairAffinity, alignProductRows } from "../lib/match.mjs";
import { DOCBENCH_POLICY_V1 } from "../lib/policy.mjs";

const gt = { kind: "product", source: { page: 1, row: 3 }, fields: { name: "Công tắc Lumi 1 nút", sku: "LM-S1", unitPrice: 1250000 } };

test("pairAffinity uses frozen policy weights", () => {
  const exact = { kind: "product", source: { page: 1, row: 3 }, fields: { name: "Công tắc Lumi 1 nút", sku: "LM-S1", unitPrice: 1250000 } };
  assert.equal(pairAffinity(gt, exact, DOCBENCH_POLICY_V1), 1);
  assert.equal(DOCBENCH_POLICY_V1.match.threshold, 0.38);
  assert.equal(DOCBENCH_POLICY_V1.match.skuExactWeight, 0.56);
});

test("changing match semantics requires a different policy object", () => {
  const weak = { kind: "product", source: {}, fields: { name: "Công tắc Lumi", sku: "WRONG", unitPrice: 1250000 } };
  const affinity = pairAffinity(gt, weak, DOCBENCH_POLICY_V1);
  assert.ok(affinity < DOCBENCH_POLICY_V1.match.threshold);
});

test("alignProductRows ignores non-product predictions", () => {
  const pred = [
    { predictionId: "p1", kind: "non_product", fields: { name: "Tổng cộng", unitPrice: 1250000 } },
    { predictionId: "p2", kind: "product", source: { page: 1, row: 3 }, fields: { name: "Công tắc Lumi 1 nút", sku: "LM-S1", unitPrice: 1250000 } },
  ];
  const result = alignProductRows([gt], pred, DOCBENCH_POLICY_V1);
  assert.equal(result.pairs.length, 1);
  assert.equal(result.predictedProducts.length, 1);
  assert.equal(result.falsePositives.length, 0);
});
