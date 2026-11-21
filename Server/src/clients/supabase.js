import { createClient } from "@supabase/supabase-js";
import { getRequiredEnv } from "../env.js";

let cachedSupabase = null;

export function getSupabaseClient() {
  if (!cachedSupabase) {
    cachedSupabase = createClient(
      getRequiredEnv("SUPABASE_URL"),
      getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );
  }
  return cachedSupabase;
}
