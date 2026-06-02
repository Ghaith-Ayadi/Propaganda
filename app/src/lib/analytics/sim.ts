// Simulated-analytics mode. Activated from the command palette via
// `/simulateTraffic`. Lives entirely in the frontend — no backend writes.
//
// When active, every `useAnalytics*` hook returns data synthesized from
// the dataset in ./dataset.ts instead of (eventually) querying real
// events from Cloudflare Analytics Engine.

import { useEffect, useState } from "react";

const KEY = "verbatim:sim-mode";

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

const listeners = new Set<(on: boolean) => void>();
let current = read();

export function isSimMode(): boolean {
  return current;
}

export function setSimMode(on: boolean): void {
  if (on === current) return;
  current = on;
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {}
  for (const l of listeners) l(on);
}

export function toggleSimMode(): void {
  setSimMode(!current);
}

export function useSimMode(): boolean {
  const [on, setOn] = useState(current);
  useEffect(() => {
    const fn = (v: boolean) => setOn(v);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return on;
}

// Fixed seed: same dataset every reload. Stable for screenshots + demos.
// If we want a "shuffle" affordance later, expose this through the UI.
export const SIM_SEED = 0x42;
