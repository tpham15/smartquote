import { createClient } from "@supabase/supabase-js";

const viteEnv = import.meta?.env || {};
const nodeEnv = typeof process !== "undefined" ? process.env || {} : {};

const supabaseUrl = viteEnv.VITE_SUPABASE_URL || nodeEnv.VITE_SUPABASE_URL || "";
const supabaseAnonKey = viteEnv.VITE_SUPABASE_ANON_KEY || nodeEnv.VITE_SUPABASE_ANON_KEY || "";

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
