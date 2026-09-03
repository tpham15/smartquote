import { normalizeSku, normalizeText, numberOrNull, tokenF1 } from "./normalize.mjs";
import { DOCBENCH_POLICY_V1 } from "./policy.mjs";

function sourceAffinity(gt, pred) {
  const a = gt.source || {};
  const b = pred.source || {};
  let score = 0;
  let comparable = 0;
  for (const key of ["page", "sheet", "row"]) {
    if (a[key] != null && a[key] !== "" && b[key] != null && b[key] !== "") {
      comparable += 1;
      const av = key === "sheet" ? normalizeText(a[key]) : String(a[key]);
      const bv = key === "sheet" ? normalizeText(b[key]) : String(b[key]);
      if (av === bv) score += 1;
    }
  }
  return comparable ? score / comparable : null;
}

export function pairAffinity(gt, pred, policy = DOCBENCH_POLICY_V1) {
  const gf = gt.fields || {};
  const pf = pred.fields || {};
  const gSku = normalizeSku(gf.sku);
  const pSku = normalizeSku(pf.sku);
  const skuComparable = !!gSku && !!pSku;
  const skuExact = skuComparable && gSku === pSku;
  const name = tokenF1(gf.name, pf.name);
  const gPrice = numberOrNull(gf.unitPrice, "price");
  const pPrice = numberOrNull(pf.unitPrice, "price");
  const priceComparable = gPrice != null && pPrice != null;
  const priceExact = priceComparable && gPrice === pPrice;
  const src = sourceAffinity(gt, pred);
  const w = policy.match;

  let score = 0;
  if (skuExact) score += w.skuExactWeight;
  else if (skuComparable) score -= w.skuMismatchPenalty;
  score += w.nameTokenF1Weight * name;
  if (priceExact) score += w.unitPriceExactWeight;
  if (src != null) score += w.sourceAffinityWeight * src;
  return Math.max(0, Math.min(1, score));
}

export function alignProductRows(gtRows, predRows, policy = DOCBENCH_POLICY_V1) {
  const gt = gtRows.filter((r) => r.kind === "product");
  const pred = predRows.filter((r) => (r.kind || "product") === "product");
  const candidates = [];
  for (let gi = 0; gi < gt.length; gi++) {
    for (let pi = 0; pi < pred.length; pi++) {
      const affinity = pairAffinity(gt[gi], pred[pi], policy);
      if (affinity >= policy.match.threshold) candidates.push({ gi, pi, affinity });
    }
  }
  candidates.sort((a, b) => b.affinity - a.affinity || a.gi - b.gi || a.pi - b.pi);
  const usedG = new Set();
  const usedP = new Set();
  const pairs = [];
  for (const c of candidates) {
    if (usedG.has(c.gi) || usedP.has(c.pi)) continue;
    usedG.add(c.gi); usedP.add(c.pi);
    pairs.push({ gt: gt[c.gi], pred: pred[c.pi], affinity: c.affinity });
  }
  return {
    pairs,
    falseNegatives: gt.filter((_, i) => !usedG.has(i)),
    falsePositives: pred.filter((_, i) => !usedP.has(i)),
    gtProducts: gt,
    predictedProducts: pred,
  };
}
