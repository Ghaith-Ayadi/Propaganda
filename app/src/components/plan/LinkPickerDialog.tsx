// A small searchable picker modal, shared by brief↔post linking: pick a post
// to link to a brief, or a brief to attach to a post. Mirrors ConfirmDialog's
// overlay idiom.

import { useEffect, useMemo, useState } from "react";
import { SearchLg } from "@untitledui/icons";

export interface PickItem {
  id: string | number;
  label: string;
  sublabel?: string;
}

interface Props {
  title: string;
  items: PickItem[];
  emptyText?: string;
  onPick: (id: string | number) => void;
  onClose: () => void;
}

export function LinkPickerDialog({ title, items, emptyText = "Nothing to pick.", onPick, onClose }: Props) {
  const [q, setQ] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(
      (i) =>
        i.label.toLowerCase().includes(needle) || (i.sublabel ?? "").toLowerCase().includes(needle),
    );
  }, [items, q]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[70vh] w-[460px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-secondary bg-secondary shadow-2xl ring-1 ring-primary"
      >
        <div className="border-b border-secondary px-4 py-3">
          <h2 className="mb-2 text-sm font-semibold text-primary">{title}</h2>
          <label className="flex items-center gap-2 rounded-lg bg-primary px-2.5 py-1.5 text-sm shadow-xs ring-1 ring-inset ring-primary transition-shadow focus-within:ring-2 focus-within:ring-inset focus-within:ring-brand">
            <SearchLg className="size-4 shrink-0 text-quaternary" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search…"
              className="w-full bg-transparent text-primary outline-none placeholder:text-quaternary"
            />
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-quaternary">{emptyText}</p>
          ) : (
            filtered.map((i) => (
              <button
                key={i.id}
                onClick={() => {
                  onPick(i.id);
                  onClose();
                }}
                className="flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left transition hover:bg-primary_hover"
              >
                <span className="line-clamp-1 text-sm text-primary">{i.label}</span>
                {i.sublabel && <span className="text-[11px] text-quaternary">{i.sublabel}</span>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
