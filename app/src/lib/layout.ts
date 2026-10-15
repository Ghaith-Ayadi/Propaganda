// Sidebar / attribute panel visibility and the details panel's width, persisted
// in localStorage. Author mode = both panels hidden.

import { useEffect, useState } from "react";

const STORAGE_KEY = "verbatim:layout";

/** The details panel (right): default, and the range a drag can reach. */
export const ATTRIBUTES_WIDTH = { default: 320, min: 260, max: 640 } as const;

interface Layout {
  sidebar: boolean;
  attributes: boolean;
  /** The left drawer shrinks to an icon rail instead of hiding. */
  sidebarCollapsed: boolean;
  attributesWidth: number;
}

const DEFAULTS: Layout = {
  sidebar: true,
  attributes: true,
  sidebarCollapsed: false,
  attributesWidth: ATTRIBUTES_WIDTH.default,
};

export function clampWidth(w: number): number {
  const max = Math.min(ATTRIBUTES_WIDTH.max, Math.round(window.innerWidth * 0.6));
  return Math.max(ATTRIBUTES_WIDTH.min, Math.min(max, Math.round(w)));
}

function read(): Layout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {}
  return DEFAULTS;
}

function write(l: Layout) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(l));
  } catch {}
}

const listeners = new Set<(l: Layout) => void>();
let current = read();

export function useLayout(): [Layout, (patch: Partial<Layout>) => void, () => void] {
  const [state, setState] = useState(current);
  useEffect(() => {
    const fn = (l: Layout) => setState(l);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);

  const update = (patch: Partial<Layout>) => {
    current = { ...current, ...patch };
    write(current);
    for (const l of listeners) l(current);
  };

  const toggleAuthorMode = () => {
    const hidden = !state.sidebar && !state.attributes;
    update(hidden ? { sidebar: true, attributes: true } : { sidebar: false, attributes: false });
  };

  return [state, update, toggleAuthorMode];
}
