// Tiny key/value settings store backed by the `app_settings` collection. Holds
// things like the author bio + favicon URL. Cached in module memory;
// subscribers get notified on change.
//
// Settings are per site. The cache is dropped on every scope switch
// (onScopeReset) and each load, write and subscription is pinned to the site
// and client that were active when it started.

import { useEffect, useState, useSyncExternalStore } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { must, sb, type Client } from "@/lib/supabase";
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

const settingsOf = (client: Client) => client.from("app_settings");

// The public blog has no scope: it binds the site it is showing, read through
// the anonymous client (blog/BlogApp.tsx).
let publicTarget: { client: Client; site: string } | null = null;

export function bindPublicSettings(client: Client, site: string): void {
  publicTarget = { client, site };
}

function target(): { client: Client; site: string } {
  return publicTarget ?? { client: sb, site: siteId() };
}
let unsubscribeRealtime: (() => Promise<unknown>) | null = null;
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
 * Pull every setting from the server + subscribe to realtime updates. Memoized:
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
  let records: SettingRecord[];
  try {
    records = (await must(settingsOf(client).select("*").eq("site", site))) as SettingRecord[];
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

  // A change event only says which row changed; its value is read again (a
  // large unchanged value is left out of update events). Deletes carry the id
  // alone, and a site filter can't match them, so they come unfiltered.
  const reread = async (id: string) => {
    const row = (await must(settingsOf(client).select("*").eq("id", id).maybeSingle()).catch(() => null)) as SettingRecord | null;
    if (mine !== epoch || !row || (row as SettingRecord & { site?: string }).site !== site) return;
    cache.set(row.key, row.value);
    recordIds.set(row.key, row.id);
    emit();
  };
  const channel: RealtimeChannel = client
    .channel(`settings:${site}:${Math.random().toString(36).slice(2)}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "app_settings", filter: `site=eq.${site}` }, (e) => {
      if (e.eventType !== "DELETE") void reread((e.new as { id: string }).id);
    })
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "app_settings" }, (e) => {
      if (mine !== epoch) return;
      const id = (e.old as { id?: string }).id;
      const key = [...recordIds].find(([, rid]) => rid === id)?.[0];
      if (key === undefined) return;
      cache.delete(key);
      recordIds.delete(key);
      emit();
    })
    .subscribe((status, err) => {
      if (status === "CHANNEL_ERROR") console.error("settings realtime failed:", err);
    });
  if (mine === epoch) unsubscribeRealtime = () => client.removeChannel(channel);
  else void client.removeChannel(channel);
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
    // One statement: creates the key for this site, or replaces its value.
    const saved = (await must(
      settingsOf(client).upsert({ site, key, value }, { onConflict: "site,key" }).select("id").single(),
    )) as { id: string };
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
