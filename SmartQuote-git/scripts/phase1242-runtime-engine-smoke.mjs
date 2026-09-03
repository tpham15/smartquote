import fs from "node:fs";
import assert from "node:assert/strict";

const jsx = fs.readFileSync("src/SmartQuote.jsx", "utf8");
const api = fs.readFileSync("api/excel-template.py", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

assert.match(jsx, /res\.headers\.get\("X-SmartQuote-Excel-Engine"\)/, "frontend must verify runtime engine header");
assert.match(jsx, /engine !== "lossless_xml_v3"/, "frontend must fail closed on old Excel engine");
assert.match(jsx, /X-SmartQuote-Excel-Manifest/, "frontend must verify manifest header");
assert.match(api, /data\.get\("exportMode"\) or "lossless_xml_v3"/, "server must default to lossless engine");
assert.match(api, /send_header\("X-SmartQuote-Excel-Engine", engine_mode\)/, "server engine handshake header missing");
assert.match(api, /send_header\("X-SmartQuote-Excel-Manifest", "3"\)/, "server manifest handshake header missing");
assert.match(api, /Access-Control-Expose-Headers/, "cross-origin API must expose engine headers");
assert.equal(pkg.scripts["smoke:phase12.4.2"], "node scripts/phase1242-runtime-engine-smoke.mjs");
console.log("Phase 12.4.2 runtime engine enforcement smoke: PASS");
