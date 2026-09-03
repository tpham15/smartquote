import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { canonicalJson } from "./lib/freeze.mjs";

export function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}
export function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}
export function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
export function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
}
export function listFiles(root) {
  const out = [];
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile()) out.push(full);
    }
  }
  walk(root);
  return out;
}
export function canonicalWithoutGeneratedAt(value) {
  if (Array.isArray(value)) return value.map(canonicalWithoutGeneratedAt);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => key !== "generatedAt")
      .map(([key, child]) => [key, canonicalWithoutGeneratedAt(child)]));
  }
  return value;
}
export function semanticHash(value) {
  return sha256Text(canonicalJson(canonicalWithoutGeneratedAt(value)));
}
export function fileInventory(root, { prefix = "artifacts" } = {}) {
  return listFiles(root).map((full) => ({
    path: path.posix.join(prefix, path.relative(root, full).split(path.sep).join("/")),
    bytes: fs.statSync(full).size,
    sha256: sha256File(full),
  }));
}
export function verifyInventory(bundleRoot, files) {
  const problems = [];
  const expected = new Set(files.map((x) => x.path));
  for (const item of files) {
    const full = path.join(bundleRoot, item.path);
    if (!fs.existsSync(full)) { problems.push({ type: "missing_file", path: item.path }); continue; }
    const stat = fs.statSync(full);
    if (!stat.isFile()) { problems.push({ type: "not_file", path: item.path }); continue; }
    if (stat.size !== item.bytes) problems.push({ type: "size_mismatch", path: item.path, expected: item.bytes, actual: stat.size });
    const actual = sha256File(full);
    if (actual !== item.sha256) problems.push({ type: "hash_mismatch", path: item.path, expected: item.sha256, actual });
  }
  for (const full of listFiles(path.join(bundleRoot, "artifacts"))) {
    const rel = path.posix.join("artifacts", path.relative(path.join(bundleRoot, "artifacts"), full).split(path.sep).join("/"));
    if (!expected.has(rel)) problems.push({ type: "unlisted_file", path: rel });
  }
  return problems;
}
