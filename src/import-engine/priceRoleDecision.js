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
    const meta = product?._meta || {};
    const hasRoleHistory = !!meta.priceColumnConfirmed && Number(meta.priceColumnOriginalValue || 0) > 0;
    if (!hasAmbiguousPriceRole(product) && !hasRoleHistory) return product;

    const sourceIssues = baseIssues(product);
    const retainedIssues = sourceIssues.filter((it) => {
      const code = issueCode(it);
      if (code === 'price_column_uncertain') return false;
      if (['price_role_confirmed_cost','price_role_confirmed_list','missing_cost_price'].includes(code)) return false;
      return !/(?:^|pilot_business_)(?:price_change_|list_price_change_|list_below_existing_cost)/.test(code);
    });

    const sourcePrice = Number(meta.priceColumnOriginalValue || product?.costPrice || product?.price || product?.listPrice || product?.publicPrice || 0) || 0;
    const originalListPrice = Number(meta.priceColumnOriginalListPrice ?? product?.listPrice ?? product?.publicPrice ?? 0) || 0;
    const originalPriceMode = meta.priceColumnOriginalPriceMode || product?.priceMode || 'markup';
    const nextBaseMeta = {
      ...meta,
      priceColumnOriginalValue: sourcePrice,
      priceColumnOriginalListPrice: originalListPrice,
      priceColumnOriginalPriceMode: originalPriceMode,
      priceColumnConfirmed: true,
      priceColumnRole: role,
      priceColumnConfirmedAt: confirmedAt,
    };

    if (role === 'cost') {
      return {
        ...product,
        price: sourcePrice,
        costPrice: sourcePrice,
        listPrice: originalListPrice,
        publicPrice: originalListPrice,
        priceMode: originalListPrice > 0 ? 'fixed' : originalPriceMode,
        _meta: {
          ...nextBaseMeta,
          issues: retainedIssues.concat([{
            code: 'price_role_confirmed_cost',
            level: 'info',
            message: 'Người dùng xác nhận cột Đơn giá là giá nhập/giá vốn',
            field: 'costPrice',
          }]),
        },
      };
    }

    return {
      ...product,
      price: 0,
      costPrice: 0,
      listPrice: sourcePrice,
      publicPrice: sourcePrice,
      priceMode: 'fixed',
      _meta: {
        ...nextBaseMeta,
        issues: retainedIssues.concat([
          {
            code: 'price_role_confirmed_list',
            level: 'info',
            message: 'Người dùng xác nhận cột Đơn giá là giá bán/niêm yết',
            field: 'listPrice',
          },
          {
            code: 'missing_cost_price',
            level: 'info',
            message: 'File không cung cấp giá nhập sau khi xác nhận Đơn giá là giá bán',
            field: 'costPrice',
            suggestedFix: 'Bổ sung giá nhập khi có bảng giá nhà cung cấp',
          },
        ]),
      },
    };
  });
}
