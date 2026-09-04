// ============================================================
// PDF Catalog Pipeline v3.0 — resilient catalog reader
//
// Design principle for real supplier PDFs:
//   - Never make the whole import depend on one huge Claude JSON response.
//   - Text extraction + deterministic row parser always runs first.
//   - Claude is used as an enhancer for small micro-chunks, not as the only source.
//   - Claude output is JSONL/loose JSON and parsed per object, so max_tokens cannot
//     kill the entire PDF if some objects are already complete.
//   - Legacy direct-document Claude fallback is only used when PDF text extraction
//     cannot produce any usable row.
// ============================================================
import { callClaudeText, callClaudeStructured, PDF_CATALOG_OUTPUT_SCHEMA, extractCatalogPdfWithClaude } from "../legacy/legacyClaudeMapper.js";
import { sanitizeCatalogProduct, sanitizeCatalogProducts } from "../productSanitizer.js";
import { buildPdfProbe, planDocumentRoute } from "../documentRouter.js";
import { assessPdfPositiveEvidence, assessPdfVisionTrust, findPdfRowEvidence, inferPdfQuoteRowEconomics, classifyPdfStructuralRow } from "./pdfEvidence.js";
import { normalizeSellableVariants, normalizePdfTableSemantics } from "./pdfVariants.js";
import { PDF_PAGE_DOCUMENT_IR_SCHEMA, PDF_ROW_RECOVERY_SCHEMA, normalizePdfDocumentIR, assembleProductsFromPdfDocumentIR, mergeRecoveredPdfRow } from "./pdfDocumentFramework.js";
import { getPdfTemplateHint, rememberPdfTemplate } from "./pdfTemplateMemory.js";
import { smartQuoteFetch } from '../../supabase/apiFetch.js';
import pdfJsWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";

const DEFAULT_MAX_CHARS_PER_CHUNK = 850;
const DEFAULT_MAX_LINES_PER_CHUNK = 8;
const DEFAULT_MAX_PAGES_PER_CHUNK = 1;
const MIN_SPLITTABLE_CHARS = 160;
const MAX_RECURSIVE_SPLIT_DEPTH = 6;
const AI_CHUNK_DELAY_MS = 120;

// Phase 14.0A — real page-image vision for scanned PDFs.
// /api/claude rejects requests above 1.2MB by default, so keep the encoded
// page image comfortably below that ceiling after JSON/prompt overhead.
const PDF_VISION_MAX_BASE64_CHARS = 1000000;
const PDF_VISION_TARGET_LONG_SIDE = 2200;
const PDF_VISION_RECOVERY_LONG_SIDE = 2500;
const PDF_VISION_MIN_LONG_SIDE = 1350;
const PDF_NATIVE_SCAN_MAX_BYTES = 2000000;

function uid(p = "imp") {
  return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizePrice(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  if (!digits) return 0;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : 0;
}

function repairVietnameseGlyphSpacing(value) {
  const source = String(value ?? "").normalize("NFC");
  const tokens = source.split(/\s+/).filter(Boolean);
  const single = (token) => /^\p{L}$/u.test(token || "");
  const marked = (token) => /^[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]$/iu.test(token || "");
  const out = [];
  for (let i = 0; i < tokens.length;) {
    if (single(tokens[i]) && marked(tokens[i + 1])) {
      if (single(tokens[i + 2])) {
        out.push(tokens[i] + tokens[i + 1] + tokens[i + 2]);
        i += 3;
      } else {
        out.push(tokens[i] + tokens[i + 1]);
        i += 2;
      }
      continue;
    }
    out.push(tokens[i]);
    i += 1;
  }
  return out.join(" ");
}


function normalizeText(value) {
  return repairVietnameseGlyphSpacing(String(value ?? "").replace(/[\uFFFE\uFFFF]/g, "-")).replace(/\s+/g, " ").trim();
}

function normalizePdfSku(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[\uFFFE\uFFFF]/g, "-")
    .replace(/\s*[-–—]\s*/g, "-")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^[-/]+|[-/]+$/g, "")
    .trim();
}

function knownLumiReleaseKind(ctx = {}) {
  const key = normalizeVietnameseKey([ctx.fileName, ctx.supplierGuess, ctx.category, ctx.name, ctx.rawText]
    .map((x) => String(x || ""))
    .join(" "));
  if (/\bbang gia smarthome 2026 0?6 0?1\b/.test(key)) return "smarthome";
  if (/\bbang gia lighting 2026 0?6 0?1\b/.test(key)) return "lighting";
  return "";
}

function isLumiLightingContext(ctx = {}) {
  const haystack = [ctx.fileName, ctx.supplierGuess, ctx.category, ctx.name, ctx.rawText]
    .map((x) => String(x || ""))
    .join(" ")
    .toLowerCase();
  if (knownLumiReleaseKind(ctx) === "lighting") return true;
  return /lumi/.test(haystack) && /(lighting|đèn|den|spotlight|downlight|led|ray nam châm|ray nam cham|mira|lyra|hera|vega)/i.test(haystack);
}

function isLumiSmarthomeContext(ctx = {}) {
  const haystack = [ctx.fileName, ctx.supplierGuess, ctx.category, ctx.name, ctx.rawText]
    .map((x) => String(x || ""))
    .join(" ")
    .toLowerCase();
  if (knownLumiReleaseKind(ctx) === "smarthome") return true;
  return /lumi/.test(haystack) && /(smarthome|smart home|công tắc|cong tac|luto|lumes|cảm biến|cam bien|module|wallpad|khóa thông minh|khoa thong minh|ai camera hub|âm thanh|am thanh|works with lumi|bộ điều khiển trung tâm|bo dieu khien trung tam)/i.test(haystack);
}

function getExpectedLumiPdfRows(ctx = {}) {
  const releaseKind = knownLumiReleaseKind(ctx);
  if (releaseKind === "smarthome") return 49;
  if (releaseKind === "lighting") return 48;

  const haystack = [ctx.fileName, ctx.supplierGuess, ctx.category, ctx.name, ctx.rawText]
    .map((x) => String(x || ""))
    .join(" ")
    .toLowerCase();
  if (/lumi/.test(haystack) && /(smarthome|smart home)/i.test(haystack)) return 49;
  if (/lumi/.test(haystack) && /(lighting|đèn|den)/i.test(haystack)) return 48;
  return 0;
}

function stripLightingVariantFromName(value) {
  return normalizeText(value)
    .replace(/\s*\((?:on\/?off|smart\s*dimmable|smart\s*tunable|tunable|dim|on off)\)\s*$/i, "")
    .replace(/\s*[–—-]\s*(?:on\/?off|smart\s*dimmable|smart\s*tunable|tunable|dim)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSourceRowNumber(value) {
  const text = normalizeText(value);
  const m = text.match(/(?:sourceRow|source row|row|stt|dòng|dong)\s*[:#-]?\s*(\d{1,3})/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const OCR_UNCERTAIN_MESSAGE = "PDF/OCR không chắc — kiểm tra lại tên/giá trước khi nhập";
const OCR_BROKEN_SKIP_MESSAGE = "Dòng PDF/OCR quá vỡ nên SmartQuote đã bỏ qua, không nhập vào catalog";
const PDF_SECTION_AS_SUPPLIER_RE = /^(bbg|bang gia|bảng giá|dong san pham|dòng sản phẩm|phu kien|phụ kiện|thanh ray|den |đèn |spotlight|downlight|led |camera|cong tac|công tắc|khoa|khóa|ket |két )/i;
const GENERIC_NAME_RE = /^(bộ|bo|md|cái|cai|phụ kiện|phu kien|hình|hinh|âm trần|am tran|nhập khẩu|nhap khau|trung|đi kèm|di kem|động cơ|dong co|sản phẩm|san pham)$/i;

function simpleIssue(code, level, message, field, suggestedFix) {
  return { code, level, message, field, suggestedFix };
}

function normalizeVietnameseKey(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function canonicalPdfBrand(value) {
  const raw = normalizeText(value);
  const m = raw.match(/\b(Lumi|Roger|Forest|OSUNO|Osuno|Kaadas|Philips|Hexa|Hikvision|Dahua)\b/i)?.[1];
  if (!m) return "";
  const key = m.toLowerCase();
  const map = { lumi: "Lumi", roger: "Roger", forest: "Forest", osuno: "OSUNO", kaadas: "Kaadas", philips: "Philips", hexa: "Hexa", hikvision: "Hikvision", dahua: "Dahua" };
  return map[key] || m;
}

function supplierFallbackName(supplierGuess = "") {
  const raw = normalizeText(supplierGuess);
  if (!raw) return "PDF Catalog";
  if (knownLumiReleaseKind({ fileName: raw, supplierGuess: raw })) return "Lumi";
  const brand = canonicalPdfBrand(raw);
  if (brand) return brand;
  const key = normalizeVietnameseKey(raw);
  if (/bang gia|bao gia|quotation|quote|bbg|gia dai ly|gia npp|gia si|don gia|thanh ray|phu kien|dong san pham/.test(key)) return "PDF Catalog";
  if (raw.length > 40) return "PDF Catalog";
  return raw;
}

function cleanPdfSupplierName(rawSupplier, supplierGuess = "") {
  const raw = normalizeText(rawSupplier);
  const fallback = supplierFallbackName(supplierGuess);
  if (!raw) return fallback;
  const brand = canonicalPdfBrand(raw);
  const key = normalizeVietnameseKey(raw);
  if (raw.length > 55) return brand || fallback;
  if (PDF_SECTION_AS_SUPPLIER_RE.test(raw) || /^(bbg|bang gia|dong san pham|phu kien|thanh ray)/.test(key)) return brand || fallback;
  if (/bang gia|bbg|gia dai ly|gia npp|gia si|don gia|bao gia/.test(key)) return brand || fallback;
  if (/^(stt|thiet bi|ma san pham|hinh anh|mo ta|don gia|gia)/.test(key)) return fallback;
  return raw;
}

function tokenCount(value) {
  return normalizeText(value).split(/\s+/).filter(Boolean).length;
}

function hasClearSku(value) {
  const sku = normalizeText(value);
  if (!sku) return false;
  return /[A-Z]/i.test(sku) && /\d/.test(sku) && sku.replace(/[^A-Z0-9]/gi, "").length >= 4;
}

function isGenericOrFragmentName(name) {
  const n = normalizeText(name);
  if (!n) return true;
  const key = normalizeVietnameseKey(n);
  if (GENERIC_NAME_RE.test(n) || GENERIC_NAME_RE.test(key)) return true;
  if (n.length < 5) return true;
  if (tokenCount(n) <= 2 && !/(den|đèn|khoa|khóa|camera|cong tac|công tắc|dong co|động cơ|ray|led|spotlight|downlight|sensor|cam bien|cảm biến)/i.test(n)) return true;
  // Fragments often produced by fallback text in scanned PDFs.
  if (!/(den|đèn|khoa|khóa|camera|cong tac|công tắc|cam bien|cảm biến|ray|dong co|động cơ|led|spotlight|downlight|nguon|nguồn|module|modun|phu kien|phụ kiện)/i.test(n) && tokenCount(n) <= 4) return true;
  return false;
}

function isOcrBrokenProduct(item, engine) {
  if (!String(engine || "").includes("heuristic")) return false;
  const name = normalizeText(item.name);
  const sku = normalizeText(item.sku);
  const raw = normalizeText(item.rawText || item._meta?.source?.rawText || "");
  const supplier = normalizeText(item.supplier);
  const category = normalizeText(item.category);
  const specs = normalizeText(item.specs);
  const noClearSku = !hasClearSku(sku);
  const fragmentName = isGenericOrFragmentName(name);
  const suspectSupplier = supplier && cleanPdfSupplierName(supplier, "") !== supplier;
  const suspectCategory = /^(bbg|bang gia|bảng giá)$/i.test(category) || category.length > 90;
  const veryLittleContext = tokenCount([name, specs, raw].join(" ")) <= 8;
  return noClearSku && (fragmentName || suspectSupplier || suspectCategory || veryLittleContext);
}

function hasProductKeyword(value) {
  return /(đèn|den|khóa|khoa|camera|công tắc|cong tac|cảm biến|cam bien|ray|động cơ|dong co|led|spotlight|downlight|nguồn|nguon|module|modun|phụ kiện|phu kien|còi|coi|chặn|chan|con lăn|con lan|door|exit|thanh ray)/i.test(normalizeText(value));
}

function hasSuspiciousPdfName(value) {
  const n = normalizeText(value);
  const key = normalizeVietnameseKey(n);
  if (!n) return true;
  if (/^(bo|bộ|md|cai|cái|hinh|hình|phu kien|phụ kiện)\s*\d*$/i.test(n)) return true;
  if (/^(bang gia|bbg|gia dai ly|gia npp|don gia|bao gia)/.test(key)) return true;
  if (tokenCount(n) <= 2 && !hasProductKeyword(n)) return true;
  return false;
}

function isHighConfidencePdfHeuristicProduct(item, engine) {
  return assessPdfPositiveEvidence(item, engine).autoApprove;
}

function applyPdfOcrQualityGuard(item, engine, supplierGuess) {
  const meta = { ...(item._meta || {}) };
  let issues = Array.isArray(meta.issues) ? [...meta.issues] : [];
  const isHeuristic = String(engine || meta.engine || "").includes("heuristic");
  const isPdf = meta.source?.type === "pdf" || String(engine || meta.engine || "").startsWith("pdf");
  const evidence = assessPdfPositiveEvidence({ ...item, _meta: meta }, engine || meta.engine);

  item.supplier = cleanPdfSupplierName(item.supplier, supplierGuess);
  meta.productEvidence = { ...(meta.productEvidence || {}), ...evidence };

  if (isPdf && isOcrBrokenProduct({ ...item, _meta: meta }, engine || meta.engine) && !evidence.signals?.quoteArithmeticMatched) {
    item._skipReason = "pdf_ocr_low_quality";
    item._pdfOcrLowQuality = true;
    meta.canonicalStatus = "skipped";
    meta.status = "skipped";
    meta.confidence = Math.min(Number(meta.confidence || 0.5), 0.38);
    issues.push(simpleIssue("pdf_ocr_low_quality", "info", OCR_BROKEN_SKIP_MESSAGE, "name", "Dòng này là mảnh OCR/fallback text, không phải sản phẩm đủ chắc"));
  } else if (isHeuristic && !evidence.positive) {
    item._skipReason = "pdf_insufficient_product_evidence";
    meta.canonicalStatus = "skipped";
    meta.status = "skipped";
    meta.confidence = Math.min(Number(meta.confidence || 0.5), 0.34);
    issues.push(simpleIssue("pdf_insufficient_product_evidence", "info", "Bỏ qua vì dòng PDF chưa có đủ bằng chứng dương để coi là sản phẩm", "name"));
  } else if (isHeuristic && evidence.autoApprove) {
    meta.canonicalStatus = "auto_approved";
    meta.status = "new";
    meta.confidence = Math.max(Number(meta.confidence || 0), evidence.signals?.quoteArithmeticMatched ? 0.92 : (hasClearSku(item.sku) ? 0.86 : 0.8));
  } else if (isHeuristic) {
    meta.canonicalStatus = "need_review";
    meta.status = "review";
    meta.confidence = Math.min(Number(meta.confidence || 0.64), 0.64);
    issues.push(simpleIssue("pdf_ocr_uncertain", "warning", "PDF chưa đủ chắc chắn — vui lòng đối chiếu tên, mã và giá với nguồn", "name"));
  } else if (isPdf) {
    // Phase 14.1: AI is only the reader. SmartQuote's deterministic evidence
    // decides whether the row is safe. Do NOT blanket-review every AI row.
    const probe = { ...item, _meta: { ...meta, issues } };
    const trust = assessPdfVisionTrust(probe, engine || meta.engine);
    meta.visionTrust = trust;
    if (trust.trusted) {
      issues = issues.filter((it) => !["pdf_ai_needs_review", "pdf_ocr_uncertain"].includes(issueCodeValue(it)));
      meta.canonicalStatus = "auto_approved";
      meta.status = "new";
      meta.confidence = Math.max(Number(meta.confidence || 0), 0.93);
    } else {
      meta.canonicalStatus = "need_review";
      meta.status = "review";
      meta.confidence = Math.min(Number(meta.confidence || 0.72), 0.68);
      const isLayoutIr = String(engine || meta.engine || "").includes("layout-ir");
      if (isLayoutIr && trust?.signals?.fieldConfidenceStrong === false) {
        const fc = trust?.signals?.fieldConfidence || {};
        const weakField = Number(fc.sku || 0) < 0.72 ? "sku" : (Number(fc.price || 0) < 0.72 ? "price" : "name");
        const label = weakField === "sku" ? "mã sản phẩm" : (weakField === "price" ? "giá" : "tên sản phẩm");
        if (!issues.some((it) => issueCodeValue(it) === "pdf_field_confidence_low")) {
          issues.push(simpleIssue("pdf_field_confidence_low", "warning", `Chỉ cần kiểm tra lại ${label}; các field khác đã có bằng chứng tốt`, weakField, "SmartQuote đã crop/đọc lại hàng này nếu có thể"));
        }
      } else if (!issues.some((it) => issueCodeValue(it) === "pdf_ai_needs_review")) {
        issues.push(simpleIssue("pdf_ai_needs_review", "warning", "PDF chưa đủ bằng chứng để tự duyệt dòng này", "name", "Kiểm tra riêng field còn thiếu/không chắc"));
      }
    }
  }

  item._meta = { ...meta, issues };
  return item;
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(String(event.target.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("Không đọc được file PDF trong trình duyệt"));
    reader.readAsDataURL(file);
  });
}

async function extractPdfTextPages(file) {
  const base64 = await fileToBase64(file);
  const res = await smartQuoteFetch("/api/pdf-extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name, base64 }),
  });

  let data;
  try {
    data = await res.json();
  } catch (err) {
    throw new Error(`Không đọc được phản hồi /api/pdf-extract: ${err.message}`);
  }

  if (!res.ok || data?.error) {
    throw new Error(data?.error || `PDF text extraction lỗi ${res.status}`);
  }

  const pages = Array.isArray(data.pages) ? data.pages : [];
  const normalizedPages = pages
    .map((p, i) => ({
      page: Number(p.page || i + 1),
      text: String(p.text || "").trim(),
      rows: Array.isArray(p.rows) ? p.rows : [],
      pageWidth: Number(p.pageWidth || 0) || null,
      pageHeight: Number(p.pageHeight || 0) || null,
    }));
  const usable = normalizedPages.filter((p) => p.text.length > 20);
  const pageCount = data.pageCount || normalizedPages.length || usable.length;
  const textChars = data.textChars || normalizedPages.reduce((s, p) => s + p.text.length, 0);

  // Important for scanned/image PDFs: pdfjs can open the PDF and count pages,
  // but text extraction returns 0 chars. Do NOT throw here, because the caller
  // can still use Claude document/vision fallback page-by-page.
  const probe = data.probe?.schemaVersion === "sq-pdf-probe-v1"
    ? data.probe
    : buildPdfProbe({
      pageCount,
      textChars,
      pages: normalizedPages.map((p) => ({ page: p.page, textChars: p.text.length })),
    });
  return {
    pageCount,
    textChars,
    pages: usable,
    rawPages: normalizedPages,
    probe,
    // Backward-compatible flag. Route planning is authoritative from Phase 13.1,
    // but old callers can still read `scanned`.
    scanned: !usable.length || textChars < 80,
  };
}

function splitLinesSmart(text) {
  return String(text || "")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function pushChunk(chunks, pageNums, lines, sequence) {
  if (!lines.length) return;
  const pages = [...new Set(pageNums)].filter(Boolean);
  chunks.push({
    id: `chunk_${sequence}`,
    fromPage: pages[0] || null,
    toPage: pages[pages.length - 1] || null,
    pages,
    text: lines.join("\n"),
    lineCount: lines.length,
  });
}

function chunkPages(pages, opts = {}) {
  const maxChars = opts.maxCharsPerChunk || DEFAULT_MAX_CHARS_PER_CHUNK;
  const maxLines = opts.maxLinesPerChunk || DEFAULT_MAX_LINES_PER_CHUNK;
  const maxPages = opts.maxPagesPerChunk || DEFAULT_MAX_PAGES_PER_CHUNK;
  const chunks = [];
  let curLines = [];
  let curPages = [];
  let curChars = 0;
  let sequence = 1;

  const flush = () => {
    pushChunk(chunks, curPages, curLines, sequence++);
    curLines = [];
    curPages = [];
    curChars = 0;
  };

  for (const page of pages) {
    const lines = splitLinesSmart(page.text);
    for (const line of lines) {
      const nextChars = curChars + line.length + 1;
      const nextPages = new Set([...curPages, page.page]).size;
      if (curLines.length && (curLines.length >= maxLines || nextChars > maxChars || nextPages > maxPages)) {
        flush();
      }
      curLines.push(line);
      curPages.push(page.page);
      curChars += line.length + 1;
    }
  }
  flush();
  return chunks;
}

function splitChunkInHalf(chunk) {
  const lines = splitLinesSmart(chunk.text);
  if (lines.length < 4 && chunk.text.length < MIN_SPLITTABLE_CHARS) return null;
  const mid = Math.max(1, Math.floor(lines.length / 2));
  const leftLines = lines.slice(0, mid);
  const rightLines = lines.slice(mid);
  if (!leftLines.length || !rightLines.length) return null;
  const pages = chunk.pages?.length ? chunk.pages : [chunk.fromPage].filter(Boolean);
  return [
    { ...chunk, id: `${chunk.id || "chunk"}a`, text: leftLines.join("\n"), lineCount: leftLines.length, pages },
    { ...chunk, id: `${chunk.id || "chunk"}b`, text: rightLines.join("\n"), lineCount: rightLines.length, pages },
  ];
}

function buildChunkPrompt({ fileName, supplierGuess, chunk, chunkIndex, totalChunks }) {
  return `Bạn là engine bóc bảng giá PDF tiếng Việt.

FILE: ${fileName}
NCC dự đoán: ${supplierGuess}
Chunk ${chunkIndex + 1}/${totalChunks}, trang ${chunk.fromPage || "?"}-${chunk.toPage || "?"}

TEXT:
${chunk.text}

Nhiệm vụ: lấy các dòng SẢN PHẨM có giá tiền.
Bỏ qua header, chính sách, VAT, bảo hành, địa chỉ, hotline, tài khoản ngân hàng.

Trả về JSONL: mỗi dòng là 1 object JSON, KHÔNG dùng mảng lớn, KHÔNG markdown.
Schema ngắn:
{"name":"tên ngắn","sku":"mã/model","category":"nhóm","supplier":"${supplierGuess}","unit":"Cái","costPrice":123456,"listPrice":0,"minRetailPrice":0,"specs":"<=80 ký tự","rawText":"<=90 ký tự","sourcePage":${chunk.fromPage || 0}}

Quy tắc giá:
- costPrice = giá đại lý/NPP/nhập hoặc ĐƠN GIÁ của sản phẩm.
- Nếu dòng báo giá có SL + Đơn giá + Thành tiền và SL × Đơn giá = Thành tiền: costPrice = Đơn giá, KHÔNG dùng Thành tiền làm listPrice.
- listPrice chỉ là giá công bố/niêm yết/giá bán lẻ khi bảng có cột đó rõ ràng; nếu không thì listPrice=0.
- Nếu giá bị dính quá dài, để costPrice=0.
- Nếu không có sản phẩm trong chunk, trả về rỗng. Không giải thích.`;
}

function isTruncationOrJsonError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("max_tokens") || msg.includes("json") || msg.includes("không phải json") || msg.includes("không hợp lệ");
}

function extractCompleteObjectsFromPossiblyTruncatedJson(raw) {
  const text = String(raw || "").replace(/```json|```/g, "").trim();
  if (!text) return [];

  // If the model obeyed and returned a normal JSON array/object, use it first.
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.filter((x) => x && typeof x === "object");
    if (parsed && typeof parsed === "object") return [parsed];
  } catch (_) {}

  const objects = [];
  const seen = new Set();

  // JSONL path: each line may be a complete object.
  for (const line of text.split(/\n+/)) {
    const candidate = line.trim().replace(/^[-*]\s*/, "").replace(/,$/, "");
    if (!candidate.startsWith("{") || !candidate.includes("}")) continue;
    try {
      const obj = JSON.parse(candidate);
      const key = JSON.stringify(obj);
      if (obj && typeof obj === "object" && !seen.has(key)) {
        seen.add(key);
        objects.push(obj);
      }
    } catch (_) {}
  }

  // Scanner path: salvage complete objects even if the array was cut mid-stream.
  const start = text.indexOf("[");
  const scanText = start >= 0 ? text.slice(start + 1) : text;
  let inString = false;
  let escapeNext = false;
  let depth = 0;
  let objStart = -1;

  for (let i = 0; i < scanText.length; i++) {
    const ch = scanText[i];
    if (inString) {
      if (escapeNext) escapeNext = false;
      else if (ch === "\\") escapeNext = true;
      else if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") { inString = true; continue; }
    if (ch === "{") {
      if (depth === 0) objStart = i;
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0 && objStart >= 0) {
        const candidate = scanText.slice(objStart, i + 1);
        try {
          const obj = JSON.parse(candidate);
          const key = JSON.stringify(obj);
          if (obj && typeof obj === "object" && !Array.isArray(obj) && !seen.has(key)) {
            seen.add(key);
            objects.push(obj);
          }
        } catch (_) {}
        objStart = -1;
      }
    }
  }

  return objects;
}

function parseClaudeProductObjects(raw) {
  return extractCompleteObjectsFromPossiblyTruncatedJson(raw)
    .filter((obj) => obj && (obj.name || obj.sku || obj.costPrice || obj.price));
}

function buildDocumentPagePrompt({ fileName, supplierGuess, pageNum, pageCount, recoveryMode = false, bandLabel = "" }) {
  const expectedRows = getExpectedLumiPdfRows({ fileName, supplierGuess, rawText: fileName });
  return `Bạn là Document AI chuyên đọc catalog/bảng giá Việt Nam.
FILE: ${fileName}
NCC: ${supplierGuess || "Chung"}
Đang đọc ${bandLabel ? `${bandLabel} của ` : ""}trang ${pageNum}/${pageCount || "?"}.

Đọc theo HÀNG VẬT LÝ của bảng:
- Mỗi STT/hàng sản phẩm = đúng 1 product; giữ sourcePage=${pageNum} và sourceRow=STT vật lý nếu nhìn thấy.
- Bỏ header, subtotal, footer, điều khoản, logo, con dấu và dòng không phải sản phẩm.
- name lấy từ cột tên/thiết bị; sku lấy từ cột mã. Không biến specs thành tên.
- Đọc HEADER trước và điền tableSemantics: phân biệt variant_price với commercial_price và quote_value.
- costPrice là field tương thích, KHÔNG phải Thành tiền, tuổi thọ 25,000/50,000h, điện áp, kích thước, CRI/IP/CCT.
- Nếu không chắc SKU hay giá: dùng "" hoặc 0, tuyệt đối không đoán.
- Đếm đúng visibleSkuCount và visiblePriceCount trên row. Nếu visibleSkuCount>=2 và các cột giá là cấu hình (On/off / Smart dimmable / Smart Tunable...), variants phải có đủ one-to-one mapping [{sku,label,variantKey,priceRole:"variant_price",price}]; không chỉ trả SKU đầu tiên.
- Nếu chỉ MỘT SKU có nhiều tier như giá đại lý/giá công bố/MSRP thì KHÔNG tạo variants; đó là commercial_price.
- Với Lumi, chỉ khi nhìn thấy đúng mã: -O ↔ On/off, -D ↔ Smart dimmable, -T ↔ Smart Tunable.
- category lấy từ section gần nhất; specs giữ thông số hữu ích ngắn gọn.
- ${recoveryMode ? "Recovery: ưu tiên không bỏ sót row; vẫn xuất row tên rõ dù SKU/giá chưa chắc." : "Ưu tiên độ chính xác và đủ hàng."}
${expectedRows ? `- File này có chỉ dấu kỳ vọng khoảng ${expectedRows} STT toàn tài liệu; không tự tạo thêm row để đủ số.` : ""}

Output bị khóa bằng JSON Schema; chỉ điền dữ liệu nhìn thấy trong ảnh.`;
}

function dataUrlBase64(dataUrl = "") {
  const comma = String(dataUrl || "").indexOf(",");
  return comma >= 0 ? String(dataUrl).slice(comma + 1) : "";
}

function jpegFromCanvasWithinBudget(canvas, maxBase64Chars = PDF_VISION_MAX_BASE64_CHARS) {
  for (const quality of [0.88, 0.8, 0.72, 0.64, 0.56]) {
    const base64 = dataUrlBase64(canvas.toDataURL("image/jpeg", quality));
    if (base64 && base64.length <= maxBase64Chars) {
      return { base64, mediaType: "image/jpeg", quality };
    }
  }
  return null;
}

async function createPdfVisionRenderer(file) {
  if (typeof document === "undefined") {
    throw new Error("PDF scan vision cần chạy trong trình duyệt để render từng trang.");
  }
  const data = new Uint8Array(await file.arrayBuffer());
  const pdfjsVision = await import("pdfjs-dist/legacy/build/pdf.mjs");

  if (!pdfjsVision.GlobalWorkerOptions.workerSrc) {
    pdfjsVision.GlobalWorkerOptions.workerSrc = pdfJsWorkerUrl;
  }

  const task = pdfjsVision.getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const pdf = await task.promise;

  async function renderPageCanvas(pageNum, targetLongSide) {
    const page = await pdf.getPage(pageNum);
    try {
      // getViewport() defaults to page.rotate, so PDFs whose raw embedded scan is
      // sideways are normalized to the exact orientation users see in a PDF viewer.
      const baseViewport = page.getViewport({ scale: 1 });
      const longSide = Math.max(baseViewport.width, baseViewport.height) || 1;
      const scale = Math.max(0.35, targetLongSide / longSide);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) throw new Error("Trình duyệt không tạo được canvas để đọc PDF scan.");
      ctx.save();
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
      await page.render({ canvasContext: ctx, viewport }).promise;
      return {
        canvas,
        width: canvas.width,
        height: canvas.height,
        rotation: Number(page.rotate || 0),
      };
    } finally {
      page.cleanup?.();
    }
  }

  async function renderPage(pageNum, { recoveryMode = false } = {}) {
    const firstTarget = recoveryMode ? PDF_VISION_RECOVERY_LONG_SIDE : PDF_VISION_TARGET_LONG_SIDE;
    const targets = [firstTarget, 2000, 1750, 1550, PDF_VISION_MIN_LONG_SIDE]
      .filter((v, i, arr) => v >= PDF_VISION_MIN_LONG_SIDE && arr.indexOf(v) === i);
    for (const target of targets) {
      const rendered = await renderPageCanvas(pageNum, target);
      const encoded = jpegFromCanvasWithinBudget(rendered.canvas);
      if (encoded) {
        return {
          ...encoded,
          width: rendered.width,
          height: rendered.height,
          rotation: rendered.rotation,
          targetLongSide: target,
        };
      }
    }
    throw new Error(`Ảnh trang ${pageNum} vẫn quá lớn sau khi nén; không gửi request vượt giới hạn Claude.`);
  }

  async function renderCrop(pageNum, bbox, { targetLongSide = 2600, padRatio = 0.035 } = {}) {
    if (!Array.isArray(bbox) || bbox.length !== 4) return null;
    const rendered = await renderPageCanvas(pageNum, targetLongSide);
    const { canvas } = rendered;
    const [x1, y1, x2, y2] = bbox.map((n) => Math.max(0, Math.min(1000, Number(n) || 0)));
    if (x2 <= x1 || y2 <= y1) return null;
    const padX = Math.round(canvas.width * padRatio);
    const padY = Math.round(canvas.height * padRatio);
    const sx = Math.max(0, Math.floor(canvas.width * x1 / 1000) - padX);
    const sy = Math.max(0, Math.floor(canvas.height * y1 / 1000) - padY);
    const ex = Math.min(canvas.width, Math.ceil(canvas.width * x2 / 1000) + padX);
    const ey = Math.min(canvas.height, Math.ceil(canvas.height * y2 / 1000) + padY);
    const sw = Math.max(1, ex - sx);
    const sh = Math.max(1, ey - sy);
    const crop = document.createElement("canvas");
    crop.width = sw;
    crop.height = sh;
    const ctx = crop.getContext("2d", { alpha: false });
    if (!ctx) return null;
    ctx.save();
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, sw, sh);
    ctx.restore();
    ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    const encoded = jpegFromCanvasWithinBudget(crop);
    if (!encoded) return null;
    return { ...encoded, width: sw, height: sh, rotation: rendered.rotation, cropOfPage: pageNum, bbox: [x1, y1, x2, y2] };
  }

  async function renderBands(pageNum) {
    const rendered = await renderPageCanvas(pageNum, 2100);
    const { canvas } = rendered;
    const bandCount = 3;
    const overlap = Math.max(24, Math.round(canvas.height * 0.035));
    const nominal = Math.ceil(canvas.height / bandCount);
    const out = [];
    for (let i = 0; i < bandCount; i++) {
      const y0 = Math.max(0, i * nominal - (i ? overlap : 0));
      const y1 = Math.min(canvas.height, (i + 1) * nominal + (i < bandCount - 1 ? overlap : 0));
      const h = Math.max(1, y1 - y0);
      const crop = document.createElement("canvas");
      crop.width = canvas.width;
      crop.height = h;
      const ctx = crop.getContext("2d", { alpha: false });
      if (!ctx) continue;
      ctx.drawImage(canvas, 0, y0, canvas.width, h, 0, 0, canvas.width, h);
      const encoded = jpegFromCanvasWithinBudget(crop);
      if (!encoded) continue;
      out.push({
        ...encoded,
        width: crop.width,
        height: crop.height,
        rotation: rendered.rotation,
        bandLabel: `vùng ngang ${i + 1}/${bandCount}`,
        bandY0: Math.round(y0 * 1000 / canvas.height),
        bandY1: Math.round(y1 * 1000 / canvas.height),
      });
    }
    return out;
  }

  return {
    pageCount: pdf.numPages,
    renderPage,
    renderBands,
    renderCrop,
    async destroy() { try { await pdf.destroy?.(); } catch (_) {} },
  };
}

function buildDocumentLayoutPrompt({ fileName, supplierGuess, pageNum, pageCount, recoveryMode = false, bandLabel = "", templateHint = "", previousSectionTitle = "" }) {
  return `Bạn là lớp DOCUMENT PERCEPTION của SmartQuote. Không được nhảy thẳng từ ảnh sang danh sách product phẳng.
FILE: ${fileName}
NCC: ${supplierGuess || "Chung"}
Đang đọc ${bandLabel ? `${bandLabel} của ` : ""}trang ${pageNum}/${pageCount || "?"}.

MỤC TIÊU: dựng lại cấu trúc bảng trước, sau đó SmartQuote sẽ tự assemble product.

QUY TẮC LAYOUT:
1) Xác định từng TABLE, HEADER, SECTION và PRODUCT ROW theo vị trí thực tế trên ảnh.
2) BBOX dùng tọa độ chuẩn hóa [x1,y1,x2,y2] trong khoảng 0..1000 của chính ảnh đang xem. Nếu thật sự không xác định được, dùng [0,0,0,0].
3) kind="product" CHỈ cho hàng bán được. Header section, subtotal, footer, ghi chú, ngày hiệu lực, chữ ký/con dấu không được thành product.
4) Nếu bảng KHÔNG có STT, sourceRow=0 và rowIndex phải là thứ tự hàng vật lý trong table/section. SmartQuote dùng rowIndex làm provenance, không được bịa STT.
5) Với ô merge/rowspan ở cột mô tả: đặt nội dung dùng chung vào section.sharedSpecs nếu nó áp dụng cho nhiều product row. Không tạo product từ ô mô tả merge và không bỏ mất nội dung đó.
6) section.title phải lấy heading gần nhất (ví dụ CÔNG TẮC LUTO, CẢM BIẾN PHỤ TRỢ, MODULE...). Nếu trang bắt đầu giữa một section và không thấy heading, để title="" thay vì đoán.
7) Đọc header để phân loại role của cột: product_name, sku, specs, unit, variant_price, commercial_price, quote_value, image, unknown.
8) Phân biệt price semantics:
   - variant_price = các cấu hình/SKU khác nhau như On/off, Smart dimmable, Smart Tunable.
   - commercial_price = giá đại lý/giá công bố/MSRP của cùng SKU.
   - quote_value = số lượng/đơn giá/thành tiền của quotation; không coi Thành tiền là giá catalog.
9) Nếu một row có nhiều SKU variant, variants phải giữ one-to-one SKU ↔ cấu hình ↔ giá. Nếu chỉ có 1 SKU + 1 đơn giá thì prices chứa một commercial_price.
10) confidence 0..100 phản ánh độ chắc chắn RIÊNG của name/sku/specs/price. Không nâng confidence chỉ vì row trông giống product.
11) Không dùng số trong điện áp, kích thước, CRI/IP/CCT, tuổi thọ 25,000/50,000h làm giá.
12) ${recoveryMode ? "Recovery mode: ưu tiên phục hồi cell mờ nhưng vẫn dùng confidence thấp nếu chưa chắc; tuyệt đối không đoán." : "Ưu tiên precision nhưng phải giữ đủ mọi product row nhìn thấy."}
${previousSectionTitle ? `13) Context trang trước kết thúc ở section "${previousSectionTitle}". Chỉ dùng làm gợi ý nếu trang hiện tại rõ ràng tiếp tục cùng bảng; không copy mù.` : ""}
${templateHint ? `14) ${templateHint}` : ""}

OUTPUT TỐI GIẢN:
- Chỉ trả đúng các key: page, pageType, tables, sections, rows, ignoredRegions.
- rows là MẢNG PHẲNG. Không lặp lại header/spec dùng chung trong từng row; dùng sectionId + sections.sharedSpecs.
- Không trả sourceFile, supplier, explanation, markdown hoặc code fence.
- BBOX chỉ cần ở cấp row trong pass đầu; không tạo bbox riêng cho từng field.
Output bị khóa bằng JSON Schema. Không giải thích ngoài schema.`;
}

async function parseDocumentPageWithClaude({ file, image, supplierGuess, pageNum, pageCount, recoveryMode = false, bandLabel = "", previousSectionTitle = "" }) {
  const templateHint = getPdfTemplateHint({ supplierGuess, fileName: file.name });
  const parsed = await callClaudeStructured({
    model: "claude-sonnet-5",
    // Sonnet 5 tokenizes equivalent JSON more densely than 4.6 and adaptive
    // thinking shares this budget. Compact IR + thinking disabled leaves enough
    // room for dense catalog pages without paying 30k tokens for normal pages.
    max_tokens: bandLabel ? 10000 : (recoveryMode ? 26000 : 22000),
    thinking: { type: "disabled" },
    output_config: {
      format: { type: "json_schema", schema: PDF_PAGE_DOCUMENT_IR_SCHEMA },
    },
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: image.mediaType || "image/jpeg", data: image.base64 } },
        { type: "text", text: buildDocumentLayoutPrompt({ fileName: file.name, supplierGuess, pageNum, pageCount, recoveryMode, bandLabel, templateHint, previousSectionTitle }) },
      ],
    }],
  });
  const ir = normalizePdfDocumentIR(parsed || {}, { pageNum });
  rememberPdfTemplate({ supplierGuess, fileName: file.name, pageIrs: [ir] });
  const assembled = assembleProductsFromPdfDocumentIR(ir, { supplierGuess });
  const products = assembled.products;
  products.documentIR = ir;
  products.documentStats = assembled.stats;
  return products;
}

async function recoverLayoutProductWithClaude({ file, image, product, supplierGuess, pageNum }) {
  const section = product?.category || "";
  const prompt = `Bạn đang kiểm chứng CHỈ MỘT HÀNG sản phẩm đã crop từ PDF catalog.
FILE: ${file.name}; NCC: ${supplierGuess || "Chung"}; trang ${pageNum}; section: ${section || "không rõ"}.
Đọc lại chính xác name, sku, unit, specs và mọi ô giá/variant nhìn thấy trong crop.
- Không tạo dữ liệu không có trên ảnh.
- Phân biệt giá variant với commercial_price/quote_value.
- confidence 0..100 cho từng field.
- Nếu mờ: để text=""/value=0 với confidence thấp, không đoán.
Output chỉ theo JSON Schema.`;
  return callClaudeStructured({
    model: "claude-sonnet-5",
    max_tokens: 4000,
    thinking: { type: "disabled" },
    output_config: { format: { type: "json_schema", schema: PDF_ROW_RECOVERY_SCHEMA } },
    messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: image.mediaType || "image/jpeg", data: image.base64 } },
      { type: "text", text: prompt },
    ] }],
  });
}

function isLayoutSplitError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  const stop = String(err?.stopReason || '').toLowerCase();
  return stop === 'max_tokens'
    || stop === 'model_context_window_exceeded'
    || msg.includes('max_tokens')
    || msg.includes('bị cắt')
    || msg.includes('không parse được json')
    || msg.includes('không phải json hợp lệ')
    || msg.includes('schema is too complex')
    || msg.includes('grammar');
}

function remapBandBbox(bbox, band) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return bbox;
  const y0 = Number(band?.bandY0);
  const y1 = Number(band?.bandY1);
  if (!Number.isFinite(y0) || !Number.isFinite(y1) || y1 <= y0) return bbox;
  const span = y1 - y0;
  const [x1, by1, x2, by2] = bbox.map((n) => Math.max(0, Math.min(1000, Number(n) || 0)));
  return [x1, Math.round(y0 + by1 * span / 1000), x2, Math.round(y0 + by2 * span / 1000)];
}

function remapBandProduct(item, band) {
  const mapped = { ...item, sourceBBox: remapBandBbox(item?.sourceBBox, band) };
  if (mapped.fieldEvidence) {
    mapped.fieldEvidence = Object.fromEntries(Object.entries(mapped.fieldEvidence).map(([k, v]) => [k, {
      ...(v || {}), bbox: remapBandBbox(v?.bbox, band),
    }]));
  }
  mapped.evidence = { ...(mapped.evidence || {}), bandRecovered: true, bandLabel: band?.bandLabel || '' };
  return mapped;
}

function dedupeLayoutPageRows(items = []) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const sku = normalizeText(item?.sku || '').toLowerCase();
    const name = normalizeText(item?.name || '').toLowerCase();
    const price = Number(item?.costPrice || item?.price || 0) || 0;
    const variants = (item?.variants || []).map((v) => `${normalizeText(v?.sku).toLowerCase()}:${Number(v?.price || 0)}`).sort().join('|');
    const key = sku ? `sku:${sku}:${price}:${variants}` : `name:${name}:${price}:${variants}`;
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

async function parsePageBands({ file, renderer, supplierGuess, pageNum, totalPages, previousSectionTitle, pageIrs, pageErrors }) {
  const bands = await renderer.renderBands(pageNum);
  const out = [];
  for (let i = 0; i < bands.length; i++) {
    const band = bands[i];
    try {
      const rows = await parseDocumentPageWithClaude({
        file, image: band, supplierGuess, pageNum, pageCount: totalPages,
        recoveryMode: true, bandLabel: band.bandLabel, previousSectionTitle,
      });
      out.push(...rows.map((item) => remapBandProduct(item, band)));
      if (rows.documentIR) pageIrs.push(rows.documentIR);
    } catch (err) {
      pageErrors.push(`Trang ${pageNum} ${band.bandLabel}: ${String(err?.message || err || 'Lỗi không xác định')}`);
    }
    if (i < bands.length - 1) await new Promise((r) => setTimeout(r, 100));
  }
  return dedupeLayoutPageRows(out);
}

async function collectDocumentPageRows({ file, renderer, supplierGuess, totalPages, onProgress, recoveryMode = false }) {
  const raw = [];
  const pageIrs = [];
  const failedPageNumbers = new Set();
  const pageErrors = [];
  let targetedRecoveries = 0;
  let previousSectionTitle = "";

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    onProgress?.({
      stage: recoveryMode ? "vision_recovery_page" : "vision_page",
      message: recoveryMode
        ? `PDF scan/ảnh: đang dựng lại layout trang ${pageNum}/${totalPages}...`
        : `PDF scan/ảnh: đang dựng Document IR trang ${pageNum}/${totalPages}...`,
      current: pageNum, total: totalPages,
    });

    let pageItems = [];
    let pageIr = null;
    let fullPageError = null;
    try {
      const image = await renderer.renderPage(pageNum, { recoveryMode });
      pageItems = await parseDocumentPageWithClaude({
        file, image, supplierGuess, pageNum, pageCount: totalPages, recoveryMode, previousSectionTitle,
      });
      pageIr = pageItems.documentIR || null;
      if (pageIr) {
        pageIrs.push(pageIr);
        const titles = (pageIr.tables || []).flatMap((t) => (t.sections || []).map((sec) => sec.title).filter(Boolean));
        if (titles.length) previousSectionTitle = titles[titles.length - 1];
      }
    } catch (err) {
      fullPageError = err;
    }

    const pageType = String(pageIr?.pageType || 'unknown');
    const needsBands = !!fullPageError
      || (!pageItems.length && pageType !== 'non_catalog')
      || (pageType === 'unknown' && pageItems.length === 0);

    if (needsBands) {
      // Dense pages often exceed a single structured-output budget; sparse end
      // pages can hide a tiny table above a large signature/footer. Split both.
      if (fullPageError && !isLayoutSplitError(fullPageError)) {
        pageErrors.push(`Trang ${pageNum} full-page: ${String(fullPageError?.message || fullPageError)}`);
      }
      const bandItems = await parsePageBands({
        file, renderer, supplierGuess, pageNum, totalPages, previousSectionTitle, pageIrs, pageErrors,
      });
      if (bandItems.length) pageItems = bandItems;
      else if (fullPageError) pageErrors.push(`Trang ${pageNum}: ${String(fullPageError?.message || fullPageError)}`);
    }

    pageItems = dedupeLayoutPageRows(pageItems);

    // Phase 14.2E — recover only weak rows, now with band bbox remapped to page coordinates.
    if (pageItems.length && typeof renderer.renderCrop === 'function') {
      const candidates = pageItems
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item?._layoutNeedsRecovery && Array.isArray(item?.sourceBBox) && item.sourceBBox.length === 4)
        .slice(0, 4);
      for (const { item, index } of candidates) {
        try {
          const crop = await renderer.renderCrop(pageNum, item.sourceBBox);
          if (!crop) continue;
          const recovered = await recoverLayoutProductWithClaude({ file, image: crop, product: item, supplierGuess, pageNum });
          pageItems[index] = mergeRecoveredPdfRow(item, recovered || {});
          targetedRecoveries += 1;
        } catch (recoverErr) {
          console.warn('PDF targeted row recovery failed', { pageNum, error: recoverErr?.message || recoverErr });
        }
      }
    }

    if (!pageItems.length && pageType !== 'non_catalog') {
      failedPageNumbers.add(pageNum);
      if (!fullPageError) pageErrors.push(`Trang ${pageNum}: không tìm thấy product row sau full-page + band recovery (pageType=${pageType}).`);
    }

    raw.push(...pageItems.map((it) => ({ ...it, sourcePage: Number(it.sourcePage || pageNum) || pageNum })));
    if (pageNum < totalPages) await new Promise((r) => setTimeout(r, recoveryMode ? 180 : 120));
  }

  return {
    raw,
    failedPages: failedPageNumbers.size,
    failedPageNumbers: [...failedPageNumbers],
    pageErrors,
    pageIrs,
    targetedRecoveries,
  };
}

async function extractCatalogPdfWithClaudeDocumentPages({ file, supplierGuess, pageCount, onProgress }) {
  const renderer = await createPdfVisionRenderer(file);
  const totalPages = Math.max(1, Math.min(Number(pageCount || renderer.pageCount || 1), 30));
  const expectedRows = getExpectedLumiPdfRows({ fileName: file.name, supplierGuess });

  try {
    const first = await collectDocumentPageRows({ file, renderer, supplierGuess, totalPages, onProgress, recoveryMode: false });
    let raw = first.raw;
    let failedPages = first.failedPages;
    let pageErrors = [...(first.pageErrors || [])];
    let successfulPages = new Set(raw.map((it) => Number(it?.sourcePage || 0)).filter((n) => n > 0));
    let items = normalizePdfItems(raw, supplierGuess, "pdf-v7-layout-ir");
    let finalItems = dedupeProducts(items, { fileName: file.name, supplierGuess });

    const lowExpectedCoverage = expectedRows && finalItems.length < Math.ceil(expectedRows * 0.96);
    const pageFailureRecovery = failedPages > 0;
    if (lowExpectedCoverage || pageFailureRecovery) {
      onProgress?.({
        stage: "vision_recovery",
        message: lowExpectedCoverage
          ? `PDF có thể thiếu dòng (${finalItems.length}/${expectedRows}). Đang dựng lại layout ở độ phân giải cao...`
          : `Có ${failedPages} trang chưa dựng được layout. Đang phục hồi riêng các trang PDF khó...`,
        current: finalItems.length,
        total: expectedRows || totalPages,
        expectedRows: expectedRows || null,
      });
      const second = await collectDocumentPageRows({ file, renderer, supplierGuess, totalPages, onProgress, recoveryMode: true });
      pageErrors = [...pageErrors, ...(second.pageErrors || [])];
      raw = [...raw, ...second.raw];
      for (const it of second.raw || []) {
        const p = Number(it?.sourcePage || 0);
        if (p > 0) successfulPages.add(p);
      }
      // Do not add first-pass + retry failures (which produced impossible 6/3).
      // After recovery, a page is failed only when neither pass produced products.
      failedPages = Math.max(0, totalPages - successfulPages.size);
      items = normalizePdfItems(raw, supplierGuess, "pdf-v7-layout-ir");
      finalItems = dedupeProducts(items, { fileName: file.name, supplierGuess });
    }

    if (!finalItems.length) {
      const uniqueErrors = [...new Set(pageErrors.map((e) => String(e || '').trim()).filter(Boolean))];
      const diagnostic = uniqueErrors.length ? ` Chi tiết: ${uniqueErrors.slice(0, 2).join(' | ')}` : '';
      throw new Error(`Claude page vision không tìm được sản phẩm (${Math.min(failedPages, totalPages)}/${totalPages} trang lỗi).${diagnostic}`);
    }

    const finalized = finalizePdfTrust(finalItems, { expectedRows, failedPages, engine: "pdf-v7-layout-ir" });
    const warning = expectedRows && finalized.items.length < expectedRows
      ? `; có thể thiếu ${Math.max(0, expectedRows - finalized.items.length)} STT`
      : "";
    onProgress?.({
      stage: "done",
      message: `PDF đọc được ${finalized.items.length} sản phẩm qua Document IR + Layout Vision${expectedRows ? ` / ${expectedRows} dự kiến` : ""}${warning}${failedPages ? `; ${failedPages} trang lỗi` : ""}.`,
      current: totalPages,
      total: totalPages,
      warningPages: failedPages,
      expectedRows,
      coverageRatio: finalized.coverageRatio,
      missingRows: finalized.missingRows,
    });
    return finalized.items;
  } finally {
    await renderer.destroy();
  }
}

async function parseTextChunkWithClaude(params, depth = 0) {
  try {
    const { text, stopReason } = await callClaudeText({
      max_tokens: 1400,
      messages: [{ role: "user", content: buildChunkPrompt(params) }],
    });
    const items = parseClaudeProductObjects(text);
    if (items.length) return items;

    if (stopReason === "max_tokens" && depth < MAX_RECURSIVE_SPLIT_DEPTH) {
      const halves = splitChunkInHalf(params.chunk);
      if (halves) {
        const out = [];
        for (let i = 0; i < halves.length; i++) {
          out.push(...await parseTextChunkWithClaude({ ...params, chunk: halves[i] }, depth + 1));
          if (i === 0) await new Promise((r) => setTimeout(r, 80));
        }
        return out;
      }
    }
    return [];
  } catch (err) {
    const salvaged = parseClaudeProductObjects(err?.rawText || err?.extractedJsonText || "");
    if (salvaged.length) return salvaged;

    const canSplit = depth < MAX_RECURSIVE_SPLIT_DEPTH && isTruncationOrJsonError(err);
    const halves = canSplit ? splitChunkInHalf(params.chunk) : null;
    if (!halves) throw err;

    const out = [];
    for (let i = 0; i < halves.length; i++) {
      try {
        out.push(...await parseTextChunkWithClaude({ ...params, chunk: halves[i] }, depth + 1));
      } catch (splitErr) {
        const partial = parseClaudeProductObjects(splitErr?.rawText || splitErr?.extractedJsonText || "");
        if (partial.length) out.push(...partial);
      }
      if (i === 0) await new Promise((r) => setTimeout(r, 80));
    }
    if (out.length) return out;
    throw err;
  }
}

function normalizePdfVariants(values = [], tableSemantics = {}) {
  return normalizeSellableVariants(values, tableSemantics).slice(0, 16);
}

function normalizePdfItems(items, supplierGuess, engine = "pdf-v3-ai-jsonl") {
  return (items || [])
    .map((it) => {
      const rawText = normalizeText(it.rawText || it.name);
      const structural = classifyPdfStructuralRow([it.name, rawText].filter(Boolean).join(" "));
      if (!structural.catalogEligible) return null;
      const sourceRow = Number(it.sourceRow || it.stt || it.row || extractSourceRowNumber(rawText) || 0) || null;
      const specs = normalizeText(it.specs);
      const tableSemantics = normalizePdfTableSemantics(it.tableSemantics || it._tableSemantics || {});
      const variants = normalizePdfVariants(it.variants, tableSemantics);
      const visibleSkuCount = Math.max(0, Number(it.visibleSkuCount || 0) || 0);
      const visiblePriceCount = Math.max(0, Number(it.visiblePriceCount || 0) || 0);
      const quoteEconomics = inferPdfQuoteRowEconomics(rawText);
      const variantPrices = variants.map((v) => Number(v.price || 0)).filter((n) => n >= 1000);
      let costPrice = quoteEconomics.matched ? quoteEconomics.unitPrice : normalizePrice(it.costPrice ?? it.price);
      if (!costPrice && variantPrices.length) costPrice = Math.min(...variantPrices);
      const contextKey = normalizeVietnameseKey([rawText, specs, it.name].join(" "));
      const priceLooksLikeLifeHours = (costPrice === 50000 || costPrice === 25000) && /tuoi tho/.test(contextKey);
      if (priceLooksLikeLifeHours) costPrice = 0;
      const name = stripLightingVariantFromName(normalizeText(it.name));
      const variantSku = variants.map((v) => v.sku).filter(Boolean).join(" / ");
      const sanitized = sanitizeCatalogProduct({
        id: uid("imp"),
        name,
        sku: normalizePdfSku(it.sku) || variantSku,
        category: normalizeText(it.category) || "Chung",
        supplier: normalizeText(it.supplier) || supplierGuess,
        unit: normalizeText(it.unit) || "Cái",
        costPrice,
        listPrice: quoteEconomics.matched ? 0 : normalizePrice(it.listPrice ?? it.publicPrice ?? it.salePrice),
        minRetailPrice: quoteEconomics.matched ? 0 : normalizePrice(it.minRetailPrice),
        specs,
        variants,
        image: "",
        _meta: {
          source: {
            type: "pdf",
            page: Number(it.sourcePage || it.page || 0) || null,
            row: sourceRow,
            rawText: rawText.slice(0, 300),
            bbox: it.sourceBBox || it.bbox || null,
            parts: Array.isArray(it.sourceParts) ? it.sourceParts.slice(0, 80) : [],
            pageWidth: Number(it.sourcePageWidth || it.pageWidth || 0) || null,
            pageHeight: Number(it.sourcePageHeight || it.pageHeight || 0) || null,
            layoutGrounded: !!(it.layoutGrounded || it?.evidence?.layoutGrounded),
            layoutRowIndex: Number(it.layoutRowIndex || it?.evidence?.layoutRowIndex || 0) || null,
            rowSourceKind: normalizeText(it.rowSourceKind || it?.evidence?.rowSourceKind || ""),
          },
          variants,
          tableSemantics,
          variantBinding: { visibleSkuCount, visiblePriceCount },
          fieldEvidence: it.fieldEvidence || it?.evidence?.fieldEvidence || {},
          productEvidence: { ...(it.evidence || {}), quoteArithmeticMatched: quoteEconomics.matched },
          quoteEconomics: quoteEconomics.matched ? quoteEconomics : null,
          status: "new",
          confidence: engine.includes("heuristic") ? 0.62 : 0.78,
          issues: [],
          engine,
        },
      }, { defaultSupplier: supplierGuess });
      const validBoundVariants = variants.filter((v) => hasClearSku(v?.sku) && Number(v?.price || 0) >= 1000);
      if (visibleSkuCount >= 2 && validBoundVariants.length < visibleSkuCount) {
        sanitized._meta = sanitized._meta || {};
        sanitized._meta.issues = [...(sanitized._meta.issues || []), simpleIssue(
          "pdf_variant_binding_incomplete",
          "warning",
          `Dòng nguồn có ${visibleSkuCount} SKU nhưng mới ghép chắc ${validBoundVariants.length} SKU ↔ giá`,
          "sku"
        )];
      }
      if (priceLooksLikeLifeHours) {
        sanitized.costPrice = 0;
        sanitized.price = 0;
        sanitized._meta = sanitized._meta || {};
        sanitized._meta.issues = [...(sanitized._meta.issues || []), simpleIssue("pdf_price_looks_like_life_hours", "warning", "Số 25,000/50,000 có vẻ là tuổi thọ, không phải giá bán", "price")];
      }
      return sanitized;
    })
    .filter(Boolean)
    .map((it) => applyPdfOcrQualityGuard(it, engine, supplierGuess))
    .filter((it) => it.name.length > 1);
}

function uniqueSlashList(values, max = 8) {
  const seen = new Set();
  const out = [];
  for (const raw of values || []) {
    for (const part of String(raw || "").split(/\s*\/\s*|\s*,\s*|\s*;\s*/)) {
      const v = normalizeText(part);
      if (!v || seen.has(v.toLowerCase())) continue;
      seen.add(v.toLowerCase());
      out.push(v);
      if (out.length >= max) return out.join(" / ");
    }
  }
  return out.join(" / ");
}

function isVariantPriceRowMerge(oldItem, newItem, opts = {}) {
  const pageA = oldItem?._meta?.source?.page || 0;
  const pageB = newItem?._meta?.source?.page || 0;
  const rowA = oldItem?._meta?.source?.row || extractSourceRowNumber(oldItem?._meta?.source?.rawText);
  const rowB = newItem?._meta?.source?.row || extractSourceRowNumber(newItem?._meta?.source?.rawText);
  if (rowA && rowB && rowA === rowB && (!pageA || !pageB || pageA === pageB)) return true;

  const context = {
    fileName: opts.fileName,
    supplierGuess: opts.supplierGuess,
    category: [oldItem?.category, newItem?.category].join(" "),
    name: [oldItem?.name, newItem?.name].join(" "),
    rawText: [oldItem?._meta?.source?.rawText, newItem?._meta?.source?.rawText].join(" "),
  };
  if (!isLumiLightingContext(context)) return false;
  if (pageA && pageB && pageA !== pageB) return false;
  const baseA = normalizeVietnameseKey(stripLightingVariantFromName(oldItem?.name));
  const baseB = normalizeVietnameseKey(stripLightingVariantFromName(newItem?.name));
  if (!baseA || !baseB || baseA !== baseB) return false;
  const hasVariantMarker = /on\/?off|smart\s*dimmable|smart\s*tunable|tunable|dim/i.test([oldItem?.name, newItem?.name, oldItem?._meta?.source?.rawText, newItem?._meta?.source?.rawText].join(" "));
  return hasVariantMarker;
}

function mergeVariantArrays(...groups) {
  return normalizePdfVariants(groups.flatMap((g) => Array.isArray(g) ? g : []));
}

function mergePdfRowVariants(oldItem, item) {
  const oldPrice = Number(oldItem.costPrice || 0) || 0;
  const newPrice = Number(item.costPrice || 0) || 0;
  const prices = [oldPrice, newPrice].filter((n) => n > 0);
  const costPrice = prices.length ? Math.min(...prices) : 0;
  const allSkus = uniqueSlashList([oldItem.sku, item.sku]);
  const issues = [...(oldItem._meta?.issues || []), ...(item._meta?.issues || [])];
  if (!issues.some((i) => i.code === "pdf_row_variants_collapsed")) {
    issues.push(simpleIssue(
      "pdf_row_variants_collapsed",
      "info",
      "PDF có nhiều SKU/giá trong cùng một STT; giữ family+variants để Phase 14.1A tách đúng từng SKU bán được",
      "price"
    ));
  }
  const variantSpecs = [
    oldItem.sku && oldPrice ? `${oldItem.sku}: ${oldPrice}` : "",
    item.sku && newPrice ? `${item.sku}: ${newPrice}` : "",
  ].filter(Boolean).join("; ");
  return {
    ...oldItem,
    name: stripLightingVariantFromName(oldItem.name || item.name),
    sku: allSkus || oldItem.sku || item.sku || "",
    costPrice,
    listPrice: Math.max(Number(oldItem.listPrice || 0) || 0, Number(item.listPrice || 0) || 0),
    minRetailPrice: 0,
    specs: [oldItem.specs, item.specs, variantSpecs && `Biến thể/giá: ${variantSpecs}`].filter(Boolean).join(" | ").slice(0, 1000),
    variants: mergeVariantArrays(oldItem.variants, item.variants, [
      oldItem.sku && oldPrice ? { sku: oldItem.sku, label: "", price: oldPrice } : null,
      item.sku && newPrice ? { sku: item.sku, label: "", price: newPrice } : null,
    ].filter(Boolean)),
    image: oldItem.image || item.image || "",
    _meta: {
      ...(oldItem._meta || {}),
      source: oldItem._meta?.source?.bbox
        ? { ...(oldItem._meta?.source || {}), row: oldItem._meta?.source?.row || item._meta?.source?.row || null }
        : { ...(item._meta?.source || oldItem._meta?.source || {}), row: item._meta?.source?.row || oldItem._meta?.source?.row || null },
      issues: issues.slice(0, 8),
      confidence: Math.max(Number(oldItem._meta?.confidence || 0), Number(item._meta?.confidence || 0), 0.78),
    },
  };
}

function issueCodeValue(issue) {
  return String(typeof issue === "string" ? issue : (issue?.code || "")).toLowerCase();
}

function productMergeQuality(item = {}) {
  const evidence = item?._meta?.productEvidence || {};
  const issues = item?._meta?.issues || [];
  let score = 0;
  if (Number(item.costPrice || 0) > 0) score += 2;
  if (hasClearSku(item.sku)) score += 2;
  if (item?._meta?.source?.bbox) score += 1;
  if (evidence.quoteArithmeticMatched) score += 4;
  if (item?._meta?.canonicalStatus === "auto_approved") score += 1;
  score -= issues.filter((it) => String(it?.level || "") === "error").length * 3;
  score -= issues.filter((it) => String(it?.level || "") === "warning").length;
  return score;
}

function chooseBetterSku(a = "", b = "") {
  const values = [normalizeText(a), normalizeText(b)].filter(Boolean);
  if (!values.length) return "";
  return values.sort((x, y) => {
    const cx = hasClearSku(x) ? 1 : 0;
    const cy = hasClearSku(y) ? 1 : 0;
    return cy - cx || y.replace(/[^A-Z0-9]/gi, "").length - x.replace(/[^A-Z0-9]/gi, "").length;
  })[0];
}

function resolvedMergedIssues(issues = [], merged = {}) {
  const validPrice = Number(merged.costPrice || 0) >= 1000 && Number(merged.costPrice || 0) <= 1_000_000_000;
  const heuristicStrong = !!merged?._meta?.productEvidence?.quoteArithmeticMatched || isHighConfidencePdfHeuristicProduct(merged, merged?._meta?.engine || "pdf-v3-text-heuristic");
  const visionStrong = assessPdfVisionTrust(merged, merged?._meta?.engine || "").trusted;
  const strong = heuristicStrong || visionStrong;
  const hasSku = hasClearSku(merged.sku) || (Array.isArray(merged.variants) && merged.variants.some((v) => hasClearSku(v?.sku)));
  const out = [];
  const seen = new Set();
  for (const it of issues || []) {
    const code = issueCodeValue(it);
    if (validPrice && ["price_unreasonable", "price_parse_failed", "price_recovered"].includes(code)) continue;
    if (strong && ["pdf_ocr_uncertain", "pdf_ai_needs_review", "pdf_insufficient_product_evidence", "pdf_scan_low_recall"].includes(code)) continue;
    if (strong && hasSku && code === "non_product_row") continue;
    if (merged.name && code === "missing_product_name") continue;
    const sig = `${code}:${typeof it === "string" ? it : (it?.message || "")}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(it);
  }
  return out.slice(0, 8);
}

function mergePdfDuplicates(oldItem, item) {
  const oldQ = productMergeQuality(oldItem);
  const newQ = productMergeQuality(item);
  const winner = newQ > oldQ ? item : oldItem;
  const other = winner === item ? oldItem : item;
  const winnerArithmetic = !!winner?._meta?.productEvidence?.quoteArithmeticMatched;
  const otherArithmetic = !!other?._meta?.productEvidence?.quoteArithmeticMatched;
  const source = winner?._meta?.source?.bbox ? winner._meta.source
    : (other?._meta?.source?.bbox ? other._meta.source : (winner?._meta?.source || other?._meta?.source || {}));
  const productEvidence = {
    ...(other?._meta?.productEvidence || {}),
    ...(winner?._meta?.productEvidence || {}),
    quoteArithmeticMatched: winnerArithmetic || otherArithmetic,
  };
  const costPrice = Number(winner.costPrice || 0) || Number(other.costPrice || 0) || 0;
  // When arithmetic proves Đơn giá × SL = Thành tiền, never preserve Thành tiền as list price.
  const listPrice = productEvidence.quoteArithmeticMatched
    ? 0
    : (Number(winner.listPrice || 0) || Number(other.listPrice || 0) || 0);
  const merged = {
    ...other,
    ...winner,
    name: normalizeText(winner.name || other.name),
    sku: chooseBetterSku(winner.sku, other.sku),
    category: normalizeText(winner.category || other.category) || "Chung",
    supplier: normalizeText(winner.supplier || other.supplier),
    unit: normalizeText(winner.unit || other.unit) || "Cái",
    costPrice,
    listPrice,
    publicPrice: listPrice,
    minRetailPrice: productEvidence.quoteArithmeticMatched ? 0 : (Number(winner.minRetailPrice || 0) || Number(other.minRetailPrice || 0) || 0),
    specs: [...new Set([oldItem.specs, item.specs].filter(Boolean))].join(" | ").slice(0, 1000),
    image: oldItem.image || item.image || "",
    _meta: {
      ...(other?._meta || {}),
      ...(winner?._meta || {}),
      source,
      productEvidence,
      quoteEconomics: winner?._meta?.quoteEconomics || other?._meta?.quoteEconomics || null,
    },
  };
  const issues = resolvedMergedIssues([...(oldItem._meta?.issues || []), ...(item._meta?.issues || [])], merged);
  const hasError = issues.some((it) => String(it?.level || "") === "error");
  const hasWarn = issues.some((it) => String(it?.level || "") === "warning");
  merged._meta.issues = issues;
  merged._meta.canonicalStatus = hasError || hasWarn ? "need_review" : "auto_approved";
  merged._meta.status = hasError || hasWarn ? "review" : "new";
  merged._meta.confidence = hasError ? 0.42 : hasWarn ? Math.min(Number(merged._meta.confidence || 0.72), 0.64) : Math.max(Number(merged._meta.confidence || 0.78), productEvidence.quoteArithmeticMatched ? 0.9 : 0.78);
  return merged;
}


function finalizePdfTrust(items = [], { expectedRows = 0, failedPages = 0, engine = "" } = {}) {
  const active = (items || []).filter((it) => it?._meta?.canonicalStatus !== "skipped" && it?._meta?.status !== "skipped");
  const physicalRows = active.map((it) => Number(it?._meta?.source?.row || 0)).filter((n) => Number.isInteger(n) && n > 0);
  const uniqueRows = new Set(physicalRows);
  const missingRows = [];
  if (expectedRows > 0) {
    for (let n = 1; n <= expectedRows; n++) if (!uniqueRows.has(n)) missingRows.push(n);
  }
  const coverageRatio = expectedRows > 0 ? active.length / expectedRows : 1;

  const finalized = (items || []).map((item) => {
    if (!item || item?._meta?.canonicalStatus === "skipped" || item?._meta?.status === "skipped") return item;
    const meta = { ...(item._meta || {}) };
    const effectiveEngine = meta.engine || engine || "";
    const trust = assessPdfVisionTrust({ ...item, _meta: meta }, effectiveEngine);
    let issues = Array.isArray(meta.issues) ? [...meta.issues] : [];
    const hardBlocking = issues.some((it) => {
      const code = issueCodeValue(it);
      const level = String(typeof it === "string" ? "" : (it?.level || "")).toLowerCase();
      return level === "error" || ["pdf_price_looks_like_life_hours", "missing_product_name", "price_parse_failed", "price_unreasonable", "pdf_ocr_low_quality", "pdf_variant_binding_incomplete"].includes(code);
    });

    if (trust.trusted && !hardBlocking) {
      issues = issues.filter((it) => !["pdf_ai_needs_review", "pdf_ocr_uncertain", "pdf_scan_low_recall", "pdf_insufficient_product_evidence"].includes(issueCodeValue(it)));
      meta.canonicalStatus = "auto_approved";
      meta.status = "new";
      meta.confidence = Math.max(Number(meta.confidence || 0), 0.94);
    } else if (issues.some((it) => String(typeof it === "string" ? "warning" : (it?.level || "")).toLowerCase() !== "info")) {
      meta.canonicalStatus = "need_review";
      meta.status = "review";
    }

    meta.issues = issues;
    meta.visionTrust = trust;
    meta.pdfDocument = {
      expectedRows: Number(expectedRows || 0) || null,
      extractedRows: active.length,
      coverageRatio,
      missingRows: missingRows.slice(0, 100),
      failedPages: Number(failedPages || 0),
    };
    return { ...item, _meta: meta };
  });
  return { items: finalized, coverageRatio, missingRows };
}

function skuIdentityKey(value = "") {
  return normalizePdfSku(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function skuIdentityCompatible(a = "", b = "") {
  const ka = skuIdentityKey(a);
  const kb = skuIdentityKey(b);
  if (!ka || !kb) return !ka || !kb;
  if (ka === kb) return true;
  const shorter = ka.length <= kb.length ? ka : kb;
  const longer = ka.length > kb.length ? ka : kb;
  // PDF/AI commonly drops a wrapped suffix (e.g. LM-2G2W vs LM-2G2W-C(G)).
  // Prefix matching is allowed only for a substantial model stem.
  return shorter.length >= 6 && longer.startsWith(shorter);
}

function canonicalProductNameKey(value = "") {
  return normalizeVietnameseKey(normalizeText(value))
    .replace(/\b(?:cai|chiec|bo|set|pcs?)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isStrongQuoteTableBaseline(items = []) {
  const active = (items || []).filter((x) => x && x?._meta?.canonicalStatus !== "skipped" && !x?._skipReason);
  if (active.length < 3) return false;
  const arithmetic = active.filter((x) => !!x?._meta?.productEvidence?.quoteArithmeticMatched).length;
  const grounded = active.filter((x) => !!x?._meta?.source?.bbox).length;
  return arithmetic >= 3 && arithmetic / active.length >= 0.7 && grounded / active.length >= 0.7;
}

function findCompatibleProductIndex(items = [], item = {}) {
  const sku = normalizePdfSku(item?.sku);
  const name = canonicalProductNameKey(item?.name);
  let best = -1;
  let bestScore = -1;
  for (let i = 0; i < items.length; i++) {
    const existing = items[i];
    const existingSku = normalizePdfSku(existing?.sku);
    const existingName = canonicalProductNameKey(existing?.name);
    let score = 0;
    if (sku && existingSku && skuIdentityKey(sku) === skuIdentityKey(existingSku)) score += 6;
    else if (sku && existingSku && skuIdentityCompatible(sku, existingSku)) score += 4;
    if (name && existingName && name === existingName) score += 5;
    else if (name && existingName && (name.includes(existingName) || existingName.includes(name)) && Math.min(name.length, existingName.length) >= 12) score += 2;
    if (Number(item?.costPrice || 0) > 0 && Number(existing?.costPrice || 0) === Number(item?.costPrice || 0)) score += 1;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return bestScore >= 5 ? best : -1;
}

function enrichDeterministicQuoteAnchor(anchor = {}, ai = {}) {
  const anchorMeta = anchor?._meta || {};
  const aiSpecs = normalizeText(ai?.specs);
  const anchorSpecs = normalizeText(anchor?.specs);
  return {
    ...anchor,
    // Identity + arithmetic-verified price stay deterministic. AI is enrichment only.
    name: normalizeText(anchor?.name),
    sku: normalizePdfSku(anchor?.sku),
    costPrice: Number(anchor?.costPrice || 0) || 0,
    listPrice: Number(anchor?.listPrice || 0) || 0,
    publicPrice: Number(anchor?.publicPrice || anchor?.listPrice || 0) || 0,
    supplier: normalizeText(anchor?.supplier || ai?.supplier),
    specs: [anchorSpecs, aiSpecs && aiSpecs !== anchorSpecs ? aiSpecs : ""].filter(Boolean).join(" | ").slice(0, 1000),
    image: anchor?.image || ai?.image || "",
    _meta: {
      ...anchorMeta,
      issues: [...(anchorMeta.issues || [])],
      canonicalStatus: anchorMeta.canonicalStatus || "auto_approved",
      status: anchorMeta.status || "new",
      confidence: Math.max(Number(anchorMeta.confidence || 0), 0.9),
      aiEnriched: true,
    },
  };
}

function mergeQuoteTableCandidates(heuristicItems = [], aiItems = [], opts = {}) {
  const base = dedupeProducts(heuristicItems, opts);
  const grounded = heuristicItems.filter((x) => !!x?._meta?.source?.bbox).length;
  const structuredDeterministicBaseline = !!opts.structuredQuoteTable
    && base.length >= 3
    && grounded >= Math.min(3, heuristicItems.length);
  if (!isStrongQuoteTableBaseline(heuristicItems) && !structuredDeterministicBaseline) {
    return dedupeProducts([...heuristicItems, ...aiItems], opts);
  }
  // When a selectable-text quotation has arithmetic-verified, grounded rows,
  // deterministic table extraction is the source of truth. AI may enrich a
  // matching product, but cannot invent extra catalog identities.
  for (const ai of aiItems || []) {
    if (!ai || ai?._meta?.canonicalStatus === "skipped" || ai?._skipReason) continue;
    const idx = findCompatibleProductIndex(base, ai);
    if (idx < 0) continue;
    base[idx] = enrichDeterministicQuoteAnchor(base[idx], ai);
  }
  return base;
}

function dedupeProducts(items, opts = {}) {
  const aliasMap = new Map();
  const out = [];

  function keysFor(item) {
    const sku = skuIdentityKey(item?.sku).toLowerCase();
    const name = canonicalProductNameKey(stripLightingVariantFromName(item?.name));
    return { sku: sku ? `sku:${sku}` : "", name: name ? `name:${name}` : "" };
  }
  function bindAliases(item, index) {
    const keys = keysFor(item);
    if (keys.sku) aliasMap.set(keys.sku, index);
    if (keys.name) aliasMap.set(keys.name, index);
  }

  for (const item of items || []) {
    if (!item || item?._meta?.canonicalStatus === "skipped" || item?._meta?.status === "skipped" || item?._skipReason) continue;
    const row = item?._meta?.source?.row || extractSourceRowNumber(item?._meta?.source?.rawText);
    const page = item?._meta?.source?.page || 0;
    const baseName = normalizeVietnameseKey(stripLightingVariantFromName(item.name));
    const lumiVariantKey = isLumiLightingContext({ fileName: opts.fileName, supplierGuess: opts.supplierGuess, category: item.category, name: item.name, rawText: item._meta?.source?.rawText })
      ? `lumi:${page || "p"}:${row || baseName}`
      : "";
    if (lumiVariantKey && aliasMap.has(lumiVariantKey)) {
      const idx = aliasMap.get(lumiVariantKey);
      out[idx] = mergePdfRowVariants(out[idx], item);
      bindAliases(out[idx], idx);
      continue;
    }

    const keys = keysFor(item);
    let idx = keys.sku && aliasMap.has(keys.sku) ? aliasMap.get(keys.sku) : null;
    if (idx == null && keys.name && aliasMap.has(keys.name)) {
      const candidateIdx = aliasMap.get(keys.name);
      const existing = out[candidateIdx];
      const a = normalizePdfSku(existing?.sku);
      const b = normalizePdfSku(item?.sku);
      // Same canonical name can merge a truncated wrapped SKU only when model
      // stems are compatible; unrelated non-empty SKUs remain separate products.
      if (!a || !b || skuIdentityCompatible(a, b)) idx = candidateIdx;
    }

    if (idx != null) {
      const old = out[idx];
      if (isVariantPriceRowMerge(old, item, opts)) out[idx] = mergePdfRowVariants(old, item);
      else out[idx] = mergePdfDuplicates(old, item);
      bindAliases(out[idx], idx);
      if (lumiVariantKey) aliasMap.set(lumiVariantKey, idx);
    } else {
      const newIdx = out.length;
      out.push(item);
      bindAliases(item, newIdx);
      if (lumiVariantKey) aliasMap.set(lumiVariantKey, newIdx);
    }
  }
  return out;
}

function looksLikeMoneyToken(token) {
  const raw = String(token || "").trim();
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length < 5 || digits.length > 10) return false;
  const value = Number(digits);
  return Number.isFinite(value) && value >= 10000 && value <= 999000000;
}

function extractMoneyValues(line) {
  const text = String(line || "");
  const matches = text.match(/(?:\d{1,3}(?:[.,]\d{3}){1,3}|\d{5,10})(?:\s?đ)?/gi) || [];
  const out = [];
  for (const m of matches) {
    if (!looksLikeMoneyToken(m)) continue;
    const n = Number(String(m).replace(/[^\d]/g, ""));
    if (Number.isFinite(n) && n > 0 && !out.includes(n)) out.push(n);
  }
  return out;
}

function pickPriceFields(prices) {
  const sensible = (prices || []).filter((n) => n >= 10000 && n <= 999000000).sort((a, b) => a - b);
  if (!sensible.length) return { costPrice: 0, listPrice: 0, minRetailPrice: 0 };
  const costPrice = sensible[0];
  const listPrice = sensible.length > 1 ? sensible[sensible.length - 1] : 0;
  const minRetailPrice = sensible.length > 2 ? sensible[1] : 0;
  return { costPrice, listPrice: listPrice > costPrice ? listPrice : 0, minRetailPrice };
}

function isLikelySkipPdfLine(line) {
  const t = normalizeText(line).toLowerCase();
  if (!t || t.length < 5) return true;
  const structural = classifyPdfStructuralRow(t);
  if (structural.kind === "header_contact" || structural.kind === "quote_summary_or_service") return true;
  return /^(stt|no\.|mã|ma sp|model|sku|tên|ten|đơn giá|don gia|giá|gia|ghi chú|ghi chu)(\s|$)/i.test(t)
    || /vat|thanh toán|thanh toan|bảo hành|bao hanh|hotline|ngân hàng|ngan hang|chuyển khoản|chuyen khoan|địa chỉ|dia chi|website|email|tổng cộng|tong cong/.test(t);
}

function isLikelySectionLine(line) {
  const t = normalizeText(line);
  if (!t || t.length < 4 || extractMoneyValues(t).length) return false;
  // Product descriptions such as "Công tắc cơ Lumes..." are not sections.
  // Accept only visually uppercase headings or explicit group/series prefixes.
  const explicitPrefix = /^(dòng sản phẩm|dong san pham|dòng|dong|nhóm|nhom|series|bảng giá|bang gia)\b/i.test(t);
  const upperish = t.toUpperCase() === t && tokenCount(t) >= 2;
  return (upperish || explicitPrefix) && t.length <= 130;
}

function extractSkuFromPdfLine(line) {
  const text = String(line || "");
  const patterns = [
    /\b[A-Z]{1,6}(?:-[A-Z0-9]{1,12}){1,8}(?:\/[A-Z0-9]{1,8})?(?:\([A-Z0-9]{1,6}\))?/g,
    /\b[A-Z]{1,6}(?:-[A-Z]{2,12}){1,3}\b/g, // e.g. LM-PCB, TU-DAUGHI
    /\b[A-Z]{2,}[0-9][A-Z0-9\-\/]{2,}(?:\([A-Z0-9]{1,6}\))?\b/g,
    /\b[0-9]{2}[A-Z][A-Z0-9\-\/]{3,}\b/g,
    /\b[A-Z]+\d+[A-Z0-9\-\/]*\b/g,
  ];
  for (const re of patterns) {
    const matches = text.match(re) || [];
    const good = matches.find((m) => !/^(VAT|VND|NPP|LED|USB|WIFI)$/i.test(m) && m.replace(/[^A-Z0-9]/gi, "").length >= 4);
    if (good) return good;
  }
  return "";
}

function cleanHeuristicName(line, sku) {
  let name = normalizeText(line)
    .replace(/(?:\d{1,3}(?:[.,]\d{3}){1,3}|\d{5,10})(?:\s?đ)?/gi, " ")
    .replace(/^\d+[.)\-\s]+/, " ")
    .replace(/\b(cái|cai|bộ|bo|chiếc|chiec|set|pcs?|vnđ|vnd|đ)\b/gi, " ")
    .replace(/\b(giá|gia|đơn giá|don gia|giá npp|gia npp|giá lẻ|gia le|giá đại lý|gia dai ly)\b/gi, " ");
  if (sku) {
    const idx = name.indexOf(sku);
    if (idx > 0) name = name.slice(0, idx);
    name = name.replace(sku, " ");
  }
  name = name.split(/\b(chất liệu|chat lieu|nguồn cấp|nguon cap|công suất|cong suat|kích thước|kich thuoc|lỗ khoét|lo khoet|màu sắc|mau sac)\b/i)[0];
  name = normalizeText(name.replace(/[|•·]+/g, " "));
  if (name.length > 90) name = name.slice(0, 90).trim();
  return name;
}

function buildSpecsFromLine(line, prices) {
  let specs = normalizeText(line);
  for (const p of prices || []) {
    specs = specs.replace(new RegExp(String(p).replace(/\B(?=(\d{3})+(?!\d))/g, "[.,]?"), "g"), " ");
  }
  specs = specs.replace(/(?:\d{1,3}(?:[.,]\d{3}){1,3}|\d{5,10})(?:\s?đ)?/gi, " ");
  specs = normalizeText(specs);
  return specs.length > 160 ? specs.slice(0, 160).trim() : specs;
}


function inferPdfTableColumnLayout(pages = []) {
  for (const page of pages || []) {
    for (const row of page.rows || []) {
      const k = normalizeVietnameseKey(row.text || "");
      if (!/\bstt\b/.test(k) || !/(don gia|gia)/.test(k) || !/(thanh tien|tong)/.test(k)) continue;
      const parts = Array.isArray(row.parts) ? row.parts : [];
      const findX = (re) => {
        const part = parts.find((p) => re.test(normalizeVietnameseKey(p.str || "")));
        return part ? Number(part.x || 0) : 0;
      };
      const nameX = findX(/^(ten|ten hang|hang hoa|san pham|thiet bi)$/) || findX(/^ten$/);
      const skuX = findX(/^(ma|sku|model)$/);
      const supplierX = findX(/^xuat$/) || findX(/^ncc$/) || findX(/^hang$/);
      const unitX = findX(/^(dvt|don vi)$/);
      const qtyX = findX(/^(sl|so luong)$/);
      const unitPriceX = findX(/^don$/) || findX(/^gia$/);
      const totalX = findX(/^thanh$/) || findX(/^tong$/);
      if (skuX && supplierX && unitX && qtyX && unitPriceX && totalX) {
        return { nameX, skuX, supplierX, unitX, qtyX, unitPriceX, totalX };
      }
    }
  }
  return null;
}

function columnParts(row = {}, minX = -Infinity, maxX = Infinity) {
  return (Array.isArray(row.parts) ? row.parts : [])
    .filter((p) => Number(p.x || 0) >= minX && Number(p.x || 0) < maxX)
    .sort((a, b) => Number(a.x || 0) - Number(b.x || 0));
}

function compactSkuFragments(parts = []) {
  const raw = parts.map((p) => String(p?.str || "")).filter(Boolean).join("");
  return normalizePdfSku(raw);
}

function reconstructPdfTableRow(page = {}, rowIndex = 0, layout = null) {
  if (!layout || !Array.isArray(page.rows) || !page.rows[rowIndex]) return null;
  const rows = page.rows;
  const row = rows[rowIndex];
  const nameMin = layout.nameX || 0;
  const nameMax = layout.skuX;
  const skuMin = layout.skuX;
  const skuMax = layout.supplierX;
  const supplierMin = (layout.skuX + layout.supplierX) / 2;
  const supplierMax = (layout.supplierX + layout.unitX) / 2;
  const unitMin = supplierMax;
  const unitMax = (layout.unitX + layout.qtyX) / 2;

  const columnTolerance = 8;
  const nameParts = [...columnParts(row, Math.max(0, nameMin - columnTolerance), nameMax - 2)];
  const skuParts = [...columnParts(row, skuMin - columnTolerance, skuMax - 4)];
  // Wrapped table cells continue on following visual lines at the same x column.
  // Only append the name fragment when that continuation line also carries SKU text;
  // otherwise it is usually the long description/specs cell.
  for (let j = rowIndex + 1; j < Math.min(rows.length, rowIndex + 4); j++) {
    const next = rows[j];
    const nextMoney = extractMoneyValues(next.text || "");
    if (nextMoney.length >= 1) break; // next product/subtotal row
    const nextSku = columnParts(next, skuMin - columnTolerance, skuMax - 4);
    if (!nextSku.length) break;
    skuParts.push(...nextSku);
    nameParts.push(...columnParts(next, Math.max(0, nameMin - columnTolerance), nameMax - 2));
  }

  const name = normalizeText(nameParts.map((p) => p.str).join(" ")).replace(/^\d+[.)\-\s]+/, "");
  const sku = compactSkuFragments(skuParts);
  const supplier = normalizeText(columnParts(row, supplierMin, supplierMax).map((p) => p.str).join(" "));
  const unit = normalizeText(columnParts(row, unitMin, unitMax).map((p) => p.str).join(" "));
  return { name, sku, supplier, unit };
}

function heuristicExtractProductsFromPdfPages(pages, supplierGuess) {
  const out = [];
  let currentCategory = "Chung";
  const tableLayout = inferPdfTableColumnLayout(pages);

  for (const page of pages || []) {
    const sourceRows = Array.isArray(page.rows) && page.rows.length
      ? page.rows.map((row, index) => ({ line: row.text || "", rowIndex: index, evidence: { row: index + 1, rawText: row.text || "", bbox: row.bbox || null, parts: row.parts || [], pageWidth: page.pageWidth || null, pageHeight: page.pageHeight || null, matchScore: 1 } }))
      : splitLinesSmart(page.text).map((line, index) => ({ line, rowIndex: index, evidence: null }));
    for (const entry of sourceRows) {
      const clean = normalizeText(entry.line);
      if (!clean) continue;
      const structural = classifyPdfStructuralRow(clean);
      if (structural.kind === "section_subtotal") {
        currentCategory = structural.category.slice(0, 90) || currentCategory;
        continue;
      }
      if (!structural.catalogEligible) continue;
      if (isLikelySectionLine(clean)) {
        currentCategory = clean.replace(/^bảng giá\s*/i, "").slice(0, 90) || currentCategory;
        continue;
      }
      if (isLikelySkipPdfLine(clean)) continue;

      const prices = extractMoneyValues(clean);
      if (!prices.length) continue;
      const quoteEconomics = inferPdfQuoteRowEconomics(clean);
      const { costPrice, listPrice, minRetailPrice } = quoteEconomics.matched
        ? { costPrice: quoteEconomics.unitPrice, listPrice: 0, minRetailPrice: 0 }
        : pickPriceFields(prices);
      if (!costPrice) continue;

      const reconstructed = reconstructPdfTableRow(page, entry.rowIndex, tableLayout);
      const sku = normalizeText(reconstructed?.sku) || extractSkuFromPdfLine(clean);
      let name = normalizeText(reconstructed?.name) || cleanHeuristicName(clean, sku);
      if ((!name || name.length < 3) && sku) name = `${currentCategory} ${sku}`;
      if (!name || name.length < 3) continue;
      const unitText = normalizeText(reconstructed?.unit);
      const explicitUnit = !!unitText || /\b(bộ|bo|set|cái|cai|chiếc|chiec|m|mét|met|cuộn|cuon|hộp|hop|tủ|tu)\b/i.test(clean);
      const evidence = entry.evidence || findPdfRowEvidence(page, clean);

      out.push({
        name,
        sku,
        category: currentCategory || "Chung",
        supplier: normalizeText(reconstructed?.supplier) || supplierGuess,
        unit: unitText || (/\b(bộ|bo|set)\b/i.test(clean) ? "Bộ" : "Cái"),
        costPrice,
        listPrice,
        minRetailPrice,
        specs: buildSpecsFromLine(clean, prices),
        rawText: clean.slice(0, 160),
        sourcePage: page.page,
        sourceRow: evidence?.row || null,
        sourceBBox: evidence?.bbox || null,
        sourceParts: evidence?.parts || [],
        sourcePageWidth: evidence?.pageWidth || page.pageWidth || null,
        sourcePageHeight: evidence?.pageHeight || page.pageHeight || null,
        quoteQuantity: quoteEconomics.matched ? quoteEconomics.quantity : 0,
        quoteLineTotal: quoteEconomics.matched ? quoteEconomics.lineTotal : 0,
        evidence: {
          hasPrice: true,
          hasSku: !!sku,
          hasProductKeyword: hasProductKeyword([name, clean, currentCategory].join(" ")),
          hasExplicitUnit: explicitUnit,
          hasGrounding: !!evidence?.bbox,
          quoteArithmeticMatched: quoteEconomics.matched,
          tableLayoutDetected: !!tableLayout,
          category: currentCategory || "Chung",
        },
      });
    }
  }

  return out;
}


async function extractScannedPdfV6({ file, supplierGuess, pageCount, onProgress }) {
  const expectedRows = getExpectedLumiPdfRows({ fileName: file.name, supplierGuess });
  if (expectedRows && Number(file?.size || 0) > 0 && Number(file.size) <= PDF_NATIVE_SCAN_MAX_BYTES) {
    try {
      onProgress?.({ stage: "native_pdf", message: `Đang đọc PDF scan trực tiếp bằng Claude Document AI (${expectedRows} STT kỳ vọng)...` });
      const raw = await extractCatalogPdfWithClaude({ file, supplierGuess });
      let items = normalizePdfItems(raw, supplierGuess, "pdf-v6-native-structured");
      items = dedupeProducts(items, { fileName: file.name, supplierGuess });
      const finalized = finalizePdfTrust(items, { expectedRows, failedPages: 0, engine: "pdf-v6-native-structured" });
      const trusted = finalized.items.filter((it) => it?._meta?.canonicalStatus === "auto_approved").length;
      if (finalized.items.length >= Math.ceil(expectedRows * 0.96) && trusted >= Math.ceil(finalized.items.length * 0.9)) {
        onProgress?.({ stage: "done", message: `Native PDF đọc ${finalized.items.length}/${expectedRows} sản phẩm; ${trusted} dòng đủ bằng chứng tự duyệt.`, expectedRows, coverageRatio: finalized.coverageRatio });
        return finalized.items;
      }
      onProgress?.({ stage: "native_pdf_fallback", message: `Native PDF mới chắc ${trusted}/${finalized.items.length} dòng. Chuyển sang đọc ảnh từng trang để kiểm chứng...` });
    } catch (err) {
      console.warn("Native PDF structured extraction failed; falling back to page vision", err?.message || err);
      onProgress?.({ stage: "native_pdf_fallback", message: `Native PDF chưa đủ ổn (${err?.message || "unknown"}). Chuyển sang ảnh từng trang...` });
    }
  }
  return extractCatalogPdfWithClaudeDocumentPages({ file, supplierGuess, pageCount, onProgress });
}

/**
 * Parse PDF catalog via resilient v3 pipeline.
 * @param {{file:File, supplierGuess:string, onProgress?:(event:Object)=>void, maxPagesPerChunk?:number, maxCharsPerChunk?:number, maxLinesPerChunk?:number}} params
 * @returns {Promise<Array>} UI product shape
 */
export async function parsePdfCatalogWithPipeline(params) {
  const { file, supplierGuess, onProgress } = params;
  let extracted = null;
  let textPipelineError = null;

  try {
    onProgress?.({ stage: "extract_text", message: "Đang tách text từng trang từ PDF..." });
    extracted = await extractPdfTextPages(file);
  } catch (err) {
    textPipelineError = err;
  }

  if (!extracted) {
    onProgress?.({
      stage: "vision_fallback",
      message: `PDF không tách text được (${textPipelineError?.message || "unknown"}). Chuyển sang render ảnh từng trang...`,
    });
    try {
      return await extractScannedPdfV6({
        file,
        supplierGuess,
        pageCount: null,
        onProgress,
      });
    } catch (visionErr) {
      throw new Error(`PDF không đọc được. Text extraction lỗi: ${textPipelineError?.message || "unknown"}. Page-image vision lỗi: ${visionErr?.message || visionErr}`);
    }
  }

  const route = planDocumentRoute({
    fileName: file.name,
    mimeType: file.type || "application/pdf",
    explicitType: params.documentType || "",
    sampleText: extracted.pages.slice(0, 2).map((p) => p.text).join("\n").slice(0, 4000),
    pdfProbe: extracted.probe,
  });
  onProgress?.({
    stage: "route",
    message: `Document Router: ${route.inputKind} → ${route.primaryEngine}`,
    route,
  });

  if (route.inputKind === "scan_pdf" || !extracted.pages.length) {
    onProgress?.({
      stage: "vision_fallback",
      message: `PDF có ${extracted.pageCount || "?"} trang nhưng gần như không có text selectable. Chuyển sang AI đọc từng trang ảnh...`,
      pageCount: extracted.pageCount,
      textChars: extracted.textChars,
      route,
    });
    try {
      return await extractScannedPdfV6({
        file,
        supplierGuess,
        pageCount: extracted.pageCount,
        onProgress,
      });
    } catch (pageErr) {
      // Scan PDFs must never fall back to re-sending the whole PDF to Claude.
      // That path multiplies payload size and is exactly what caused 413 on pilot files.
      throw new Error(`PDF scan/ảnh không đọc được bằng page-image vision: ${pageErr?.message || pageErr}`);
    }
  }

  onProgress?.({
    stage: "chunk",
    message: `Đã đọc ${extracted.pageCount} trang, ${extracted.textChars} ký tự text`,
    pageCount: extracted.pageCount,
    textChars: extracted.textChars,
  });

  // Deterministic baseline always runs. This is the safety net for catalog PDFs.
  const heuristicItems = normalizePdfItems(
    heuristicExtractProductsFromPdfPages(extracted.pages, supplierGuess),
    supplierGuess,
    "pdf-v3-text-heuristic",
  );

  const chunks = chunkPages(extracted.pages, params);
  const aiRaw = [];
  let failedChunks = 0;
  let skippedAi = false;

  // If deterministic extraction already found many rows, AI still improves names/category,
  // but we cap calls to avoid slow/expensive imports on very long PDFs.
  const maxAiChunks = Number(params.maxAiChunks || 40);

  for (let i = 0; i < chunks.length; i++) {
    if (i >= maxAiChunks && heuristicItems.length >= 20) {
      skippedAi = true;
      break;
    }
    const chunk = chunks[i];
    onProgress?.({
      stage: "parse_chunk",
      message: `AI đang bóc PDF phần ${i + 1}/${chunks.length} (trang ${chunk.fromPage || "?"}, ${chunk.lineCount || 0} dòng)...`,
      current: i + 1,
      total: chunks.length,
    });
    try {
      const parsed = await parseTextChunkWithClaude({
        fileName: file.name,
        supplierGuess,
        chunk,
        chunkIndex: i,
        totalChunks: chunks.length,
      });
      aiRaw.push(...parsed);
    } catch (err) {
      failedChunks += 1;
      console.warn("PDF AI chunk failed", { chunk: i + 1, error: err?.message || err });
    }
    if (i < chunks.length - 1) await new Promise((r) => setTimeout(r, AI_CHUNK_DELAY_MS));
  }

  const aiItems = normalizePdfItems(aiRaw, supplierGuess, "pdf-v3-ai-jsonl");
  const structuredQuoteTable = !!inferPdfTableColumnLayout(extracted.pages);
  const finalItems = mergeQuoteTableCandidates(heuristicItems, aiItems, { fileName: file.name, supplierGuess, structuredQuoteTable });

  if (finalItems.length) {
    const warn = [];
    if (failedChunks) warn.push(`${failedChunks} phần AI lỗi nhưng đã dùng fallback text`);
    if (skippedAi) warn.push(`PDF dài: chỉ dùng AI cho ${maxAiChunks} phần đầu, phần còn lại dùng fallback text`);
    const heuristicMsg = heuristicItems.length ? `, fallback text ${heuristicItems.length} dòng` : "";
    const aiMsg = aiItems.length ? `, AI ${aiItems.length} dòng` : "";
    onProgress?.({
      stage: "done",
      message: `PDF đọc được ${finalItems.length} sản phẩm${heuristicMsg}${aiMsg}${warn.length ? ` (${warn.join("; ")})` : ""}`,
      warningChunks: failedChunks,
      skippedAi,
      route,
    });
    return finalizePdfTrust(finalItems, { expectedRows: 0, failedPages: failedChunks, engine: "pdf-v3-mixed" }).items;
  }

  // Only reach legacy document mode if text extraction worked but produced no usable row.
  onProgress?.({
    stage: "fallback",
    message: "PDF text đã đọc được nhưng chưa tìm thấy dòng giá. Thử Claude đọc document trực tiếp...",
  });
  try {
    const legacyItems = await extractCatalogPdfWithClaude({ file, supplierGuess });
    const finalLegacy = sanitizeCatalogProducts(normalizePdfItems(legacyItems, supplierGuess, "pdf-legacy-document-fallback"), { defaultSupplier: supplierGuess });
    if (!finalLegacy.length) throw new Error("legacy không tìm được sản phẩm");
    const dedupedLegacy = dedupeProducts(finalLegacy, { fileName: file.name, supplierGuess });
    return finalizePdfTrust(dedupedLegacy, { expectedRows: 0, failedPages: 0, engine: "pdf-v6-native-structured" }).items;
  } catch (legacyErr) {
    throw new Error(`PDF text không tìm được sản phẩm có giá hợp lệ, Claude document cũng lỗi: ${legacyErr?.message || legacyErr}`);
  }
}

// Export thêm các helper deterministic để smoke:pdf test offline (không cần API).
export {
  heuristicExtractProductsFromPdfPages,
  normalizePdfItems,
  finalizePdfTrust,
  dedupeProducts,
  extractMoneyValues,
  pickPriceFields,
  extractSkuFromPdfLine,
  isLikelySkipPdfLine,
  applyPdfOcrQualityGuard,
  isOcrBrokenProduct,
  cleanPdfSupplierName,
  isLumiSmarthomeContext,
  getExpectedLumiPdfRows,
  buildDocumentPagePrompt,
  assessPdfPositiveEvidence,
  findPdfRowEvidence,
  inferPdfQuoteRowEconomics,
  classifyPdfStructuralRow,
  inferPdfTableColumnLayout,
  reconstructPdfTableRow,
  repairVietnameseGlyphSpacing,
  normalizePdfSku,
  skuIdentityCompatible,
  isStrongQuoteTableBaseline,
  mergeQuoteTableCandidates,
};
