// Multi-select tag picker: a chip field that opens a popover to toggle
// tenant-wide tags or create a new one. Tenant-wide = the union of every tag
// used across all posts (passed in via `options`). A post may hold many tags.

import { useMemo, useState } from "react";
import { Button as AriaButton, Dialog, DialogTrigger, Popover as AriaPopover } from "react-aria-components";
import { Check, Plus, SearchLg } from "@untitledui/icons";
import { cx } from "@/utils/cx";

interface Props {
  value: string[];
  /** All tags used anywhere in the tenant, for the dropdown. */
  options: string[];
  onChange: (next: string[]) => void;
}

export function TagSelect({ value, options, onChange }: Props) {
  const [query, setQuery] = useState("");
  const selected = value ?? [];

  const toggle = (tag: string) =>
    onChange(selected.includes(tag) ? selected.filter((t) => t !== tag) : [...selected, tag]);
  const remove = (tag: string) => onChange(selected.filter((t) => t !== tag));

  const q = query.trim();
  const all = useMemo(
    () => Array.from(new Set([...options, ...selected])).sort((a, b) => a.localeCompare(b)),
    [options, selected],
  );
  const filtered = useMemo(
    () => (q ? all.filter((t) => t.toLowerCase().includes(q.toLowerCase())) : all),
    [all, q],
  );
  const canCreate = q.length > 0 && !all.some((t) => t.toLowerCase() === q.toLowerCase());

  const create = () => {
    if (!q) return;
    if (!selected.includes(q)) onChange([...selected, q]);
    setQuery("");
  };

  return (
    <DialogTrigger>
      <AriaButton
        className={cx(
          "flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-lg bg-primary px-2 py-1.5 text-left shadow-xs ring-1 ring-primary transition ring-inset outline-hidden",
          "focus-visible:ring-2 focus-visible:ring-brand pressed:ring-2 pressed:ring-brand",
        )}
      >
        {selected.length === 0 ? (
          <span className="px-0.5 text-sm text-placeholder">Add tags…</span>
        ) : (
          selected.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-md bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary ring-1 ring-secondary_alt ring-inset"
            >
              {tag}
              <span
                role="button"
                aria-label={`Remove ${tag}`}
                className="cursor-pointer text-quaternary transition hover:text-secondary"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  remove(tag);
                }}
              >
                ✕
              </span>
            </span>
          ))
        )}
        <Plus className="ml-auto size-4 shrink-0 text-fg-quaternary" />
      </AriaButton>

      <AriaPopover
        placement="bottom left"
        className={cx(
          "w-(--trigger-width) min-w-56 origin-(--trigger-anchor-point) overflow-hidden rounded-lg bg-primary shadow-lg ring-1 ring-secondary_alt",
          "entering:duration-150 entering:ease-out entering:animate-in entering:fade-in entering:slide-in-from-top-0.5",
          "exiting:duration-100 exiting:ease-in exiting:animate-out exiting:fade-out exiting:slide-out-to-top-0.5",
        )}
      >
        <Dialog className="outline-hidden">
          <div className="flex items-center gap-2 border-b border-secondary px-3 py-2">
            <SearchLg className="size-4 shrink-0 text-fg-quaternary" />
            <input
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canCreate) {
                  e.preventDefault();
                  create();
                }
              }}
              placeholder="Search or create…"
              className="w-full bg-transparent text-sm text-primary outline-none placeholder:text-quaternary"
            />
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.map((tag) => {
              const isSel = selected.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggle(tag)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-secondary transition hover:bg-primary_hover"
                >
                  <Check
                    className={cx("size-4 shrink-0 stroke-[2.25px] text-fg-brand-primary", !isSel && "invisible")}
                  />
                  <span className="truncate">{tag}</span>
                </button>
              );
            })}
            {canCreate && (
              <button
                type="button"
                onClick={create}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-secondary transition hover:bg-primary_hover"
              >
                <Plus className="size-4 shrink-0 text-fg-quaternary" />
                <span className="truncate">
                  Create <span className="font-medium text-primary">“{q}”</span>
                </span>
              </button>
            )}
            {filtered.length === 0 && !canCreate && (
              <div className="px-3 py-3 text-center text-xs text-quaternary">No tags yet.</div>
            )}
          </div>
        </Dialog>
      </AriaPopover>
    </DialogTrigger>
  );
}
