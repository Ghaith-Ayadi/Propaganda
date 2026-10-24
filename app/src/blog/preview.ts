// Members' preview of a post that isn't published yet, on the app host:
//   app.propaganda.pub/<site slug>-preview/<collection slug>/<post slug>
// (postPreviewUrl() in lib/siteUrl.ts).
//
// The editor's Preview button opens it for every post that isn't published (a
// published post opens its public address). BlogApp renders it under that base
// path with the site's own blog design, and the post is read with the signed-in
// member's session: unpublished posts are private (row-level security), and the
// app host is the only origin that holds the session. Anyone else gets a "sign
// in" page; search engines are told noindex, and no page view is counted.

import type { Account, SiteRef } from "@/lib/accounts";
import { appOrigin } from "@/lib/siteUrl";
import type { Client } from "@/lib/supabase";
import { routeOf } from "./route";
import type { BlogSite } from "./siteTypes";

const PREFIX = /^\/([a-z0-9][a-z0-9-]*)-preview(?=\/|$)/;

interface Preview {
  siteSlug: string;
  /** "/<site slug>-preview": the base path the blog renders under. */
  base: string;
  /** The member's client, once resolvePreviewSite() found one. */
  client: Client | null;
}

// Read once, at load: the blog's own navigation keeps the base path.
const state: Preview | null = (() => {
  if (typeof window === "undefined" || window.location.origin !== appOrigin()) return null;
  const m = PREFIX.exec(window.location.pathname);
  return m ? { siteSlug: m[1], base: m[0], client: null } : null;
})();

/** True on a preview address. */
export function isPostPreview(): boolean {
  return state !== null;
}

export function previewBase(): string {
  return state?.base ?? "";
}

export function previewClient(): Client | null {
  return state?.client ?? null;
}

/** The post the address names, as it was when the page loaded. */
export function previewTarget(): { collection: string; slug: string } | null {
  if (!state) return null;
  const r = routeOf(window.location.pathname.slice(state.base.length) || "/");
  return r.view === "post" ? { collection: r.collection, slug: r.slug } : null;
}

function asBlogSite(s: SiteRef): BlogSite {
  return { id: s.id, slug: s.slug, domain: s.domain, name: s.name, analyticsTenant: s.analyticsTenant };
}

/**
 * The previewed site, through the first signed-in account on this browser that
 * is a member of it (cached memberships first, then the server's). Null when
 * none is: the page asks to sign in.
 */
export async function resolvePreviewSite(): Promise<BlogSite | null> {
  const preview = state;
  if (!preview) return null;
  // Loaded here, not at the top: the blog's rendering function shares this module and has no accounts.
  const { cachedSites, clientFor, fetchSites, hasValidSession, listAccounts } = await import("@/lib/accounts");
  const slug = preview.siteSlug;
  const accounts = listAccounts().filter(hasValidSession);
  const use = (account: Account, site: SiteRef) => {
    preview.client = clientFor(account);
    return asBlogSite(site);
  };
  for (const account of accounts) {
    const site = cachedSites(account.userId).find((s) => s.slug === slug);
    if (site) return use(account, site);
  }
  for (const account of accounts) {
    const sites = await fetchSites(account).catch(() => [] as SiteRef[]);
    const site = sites.find((s) => s.slug === slug);
    if (site) return use(account, site);
  }
  return null;
}
