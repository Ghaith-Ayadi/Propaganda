import { useEffect, useMemo, useRef, useState } from "react";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import "@blocknote/mantine/style.css";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, ArrowDown, ArrowUp } from "@untitledui/icons";
import type { Post } from "@/types";
import { db } from "@/lib/db";
import { updatePost } from "@/lib/posts";
import { uploadFile } from "@/lib/uploads";
import { go } from "@/lib/route";
import { collectionDisplay } from "@/lib/collections";
import { useTheme } from "@/lib/theme";
import { countWords, formatWordCount } from "@/lib/format";
import { consumeTitleFocus } from "@/lib/postFocus";
import type { Collection } from "@/types";
import { WikilinkAutocomplete } from "@/components/WikilinkAutocomplete";

interface Props {
  post: Post;
}

const SAVE_DEBOUNCE_MS = 100;

export function Editor({ post }: Props) {
  const editor = useCreateBlockNote({ uploadFile });
  const [theme] = useTheme();
  const lastLoadedId = useRef<number | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load post content into editor when switching documents — same editor instance.
  useEffect(() => {
    if (!editor) return;
    if (lastLoadedId.current === post.id) return;
    lastLoadedId.current = post.id;
    void (async () => {
      const blocks = await editor.tryParseMarkdownToBlocks(post.content || "");
      editor.replaceBlocks(editor.document, blocks);
    })();
  }, [editor, post.id, post.content]);

  // Save on change: debounce 100ms to IDB; sync engine pushes to Supabase on 2s idle.
  // Word count rides the same debounce — no separate pass.
  useEffect(() => {
    if (!editor) return;
    const unsub = editor.onChange(() => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        const md = await editor.blocksToMarkdownLossy();
        await updatePost(post.id, { content: md, wordCount: countWords(md) });
      }, SAVE_DEBOUNCE_MS);
    });
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (typeof unsub === "function") unsub();
    };
  }, [editor, post.id]);

  const editorRootRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const [titleVisible, setTitleVisible] = useState(true);

  // When the article title scrolls out of view, the sticky nav switches to
  // showing the post title in place of just the collection.
  useEffect(() => {
    if (!titleRef.current) return;
    const io = new IntersectionObserver(
      ([entry]) => setTitleVisible(entry.isIntersecting),
      { threshold: 0, rootMargin: "-1px 0px 0px 0px" },
    );
    io.observe(titleRef.current);
    return () => io.disconnect();
  }, [post.id]);

  // Focus the title when navigating to a freshly-created post (cmd+K → new).
  useEffect(() => {
    if (consumeTitleFocus(post.id)) {
      titleRef.current?.focus();
    }
  }, [post.id]);

  // ArrowUp at the top of the body should jump back to the title.
  useEffect(() => {
    const root = editorRootRef.current;
    if (!root || !editor) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowUp" && !(e.key === "Tab" && e.shiftKey)) return;
      const pos = editor.getTextCursorPosition?.();
      if (!pos || pos.prevBlock) return;
      e.preventDefault();
      const el = titleRef.current;
      if (!el) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    };
    root.addEventListener("keydown", onKeyDown, true);
    return () => root.removeEventListener("keydown", onKeyDown, true);
  }, [editor, post.id]);

  return (
    <div className="mx-auto w-full max-w-[760px] px-10">
      <PostNav post={post} showTitle={!titleVisible} />
      <div className="pt-2">
        <input
          ref={titleRef}
          value={post.title}
          onChange={(e) => void updatePost(post.id, { title: e.target.value })}
          placeholder="Untitled"
          className="w-full bg-transparent font-title text-4xl leading-tight text-primary outline-none placeholder:text-quaternary"
        />
        <div className="mt-3 mb-8 text-xs text-quaternary">
          {formatWordCount(post.wordCount)}
        </div>
        <div ref={editorRootRef} className="w-full pb-24">
          <BlockNoteView editor={editor} theme={theme} />
          <WikilinkAutocomplete rootRef={editorRootRef} />
        </div>
      </div>
    </div>
  );
}

function PostNav({ post, showTitle }: { post: Post; showTitle: boolean }) {
  const peers = useLiveQuery(
    () => db.posts.where("type").equals(post.type).toArray(),
    [post.type],
    [] as Post[],
  );
  const collections = useLiveQuery(
    () => db.collections.toArray(),
    [],
    [] as Collection[],
  );
  const sorted = useMemo(
    () =>
      [...peers].sort((a, b) => (a.collectionSeq ?? 0) - (b.collectionSeq ?? 0)),
    [peers],
  );
  const idx = sorted.findIndex((p) => p.id === post.id);
  const prev = idx > 0 ? sorted[idx - 1] : null;
  const next = idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : null;
  const display = collectionDisplay(post.type, collections);

  return (
    <>
      <div
        className={[
          "sticky top-0 z-30 -mx-10 flex items-center justify-between px-10 py-3 text-xs text-tertiary transition-[background,border-color] duration-150",
          showTitle
            ? "border-b border-secondary bg-primary/85 backdrop-blur"
            : "border-b border-transparent bg-transparent",
        ].join(" ")}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <button
            type="button"
            onClick={() => go({ view: "list" })}
            className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 transition hover:bg-primary_hover hover:text-secondary"
          >
            <ArrowLeft className="size-3.5" />
            {display.emoji && <span className="text-sm leading-none">{display.emoji}</span>}
            <span>{display.label || post.type || "Home"}</span>
          </button>
          {showTitle && (
            <>
              <span className="shrink-0 text-quaternary">/</span>
              <span className="truncate text-sm text-primary">
                {post.title || "Untitled"}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span className="date-pill mr-2 text-quaternary">
            #{post.collectionSeq ?? "—"} of {sorted.length}
          </span>
          <button
            type="button"
            aria-label="Previous post"
            disabled={!prev}
            onClick={() => prev && go({ view: "post", id: prev.id })}
            className="rounded-md p-1.5 text-tertiary transition hover:bg-primary_hover hover:text-secondary disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ArrowUp className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Next post"
            disabled={!next}
            onClick={() => next && go({ view: "post", id: next.id })}
            className="rounded-md p-1.5 text-tertiary transition hover:bg-primary_hover hover:text-secondary disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ArrowDown className="size-4" />
          </button>
        </div>
      </div>
    </>
  );
}
