// Which tenants are on Lite (no AI). Its own module so store.ts and
// first-day.ts both import it without an import cycle.

/**
 * The tenants on Lite by id alone: Verbatim, and WORKER_LITE_SITES
 * (comma-separated ids). A tenant that picked Lite carries `tenant.plan` =
 * "lite" in app_settings as well: `isLite()` in store.ts reads both. Not
 * kb_agent_sites: that list is turned on by hand, so every new tenant would
 * read as Lite on its first day.
 */
export function isLiteById(site: string): boolean {
  const extra = (process.env.WORKER_LITE_SITES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return site === "verbatimsite000" || extra.includes(site);
}
