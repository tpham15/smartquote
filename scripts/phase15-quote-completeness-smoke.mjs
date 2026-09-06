import assert from "node:assert/strict";
import { buildQuoteCompletenessAssessment, QUOTE_COMPLETENESS_RULES } from "../src/import-engine/bom/quoteCompleteness.js";
import { buildBomQuoteVariants } from "../src/import-engine/bom/bomQuoteComposer.js";

const products = [
  { id: "cam1", name: "Camera IP 4MP AI", sku: "CAM-4MP", category: "Camera", supplier: "Hikvision", listPrice: 2500000, costPrice: 1800000 },
  { id: "nvr16", name: "Đầu ghi NVR 16 kênh", sku: "NVR-16", category: "Đầu ghi", supplier: "Hikvision", listPrice: 5200000, costPrice: 4200000 },
  { id: "hdd4", name: "Ổ cứng surveillance HDD 4TB Purple", sku: "HDD-4T", category: "Ổ cứng", supplier: "WD", listPrice: 3100000, costPrice: 2700000 },
  { id: "poe16", name: "Switch PoE 16 port", sku: "POE-16", category: "Switch PoE", supplier: "Hikvision", listPrice: 4800000, costPrice: 3900000 },
  { id: "rack6", name: "Tủ đầu ghi rack 6U", sku: "RACK-6U", category: "Tủ mạng", supplier: "OEM", listPrice: 1800000, costPrice: 1200000 },
  { id: "ups1", name: "UPS bộ lưu điện 1000VA", sku: "UPS-1K", category: "UPS", supplier: "APC", listPrice: 3400000, costPrice: 2700000 },
];

const cameraLine = {
  id: "l1",
  name: "Camera IP 4MP",
  model: "CAM-4MP",
  qty: 8,
  unit: "Cái",
  scopeId: "scope_cam",
  solutionKey: "camera_security",
  solutionLabel: "Camera an ninh",
  status: "ready",
  sourceSheet: "Camera",
  sourceRow: 2,
};

const basePreview = {
  lines: [cameraLine],
  scopes: [{ id: "scope_cam", key: "camera_security", label: "Camera an ninh", lineCount: 1, matched: 1, unresolved: 0, confidence: 95 }],
  solutionPacks: [],
};

assert(QUOTE_COMPLETENESS_RULES.some((r) => r.id === "camera.rack"), "camera rack rule must exist");

const a1 = buildQuoteCompletenessAssessment({
  bomPreview: basePreview,
  products,
  resolutionMap: { l1: "cam1" },
});

const byRule = Object.fromEntries(a1.recommendations.map((r) => [r.ruleId, r]));
assert(byRule["camera.recorder"], "8 cameras without NVR should recommend recorder");
assert.equal(byRule["camera.recorder"].level, "required");
assert.equal(byRule["camera.recorder"].qty, 1);
assert.equal(byRule["camera.recorder"].candidates[0]?.productId, "nvr16");
assert(byRule["camera.storage"], "camera system should check storage");
assert.equal(byRule["camera.storage"].candidates[0]?.productId, "hdd4");
assert(byRule["camera.poe_switch"], "camera system should check PoE");
assert.equal(byRule["camera.poe_switch"].candidates[0]?.productId, "poe16");
assert(byRule["camera.rack"], "camera system should suggest recorder rack/cabinet");
assert.equal(byRule["camera.rack"].candidates[0]?.productId, "rack6");
assert(byRule["camera.ups"], "camera system should expose optional UPS");

// Pack-template planned NVR should satisfy the recorder dependency so Phase 15
// doesn't show a duplicate NVR suggestion.
const withPlannedNvr = {
  ...basePreview,
  solutionPacks: [{
    scopeId: "scope_cam",
    selectedRecommendationId: "rec1",
    recommendations: [{
      id: "rec1",
      vendor: "Hikvision",
      template: {
        components: [
          { role: "recorder", label: "Đầu ghi / NVR", autoAdd: true, selectedProductId: "nvr16", qty: 1 },
        ],
      },
    }],
  }],
};
const a2 = buildQuoteCompletenessAssessment({
  bomPreview: withPlannedNvr,
  products,
  resolutionMap: { l1: "cam1" },
});
assert(!a2.recommendations.some((r) => r.ruleId === "camera.recorder"), "planned NVR must suppress duplicate recorder recommendation");

// Nothing is silently added before user/learned approval.
const variantsBefore = buildBomQuoteVariants({
  bomPreview: basePreview,
  products,
  resolutionMap: { l1: "cam1" },
  completenessDecisions: {},
});
const standardBefore = variantsBefore.find((v) => v.id === "standard");
assert.equal(standardBefore.completenessLineCount, 0, "completeness suggestions must not auto-add by default");

const rackRec = a1.recommendations.find((r) => r.ruleId === "camera.rack");
const decisions = {
  [rackRec.id]: { action: "add", productId: "rack6" },
};
const variantsAfter = buildBomQuoteVariants({
  bomPreview: basePreview,
  products,
  resolutionMap: { l1: "cam1" },
  completenessDecisions: decisions,
});
const standardAfter = variantsAfter.find((v) => v.id === "standard");
assert.equal(standardAfter.completenessLineCount, 1, "approved rack must become one quote line");
assert(standardAfter.rooms.some((room) => room.lines.some((line) => line.productId === "rack6")), "rack product must be present in quote rooms");
assert(standardAfter.completenessSample.some((s) => /Tủ đầu ghi|rack/i.test(s)), "diagnostic sample should explain rack addition");

// If rack already exists in the BOM, it must not be suggested again.
const previewWithRack = {
  ...basePreview,
  lines: [cameraLine, {
    id: "l2",
    name: "Tủ đầu ghi rack 6U",
    model: "RACK-6U",
    qty: 1,
    unit: "Cái",
    scopeId: "scope_cam",
    solutionKey: "camera_security",
    solutionLabel: "Camera an ninh",
    status: "ready",
  }],
};
const a3 = buildQuoteCompletenessAssessment({
  bomPreview: previewWithRack,
  products,
  resolutionMap: { l1: "cam1", l2: "rack6" },
});
assert(!a3.recommendations.some((r) => r.ruleId === "camera.rack"), "existing rack must satisfy rack rule");

console.log("✓ Phase 15 Quote Completeness smoke PASS");
console.log(`  rules: ${QUOTE_COMPLETENESS_RULES.length}`);
console.log("  camera 8x -> NVR/HDD/PoE/rack/UPS checks");
console.log("  planned pack component suppresses duplicate recommendation");
console.log("  suggestions are approval-gated; accepted accessory enters quote");
console.log("  existing accessory suppresses duplicate suggestion");
