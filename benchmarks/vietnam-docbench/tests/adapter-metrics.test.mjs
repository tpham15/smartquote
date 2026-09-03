import test from "node:test";
import assert from "node:assert/strict";
import { smartQuoteLineKind, smartQuotePreviewToPredictionDocument } from "../adapters/smartquote-preview.mjs";
import { fieldCorrect, fieldWithinRounding } from "../lib/metrics.mjs";
import { DOCBENCH_POLICY_V1 } from "../lib/policy.mjs";

test("SmartQuote adapter preserves real non-product rows", () => {
  assert.equal(smartQuoteLineKind({ kind: "catalog_product", rowType: "item", status: "need_review" }), "product");
  assert.equal(smartQuoteLineKind({ kind: "catalog_product", rowType: "header", status: "skipped" }), "non_product");
  assert.equal(smartQuoteLineKind({ kind: "service", rowType: "item" }), "non_product");
  assert.equal(smartQuoteLineKind({ kind: "non_product" }), "non_product");
});

test("legacy preview without kind still maps product evidence as product", () => {
  const doc = smartQuotePreviewToPredictionDocument({ lines: [{ raw: { productName: "A", sku: "SKU-1", price: 100 } }] }, "d1");
  assert.equal(doc.rows[0].kind, "product");
});

test("strict price exact remains separate from within-rounding", () => {
  assert.equal(fieldCorrect("unitPrice", 1250000, 1250500), false);
  assert.equal(fieldWithinRounding("unitPrice", 1250000, 1250500, DOCBENCH_POLICY_V1), true);
  assert.equal(fieldWithinRounding("unitPrice", 1250000, 1252000, DOCBENCH_POLICY_V1), false);
});
