// How the admin pages name a tenant: its address (the slug: havok, munch,
// ppgd), then its business name when that says something else. Getting
// started sets the business name as the site's name, so on a test tenant the
// name alone ("Gaia K12") hides which tenant ran (Ayadi, 2026-10-11).

import type { Client } from "@/lib/supabase";

export function tenantLabel(s: { slug: string; name: string }): string {
  return s.name && s.name.toLowerCase() !== s.slug.toLowerCase() ? `${s.slug} · ${s.name}` : s.slug;
}

/** Labels for these site ids. Sites are publicly readable. */
export async function tenantNames(client: Client, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await client.from("sites").select("id,name,slug").in("id", ids);
  return new Map((data ?? []).map((s: { id: string; name: string; slug: string }) => [s.id, tenantLabel(s)]));
}
