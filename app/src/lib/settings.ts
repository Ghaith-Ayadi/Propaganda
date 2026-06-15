// Tiny key/value settings store backed by `public.app_settings`. Holds things
// like the author bio + favicon URL. Cached in module memory; subscribers get
// notified on change.

import { useEffect, useState, useSyncExternalStore } from "react";
import { supabase } from "@/lib/supabase";

const cache = new Map<string, unknown>();
const listeners = new Set<() => void>();
let version = 0;
let loaded = false;
let loadPromise: Promise<void> | null = null;

function emit() {
  version++;
  for (const l of listeners) l();
}

interface SettingRow {
  key: string;
  value: unknown;
  updated_at: string;
}

/**
 * Pull every setting from Supabase + subscribe to realtime updates. Memoized:
 * every caller awaits the SAME load, so the cache is guaranteed populated when
 * the returned promise resolves (callers must not race on a half-filled cache).
 */
export function installSettings(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = load();
  return loadPromise;
}

async function load(): Promise<void> {
  const { data, error } = await supabase.from("app_settings").select("*");
  if (error) {
    console.error("loadSettings failed:", error);
    return;
  }
  for (const row of (data ?? []) as SettingRow[]) {
    cache.set(row.key, row.value);
  }
  loaded = true;
  emit();

  supabase
    .channel("verbatim:app_settings")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "app_settings" },
      (payload) => {
        if (payload.eventType === "DELETE") {
          const old = payload.old as { key?: string };
          if (old.key) {
            cache.delete(old.key);
            emit();
          }
          return;
        }
        const row = payload.new as SettingRow;
        if (!row?.key) return;
        cache.set(row.key, row.value);
        emit();
      },
    )
    .subscribe();
}

export function getSetting<T = unknown>(key: string, fallback?: T): T | undefined {
  if (cache.has(key)) return cache.get(key) as T;
  return fallback;
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  cache.set(key, value);
  emit();
  const { error } = await supabase
    .from("app_settings")
    .upsert({ key, value });
  if (error) console.error("setSetting failed:", error);
}

/** Subscribe to all setting changes. */
export function useSettingsVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => version,
  );
}

/** Get-and-subscribe convenience hook for a single key. */
export function useSetting<T>(key: string, fallback?: T): T | undefined {
  useSettingsVersion();
  const [, force] = useState(0);
  useEffect(() => {
    if (!loaded) void installSettings().then(() => force((n) => n + 1));
  }, []);
  return getSetting<T>(key, fallback);
}
