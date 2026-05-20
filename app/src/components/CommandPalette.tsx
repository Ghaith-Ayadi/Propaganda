import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Command } from "cmdk";
import { useHotkeys } from "react-hotkeys-hook";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowDown, ArrowUp, CornerDownLeft, FilePlus02, Moon01, SearchLg, Sun } from "@untitledui/icons";
import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { search, subscribeSearch } from "@/lib/search";
import { go } from "@/lib/route";
import { useLayout } from "@/lib/layout";
import { collectionDisplay } from "@/lib/collections";
import { fromRow, setPostStatus, type PostRow } from "@/lib/posts";
import { toggleTheme, useTheme } from "@/lib/theme";
import { createCollection } from "@/lib/collections";
import { NewCollectionDialog } from "@/components/NewCollectionDialog";
import { setActiveCollection } from "@/lib/activeCollection";
import { requestTitleFocus } from "@/lib/postFocus";
import type { Collection, Post } from "@/types";

type Mode = "search" | "commands";

interface Props {
  currentPostId: number | null;
}

const LAST_COLLECTION_KEY = "verbatim:lastCollection";

export function CommandPalette({ currentPostId }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  // null = closed, {withPost} = open with that mode
  const [newCollection, setNewCollection] = useState<null | { withPost: boolean }>(null);
  const mode: Mode = q.length === 0 || q.startsWith("/") ? "commands" : "search";
  const commandQuery = q.startsWith("/") ? q.slice(1).trim().toLowerCase() : "";
  const [, , toggleAuthorMode] = useLayout();
  const [theme] = useTheme();

  const allPosts = useLiveQuery(
    () => db.posts.orderBy("updatedAt").reverse().toArray(),
    [],
    [] as Post[],
  );
  const collectionRows = useLiveQuery(
    () => db.collections.orderBy("position").toArray(),
    [],
    [] as Collection[],
  );
  const knownCollections = useMemo(
    () => collectionRows.map((c) => c.name),
    [collectionRows],
  );

  const defaultCollection = useMemo(() => {
    if (currentPostId != null) {
      const cur = allPosts.find((p) => p.id === currentPostId);
      if (cur?.type) return cur.type;
    }
    const remembered =
      typeof localStorage !== "undefined" ? localStorage.getItem(LAST_COLLECTION_KEY) : null;
    if (remembered && knownCollections.includes(remembered)) return remembered;
    if (allPosts[0]?.type) return allPosts[0].type;
    if (knownCollections[0]) return knownCollections[0];
    return "hokum";
  }, [currentPostId, allPosts, knownCollections]);

  useSyncExternalStore(
    (cb) => subscribeSearch(cb),
    () => "v",
  );

  useHotkeys(
    "mod+k",
    (e) => {
      e.preventDefault();
      setOpen((o) => !o);
    },
    { enableOnFormTags: true, enableOnContentEditable: true },
  );
  useHotkeys(
    "mod+shift+n",
    (e) => {
      e.preventDefault();
      void newPost(defaultCollection);
    },
    { enableOnFormTags: true, enableOnContentEditable: true },
    [defaultCollection],
  );
  useHotkeys(
    "mod+shift+p",
    (e) => {
      e.preventDefault();
      void publishCurrent();
    },
    { enableOnFormTags: true, enableOnContentEditable: true },
    [currentPostId],
  );
  useHotkeys("escape", () => setOpen(false), {
    enabled: open,
    enableOnFormTags: true,
    enableOnContentEditable: true,
  });

  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  const results = useMemo(() => {
    if (mode === "search") return search(q, 12);
    return [];
  }, [q, mode]);

  async function newPost(type: string) {
    // Next sequential id within the collection. Slug = {prefix}·{NN}.
    const peers = await db.posts.where("type").equals(type).toArray();
    const nextSeq = peers.reduce((m, p) => Math.max(m, p.collectionSeq ?? 0), 0) + 1;
    const { postSlug } = await import("@/lib/postId");
    const slug = postSlug(type, nextSeq);
    const { data, error } = await supabase
      .from("posts")
      .insert({
        title: "",
        slug,
        type,
        status: "draft",
        content_md: "",
        collection_seq: nextSeq,
      })
      .select()
      .single();
    if (error) {
      console.error("New post failed:", error);
      window.alert(`New post failed: ${error.message}`);
      return;
    }
    const post = fromRow(data as PostRow);
    await db.posts.put({ ...post, syncedAt: Date.now(), dirty: false });
    localStorage.setItem(LAST_COLLECTION_KEY, type);
    setOpen(false);
    requestTitleFocus(post.id);
    go({ view: "post", id: post.id });
  }

  async function publishCurrent() {
    if (currentPostId == null) return;
    await setPostStatus(currentPostId, "published");
    setOpen(false);
  }

  type CommandRow = {
    key: string;
    label: string;
    emoji?: string | null;
    icon?: React.ReactNode;
    hint?: string;
    onSelect: () => void;
  };

  const otherCollections = knownCollections.filter((c) => c !== defaultCollection);
  const defaultDisplay = collectionDisplay(defaultCollection, collectionRows);

  const allCommands: CommandRow[] = [
    {
      key: "new-default",
      label: defaultCollection
        ? `New post in ${defaultDisplay.label || defaultCollection}`
        : "New post",
      emoji: defaultDisplay.emoji,
      icon: <FilePlus02 className="size-4" />,
      hint: "⌘⇧N",
      onSelect: () => void newPost(defaultCollection),
    },
    ...otherCollections.map<CommandRow>((c) => {
      const d = collectionDisplay(c, collectionRows);
      return {
        key: `new-${c}`,
        label: `New post in ${d.label || c}`,
        emoji: d.emoji,
        icon: <FilePlus02 className="size-4" />,
        onSelect: () => void newPost(c),
      };
    }),
    {
      key: "new-collection-post",
      label: "New post in new collection…",
      icon: <FilePlus02 className="size-4" />,
      onSelect: () => {
        setOpen(false);
        setNewCollection({ withPost: true });
      },
    },
    {
      key: "new-collection",
      label: "New collection…",
      icon: <FilePlus02 className="size-4" />,
      onSelect: () => {
        setOpen(false);
        setNewCollection({ withPost: false });
      },
    },
    {
      key: "author-mode",
      label: "Toggle author mode",
      hint: "⌘\\",
      onSelect: () => {
        toggleAuthorMode();
        setOpen(false);
      },
    },
    {
      key: "theme",
      label: theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
      icon: theme === "dark" ? <Sun className="size-4" /> : <Moon01 className="size-4" />,
      hint: "⌘⇧L",
      onSelect: () => {
        toggleTheme();
        setOpen(false);
      },
    },
    ...(currentPostId != null
      ? [
          {
            key: "publish",
            label: "Publish current post",
            hint: "⌘⇧P",
            onSelect: () => void publishCurrent(),
          } as CommandRow,
        ]
      : []),
  ];

  const filteredCommands = commandQuery
    ? allCommands.filter((c) => fuzzyMatch(c.label, commandQuery))
    : allCommands;

  // The dialog and the palette are mutually exclusive but the dialog needs to
  // outlive the palette closing animation.
  const dialog = newCollection && (
    <NewCollectionDialog
      withPost={newCollection.withPost}
      onClose={() => setNewCollection(null)}
      onConfirm={async ({ name, emoji, withPost }) => {
        await createCollection(name, { emoji });
        setActiveCollection(name);
        if (withPost) await newPost(name);
      }}
    />
  );

  if (!open) return <>{dialog}</>;

  return (
    <>
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-overlay/60 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="mt-[12vh] flex w-[680px] max-w-[92vw] flex-col overflow-hidden rounded-2xl border border-secondary bg-secondary shadow-2xl ring-1 ring-primary"
      >
        <Command shouldFilter={false} className="flex w-full flex-col">
          <div className="flex items-center gap-2 border-b border-secondary px-4">
            <SearchLg data-icon className="size-4 shrink-0 text-quaternary" />
            <Command.Input
              autoFocus
              placeholder={
                mode === "commands"
                  ? "Type a command, or press Enter to create a new post"
                  : "Search posts… (type / for commands)"
              }
              value={q}
              onValueChange={setQ}
              className="w-full bg-transparent px-1 py-3.5 text-sm text-primary outline-none placeholder:text-quaternary"
            />
          </div>

          <Command.List className="max-h-[60vh] min-h-[120px] overflow-y-auto p-1.5">
            <Command.Empty className="px-3 py-8 text-center text-sm text-tertiary">
              {mode === "search" ? "No results." : "No matching commands."}
            </Command.Empty>

            {mode === "commands" && (
              <Command.Group>
                {filteredCommands.map((c) => (
                  <Item
                    key={c.key}
                    label={c.label}
                    emoji={c.emoji ?? undefined}
                    icon={c.icon}
                    hint={c.hint}
                    onSelect={c.onSelect}
                  />
                ))}
              </Command.Group>
            )}

            {mode === "search" && q && (
              <Command.Group heading="Posts">
                {results.map((r) => {
                  const id = Number(r.id);
                  const status = (r as unknown as { status?: string | null }).status;
                  const type = (r as unknown as { type?: string }).type;
                  const emoji = type ? collectionDisplay(type, collectionRows).emoji : null;
                  return (
                    <Item
                      key={r.id}
                      label={String((r as unknown as { title?: string }).title || "Untitled")}
                      emoji={emoji ?? undefined}
                      hint={status === "draft" ? "draft" : undefined}
                      onSelect={() => {
                        go({ view: "post", id });
                        setOpen(false);
                      }}
                    />
                  );
                })}
              </Command.Group>
            )}
          </Command.List>

          <Footer />
        </Command>
      </div>
    </div>
    {dialog}
    </>
  );
}

function fuzzyMatch(label: string, q: string): boolean {
  const haystack = label.toLowerCase();
  if (haystack.includes(q)) return true;
  let i = 0;
  for (const ch of haystack) {
    if (ch === q[i]) i++;
    if (i === q.length) return true;
  }
  return false;
}

function Footer() {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-secondary bg-primary px-4 py-2.5 text-xs text-tertiary">
      <div className="flex items-center gap-3">
        <Kbd>
          <ArrowUp className="size-3" />
          <ArrowDown className="size-3" />
        </Kbd>
        <span>navigate</span>
        <Kbd>
          <CornerDownLeft className="size-3" />
        </Kbd>
        <span>select</span>
        <Kbd>esc</Kbd>
        <span>close</span>
      </div>
      <div className="flex items-center gap-2">
        <Kbd>/</Kbd>
        <span>commands</span>
        <span className="text-quaternary">·</span>
        <Kbd>⌘⇧N</Kbd>
        <span>new post</span>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center gap-0.5 rounded border border-secondary bg-secondary_alt px-1 font-sans text-[11px] font-medium text-secondary">
      {children}
    </kbd>
  );
}

function Item({
  label,
  hint,
  onSelect,
  emoji,
  icon,
}: {
  label: string;
  hint?: string;
  onSelect: () => void;
  emoji?: string;
  icon?: React.ReactNode;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm text-secondary transition aria-selected:bg-tertiary aria-selected:font-medium aria-selected:text-primary"
    >
      <span className="flex min-w-0 items-center gap-2.5">
        {emoji ? (
          <span className="inline-block w-4 shrink-0 text-center text-base leading-none">
            {emoji}
          </span>
        ) : icon ? (
          <span className="shrink-0 text-quaternary">{icon}</span>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <span className="truncate">{label}</span>
      </span>
      {hint && <span className="shrink-0 text-xs text-quaternary">{hint}</span>}
    </Command.Item>
  );
}
