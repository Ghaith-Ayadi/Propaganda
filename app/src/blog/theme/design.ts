// A site's blog design, stored as site data in app_settings (per site, public
// read, realtime):
//
//   blog.design        the published design: { api, theme, overrides }. A site
//                      without one keeps the original blog renderer; publishing
//                      a design switches it to the themed templates.
//   blog.design.draft  what the Design panel is editing. The blog shows it only
//                      under ?pg-preview=draft (the panel's preview frame).
//   blog.themes        the site's custom themes: { [id]: ThemeSource }. Same
//                      format as the built-in themes (Theme API v1), plus
//                      `fonts.custom` and `brand.logo`. A design's `theme` names
//                      a built-in theme or one of these.
//
// Custom themes are content like any other site data; nothing here checks them
// beyond what compileTheme() already clamps. (Validation and upload are Part 2.)

import { compileTheme, type CompiledTheme, type ThemeSource } from "./compile";
import { DEFAULT_THEME, THEMES } from "./themes";
import type { DesignOverrides } from "./schema";

export const DESIGN_KEY = "blog.design";
export const DRAFT_KEY = "blog.design.draft";
export const THEMES_KEY = "blog.themes";

export interface SiteDesign {
  api: 1;
  theme: string;
  overrides: DesignOverrides;
}

export type CustomThemes = Record<string, ThemeSource>;

/** A stored value as a design, or null when it isn't one (no design yet, or garbage). */
export function asDesign(v: unknown): SiteDesign | null {
  if (!v || typeof v !== "object") return null;
  const d = v as Partial<SiteDesign>;
  if (typeof d.theme !== "string" || !d.theme) return null;
  const overrides = d.overrides && typeof d.overrides === "object" ? d.overrides : {};
  return { api: 1, theme: d.theme, overrides };
}

export function asCustomThemes(v: unknown): CustomThemes {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: CustomThemes = {};
  for (const [id, t] of Object.entries(v as Record<string, unknown>)) {
    if (t && typeof t === "object" && typeof (t as ThemeSource).fonts === "object" && typeof (t as ThemeSource).color === "object") {
      out[id] = { ...(t as ThemeSource), id };
    }
  }
  return out;
}

/** The theme a design names: built-in first, then the site's own; the default theme when neither has it. */
export function themeOf(id: string, custom: CustomThemes = {}): ThemeSource {
  return THEMES[id] ?? custom[id] ?? THEMES[DEFAULT_THEME];
}

const compiled = new WeakMap<ThemeSource, CompiledTheme>();

/** compileTheme(), memoized per theme object. */
export function compiledOf(theme: ThemeSource): CompiledTheme {
  let c = compiled.get(theme);
  if (!c) {
    c = compileTheme(theme);
    compiled.set(theme, c);
  }
  return c;
}

/** The compiled theme as a stylesheet, in the cascade layer pg.css reserves for themes. */
export function themeCss(c: CompiledTheme): string {
  return `@layer pg.theme {\n${c.css}\n}`;
}
