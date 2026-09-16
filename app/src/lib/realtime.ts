// Realtime: watch posts, post_versions and collections over PocketBase's
// server-sent events; updates Dexie so dexie-react-hooks reflows the UI.

import { db } from "@/lib/db";
import { pb, pbDateToMs } from "@/lib/pocketbase";
import { fromRecord, type PostRecord } from "@/lib/posts";
import { fromVersionRecord, type VersionRecord } from "@/lib/versions";
import { fromCollectionRecord, type CollectionRecord } from "@/lib/collections";
import { runSync } from "@/lib/sync";

type Unsubscribe = () => Promise<void>;
let subscriptions: Unsubscribe[] = [];

export async function startRealtime() {
  await stopRealtime();

  const posts = await pb.collection<PostRecord>("posts").subscribe("*", async (e) => {
    if (e.action === "delete") {
      await db.posts.delete(e.record.id);
      await db.versions.where("postId").equals(e.record.id).delete();
      return;
    }
    const local = await db.posts.get(e.record.id);
    if (local?.dirty && local.updatedAt > (pbDateToMs(e.record.updated) ?? 0)) return;
    await db.posts.put({ ...fromRecord(e.record), syncedAt: Date.now(), dirty: false });
  });

  const versions = await pb.collection<VersionRecord>("post_versions").subscribe("*", async (e) => {
    if (e.action === "delete") {
      await db.versions.delete(e.record.id);
      return;
    }
    await db.versions.put(fromVersionRecord(e.record));
  });

  const collections = await pb.collection<CollectionRecord>("collections").subscribe("*", async (e) => {
    if (e.action === "delete") {
      await db.collections.delete(e.record.name);
      return;
    }
    await db.collections.put({ ...fromCollectionRecord(e.record), syncedAt: Date.now(), dirty: false });
  });

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
  for (const unsubscribe of current) await unsubscribe();
}
