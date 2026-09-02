import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
loadEnv({ path: "/Users/ghaithayadi/code/Personal/Propaganda/.env.local" });
const anon = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);
const t0 = Date.now();
const { error } = await anon.auth.resetPasswordForEmail("contact@ayadighaith.com", {
  redirectTo: "https://verbatim-rho.vercel.app/admin",
});
console.log(`resetPasswordForEmail → ${error ? "ERROR: " + error.message : "accepted"} (${Date.now() - t0}ms)`);
