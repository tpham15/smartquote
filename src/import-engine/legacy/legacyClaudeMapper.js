// ============================================================
// Legacy Claude mapper — một chỗ duy nhất gọi /api/claude.
// React components truyền dữ liệu vào, module này chịu trách nhiệm
// build prompt + parse JSON để giữ UI sạch và dễ thay provider sau này.
// ============================================================

const DEFAULT_MODEL = "claude-sonnet-4-6";

/**
 * Gọi /api/claude và trả raw text từ Claude, không parse JSON.
 * Dùng cho PDF vì JSON dài rất dễ bị cắt; caller có thể parse/salvage từng object.
 * @param {{messages:Array, max_tokens?:number, model?:string}} payload
 * @returns {Promise<{text:string, stopReason:string|null, raw:Object}>}
 */
export async function callClaudeText(payload) {
  let data;
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: payload.model || DEFAULT_MODEL,
      max_tokens: payload.max_tokens || 1000,
      messages: payload.messages,
    }),
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
  const base64 = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = e => res(e.target.result.split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });

  const prompt = `Bạn là chuyên gia trích xuất dữ liệu bảng giá sản phẩm. Đọc KỸ file PDF bảng giá này và trích xuất TẤT CẢ sản phẩm — không bỏ sót dòng nào.

QUY TẮC TRÍCH XUẤT:
1. Đọc hết mọi trang, mọi bảng, mọi section/nhóm trong file.
2. Mỗi DÒNG SẢN PHẨM = 1 item (sản phẩm có giá tiền cụ thể).
3. Nhóm/section header (vd "CÔNG TẮC LUTO", "THIẾT BỊ CỔNG TỰ ĐỘNG", "THANH RAY KÉO TAY KS") → dùng làm "category" cho các sản phẩm bên dưới nó, KHÔNG tạo thành item riêng.
4. Nếu mô tả/thông số bị gộp ô (1 mô tả cho nhiều sản phẩm) → áp dụng mô tả đó cho tất cả sản phẩm trong nhóm.

XỬ LÝ CÁC TRƯỜNG HỢP:
- Có MÃ SP riêng (vd LM-S1N/S, 22F005, PHOX2-433) → điền vào "sku".
- KHÔNG có mã SP riêng → để sku rỗng "", giữ nguyên tên đầy đủ.
- Nhiều cột giá (vd "Giá lẻ" + "Giá NPP", hoặc "Giá đại lý"):
  → "costPrice" = giá THẤP NHẤT (giá nhập/đại lý/NPP — giá gốc để công ty mua vào).
  → Ghi các giá khác vào "specs" (vd "Giá lẻ: 41.900.000").
- ĐVT (Bộ/Cái/md/chiếc/đôi) → "unit".
- Giá: bỏ dấu chấm/phẩy phân cách, chỉ lấy số (vd "1,944,000" → 1944000).
- Tên sản phẩm phải NGẮN GỌN, chỉ là tên/model. KHÔNG nhét toàn bộ thông số vào name.
  Ví dụ sai: name="Công tắc tiết kiệm điện Chất liệu: Nhựa PC... Nguồn cấp..."
  Ví dụ đúng: name="Công tắc tiết kiệm điện", specs="Chất liệu: Nhựa PC... Nguồn cấp..."
- Nếu text có từ khóa Chất liệu/Nguồn cấp/Công suất/Kích thước/Tích hợp/Mã khóa..., phần sau các từ đó đưa vào specs.
- Nếu text giá bị dính thành chuỗi rất dài như "7.200.001.600.017...", KHÔNG dùng chuỗi đó; hãy lấy giá tiền rõ ràng hợp lý hoặc để costPrice=0.
- Nếu category bị lỗi font/ký tự lạ, để category="Chung".

BỎ QUA (không phải sản phẩm):
- Dòng tiêu đề cột (STT, Tên, Mã, Đơn giá...).
- Dòng tổng, ghi chú, chính sách, điều khoản thanh toán, bảo hành.
- Thông tin chuyển khoản, địa chỉ, hotline, người phụ trách.
- Dòng chỉ có chữ không có giá tiền.

Trả về JSON array, mỗi item:
{"name":"tên ngắn gọn không chứa specs dài", "sku":"mã hoặc rỗng", "category":"tên nhóm hoặc Chung", "supplier":"${supplierGuess}", "unit":"đvt", "costPrice":số_nguyên, "specs":"thông số kỹ thuật + giá khác nếu có", "rawText":"dòng text nguồn"}

CHỈ trả JSON array thuần, KHÔNG markdown, KHÔNG giải thích. Bắt đầu bằng [ kết thúc bằng ].`;

  try {
    const parsed = await callClaudeJSON({
      max_tokens: 8000,
      messages: [{ role: "user", content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
        { type: "text", text: prompt }
      ]}],
    });
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    throw new Error(e?.message || "AI trả về không đọc được");
  }
}
