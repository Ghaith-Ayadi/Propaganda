// Realtime: watch posts, post_versions and collections over PocketBase's
// server-sent events; updates Dexie so dexie-react-hooks reflows the UI.
//
// Subscriptions are filtered to the active site and write only into the
// database captured when they started: published posts of every site are
// publicly readable, so an unfiltered subscription would fill this site's
// cache with other sites' posts.

import { pbDateToMs } from "@/lib/pocketbase";
import { fromRecord, type PostRecord } from "@/lib/posts";
import { fromVersionRecord, type VersionRecord } from "@/lib/versions";
import { fromCollectionRecord, type CollectionRecord } from "@/lib/collections";
import { captureCtx, runSync } from "@/lib/sync";

type Unsubscribe = () => Promise<void>;
let subscriptions: Unsubscribe[] = [];

export async function startRealtime() {
  await stopRealtime();
  const { db, pb, site } = captureCtx();
  const opts = { filter: pb.filter("site = {:site}", { site }) };
  // Drop events that aren't this site's, whatever the server sends.
  const mine = (r: { site?: string }) => r.site === site;

  const posts = await pb.collection<PostRecord & { site?: string }>("posts").subscribe("*", async (e) => {
    if (!mine(e.record)) return;
    if (e.action === "delete") {
      await db.posts.delete(e.record.id);
      await db.versions.where("postId").equals(e.record.id).delete();
      return;
    }
    const local = await db.posts.get(e.record.id);
    if (local?.dirty && local.updatedAt > (pbDateToMs(e.record.updated) ?? 0)) return;
    await db.posts.put({ ...fromRecord(e.record), syncedAt: Date.now(), dirty: false });
  }, opts);

  const versions = await pb.collection<VersionRecord & { site?: string }>("post_versions").subscribe("*", async (e) => {
    if (!mine(e.record)) return;
    if (e.action === "delete") {
      await db.versions.delete(e.record.id);
      return;
    }
    await db.versions.put(fromVersionRecord(e.record));
  }, opts);

  const collections = await pb.collection<CollectionRecord & { site?: string }>("collections").subscribe("*", async (e) => {
    if (!mine(e.record)) return;
    if (e.action === "delete") {
      await db.collections.delete(e.record.name);
      return;
    }
    await db.collections.put({ ...fromCollectionRecord(e.record), syncedAt: Date.now(), dirty: false });
  }, opts);

  // PB_CONNECT fires on the first connection and after every automatic
  // reconnect, which is the moment to reconcile anything missed.
  const connect = await pb.realtime.subscribe("PB_CONNECT", () => {
    void runSync();
  });

  subscriptions = [posts, versions, collections, connect];
}

export async function stopRealtime() {
  const current = subscriptions;
  subscriptions = [];
  for (const unsubscribe of current) {
    try {
      await unsubscribe();
    } catch (err) {
      console.warn("realtime unsubscribe failed:", err);
    }
  }
}
