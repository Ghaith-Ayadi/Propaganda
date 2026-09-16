// Lightweight wikilink autocomplete. Watches keystrokes inside the editor surface,
// detects the "[[query" pattern, and shows a floating MiniSearch-backed picker.
// On select, replaces "[[query" with "[[slug]]" via document.execCommand or selection
// manipulation — we deliberately don't reach into ProseMirror so this stays decoupled.

import { useEffect, useRef, useState } from "react";
import { search } from "@/lib/search";

interface Match {
  id: string;
  slug: string;
  title: string;
}

export function WikilinkAutocomplete({ rootRef }: { rootRef: React.RefObject<HTMLElement | null> }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const matchesRef = useRef<Match[]>([]);

  useEffect(() => {
    matchesRef.current = !query
      ? []
      : search(query, 8).map((r) => ({
          id: r.id as string,
          slug: (r as unknown as { slug?: string }).slug ?? "",
          title: (r as unknown as { title?: string }).title ?? "Untitled",
        }));
  }, [query]);

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
      const r = range.getBoundingClientRect();
      return { text, rect: r };
    }

    function onInput() {
      const ctx = readContext();
      if (!ctx) return close();
      const m = /\[\[([^\[\]]{0,40})$/.exec(ctx.text);
      if (!m) return close();
      setQuery(m[1]);
      setOpen(true);
      // Position below caret. If the caret rect is zero-sized (empty text),
      // fall back to the editor's left edge.
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
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(matches.length - 1, i + 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        const m = matches[activeIdx];
        if (m) {
          e.preventDefault();
          insertSlug(m.slug);
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
  }, [rootRef, open, activeIdx]);

  if (!open || !query) return null;
  const matches = matchesRef.current;
  if (!matches.length) return null;

  return (
    <div
      style={{ position: "fixed", left: pos.x, top: pos.y, zIndex: 60 }}
      className="w-72 overflow-hidden rounded-md border border-border bg-bg-elev shadow-2xl"
    >
      <ul>
        {matches.map((m, i) => (
          <li
            key={m.id}
            onMouseDown={(e) => {
              e.preventDefault();
              insertSlug(m.slug);
              setOpen(false);
              setQuery("");
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
    </div>
  );
}

// Replace the "[[query" prefix in the current text node with "[[slug]]"
function insertSlug(slug: string) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return;
  const text = node.textContent ?? "";
  const offset = range.startOffset;
  const before = text.slice(0, offset);
  const after = text.slice(offset);
  const m = /\[\[([^\[\]]{0,40})$/.exec(before);
  if (!m) return;
  const newText = before.slice(0, m.index) + `[[${slug}]]` + after;
  node.textContent = newText;
  // Place caret right after the inserted slug.
  const newOffset = m.index + slug.length + 4;
  const r = document.createRange();
  r.setStart(node, newOffset);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
  // Fire an input event so the editor's onChange picks it up.
  node.parentElement?.dispatchEvent(new InputEvent("input", { bubbles: true }));
}
