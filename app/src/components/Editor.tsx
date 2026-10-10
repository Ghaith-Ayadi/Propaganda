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
import { ArrowLeft, ArrowDown, ArrowUp, LayoutRight, Menu01 } from "@untitledui/icons";
import type { Post } from "@/types";
import { db } from "@/lib/db";
import { updatePost } from "@/lib/posts";
import { beginWrite } from "@/lib/db";
import { uploadFile } from "@/lib/uploads";
import { hasImageFileBlock, normalizeImageBlocks, promoteImageFileBlocks } from "@/lib/images";
import { go, goPage } from "@/lib/route";
import { usePipelineItemForPost } from "@/lib/pipeline/store";
import { collectionDisplay } from "@/lib/collections";
import { useTheme } from "@/lib/theme";
import { countWords, formatWordCount } from "@/lib/format";
import { consumeTitleFocus } from "@/lib/postFocus";
import { useEditorStyles } from "@/lib/editorStyles";
import { setDrawer, toggleDrawer, useIsMobile } from "@/lib/mobile";
import { useLayout } from "@/lib/layout";
import { TextSelection } from "prosemirror-state";
import { reviewMarksKey, reviewMarksPlugin } from "@/lib/review/marks";
import { useReviewPublisher } from "@/lib/review/notes";
import { activate, registerEditor, reviewState, setFound, setHover, subscribeReview } from "@/lib/review/store";
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
  // The Review tab's notes, built here so the text shows them on any side tab.
  useReviewPublisher(post.id, usePipelineItemForPost(post.id));
  const editor = useCreateBlockNote({
    uploadFile,
    // The Review tab's highlights (lib/review): decorations only, never saved.
    _extensions: { reviewMarks: { plugin: reviewMarksPlugin(setFound) } },
  });
  const [theme] = useTheme();
  const lastLoadedId = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True while we programmatically replace the document on load. BlockNote fires
  // onChange for programmatic edits too, so without this guard merely opening a
  // post would persist it back (bumping updatedAt and, worse, rewriting normalised
  // image blocks over the stored content). We only save genuine user edits.
  const loadingRef = useRef(false);

  // Content this editor loaded or wrote for the open post (the last few: a sync
  // re-emit of an older save of ours can arrive after a newer one).
  const ours = useRef<string[]>([]);

  // Load post content into editor when switching documents — same editor instance.
  // Also when the open post changes from outside (the Writer's draft, another
  // device), unless a keystroke is waiting to be saved: without this the page
  // showed the old text until reopened, and the next keystroke saved it back.
  useEffect(() => {
    if (!editor) return;
    const content = post.content || "";
    if (lastLoadedId.current === post.id && (ours.current.includes(content) || saveTimer.current)) return;
    lastLoadedId.current = post.id;
    ours.current = [content];
    void (async () => {
      const blocks = await editor.tryParseMarkdownToBlocks(content);
      loadingRef.current = true;
      // Render image-URL file blocks / links as real images (legacy content
      // saved images as `[name](url)` links — see lib/images).
      editor.replaceBlocks(editor.document, normalizeImageBlocks(blocks) as typeof blocks);
      // Release on the next tick so the load's own onChange stays unsaved.
      setTimeout(() => {
        loadingRef.current = false;
      }, 0);
    })();
  }, [editor, post.id, post.content]);

  // Save on change: debounce 100ms to IDB; sync engine pushes to Supabase on 2s idle.
  // Word count rides the same debounce — no separate pass.
  useEffect(() => {
    if (!editor) return;
    const unsub = editor.onChange(() => {
      if (loadingRef.current) return; // ignore the programmatic load
      // Pasted/dropped images land as generic file blocks — promote them to
      // image blocks so they preview and serialise as `![](url)`. The update
      // re-fires onChange; we defer it out of this dispatch and save on that pass.
      if (hasImageFileBlock(editor)) {
        queueMicrotask(() => promoteImageFileBlocks(editor));
        return;
      }
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        void save();
      }, SAVE_DEBOUNCE_MS);
    });
    const postId = post.id;
    async function save() {
      const md = await editor!.blocksToMarkdownLossy();
      ours.current = [...ours.current.slice(-19), md];
      await updatePost(postId, { content: md, wordCount: countWords(md) });
    }
    return () => {
      if (typeof unsub === "function") unsub();
      // A keystroke still inside the debounce is saved now rather than dropped
      // (leaving the post, or switching site/account). beginWrite() makes a
      // scope switch wait for it, so it lands in this post's database.
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
        const done = beginWrite();
        void save()
          .catch((err) => console.error("Final save failed:", err))
          .finally(done);
      }
    };
  }, [editor, post.id]);

  const editorRootRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const subtitleRef = useRef<HTMLTextAreaElement | null>(null);
  const [titleVisible, setTitleVisible] = useState(true);

  // Title/subtitle are edited through LOCAL draft state, not bound straight to
  // the Dexie-backed `post`. Binding a controlled input's value to an async
  // store means every keystroke round-trips (onChange → IndexedDB → liveQuery
  // re-emit → re-render) and every sync pull rewrites the post object; when
  // React reassigns `value` a tick late the browser drops the caret to the end.
  // Editing a draft keeps the caret put; we still persist on every change.
  const [titleDraft, setTitleDraft] = useState(post.title);
  const [subtitleDraft, setSubtitleDraft] = useState(post.subtitle ?? "");
  // Re-seed drafts only when switching posts — never on the round-trip that
  // caused the jump. (Depending on post.id, not post.title/subtitle.)
  useEffect(() => {
    setTitleDraft(post.title);
    setSubtitleDraft(post.subtitle ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.id]);
  // A change from outside (the Writer, another device) shows in a field nobody is typing in.
  useEffect(() => {
    if (document.activeElement !== titleRef.current) setTitleDraft(post.title);
  }, [post.title]);
  useEffect(() => {
    if (document.activeElement !== subtitleRef.current) setSubtitleDraft(post.subtitle ?? "");
  }, [post.subtitle]);

  // Auto-size the subtitle textarea to its content on mount and when the post
  // changes (e.g. navigating between posts or subtitle syncing in).
  useEffect(() => {
    const el = subtitleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [post.id, subtitleDraft]);
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

  // Paste a URL while text is selected → wrap the selection in a link (like
  // Notion / Google Docs), instead of replacing the text with the raw URL.
  useEffect(() => {
    const root = editorRootRef.current;
    if (!root || !editor) return;
    const onPaste = (e: ClipboardEvent) => {
      const pasted = e.clipboardData?.getData("text/plain")?.trim();
      // Only a single bare URL qualifies; multi-line or plain text pastes normally.
      if (!pasted || /\s/.test(pasted) || !/^https?:\/\/\S+$/i.test(pasted)) return;
      const selected = editor.getSelectedText();
      if (!selected) return; // nothing selected → normal paste
      e.preventDefault();
      e.stopPropagation();
      editor.createLink(pasted);
    };
    root.addEventListener("paste", onPaste, true);
    return () => root.removeEventListener("paste", onPaste, true);
  }, [editor]);

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

  useReviewMarks(editor, post.id, editorRootRef);

  return (
    <div className="mx-auto w-full max-w-[760px] px-5 md:px-10">
      <style>{editorCss}</style>
      <style>{REVIEW_MARK_CSS}</style>
      <PostNav post={post} showTitle={!titleVisible} />
      <div className="pt-8 md:pt-12">
        <input
          ref={titleRef}
          value={titleDraft}
          onChange={(e) => {
            setTitleDraft(e.target.value);
            void updatePost(post.id, { title: e.target.value });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              subtitleRef.current?.focus();
            }
          }}
          placeholder="Untitled"
          className="w-full bg-transparent font-serif text-3xl leading-tight md:text-4xl text-primary outline-none placeholder:text-quaternary"
        />
        <textarea
          ref={subtitleRef}
          value={subtitleDraft}
          rows={1}
          onChange={(e) => {
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${el.scrollHeight}px`;
            setSubtitleDraft(e.target.value);
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
          className="mt-2 w-full resize-none overflow-hidden bg-transparent text-lg md:text-xl leading-snug text-secondary outline-none placeholder:text-quaternary"
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

type AnyEditor = ReturnType<typeof useCreateBlockNote>;

/**
 * Keeps the Review tab's highlights in the text in step with its cards: feeds
 * the passages to the marks plugin, lights up the hovered and active one,
 * scrolls to a passage when its card is clicked, and opens the Review tab when
 * a highlight is clicked.
 */
function useReviewMarks(editor: AnyEditor, postId: string, rootRef: React.RefObject<HTMLDivElement | null>) {
  const isMobile = useIsMobile();
  const [, setLayout] = useLayout();

  useEffect(() => {
    let seen = -1;
    const push = () => {
      const view = editor.prosemirrorView;
      if (!view) return;
      const r = reviewState();
      const mine = r.postId === postId;
      const cur = reviewMarksKey.getState(view.state);
      const anchors = mine ? r.anchors : [];
      const hover = mine ? r.hover : null;
      const active = mine ? r.active : null;
      if (cur && (cur.anchors !== anchors || cur.hover !== hover || cur.active !== active)) {
        view.dispatch(view.state.tr.setMeta(reviewMarksKey, { anchors, hover, active }).setMeta("addToHistory", false));
      }
      // A card was clicked: bring its passage into view.
      if (mine && r.activeFrom === "panel" && r.active && r.seq !== seen) {
        seen = r.seq;
        const el = rootRef.current?.querySelector(`[data-review-id="${CSS.escape(r.active)}"]`);
        el?.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    };
    push();
    // The view mounts a tick after the editor: try again once it's there.
    const t = setTimeout(push, 0);
    const unsub = subscribeReview(push);
    return () => {
      clearTimeout(t);
      unsub();
    };
  }, [editor, postId, rootRef]);

  useEffect(() => {
    const range = (id: string) => {
      const view = editor.prosemirrorView;
      const r = view && reviewMarksKey.getState(view.state)?.ranges.get(id);
      return view && r ? { view, ...r } : null;
    };
    registerEditor({
      replace(id, text) {
        const r = range(id);
        if (!r) return false;
        r.view.dispatch(r.view.state.tr.insertText(text, r.from, r.to));
        return true;
      },
      select(id) {
        const r = range(id);
        if (!r) return false;
        r.view.dispatch(r.view.state.tr.setSelection(TextSelection.create(r.view.state.doc, r.from, r.to)).scrollIntoView());
        r.view.focus();
        return true;
      },
    });
    return () => registerEditor(null);
  }, [editor]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const idOf = (e: Event) => (e.target as HTMLElement | null)?.closest?.("[data-review-id]")?.getAttribute("data-review-id") ?? null;
    const onOver = (e: MouseEvent) => setHover(idOf(e));
    const onLeave = () => setHover(null);
    const onClick = (e: MouseEvent) => {
      const id = idOf(e);
      if (!id) return;
      activate(id, "editor");
      if (isMobile) setDrawer("attributes");
      else setLayout({ attributes: true });
    };
    root.addEventListener("mouseover", onOver);
    root.addEventListener("mouseleave", onLeave);
    root.addEventListener("click", onClick);
    return () => {
      root.removeEventListener("mouseover", onOver);
      root.removeEventListener("mouseleave", onLeave);
      root.removeEventListener("click", onClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootRef, isMobile]);
}

/** One colour per Review section: pitch notes neutral, source checks red, knowledge base orange. */
const REVIEW_MARK_CSS = `
.review-mark { cursor: pointer; border-radius: 2px; text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 3px; transition: background-color 120ms; }
.review-mark--pitch { text-decoration-color: var(--color-utility-neutral-400); text-decoration-style: dashed; }
.review-mark--sources { text-decoration-color: var(--color-utility-red-500); }
.review-mark--kb { text-decoration-color: var(--color-utility-orange-500); }
.review-mark--pitch.is-hover, .review-mark--pitch.is-active { background: var(--color-utility-neutral-100); }
.review-mark--sources.is-hover, .review-mark--sources.is-active { background: var(--color-utility-red-100); }
.review-mark--kb.is-hover, .review-mark--kb.is-active { background: var(--color-utility-orange-100); }
`;

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
  // Posts in the pipeline go back to it.
  const pipelineItem = usePipelineItemForPost(post.id);
  const isMobile = useIsMobile();

  return (
    <>
      <div
        className="sticky top-0 z-30 -mx-5 flex items-center justify-between border-b border-secondary bg-primary/85 px-2 py-2 text-xs text-tertiary backdrop-blur md:-mx-10 md:px-10 md:py-3"
      >
        <div className="flex min-w-0 flex-1 items-center gap-1 md:gap-2">
          {isMobile && (
            <button
              type="button"
              aria-label="Menu"
              onClick={() => toggleDrawer("nav")}
              className="shrink-0 rounded-md p-2 text-tertiary transition hover:bg-primary_hover hover:text-secondary"
            >
              <Menu01 className="size-5" />
            </button>
          )}
          {pipelineItem ? (
            <button
              type="button"
              onClick={() => goPage("pipeline")}
              className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 transition hover:bg-primary_hover hover:text-secondary"
            >
              <ArrowLeft className="size-3.5" />
              <span>Pipeline</span>
            </button>
          ) : (
            <button
              type="button"
              aria-label={`Back to ${display.label || post.type}`}
              onClick={() => go({ view: "list" })}
              className="shrink-0 rounded-md p-1 transition hover:bg-primary_hover hover:text-secondary"
            >
              <ArrowLeft className="size-3.5" />
            </button>
          )}
          {/* Breadcrumbs: Content / Blog / Collection / post id. */}
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1">
            <button type="button" onClick={() => goPage("content")} className="rounded-md px-1 py-1 transition hover:text-secondary max-md:hidden">
              Content
            </button>
            <span className="text-quaternary max-md:hidden">/</span>
            <button type="button" onClick={() => go({ view: "list" })} className="rounded-md px-1 py-1 transition hover:text-secondary max-md:hidden">
              Blog
            </button>
            <span className="text-quaternary max-md:hidden">/</span>
            <button
              type="button"
              onClick={() => go({ view: "list" })}
              className="flex shrink-0 items-center gap-1 rounded-md px-1 py-1 transition hover:text-secondary"
            >
              {display.emoji && <span className="text-sm leading-none">{display.emoji}</span>}
              <span className="max-md:max-w-[9rem] max-md:truncate">{display.label || post.type || "Home"}</span>
            </button>
            <span className="text-quaternary">/</span>
            <span className="truncate font-mono text-quaternary">{post.postId || post.id}</span>
            {showTitle && (
              <>
                <span className="shrink-0 text-quaternary">·</span>
                <span className="truncate text-sm text-primary">{post.title || "Untitled"}</span>
              </>
            )}
          </nav>
        </div>
        <div className="flex items-center gap-1">
          {post.wordCount != null && (
            <span className="mr-1 text-quaternary">
              {formatWordCount(post.wordCount)}
            </span>
          )}
          <span className="date-pill mr-2 text-quaternary max-md:hidden">
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
          {isMobile && (
            <button
              type="button"
              aria-label="Post details"
              onClick={() => toggleDrawer("attributes")}
              className="rounded-md p-2 text-tertiary transition hover:bg-primary_hover hover:text-secondary"
            >
              <LayoutRight className="size-5" />
            </button>
          )}
        </div>
      </div>
    </>
  );
}
