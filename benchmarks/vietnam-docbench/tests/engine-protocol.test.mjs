import test from "node:test";
import assert from "node:assert/strict";
import { predictionBundle, validateEngineAdapterModule } from "../engines/protocol.mjs";

test("engine adapter contract requires id + runDocument", () => {
  assert.throws(() => validateEngineAdapterModule({ engine: { id: "x" } }), /runDocument/);
  const mod = { engine: { id: "x" }, runDocument: async () => ({ rows: [] }) };
  assert.equal(validateEngineAdapterModule(mod), mod);
});

test("prediction bundle uses frozen prediction schema", () => {
  const bundle = predictionBundle({ id: "mock", version: "1" }, [{ documentId: "doc", rows: [] }]);
  assert.equal(bundle.schemaVersion, "sq-docbench-predictions-v1");
  assert.equal(bundle.engine.id, "mock");
});
