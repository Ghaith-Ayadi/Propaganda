// A collection's rules for the agents (public.collection_rules): how the
// Pitcher and the Writer write posts in it. Private to the site's members,
// unlike the description, which the blog shows. Read and written straight on
// the server (not synced): they matter only to the agents, which run there.

import { coded } from "@/lib/errors";
import { siteId } from "@/lib/scope";
import { must, sb } from "@/lib/supabase";

async function collectionId(name: string): Promise<string | null> {
  const rows = await must(sb.from("collections").select("id").eq("site", siteId()).eq("name", name).limit(1));
  return (rows as { id: string }[])[0]?.id ?? null;
}

/** The collection's rules; "" when it has none, or none saved on the server yet. */
export async function loadCollectionRules(name: string): Promise<string> {
  try {
    const id = await collectionId(name);
    if (!id) return "";
    const rows = await must(sb.from("collection_rules").select("rules").eq("site", siteId()).eq("collection", id).limit(1));
    return (rows as { rules: string }[])[0]?.rules ?? "";
  } catch (err) {
    throw coded("COLLECTION-RULES", err, "Couldn't load this collection's rules.");
  }
}

export async function saveCollectionRules(name: string, rules: string): Promise<void> {
  try {
    const id = await collectionId(name);
    if (!id) throw new Error("the collection isn't on the server yet");
    await must(sb.from("collection_rules").upsert({ collection: id, site: siteId(), rules: rules.trim().slice(0, 8000) }));
  } catch (err) {
    throw coded("COLLECTION-RULES", err, "Couldn't save this collection's rules. Try again.");
  }
}
