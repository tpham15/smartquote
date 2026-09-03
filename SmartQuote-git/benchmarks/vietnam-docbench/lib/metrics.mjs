import { normalizeSku, normalizeText, normalizeUnit, numberForField, sameNumber, tokenF1, normalizeStatus } from "./normalize.mjs";
import { DOCBENCH_POLICY_V1 } from "./policy.mjs";

const CRITICAL_FIELDS_DEFAULT = ["sku", "unitPrice"];
const PRICE_FIELDS = new Set(["unitPrice", "listPrice", "lineTotal"]);

function ratio(n, d) { return d ? n / d : null; }
function round(n, digits = 6) { return n == null ? null : Number(n.toFixed(digits)); }

function expected(field, value) {
  if (field === "sku" || field === "name" || field === "unit" || field === "section") return String(value ?? "").trim() !== "";
  return numberForField(field, value) != null;
}

export function fieldCorrect(field, gtValue, predValue) {
  switch (field) {
    case "sku": return normalizeSku(gtValue) === normalizeSku(predValue);
    case "name": return normalizeText(gtValue) === normalizeText(predValue);
    case "unit": return normalizeUnit(gtValue) === normalizeUnit(predValue);
    case "section": return normalizeText(gtValue) === normalizeText(predValue);
    case "quantity": return sameNumber(gtValue, predValue, 1e-9, "quantity");
    case "unitPrice": case "listPrice": case "lineTotal": return sameNumber(gtValue, predValue, 0, "price");
    default: return normalizeText(gtValue) === normalizeText(predValue);
  }
}

export function fieldWithinRounding(field, gtValue, predValue, policy = DOCBENCH_POLICY_V1) {
  if (!PRICE_FIELDS.has(field)) return fieldCorrect(field, gtValue, predValue);
  return sameNumber(gtValue, predValue, policy.rounding.priceAbsoluteToleranceVnd, "price");
}

export function criticalRowCorrect(gt, pred) {
  const fields = gt.acceptance?.criticalFields || CRITICAL_FIELDS_DEFAULT;
  const meaningful = fields.filter((field) => expected(field, gt.fields?.[field]));
  if (!meaningful.length) return tokenF1(gt.fields?.name, pred.fields?.name) >= 0.9;
  return meaningful.every((field) => fieldCorrect(field, gt.fields?.[field], pred.fields?.[field]));
}

export function groundingPresent(row) {
  const s = row?.source || {};
  const hasLocator = s.page != null || s.row != null || String(s.sheet || "").trim() !== "";
  const bbox = s.bbox;
  const hasBox = Array.isArray(bbox) && bbox.length === 4 && bbox.every((v) => Number.isFinite(Number(v)));
  return hasLocator || hasBox;
}

export function scoreAlignment(alignment, policy = DOCBENCH_POLICY_V1) {
  const { pairs, falseNegatives, falsePositives, gtProducts, predictedProducts } = alignment;
  const tp = pairs.length;
  const fp = falsePositives.length;
  const fn = falseNegatives.length;
  const rowPrecision = ratio(tp, tp + fp);
  const rowRecall = ratio(tp, tp + fn);
  const rowF1 = rowPrecision == null || rowRecall == null || rowPrecision + rowRecall === 0 ? null : 2 * rowPrecision * rowRecall / (rowPrecision + rowRecall);

  const fields = ["sku", "name", "unit", "quantity", "unitPrice", "listPrice", "lineTotal", "section"];
  const fieldStats = {};
  for (const field of fields) {
    let denom = 0, correct = 0, withinRounding = 0;
    for (const pair of pairs) {
      const gv = pair.gt.fields?.[field];
      if (!expected(field, gv)) continue;
      denom += 1;
      if (fieldCorrect(field, gv, pair.pred.fields?.[field])) correct += 1;
      if (fieldWithinRounding(field, gv, pair.pred.fields?.[field], policy)) withinRounding += 1;
    }
    fieldStats[field] = {
      correct,
      total: denom,
      exact: round(ratio(correct, denom)),
      ...(PRICE_FIELDS.has(field) ? {
        withinRounding,
        withinRoundingRate: round(ratio(withinRounding, denom)),
        roundingToleranceVnd: policy.rounding.priceAbsoluteToleranceVnd,
      } : {}),
    };
  }

  let nameTokenTotal = 0;
  for (const pair of pairs) nameTokenTotal += tokenF1(pair.gt.fields?.name, pair.pred.fields?.name);

  const correctCriticalPairs = pairs.filter((p) => criticalRowCorrect(p.gt, p.pred));
  const autoRows = predictedProducts.filter((r) => normalizeStatus(r.status) === "auto_approved");
  const predToPair = new Map(pairs.map((p) => [p.pred, p]));
  let safeAuto = 0;
  let unsafeAuto = 0;
  for (const row of autoRows) {
    const pair = predToPair.get(row);
    if (pair && criticalRowCorrect(pair.gt, pair.pred)) safeAuto += 1;
    else unsafeAuto += 1;
  }

  const groundingRows = predictedProducts.filter(groundingPresent).length;
  return {
    counts: { groundTruthProducts: gtProducts.length, predictedProducts: predictedProducts.length, matched: tp, falsePositive: fp, falseNegative: fn },
    rowDetection: { precision: round(rowPrecision), recall: round(rowRecall), f1: round(rowF1), falseProductRate: round(ratio(fp, predictedProducts.length)) },
    fields: fieldStats,
    nameTokenF1: round(ratio(nameTokenTotal, pairs.length)),
    trustedRows: { correct: correctCriticalPairs.length, total: gtProducts.length, accuracy: round(ratio(correctCriticalPairs.length, gtProducts.length)) },
    autoApproval: {
      total: autoRows.length,
      safe: safeAuto,
      unsafe: unsafeAuto,
      precision: round(ratio(safeAuto, autoRows.length)),
      coverage: round(ratio(safeAuto, gtProducts.length)),
      unsafeRate: round(ratio(unsafeAuto, autoRows.length)),
    },
    grounding: { present: groundingRows, total: predictedProducts.length, coverage: round(ratio(groundingRows, predictedProducts.length)) },
  };
}

export function aggregateMetricReports(reports) {
  const sums = {
    gt: 0, pred: 0, matched: 0, fp: 0, fn: 0,
    auto: 0, safeAuto: 0, unsafeAuto: 0, grounding: 0,
    trustedCorrect: 0,
    field: {},
    nameTokenWeighted: 0, nameTokenCount: 0,
  };
  for (const r of reports) {
    const c = r.metrics.counts;
    sums.gt += c.groundTruthProducts;
    sums.pred += c.predictedProducts;
    sums.matched += c.matched;
    sums.fp += c.falsePositive;
    sums.fn += c.falseNegative;
    sums.auto += r.metrics.autoApproval.total;
    sums.safeAuto += r.metrics.autoApproval.safe;
    sums.unsafeAuto += r.metrics.autoApproval.unsafe;
    sums.grounding += r.metrics.grounding.present;
    sums.trustedCorrect += r.metrics.trustedRows.correct;
    if (r.metrics.nameTokenF1 != null) { sums.nameTokenWeighted += r.metrics.nameTokenF1 * c.matched; sums.nameTokenCount += c.matched; }
    for (const [field, stat] of Object.entries(r.metrics.fields)) {
      sums.field[field] ||= { correct: 0, total: 0, withinRounding: 0, roundingToleranceVnd: stat.roundingToleranceVnd ?? null };
      sums.field[field].correct += stat.correct;
      sums.field[field].total += stat.total;
      sums.field[field].withinRounding += stat.withinRounding ?? stat.correct;
    }
  }
  const precision = ratio(sums.matched, sums.matched + sums.fp);
  const recall = ratio(sums.matched, sums.matched + sums.fn);
  const f1 = precision == null || recall == null || precision + recall === 0 ? null : 2 * precision * recall / (precision + recall);
  const fields = {};
  for (const [field, stat] of Object.entries(sums.field)) {
    fields[field] = {
      correct: stat.correct,
      total: stat.total,
      exact: round(ratio(stat.correct, stat.total)),
      ...(PRICE_FIELDS.has(field) ? {
        withinRounding: stat.withinRounding,
        withinRoundingRate: round(ratio(stat.withinRounding, stat.total)),
        roundingToleranceVnd: stat.roundingToleranceVnd,
      } : {}),
    };
  }
  return {
    counts: { groundTruthProducts: sums.gt, predictedProducts: sums.pred, matched: sums.matched, falsePositive: sums.fp, falseNegative: sums.fn },
    rowDetection: { precision: round(precision), recall: round(recall), f1: round(f1), falseProductRate: round(ratio(sums.fp, sums.pred)) },
    fields,
    nameTokenF1: round(ratio(sums.nameTokenWeighted, sums.nameTokenCount)),
    trustedRows: { correct: sums.trustedCorrect, total: sums.gt, accuracy: round(ratio(sums.trustedCorrect, sums.gt)) },
    autoApproval: { total: sums.auto, safe: sums.safeAuto, unsafe: sums.unsafeAuto, precision: round(ratio(sums.safeAuto, sums.auto)), coverage: round(ratio(sums.safeAuto, sums.gt)), unsafeRate: round(ratio(sums.unsafeAuto, sums.auto)) },
    grounding: { present: sums.grounding, total: sums.pred, coverage: round(ratio(sums.grounding, sums.pred)) },
  };
}
