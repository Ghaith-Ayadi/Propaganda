// Dashboard-02-style table for the posts in the active collection.
// - First body row is "+ New post" — replaces the floating add-post button
// - Status filter chips (All / Drafts / Published) above the table
// - Title filter input on the right

import { useMemo, useRef, useState } from "react";
import { useFlip } from "@/lib/motion/useFlip";
import { ArrowDown, ArrowUp, Copy04, DotsHorizontal, Plus, SearchLg, Sliders04, Trash01 } from "@untitledui/icons";
import type { Post } from "@/types";
import { go } from "@/lib/route";
import { formatDate, formatWordCount } from "@/lib/format";
import { usePostHitsTime } from "@/lib/analytics/hook";
import { formatHitsAndDuration } from "@/lib/analytics/format";
import { deletePost, duplicatePost } from "@/lib/posts";
import { ActionMenu } from "@/components/Menu";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button as AriaButton, Dialog, DialogTrigger, Popover } from "react-aria-components";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { POST_COLUMNS, usePostColumns, type PostColumnId } from "@/lib/postColumns";

type StatusFilter = "all" | "draft" | "done" | "published";
type SortKey = "updated" | "created";
type SortDir = "asc" | "desc";

interface Props {
  posts: Post[];
  onAddPost: () => void;
}

export function PostTable({ posts, onAddPost }: Props) {
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [confirmDelete, setConfirmDelete] = useState<Post | null>(null);

  const filtered = useMemo(() => {
    let xs = posts;
    if (filter !== "all") {
      xs = xs.filter((p) => (p.status ?? "draft") === filter);
    }
    const q = query.trim().toLowerCase();
    if (q) {
      const num = /^#?\d+$/.test(q) ? Number(q.replace("#", "")) : null;
      xs = xs.filter(
        (p) => p.number === num || p.title.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q),
      );
    }
    const field = sortKey === "updated" ? "updatedAt" : "createdAt";
    const sign = sortDir === "desc" ? -1 : 1;
    xs = [...xs].sort((a, b) => {
      const av = (a[field] ?? 0) as number;
      const bv = (b[field] ?? 0) as number;
      return av === bv ? 0 : av < bv ? -1 * sign : 1 * sign;
    });
    return xs;
  }, [posts, filter, query, sortKey, sortDir]);
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  useFlip(bodyRef, filtered);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const counts = useMemo(() => {
    let draft = 0;
    let done = 0;
    let published = 0;
    for (const p of posts) {
      const s = p.status ?? "draft";
      if (s === "published") published++;
      else if (s === "done") done++;
      else draft++;
    }
    return { all: posts.length, draft, done, published };
  }, [posts]);

  const cols = usePostColumns();
  const colCount = cols.visible.length + 1;

  function cell(p: Post, id: PostColumnId) {
    switch (id) {
      case "number":
        // The server numbers a post on its first push; until then it has none.
        return <Td key={id} className="font-mono text-xs tabular-nums text-quaternary">{p.number ?? ""}</Td>;
      case "title":
        return (
          <Td key={id} className="text-sm text-primary">
            <div className="truncate">{p.title || <span className="text-quaternary">Untitled</span>}</div>
            {cols.description && p.subtitle?.trim() && (
              <div className="mt-0.5 truncate text-xs text-tertiary">{p.subtitle.trim()}</div>
            )}
          </Td>
        );
      case "status":
        return (
          <Td key={id}>
            <StatusBadge status={(p.status ?? "draft") as "draft" | "done" | "published"} />
          </Td>
        );
      case "length":
        return <Td key={id} className="truncate whitespace-nowrap text-xs text-tertiary">{formatWordCount(p.wordCount)}</Td>;
      case "hits":
        return (
          <Td key={id} className="truncate whitespace-nowrap text-xs text-tertiary">
            <HitsCell slug={p.slug} />
          </Td>
        );
      case "created":
        return <Td key={id} className="date-pill text-xs text-quaternary">{formatDate(p.createdAt)}</Td>;
      case "updated":
        return <Td key={id} className="date-pill text-xs text-quaternary">{formatDate(p.updatedAt)}</Td>;
    }
  }

  function head(id: PostColumnId, label: string) {
    const grip = (
      <ColumnGrip
        label={`Resize ${label}`}
        min={POST_COLUMNS.find((c) => c.id === id)!.min}
        onResize={(w) => cols.setWidth(id, w)}
        onReset={() => cols.setWidth(id, null)}
      />
    );
    if (id === "created" || id === "updated") {
      return (
        <SortableTh key={id} grip={grip} active={sortKey === id} dir={sortDir} onClick={() => toggleSort(id)}>
          {label}
        </SortableTh>
      );
    }
    return (
      <Th key={id} grip={grip}>
        {label}
      </Th>
    );
  }

  return (
    <div className="rounded-xl border border-secondary bg-primary">
      <Toolbar
        filter={filter}
        onFilterChange={setFilter}
        query={query}
        onQueryChange={setQuery}
        counts={counts}
        display={<DisplayMenu cols={cols} />}
      />
      <table className="post-table w-full table-fixed border-separate border-spacing-0 text-sm">
        <colgroup>
          {cols.visible.map((c) => {
            const w = cols.widthOf(c.id);
            return <col key={c.id} style={w ? { width: w } : undefined} />;
          })}
          <col style={{ width: 40 }} />
        </colgroup>
        <thead className="z-20 md:sticky md:top-[57px]">
          <tr>
            {cols.visible.map((c) => head(c.id, c.label))}
            <Th className="w-10" />
          </tr>
        </thead>
        <tbody ref={bodyRef}>
          <tr
            tabIndex={0}
            onClick={onAddPost}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onAddPost();
              }
            }}
            className="group z-10 cursor-pointer md:sticky md:top-[93px] text-tertiary outline-none transition hover:text-primary"
          >
            <Td colSpan={colCount} className="bg-primary text-sm group-hover:bg-secondary group-focus:bg-secondary">
              <span className="flex items-center gap-2">
                <Plus className="size-4" />
                New post
              </span>
            </Td>
          </tr>
          {filtered.map((p) => (
            <tr
              key={p.id}
              data-flip={p.id}
              tabIndex={0}
              onClick={() => go({ view: "post", id: p.id })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  go({ view: "post", id: p.id });
                }
              }}
              className="group cursor-pointer text-secondary outline-none transition hover:bg-secondary focus:bg-secondary"
            >
              {cols.visible.map((c) => cell(p, c.id))}
              <Td
                className="text-right"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="inline-flex opacity-0 transition group-hover:opacity-100 focus-within:opacity-100 max-md:opacity-100">
                  <PostRowActions post={p} onDelete={() => setConfirmDelete(p)} />
                </div>
              </Td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr>
              <td
                colSpan={colCount}
                className="border-b border-secondary px-4 py-8 text-center text-sm text-tertiary last:border-b-0"
              >
                {query ? "No matches." : "No posts in this filter."}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete "${confirmDelete.title || "Untitled"}"?`}
          message={
            <>
              The post and all of its versions will be permanently deleted.
            </>
          }
          confirmLabel="Delete post"
          destructive
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => void deletePost(confirmDelete.id)}
        />
      )}
    </div>
  );
}

/**
 * Combined hits + reading-time cell. "544 · 9h" when analytics are live
 * (currently: sim mode), an em-dash when not.
 */
function HitsCell({ slug }: { slug: string }) {
  const stats = usePostHitsTime(slug);
  if (!stats || stats.hits === 0) {
    return <span className="text-quaternary">—</span>;
  }
  return <span>{formatHitsAndDuration(stats.hits, stats.seconds)}</span>;
}

function PostRowActions({
  post,
  onDelete,
}: {
  post: Post;
  onDelete: () => void;
}) {
  return (
    <ActionMenu
      trigger={<DotsHorizontal className="size-4" data-icon />}
      items={[
        {
          id: "duplicate",
          label: "Duplicate",
          icon: <Copy04 className="size-4" />,
          onAction: () => void duplicatePost(post),
        },
        {
          id: "delete",
          label: "Delete",
          icon: <Trash01 className="size-4" />,
          destructive: true,
          onAction: onDelete,
        },
      ]}
    />
  );
}

function SortableTh({
  children,
  className,
  active,
  dir,
  onClick,
  grip,
}: {
  children: React.ReactNode;
  className?: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  grip?: React.ReactNode;
}) {
  return (
    <th
      className={[
        "relative border-b border-secondary bg-secondary px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-quaternary",
        className ?? "",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center justify-between gap-1 uppercase tracking-wide transition hover:text-secondary"
      >
        <span className="truncate">{children}</span>
        <span className="inline-flex w-3 shrink-0 items-center justify-center">
          {active && (dir === "desc" ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
        </span>
      </button>
      {grip}
    </th>
  );
}

function Th({ children, className, grip }: { children?: React.ReactNode; className?: string; grip?: React.ReactNode }) {
  return (
    <th
      className={[
        "relative border-b border-secondary bg-secondary px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-quaternary",
        className ?? "",
      ].join(" ")}
    >
      <span className="block truncate">{children}</span>
      {grip}
    </th>
  );
}

/** A drag handle on a header's right edge: drag, or focus it and use the arrow keys (Shift = bigger steps); double-click resets. */
function ColumnGrip({
  label,
  min,
  onResize,
  onReset,
}: {
  label: string;
  min: number;
  onResize: (w: number) => void;
  onReset: () => void;
}) {
  const start = useRef<{ x: number; w: number } | null>(null);
  const widthOf = (el: HTMLElement) => el.closest("th")!.getBoundingClientRect().width;

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, w: widthOf(e.currentTarget) };
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }}
      onPointerMove={(e) => {
        if (start.current) onResize(start.current.w + (e.clientX - start.current.x));
      }}
      onPointerUp={(e) => {
        if (!start.current) return;
        start.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }}
      onPointerCancel={() => {
        start.current = null;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 64 : 16;
        const w = widthOf(e.currentTarget);
        if (e.key === "ArrowRight") onResize(w + step);
        else if (e.key === "ArrowLeft") onResize(Math.max(min, w - step));
        else return;
        e.preventDefault();
      }}
      onDoubleClick={onReset}
      className="group absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none outline-none"
    >
      <span className="absolute inset-y-1.5 left-1/2 w-px -translate-x-1/2 bg-transparent transition group-hover:w-0.5 group-hover:bg-brand-solid group-focus-visible:w-0.5 group-focus-visible:bg-brand-solid group-active:w-0.5 group-active:bg-brand-solid" />
    </div>
  );
}

function Td({
  children,
  className,
  ...rest
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={["border-t border-secondary px-4 py-2.5 align-middle", className ?? ""].join(" ")}
      {...rest}
    >
      {children}
    </td>
  );
}

function Toolbar({
  filter,
  onFilterChange,
  query,
  onQueryChange,
  counts,
  display,
}: {
  display?: React.ReactNode;
  filter: StatusFilter;
  onFilterChange: (s: StatusFilter) => void;
  query: string;
  onQueryChange: (s: string) => void;
  counts: { all: number; draft: number; done: number; published: number };
}) {
  return (
    <div className="z-30 flex flex-wrap items-center justify-between gap-3 rounded-t-xl md:sticky md:top-0 border-b border-secondary bg-primary px-4 py-3">
      <div className="flex items-center gap-1 rounded-lg border border-secondary bg-secondary p-0.5">
        <Chip active={filter === "all"} onClick={() => onFilterChange("all")}>
          All <Count n={counts.all} />
        </Chip>
        <Chip active={filter === "draft"} onClick={() => onFilterChange("draft")}>
          Drafts <Count n={counts.draft} />
        </Chip>
        <Chip active={filter === "done"} onClick={() => onFilterChange("done")}>
          Done <Count n={counts.done} />
        </Chip>
        <Chip active={filter === "published"} onClick={() => onFilterChange("published")}>
          Published <Count n={counts.published} />
        </Chip>
      </div>
      <div className="flex items-center gap-2">
      {display}
      <label className="flex items-center gap-2 rounded-lg bg-secondary px-2.5 py-1.5 text-sm shadow-xs ring-1 ring-inset ring-primary transition-shadow duration-100 ease-linear focus-within:ring-2 focus-within:ring-inset focus-within:ring-brand">
        <SearchLg className="size-3.5 shrink-0 text-quaternary" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search"
          className="w-full min-w-0 bg-transparent text-primary md:w-36 outline-none placeholder:text-quaternary"
        />
      </label>
      </div>
    </div>
  );
}

function DisplayMenu({ cols }: { cols: ReturnType<typeof usePostColumns> }) {
  return (
    <DialogTrigger>
      <AriaButton
        aria-label="Display options"
        className="flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-sm text-secondary shadow-xs ring-1 ring-inset ring-primary outline-none transition hover:bg-primary_hover data-[focus-visible]:ring-2 data-[focus-visible]:ring-brand data-[pressed]:bg-primary_hover"
      >
        <Sliders04 className="size-3.5 text-quaternary" />
        Display
      </AriaButton>
      <Popover
        placement="bottom end"
        className="z-50 w-56 rounded-xl border border-secondary bg-secondary p-3 shadow-2xl ring-1 ring-primary entering:animate-in entering:fade-in entering:zoom-in-95 entering:duration-100 exiting:animate-out exiting:fade-out exiting:zoom-out-95 exiting:duration-75"
      >
        <Dialog aria-label="Display options" className="flex flex-col gap-2.5 outline-none">
          <div className="text-xs text-tertiary">Columns</div>
          {POST_COLUMNS.map((c) => (
            <Checkbox
              key={c.id}
              label={c.label}
              isSelected={!cols.hidden.includes(c.id)}
              isDisabled={!cols.hidden.includes(c.id) && cols.visible.length === 1}
              onChange={(on) => cols.setShown(c.id, on)}
            />
          ))}
          <div className="my-0.5 border-t border-secondary" />
          <Checkbox label="Description under the title" isSelected={cols.description} onChange={cols.setDescription} />
          <button
            type="button"
            onClick={cols.reset}
            className="mt-0.5 self-start text-xs text-tertiary transition hover:text-secondary"
          >
            Reset columns
          </button>
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition",
        active
          ? "bg-primary text-primary shadow-xs ring-1 ring-secondary"
          : "text-secondary hover:text-primary",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function Count({ n }: { n: number }) {
  return <span className="font-mono text-xs text-quaternary">{n}</span>;
}

function StatusBadge({ status }: { status: "draft" | "done" | "published" }) {
  if (status === "published") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-utility-green-50 px-2 py-0.5 text-xs font-medium text-utility-green-700 ring-1 ring-utility-green-200 ring-inset">
        <span className="size-1.5 rounded-full bg-utility-green-500" />
        Published
      </span>
    );
  }
  if (status === "done") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-utility-blue-50 px-2 py-0.5 text-xs font-medium text-utility-blue-700 ring-1 ring-utility-blue-200 ring-inset">
        <span className="size-1.5 rounded-full bg-utility-blue-500" />
        Done
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-utility-neutral-50 px-2 py-0.5 text-xs font-medium text-utility-neutral-700 ring-1 ring-utility-neutral-200 ring-inset">
      <span className="size-1.5 rounded-full bg-utility-neutral-500" />
      Draft
    </span>
  );
}
