// Custom blog themes: site data (the `blog.themes` setting of the active site;
// blog/theme/design.ts has the format). No UI and no checks yet, on purpose:
// installing one is a console call in the editor, signed in to the site:
//
//   await propaganda.installTheme("/themes/verbatim.json")   // a URL, or the theme object
//   propaganda.themes()                                      // the site's custom themes
//   await propaganda.removeTheme("verbatim")
//
// Installing only makes the theme available: the blog changes when a design
// that uses it is published from Settings → Design.

import { getSetting, installSettings, setSetting } from "@/lib/settings";
import { asCustomThemes, THEMES_KEY } from "@/blog/theme/design";
import { THEMES } from "@/blog/theme/themes";
import type { ThemeSource } from "@/blog/theme/compile";

export function customThemes(): Record<string, ThemeSource> {
  return asCustomThemes(getSetting(THEMES_KEY, null));
}

export async function installTheme(theme: ThemeSource | string): Promise<string> {
  await installSettings();
  const t = typeof theme === "string" ? ((await (await fetch(theme)).json()) as ThemeSource) : theme;
  if (!t || typeof t.id !== "string" || !t.id) throw new Error("A theme needs an id");
  if (THEMES[t.id]) throw new Error(`"${t.id}" is a built-in theme's id; pick another`);
  await setSetting(THEMES_KEY, { ...customThemes(), [t.id]: t });
  return t.id;
}

export async function removeTheme(id: string): Promise<void> {
  await installSettings();
  const next = { ...customThemes() };
  delete next[id];
  await setSetting(THEMES_KEY, next);
}

declare global {
  interface Window {
    propaganda?: { installTheme: typeof installTheme; removeTheme: typeof removeTheme; themes: typeof customThemes };
  }
}

export function exposeThemeConsole(): void {
  if (typeof window !== "undefined") window.propaganda = { installTheme, removeTheme, themes: customThemes };
}
