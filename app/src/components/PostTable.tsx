// Dashboard-02-style table for the posts in the active collection.
// - First body row is "+ New post" — replaces the floating add-post button
// - Status filter chips (All / Drafts / Published) above the table
// - Title filter input on the right

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Copy04, DotsHorizontal, Plus, SearchLg, Trash01 } from "@untitledui/icons";
import type { Post } from "@/types";
import { go } from "@/lib/route";
import { formatDate, formatWordCount } from "@/lib/format";
import { deletePost, duplicatePost } from "@/lib/posts";
import { ActionMenu } from "@/components/Menu";
import { ConfirmDialog } from "@/components/ConfirmDialog";

type StatusFilter = "all" | "draft" | "published";
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
      xs = xs.filter(
        (p) => p.title.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q),
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
    let published = 0;
    for (const p of posts) {
      if ((p.status ?? "draft") === "published") published++;
      else draft++;
    }
    return { all: posts.length, draft, published };
  }, [posts]);

  return (
    <div className="rounded-xl border border-secondary bg-primary">
      <Toolbar
        filter={filter}
        onFilterChange={setFilter}
        query={query}
        onQueryChange={setQuery}
        counts={counts}
      />
      <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
        <thead className="sticky top-[57px] z-20">
          <tr>
            <Th className="w-20">ID</Th>
            <Th>Title</Th>
            <Th className="w-28">Status</Th>
            <Th className="w-44">Length</Th>
            <SortableTh
              className="w-28"
              active={sortKey === "created"}
              dir={sortDir}
              onClick={() => toggleSort("created")}
            >
              Created
            </SortableTh>
            <SortableTh
              className="w-28"
              active={sortKey === "updated"}
              dir={sortDir}
              onClick={() => toggleSort("updated")}
            >
              Updated
            </SortableTh>
            <Th className="w-10" />
          </tr>
        </thead>
        <tbody>
          <tr
            tabIndex={0}
            onClick={onAddPost}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onAddPost();
              }
            }}
            className="group sticky top-[93px] z-10 cursor-pointer text-tertiary outline-none transition hover:text-primary"
          >
            <Td className="bg-primary group-hover:bg-secondary group-focus:bg-secondary">
              <Plus className="size-4" />
            </Td>
            <Td className="bg-primary text-sm group-hover:bg-secondary group-focus:bg-secondary">
              New post
            </Td>
            <Td className="bg-primary group-hover:bg-secondary group-focus:bg-secondary" />
            <Td className="bg-primary group-hover:bg-secondary group-focus:bg-secondary" />
            <Td className="bg-primary group-hover:bg-secondary group-focus:bg-secondary" />
            <Td className="bg-primary group-hover:bg-secondary group-focus:bg-secondary" />
            <Td className="bg-primary group-hover:bg-secondary group-focus:bg-secondary" />
          </tr>
          {filtered.map((p) => (
            <tr
              key={p.id}
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
              <Td className="date-pill text-xs text-quaternary">{p.slug || "—"}</Td>
              <Td className="truncate text-sm text-primary">
                {p.title || <span className="text-quaternary">Untitled</span>}
              </Td>
              <Td>
                <StatusBadge status={(p.status ?? "draft") as "draft" | "published"} />
              </Td>
              <Td className="whitespace-nowrap text-xs text-tertiary">
                {formatWordCount(p.wordCount)}
              </Td>
              <Td className="date-pill text-xs text-quaternary">
                {formatDate(p.createdAt)}
              </Td>
              <Td className="date-pill text-xs text-quaternary">
                {formatDate(p.updatedAt)}
              </Td>
              <Td
                className="text-right"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="inline-flex opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                  <PostRowActions post={p} onDelete={() => setConfirmDelete(p)} />
                </div>
              </Td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr>
              <td
                colSpan={7}
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
}: {
  children: React.ReactNode;
  className?: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  return (
    <th
      className={[
        "border-b border-secondary bg-secondary px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-quaternary",
        className ?? "",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center justify-between gap-1 uppercase tracking-wide transition hover:text-secondary"
      >
        <span>{children}</span>
        <span className="inline-flex w-3 shrink-0 items-center justify-center">
          {active && (dir === "desc" ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
        </span>
      </button>
    </th>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      className={[
        "border-b border-secondary bg-secondary px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-quaternary",
        className ?? "",
      ].join(" ")}
    >
      {children}
    </th>
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
}: {
  filter: StatusFilter;
  onFilterChange: (s: StatusFilter) => void;
  query: string;
  onQueryChange: (s: string) => void;
  counts: { all: number; draft: number; published: number };
}) {
  return (
    <div className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 rounded-t-xl border-b border-secondary bg-primary px-4 py-3">
      <div className="flex items-center gap-1 rounded-lg border border-secondary bg-secondary p-0.5">
        <Chip active={filter === "all"} onClick={() => onFilterChange("all")}>
          All <Count n={counts.all} />
        </Chip>
        <Chip active={filter === "draft"} onClick={() => onFilterChange("draft")}>
          Drafts <Count n={counts.draft} />
        </Chip>
        <Chip active={filter === "published"} onClick={() => onFilterChange("published")}>
          Published <Count n={counts.published} />
        </Chip>
      </div>
      <label className="flex items-center gap-2 rounded-lg border border-secondary bg-secondary px-2.5 py-1.5 text-sm focus-within:border-tertiary">
        <SearchLg className="size-3.5 shrink-0 text-quaternary" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search"
          className="w-36 bg-transparent text-primary outline-none placeholder:text-quaternary"
        />
      </label>
    </div>
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

function StatusBadge({ status }: { status: "draft" | "published" }) {
  if (status === "published") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-utility-green-50 px-2 py-0.5 text-xs font-medium text-utility-green-700 ring-1 ring-utility-green-200 ring-inset">
        <span className="size-1.5 rounded-full bg-utility-green-500" />
        Published
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
