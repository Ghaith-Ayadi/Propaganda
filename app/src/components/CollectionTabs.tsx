import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Copy04, DotsHorizontal, Eye, EyeOff, Plus, Sliders04, Trash01 } from "@untitledui/icons";
import { db } from "@/lib/db";
import { go } from "@/lib/route";
import {
  deleteCollection,
  duplicateCollection,
  renameCollection,
  upsertCollection,
  isRenaming,
} from "@/lib/collections";
import { useActiveCollection } from "@/lib/activeCollection";
import { createPost } from "@/lib/posts";
import { ActionMenu } from "@/components/Menu";
import { ConfirmTypeDialog } from "@/components/ConfirmTypeDialog";
import { PostTable } from "@/components/PostTable";
import { Button } from "@/components/base/buttons/button";
import { usePlan } from "@/lib/tenantPlan";
import type { Collection, Post } from "@/types";
import { toast } from "@/components/base/toast/toast";
import { loadCollectionRules, saveCollectionRules } from "@/lib/collectionRules";
import { userMessage } from "@/lib/errors";
import { reportError } from "@/lib/telemetry";

/**
 * Home view. The tab bar lives in App so it's visible everywhere; this
 * component just renders the body for the active collection.
 */
export function CollectionTabs() {
  const collections = useLiveQuery(
    () => db.collections.orderBy("position").toArray(),
    [],
    [] as Collection[],
  );
  const posts = useLiveQuery(
    () => db.posts.orderBy("updatedAt").reverse().toArray(),
    [],
    [] as Post[],
  );
  const [active, setActive] = useActiveCollection();

  // Auto-create rows for any post type without a registry entry (legacy posts),
  // except mid-rename, when posts briefly carry a name whose record is on its way.
  const referenced = useMemo(() => {
    const s = new Set<string>();
    for (const p of posts) if (p.type) s.add(p.type);
    return s;
  }, [posts]);
  useEffect(() => {
    const have = new Set(collections.map((c) => c.name));
    for (const name of referenced) {
      if (!have.has(name) && !isRenaming(name)) void upsertCollection(name, {});
    }
  }, [collections, referenced]);

  // Seed the active collection on first paint.
  useEffect(() => {
    if (!collections.length) return;
    if (!active || !collections.some((c) => c.name === active)) {
      setActive(collections[0].name);
    }
  }, [collections, active, setActive]);

  if (collections.length === 0) {
    return (
      <div className="mx-auto max-w-[900px] px-6 py-24 text-center text-tertiary md:px-12">
        No collections yet. Press <Kbd>⌘K</Kbd> then <Kbd>↵</Kbd> to create a post in your first collection.
      </div>
    );
  }

  const activeName =
    active && collections.some((c) => c.name === active) ? active : collections[0].name;
  const activeCollection = collections.find((c) => c.name === activeName)!;
  const collectionPosts = posts.filter((p) => p.type === activeName);

  return (
    <div className="mx-auto h-full w-full max-w-[900px] px-4 pt-6 pb-16 md:px-5 md:pt-5 2xl:px-10 2xl:pt-10">
      <CollectionView collection={activeCollection} posts={collectionPosts} />
    </div>
  );
}

function CollectionView({ collection, posts }: { collection: Collection; posts: Post[] }) {
  const [emojiDraft, setEmojiDraft] = useState(collection.emoji ?? "");
  const [nameDraft, setNameDraft] = useState(collection.name);
  const [descDraft, setDescDraft] = useState(collection.description ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  // Rules steer the agents; Lite has none.
  const lite = usePlan() === "lite";
  const [, setActive] = useActiveCollection();

  useEffect(() => {
    setEmojiDraft(collection.emoji ?? "");
    setNameDraft(collection.name);
    setDescDraft(collection.description ?? "");
  }, [collection.name, collection.emoji, collection.description]);

  const saveEmoji = () => {
    const next = emojiDraft.trim() || null;
    if (next !== (collection.emoji ?? null)) {
      void upsertCollection(collection.name, { emoji: next });
    }
  };
  const saveName = () => {
    const next = nameDraft.trim();
    // Stay on the collection under its new name once the rename lands.
    if (next && next !== collection.name) void renameCollection(collection.name, next).then(() => setActive(next));
    else setNameDraft(collection.name);
  };
  const saveDesc = () => {
    const next = descDraft.trim() || null;
    if (next !== (collection.description ?? null)) {
      void upsertCollection(collection.name, { description: next });
    }
  };

  async function addPost() {
    // Offline-first: staged in Dexie with a temp id, INSERTed on next sync.
    const post = await createPost(collection.name);
    if (!post) {
      toast.add({ type: "error", title: "Couldn't create a post", description: "Try again in a moment." });
      return;
    }
    go({ view: "post", id: post.id });
  }

  async function onDuplicate() {
    const next = await duplicateCollection(collection.name);
    if (next) setActive(next);
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-end gap-2">
        {collection.isHidden && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary"
            title="Hidden from the public site. Articles in this collection won't render."
          >
            <EyeOff className="size-3" />
            Hidden
          </span>
        )}
        <ActionMenu
          trigger={<DotsHorizontal className="size-4" data-icon />}
          items={[
            ...(lite
              ? []
              : [
                  {
                    id: "rules",
                    label: "Rules for the agents…",
                    icon: <Sliders04 className="size-4" />,
                    onAction: () => setRulesOpen(true),
                  },
                ]),
            {
              id: "duplicate",
              label: "Duplicate",
              icon: <Copy04 className="size-4" />,
              onAction: () => void onDuplicate(),
            },
            {
              id: "hide",
              label: collection.isHidden ? "Show on public site" : "Hide from public site",
              icon: collection.isHidden ? (
                <Eye className="size-4" />
              ) : (
                <EyeOff className="size-4" />
              ),
              onAction: () =>
                void upsertCollection(collection.name, { isHidden: !collection.isHidden }),
            },
            {
              id: "delete",
              label: "Delete collection…",
              icon: <Trash01 className="size-4" />,
              destructive: true,
              onAction: () => setConfirmDelete(true),
            },
          ]}
        />
      </div>

      <div className="flex items-start gap-3">
        <input
          aria-label="Collection emoji"
          value={emojiDraft}
          onChange={(e) => setEmojiDraft(e.target.value)}
          onBlur={saveEmoji}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          placeholder="🙂"
          className="w-9 shrink-0 rounded-lg bg-transparent text-center type-title text-primary outline-none placeholder:text-quaternary focus:bg-primary_hover"
        />
        <input
          aria-label="Collection name"
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          placeholder="Untitled collection"
          className="min-w-0 flex-1 bg-transparent type-title text-primary outline-none placeholder:text-quaternary"
        />
      </div>

      <textarea
        aria-label="Collection description"
        value={descDraft}
        onChange={(e) => setDescDraft(e.target.value)}
        onBlur={saveDesc}
        placeholder="What is this collection about?"
        rows={2}
        className="mt-3 w-full resize-none bg-transparent text-base text-secondary outline-none placeholder:text-quaternary"
      />

      <div className="mt-8">
        <PostTable posts={posts} onAddPost={() => void addPost()} />
      </div>

      {/* Phones: the "+ New post" row scrolls away with the list, so a button stays in reach. */}
      <button
        type="button"
        aria-label="New post"
        onClick={() => void addPost()}
        className="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-30 flex size-14 items-center justify-center rounded-full bg-brand-solid text-white shadow-lg transition active:scale-95 md:hidden"
      >
        <Plus className="size-6" />
      </button>

      {rulesOpen && <RulesDialog name={collection.name} onClose={() => setRulesOpen(false)} />}

      {confirmDelete && (
        <ConfirmTypeDialog
          title={`Delete "${collection.name}"`}
          message={
            <>
              The {posts.length} {posts.length === 1 ? "post" : "posts"} in this collection won't be
              deleted, but they'll lose this grouping.
            </>
          }
          confirmation={collection.name}
          confirmLabel="Delete collection"
          destructive
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => void deleteCollection(collection.name)}
        />
      )}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mx-1 inline-flex h-5 min-w-5 items-center justify-center rounded border border-secondary bg-secondary px-1 text-[11px] text-secondary">
      {children}
    </kbd>
  );
}

/** The collection's private rules for the agents (collection menu > Rules for the agents). */
function RulesDialog({ name, onClose }: { name: string; onClose: () => void }) {
  const [rules, setRules] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const saved = useRef("");

  useEffect(() => {
    let live = true;
    loadCollectionRules(name)
      .then((r) => {
        if (!live) return;
        saved.current = r;
        setRules(r);
      })
      .catch((err) => {
        reportError("collections.loadRules", err);
        if (live) setRules("");
      });
    return () => {
      live = false;
    };
  }, [name]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = () => {
    if (rules === null) return;
    if (rules.trim() === saved.current.trim()) return onClose();
    setSaving(true);
    saveCollectionRules(name, rules)
      .then(onClose)
      .catch((err) => {
        reportError("collections.saveRules", err);
        toast.add({ type: "error", title: userMessage(err) });
        setSaving(false);
      });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Rules for the agents"
        onClick={(e) => e.stopPropagation()}
        className="w-[520px] max-w-[92vw] rounded-xl border border-secondary bg-secondary p-6 shadow-2xl ring-1 ring-primary"
      >
        <h2 className="type-heading text-primary">Rules for the agents</h2>
        <p className="mt-1 text-sm text-tertiary">Private to this collection, never shown on the blog.</p>
        <textarea
          aria-label="Rules for the agents"
          value={rules ?? ""}
          disabled={rules === null}
          onChange={(e) => setRules(e.target.value)}
          placeholder="How posts in this collection are written. For example: academic register; show the method, the results and what we learned; cite every number."
          rows={6}
          className="mt-4 w-full resize-y rounded-lg bg-primary px-3 py-2 text-sm text-primary shadow-xs ring-1 ring-primary outline-none ring-inset placeholder:text-quaternary focus:ring-2 focus:ring-brand"
        />
        <div className="mt-5 flex justify-end gap-2">
          <Button size="sm" color="tertiary" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" color="primary" isDisabled={rules === null || saving} onClick={save}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
