import fs from "node:fs";

const sx = fs.readFileSync("src/SmartQuote.jsx", "utf8");
const rootCount = (sx.match(/:root\{/g) || []).length;
if (rootCount !== 1) {
  throw new Error(`Expected exactly one :root block, found ${rootCount}.`);
}

const requiredTokens = [
  "--ink:#16181D",
  "--primary:#2947E0",
  "--amber:#B7791F",
  "--green:#0F9D63",
  "--f:\"Be Vietnam Pro\"",
  "--c-primary:var(--primary)",
  "--brand:var(--primary)",
  "--radius:var(--r-md)",
];
for (const token of requiredTokens) {
  if (!sx.includes(token)) throw new Error(`Missing unified design token: ${token}`);
}

if (sx.includes('font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif')) {
  throw new Error("Old .app system font stack should not remain as the app font.");
}

if (!sx.includes("html,body{margin:0;background:var(--canvas);color:var(--ink);font-family:var(--f)")) {
  throw new Error("Design-system body font rule is missing.");
}

console.log("Design system cleanup smoke: PASS");
