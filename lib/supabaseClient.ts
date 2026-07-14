// ============================================================
// lib/supabaseClient.ts
//
// Single shared Supabase client. Deliberately does NOT throw at
// import/module-load time if the environment variables are missing —
// that would break `next build`'s static prerendering, which imports
// every module even for client components. Instead, getSupabase()
// throws only when something actually tries to USE it, with a clear
// message pointing at what's missing.
// ============================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;
let attemptedInit = false;

export function getSupabase(): SupabaseClient {
  if (!attemptedInit) {
    attemptedInit = true;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (url && anonKey) {
      client = createClient(url, anonKey);
    }
  }
  if (!client) {
    throw new Error(
      'Supabase is not configured: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set (in .env.local for local dev, or via the Netlify Supabase extension for deployed sites).'
    );
  }
  return client;
}

/** Non-throwing check, for UI that wants to show a friendly "not connected yet" state. */
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
