// Tiny key/value settings store backed by the `app_settings` collection. Holds
// things like the author bio + favicon URL. Cached in module memory;
// subscribers get notified on change.

import { useEffect, useState, useSyncExternalStore } from "react";
import { pb } from "@/lib/pocketbase";

const cache = new Map<string, unknown>();
const recordIds = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;
let loaded = false;
let loadPromise: Promise<void> | null = null;

function emit() {
  version++;
  for (const l of listeners) l();
}

interface SettingRecord {
  id: string;
  key: string;
  value: unknown;
  updated: string;
}

const settings = () => pb.collection<SettingRecord>("app_settings");

/**
 * Pull every setting from PocketBase + subscribe to realtime updates. Memoized:
 * every caller awaits the SAME load, so the cache is guaranteed populated when
 * the returned promise resolves (callers must not race on a half-filled cache).
 */
export function installSettings(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = load();
  return loadPromise;
}

async function load(): Promise<void> {
  let records: SettingRecord[];
  try {
    records = await settings().getFullList();
  } catch (err) {
    console.error("loadSettings failed:", err);
    return;
  }
  for (const r of records) {
    cache.set(r.key, r.value);
    recordIds.set(r.key, r.id);
  }
  loaded = true;
  emit();

  void settings()
    .subscribe("*", (e) => {
      if (e.action === "delete") {
        cache.delete(e.record.key);
        recordIds.delete(e.record.key);
        emit();
        return;
      }
      cache.set(e.record.key, e.record.value);
      recordIds.set(e.record.key, e.record.id);
      emit();
    })
    .catch((err) => console.error("settings realtime failed:", err));
}

export function getSetting<T = unknown>(key: string, fallback?: T): T | undefined {
  if (cache.has(key)) return cache.get(key) as T;
  return fallback;
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  cache.set(key, value);
  emit();
  try {
    let id = recordIds.get(key);
    if (!id) {
      const found = await settings()
        .getFirstListItem(pb.filter("key = {:k}", { k: key }))
        .catch(() => null);
      id = found?.id;
    }
    const saved = id
      ? await settings().update(id, { value })
      : await settings().create({ key, value });
    recordIds.set(key, saved.id);
  } catch (err) {
    console.error("setSetting failed:", err);
  }
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
