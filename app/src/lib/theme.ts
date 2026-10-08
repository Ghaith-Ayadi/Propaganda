// Light / dark theme. Genesis's CSS keys off the `.dark-mode` class on the
// root element — we just add/remove it.
//
// The preference is "system" (the default: follow the OS, live), "light" or
// "dark". Settings owns the choice (setThemePreference); ⌘K and ⌘⇧L flip to an
// explicit theme. useTheme() returns the theme in effect, never "system".

import { useEffect, useState } from "react";

export type Theme = "light" | "dark";
export type ThemePreference = Theme | "system";

const KEY = "verbatim:theme";
const QUERY = "(prefers-color-scheme: dark)";

function readPreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {}
  return "system";
}

function systemTheme(): Theme {
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia(QUERY).matches ? "dark" : "light";
  }
  return "light";
}

function resolve(p: ThemePreference): Theme {
  return p === "system" ? systemTheme() : p;
}

function apply(t: Theme) {
  if (typeof document === "undefined") return;
  if (t === "dark") document.documentElement.classList.add("dark-mode");
  else document.documentElement.classList.remove("dark-mode");
}

let preference: ThemePreference = readPreference();
let current: Theme = resolve(preference);
apply(current);

const listeners = new Set<() => void>();

function update() {
  const next = resolve(preference);
  if (next !== current) {
    current = next;
    apply(current);
  }
  for (const l of listeners) l();
}

if (typeof window !== "undefined" && window.matchMedia) {
  window.matchMedia(QUERY).addEventListener("change", () => {
    if (preference === "system") update();
  });
}

export function getTheme(): Theme {
  return current;
}

export function getThemePreference(): ThemePreference {
  return preference;
}

export function setThemePreference(p: ThemePreference): void {
  preference = p;
  try {
    localStorage.setItem(KEY, p);
  } catch {}
  update();
}

/** Pin an explicit theme (⌘K, ⌘⇧L). Settings can put it back on "system". */
export function setTheme(t: Theme): void {
  setThemePreference(t);
}

export function toggleTheme(): void {
  setTheme(current === "dark" ? "light" : "dark");
}

function useStore<T>(read: () => T): T {
  const [v, setV] = useState<T>(read);
  useEffect(() => {
    const fn = () => setV(read);
    listeners.add(fn);
    fn();
    return () => {
      listeners.delete(fn);
    };
  }, [read]);
  return v;
}

/** The theme in effect (light or dark). */
export function useTheme(): [Theme, (t: Theme) => void] {
  return [useStore(getTheme), setTheme];
}

/** The stored preference, for the Settings control. */
export function useThemePreference(): [ThemePreference, (p: ThemePreference) => void] {
  return [useStore(getThemePreference), setThemePreference];
}
