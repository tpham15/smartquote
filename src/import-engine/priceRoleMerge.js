// RC14: merge semantics for explicitly confirmed ambiguous price columns.
export function mergeImportedCatalogProduct(existing = {}, incoming = {}) {
  const role = incoming?._meta?.priceColumnRole || "";
  const base = { ...existing };
  const common = {
    ...base,
    ...incoming,
    image: base.image || incoming.image || "",
  };
  if (role === "list") {
    const list = Number(incoming.listPrice || incoming.publicPrice || 0) || 0;
    return {
      ...common,
      costPrice: Number(base.costPrice || 0) || 0,
      price: Number(base.price || 0) || 0,
      listPrice: list,
      publicPrice: list,
      priceMode: "fixed",
    };
  }
  if (role === "cost") {
    return {
      ...common,
      costPrice: Number(incoming.costPrice || incoming.price || 0) || 0,
      price: Number(incoming.costPrice || incoming.price || 0) || 0,
      listPrice: Number(base.listPrice || 0) || 0,
      publicPrice: Number(base.publicPrice || base.listPrice || 0) || 0,
      priceMode: base.priceMode || (base.listPrice || base.publicPrice ? "fixed" : "markup"),
    };
  }
  return common;
}
