// Tiny key/value settings store backed by the `app_settings` collection. Holds
// things like the author bio + favicon URL. Cached in module memory;
// subscribers get notified on change.
//
// Settings are per site. The cache is dropped on every scope switch
// (onScopeReset) and each load, write and subscription is pinned to the site
// and client that were active when it started.

import { useEffect, useState, useSyncExternalStore } from "react";
import type PocketBase from "pocketbase";
import { pb } from "@/lib/pocketbase";
import { onScopeReset, siteId } from "@/lib/scope";

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

const settingsOf = (client: PocketBase) => client.collection<SettingRecord>("app_settings");

// The public blog has no scope: it binds the site it is showing, read through
// the anonymous client (blog/BlogApp.tsx).
let publicTarget: { client: PocketBase; site: string } | null = null;

export function bindPublicSettings(client: PocketBase, site: string): void {
  publicTarget = { client, site };
}

function target(): { client: PocketBase; site: string } {
  return publicTarget ?? { client: pb, site: siteId() };
}
let unsubscribeRealtime: (() => Promise<void>) | null = null;
// Bumped on every scope switch: a load or write that started before it must not
// touch the new site's cache.
let epoch = 0;

onScopeReset(() => {
  epoch++;
  cache.clear();
  recordIds.clear();
  loaded = false;
  loadPromise = null;
  const unsub = unsubscribeRealtime;
  unsubscribeRealtime = null;
  void unsub?.().catch(() => undefined);
  emit();
});

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
  const mine = epoch;
  const { client, site } = target();
  const filter = client.filter("site = {:site}", { site });
  let records: SettingRecord[];
  try {
    records = await settingsOf(client).getFullList({ filter });
  } catch (err) {
    console.error("loadSettings failed:", err);
    // Let a later caller retry instead of awaiting this failure forever.
    if (mine === epoch) loadPromise = null;
    return;
  }
  if (mine !== epoch) return;
  for (const r of records) {
    cache.set(r.key, r.value);
    recordIds.set(r.key, r.id);
  }
  loaded = true;
  emit();

  void settingsOf(client)
    .subscribe("*", (e) => {
      if (mine !== epoch || (e.record as { site?: string }).site !== site) return;
      if (e.action === "delete") {
        cache.delete(e.record.key);
        recordIds.delete(e.record.key);
        emit();
        return;
      }
      cache.set(e.record.key, e.record.value);
      recordIds.set(e.record.key, e.record.id);
      emit();
    }, { filter })
    .then((unsub) => {
      if (mine === epoch) unsubscribeRealtime = unsub;
      else void unsub();
    })
    .catch((err) => console.error("settings realtime failed:", err));
}

export function getSetting<T = unknown>(key: string, fallback?: T): T | undefined {
  if (cache.has(key)) return cache.get(key) as T;
  return fallback;
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  const mine = epoch;
  const { client, site } = target();
  cache.set(key, value);
  emit();
  try {
    let id = mine === epoch ? recordIds.get(key) : undefined;
    if (!id) {
      const found = await settingsOf(client)
        .getFirstListItem(client.filter("site = {:site} && key = {:k}", { site, k: key }))
        .catch(() => null);
      id = found?.id;
    }
    const saved = id
      ? await settingsOf(client).update(id, { value })
      : await settingsOf(client).create({ site, key, value });
    if (mine === epoch) recordIds.set(key, saved.id);
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
