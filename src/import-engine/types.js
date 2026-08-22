// ============================================================
// IMPORT ENGINE — Type definitions (JSDoc)
// Module thuần JS, KHÔNG phụ thuộc React.
// ============================================================


/**
 * Phase 2 canonical import status.
 * @typedef {'auto_approved'|'need_review'|'failed'|'skipped'} CanonicalImportStatus
 */

/**
 * @typedef {Object} CanonicalValidationIssue
 * @property {string} code
 * @property {'info'|'warning'|'error'} level
 * @property {string} message
 * @property {string=} field
 * @property {string=} suggestedFix
 */

/**
 * @typedef {Object} CanonicalImportLine
 * @property {string} lineId
 * @property {number} lineNo
 * @property {'catalog_product'|'price_update'|'bom_item'} kind
 * @property {Object} source
 * @property {string=} source.sheet
 * @property {number=} source.row
 * @property {Object|Array=} source.cells
 * @property {string=} source.rawText
 * @property {number=} source.page
 * @property {string} rowType
 * @property {Object} raw
 * @property {Object} parsed
 * @property {Object|null} matchedProduct
 * @property {number} confidence
 * @property {CanonicalImportStatus} status
 * @property {CanonicalValidationIssue[]} issues
 */

/**
 * @typedef {Object} CanonicalImportPreviewResult
 * @property {string} importId
 * @property {string} fileName
 * @property {string} importType
 * @property {string|null} detectedTemplateId
 * @property {boolean} templateKnown
 * @property {string} detectedIndustry
 * @property {number} overallConfidence
 * @property {Object} summary
 * @property {number} summary.totalRows
 * @property {number} summary.parsedItems
 * @property {number} summary.autoApproved
 * @property {number} summary.needReview
 * @property {number} summary.failed
 * @property {number} summary.skipped
 * @property {CanonicalImportLine[]} lines
 * @property {string[]} warnings
 * @property {string} engine
 */

/**
 * @typedef {Object} RawCell
 * @property {number} c        - chỉ số cột (0-based)
 * @property {*}      v        - giá trị thô
 * @property {string} ref      - địa chỉ cell, vd "B5"
 */

/**
 * @typedef {Object} NormalizedRow
 * @property {number}    r        - chỉ số dòng trong sheet (0-based)
 * @property {RawCell[]} cells    - các ô có giá trị
 * @property {string[]}  text     - mảng text từng cột (đã chuẩn hoá)
 * @property {string}    joined   - toàn bộ text dòng nối lại (để regex)
 * @property {number}    filled   - số ô có dữ liệu
 */

/**
 * @typedef {Object} NormalizedSheet
 * @property {string}          name   - tên sheet
 * @property {NormalizedRow[]} rows
 * @property {number}          maxCol
 */

/**
 * @typedef {Object} NormalizedWorkbook
 * @property {NormalizedSheet[]} sheets
 * @property {string}            fileName
 * @property {string}            fileSupplier - đoán NCC từ tên file
 */

/**
 * @typedef {Object} Region
 * Một vùng bảng liên tục trong sheet (tách khỏi tiêu đề/footer/ghi chú).
 * @property {string} sheet
 * @property {number} startRow
 * @property {number} endRow
 * @property {string} [sectionName] - nếu region nằm dưới 1 section header
 */

/**
 * @typedef {Object} ColumnMap
 * fieldKey -> chỉ số cột. Các field: name, sku, category, supplier, unit, price, specs, qty
 * @property {number} [name]
 * @property {number} [sku]
 * @property {number} [category]
 * @property {number} [supplier]
 * @property {number} [unit]
 * @property {number} [price]
 * @property {number} [specs]
 */

/** @typedef {'product'|'section'|'note'|'total'|'header'|'blank'} RowClass */

/**
 * @typedef {Object} ImportItem
 * @property {string}   name
 * @property {string}   sku
 * @property {string}   category
 * @property {string}   supplier
 * @property {string}   unit
 * @property {number}   price
 * @property {string}   specs
 * @property {number}   confidence    - 0..1
 * @property {('matched'|'new'|'review'|'rejected')} status
 * @property {string[]} issues        - danh sách vấn đề phát hiện
 * @property {?string}  matchedProductId
 * @property {Object}   source
 * @property {string}   source.sheet
 * @property {number}   source.rowIndex
 * @property {string[]} source.cellRefs
 * @property {string}   source.rawText  - text gốc dòng (để học correction)
 */

/**
 * @typedef {Object} ImportPreviewResult
 * @property {ImportItem[]} items
 * @property {string}       templateId      - fingerprint mẫu file
 * @property {boolean}      templateKnown    - đã gặp mẫu này trước chưa
 * @property {string}       domain           - ngành đoán được
 * @property {Object}       stats
 * @property {number}       stats.total
 * @property {number}       stats.matched
 * @property {number}       stats.new
 * @property {number}       stats.review
 * @property {number}       stats.rejected
 * @property {number}       stats.aiUsed     - số dòng phải dùng AI fallback
 * @property {boolean}      needsReview      - có dòng cần người duyệt không
 * @property {string}       engine           - 'v2' | 'legacy'
 * @property {string[]}     warnings
 */

/**
 * @typedef {Object} ImportContext
 * Dữ liệu môi trường truyền vào engine (không phụ thuộc React).
 * @property {Array}    catalog          - danh sách sản phẩm hiện có
 * @property {Function} [aiExtract]      - async (payload) => items | null. AI fallback.
 * @property {Object}   [corrections]    - map rawText -> productId đã học
 * @property {Object}   [templateMap]    - map templateId -> ColumnMap đã lưu
 */

export const FIELD_KEYS = ['name', 'sku', 'category', 'supplier', 'unit', 'price', 'specs'];

export const ROW_CLASS = {
  PRODUCT: 'product',
  SECTION: 'section',
  NOTE: 'note',
  TOTAL: 'total',
  HEADER: 'header',
  BLANK: 'blank',
};

export const STATUS = {
  MATCHED: 'matched',
  NEW: 'new',
  REVIEW: 'review',
  REJECTED: 'rejected',
  SKIPPED: 'skipped',
};

export const IMPORT_STATUS = {
  AUTO_APPROVED: 'auto_approved',
  NEED_REVIEW: 'need_review',
  FAILED: 'failed',
  SKIPPED: 'skipped',
};
