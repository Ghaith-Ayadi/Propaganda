import { useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronDown,
  ChevronRight,
  Eye,
  Folder,
  SearchLg,
  Settings01,
  Star01,
} from "@untitledui/icons";
import { SettingsDialog } from "@/components/SettingsDialog";
import { db } from "@/lib/db";
import { postHref, go } from "@/lib/route";
import { collectionDisplay } from "@/lib/collections";
import { useActiveCollection } from "@/lib/activeCollection";
import { search, subscribeSearch } from "@/lib/search";
import { useSyncExternalStore } from "react";
import type { Collection, Post } from "@/types";

interface Props {
  currentId: number | null;
}

const ADMIN_KNOWN = "verbatim:admin-known";

export function Sidebar({ currentId }: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const posts = useLiveQuery(
    () => db.posts.orderBy("updatedAt").reverse().toArray(),
    [],
    [] as Post[],
  );
  const collectionRows = useLiveQuery(
    () => db.collections.orderBy("position").toArray(),
    [],
    [] as Collection[],
  );
  const [active] = useActiveCollection();

  const favorites = useMemo(() => posts.filter((p) => p.favorited).slice(0, 50), [posts]);
  const postsByCollection = useMemo(() => {
    const m = new Map<string, Post[]>();
    for (const c of collectionRows) m.set(c.name, []);
    for (const p of posts) {
      const key = p.type || "Uncollected";
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(p);
    }
    // Stable order within each collection — newest seq first, matching the
    // post-nav arrows. Without this, typing into a post would shuffle the
    // sidebar because the global list is sorted by updatedAt.
    for (const list of m.values()) {
      list.sort((a, b) => (b.collectionSeq ?? 0) - (a.collectionSeq ?? 0));
    }
    return m;
  }, [posts, collectionRows]);

  // Search box
  const [query, setQuery] = useState("");
  useSyncExternalStore(
    (cb) => subscribeSearch(cb),
    () => "v",
  );
  const searchResults = useMemo(() => (query.trim() ? search(query, 12) : []), [query]);

  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col border-r border-secondary bg-secondary">
      <div className="px-3 pt-3 pb-2">
        <a
          href="#/"
          aria-label="Verbatim — home"
          className="-mx-1 block rounded-md px-2 py-1 font-title text-xl tracking-tight text-primary transition hover:bg-primary_hover"
        >
          Verbatim
        </a>
      </div>

      <div className="px-3 pb-3">
        <SearchBox value={query} onChange={setQuery} />
      </div>

      <div className="flex-1 overflow-y-auto">
        {query.trim() ? (
          <SearchResults
            posts={searchResults as unknown as Post[]}
            currentId={currentId}
            collectionRows={collectionRows}
          />
        ) : (
          <>
            {favorites.length > 0 && (
              <Section label="Favorites" defaultOpen icon={<Star01 className="size-3.5" />}>
                <PostList
                  posts={favorites}
                  currentId={currentId}
                  collectionRows={collectionRows}
                />
              </Section>
            )}

            <Divider />

            <Section label="Collections" defaultOpen>
              <ul className="space-y-0.5">
                {collectionRows.map((c) => {
                  const items = postsByCollection.get(c.name) ?? [];
                  return (
                    <CollectionFolder
                      key={c.name}
                      collection={c}
                      items={items}
                      currentId={currentId}
                      isActive={active === c.name}
                      allCollections={collectionRows}
                    />
                  );
                })}
              </ul>
            </Section>

            <Divider />

            <Section label="Recent">
              <VirtualPostList
                posts={posts.slice(0, 50)}
                currentId={currentId}
                collectionRows={collectionRows}
              />
            </Section>
          </>
        )}
      </div>

      <div className="flex flex-col gap-0 border-t border-secondary p-2">
        <button
          onClick={() => setSettingsOpen(true)}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-secondary transition hover:bg-tertiary hover:text-primary"
        >
          <Settings01 className="size-3.5 text-quaternary" />
          <span>Settings</span>
        </button>
        <a
          href="/"
          onClick={() => {
            try { localStorage.setItem(ADMIN_KNOWN, "1"); } catch {}
          }}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-secondary transition hover:bg-tertiary hover:text-primary"
          title="Open the public site in this tab"
        >
          <Eye className="size-3.5 text-quaternary" />
          <span>Preview site</span>
        </a>
        <div className="px-2 pt-2 text-[11px] text-quaternary">
          {posts.length} {posts.length === 1 ? "post" : "posts"} ·{" "}
          {collectionRows.length} {collectionRows.length === 1 ? "collection" : "collections"}
        </div>
      </div>
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </aside>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2 rounded-lg border border-secondary bg-primary px-2.5 py-1.5 text-sm focus-within:border-tertiary">
      <SearchLg className="size-4 shrink-0 text-quaternary" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search posts"
        className="w-full bg-transparent text-primary outline-none placeholder:text-quaternary"
      />
      <kbd className="shrink-0 rounded border border-secondary bg-secondary px-1 text-[11px] text-quaternary">
        ⌘K
      </kbd>
    </label>
  );
}

function Section({
  label,
  icon,
  children,
  defaultOpen = false,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} className="group/section px-3 py-1">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-1 py-1 text-[11px] font-semibold uppercase tracking-wider text-quaternary hover:text-secondary">
        <ChevronRight className="size-3 transition group-open/section:rotate-90" />
        {icon && <span className="text-quaternary">{icon}</span>}
        <span>{label}</span>
      </summary>
      <div className="mt-0.5">{children}</div>
    </details>
  );
}

function Divider() {
  return <div className="my-1 border-t border-secondary" />;
}

function CollectionFolder({
  collection,
  items,
  currentId,
  isActive,
  allCollections,
}: {
  collection: Collection;
  items: Post[];
  currentId: number | null;
  isActive: boolean;
  allCollections: Collection[];
}) {
  const display = collectionDisplay(collection.name, allCollections);
  const containsCurrent = items.some((p) => p.id === currentId);
  const [, setActive] = useActiveCollection();
  const [open, setOpen] = useState(isActive || containsCurrent);

  return (
    <li>
      <div
        className={[
          "group flex items-center gap-1.5 rounded-md px-1 py-1 transition",
          isActive
            ? "bg-primary_hover text-primary"
            : "text-secondary hover:bg-primary_hover hover:text-primary",
        ].join(" ")}
      >
        <button
          aria-label={open ? "Collapse" : "Expand"}
          onClick={() => setOpen((o) => !o)}
          className="rounded p-0.5 text-quaternary hover:text-secondary"
        >
          {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </button>
        <button
          onClick={() => {
            go({ view: "list" });
            setActive(collection.name);
          }}
          className="flex flex-1 items-center gap-1.5 truncate text-left text-sm"
        >
          {display.emoji ? (
            <span className="text-sm leading-none">{display.emoji}</span>
          ) : (
            <Folder className="size-3.5 text-quaternary" />
          )}
          <span className="truncate">{display.label || collection.name}</span>
          <span className="ml-auto text-xs text-quaternary">{items.length}</span>
        </button>
      </div>
      {open && items.length > 0 && (
        <ul className="ml-5 mt-0.5 space-y-0">
          {items.slice(0, 10).map((p) => (
            <PostRow key={p.id} post={p} active={p.id === currentId} compact />
          ))}
          {items.length > 10 && (
            <li className="px-2 py-1 text-xs text-quaternary">+ {items.length - 10} more</li>
          )}
        </ul>
      )}
    </li>
  );
}

function PostList({
  posts,
  currentId,
  collectionRows,
}: {
  posts: Post[];
  currentId: number | null;
  collectionRows: Collection[];
}) {
  return (
    <ul>
      {posts.map((p) => (
        <PostRow key={p.id} post={p} active={p.id === currentId} collectionRows={collectionRows} />
      ))}
    </ul>
  );
}

function VirtualPostList({
  posts,
  currentId,
  collectionRows,
}: {
  posts: Post[];
  currentId: number | null;
  collectionRows: Collection[];
}) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const virtual = useVirtualizer({
    count: posts.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 8,
  });

  return (
    <div ref={parentRef} className="max-h-[36vh] overflow-y-auto">
      <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
        {virtual.getVirtualItems().map((vi) => {
          const p = posts[vi.index];
          return (
            <div
              key={p.id}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${vi.start}px)`,
              }}
            >
              <PostRow post={p} active={p.id === currentId} collectionRows={collectionRows} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SearchResults({
  posts,
  currentId,
  collectionRows,
}: {
  posts: Post[];
  currentId: number | null;
  collectionRows: Collection[];
}) {
  return (
    <div className="px-3 py-1">
      <div className="px-1 pb-1 text-[11px] uppercase tracking-wider text-quaternary">
        {posts.length} {posts.length === 1 ? "match" : "matches"}
      </div>
      <ul>
        {posts.map((p) => (
          <PostRow
            key={p.id}
            post={p}
            active={p.id === currentId}
            collectionRows={collectionRows}
          />
        ))}
      </ul>
    </div>
  );
}

function PostRow({
  post,
  active,
  collectionRows,
  compact = false,
}: {
  post: Post;
  active: boolean;
  collectionRows?: Collection[];
  compact?: boolean;
}) {
  const title = post.title || "Untitled";
  const d = collectionDisplay(post.type, collectionRows ?? []);
  return (
    <a
      href={postHref(post.id)}
      className={[
        "flex items-center gap-2 truncate rounded-md px-2 py-1 text-sm",
        compact ? "ml-1" : "",
        active
          ? "bg-primary_hover text-primary"
          : "text-secondary hover:bg-primary_hover hover:text-primary",
      ].join(" ")}
      title={post.type ? `${title} · ${post.type}` : title}
    >
      {!compact && (
        <span className="w-4 shrink-0 text-center text-[13px] leading-none">{d.emoji ?? ""}</span>
      )}
      {post.status === "draft" && <span className="text-quaternary">●</span>}
      <span className="truncate">{title}</span>
    </a>
  );
}
