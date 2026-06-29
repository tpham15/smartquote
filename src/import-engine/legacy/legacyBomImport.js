// ============================================================
// Legacy BOM / takeoff import — chứa logic đọc Excel cũ được tách
// khỏi React component. Mục tiêu Phase 1: giữ behavior y nguyên.
// ============================================================
import * as XLSX from "xlsx";

/** Đọc file KTS/BOM dạng list vật tư: Tên | Đơn vị | Số lượng. */
export async function parseKtsBomExcel(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });

  const allRows = [];
  let curSection = "";
  let calcFileWarning = false;
  let totalRawRows = 0;

  const isValidName = (s) => {
    if (!s || s.length < 4) return false;
    if (/^[\d\s\.\,\+\-\*\/\(\)\=\<\>]+$/.test(s)) return false;
    if (/SQRT|cosφ|cos[φΦ]|Inm=|trefoil|DC 24V formula|^For |^Z\s*=|^I[nm]=/.test(s)) return false;
    if (!/[a-zA-ZÀ-ỹ]{3,}/.test(s)) return false;
    return true;
  };

  const isValidUnit = (u) => {
    if (!u) return true;
    return /^(cái|bộ|m|mét|chiếc|tủ|hộp|lô|gói|bãi|móng|cọc|cột|hệ thống|ht|bộ|bao|lọ|mối|m2|m3|kg|tấm|thanh|cuộn|vòng|lần|đôi|bình|máy|set|pcs|unit|ea|nos?)$/i.test(u.trim());
  };

  const isValidQty = (q) => {
    if (isNaN(q) || q <= 0) return false;
    const str = String(q);
    if (str.includes("e") || (str.includes(".") && str.split(".")[1].length > 4)) return false;
    return true;
  };

  wb.SheetNames.forEach((sheetName) => {
    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false });

    data.forEach((row) => {
      const col0 = String(row[0] ?? "").trim();
      const col1 = String(row[1] ?? "").trim();
      const col2 = String(row[2] ?? "").trim();
      const col3 = String(row[3] ?? "").trim();

      totalRawRows++;
      if (/cosφ|SQRT|trefoil|Inm=/i.test(col0 + col1)) calcFileWarning = true;

      if (!col1 && col0 && col0.length < 80 && isValidName(col0)) {
        curSection = col0; return;
      }
      if (col0.match(/^[A-Z]{1,2}$|^(I{1,3}|IV|VI?|VII?)$/) && col1 && !col3) {
        curSection = col1; return;
      }
      if (col1 && col1.match(/^(TẦNG|SÂN|MÁI|TUM|PHẦN|KHU|HẠ TẦNG)/i)) {
        curSection = col1; return;
      }

      const name = col1 || col0;
      const unit = col2;
      const qtyRaw = parseFloat(col3);

      if (!isValidName(name)) return;
      if (!isValidQty(qtyRaw)) return;
      if (!isValidUnit(unit)) return;
      if (/^(TÊN GỌI|STT|BẢNG LIỆT KÊ|PHẦN|HẠNG MỤC|QUY CÁCH|ĐƠN VỊ|SỐ LƯỢNG|THỐNG KÊ)/i.test(name)) return;
      if (/^[\d\.]+$/.test(name)) return;

      allRows.push({
        sheet: sheetName,
        section: curSection,
        name: name.replace(/\s+/g, " ").trim(),
        unit: unit || "",
        qty: qtyRaw,
        idx: allRows.length,
      });
    });
  });

  const SKIP_PATTERNS = [
    /^(ống|pipe|tube|hdpe|upvc|pvc\s*d\d)/i,
    /^(cáp|cable|dây điện|cu\.pvc|cu\/pvc|cu\/xlpe|rg\d)/i,
    /^(băng đồng|dây thép|cọc|móng|hào|mối hàn|hóa chất)/i,
    /^(thang cáp|máng cáp|box\s*\d|hộp kỹ thuật)/i,
    /^(điều hòa|dàn lạnh|dàn nóng|cassette|multi|hvac)/i,
    /^(ống gas|ống gió|cửa gió|bảo ôn|quạt hút|quạt cấp)/i,
    /^(vật tư|phụ kiện|vật tư phụ|nhân công|lắp đặt|thi công)/i,
    /^(bản quyền|chi phí|giám sát|lập trình tích hợp)/i,
    /(m2|m3)\s*$/i,
    /^(cột đèn|móng đèn|bảng điện cột|cọc tiếp địa|dây bảo vệ)/i,
    /^(modem|ups|server|nas lưu trữ nhạc)/i,
  ];
  const isSkippable = (name) => SKIP_PATTERNS.some((re) => re.test(name.trim()));

  return {
    allRows,
    toProcess: allRows.filter((r) => !isSkippable(r.name)),
    autoSkipped: allRows.filter((r) => isSkippable(r.name)),
    calcFileWarning,
    totalRawRows,
  };
}

/** Đọc file matrix bóc tách. */
export async function parseTakeoffMatrixFile(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
  const result = parseTakeoffMatrixRows(rows);
  return result.error ? result : { ...result, rawRows: rows };
}

/** Parse bảng ma trận bóc tách: 2 hàng tiêu đề + các hàng tầng/phòng. */
export function parseTakeoffMatrixRows(rows) {
  if (!rows || rows.length < 3) return { error: "File không đủ dữ liệu (cần tiêu đề + ít nhất 1 tầng)." };

  let headerRowIdx = -1;
  for (let r = 0; r < Math.min(rows.length, 6); r++) {
    const first = String(rows[r]?.[0] ?? "").toLowerCase().trim();
    if (first === "tầng" || first === "khu vực" || first === "phòng") { headerRowIdx = r; break; }
  }
  if (headerRowIdx === -1) return { error: "Không tìm thấy hàng tiêu đề bắt đầu bằng 'Tầng'." };

  const groupRow = rows[headerRowIdx] || [];
  const subRow = rows[headerRowIdx + 1] || [];
  const columns = [];
  const columnGroups = [];
  const colIndex = [];

  const maxCol = Math.max(groupRow.length, subRow.length);
  let lastGroup = "";
  for (let c = 1; c < maxCol; c++) {
    const grpRaw = String(groupRow[c] ?? "").trim();
    if (grpRaw) lastGroup = grpRaw;
    const sub = String(subRow[c] ?? "").trim();
    const label = sub || lastGroup;
    if (label) {
      columns.push(label);
      columnGroups.push(lastGroup);
      colIndex.push(c);
    }
  }
  if (columns.length === 0) return { error: "Không đọc được tên cột thiết bị." };

  let title = "";
  for (let r = 0; r < headerRowIdx; r++) {
    const joined = (rows[r] || []).filter(Boolean).join(" ").trim();
    if (joined) { title = joined; break; }
  }

  const floors = [];
  for (let r = headerRowIdx + 2; r < rows.length; r++) {
    const row = rows[r] || [];
    const name = String(row[0] ?? "").trim();
    if (!name) continue;
    if (name.toLowerCase() === "tổng" || name.toLowerCase() === "tong") continue;
    const qtys = {};
    let hasQty = false;
    columns.forEach((col, i) => {
      const v = row[colIndex[i]];
      const num = typeof v === "number" ? v : parseInt(String(v ?? "").replace(/[^\d]/g, ""), 10);
      if (!isNaN(num) && num > 0) { qtys[col] = num; hasQty = true; }
    });
    if (hasQty) floors.push({ name, qtys });
  }
  if (floors.length === 0) return { error: "Không đọc được tầng nào có số lượng." };

  const sharedColumns = {};
  columns.forEach((col) => {
    const floorsWithQty = floors.filter((f) => f.qtys[col] > 0);
    if (floorsWithQty.length === 1 && floors.length > 1) sharedColumns[col] = floorsWithQty[0].qtys[col];
  });

  return { title, columns, columnGroups, colIndex, floors, sharedColumns };
}

/** Đoán sản phẩm khớp với tên cột bóc tách. */
export function guessProductForColumn(colName, products) {
  const c = colName.toLowerCase().trim();
  const tryMatch = (keywords) => products.find((p) => {
    const name = (p.name + " " + p.sku).toLowerCase();
    return keywords.every((k) => name.includes(k));
  });
  const trySku = (skuPart) => products.find((p) => (p.sku || "").toLowerCase().includes(skuPart.toLowerCase()));

  if (c.includes("1 nút") || c === "1 nut") return tryMatch(["công tắc", "1 nút"]) || tryMatch(["luto 1"]);
  if (c.includes("2 nút")) return tryMatch(["công tắc", "2 nút"]) || tryMatch(["luto 2"]);
  if (c.includes("3 nút")) return tryMatch(["công tắc", "3 nút"]) || tryMatch(["luto 3"]);
  if (c.includes("4 nút")) return tryMatch(["công tắc", "4 nút"]) || tryMatch(["luto 4"]);
  if (c.includes("công tắc cổng") || c.includes("cong tac cong")) return tryMatch(["công tắc", "cổng"]);
  if (c.includes("trung tâm") || c.includes("trung tam")) return tryMatch(["trung tâm"]);
  if (c === "cbcđ" || c === "cbcd" || c.includes("chuyển động") || c.includes("chuyen dong")) return tryMatch(["cảm biến", "chuyển động"]) || tryMatch(["cảm biến"]);
  if (c === "cbhd" || c === "cbhđ" || c.includes("hiện diện") || c.includes("hien dien")) return tryMatch(["hiện diện"]);
  if (c.includes("bộ motor") || c.includes("motor")) return tryMatch(["cổng", "motor"]) || tryMatch(["motor"]);
  if (c.includes("cam") && (c.includes("ngoài") || c.includes("ngoai"))) return tryMatch(["camera", "ngoài"]) || trySku("DS-2CD1047");
  if (c.includes("cam") && c.includes("trong")) return tryMatch(["camera", "trong"]) || trySku("DS-2CD1347");
  if (c.includes("đầu ghi") || c.includes("dau ghi") || c.includes("nvr")) return tryMatch(["đầu ghi"]) || trySku("DS-7616");
  if (c.includes("ổ cứng") || c.includes("o cung") || c.includes("hdd")) return tryMatch(["ổ cứng"]) || trySku("WD43");
  if (c.includes("switch") && c.includes("1000")) return trySku("SWITCH-POE-16-1000") || tryMatch(["switch", "1000"]);
  if (c.includes("switch") && (c.includes("16"))) return tryMatch(["switch", "16"]) || trySku("DS-3E1318");
  if (c.includes("switch") && c.includes("poe")) return tryMatch(["switch", "poe"]);
  if (c.includes("wifi") && (c.includes("tường") || c.includes("tuong") || c.includes("gắn") || c.includes("gan"))) return trySku("WIFI-GAN-TUONG") || tryMatch(["wifi"]) || tryMatch(["phát wifi"]);
  if (c.includes("wifi")) return tryMatch(["wifi"]) || tryMatch(["phát wifi"]);
  if (c.includes("cân bằng tải") || c.includes("can bang tai")) return trySku("CAN-BANG-TAI") || tryMatch(["cân bằng"]);
  if (c.includes("rèm") || c.includes("rem")) return tryMatch(["rèm"]);
  if (c.includes("ổ cắm") || c.includes("o cam")) return tryMatch(["ổ cắm"]);
  if (c.includes("hồng ngoại") || c.includes("hong ngoai")) return tryMatch(["hồng ngoại"]);
  return products.find((p) => p.name.toLowerCase().includes(c) && c.length > 4) || null;
}
