import React, { useState, useMemo, useRef, useEffect } from "react";
import * as XLSX from "xlsx";
import { importFileForUI, importManyForUI, productsToImportPreviewResult, combineImportPreviewResults } from "./import-engine/uiAdapter.js";
import { parseKtsBomExcel, parseTakeoffMatrixFile, guessProductForColumn } from "./import-engine/legacy/legacyBomImport.js";
import { parseBomPreviewFile } from "./import-engine/bom/bomPreviewParser.js";
import { saveBomMatchLearning } from "./import-engine/bom/bomMatcher.js";
import { buildBomQuoteVariants, quoteVariantToRooms } from "./import-engine/bom/bomQuoteComposer.js";
import { mapBomRowsWithClaude, mapTakeoffColumnsWithClaude, autoMapCatalogColumnsWithClaude } from "./import-engine/legacy/legacyClaudeMapper.js";
import { parsePdfCatalogWithClaude, parseSupplierPriceFile, guessCatalogColumnsByName, buildCatalogPreview, readCatalogRowsForManualMapping } from "./import-engine/legacy/legacyCatalogImport.js";
import { sanitizeCatalogProducts, isUnsafeImportedProduct, parseSafePrice } from "./import-engine/productSanitizer.js";
import { webScrapeItemsToProducts } from "./import-engine/web/webCatalogImport.js";
import {
  loadCatalogTemplate as loadStoredCatalogTemplate,
  saveCatalogTemplate as persistCatalogTemplate,
  listCatalogTemplates as listStoredCatalogTemplates,
  suggestCatalogTemplates as suggestStoredCatalogTemplates,
  deleteCatalogTemplate as deleteStoredCatalogTemplate,
} from "./import-engine/templateMemory.js";
import {
  applyCorrectionLearning,
  saveProductLearning,
  saveProductLearningBatch,
  listCorrectionLearningStats,
} from "./import-engine/correctionLearning.js";

// ============================================================
// SmartQuote — App báo giá smarthome
// Giải quyết: giá nhà cung cấp đổi liên tục, nhập tay mất thời gian,
// báo giá theo phòng/gói. Sửa giá 1 nơi (catalog) → mọi báo giá dùng giá mới.
// Dữ liệu giữ trong state; dùng Xuất/Nhập JSON để lưu lâu dài & sao lưu.
// ============================================================

const VND = (n) =>
  (Number(n) || 0).toLocaleString("vi-VN", { maximumFractionDigits: 0 }) + "đ";

const uid = (p) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

// ---- Dữ liệu mẫu: thiết bị Lumi thật từ báo giá chị Mỹ ----
// costPrice = GIÁ GỐC nhà phân phối. Giá bán = costPrice × hệ số khách (chọn khi báo giá).
// (giá gốc ở đây = giá bán trong file ÷ 1.6, để demo ra đúng lại giá khách quen thấy)
// Catalog bắt đầu trắng — đại lý import file Excel/PDF bảng giá của họ
const SEED_PRODUCTS = [];
const SEED_CATEGORIES = [];
const buildSeedTemplates = () => [];

export default function SmartQuote() {
  const [tab, setTab] = useState("quote"); // quote | catalog | templates | settings
  const [products, setProducts] = useState(() => {
    try {
      const saved = localStorage.getItem("sq_products");
      return saved ? JSON.parse(saved) : SEED_PRODUCTS;
    } catch { return SEED_PRODUCTS; }
  });
  const [templates, setTemplates] = useState(() => {
    try {
      const saved = localStorage.getItem("sq_templates");
      return saved ? JSON.parse(saved) : buildSeedTemplates();
    } catch { return buildSeedTemplates(); }
  });
  const [company, setCompany] = useState(() => {
    try {
      const saved = localStorage.getItem("sq_company");
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      name: "", phone: "", address: "", taxCode: "",
      laborPercent: 10, quoteNumber: "", salesPerson: "", salesPhone: "",
      website: "", googleApiKey: "", googleCx: "",
    };
  });

  // Các mức hệ số áp cho giá gốc → giá bán
  const [markups, setMarkups] = useState(() => {
    try {
      const saved = localStorage.getItem("sq_markups");
      if (saved) return JSON.parse(saved);
    } catch {}
    return [
      { id: uid("mk"), label: "Khách lẻ (×1.7)", value: 1.7 },
      { id: uid("mk"), label: "Khách quen (×1.6)", value: 1.6 },
    ];
  });

  // Báo giá: mỗi "room" = 1 giải pháp/hạng mục. Bắt đầu với 1 hạng mục trống (SaaS đa ngành)
  const DEFAULT_ROOMS = () => [
    { id: uid("room"), name: "Hạng mục 1", lines: [] },
  ];
  const [rooms, setRooms] = useState(DEFAULT_ROOMS);
  const [customer, setCustomer] = useState({ name: "", phone: "", address: "", project: "" });

  // Danh sách nhà cung cấp — lưu localStorage
  const [suppliersList, setSuppliersList] = useState(() => {
    try {
      const saved = localStorage.getItem("sq_suppliers");
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  });

  // Ánh xạ tên cột trong file bóc tách (vd "1 nút", "Cam ngoài trời") → SKU thiết bị trong catalog.
  // App nhớ lại để lần sau tự khớp, không phải chọn lại.
  const [nameMap, setNameMap] = useState(() => {
    try {
      const saved = localStorage.getItem("sq_nameMap");
      if (saved) return JSON.parse(saved);
    } catch {}
    return {};
  });

  const productById = useMemo(() => {
    const m = {};
    products.forEach((p) => (m[p.id] = p));
    return m;
  }, [products]);

  // ── TỰ ĐỘNG LƯU vào localStorage mỗi khi data thay đổi ──
  useEffect(() => {
    try { localStorage.setItem("sq_products", JSON.stringify(products)); } catch (e) { console.warn("Lưu products lỗi (có thể đầy bộ nhớ):", e); }
  }, [products]);
  useEffect(() => {
    try { localStorage.setItem("sq_templates", JSON.stringify(templates)); } catch {}
  }, [templates]);
  useEffect(() => {
    try { localStorage.setItem("sq_company", JSON.stringify(company)); } catch {}
  }, [company]);
  useEffect(() => {
    try { localStorage.setItem("sq_markups", JSON.stringify(markups)); } catch {}
  }, [markups]);
  useEffect(() => {
    try { localStorage.setItem("sq_suppliers", JSON.stringify(suppliersList)); } catch {}
  }, [suppliersList]);
  useEffect(() => {
    try { localStorage.setItem("sq_nameMap", JSON.stringify(nameMap)); } catch {}
  }, [nameMap]);

  return (
    <div className="app">
      <style>{CSS}</style>

      <header className="topbar">
        <div className="brand">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 1L16 5V13L9 17L2 13V5L9 1Z" stroke="#1B4FD8" strokeWidth="1.5" strokeLinejoin="round"/><path d="M9 5L13 7.5V12.5L9 15L5 12.5V7.5L9 5Z" fill="#1B4FD8" fillOpacity=".2" stroke="#1B4FD8" strokeWidth="1"/></svg>
          <span>SmartQuote</span>
        </div>
        <nav className="tabs">
          <button className={tab === "quote" ? "on" : ""} onClick={() => setTab("quote")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            Báo giá
          </button>
          <button className={(tab === "takeoff" || tab === "ai_reader") ? "on" : ""} onClick={() => setTab("takeoff")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Đọc bóc tách
          </button>
          <button className={tab === "catalog" ? "on" : ""} onClick={() => setTab("catalog")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
            Danh mục
          </button>
          <button className={tab === "ask" ? "on" : ""} onClick={() => setTab("ask")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            Hỏi NCC
          </button>
          <button className={tab === "templates" ? "on" : ""} onClick={() => setTab("templates")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
            Gói phòng
          </button>
          <button className={tab === "settings" ? "on" : ""} onClick={() => setTab("settings")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            Cài đặt
          </button>
        </nav>
      </header>

      <main className="main">
        {tab === "quote" && (
          <QuoteBuilder
            products={products}
            setProducts={setProducts}
            productById={productById}
            templates={templates}
            company={company}
            markups={markups}
            rooms={rooms}
            setRooms={setRooms}
            defaultRooms={DEFAULT_ROOMS}
            customer={customer}
            setCustomer={setCustomer}
          />
        )}
        {tab === "catalog" && (
          <Catalog products={products} setProducts={setProducts} company={company} />
        )}
        {tab === "takeoff" && (
          <TakeoffReader
            products={products}
            nameMap={nameMap}
            setNameMap={setNameMap}
            markups={markups}
            company={company}
            onCreateQuote={(newRooms, customerInfo) => {
              setRooms(newRooms);
              if (customerInfo) setCustomer((c) => ({ ...c, ...customerInfo }));
              setTab("quote");
            }}
          />
        )}
        {tab === "ask" && (
          <AskSupplier
            products={products}
            company={company}
            suppliers={suppliersList}
            setSuppliers={setSuppliersList}
          />
        )}
        {tab === "templates" && (
          <Templates products={products} productById={productById} templates={templates} setTemplates={setTemplates} />
        )}
        {tab === "settings" && (
          <Settings
            company={company}
            setCompany={setCompany}
            markups={markups}
            setMarkups={setMarkups}
            data={{ products, templates, company, markups, suppliers: suppliersList, nameMap }}
            onImport={(d) => {
              if (d.products) setProducts(d.products);
              if (d.templates) setTemplates(d.templates);
              if (d.company) setCompany(d.company);
              if (d.markups) setMarkups(d.markups);
              if (d.suppliers) setSuppliersList(d.suppliers);
              if (d.nameMap) setNameMap(d.nameMap);
            }}
          />
        )}
      </main>
    </div>
  );
}

// ============================================================
// TAB 1 — Tạo báo giá
// ============================================================
function QuoteBuilder({ products, setProducts, productById, templates, company, markups, rooms, setRooms, defaultRooms, customer, setCustomer }) {
  const [pickerRoomId, setPickerRoomId] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [editingLine, setEditingLine] = useState(null); // {roomId, line} đang đổi thiết bị

  // Giá niêm yết gốc của 1 thiết bị (chưa nhân hệ số):
  // - Lumi: costPrice (giá niêm yết)
  // - Cổng (fixed): listPrice (giá bán lẻ cố định)
  const listPriceOf = (p) => {
    if (!p) return 0;
    return p.priceMode === "fixed" ? (p.listPrice || 0) : (p.costPrice || 0);
  };

  // Giá bán 1 dòng = giá niêm yết × hệ số riêng của dòng (factor). Mặc định factor = 1.
  // Hàng cổng (fixed) luôn giữ giá bán lẻ, không nhân (factor ép = 1).
  const lineSalePrice = (p, line) => {
    if (!p) return 0;
    const base = listPriceOf(p);
    if (p.priceMode === "fixed") return base;
    const f = line?.factor || 1;
    return Math.round((base * f) / 1000) * 1000;
  };

  // Tạo thiết bị mới ngay tại chỗ (từ ô tìm trong báo giá) + thêm luôn vào phòng đang chọn
  const createProductAndAdd = (roomId, draft) => {
    const newProduct = {
      id: uid("p"),
      name: draft.name.trim(),
      sku: draft.sku.trim(),
      category: draft.category?.trim() || "",
      supplier: draft.supplier?.trim() || "",
      unit: draft.unit?.trim() || "Cái",
      costPrice: draft.costPrice || 0,
      priceMode: "markup",
      specs: draft.specs?.trim() || "",
      image: draft.image?.trim() || "",
    };
    setProducts((ps) => [...ps, newProduct]); // lưu vào danh mục để lần sau dùng lại
    addProductToRoom(roomId, newProduct.id);  // thêm ngay vào báo giá
  };

  // Đổi thiết bị của 1 dòng (vd Luto → Lumes), giữ nguyên số lượng và hệ số
  const swapLineProduct = (roomId, lineId, newProductId) => {
    setRooms((r) =>
      r.map((room) =>
        room.id === roomId
          ? { ...room, lines: room.lines.map((l) => (l.id === lineId ? { ...l, productId: newProductId } : l)) }
          : room
      )
    );
    setEditingLine(null);
  };

  // Đặt hệ số riêng cho 1 dòng
  const setLineFactor = (roomId, lineId, factor) =>
    setRooms((r) =>
      r.map((room) =>
        room.id === roomId
          ? { ...room, lines: room.lines.map((l) => (l.id === lineId ? { ...l, factor } : l)) }
          : room
      )
    );

  // Cập nhật ghi chú phân bổ tầng cho 1 dòng (vd "Tầng 1: 10, Tầng 2: 7")
  const setLineNote = (roomId, lineId, note) =>
    setRooms((r) =>
      r.map((room) =>
        room.id === roomId
          ? { ...room, lines: room.lines.map((l) => (l.id === lineId ? { ...l, note } : l)) }
          : room
      )
    );

  const SOLUTION_NAMES = [
    "I./ Giải pháp chiếu sáng tự động thông minh\n(Điều khiển tắt/mở đèn từ xa qua Smart Phone, hẹn giờ, cảm ứng…)",
    "II./ Hệ thống cảm biến",
    "III./ Giải pháp cổng tự động thông minh",
    "IV./ Giải pháp camera an ninh",
    "V./ Hệ thống mạng nội bộ + Wifi",
    "VI./ Giải pháp âm thanh đa vùng",
    "VII./ Hệ thống chiếu sáng trang trí",
    "VIII./ Giải pháp rèm thông minh",
  ];

  const addRoom = () => {
    const idx = rooms.length;
    const name = SOLUTION_NAMES[idx] || `${idx + 1}./ Giải pháp ${idx + 1}`;
    setRooms((r) => [...r, { id: uid("room"), name, lines: [] }]);
  };
  const removeRoom = (roomId) => setRooms((r) => r.filter((x) => x.id !== roomId));
  const renameRoom = (roomId, name) =>
    setRooms((r) => r.map((x) => (x.id === roomId ? { ...x, name } : x)));

  // Tạo báo giá mới: reset về 5 giải pháp mặc định
  const newQuote = () => {
    if (rooms.some((r) => r.lines.length > 0)) {
      if (!confirm("Tạo báo giá mới sẽ xóa báo giá hiện tại. Tiếp tục?")) return;
    }
    setRooms(defaultRooms());
    setCustomer({ name: "", phone: "", address: "", project: "" });
  };

  const applyTemplate = (roomId, tplId) => {
    const tpl = templates.find((t) => t.id === tplId);
    if (!tpl) return;
    setRooms((r) =>
      r.map((room) => {
        if (room.id !== roomId) return room;
        const lines = [...room.lines];
        tpl.items.forEach((it) => {
          const existing = lines.find((l) => l.productId === it.productId);
          if (existing) existing.qty += it.qty;
          else lines.push({ id: uid("ln"), productId: it.productId, qty: it.qty, note: "" });
        });
        return { ...room, lines };
      })
    );
  };

  const addProductToRoom = (roomId, productId) => {
    setRooms((r) =>
      r.map((room) => {
        if (room.id !== roomId) return room;
        const existing = room.lines.find((l) => l.productId === productId);
        if (existing)
          return { ...room, lines: room.lines.map((l) => (l.productId === productId ? { ...l, qty: l.qty + 1 } : l)) };
        return { ...room, lines: [...room.lines, { id: uid("ln"), productId, qty: 1, note: "" }] };
      })
    );
  };

  const setQty = (roomId, lineId, qty) =>
    setRooms((r) =>
      r.map((room) =>
        room.id === roomId
          ? { ...room, lines: room.lines.map((l) => (l.id === lineId ? { ...l, qty: Math.max(0, qty) } : l)) }
          : room
      )
    );

  const removeLine = (roomId, lineId) =>
    setRooms((r) =>
      r.map((room) => (room.id === roomId ? { ...room, lines: room.lines.filter((l) => l.id !== lineId) } : room))
    );

  // Di chuyển dòng lên (-1) hoặc xuống (+1) trong danh sách
  const moveLine = (roomId, lineId, dir) =>
    setRooms((r) =>
      r.map((room) => {
        if (room.id !== roomId) return room;
        const lines = [...room.lines];
        const idx = lines.findIndex((l) => l.id === lineId);
        const newIdx = idx + dir;
        if (newIdx < 0 || newIdx >= lines.length) return room;
        [lines[idx], lines[newIdx]] = [lines[newIdx], lines[idx]];
        return { ...room, lines };
      })
    );

  // ---- Tính toán tổng tiền ----
  const calc = useMemo(() => {
    let deviceTotal = 0;
    let pointCount = 0;
    rooms.forEach((room) => {
      room.lines.forEach((l) => {
        const p = productById[l.productId];
        if (!p) return;
        deviceTotal += lineSalePrice(p, l) * l.qty;
        pointCount += l.qty;
      });
    });
    const laborTotal = Math.round((deviceTotal * (company.laborPercent || 0)) / 100);
    const grand = deviceTotal + laborTotal;
    return { deviceTotal, pointCount, laborTotal, grand };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms, productById, company]);

  const exportExcel = async () => {
    if (calc.pointCount === 0) {
      alert("Chưa có thiết bị nào để xuất báo giá.");
      return;
    }
    setExporting(true);
    try {
      await exportQuoteExcel({ company, customer, rooms, productById, lineSalePrice, calc });
    } catch (e) {
      console.error(e);
      alert("Có lỗi khi xuất Excel. Thử lại nhé.");
    } finally {
      setExporting(false);
    }
  };

  const exportPDF = () => {
    if (calc.pointCount === 0) {
      alert("Chưa có thiết bị nào để xuất báo giá.");
      return;
    }
    const html = buildQuotePrintHTML({ company, customer, rooms, productById, lineSalePrice, calc });
    const w = window.open("", "_blank");
    if (!w) {
      alert("Trình duyệt chặn cửa sổ in. Cho phép pop-up rồi thử lại.");
      return;
    }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 500);
  };

  const markupLabel = "";

  return (
    <div className="quote-grid">
      <div className="quote-main">
        {/* Thông tin khách hàng */}
        <section className="card">
          <h2>Thông tin khách hàng</h2>
          <div className="field-grid">
            <Field label="Tên khách hàng / Công trình" value={customer.name} onChange={(v) => setCustomer({ ...customer, name: v })} />
            <Field label="Số điện thoại" value={customer.phone} onChange={(v) => setCustomer({ ...customer, phone: v })} />
            <Field label="Tên công trình" value={customer.project} onChange={(v) => setCustomer({ ...customer, project: v })} />
            <Field label="Địa điểm" value={customer.address} onChange={(v) => setCustomer({ ...customer, address: v })} />
            <Field label="Số báo giá" value={customer.quoteNumber || ""} onChange={(v) => setCustomer({ ...customer, quoteNumber: v })} />
            <Field label="Hạng mục" value={customer.category || ""} onChange={(v) => setCustomer({ ...customer, category: v })} />
          </div>
        </section>

        {/* Các khu vực/giải pháp */}
        {rooms.map((room) => (
          <section className="card room-card" key={room.id}>
            <div className="room-head">
              <textarea className="room-name" rows={2} value={room.name} onChange={(e) => renameRoom(room.id, e.target.value)} />
              <div className="room-head-actions">
                <select
                  className="tpl-select"
                  value=""
                  onChange={(e) => { if (e.target.value) { applyTemplate(room.id, e.target.value); e.target.value = ""; } }}
                >
                  <option value="">+ Thêm gói…</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <button className="btn-ghost" onClick={() => setPickerRoomId(pickerRoomId === room.id ? null : room.id)}>
                  + Thêm thiết bị
                </button>
                {rooms.length > 1 && (
                  <button className="btn-ghost danger" onClick={() => removeRoom(room.id)}>Xóa</button>
                )}
              </div>
            </div>

            {pickerRoomId === room.id && (
              <ProductPicker
                products={products}
                priceOf={listPriceOf}
                onPick={(pid) => addProductToRoom(room.id, pid)}
                onCreate={(draft) => createProductAndAdd(room.id, draft)}
                onClose={() => setPickerRoomId(null)}
              />
            )}

            {room.lines.length === 0 ? (
              <p className="empty-hint">Chưa có thiết bị. Chọn “Thêm gói” để dùng combo dựng sẵn, hoặc “Thêm thiết bị” để chọn lẻ.</p>
            ) : (
              <table className="line-table">
                <thead>
                  <tr>
                    <th className="stt-col">STT</th>
                    <th className="note-col">Khu vực / Phân bổ</th>
                    <th>Thiết bị</th>
                    <th className="num">Niêm yết</th>
                    <th className="num hs-col">Hệ số</th>
                    <th className="num">Đơn giá</th>
                    <th className="num qty-col">SL</th>
                    <th className="num">Thành tiền</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {room.lines.map((l, lineIdx) => {
                    const p = productById[l.productId];
                    if (!p) return null;
                    const isFixed = p.priceMode === "fixed";
                    const base = listPriceOf(p);
                    const sp = lineSalePrice(p, l);
                    const f = l.factor || 1;
                    const missingPrice = base === 0; // chưa có giá

                    // Cập nhật giá vào catalog ngay khi người dùng gõ số
                    const updatePrice = (num) => {
                      if (!num || num <= 0) return;
                      setProducts((ps) => ps.map((x) => x.id === p.id ? { ...x, costPrice: num } : x));
                    };

                    return (
                      <tr key={l.id} className={missingPrice ? "row-missing-price" : ""}>
                        <td className="stt-col">
                          <div className="stt-cell">
                            <span className="stt-num">{lineIdx + 1}</span>
                            <div className="stt-move">
                              <button
                                className="move-btn"
                                title="Lên"
                                disabled={lineIdx === 0}
                                onClick={() => moveLine(room.id, l.id, -1)}
                              >▲</button>
                              <button
                                className="move-btn"
                                title="Xuống"
                                disabled={lineIdx === room.lines.length - 1}
                                onClick={() => moveLine(room.id, l.id, 1)}
                              >▼</button>
                            </div>
                          </div>
                        </td>
                        <td className="note-col">
                          <textarea
                            className="note-input"
                            value={l.note || ""}
                            onChange={(e) => setLineNote(room.id, l.id, e.target.value)}
                            rows={2}
                          />
                        </td>
                        <td>
                          <div className="ln-name">{p.name}</div>
                          <div className="ln-sku">{p.sku}{p.supplier ? ` · ${p.supplier}` : ""}</div>
                        </td>
                        <td className="num">
                          {missingPrice ? (
                            <div className="price-missing-cell">
                              <input
                                type="text" inputMode="numeric"
                                className="price-inline-input"
                                onChange={(e) => {
                                  const n = parseInt(e.target.value.replace(/\D/g,""),10);
                                  if(n>0) updatePrice(n);
                                }}
                                onKeyDown={(e) => { if(e.key==="Enter") e.target.blur(); }}
                              />
                              <span className="price-missing-hint">⚠ Chưa có giá</span>
                            </div>
                          ) : (
                            <span className="muted">{VND(base)}</span>
                          )}
                        </td>
                        <td className="num hs-col">
                          {isFixed ? (
                            <span className="muted hs-fixed">cố định</span>
                          ) : (
                            <div className="hs-cell">
                              <input
                                type="number" step="0.05" min="1" className="hs-input"
                                value={f}
                                onChange={(e) => setLineFactor(room.id, l.id, parseFloat(e.target.value) || 1)}
                              />
                              <div className="hs-quick">
                                <button className={f === 1.6 ? "on" : ""} onClick={() => setLineFactor(room.id, l.id, 1.6)}>1.6</button>
                                <button className={f === 1.7 ? "on" : ""} onClick={() => setLineFactor(room.id, l.id, 1.7)}>1.7</button>
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="num">{VND(sp)}</td>
                        <td className="num qty-col">
                          <input type="text" inputMode="numeric" className="qty-input" value={l.qty}
                            onChange={(e) => setQty(room.id, l.id, parseInt(e.target.value.replace(/\D/g, "")) || 0)} />
                        </td>
                        <td className="num strong">{VND(sp * l.qty)}</td>
                        <td className="ln-actions">
                          <button className="ln-edit" title="Đổi thiết bị" onClick={() => setEditingLine({ roomId: room.id, line: l })}>✎</button>
                          <button className="x-btn" onClick={() => removeLine(room.id, l.id)}>×</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        ))}

        <div className="quote-actions-bottom">
          <button className="btn-add-room" onClick={addRoom}>+ Thêm giải pháp</button>
          <button className="btn-ghost" onClick={newQuote}>⟳ Báo giá mới</button>
        </div>
      </div>

      {/* Cột tổng kết bên phải */}
      <aside className="quote-side">
        <div className="card summary">
          <h2>Tổng kết</h2>

          <Row label={`Tiền hàng (${calc.pointCount} thiết bị)`} value={VND(calc.deviceTotal)} />
          <Row label={`Nhân công, lập trình (${company.laborPercent}%)`} value={VND(calc.laborTotal)} />
          <div className="grand">
            <span>Giá trị hợp đồng</span>
            <span>{VND(calc.grand)}</span>
          </div>
          <div className="export-btns">
            <button className="btn-primary" disabled={exporting} onClick={exportExcel}>
              {exporting ? "Đang tạo…" : "Xuất Excel"}
            </button>
            <button className="btn-pdf" onClick={exportPDF}>Xuất PDF</button>
          </div>
          <p className="side-note">
            Đơn giá mặc định là <strong>giá niêm yết</strong>. Gõ hệ số (vd 1.6, 1.7) ở từng dòng để nhân giá riêng.
            <strong> Excel</strong> để sửa/tính nội bộ, <strong>PDF</strong> để gửi khách xem.
          </p>
        </div>
      </aside>

      {/* Modal đổi thiết bị của 1 dòng */}
      {editingLine && (
        <LineProductSwap
          products={products}
          current={productById[editingLine.line.productId]}
          onSwap={(pid) => swapLineProduct(editingLine.roomId, editingLine.line.id, pid)}
          onClose={() => setEditingLine(null)}
        />
      )}
    </div>
  );
}

// Modal đổi thiết bị cho 1 dòng (giữ nguyên SL & hệ số)
function LineProductSwap({ products, current, onSwap, onClose }) {
  const [q, setQ] = useState("");
  const filtered = products.filter(
    (p) => p.name.toLowerCase().includes(q.toLowerCase()) || (p.sku || "").toLowerCase().includes(q.toLowerCase())
  );
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Đổi thiết bị</h2>
        {current && (
          <p className="tab-intro" style={{ margin: "0 0 12px" }}>
            Đang chọn: <strong>{current.name}</strong> ({current.sku}). Chọn thiết bị thay thế bên dưới — số lượng và hệ số giữ nguyên.
          </p>
        )}
        <input className="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} style={{ width: "100%", marginBottom: 10 }} />
        <div className="swap-list">
          {filtered.slice(0, 30).map((p) => (
            <button key={p.id} className={`picker-item ${current && p.id === current.id ? "cur" : ""}`} onClick={() => onSwap(p.id)}>
              {p.image && <img src={imgSrc(p.image)} alt="" loading="lazy" className="pi-thumb" onError={(e)=>{e.currentTarget.style.display="none"}} />}
              <span className="pi-name">{p.name}</span>
              <span className="pi-meta">{p.sku}{p.supplier ? ` · ${p.supplier}` : ""}</span>
            </button>
          ))}
          {filtered.length === 0 && <div className="empty-hint">Không tìm thấy thiết bị.</div>}
        </div>
        <div className="modal-actions">
          <button className="btn-ghost" onClick={onClose}>Hủy</button>
        </div>
      </div>
    </div>
  );
}

function ProductPicker({ products, priceOf, onPick, onCreate, onClose }) {
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(null); // draft thiết bị mới đang tạo

  const filtered = products.filter(
    (p) => p.name.toLowerCase().includes(q.toLowerCase()) || (p.sku || "").toLowerCase().includes(q.toLowerCase())
  );

  const startCreate = () => {
    // Đoán: nếu chuỗi tìm trông giống mã (có gạch/chữ in hoa) thì điền vào ô mã, ngược lại điền tên
    const looksLikeSku = /[-/]/.test(q) || (q === q.toUpperCase() && /\d/.test(q));
    setCreating({
      name: looksLikeSku ? "" : q,
      sku: looksLikeSku ? q : "",
      category: "", supplier: "", unit: "Cái", costPrice: 0, specs: "", image: "",
    });
  };

  const submitCreate = () => {
    if (!creating.name.trim() && !creating.sku.trim()) {
      alert("Nhập tên hoặc mã thiết bị.");
      return;
    }
    if (!creating.costPrice || creating.costPrice <= 0) {
      alert("Nhập giá gốc của thiết bị.");
      return;
    }
    onCreate(creating);
    setCreating(null);
    setQ("");
  };

  // Đang ở chế độ tạo mới
  if (creating) {
    return (
      <div className="picker">
        <div className="picker-create-head">
          <strong>Thêm thiết bị mới vào danh mục</strong>
          <button className="btn-ghost" onClick={() => setCreating(null)}>← Quay lại</button>
        </div>
        <div className="picker-create-grid">
          <label className="field"><span>Tên thiết bị *</span>
            <input autoFocus value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.target.value })} /></label>
          <label className="field"><span>Mã sản phẩm (SKU)</span>
            <input value={creating.sku} onChange={(e) => setCreating({ ...creating, sku: e.target.value })} /></label>
          <label className="field"><span>Nhóm thiết bị</span>
            <input value={creating.category} onChange={(e) => setCreating({ ...creating, category: e.target.value })} /></label>
          <label className="field"><span>Nhà cung cấp</span>
            <input value={creating.supplier} onChange={(e) => setCreating({ ...creating, supplier: e.target.value })} /></label>
          <label className="field"><span>Đơn vị tính</span>
            <input value={creating.unit} onChange={(e) => setCreating({ ...creating, unit: e.target.value })} /></label>
          <label className="field"><span>Giá niêm yết (đ) *</span>
            <input type="text" inputMode="numeric" value={creating.costPrice || ""} onChange={(e) => setCreating({ ...creating, costPrice: parseInt(e.target.value.replace(/\D/g,""),10)||0 })} /></label>
        </div>
        <label className="field" style={{ marginTop:10, display:"block" }}>
          <span>Thông số kỹ thuật (hiện trong báo giá PDF)</span>
          <textarea rows={2} className="specs-textarea" value={creating.specs||""} onChange={(e) => setCreating({ ...creating, specs: e.target.value })} />
        </label>
        <div style={{ display:"flex", gap:8, marginTop:12 }}>
          <button className="btn-primary" style={{ flex:1 }} onClick={submitCreate}>✔ Thêm vào báo giá</button>
          <button className="btn-ghost" onClick={() => setCreating(null)}>Hủy</button>
        </div>
      </div>
    );
  }

  return (
    <div className="picker">
      <div className="picker-bar">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn-ghost" onClick={onClose}>Đóng</button>
      </div>
      <div className="picker-list">
        {filtered.map((p) => (
          <button key={p.id} className="picker-item" onClick={() => onPick(p.id)}>
            {p.image && <img src={imgSrc(p.image)} alt="" loading="lazy" className="pi-thumb" onError={(e)=>{e.currentTarget.style.display="none"}} />}
            <span className="pi-name">{p.name}</span>
            <span className="pi-meta">{p.sku} · {VND(priceOf ? priceOf(p) : p.costPrice)}</span>
          </button>
        ))}
      </div>
      {filtered.length === 0 && q.trim() && (
        <div className="empty-hint">Không tìm thấy &quot;{q.trim()}&quot; trong danh mục.</div>
      )}
      {/* Nút tạo mới LUÔN HIỆN — không cần gõ không ra mới thấy */}
      <button className="picker-create-btn" onClick={startCreate}>
        {q.trim() && filtered.length === 0
          ? "+ Thêm mới vào danh mục"
          : "+ Tạo thiết bị mới (chưa có trong danh mục)"}
      </button>
    </div>
  );
}

// ============================================================
// TAB — Hỏi giá nhà cung cấp (soạn tin, copy, mở Zalo)
// ============================================================
function AskSupplier({ products, company, suppliers, setSuppliers }) {
  const [askItems, setAskItems] = useState([]); // {key, code, name} - món cần hỏi
  const [freeCode, setFreeCode] = useState(""); // gõ mã/tên tự do
  const [q, setQ] = useState(""); // tìm trong catalog
  const [selectedSupplier, setSelectedSupplier] = useState(suppliers[0]?.id || "");
  const [copied, setCopied] = useState(false);
  const [editingNcc, setEditingNcc] = useState(null);

  const supplier = suppliers.find((s) => s.id === selectedSupplier);

  const addFromCatalog = (p) => {
    if (askItems.some((it) => it.key === p.id)) return;
    setAskItems((a) => [...a, { key: p.id, code: p.sku, name: p.name }]);
  };
  const addFreeCode = () => {
    const v = freeCode.trim();
    if (!v) return;
    setAskItems((a) => [...a, { key: uid("free"), code: v, name: "" }]);
    setFreeCode("");
  };
  const removeItem = (key) => setAskItems((a) => a.filter((it) => it.key !== key));

  // Soạn nội dung tin nhắn hỏi giá — văn phong lịch sự, gọn, theo cách chị bạn đang dùng
  const message = useMemo(() => {
    if (askItems.length === 0) return "";
    const greeting = supplier ? `Dạ ${supplier.name.split(" ")[0]} ơi, ` : "Dạ shop ơi, ";
    if (askItems.length === 1) {
      const it = askItems[0];
      const label = it.name ? `${it.name} (${it.code})` : it.code;
      return `${greeting}cho em hỏi mã ${label} còn hàng và giá hiện tại bao nhiêu ạ? Em cảm ơn!`;
    }
    const lines = askItems.map((it, i) => {
      const label = it.name ? `${it.name} - ${it.code}` : it.code;
      return `${i + 1}. ${label}`;
    });
    return `${greeting}cho em hỏi giá và tình trạng hàng các mã sau ạ:\n${lines.join("\n")}\n\nEm cảm ơn ạ!`;
  }, [askItems, supplier]);

  const copyMsg = async () => {
    if (!message) return;
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert("Không copy được tự động. Hãy bôi đen nội dung và copy thủ công.");
    }
  };

  const openZalo = () => {
    if (!supplier?.phone) {
      alert("Nhà cung cấp này chưa có số điện thoại. Thêm số ở danh sách bên dưới để mở Zalo trực tiếp.");
      return;
    }
    // Link mở chat Zalo với 1 người theo số điện thoại
    window.open(`https://zalo.me/${supplier.phone.replace(/\D/g, "")}`, "_blank");
  };

  const filtered = products.filter(
    (p) => p.name.toLowerCase().includes(q.toLowerCase()) || (p.sku || "").toLowerCase().includes(q.toLowerCase())
  );

  const saveNcc = (ncc) => {
    if (ncc.id) setSuppliers((s) => s.map((x) => (x.id === ncc.id ? ncc : x)));
    else {
      const created = { ...ncc, id: uid("ncc") };
      setSuppliers((s) => [...s, created]);
      setSelectedSupplier(created.id);
    }
    setEditingNcc(null);
  };
  const deleteNcc = (id) => {
    if (confirm("Xóa nhà cung cấp này?")) setSuppliers((s) => s.filter((x) => x.id !== id));
  };

  return (
    <div className="ask-grid">
      <div className="ask-main">
        <section className="card">
          <h2>Chọn thiết bị cần hỏi giá</h2>
          <p className="tab-intro" style={{ margin: "0 0 12px" }}>
            Chọn từ bảng giá có sẵn, hoặc gõ mã thiết bị mới (chưa có trong bảng giá) để hỏi.
          </p>

          <div className="ask-add-row">
            <input
              className="search"
              value={freeCode}
              onChange={(e) => setFreeCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addFreeCode(); }}
            />
            <button className="btn-ghost" onClick={addFreeCode}>+ Thêm mã</button>
          </div>

          <div className="ask-catalog-search">
            <input className="search" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {q && (
            <div className="picker-list" style={{ marginTop: 8 }}>
              {filtered.slice(0, 8).map((p) => (
                <button key={p.id} className="picker-item" onClick={() => addFromCatalog(p)}>
                  {p.image && <img src={imgSrc(p.image)} alt="" loading="lazy" className="pi-thumb" onError={(e)=>{e.currentTarget.style.display="none"}} />}
                  <span className="pi-name">{p.name}</span>
                  <span className="pi-meta">{p.sku}</span>
                </button>
              ))}
              {filtered.length === 0 && <div className="empty-hint">Không tìm thấy.</div>}
            </div>
          )}

          {askItems.length > 0 && (
            <div className="ask-chips">
              {askItems.map((it) => (
                <span className="ask-chip" key={it.key}>
                  {it.name ? `${it.name} (${it.code})` : it.code}
                  <button onClick={() => removeItem(it.key)}>×</button>
                </span>
              ))}
            </div>
          )}
        </section>

        {askItems.length > 0 && (
          <section className="card">
            <h2>Nội dung tin nhắn</h2>
            <textarea className="ask-msg" value={message} readOnly rows={Math.min(3 + askItems.length, 12)} />
            <div className="ask-actions">
              <button className="btn-primary" onClick={copyMsg}>{copied ? "✓ Đã copy" : "Copy nội dung"}</button>
              <button className="btn-excel" onClick={openZalo}>Mở Zalo với NCC</button>
            </div>
            <p className="side-note">
              Zalo không cho điền sẵn nội dung qua link, nên cách nhanh nhất: bấm <strong>Copy nội dung</strong> → bấm
              <strong> Mở Zalo</strong> → dán vào ô chat rồi gửi. Với nhóm Zalo (nhiều NCC), mở app Zalo và dán vào nhóm.
            </p>
          </section>
        )}
      </div>

      <aside className="ask-side">
        <div className="card">
          <h2>Nhà cung cấp</h2>
          <select className="form-select" style={{ width: "100%", marginBottom: 10 }} value={selectedSupplier} onChange={(e) => setSelectedSupplier(e.target.value)}>
            {suppliers.length === 0 && <option value="">Chưa có NCC</option>}
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          {supplier && (
            <div className="ncc-info">
              <div>{supplier.phone ? `ĐT: ${supplier.phone}` : "Chưa có số điện thoại"}</div>
              {supplier.note && <div className="muted">{supplier.note}</div>}
              <div className="ncc-info-actions">
                <button className="link" onClick={() => setEditingNcc(supplier)}>Sửa</button>
                <button className="link danger" onClick={() => deleteNcc(supplier.id)}>Xóa</button>
              </div>
            </div>
          )}

          <button className="btn-ghost" style={{ width: "100%", marginTop: 10 }} onClick={() => setEditingNcc({ name: "", phone: "", note: "" })}>
            + Thêm nhà cung cấp
          </button>
        </div>
      </aside>

      {editingNcc && (
        <div className="modal-backdrop" onClick={() => setEditingNcc(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editingNcc.id ? "Sửa nhà cung cấp" : "Thêm nhà cung cấp"}</h2>
            <div className="field-grid">
              <Field label="Tên NCC" value={editingNcc.name} onChange={(v) => setEditingNcc({ ...editingNcc, name: v })} full />
              <Field label="Số điện thoại (để mở Zalo)" value={editingNcc.phone} onChange={(v) => setEditingNcc({ ...editingNcc, phone: v })} />
              <Field label="Ghi chú (vd tên nhóm Zalo)" value={editingNcc.note} onChange={(v) => setEditingNcc({ ...editingNcc, note: v })} />
            </div>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setEditingNcc(null)}>Hủy</button>
              <button className="btn-primary" onClick={() => { if (!editingNcc.name) { alert("Nhập tên NCC."); return; } saveNcc(editingNcc); }}>Lưu</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// TAB — Đọc file bóc tách khối lượng (bảng ma trận tầng × thiết bị)
// ============================================================
// Helper: proxy ảnh qua Vercel để tránh CORS/hotlink block
const imgSrc = (url) => {
  if (!url) return "";
  if (url.startsWith("data:")) return url; // data URI dùng trực tiếp
  if (url.includes("encrypted-tbn") || url.includes("gstatic.com/images?q=tbn")) return ""; // Google thumbnail không dùng được
  if (typeof window !== "undefined" && window.location.protocol === "https:") {
    return `/api/img?url=${encodeURIComponent(url)}`;
  }
  return url; // local: dùng URL gốc
};

// Img với fallback: proxy → URL gốc → ẩn
const ImgWithFallback = ({ src, className, style, alt = "" }) => {
  if (!src) return null;
  const proxied = imgSrc(src);
  if (!proxied) return null;
  return React.createElement("img", {
    src: proxied,
    alt,
    className,
    style,
    loading: "lazy",
    onError: (e) => {
      // Nếu proxy lỗi → thử URL gốc
      if (e.currentTarget.src !== src) {
        e.currentTarget.src = src;
      } else {
        e.currentTarget.style.display = "none";
        if (e.currentTarget.nextSibling) e.currentTarget.nextSibling.style.display = "flex";
      }
    },
  });
};
// ============================================================
function SearchSelect({ products, value, onChange, placeholder = "Tìm thiết bị...", hasValue }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrapRef = useRef();
  const inputRef = useRef();

  const selected = products.find((p) => p.id === value);

  // Đóng khi click ngoài
  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        setQ("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = q.trim()
    ? products.filter((p) =>
        p.name.toLowerCase().includes(q.toLowerCase()) ||
        (p.sku || "").toLowerCase().includes(q.toLowerCase())
      ).slice(0, 20)
    : products.slice(0, 60); // hiện 60 item đầu khi chưa search

  const handleOpen = () => {
    setOpen(true);
    setQ("");
    setTimeout(() => inputRef.current?.focus(), 30);
  };

  const handleSelect = (p) => {
    onChange(p ? p.id : "");
    setOpen(false);
    setQ("");
  };

  return (
    <div className="ss-wrap" ref={wrapRef}>
      {/* Trigger button */}
      <button
        type="button"
        className={`ss-trigger${hasValue ? "" : " ss-unmapped"}`}
        onClick={handleOpen}
      >
        <svg className="ss-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <span className={selected ? "ss-val" : "ss-placeholder"}>
          {selected ? `${selected.name} (${selected.sku})` : placeholder}
        </span>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: "auto", flexShrink: 0, color: "var(--muted)" }}><polyline points="6 9 12 15 18 9"/></svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="ss-dropdown">
          {/* Search input */}
          <div className="ss-search-bar">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              ref={inputRef}
              className="ss-search-inp"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
            {q && <button className="ss-clear" onClick={() => setQ("")}>×</button>}
          </div>

          {/* List */}
          <div className="ss-list">
            <div className="ss-item ss-item-empty" onClick={() => handleSelect(null)}>
              — Bỏ qua cột này —
            </div>
            {filtered.length === 0 && (
              <div className="ss-no-result">Không tìm thấy "{q}"</div>
            )}
            {filtered.map((p) => {
              const tag = (p.supplier || "").toLowerCase();
              const tagCls = tag.includes("lumi") ? "tag-ncc tag-lumi"
                : tag.includes("hikvision") || tag.includes("hik") ? "tag-ncc tag-hik"
                : tag.includes("ruijie") ? "tag-ncc tag-ruijie"
                : tag.includes("bisco") ? "tag-ncc tag-bisco"
                : tag.includes("roger") ? "tag-ncc tag-roger" : "";
              return (
                <div
                  key={p.id}
                  className={`ss-item${p.id === value ? " ss-selected" : ""}`}
                  onClick={() => handleSelect(p)}
                >
                  {p.image && <img src={imgSrc(p.image)} alt="" className="ss-thumb" onError={(e) => { e.currentTarget.style.display = "none"; }} />}
                  <div className="ss-item-info">
                    <span className="ss-item-name">{p.name}</span>
                    <span className="ss-item-meta">{p.sku}{tagCls && <span className={tagCls} style={{ marginLeft: 6 }}>{p.supplier}</span>}</span>
                  </div>
                  {p.id === value && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: "var(--brand)" }}><polyline points="20 6 9 17 4 12"/></svg>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
function AIReader({ products, setProducts, company, onCreateQuote, embedded = false, ktsFileRef = null, onBack = null }) {
  const [step, setStep] = useState("upload"); // upload | parsing | review | done
  const [rows, setRows] = useState([]); // {section, name, unit, qty}
  const [mapped, setMapped] = useState([]); // {row, product, qty, confidence, section}
  const [unmatched, setUnmatched] = useState([]); // {row} cần chọn tay
  const [ignored, setIgnored] = useState([]); // {row} bỏ qua
  const [progress, setProgress] = useState({ cur: 0, total: 0, msg: "" });
  const [manualMap, setManualMap] = useState({}); // rowIdx → productId
  const [sectionMap, setSectionMap] = useState({}); // rowIdx → solution name
  const fileRef = useRef();

  // Đọc file Excel KTS → danh sách rows có số lượng (legacy module)
  const handleBomFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBomStatus("loading");
    setBomError("");
    try {
      const result = await parseBomPreviewFile(file, products);
      setBomPreview(result);
      setBomFilter(result.review > 0 ? "review" : result.ready > 0 ? "ready" : "all");
      setBomStatus("done");
    } catch (err) {
      console.error("BOM preview parser lỗi:", err);
      setBomError("Không đọc được file BOM/dự toán. Hãy kiểm tra file Excel có bảng vật tư, số lượng và đơn vị.");
      setBomStatus("error");
    } finally {
      e.target.value = "";
    }
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const { allRows, toProcess, autoSkipped, calcFileWarning } = await parseKtsBomExcel(file);

      if (calcFileWarning && allRows.length < 10) {
        alert(
          "⚠️ File này có vẻ là bảng tính toán kỹ thuật (cosφ, SQRT, Inm...) chứ không phải bảng khối lượng vật tư.\n\n" +
          "Hãy upload đúng file \"Bảng liệt kê khối lượng\" hoặc \"Bảng khối lượng vật tư\" từ KTS.\n\n" +
          "File đúng thường có các cột: STT | Tên vật tư | Đơn vị | Số lượng"
        );
        setStep("upload");
        return;
      }

      if (allRows.length === 0) {
        alert("Không tìm thấy dòng vật tư nào hợp lệ trong file.\n\nFile cần có dạng bảng với cột: Tên vật tư | Đơn vị | Số lượng");
        setStep("upload");
        return;
      }

      if (toProcess.length === 0) {
        alert(`Không có vật tư nào phù hợp với catalog của công ty trong file này.\n\n` +
          `File có ${allRows.length} dòng nhưng đều là vật tư ngoài phạm vi (ống, cáp, điều hòa...).\n\n` +
          `Hãy upload file bảng khối lượng điện nhẹ / smarthome / camera.`);
        setStep("upload");
        return;
      }

      setRows(allRows);
      setIgnored(autoSkipped);
      setStep("parsing");
      await runAIMapping(toProcess);
    } catch (err) {
      console.error(err);
      alert("Không đọc được file. Đảm bảo đúng định dạng Excel (.xlsx/.xls).");
      setStep("upload");
    }
  };

  // Gọi Claude API qua legacy mapper để map từng batch rows sang catalog
  const runAIMapping = async (allRows) => {
    if (!allRows.length) return;
    const results = await mapBomRowsWithClaude(allRows, products, setProgress);
    const mappedList = results.filter((r) => r.productId && (r.confidence === "high" || r.confidence === "medium"));
    const unmatchedList = results.filter((r) => !r.productId || r.confidence === "low");
    setMapped(mappedList);
    setUnmatched(unmatchedList);
    setStep("review");
    setProgress({ cur: allRows.length, total: allRows.length, msg: "Hoàn tất!" });
  };

  // Tạo báo giá từ kết quả đã review
  const buildQuote = () => {
    const solutionOrder = [
      "I./ Giải pháp chiếu sáng tự động thông minh\n(Điều khiển tắt/mở đèn từ xa qua Smart Phone, hẹn giờ, cảm ứng…)",
      "II./ Hệ thống cảm biến",
      "III./ Giải pháp cổng tự động thông minh",
      "IV./ Giải pháp camera an ninh",
      "V./ Hệ thống mạng nội bộ + Wifi",
      "VI./ Giải pháp âm thanh đa vùng",
    ];

    const roomMap = {};
    const addLine = (solutionName, productId, qty, note) => {
      if (!roomMap[solutionName]) roomMap[solutionName] = [];
      // Gộp dòng trùng productId
      const existing = roomMap[solutionName].find((l) => l.productId === productId);
      if (existing) { existing.qty += qty; }
      else roomMap[solutionName].push({ id: uid("ln"), productId, qty, note: note || "" });
    };

    // Thêm các dòng đã map
    mapped.forEach((r) => {
      const sol = r.solution || solutionOrder[0];
      addLine(sol, r.productId, r.qty, `${r.section}: ${r.qty}`);
    });

    // Thêm các dòng được chọn thủ công
    unmatched.forEach((r) => {
      const pid = manualMap[r.idx];
      if (pid) {
        const sol = sectionMap[r.idx] || solutionOrder[0];
        addLine(sol, pid, r.qty, `${r.section}: ${r.qty}`);
      }
    });

    // Sắp xếp theo thứ tự La Mã
    const romanOrder = (name) => {
      const m = name.match(/^(I{1,3}|IV|V|VI{0,3})\./);
      if (!m) return 99;
      const map = { "I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6 };
      return map[m[1]] || 99;
    };

    const rooms = Object.entries(roomMap)
      .sort(([a], [b]) => romanOrder(a) - romanOrder(b))
      .map(([name, lines]) => ({ id: uid("room"), name, lines }))
      .filter((r) => r.lines.length > 0);

    if (!rooms.length) { alert("Chưa có thiết bị nào được ghép. Hãy chọn thiết bị cho các dòng chưa map."); return; }
    onCreateQuote(rooms, {});
  };

  // ---- RENDER ----
  const pct = progress.total ? Math.round((progress.cur / progress.total) * 100) : 0;

  return (
    <div className="takeoff">
      {!embedded && (
        <>
          <h2 className="section-title">🤖 AI đọc file khối lượng KTS</h2>
          <p className="tab-intro">
            Upload file Excel khối lượng từ kiến trúc sư/kỹ sư điện. AI tự động nhận diện vật tư và ghép sang catalog của công ty.
            Không cần train nhân viên — AI xử lý trong vài giây.
          </p>
        </>
      )}

      {step === "upload" && (
        <section className="card">
          {embedded && onBack && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Bảng khối lượng từ KTS / kỹ sư</h2>
                <p className="tab-intro" style={{ margin: "4px 0 0" }}>AI đọc danh sách vật tư, tự ghép sang catalog. Không cần train nhân viên.</p>
              </div>
              <button className="btn-ghost" style={{ fontSize: 12, flexShrink: 0 }} onClick={onBack}>← Đổi loại file</button>
            </div>
          )}
          <div
            className="ai-drop-zone"
            onClick={() => (ktsFileRef || fileRef).current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) { handleFile({ target: { files: [f] } }); } }}
          >
            <div className="ai-drop-icon">📂</div>
            <div className="ai-drop-text">Kéo thả hoặc bấm để chọn file Excel (.xlsx)</div>
            <div className="ai-drop-sub">File bảng khối lượng điện / điện nhẹ / HVAC từ KTS</div>
          </div>
          {!embedded && <input ref={fileRef} type="file" accept=".xlsx,.xls" hidden onChange={handleFile} />}
          {embedded && <input ref={ktsFileRef || fileRef} type="file" accept=".xlsx,.xls" hidden onChange={handleFile} />}
        </section>
      )}

      {step === "parsing" && (
        <section className="card">
          {embedded && onBack && (
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Bảng khối lượng từ KTS / kỹ sư</span>
              <button className="btn-ghost" style={{ fontSize: 12 }} onClick={onBack}>← Đổi loại file</button>
            </div>
          )}
          <div className="ai-progress-wrap">
            <div className="ai-progress-bar">
              <div className="ai-progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="ai-progress-label">🤖 {progress.msg} ({pct}%)</div>
          </div>
          <p className="tab-intro" style={{ marginTop: 12 }}>
            AI đang đọc {progress.total} dòng vật tư và tìm sản phẩm tương đương trong catalog...
          </p>
        </section>
      )}

      {step === "review" && (
        <section className="card">
          <div className="ai-review-header">
            <h3>Kết quả phân tích — {rows.length} dòng vật tư</h3>
            <div style={{ display: "flex", gap: 8 }}>
              {embedded && onBack && (
                <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => { setStep("upload"); setRows([]); setMapped([]); setUnmatched([]); setManualMap({}); }}>
                  ← Upload lại
                </button>
              )}
              <button className="btn-primary" style={{ width: "auto" }} onClick={buildQuote}>
                ✓ Tạo báo giá ({mapped.length + Object.keys(manualMap).length} thiết bị)
              </button>
            </div>
          </div>

          {/* Đã map tự động */}
          {mapped.length > 0 && (
            <details open>
              <summary className="ai-section-title ai-ok">
                ✅ Đã tự động ghép — {mapped.length} dòng
              </summary>
              <table className="cat-table" style={{ marginTop: 8 }}>
                <thead><tr>
                  <th>Vật tư KTS</th><th>SL</th><th>→ Sản phẩm catalog</th><th>Nhóm giải pháp</th><th>Độ tin cậy</th>
                </tr></thead>
                <tbody>
                  {mapped.map((r, i) => {
                    const p = products.find((x) => x.id === r.productId);
                    return (
                      <tr key={i}>
                        <td><div className="strong">{r.name}</div><div className="ln-sku">{r.section}</div></td>
                        <td className="num">{r.qty}</td>
                        <td>{p ? <><div className="strong">{p.name}</div><div className="ln-sku">{p.sku}</div></> : "—"}</td>
                        <td style={{ fontSize: 11 }}>{r.solution?.split("\n")[0]}</td>
                        <td><span className={`badge-conf-${r.confidence}`}>{r.confidence === "high" ? "Cao" : "Vừa"}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </details>
          )}

          {/* Cần chọn thủ công */}
          {unmatched.length > 0 && (
            <details open>
              <summary className="ai-section-title ai-warn">
                ⚠️ Cần chọn thủ công — {unmatched.length} dòng (bỏ qua hoặc ghép tay)
              </summary>
              <table className="cat-table" style={{ marginTop: 8 }}>
                <thead><tr>
                  <th>Vật tư KTS</th><th>SL</th><th>Lý do AI không ghép</th><th>Ghép với sản phẩm</th>
                </tr></thead>
                <tbody>
                  {unmatched.map((r, i) => (
                    <tr key={i} className={manualMap[r.idx] ? "" : "row-unmapped"}>
                      <td><div className="strong">{r.name}</div><div className="ln-sku">{r.section} · {r.qty} {r.unit}</div></td>
                      <td className="num">{r.qty}</td>
                      <td style={{ fontSize: 11, color: "#888" }}>{r.reason || "Không có trong catalog"}</td>
                      <td>
                        <select
                          className="map-select"
                          value={manualMap[r.idx] || ""}
                          onChange={(e) => setManualMap((m) => ({ ...m, [r.idx]: e.target.value }))}
                        >
                          <option value="">— Bỏ qua dòng này —</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}

          {/* Bỏ qua tự động */}
          {ignored.length > 0 && (
            <details>
              <summary className="ai-section-title" style={{ color: "var(--muted)" }}>
                ⊘ Bỏ qua tự động — {ignored.length} dòng (ống, cáp, điều hòa... ngoài phạm vi catalog)
              </summary>
              <div style={{ fontSize: 12, color: "#aaa", padding: "8px 0", lineHeight: 1.8 }}>
                {ignored.map((r, i) => (
                  <span key={i} style={{ display: "inline-block", background: "#f1f5f9", borderRadius: 4, padding: "2px 8px", margin: "2px" }}>
                    {r.name} ({r.qty} {r.unit})
                  </span>
                ))}
              </div>
            </details>
          )}

          <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
            <button className="btn-primary" style={{ flex: 1 }} onClick={buildQuote}>
              ✓ Tạo báo giá ({mapped.length + Object.keys(manualMap).length} thiết bị)
            </button>
            <button className="btn-ghost" onClick={() => { setStep("upload"); setRows([]); setMapped([]); setUnmatched([]); setManualMap({}); }}>
              ↩ Upload file khác
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function TakeoffReader({ products, nameMap, setNameMap, markups, company, onCreateQuote }) {
  const [mode, setMode] = useState(""); // "" | "bom" | "matrix" | "kts"
  const [pendingOpen, setPendingOpen] = useState(""); // "bom" | "matrix" | "kts" — chờ render xong rồi click
  const [parsed, setParsed] = useState(null);
  const [mapping, setMapping] = useState({});
  const [aiStatus, setAiStatus] = useState("");
  const [bomPreview, setBomPreview] = useState(null);
  const [bomStatus, setBomStatus] = useState("");
  const [bomFilter, setBomFilter] = useState("all");
  const [bomError, setBomError] = useState("");
  const [bomResolutions, setBomResolutions] = useState({});
  const [bomIgnored, setBomIgnored] = useState({});
  const [bomQuoteGrouping, setBomQuoteGrouping] = useState("scope"); // "scope" | "area" | "pack"
  const [bomPackSelections, setBomPackSelections] = useState({});
  const [bomQuoteVariantId, setBomQuoteVariantId] = useState("standard");
  const [bomShowSupporting, setBomShowSupporting] = useState(false);
  const [bomPilotTableLimit, setBomPilotTableLimit] = useState(80);
  const fileRef = useRef();
  const ktsFileRef = useRef();
  const bomFileRef = useRef();

  // Sau khi mode render xong → trigger click file input
  useEffect(() => {
    if (!pendingOpen) return;
    const ref = pendingOpen === "matrix" ? fileRef : pendingOpen === "bom" ? bomFileRef : ktsFileRef;
    const timer = setTimeout(() => {
      ref.current?.click();
      setPendingOpen("");
    }, 50); // đủ để React flush DOM
    return () => clearTimeout(timer);
  }, [pendingOpen]);

  const buildInitialBomResolutions = (result) => {
    const next = {};
    (result?.lines || []).forEach((line) => {
      const top = line.suggestedMatch || line.matchSuggestions?.[0];
      if (top?.productId && (top.learned || top.confidence === "high" || Number(top.score) >= 0.5)) {
        next[line.id] = top.productId;
      }
    });
    return next;
  };

  const buildInitialBomPackSelections = (result) => {
    const next = {};
    (result?.solutionPacks || []).forEach((pack) => {
      const top = pack.recommendations?.[0];
      if (top?.id) next[pack.scopeId] = top.id;
    });
    return next;
  };

  const getSelectedBomPack = (scopeId) => {
    const pack = (bomPreview?.solutionPacks || []).find((p) => p.scopeId === scopeId);
    if (!pack) return null;
    const selectedId = bomPackSelections[scopeId] || pack.selectedRecommendationId || pack.recommendations?.[0]?.id;
    const recommendation = (pack.recommendations || []).find((r) => r.id === selectedId) || pack.recommendations?.[0] || null;
    return { pack, recommendation };
  };

  const applyBomPackRecommendation = (pack, recommendation) => {
    if (!pack || !recommendation) return;
    const allowedIds = new Set(recommendation.productIds || []);
    const vendorNorm = String(recommendation.vendor || "").toLowerCase();
    const next = {};
    let applied = 0;
    (bomPreview?.lines || []).forEach((line) => {
      const lineScopeId = line.scopeId || `scope_${String(line.solutionKey || "other").replace(/[^a-z0-9_-]/gi, "_")}`;
      if (lineScopeId !== pack.scopeId || bomIgnored[line.id]) return;
      if (getBomProductId(line)) return;
      const suggestion = (line.matchSuggestions || []).find((sg) => allowedIds.has(sg.productId))
        || (line.matchSuggestions || []).find((sg) => vendorNorm && String(sg.supplier || "").toLowerCase().includes(vendorNorm))
        || (line.matchSuggestions || [])[0];
      if (suggestion?.productId) {
        next[line.id] = suggestion.productId;
        const product = products.find((p) => p.id === suggestion.productId);
        if (product) saveBomMatchLearning(line, product);
        applied += 1;
      }
    });
    setBomPackSelections((prev) => ({ ...prev, [pack.scopeId]: recommendation.id }));
    if (applied) setBomResolutions((prev) => ({ ...prev, ...next }));
    else alert("Phương án này chưa có sản phẩm catalog đủ khớp để áp dụng tự động. Bạn vẫn có thể dùng nó như gợi ý NCC/phương án.");
  };

  const getBomProductId = (line) => {
    if (Object.prototype.hasOwnProperty.call(bomResolutions, line.id)) {
      return bomResolutions[line.id] === "__none__" ? "" : bomResolutions[line.id];
    }
    return line.resolvedProductId || line.suggestedMatch?.productId || "";
  };

  const setBomLineProduct = (line, productId) => {
    setBomResolutions((prev) => ({ ...prev, [line.id]: productId || "__none__" }));
    if (productId) {
      setBomIgnored((prev) => ({ ...prev, [line.id]: false }));
      const p = products.find((x) => x.id === productId);
      if (p) saveBomMatchLearning(line, p);
    }
  };

  const ignoreBomLine = (line) => {
    setBomIgnored((prev) => ({ ...prev, [line.id]: true }));
    setBomResolutions((prev) => ({ ...prev, [line.id]: "__none__" }));
  };

  const restoreBomLine = (line) => {
    setBomIgnored((prev) => ({ ...prev, [line.id]: false }));
  };

  const getBomLineScopeId = (line) => line.scopeId || `scope_${String(line.solutionKey || "other").replace(/[^a-z0-9_-]/gi, "_")}`;

  const isSupportingBomLine = (line) => {
    const scope = (bomPreview?.scopes || []).find((s) => s.id === getBomLineScopeId(line));
    const text = `${line.solutionLabel || ""} ${line.category || ""} ${line.name || ""}`.toLowerCase();
    return !!scope?.supporting || !!line.supporting || line.solutionKey === "infrastructure" || /cáp|cap|dây|day|ống|ong|phụ kiện|phu kien|nhân công|nhan cong|hạ tầng|ha tang/.test(text);
  };

  const getBomTopSuggestion = (line) => line.suggestedMatch || (line.matchSuggestions || [])[0] || null;

  const applyHighConfidenceBomMatches = () => {
    if (!bomPreview) return;
    const next = {};
    let count = 0;
    (bomPreview.lines || []).forEach((line) => {
      if (bomIgnored[line.id] || getBomProductId(line) || isSupportingBomLine(line)) return;
      const top = getBomTopSuggestion(line);
      const score = Number(top?.score || 0);
      const strong = top?.learned || top?.confidence === "high" || score >= 0.52;
      if (top?.productId && strong) {
        next[line.id] = top.productId;
        const product = products.find((p) => p.id === top.productId);
        if (product) saveBomMatchLearning(line, product);
        count += 1;
      }
    });
    if (count) {
      setBomResolutions((prev) => ({ ...prev, ...next }));
      setBomFilter("unresolved");
    } else {
      alert("Không còn match chắc nào để duyệt nhanh. Hãy chọn sản phẩm cho các dòng còn lại.");
    }
  };

  const ignoreSupportingBomLines = () => {
    if (!bomPreview) return;
    const ignoreNext = {};
    const resolutionNext = {};
    let count = 0;
    (bomPreview.lines || []).forEach((line) => {
      if (bomIgnored[line.id] || getBomProductId(line) || !isSupportingBomLine(line)) return;
      ignoreNext[line.id] = true;
      resolutionNext[line.id] = "__none__";
      count += 1;
    });
    if (count) {
      setBomIgnored((prev) => ({ ...prev, ...ignoreNext }));
      setBomResolutions((prev) => ({ ...prev, ...resolutionNext }));
      setBomShowSupporting(false);
    } else {
      alert("Không có dòng vật tư phụ chưa match nào để ẩn.");
    }
  };

  const focusBomUnresolved = () => {
    setBomShowSupporting(false);
    setBomFilter("unresolved");
    setBomPilotTableLimit(80);
  };

  const createQuoteFromBom = () => {
    if (!bomPreview) return;
    const variants = buildBomQuoteVariants({
      bomPreview,
      products,
      resolutionMap: bomResolutions,
      ignoredMap: bomIgnored,
      packSelections: bomPackSelections,
      grouping: bomQuoteGrouping,
      laborPercent: company?.laborPercent || 0,
    });
    const selected = variants.find((v) => v.id === bomQuoteVariantId) || variants.find((v) => v.id === "standard") || variants[0];
    if (!selected?.ready) {
      alert("Chưa có dòng BOM nào đủ match để tạo báo giá. Hãy chọn sản phẩm catalog cho ít nhất một dòng.");
      return;
    }

    // Lưu học từ các dòng user/engine đã dùng vào báo giá.
    (bomPreview.lines || []).forEach((line) => {
      if (bomIgnored[line.id]) return;
      const productId = getBomProductId(line);
      const product = products.find((p) => p.id === productId);
      if (product) saveBomMatchLearning(line, product);
    });

    const rooms = quoteVariantToRooms(selected, uid);
    const projectName = (bomPreview.fileName || "BOM").replace(/\.(xlsx|xls)$/i, "");
    onCreateQuote(rooms, {
      project: `${projectName} · PA ${selected.shortLabel} - ${selected.label}`,
    });
  };

  const handleBomFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBomStatus("loading");
    setBomError("");
    try {
      const result = await parseBomPreviewFile(file, products);
      setBomPreview(result);
      setBomResolutions(buildInitialBomResolutions(result));
      setBomIgnored({});
      setBomPackSelections(buildInitialBomPackSelections(result));
      setBomQuoteGrouping("scope");
      setBomQuoteVariantId("standard");
      setBomShowSupporting(false);
      setBomPilotTableLimit(80);
      const unresolvedCount = result.lines.filter((line) => !line.resolvedProductId && !line.suggestedMatch?.productId).length;
      setBomFilter(unresolvedCount > 0 ? "unresolved" : result.matched > 0 ? "matched" : result.ready > 0 ? "ready" : "all");
      setBomStatus("done");
    } catch (err) {
      console.error("BOM preview parser lỗi:", err);
      setBomError("Không đọc được file BOM/dự toán. Hãy kiểm tra file Excel có bảng vật tư, số lượng và đơn vị.");
      setBomStatus("error");
    } finally {
      e.target.value = "";
    }
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await parseTakeoffMatrixFile(file);
      if (result.error) { alert(result.error); return; }
      setParsed(result);

      // Bước 1: Map nhanh bằng nameMap đã nhớ + keyword (tức thì)
      const initMap = {};
      result.columns.forEach((col) => {
        const savedSku = nameMap[col.toLowerCase().trim()];
        if (savedSku) {
          const p = products.find((x) => x.sku === savedSku);
          if (p) { initMap[col] = p.id; return; }
        }
        const guess = guessProductForColumn(col, products);
        if (guess) initMap[col] = guess.id;
      });
      setMapping(initMap);

      // Bước 2: AI map các cột chưa ghép được (hoặc ghép không chắc)
      const unmapped = result.columns.filter((col) => !initMap[col]);
      if (unmapped.length > 0 && company?.googleApiKey) {
        setAiStatus("loading");
        try {
          const aiResults = await mapTakeoffColumnsWithClaude({
            rows: result.rawRows || [],
            unmapped,
            products,
          });

          setMapping((prev) => {
            const next = { ...prev };
            aiResults.forEach(({ colIdx, productId, confidence }) => {
              if (productId && (confidence === "high" || confidence === "medium")) {
                const col = unmapped[colIdx];
                if (col && !next[col]) next[col] = productId;
              }
            });
            return next;
          });
          setAiStatus("done");
        } catch (err) {
          console.warn("AI mapping lỗi:", err);
          setAiStatus("error");
        }
      } else {
        setAiStatus("done");
      }
    } catch (err) {
      console.error(err);
      alert("Không đọc được file. Đảm bảo đúng định dạng Excel bóc tách.");
    } finally {
      e.target.value = "";
    }
  };

  const setColMap = (col, productId) => setMapping((m) => ({ ...m, [col]: productId }));

  const mappedCount = parsed ? parsed.columns.filter((c) => mapping[c]).length : 0;
  const unmappedCols = parsed ? parsed.columns.filter((c) => !mapping[c]) : [];

  const buildQuote = () => {
    if (!parsed) return;
    const newNameMap = { ...nameMap };
    parsed.columns.forEach((col) => {
      const pid = mapping[col];
      if (pid) {
        const p = products.find((x) => x.id === pid);
        if (p) newNameMap[col.toLowerCase().trim()] = p.sku;
      }
    });
    setNameMap(newNameMap);

    const shared = parsed.sharedColumns || {};
    const columnGroups = parsed.columnGroups || [];

    // Mapping từ TÊN NHÓM trong file bóc tách (R1) → tên giải pháp Nguyên Đà
    // Đây là mapping chính xác nhất vì dùng đúng cấu trúc file bóc tách
    const GROUP_TO_SOLUTION = {
      "công tắc thông minh": "I./ Giải pháp chiếu sáng tự động thông minh\n(Điều khiển tắt/mở đèn từ xa qua Smart Phone, hẹn giờ, cảm ứng…)",
      "công tắc":            "I./ Giải pháp chiếu sáng tự động thông minh\n(Điều khiển tắt/mở đèn từ xa qua Smart Phone, hẹn giờ, cảm ứng…)",
      "ổ cắm":               "I./ Giải pháp chiếu sáng tự động thông minh\n(Điều khiển tắt/mở đèn từ xa qua Smart Phone, hẹn giờ, cảm ứng…)",
      "chiếu sáng":          "I./ Giải pháp chiếu sáng tự động thông minh\n(Điều khiển tắt/mở đèn từ xa qua Smart Phone, hẹn giờ, cảm ứng…)",
      "đèn":                 "I./ Giải pháp chiếu sáng tự động thông minh\n(Điều khiển tắt/mở đèn từ xa qua Smart Phone, hẹn giờ, cảm ứng…)",
      "cb thông minh":       "II./ Hệ thống cảm biến",
      "cảm biến":            "II./ Hệ thống cảm biến",
      "cb":                  "II./ Hệ thống cảm biến",
      "cổng tự động":        "III./ Giải pháp cổng tự động thông minh",
      "cổng":                "III./ Giải pháp cổng tự động thông minh",
      "camera":              "IV./ Giải pháp camera an ninh",
      "an ninh":             "IV./ Giải pháp camera an ninh",
      "wifi":                "V./ Hệ thống mạng nội bộ + Wifi",
      "mạng":                "V./ Hệ thống mạng nội bộ + Wifi",
      "mạng/wifi":           "V./ Hệ thống mạng nội bộ + Wifi",
      "âm thanh":            "VI./ Giải pháp âm thanh đa vùng",
      "rèm":                 "VIII./ Giải pháp rèm thông minh",
    };

    // Dự phòng: map theo category thiết bị nếu file bóc tách không có nhóm R1
    const CAT_TO_SOLUTION = {
      "Công tắc":    "I./ Giải pháp chiếu sáng tự động thông minh\n(Điều khiển tắt/mở đèn từ xa qua Smart Phone, hẹn giờ, cảm ứng…)",
      "Ổ cắm":       "I./ Giải pháp chiếu sáng tự động thông minh\n(Điều khiển tắt/mở đèn từ xa qua Smart Phone, hẹn giờ, cảm ứng…)",
      "Chiếu sáng":  "I./ Giải pháp chiếu sáng tự động thông minh\n(Điều khiển tắt/mở đèn từ xa qua Smart Phone, hẹn giờ, cảm ứng…)",
      "Điều khiển":  "I./ Giải pháp chiếu sáng tự động thông minh\n(Điều khiển tắt/mở đèn từ xa qua Smart Phone, hẹn giờ, cảm ứng…)",
      "Cảm biến":    "II./ Hệ thống cảm biến",
      "Cổng tự động":"III./ Giải pháp cổng tự động thông minh",
      "Camera":      "IV./ Giải pháp camera an ninh",
      "An ninh":     "IV./ Giải pháp camera an ninh",
      "Mạng/Wifi":   "V./ Hệ thống mạng nội bộ + Wifi",
      "Module":      "V./ Hệ thống mạng nội bộ + Wifi",
      "Âm thanh":    "VI./ Giải pháp âm thanh đa vùng",
      "Rèm":         "VIII./ Giải pháp rèm thông minh",
    };

    const resolveSolution = (colIdx, p) => {
      // Ưu tiên 1: nhóm từ R1 của file bóc tách (chính xác nhất)
      const grp = (columnGroups[colIdx] || "").toLowerCase().trim();
      if (grp) {
        // Tìm khớp chính xác trước
        if (GROUP_TO_SOLUTION[grp]) return GROUP_TO_SOLUTION[grp];
        // Tìm khớp một phần
        const found = Object.entries(GROUP_TO_SOLUTION)
          .find(([k]) => grp.includes(k) || k.includes(grp));
        if (found) return found[1];
      }
      // Ưu tiên 2: category của thiết bị trong catalog
      const cat = p?.category || "";
      return CAT_TO_SOLUTION[cat]
        || Object.entries(CAT_TO_SOLUTION).find(([k]) => cat.toLowerCase().includes(k.toLowerCase()))?.[1]
        || GROUP_TO_SOLUTION["công tắc thông minh"]; // fallback về giải pháp I
    };

    // Tạo map: tên giải pháp → lines[]
    const solutionMap = {};
    const solutionOrder = [];
    const addToSolution = (solutionName, line) => {
      if (!solutionMap[solutionName]) {
        solutionMap[solutionName] = [];
        solutionOrder.push(solutionName);
      }
      solutionMap[solutionName].push(line);
    };

    // Xử lý từng cột: tính tổng số lượng, ghi note phân bổ tầng, xếp vào đúng giải pháp
    parsed.columns.forEach((col, colIdx) => {
      const pid = mapping[col];
      if (!pid) return;
      const p = products.find((x) => x.id === pid);
      if (!p) return;

      const isShared = !!shared[col];
      let totalQty = 0;
      const noteLines = [];

      if (isShared) {
        totalQty = shared[col] || 0;
        // Dùng chung không ghi note tầng
      } else {
        parsed.floors.forEach((floor) => {
          const q = floor.qtys[col];
          if (q && q > 0) {
            totalQty += q;
            noteLines.push(`${floor.name}: ${q}`);
          }
        });
      }

      if (totalQty <= 0) return;

      const note = noteLines.join("\n");
      const line = { id: uid("ln"), productId: pid, qty: totalQty, note };
      addToSolution(resolveSolution(colIdx, p), line);
    });

    // Sắp xếp theo thứ tự số La Mã (I < II < III < IV < V...) trong tên giải pháp
    const romanOrder = (name) => {
      const m = name.match(/^(I{1,3}|IV|V|VI{0,3}|IX|X)\./);
      if (!m) return 99;
      const map = { "I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7, "VIII": 8, "IX": 9, "X": 10 };
      return map[m[1]] || 99;
    };
    const rooms = solutionOrder
      .sort((a, b) => romanOrder(a) - romanOrder(b))
      .map((name) => ({
      id: uid("room"),
      name,
      lines: solutionMap[name],
    }));

    if (rooms.length === 0) {
      alert("Chưa ghép được thiết bị nào. Hãy chọn thiết bị cho các cột bên dưới.");
      return;
    }
    onCreateQuote(rooms, { project: parsed.title || "" });
  };

  return (
    <div className="takeoff">

      {/* Chọn loại file — hiện khi chưa chọn mode hoặc muốn đổi */}
      {!mode && (
        <section className="card">
          <h2 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 600 }}>Chọn loại file muốn đọc</h2>
          <p className="tab-intro" style={{ margin: "0 0 16px" }}>
            AI hỗ trợ cả 2 loại file — chọn đúng loại để kết quả chính xác nhất.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
            <button
              className="mode-pick-btn mode-pick-primary"
              onClick={() => { setMode("bom"); setPendingOpen("bom"); }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16v16H4z"/><path d="M4 9h16"/><path d="M9 4v16"/><path d="M14 4v16"/></svg>
              <div className="mpb-title">BOM / dự toán công trình</div>
              <div className="mpb-sub">Đọc file bóc tách dạng danh sách: tên vật tư, model, số lượng, đơn vị, phòng/khu vực.</div>
              <div className="mpb-example">Phase 1: preview cấu trúc trước khi match catalog</div>
            </button>
            <button
              className="mode-pick-btn"
              onClick={() => { setMode("matrix"); setPendingOpen("matrix"); }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
              <div className="mpb-title">Bảng bóc tách (tầng × thiết bị)</div>
              <div className="mpb-sub">File bảng ma trận: hàng = tầng, cột = loại thiết bị, ô = số lượng. Thường do nội bộ lập.</div>
              <div className="mpb-example">Ví dụ: Tầng 1 · Công tắc 1 nút · 10</div>
            </button>
            <button
              className="mode-pick-btn"
              onClick={() => { setMode("kts"); setPendingOpen("kts"); }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              <div className="mpb-title">Bảng khối lượng từ KTS / kỹ sư</div>
              <div className="mpb-sub">File danh sách vật tư dạng cột: STT · Tên vật tư · ĐVT · Số lượng. Do kiến trúc sư / kỹ sư lập.</div>
              <div className="mpb-example">Ví dụ: ĐÈN DOWNLIGHT 9W · Cái · 222</div>
            </button>
          </div>
          <input ref={bomFileRef} type="file" accept=".xlsx,.xls" hidden onChange={handleBomFile} />
          <input ref={fileRef} type="file" accept=".xlsx,.xls" hidden onChange={(e) => { handleFile(e); }} />
          <input ref={ktsFileRef} type="file" accept=".xlsx,.xls" hidden onChange={() => {}} />
        </section>
      )}

      {/* BOM Preview Parser — Phase BOM-1 */}
      {mode === "bom" && (
        <section className="card bom-preview-card">
          <div className="bom-topline">
            <div>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>BOM / dự toán công trình</h2>
              <p className="tab-intro" style={{ margin: "4px 0 0" }}>
                Phase 1 đọc file và tạo preview: phòng/khu vực, tên thiết bị, model, số lượng, đơn vị. Chưa ép user match catalog ngay.
              </p>
            </div>
            <button className="btn-ghost" style={{ fontSize: 12, flexShrink: 0 }} onClick={() => { setMode(""); setBomPreview(null); setBomStatus(""); setBomError(""); }}>
              ← Đổi loại file
            </button>
          </div>

          {!bomPreview && (
            <>
              <div
                className="bom-drop-zone"
                onClick={() => bomFileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleBomFile({ target: { files: [f], value: "" } }); }}
              >
                <div className="ai-drop-icon">📋</div>
                <div className="ai-drop-text">Kéo thả hoặc bấm để chọn file BOM / dự toán Excel</div>
                <div className="ai-drop-sub">Hỗ trợ cột: Tên thiết bị · Model · Số lượng · ĐVT · Phòng/khu vực · Ghi chú</div>
              </div>
              <input ref={bomFileRef} type="file" accept=".xlsx,.xls" hidden onChange={handleBomFile} />
              {bomStatus === "loading" && <p className="tab-intro" style={{ marginTop: 12 }}>Đang đọc BOM và tách phòng/khu vực…</p>}
              {bomError && <div className="takeoff-warn" style={{ marginTop: 12 }}>{bomError}</div>}
            </>
          )}

          {bomPreview && (() => {
            const activeLines = bomPreview.lines.filter((l) => !bomIgnored[l.id]);
            const resolvedLines = activeLines.filter((l) => !!getBomProductId(l));
            const unresolvedLines = activeLines.filter((l) => !getBomProductId(l));
            const reviewLines = activeLines.filter((l) => l.status === "need_review" && !getBomProductId(l));
            const supportingLines = activeLines.filter((l) => isSupportingBomLine(l));
            const coreLines = activeLines.filter((l) => !isSupportingBomLine(l));
            const coreResolvedLines = coreLines.filter((l) => !!getBomProductId(l));
            const coreUnresolvedLines = coreLines.filter((l) => !getBomProductId(l));
            const highSuggestionLines = coreUnresolvedLines.filter((l) => {
              const top = getBomTopSuggestion(l);
              const score = Number(top?.score || 0);
              return !!top?.productId && (top.learned || top.confidence === "high" || score >= 0.52);
            });
            const ignoredCount = Object.values(bomIgnored).filter(Boolean).length;
            const scopes = bomPreview.scopes || [];
            const mainScopes = scopes.filter((s) => !s.supporting);
            const supportingScopes = scopes.filter((s) => s.supporting);
            const selectedScope = bomFilter.startsWith("scope:") ? bomFilter.slice(6) : "";
            const filtered = bomPreview.lines.filter((l) => {
              const pid = getBomProductId(l);
              const ignored = !!bomIgnored[l.id];
              const supporting = isSupportingBomLine(l);
              const lineScopeId = getBomLineScopeId(l);
              if (selectedScope) return !ignored && lineScopeId === selectedScope;
              if (bomFilter === "core") return !ignored && !supporting;
              if (bomFilter === "supporting") return !ignored && supporting;
              if (bomFilter === "ready") return !ignored && l.status === "ready" && (bomShowSupporting || !supporting);
              if (bomFilter === "review") return !ignored && l.status === "need_review" && (bomShowSupporting || !supporting);
              if (bomFilter === "matched") return !ignored && !!pid && (bomShowSupporting || !supporting);
              if (bomFilter === "unresolved") return !ignored && !pid && (bomShowSupporting || !supporting);
              if (bomFilter === "ignored") return ignored;
              if (!bomShowSupporting && !ignored && supporting) return false;
              return true;
            });
            const groupedAreas = bomPreview.areas.length ? bomPreview.areas.join(" · ") : "Chưa phân khu";
            const quoteVariants = buildBomQuoteVariants({
              bomPreview,
              products,
              resolutionMap: bomResolutions,
              ignoredMap: bomIgnored,
              packSelections: bomPackSelections,
              grouping: bomQuoteGrouping,
              laborPercent: company?.laborPercent || 0,
            });
            const selectedQuoteVariant = quoteVariants.find((v) => v.id === bomQuoteVariantId) || quoteVariants.find((v) => v.id === "standard") || quoteVariants[0];
            return (
              <>
                <div className="bom-summary-box bom-phase2-summary bom-pilot-summary">
                  <div>
                    <div className="bom-summary-title">BOM đã sẵn sàng để resolve nhanh</div>
                    <div className="bom-summary-sub">
                      {coreLines.length} dòng giải pháp chính · {coreResolvedLines.length} đã match · {coreUnresolvedLines.length} cần chọn · {supportingLines.length} vật tư phụ đang {bomShowSupporting ? "hiện" : "ẩn"}
                    </div>
                    <div className="bom-summary-areas">Khu vực/hạng mục: {groupedAreas}</div>
                  </div>
                  <div className="bom-summary-actions">
                    <button className="btn-ghost" onClick={() => bomFileRef.current?.click()}>Upload file khác</button>
                    <div className="bom-grouping-toggle" title="Chọn cách gom dòng khi tạo báo giá">
                      <button className={bomQuoteGrouping === "scope" ? "active" : ""} onClick={() => setBomQuoteGrouping("scope")}>Theo giải pháp</button>
                      <button className={bomQuoteGrouping === "pack" ? "active" : ""} onClick={() => setBomQuoteGrouping("pack")}>Theo phương án</button>
                      <button className={bomQuoteGrouping === "area" ? "active" : ""} onClick={() => setBomQuoteGrouping("area")}>Theo khu vực</button>
                    </div>
                    <button className="btn-primary" style={{ width: "auto" }} disabled={!selectedQuoteVariant?.ready} onClick={createQuoteFromBom}>
                      Tạo PA {selectedQuoteVariant?.shortLabel || "B"}: {selectedQuoteVariant?.label || "Tiêu chuẩn"} →
                    </button>
                  </div>
                </div>

                <div className="bom-pilot-actionbar">
                  <div>
                    <strong>Việc cần làm tiếp theo</strong>
                    <span>
                      {coreUnresolvedLines.length > 0
                        ? `Còn ${coreUnresolvedLines.length} dòng giải pháp chính cần chọn sản phẩm.`
                        : selectedQuoteVariant?.ready
                          ? `Đã đủ dữ liệu để tạo báo giá ${selectedQuoteVariant.shortLabel || "B"}.`
                          : "Chưa có dòng nào đủ match để tạo báo giá."}
                    </span>
                  </div>
                  <div className="bom-pilot-actions">
                    {highSuggestionLines.length > 0 && <button className="btn-mini" onClick={applyHighConfidenceBomMatches}>Duyệt {highSuggestionLines.length} match chắc</button>}
                    {supportingLines.length > 0 && <button className="btn-mini" onClick={() => setBomShowSupporting((v) => !v)}>{bomShowSupporting ? "Ẩn vật tư phụ" : `Hiện ${supportingLines.length} vật tư phụ`}</button>}
                    {supportingLines.some((l) => !getBomProductId(l) && !bomIgnored[l.id]) && <button className="btn-mini" onClick={ignoreSupportingBomLines}>Bỏ qua vật tư phụ chưa match</button>}
                    {coreUnresolvedLines.length > 0 && <button className="btn-mini" onClick={focusBomUnresolved}>Xử lý dòng chưa match</button>}
                  </div>
                </div>

                <input ref={bomFileRef} type="file" accept=".xlsx,.xls" hidden onChange={handleBomFile} />

                <div className="bom-metrics bom-phase2-metrics bom-pilot-metrics">
                  <div><strong>{mainScopes.length}</strong><span>Nhóm giải pháp chính</span></div>
                  <div><strong>{coreResolvedLines.length}</strong><span>Đã match catalog</span></div>
                  <div><strong>{coreUnresolvedLines.length}</strong><span>Cần xử lý</span></div>
                  <div><strong>{supportingLines.length}</strong><span>Vật tư phụ ẩn</span></div>
                </div>

                <div className="bom-quote-composer">
                  <div className="bom-scope-header">
                    <div>
                      <strong>Phương án báo giá A/B/C</strong>
                      <span>Chọn phương án để SmartQuote tạo báo giá nháp. Dòng đã user chọn sẽ được khóa, dòng còn lại chọn theo chiến lược từng phương án.</span>
                    </div>
                    <button className="btn-mini" onClick={() => setBomQuoteGrouping("pack")}>Gom theo phương án</button>
                  </div>
                  <div className="bom-variant-grid">
                    {quoteVariants.map((variant) => (
                      <button
                        key={variant.id}
                        className={`bom-variant-card ${bomQuoteVariantId === variant.id ? "active" : ""}`}
                        onClick={() => setBomQuoteVariantId(variant.id)}
                      >
                        <div className="bom-variant-head">
                          <span className="bom-variant-letter">{variant.shortLabel}</span>
                          <div>
                            <strong>{variant.label}</strong>
                            <small>{variant.subtitle}</small>
                          </div>
                        </div>
                        <div className="bom-variant-total">{VND(variant.grandTotal || 0)}</div>
                        <div className="bom-variant-meta">
                          <span>{variant.itemCount} dòng</span>
                          <span>{variant.coverage}% coverage</span>
                          <span>{variant.packTemplateLineCount || 0} template</span>
                          <span>margin {variant.marginPercent}%</span>
                        </div>
                        {variant.unmatchedCount > 0 && <div className="bom-variant-warn">Còn {variant.unmatchedCount} dòng chưa match</div>}
                      </button>
                    ))}
                  </div>
                  {selectedQuoteVariant?.packTemplateLineCount > 0 && (
                    <div className="bom-variant-note bom-template-note">
                      SmartQuote đã bổ sung {selectedQuoteVariant.packTemplateLineCount} dòng từ template cấu hình. Ví dụ: {selectedQuoteVariant.packTemplateSample?.slice(0, 3).join(" · ") || "—"}.
                    </div>
                  )}
                  {selectedQuoteVariant?.unmatchedCount > 0 && (
                    <div className="bom-variant-note">
                      Phương án đang chọn còn {selectedQuoteVariant.unmatchedCount} dòng chưa lên báo giá. Ví dụ: {selectedQuoteVariant.unmatchedSample?.slice(0, 3).join(" · ") || "—"}.
                    </div>
                  )}
                </div>

                {scopes.length > 0 && (
                  <div className="bom-scope-section">
                    <div className="bom-scope-header">
                      <div>
                        <strong>Phạm vi giải pháp phát hiện</strong>
                        <span>SmartQuote gom vật tư thành các hệ để sales/kỹ thuật duyệt nhanh trước khi tạo báo giá.</span>
                      </div>
                      {selectedScope && <button className="btn-mini" onClick={() => setBomFilter("all")}>Xem tất cả dòng</button>}
                    </div>
                    <div className="bom-scope-grid">
                      {(bomShowSupporting ? scopes : mainScopes).slice(0, 10).map((scope) => (
                        <button
                          key={scope.id}
                          className={`bom-scope-card ${scope.supporting ? "supporting" : ""} ${selectedScope === scope.id ? "active" : ""}`}
                          onClick={() => setBomFilter(`scope:${scope.id}`)}
                        >
                          <div className="bom-scope-title">{scope.label}</div>
                          <div className="bom-scope-meta">{scope.lineCount} dòng · {scope.matched} match · {scope.unresolved} cần chọn · {scope.confidence}%</div>
                          {scope.vendors?.length > 0 && <div className="bom-scope-vendors">Gợi ý NCC: {scope.vendors.join(" / ")}</div>}
                          {scope.sampleItems?.length > 0 && <div className="bom-scope-samples">{scope.sampleItems.slice(0, 2).join(" · ")}</div>}
                        </button>
                      ))}
                    </div>
                    {!bomShowSupporting && supportingScopes.length > 0 && (
                      <button className="bom-supporting-toggle" onClick={() => { setBomShowSupporting(true); setBomFilter("supporting"); }}>
                        Đang ẩn {supportingScopes.reduce((sum, s) => sum + (s.lineCount || 0), 0)} dòng vật tư phụ/cáp/ống. Bấm để xem khi cần đưa vào báo giá chi tiết.
                      </button>
                    )}
                  </div>
                )}

                {(bomPreview.solutionPacks || []).length > 0 && (
                  <div className="bom-pack-section">
                    <div className="bom-scope-header">
                      <div>
                        <strong>Gợi ý phương án / bộ giải pháp</strong>
                        <span>Mỗi nhóm giải pháp có các phương án NCC/brand để sales chọn nhanh trước khi tạo báo giá.</span>
                      </div>
                      <button className="btn-mini" onClick={() => setBomQuoteGrouping("pack")}>Tạo báo giá theo phương án</button>
                    </div>
                    <div className="bom-pack-list">
                      {(bomPreview.solutionPacks || []).slice(0, 8).map((pack) => {
                        const selectedId = bomPackSelections[pack.scopeId] || pack.selectedRecommendationId || pack.recommendations?.[0]?.id;
                        return (
                          <div key={pack.scopeId} className="bom-pack-row">
                            <div className="bom-pack-row-head">
                              <button className="bom-pack-scope" onClick={() => setBomFilter(`scope:${pack.scopeId}`)}>
                                <strong>{pack.scopeLabel}</strong>
                                <span>{pack.lineCount} dòng · {pack.matched} đã match · {pack.unresolved} cần chọn</span>
                              </button>
                            </div>
                            <div className="bom-pack-options">
                              {(pack.recommendations || []).map((rec) => (
                                <button
                                  key={rec.id}
                                  className={`bom-pack-card ${selectedId === rec.id ? "active" : ""}`}
                                  onClick={() => setBomPackSelections((prev) => ({ ...prev, [pack.scopeId]: rec.id }))}
                                >
                                  <div className="bom-pack-title">{rec.title}</div>
                                  <div className="bom-pack-meta">{rec.vendor} · {rec.tier} · {rec.score}%</div>
                                  <div className="bom-pack-rationale">{rec.rationale}</div>
                                  {rec.template && (
                                    <div className="bom-template-summary">
                                      <strong>{rec.template.label}</strong>
                                      <span>{rec.template.requiredMatched}/{rec.template.requiredCount} thành phần bắt buộc · {rec.template.coverage}%</span>
                                      <div className="bom-template-components">
                                        {rec.template.components.slice(0, 4).map((cmp) => (
                                          <em key={cmp.role} className={cmp.matched ? "ok" : cmp.required ? "missing" : "optional"}>
                                            {cmp.matched ? "✓" : cmp.required ? "!" : "○"} {cmp.label}
                                          </em>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {rec.sampleProducts?.length > 0 && <div className="bom-pack-products">{rec.sampleProducts.slice(0, 2).join(" · ")}</div>}
                                  <div className="bom-pack-actions">
                                    <span>{rec.catalogProductCount} SP catalog</span>
                                    <em>{rec.template?.status === "ready" ? "đủ bộ" : rec.confidence === "high" ? "chắc" : rec.confidence === "medium" ? "khá" : "gợi ý"}</em>
                                  </div>
                                </button>
                              ))}
                            </div>
                            <div className="bom-pack-row-actions">
                              {(() => {
                                const selected = (pack.recommendations || []).find((r) => r.id === selectedId) || pack.recommendations?.[0];
                                return selected ? <button className="btn-mini" onClick={() => applyBomPackRecommendation(pack, selected)}>Áp dụng match phù hợp</button> : null;
                              })()}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="bom-resolve-hint">
                  <strong>Phase 6:</strong> SmartQuote đã có template cấu hình cho từng phương án. Template giúp bổ sung các thành phần bắt buộc như gateway, controller, màn hình, NVR, nguồn/phụ kiện nếu catalog có sản phẩm phù hợp.
                </div>

                <details className="bom-details">
                  <summary>Chi tiết parser</summary>
                  <div className="bom-detail-grid">
                    {bomPreview.sheets.map((sh) => (
                      <div key={sh.sheetName} className="bom-detail-chip">
                        <strong>{sh.sheetName}</strong><span>{sh.disciplineLabel || "BOM"} · {sh.parsedCount} dòng · header {sh.headerRow || "fallback"}</span>
                      </div>
                    ))}
                  </div>
                </details>

                <div className="bom-toolbar bom-pilot-toolbar">
                  {[
                    ["all", `Tổng quan (${bomShowSupporting ? activeLines.length : coreLines.length})`],
                    ["core", `Giải pháp chính (${coreLines.length})`],
                    ["unresolved", `Cần chọn (${coreUnresolvedLines.length})`],
                    ["matched", `Đã match (${coreResolvedLines.length})`],
                    ["supporting", `Vật tư phụ (${supportingLines.length})`],
                    ["ignored", `Bỏ qua (${ignoredCount})`],
                  ].map(([key, label]) => (
                    <button key={key} className={bomFilter === key ? "active" : ""} onClick={() => { if (key === "supporting") setBomShowSupporting(true); setBomFilter(key); setBomPilotTableLimit(80); }}>{label}</button>
                  ))}
                </div>

                <div className="bom-table-wrap">
                  <table className="bom-preview-table bom-match-table">
                    <thead>
                      <tr>
                        <th>#</th><th>Trạng thái</th><th>Vật tư trong BOM</th><th>SL</th><th>Khu vực</th><th>Match catalog</th><th>Vấn đề / thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.slice(0, bomPilotTableLimit).map((line, idx) => {
                        const selectedProductId = getBomProductId(line);
                        const selectedProduct = products.find((p) => p.id === selectedProductId);
                        const ignored = !!bomIgnored[line.id];
                        const supporting = isSupportingBomLine(line);
                        const topSuggestion = getBomTopSuggestion(line);
                        const statusLabel = ignored ? "Bỏ qua" : selectedProductId ? "Đã match" : supporting ? "Vật tư phụ" : line.status === "ready" ? "Cần chọn" : "Cần xem";
                        const statusClass = ignored ? "ignored" : selectedProductId ? "matched" : supporting ? "ignored" : line.status;
                        return (
                          <tr key={line.id} className={`${line.status === "need_review" && !selectedProductId ? "bom-row-review" : ""} ${supporting ? "bom-row-supporting" : ""}`}>
                            <td>{idx + 1}</td>
                            <td><span className={`bom-status ${statusClass}`}>{statusLabel}</span></td>
                            <td>
                              <div className="strong">{line.name}</div>
                              <div className="ln-sku">{line.model || "không có model"} · {line.solutionLabel || line.category} · {line.sourceSheet} dòng {line.sourceRow}</div>
                              {line.note && <div className="ln-sku">{line.note}</div>}
                            </td>
                            <td className="num">{line.qty} {line.unit}</td>
                            <td>{line.area || "—"}</td>
                            <td>
                              <SearchSelect
                                products={products}
                                value={selectedProductId || ""}
                                onChange={(pid) => setBomLineProduct(line, pid)}
                                placeholder="Chọn sản phẩm catalog..."
                                hasValue={!!selectedProductId}
                              />
                              {line.matchSuggestions?.length > 0 && (
                                <div className="bom-suggestions">
                                  {line.matchSuggestions.slice(0, 3).map((sg) => (
                                    <button
                                      key={sg.productId}
                                      className={selectedProductId === sg.productId ? "selected" : ""}
                                      onClick={() => setBomLineProduct(line, sg.productId)}
                                      title={sg.reason}
                                    >
                                      {sg.productName} <span>{Math.round((sg.score || 0) * 100)}%</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                              {selectedProduct && <div className="ln-sku">Đang dùng: {selectedProduct.sku || "—"} · {selectedProduct.supplier || "Catalog"}</div>}
                            </td>
                            <td>
                              <div>{line.issues?.length ? line.issues.join("; ") : selectedProductId ? "Sẵn sàng tạo báo giá" : supporting ? "Vật tư phụ — ẩn mặc định, chỉ đưa vào báo giá chi tiết khi cần" : "Chọn sản phẩm trong catalog"}</div>
                              <div className="bom-row-actions">
                                {!selectedProductId && topSuggestion?.productId && !ignored && (
                                  <button className="btn-mini" onClick={() => setBomLineProduct(line, topSuggestion.productId)}>Chọn gợi ý đầu</button>
                                )}
                                {ignored ? (
                                  <button className="btn-mini" onClick={() => restoreBomLine(line)}>Khôi phục</button>
                                ) : (
                                  <button className="btn-mini danger" onClick={() => ignoreBomLine(line)}>Bỏ qua</button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {filtered.length > bomPilotTableLimit && (
                    <div className="bom-load-more">
                      <span>Đang hiển thị {bomPilotTableLimit}/{filtered.length} dòng để giữ UI nhẹ.</span>
                      <button className="btn-mini" onClick={() => setBomPilotTableLimit((n) => n + 80)}>Hiện thêm 80 dòng</button>
                    </div>
                  )}
                  {filtered.length === 0 && <div className="empty-hint">Không có dòng nào trong filter này.</div>}
                </div>
              </>
            );
          })()}
        </section>
      )}

      {/* Bảng ma trận — mode cũ */}
      {mode === "matrix" && (
      <section className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Bảng bóc tách (tầng × thiết bị)</h2>
            <p className="tab-intro" style={{ margin: "4px 0 0" }}>
              AI tự ghép cột với thiết bị trong catalog, nhớ lựa chọn cho lần sau.
            </p>
          </div>
          <button className="btn-ghost" style={{ fontSize: 12, flexShrink: 0 }} onClick={() => { setMode(""); setParsed(null); setMapping({}); setAiStatus(""); }}>
            ← Đổi loại file
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn-excel" onClick={() => fileRef.current?.click()}>
            ⬆ Tải file bóc tách Excel
          </button>
          {aiStatus === "loading" && <span style={{ fontSize: 12.5, color: "var(--brand)" }}>🤖 AI đang phân tích cột…</span>}
          {aiStatus === "done" && parsed && <span style={{ fontSize: 12.5, color: "var(--pos)" }}>✓ AI đã ghép xong</span>}
          {aiStatus === "error" && <span style={{ fontSize: 12.5, color: "var(--neg)" }}>⚠ AI lỗi — ghép thủ công bên dưới</span>}
        </div>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" hidden onChange={handleFile} />
      </section>
      )}

      {parsed && (
        <>
          <section className="card">
            <div className="takeoff-head">
              <h2>{parsed.title || "Bảng bóc tách"}</h2>
              <span className="takeoff-stat">{parsed.floors.length} tầng · {parsed.columns.length} loại thiết bị · đã ghép {mappedCount}/{parsed.columns.length}</span>
            </div>

            <p className="tab-intro" style={{ margin: "0 0 10px" }}>
              Ghép mỗi cột trong file với thiết bị trong bảng giá. Cột đoán sẵn rồi, chỉ cần kiểm tra lại; cột chưa khớp tô vàng.
            </p>

            <table className="map-table">
              <thead>
                <tr><th>Tên cột trong file</th><th class="num">SL</th><th style={{width:70}}>NCC</th><th>Ghép với thiết bị trong catalog</th></tr>
              </thead>
              <tbody>
                {parsed.columns.map((col) => {
                  const totalQty = parsed.floors.reduce((s, f) => s + (f.qtys[col] || 0), 0);
                  if (totalQty === 0) return null;
                  const isShared = parsed.sharedColumns && parsed.sharedColumns[col];
                  const mappedProduct = products.find((p) => p.id === mapping[col]);
                  const tag = mappedProduct?.supplier?.toLowerCase();
                  const tagClass = tag?.includes("lumi") ? "tag-ncc tag-lumi"
                    : tag?.includes("hikvision") || tag?.includes("hik") ? "tag-ncc tag-hik"
                    : tag?.includes("ruijie") ? "tag-ncc tag-ruijie"
                    : tag?.includes("bisco") ? "tag-ncc tag-bisco"
                    : tag?.includes("roger") ? "tag-ncc tag-roger"
                    : null;
                  return (
                    <tr key={col} className={mapping[col] ? "" : "row-unmapped"}>
                      <td>
                        <span className="strong">{col}</span>
                        {isShared && <span className="badge-shared">dùng chung</span>}
                        {mapping[col] && <span className="badge-ai">AI</span>}
                      </td>
                      <td className="num">{totalQty}</td>
                      <td>{mappedProduct && tagClass && <span className={tagClass}>{mappedProduct.supplier}</span>}</td>
                      <td>
                        <SearchSelect
                          products={products}
                          value={mapping[col] || ""}
                          onChange={(pid) => setColMap(col, pid)}
                          hasValue={!!mapping[col]}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <p className="tab-intro" style={{ marginTop: 10 }}>
              Cột gắn nhãn <span className="badge-shared">dùng chung</span> là thiết bị chỉ điền 1 lần, dùng cho cả công trình
              (vd bộ trung tâm, đầu ghi, cân bằng tải) — sẽ gom vào khu vực “Thiết bị dùng chung” riêng, không thuộc tầng nào.
            </p>

            {unmappedCols.length > 0 && (
              <p className="takeoff-warn">
                Còn {unmappedCols.length} cột chưa ghép: {unmappedCols.join(", ")}. Các cột này sẽ bị bỏ qua nếu không chọn thiết bị.
              </p>
            )}

            <button className="btn-primary" style={{ marginTop: 14, width: "auto" }} onClick={buildQuote}>
              Tạo báo giá →
            </button>
          </section>

          {/* Xem trước bảng số lượng theo tầng */}
          <section className="card">
            <h2>Xem trước số lượng theo tầng</h2>
            <div className="takeoff-preview-scroll">
              <table className="cat-table">
                <thead>
                  <tr>
                    <th>Tầng</th>
                    {parsed.columns.map((c) => <th key={c} className="num">{c}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {parsed.floors.map((f) => (
                    <tr key={f.name}>
                      <td className="strong">{f.name}</td>
                      {parsed.columns.map((c) => <td key={c} className="num">{f.qtys[c] || ""}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* Mode KTS — nhúng AIReader vào đây */}
      {mode === "kts" && (
        <AIReader
          products={products}
          setProducts={() => {}}
          company={company}
          embedded={true}
          ktsFileRef={ktsFileRef}
          onBack={() => { setMode(""); }}
          onCreateQuote={onCreateQuote}
        />
      )}

    </div>
  );
}

// handleKTSFile là prop của AIReader — xử lý bên trong AIReader component

// ============================================================
// TAB 2 — Bảng giá thiết bị (catalog)
// ============================================================
// ============================================================
// CATALOG IMPORTER — Drag & drop Excel/PDF, AI nhận diện cột
// ============================================================
function CatalogImporter({ products, setProducts, company, onClose,
  imgDragging, setImgDragging, imgStatus, setImgStatus, imgFolderRef, handleImgDrop, handleImgFiles }) {
  const [step, setStep]           = useState("drop");
  const [file, setFile]           = useState(null);
  const [batchMode, setBatchMode] = useState(false);
  const [batchLog, setBatchLog]   = useState([]);
  const [rawRows, setRawRows]     = useState([]);
  const [manualStartRow, setManualStartRow] = useState(1); // 1-based, tính từ dòng data sau header
  const [manualEndRow, setManualEndRow] = useState("");  // rỗng = tới cuối
  const [headers, setHeaders]     = useState([]);       // tên cột trong file
  const [colMap, setColMap]       = useState({});       // fieldKey → colIndex
  const [parsed, setParsed]       = useState([]);       // [{name,sku,category,supplier,unit,costPrice,specs}]
  const [importResult, setImportResult] = useState(null); // ImportPreviewResult chuẩn Phase 2
  const [aiStatus, setAiStatus]   = useState("");
  const [mergeMode, setMergeMode] = useState("merge");  // merge | replace
  const [dragging, setDragging]   = useState(false);
  const [cacheHits, setCacheHits] = useState(0);
  const [editingIndex, setEditingIndex] = useState(null);
  const [editingDraft, setEditingDraft] = useState(null);
  const [previewFilter, setPreviewFilter] = useState("all");
  const [highlightedPreviewIndex, setHighlightedPreviewIndex] = useState(null);
  const [templateNotice, setTemplateNotice] = useState("");
  const [templateLibrary, setTemplateLibrary] = useState([]);
  const [templateSuggestions, setTemplateSuggestions] = useState([]);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState("");
  const [learningNotice, setLearningNotice] = useState("");
  const [learningStats, setLearningStats] = useState(() => {
    try { return listCorrectionLearningStats(); } catch { return { skuRules: 0, rawRules: 0, supplierProfiles: 0 }; }
  });
  const [webUrl, setWebUrl] = useState("");
  const [webSupplier, setWebSupplier] = useState("");
  const [webImporting, setWebImporting] = useState(false);
  const [webStatus, setWebStatus] = useState("");
  const fileRef = useRef();
  const imgFilesInputRef = useRef(null);
  const imgFolderInputRef = useRef(null);
  const products_ref = useRef(products);
  useEffect(() => { products_ref.current = products; }, [products]);

  // ── LỚP 3: CACHE — không gọi AI lại cho file giống nhau ──
  const getCached = (hash) => {
    try {
      const c = localStorage.getItem("sq_pdf_cache_" + hash);
      return c ? JSON.parse(c) : null;
    } catch { return null; }
  };
  const setCached = (hash, items) => {
    try {
      const keys = Object.keys(localStorage).filter(k => k.startsWith("sq_pdf_cache_"));
      if (keys.length > 30) localStorage.removeItem(keys[0]);
      localStorage.setItem("sq_pdf_cache_" + hash, JSON.stringify(items));
    } catch {}
  };

  // ── LỚP 2: QUOTA — đếm số file PDF dùng AI trong tháng ──
  const getQuota = () => {
    try {
      const month = new Date().toISOString().slice(0, 7);
      const data = JSON.parse(localStorage.getItem("sq_ai_quota") || "{}");
      if (data.month !== month) return { month, pdfCount: 0 };
      return data;
    } catch { return { month: new Date().toISOString().slice(0,7), pdfCount: 0 }; }
  };
  const incQuota = (n = 1) => {
    const q = getQuota();
    q.pdfCount = (q.pdfCount || 0) + n;
    localStorage.setItem("sq_ai_quota", JSON.stringify(q));
    return q.pdfCount;
  };
  const PDF_QUOTA_LIMIT = (company?.pdfQuotaLimit) || 50;

  // ── TEMPLATE MEMORY: centralized in import-engine/templateMemory.js ──
  const loadCatalogTemplate = (hdrs, fileName) => loadStoredCatalogTemplate(hdrs, fileName);
  const saveCatalogTemplate = (hdrs = headers, fileName = file?.name || "", extra = {}) => {
    const result = persistCatalogTemplate({
      headers: hdrs,
      fileName,
      colMap,
      manualStartRow,
      manualEndRow,
      extra,
    });
    if (result.ok) {
      setTemplateNotice(`✓ Đã lưu template mapping cho ${result.template?.name || "file này"}`);
      return true;
    }
    setTemplateNotice("Không lưu được template mapping trên trình duyệt này.");
    return false;
  };
  const refreshTemplateLibrary = (hdrs = headers, fileName = file?.name || "") => {
    try {
      const all = listStoredCatalogTemplates();
      setTemplateLibrary(all);
      setTemplateSuggestions(hdrs?.length ? suggestStoredCatalogTemplates(hdrs, fileName, 8) : all.slice(0, 8));
    } catch {
      setTemplateLibrary([]);
      setTemplateSuggestions([]);
    }
  };

  const refreshLearningStats = () => {
    try { setLearningStats(listCorrectionLearningStats()); } catch {}
  };

  const saveCurrentMappingTemplate = () => {
    if (!headers.length) { alert("Chưa có file/header để lưu template."); return; }
    if (!colMap.name && !colMap.sku) { alert("Cần map ít nhất cột Tên sản phẩm hoặc Mã SKU trước khi lưu template."); return; }
    const ok = saveCatalogTemplate(headers, file?.name || "");
    if (ok) refreshTemplateLibrary(headers, file?.name || "");
  };

  const applyCatalogTemplate = (tpl) => {
    if (!tpl?.colMap) return;
    setColMap(tpl.colMap || {});
    setManualStartRow(tpl.manualStartRow || 1);
    setManualEndRow(tpl.manualEndRow ?? "");
    setSelectedTemplateKey(tpl.key || "");
    setTemplateNotice(`✓ Đã áp dụng template: ${tpl.name || tpl.fileName || "mapping đã lưu"}`);
  };

  const applySelectedTemplate = () => {
    const tpl = templateLibrary.find((t) => t.key === selectedTemplateKey) || templateSuggestions.find((t) => t.key === selectedTemplateKey);
    if (!tpl) { alert("Chọn một template mapping trước."); return; }
    applyCatalogTemplate(tpl);
  };

  const deleteSelectedTemplate = () => {
    if (!selectedTemplateKey) { alert("Chọn template cần xóa."); return; }
    const tpl = templateLibrary.find((t) => t.key === selectedTemplateKey) || templateSuggestions.find((t) => t.key === selectedTemplateKey);
    if (!confirm(`Xóa template mapping ${tpl?.name || "này"}?`)) return;
    if (deleteStoredCatalogTemplate(selectedTemplateKey)) {
      setSelectedTemplateKey("");
      refreshTemplateLibrary(headers, file?.name || "");
      setTemplateNotice("Đã xóa template mapping.");
    }
  };

  const learnFromProducts = (items, meta = {}) => {
    const valid = (items || []).filter((p) => p && (p.name || p.sku));
    if (!valid.length) return 0;
    const res = saveProductLearningBatch(valid, {
      fileName: file?.name || meta.fileName || "",
      detectedIndustry: importResult?.detectedIndustry || meta.detectedIndustry || "catalog",
      ...meta,
    });
    refreshLearningStats();
    return res.saved || 0;
  };

  // Các field cần map
  const FIELDS = [
    { key: "name",      label: "Tên sản phẩm",   required: true  },
    { key: "sku",       label: "Mã SKU",          required: false },
    { key: "category",  label: "Nhóm / Danh mục", required: false },
    { key: "supplier",  label: "Nhà cung cấp",    required: false },
    { key: "unit",      label: "Đơn vị tính",     required: false },
    { key: "costPrice", label: "Giá nhập / Giá gốc", required: false },
    { key: "currentListPrice", label: "Giá hiện hành / Điều chỉnh", required: false },
    { key: "listPrice", label: "Giá công bố / Niêm yết cũ", required: false },
    { key: "minRetailPrice", label: "Giá bán lẻ thấp nhất", required: false },
    { key: "specs",     label: "Thông số kỹ thuật", required: false },
    { key: "image",     label: "Ảnh URL", required: false },
  ];

  // Đọc file và detect headers
  // Xử lý nhiều file cùng lúc — mỗi file parse riêng, gộp kết quả
  const handleMultipleFiles = async (files) => {
    const fileList = Array.from(files).filter(f =>
      /\.(xlsx|xls|pdf)$/i.test(f.name)
    );
    if (!fileList.length) {
      alert("Không tìm thấy file Excel hoặc PDF nào.");
      return;
    }

    setStep("mapping");
    setBatchMode(true);
    const fileLog = [];

    // Tách Excel (engine v2, deterministic) và PDF (cần AI)
    const excelFiles = fileList.filter(f => /\.(xlsx|xls)$/i.test(f.name));
    const pdfFiles   = fileList.filter(f => /\.pdf$/i.test(f.name));
    let allProducts = [];
    let filePreviews = [];
    let totalLearningHits = 0;

    // AI fallback chỉ dùng khi engine deterministic kém
    const aiExtract = async (payload) => {
      const quota = getQuota();
      if (quota.pdfCount >= PDF_QUOTA_LIMIT) return null;
      return null; // Excel không cần AI; để null = chỉ deterministic
    };

    // 1) Excel qua engine v2
    if (excelFiles.length) {
      setAiStatus(`Đang đọc ${excelFiles.length} file Excel (engine v2)...`);
      try {
        const { products, perFile, preview } = await importManyForUI(excelFiles, {
          catalog: products_ref.current || [],
          aiExtract,
        });
        const learned = applyCorrectionLearning(products, { fileName: `${excelFiles.length} Excel files` });
        totalLearningHits += learned.hits || 0;
        allProducts = allProducts.concat(sanitizeCatalogProducts(learned.products));
        perFile.forEach(pf => {
          fileLog.push(`✓ ${pf.name}: ${pf.count} SP (${pf.engine}${pf.domain ? ", " + pf.domain : ""})`);
          (pf.warnings || []).forEach(w => fileLog.push(`  ⚠ ${w}`));
        });
        setBatchLog([...fileLog]);
        if (preview) filePreviews.push(preview);
      } catch (e) {
        fileLog.push(`✗ Lỗi đọc Excel: ${e.message}`);
        setBatchLog([...fileLog]);
      }
    }

    // 2) PDF qua AI (giữ flow cũ: cache + quota)
    for (let i = 0; i < pdfFiles.length; i++) {
      const f = pdfFiles[i];
      setAiStatus(`Đang đọc PDF ${i + 1}/${pdfFiles.length}: ${f.name}...`);
      try {
        const items = await parsePDFToProducts(f);
        const learnedPdf = applyCorrectionLearning(items, { fileName: f.name });
        totalLearningHits += learnedPdf.hits || 0;
        allProducts = allProducts.concat(sanitizeCatalogProducts(learnedPdf.products));
        if (items.importPreview) filePreviews.push(items.importPreview);
        fileLog.push(`✓ ${f.name}: ${items.length} SP (AI)`);
      } catch (err) {
        fileLog.push(`✗ ${f.name}: ${err.message}`);
      }
      setBatchLog([...fileLog]);
    }

    // Khử trùng theo SKU (giữ bản cuối)
    const seen = {};
    const deduped = [];
    allProducts.forEach(p => {
      const key = (p.sku || p.name || "").toLowerCase().trim();
      if (key && seen[key] !== undefined) deduped[seen[key]] = p;
      else { seen[key] = deduped.length; deduped.push(p); }
    });

    const cleanDeduped = sanitizeCatalogProducts(deduped);
    setParsed(cleanDeduped);
    setLearningNotice(totalLearningHits > 0 ? `✓ Áp dụng ${totalLearningHits} học từ lần sửa trước` : "");
    refreshLearningStats();
    setImportResult(filePreviews.length
      ? combineImportPreviewResults(filePreviews, { fileName: `${fileList.length} files`, importType: "catalog_batch", engine: "mixed" })
      : productsToImportPreviewResult({ products: cleanDeduped, fileName: `${fileList.length} files`, engine: "mixed" })
    );
    setAiStatus(`✓ Đọc xong ${fileList.length} file — tổng ${deduped.length} sản phẩm`);
    setStep("preview");
  };

  // Parse PDF → mảng sản phẩm (pipeline v2: text extraction → chunk AI → legacy fallback)
  const parsePDFToProducts = async (f) => {
    return parsePdfCatalogWithClaude(f, {
      getCached,
      setCached,
      getQuota,
      incQuota,
      quotaLimit: PDF_QUOTA_LIMIT,
      onCacheHit: () => setCacheHits(h => h + 1),
      onProgress: (event) => {
        if (event?.message) {
          setAiStatus(event.message);
          setBatchLog(prev => {
            const next = [...prev, event.message];
            return next.slice(-12);
          });
        }
      },
    });
  };

  const handleFile = async (f) => {
    if (!f) return;
    setFile(f);
    const ext = f.name.split(".").pop().toLowerCase();
    if (ext === "pdf") await handlePDF(f);
    else await handleExcel(f);
  };

  const handleExcel = async (f) => {
    setStep("mapping");
    setBatchMode(true);
    setBatchLog([`Đang đọc ${f.name} (engine v2)...`]);
    try {
      const { result, preview, products: items } = await importFileForUI(f, {
        catalog: products_ref.current || [],
      });
      if (!items.length) {
        setAiStatus("Không trích được sản phẩm nào.");
        setBatchLog([`✗ ${f.name}: không có sản phẩm`]);
        return;
      }
      const learned = applyCorrectionLearning(items, { fileName: f.name, detectedIndustry: preview?.detectedIndustry || result?.domain });
      const cleanItems = sanitizeCatalogProducts(learned.products);
      setLearningNotice(learned.hits > 0 ? `✓ Áp dụng ${learned.hits} học từ lần sửa trước` : "");
      refreshLearningStats();
      setParsed(cleanItems);
      setImportResult(productsToImportPreviewResult({
        products: cleanItems,
        fileName: f.name,
        engine: preview?.engine || "excel-v2",
        detectedIndustry: preview?.detectedIndustry || "unknown",
        detectedTemplateId: preview?.detectedTemplateId || null,
        templateKnown: !!preview?.templateKnown,
        warnings: preview?.warnings || [],
        summary: { skipped: preview?.summary?.skipped || 0, noteRows: preview?.summary?.noteRows || 0 },
      }));
      const s = result.stats;
      setBatchLog([
        `✓ ${f.name}: ${items.length} SP (${result.engine}${result.domain ? ", " + result.domain : ""})`,
        `   khớp catalog: ${s.matched} · mới: ${s.new} · cần xem: ${s.review} · loại: ${s.rejected}`,
        ...(result.warnings || []).map(w => `   ⚠ ${w}`),
      ]);
      setAiStatus(`✓ Đọc xong — ${items.length} sản phẩm`);
      setStep("preview");
    } catch (e) {
      setAiStatus("Lỗi đọc file: " + e.message);
      setBatchLog([`✗ ${f.name}: ${e.message}`]);
    }
  };

  const handlePDF = async (f) => {
    setAiStatus("🤖 AI đang đọc PDF — trích xuất tất cả sản phẩm...");
    setStep("mapping");
    setBatchMode(true);
    setBatchLog([`Đang xử lý: ${f.name}`]);
    try {
      const items = await parsePDFToProducts(f);
      if (!items.length) {
        setAiStatus("Không tìm thấy sản phẩm nào trong PDF.");
        setBatchLog([`✗ ${f.name}: không có sản phẩm`]);
        return;
      }
      const learned = applyCorrectionLearning(items, { fileName: f.name, detectedIndustry: items.importPreview?.detectedIndustry || "pdf" });
      const cleanItems = sanitizeCatalogProducts(learned.products);
      setLearningNotice(learned.hits > 0 ? `✓ Áp dụng ${learned.hits} học từ lần sửa trước` : "");
      refreshLearningStats();
      setParsed(cleanItems);
      setImportResult(items.importPreview || productsToImportPreviewResult({ products: cleanItems, fileName: f.name, engine: "pdf-v2" }));
      setBatchLog([`✓ ${f.name}: ${items.length} sản phẩm`]);
      setAiStatus(`✓ AI đọc xong — ${items.length} sản phẩm`);
      setStep("preview");
    } catch (e) {
      setAiStatus("Lỗi đọc PDF: " + e.message);
      setBatchLog([`✗ ${f.name}: ${e.message}`]);
    }
  };

  const handleWebImport = async () => {
    const url = String(webUrl || "").trim();
    if (!url) {
      setWebStatus("Nhập URL trang danh mục/trang sản phẩm trước.");
      return;
    }
    let normalizedUrl = url;
    if (!/^https?:\/\//i.test(normalizedUrl)) normalizedUrl = `https://${normalizedUrl}`;

    setWebImporting(true);
    setWebStatus("");
    setAiStatus("Đang cào danh sách sản phẩm từ web...");
    setBatchMode(true);
    setStep("mapping");
    setBatchLog([`Đang đọc web: ${normalizedUrl}`]);

    try {
      const response = await fetch("/api/web-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: normalizedUrl, supplier: webSupplier, limit: 300, crawl: true, maxPages: 32 }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);

      const webProducts = webScrapeItemsToProducts(payload, {
        sourceUrl: payload.sourceUrl || normalizedUrl,
        defaultSupplier: webSupplier || payload.siteName || payload.hostname || "Web",
      });
      if (!webProducts.length) {
        setAiStatus("Không trích được sản phẩm từ URL này.");
        setBatchLog([`✗ ${normalizedUrl}: không có sản phẩm rõ ràng`, ...(payload.warnings || []).map(w => `⚠ ${w}`)]);
        setWebStatus("Không trích được sản phẩm. Thử trang danh mục có HTML tĩnh, hoặc dùng Excel/PDF từ nhà cung cấp.");
        setStep("drop");
        return;
      }

      const learned = applyCorrectionLearning(webProducts, { fileName: payload.sourceUrl || normalizedUrl, detectedIndustry: "web_catalog" });
      const cleanItems = sanitizeCatalogProducts(learned.products, { defaultSupplier: webSupplier || payload.siteName || payload.hostname || "Web" });
      setFile({ name: payload.sourceUrl || normalizedUrl });
      setLearningNotice(learned.hits > 0 ? `✓ Áp dụng ${learned.hits} học từ lần sửa trước` : "");
      refreshLearningStats();
      setParsed(cleanItems);
      setImportResult(productsToImportPreviewResult({
        products: cleanItems,
        fileName: payload.sourceUrl || normalizedUrl,
        engine: payload.engine || "web-scrape",
        detectedIndustry: "web_catalog",
        warnings: payload.warnings || [],
      }));
      const imageCount = cleanItems.filter((p) => p.image).length;
      setBatchLog([
        `✓ ${payload.hostname || normalizedUrl}: ${cleanItems.length} sản phẩm từ web · ${imageCount} ảnh`,
        payload.pagesScanned ? `   đã đọc ${payload.pagesScanned} trang category/pagination` : "",
        ...(payload.warnings || []).map(w => `⚠ ${w}`),
      ]);
      setWebStatus(`✓ Đã cào ${cleanItems.length} sản phẩm, lấy được ${imageCount} ảnh${payload.pagesScanned ? ` từ ${payload.pagesScanned} trang` : ""}.`);
      setAiStatus(`✓ Đã cào xong — ${cleanItems.length} sản phẩm · ${imageCount} ảnh${payload.pagesScanned ? ` · ${payload.pagesScanned} trang` : ""}`);
      setStep("preview");
    } catch (e) {
      setAiStatus("Lỗi cào web: " + e.message);
      setBatchLog([`✗ ${normalizedUrl}: ${e.message}`]);
      setWebStatus("Lỗi cào web: " + e.message);
      setStep("drop");
    } finally {
      setWebImporting(false);
    }
  };

  const processRows = (rows, fileName) => {
    if (!rows || rows.length < 2) {
      alert("File không có đủ dữ liệu (cần ít nhất 1 dòng tiêu đề + dòng data).");
      return;
    }
    // Tìm hàng header — hàng có nhiều text nhất trong 10 dòng đầu
    let headerRowIdx = 0;
    let maxTextCells = 0;
    for (let i = 0; i < Math.min(10, rows.length); i++) {
      const textCount = (rows[i] || []).filter(c => c && String(c).trim().length > 1 && isNaN(c)).length;
      if (textCount > maxTextCells) { maxTextCells = textCount; headerRowIdx = i; }
    }
    const hdrs = (rows[headerRowIdx] || []).map((h, i) => ({ label: String(h ?? `Cột ${i+1}`).trim(), idx: i }));
    const dataRows = rows.slice(headerRowIdx + 1).filter(r => r.some(c => c !== null && c !== ""));
    setHeaders(hdrs);
    setRawRows(dataRows);
    setManualStartRow(1);
    setManualEndRow("");
    refreshTemplateLibrary(hdrs, fileName);

    // Template memory: nếu đã map file cùng format trước đó, tự dùng lại.
    const savedTemplate = loadCatalogTemplate(hdrs, fileName);
    if (savedTemplate?.colMap) {
      setColMap(savedTemplate.colMap || {});
      setManualStartRow(savedTemplate.manualStartRow || 1);
      setManualEndRow(savedTemplate.manualEndRow ?? "");
      setTemplateNotice(`✓ Đã dùng template đã lưu: ${savedTemplate.name || "catalog"}`);
      setAiStatus(`✓ Đã dùng template mapping đã lưu — kiểm tra lại nếu nhà cung cấp đổi file`);
    } else {
      setTemplateNotice("");
      // AI auto-map cột
      autoMapColumns(hdrs, rows.slice(headerRowIdx + 1, headerRowIdx + 6), fileName);
    }
    setStep("mapping");
  };

  // Đoán cột theo tên header — chạy ngay không cần AI
  const guessColumnsByName = (hdrs) => guessCatalogColumnsByName(hdrs);

  const autoMapColumns = async (hdrs, sampleRows, fileName) => {
    const guessed = guessColumnsByName(hdrs);
    setColMap(guessed);

    const isVercel = window.location.protocol === "https:";
    if (!isVercel) {
      setAiStatus(guessed.name ? "✓ Đã đoán cột theo tên — kiểm tra lại bên dưới" : "Chọn cột thủ công bên dưới");
      return;
    }

    setAiStatus("AI đang nhận diện cột...");
    try {
      const mapping = await autoMapCatalogColumnsWithClaude({ headers: hdrs, sampleRows, fileName });
      const mapped = {};
      Object.entries(mapping || {}).forEach(([k, v]) => { if (v !== null && v !== undefined) mapped[k] = String(v); });
      setColMap(mapped);
      setAiStatus("✓ AI nhận diện xong");
    } catch {
      setAiStatus(guessed.name ? "✓ Đã đoán cột theo tên — kiểm tra lại bên dưới" : "Chọn cột thủ công bên dưới");
    }
  };

  const getManualSelectedRows = () => {
    const total = rawRows.length;
    const start = Math.max(1, Math.min(total || 1, Number(manualStartRow) || 1));
    const end = manualEndRow === "" || manualEndRow == null
      ? total
      : Math.max(start, Math.min(total, Number(manualEndRow) || total));
    return { start, end, rows: rawRows.slice(start - 1, end) };
  };

  const buildPreview = () => {
    const selected = getManualSelectedRows();
    const rawPreview = buildCatalogPreview(selected.rows, colMap, {
      startRowIndex: selected.start - 1,
      defaultSupplier: file?.name?.replace(/\.(xlsx|xls)$/i, "") || "",
      sheetName: file?.name || "manual-mapping.xlsx",
    });
    const learned = applyCorrectionLearning(rawPreview, { fileName: file?.name || "manual-mapping.xlsx" });
    const result = sanitizeCatalogProducts(learned.products);
    setLearningNotice(learned.hits > 0 ? `✓ Áp dụng ${learned.hits} học từ lần sửa trước` : "");
    refreshLearningStats();
    setParsed(result);
    setImportResult(productsToImportPreviewResult({
      products: result,
      fileName: file?.name || "manual-mapping.xlsx",
      engine: "manual-column-mapping",
      warnings: selected.start > 1 || selected.end < rawRows.length ? [`Chỉ import dòng ${selected.start}–${selected.end} trong ${rawRows.length} dòng data`] : [],
    }));
    setStep("preview");
  };

  const openManualMapping = async () => {
    if (!file || !/\.(xlsx|xls)$/i.test(file.name)) {
      alert("Sửa mapping hiện chỉ hỗ trợ file Excel. Với PDF, hãy sửa trực tiếp từng dòng trong preview hoặc upload file Excel nếu nhà cung cấp có.");
      return;
    }
    try {
      setAiStatus("Đang mở mapping cột thủ công...");
      const { rows, fileName } = await readCatalogRowsForManualMapping(file);
      setBatchMode(false);
      processRows(rows, fileName);
    } catch (e) {
      alert("Không mở được mapping thủ công: " + e.message);
    }
  };

  const rebuildImportResultFromParsed = (list, engine = "user-reviewed") => {
    setImportResult(productsToImportPreviewResult({
      products: list,
      fileName: file?.name || "import",
      engine,
      detectedIndustry: importResult?.detectedIndustry || "catalog",
      detectedTemplateId: importResult?.detectedTemplateId || null,
      templateKnown: !!importResult?.templateKnown,
      warnings: importResult?.warnings || [],
      summary: { skipped: importResult?.summary?.skipped || 0, noteRows: importResult?.summary?.noteRows || 0 },
    }));
  };

  const getPreviewIssues = (p) => p?._meta?.issues || p?.issues || [];
  const getProductLineId = (p) => p?._meta?.lineId || p?.lineId || "";
  const getLineForProductIndex = (index, product = parsed[index]) => {
    const id = getProductLineId(product);
    if (id && importResult?.lines?.length) {
      const byId = importResult.lines.find((l) => l.lineId === id);
      if (byId) return byId;
    }
    return importResult?.lines?.[index] || null;
  };
  const issueLevel = (it) => typeof it === "string" ? (/lỗi|error|thiếu tên|không phải|bất thường|không tách được/i.test(it) ? "error" : "warning") : (it?.level || "warning");
  const issueCode = (it) => typeof it === "string" ? String(it).toLowerCase() : String(it?.code || "").toLowerCase();
  const isBlockingIssue = (it) => {
    const code = issueCode(it);
    const msg = typeof it === "string" ? it.toLowerCase() : String(it?.message || "").toLowerCase();
    if (issueLevel(it) === "error") return true;
    return /missing_product_name|price_parse_failed|price_unreasonable|non_product_row|name_too_long/.test(code)
      || /thiếu tên|không phải sản phẩm|giá nhập bất thường|không tách được giá|tên sản phẩm quá dài/.test(msg);
  };
  const isWarningOnlyProduct = (p) => {
    const issues = getPreviewIssues(p);
    if (!issues.length) return false;
    return !issues.some(isBlockingIssue);
  };
  const getPreviewCounts = (list = parsed) => {
    const blocking = list.filter((p) => getPreviewIssues(p).some(isBlockingIssue)).length;
    const warningOnly = list.filter(isWarningOnlyProduct).length;
    const clean = list.length - blocking - warningOnly;
    const skipped = importResult?.summary?.skipped || 0;
    return { clean: Math.max(0, clean), warningOnly, blocking, skipped, willImport: Math.max(0, clean), needFix: warningOnly + blocking };
  };

  const getPreviewStatusForRow = (p, index) => getLineForProductIndex(index, p)?.status || p?._meta?.canonicalStatus || p?._meta?.status || "auto_approved";
  const isCleanPreviewRow = (p, index) => {
    const issues = getPreviewIssues(p);
    const status = getPreviewStatusForRow(p, index);
    return !issues.length && !["failed", "need_review", "review", "rejected"].includes(status);
  };
  const isReviewPreviewRow = (p, index) => {
    const status = getPreviewStatusForRow(p, index);
    return isWarningOnlyProduct(p) || ["need_review", "review"].includes(status);
  };
  const isBlockingPreviewRow = (p, index) => {
    const status = getPreviewStatusForRow(p, index);
    return getPreviewIssues(p).some(isBlockingIssue) || ["failed", "rejected"].includes(status);
  };
  const getProblemRows = (kind = "blocking") => {
    const rows = parsed.map((p, index) => ({ p, index, line: getLineForProductIndex(index, p) }));
    if (kind === "review") return rows.filter(({ p, index }) => isReviewPreviewRow(p, index));
    if (kind === "any") return rows.filter(({ p, index }) => isBlockingPreviewRow(p, index) || isReviewPreviewRow(p, index));
    return rows.filter(({ p, index }) => isBlockingPreviewRow(p, index));
  };
  const scrollToPreviewIndex = (index) => {
    if (index == null || index < 0) return;
    setHighlightedPreviewIndex(index);
    window.setTimeout(() => {
      const el = document.querySelector(`[data-preview-index="${index}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    }, 80);
  };
  const goToPreviewIssue = (kind = "blocking", direction = "first") => {
    const rows = getProblemRows(kind);
    if (!rows.length) {
      alert(kind === "blocking" ? "Không còn dòng lỗi nặng." : "Không còn dòng cần kiểm tra.");
      return;
    }
    const filter = kind === "review" ? "review" : "blocking";
    setPreviewFilter(filter);
    let target = rows[0];
    if (direction === "next" || direction === "prev") {
      const currentPos = rows.findIndex(r => r.index === highlightedPreviewIndex);
      const nextPos = direction === "next"
        ? (currentPos < 0 ? 0 : (currentPos + 1) % rows.length)
        : (currentPos < 0 ? rows.length - 1 : (currentPos - 1 + rows.length) % rows.length);
      target = rows[nextPos];
    }
    scrollToPreviewIndex(target.index);
  };
  const getFilteredPreviewRows = () => {
    const rows = parsed.map((p, index) => ({ p, index, line: getLineForProductIndex(index, p) }));
    return rows.filter(({ p, index }) => {
      if (previewFilter === "all") return true;
      if (previewFilter === "clean") return isCleanPreviewRow(p, index);
      if (previewFilter === "review") return isReviewPreviewRow(p, index);
      if (previewFilter === "blocking") return isBlockingPreviewRow(p, index);
      if (previewFilter === "approved") return !!p?._meta?.userApproved || !!p?._meta?.userEdited;
      return true;
    });
  };
  const previewFilterCounts = (() => {
    const rows = parsed.map((p, index) => ({ p, index }));
    return {
      all: rows.length,
      clean: rows.filter(({ p, index }) => isCleanPreviewRow(p, index)).length,
      review: rows.filter(({ p, index }) => isReviewPreviewRow(p, index)).length,
      blocking: rows.filter(({ p, index }) => isBlockingPreviewRow(p, index)).length,
      approved: rows.filter(({ p }) => !!p?._meta?.userApproved || !!p?._meta?.userEdited).length,
    };
  })();
  const firstBlockingRow = getProblemRows("blocking")[0];
  const firstReviewRow = getProblemRows("review")[0];

  useEffect(() => {
    if (step !== "preview" || !parsed.length || previewFilter !== "all") return;
    if (previewFilterCounts.blocking > 0) setPreviewFilter("blocking");
    else if (previewFilterCounts.review > 0) setPreviewFilter("review");
    else if (previewFilterCounts.clean > 0) setPreviewFilter("clean");
  }, [step, parsed.length]);

  const approvePreviewRow = (index) => {
    const current = parsed[index];
    if (current && isBlockingPreviewRow(current, index)) {
      alert("Dòng này là lỗi nặng nên không thể Duyệt nguyên dòng. Hãy bấm Sửa để chỉnh giá/tên/SKU hoặc bấm Xóa để bỏ qua.");
      goToPreviewIssue("blocking", "first");
      return;
    }
    setParsed(prev => {
      const next = prev.map((p, i) => i === index ? {
        ...p,
        _meta: {
          ...(p._meta || {}),
          issues: [],
          status: "new",
          canonicalStatus: "auto_approved",
          confidence: 0.9,
          userApproved: true,
        }
      } : p);
      if (next[index]) {
        saveProductLearning(next[index], { fileName: file?.name || "", detectedIndustry: importResult?.detectedIndustry || "catalog", userApproved: true });
        refreshLearningStats();
      }
      rebuildImportResultFromParsed(next, "user-approved-preview");
      return next;
    });
  };

  const approveAllPreviewRows = () => {
    const counts = getPreviewCounts(parsed);
    if (counts.warningOnly <= 0) {
      if (counts.blocking > 0) {
        const go = confirm(`Không có dòng cảnh báo nhẹ để duyệt hàng loạt. Còn ${counts.blocking} dòng lỗi nặng cần Sửa hoặc Xóa.

Bấm OK để đi tới dòng lỗi đầu tiên.`);
        if (go) goToPreviewIssue("blocking", "first");
      } else {
        alert("Không có dòng nào cần duyệt hàng loạt.");
      }
      return;
    }
    const ok = confirm(`Duyệt ${counts.warningOnly} dòng chỉ có cảnh báo nhẹ?

${counts.blocking ? `${counts.blocking} dòng lỗi nặng vẫn sẽ được giữ lại để bạn Sửa/Xóa, không duyệt tự động.` : ""}`);
    if (!ok) return;
    setParsed(prev => {
      const rowsToLearn = prev.filter(isWarningOnlyProduct);
      const next = prev.map((p) => {
        if (!isWarningOnlyProduct(p)) return p;
        return {
          ...p,
          _meta: {
            ...(p._meta || {}),
            issues: [],
            status: "new",
            canonicalStatus: "auto_approved",
            confidence: Math.max(Number(p._meta?.confidence || 0), 0.9),
            userApproved: true,
            userApprovedAll: true,
          }
        };
      });
      learnFromProducts(rowsToLearn, { userApprovedAll: true });
      rebuildImportResultFromParsed(next, "user-approved-light-warnings");
      return next;
    });
  };

  const removePreviewRow = (index) => {
    setParsed(prev => {
      const next = prev.filter((_, i) => i !== index);
      rebuildImportResultFromParsed(next, "user-edited-preview");
      return next;
    });
    if (editingIndex === index) {
      setEditingIndex(null);
      setEditingDraft(null);
    }
  };

  const startEditPreviewRow = (index) => {
    setEditingIndex(index);
    setEditingDraft({ ...(parsed[index] || {}) });
  };

  const parseEditedPrice = (value) => {
    const n = parseSafePrice(value);
    return Number.isFinite(n) ? n : 0;
  };

  const saveEditedPreviewRow = () => {
    if (editingIndex == null || !editingDraft) return;
    const edited = {
      ...editingDraft,
      name: String(editingDraft.name || "").trim(),
      sku: String(editingDraft.sku || "").trim(),
      category: String(editingDraft.category || "Chung").trim() || "Chung",
      supplier: String(editingDraft.supplier || "").trim(),
      unit: String(editingDraft.unit || "Cái").trim() || "Cái",
      costPrice: parseEditedPrice(editingDraft.costPrice),
      listPrice: parseEditedPrice(editingDraft.listPrice || editingDraft.publicPrice),
      publicPrice: parseEditedPrice(editingDraft.listPrice || editingDraft.publicPrice),
      minRetailPrice: parseEditedPrice(editingDraft.minRetailPrice),
      priceMode: parseEditedPrice(editingDraft.listPrice || editingDraft.publicPrice) > 0 ? "fixed" : (editingDraft.priceMode || "markup"),
      specs: String(editingDraft.specs || "").trim(),
      image: String(editingDraft.image || "").trim(),
      _meta: {
        ...(editingDraft._meta || {}),
        issues: [],
        status: "new",
        canonicalStatus: "auto_approved",
        confidence: 0.92,
        userEdited: true,
      }
    };
    if (!edited.name) {
      alert("Tên sản phẩm không được để trống.");
      return;
    }
    setParsed(prev => {
      const next = prev.map((p, i) => i === editingIndex ? edited : p);
      saveProductLearning(edited, { fileName: file?.name || "", detectedIndustry: importResult?.detectedIndustry || "catalog", userEdited: true });
      refreshLearningStats();
      setLearningNotice("✓ Đã học từ dòng bạn vừa sửa");
      rebuildImportResultFromParsed(next, "user-edited-preview");
      return next;
    });
    setEditingIndex(null);
    setEditingDraft(null);
  };

  const applyImport = () => {
    const cleaned = sanitizeCatalogProducts(parsed);
    const unsafe = cleaned.filter(isUnsafeImportedProduct);
    const safeItems = cleaned.filter(p => !isUnsafeImportedProduct(p));

    if (unsafe.length > 0) {
      const sample = unsafe.slice(0, 5).map(p => `• ${p.name || "(thiếu tên)"}: ${(p._meta?.issues || []).map(i => i.message || i).slice(0, 2).join(", ")}`).join("\n");
      const ok = confirm(
        `Có ${unsafe.length} dòng cần kiểm tra nên SmartQuote sẽ KHÔNG nhập vào catalog ngay.\n\n${sample}${unsafe.length > 5 ? "\n..." : ""}\n\nBấm OK để chỉ nhập ${safeItems.length} dòng sạch. Bấm Cancel để quay lại preview và sửa/xóa dòng lỗi.`
      );
      if (!ok) {
        setParsed(cleaned);
        setImportResult(productsToImportPreviewResult({ products: cleaned, fileName: file?.name || "import", engine: "sanitized-preview" }));
        return;
      }
    }

    const finalItems = safeItems;
    if (!finalItems.length) {
      alert("Không có dòng đủ sạch để nhập. Hãy sửa file nguồn hoặc import Excel thay vì PDF.");
      setParsed(cleaned);
      setImportResult(productsToImportPreviewResult({ products: cleaned, fileName: file?.name || "import", engine: "sanitized-preview" }));
      return;
    }

    const learnedCount = learnFromProducts(finalItems, { acceptedAtMerge: true });
    if (learnedCount > 0) setLearningNotice(`✓ Đã học ${learnedCount} dòng để lần sau đọc nhanh hơn`);

    if (mergeMode === "replace") {
      setProducts(finalItems);
    } else {
      // Merge: giữ cũ, cập nhật nếu trùng SKU, thêm mới nếu chưa có
      setProducts((prev) => {
        const skuMap = {};
        prev.forEach(p => { if (p.sku) skuMap[p.sku.toLowerCase()] = p.id; });
        const updated = [...prev];
        finalItems.forEach(np => {
          const key = (np.sku || "").toLowerCase();
          const existId = key ? skuMap[key] : null;
          if (existId) {
            // Cập nhật giá và thông số, giữ ảnh cũ
            const idx = updated.findIndex(p => p.id === existId);
            if (idx >= 0) updated[idx] = {
              ...updated[idx],
              costPrice: np.costPrice || updated[idx].costPrice,
              listPrice: np.listPrice || updated[idx].listPrice || 0,
              publicPrice: np.publicPrice || np.listPrice || updated[idx].publicPrice || 0,
              minRetailPrice: np.minRetailPrice || updated[idx].minRetailPrice || 0,
              priceMode: (np.listPrice || np.publicPrice) ? "fixed" : (updated[idx].priceMode || np.priceMode || "markup"),
              specs: np.specs || updated[idx].specs,
              image: updated[idx].image || np.image || "",
              category: np.category || updated[idx].category,
              supplier: np.supplier || updated[idx].supplier,
              unit: np.unit || updated[idx].unit,
            };
          } else {
            const newId = uid("p");
            updated.push({ ...np, id: newId, priceMode: (np.listPrice || np.publicPrice) ? "fixed" : (np.priceMode || "markup") });
            if (np.sku) skuMap[np.sku.toLowerCase()] = newId;
          }
        });
        return updated;
      });
    }
    setParsed(finalItems);
    setStep("done");
  };

  const statusLabel = (status) => ({
    auto_approved: "Tự duyệt",
    need_review: "Cần kiểm tra",
    failed: "Lỗi",
    skipped: "Bỏ qua",
    matched: "Đã khớp",
    new: "Mới",
    review: "Cần xem",
    rejected: "Loại",
  }[status] || status || "—");
  const statusClass = (status) => ({
    auto_approved: "ok",
    need_review: "warn",
    failed: "err",
    skipped: "muted",
  }[status] || "");

  // Drag & drop handlers
  const onDragOver  = (e) => { e.preventDefault(); setDragging(true); };
  const onDragLeave = ()  => setDragging(false);
  const onDrop      = async (e) => {
    e.preventDefault();
    setDragging(false);
    // Thu thập file từ folder hoặc nhiều file
    const files = [];
    const items = e.dataTransfer.items;
    if (items && items.length && items[0].webkitGetAsEntry) {
      const traverse = async (entry) => {
        if (entry.isFile) {
          await new Promise(res => entry.file(f => { files.push(f); res(); }));
        } else if (entry.isDirectory) {
          const reader = entry.createReader();
          await new Promise(res => reader.readEntries(async (entries) => {
            for (const en of entries) await traverse(en);
            res();
          }));
        }
      };
      for (const item of items) {
        const entry = item.webkitGetAsEntry?.();
        if (entry) await traverse(entry);
      }
    }
    if (!files.length) Array.from(e.dataTransfer.files).forEach(f => files.push(f));

    const valid = files.filter(f => /\.(xlsx|xls|pdf)$/i.test(f.name));
    if (valid.length === 1) handleFile(valid[0]);
    else if (valid.length > 1) handleMultipleFiles(valid);
    else alert("Không tìm thấy file Excel/PDF nào.");
  };

  return (
    <div className="ci-overlay" onClick={(e) => e.target.className === "ci-overlay" && onClose()}>
      <div className="ci-modal">
        <div className="ci-head">
          <div>
            <h2 className="ci-title">📥 Import catalog sản phẩm</h2>
            <p className="ci-sub">Hỗ trợ mọi ngành — nội thất, điện lạnh, smarthome, vệ sinh...</p>
          </div>
          <button className="ci-close" onClick={onClose}>✕</button>
        </div>

        {/* BƯỚC 1: DROP */}
        {step === "drop" && (
          <div
            className={`ci-drop${dragging ? " ci-dragging" : ""}`}
            onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
          >
            <div className="ci-drop-icon">📂</div>
            <div className="ci-drop-title">Kéo thả nhiều file hoặc cả folder vào đây</div>
            <div className="ci-drop-sub">Hỗ trợ <strong>Excel (.xlsx/.xls)</strong> và <strong>PDF</strong> — import nhiều bảng giá cùng lúc</div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 14 }}>
              <label htmlFor="ci-catalog-files" className="btn-primary" style={{ width: "auto", cursor: "pointer", display: "inline-flex", alignItems: "center" }}>
                📄 Chọn nhiều file
              </label>
              <label htmlFor="ci-catalog-folder" className="btn-ghost" style={{ cursor: "pointer", display: "inline-flex", alignItems: "center" }}>
                📁 Chọn cả folder
              </label>
            </div>
            <div className="ci-drop-examples" style={{ marginTop: 14 }}>
              <span>✓ Bảng giá Lumi.xlsx</span>
              <span>✓ Catalog Bisco.pdf</span>
              <span>✓ Giá Roger 2026.xlsx</span>
            </div>

            <div className="ci-web-import-box" onClick={(e) => e.stopPropagation()}>
              <div className="ci-web-import-title">🌐 Cào danh sách sản phẩm từ web</div>
              <div className="ci-web-import-row">
                <input
                  type="url"
                  placeholder="Dán URL trang danh mục / trang sản phẩm"
                  value={webUrl}
                  onChange={(e) => setWebUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleWebImport(); }}
                />
                <input
                  type="text"
                  placeholder="NCC/Brand (tuỳ chọn)"
                  value={webSupplier}
                  onChange={(e) => setWebSupplier(e.target.value)}
                />
                <button type="button" className="btn-primary" style={{ width: "auto" }} disabled={webImporting} onClick={handleWebImport}>
                  {webImporting ? "Đang cào..." : "Cào web"}
                </button>
              </div>
              <div className="ci-web-import-sub">Ưu tiên đọc schema.org/JSON-LD, sau đó dò card sản phẩm trong HTML. Kết quả vẫn qua preview để bạn sửa/xóa trước khi merge.</div>
              {webStatus && <div className="ci-web-import-status">{webStatus}</div>}
            </div>
            <input id="ci-catalog-files" type="file" accept=".xlsx,.xls,.pdf" multiple
              style={{ opacity:0, position:"absolute", width:0, height:0 }}
              onChange={(e) => { if (e.target.files.length === 1) handleFile(e.target.files[0]); else if (e.target.files.length > 1) handleMultipleFiles(e.target.files); }} />
            <input id="ci-catalog-folder" type="file" webkitdirectory="" multiple
              style={{ opacity:0, position:"absolute", width:0, height:0 }}
              onChange={(e) => handleMultipleFiles(e.target.files)} />
            {/* LỚP 1: gợi ý ưu tiên Excel */}
            <div className="ci-tip-excel">
              💡 <strong>Mẹo:</strong> File <strong>Excel xử lý miễn phí & nhanh hơn</strong>. PDF cần AI đọc (có giới hạn {getQuota().pdfCount}/{PDF_QUOTA_LIMIT} lượt tháng này). Nếu nhà cung cấp có cả 2, hãy chọn Excel.
            </div>
          </div>
        )}

        {/* BƯỚC 2: MAPPING CỘT (1 file) hoặc BATCH LOG (nhiều file) */}
        {step === "mapping" && batchMode && (
          <div className="ci-body">
            <div className="ci-ai-status">{aiStatus}</div>
            <div className="ci-batch-log">
              {batchLog.map((line, i) => (
                <div key={i} className={`ci-batch-line${line.startsWith("✓") ? " ok" : line.startsWith("✗") ? " err" : ""}`}>{line}</div>
              ))}
            </div>
            {cacheHits > 0 && (
              <div className="ci-cache-note">⚡ {cacheHits} file lấy từ bộ nhớ đệm (không tốn AI)</div>
            )}
          </div>
        )}
        {step === "mapping" && !batchMode && (
          <div className="ci-body">
            <div className="ci-file-badge">📄 {file?.name} · {rawRows.length} dòng dữ liệu</div>
            {aiStatus && <div className={`ci-ai-status${aiStatus.startsWith("✓") ? " ok" : ""}`}>{aiStatus}</div>}
            {templateNotice && <div className="ci-template-note">{templateNotice}</div>}
            <p className="ci-hint">Kiểm tra AI đã nhận diện đúng cột chưa, chỉnh nếu cần:</p>
            {(templateSuggestions.length > 0 || templateLibrary.length > 0) && (
              <div className="ci-template-library">
                <div className="ci-template-library-title">📚 Supplier Template Library</div>
                <div className="ci-template-library-row">
                  <select value={selectedTemplateKey} onChange={(e) => setSelectedTemplateKey(e.target.value)}>
                    <option value="">— Chọn template đã lưu —</option>
                    {(templateSuggestions.length ? templateSuggestions : templateLibrary.slice(0, 8)).map((tpl) => (
                      <option key={tpl.key} value={tpl.key}>
                        {(tpl.name || tpl.fileName || "Template")} {tpl.matchScore ? `· match ${Math.round(tpl.matchScore * 100)}%` : ""}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="btn-ghost" onClick={applySelectedTemplate}>Áp dụng template</button>
                  <button type="button" className="btn-ghost danger" onClick={deleteSelectedTemplate}>Xóa template</button>
                </div>
                <div className="ci-template-library-sub">SmartQuote sẽ dùng lại mapping cột + khoảng dòng cho nhà cung cấp/file cùng format.</div>
              </div>
            )}
            <div className="ci-row-range-box">
              <div className="ci-row-range-title">Khoảng dòng cần import</div>
              <label>Dòng bắt đầu
                <input type="number" min="1" max={rawRows.length || 1} value={manualStartRow}
                  onChange={(e) => setManualStartRow(e.target.value)} />
              </label>
              <label>Dòng kết thúc
                <input type="number" min="1" max={rawRows.length || 1} placeholder={`Tới cuối (${rawRows.length})`} value={manualEndRow}
                  onChange={(e) => setManualEndRow(e.target.value)} />
              </label>
              <span>{getManualSelectedRows().rows.length} / {rawRows.length} dòng sẽ được xem trước</span>
            </div>
            <div className="ci-map-grid">
              {FIELDS.map(f => (
                <div key={f.key} className="ci-map-row">
                  <label className="ci-map-label">
                    {f.label}{f.required && <span className="ci-req">*</span>}
                  </label>
                  <select
                    className={`ci-map-select${!colMap[f.key] && f.required ? " ci-select-err" : ""}`}
                    value={colMap[f.key] ?? ""}
                    onChange={(e) => setColMap(c => ({ ...c, [f.key]: e.target.value }))}
                  >
                    <option value="">— Không có —</option>
                    {headers.map(h => (
                      <option key={h.idx} value={String(h.idx)}>{h.label}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            {/* Preview 3 dòng đầu */}
            {rawRows.length > 0 && colMap.name && (
              <div className="ci-preview-mini">
                <div className="ci-preview-title">Xem trước 3 dòng đầu:</div>
                <table className="ci-preview-table">
                  <thead><tr>
                    {FIELDS.filter(f => colMap[f.key]).map(f => <th key={f.key}>{f.label}</th>)}
                  </tr></thead>
                  <tbody>
                    {getManualSelectedRows().rows.slice(0,3).map((row, i) => (
                      <tr key={i}>
                        {FIELDS.filter(f => colMap[f.key]).map(f => (
                          <td key={f.key}>{String(row[parseInt(colMap[f.key])] ?? "").slice(0, 40)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="ci-footer">
              <button className="btn-ghost" onClick={() => { setStep("drop"); setFile(null); }}>← Chọn file khác</button>
              <div className="ci-footer-actions">
                <button className="btn-ghost" type="button" onClick={saveCurrentMappingTemplate}>💾 Lưu template mapping</button>
                <button className="btn-primary" style={{ width: "auto" }} onClick={buildPreview}
                  disabled={!colMap.name && !colMap.sku}>
                  Tiếp theo — Xem trước {getManualSelectedRows().rows.length} dòng →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* BƯỚC 3: PREVIEW & CONFIRM */}
        {step === "preview" && (
          <div className="ci-body">
            {(() => {
              const c = getPreviewCounts(parsed);
              const hasBlocking = c.blocking > 0;
              const hasReview = c.warningOnly > 0;
              const readyCount = c.clean;
              const skippedCount = c.skipped;
              const title = hasBlocking
                ? `Có ${c.blocking} lỗi cần xử lý`
                : hasReview
                  ? `Cần xem lại ${c.warningOnly} dòng`
                  : `Đã sẵn sàng nhập`;
              const tone = hasBlocking ? "danger" : hasReview ? "warn" : "ok";
              const defaultAction = hasBlocking
                ? { label: `Đi tới lỗi đầu tiên`, onClick: () => goToPreviewIssue("blocking", "first") }
                : hasReview
                  ? { label: `Duyệt ${c.warningOnly} dòng an toàn`, onClick: approveAllPreviewRows }
                  : { label: `Nhập ${readyCount} sản phẩm`, onClick: applyImport };
              return (
                <div className={`ci-import-hero ${tone}`}>
                  <div className="ci-import-hero-main">
                    <div className="ci-import-hero-kicker">Preview import</div>
                    <h3>{title}</h3>
                    <p>
                      <strong>{readyCount}</strong> sản phẩm sẵn sàng nhập · <strong>{c.warningOnly}</strong> cần xem lại · <strong>{skippedCount}</strong> dòng đã bỏ qua
                    </p>
                  </div>
                  <div className="ci-import-hero-actions">
                    {hasReview && !hasBlocking && <button type="button" className="btn-ghost" onClick={() => setPreviewFilter("review")}>Xem dòng cần duyệt</button>}
                    {hasReview && hasBlocking && <button type="button" className="btn-ghost" onClick={() => goToPreviewIssue("review", "first")}>Xem dòng cần xem</button>}
                    <button type="button" className={`ci-primary-action ${tone}`} onClick={defaultAction.onClick}>{defaultAction.label}</button>
                  </div>
                </div>
              );
            })()}

            <details className="ci-processing-details">
              <summary>Chi tiết xử lý</summary>
              <div className="ci-detail-grid">
                <div><span>Engine</span><strong>{importResult?.engine || "—"}</strong></div>
                <div><span>Ngành</span><strong>{importResult?.detectedIndustry || "unknown"}</strong></div>
                <div><span>Confidence</span><strong>{Math.round((importResult?.overallConfidence || 0) * 100)}%</strong></div>
                <div><span>Template</span><strong>{importResult?.templateKnown ? "đã nhớ" : (importResult?.detectedTemplateId ? "mới" : "—")}</strong></div>
                <div><span>Đã học</span><strong>{learningStats ? `${learningStats.skuRules} SKU · ${learningStats.rawRules} raw · ${learningStats.supplierProfiles} NCC` : "—"}</strong></div>
                <div><span>Nguồn</span><strong>{file?.name || "import"}</strong></div>
              </div>
              {learningNotice && <div className="ci-learning-note compact">{learningNotice}</div>}
              {(importResult?.warnings || []).length > 0 && (
                <div className="ci-warnings compact">{importResult.warnings.slice(0, 3).map((w, i) => <div key={i}>⚠️ {w}</div>)}</div>
              )}
            </details>

            <div className="ci-import-controls">
              <div className="ci-merge-choice">
                <span>Xử lý catalog</span>
                <label className="ci-radio"><input type="radio" value="merge" checked={mergeMode==="merge"} onChange={()=>setMergeMode("merge")} /> Merge</label>
                <label className="ci-radio"><input type="radio" value="replace" checked={mergeMode==="replace"} onChange={()=>setMergeMode("replace")} /> Thay thế ({products.length} SP)</label>
              </div>
              <div className="ci-control-actions">
                {headers.length > 0 && <button type="button" className="ghost" onClick={saveCurrentMappingTemplate}>Lưu template</button>}
                <button type="button" className="ghost" onClick={openManualMapping}>Sửa mapping</button>
              </div>
            </div>

            <div className="ci-preview-tabs">
              {[
                ["all", `Tất cả`, previewFilterCounts.all],
                ["review", `Cần xem lại`, previewFilterCounts.review],
                ["clean", `Sạch`, previewFilterCounts.clean],
                ["blocking", `Lỗi`, previewFilterCounts.blocking],
                ["approved", `Đã duyệt/sửa`, previewFilterCounts.approved],
              ].map(([key, label, count]) => (
                <button key={key} type="button" className={`${previewFilter === key ? "active" : ""} ${key === "blocking" && count > 0 ? "danger" : ""}`} onClick={() => {
                  setPreviewFilter(key);
                  if (key === "blocking" && firstBlockingRow) scrollToPreviewIndex(firstBlockingRow.index);
                  if (key === "review" && firstReviewRow) scrollToPreviewIndex(firstReviewRow.index);
                }}>{label} <span>{count}</span></button>
              ))}
              <div className="ci-tab-spacer" />
              {firstBlockingRow && <button type="button" className="ci-mini-danger" onClick={() => goToPreviewIssue("blocking", "first")}>Đi tới lỗi</button>}
              {getPreviewCounts(parsed).warningOnly > 0 && <button type="button" className="ci-mini-ok" onClick={approveAllPreviewRows}>Duyệt dòng an toàn</button>}
            </div>

            {importResult?.summary?.needReview > 0 && (
              <div className="ci-review-copy">
                Dòng vàng là các dòng SmartQuote chưa chắc chắn. Bạn có thể <strong>Sửa</strong>, <strong>Duyệt</strong> hoặc <strong>Xóa</strong> ngay trong app.
              </div>
            )}

            <div className="ci-preview-scroll compact">
              <table className="ci-preview-table ci-preview-table-clean">
                <thead><tr><th style={{width:54}}>TT</th><th style={{width:72}}>Ảnh</th><th>Sản phẩm</th><th style={{width:140}}>Mã</th><th style={{width:160}}>Giá</th><th>Vấn đề</th><th style={{width:130}}>Thao tác</th></tr></thead>
                <tbody>
                  {getFilteredPreviewRows().map(({ p, index: i, line }) => {
                    const issues = line?.issues || p._meta?.issues || [];
                    const status = line?.status || p._meta?.status || "auto_approved";
                    const statusCls = statusClass(status);
                    const source = line?.source?.sheet ? `${line.source.sheet} · dòng ${line.source.row}` : (line?.source?.page ? `PDF trang ${line.source.page}` : "");
                    return (
                    <tr key={p?._meta?.lineId || line?.lineId || i} data-preview-index={i} className={`${highlightedPreviewIndex === i ? "ci-row-focus" : ""} ${isBlockingPreviewRow(p, i) ? "ci-row-blocking" : isReviewPreviewRow(p, i) ? "ci-row-review" : ""}`}>
                      <td className="ci-row-num"><span>{i+1}</span><span className={`ci-dot ${statusCls}`}></span></td>
                      <td>
                        {p.image
                          ? <ImgWithFallback src={p.image} alt={p.name || ""} style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)", background: "#fff" }} />
                          : <span className="muted">—</span>}
                      </td>
                      <td className="ci-product-cell">
                        <div className="ci-product-name">{p.name || "(thiếu tên)"}</div>
                        <div className="ci-product-meta">
                          {[p.category, p.unit, p.supplier].filter(Boolean).join(" · ")}
                          {source && <span> · {source}</span>}
                        </div>
                      </td>
                      <td className="ci-sku-cell">{p.sku || "—"}</td>
                      <td className="ci-price-cell">
                        <div>{p.costPrice > 0 ? p.costPrice.toLocaleString("vi-VN")+"đ" : "—"}</div>
                        {p.listPrice > 0 && <small>Công bố: {p.listPrice.toLocaleString("vi-VN")}đ</small>}
                      </td>
                      <td className="ci-issues clean">{issues.length ? issues.slice(0,2).map((it, k) => <div key={k}>• {it.message || it}</div>) : "—"}</td>
                      <td>
                        <div className="ci-row-actions clean">
                          <button type="button" onClick={() => startEditPreviewRow(i)}>{isBlockingPreviewRow(p, i) ? "Sửa lỗi" : "Sửa"}</button>
                          {issues.length > 0 && !isBlockingPreviewRow(p, i) && <button type="button" onClick={() => approvePreviewRow(i)}>Duyệt</button>}
                          <button type="button" className="danger" onClick={() => removePreviewRow(i)}>Xóa</button>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
              {getFilteredPreviewRows().length === 0 && <div className="ci-more">Không có dòng nào trong bộ lọc này.</div>}
              {getFilteredPreviewRows().length < parsed.length && <div className="ci-more">Đang hiển thị {getFilteredPreviewRows().length}/{parsed.length} dòng theo bộ lọc.</div>}
            </div>
            {editingDraft && (
              <div className="ci-edit-panel">
                <div className="ci-edit-title">Sửa dòng #{(editingIndex ?? 0) + 1}</div>
                <div className="ci-edit-grid">
                  <label>Tên sản phẩm<input value={editingDraft.name || ""} onChange={(e)=>setEditingDraft(d=>({...d, name:e.target.value}))} /></label>
                  <label>Mã SKU<input value={editingDraft.sku || ""} onChange={(e)=>setEditingDraft(d=>({...d, sku:e.target.value}))} /></label>
                  <label>Nhóm<input value={editingDraft.category || ""} onChange={(e)=>setEditingDraft(d=>({...d, category:e.target.value}))} /></label>
                  <label>Nhà cung cấp<input value={editingDraft.supplier || ""} onChange={(e)=>setEditingDraft(d=>({...d, supplier:e.target.value}))} /></label>
                  <label>ĐVT<input value={editingDraft.unit || ""} onChange={(e)=>setEditingDraft(d=>({...d, unit:e.target.value}))} /></label>
                  <label>Giá nhập<input value={editingDraft.costPrice || ""} onChange={(e)=>setEditingDraft(d=>({...d, costPrice:e.target.value}))} /></label>
                  <label>Giá công bố<input value={editingDraft.listPrice || ""} onChange={(e)=>setEditingDraft(d=>({...d, listPrice:e.target.value, publicPrice:e.target.value}))} /></label>
                  <label>Ảnh URL<input value={editingDraft.image || ""} onChange={(e)=>setEditingDraft(d=>({...d, image:e.target.value}))} /></label>
                </div>
                {editingDraft.image && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "8px 0 0" }}>
                    <ImgWithFallback src={editingDraft.image} alt={editingDraft.name || ""} style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)", background: "#fff" }} />
                    <span className="muted" style={{ fontSize: 12 }}>Preview ảnh lấy từ web</span>
                  </div>
                )}
                <label className="ci-edit-specs">Thông số / mô tả<textarea value={editingDraft.specs || ""} onChange={(e)=>setEditingDraft(d=>({...d, specs:e.target.value}))} /></label>
                <div className="ci-edit-actions">
                  <button className="btn-ghost" type="button" onClick={() => { setEditingIndex(null); setEditingDraft(null); }}>Hủy</button>
                  <button className="btn-primary" type="button" style={{ width: "auto" }} onClick={saveEditedPreviewRow}>Lưu dòng này</button>
                </div>
              </div>
            )}

            <div className="ci-footer">
              <button className="btn-ghost" onClick={openManualMapping}>← Sửa mapping</button>
              <div className="ci-footer-actions">
                {importResult?.summary?.needReview > 0 && (
                  <button className="btn-ghost btn-approve-all-footer" type="button" onClick={approveAllPreviewRows}>✓ Duyệt cảnh báo nhẹ</button>
                )}
                {firstBlockingRow && <button className="btn-ghost" type="button" onClick={() => goToPreviewIssue("blocking", "first")}>Đi tới lỗi</button>}
                <button className="btn-primary" style={{ width: "auto", background: "var(--brand)" }} onClick={applyImport}>
                  ✓ {mergeMode === "replace" ? "Thay thế" : "Merge"} {getPreviewCounts(parsed).clean} sản phẩm sạch vào catalog
                </button>
              </div>
            </div>
          </div>
        )}

        {/* BƯỚC 4: DONE + tùy chọn import ảnh */}
        {step === "done" && (
          <div className="ci-body" style={{ textAlign: "center", padding: "32px 20px" }}>
            <div style={{ fontSize: 48 }}>✅</div>
            <h3 style={{ margin: "16px 0 8px", fontSize: 18 }}>Import thành công!</h3>
            <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 24 }}>
              {mergeMode === "replace" ? `Đã thay thế catalog bằng ${parsed.length} sản phẩm.` : `Đã thêm/cập nhật ${parsed.length} sản phẩm vào catalog.`}
            </p>

            {/* Import ảnh từ folder */}
            <div className="ci-img-import-box">
              <div className="ci-img-import-title">📁 Thêm ảnh sản phẩm (tuỳ chọn)</div>
              <p className="ci-img-import-sub">
                Kéo thả <strong>thư mục ảnh</strong> hoặc chọn nhiều file ảnh vào đây.<br/>
                App tự ghép theo tên file = mã SKU. Ví dụ: <code>LM-S1N.jpg</code> → sản phẩm SKU <code>LM-S1N/S</code>
              </p>
              <div
                className={`ci-img-drop${imgDragging ? " ci-dragging" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => imgFilesInputRef.current?.click()}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); imgFilesInputRef.current?.click(); } }}
                onDragOver={(e) => { e.preventDefault(); setImgDragging(true); }}
                onDragLeave={() => setImgDragging(false)}
                onDrop={handleImgDrop}
              >
                <span style={{ fontSize: 28 }}>🖼</span>
                <span style={{ fontWeight: 500 }}>Kéo thả folder hoặc file ảnh vào đây</span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>JPG, PNG, WebP — tên file = mã SKU sản phẩm</span>
                <div style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "center", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ fontSize: 12, padding: "5px 12px", cursor: "pointer" }}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); imgFilesInputRef.current?.click(); }}
                  >
                    📄 Chọn nhiều file ảnh
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ fontSize: 12, padding: "5px 12px", cursor: "pointer" }}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); imgFolderInputRef.current?.click(); }}
                  >
                    📁 Chọn cả folder
                  </button>
                </div>
              </div>
              <input
                ref={imgFilesInputRef}
                id="ci-files-input"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/jpg"
                multiple
                style={{ display: "none" }}
                onChange={handleImgFiles}
              />
              <input
                ref={imgFolderInputRef}
                id="ci-folder-input"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/jpg"
                webkitdirectory="true"
                directory="true"
                multiple
                style={{ display: "none" }}
                onChange={handleImgFiles}
              />
              {imgStatus && <div className="ci-img-status">{imgStatus}</div>}
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 20 }}>
              <button className="btn-primary" style={{ width: "auto" }} onClick={onClose}>Xem catalog →</button>
                      <button className="btn-ghost" onClick={() => { setStep("drop"); setFile(null); setParsed([]); setImportResult(null); setImgStatus(""); setWebStatus(""); }}>Import thêm nguồn khác</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Catalog({ products, setProducts, company }) {
  const [q, setQ] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [editing, setEditing] = useState(null);
  const [bulk, setBulk] = useState({ supplier: "", percent: "" });
  const [bulkError, setBulkError] = useState("");
  const [importPreview, setImportPreview] = useState(null);
  const [autoImg, setAutoImg] = useState({ running: false, done: 0, total: 0, errors: 0, log: "" });
  const importRef = useRef();

  const suppliers = useMemo(() => [...new Set(products.map((p) => p.supplier).filter(Boolean))], [products]);

  const parseBulkPercent = (value) => {
    const text = String(value || "")
      .trim()
      .replace(/%/g, "")
      .replace(/,/g, ".");
    if (!text) return NaN;
    if (!/^-?\d+(?:\.\d+)?$/.test(text)) return NaN;
    return Number(text);
  };

  const bulkPct = parseBulkPercent(bulk.percent);
  const bulkAffectedCount = bulk.supplier
    ? products.filter((p) => p.supplier === bulk.supplier).length
    : 0;

  const filtered = products.filter((p) => {
    const matchQ = p.name.toLowerCase().includes(q.toLowerCase()) || (p.sku || "").toLowerCase().includes(q.toLowerCase());
    const matchS = !supplierFilter || p.supplier === supplierFilter;
    return matchQ && matchS;
  });

  const saveProduct = (prod) => {
    if (prod.id) setProducts((ps) => ps.map((p) => (p.id === prod.id ? prod : p)));
    else setProducts((ps) => [...ps, { ...prod, id: uid("p") }]);
    setEditing(null);
  };

  const deleteProduct = (id) => {
    if (confirm("Xóa thiết bị này khỏi bảng giá?")) setProducts((ps) => ps.filter((p) => p.id !== id));
  };

  const clearAllProducts = () => {
    const total = products.length;
    if (!total) {
      alert("Danh mục đã trống — không có sản phẩm để xóa.");
      return;
    }

    const firstConfirm = confirm(
      `XÓA TOÀN BỘ ${total} sản phẩm khỏi Danh mục?\n\n` +
      "Thao tác này chỉ xóa danh sách sản phẩm hiện tại. Template mapping, correction learning và cài đặt vẫn được giữ.\n" +
      "Các báo giá/gói cũ có thể hiển thị sản phẩm là 'đã xóa' nếu đang tham chiếu tới catalog này.\n\n" +
      "Nên tải file sao lưu ở tab Cài đặt trước nếu đây là dữ liệu thật. Tiếp tục?"
    );
    if (!firstConfirm) return;

    const confirmText = `XOA ${total}`;
    const typed = prompt(
      `Để xác nhận xóa ${total} sản phẩm, nhập chính xác:\n\n${confirmText}`
    );
    if ((typed || "").trim().toUpperCase() !== confirmText) {
      alert("Đã hủy xóa toàn bộ danh mục.");
      return;
    }

    try {
      localStorage.setItem("sq_products_backup_before_clear", JSON.stringify({
        clearedAt: new Date().toISOString(),
        count: total,
        products,
      }));
    } catch (e) {
      console.warn("Không lưu được backup tạm trước khi xóa catalog:", e);
    }

    setProducts([]);
    setQ("");
    setSupplierFilter("");
    setEditing(null);
    setImportPreview(null);
    setAutoImg({ running: false, done: 0, total: 0, errors: 0, log: "" });
    alert(`Đã xóa ${total} sản phẩm khỏi Danh mục.`);
  };

  // Tăng/giảm giá hàng loạt theo nhà cung cấp — giải quyết "nhà cung cấp đổi giá nhập"
  const applyBulk = () => {
    const pct = parseBulkPercent(bulk.percent);
    setBulkError("");

    if (!bulk.supplier) {
      setBulkError("Chọn nhà cung cấp cần cập nhật giá.");
      return;
    }
    if (!bulkAffectedCount) {
      setBulkError(`Không tìm thấy sản phẩm nào của nhà cung cấp "${bulk.supplier}".`);
      return;
    }
    if (Number.isNaN(pct)) {
      setBulkError("Nhập % thay đổi dạng số, ví dụ 5, -3 hoặc 2.5.");
      return;
    }
    if (pct <= -100) {
      setBulkError("% giảm không thể nhỏ hơn hoặc bằng -100%.");
      return;
    }

    const direction = pct >= 0 ? `tăng ${pct}%` : `giảm ${Math.abs(pct)}%`;
    if (!confirm(`Điều chỉnh giá nhập của ${bulkAffectedCount} thiết bị từ "${bulk.supplier}" — ${direction}?`)) return;

    setProducts((ps) =>
      ps.map((p) =>
        p.supplier === bulk.supplier
          ? { ...p, costPrice: Math.round((p.costPrice || 0) * (1 + pct / 100)) }
          : p
      )
    );
    setBulk({ supplier: "", percent: "" });
    setBulkError("");
  };

  // ---- Tự động tìm ảnh qua Serper.dev (2500 lượt miễn phí, đơn giản hơn Google) ----
  // Dọn dẹp catalog: phát hiện & xóa dòng điều khoản/ghi chú nhập nhầm
  const cleanupCatalog = () => {
    const isJunk = (p) => {
      const name = (p.name || "").trim();
      const hasPrice = (p.costPrice || 0) > 0;
      const hasSku = !!(p.sku || "").trim();
      // Dòng rác: bắt đầu bằng gạch đầu dòng/số điều khoản
      if (/^[\-•*+]/.test(name) || /^\d+[\.\)]\s/.test(name)) return true;
      // Chứa từ khóa điều khoản (và không có giá+mã)
      if (!hasPrice && !hasSku &&
          /miễn phí|vận chuyển|lắp đặt tại|bảo hành|chính sách|thanh toán|giao hàng|chuyển khoản|đổi trả|thay thế vô điều kiện|báo giá có|thời hạn|có hiệu lực|cảm ơn|trân trọng|kính gửi|ghi chú|lưu ý|điều kiện|cam kết|chiết khấu|hotline|liên hệ|website|địa chỉ/i.test(name)) return true;
      // Câu quá dài không mã không giá
      if (name.length > 80 && !hasPrice && !hasSku) return true;
      return false;
    };
    const junk = products.filter(isJunk);
    if (junk.length === 0) {
      alert("Catalog sạch — không tìm thấy dòng rác nào.");
      return;
    }
    const preview = junk.slice(0, 5).map(p => `• ${p.name.slice(0, 50)}`).join("\n");
    const more = junk.length > 5 ? `\n... và ${junk.length - 5} dòng khác` : "";
    if (confirm(`Tìm thấy ${junk.length} dòng có vẻ là điều khoản/ghi chú (không phải sản phẩm):\n\n${preview}${more}\n\nXóa các dòng này?`)) {
      setProducts(ps => ps.filter(p => !isJunk(p)));
    }
  };

  const autoFetchImages = async () => {
    const apiKey = company?.googleApiKey?.trim();
    if (!apiKey) {
      alert("Chưa có Serper API Key.\nVào tab Cài đặt → mục Tìm ảnh tự động để điền.");
      return;
    }
    const targets = products.filter((p) => !p.image);
    if (targets.length === 0) { alert("Tất cả thiết bị đã có ảnh rồi!"); return; }

    // Test kết nối
    setAutoImg({ running: true, done: 0, total: targets.length, errors: 0, log: "Đang kiểm tra kết nối API…" });
    try {
      const testRes = await fetch("https://google.serper.dev/images", {
        method: "POST",
        headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ q: "test", num: 1 }),
      });
      const testData = await testRes.json();
      if (!testRes.ok) {
        setAutoImg({ running: false, done: 0, total: 0, errors: 1,
          log: `❌ Lỗi API (${testRes.status}): ${testData.message || "Kiểm tra lại API Key"}` });
        return;
      }
    } catch (e) {
      setAutoImg({ running: false, done: 0, total: 0, errors: 1,
        log: `❌ Không kết nối được: ${e.message}` });
      return;
    }

    if (!confirm(`API OK! Tìm ảnh cho ${targets.length} thiết bị (2.500 lượt miễn phí). Tiếp tục?`)) {
      setAutoImg({ running: false, done: 0, total: 0, errors: 0, log: "" });
      return;
    }

    setAutoImg({ running: true, done: 0, total: targets.length, errors: 0, log: "Đang tìm ảnh…" });
    let done = 0, errors = 0;

    for (const p of targets) {
      const query = `${p.name} ${p.sku || ""}`.replace(/[()]/g, " ").trim();
      try {
        const res = await fetch("https://google.serper.dev/images", {
          method: "POST",
          headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ q: query, num: 1 }),
        });
        const data = await res.json();
        const rawUrl = data?.images?.[0]?.imageUrl;
        // Bỏ qua Google thumbnail (encrypted-tbn) — không load được cross-origin
        const imgUrl = rawUrl && !rawUrl.includes("encrypted-tbn") && !rawUrl.includes("gstatic.com/images?q=tbn")
          ? rawUrl : null;
        if (imgUrl) {
          setProducts((ps) => ps.map((x) => x.id === p.id ? { ...x, image: imgUrl } : x));
          done++;
        } else {
          errors++;
        }
      } catch {
        errors++;
      }
      setAutoImg({ running: true, done, total: targets.length, errors, log: `Đang tìm: ${p.name}…` });
      await new Promise((r) => setTimeout(r, 200));
    }
    setAutoImg({ running: false, done, total: targets.length, errors,
      log: `✓ Hoàn tất! Tìm được ${done} ảnh, ${errors} thiết bị không tìm thấy ảnh.` });
  };
  const handleExcelFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const preview = await parseSupplierPriceFile(file, products);
      if (preview.error) {
        alert(preview.error);
        return;
      }
      setImportPreview(preview);
    } catch (err) {
      console.error(err);
      alert("Không đọc được file. Đảm bảo đúng định dạng Excel (.xlsx/.xls).");
    } finally {
      e.target.value = "";
    }
  };

  // Áp dụng cập nhật sau khi nhân viên xem preview và xác nhận.
  // Cập nhật giá gốc từ file NCC. Giá bán không lưu cứng nữa (tính từ hệ số) nên chỉ sửa costPrice.
  const applyImport = (preview, opts) => {
    setProducts((ps) => {
      let next = ps.map((p) => {
        const hit = preview.matched.find((m) => m.existing.id === p.id);
        if (!hit) return p;
        return { ...p, costPrice: Math.round(hit.newCost) };
      });
      if (opts.addNew) {
        const toAdd = preview.newItems.map((it) => ({
          id: uid("p"),
          name: it.name || it.sku,
          sku: it.sku,
          category: "",
          supplier: it.supplier || "",
          unit: "Cái",
          costPrice: Math.round(it.costPrice),
        }));
        next = [...next, ...toAdd];
      }
      return next;
    });
    setImportPreview(null);
  };

  const [showImporter, setShowImporter] = useState(false);
  const [imgDragging, setImgDragging] = useState(false);
  const [imgStatus, setImgStatus] = useState("");
  const imgFolderRef = useRef();

  // Import ảnh từ folder — match tên file với SKU trong catalog
  const handleImgFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    await processImgFiles(files);
    e.target.value = "";
  };

  const handleImgDrop = async (e) => {
    e.preventDefault();
    setImgDragging(false);
    const files = [];
    const traverse = async (entry) => {
      if (entry.isFile) {
        await new Promise(res => entry.file(f => { files.push(f); res(); }));
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        await new Promise(res => reader.readEntries(async (entries) => {
          for (const en of entries) await traverse(en);
          res();
        }));
      }
    };
    for (const item of e.dataTransfer.items) {
      const entry = item.webkitGetAsEntry?.();
      if (entry) await traverse(entry);
    }
    if (!files.length) {
      Array.from(e.dataTransfer.files).forEach(f => files.push(f));
    }
    await processImgFiles(files.filter(f => f.type.startsWith("image/")));
  };

  const processImgFiles = async (files) => {
    if (!files.length) return;
    setImgStatus(`Đang xử lý ${files.length} ảnh...`);
    let matched = 0;

    // Build SKU lookup — normalize: bỏ /, -, _ và lowercase
    const normalize = (s) => String(s || "").toLowerCase().replace(/[\/\-_\s\.]/g, "");
    const skuIndex = {};
    products.forEach(p => {
      if (p.sku) skuIndex[normalize(p.sku)] = p.id;
    });

    const updates = {};
    for (const file of files) {
      // Tên file không có extension
      const baseName = file.name.replace(/\.[^.]+$/, "");
      const normName = normalize(baseName);

      // Tìm match: tên file = SKU hoặc tên file chứa SKU
      let matchId = skuIndex[normName];
      if (!matchId) {
        // Thử match một phần
        for (const [key, id] of Object.entries(skuIndex)) {
          if (normName.includes(key) || key.includes(normName)) {
            matchId = id; break;
          }
        }
      }

      if (matchId) {
        // Chuyển file thành data URL
        const dataUrl = await new Promise(res => {
          const reader = new FileReader();
          reader.onload = e => res(e.target.result);
          reader.readAsDataURL(file);
        });
        updates[matchId] = dataUrl;
        matched++;
      }
    }

    if (Object.keys(updates).length > 0) {
      setProducts(ps => ps.map(p => updates[p.id] ? { ...p, image: updates[p.id] } : p));
    }
    setImgStatus(`✓ Ghép được ${matched}/${files.length} ảnh với sản phẩm trong catalog`);
  };

  return (
    <div className="catalog">
      {/* Import Catalog overlay */}
      {showImporter && (
        <CatalogImporter
          products={products}
          setProducts={setProducts}
          company={company}
          onClose={() => setShowImporter(false)}
          imgDragging={imgDragging}
          setImgDragging={setImgDragging}
          imgStatus={imgStatus}
          setImgStatus={setImgStatus}
          imgFolderRef={imgFolderRef}
          handleImgDrop={handleImgDrop}
          handleImgFiles={handleImgFiles}
        />
      )}

      <div className="cat-toolbar">
        <input className="search" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}>
          <option value="">Tất cả nhà cung cấp</option>
          {suppliers.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className="btn-primary" onClick={() => setEditing({ name: "", sku: "", category: "", supplier: "", unit: "Cái", costPrice: 0 })}>
          + Thêm
        </button>
        <button className="btn-import-catalog" onClick={() => setShowImporter(true)}>
          📥 Import catalog
        </button>
        <label htmlFor="cat-price-file" className="btn-excel" style={{ cursor:"pointer", display:"inline-flex", alignItems:"center" }}>
          ⬆ Cập nhật giá
        </label>
        <input id="cat-price-file" ref={importRef} type="file" accept=".xlsx,.xls" style={{ display:"none" }} onChange={handleExcelFile} />
        <button className="btn-img-auto" onClick={autoFetchImages} disabled={autoImg.running}>
          {autoImg.running ? `🔍 ${autoImg.done}/${autoImg.total}…` : "🔍 Tự động tìm ảnh"}
        </button>
        {/* Import ảnh: label htmlFor — cách duy nhất đáng tin để trigger file input */}
        <label htmlFor="cat-img-files" className="btn-img-auto" style={{ cursor:"pointer" }}>
          🖼 Import ảnh
        </label>
        <input id="cat-img-files" type="file" accept="image/*" multiple style={{ opacity:0, position:"absolute", width:0, height:0 }} onChange={handleImgFiles} />
        <label htmlFor="cat-img-folder" className="btn-img-auto" style={{ cursor:"pointer" }}>
          📁 Chọn folder
        </label>
        <input id="cat-img-folder" type="file" webkitdirectory="" multiple style={{ opacity:0, position:"absolute", width:0, height:0 }} onChange={handleImgFiles} />
        <button className="btn-cleanup" onClick={cleanupCatalog} title="Xóa các dòng điều khoản, ghi chú, chính sách bị nhập nhầm thành sản phẩm">
          🧹 Dọn dẹp
        </button>
        <button
          className="btn-ghost danger"
          onClick={clearAllProducts}
          disabled={products.length === 0}
          title="Xóa toàn bộ sản phẩm trong Danh mục hiện tại"
        >
          🗑 Xóa tất cả
        </button>
      </div>

      {/* Drop zone kéo thả ảnh / folder thẳng từ Finder */}
      <div
        className={`cat-img-dropzone${imgDragging ? " dragging" : ""}`}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setImgDragging(true); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setImgDragging(false); }}
        onDrop={handleImgDrop}
      >
        <span style={{ fontSize: 18 }}>🖼</span>
        <span>Kéo thả folder hoặc nhiều file ảnh vào đây — tên file khớp SKU sẽ tự ghép</span>
        {imgStatus && <strong style={{ color: "var(--brand)" }}>{imgStatus}</strong>}
      </div>

      {/* Progress bar tìm ảnh */}
      {(autoImg.running || autoImg.log) && (
        <div className="auto-img-bar">
          {autoImg.running && (
            <div className="auto-img-progress">
              <div className="auto-img-fill" style={{ width: `${autoImg.total ? (autoImg.done / autoImg.total) * 100 : 0}%` }} />
            </div>
          )}
          <span className={autoImg.errors > 0 ? "warn" : ""}>{autoImg.log}</span>
          {!autoImg.running && autoImg.done > 0 && (
            <span className="muted" style={{ marginLeft: 8 }}>
              ({autoImg.errors} thiết bị không tìm được ảnh — có thể dán URL thủ công)
            </span>
          )}
          {!autoImg.running && (
            <button className="btn-ghost" style={{ marginLeft: 8, padding: "2px 10px", fontSize: 12 }}
              onClick={() => setAutoImg({ running: false, done: 0, total: 0, errors: 0, log: "" })}>
              Đóng
            </button>
          )}
        </div>
      )}

      {/* Công cụ điều chỉnh giá hàng loạt */}
      <div className="bulk-box">
        <span className="bulk-title">Cập nhật giá hàng loạt khi nhà cung cấp đổi giá:</span>
        <select value={bulk.supplier} onChange={(e) => { setBulk({ ...bulk, supplier: e.target.value }); setBulkError(""); }}>
          <option value="">Chọn nhà cung cấp</option>
          {suppliers.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input
          className="bulk-pct"
          type="text"
          inputMode="decimal"
          placeholder="% vd 5 hoặc -3"
          value={bulk.percent}
          onChange={(e) => { setBulk({ ...bulk, percent: e.target.value }); setBulkError(""); }}
          onKeyDown={(e) => { if (e.key === "Enter") applyBulk(); }}
        />
        <button className="btn-ghost" onClick={applyBulk}>Áp dụng</button>
        {bulk.supplier && (
          <span className="bulk-hint">{bulkAffectedCount} sản phẩm sẽ được cập nhật</span>
        )}
        {bulkError && <span className="bulk-error">{bulkError}</span>}
      </div>

      {/* Empty state — catalog trắng */}
      {products.length === 0 && (
        <div className="catalog-empty">
          <div className="catalog-empty-icon">📦</div>
          <h3>Catalog đang trống</h3>
          <p>Import file bảng giá sản phẩm của bạn để bắt đầu. Hỗ trợ mọi ngành — nội thất, điện lạnh, smarthome, thiết bị vệ sinh...</p>
          <div className="catalog-empty-actions">
            <button className="btn-primary" style={{ width: "auto" }} onClick={() => setShowImporter(true)}>
              📥 Import catalog từ Excel / PDF
            </button>
            <button className="btn-ghost" onClick={() => setEditing({ name: "", sku: "", category: "", supplier: "", unit: "Cái", costPrice: 0 })}>
              + Thêm thủ công
            </button>
          </div>
        </div>
      )}

      <table className="cat-table" style={{ display: products.length === 0 ? "none" : "table" }}>
        <thead>
          <tr><th style={{width:"52px"}}>Ảnh</th><th>Thiết bị</th><th>Mã</th><th>NCC</th><th className="num">Giá gốc/nhập</th><th className="num">Giá bán</th><th className="num">Lợi nhuận</th><th></th></tr>
        </thead>
        <tbody>
          {filtered.map((p) => {
            const publicPrice = Number(p.listPrice || p.publicPrice || 0) || 0;
            const isFixed = p.priceMode === "fixed" || publicPrice > 0;
            // Nếu catalog có cột giá công bố/niêm yết từ file NCC: hiển thị đúng giá đó, không tự hiện ×1.6/1.7.
            // Nếu chưa có giá công bố thì giữ cơ chế markup cũ để báo giá vẫn chạy.
            const sale = isFixed && publicPrice > 0
              ? VND(publicPrice)
              : `${VND(Math.round((p.costPrice * 1.6) / 1000) * 1000)} / ${VND(Math.round((p.costPrice * 1.7) / 1000) * 1000)}`;
            const profit = publicPrice > 0 ? publicPrice - (p.costPrice || 0) : null;
            return (
              <tr key={p.id}>
                <td>
                  {p.image
                    ? <ImgWithFallback src={p.image} className="cat-thumb" />
                    : null}
                  <div className="cat-thumb-empty" style={{ display: p.image ? "none" : "flex" }}>?</div>
                </td>
                <td className="strong">{p.name}{isFixed && <span className="badge-fixed">giá cố định</span>}</td>
                <td className="muted" style={{fontSize:11.5}}>{p.sku}</td>
                <td>
                  {p.supplier && (
                    <span className={`tag-ncc tag-${p.supplier.toLowerCase().replace(/[^a-z]/g,"")}`}>
                      {p.supplier}
                    </span>
                  )}
                </td>
                <td className="num strong">{VND(p.costPrice)}</td>
                <td className="num">{sale}{!isFixed && <span className="muted" style={{ fontSize: 11 }}> (gợi ý ×1.6/1.7)</span>}</td>
                <td className="num">{profit !== null ? <span className="pos">{VND(profit)}</span> : <span className="muted">—</span>}</td>
                <td className="row-actions">
                  <button className="link" onClick={() => setEditing(p)}>Sửa</button>
                  <button className="link danger" onClick={() => deleteProduct(p.id)}>Xóa</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {filtered.length === 0 && <p className="empty-hint pad">Không có thiết bị nào khớp.</p>}

      {editing && <ProductEditor product={editing} suppliers={suppliers} onSave={saveProduct} onCancel={() => setEditing(null)} />}

      {importPreview && (
        <ImportPreview preview={importPreview} onApply={applyImport} onCancel={() => setImportPreview(null)} />
      )}
    </div>
  );
}

function ProductEditor({ product, suppliers, onSave, onCancel }) {
  const [f, setF] = useState(product);
  const set = (k, v) => setF({ ...f, [k]: v });
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{product.id ? "Sửa thiết bị" : "Thêm thiết bị"}</h2>
        <div className="field-grid">
          <Field label="Tên thiết bị" value={f.name} onChange={(v) => set("name", v)} />
          <Field label="Mã (SKU)" value={f.sku} onChange={(v) => set("sku", v)} />
          <Field label="Nhóm" value={f.category} onChange={(v) => set("category", v)} />
          <Field label="Nhà cung cấp" value={f.supplier} onChange={(v) => set("supplier", v)} list={suppliers} />
          <Field label="Đơn vị tính" value={f.unit} onChange={(v) => set("unit", v)} />
          <NumField label="Giá nhập/giá đại lý (đ)" value={f.costPrice} onChange={(v) => set("costPrice", v)} />
          <NumField label="Giá công bố/niêm yết (đ)" value={f.listPrice || 0} onChange={(v) => { setF({ ...f, listPrice: v, publicPrice: v, priceMode: v > 0 ? "fixed" : (f.priceMode || "markup") }); }} />
        </div>
        <label className="field full" style={{ marginTop: 12 }}>
          <span>Thông số kỹ thuật (hiện trong báo giá gửi khách)</span>
          <textarea
            className="specs-textarea"
            value={f.specs || ""}
            onChange={(e) => set("specs", e.target.value)}
            rows={4}
          />
        </label>
        <label className="field" style={{ marginTop: 12, display: "block" }}>
          <span>Ảnh sản phẩm (URL — dán link ảnh từ web hãng hoặc Imgur)</span>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <input
              style={{ flex: 1 }}
              value={f.image || ""}
              onChange={(e) => set("image", e.target.value)}
            />
            {f.image && (
              <img
                src={f.image} alt="preview" loading="lazy"
                style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)", flexShrink: 0 }}
                onError={(e) => { e.currentTarget.style.display = "none" }}
              />
            )}
          </div>
          <p className="side-note" style={{ marginTop: 4 }}>
            Không cần ảnh cho mọi sản phẩm — chỉ thêm những cái hay nhầm lẫn (công tắc 1/2/3 nút, các loại đèn...).
            Trình duyệt tự cache, app không bị nặng.
          </p>
        </label>
        <div className="modal-actions">
          <button className="btn-ghost" onClick={onCancel}>Hủy</button>
          <button className="btn-primary" onClick={() => { if (!f.name) { alert("Nhập tên thiết bị."); return; } onSave(f); }}>Lưu</button>
        </div>
      </div>
    </div>
  );
}

function ImportPreview({ preview, onApply, onCancel }) {
  const [addNew, setAddNew] = useState(true);
  const { matched, unchanged, newItems, fileName } = preview;
  const importResult = preview.importPreview;

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h2>Xem trước cập nhật giá</h2>
        <p className="tab-intro" style={{ marginBottom: 14 }}>
          Từ file <strong>{fileName}</strong>: <strong>{matched.length}</strong> thiết bị đổi giá,{" "}
          <strong>{unchanged.length}</strong> giữ nguyên, <strong>{newItems.length}</strong> thiết bị mới chưa có trong bảng giá.
        </p>
        {importResult && (
          <div className="ci-import-summary" style={{ marginBottom: 14 }}>
            <div><strong>ImportPreviewResult:</strong> {importResult.engine} · confidence {Math.round((importResult.overallConfidence || 0) * 100)}%</div>
            <div className="ci-summary-pills">
              <span className="ok">✅ {importResult.summary.autoApproved} tự duyệt</span>
              <span className="warn">⚠️ {importResult.summary.needReview} cần kiểm tra</span>
              <span className="err">❌ {importResult.summary.failed} lỗi</span>
              <span className="muted">⏭ {importResult.summary.skipped} bỏ qua</span>
            </div>
          </div>
        )}

        {matched.length > 0 && (
          <>
            <h4 className="imp-sub">Thiết bị thay đổi giá nhập</h4>
            <div className="imp-scroll">
              <table className="cat-table">
                <thead><tr><th>Thiết bị</th><th>Mã</th><th className="num">Giá nhập cũ</th><th className="num">Giá nhập mới</th><th className="num">Thay đổi</th></tr></thead>
                <tbody>
                  {matched.map((m) => {
                    const diff = m.newCost - (m.existing.costPrice || 0);
                    const pct = m.existing.costPrice ? Math.round((diff / m.existing.costPrice) * 100) : 0;
                    return (
                      <tr key={m.existing.id}>
                        <td className="strong">{m.existing.name}</td>
                        <td className="muted">{m.existing.sku}</td>
                        <td className="num muted">{VND(m.existing.costPrice)}</td>
                        <td className="num strong">{VND(m.newCost)}</td>
                        <td className="num"><span className={diff >= 0 ? "neg" : "pos"}>{diff >= 0 ? "+" : ""}{pct}%</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {newItems.length > 0 && (
          <>
            <h4 className="imp-sub">Thiết bị mới (chưa có trong bảng giá)</h4>
            <div className="imp-scroll short">
              <table className="cat-table">
                <thead><tr><th>Tên / Mã</th><th className="num">Giá nhập</th></tr></thead>
                <tbody>
                  {newItems.map((it, i) => (
                    <tr key={i}><td>{it.name || it.sku} <span className="muted">({it.sku})</span></td><td className="num">{VND(it.costPrice)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {matched.length === 0 && newItems.length === 0 && (
          <p className="empty-hint">Không có thay đổi nào để áp dụng — giá trong file giống bảng giá hiện tại.</p>
        )}

        <div className="imp-options">
          {newItems.length > 0 && (
            <label className="chk">
              <input type="checkbox" checked={addNew} onChange={(e) => setAddNew(e.target.checked)} />
              <span>Thêm {newItems.length} thiết bị mới vào bảng giá</span>
            </label>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn-ghost" onClick={onCancel}>Hủy</button>
          <button
            className="btn-primary"
            disabled={matched.length === 0 && !(addNew && newItems.length > 0)}
            onClick={() => onApply(preview, { addNew })}
          >
            Áp dụng cập nhật
          </button>
        </div>
      </div>
    </div>
  );
}
function Templates({ products, productById, templates, setTemplates }) {
  const [editing, setEditing] = useState(null);

  const saveTpl = (tpl) => {
    if (tpl.id) setTemplates((ts) => ts.map((t) => (t.id === tpl.id ? tpl : t)));
    else setTemplates((ts) => [...ts, { ...tpl, id: uid("tpl") }]);
    setEditing(null);
  };
  const deleteTpl = (id) => {
    if (confirm("Xóa gói phòng này?")) setTemplates((ts) => ts.filter((t) => t.id !== id));
  };

  const tplTotal = (tpl) =>
    tpl.items.reduce((s, it) => s + Math.round(((productById[it.productId]?.costPrice || 0) * 1.6) / 1000) * 1000 * it.qty, 0);

  return (
    <div className="templates">
      <div className="cat-toolbar">
        <p className="tab-intro">Gói phòng là combo thiết bị dựng sẵn. Khi tạo báo giá, chọn gói là tự thêm hết thiết bị — không phải nhập lại từng món.</p>
        <button className="btn-primary" onClick={() => setEditing({ name: "", items: [] })}>+ Tạo gói phòng</button>
      </div>

      <div className="tpl-grid">
        {templates.map((t) => (
          <div className="tpl-card" key={t.id}>
            <div className="tpl-card-head">
              <h3>{t.name}</h3>
              <span className="tpl-total">{VND(tplTotal(t))}</span>
            </div>
            <ul className="tpl-items">
              {t.items.map((it, i) => {
                const p = productById[it.productId];
                return <li key={i}><span>{p ? p.name : "(thiết bị đã xóa)"}</span><span className="muted">×{it.qty}</span></li>;
              })}
              {t.items.length === 0 && <li className="muted">Chưa có thiết bị</li>}
            </ul>
            <div className="tpl-card-actions">
              <button className="link" onClick={() => setEditing(t)}>Sửa</button>
              <button className="link danger" onClick={() => deleteTpl(t.id)}>Xóa</button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <TemplateEditor template={editing} products={products} productById={productById} onSave={saveTpl} onCancel={() => setEditing(null)} />
      )}
    </div>
  );
}

function TemplateEditor({ template, products, productById, onSave, onCancel }) {
  const [f, setF] = useState({ ...template, items: [...template.items] });
  const [q, setQ] = useState("");

  const addItem = (pid) => {
    const ex = f.items.find((i) => i.productId === pid);
    if (ex) setF({ ...f, items: f.items.map((i) => (i.productId === pid ? { ...i, qty: i.qty + 1 } : i)) });
    else setF({ ...f, items: [...f.items, { productId: pid, qty: 1 }] });
  };
  const setQty = (pid, qty) => setF({ ...f, items: f.items.map((i) => (i.productId === pid ? { ...i, qty: Math.max(1, qty) } : i)) });
  const removeItem = (pid) => setF({ ...f, items: f.items.filter((i) => i.productId !== pid) });

  const filtered = products.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h2>{template.id ? "Sửa gói phòng" : "Tạo gói phòng"}</h2>
        <Field label="Tên gói" value={f.name} onChange={(v) => setF({ ...f, name: v })} />

        <div className="tpl-editor-cols">
          <div>
            <h4>Thiết bị trong gói</h4>
            {f.items.length === 0 && <p className="empty-hint">Chọn thiết bị từ danh sách bên phải.</p>}
            <ul className="tpl-edit-items">
              {f.items.map((it) => {
                const p = productById[it.productId];
                return (
                  <li key={it.productId}>
                    <span className="tei-name">{p ? p.name : "(đã xóa)"}</span>
                    <input type="text" inputMode="numeric" value={it.qty} className="qty-input" onChange={(e) => setQty(it.productId, parseInt(e.target.value.replace(/\D/g, "")) || 1)} />
                    <button className="x-btn" onClick={() => removeItem(it.productId)}>×</button>
                  </li>
                );
              })}
            </ul>
          </div>
          <div>
            <h4>Thêm thiết bị</h4>
            <input className="search" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="tpl-pick-list">
              {filtered.map((p) => (
                <button key={p.id} className="picker-item" onClick={() => addItem(p.id)}>
                  {p.image && <img src={imgSrc(p.image)} alt="" loading="lazy" className="pi-thumb" onError={(e)=>{e.currentTarget.style.display="none"}} />}
                  <span className="pi-name">{p.name}</span>
                  <span className="pi-meta">{VND(p.costPrice)} gốc</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn-ghost" onClick={onCancel}>Hủy</button>
          <button className="btn-primary" onClick={() => { if (!f.name) { alert("Nhập tên gói."); return; } onSave(f); }}>Lưu gói</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// TAB 4 — Cài đặt + Xuất/Nhập dữ liệu
// ============================================================
function Settings({ company, setCompany, markups, setMarkups, data, onImport }) {
  const fileRef = useRef();
  const set = (k, v) => setCompany({ ...company, [k]: v });

  const exportData = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `smartquote-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  };

  const importData = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(reader.result);
        onImport(d);
        alert("Đã nhập dữ liệu thành công.");
      } catch {
        alert("File không hợp lệ.");
      }
    };
    reader.readAsText(file);
  };

  const updateMarkup = (id, key, val) =>
    setMarkups((ms) => ms.map((m) => (m.id === id ? { ...m, [key]: key === "value" ? parseFloat(val) || 0 : val } : m)));
  const addMarkup = () => setMarkups((ms) => [...ms, { id: uid("mk"), label: "Mức mới", value: 1.5 }]);
  const removeMarkup = (id) => setMarkups((ms) => ms.filter((m) => m.id !== id));

  return (
    <div className="settings">

      <section className="section-card">
        <div className="section-card-head">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          <span>Thông tin công ty</span>
        </div>
        <div className="section-card-body">
          <div className="field-grid">
            <Field label="Tên công ty" value={company.name} onChange={(v) => set("name", v)} />
            <Field label="Mã số thuế" value={company.taxCode} onChange={(v) => set("taxCode", v)} />
            <Field label="Điện thoại công ty" value={company.phone} onChange={(v) => set("phone", v)} />
            <NumField label="Nhân công, lập trình (% tiền hàng)" value={company.laborPercent} onChange={(v) => set("laborPercent", v)} />
            <Field label="Địa chỉ" value={company.address} onChange={(v) => set("address", v)} full />
            <Field label="Website" value={company.website || ""} onChange={(v) => set("website", v)} full />
            <Field label="Người báo giá" value={company.salesPerson || ""} onChange={(v) => set("salesPerson", v)} />
            <Field label="SĐT người báo giá" value={company.salesPhone || ""} onChange={(v) => set("salesPhone", v)} />
          </div>
        </div>
      </section>

      <section className="section-card">
        <div className="section-card-head">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          <span>Tìm ảnh tự động (Serper.dev)</span>
        </div>
        <div className="section-card-body">
          <p className="tab-intro" style={{ margin: "0 0 10px" }}>
            2.500 lượt miễn phí — không cần billing. Sau khi điền key, vào tab <strong>Danh mục</strong> → bấm <strong>"Tự động tìm ảnh"</strong>.
          </p>
          <div className="field-grid">
            <Field label="Serper API Key" value={company.googleApiKey || ""} onChange={(v) => set("googleApiKey", v)} full />
          </div>
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--brand)", fontWeight: 600 }}>Cách lấy key (1 phút)</summary>
            <div className="api-guide">
              <ol>
                <li>Vào <a href="https://serper.dev" target="_blank" rel="noreferrer">serper.dev</a> → đăng ký Gmail</li>
                <li>Dashboard → copy <strong>API Key</strong> → dán vào ô trên</li>
              </ol>
            </div>
          </details>
        </div>
      </section>

      <section className="section-card">
        <div className="section-card-head">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          <span>Hệ số giá theo khách</span>
        </div>
        <div className="section-card-body">
          <p className="tab-intro" style={{ margin: "0 0 10px" }}>Giá bán = giá gốc × hệ số. Khi tạo báo giá chọn mức phù hợp cho từng khách.</p>
          {markups.map((m) => (
            <div className="markup-row" key={m.id}>
              <input className="markup-name-input" value={m.label} onChange={(e) => updateMarkup(m.id, "label", e.target.value)} />
              <span className="markup-x">×</span>
              <input className="markup-val-input" type="number" step="0.05" value={m.value} onChange={(e) => updateMarkup(m.id, "value", e.target.value)} />
              {markups.length > 1 && <button className="x-btn" onClick={() => removeMarkup(m.id)}>×</button>}
            </div>
          ))}
          <button className="btn-ghost" style={{ marginTop: 8, fontSize: 12 }} onClick={addMarkup}>+ Thêm mức hệ số</button>
        </div>
      </section>

      <section className="section-card">
        <div className="section-card-head">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <span>Sao lưu &amp; khôi phục dữ liệu</span>
        </div>
        <div className="section-card-body">
          <div className="backup-warning">
            ⚠️ <strong>Quan trọng:</strong> Dữ liệu (catalog, gói, cài đặt) hiện lưu trong trình duyệt máy này. Nếu xóa lịch sử trình duyệt hoặc đổi máy, dữ liệu sẽ mất. <strong>Hãy tải file sao lưu định kỳ</strong> (vd cuối mỗi ngày) và giữ ở nơi an toàn (Google Drive, email...).
          </div>
          <div className="backup-stats">
            <span>📦 {data.products?.length || 0} sản phẩm</span>
            <span>📋 {data.templates?.length || 0} gói</span>
            <span>🏢 {data.suppliers?.length || 0} nhà cung cấp</span>
          </div>
          <div className="settings-actions">
            <button className="btn-primary" onClick={exportData}>⬇ Tải file sao lưu (.json)</button>
            <button className="btn-ghost" onClick={() => fileRef.current?.click()}>⬆ Nhập từ file sao lưu</button>
            <input ref={fileRef} type="file" accept="application/json" hidden onChange={importData} />
          </div>
          <p className="tab-intro" style={{ margin: "10px 0 0", fontSize: 12 }}>
            💡 Khi chuyển máy mới: mở SmartQuote → vào đây → "Nhập từ file sao lưu" → chọn file .json đã tải.
          </p>
        </div>
      </section>

    </div>
  );
}

// ============================================================
// Thành phần dùng chung
// ============================================================
function Field({ label, value, onChange, placeholder, full, list }) {
  const listId = list ? uid("dl") : undefined;
  return (
    <label className={`field ${full ? "full" : ""}`}>
      <span>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} list={listId} />
      {list && (
        <datalist id={listId}>
          {list.map((o) => <option key={o} value={o} />)}
        </datalist>
      )}
    </label>
  );
}

function NumField({ label, value, onChange }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" value={value} onChange={(e) => onChange(parseFloat(e.target.value) || 0)} />
    </label>
  );
}

function Row({ label, value }) {
  return <div className="sum-row"><span>{label}</span><span>{value}</span></div>;
}

// ============================================================
// Tạo trang HTML đẹp để in/lưu PDF (đúng dấu tiếng Việt, có màu/viền)
// ============================================================
function buildQuotePrintHTML({ company, customer, rooms, productById, lineSalePrice, calc }) {
  const today = new Date();
  const dateStr = `${String(today.getDate()).padStart(2,"0")}/ ${String(today.getMonth()+1).padStart(2,"0")} /${today.getFullYear()}`;
  const vnd = (n) => (Number(n)||0).toLocaleString("vi-VN");
  const esc = (s) => String(s??"").replace(/[&<>]/g,(c)=>({'"':"&amp;","<":"&lt;",">":"&gt;"}[c]||c));

  // Tính tổng từng giải pháp (cho bảng tổng hợp cuối)
  let romanIdx = 0;
  const sectionSums = []; // [{name, total}]
  const sections = rooms.map((room) => {
    const valid = room.lines.filter((l) => productById[l.productId]);
    if (valid.length === 0) return "";
    romanIdx++;
    let sectionSum = 0;
    const rowsHtml = valid.map((l, i) => {
      const p = productById[l.productId];
      const sp = lineSalePrice(p, l);
      const total = sp * l.qty;
      sectionSum += total;
      const noteHtml = l.note ? esc(l.note).replace(/\n/g,"<br>") : "";
      // Dùng proxy /api/img khi chạy trên HTTPS (Vercel), URL gốc khi local
      const imgProxySrc = (url) => {
        if (!url) return "";
        if (url.includes("encrypted-tbn") || url.includes("gstatic.com/images?q=tbn")) return "";
        return window.location.protocol === "https:" ? `/api/img?url=${encodeURIComponent(url)}` : url;
      };
      const proxiedImg = imgProxySrc(p.image);
      const imgHtml = proxiedImg
        ? `<img src="${esc(proxiedImg)}" style="width:56px;height:56px;object-fit:cover;border-radius:4px;display:block;margin:0 auto;border:1px solid #e5e7eb;" onerror="this.parentNode.innerHTML='<span style=color:#ccc;font-size:9px>—</span>'" />`
        : `<span style="color:#ccc;font-size:10px">—</span>`;
      return `<tr>
        <td class="c">${i+1}</td>
        <td style="font-size:10.5px;color:#444;line-height:1.5">${noteHtml}</td>
        <td>${esc(p.name)}</td>
        <td style="font-size:9.5px;color:#444;line-height:1.4">${p.specs?esc(p.specs):""}</td>
        <td class="c">${imgHtml}</td>
        <td>${esc(p.sku||"")}</td><td>${esc(p.supplier||"")}</td>
        <td class="c">${esc(p.unit||"Cái")}</td><td class="c">${l.qty}</td>
        <td class="r">${vnd(sp)}</td><td class="r">${vnd(total)}</td>
      </tr>`;
    }).join("");
    sectionSums.push({ name: room.name.replace(/\n/g," "), total: sectionSum });
    return `<tr class="section-row">
      <td colspan="10">${esc(room.name.replace(/\n/g," "))}</td>
      <td class="r">${vnd(sectionSum)}</td>
    </tr>${rowsHtml}`;
  }).join("");

  // Bảng tổng hợp cuối
  const summaryRows = sectionSums.map((s) =>
    `<tr><td class="sl">${esc(s.name)}</td><td class="sr">${vnd(s.total)}</td></tr>`
  ).join("");

  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Báo giá ${esc(customer.name||"")}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:Arial,sans-serif;color:#1a1a1a;padding:20px 24px;font-size:12px;}

    /* HEADER 2 CỘT */
    .hdr{display:table;width:100%;border:1.5px solid #333;border-collapse:collapse;margin-bottom:0;}
    .hdr-left,.hdr-right{display:table-cell;vertical-align:middle;padding:10px 14px;}
    .hdr-left{width:38%;border-right:1.5px solid #333;text-align:center;}
    .hdr-right{width:62%;text-align:center;}
    .logo-placeholder{font-size:28px;font-weight:900;color:#1A7A4A;letter-spacing:1px;line-height:1;}
    .logo-sub{font-size:10px;color:#555;margin-top:4px;font-style:italic;}
    .co-name-big{font-size:14px;font-weight:bold;color:#1A7A4A;text-transform:uppercase;line-height:1.4;}
    .co-detail{font-size:11px;color:#222;line-height:1.8;margin-top:4px;}
    .co-web{font-size:10px;color:#555;margin-top:2px;}

    /* INFO KHÁCH */
    .info-table{width:100%;border-collapse:collapse;border:1.5px solid #333;border-top:none;margin-bottom:0;}
    .info-table td{padding:5px 10px;font-size:11.5px;border:1px solid #ccc;vertical-align:top;}
    .info-table .lbl{font-weight:bold;}
    .title-bar{text-align:center;font-size:14px;font-weight:bold;border:1.5px solid #333;border-top:none;padding:7px;letter-spacing:.5px;background:#f8f8f8;}
    .intro-bar{border:1.5px solid #333;border-top:none;padding:7px 10px;font-size:11px;color:#333;margin-bottom:0;}

    /* BẢNG CHI TIẾT */
    table.main{width:100%;border-collapse:collapse;font-size:11.5px;margin-top:0;}
    .main th{background:#1A7A4A;color:#fff;padding:7px 6px;text-align:left;border:1px solid #1A7A4A;font-size:11px;}
    .main th.c,.main td.c{text-align:center;}
    .main th.r,.main td.r{text-align:right;}
    .main td{padding:6px;border:1px solid #ccc;vertical-align:top;}
    .section-row td{background:#D1FAE5;font-weight:bold;color:#1A7A4A;font-size:11.5px;}

    /* BẢNG TỔNG HỢP */
    .sum-title{text-align:center;font-weight:bold;font-size:12px;border:1.5px solid #333;border-top:none;padding:6px;background:#f0f0f0;letter-spacing:.3px;}
    table.summary{width:100%;border-collapse:collapse;font-size:12px;border:1.5px solid #333;border-top:none;}
    .summary td{padding:6px 12px;border:1px solid #ccc;}
    .summary .sl{width:85%;}
    .summary .sr{text-align:right;font-weight:600;white-space:nowrap;}
    .summary .grand-row td{font-weight:bold;font-size:13px;border-top:2px solid #333;}

    /* KÝ TÊN */
    .foot{margin-top:14px;font-size:10.5px;color:#555;line-height:1.6;}
    .sign{display:flex;justify-content:space-between;margin-top:28px;text-align:center;font-size:11.5px;}
    .sign div{width:45%;}
    .sign .role{font-weight:bold;margin-bottom:55px;}
    @media print{body{padding:0;}@page{margin:12mm;size:A4;}}
  .ci-template-note{background:#ecfdf5;border:1px solid #bbf7d0;color:#047857;border-radius:10px;padding:10px 12px;font-size:13px;margin:8px 0 12px;font-weight:600;}
.ci-preview-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:10px 0 12px;padding:10px 12px;background:#f8fafc;border:1px solid var(--border);border-radius:12px;}
.ci-preview-toolbar .ci-filter-title{font-size:12px;font-weight:700;color:var(--muted);margin-right:2px;}
.ci-preview-toolbar button{border:1px solid var(--border);background:#fff;border-radius:999px;padding:7px 10px;font-size:12px;font-weight:700;color:var(--text);cursor:pointer;}
.ci-preview-toolbar button.active{background:#e8f8ef;border-color:#86efac;color:#166534;}
.ci-preview-toolbar button.ghost{margin-left:auto;border-color:#bfdbfe;background:#eff6ff;color:#1d4ed8;}

</style></head><body>

    <!-- HEADER CÔNG TY -->
    <div class="hdr">
      <div class="hdr-left">
        <div class="logo-placeholder">NDG</div>
        <div class="logo-sub">NGUYÊN ĐÀ GROUP<br>≡ Một điểm đến - Vạn niềm tin ≡</div>
      </div>
      <div class="hdr-right">
        <div class="co-name-big">"${esc(company.name)}</div>
        <div class="co-detail">
          Showroom và VPGD: ${esc(company.address)}<br>
          Mã số thuế: ${esc(company.taxCode||"")} &nbsp;&nbsp; Số điện thoại: ${esc(company.phone)}
        </div>
        <div class="co-web">${esc(company.website||"")}</div>
      </div>
    </div>

    <!-- THÔNG TIN KHÁCH HÀNG -->
    <table class="info-table">
      <tr>
        <td class="lbl" style="width:50%">Khách hàng: <strong>${esc(customer.name||"")}</strong></td>
        <td class="lbl">Số báo giá: ${esc(customer.quoteNumber||"")}</td>
      </tr>
      <tr>
        <td>Điện thoại: ${esc(customer.phone||"")}</td>
        <td>Ngày: &nbsp; ${dateStr}</td>
      </tr>
      <tr>
        <td>Email: </td>
        <td>Người báo giá: <strong>${esc(company.salesPerson||"")}</strong></td>
      </tr>
      <tr>
        <td>Địa điểm công trình: <strong>${esc(customer.address||"")}</strong></td>
        <td>Điện thoại: ${esc(company.salesPhone||"")}</td>
      </tr>
      <tr>
        <td>Hạng mục: ${esc(customer.category||"")}</td>
        <td>Email: </td>
      </tr>
    </table>

    <div class="title-bar">BẢNG BÁO GIÁ TỔNG HỢP</div>
    <div class="intro-bar">${esc(company.introText||"Xin trân trọng gửi tới Quý Khách hàng Bảng báo giá với những chi tiết như sau:")}</div>

    <!-- BẢNG CHI TIẾT -->
    <table class="main">
      <thead><tr>
        <th class="c" style="width:28px">STT</th>
        <th style="width:100px">Khu vực lắp đặt</th>
        <th>Tên hàng hoá / Mô tả</th>
        <th>Thông số kỹ thuật</th>
        <th class="c" style="width:68px">Hình ảnh</th>
        <th style="width:60px">Mã thiết bị</th>
        <th style="width:48px">Xuất xứ</th>
        <th class="c" style="width:32px">ĐVT</th>
        <th class="c" style="width:28px">SL</th>
        <th class="r" style="width:75px">Đơn giá</th>
        <th class="r" style="width:85px">Thành tiền</th>
      </tr></thead>
      <tbody>${sections||`<tr><td colspan="11" class="c" style="padding:18px;color:#999">Chưa có thiết bị</td></tr>`}</tbody>
    </table>

    <!-- BẢNG TỔNG HỢP CÁC GIẢI PHÁP -->
    <div class="sum-title">TỔNG HỢP CÁC GIẢI PHÁP NHÀ THÔNG MINH</div>
    <table class="summary">
      ${summaryRows}
      <tr><td class="sl lbl">Tổng tiền hàng:</td><td class="sr">${vnd(calc.deviceTotal)}</td></tr>
      <tr><td class="sl lbl">Nhân công thi công lắp đặt và cài đặt lập trình cấu hình và set theo ngữ cảnh CĐT (${company.laborPercent}%)</td><td class="sr">${vnd(calc.laborTotal)}</td></tr>
      <tr class="grand-row"><td class="sl lbl">Tổng giá trị hợp đồng</td><td class="sr">${vnd(calc.grand)}</td></tr>
    </table>

    <div class="foot">
      * Lưu ý: Báo giá chỉ có giá trị trong vòng 14 ngày kể từ ngày báo giá, sau thời gian này giá sẽ thay đổi theo nhà sản xuất.
    </div>
    <div class="sign">
      <div><div class="role">KHÁCH HÀNG<br>(Ký xác nhận &amp; Ghi rõ họ và tên)</div></div>
      <div><div class="role">${esc(company.name)}<br>(Ký và ghi rõ họ tên)</div></div>
    </div>
  </body></html>`;
}

// ============================================================
// Xuất báo giá ra file Excel theo mẫu công ty (gom theo khu vực/giải pháp)
// ============================================================
async function exportQuoteExcel({ company, customer, rooms, productById, lineSalePrice, calc }) {
  // Nếu đang chạy trên Vercel (HTTPS) → dùng Python API để xuất Excel có ảnh
  const isVercel = typeof window !== "undefined" && window.location.protocol === "https:";
  if (isVercel) {
    try {
      // Chuẩn bị data gửi lên Python API
      const payload = {
        company,
        customer,
        calc,
        rooms: rooms
          .filter((r) => r.lines.some((l) => productById[l.productId]))
          .map((r) => ({
            name: r.name,
            lines: r.lines
              .filter((l) => productById[l.productId])
              .map((l) => {
                const p = productById[l.productId];
                const price = lineSalePrice(p, l);
                return {
                  productId: l.productId,
                  qty: l.qty,
                  price,
                  note: l.note || "",
                  product: {
                    name: p.name,
                    sku: p.sku || "",
                    supplier: p.supplier || "",
                    unit: p.unit || "Cái",
                    specs: p.specs || "",
                    image: p.image || "",
                  },
                };
              }),
          })),
      };

      const res = await fetch("/api/excel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(`API lỗi ${res.status}`);

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `BaoGia_${customer.name || "SmartQuote"}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    } catch (err) {
      console.warn("Excel API lỗi, fallback SheetJS:", err);
      // Tiếp tục dùng SheetJS bên dưới nếu API lỗi
    }
  }

  // Fallback: SheetJS (không có ảnh, dùng khi local hoặc API lỗi)
  const today = new Date();
  const dateStr = `${String(today.getDate()).padStart(2, "0")}/${String(today.getMonth() + 1).padStart(2, "0")}/${today.getFullYear()}`;

  const aoa = [];
  const merges = [];
  const money = [];       // [r,c] ô cần format tiền
  const formulas = [];    // {r,c,f} công thức set sau khi tạo sheet
  let R = 0;
  const push = (row) => { aoa.push(row); R++; };

  // --- Header công ty (mẫu Nguyên Đà) ---
  push([company.name, "", "", "", `Số báo giá: ${customer.quoteNumber || ""}`, "", "", ""]);
  merges.push({ s: { r: R-1, c: 0 }, e: { r: R-1, c: 3 } });
  push([`Showroom và VPGD: ${company.address}`, "", "", "", `Mã số thuế: ${company.taxCode || ""}`, "", "", ""]);
  merges.push({ s: { r: R-1, c: 0 }, e: { r: R-1, c: 3 } });
  push([`Mã số thuế: ${company.taxCode || ""} · Số điện thoại: ${company.phone}`, "", "", "", `Ngày: ${dateStr}`, "", "", ""]);
  merges.push({ s: { r: R-1, c: 0 }, e: { r: R-1, c: 3 } });
  push([company.website || "", "", "", "", `Người báo giá: ${company.salesPerson || ""}`, "", "", ""]);
  merges.push({ s: { r: R-1, c: 0 }, e: { r: R-1, c: 3 } });
  push([]);

  // --- Thông tin khách ---
  push([`Khách hàng: ${customer.name || ""}`, "", "", "", `Điện thoại NB: ${company.salesPhone || ""}`, "", "", ""]);
  push([`Điện thoại: ${customer.phone || ""}`, "", "", "", "", "", "", ""]);
  push([`Email:`, "", "", "", "", "", "", ""]);
  push([`Địa điểm công trình: ${customer.address || ""}`, "", "", "", "", "", "", ""]);
  push([`Hạng mục: ${customer.category || "Giải pháp nhà thông minh Lumi"}`, "", "", "", "", "", "", ""]);
  push([]);

  // --- Tiêu đề ---
  push(["BẢNG BÁO GIÁ TỔNG HỢP"]);
  merges.push({ s: { r: R-1, c: 0 }, e: { r: R-1, c: 7 } });
  push([company.introText||"Xin trân trọng gửi tới Quý Khách hàng Bảng báo giá với những chi tiết như sau:"]);
  merges.push({ s: { r: R-1, c: 0 }, e: { r: R-1, c: 7 } });
  push([]);

  // --- Header bảng ---
  push(["STT", "Khu vực lắp đặt", "Tên hàng hoá/Mô tả", "Thông số kỹ thuật", "Hình ảnh", "Mã thiết bị", "Xuất xứ", "ĐVT", "SL", "Đơn giá", "Thành tiền"]);

  // --- Từng khu vực ---
  const sectionTotalRows = [];
  const sectionNames = [];
  let sttGlobal = 0; // STT toàn bảng
  rooms.forEach((room, idx) => {
    const validLines = room.lines.filter((l) => productById[l.productId]);
    if (validLines.length === 0) return;

    const secRow = R;
    push([`${room.name.replace(/\n/g," ")}`, "", "", "", "", "", "", "", "", ""]);
    merges.push({ s: { r: secRow, c: 0 }, e: { r: secRow, c: 9 } });

    const firstItemExcelRow = R + 1;
    let sectionSum = 0;
    validLines.forEach((l) => {
      sttGlobal++;
      const p = productById[l.productId];
      const sp = lineSalePrice(p, l);
      const lineTotal = sp * l.qty;
      sectionSum += lineTotal;
      const er = R + 1;
      push([sttGlobal, l.note || "", p.name, p.specs || "", p.image || "", p.sku || "", p.supplier || "", p.unit || "Cái", l.qty, sp, ""]);
      formulas.push({ r: R-1, c: 10, f: `I${er}*J${er}`, v: lineTotal });
      money.push([R-1, 9]); money.push([R-1, 10]);
    });
    const lastItemExcelRow = R;

    formulas.push({ r: secRow, c: 10, f: `SUM(K${firstItemExcelRow}:K${lastItemExcelRow})`, v: sectionSum });
    money.push([secRow, 9]);
    sectionTotalRows.push(secRow);
    sectionNames.push(room.name.replace(/\n/g," "));
  });

  push([]);

  // --- BẢNG TỔNG HỢP CÁC GIẢI PHÁP ---
  push(["TỔNG HỢP CÁC GIẢI PHÁP NHÀ THÔNG MINH", "", "", "", "", "", "", "", "", ""]);
  merges.push({ s: { r: R-1, c: 0 }, e: { r: R-1, c: 9 } });

  // Từng giải pháp
  sectionTotalRows.forEach((secRow, i) => {
    push([sectionNames[i], "", "", "", "", "", "", "", "", ""]);
    merges.push({ s: { r: R-1, c: 0 }, e: { r: R-1, c: 9 } });
    const ref = `K${secRow + 1}`;
    const v = aoa[secRow]?.[9] || 0;
    formulas.push({ r: R-1, c: 9, f: ref, v: typeof v === "number" ? v : 0 });
    money.push([R-1, 9]);
  });

  // Tổng tiền hàng
  const sumRefs2 = sectionTotalRows.map((r) => `K${r + 1}`).join("+");
  const hangRow = R;
  push(["Tổng tiền hàng:", "", "", "", "", "", "", "", "", ""]);
  merges.push({ s: { r: hangRow, c: 0 }, e: { r: hangRow, c: 9 } });
  formulas.push({ r: hangRow, c: 10, f: sumRefs2 || "0", v: calc.deviceTotal });
  money.push([hangRow, 9]);

  const ncRow = R;
  push([`Nhân công thi công lắp đặt và cài đặt lập trình cấu hình và set theo ngữ cảnh CĐT (${company.laborPercent}%):`, "", "", "", "", "", "", "", "", ""]);
  merges.push({ s: { r: ncRow, c: 0 }, e: { r: ncRow, c: 9 } });
  formulas.push({ r: ncRow, c: 10, f: `K${hangRow+1}*${(company.laborPercent||0)/100}`, v: calc.laborTotal });
  money.push([ncRow, 9]);

  const hdRow = R;
  push(["Tổng giá trị hợp đồng", "", "", "", "", "", "", "", "", ""]);
  merges.push({ s: { r: hdRow, c: 0 }, e: { r: hdRow, c: 9 } });
  formulas.push({ r: hdRow, c: 10, f: `K${hangRow+1}+K${ncRow+1}`, v: calc.grand });
  money.push([hdRow, 9]);

  push([]);
  push(["* Lưu ý: Báo giá chỉ có giá trị trong vòng 14 ngày kể từ ngày báo giá, sau thời gian này giá sẽ thay đổi theo nhà sản xuất."]);
  merges.push({ s: { r: R-1, c: 0 }, e: { r: R-1, c: 9 } });

  // --- Tạo worksheet ---
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!merges"] = merges;
  ws["!cols"] = [
    { wch: 5 },  // STT
    { wch: 22 }, // Khu vực
    { wch: 28 }, // Tên hàng hoá
    { wch: 28 }, // Thông số
    { wch: 40 }, // Hình ảnh (URL)
    { wch: 18 }, // Mã
    { wch: 10 }, // Xuất xứ
    { wch: 7 },  // ĐVT
    { wch: 6 },  // SL
    { wch: 14 }, // Đơn giá
    { wch: 16 }, // Thành tiền
  ];

  // Set công thức ĐÚNG CÁCH: cell cần type 'n', thuộc tính f (công thức) VÀ v (giá trị cache).
  // Thiếu v thì SheetJS community không ghi ô công thức ra file.
  formulas.forEach(({ r, c, f, v }) => {
    const addr = XLSX.utils.encode_cell({ r, c });
    ws[addr] = { t: "n", f, v: v ?? 0 };
  });

  // Format số tiền (cả ô giá trị và ô công thức)
  money.forEach(([r, c]) => {
    const addr = XLSX.utils.encode_cell({ r, c });
    if (ws[addr]) ws[addr].z = "#,##0";
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "BÁO GIÁ");

  const fileName = `BaoGia_${(customer.name || "KhachHang").replace(/\s+/g, "_")}_${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}.xlsx`;
  XLSX.writeFile(wb, fileName);
}

function toRoman(num) {
  const map = [["X", 10], ["IX", 9], ["V", 5], ["IV", 4], ["I", 1]];
  let r = "";
  for (const [sym, val] of map) while (num >= val) { r += sym; num -= val; }
  return r;
}

const CSS = `
:root{
  --bg:#F8FAFC;--surface:#FFFFFF;--line:#E2E8F0;--line2:#CBD5E1;--ink:#0F172A;--muted:#64748B;
  --brand:#1A7A4A;--brand-d:#155E3A;--brand-soft:#ECFDF5;
  --pos:#16A34A;--pos-bg:#F0FDF4;--neg:#DC2626;--neg-bg:#FEF2F2;
  --warn:#D97706;--warn-bg:#FFFBEB;
  --radius:10px;--radius-lg:12px;
}
*{box-sizing:border-box;}
.app{min-height:100vh;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px;}
.topbar{position:sticky;top:0;z-index:20;display:flex;align-items:center;background:var(--surface);border-bottom:1px solid var(--line);padding:0 20px;height:52px;gap:0;}
.brand{display:flex;align-items:center;gap:7px;font-weight:700;font-size:15px;color:var(--ink);margin-right:20px;flex-shrink:0;}
.brand-mark{color:var(--brand);font-size:18px;}
.tabs{display:flex;height:100%;gap:0;}
.tabs button{display:flex;align-items:center;gap:6px;background:none;border:none;border-bottom:2px solid transparent;padding:0 13px;height:100%;font-size:13px;font-weight:500;color:var(--muted);cursor:pointer;white-space:nowrap;font-family:inherit;transition:color .15s;}
.tabs button:hover{color:var(--ink);background:var(--bg);}
.tabs button.on{color:var(--brand);border-bottom-color:var(--brand);}
.main{max-width:1180px;margin:0 auto;padding:20px;}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-lg);padding:18px 20px;margin-bottom:14px;}
.card h2{margin:0 0 14px;font-size:15px;font-weight:600;}
.quote-grid{display:grid;grid-template-columns:1fr 300px;gap:16px;align-items:start;}
.quote-side{position:sticky;top:68px;}
.field-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.field{display:flex;flex-direction:column;gap:5px;font-size:13px;}
.field.full{grid-column:1/-1;}
.field span{font-size:11.5px;font-weight:600;color:var(--muted);letter-spacing:.03em;}
.field input{padding:8px 10px;border:1px solid var(--line);border-radius:8px;font-size:13px;font-family:inherit;color:var(--ink);background:var(--surface);}
.field input:focus{outline:none;border-color:var(--brand);}
.specs-textarea{width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:8px;font-family:inherit;font-size:13px;line-height:1.5;resize:vertical;}
.specs-textarea:focus{outline:none;border-color:var(--brand);}
.room-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-lg);margin-bottom:12px;overflow:hidden;}
.room-card .room-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line);background:var(--bg);}
.room-name{font-size:14px;font-weight:600;border:none;background:transparent;padding:0;width:100%;font-family:inherit;resize:none;line-height:1.4;color:var(--ink);}
.room-name:focus{outline:none;}
.room-head-actions{display:flex;gap:6px;align-items:center;flex-shrink:0;}
.tpl-select{padding:6px 9px;border:1px solid var(--line);border-radius:7px;font-size:12px;font-family:inherit;color:var(--brand);font-weight:600;cursor:pointer;background:var(--surface);}
.btn-ghost{background:none;border:1px solid var(--line2);padding:6px 12px;border-radius:8px;font-size:13px;cursor:pointer;font-weight:500;color:var(--ink);font-family:inherit;transition:all .15s;}
.btn-ghost:hover{border-color:var(--brand);color:var(--brand);}
.btn-ghost.danger{color:var(--neg);}
.btn-ghost.danger:hover{border-color:var(--neg);}
.btn-primary{background:var(--brand);color:#fff;border:none;padding:9px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;width:100%;transition:background .15s;}
.btn-primary:hover{background:var(--brand-d);}
.btn-primary:disabled{background:#93AEED;cursor:not-allowed;}
.btn-pdf{flex:1;background:#DC2626;color:#fff;border:none;padding:9px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;}
.btn-pdf:hover{background:#B91C1C;}
.btn-excel{background:#15803D;color:#fff;border:none;padding:9px 14px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap;}
.btn-excel:hover{background:#166534;}
.btn-add-room{background:none;color:var(--brand);border:1.5px dashed var(--line2);padding:11px;border-radius:var(--radius-lg);font-size:13px;font-weight:600;cursor:pointer;width:100%;font-family:inherit;transition:all .15s;}
.btn-add-room:hover{border-color:var(--brand);background:var(--brand-soft);}
.add-bar-room{display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--line);background:var(--bg);}
.add-bar-room .btn-ghost{font-size:12px;padding:5px 10px;}
.x-btn{background:none;border:none;color:var(--muted);font-size:16px;cursor:pointer;line-height:1;padding:0 3px;}
.x-btn:hover{color:var(--neg);}
.line-table,.cat-table{width:100%;border-collapse:collapse;font-size:13px;}
.line-table th,.cat-table th{text-align:left;color:var(--muted);font-size:11.5px;font-weight:600;padding:7px 8px;border-bottom:1px solid var(--line);background:var(--bg);}
.line-table td,.cat-table td{padding:8px;border-bottom:1px solid var(--line);vertical-align:middle;}
.line-table tr:last-child td,.cat-table tr:last-child td{border-bottom:none;}
.line-table tr:hover td{background:var(--bg);}
.num{text-align:right;}
.qty-col{width:64px;}
.ln-name{font-weight:600;font-size:13px;}
.ln-sku{font-size:11px;color:var(--muted);margin-top:2px;}
.strong{font-weight:600;}
.muted{color:var(--muted);}
.qty-input{width:54px;padding:5px 6px;border:1px solid var(--line);border-radius:6px;text-align:center;font-family:inherit;font-size:13px;}
.qty-input::-webkit-outer-spin-button,.qty-input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0;}
.qty-input[type=number]{-moz-appearance:textfield;}
.note-col{width:120px;}
.stt-col{width:40px;text-align:center;}
.stt-cell{display:flex;flex-direction:column;align-items:center;gap:2px;}
.stt-num{font-size:12px;font-weight:600;color:var(--muted);}
.stt-move{display:flex;flex-direction:column;gap:1px;}
.move-btn{background:none;border:1px solid var(--line);border-radius:3px;font-size:9px;padding:1px 4px;cursor:pointer;color:var(--muted);line-height:1.2;font-family:inherit;}
.move-btn:hover:not(:disabled){background:var(--brand-soft);border-color:var(--brand);color:var(--brand);}
.move-btn:disabled{opacity:.25;cursor:default;}
.note-input{width:100%;min-width:100px;padding:5px 7px;border:1px solid var(--line);border-radius:6px;font-family:inherit;font-size:11px;color:var(--muted);resize:none;line-height:1.4;background:var(--bg);}
.note-input:focus{outline:none;border-color:var(--brand);background:var(--surface);}
.ln-actions{display:flex;gap:3px;align-items:center;white-space:nowrap;}
.ln-edit{background:none;border:none;color:var(--brand);font-size:14px;cursor:pointer;padding:0 3px;}
.ln-edit:hover{color:var(--brand-d);}
.empty-hint{color:var(--muted);font-size:13px;font-style:italic;padding:6px 2px;}
.empty-hint.pad{padding:20px;text-align:center;}
.summary .sum-row{display:flex;justify-content:space-between;padding:7px 0;font-size:13.5px;border-bottom:1px solid var(--line);}
.summary .grand{display:flex;justify-content:space-between;padding:12px 0;font-size:18px;font-weight:700;color:var(--brand);border-top:2px solid var(--brand);margin-top:4px;margin-bottom:10px;}
.export-btns{display:flex;gap:8px;}
.export-btns .btn-primary{flex:1;}
.side-note{font-size:11.5px;color:var(--muted);margin:10px 0 0;line-height:1.5;}
.quote-actions-bottom{display:flex;gap:10px;margin-top:4px;}
.quote-actions-bottom .btn-add-room{flex:1;}
.hs-col{width:110px;}
.hs-cell{display:flex;flex-direction:column;align-items:flex-end;gap:3px;}
.hs-input{width:58px;padding:4px 6px;border:1px solid var(--line);border-radius:6px;text-align:center;font-family:inherit;font-size:12px;}
.hs-quick{display:flex;gap:3px;}
.hs-quick button{border:1px solid var(--line);background:var(--surface);border-radius:5px;font-size:11px;padding:2px 6px;cursor:pointer;font-family:inherit;color:var(--muted);font-weight:600;}
.hs-quick button:hover{border-color:var(--brand);color:var(--brand);}
.hs-quick button.on{background:var(--brand);color:#fff;border-color:var(--brand);}
.hs-fixed{font-size:11px;}
.row-missing-price{background:var(--warn-bg);}
.price-missing-cell{display:flex;flex-direction:column;align-items:flex-end;gap:2px;}
.price-inline-input{width:100px;padding:4px 7px;border:1.5px solid var(--warn);border-radius:6px;font-family:inherit;font-size:13px;text-align:right;}
.price-inline-input:focus{outline:none;border-color:#EA580C;}
.price-missing-hint{font-size:10.5px;color:#EA580C;font-weight:600;}
.picker{background:var(--brand-soft);border-radius:10px;padding:12px;margin-bottom:12px;}
.picker-bar{display:flex;gap:8px;margin-bottom:10px;}
.picker-bar input{flex:1;padding:8px 10px;border:1px solid var(--line);border-radius:8px;font-family:inherit;font-size:13px;}
.picker-list{display:grid;grid-template-columns:1fr 1fr;gap:6px;max-height:220px;overflow:auto;}
.picker-item{display:flex;flex-direction:row;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:7px 10px;cursor:pointer;text-align:left;font-family:inherit;transition:border-color .15s;}
.picker-item:hover{border-color:var(--brand);background:#fff;}
.pi-thumb{width:38px;height:38px;object-fit:cover;border-radius:6px;background:var(--bg);flex-shrink:0;border:1px solid var(--line);}
.pi-name{font-weight:600;font-size:12.5px;}
.pi-meta{font-size:11px;color:var(--muted);}
.picker-create-btn{width:100%;margin-top:8px;background:var(--surface);border:1px dashed var(--brand);color:var(--brand);padding:10px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;}
.picker-create-btn:hover{background:var(--brand-soft);}
.picker-create-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;font-size:14px;}
.picker-create-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.price-preview{padding:8px 10px;background:var(--brand-soft);border-radius:8px;font-weight:700;color:var(--brand);font-size:13px;}
.cat-thumb{width:40px;height:40px;object-fit:cover;border-radius:6px;background:var(--bg);border:1px solid var(--line);}
.cat-thumb-empty{width:40px;height:40px;border-radius:6px;background:var(--bg);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;color:#CBD5E1;font-size:16px;}
.cat-toolbar{display:flex;gap:8px;margin-bottom:12px;align-items:center;flex-wrap:wrap;}
.cat-toolbar .search,.search{flex:1;min-width:180px;padding:8px 12px;border:1px solid var(--line);border-radius:8px;font-family:inherit;font-size:13px;}
.cat-toolbar select{padding:8px 10px;border:1px solid var(--line);border-radius:8px;font-family:inherit;font-size:13px;}
.tab-intro{flex:1;color:var(--muted);font-size:12.5px;margin:0;line-height:1.5;min-width:200px;}
.bulk-box{display:flex;gap:8px;align-items:center;background:var(--warn-bg);border:1px solid #FCD34D;border-radius:10px;padding:10px 12px;margin-bottom:14px;flex-wrap:wrap;}
.bulk-title{font-size:13px;font-weight:600;color:var(--warn);}
.bulk-box select,.bulk-pct{padding:6px 9px;border:1px solid var(--line);border-radius:8px;font-family:inherit;font-size:13px;}
.bulk-pct{width:150px;background:#fff;}
.bulk-pct:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-soft);}
.bulk-hint{font-size:12px;color:var(--muted);}
.bulk-error{font-size:12px;color:var(--neg);font-weight:600;}
.cat-table{background:var(--surface);}
.cat-table .pos{color:var(--pos);font-weight:600;}
.cat-table .neg{color:var(--neg);font-weight:600;}
.badge-fixed{display:inline-block;margin-left:6px;font-size:10px;background:var(--brand-soft);color:var(--brand);padding:1px 6px;border-radius:999px;font-weight:600;}
.badge-shared{display:inline-block;margin-left:6px;font-size:10px;background:var(--warn-bg);color:#92400E;padding:1px 6px;border-radius:999px;font-weight:600;}
.hidden-nav{display:none !important;}
.tabs button svg{flex-shrink:0;}
.tag-ncc{display:inline-flex;align-items:center;font-size:10.5px;border-radius:999px;padding:2px 8px;font-weight:600;line-height:1.4;}
.tag-lumi{background:#ECFDF5;color:#1A7A4A;}
.tag-hik{background:#FEF2F2;color:#991B1B;}
.tag-ruijie,.tag-aptek{background:#F0FDF4;color:#166534;}
.tag-bisco,.tag-roger{background:#FFF7ED;color:#92400E;}
.settings{max-width:780px;}
.section-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-lg);margin-bottom:14px;overflow:hidden;}
.section-card-head{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid var(--line);font-size:14px;font-weight:600;}
.section-card-body{padding:16px;}
.ss-wrap{position:relative;width:100%;}
.ss-trigger{display:flex;align-items:center;gap:7px;width:100%;padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:var(--surface);cursor:pointer;font-family:inherit;font-size:13px;text-align:left;transition:border-color .15s;}
.ss-trigger:hover{border-color:var(--line2);}
.ss-trigger.ss-unmapped{border-color:var(--neg);background:var(--neg-bg);}
.ss-icon{flex-shrink:0;color:var(--muted);}
.ss-val{flex:1;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ss-placeholder{flex:1;color:var(--muted);}
.ss-dropdown{position:absolute;top:calc(100% + 4px);left:0;right:0;min-width:320px;background:var(--surface);border:1px solid var(--line2);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:100;overflow:hidden;}
.ss-search-bar{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line);background:var(--bg);}
.ss-search-inp{flex:1;border:none;background:transparent;font-family:inherit;font-size:13px;color:var(--ink);outline:none;}
.ss-clear{background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;padding:0 2px;line-height:1;}
.ss-list{max-height:260px;overflow-y:auto;}
.ss-item{display:flex;align-items:center;gap:9px;padding:8px 12px;cursor:pointer;font-size:13px;transition:background .1s;}
.ss-item:hover{background:var(--bg);}
.ss-item.ss-selected{background:var(--brand-soft);}
.ss-item.ss-item-empty{color:var(--muted);font-style:italic;border-bottom:1px solid var(--line);}
.ss-no-result{padding:12px;text-align:center;color:var(--muted);font-size:13px;}
.ss-thumb{width:32px;height:32px;object-fit:cover;border-radius:5px;flex-shrink:0;border:1px solid var(--line);}
.ss-item-info{flex:1;min-width:0;}
.ss-item-name{display:block;font-weight:500;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.row-actions{text-align:right;white-space:nowrap;}
.link{background:none;border:none;color:var(--brand);font-size:12.5px;font-weight:600;cursor:pointer;padding:0 5px;font-family:inherit;}
.link.danger{color:var(--neg);}
.swap-list{max-height:320px;overflow:auto;display:flex;flex-direction:column;gap:6px;margin-bottom:6px;}
.swap-list .picker-item.cur{border-color:var(--brand);background:var(--brand-soft);}
.takeoff{padding:0;}
.takeoff-head{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px;}
.takeoff-head h2{margin:0;font-size:15px;font-weight:600;}
.takeoff-stat{font-size:12px;color:var(--muted);font-weight:600;}
.map-table{width:100%;border-collapse:collapse;font-size:13px;}
.map-table th{text-align:left;color:var(--muted);font-size:11.5px;font-weight:600;padding:7px 8px;border-bottom:1px solid var(--line);background:var(--bg);}
.map-table td{padding:8px;border-bottom:1px solid var(--line);vertical-align:middle;}
.map-table .row-unmapped{background:var(--warn-bg);}
.map-select{width:100%;max-width:400px;padding:6px 9px;border:1px solid var(--line);border-radius:7px;font-family:inherit;font-size:13px;background:var(--surface);}
.takeoff-warn{font-size:12.5px;color:#9A3412;background:var(--warn-bg);border:1px solid #FCD34D;border-radius:8px;padding:8px 12px;margin-top:10px;line-height:1.5;}
.takeoff-preview-scroll{overflow-x:auto;}
.takeoff-preview-scroll .cat-table th,.takeoff-preview-scroll .cat-table td{white-space:nowrap;font-size:12px;padding:5px 8px;}
.mode-pick-btn{display:flex;flex-direction:column;align-items:flex-start;gap:8px;padding:16px;border:1.5px solid var(--line2);border-radius:var(--radius-lg);background:var(--surface);cursor:pointer;text-align:left;font-family:inherit;transition:all .15s;}
.mode-pick-btn:hover{border-color:var(--brand);background:var(--brand-soft);}
.mode-pick-btn:hover svg{stroke:var(--brand);}
.mode-pick-btn svg{color:var(--muted);transition:stroke .15s;}
.mpb-title{font-size:14px;font-weight:600;color:var(--ink);}
.mpb-sub{font-size:12.5px;color:var(--muted);line-height:1.5;}
.ai-drop-zone{border:2px dashed var(--line2);border-radius:var(--radius-lg);padding:36px 24px;text-align:center;cursor:pointer;background:var(--bg);transition:all .2s;}
.ai-drop-zone:hover{border-color:var(--brand);background:var(--brand-soft);}
.ai-drop-icon{font-size:32px;margin-bottom:8px;}
.ai-drop-text{font-size:14px;font-weight:600;color:var(--ink);margin-bottom:4px;}
.ai-drop-sub{font-size:12.5px;color:var(--muted);}
.ai-progress-wrap{margin:14px 0;}
.ai-progress-bar{height:8px;background:var(--line);border-radius:999px;overflow:hidden;}
.ai-progress-fill{height:100%;background:var(--brand);border-radius:999px;transition:width .4s;}
.ai-progress-label{margin-top:6px;font-size:12.5px;color:var(--muted);text-align:center;}
.ai-review-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;}
.ai-review-header h3{font-size:14px;font-weight:600;}
.ai-section-title{font-size:13px;font-weight:600;padding:8px 0;cursor:pointer;list-style:none;}
.ai-section-title::marker{display:none;}
.ai-ok{color:var(--pos);}
.ai-warn{color:var(--warn);}
.badge-conf-high{background:var(--pos-bg);color:var(--pos);padding:1px 7px;border-radius:999px;font-size:11px;font-weight:600;}
.badge-conf-medium{background:var(--warn-bg);color:var(--warn);padding:1px 7px;border-radius:999px;font-size:11px;font-weight:600;}
.badge-conf-low{background:var(--neg-bg);color:var(--neg);padding:1px 7px;border-radius:999px;font-size:11px;font-weight:600;}
.badge-ai{display:inline-block;font-size:10px;background:var(--brand-soft);color:var(--brand);border-radius:999px;padding:1px 6px;font-weight:600;margin-left:4px;}
.stats-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px;}
.stat-mini{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:10px;text-align:center;}
.stat-mini .n{font-size:20px;font-weight:700;}
.stat-mini .l{font-size:11px;color:var(--muted);margin-top:2px;}
.n-blue{color:var(--brand);}
.n-green{color:var(--pos);}
.n-red{color:var(--neg);}
.n-gray{color:var(--muted);}
.cat-img-dropzone{display:flex;align-items:center;gap:10px;padding:10px 14px;border:1.5px dashed var(--line2);border-radius:10px;font-size:13px;color:var(--muted);margin-bottom:12px;transition:all .2s;background:var(--bg);cursor:default;}
.cat-img-dropzone.dragging{border-color:var(--brand);background:var(--brand-soft);color:var(--brand);}
.cat-img-dropzone strong{color:var(--brand);margin-left:4px;}
.ci-tip-excel{margin-top:16px;padding:10px 14px;background:#FEF9E7;border:1px solid #FDE68A;border-radius:8px;font-size:12.5px;color:#92660E;line-height:1.5;max-width:480px;}
.ci-web-import-box{margin:18px auto 0;padding:14px;background:#F8FAFC;border:1px solid var(--line);border-radius:12px;max-width:760px;text-align:left;}
.ci-web-import-title{font-weight:700;font-size:14px;margin-bottom:10px;color:var(--text);}
.ci-web-import-row{display:grid;grid-template-columns:minmax(220px,1fr) 180px auto;gap:8px;align-items:center;}
.ci-web-import-row input{border:1px solid var(--line);border-radius:8px;padding:9px 10px;font-size:13px;font-family:inherit;background:#fff;color:var(--text);}
.ci-web-import-row input:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px rgba(37,99,235,.08);}
.ci-web-import-sub{font-size:12px;color:var(--muted);line-height:1.45;margin-top:8px;}
.ci-web-import-status{font-size:12px;color:#B45309;background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:8px 10px;margin-top:8px;}
@media (max-width:760px){.ci-web-import-row{grid-template-columns:1fr}.ci-web-import-row .btn-primary{justify-content:center}}
.ci-cache-note{margin-top:10px;padding:8px 12px;background:#EFF6FF;border-radius:7px;font-size:13px;color:#1E40AF;}
.ci-batch-log{margin-top:14px;display:flex;flex-direction:column;gap:6px;}
.ci-batch-line{font-size:13px;padding:8px 12px;border-radius:7px;background:var(--bg);color:var(--text2);}
.ci-batch-line.ok{background:#F0FDF4;color:#166534;}
.ci-batch-line.err{background:var(--neg-bg);color:var(--neg);}
.ci-img-import-box{background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:20px;margin-bottom:16px;text-align:left;}
.ci-img-import-title{font-size:14px;font-weight:600;margin-bottom:6px;}
.ci-img-import-sub{font-size:13px;color:var(--muted);margin-bottom:12px;line-height:1.6;}
.ci-img-import-sub code{background:var(--surface2);padding:1px 5px;border-radius:4px;font-size:12px;}
.ci-img-drop{border:1.5px dashed var(--line2);border-radius:10px;padding:20px;text-align:center;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:6px;font-size:13px;color:var(--muted);transition:all .2s;}
.ci-img-drop:hover,.ci-img-drop.ci-dragging{border-color:var(--brand);background:var(--brand-soft);color:var(--brand);}
.ci-img-status{margin-top:10px;font-size:13px;color:var(--brand);font-weight:500;}
.catalog-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:80px 24px;text-align:center;gap:16px;}
.catalog-empty-icon{font-size:56px;opacity:.4;}
.catalog-empty h3{font-size:20px;font-weight:700;margin:0;color:var(--ink);}
.catalog-empty p{font-size:14px;color:var(--muted);margin:0;max-width:440px;line-height:1.6;}
.btn-cleanup{background:#FEF3F2;color:#B42318;border:1px solid #FECDCA;padding:7px 12px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap;}
.btn-cleanup:hover{background:#FEE4E2;}
.btn-import-catalog{background:#F0FDF4;color:#166534;border:1px solid #86EFAC;padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap;}
.btn-import-catalog:hover{background:#DCFCE7;}
.ci-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px;}
.ci-modal{background:var(--surface);border-radius:16px;width:min(1180px,96vw);height:min(900px,92vh);min-width:min(760px,96vw);min-height:560px;max-width:98vw;max-height:96vh;display:flex;flex-direction:column;overflow:hidden;resize:both;box-shadow:0 24px 64px rgba(0,0,0,.18);}
.ci-head{display:flex;align-items:flex-start;justify-content:space-between;padding:20px 24px 16px;border-bottom:1px solid var(--line);}
.ci-title{font-size:17px;font-weight:700;margin:0 0 2px;}
.ci-sub{font-size:13px;color:var(--muted);margin:0;}
.ci-close{background:none;border:none;font-size:18px;color:var(--muted);cursor:pointer;padding:4px 8px;border-radius:6px;}
.ci-close:hover{background:var(--bg);color:var(--ink);}
.ci-drop{border:2px dashed var(--line2);border-radius:12px;padding:40px 24px;text-align:center;cursor:pointer;margin:20px 24px;transition:all .2s;}
.ci-drop:hover,.ci-dragging{border-color:var(--brand);background:var(--brand-soft);}
.ci-drop-icon{font-size:40px;margin-bottom:12px;}
.ci-drop-title{font-size:16px;font-weight:600;margin-bottom:6px;}
.ci-drop-sub{font-size:13px;color:var(--muted);margin-bottom:14px;}
.ci-drop-examples{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;font-size:12px;color:var(--brand);}
.ci-body{padding:20px 24px;overflow:auto;flex:1;}
.ci-file-badge{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px 12px;font-size:13px;font-weight:500;margin-bottom:12px;display:inline-block;}
.ci-ai-status{font-size:13px;padding:8px 12px;border-radius:8px;background:var(--brand-soft);color:var(--brand);margin-bottom:12px;}
.ci-ai-status.ok{background:#F0FDF4;color:#166534;}
.ci-hint{font-size:13px;color:var(--muted);margin-bottom:12px;}
.ci-row-range-box{display:flex;align-items:end;gap:10px;flex-wrap:wrap;background:#F8FAFC;border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:0 0 14px;}
.ci-row-range-title{font-size:12px;font-weight:800;color:var(--text2);margin-right:4px;align-self:center;}
.ci-row-range-box label{display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:700;color:var(--text2);}
.ci-row-range-box input{width:110px;border:1px solid var(--line);border-radius:7px;padding:7px 9px;font-family:inherit;font-size:13px;background:#fff;color:var(--text);}
.ci-row-range-box span{font-size:12px;color:var(--muted);align-self:center;}
.ci-import-plan{background:#EFF6FF;border:1px solid #BFDBFE;color:#1E3A8A;border-radius:8px;padding:9px 12px;font-size:12.5px;line-height:1.5;margin:-2px 0 12px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;}
.ci-jump-btn{border:1px solid #BFDBFE;background:#fff;color:#1D4ED8;border-radius:8px;padding:7px 10px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;white-space:nowrap;}
.ci-jump-btn.danger{border-color:#FCA5A5;background:#FEF2F2;color:#B42318;}
.ci-jump-btn:hover{filter:brightness(.98);}
.ci-map-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;}
.ci-map-row{display:flex;flex-direction:column;gap:4px;}
.ci-map-label{font-size:12px;font-weight:500;color:var(--text2);}
.ci-req{color:var(--neg);margin-left:2px;}
.ci-map-select{padding:7px 10px;border:1px solid var(--line);border-radius:7px;font-family:inherit;font-size:13px;background:var(--surface);}
.ci-select-err{border-color:var(--neg);}
.ci-preview-mini{background:var(--bg);border-radius:8px;padding:12px;margin-bottom:16px;overflow-x:auto;}
.ci-preview-title{font-size:12px;font-weight:500;color:var(--muted);margin-bottom:8px;}
.ci-preview-table{width:100%;border-collapse:collapse;font-size:12px;}
.ci-preview-table th{background:var(--brand);color:#fff;padding:6px 8px;text-align:left;font-weight:500;position:sticky;top:0;z-index:1;}
.ci-preview-table td{padding:5px 8px;border-bottom:1px solid var(--line);vertical-align:top;}
.ci-preview-table tr:last-child td{border-bottom:none;}
.ci-stats-row{display:flex;gap:12px;margin-bottom:16px;}
.ci-stat{flex:1;background:var(--bg);border-radius:10px;padding:14px;text-align:center;display:flex;flex-direction:column;gap:4px;}
.ci-stat-n{font-size:26px;font-weight:700;color:var(--brand);}
.ci-stat span{font-size:12px;color:var(--muted);}
.ci-import-summary{border:1px solid var(--line);background:#F8FAFC;border-radius:10px;padding:10px 12px;margin:-4px 0 14px;font-size:12.5px;color:var(--text2);display:flex;flex-direction:column;gap:8px;}
.ci-summary-pills{display:flex;gap:8px;flex-wrap:wrap;}
.ci-summary-pills span,.ci-summary-pills button{padding:3px 8px;border-radius:999px;font-weight:600;font-size:11.5px;border:0;font-family:inherit;}
.ci-summary-pills button{cursor:pointer;}
.ci-summary-pills button:hover{filter:brightness(.96);}
.ci-summary-pills .ok,.ci-status.ok{background:#F0FDF4;color:#166534;}
.ci-summary-pills .warn,.ci-status.warn{background:#FEF9E7;color:#92660E;}
.ci-summary-pills .err,.ci-status.err{background:#FEF2F2;color:#B42318;}
.ci-summary-pills .muted,.ci-status.muted{background:var(--bg);color:var(--muted);}
.ci-error-nav{display:flex;gap:6px;margin-left:auto;}
.ci-error-nav button{border:1px solid #FCA5A5;background:#FEF2F2;color:#B42318;border-radius:999px;padding:7px 10px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;}
.ci-error-nav button:disabled{opacity:.45;cursor:not-allowed;background:#F8FAFC;color:var(--muted);border-color:var(--line);}
.ci-row-blocking td{background:#FFF1F2;}
.ci-row-review td{background:#FFFBEB;}
.ci-row-focus td{box-shadow:inset 0 2px 0 #EF4444, inset 0 -2px 0 #EF4444;}
.ci-row-focus td:first-child{box-shadow:inset 3px 0 0 #EF4444, inset 0 2px 0 #EF4444, inset 0 -2px 0 #EF4444;}
.ci-warnings{font-size:12px;color:#92660E;display:flex;flex-direction:column;gap:3px;}
.ci-status{display:inline-block;padding:2px 7px;border-radius:999px;font-size:11px;font-weight:700;white-space:nowrap;background:var(--bg);color:var(--text2);}
.ci-source{font-size:10.5px;color:var(--muted);font-weight:400;margin-top:2px;}
.ci-issues{font-size:11px;color:var(--muted);min-width:110px;}

.ci-review-help{background:#FFFBEB;border:1px solid #FDE68A;color:#7C4A03;border-radius:8px;padding:10px 12px;font-size:12.5px;line-height:1.55;margin:-2px 0 12px;}
.ci-review-help-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;}
.btn-approve-all{border:1px solid #86EFAC;background:#F0FDF4;color:#166534;border-radius:8px;padding:7px 12px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;white-space:nowrap;}
.btn-approve-all:hover{background:#DCFCE7;}
.ci-footer-actions{display:flex;align-items:center;justify-content:flex-end;gap:10px;flex-wrap:wrap;}
.btn-approve-all-footer{color:#166534;border-color:#86EFAC;background:#F0FDF4;}
.ci-row-actions{display:flex;gap:5px;flex-wrap:wrap;min-width:118px;}
.ci-row-actions button{border:1px solid var(--line);background:#fff;color:var(--brand);border-radius:6px;padding:4px 7px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;}
.ci-row-actions button:hover{background:var(--brand-soft);}
.ci-row-actions button.danger{color:var(--neg);}
.ci-row-actions button.danger:hover{background:#FEF2F2;border-color:#FECACA;}
.ci-edit-panel{border:1px solid var(--line);background:#F8FAFC;border-radius:10px;padding:12px;margin:12px 0 16px;}
.ci-edit-title{font-weight:800;font-size:13px;margin-bottom:10px;color:var(--text);}
.ci-edit-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px;}
.ci-edit-grid label,.ci-edit-specs{display:flex;flex-direction:column;gap:5px;font-size:11px;font-weight:700;color:var(--text2);}
.ci-edit-grid input,.ci-edit-specs textarea{border:1px solid var(--line);border-radius:7px;padding:8px 9px;font-family:inherit;font-size:13px;background:#fff;color:var(--text);}
.ci-edit-specs textarea{min-height:64px;resize:vertical;}
.ci-edit-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:10px;}
.ci-merge-toggle{display:flex;align-items:center;gap:16px;padding:12px 14px;background:var(--bg);border-radius:8px;margin-bottom:14px;flex-wrap:wrap;}
.ci-radio{display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;}
.ci-preview-scroll{max-height:48vh;min-height:300px;overflow:auto;border:1px solid var(--line);border-radius:8px;margin-bottom:16px;}
.ci-more{text-align:center;padding:10px;font-size:13px;color:var(--muted);background:var(--bg);}
.ci-footer{display:flex;justify-content:space-between;align-items:center;padding-top:14px;border-top:1px solid var(--line);margin-top:4px;}
.btn-img-auto{background:var(--pos-bg);color:var(--pos);border:1px solid #86EFAC;padding:7px 12px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap;}
.btn-img-auto:hover:not(:disabled){background:#DCFCE7;}
.btn-img-auto:disabled{opacity:.6;cursor:wait;}
.auto-img-bar{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin-bottom:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;}
.auto-img-progress{flex:1;min-width:100px;height:6px;background:var(--line);border-radius:999px;overflow:hidden;}
.auto-img-fill{height:100%;background:var(--pos);border-radius:999px;transition:width .3s;}
.api-guide{background:var(--bg);border-left:3px solid var(--brand);padding:12px 14px;margin-top:10px;font-size:12.5px;line-height:1.9;}
.api-guide ol{margin:4px 0 10px 16px;}
.api-guide p{margin-bottom:4px;}
.api-guide a{color:var(--brand);}
details summary::-webkit-details-marker{color:var(--brand);}
.backup-warning{padding:12px 14px;background:#FEF9E7;border:1px solid #FDE68A;border-radius:8px;font-size:13px;color:#92660E;line-height:1.6;margin-bottom:12px;}
.backup-stats{display:flex;gap:14px;margin-bottom:12px;flex-wrap:wrap;}
.backup-stats span{font-size:13px;color:var(--text2);background:var(--bg);padding:6px 12px;border-radius:7px;}
.settings-actions{display:flex;gap:10px;flex-wrap:wrap;}
.settings-actions .btn-primary{width:auto;}
.markup-box{background:var(--warn-bg);border:1px solid #FCD34D;border-radius:10px;padding:10px 12px;margin-bottom:12px;}
.markup-label{font-size:12px;font-weight:600;color:var(--warn);margin-bottom:6px;}
.markup-select{width:100%;padding:7px 9px;border:1px solid var(--line);border-radius:8px;font-family:inherit;font-size:13px;font-weight:600;color:var(--brand);cursor:pointer;background:var(--surface);}
.markup-row{display:flex;align-items:center;gap:8px;margin-bottom:8px;}
.markup-name-input{flex:1;padding:7px 10px;border:1px solid var(--line);border-radius:8px;font-family:inherit;font-size:13px;}
.markup-x{color:var(--muted);font-weight:600;}
.markup-val-input{width:72px;padding:7px 9px;border:1px solid var(--line);border-radius:8px;font-family:inherit;font-size:13px;text-align:center;}
.imp-sub{margin:16px 0 6px;font-size:13px;color:var(--muted);}
.imp-scroll{max-height:240px;overflow:auto;border:1px solid var(--line);border-radius:8px;}
.imp-scroll.short{max-height:140px;}
.imp-scroll .cat-table th{position:sticky;top:0;background:var(--surface);}
.imp-options{margin-top:14px;display:flex;flex-direction:column;gap:10px;}
.chk{display:flex;align-items:center;gap:9px;font-size:13px;cursor:pointer;}
.chk input{width:16px;height:16px;cursor:pointer;}
.modal-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.4);display:flex;align-items:center;justify-content:center;z-index:50;padding:20px;}
.modal{background:var(--surface);border-radius:14px;padding:22px;width:100%;max-width:480px;max-height:90vh;overflow:auto;}
.modal.wide{max-width:740px;}
.modal h2{margin:0 0 16px;font-size:17px;font-weight:600;}
.modal-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px;}
.modal-actions .btn-primary{width:auto;}
.tpl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;}
.tpl-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-lg);padding:14px;}
.tpl-card-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;}
.tpl-card-head h3{margin:0;font-size:14px;font-weight:600;}
.tpl-total{font-weight:700;color:var(--brand);font-size:13px;}
.tpl-items{list-style:none;padding:0;margin:0;font-size:12.5px;}
.tpl-items li{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line);}
.tpl-card-actions{margin-top:10px;display:flex;gap:6px;justify-content:flex-end;}
.tpl-editor-cols{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:14px;}
.tpl-editor-cols h4{margin:0 0 8px;font-size:12.5px;color:var(--muted);}
.tpl-edit-items{list-style:none;padding:0;margin:0;}
.tpl-edit-items li{display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--line);}
.tei-name{flex:1;font-size:12.5px;}
.tpl-pick-list{max-height:260px;overflow:auto;display:flex;flex-direction:column;gap:6px;margin-top:8px;}
.ask-grid{display:grid;grid-template-columns:1fr 280px;gap:16px;align-items:start;}
.ask-side{position:sticky;top:68px;}
.ask-add-row{display:flex;gap:8px;margin-bottom:10px;}
.ask-catalog-search{margin-bottom:4px;}
.ask-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;}
.ask-chip{display:inline-flex;align-items:center;gap:6px;background:var(--brand-soft);color:var(--brand);border-radius:999px;padding:4px 6px 4px 11px;font-size:12.5px;font-weight:600;}
.ask-chip button{background:none;border:none;color:var(--brand);font-size:15px;cursor:pointer;line-height:1;padding:0 2px;}
.ask-msg{width:100%;border:1px solid var(--line);border-radius:9px;padding:10px 12px;font-size:13px;font-family:inherit;line-height:1.6;resize:vertical;background:var(--bg);}
.ask-actions{display:flex;gap:8px;margin-top:10px;}
.ask-actions .btn-primary,.ask-actions .btn-excel{width:auto;flex:1;}
.ncc-info{font-size:13px;line-height:1.7;padding:10px 0;border-top:1px solid var(--line);}
.ncc-info-actions{display:flex;gap:8px;margin-top:6px;}
.section-title{font-size:17px;font-weight:700;margin:0 0 16px;}
@media (max-width:900px){
  .ask-grid,.quote-grid{grid-template-columns:1fr;}
  .ask-side,.quote-side{position:static;}
  .field-grid{grid-template-columns:1fr;}
  .tpl-editor-cols{grid-template-columns:1fr;}
  .picker-list{grid-template-columns:1fr;}
  .tabs{overflow-x:auto;}
  .main{padding:12px;}
}

.ci-template-library{border:1px solid #D6E4FF;background:#F8FBFF;border-radius:12px;padding:12px 14px;margin:12px 0;}
.ci-template-library-title{font-weight:900;color:#1E3A8A;font-size:14px;margin-bottom:8px;}
.ci-template-library-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
.ci-template-library-row select{min-width:280px;flex:1;border:1px solid #CBD5E1;border-radius:10px;padding:8px 10px;background:#fff;font-family:inherit;}
.ci-template-library-sub{margin-top:6px;font-size:12px;color:var(--muted);}
.ci-learning-note{border:1px solid #86EFAC;background:#F0FDF4;color:#166534;border-radius:10px;padding:10px 12px;margin:10px 0;font-weight:800;}
.ci-learning-mini{border:1px solid #E0E7FF;background:#EEF2FF;color:#3730A3;border-radius:10px;padding:8px 12px;margin:10px 0;font-size:13px;font-weight:700;}
.btn-ghost.danger{color:#DC2626;border-color:#FECACA;background:#FFF7F7;}
.btn-ghost.danger:hover{background:#FEE2E2;}

/* Phase 3.16 — clean import preview redesign */
.ci-body{padding:18px 20px;}
.ci-import-hero{display:flex;align-items:center;justify-content:space-between;gap:16px;border:1px solid var(--line);border-radius:16px;padding:16px 18px;margin-bottom:12px;background:#F8FAFC;}
.ci-import-hero.ok{background:linear-gradient(180deg,#F0FDF4,#FFFFFF);border-color:#BBF7D0;}
.ci-import-hero.warn{background:linear-gradient(180deg,#FFFBEB,#FFFFFF);border-color:#FDE68A;}
.ci-import-hero.danger{background:linear-gradient(180deg,#FEF2F2,#FFFFFF);border-color:#FECACA;}
.ci-import-hero-kicker{text-transform:uppercase;letter-spacing:.05em;font-size:11px;font-weight:800;color:var(--muted);margin-bottom:3px;}
.ci-import-hero h3{font-size:18px;line-height:1.25;margin:0 0 6px;color:var(--ink);}
.ci-import-hero p{margin:0;font-size:13px;color:var(--text2);line-height:1.55;}
.ci-import-hero-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;}
.ci-primary-action{border:0;border-radius:11px;padding:10px 14px;font-size:13px;font-weight:900;cursor:pointer;font-family:inherit;white-space:nowrap;color:#fff;background:var(--brand);box-shadow:0 8px 20px rgba(18,169,116,.16);}
.ci-primary-action.ok{background:#15803D;}
.ci-primary-action.warn{background:#B45309;}
.ci-primary-action.danger{background:#B42318;}
.ci-primary-action:hover{filter:brightness(.97);transform:translateY(-1px);}
.ci-processing-details{border:1px solid var(--line);border-radius:12px;background:#fff;margin:0 0 12px;overflow:hidden;}
.ci-processing-details summary{cursor:pointer;list-style:none;padding:10px 12px;font-size:13px;font-weight:800;color:var(--text2);display:flex;align-items:center;gap:8px;}
.ci-processing-details summary:before{content:'▸';font-size:11px;color:var(--muted);transition:transform .15s;}
.ci-processing-details[open] summary:before{transform:rotate(90deg);}
.ci-processing-details summary::-webkit-details-marker{display:none;}
.ci-detail-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;border-top:1px solid var(--line);padding:12px;}
.ci-detail-grid div{background:#F8FAFC;border:1px solid #EEF2F7;border-radius:9px;padding:8px 10px;min-width:0;}
.ci-detail-grid span{display:block;font-size:11px;color:var(--muted);margin-bottom:2px;}
.ci-detail-grid strong{display:block;font-size:12px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ci-learning-note.compact,.ci-warnings.compact{margin:0 12px 12px;font-size:12px;padding:8px 10px;}
.ci-import-controls{display:flex;align-items:center;justify-content:space-between;gap:12px;background:#F8FAFC;border:1px solid #EEF2F7;border-radius:12px;padding:10px 12px;margin-bottom:10px;}
.ci-merge-choice{display:flex;align-items:center;gap:12px;flex-wrap:wrap;}
.ci-merge-choice>span{font-size:12px;font-weight:900;color:var(--text2);}
.ci-control-actions{display:flex;gap:8px;align-items:center;}
.ci-preview-tabs{display:flex;align-items:center;gap:6px;margin-bottom:10px;flex-wrap:wrap;}
.ci-preview-tabs button{border:1px solid var(--line);background:#fff;color:var(--text2);border-radius:999px;padding:6px 10px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:6px;}
.ci-preview-tabs button span{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;border-radius:999px;background:#F1F5F9;color:var(--muted);font-size:11px;padding:0 5px;}
.ci-preview-tabs button.active{border-color:var(--brand);background:var(--brand-soft);color:var(--brand);}
.ci-preview-tabs button.active span{background:#fff;color:var(--brand);}
.ci-preview-tabs button.danger{border-color:#FECACA;color:#B42318;background:#FFF7F7;}
.ci-tab-spacer{flex:1;}
.ci-mini-danger,.ci-mini-ok{border-radius:999px!important;font-weight:900!important;}
.ci-mini-danger{border-color:#FCA5A5!important;background:#FEF2F2!important;color:#B42318!important;}
.ci-mini-ok{border-color:#86EFAC!important;background:#F0FDF4!important;color:#166534!important;}
.ci-review-copy{background:#FFFBEB;border:1px solid #FDE68A;color:#7C4A03;border-radius:12px;padding:9px 11px;font-size:12.5px;line-height:1.5;margin-bottom:10px;}
.ci-preview-scroll.compact{max-height:54vh;min-height:360px;border-radius:12px;}
.ci-preview-table-clean{font-size:12.5px;}
.ci-preview-table-clean th{background:#0F7D4F;padding:9px 10px;font-size:12px;font-weight:900;}
.ci-preview-table-clean td{padding:10px;border-bottom:1px solid #EAF0F5;}
.ci-row-num{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:12px;font-weight:800;}
.ci-dot{width:9px;height:9px;border-radius:50%;background:#CBD5E1;display:inline-block;}
.ci-dot.ok{background:#22C55E;}
.ci-dot.warn{background:#F59E0B;}
.ci-dot.err{background:#EF4444;}
.ci-dot.muted{background:#94A3B8;}
.ci-product-cell{min-width:280px;}
.ci-product-name{font-weight:900;color:var(--ink);line-height:1.35;margin-bottom:3px;}
.ci-product-meta{font-size:11.5px;color:var(--muted);line-height:1.35;}
.ci-sku-cell{font-size:12px;color:#475569;font-weight:700;white-space:nowrap;}
.ci-price-cell{text-align:right;white-space:nowrap;font-weight:900;color:var(--ink);}
.ci-price-cell small{display:block;color:var(--muted);font-size:11px;font-weight:700;margin-top:2px;}
.ci-issues.clean{font-size:12px;line-height:1.45;color:#64748B;min-width:170px;max-width:320px;}
.ci-row-actions.clean{min-width:104px;gap:5px;}
.ci-row-actions.clean button{padding:5px 8px;border-radius:8px;font-size:11.5px;background:#fff;}
.ci-footer{position:sticky;bottom:0;background:var(--surface);z-index:2;padding:12px 0 0;margin-top:10px;}
@media (max-width:900px){
  .ci-import-hero,.ci-import-controls{align-items:flex-start;flex-direction:column;}
  .ci-import-hero-actions,.ci-control-actions{width:100%;justify-content:flex-start;}
  .ci-detail-grid{grid-template-columns:1fr 1fr;}
  .ci-preview-table-clean th:nth-child(3),.ci-preview-table-clean td:nth-child(3){display:none;}
}


/* BOM Phase 1 — preview parser */
.mode-pick-primary{border-color:#86EFAC!important;background:linear-gradient(180deg,#F0FDF4,#FFFFFF)!important;}
.bom-preview-card{display:flex;flex-direction:column;gap:14px;}
.bom-topline{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;}
.bom-drop-zone{border:1.5px dashed #CBD5E1;background:#F8FAFC;border-radius:14px;padding:34px 20px;text-align:center;cursor:pointer;transition:.16s;}
.bom-drop-zone:hover{border-color:var(--brand);background:#F0FDF4;}
.bom-summary-box{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;border:1px solid #BBF7D0;background:linear-gradient(180deg,#F0FDF4,#FFFFFF);border-radius:16px;padding:16px;}
.bom-summary-title{font-size:18px;font-weight:900;color:#14532D;margin-bottom:4px;}
.bom-summary-sub{font-size:13px;color:#166534;line-height:1.5;}
.bom-summary-areas{font-size:12px;color:#64748B;margin-top:6px;line-height:1.5;}
.bom-summary-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end;}
.bom-summary-actions .btn-primary:disabled{opacity:.75;cursor:not-allowed;background:#94A3B8;}
.bom-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;}
.bom-metrics div{border:1px solid #EEF2F7;background:#F8FAFC;border-radius:12px;padding:12px;text-align:center;}
.bom-metrics strong{display:block;font-size:24px;color:var(--ink);}
.bom-metrics span{display:block;font-size:12px;color:var(--muted);margin-top:2px;}
.bom-details{border:1px solid var(--line);border-radius:12px;background:#fff;overflow:hidden;}
.bom-details summary{cursor:pointer;padding:10px 12px;font-size:13px;font-weight:800;color:var(--text2);}
.bom-detail-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:12px;border-top:1px solid var(--line);}
.bom-detail-chip{background:#F8FAFC;border:1px solid #EEF2F7;border-radius:9px;padding:8px 10px;}
.bom-detail-chip strong{display:block;font-size:12px;color:var(--text);}
.bom-detail-chip span{display:block;font-size:11px;color:var(--muted);margin-top:2px;}
.bom-toolbar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;}
.bom-toolbar button{border:1px solid var(--line);background:#fff;border-radius:999px;padding:7px 11px;font-size:12px;font-weight:800;color:var(--text2);cursor:pointer;font-family:inherit;}
.bom-toolbar button.active{border-color:var(--brand);background:var(--brand-soft);color:var(--brand);}
.bom-table-wrap{border:1px solid var(--line);border-radius:12px;overflow:auto;max-height:56vh;background:#fff;}
.bom-preview-table{width:100%;border-collapse:collapse;font-size:12.5px;}
.bom-preview-table th{position:sticky;top:0;background:#0F7D4F;color:#fff;text-align:left;padding:10px;font-size:12px;z-index:1;}
.bom-preview-table td{padding:10px;border-bottom:1px solid #EAF0F5;vertical-align:top;}
.bom-row-review td{background:#FFFBEB;}
.bom-status{display:inline-block;border-radius:999px;padding:3px 8px;font-size:11px;font-weight:900;white-space:nowrap;}
.bom-status.ready{background:#F0FDF4;color:#166534;}
.bom-status.need_review{background:#FEF3C7;color:#92400E;}
.bom-preview-table .muted{color:var(--muted);font-size:11.5px;}
@media (max-width:900px){
  .bom-summary-box,.bom-topline{flex-direction:column;}
  .bom-metrics,.bom-detail-grid{grid-template-columns:1fr 1fr;}
  .bom-preview-table th:nth-child(6),.bom-preview-table td:nth-child(6),.bom-preview-table th:nth-child(7),.bom-preview-table td:nth-child(7){display:none;}
}

/* BOM Phase 2 — catalog matching + resolve UI */
.bom-phase2-summary{border-color:#BFDBFE;background:linear-gradient(180deg,#EFF6FF,#FFFFFF);} 
.bom-phase2-summary .bom-summary-title{color:#1E3A8A;}
.bom-phase2-summary .bom-summary-sub{color:#1D4ED8;}
.bom-phase2-metrics{grid-template-columns:repeat(4,minmax(0,1fr));}
.bom-resolve-hint{border:1px solid #FDE68A;background:#FFFBEB;color:#92400E;border-radius:12px;padding:11px 12px;font-size:13px;line-height:1.45;}
.bom-status.matched{background:#DBEAFE;color:#1D4ED8;}
.bom-status.ignored{background:#F1F5F9;color:#64748B;}
.bom-match-table th:nth-child(6),.bom-match-table td:nth-child(6){min-width:310px;}
.bom-suggestions{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px;}
.bom-suggestions button{border:1px solid #DDE7F0;background:#fff;border-radius:999px;padding:4px 8px;font-size:11px;font-weight:750;color:#334155;cursor:pointer;max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bom-suggestions button:hover{border-color:var(--brand);background:#F0FDF4;color:var(--brand);}
.bom-suggestions button.selected{border-color:#2563EB;background:#EFF6FF;color:#1D4ED8;}
.bom-suggestions span{color:#64748B;margin-left:4px;}
.bom-row-actions{margin-top:8px;display:flex;gap:6px;}
.btn-mini{border:1px solid var(--line);background:#fff;border-radius:8px;padding:4px 7px;font-size:11px;font-weight:850;cursor:pointer;font-family:inherit;color:var(--text2);}
.btn-mini.danger{border-color:#FECACA;color:#B91C1C;background:#FEF2F2;}
@media(max-width:720px){.bom-match-table th:nth-child(5),.bom-match-table td:nth-child(5){display:none}.bom-phase2-metrics{grid-template-columns:1fr 1fr;}}

/* BOM Phase 3 — discipline + scope extraction */
.bom-scope-section{border:1px solid #DDEAFE;background:#F8FBFF;border-radius:14px;padding:13px;display:flex;flex-direction:column;gap:11px;}
.bom-scope-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;}
.bom-scope-header strong{display:block;font-size:14px;color:#0F172A;margin-bottom:2px;}
.bom-scope-header span{display:block;font-size:12px;color:#64748B;line-height:1.4;}
.bom-scope-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;}
.bom-scope-card{text-align:left;border:1px solid #DDEAFE;background:#fff;border-radius:12px;padding:11px;cursor:pointer;font-family:inherit;display:flex;flex-direction:column;gap:4px;min-height:108px;transition:.16s;}
.bom-scope-card:hover{border-color:#2563EB;box-shadow:0 6px 20px rgba(37,99,235,.08);transform:translateY(-1px);}
.bom-scope-card.active{border-color:#2563EB;background:#EFF6FF;box-shadow:0 0 0 2px rgba(37,99,235,.08) inset;}
.bom-scope-card.supporting{background:#F8FAFC;border-color:#E2E8F0;}
.bom-scope-title{font-size:13px;font-weight:900;color:#0F172A;line-height:1.25;}
.bom-scope-card.supporting .bom-scope-title{color:#475569;}
.bom-scope-meta{font-size:11.5px;color:#1D4ED8;font-weight:800;}
.bom-scope-vendors{font-size:11.5px;color:#166534;line-height:1.3;}
.bom-scope-samples{font-size:11px;color:#64748B;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.bom-grouping-toggle{display:inline-flex;border:1px solid #DDE7F0;background:#fff;border-radius:999px;padding:3px;gap:2px;}
.bom-grouping-toggle button{border:0;background:transparent;border-radius:999px;padding:6px 9px;font-size:11.5px;font-weight:850;color:#64748B;cursor:pointer;font-family:inherit;white-space:nowrap;}
.bom-grouping-toggle button.active{background:#DBEAFE;color:#1D4ED8;}
@media(max-width:960px){.bom-scope-grid{grid-template-columns:1fr 1fr;}.bom-summary-actions{align-items:flex-start;justify-content:flex-start;}}
@media(max-width:640px){.bom-scope-grid{grid-template-columns:1fr;}.bom-scope-header{flex-direction:column;}.bom-grouping-toggle{width:100%;}.bom-grouping-toggle button{flex:1;}}

/* BOM Phase 4 — solution pack matching */
.bom-pack-section{border:1px solid #C7D2FE;background:linear-gradient(180deg,#EEF2FF,#FFFFFF);border-radius:14px;padding:13px;display:flex;flex-direction:column;gap:11px;}
.bom-pack-list{display:flex;flex-direction:column;gap:10px;}
.bom-pack-row{border:1px solid #E0E7FF;background:#fff;border-radius:13px;padding:10px;display:grid;grid-template-columns:180px minmax(0,1fr) auto;gap:10px;align-items:start;}
.bom-pack-scope{border:0;background:transparent;text-align:left;font-family:inherit;cursor:pointer;padding:2px;}
.bom-pack-scope strong{display:block;font-size:13px;color:#1E1B4B;line-height:1.25;margin-bottom:3px;}
.bom-pack-scope span{display:block;font-size:11.5px;color:#64748B;line-height:1.35;}
.bom-pack-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;}
.bom-pack-card{border:1px solid #E0E7FF;background:#FAFBFF;border-radius:11px;padding:10px;text-align:left;font-family:inherit;cursor:pointer;min-height:118px;display:flex;flex-direction:column;gap:4px;transition:.16s;}
.bom-pack-card:hover{border-color:#6366F1;box-shadow:0 6px 18px rgba(99,102,241,.10);transform:translateY(-1px);}
.bom-pack-card.active{border-color:#4F46E5;background:#EEF2FF;box-shadow:0 0 0 2px rgba(79,70,229,.08) inset;}
.bom-pack-title{font-size:13px;font-weight:950;color:#111827;line-height:1.25;}
.bom-pack-meta{font-size:11.5px;color:#4338CA;font-weight:850;}
.bom-pack-rationale{font-size:11px;color:#64748B;line-height:1.35;min-height:30px;}
.bom-pack-products{font-size:11px;color:#166534;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.bom-pack-actions{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:auto;font-size:10.5px;color:#64748B;}
.bom-pack-actions em{font-style:normal;border-radius:999px;background:#E0E7FF;color:#3730A3;padding:2px 6px;font-weight:850;}
.bom-pack-row-actions{display:flex;align-items:flex-start;justify-content:flex-end;}
@media(max-width:1080px){.bom-pack-row{grid-template-columns:1fr;}.bom-pack-row-actions{justify-content:flex-start}.bom-pack-options{grid-template-columns:1fr 1fr;}}
@media(max-width:720px){.bom-pack-options{grid-template-columns:1fr;}}


/* BOM Phase 5 — quote composer A/B/C */
.bom-quote-composer{border:1px solid #FED7AA;background:linear-gradient(180deg,#FFF7ED,#FFFFFF);border-radius:14px;padding:13px;display:flex;flex-direction:column;gap:11px;}
.bom-variant-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;}
.bom-variant-card{border:1px solid #FDBA74;background:#fff;border-radius:13px;padding:12px;text-align:left;font-family:inherit;cursor:pointer;display:flex;flex-direction:column;gap:8px;transition:.16s;min-height:150px;}
.bom-variant-card:hover{border-color:#F97316;box-shadow:0 8px 22px rgba(249,115,22,.10);transform:translateY(-1px);}
.bom-variant-card.active{border-color:#EA580C;background:#FFF7ED;box-shadow:0 0 0 2px rgba(234,88,12,.10) inset;}
.bom-variant-head{display:flex;gap:10px;align-items:flex-start;}
.bom-variant-letter{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:10px;background:#FFEDD5;color:#9A3412;font-weight:950;font-size:14px;flex:0 0 auto;}
.bom-variant-head strong{display:block;font-size:14px;color:#111827;line-height:1.2;}
.bom-variant-head small{display:block;font-size:11.5px;color:#64748B;line-height:1.35;margin-top:2px;}
.bom-variant-total{font-size:20px;font-weight:950;color:#9A3412;margin-top:2px;}
.bom-variant-meta{display:flex;gap:6px;flex-wrap:wrap;font-size:11px;color:#64748B;}
.bom-variant-meta span{border:1px solid #FED7AA;background:#FFF7ED;border-radius:999px;padding:3px 7px;font-weight:800;}
.bom-variant-warn{font-size:11.5px;color:#92400E;background:#FEF3C7;border:1px solid #FDE68A;border-radius:8px;padding:6px 8px;margin-top:auto;}
.bom-variant-note{font-size:12.5px;color:#92400E;background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;padding:9px 10px;line-height:1.45;}
@media(max-width:960px){.bom-variant-grid{grid-template-columns:1fr;}}


/* BOM Phase 6 — pack template builder */
.bom-template-summary{border:1px solid #D1FAE5;background:#F0FDF4;border-radius:9px;padding:7px 8px;margin-top:4px;display:flex;flex-direction:column;gap:3px;}
.bom-template-summary strong{font-size:11.5px;color:#14532D;line-height:1.25;}
.bom-template-summary span{font-size:10.5px;color:#166534;font-weight:800;}
.bom-template-components{display:flex;gap:4px;flex-wrap:wrap;margin-top:2px;}
.bom-template-components em{font-style:normal;border-radius:999px;padding:2px 6px;font-size:10px;font-weight:850;max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bom-template-components em.ok{background:#DCFCE7;color:#166534;}
.bom-template-components em.missing{background:#FEE2E2;color:#991B1B;}
.bom-template-components em.optional{background:#F1F5F9;color:#64748B;}
.bom-template-note{border-color:#BBF7D0;background:#F0FDF4;color:#166534;}


/* BOM Phase 8 — pilot UX & resolve speed */
.bom-pilot-summary{position:sticky;top:0;z-index:4;box-shadow:0 12px 30px rgba(15,23,42,.06);} 
.bom-pilot-actionbar{border:1px solid #BBF7D0;background:linear-gradient(180deg,#F0FDF4,#FFFFFF);border-radius:14px;padding:12px;display:flex;justify-content:space-between;gap:12px;align-items:center;}
.bom-pilot-actionbar strong{display:block;font-size:14px;color:#14532D;margin-bottom:2px;}
.bom-pilot-actionbar span{display:block;font-size:12.5px;color:#166534;line-height:1.4;}
.bom-pilot-actions{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end;}
.bom-pilot-metrics div:nth-child(4){background:#F8FAFC;color:#64748B;}
.bom-pilot-toolbar{position:sticky;top:74px;z-index:3;background:#fff;padding:8px;border:1px solid #E2E8F0;border-radius:13px;box-shadow:0 10px 28px rgba(15,23,42,.05);} 
.bom-supporting-toggle{border:1px dashed #CBD5E1;background:#fff;border-radius:11px;padding:9px 11px;font-size:12px;font-weight:850;color:#475569;text-align:left;cursor:pointer;font-family:inherit;}
.bom-supporting-toggle:hover{border-color:#64748B;background:#F8FAFC;}
.bom-row-supporting td{background:#F8FAFC;color:#475569;}
.bom-row-supporting .strong{color:#475569;}
.bom-load-more{display:flex;align-items:center;justify-content:center;gap:10px;padding:10px 12px;font-size:12px;color:#64748B;background:#F8FAFC;border-top:1px solid #E2E8F0;}
@media(max-width:860px){.bom-pilot-actionbar{align-items:flex-start;flex-direction:column}.bom-pilot-actions{justify-content:flex-start}.bom-pilot-toolbar{position:static}}

`;
