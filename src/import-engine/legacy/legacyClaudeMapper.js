// ============================================================
// Legacy Claude mapper — một chỗ duy nhất gọi /api/claude.
// React components truyền dữ liệu vào, module này chịu trách nhiệm
// build prompt + parse JSON để giữ UI sạch và dễ thay provider sau này.
// ============================================================

import { smartQuoteFetch } from '../../supabase/apiFetch.js';

const DEFAULT_MODEL = "claude-sonnet-4-6";
const PDF_MODEL = "claude-sonnet-5";

export const PDF_CATALOG_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    tableSemantics: {
      type: "object",
      additionalProperties: false,
      properties: {
        rowModel: { type: "string", enum: ["single_sku", "product_family_variants", "mixed", "unknown"] },
        priceColumns: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              label: { type: "string" },
              role: { type: "string", enum: ["variant_price", "commercial_price", "quote_value", "unknown"] },
              variantKey: { type: "string" },
            },
            required: ["label", "role", "variantKey"],
          },
        },
      },
      required: ["rowModel", "priceColumns"],
    },
    products: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          sku: { type: "string" },
          category: { type: "string" },
          supplier: { type: "string" },
          unit: { type: "string" },
          costPrice: { type: "integer" },
          listPrice: { type: "integer" },
          minRetailPrice: { type: "integer" },
          specs: { type: "string" },
          rawText: { type: "string" },
          sourcePage: { type: "integer" },
          sourceRow: { type: "integer" },
          visibleSkuCount: { type: "integer" },
          visiblePriceCount: { type: "integer" },
          variants: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                sku: { type: "string" },
                label: { type: "string" },
                variantKey: { type: "string" },
                priceRole: { type: "string", enum: ["variant_price", "commercial_price", "quote_value", "unknown"] },
                price: { type: "integer" },
              },
              required: ["sku", "label", "variantKey", "priceRole", "price"],
            },
          },
        },
        required: ["name", "sku", "category", "supplier", "unit", "costPrice", "listPrice", "minRetailPrice", "specs", "rawText", "sourcePage", "sourceRow", "visibleSkuCount", "visiblePriceCount", "variants"],
      },
    },
  },
  required: ["tableSemantics", "products"],
};

/**
 * Gọi /api/claude và trả raw text từ Claude, không parse JSON.
 * Dùng cho PDF vì JSON dài rất dễ bị cắt; caller có thể parse/salvage từng object.
 * @param {{messages:Array, max_tokens?:number, model?:string}} payload
 * @returns {Promise<{text:string, stopReason:string|null, raw:Object}>}
 */
export async function callClaudeText(payload) {
  let data;
  const body = {
    model: payload.model || DEFAULT_MODEL,
    max_tokens: payload.max_tokens || 1000,
    messages: payload.messages,
  };
  if (payload.system) body.system = payload.system;
  if (payload.output_config) body.output_config = payload.output_config;
  if (payload.thinking) body.thinking = payload.thinking;
  if (payload.temperature !== undefined) body.temperature = payload.temperature;

  const res = await smartQuoteFetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  try {
    data = await res.json();
  } catch (err) {
    throw new Error(`Không đọc được phản hồi từ /api/claude. Nếu đang chạy local, hãy dùng vercel dev thay vì vite dev. Chi tiết: ${err.message}`);
  }

  const apiError = data?.error?.message || data?.error || data?.message;
  if (!res.ok || data?.type === "error" || data?.error) {
    throw new Error(`Claude API lỗi ${res.status}: ${typeof apiError === "string" ? apiError : JSON.stringify(apiError)}`);
  }

  const rawText = (data.content || [])
    .filter((block) => block?.type === "text" && block.text)
    .map((block) => block.text)
    .join("\n")
    .trim();

  if (!rawText) {
    const reason = data.stop_reason ? ` stop_reason=${data.stop_reason}` : "";
    throw new Error(`Claude không trả text JSON.${reason}`);
  }

  return { text: rawText, stopReason: data.stop_reason || null, raw: data };
}


/** Guaranteed schema-conformant JSON via Claude Structured Outputs. */
export async function callClaudeStructured(payload) {
  try {
    const raw = await callClaudeText(payload);
    if (raw.stopReason === "max_tokens" || raw.stopReason === "model_context_window_exceeded") {
      const error = new Error(`Claude Structured Output bị cắt (${raw.stopReason}).`);
      error.rawText = raw.text;
      error.extractedJsonText = raw.text;
      error.stopReason = raw.stopReason;
      error.response = raw.raw;
      throw error;
    }
    try {
      return JSON.parse(raw.text);
    } catch (err) {
      const error = new Error(`Structured Output không parse được JSON: ${err.message}`);
      error.rawText = raw.text;
      error.response = raw.raw;
      throw error;
    }
  } catch (err) {
    const msg = String(err?.message || err || '');
    const schemaFailure = /(?:schema|structured|output_config|json_schema|grammar|compilation)/i.test(msg)
      && /(?:400|invalid|unsupported|complex|compile|schema)/i.test(msg);
    if (!schemaFailure || !payload?.output_config) throw err;

    console.warn('Claude Structured Output unavailable; retrying once as plain JSON', { error: msg });
    const fallbackPayload = { ...payload };
    delete fallbackPayload.output_config;
    return callClaudeJSON(fallbackPayload);
  }
}

/**
 * Gọi /api/claude và cố parse JSON từ response text.
 * Quan trọng: không nuốt lỗi thật từ API, vì PDF import rất dễ fail do
 * thiếu ANTHROPIC_API_KEY, chạy local bằng vite thay vì vercel dev, file quá lớn,
 * hoặc model trả non-JSON/đụng max_tokens.
 * @param {{messages:Array, max_tokens?:number, model?:string}} payload
 * @returns {Promise<any>}
 */
export async function callClaudeJSON(payload) {
  let raw;
  try {
    raw = await callClaudeText(payload);
  } catch (err) {
    throw err;
  }

  const rawText = raw.text || "";
  let text = rawText.replace(/```json|```/g, "").trim();

  // Nếu model trả thêm chữ ngoài JSON, cố lấy object/array đầu-cuối.
  const arrayStart = text.indexOf("[");
  const arrayEnd = text.lastIndexOf("]");
  const objStart = text.indexOf("{");
  const objEnd = text.lastIndexOf("}");
  if (arrayStart >= 0 && arrayEnd > arrayStart && (objStart === -1 || arrayStart < objStart)) {
    text = text.slice(arrayStart, arrayEnd + 1);
  } else if (objStart >= 0 && objEnd > objStart) {
    text = text.slice(objStart, objEnd + 1);
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    const preview = rawText.slice(0, 400).replace(/\s+/g, " ");
    const suffix = raw.stopReason ? ` stop_reason=${raw.stopReason}.` : "";
    const error = new Error(`AI trả về không phải JSON hợp lệ.${suffix} Preview: ${preview}`);
    // Keep raw response metadata for callers that can recover partial JSON.
    error.rawText = rawText;
    error.extractedJsonText = text;
    error.stopReason = raw.stopReason || null;
    error.response = raw.raw;
    throw error;
  }
}

/**
 * Legacy BOM/KTS mapping: map rows vật tư sang catalog hiện tại.
 * @param {Array<{section:string,name:string,unit:string,qty:number,idx:number}>} rows
 * @param {Array} products
 * @param {(progress:{cur:number,total:number,msg:string})=>void} [onProgress]
 * @returns {Promise<Array>}
 */
export async function mapBomRowsWithClaude(rows, products, onProgress) {
  if (!rows?.length) return [];

  const catalogSummary = products.map((p) =>
    `${p.id}|${p.name}|${p.sku}|${p.category}|${p.specs || ""}`
  ).join("\n");

  const BATCH = 30;
  const batches = [];
  for (let i = 0; i < rows.length; i += BATCH) batches.push(rows.slice(i, i + BATCH));

  const results = [];
  onProgress?.({ cur: 0, total: rows.length, msg: "Đang phân tích..." });

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const rowsText = batch.map((r, i) =>
      `${i}: [${r.section}] ${r.name} | ${r.unit} | SL: ${r.qty}`
    ).join("\n");

    const prompt = `Bạn là chuyên gia đọc bảng khối lượng kỹ thuật Việt Nam.

CATALOG SẢN PHẨM của công ty (id|tên|mã|nhóm|thông số):
${catalogSummary}

DANH SÁCH VẬT TƯ TỪ FILE KỸ THUẬT (index: [nhóm] tên | đơn vị | số lượng):
${rowsText}

Nhiệm vụ: Map từng dòng vật tư sang sản phẩm trong catalog.
Trả về JSON array, mỗi phần tử:
{
  "idx": số thứ tự dòng (0-based),
  "productId": "id sản phẩm trong catalog" hoặc null nếu không tìm thấy,
  "confidence": "high" | "medium" | "low",
  "reason": "lý do ngắn (tối đa 10 từ)",
  "solution": "tên giải pháp phù hợp (I./...)"
}

Quy tắc:
- Chỉ map khi chắc chắn sản phẩm tương đương. Không map vật tư phụ, dây điện, ống luồn, phụ kiện.
- Đèn downlight 9W → map sang LM-D9-90-110-W4-2 nếu có
- Công tắc 1 nút → LM-1G2W-C(G) hoặc LM-S1N/S
- Camera trong nhà → DS-2CD1347G2H-LIUF, camera ngoài → DS-2CD1047G2H-LIUF
- Wifi mesh → RG-AP2200E hoặc RG-AP2200F
- Đầu ghi 32 kênh → không có trong catalog, trả null
- Solution: xếp vào đúng giải pháp I./II./III./IV./V. theo loại thiết bị

Chỉ trả về JSON array thuần, không có markdown.`;

    try {
      const parsed = await callClaudeJSON({
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      });
      if (Array.isArray(parsed)) {
        parsed.forEach((item) => {
          const row = batch[item.idx];
          if (row) results.push({ ...row, ...item, globalIdx: row.idx });
        });
      }
    } catch {
      batch.forEach((r) => results.push({ ...r, productId: null, confidence: "low", reason: "Lỗi AI", globalIdx: r.idx }));
    }

    onProgress?.({
      cur: Math.min((b + 1) * BATCH, rows.length),
      total: rows.length,
      msg: `Đã phân tích ${Math.min((b + 1) * BATCH, rows.length)}/${rows.length} dòng...`,
    });
    await new Promise((r) => setTimeout(r, 500));
  }

  return results;
}

/**
 * AI map các cột ma trận bóc tách sang productId.
 * @param {{rows:any[][], unmapped:string[], products:Array}} params
 * @returns {Promise<Array<{colIdx:number,productId:string|null,confidence:string}>>}
 */
export async function mapTakeoffColumnsWithClaude({ rows, unmapped, products }) {
  const catalogSummary = products.map((p) => `${p.id}|${p.name}|${p.sku}|${p.category}`).join("\n");
  const rawData = rows.slice(0, 10).map((r) => (r || []).join("\t")).join("\n");
  const colsText = unmapped.map((c, i) => `${i}: "${c}"`).join(", ");

  const prompt = `Bạn là chuyên gia đọc file bóc tách khối lượng kỹ thuật Việt Nam. Đây là file bóc tách:

HEADER FILE (10 dòng đầu):
${rawData}

CÁC CỘT CHƯA GHÉP ĐƯỢC (index: tên):
${colsText}

CATALOG SẢN PHẨM (id|tên|sku|nhóm):
${catalogSummary}

Nhiệm vụ: Ghép từng cột chưa map sang sản phẩm trong catalog.
Lưu ý đặc biệt:
- CBCĐ/CBCD = Cảm biến chuyển động → tìm LM-MDZ hoặc tương tự
- CBHD = Cảm biến hiện diện → tìm LM-PCB hoặc tương tự
- BCM = Camera điều khiển cổng Roger
- "Bộ motor" / "Bộ cổng" = motor cổng tự động
- "Cam ngoài", "Cam trong" = camera HIKVISION
- "Bộ wifi", "Wifi gắn tường" = RG-AP2200E hoặc F

Trả về JSON array:
[{"colIdx": 0, "productId": "id_trong_catalog_hoặc_null", "confidence": "high|medium|low"}]
Chỉ JSON thuần, không markdown.`;

  const parsed = await callClaudeJSON({
    max_tokens: 1000,
    messages: [{ role: "user", content: prompt }],
  });
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * AI map cột catalog import sang field UI.
 * @param {{headers:Array<{idx:number,label:string}>, sampleRows:any[][], fileName:string}} params
 * @returns {Promise<Object>}
 */
export async function autoMapCatalogColumnsWithClaude({ headers, sampleRows, fileName }) {
  const hdrNames = headers.map(h => `${h.idx}: "${h.label}"`).join(", ");
  const sample = sampleRows.slice(0, 3).map(r => r.map(c => String(c ?? "").slice(0, 30)).join(" | ")).join("\n");

  const prompt = `File bảng giá "${fileName}". Các cột (index: tên): ${hdrNames}
Sample data:
${sample}

Map từng cột sang field tương ứng. Trả về JSON object:
{"name": index_cột_hoặc_null, "sku": index, "category": index, "supplier": index, "unit": index, "costPrice": index, "specs": index}
Chỉ JSON thuần.`;

  return callClaudeJSON({
    max_tokens: 500,
    messages: [{ role: "user", content: prompt }],
  });
}

/**
 * AI trích xuất catalog từ PDF bảng giá.
 * @param {{file:File, supplierGuess:string}} params
 * @returns {Promise<Array>}
 */
export async function extractCatalogPdfWithClaude({ file, supplierGuess }) {
  const base64 = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = (event) => resolve(String(event.target.result).split(",")[1] || "");
    r.onerror = reject;
    r.readAsDataURL(file);
  });

  const prompt = `Bạn là engine Document AI cho catalog/bảng giá Việt Nam.
Đọc toàn bộ PDF, bao gồm bảng scan, hình, text và mọi trang.

MỤC TIÊU — đọc cấu trúc thương mại trước rồi mới đọc sản phẩm:
1) Đọc HEADER của bảng và điền tableSemantics.
   - rowModel="product_family_variants" khi MỘT dòng có nhiều SKU bán được và các cột giá là giá của từng cấu hình/SKU (ví dụ On/off, Smart dimmable, Smart Tunable).
   - role="commercial_price" khi nhiều giá chỉ là tier thương mại của CÙNG một SKU (giá đại lý, giá công bố, MSRP...).
   - role="quote_value" cho Số lượng/Đơn giá/Thành tiền của báo giá; tuyệt đối không coi Thành tiền là giá variant.
2) Mỗi STT/hàng vật lý = đúng 1 product family ở output products.
3) Đếm số SKU và số ô giá nhìn thấy trên từng row vào visibleSkuCount/visiblePriceCount. Nếu visibleSkuCount>=2 thì variants PHẢI giữ đủ one-to-one SKU ↔ cột cấu hình ↔ giá; không được chỉ trả SKU đầu tiên.
4) Với bảng Lumi kiểu cột On/off / Smart dimmable / Smart Tunable: map SKU hậu tố -O → on_off, -D → smart_dimmable, -T → smart_tunable khi nhìn thấy đúng các mã đó; không suy đoán SKU không có trên file.
5) Nếu bảng chỉ có 1 SKU + nhiều tier thương mại, KHÔNG tạo variants giả.
6) sourcePage là trang PDF (1-based); sourceRow là STT vật lý nếu nhìn thấy.
7) Tên lấy từ cột thiết bị; SKU từ cột mã; costPrice chỉ là field tương thích cho UI cũ và có thể dùng giá variant đầu/nhỏ nhất, nhưng variants mới là source of truth khi row có nhiều SKU.
8) Không tạo product từ header, subtotal, footer, điều khoản, tuổi thọ, điện áp, CRI/IP/CCT hoặc số trong specs.
9) Nếu SKU/giá không chắc, dùng "" / 0 thay vì đoán.
10) Trả đủ mọi dòng sản phẩm; không giải thích ngoài schema.`;

  const parsed = await callClaudeStructured({
    model: PDF_MODEL,
    max_tokens: 24000,
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: PDF_CATALOG_OUTPUT_SCHEMA },
    },
    messages: [{
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
        { type: "text", text: prompt },
      ],
    }],
  });
  const semantics = parsed?.tableSemantics || { rowModel: "unknown", priceColumns: [] };
  return Array.isArray(parsed?.products)
    ? parsed.products.map((product) => ({ ...product, tableSemantics: semantics }))
    : [];
}
