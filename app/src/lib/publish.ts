// The toast shown when a post is published: "Publishing…" while it's pushed,
// then "Published" with its address (the server's final one: it may have added
// a -2) and a View button. Offline, it's published on this device and goes
// live when the sync gets through, which is what the toast says instead.

import { toast } from "@/components/base/toast/toast";
import type { VerbatimDB } from "@/lib/db";
import { currentScope } from "@/lib/scope";
import { postPublicUrl } from "@/lib/siteUrl";
import { collectionSlugOf } from "@/lib/slug";
import { flushSync } from "@/lib/sync";

export function announcePublished(db: VerbatimDB, id: string): void {
  const site = currentScope()?.site;
  if (!site) return;
  const started = Date.now();
  const live = (async () => {
    await flushSync();
    const post = await db.posts.get(id);
    // Pushed since we started: the push stamps syncedAt when the server answers.
    if (!post || (post.syncedAt ?? 0) < started) throw new Error("Not pushed yet");
    return postPublicUrl(site, collectionSlugOf(post.type, await db.collections.toArray()), post.slug);
  })();
  void toast
    .promise(live, {
      loading: { title: "Publishing…" },
      success: (url) => ({
        title: "Published",
        description: url.replace(/^https?:\/\//, ""),
        type: "success",
        actionProps: { children: "View", onClick: () => window.open(url, "_blank", "noopener") },
      }),
      error: {
        title: "Published on this device",
        description: "It goes live as soon as you're back online.",
        type: "warning",
      },
    })
    .catch(() => undefined);
}
