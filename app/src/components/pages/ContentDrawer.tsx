// Content's secondary drawer, modelled on the 0.1 sidebar: a search scoped to
// the channel, its sub-channels (Blog: collections) with their latest posts
// nested under them, then Recent. Social will list channels (a Facebook page,
// an Instagram account, ...) the same way once they exist.

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight, Folder, Plus, SearchLg } from "@untitledui/icons";
import { NewCollectionDialog } from "@/components/NewCollectionDialog";
import { db } from "@/lib/db";
import { createCollection, collectionDisplay } from "@/lib/collections";
import { createPost } from "@/lib/posts";
import { goPage, go, postHref } from "@/lib/route";
import { search, subscribeSearch } from "@/lib/search";
import { cx } from "@/utils/cx";
import type { Collection, Post } from "@/types";
import { contentRest, type ChannelId } from "./contentTree";

const NESTED = 10;

export function ContentDrawer({
  channel,
  activeCollection,
  currentPostId,
}: {
  channel: ChannelId;
  activeCollection: string | null;
  currentPostId: string | null;
}) {
  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col border-r border-secondary bg-secondary max-md:hidden">
      {channel === "blog" ? (
        <BlogDrawer activeCollection={activeCollection} currentPostId={currentPostId} />
      ) : channel === "social" ? (
        <DrawerEmpty title="Channels" text="Connect a Facebook page, an Instagram or LinkedIn account, or a subreddit, and its posts are listed here." />
      ) : (
        <DrawerEmpty title="Nothing here yet" text="This channel comes after Propaganda 0.2." />
      )}
    </aside>
  );
}

function DrawerEmpty({ title, text }: { title: string; text: string }) {
  return (
    <div className="px-4 py-5">
      <p className="text-sm font-semibold text-secondary">{title}</p>
      <p className="mt-1 text-sm text-tertiary">{text}</p>
    </div>
  );
}

function BlogDrawer({ activeCollection, currentPostId }: { activeCollection: string | null; currentPostId: string | null }) {
  const posts = useLiveQuery(() => db.posts.orderBy("updatedAt").reverse().toArray(), [], [] as Post[]);
  const collections = useLiveQuery(() => db.collections.orderBy("position").toArray(), [], [] as Collection[]);
  const [adding, setAdding] = useState(false);

  const byCollection = useMemo(() => {
    const m = new Map<string, Post[]>();
    for (const c of collections) m.set(c.name, []);
    for (const p of posts) if (p.type && m.has(p.type)) m.get(p.type)!.push(p);
    // Stable order inside a collection (newest number first), so typing in a
    // post doesn't reshuffle the list.
    for (const list of m.values()) list.sort((a, b) => (b.collectionSeq ?? 0) - (a.collectionSeq ?? 0));
    return m;
  }, [posts, collections]);

  const [query, setQuery] = useState("");
  useSyncExternalStore(subscribeSearch, () => "v");
  const names = useMemo(() => new Set(collections.map((c) => c.name)), [collections]);
  const results = useMemo(
    () => (query.trim() ? (search(query, 30) as unknown as Post[]).filter((p) => p.type && names.has(p.type)) : []),
    [query, names],
  );

  return (
    <>
      <div className="px-3 pt-3 pb-2">
        <label className="flex items-center gap-2 rounded-lg bg-primary px-2.5 py-1.5 text-sm shadow-xs ring-1 ring-primary ring-inset focus-within:ring-2 focus-within:ring-brand">
          <SearchLg className="size-4 shrink-0 text-quaternary" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the blog"
            className="w-full bg-transparent text-primary outline-none placeholder:text-quaternary"
          />
        </label>
      </div>

      <div className="flex-1 overflow-y-auto pb-3">
        {query.trim() ? (
          <div className="px-2">
            <SectionLabel>{results.length === 1 ? "1 match" : `${results.length} matches`}</SectionLabel>
            <ul>
              {results.map((p) => (
                <PostRow key={p.id} post={p} active={p.id === currentPostId} collections={collections} withEmoji />
              ))}
            </ul>
          </div>
        ) : (
          <>
            <div className="px-2">
              <div className="flex items-center justify-between pr-1">
                <SectionLabel>Collections</SectionLabel>
                <button
                  type="button"
                  aria-label="New collection"
                  title="New collection"
                  onClick={() => setAdding(true)}
                  className="rounded p-1 text-quaternary transition hover:bg-primary_hover hover:text-secondary"
                >
                  <Plus className="size-3.5" />
                </button>
              </div>
              <ul className="flex flex-col gap-0.5">
                {collections.map((c) => (
                  <CollectionFolder
                    key={c.name}
                    collection={c}
                    posts={byCollection.get(c.name) ?? []}
                    collections={collections}
                    active={activeCollection === c.name}
                    currentPostId={currentPostId}
                  />
                ))}
              </ul>
              {collections.length === 0 && (
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-tertiary hover:bg-primary_hover hover:text-secondary"
                >
                  <Plus className="size-4" />
                  New collection
                </button>
              )}
            </div>

            <div className="mt-3 border-t border-secondary px-2 pt-2">
              <SectionLabel>Recent</SectionLabel>
              <RecentList posts={posts.slice(0, 50)} currentPostId={currentPostId} collections={collections} />
            </div>
          </>
        )}
      </div>

      {adding && (
        <NewCollectionDialog
          onClose={() => setAdding(false)}
          onConfirm={async ({ name, emoji, withPost }) => {
            await createCollection(name, { emoji });
            goPage("content", contentRest("blog", name));
            if (withPost) {
              const post = await createPost(name);
              if (post) go({ view: "post", id: post.id });
            }
          }}
        />
      )}
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="px-2 pt-1 pb-1 text-xs font-semibold text-quaternary">{children}</p>;
}

function CollectionFolder({
  collection,
  posts,
  collections,
  active,
  currentPostId,
}: {
  collection: Collection;
  posts: Post[];
  collections: Collection[];
  active: boolean;
  currentPostId: string | null;
}) {
  const containsCurrent = posts.some((p) => p.id === currentPostId);
  const [open, setOpen] = useState(active || containsCurrent);
  const d = collectionDisplay(collection.name, collections);

  return (
    <li>
      <div
        className={cx(
          "group flex items-center gap-1 rounded-md px-1 py-1 transition",
          active ? "bg-primary text-primary shadow-xs ring-1 ring-secondary ring-inset" : "text-secondary hover:bg-primary_hover hover:text-primary",
        )}
      >
        <button
          type="button"
          aria-label={open ? "Collapse" : "Expand"}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="rounded p-0.5 text-quaternary hover:text-secondary"
        >
          <ChevronRight className={cx("size-3.5 transition", open && "rotate-90")} />
        </button>
        <a href={`#/content/${contentRest("blog", collection.name)}`} className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
          {d.emoji ? <span className="w-4 text-center text-sm leading-none">{d.emoji}</span> : <Folder className="size-3.5 text-quaternary" />}
          <span className="truncate">{d.label || collection.name}</span>
          <span className="ml-auto pr-1 text-xs text-quaternary tabular-nums">{posts.length}</span>
        </a>
      </div>
      {open && posts.length > 0 && (
        <ul className="mt-0.5 ml-5">
          {posts.slice(0, NESTED).map((p) => (
            <PostRow key={p.id} post={p} active={p.id === currentPostId} collections={collections} />
          ))}
          {posts.length > NESTED && (
            <li>
              <a
                href={`#/content/${contentRest("blog", collection.name)}`}
                className="block px-2 py-1 text-xs text-quaternary hover:text-secondary"
              >
                {posts.length - NESTED} more
              </a>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

function RecentList({ posts, currentPostId, collections }: { posts: Post[]; currentPostId: string | null; collections: Collection[] }) {
  const parent = useRef<HTMLDivElement | null>(null);
  const v = useVirtualizer({ count: posts.length, getScrollElement: () => parent.current, estimateSize: () => 28, overscan: 8 });
  return (
    <div ref={parent} className="max-h-[40vh] overflow-y-auto">
      <div style={{ height: v.getTotalSize(), position: "relative" }}>
        {v.getVirtualItems().map((vi) => {
          const p = posts[vi.index];
          return (
            <div key={p.id} style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${vi.start}px)` }}>
              <PostRow post={p} active={p.id === currentPostId} collections={collections} withEmoji />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Draft grey, done blue, published green (as in 0.1). */
function StatusDot({ status }: { status: Post["status"] }) {
  const color =
    status === "published" ? "bg-utility-green-500" : status === "done" ? "bg-utility-blue-400" : "bg-fg-quaternary";
  const label = status === "published" ? "Published" : status === "done" ? "Done" : "Draft";
  return <span aria-label={label} title={label} className={cx("size-1.5 shrink-0 rounded-full", color)} />;
}

function PostRow({
  post,
  active,
  collections,
  withEmoji = false,
}: {
  post: Post;
  active: boolean;
  collections: Collection[];
  withEmoji?: boolean;
}) {
  const title = post.title || "Untitled";
  const emoji = withEmoji ? collectionDisplay(post.type, collections).emoji : null;
  return (
    <li className="list-none">
      <a
        href={postHref(post.id)}
        title={post.type ? `${title} · ${post.type}` : title}
        aria-current={active ? "page" : undefined}
        className={cx(
          "flex items-center gap-2 truncate rounded-md px-2 py-1 text-sm",
          active ? "bg-primary_hover text-primary" : "text-secondary hover:bg-primary_hover hover:text-primary",
        )}
      >
        {withEmoji && <span className="w-4 shrink-0 text-center text-[13px] leading-none">{emoji ?? ""}</span>}
        <StatusDot status={post.status} />
        <span className="truncate">{title}</span>
      </a>
    </li>
  );
}
