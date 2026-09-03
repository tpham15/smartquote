const INPUT_KINDS = new Set(["xlsx", "digital_pdf", "hybrid_pdf", "scan_pdf", "photo", "docx", "other"]);
const DOCUMENT_TYPES = new Set(["supplier_price_list", "old_quote", "bom", "catalog", "other"]);
const BENCHMARK_POLICIES = new Set(["sq-docbench-policy-v1"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateManifest(manifest) {
  assert(manifest && typeof manifest === "object", "manifest must be an object");
  assert(manifest.schemaVersion === "sq-docbench-manifest-v1", "manifest.schemaVersion must be sq-docbench-manifest-v1");
  assert(BENCHMARK_POLICIES.has(manifest.benchmarkPolicy), `manifest.benchmarkPolicy must be one of: ${[...BENCHMARK_POLICIES].join(", ")}`);
  assert(Array.isArray(manifest.documents), "manifest.documents must be an array");
  if (manifest.freeze != null) {
    assert(manifest.freeze && typeof manifest.freeze === "object", "manifest.freeze must be an object");
    assert(["draft", "frozen"].includes(manifest.freeze.status), "manifest.freeze.status must be draft or frozen");
    if (manifest.freeze.status === "frozen") {
      assert(Number(manifest.freeze.reviewPasses) >= 2, "frozen manifest requires freeze.reviewPasses >= 2");
      assert(manifest.freeze.secondPassSourceVerified === true, "frozen manifest requires secondPassSourceVerified=true");
      assert(manifest.freeze.groundTruthLocked === true, "frozen manifest requires groundTruthLocked=true");
    }
  }
  const ids = new Set();
  for (const [i, doc] of manifest.documents.entries()) {
    assert(doc && typeof doc === "object", `documents[${i}] must be an object`);
    assert(doc.id && typeof doc.id === "string", `documents[${i}].id is required`);
    assert(!ids.has(doc.id), `duplicate document id: ${doc.id}`);
    ids.add(doc.id);
    assert(INPUT_KINDS.has(doc.inputKind), `${doc.id}: invalid inputKind ${doc.inputKind}`);
    assert(DOCUMENT_TYPES.has(doc.documentType), `${doc.id}: invalid documentType ${doc.documentType}`);
    assert(doc.groundTruth && typeof doc.groundTruth === "string", `${doc.id}: groundTruth path is required`);
    if (doc.tags != null) assert(Array.isArray(doc.tags), `${doc.id}: tags must be an array`);
    if (doc.labelStatus != null) assert(typeof doc.labelStatus === "string", `${doc.id}: labelStatus must be a string`);
    if (manifest.freeze?.status === "frozen") {
      assert(doc.labelStatus === "frozen_second_pass_verified", `${doc.id}: frozen manifest requires labelStatus=frozen_second_pass_verified`);
      assert(typeof doc.sourceSha256 === "string" && doc.sourceSha256.length === 64, `${doc.id}: frozen manifest requires sourceSha256`);
      assert(typeof doc.groundTruthSha256 === "string" && doc.groundTruthSha256.length === 64, `${doc.id}: frozen manifest requires groundTruthSha256`);
    }
  }
  return manifest;
}

export function validateGroundTruth(gt, documentId = null) {
  assert(gt && typeof gt === "object", "ground truth must be an object");
  assert(gt.schemaVersion === "sq-docbench-ground-truth-v1", "ground truth schemaVersion must be sq-docbench-ground-truth-v1");
  assert(gt.documentId && typeof gt.documentId === "string", "ground truth documentId is required");
  if (documentId) assert(gt.documentId === documentId, `ground truth documentId mismatch: ${gt.documentId} != ${documentId}`);
  assert(Array.isArray(gt.rows), `${gt.documentId}: rows must be an array`);
  if (gt.review != null) {
    assert(gt.review && typeof gt.review === "object", `${gt.documentId}: review must be an object`);
    if (gt.review.status === "frozen") {
      assert(Number(gt.review.passes) >= 2, `${gt.documentId}: frozen review requires passes >= 2`);
      assert(gt.review.sourceVerified === true, `${gt.documentId}: frozen review requires sourceVerified=true`);
    }
  }
  const rowIds = new Set();
  for (const [i, row] of gt.rows.entries()) {
    assert(row && typeof row === "object", `${gt.documentId}.rows[${i}] must be object`);
    assert(row.rowId && typeof row.rowId === "string", `${gt.documentId}.rows[${i}].rowId is required`);
    assert(!rowIds.has(row.rowId), `${gt.documentId}: duplicate rowId ${row.rowId}`);
    rowIds.add(row.rowId);
    assert(["product", "non_product"].includes(row.kind), `${gt.documentId}.${row.rowId}: invalid kind ${row.kind}`);
    if (row.kind === "product") assert(row.fields && typeof row.fields === "object", `${gt.documentId}.${row.rowId}: product fields required`);
  }
  return gt;
}

export function validatePredictions(pred) {
  assert(pred && typeof pred === "object", "predictions must be object");
  assert(pred.schemaVersion === "sq-docbench-predictions-v1", "prediction schemaVersion must be sq-docbench-predictions-v1");
  assert(pred.engine?.id, "predictions.engine.id is required");
  assert(Array.isArray(pred.documents), "predictions.documents must be array");
  for (const [i, doc] of pred.documents.entries()) {
    assert(doc.documentId && typeof doc.documentId === "string", `predictions.documents[${i}].documentId required`);
    assert(Array.isArray(doc.rows), `${doc.documentId}: prediction rows must be array`);
  }
  return pred;
}
