import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Copy04, DotsHorizontal, EyeOff, Trash01 } from "@untitledui/icons";
import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { go } from "@/lib/route";
import {
  deleteCollection,
  duplicateCollection,
  renameCollection,
  upsertCollection,
} from "@/lib/collections";
import { useActiveCollection } from "@/lib/activeCollection";
import { fromRow, type PostRow } from "@/lib/posts";
import { ActionMenu } from "@/components/Menu";
import { ConfirmTypeDialog } from "@/components/ConfirmTypeDialog";
import { PostTable } from "@/components/PostTable";
import type { Collection, Post } from "@/types";

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

  // Auto-create rows for any post type without a registry entry.
  const referenced = useMemo(() => {
    const s = new Set<string>();
    for (const p of posts) if (p.type) s.add(p.type);
    return s;
  }, [posts]);
  useEffect(() => {
    const have = new Set(collections.map((c) => c.name));
    for (const name of referenced) {
      if (!have.has(name)) void upsertCollection(name, {});
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
      <div className="mx-auto max-w-[900px] px-12 py-24 text-center text-tertiary">
        No collections yet. Press <Kbd>⌘K</Kbd> then <Kbd>↵</Kbd> to create a post in your first collection.
      </div>
    );
  }

  const activeName =
    active && collections.some((c) => c.name === active) ? active : collections[0].name;
  const activeCollection = collections.find((c) => c.name === activeName)!;
  const collectionPosts = posts.filter((p) => p.type === activeName);

  return (
    <div className="mx-auto h-full max-w-[900px] px-10 pt-10 pb-16">
      <CollectionView collection={activeCollection} posts={collectionPosts} />
    </div>
  );
}

function CollectionView({ collection, posts }: { collection: Collection; posts: Post[] }) {
  const [emojiDraft, setEmojiDraft] = useState(collection.emoji ?? "");
  const [nameDraft, setNameDraft] = useState(collection.name);
  const [descDraft, setDescDraft] = useState(collection.description ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
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
    if (next && next !== collection.name) void renameCollection(collection.name, next);
    else setNameDraft(collection.name);
  };
  const saveDesc = () => {
    const next = descDraft.trim() || null;
    if (next !== (collection.description ?? null)) {
      void upsertCollection(collection.name, { description: next });
    }
  };

  async function addPost() {
    const peers = await db.posts.where("type").equals(collection.name).toArray();
    const nextSeq = peers.reduce((m, p) => Math.max(m, p.collectionSeq ?? 0), 0) + 1;
    const { postSlug } = await import("@/lib/postId");
    const { data, error } = await supabase
      .from("posts")
      .insert({
        title: "",
        slug: postSlug(collection.name, nextSeq),
        type: collection.name,
        status: "draft",
        content_md: "",
        collection_seq: nextSeq,
      })
      .select()
      .single();
    if (error) {
      console.error(error);
      window.alert(`New post failed: ${error.message}`);
      return;
    }
    const post = fromRow(data as PostRow);
    await db.posts.put({ ...post, syncedAt: Date.now(), dirty: false });
    go({ view: "post", id: post.id });
  }

  async function onDuplicate() {
    const next = await duplicateCollection(collection.name);
    if (next) setActive(next);
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-end gap-2">
        <ActionMenu
          trigger={<DotsHorizontal className="size-4" data-icon />}
          items={[
            {
              id: "duplicate",
              label: "Duplicate",
              icon: <Copy04 className="size-4" />,
              onAction: () => void onDuplicate(),
            },
            {
              id: "hide",
              label: "Hide from public site",
              icon: <EyeOff className="size-4" />,
              disabled: true,
              onAction: () => {},
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
          className="w-14 shrink-0 rounded-lg bg-transparent text-center font-title text-4xl text-primary outline-none placeholder:text-quaternary focus:bg-primary_hover"
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
          className="flex-1 bg-transparent font-title text-4xl text-primary outline-none placeholder:text-quaternary"
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
