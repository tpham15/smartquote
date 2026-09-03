export const DEFAULT_RELEASE_GATES = {
  rowRecall: 0.985,
  rowPrecision: 0.995,
  skuExact: 0.995,
  unitPriceExact: 0.997,
  autoApprovePrecision: 0.999,
  maxUnsafeAutoApproveRate: 0.001,
  groundingCoverage: 0.98,
};

function read(metrics, key) {
  switch (key) {
    case "rowRecall": return metrics.rowDetection.recall;
    case "rowPrecision": return metrics.rowDetection.precision;
    case "skuExact": return metrics.fields.sku?.exact;
    case "unitPriceExact": return metrics.fields.unitPrice?.exact;
    case "autoApprovePrecision": return metrics.autoApproval.precision;
    case "maxUnsafeAutoApproveRate": return metrics.autoApproval.unsafeRate;
    case "groundingCoverage": return metrics.grounding.coverage;
    default: return null;
  }
}

export function evaluateGates(metrics, gates = DEFAULT_RELEASE_GATES) {
  const checks = [];
  for (const [key, target] of Object.entries(gates)) {
    const actual = read(metrics, key);
    const isMax = key.startsWith("max");
    const pass = actual == null ? false : (isMax ? actual <= target : actual >= target);
    checks.push({ key, actual, target, direction: isMax ? "<=" : ">=", pass });
  }
  return { pass: checks.every((x) => x.pass), checks };
}
