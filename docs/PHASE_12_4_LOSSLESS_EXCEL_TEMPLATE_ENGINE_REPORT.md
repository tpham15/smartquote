# SmartQuote Phase 12.4 — Lossless Excel Template Engine

## Mục tiêu

Phase 12.4 thay kiến trúc xuất Excel theo mẫu từ kiểu **load → tái dựng → save workbook** sang **OOXML package-preserving patch**.

Mục tiêu là làm cho mọi vùng của file `.xlsx` mà SmartQuote không cần sửa được giữ nguyên byte-for-byte ở cấp OOXML part, thay vì cố tái tạo style/drawing bằng thư viện spreadsheet.

> Nguyên tắc của engine: nếu SmartQuote không cần thay một phần của workbook thì phần đó không được serialize lại.

## Vì sao Phase 12.2 không thể đạt fidelity cao

Các thư viện workbook cấp cao thường đọc XLSX thành object model rồi serialize lại. Với mẫu Excel phức tạp, quá trình này có thể làm thay đổi hoặc mất:

- drawing / image relationship;
- WMF và media ít phổ biến;
- style table;
- row height / column width;
- merged regions;
- page setup / printer settings;
- một số workbook metadata.

Phase 12.4 không dùng đường serialize đó cho export lossless.

## Kiến trúc mới

```text
Original XLSX bytes
      │
      ├── Template Analyzer
      │      └── manifest v3 + source checksum
      │
      └── Lossless XML Patcher
             ├── patch mapped worksheet cells
             ├── clone raw section/product/summary row XML
             ├── shift downstream row references
             ├── patch formulas
             ├── preserve existing drawings/media
             ├── add dynamic product images when possible
             └── force Excel formula recalculation
                    │
                    ▼
               Final XLSX
```

## Thành phần mới

### `api/xlsx_lossless.py`

Engine OOXML dùng Python standard library (`zipfile`, `xml.etree.ElementTree`). Không dùng `openpyxl` để serialize đường export v3.

Các trách nhiệm chính:

- đọc package XLSX;
- xác định worksheet thật từ workbook relationships;
- đọc shared strings;
- nhận diện header / section / product row / summary / total cells;
- sinh manifest;
- clone raw row XML;
- thay nội dung cell nhưng giữ `style id` và row attributes;
- dịch row/merge/reference phía dưới khi số dòng động thay đổi;
- giữ các package part không liên quan nguyên byte;
- patch drawing để loại anchor ảnh sản phẩm cũ và thêm ảnh sản phẩm mới;
- loại `calcChain.xml` cũ và bật full recalculation;
- tạo fidelity report ở cấp package part.

### `api/excel-template.py`

Thêm hai đường xử lý:

- `action: "analyze"` — phân tích template và trả manifest/checksum; không tính quota export.
- `exportMode: "lossless_xml_v3"` — dùng engine Phase 12.4.

Đường Phase 12.2 (`template_fidelity_v2`) vẫn còn để giữ regression/backward compatibility cho client cũ, nhưng frontend mới luôn yêu cầu `lossless_xml_v3` khi xuất theo template.

### `src/SmartQuote.jsx`

Template lưu thêm:

- `sourceChecksum`;
- `manifestVersion`;
- `engineVersion`;
- `manifest`.

Khi upload template:

1. browser tính SHA-256 file gốc;
2. mapper local tạo fallback preview;
3. server lossless analyzer tạo mapping authoritative khi khả dụng;
4. template được lưu cùng manifest/checksum.

Khi export:

- frontend gửi `exportMode: "lossless_xml_v3"`;
- API kiểm tra checksum file mẫu;
- nếu lossless API lỗi, frontend **không silent fallback** sang SheetJS;
- người dùng nhận lỗi rõ ràng thay vì một file fidelity thấp nhưng có vẻ như đã thành công.

## Manifest v3

Manifest phân biệt rõ các khái niệm trước đây dễ bị nhầm:

```text
headerRow
sectionRow
sectionLabelColumn
startRow
templateRow
clearUntilRow
columns.image
summary.titleRow
summary.templateRow
summary.labelColumn
summary.totalColumn
totals.subtotal
totals.labor
totals.vat
totals.grandTotal
```

Điều này ngăn header bị nhận nhầm thành product row và tách vùng tổng hợp khỏi vùng sản phẩm.

## Raw-row cloning

Section, product và summary row được clone từ XML row gốc. Vì vậy các thuộc tính như:

- style id;
- row height;
- hidden/customHeight;
- fill/font/border/alignment thông qua style id;
- horizontal merged cells;

không cần được tái dựng bằng code.

Vertical merge đi xuyên nhiều product row cũ không được nhân bản máy móc, vì điều đó có thể làm các dòng mới không writable.

## Dynamic product images

Engine giữ nguyên drawing/media tĩnh của template và chỉ xử lý anchor nằm trong vùng sản phẩm động.

Nếu có một product-image anchor mẫu, engine clone geometry/anchor của nó cho các sản phẩm mới và thêm media/relationship mới. Logo và drawing ngoài vùng sản phẩm không bị tái tạo.

## Formula và total behavior

- `lineTotal = qty * unitPrice` theo row mới;
- section total dùng `SUM(...)` trên các sản phẩm của section;
- summary rows tham chiếu section totals;
- subtotal tham chiếu summary totals (hoặc section totals khi template không có summary);
- labor/VAT dùng dữ liệu quote hiện tại, không lấy giá trị cũ trong template;
- grand total được tái tạo;
- `calcChain.xml` cũ bị bỏ và workbook được đánh dấu full recalculation.

## Fidelity contract

Phase 12.4 không định nghĩa “99%” bằng cảm giác nhìn. Nó kiểm tra cấu trúc:

### Static package fidelity

Mọi OOXML part không nằm trong allow-list sửa đổi phải có **decompressed bytes giống hệt source**.

Allow-list điển hình:

- worksheet đang được patch;
- drawing XML / drawing relationship khi vùng ảnh động thay đổi;
- workbook calculation metadata;
- workbook relationships và content types khi bỏ calcChain / thêm media.

Các part tĩnh như dưới đây phải giữ nguyên:

- `xl/styles.xml`;
- theme;
- shared strings nếu không cần patch;
- printer settings;
- media/logo tĩnh;
- document properties;
- sheet relationship không liên quan.

### Dynamic correctness

Kiểm riêng:

- field mapping;
- section/product row count;
- formulas;
- total cells;
- product image anchors;
- không xuất `[object Object]` cho specs object;
- footer còn nguyên sau row shift.

## Kết quả kiểm tra trên workbook mẫu thực tế đã cung cấp

Analyzer phát hiện:

- header row: 13;
- section row: 14;
- product row: 15;
- dynamic data region: 14–39;
- summary start: 40;
- subtotal: row 46;
- labor: row 47;
- grand total: row 48.

Package source có 34 OOXML parts. Sau một export thử có số dòng động khác source:

- các static part ngoài allow-list: **100% byte-identical**;
- `styles.xml`: identical;
- theme: identical;
- printer settings: identical;
- shared strings: identical;
- WMF/logo media: identical;
- ZIP integrity: PASS;
- footer vẫn tồn tại sau khi vùng động co lại;
- object specs được serialize thành text thay vì `[object Object]`.

`calcChain.xml` được loại có chủ đích để tránh cached formula references cũ; Excel sẽ recalculate khi mở file.

## Smoke test

Thêm:

```bash
npm run smoke:phase12.4
```

Fixture của smoke test là synthetic và không chứa dữ liệu khách hàng/đại lý thật.

Smoke kiểm tra:

- analyzer không nhận header làm product row;
- section/product/summary mapping;
- byte-identical static package parts;
- preservation của WMF/printer settings/theme/styles;
- row shifting/footer preservation;
- formula regeneration;
- labor không kế thừa giá trị cũ trong template;
- static logo drawing còn nguyên;
- dynamic product-image anchor;
- package integrity.

## Regression đã kiểm

PASS:

- Phase 12.4;
- Phase 12.3;
- Phase 12.2;
- Phase 12.1;
- Phase 12;
- Phase 11;
- Phase 10.2;
- Core Import Review;
- White-label scrub;
- Tenant storage isolation;
- Design System Cleanup;
- UX B7.1;
- Vercel Registry.

`smoke:quotes` cần package `@supabase/supabase-js` trong runtime. Baseline artifact hiện không kèm `node_modules`, nên test này không thể chạy trong môi trường đóng gói hiện tại. Đây không phải dependency mới của Phase 12.4.

## Giới hạn có chủ đích

Phase 12.4 hiện tập trung vào `.xlsx` template.

Chưa cam kết lossless cho mọi workbook tùy ý có:

- macro `.xlsm`;
- pivot/chart phức tạp có range cắt qua vùng dynamic;
- external links/query tables liên kết trực tiếp tới row bị dịch;
- template không có cấu trúc section/product row đủ để analyzer hoặc người dùng map;
- dynamic product images khi template không có drawing anchor mẫu phù hợp.

Vì vậy tuy engine đạt 100% static-part fidelity trên workbook mẫu kiểm thử, điều này **không phải lời hứa 99% cho mọi file Excel trên thế giới**. Với mỗi template dealer mới, analyzer + demo export vẫn phải qua validation trước khi kích hoạt.

## Quyết định kiến trúc

Không chuyển file template gốc sang một workbook object rồi save lại ở lossless v3.

Original `.xlsx` bytes tiếp tục là nguồn sự thật của template. Việc chuyển blob template sang Supabase Storage thay vì JSON/base64 là tối ưu persistence riêng và có thể làm tiếp mà không thay đổi lossless export contract.
