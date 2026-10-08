// Light / dark theme. Genesis's CSS keys off the `.dark-mode` class on the
// root element — we just add/remove it.

import { useEffect, useState } from "react";

export type Theme = "light" | "dark";
/** What the person chose: follow the system (the default), or pin one. */
export type ThemePref = "system" | "light" | "dark";

const KEY = "verbatim:theme";

function readPref(): ThemePref {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === "light" || raw === "dark") return raw;
  } catch {
    /* private mode: follow the system */
  }
  return "system";
}

function systemTheme(): Theme {
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return "dark";
}

const resolve = (p: ThemePref): Theme => (p === "system" ? systemTheme() : p);

function apply(t: Theme) {
  if (typeof document === "undefined") return;
  if (t === "dark") document.documentElement.classList.add("dark-mode");
  else document.documentElement.classList.remove("dark-mode");
}

let pref: ThemePref = readPref();
let current: Theme = resolve(pref);
apply(current);

const listeners = new Set<(t: Theme) => void>();

export function getTheme(): Theme {
  return current;
}

function update(next: Theme): void {
  if (next === current) return;
  current = next;
  apply(next);
  for (const l of listeners) l(next);
}

export function getThemePref(): ThemePref {
  return pref;
}

/** Settings > Appearance. "system" follows the OS, live. */
export function setThemePref(p: ThemePref): void {
  pref = p;
  try {
    if (p === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, p);
  } catch {
    /* private mode */
  }
  for (const l of prefListeners) l(p);
  update(resolve(p));
}

// Follow the OS while the preference is "system".
if (typeof window !== "undefined" && window.matchMedia) {
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (pref === "system") update(systemTheme());
  });
}

const prefListeners = new Set<(p: ThemePref) => void>();

export function useThemePref(): [ThemePref, (p: ThemePref) => void] {
  const [v, setV] = useState<ThemePref>(pref);
  useEffect(() => {
    prefListeners.add(setV);
    return () => {
      prefListeners.delete(setV);
    };
  }, []);
  return [v, setThemePref];
}

/** Pins one theme (the keyboard toggle). */
export function setTheme(t: Theme): void {
  setThemePref(t);
}

export function toggleTheme(): void {
  setTheme(current === "dark" ? "light" : "dark");
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [v, setV] = useState<Theme>(current);
  useEffect(() => {
    const fn = (t: Theme) => setV(t);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return [v, setTheme];
}
