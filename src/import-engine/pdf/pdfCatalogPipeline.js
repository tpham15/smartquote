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
import { callClaudeText, extractCatalogPdfWithClaude } from "../legacy/legacyClaudeMapper.js";
import { sanitizeCatalogProduct, sanitizeCatalogProducts } from "../productSanitizer.js";

const DEFAULT_MAX_CHARS_PER_CHUNK = 850;
const DEFAULT_MAX_LINES_PER_CHUNK = 8;
const DEFAULT_MAX_PAGES_PER_CHUNK = 1;
const MIN_SPLITTABLE_CHARS = 160;
const MAX_RECURSIVE_SPLIT_DEPTH = 6;
const AI_CHUNK_DELAY_MS = 120;

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

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function isLumiLightingContext(ctx = {}) {
  const haystack = [ctx.fileName, ctx.supplierGuess, ctx.category, ctx.name, ctx.rawText]
    .map((x) => String(x || ""))
    .join(" ")
    .toLowerCase();
  return /lumi/.test(haystack) && /(lighting|đèn|den|spotlight|downlight|led|ray nam châm|ray nam cham|mira|lyra|hera|vega)/i.test(haystack);
}

function isLumiSmarthomeContext(ctx = {}) {
  const haystack = [ctx.fileName, ctx.supplierGuess, ctx.category, ctx.name, ctx.rawText]
    .map((x) => String(x || ""))
    .join(" ")
    .toLowerCase();
  return /lumi/.test(haystack) && /(smarthome|smart home|công tắc|cong tac|luto|lumes|cảm biến|cam bien|module|wallpad|khóa thông minh|khoa thong minh|ai camera hub|âm thanh|am thanh|works with lumi|bộ điều khiển trung tâm|bo dieu khien trung tam)/i.test(haystack);
}

function getExpectedLumiPdfRows(ctx = {}) {
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
  const brand = canonicalPdfBrand(raw);
  if (brand) return brand;
  const key = normalizeVietnameseKey(raw);
  if (/bang gia|bbg|gia dai ly|gia npp|gia si|don gia|thanh ray|phu kien|dong san pham/.test(key)) return "PDF Catalog";
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
  if (!String(engine || item?._meta?.engine || "").includes("heuristic")) return false;
  const name = normalizeText(item.name);
  const sku = normalizeText(item.sku);
  const specs = normalizeText(item.specs);
  const raw = normalizeText(item.rawText || item._meta?.source?.rawText || "");
  const category = normalizeText(item.category);
  const costPrice = Number(item.costPrice || item.price || 0) || 0;
  const listPrice = Number(item.listPrice || item.publicPrice || 0) || 0;
  if (!costPrice || costPrice < 1000 || costPrice > 1000000000) return false;
  if (listPrice > 0 && listPrice < costPrice) return false;
  if (!name || name.length < 6 || name.length > 120 || hasSuspiciousPdfName(name)) return false;
  if (isGenericOrFragmentName(name)) return false;
  if (category && /^(bbg|bang gia|bảng giá)$/i.test(category)) return false;
  const context = [name, sku, specs, raw, category].join(" ");
  const clearSku = hasClearSku(sku);
  const clearProductText = hasProductKeyword(context) && tokenCount([name, specs, raw].join(" ")) >= 6;
  // Auto-approve only when the PDF fallback row is materially complete. Rows without SKU
  // can still pass if the name/specs look like a real product and price is clear.
  return clearSku ? (hasProductKeyword(context) || tokenCount(name) >= 3) : clearProductText;
}

function applyPdfOcrQualityGuard(item, engine, supplierGuess) {
  const meta = { ...(item._meta || {}) };
  const issues = Array.isArray(meta.issues) ? [...meta.issues] : [];
  const isHeuristic = String(engine || meta.engine || "").includes("heuristic");
  const isPdf = meta.source?.type === "pdf" || String(engine || meta.engine || "").startsWith("pdf");

  item.supplier = cleanPdfSupplierName(item.supplier, supplierGuess);

  if (isPdf && isOcrBrokenProduct({ ...item, _meta: meta }, engine || meta.engine)) {
    item._skipReason = "pdf_ocr_low_quality";
    item._pdfOcrLowQuality = true;
    meta.canonicalStatus = "skipped";
    meta.status = "skipped";
    meta.confidence = Math.min(Number(meta.confidence || 0.5), 0.38);
    issues.push(simpleIssue(
      "pdf_ocr_low_quality",
      "info",
      OCR_BROKEN_SKIP_MESSAGE,
      "name",
      "Dòng này là mảnh OCR/fallback text, không phải sản phẩm đủ chắc"
    ));
  } else if (isHeuristic && isHighConfidencePdfHeuristicProduct(item, engine || meta.engine)) {
    // Text/OCR fallback is not automatically bad. If the row has clear product name,
    // price and SKU/product context, keep it auto-approved to avoid forcing users to
    // manually approve dozens of valid PDF rows.
    meta.canonicalStatus = "auto_approved";
    meta.status = "new";
    meta.confidence = Math.max(Number(meta.confidence || 0), hasClearSku(item.sku) ? 0.82 : 0.76);
    issues.push(simpleIssue(
      "pdf_ocr_auto_checked",
      "info",
      "PDF/OCR đọc được dòng sản phẩm đủ rõ, đã tự duyệt",
      "name"
    ));
  } else if (isHeuristic) {
    meta.canonicalStatus = meta.canonicalStatus || "need_review";
    meta.status = meta.status || "review";
    meta.confidence = Math.min(Number(meta.confidence || 0.64), 0.64);
    issues.push(simpleIssue(
      "pdf_ocr_uncertain",
      "warning",
      OCR_UNCERTAIN_MESSAGE,
      "name",
      "Bấm Sửa nếu tên/giá chưa đúng; bấm Xóa nếu đây chỉ là dòng rác OCR"
    ));
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
  const res = await fetch("/api/pdf-extract", {
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
    }));
  const usable = normalizedPages.filter((p) => p.text.length > 20);
  const pageCount = data.pageCount || normalizedPages.length || usable.length;
  const textChars = data.textChars || normalizedPages.reduce((s, p) => s + p.text.length, 0);

  // Important for scanned/image PDFs: pdfjs can open the PDF and count pages,
  // but text extraction returns 0 chars. Do NOT throw here, because the caller
  // can still use Claude document/vision fallback page-by-page.
  return {
    pageCount,
    textChars,
    pages: usable,
    rawPages: normalizedPages,
    scanned: !usable.length,
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
- costPrice = giá đại lý/NPP/nhập hoặc giá thấp nhất hợp lý trong dòng.
- listPrice = giá công bố/niêm yết/giá bán nếu có và cao hơn costPrice.
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

function buildDocumentPagePrompt({ fileName, supplierGuess, pageNum, pageCount, recoveryMode = false }) {
  const lumiSmartHomeMode = isLumiSmarthomeContext({ fileName, supplierGuess, rawText: fileName });
  const expectedRows = getExpectedLumiPdfRows({ fileName, supplierGuess, rawText: fileName });
  const recoveryRules = recoveryMode ? `
CHẾ ĐỘ RECOVERY / BẮT DÒNG BỊ THIẾU:
- Lần đọc trước có thể đã thiếu sản phẩm. Hãy đọc chậm từng hàng ngang trong bảng.
- Ưu tiên recall: nếu một hàng có tên + giá nhưng SKU mờ, vẫn xuất object.
- Không tự bỏ qua row vì thiếu SKU, thiếu specs, hoặc cột bị dấu mộc che một phần.
- Nếu không chắc giá nhưng tên là sản phẩm rõ, vẫn xuất costPrice=0 để user kiểm tra trong preview.
` : "";

  const smarthomeRules = lumiSmartHomeMode ? `
QUY TẮC RIÊNG CHO BẢNG LUMI SMARTHOME SCAN:
- File này là bảng giá scan/ảnh. Hãy đọc THEO HÀNG VẬT LÝ của bảng, không đọc theo đoạn văn.
- Mỗi hàng sản phẩm có pattern: TÊN SẢN PHẨM + MÃ LM-* + GIÁ ở cột ngoài cùng bên phải.
- Mỗi row vật lý = 1 object JSONL. KHÔNG bỏ qua row nếu đã có tên + giá, kể cả SKU/mã bị mờ.
- Nếu SKU không chắc hoặc không đọc được, để sku="" nhưng vẫn xuất object với tên + giá.
- sourceRow phải là STT/dòng vật lý trong bảng nếu thấy được. Nếu không thấy STT, đánh số thứ tự trong trang.
- Không được gộp nhiều dòng sản phẩm thành một object.
- Không được tách một dòng sản phẩm thành nhiều object chỉ vì specs nhiều dòng.
- Category lấy từ dòng section gần nhất như CÔNG TẮC LUTO, CẢM BIẾN PHỤ TRỢ, MODULE, WORKS WITH LUMI, Ổ CẮM LUMES.
- Trang có dấu mộc/ảnh che vẫn phải cố đọc mọi row có tên + giá; nếu giá không chắc, costPrice=0 và vẫn trả object để SmartQuote đưa vào Cần kiểm tra.
- Mục tiêu recall của toàn file là khoảng ${expectedRows || 49} sản phẩm. Trang nào có bảng sản phẩm thì tuyệt đối không trả thiếu row chỉ vì SKU mờ.
` : "";

  return `Bạn là engine OCR/catalog cho PDF bảng giá tiếng Việt.

FILE: ${fileName}
NCC dự đoán: ${supplierGuess || "Chung"}
NHIỆM VỤ: Chỉ đọc TRANG ${pageNum}/${pageCount || "?"} của PDF đính kèm. Bỏ qua mọi trang khác.

Trang này có thể là PDF scan/ảnh, không có text selectable. Hãy đọc bằng thị giác.

Trả về JSONL: mỗi dòng là 1 object JSON, KHÔNG dùng mảng lớn, KHÔNG markdown.
Schema ngắn:
{"name":"tên ngắn","sku":"mã/model hoặc rỗng nếu không chắc","category":"nhóm","supplier":"${supplierGuess || ""}","unit":"Cái","costPrice":123456,"listPrice":0,"minRetailPrice":0,"specs":"<=100 ký tự","rawText":"<=120 ký tự","sourcePage":${pageNum},"sourceRow":1}

Quy tắc chung cho PDF scan dạng bảng:
- Đọc THEO HÀNG của bảng. Mỗi hàng sản phẩm = 1 object JSONL.
- Không bỏ qua một hàng nếu có tên sản phẩm + giá tiền. Nếu SKU mờ, để sku="" và vẫn xuất dòng.
- Tên sản phẩm lấy từ cột THIẾT BỊ/TÊN SẢN PHẨM, không lấy specs làm tên.
- SKU/model lấy từ cột MÃ SẢN PHẨM nếu đọc được.
- costPrice = giá ở cột giá ngoài cùng bên phải tương ứng với đúng hàng đó.
- Không được dùng số trong thông số kỹ thuật làm giá: tuổi thọ 50,000h/25,000h, CRI, IP, CCT, 220V, 24V, 48V, kích thước, góc chiếu. Nếu không chắc giá, để costPrice=0.
- listPrice = 0 nếu bảng không có giá niêm yết riêng.
- Category lấy từ dòng section gần nhất.
- Bỏ qua header, logo, footer, con dấu, điều khoản, dòng không phải sản phẩm.
- Giá phải là số nguyên VND, bỏ dấu chấm/phẩy: "648,000" -> 648000.
${smarthomeRules}${recoveryRules}
Quy tắc rất quan trọng cho bảng Lumi Lighting / PDF scan dạng STT:
- Mỗi STT vật lý trong bảng = 1 sản phẩm. KHÔNG tách 1 STT thành nhiều sản phẩm.
- Nếu một STT có nhiều SKU trong cột MÃ SẢN PHẨM (vd On/off, Smart dimmable, Smart Tunable), vẫn chỉ trả 1 object. Gộp SKU bằng dấu " / " và ghi biến thể vào specs.
- Nếu thấy nhiều giá biến thể trong cùng một STT, dùng giá thấp nhất rõ ràng và ghi các giá còn lại vào specs.
- Tên sản phẩm ngắn theo cột THIẾT BỊ, không thêm (On/off)/(Smart dimmable)/(Tunable) thành tên riêng.

Ví dụ JSONL hợp lệ cho Lumi Smarthome khi SKU mờ nhưng tên+giá rõ:
{"name":"Công tắc Luto kính phẳng, viền bo champagne","sku":"","category":"CÔNG TẮC LUTO_KÍNH PHẲNG, VIỀN BO","supplier":"${supplierGuess || "Lumi"}","unit":"Cái","costPrice":2484000,"listPrice":0,"minRetailPrice":0,"specs":"Màu trắng/đen; nguồn cấp 220VAC/50Hz","rawText":"Công tắc Luto kính phẳng viền bo champagne 2,484,000","sourcePage":${pageNum},"sourceRow":1}

Ví dụ JSONL hợp lệ cho Lumi Lighting 1 STT có 3 SKU:
{"name":"Đèn Spotlight âm trần 7W chính hướng, 24D","sku":"LM-ST7-55-O / LM-ST7-55-D / LM-ST7-55-T","category":"DÒNG SẢN PHẨM SPOTLIGHT CHÍNH HƯỚNG 2025","supplier":"${supplierGuess || "Lumi"}","unit":"Cái","costPrice":648000,"listPrice":0,"minRetailPrice":0,"specs":"SKU/giá: O=648000; D=810000; T=1080000; công suất 7W; lỗ khoét 55mm","rawText":"STT 1 LM-ST7-55-O/D/T 648,000 810,000 1,080,000","sourcePage":${pageNum},"sourceRow":1}

Chỉ trả JSONL thuần.`;
}
async function parseDocumentPageWithClaude({ file, base64, supplierGuess, pageNum, pageCount, recoveryMode = false }) {
  const { text, stopReason } = await callClaudeText({
    max_tokens: recoveryMode ? 3600 : 2600,
    messages: [{
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
        { type: "text", text: buildDocumentPagePrompt({ fileName: file.name, supplierGuess, pageNum, pageCount, recoveryMode }) },
      ],
    }],
  });
  const items = parseClaudeProductObjects(text);
  if (items.length || stopReason !== "max_tokens") return items;
  // Even when max_tokens happens, parseClaudeProductObjects already salvages
  // completed JSONL lines. Return whatever can be recovered instead of failing.
  return items;
}


async function collectDocumentPageRows({ file, base64, supplierGuess, totalPages, onProgress, recoveryMode = false }) {
  const raw = [];
  let failedPages = 0;
  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    onProgress?.({
      stage: recoveryMode ? "vision_recovery_page" : "vision_page",
      message: recoveryMode
        ? `PDF scan/ảnh: AI đang dò lại dòng bị thiếu trang ${pageNum}/${totalPages}...`
        : `PDF scan/ảnh: AI đang đọc trang ${pageNum}/${totalPages}...`,
      current: pageNum,
      total: totalPages,
    });
    try {
      const pageItems = await parseDocumentPageWithClaude({ file, base64, supplierGuess, pageNum, pageCount: totalPages, recoveryMode });
      raw.push(...pageItems.map((it) => ({ ...it, sourcePage: Number(it.sourcePage || pageNum) || pageNum })));
    } catch (err) {
      failedPages += 1;
      console.warn("PDF document page OCR failed", { pageNum, recoveryMode, error: err?.message || err });
    }
    if (pageNum < totalPages) await new Promise((r) => setTimeout(r, recoveryMode ? 220 : 160));
  }
  return { raw, failedPages };
}

async function extractCatalogPdfWithClaudeDocumentPages({ file, supplierGuess, pageCount, onProgress }) {
  const base64 = await fileToBase64(file);
  const totalPages = Math.max(1, Math.min(Number(pageCount || 1), 30));
  const expectedRows = getExpectedLumiPdfRows({ fileName: file.name, supplierGuess });

  const first = await collectDocumentPageRows({ file, base64, supplierGuess, totalPages, onProgress, recoveryMode: false });
  let raw = first.raw;
  let failedPages = first.failedPages;

  let items = normalizePdfItems(raw, supplierGuess, "pdf-v4-document-page-jsonl");
  let finalItems = dedupeProducts(items, { fileName: file.name, supplierGuess });

  // Targeted second pass for scanned Lumi Smarthome/Lighting catalogs. These files are
  // row-indexed price tables. If the first vision pass under-recovers rows, run a stricter
  // per-page prompt that favors recall and preserves rows with name+price even when SKU is blurry.
  if (expectedRows && finalItems.length < Math.ceil(expectedRows * 0.9)) {
    onProgress?.({
      stage: "vision_recovery",
      message: `PDF scan có thể đọc thiếu dòng (${finalItems.length}/${expectedRows}). SmartQuote đang dò lại theo từng hàng bảng...`,
      current: finalItems.length,
      total: expectedRows,
      expectedRows,
    });
    const second = await collectDocumentPageRows({ file, base64, supplierGuess, totalPages, onProgress, recoveryMode: true });
    failedPages += second.failedPages;
    raw = [...raw, ...second.raw];
    items = normalizePdfItems(raw, supplierGuess, "pdf-v4-document-page-jsonl");
    finalItems = dedupeProducts(items, { fileName: file.name, supplierGuess });
  }

  if (!finalItems.length) {
    throw new Error(`Claude document page fallback không tìm được sản phẩm (${failedPages}/${totalPages} trang lỗi).`);
  }

  const coverageRatio = expectedRows ? finalItems.length / expectedRows : 1;
  if (expectedRows && finalItems.length < Math.ceil(expectedRows * 0.9)) {
    for (const it of finalItems) {
      it._meta = it._meta || {};
      it._meta.issues = [...(it._meta.issues || []), simpleIssue(
        "pdf_scan_low_recall",
        "warning",
        `PDF scan có thể đọc thiếu dòng: tìm thấy ${finalItems.length}/${expectedRows} sản phẩm dự kiến`,
        "file",
        "Kiểm tra lại file PDF hoặc chạy lại sau khi cải thiện OCR/vision"
      )];
      it._meta.pdfExpectedRows = expectedRows;
      it._meta.pdfCoverageRatio = coverageRatio;
    }
  }
  onProgress?.({
    stage: "done",
    message: `PDF scan/ảnh đọc được ${finalItems.length} sản phẩm bằng AI theo từng trang${expectedRows ? ` / ${expectedRows} dự kiến` : ""}${failedPages ? `; ${failedPages} trang lỗi` : ""}.`,
    current: totalPages,
    total: totalPages,
    warningPages: failedPages,
    expectedRows,
    coverageRatio,
  });
  return finalItems;
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

function normalizePdfItems(items, supplierGuess, engine = "pdf-v3-ai-jsonl") {
  return (items || [])
    .map((it) => {
      const rawText = normalizeText(it.rawText || it.name);
      const sourceRow = Number(it.sourceRow || it.stt || it.row || extractSourceRowNumber(rawText) || 0) || null;
      const specs = normalizeText(it.specs);
      let costPrice = normalizePrice(it.costPrice ?? it.price);
      const contextKey = normalizeVietnameseKey([rawText, specs, it.name].join(" "));
      // Guard for scanned lighting PDFs: OCR often mistakes "Tuổi thọ: 50,000h"
      // or "25,000h" as the price when the real price column is unclear.
      const priceLooksLikeLifeHours = (costPrice === 50000 || costPrice === 25000) && /tuoi tho/.test(contextKey);
      if (priceLooksLikeLifeHours) costPrice = 0;
      const name = stripLightingVariantFromName(normalizeText(it.name));
      const sanitized = sanitizeCatalogProduct({
        id: uid("imp"),
        name,
        sku: normalizeText(it.sku),
        category: normalizeText(it.category) || "Chung",
        supplier: normalizeText(it.supplier) || supplierGuess,
        unit: normalizeText(it.unit) || "Cái",
        costPrice,
        listPrice: normalizePrice(it.listPrice ?? it.publicPrice ?? it.salePrice),
        minRetailPrice: normalizePrice(it.minRetailPrice),
        specs,
        image: "",
        _meta: {
          source: {
            type: "pdf",
            page: Number(it.sourcePage || it.page || 0) || null,
            row: sourceRow,
            rawText: rawText.slice(0, 300),
          },
          status: "new",
          confidence: engine.includes("heuristic") ? 0.62 : 0.74,
          issues: [],
          engine,
        },
      }, { defaultSupplier: supplierGuess });
      if (priceLooksLikeLifeHours) {
        sanitized.costPrice = 0;
        sanitized.price = 0;
        sanitized._meta = sanitized._meta || {};
        sanitized._meta.issues = [...(sanitized._meta.issues || []), simpleIssue(
          "pdf_price_looks_like_life_hours",
          "warning",
          "Số 25,000/50,000 có vẻ là tuổi thọ, không phải giá bán",
          "price"
        )];
      }
      return sanitized;
    })
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
      "PDF có nhiều SKU/giá trong cùng một STT; SmartQuote gộp thành một sản phẩm và dùng giá thấp nhất rõ ràng",
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
    image: oldItem.image || item.image || "",
    _meta: {
      ...(oldItem._meta || {}),
      source: { ...(oldItem._meta?.source || {}), row: oldItem._meta?.source?.row || item._meta?.source?.row || null },
      issues: issues.slice(0, 8),
      confidence: Math.max(Number(oldItem._meta?.confidence || 0), Number(item._meta?.confidence || 0), 0.78),
    },
  };
}

function dedupeProducts(items, opts = {}) {
  const map = new Map();
  const out = [];
  for (const item of items || []) {
    const row = item?._meta?.source?.row || extractSourceRowNumber(item?._meta?.source?.rawText);
    const page = item?._meta?.source?.page || 0;
    const baseName = normalizeVietnameseKey(stripLightingVariantFromName(item.name));
    const lumiVariantKey = isLumiLightingContext({ fileName: opts.fileName, supplierGuess: opts.supplierGuess, category: item.category, name: item.name, rawText: item._meta?.source?.rawText })
      ? `lumi:${page || "p"}:${row || baseName}`
      : "";
    const key = lumiVariantKey || (item.sku || item.name || "").toLowerCase().replace(/[\s\-\/\._]/g, "");
    if (!key) continue;
    if (map.has(key)) {
      const idx = map.get(key);
      const old = out[idx];
      if (isVariantPriceRowMerge(old, item, opts) || lumiVariantKey) {
        out[idx] = mergePdfRowVariants(old, item);
        continue;
      }
      const costPrice = item.costPrice || old.costPrice || 0;
      const listPrice = item.listPrice || old.listPrice || 0;
      const minRetailPrice = item.minRetailPrice || old.minRetailPrice || 0;
      out[idx] = {
        ...old,
        ...item,
        costPrice,
        listPrice,
        minRetailPrice,
        specs: [old.specs, item.specs].filter(Boolean).join(" | ").slice(0, 1000),
        image: old.image || item.image || "",
        _meta: {
          ...(old._meta || {}),
          ...(item._meta || {}),
          issues: [...(old._meta?.issues || []), ...(item._meta?.issues || [])].slice(0, 6),
        },
      };
    } else {
      map.set(key, out.length);
      out.push(item);
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
  return /^(stt|no\.|mã|ma sp|model|sku|tên|ten|đơn giá|don gia|giá|gia|ghi chú|ghi chu)(\s|$)/i.test(t)
    || /vat|thanh toán|thanh toan|bảo hành|bao hanh|hotline|ngân hàng|ngan hang|chuyển khoản|chuyen khoan|địa chỉ|dia chi|website|email|tổng cộng|tong cong/.test(t);
}

function isLikelySectionLine(line) {
  const t = normalizeText(line);
  if (!t || t.length < 4 || extractMoneyValues(t).length) return false;
  const upperish = t.toUpperCase() === t || /^(dòng|dong|nhóm|nhom|series|bảng giá|bang gia|công tắc|cong tac|đèn|den|thiết bị|thiet bi|camera|khóa|khoa|két|ket|động sản phẩm|dong san pham)/i.test(t);
  return upperish && t.length <= 130;
}

function extractSkuFromPdfLine(line) {
  const text = String(line || "");
  const patterns = [
    /\b[A-Z]{1,6}(?:-[A-Z0-9]{1,10}){1,8}(?:\/[A-Z0-9]{1,6})?\b/g,
    /\b[A-Z]{2,}[0-9][A-Z0-9\-\/]{2,}\b/g,
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

function heuristicExtractProductsFromPdfPages(pages, supplierGuess) {
  const out = [];
  let currentCategory = "Chung";

  for (const page of pages || []) {
    const lines = splitLinesSmart(page.text);
    for (const line of lines) {
      const clean = normalizeText(line);
      if (!clean) continue;
      if (isLikelySectionLine(clean)) {
        currentCategory = clean.replace(/^bảng giá\s*/i, "").slice(0, 90) || currentCategory;
        continue;
      }
      if (isLikelySkipPdfLine(clean)) continue;

      const prices = extractMoneyValues(clean);
      if (!prices.length) continue;
      const { costPrice, listPrice, minRetailPrice } = pickPriceFields(prices);
      if (!costPrice) continue;

      const sku = extractSkuFromPdfLine(clean);
      let name = cleanHeuristicName(clean, sku);
      if ((!name || name.length < 3) && sku) name = `${currentCategory} ${sku}`;
      if (!name || name.length < 3) continue;

      out.push({
        name,
        sku,
        category: currentCategory || "Chung",
        supplier: supplierGuess,
        unit: /\b(bộ|bo|set)\b/i.test(clean) ? "Bộ" : "Cái",
        costPrice,
        listPrice,
        minRetailPrice,
        specs: buildSpecsFromLine(clean, prices),
        rawText: clean.slice(0, 160),
        sourcePage: page.page,
      });
    }
  }

  return out;
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
      stage: "fallback",
      message: `PDF không tách text được (${textPipelineError?.message || "unknown"}). Thử Claude đọc document trực tiếp...`,
    });
    try {
      const legacyItems = await extractCatalogPdfWithClaude({ file, supplierGuess });
      const finalItems = sanitizeCatalogProducts(normalizePdfItems(legacyItems, supplierGuess, "pdf-legacy-document-fallback"), { defaultSupplier: supplierGuess });
      if (!finalItems.length) throw new Error("legacy không tìm được sản phẩm");
      return dedupeProducts(finalItems, { fileName: file.name, supplierGuess });
    } catch (legacyErr) {
      throw new Error(`PDF không đọc được. Text extraction lỗi: ${textPipelineError?.message || "unknown"}. Claude document lỗi: ${legacyErr?.message || legacyErr}`);
    }
  }

  if (extracted.scanned || !extracted.pages.length || extracted.textChars < 80) {
    onProgress?.({
      stage: "vision_fallback",
      message: `PDF có ${extracted.pageCount || "?"} trang nhưng gần như không có text selectable. Chuyển sang AI đọc từng trang ảnh...`,
      pageCount: extracted.pageCount,
      textChars: extracted.textChars,
    });
    try {
      return await extractCatalogPdfWithClaudeDocumentPages({
        file,
        supplierGuess,
        pageCount: extracted.pageCount,
        onProgress,
      });
    } catch (pageErr) {
      // Last resort: old whole-document mode. It may hit max_tokens, but can still
      // work for short PDFs; keep it only after page-by-page JSONL fails.
      onProgress?.({
        stage: "fallback",
        message: `AI đọc từng trang lỗi (${pageErr?.message || pageErr}). Thử Claude đọc toàn bộ document...`,
      });
      try {
        const legacyItems = await extractCatalogPdfWithClaude({ file, supplierGuess });
        const finalItems = sanitizeCatalogProducts(normalizePdfItems(legacyItems, supplierGuess, "pdf-legacy-document-fallback"), { defaultSupplier: supplierGuess });
        if (!finalItems.length) throw new Error("legacy không tìm được sản phẩm");
        return dedupeProducts(finalItems, { fileName: file.name, supplierGuess });
      } catch (legacyErr) {
        throw new Error(`PDF scan/ảnh không đọc được. Page-by-page lỗi: ${pageErr?.message || pageErr}. Claude document lỗi: ${legacyErr?.message || legacyErr}`);
      }
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
  const finalItems = dedupeProducts([...heuristicItems, ...aiItems], { fileName: file.name, supplierGuess });

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
    });
    return finalItems;
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
    return dedupeProducts(finalLegacy, { fileName: file.name, supplierGuess });
  } catch (legacyErr) {
    throw new Error(`PDF text không tìm được sản phẩm có giá hợp lệ, Claude document cũng lỗi: ${legacyErr?.message || legacyErr}`);
  }
}

// Export thêm các helper deterministic để smoke:pdf test offline (không cần API).
export {
  heuristicExtractProductsFromPdfPages,
  normalizePdfItems,
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
};
