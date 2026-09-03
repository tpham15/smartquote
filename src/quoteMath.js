export function normalizePercent(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return Math.max(0, Math.min(100, Number(fallback) || 0));
  return Math.max(0, Math.min(100, n));
}

export function calculateQuoteTotals({ deviceTotal = 0, laborPercent = 0, vatPercent = 0 } = {}) {
  const goods = Math.max(0, Number(deviceTotal) || 0);
  const laborRate = normalizePercent(laborPercent, 0);
  const vatRate = normalizePercent(vatPercent, 0);
  const laborTotal = Math.round((goods * laborRate) / 100);
  const preTaxTotal = goods + laborTotal;
  const vatTotal = Math.round((preTaxTotal * vatRate) / 100);
  return {
    deviceTotal: goods,
    laborPercent: laborRate,
    laborTotal,
    preTaxTotal,
    vatPercent: vatRate,
    vatTotal,
    grand: preTaxTotal + vatTotal,
  };
}
