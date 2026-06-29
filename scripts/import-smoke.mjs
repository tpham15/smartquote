#!/usr/bin/env node
// Phase 2.8 smoke checks for SmartQuote import engine.
// Usage:
//   node scripts/import-smoke.mjs path/to/catalog.xlsx [another.xlsx]
// If no files are passed, runs deterministic guardrail checks only.

import fs from 'node:fs/promises';
import path from 'node:path';
import { runImport } from '../src/import-engine/index.js';
import { parseSafePrice, sanitizeCatalogProduct, extractSkuFromText } from '../src/import-engine/productSanitizer.js';
import { rowToItem } from '../src/import-engine/extractItems.js';
import { mapColumns } from '../src/import-engine/mapColumns.js';
import { validateItems } from '../src/import-engine/validateItems.js';
import { scoreConfidence } from '../src/import-engine/scoreConfidence.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function fileLike(filePath) {
  const buf = await fs.readFile(filePath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return {
    name: path.basename(filePath),
    arrayBuffer: async () => ab,
  };
}

async function runGuardrails() {
  assert(parseSafePrice('03-05 ngày') === 0, '03-05 ngày must not parse as price');
  const note = sanitizeCatalogProduct({ name: '- Thi công: Hoàn thành sau 7 ngày kể từ ngày ký hợp đồng', costPrice: 0, unit: 'Cái' });
  assert((note._meta?.issues || []).some(i => i.code === 'non_product_row'), 'Thi công row must be flagged as non-product');
  const p = sanitizeCatalogProduct({ name: 'Mã khóa sử dụng: OSN-3381, OSN-KBT06', specs: '', costPrice: 1200000, unit: 'Cái' });
  assert(p.sku === 'OSN-3381', 'SKU must be extracted from specs/name');
  assert(extractSkuFromText('\n\n\nOSN-KBT06') === 'OSN-KBT06', 'SKU hidden after many newlines must be extracted');

  const weirdRow = {
    r: 9,
    text: ['1', '\n\n\nOSN-KBT06', 'Màu đen; Pin AA', 'Mật khẩu/Vân tay/Thẻ từ/App', '1', '39.890.000'],
    cells: [{ ref: 'A10' }, { ref: 'B10' }, { ref: 'C10' }, { ref: 'D10' }, { ref: 'E10' }, { ref: 'F10' }],
    joined: '1 OSN-KBT06 Màu đen; Pin AA Mật khẩu/Vân tay/Thẻ từ/App 1 39.890.000',
  };
  const recovered = rowToItem(weirdRow, { _hiddenSkuCols: [1], _nameSourceCols: [2, 3], _featureCols: [3], price: 5, _deriveNameFromFeature: true }, 'Khóa thông minh', '', '');
  assert(recovered?.sku === 'OSN-KBT06', 'rowToItem must recover hidden SKU from image-like cell');
  // Phase 3.10: khi có SKU/model, tên NGẮN = type + model, KHÔNG nhồi feature vào tên.
  assert(/Khóa thông minh|Khoa thong minh/i.test(recovered?.name || ''), 'rowToItem must derive product type in name');
  assert(/OSN-KBT06/i.test(recovered?.name || ''), 'rowToItem name must contain the recovered model code');
  assert((recovered?.name || '').length <= 80, `name must stay short, got "${recovered?.name}"`);
  // Feature phải nằm ở specs, không phải name
  assert(/Mật khẩu|Van tay|Vân tay/i.test(recovered?.specs || ''), 'rowToItem must put features into specs');
  assert(!/Mật khẩu.*Vân tay.*Thẻ từ/i.test(recovered?.name || ''), 'rowToItem name must not be a feature dump');
  assert(recovered?.price === 39890000, 'rowToItem must keep price while recovering hidden SKU/name');

  // Phase 3.10.1 — type theo SKU pattern, không bị kéo theo sheet "khóa".
  // Két an toàn SBX nằm trong sheet khóa nhưng phải ra "Két an toàn".
  const safeRow = {
    r: 5,
    text: ['1', 'SBX501-4C0', 'Màu đen; Khóa cơ', 'Mã khóa số/Vân tay', '1', '15.000.000'],
    cells: [{ ref: 'A6' }, { ref: 'B6' }, { ref: 'C6' }, { ref: 'D6' }, { ref: 'E6' }, { ref: 'F6' }],
    joined: '1 SBX501-4C0 Màu đen; Khóa cơ Mã khóa số/Vân tay 1 15.000.000',
  };
  const safe = rowToItem(safeRow, { sku: 1, _nameSourceCols: [2, 3], _featureCols: [3], price: 5, _deriveNameFromSku: true }, 'KÉT PHILIPS', '', 'Philips');
  assert(safe?.sku === 'SBX501-4C0', 'safe-box SKU must be parsed');
  assert(/^Két an toàn|^Ket an toan/i.test(safe?.name || ''), `SBX must be typed "Két an toàn", got "${safe?.name}"`);
  assert(!/Khóa thông minh/i.test(safe?.name || ''), 'SBX must NOT be "Khóa thông minh"');

  // Khóa DDL nằm sheet khóa → đúng loại "Khóa thông minh".
  const lockRow = {
    r: 6,
    text: ['2', 'DDL902-MFVP', 'Màu vàng', 'Vân tay/Mật mã', '1', '22.200.000'],
    cells: [{ ref: 'A7' }, { ref: 'B7' }, { ref: 'C7' }, { ref: 'D7' }, { ref: 'E7' }, { ref: 'F7' }],
    joined: '2 DDL902-MFVP Màu vàng Vân tay/Mật mã 1 22.200.000',
  };
  const lock = rowToItem(lockRow, { sku: 1, _nameSourceCols: [2, 3], _featureCols: [3], price: 5, _deriveNameFromSku: true }, 'KHÓA BIỆT THỰ', '', 'Philips');
  assert(/Khóa thông minh|Khoa thong minh/i.test(lock?.name || ''), `DDL must be "Khóa thông minh", got "${lock?.name}"`);


  // Phase 3.13 — Effective/current price column.
  // Header "Điều chỉnh tăng <ngày>" phải là giá công bố hiện tại, không phải giá nhập.
  const effHeader = { r: 0, text: ['STT','Hình ảnh','Thông số kỹ thuật','Tính năng','Số lượng','Giá niêm yết','Điều chỉnh tăng 15/04/2026','Từ 5 bộ'], cells: [], joined: '' };
  const effRows = [
    { r: 1, text: ['1','OSN-3320','Pin AAA','Mật khẩu/Vân tay','1','4,990,000','5,290,000',''], cells: [], joined: 'OSN-3320 4,990,000 5,290,000' },
    { r: 2, text: ['2','OSN-2602','Pin AAA','Mật khẩu/Vân tay','1','4,190,000','4,390,000','4,090,000'], cells: [], joined: 'OSN-2602 4,190,000 4,390,000 4,090,000' },
  ];
  const { map: effMap } = mapColumns(effHeader, effRows, 7);
  assert(Number(effMap.currentListPrice) === 6, `effective price column must map to currentListPrice=6, got ${effMap.currentListPrice}`);
  assert(Number(effMap.listPrice) === 5, `old list price column must map to listPrice=5, got ${effMap.listPrice}`);
  const effNoTier = rowToItem({ ...effRows[0], cells: [{ref:'A2'},{ref:'B2'},{ref:'C2'},{ref:'D2'},{ref:'E2'},{ref:'F2'},{ref:'G2'},{ref:'H2'}] }, effMap, 'Bảng giá OSUNO', 'KHÓA NHÔM KÍNH', 'Tổng hợp báo giá');
  assert(effNoTier?.costPrice === 5290000, `effective price without tier should set cost=list=5.290.000, got cost=${effNoTier?.costPrice}`);
  assert(effNoTier?.listPrice === 5290000, `effective price should set listPrice=5.290.000, got ${effNoTier?.listPrice}`);
  assert(/Giá niêm yết cũ: 4\.990\.000đ/.test(effNoTier?.specs || ''), 'old list price must be preserved in specs');
  const effTier = rowToItem({ ...effRows[1], cells: [{ref:'A3'},{ref:'B3'},{ref:'C3'},{ref:'D3'},{ref:'E3'},{ref:'F3'},{ref:'G3'},{ref:'H3'}] }, effMap, 'Bảng giá OSUNO', 'KHÓA NHÔM KÍNH', 'Tổng hợp báo giá');
  assert(effTier?.costPrice === 4090000, `tier price should become costPrice, got ${effTier?.costPrice}`);
  assert(effTier?.listPrice === 4390000, `adjusted/current price should become listPrice, got ${effTier?.listPrice}`);
  const effScored = scoreConfidence(validateItems([effNoTier, effTier]), 0.9);
  assert(!effScored.some((it) => (it.issues || []).some((iss) => iss.code === 'list_price_below_cost')), 'effective price rows must not trigger list_price_below_cost');

  // Phase 3.10.2 — dòng tổng nhóm: tên = loại SP chung, không SKU, specs rỗng → gắn cờ subtotal.
  const subtotalRow = {
    r: 7,
    text: ['', 'Công tắc thông minh', '', '', '', '11.016.000'],
    cells: [{ ref: 'B8' }, { ref: 'F8' }],
    joined: 'Công tắc thông minh 11.016.000',
  };
  const sub = rowToItem(subtotalRow, { name: 1, price: 5 }, 'BÁO GIÁ', '', 'NĐ');
  assert(sub?._subtotalSuspect === true, `generic category subtotal row must be flagged (got name="${sub?.name}", flag=${sub?._subtotalSuspect})`);

  // Sản phẩm thật có SKU + cùng tên loại KHÔNG bị gắn nhầm cờ subtotal.
  const realRow = {
    r: 8,
    text: ['', 'Công tắc cơ thông minh 1 nút', 'LM-1G2W-C(G)', 'Kích thước 86x86', '', '945.000'],
    cells: [{ ref: 'B9' }, { ref: 'C9' }, { ref: 'D9' }, { ref: 'F9' }],
    joined: 'Công tắc cơ thông minh 1 nút LM-1G2W-C(G) Kích thước 86x86 945.000',
  };
  const real = rowToItem(realRow, { name: 1, sku: 2, specs: 3, price: 5 }, 'BÁO GIÁ', '', 'NĐ');
  assert(!real?._subtotalSuspect, `real product with SKU must NOT be flagged as subtotal (name="${real?.name}")`);

  console.log('✓ Guardrail checks passed');
}

function findLine(lines, skuPart) {
  const needle = String(skuPart || "").toLowerCase().replace(/[\s\-\/\.\_]/g, "");
  return lines.find((l) => String(l.parsed?.sku || l.raw?.sku || "").toLowerCase().replace(/[\s\-\/\.\_]/g, "").includes(needle));
}

async function runFile(filePath) {
  const file = await fileLike(filePath);
  const result = await runImport(file, { catalog: [] });
  const summary = result.preview?.summary || result.summary || {};
  const lines = result.preview?.lines || result.lines || [];
  const base = path.basename(filePath);
  console.log(`✓ ${base} → ${summary.parsedItems ?? lines.length} items, ${summary.autoApproved || 0} clean, ${summary.needReview || 0} review, ${summary.failed || 0} failed, skipped ${summary.skipped || 0}, confidence ${Math.round((result.overallConfidence || result.preview?.overallConfidence || 0) * 100)}%`);
  assert(lines.length > 0, `${filePath}: expected at least 1 parsed line`);
  assert(lines.every(l => l.lineId), `${filePath}: every line must have stable lineId`);

  const normalizedName = base.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (normalizedName.includes('ssehome')) {
    assert(lines.length >= 60, `${base}: expected at least 60 SSEHOME products`);
    const ddl = findLine(lines, 'DDL902');
    assert(ddl, `${base}: expected DDL902 line`);
    assert(/kh[oó]a|khoa/i.test(ddl.parsed?.productName || ''), `${base}: DDL902 should have human product name`);
    assert(Number(ddl.parsed?.costPrice || 0) === 22200000, `${base}: DDL902 cost price should be 22.200.000`);
    assert(Number(ddl.parsed?.listPrice || ddl.parsed?.publicPrice || 0) > Number(ddl.parsed?.costPrice || 0), `${base}: DDL902 list price should be above cost`);

    // Phase 3.10 — Name quality: tên catalog phải NGẮN, sạch; feature nằm ở specs.
    const ddlName = ddl.parsed?.productName || '';
    assert(ddlName.length <= 80, `${base}: DDL902 name must be <= 80 chars (got ${ddlName.length}: "${ddlName}")`);
    assert((ddlName.match(/\//g) || []).length <= 1, `${base}: DDL902 name must not be a feature dump (too many "/")`);
    assert(/DDL902/i.test(ddlName), `${base}: DDL902 name must contain the model code`);
    // Feature (vân tay / mật mã...) phải ở specs, không ở name
    const ddlSpecs = ddl.parsed?.specs || '';
    assert(/v[âa]n tay|m[âa]̣t m[ãa]|wifi|chuông|chuong/i.test(ddlSpecs), `${base}: DDL902 features must be in specs`);
    assert(!/v[âa]n tay.*m[âa]̣t m[ãa].*ch[ìi]a/i.test(ddlName), `${base}: DDL902 name must not contain full feature list`);

    // Toàn bộ catalog: không tên nào quá dài
    const tooLong = lines.filter((l) => String(l.parsed?.productName || '').length > 90);
    assert(tooLong.length === 0, `${base}: ${tooLong.length} product names exceed 90 chars (feature dump). First: "${tooLong[0]?.parsed?.productName?.slice(0,100)}"`);

    // Phase 3.10.1 — Product type phải đúng theo SKU/category, không bị kéo theo sheet.
    const sbx = findLine(lines, 'SBX501');
    if (sbx) {
      const sbxName = sbx.parsed?.productName || '';
      assert(/^Két an toàn|^Ket an toan/i.test(sbxName), `${base}: SBX501 name must start with "Két an toàn", got "${sbxName}"`);
      assert(!/Khóa thông minh|Khoa thong minh/i.test(sbxName), `${base}: SBX501 must NOT be named "Khóa thông minh"`);
    }
    // Không dòng két (SBX/Valis) nào bị gắn nhầm loại "Khóa thông minh" hoặc generic "Sản phẩm"
    const safeMisnamed = lines.filter((l) =>
      /^(SBX|Valis)/i.test(l.parsed?.sku || '') &&
      /Khóa thông minh|Khoa thong minh|^Sản phẩm Philips|^San pham Philips/i.test(l.parsed?.productName || '')
    );
    assert(safeMisnamed.length === 0, `${base}: ${safeMisnamed.length} safe-box (SBX/Valis) lines mis-typed. First: "${safeMisnamed[0]?.parsed?.productName}"`);
    // Khóa DDL phải đúng loại "Khóa thông minh"
    const lockMisnamed = lines.filter((l) =>
      /^DDL/i.test(l.parsed?.sku || '') &&
      !/Khóa thông minh|Khoa thong minh/i.test(l.parsed?.productName || '')
    );
    assert(lockMisnamed.length === 0, `${base}: ${lockMisnamed.length} DDL lock lines not named "Khóa thông minh". First: "${lockMisnamed[0]?.parsed?.productName}"`);
  }

  if (normalizedName.includes('bui vien') || normalizedName.includes('nguyen')) {
    assert(lines.length >= 25, `${base}: expected at least 25 quote/catalog lines`);
    const bad = lines.find((l) => /hàng đặt|hang dat|thi công|thi cong|điều khoản|dieu khoan/i.test(l.parsed?.productName || l.raw?.productName || ''));
    assert(!bad, `${base}: note/terms rows must not be imported as products`);

    // Phase 3.10.2 — dòng tổng nhóm (tên = loại SP chung, không SKU) KHÔNG được auto-approve.
    const GENERIC_RE = /^(công tắc thông minh|công tắc|camera|khóa thông minh|cảm biến|két an toàn|bộ điều khiển trung tâm|wifi|ổ cắm)\.?$/i;
    const genericLines = lines.filter((l) =>
      !String(l.parsed?.sku || '').trim() &&
      GENERIC_RE.test(String(l.parsed?.productName || '').trim())
    );
    const autoApprovedGeneric = genericLines.filter((l) => l.status === 'auto_approved');
    assert(autoApprovedGeneric.length === 0,
      `${base}: ${autoApprovedGeneric.length} generic-category subtotal rows auto-approved. First: "${autoApprovedGeneric[0]?.parsed?.productName}" (${autoApprovedGeneric[0]?.parsed?.costPrice}đ)`);
    const blockingGeneric = genericLines.filter((l) => l.status === 'failed' || l.status === 'need_review');
    assert(blockingGeneric.length === 0,
      `${base}: generic-category subtotal rows should be skipped, not failed/review. First status=${blockingGeneric[0]?.status} name="${blockingGeneric[0]?.parsed?.productName}"`);

    // Sản phẩm thật có SKU vẫn phải được giữ
    const realWithSku = lines.filter((l) => String(l.parsed?.sku || '').trim() && l.status === 'auto_approved');
    assert(realWithSku.length >= 20, `${base}: expected >= 20 real products with SKU auto-approved, got ${realWithSku.length}`);
  }
  return result;
}

await runGuardrails();
const files = process.argv.slice(2);
for (const f of files) await runFile(f);
if (!files.length) console.log('ℹ No Excel files passed; run with file paths for end-to-end import smoke checks.');
