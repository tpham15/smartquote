// ============================================================
// validateItems — kiểm tra tính hợp lệ mỗi item, gắn issues[]
// ============================================================

function issue(code, level, message, field, suggestedFix) {
  return { code, level, message, field, suggestedFix };
}

/**
 * @param {Object[]} items
 * @returns {Object[]} items có thêm issues[]
 */
export function validateItems(items) {
  return items.map((item) => {
    const issues = [];

    // tên
    if (!item.name || item.name.trim().length < 2) issues.push(issue("missing_product_name", "error", "Thiếu tên sản phẩm", "name"));
    else if (item.name.length > 200) issues.push(issue("name_too_long", "warning", "Tên quá dài (có thể là ghi chú)", "name"));

    // giá
    if (!item.price || item.price === 0) issues.push(issue("missing_price", "error", "Thiếu giá", "costPrice"));
    else if (item.price < 1000) issues.push(issue("price_too_low", "error", "Giá thấp bất thường (<1.000đ)", "costPrice"));
    else if (item.price > 5_000_000_000) issues.push(issue("price_too_high", "error", "Giá cao bất thường (>5 tỷ)", "costPrice"));

    // sku
    if (!item.sku && !item._subtotalSuspect) issues.push(issue("missing_sku", "info", "Thiếu mã SKU — vẫn có thể nhập nếu tên và giá đã rõ", "sku"));
    if (!item.sku && /^sản phẩm$/i.test(String(item.name || "").trim())) {
      issues.push(issue("generic_product_name", "error", "Tên sản phẩm quá chung chung vì không tìm được tên thật/SKU", "name", "Sửa tên hoặc chọn lại mapping cột tên/tính năng"));
    }

    // dấu hiệu vẫn là dòng nhiễu lọt qua
    const lower = (item.name || "").toLowerCase();
    if (/tổng cộng|thành tiền|vat|thuế|chiết khấu|ghi chú/.test(lower)) {
      issues.push(issue("possible_note_or_total", "warning", "Có thể là dòng tổng/ghi chú", "name"));
    }

    // Dòng tổng nhóm: tên chỉ là loại sản phẩm chung + không SKU + specs rỗng.
    // Đây là dòng engine đã nhận diện để BỎ QUA, không phải lỗi người dùng cần sửa.
    // Score layer sẽ chuyển status = skipped để không đưa vào catalog và không hiện như lỗi nặng.
    if (item._subtotalSuspect) {
      issues.push(issue("generic_category_subtotal", "info",
        "Dòng tổng nhóm đã được SmartQuote nhận diện và bỏ qua",
        "name", "Không cần sửa nếu đây là dòng tổng/nhóm"));
    }

    // trùng giá = 0 và không mã => nghi ngờ
    if (!item.price && !item.sku) issues.push(issue("no_price_no_sku", "error", "Không giá & không mã — nghi ngờ không phải sản phẩm", "name"));

    return { ...item, issues };
  });
}
