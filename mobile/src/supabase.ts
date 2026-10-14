import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { AppState } from "react-native";

// Public values: safe to ship in the app. Data is protected by per-user database rules.
export const SUPABASE_URL = "https://uwfzijmqwkpaezmpsxwx.supabase.co";
export const SUPABASE_KEY = "sb_publishable_mndiGcFx_GmEqdZbo9lXYg_iJr8fzlT";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Keep the login fresh only while the app is open.
AppState.addEventListener("change", (state) => {
  if (state === "active") supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
