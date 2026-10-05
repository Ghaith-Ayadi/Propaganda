// Realtime: watch posts, post_versions and collections through Supabase
// Realtime (Postgres change events) and update Dexie, so dexie-react-hooks
// reflows the UI.
//
// An event only says which row changed: the row is then read again through
// the API. Update events leave out large values that didn't change (a post's
// body, when only `favorited` moved), so applying the event itself could
// blank a body locally.
//
// Subscriptions are filtered to the active site and write only into the
// database captured when they started: published posts of every site are
// publicly readable, so an unfiltered subscription would fill this site's
// cache with other sites' posts. Deletes are the exception: they carry the id
// alone, so no site filter can match them, and they come unfiltered. Ids are
// unique across sites, so deleting an id this database doesn't hold is a
// no-op.

import type { RealtimeChannel } from "@supabase/supabase-js";
import { dateToMs, must } from "@/lib/supabase";
import { fromRecord, type PostRecord } from "@/lib/posts";
import { fromVersionRecord, type VersionRecord } from "@/lib/versions";
import { captureCtx, keepsLocal, pullCollections, runSync, type Ctx } from "@/lib/sync";
import { reportError } from "@/lib/telemetry";

let current: { ctx: Ctx; channel: RealtimeChannel } | null = null;

async function readRow<R>(ctx: Ctx, table: string, id: string): Promise<R | null> {
  try {
    const row = (await must(ctx.sb.from(table).select("*").eq("id", id).maybeSingle())) as (R & { site?: string }) | null;
    return row && row.site === ctx.site ? row : null;
  } catch (err) {
    // Offline or refused: the next sync brings it.
    reportError("Realtime read failed", err, { collection: table, record_id: id });
    return null;
  }
}

async function postChanged(ctx: Ctx, id: string) {
  const r = await readRow<PostRecord>(ctx, "posts", id);
  if (!r) return;
  const local = await ctx.db.posts.get(id);
  if (keepsLocal(local, dateToMs(r.updated) ?? 0)) return;
  await ctx.db.posts.put({ ...fromRecord(r), syncedAt: Date.now(), dirty: false });
}

async function versionChanged(ctx: Ctx, id: string) {
  const r = await readRow<VersionRecord>(ctx, "post_versions", id);
  if (r) await ctx.db.versions.put(fromVersionRecord(r));
}

export async function startRealtime() {
  await stopRealtime();
  const ctx = captureCtx();
  const { db, sb, site } = ctx;
  const filter = `site=eq.${site}`;
  const changed = (e: { eventType: string; new: unknown }) =>
    e.eventType === "DELETE" ? null : (e.new as { id: string }).id;

  const channel = sb
    .channel(`site:${site}:${Math.random().toString(36).slice(2)}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "posts", filter }, (e) => {
      const id = changed(e);
      if (id) void postChanged(ctx, id);
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "post_versions", filter }, (e) => {
      const id = changed(e);
      if (id) void versionChanged(ctx, id);
    })
    // Collections are few and keyed locally by name: any change re-reads them all.
    .on("postgres_changes", { event: "*", schema: "public", table: "collections", filter }, () => {
      void pullCollections(ctx);
    })
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "posts" }, (e) => {
      const id = (e.old as { id?: string }).id;
      if (!id) return;
      void db.posts.delete(id).then(() => db.versions.where("postId").equals(id).delete());
    })
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "post_versions" }, (e) => {
      const id = (e.old as { id?: string }).id;
      if (id) void db.versions.delete(id);
    })
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "collections" }, () => {
      void pullCollections(ctx);
    })
    // Realtime confirms the database subscription a moment after SUBSCRIBED,
    // on the first connection and after every reconnect: the moment to
    // reconcile anything missed.
    .on("system", {}, (m: { extension?: string; status?: string }) => {
      if (m.extension === "postgres_changes" && m.status === "ok") void runSync();
    })
    .subscribe((status, err) => {
      if (status === "CHANNEL_ERROR") reportError("Realtime channel error", err ?? new Error("channel error"));
    });

  current = { ctx, channel };
}

export async function stopRealtime() {
  const was = current;
  current = null;
  if (!was) return;
  try {
    await was.ctx.sb.removeChannel(was.channel);
  } catch (err) {
    console.warn("realtime unsubscribe failed:", err);
  }
}
