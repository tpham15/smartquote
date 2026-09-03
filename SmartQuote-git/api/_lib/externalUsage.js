import { monthStartIso, normalizePlan } from './limits.js';

const PROVIDER_DEFAULT_UNIT_COST_USD = {
  serper: 0.001,
  anthropic: 0,
};

function normalizeProvider(provider) {
  return String(provider || '').trim().toLowerCase().replace(/[^a-z0-9_\-]/g, '').slice(0, 40) || 'unknown';
}

function normalizeOperation(operation) {
  return String(operation || '').trim().toLowerCase().replace(/[^a-z0-9_\-]/g, '').slice(0, 80) || 'unknown';
}

function normalizeUsd(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return Number(fallback) || 0;
  return Math.round(n * 1_000_000) / 1_000_000;
}

function envBudgetOverride(provider, plan) {
  const p = normalizeProvider(provider).toUpperCase();
  const planKey = normalizePlan(plan).toUpperCase();
  const specific = process.env[`SMARTQUOTE_${p}_${planKey}_MONTHLY_BUDGET_USD`];
  const generic = process.env[`SMARTQUOTE_${p}_MONTHLY_BUDGET_USD`];
  const raw = specific ?? generic;
  if (raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, value) : null;
}

function envUnitCostOverride(provider) {
  const p = normalizeProvider(provider).toUpperCase();
  const raw = process.env[`SMARTQUOTE_${p}_UNIT_COST_USD`] || process.env.SMARTQUOTE_EXTERNAL_API_UNIT_COST_USD;
  if (raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, value) : null;
}

export async function getExternalApiBudget(auth, { provider }) {
  const normalizedProvider = normalizeProvider(provider);
  const plan = normalizePlan(auth?.plan || auth?.dealer?.plan || 'trial');
  const envBudget = envBudgetOverride(normalizedProvider, plan);
  const envUnitCost = envUnitCostOverride(normalizedProvider);

  if (auth?.devMode || String(process.env.SMARTQUOTE_EXTERNAL_BUDGET_DISABLED || '').toLowerCase() === 'true') {
    return {
      provider: normalizedProvider,
      plan,
      monthlyBudgetUsd: envBudget ?? Infinity,
      unitCostUsd: envUnitCost ?? PROVIDER_DEFAULT_UNIT_COST_USD[normalizedProvider] ?? 0,
      source: 'dev/env',
    };
  }

  if (!auth?.supabase) {
    return {
      provider: normalizedProvider,
      plan,
      monthlyBudgetUsd: envBudget ?? 0,
      unitCostUsd: envUnitCost ?? PROVIDER_DEFAULT_UNIT_COST_USD[normalizedProvider] ?? 0,
      source: 'fallback',
    };
  }

  const { data, error } = await auth.supabase
    .from('external_api_budget_catalog')
    .select('monthly_budget_usd, unit_cost_usd')
    .eq('provider', normalizedProvider)
    .eq('plan', plan)
    .maybeSingle();

  if (error) {
    const msg = String(error.message || '');
    if (/external_api_budget_catalog|relation .* does not exist/i.test(msg)) {
      const err = new Error('External API budget chưa được cấu hình. Hãy chạy supabase/phase8_2_operational_guardrails.sql trên Supabase.');
      err.statusCode = 500;
      throw err;
    }
    throw error;
  }

  return {
    provider: normalizedProvider,
    plan,
    monthlyBudgetUsd: envBudget ?? normalizeUsd(data?.monthly_budget_usd, 0),
    unitCostUsd: envUnitCost ?? normalizeUsd(data?.unit_cost_usd, PROVIDER_DEFAULT_UNIT_COST_USD[normalizedProvider] ?? 0),
    source: envBudget !== null || envUnitCost !== null ? 'env+sql' : 'sql',
  };
}

export async function getExternalApiSpendThisMonth(auth, { provider }) {
  if (!auth?.supabase || auth.devMode) return 0;
  const normalizedProvider = normalizeProvider(provider);
  const since = monthStartIso();
  const { data, error } = await auth.supabase
    .from('external_api_usage')
    .select('estimated_cost_usd')
    .eq('dealer_id', auth.dealerId)
    .eq('provider', normalizedProvider)
    .gte('created_at', since)
    .limit(10000);

  if (error) {
    const msg = String(error.message || '');
    if (/external_api_usage|relation .* does not exist/i.test(msg)) {
      const err = new Error('External API usage tracking chưa được cấu hình. Hãy chạy supabase/phase8_2_operational_guardrails.sql trên Supabase.');
      err.statusCode = 500;
      throw err;
    }
    throw error;
  }

  return normalizeUsd((data || []).reduce((sum, row) => sum + Number(row.estimated_cost_usd || 0), 0), 0);
}

export async function assertExternalBudget(auth, { provider, operation = '', plannedUnits = 1 } = {}) {
  const normalizedProvider = normalizeProvider(provider);
  const units = Math.max(1, Math.min(Math.ceil(Number(plannedUnits) || 1), 1000));
  const budget = await getExternalApiBudget(auth, { provider: normalizedProvider });
  if (budget.monthlyBudgetUsd === Infinity || auth?.devMode) {
    return { allowed: true, ...budget, usedUsd: 0, plannedUnits: units, plannedCostUsd: normalizeUsd(units * budget.unitCostUsd) };
  }
  const usedUsd = await getExternalApiSpendThisMonth(auth, { provider: normalizedProvider });
  const plannedCostUsd = normalizeUsd(units * budget.unitCostUsd);
  if (usedUsd + plannedCostUsd > budget.monthlyBudgetUsd) {
    const err = new Error(`Đã chạm ngân sách ${normalizedProvider} của gói ${budget.plan}. Đã dùng khoảng $${usedUsd.toFixed(4)}/$${Number(budget.monthlyBudgetUsd).toFixed(4)} trong tháng này.`);
    err.statusCode = 429;
    err.externalBudget = { provider: normalizedProvider, operation: normalizeOperation(operation), plan: budget.plan, budgetUsd: budget.monthlyBudgetUsd, usedUsd, plannedUnits: units, plannedCostUsd };
    throw err;
  }
  return { allowed: true, ...budget, usedUsd, plannedUnits: units, plannedCostUsd };
}

export async function recordExternalApiUsage(auth, { provider, operation, units = 1, unitCostUsd, meta = {} } = {}) {
  if (!auth?.supabase || auth.devMode) return null;
  const normalizedProvider = normalizeProvider(provider);
  const normalizedOperation = normalizeOperation(operation);
  const normalizedUnits = Math.max(1, Math.min(Math.ceil(Number(units) || 1), 10000));
  const budget = await getExternalApiBudget(auth, { provider: normalizedProvider });
  const actualUnitCost = normalizeUsd(unitCostUsd, budget.unitCostUsd);
  const estimatedCostUsd = normalizeUsd(normalizedUnits * actualUnitCost);

  const { data, error } = await auth.supabase
    .from('external_api_usage')
    .insert({
      dealer_id: auth.dealerId,
      user_id: auth.user?.id || null,
      provider: normalizedProvider,
      operation: normalizedOperation,
      units: normalizedUnits,
      estimated_cost_usd: estimatedCostUsd,
      currency: 'USD',
      meta: meta || {},
    })
    .select('id, estimated_cost_usd')
    .single();

  if (error) throw error;
  return data;
}
