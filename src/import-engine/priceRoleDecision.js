// Commercial-safety helper for ambiguous generic price columns such as "Đơn giá".
// The importer may extract the numeric value first, but must not silently decide
// whether that value is supplier cost or customer/list price.

function issueCode(it) {
  return String(typeof it === "string" ? "" : (it?.code || "")).toLowerCase();
}

function baseIssues(product = {}) {
  if (Array.isArray(product?._meta?.issues)) return product._meta.issues;
  if (Array.isArray(product?.issues)) return product.issues;
  return [];
}

export function hasAmbiguousPriceRole(product = {}) {
  return baseIssues(product).some((it) => issueCode(it) === "price_column_uncertain");
}

export function applyAmbiguousPriceRole(products = [], role = "") {
  if (!Array.isArray(products)) return [];
  if (!['cost', 'list'].includes(role)) return products;
  const confirmedAt = new Date().toISOString();

  return products.map((product) => {
    if (!hasAmbiguousPriceRole(product)) return product;
    const sourceIssues = baseIssues(product);
    const retainedIssues = sourceIssues.filter((it) => issueCode(it) !== 'price_column_uncertain');
    const sourcePrice = Number(product?.costPrice || product?.price || 0) || 0;

    if (role === 'cost') {
      return {
        ...product,
        _meta: {
          ...(product._meta || {}),
          issues: retainedIssues.concat([{
            code: 'price_role_confirmed_cost',
            level: 'info',
            message: 'Người dùng xác nhận cột Đơn giá là giá nhập/giá vốn',
            field: 'costPrice',
          }]),
          acceptedAtPreview: true,
          priceColumnConfirmed: true,
          priceColumnRole: 'cost',
          priceColumnConfirmedAt: confirmedAt,
        },
      };
    }

    const listPrice = sourcePrice || Number(product?.listPrice || product?.publicPrice || 0) || 0;
    return {
      ...product,
      price: 0,
      costPrice: 0,
      listPrice,
      publicPrice: listPrice,
      priceMode: 'fixed',
      _meta: {
        ...(product._meta || {}),
        issues: retainedIssues.concat([
          {
            code: 'price_role_confirmed_list',
            level: 'info',
            message: 'Người dùng xác nhận cột Đơn giá là giá bán/niêm yết',
            field: 'listPrice',
          },
          {
            code: 'missing_cost_price',
            level: 'warning',
            message: 'File không cung cấp giá nhập sau khi xác nhận Đơn giá là giá bán',
            field: 'costPrice',
            suggestedFix: 'Bổ sung giá nhập khi có bảng giá nhà cung cấp',
          },
        ]),
        acceptedAtPreview: true,
        priceColumnConfirmed: true,
        priceColumnRole: 'list',
        priceColumnConfirmedAt: confirmedAt,
      },
    };
  });
}
