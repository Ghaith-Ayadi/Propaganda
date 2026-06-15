import { useEffect, useMemo, useRef, useState } from "react";
import { BlockNoteView } from "@blocknote/mantine";
import {
  useCreateBlockNote,
  FormattingToolbar,
  FormattingToolbarController,
  getFormattingToolbarItems,
} from "@blocknote/react";
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
import { useEditorStyles } from "@/lib/editorStyles";
import type { Collection } from "@/types";
import { WikilinkAutocomplete } from "@/components/WikilinkAutocomplete";
import {
  MentionAutocomplete,
  MentionToolbarButton,
} from "@/components/PostMention";

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
  const subtitleRef = useRef<HTMLTextAreaElement | null>(null);
  const [titleVisible, setTitleVisible] = useState(true);

  // Auto-size the subtitle textarea to its content on mount and when the post
  // changes (e.g. navigating between posts or subtitle syncing in).
  useEffect(() => {
    const el = subtitleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [post.id, post.subtitle]);
  const editorCss = useEditorStyles();

  // When the article title scrolls out of view, the sticky nav switches to
  // showing the post title in place of just the collection.
  useEffect(() => {
    if (!titleRef.current) return;
    const io = new IntersectionObserver(
      ([entry]) => setTitleVisible(entry.isIntersecting),
      { threshold: 0, rootMargin: "-44px 0px 0px 0px" },
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

  // ArrowUp at the top of the body → subtitle → title.
  useEffect(() => {
    const root = editorRootRef.current;
    if (!root || !editor) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowUp" && !(e.key === "Tab" && e.shiftKey)) return;
      const pos = editor.getTextCursorPosition?.();
      if (!pos || pos.prevBlock) return;
      e.preventDefault();
      // Step to subtitle if present, otherwise go straight to title.
      const sub = subtitleRef.current;
      const title = titleRef.current;
      if (sub && document.activeElement !== sub) {
        sub.focus();
        sub.setSelectionRange(sub.value.length, sub.value.length);
      } else if (title) {
        title.focus();
        title.setSelectionRange(title.value.length, title.value.length);
      }
    };
    root.addEventListener("keydown", onKeyDown, true);
    return () => root.removeEventListener("keydown", onKeyDown, true);
  }, [editor, post.id]);

  return (
    <div className="mx-auto w-full max-w-[760px] px-10">
      <style>{editorCss}</style>
      <PostNav post={post} showTitle={!titleVisible} />
      <div className="pt-12">
        <input
          ref={titleRef}
          value={post.title}
          onChange={(e) => void updatePost(post.id, { title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              subtitleRef.current?.focus();
            }
          }}
          placeholder="Untitled"
          className="w-full bg-transparent font-title text-4xl leading-tight text-primary outline-none placeholder:text-quaternary"
        />
        <textarea
          ref={subtitleRef}
          value={post.subtitle ?? ""}
          rows={1}
          onChange={(e) => {
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${el.scrollHeight}px`;
            void updatePost(post.id, { subtitle: e.target.value || null });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              editor.focus();
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              const title = titleRef.current;
              if (title) {
                title.focus();
                title.setSelectionRange(title.value.length, title.value.length);
              }
            }
          }}
          placeholder="Subtitle"
          className="mt-2 w-full resize-none overflow-hidden bg-transparent text-xl leading-snug text-secondary outline-none placeholder:text-quaternary"
        />
        <div className="mb-8" />
        <div ref={editorRootRef} className="w-full pb-24">
          <BlockNoteView editor={editor} theme={theme} formattingToolbar={false}>
            <FormattingToolbarController
              formattingToolbar={() => (
                <FormattingToolbar>
                  {...getFormattingToolbarItems()}
                  <MentionToolbarButton key="mention" excludeId={post.id} />
                </FormattingToolbar>
              )}
            />
          </BlockNoteView>
          <WikilinkAutocomplete rootRef={editorRootRef} />
          <MentionAutocomplete
            editor={editor}
            rootRef={editorRootRef}
            excludeId={post.id}
          />
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
        className="sticky top-0 z-30 -mx-10 flex items-center justify-between border-b border-secondary bg-primary/85 px-10 py-3 text-xs text-tertiary backdrop-blur"
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
          {post.wordCount != null && (
            <span className="mr-1 text-quaternary">
              {formatWordCount(post.wordCount)}
            </span>
          )}
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
