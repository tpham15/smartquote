import { supabase } from "./client.js";

const emptyState = {
  products: [],
  templates: [],
  company: null,
  markups: [],
  suppliers: [],
  nameMap: {},
};

export async function signUpDealer({ email, password, dealerName, fullName }) {
  if (!supabase) throw new Error("Supabase chưa được cấu hình.");
  return supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        dealer_name: dealerName || "Đại lý SmartQuote",
        full_name: fullName || "",
      },
    },
  });
}

export async function signInDealer({ email, password }) {
  if (!supabase) throw new Error("Supabase chưa được cấu hình.");
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signOutDealer() {
  if (!supabase) return;
  return supabase.auth.signOut();
}

export async function requestPasswordReset(email, redirectTo) {
  if (!supabase) throw new Error("Supabase chưa được cấu hình.");
  return supabase.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined);
}

export async function updateCurrentUserPassword(password) {
  if (!supabase) throw new Error("Supabase chưa được cấu hình.");
  return supabase.auth.updateUser({ password });
}

export async function ensureDealerWorkspace(dealerName = "Đại lý SmartQuote") {
  if (!supabase) throw new Error("Supabase chưa được cấu hình.");
  const { data, error } = await supabase.rpc("ensure_dealer_workspace", {
    dealer_name_input: dealerName || "Đại lý SmartQuote",
  });
  if (error) throw error;
  return data;
}

export async function loadCloudState(dealerId) {
  if (!supabase || !dealerId) return emptyState;
  const { data, error } = await supabase
    .from("dealer_app_state")
    .select("products, templates, company, markups, suppliers, name_map, updated_at")
    .eq("dealer_id", dealerId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return emptyState;

  return {
    products: Array.isArray(data.products) ? data.products : [],
    templates: Array.isArray(data.templates) ? data.templates : [],
    company: data.company || null,
    markups: Array.isArray(data.markups) ? data.markups : [],
    suppliers: Array.isArray(data.suppliers) ? data.suppliers : [],
    nameMap: data.name_map && typeof data.name_map === "object" ? data.name_map : {},
    updatedAt: data.updated_at,
  };
}

export async function saveCloudState(dealerId, state) {
  if (!supabase || !dealerId) return;
  // Phase 5: catalog/products are stored in public.catalog_items.
  // Keep dealer_app_state.products empty so the settings snapshot stays lightweight.
  const payload = {
    dealer_id: dealerId,
    products: [],
    templates: state.templates || [],
    company: state.company || {},
    markups: state.markups || [],
    suppliers: state.suppliers || [],
    name_map: state.nameMap || {},
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("dealer_app_state")
    .upsert(payload, { onConflict: "dealer_id" });

  if (error) throw error;
}


function monthStartIso(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString();
}

export async function loadDealerBilling(dealerId) {
  if (!supabase || !dealerId) return { dealer: null, usage: {} };

  const { data: dealer, error: dealerError } = await supabase
    .from("dealers")
    .select("id, name, plan, trial_ends_at, subscription_status, current_period_end, plan_started_at, updated_at")
    .eq("id", dealerId)
    .maybeSingle();
  if (dealerError) throw dealerError;

  const { data: usageRows, error: usageError } = await supabase
    .from("usage_events")
    .select("event_type, units")
    .eq("dealer_id", dealerId)
    .gte("created_at", monthStartIso())
    .limit(10000);
  if (usageError) throw usageError;

  const usage = {};
  (usageRows || []).forEach((row) => {
    const key = row.event_type;
    usage[key] = (usage[key] || 0) + (Number(row.units) || 0);
  });

  return { dealer, usage, loadedAt: new Date().toISOString() };
}
