// "@mention" linking to other posts. Two entry points, one mechanism:
//   1. MentionAutocomplete — type "@query" inline; Enter pastes the post's full
//      title as a link to its public URL (/p/slug), Notion-style.
//   2. MentionToolbarButton — an "@" button at the end of the selection
//      formatting toolbar; links the highlighted text to a post you pick.
// Both share the same MiniSearch-backed picker and write a real BlockNote link
// mark via the editor's ProseMirror transaction (so it renders as an anchor
// immediately, unlike the decoupled "[[slug]]" wikilink path).

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AtSign } from "@untitledui/icons";
import { useBlockNoteEditor, useComponentsContext } from "@blocknote/react";
import type { BlockNoteEditor } from "@blocknote/core";
import { search } from "@/lib/search";

// Permissive editor type: the concrete instance from useCreateBlockNote and the
// generic one from useBlockNoteEditor have incompatible schema generics.
type Editor = BlockNoteEditor<any, any, any>;

interface Match {
  id: number;
  slug: string;
  title: string;
}

/** The in-app public URL for a post. Reader treats "/p/" hrefs as internal. */
function postHref(slug: string): string {
  return `/p/${encodeURIComponent(slug)}`;
}

function searchPosts(query: string, limit: number, excludeId?: number): Match[] {
  if (!query.trim()) return [];
  return search(query, limit + 1)
    .map((r) => ({
      id: r.id as number,
      slug: (r as unknown as { slug?: string }).slug ?? "",
      title: (r as unknown as { title?: string }).title ?? "Untitled",
    }))
    .filter((m) => m.slug && m.id !== excludeId)
    .slice(0, limit);
}

/** Mark an existing doc range [from, to] as a link to the post. */
function linkRange(editor: Editor, from: number, to: number, slug: string) {
  if (!editor || from === to) return;
  const href = postHref(slug);
  const schema = editor.prosemirrorState.schema;
  editor.transact((tr) => {
    tr.addMark(from, to, schema.mark("link", { href }));
  });
}

/**
 * Replace the "@query" immediately before the caret with the post title,
 * linked to its public URL. Positions are derived from the DOM via posAtDOM
 * (rather than the editor's selection) so this is robust regardless of focus.
 */
function replaceMentionWithLink(editor: Editor, slug: string, title: string) {
  if (!editor) return;
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return;
  const caret = range.startOffset;
  const before = (node.textContent ?? "").slice(0, caret);
  const m = /@([^@\n]{0,40})$/.exec(before);
  if (!m) return;

  const view = editor.prosemirrorView;
  const from = view.posAtDOM(node, m.index); // the "@"
  const to = view.posAtDOM(node, caret);
  const href = postHref(slug);
  const schema = editor.prosemirrorState.schema;
  editor.transact((tr) => {
    // Replace "@query" with the title plus a trailing (unlinked) space so the
    // next keystroke isn't swallowed into the link.
    tr.insertText(`${title} `, from, to);
    tr.addMark(from, from + title.length, schema.mark("link", { href }));
  });
}

function PickerList({
  matches,
  activeIdx,
  onPick,
}: {
  matches: Match[];
  activeIdx: number;
  onPick: (m: Match) => void;
}) {
  return (
    <ul>
      {matches.map((m, i) => (
        <li
          key={m.id}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(m);
          }}
          className={[
            "cursor-pointer truncate px-3 py-1.5 text-sm",
            i === activeIdx ? "bg-bg-hover text-fg" : "text-fg-muted",
          ].join(" ")}
        >
          {m.title}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// 1. Inline "@query" autocomplete
// ---------------------------------------------------------------------------

export function MentionAutocomplete({
  editor,
  rootRef,
  excludeId,
}: {
  editor: Editor;
  rootRef: React.RefObject<HTMLElement | null>;
  excludeId?: number;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const matchesRef = useRef<Match[]>([]);

  matchesRef.current = open ? searchPosts(query, 3, excludeId) : [];

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    function close() {
      setOpen(false);
      setQuery("");
      setActiveIdx(0);
    }

    function readContext(): { text: string; rect: DOMRect } | null {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return null;
      const range = sel.getRangeAt(0).cloneRange();
      const node = range.startContainer;
      if (node.nodeType !== Node.TEXT_NODE) return null;
      const text = (node.textContent ?? "").slice(0, range.startOffset);
      return { text, rect: range.getBoundingClientRect() };
    }

    function onInput() {
      const ctx = readContext();
      if (!ctx) return close();
      // "@" at the start of a word, then up to 40 chars (no second "@").
      const m = /(?:^|\s)@([^@\n]{0,40})$/.exec(ctx.text);
      if (!m) return close();
      setQuery(m[1]);
      setActiveIdx(0);
      setOpen(true);
      const x = ctx.rect.left || root!.getBoundingClientRect().left;
      const y = (ctx.rect.bottom || ctx.rect.top) + 4;
      setPos({ x, y });
    }

    function onKeyDown(e: KeyboardEvent) {
      if (!open) return;
      const matches = matchesRef.current;
      if (e.key === "Escape") {
        e.preventDefault();
        return close();
      }
      if (!matches.length) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(matches.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter" || e.key === "Tab") {
        const m = matches[activeIdx];
        if (m) {
          e.preventDefault();
          replaceMentionWithLink(editor, m.slug, m.title);
          close();
        }
      }
    }

    root.addEventListener("input", onInput);
    root.addEventListener("keydown", onKeyDown, true);
    return () => {
      root.removeEventListener("input", onInput);
      root.removeEventListener("keydown", onKeyDown, true);
    };
  }, [rootRef, editor, open, activeIdx, query]);

  if (!open) return null;
  const matches = matchesRef.current;
  if (!matches.length) return null;

  return (
    <div
      style={{ position: "fixed", left: pos.x, top: pos.y, zIndex: 60 }}
      className="w-72 overflow-hidden rounded-md border border-border bg-bg-elev shadow-2xl"
    >
      <PickerList
        matches={matches}
        activeIdx={activeIdx}
        onPick={(m) => {
          replaceMentionWithLink(editor, m.slug, m.title);
          setOpen(false);
          setQuery("");
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Formatting-toolbar "@" button (links the current selection)
// ---------------------------------------------------------------------------

export function MentionToolbarButton({ excludeId }: { excludeId?: number }) {
  const editor = useBlockNoteEditor();
  const Components = useComponentsContext()!;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const rangeRef = useRef<{ from: number; to: number } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const matches = useMemo(
    () => (open ? searchPosts(query, 6, excludeId) : []),
    [open, query, excludeId],
  );

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function openPicker() {
    const sel = editor.prosemirrorState.selection;
    if (sel.from === sel.to) return;
    rangeRef.current = { from: sel.from, to: sel.to };
    const wsel = window.getSelection();
    const rect =
      wsel && wsel.rangeCount
        ? wsel.getRangeAt(0).getBoundingClientRect()
        : null;
    setPos({ x: rect?.left ?? 240, y: (rect?.bottom ?? 240) + 8 });
    setQuery(editor.getSelectedText());
    setActiveIdx(0);
    setOpen(true);
  }

  function choose(m: Match) {
    const r = rangeRef.current;
    if (r) linkRange(editor, r.from, r.to, m.slug);
    setOpen(false);
    setQuery("");
  }

  return (
    <>
      <Components.FormattingToolbar.Button
        label="Link to post"
        mainTooltip="Link to a post"
        icon={<AtSign size={16} />}
        isSelected={open}
        onClick={openPicker}
      />
      {open &&
        createPortal(
          <div
            style={{ position: "fixed", left: pos.x, top: pos.y, zIndex: 70 }}
            className="w-72 overflow-hidden rounded-md border border-border bg-bg-elev shadow-2xl"
            onMouseDown={(e) => {
              // Keep focus/selection unless clicking a result (handled there).
              if (e.target === e.currentTarget) e.preventDefault();
            }}
          >
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIdx(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setOpen(false);
                } else if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActiveIdx((i) => Math.min(matches.length - 1, i + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActiveIdx((i) => Math.max(0, i - 1));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  const m = matches[activeIdx];
                  if (m) choose(m);
                }
              }}
              placeholder="Search posts…"
              className="w-full border-b border-border bg-transparent px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-muted"
            />
            {matches.length > 0 && (
              <PickerList
                matches={matches}
                activeIdx={activeIdx}
                onPick={choose}
              />
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
