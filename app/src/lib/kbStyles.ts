// The knowledge base's Styles (public.kb_styles): how the tenant wants its
// writing to sound, one rule a row. Every agent that writes reads the active
// ones after our twenty rules. Read and written straight on the server (not
// synced): they matter only to the agents, which run there. Nothing is
// deleted; a rule nobody wants is retired.

import { coded } from "@/lib/errors";
import { siteId } from "@/lib/scope";
import { BackendError, must, sb } from "@/lib/supabase";

export interface StyleRule {
  id: string;
  rule: string;
  example: string;
  created: string;
}

/** The active rules, oldest first; none on a server without the table yet. */
export async function loadStyles(): Promise<StyleRule[]> {
  try {
    const { data, error, status } = await sb
      .from("kb_styles")
      .select("id,rule,example,created")
      .eq("site", siteId())
      .eq("status", "active")
      .order("created", { ascending: true });
    // PGRST205: the table isn't on this server yet.
    if (error && (error.code === "PGRST205" || status === 404)) return [];
    if (error) throw new BackendError(error, status);
    return (data ?? []) as StyleRule[];
  } catch (err) {
    throw coded("KB-STYLES", err, "Couldn't load your style rules.");
  }
}

export async function addStyle(rule: string, example: string): Promise<void> {
  try {
    await must(sb.from("kb_styles").insert({ site: siteId(), rule: rule.trim().slice(0, 2000), example: example.trim().slice(0, 2000) }));
  } catch (err) {
    throw coded("KB-STYLES", err, "Couldn't add this rule. Try again.");
  }
}

export async function retireStyle(id: string): Promise<void> {
  try {
    await must(sb.from("kb_styles").update({ status: "retired" }).eq("site", siteId()).eq("id", id));
  } catch (err) {
    throw coded("KB-STYLES", err, "Couldn't retire this rule. Try again.");
  }
}
