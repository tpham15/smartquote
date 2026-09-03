#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import { calculateQuoteTotals, normalizePercent } from "../src/quoteMath.js";

const t = calculateQuoteTotals({ deviceTotal: 74_969_000, laborPercent: 10, vatPercent: 8 });
assert.equal(t.laborTotal, 7_496_900);
assert.equal(t.preTaxTotal, 82_465_900);
assert.equal(t.vatTotal, 6_597_272);
assert.equal(t.grand, 89_063_172);
assert.equal(normalizePercent(150, 8), 100);
assert.equal(normalizePercent(-2, 8), 0);
assert.equal(normalizePercent("bad", 8), 8);

const jsx = fs.readFileSync(new URL("../src/SmartQuote.jsx", import.meta.url), "utf8");
assert.match(jsx, /vatPercent:\s*8/);
assert.match(jsx, /VAT mặc định \(%\)/);
assert.match(jsx, /VAT báo giá \(%\)/);
assert.match(jsx, /VND\(calc\.vatTotal\)/);
assert.match(jsx, /VAT \(\$\{Number\(calc\.vatPercent/);
assert.doesNotMatch(jsx, /VAT \(0%\)<\/span><b>—<\/b>/);

const tplApi = fs.readFileSync(new URL("../api/excel-template.py", import.meta.url), "utf8");
const lossless = fs.readFileSync(new URL("../api/xlsx_lossless.py", import.meta.url), "utf8");
const builder = fs.readFileSync(new URL("../api/excel_builder.py", import.meta.url), "utf8");
assert.match(tplApi, /calc\.get\("vatTotal"\)/);
assert.match(lossless, /calc\.get\("vatTotal"\)/);
assert.match(builder, /vat_pct = float\(calc\.get\("vatPercent"/);
console.log("✓ Phase 14.0 VAT: default 8%, quote override, UI/PDF/Excel paths wired");
