import { DOCBENCH_POLICY_V1 } from "./policy.mjs";

export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[đĐ]/g, "d")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeSku(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[–—]/g, "-")
    .trim();
}

export function normalizeUnit(value) {
  const v = normalizeText(value);
  const aliases = new Map([
    ["cai", "cai"], ["chiec", "cai"], ["pcs", "cai"], ["pc", "cai"],
    ["bo", "bo"], ["set", "bo"],
    ["m", "m"], ["met", "m"], ["meter", "m"],
    ["m2", "m2"], ["m 2", "m2"], ["m²", "m2"],
    ["m3", "m3"], ["m 3", "m3"], ["m³", "m3"],
    ["kg", "kg"], ["kilogram", "kg"],
    ["lot", "lo"], ["lo", "lo"],
  ]);
  return aliases.get(v) || v;
}

function parseGroupedOrDecimal(raw, separatorPolicy) {
  const cleaned = raw.replace(/[^0-9,.-]/g, "");
  if (!cleaned || !/[0-9]/.test(cleaned)) return null;

  const sign = cleaned.startsWith("-") ? -1 : 1;
  const unsigned = cleaned.replace(/-/g, "");
  const dots = (unsigned.match(/\./g) || []).length;
  const commas = (unsigned.match(/,/g) || []).length;

  // Mixed separators: the last separator is decimal, the other is grouping.
  // 1.234,56 -> 1234.56 ; 1,234.56 -> 1234.56
  if (dots && commas) {
    const lastDot = unsigned.lastIndexOf(".");
    const lastComma = unsigned.lastIndexOf(",");
    const decimalSep = lastDot > lastComma ? "." : ",";
    const groupingSep = decimalSep === "." ? "," : ".";
    const normalized = unsigned.split(groupingSep).join("").replace(decimalSep, ".");
    const n = Number(normalized);
    return Number.isFinite(n) ? sign * n : null;
  }

  const sep = dots ? "." : commas ? "," : "";
  if (!sep) {
    const n = Number(unsigned);
    return Number.isFinite(n) ? sign * n : null;
  }

  const count = sep === "." ? dots : commas;
  const parts = unsigned.split(sep);

  // Multiple separators with 3-digit groups are unambiguously grouped thousands.
  if (count > 1) {
    const grouped = parts.slice(1).every((p) => p.length === 3);
    if (grouped) {
      const n = Number(parts.join(""));
      return Number.isFinite(n) ? sign * n : null;
    }
    // Otherwise keep the last separator as decimal and strip earlier separators.
    const normalized = `${parts.slice(0, -1).join("")}.${parts.at(-1)}`;
    const n = Number(normalized);
    return Number.isFinite(n) ? sign * n : null;
  }

  const [left, right = ""] = parts;
  if (separatorPolicy === "decimal_preferred") {
    const n = Number(`${left || "0"}.${right}`);
    return Number.isFinite(n) ? sign * n : null;
  }

  // price/generic: exactly 3 trailing digits means thousands grouping.
  if (right.length === 3) {
    const n = Number(`${left}${right}`);
    return Number.isFinite(n) ? sign * n : null;
  }
  const n = Number(`${left || "0"}.${right}`);
  return Number.isFinite(n) ? sign * n : null;
}

export function numberOrNull(value, policy = "generic") {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = String(value).trim();
  if (!raw) return null;

  const separatorPolicy = policy === "quantity"
    ? DOCBENCH_POLICY_V1.numeric.quantitySeparatorPolicy
    : DOCBENCH_POLICY_V1.numeric.priceSeparatorPolicy;
  return parseGroupedOrDecimal(raw, separatorPolicy);
}

export function numberForField(field, value) {
  if (field === "quantity") return numberOrNull(value, "quantity");
  if (["unitPrice", "listPrice", "lineTotal"].includes(field)) return numberOrNull(value, "price");
  return numberOrNull(value, "generic");
}

export function tokens(value) {
  return normalizeText(value).split(" ").filter(Boolean);
}

export function tokenF1(a, b) {
  const aa = tokens(a);
  const bb = tokens(b);
  if (!aa.length && !bb.length) return 1;
  if (!aa.length || !bb.length) return 0;
  const counts = new Map();
  for (const t of aa) counts.set(t, (counts.get(t) || 0) + 1);
  let overlap = 0;
  for (const t of bb) {
    const c = counts.get(t) || 0;
    if (c > 0) { overlap += 1; counts.set(t, c - 1); }
  }
  const p = overlap / bb.length;
  const r = overlap / aa.length;
  return p + r ? (2 * p * r) / (p + r) : 0;
}

export function sameNumber(a, b, tolerance = 0, policy = "generic") {
  const x = numberOrNull(a, policy);
  const y = numberOrNull(b, policy);
  if (x === null && y === null) return true;
  if (x === null || y === null) return false;
  return Math.abs(x - y) <= tolerance;
}

export function normalizeStatus(value) {
  const v = String(value || "").toLowerCase();
  if (["auto_approved", "approved", "auto", "matched", "new"].includes(v)) return "auto_approved";
  if (["need_review", "review", "needs_review"].includes(v)) return "need_review";
  if (["failed", "rejected", "error"].includes(v)) return "failed";
  if (["skipped", "skip"].includes(v)) return "skipped";
  return "need_review";
}
