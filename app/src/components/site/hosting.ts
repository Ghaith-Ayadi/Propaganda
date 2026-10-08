// Where a tenant's blog lives and how it looks: settings of the site
// (app_settings, lib/settings.ts), so every member sees the same and nothing
// needs a schema change.
//
//   site.hosting           "propaganda" (we host it) or "elsewhere" (headless:
//                          it lives on Framer, WordPress, ..., and Propaganda
//                          publishes to it). Unset reads as "propaganda": every
//                          site has its blog at <slug>.propaganda.pub today.
//   site.hosting.platform  for "elsewhere": framer, webflow, wordpress, ...
//   site.hosting.url       for "elsewhere": the blog's address there
//   blog.theme             the blog's theme (THEMES below)
//   tenant.timezone        an IANA zone; sweeps and quarters follow it
//   tenant.language        the content language, a BCP 47 tag
//
// The blog renderer doesn't read blog.theme yet: there is one theme today. The
// key is here so the tenant's pick (Kontra's is made) is stored from day one.

import { setSetting, useSetting } from "@/lib/settings";

export type Hosting = "propaganda" | "elsewhere";

export const PLATFORMS: { value: string; label: string }[] = [
  { value: "framer", label: "Framer" },
  { value: "webflow", label: "Webflow" },
  { value: "wordpress", label: "WordPress" },
  { value: "ghost", label: "Ghost" },
  { value: "hubspot", label: "HubSpot" },
  { value: "squarespace", label: "Squarespace" },
  { value: "wix", label: "Wix" },
  { value: "substack", label: "Substack" },
  { value: "other", label: "Somewhere else" },
];

export function platformLabel(value: string): string {
  return PLATFORMS.find((p) => p.value === value)?.label ?? "another platform";
}

export interface Theme {
  id: string;
  label: string;
  description: string;
}

export const THEMES: Theme[] = [
  { id: "verbatim", label: "Verbatim", description: "Serif titles, a calm reading column, the post list on the home page." },
];

export const LANGUAGES: { value: string; label: string }[] = [
  { value: "en", label: "English" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "es", label: "Spanish" },
  { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" },
  { value: "nl", label: "Dutch" },
  { value: "ar", label: "Arabic" },
];

/** Every IANA zone the browser knows, with `current` first if the list leaves it out (Chrome omits "UTC"). */
export function timeZones(current: string): string[] {
  let zones: string[] = [];
  try {
    zones = (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
  } catch {
    // An old browser: the current zone alone.
  }
  return zones.includes(current) ? zones : [current, ...zones];
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export interface HostingSettings {
  hosting: Hosting;
  platform: string;
  url: string;
  theme: string;
  timezone: string;
  language: string;
}

export function useHosting(): HostingSettings {
  const hosting = useSetting<Hosting>("site.hosting", "propaganda") ?? "propaganda";
  const platform = useSetting<string>("site.hosting.platform", "") ?? "";
  const url = useSetting<string>("site.hosting.url", "") ?? "";
  const theme = useSetting<string>("blog.theme", THEMES[0].id) ?? THEMES[0].id;
  const timezone = useSetting<string>("tenant.timezone", "") || browserTimeZone();
  const language = useSetting<string>("tenant.language", "en") ?? "en";
  return { hosting: hosting === "elsewhere" ? "elsewhere" : "propaganda", platform, url, theme, timezone, language };
}

export const setHosting = (v: Hosting) => setSetting("site.hosting", v);
export const setPlatform = (v: string) => setSetting("site.hosting.platform", v);
export const setPlatformUrl = (v: string) => setSetting("site.hosting.url", v);
export const setTheme = (v: string) => setSetting("blog.theme", v);
export const setTimeZone = (v: string) => setSetting("tenant.timezone", v);
export const setLanguage = (v: string) => setSetting("tenant.language", v);
