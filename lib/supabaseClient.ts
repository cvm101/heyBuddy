"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

/**
 * Returns a singleton Supabase browser client.
 * The client persists the auth session in cookies so middleware and
 * route handlers can read it on the server side as well.
 */
export function getSupabaseBrowserClient(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) {
    // Surface the misconfiguration loudly. We can't usefully proceed.
    const msg =
      "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
      "Copy .env.local.example to .env.local and fill in the values from your Supabase project.";
    // eslint-disable-next-line no-console
    console.error("[supabaseClient]", msg);
    throw new Error(msg);
  }

  _client = createBrowserClient(url, anon);
  return _client;
}
