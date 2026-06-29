#!/usr/bin/env node
// Phase 3.10 — PDF smoke checks for SmartQuote import engine.
//
// PDF pipeline có 2 phần:
//   (1) Deterministic text→product parser (chạy offline, KHÔNG cần API) — test ở đây.
//   (2) AI enhancement qua /api/claude + /api/pdf-extract — chỉ chạy trên Vercel/local server.
//
// Script này test (1) bằng text trích từ PDF thật (Lumi / Bisco / Forest).
// Để test (2) end-to-end, chạy app trên Vercel rồi import PDF qua UI.
//
// Usage:
//   npm run smoke:pdf

import {
  heuristicExtractProductsFromPdfPages,
  normalizePdfItems,
  dedupeProducts,
  extractMoneyValues,
  pickPriceFields,
  extractSkuFromPdfLine,
  applyPdfOcrQualityGuard,
  cleanPdfSupplierName,
  isLumiSmarthomeContext,
  getExpectedLumiPdfRows,
  buildDocumentPagePrompt,
} from '../src/import-engine/pdf/pdfCatalogPipeline.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// ---- Guardrail: tách giá & SKU từ dòng PDF ----
function runPdfGuardrails() {
  // Giá: lấy được nhiều mức, chọn thấp nhất làm costPrice
  const prices = extractMoneyValues('Cổng âm sàn VULCAN 24V 41.900.000 19.765.000');
  assert(prices.length >= 2, 'must extract multiple prices from a Bisco-like line');
  const picked = pickPriceFields(prices);
  assert(picked.costPrice === 19765000, `costPrice should be lowest sensible price, got ${picked.costPrice}`);
  assert(picked.listPrice === 41900000, `listPrice should be highest, got ${picked.listPrice}`);

  // Không nhầm "03-05 ngày" thành giá
  assert(extractMoneyValues('Thời gian giao hàng 03-05 ngày').length === 0, '03-05 ngày must not be a price');

  // SKU từ dòng Lumi
  assert(/LM-S1N/i.test(extractSkuFromPdfLine('Công tắc Luto 1 nút LM-S1N/S 1.944.000') || ''), 'must extract LM-S1N SKU');
  // SKU từ dòng Bisco
  assert(/22F005/i.test(extractSkuFromPdfLine('CỔNG ÂM SÀN VULCAN 24V 22F005 Bộ') || ''), 'must extract 22F005 SKU');


  // PDF OCR guard: không dùng tiêu đề bảng làm NCC, dòng mảnh vỡ bị skip.
  assert(cleanPdfSupplierName('BBG THANH RAY KÉO TAY FOREST G', 'Forest') === 'Forest', 'PDF table title must not become supplier');
  const broken = applyPdfOcrQualityGuard({
    name: 'bộ 1',
    sku: '',
    category: 'THANH RAY ÂM TRẦN TỰ ĐỘNG FOREST',
    supplier: 'BBG THANH RAY KÉO TAY FOREST G',
    unit: 'Cái',
    costPrice: 600000,
    specs: '',
    rawText: 'bộ 1 600.000',
    _meta: { engine: 'pdf-v3-text-heuristic', source: { type: 'pdf', rawText: 'bộ 1 600.000' }, issues: [] },
  }, 'pdf-v3-text-heuristic', 'Forest');
  assert(broken._meta?.canonicalStatus === 'skipped', 'broken OCR fragment must be skipped, not review');
  assert((broken._meta?.issues || []).some(i => i.code === 'pdf_ocr_low_quality'), 'broken OCR fragment should have pdf_ocr_low_quality issue');

  const clear = applyPdfOcrQualityGuard({
    name: 'DE Công tắc gắn tường Door Exit',
    sku: 'DE-01',
    category: 'Phụ kiện kiểm soát cửa',
    supplier: 'Roger BG RF Giá đại lý',
    unit: 'Cái',
    costPrice: 220000,
    listPrice: 700000,
    specs: 'Công tắc gắn tường; dùng cho door exit',
    rawText: 'DE Công tắc gắn tường Door Exit DE-01 220.000 700.000',
    _meta: { engine: 'pdf-v3-text-heuristic', source: { type: 'pdf', rawText: 'DE Công tắc gắn tường Door Exit DE-01 220.000 700.000' }, issues: [] },
  }, 'pdf-v3-text-heuristic', 'Roger BG RF Giá đại lý');
  assert(clear._meta?.canonicalStatus === 'auto_approved', 'clear PDF/OCR row should auto-approve, not force review');
  assert(cleanPdfSupplierName('Roger BG RF Giá đại lý', 'Roger BG RF Giá đại lý') === 'Roger', 'PDF price-table title should collapse to supplier brand');



  // Lumi Lighting scan: AI must not split one physical STT row into 3 catalog products.
  const lightingVariants = normalizePdfItems([
    {
      name: 'Đèn Spotlight âm trần 7W chính hướng, 24D (On/off)',
      sku: 'LM-ST7-55-O',
      category: 'DÒNG SẢN PHẨM SPOTLIGHT CHÍNH HƯỚNG 2025',
      supplier: 'Lumi',
      unit: 'Cái',
      costPrice: 648000,
      specs: 'On/off; công suất 7W; tuổi thọ 50,000h',
      rawText: 'STT 1 LM-ST7-55-O 648,000 810,000 1,080,000',
      sourcePage: 1,
      sourceRow: 1,
    },
    {
      name: 'Đèn Spotlight âm trần 7W chính hướng, 24D (Smart dimmable)',
      sku: 'LM-ST7-55-D',
      category: 'DÒNG SẢN PHẨM SPOTLIGHT CHÍNH HƯỚNG 2025',
      supplier: 'Lumi',
      unit: 'Cái',
      costPrice: 810000,
      specs: 'Smart dimmable; công suất 7W',
      rawText: 'STT 1 LM-ST7-55-D 648,000 810,000 1,080,000',
      sourcePage: 1,
      sourceRow: 1,
    },
    {
      name: 'Đèn Spotlight âm trần 7W chính hướng, 24D (Smart Tunable)',
      sku: 'LM-ST7-55-T',
      category: 'DÒNG SẢN PHẨM SPOTLIGHT CHÍNH HƯỚNG 2025',
      supplier: 'Lumi',
      unit: 'Cái',
      costPrice: 1080000,
      specs: 'Smart Tunable; CCT 2700K-6500K',
      rawText: 'STT 1 LM-ST7-55-T 648,000 810,000 1,080,000',
      sourcePage: 1,
      sourceRow: 1,
    },
  ], 'Lumi', 'pdf-v4-document-page-jsonl');
  const collapsedLighting = dedupeProducts(lightingVariants, { fileName: 'Bảng giá Lighting 2026.06.01.pdf', supplierGuess: 'Lumi' });
  assert(collapsedLighting.length === 1, `Lumi Lighting STT row should collapse to 1 product, got ${collapsedLighting.length}`);
  assert(collapsedLighting[0].costPrice === 648000, `collapsed row should use lowest clear variant price, got ${collapsedLighting[0].costPrice}`);
  assert(/LM-ST7-55-O/.test(collapsedLighting[0].sku) && /LM-ST7-55-D/.test(collapsedLighting[0].sku) && /LM-ST7-55-T/.test(collapsedLighting[0].sku), 'collapsed row should preserve all variant SKUs in sku/specs');
  assert(!/Smart dimmable|Smart Tunable|On\/off/i.test(collapsedLighting[0].name), `collapsed name should be base product name, got ${collapsedLighting[0].name}`);

  const fakeLifeHours = normalizePdfItems([
    {
      name: 'Đèn Spotlight âm trần 7W chính hướng, 24D',
      sku: 'LM-ST7-55-O',
      category: 'DÒNG SẢN PHẨM SPOTLIGHT CHÍNH HƯỚNG 2025',
      supplier: 'Lumi',
      unit: 'Cái',
      costPrice: 50000,
      specs: 'Tuổi thọ: 50,000h; CRI>95',
      rawText: 'STT 1 tuổi thọ 50,000h',
      sourcePage: 1,
      sourceRow: 1,
    },
  ], 'Lumi', 'pdf-v4-document-page-jsonl');
  assert(fakeLifeHours[0].costPrice === 0, `must not treat Tuổi thọ 50,000h as price, got ${fakeLifeHours[0].costPrice}`);

  // Lumi Smarthome scan recovery: prompt/normalizer guardrails.
  // This does not call the AI offline, but it locks the exact contract we need on Vercel:
  // table rows must be returned as row-indexed JSONL, and rows with name+price must not be skipped
  // only because SKU is blurry.
  assert(isLumiSmarthomeContext({ fileName: 'Bảng giá Smarthome 2026.06.01.pdf', supplierGuess: 'Lumi' }), 'must detect Lumi Smarthome context');
  assert(getExpectedLumiPdfRows({ fileName: 'Bảng giá Smarthome 2026.06.01.pdf', supplierGuess: 'Lumi' }) === 49, 'Lumi Smarthome scan expected row count should be 49');
  const smarthomePrompt = buildDocumentPagePrompt({ fileName: 'Bảng giá Smarthome 2026.06.01.pdf', supplierGuess: 'Lumi', pageNum: 1, pageCount: 3 });
  assert(/Mỗi row vật lý = 1 object JSONL/i.test(smarthomePrompt), 'Lumi Smarthome prompt must enforce one physical row = one JSONL object');
  assert(/Nếu SKU không chắc hoặc không đọc được, để sku="" nhưng vẫn xuất object/i.test(smarthomePrompt), 'Lumi Smarthome prompt must keep rows when SKU is blurry');
  assert(/49 sản phẩm/i.test(smarthomePrompt), 'Lumi Smarthome prompt must include expected row target');

  const simulatedSmarthomeRows = Array.from({ length: 49 }, (_, i) => ({
    name: i % 10 === 0 ? `Công tắc Luto dòng ${i + 1}` : `Thiết bị Lumi Smarthome ${i + 1}`,
    sku: i % 7 === 0 ? '' : `LM-SM-${String(i + 1).padStart(2, '0')}`,
    category: i < 25 ? 'CÔNG TẮC LUTO' : 'CẢM BIẾN, PHỤ TRỢ',
    supplier: 'Lumi',
    unit: 'Cái',
    costPrice: 900000 + i * 1000,
    specs: 'Nguồn cấp 220VAC/50Hz',
    rawText: `STT ${i + 1} row ${i + 1} ${900000 + i * 1000}`,
    sourcePage: Math.floor(i / 18) + 1,
    sourceRow: i + 1,
  }));
  const normalizedSmarthomeRows = dedupeProducts(
    normalizePdfItems(simulatedSmarthomeRows, 'Lumi', 'pdf-v4-document-page-jsonl'),
    { fileName: 'Bảng giá Smarthome 2026.06.01.pdf', supplierGuess: 'Lumi' }
  );
  assert(normalizedSmarthomeRows.length >= 45, `Lumi Smarthome row recovery must preserve >=45 rows, got ${normalizedSmarthomeRows.length}`);
  assert(normalizedSmarthomeRows.some(it => !it.sku && it.name && it.costPrice > 0), 'Rows with blurry SKU but name+price must remain in preview');

  console.log('✓ PDF guardrail checks passed');
}

// ---- Test deterministic parser với 3 PDF thật (text mẫu) ----
const LUMI_PAGE = {
  page: 1,
  text: [
    'SMART HOME BẢNG GIÁ 2026',
    'THIẾT BỊ MÃ SẢN PHẨM MÔ TẢ ĐƠN GIÁ',
    'CÔNG TẮC LUTO_KÍNH PHẲNG, VIỀN THẲNG CHAMPAGNE',
    'Công tắc Luto 1 nút LM-S1N/S Màu trắng/đen 1.944.000',
    'Công tắc Luto 2 nút LM-S2N/S Màu trắng/đen 1.998.000',
    'Công tắc Luto 3 nút LM-S3N/S 2.133.000',
    'Ổ CẮM',
    'Ổ cắm Luso viền thẳng champagne LM-SK4/SC 621.000',
    'Bộ điều khiển trung tâm LM-HC/4.0 Nguồn cấp: 220VAC 2.970.000',
    'Bảng giá có hiệu lực kể từ ngày 01 tháng 06 năm 2026',
    '(Lưu ý: Bảng giá đã gồm thuế VAT 8%)',
  ].join('\n'),
};

const BISCO_PAGE = {
  page: 1,
  text: [
    'BÁO GIÁ - HỆ THỐNG BISCO',
    'STT Mã Sản phẩm Thông số sản phẩm Đơn vị Giá bán lẻ Giá NPP',
    'THIẾT BỊ CỔNG TỰ ĐỘNG',
    '1 22F005 Cổng mở xoay âm sàn VULCAN 24V 600kg Bộ 41.900.000 19.765.000',
    '1 30C065 Cổng trượt tự động AYROS 24V 650kg Bộ 25.950.000 7.277.000',
    'PHỤ KIỆN MUA THÊM',
    '1 PHOX2-433 Tay điều khiển 2 nút Vulcan Cái 1.000.000 380.000',
    'Ghi chú: Giá trên chưa bao gồm VAT, khi lên đơn sẽ cộng thêm VAT 8%',
    'Thanh toán 100% trước khi giao hàng.',
  ].join('\n'),
};

const FOREST_PAGE = {
  page: 1,
  text: [
    'BẢNG GIÁ THANH RÈM FOREST 2024',
    'THANH RAY KÉO TAY MÃ KS FOREST',
    'No Thông số kỹ thuật Đvt Số lượng Giá Đại Lí',
    '1 Thanh ray kéo tay KS Forest bi thường đầy đủ phụ kiện md 1 165.000',
    '2 Thanh ray kéo tay KS Forest định hình đầy đủ phụ kiện md 1 200.000',
    'THANH RAY KÉO TAY CRS FOREST',
    '1 Thanh ray kéo tay CRS Forest phi 28mm bi thường md 1 425.000',
    'Chính sách thanh toán: áp dụng cho đơn hàng dự án',
    'Bảng giá có hiệu lực từ ngày 01/9/2024',
  ].join('\n'),
};

function runDeterministicPdf(label, page, supplierGuess, expectMin) {
  const raw = heuristicExtractProductsFromPdfPages([page], supplierGuess);
  const items = dedupeProducts(normalizePdfItems(raw, supplierGuess, 'pdf-v3-text-heuristic'));

  console.log(`✓ ${label} → ${items.length} sản phẩm (deterministic, offline)`);
  assert(items.length >= expectMin, `${label}: expected >= ${expectMin} products, got ${items.length}`);

  // Không có dòng chính sách/ghi chú/VAT lọt vào
  const junk = items.find((it) => /ghi chú|chính sách|thanh toán|hiệu lực|VAT|lưu ý/i.test(it.name));
  assert(!junk, `${label}: policy/note line leaked as product: "${junk?.name}"`);

  // Mọi sản phẩm có giá > 0
  const noPrice = items.find((it) => !(it.costPrice > 0));
  assert(!noPrice, `${label}: product without price: "${noPrice?.name}"`);

  // Tên không quá dài
  const tooLong = items.find((it) => (it.name || '').length > 90);
  assert(!tooLong, `${label}: name too long: "${tooLong?.name}"`);

  for (const it of items.slice(0, 3)) {
    console.log(`    • ${String(it.name).slice(0, 44).padEnd(46)} | ${String(it.sku || '(none)').padEnd(12)} | ${it.costPrice.toLocaleString('vi-VN')}đ`);
  }
  return items;
}

runPdfGuardrails();
console.log('');
runDeterministicPdf('LUMI (smarthome)', LUMI_PAGE, 'Lumi', 4);
runDeterministicPdf('BISCO (cổng)', BISCO_PAGE, 'Bisco', 3);
runDeterministicPdf('FOREST (rèm)', FOREST_PAGE, 'Forest', 3);

console.log('');
console.log('ℹ Deterministic PDF parser: PASS (offline).');
console.log('ℹ Để test AI enhancement + /api/pdf-extract end-to-end:');
console.log('  1. Deploy lên Vercel (cần ANTHROPIC_API_KEY).');
console.log('  2. Import 3 PDF thật (Lumi/Bisco/Forest) qua UI tab "Danh mục".');
console.log('  3. Kiểm tra số sản phẩm, giá NPP thấp nhất, không lọt dòng chính sách.');
