import test from "node:test";
import assert from "node:assert/strict";
import { numberOrNull, numberForField, normalizeUnit, tokenF1 } from "../lib/normalize.mjs";

test("price parsing prefers Vietnamese thousands separators", () => {
  assert.equal(numberOrNull("12.345", "price"), 12345);
  assert.equal(numberOrNull("12,345", "price"), 12345);
  assert.equal(numberOrNull("1.234.567", "price"), 1234567);
  assert.equal(numberOrNull("1.234,56", "price"), 1234.56);
  assert.equal(numberOrNull("1,234.56", "price"), 1234.56);
});

test("quantity parsing prefers decimal for a single separator", () => {
  assert.equal(numberOrNull("12.345", "quantity"), 12.345);
  assert.equal(numberOrNull("12,345", "quantity"), 12.345);
  assert.equal(numberOrNull("1.234.567", "quantity"), 1234567);
  assert.equal(numberForField("quantity", "2,5"), 2.5);
});

test("field-aware numeric parsing keeps prices and quantities distinct", () => {
  assert.equal(numberForField("unitPrice", "12.345"), 12345);
  assert.equal(numberForField("lineTotal", "12.345"), 12345);
  assert.equal(numberForField("quantity", "12.345"), 12.345);
});

test("normalizeUnit handles common Vietnamese aliases", () => {
  assert.equal(normalizeUnit("Chiếc"), "cai");
  assert.equal(normalizeUnit("Cái"), "cai");
  assert.equal(normalizeUnit("Bộ"), "bo");
  assert.equal(normalizeUnit("m²"), "m2");
});

test("tokenF1 is deterministic and duplicate-aware", () => {
  assert.equal(tokenF1("Công tắc Lumi", "Công tắc Lumi"), 1);
  assert.ok(tokenF1("Công tắc Lumi 2 nút", "Công tắc 2 nút") > 0.7);
  assert.equal(tokenF1("A A B", "A B"), 0.8);
});
