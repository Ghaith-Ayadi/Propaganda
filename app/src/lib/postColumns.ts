// The posts table's columns (components/PostTable.tsx): which are shown, how
// wide each is, and whether a post's description sits under its title. Kept
// per browser (a view preference, not content).

import { useCallback, useEffect, useState } from "react";

export const POST_COLUMNS = [
  { id: "number", label: "ID", width: 64, min: 48 },
  // No default width: the title takes what the others leave until it is resized.
  { id: "title", label: "Title", width: null, min: 160 },
  { id: "status", label: "Status", width: 112, min: 88 },
  { id: "length", label: "Length", width: 144, min: 72 },
  { id: "hits", label: "Hits", width: 80, min: 56 },
  { id: "created", label: "Created", width: 112, min: 80 },
  { id: "updated", label: "Updated", width: 112, min: 80 },
] as const;

export type PostColumnId = (typeof POST_COLUMNS)[number]["id"];

export const MAX_COLUMN_WIDTH = 720;

interface Stored {
  hidden: PostColumnId[];
  widths: Partial<Record<PostColumnId, number>>;
  description: boolean;
}

const KEY = "propaganda:post-table";
const EMPTY: Stored = { hidden: [], widths: {}, description: false };

function load(): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Stored> | null;
    if (!raw) return EMPTY;
    const ids = new Set<string>(POST_COLUMNS.map((c) => c.id));
    const widths: Stored["widths"] = {};
    for (const [id, w] of Object.entries(raw.widths ?? {})) {
      if (ids.has(id) && typeof w === "number" && w > 0) widths[id as PostColumnId] = w;
    }
    return {
      hidden: (raw.hidden ?? []).filter((id) => ids.has(id)),
      widths,
      description: !!raw.description,
    };
  } catch {
    return EMPTY;
  }
}

export function usePostColumns() {
  const [state, setState] = useState<Stored>(load);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      // Private window or blocked storage: the view just isn't remembered.
    }
  }, [state]);

  const visible = POST_COLUMNS.filter((c) => !state.hidden.includes(c.id));

  const setShown = useCallback((id: PostColumnId, shown: boolean) => {
    setState((s) => {
      const hidden = shown ? s.hidden.filter((h) => h !== id) : [...new Set([...s.hidden, id])];
      // The table keeps at least one column.
      return hidden.length >= POST_COLUMNS.length ? s : { ...s, hidden };
    });
  }, []);

  const setWidth = useCallback((id: PostColumnId, width: number | null) => {
    setState((s) => {
      const widths = { ...s.widths };
      const col = POST_COLUMNS.find((c) => c.id === id)!;
      if (width == null) delete widths[id];
      else widths[id] = Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(col.min, width)));
      return { ...s, widths };
    });
  }, []);

  const setDescription = useCallback((description: boolean) => setState((s) => ({ ...s, description })), []);

  const reset = useCallback(() => setState(EMPTY), []);

  const widthOf = (id: PostColumnId): number | null =>
    state.widths[id] ?? POST_COLUMNS.find((c) => c.id === id)!.width;

  return { visible, hidden: state.hidden, description: state.description, widthOf, setShown, setWidth, setDescription, reset };
}
