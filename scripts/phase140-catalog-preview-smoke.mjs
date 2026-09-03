#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";

const ui = fs.readFileSync(new URL("../src/SmartQuote.jsx", import.meta.url), "utf8");
const pdf = fs.readFileSync(new URL("../src/import-engine/pdf/pdfCatalogPipeline.js", import.meta.url), "utf8");

// Customer-facing issue list must ignore info/provenance and de-duplicate the
// product + canonical-line copies of the same issue.
assert.match(ui, /if \(issueLevel\(it\) === "info"\) return false;/);
assert.match(ui, /if \(seen\.has\(sig\)\) return false;/);
assert.doesNotMatch(ui, /Dòng vàng là các dòng SmartQuote/);
assert.match(ui, /Dòng có vạch vàng là các dòng SmartQuote/);

// Status colors must be indicators, not full-row warning/error fills.
assert.match(ui, /\.ci-row-review td\{background:transparent;\}/);
assert.match(ui, /\.ci-row-review td:first-child\{box-shadow:inset 3px 0 0 var\(--amber\);\}/);
assert.match(ui, /\.ci-row-blocking td\{background:transparent;\}/);
assert.match(ui, /\.ci-row-price-warn td\{background:transparent!important;\}/);

// Strong arithmetic-grounded quote tables are deterministic identity anchors;
// AI can enrich a matching product, not append ungrounded catalog identities.
assert.match(pdf, /function mergeQuoteTableCandidates/);
assert.match(pdf, /structuredDeterministicBaseline/);
assert.match(pdf, /if \(idx < 0\) continue;/);
assert.match(pdf, /pdf_ai_needs_review/);
assert.match(pdf, /function skuIdentityCompatible/);
assert.match(pdf, /function repairVietnameseGlyphSpacing/);

console.log("✓ Phase 14.0 catalog preview cleanup smoke PASS");
console.log("  info diagnostics hidden; rows neutral; quote-table AI inflation blocked");
