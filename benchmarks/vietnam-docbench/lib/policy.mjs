// Frozen scoring policy for SmartQuote Vietnam DocBench.
// IMPORTANT: changing any matching weight, threshold, numeric parsing rule, or
// rounding tolerance changes benchmark semantics and requires a NEW policy id.
export const DOCBENCH_POLICY_V1 = Object.freeze({
  id: "sq-docbench-policy-v1",
  match: Object.freeze({
    threshold: 0.38,
    skuExactWeight: 0.56,
    skuMismatchPenalty: 0.08,
    nameTokenF1Weight: 0.28,
    unitPriceExactWeight: 0.10,
    sourceAffinityWeight: 0.18,
  }),
  numeric: Object.freeze({
    // Vietnamese commercial prices overwhelmingly use dot/comma as thousands
    // separators when exactly three digits follow the separator.
    priceSeparatorPolicy: "thousands_preferred",
    // Quantity is different: a single separator is treated as decimal first.
    // Multiple separators still imply grouped thousands.
    quantitySeparatorPolicy: "decimal_preferred",
  }),
  rounding: Object.freeze({
    // Descriptive metric only; strict exact remains the release-gate metric.
    // This separates likely thousand-dong rounding differences from OCR errors.
    priceAbsoluteToleranceVnd: 1000,
  }),
});

export const DOCBENCH_POLICIES = Object.freeze({
  [DOCBENCH_POLICY_V1.id]: DOCBENCH_POLICY_V1,
});

export function resolveDocBenchPolicy(id = DOCBENCH_POLICY_V1.id) {
  const policy = DOCBENCH_POLICIES[id];
  if (!policy) throw new Error(`Unsupported DocBench policy: ${id}`);
  return policy;
}
