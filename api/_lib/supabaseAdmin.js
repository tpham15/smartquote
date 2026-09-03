import { createClient } from '@supabase/supabase-js';

let adminClient = null;

export function isApiAuthDisabled() {
  return String(process.env.SMARTQUOTE_API_AUTH_DISABLED || '').toLowerCase() === 'true';
}

export function getSupabaseAdmin() {
  if (adminClient) return adminClient;

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Server auth chưa được cấu hình. Cần SUPABASE_URL và SUPABASE_SERVICE_ROLE_KEY trong Vercel env.');
  }

  adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return adminClient;
}
