// Lite's nav puts the writing first, as the 0.1 sidebar did: every collection
// as a folder with its newest posts inside, filling the nav bar.

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronDown, Folder } from "@untitledui/icons";
import { contentRest } from "@/components/pages/contentTree";
import { useActiveCollection } from "@/lib/activeCollection";
import { collectionDisplay } from "@/lib/collections";
import { db } from "@/lib/db";
import { pageHref, postHref } from "@/lib/route";
import type { Collection, Post } from "@/types";
import { cx } from "@/utils/cx";

const SHOWN = 10;

export function LiteCollections({ currentPostId, rowClass }: { currentPostId: string | null; rowClass: (active: boolean) => string }) {
  const posts = useLiveQuery(() => db.posts.toArray(), [], [] as Post[]);
  const collections = useLiveQuery(() => db.collections.orderBy("position").toArray(), [], [] as Collection[]);
  const [active] = useActiveCollection();

  // Newest first within each collection, by its number, so typing in a post
  // doesn't reshuffle the list.
  const byCollection = useMemo(() => {
    const m = new Map<string, Post[]>();
    for (const c of collections) m.set(c.name, []);
    for (const p of posts) if (p.type && m.has(p.type)) m.get(p.type)!.push(p);
    for (const list of m.values()) list.sort((a, b) => (b.collectionSeq ?? 0) - (a.collectionSeq ?? 0));
    return m;
  }, [posts, collections]);

  return (
    <div className="flex flex-col gap-0.5">
      <a
        href={pageHref("content", "blog")}
        className="px-2.5 pt-2 pb-1 text-xs font-semibold text-quaternary transition hover:text-secondary"
      >
        Collections
      </a>
      <ul className="flex flex-col gap-0.5">
        {collections.map((c) => (
          <CollectionFolder
            key={c.name}
            collection={c}
            all={collections}
            items={byCollection.get(c.name) ?? []}
            currentPostId={currentPostId}
            isActive={active === c.name}
            rowClass={rowClass}
          />
        ))}
      </ul>
    </div>
  );
}

function CollectionFolder({
  collection,
  all,
  items,
  currentPostId,
  isActive,
  rowClass,
}: {
  collection: Collection;
  all: Collection[];
  items: Post[];
  currentPostId: string | null;
  isActive: boolean;
  rowClass: (active: boolean) => string;
}) {
  const display = collectionDisplay(collection.name, all);
  const [open, setOpen] = useState(isActive || items.some((p) => p.id === currentPostId));
  const href = pageHref("content", contentRest("blog", collection.name));

  return (
    <li>
      <div className="relative flex items-center">
        <a href={href} className={cx(rowClass(isActive && !currentPostId), "pr-8")}>
          {display.emoji ? (
            <span className="w-4 shrink-0 text-center text-[13px] leading-none">{display.emoji}</span>
          ) : (
            <Folder className="size-4 shrink-0 text-quaternary" />
          )}
          <span className="truncate">{display.label || collection.name}</span>
          <span className="ml-auto text-xs tabular-nums text-quaternary">{items.length}</span>
        </a>
        {items.length > 0 && (
          <button
            type="button"
            aria-label={open ? "Collapse" : "Expand"}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="absolute right-1 rounded p-1 text-quaternary transition hover:bg-primary_hover hover:text-secondary"
          >
            <ChevronDown className={cx("size-3.5 transition", !open && "-rotate-90")} />
          </button>
        )}
      </div>
      {open && items.length > 0 && (
        <ul className="mt-0.5 ml-[18px] flex flex-col gap-0.5 border-l border-secondary pl-1.5">
          {items.slice(0, SHOWN).map((p) => (
            <li key={p.id}>
              <PostRow post={p} active={p.id === currentPostId} rowClass={rowClass} />
            </li>
          ))}
          {items.length > SHOWN && (
            <li>
              <a href={href} className="block px-2.5 py-1 text-xs text-quaternary transition hover:text-secondary">
                {items.length - SHOWN} more
              </a>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

function PostRow({ post, active, rowClass }: { post: Post; active: boolean; rowClass: (active: boolean) => string }) {
  const title = post.title || "Untitled";
  return (
    <a
      href={postHref(post.id)}
      aria-current={active ? "page" : undefined}
      title={title}
      className={cx(rowClass(active), "gap-2 py-1")}
    >
      <span
        aria-hidden
        className={cx(
          "size-1.5 shrink-0 rounded-full",
          post.status === "published"
            ? "bg-utility-green-500"
            : post.status === "done"
              ? "bg-utility-blue-400"
              : "bg-quaternary",
        )}
      />
      <span className="truncate">{title}</span>
    </a>
  );
}
