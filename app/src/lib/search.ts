// In-memory MiniSearch index over posts.
// Rebuilt on every Dexie change via a thin observable layer; the palette pulls results synchronously.

import MiniSearch from "minisearch";
import { db, type VerbatimDB } from "@/lib/db";
import { onScopeReset } from "@/lib/scope";
import type { Post } from "@/types";

let index: MiniSearch<Post> | null = null;
const listeners = new Set<() => void>();

function build(posts: Post[]): MiniSearch<Post> {
  const ms = new MiniSearch<Post>({
    fields: ["title", "content", "excerpt"],
    storeFields: ["id", "title", "slug", "status", "type", "updatedAt"],
    searchOptions: {
      boost: { title: 4, excerpt: 2 },
      fuzzy: 0.2,
      prefix: true,
    },
    idField: "id",
  });
  ms.addAll(posts);
  return ms;
}

export function getIndex(): MiniSearch<Post> | null {
  return index;
}

export function search(q: string, limit = 12) {
  if (!index || !q.trim()) return [];
  return index.search(q, { combineWith: "AND" }).slice(0, limit);
}

export function subscribeSearch(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let timer: ReturnType<typeof setTimeout> | null = null;
async function rebuild() {
  const source = db;
  const posts = await source.posts.toArray();
  if (source !== db) return; // switched site meanwhile
  index = build(posts);
  for (const l of listeners) l();
}

// Hooks are attached per database; each site's database gets them once.
const hooked = new WeakSet<VerbatimDB>();

onScopeReset(() => {
  if (timer) clearTimeout(timer);
  timer = null;
  index = null;
  for (const l of listeners) l();
});

export function installSearchIndex() {
  void rebuild();
  if (hooked.has(db)) return;
  hooked.add(db);
  // dexie-react-hooks would also work but we want one global index, not per-component.
  // Listen to all post table changes via Dexie hooks API.
  db.posts.hook("creating", scheduleRebuild);
  db.posts.hook("updating", scheduleRebuild);
  db.posts.hook("deleting", scheduleRebuild);
}

function scheduleRebuild() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void rebuild(), 250);
}
