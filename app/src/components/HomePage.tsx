// Admin home dashboard: writing-activity heatmap (optional Verbose module) plus
// "Last added" and "Last edited" recent-post tables side by side.

import { lazy, Suspense, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { go } from "@/lib/route";
import { collectionDisplay } from "@/lib/collections";
import { WordCountDot } from "@/components/WordCountDot";
import type { Collection, Post } from "@/types";

// VERBOSE MODULE (optional, personal). Renders null when disabled. To remove
// the writing-activity row, delete this import and the mount block below.
const VerboseActivity = lazy(() =>
  import("@/features/verbose").then((m) => ({ default: m.VerboseActivity })),
);

const LIMIT = 10;

export function HomePage() {
  const posts = useLiveQuery(() => db.posts.toArray(), [], [] as Post[]);
  const collections = useLiveQuery(
    () => db.collections.orderBy("position").toArray(),
    [],
    [] as Collection[],
  );

  const lastAdded = useMemo(
    () => [...posts].sort((a, b) => b.createdAt - a.createdAt).slice(0, LIMIT),
    [posts],
  );
  const lastEdited = useMemo(
    () => [...posts].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, LIMIT),
    [posts],
  );

  return (
    <div className="mx-auto max-w-[1100px] px-10 pt-10 pb-16">
      {/* VERBOSE MODULE (optional, personal) */}
      <Suspense fallback={null}>
        <VerboseActivity />
      </Suspense>

      <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2">
        <RecentTable title="Last added" posts={lastAdded} collections={collections} />
        <RecentTable title="Last edited" posts={lastEdited} collections={collections} />
      </div>
    </div>
  );
}

function RecentTable({
  title,
  posts,
  collections,
}: {
  title: string;
  posts: Post[];
  collections: Collection[];
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-secondary bg-primary">
      <div className="border-b border-secondary px-4 py-3 text-sm font-medium text-secondary">
        {title}
      </div>
      <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <Th>Title</Th>
            <Th className="w-32">Collection</Th>
            <Th className="w-24">Words</Th>
          </tr>
        </thead>
        <tbody>
          {posts.map((p) => {
            const d = collectionDisplay(p.type, collections);
            return (
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
                <Td className="truncate text-primary">
                  {p.title || <span className="text-quaternary">Untitled</span>}
                </Td>
                <Td className="truncate text-xs text-tertiary">
                  <span className="inline-flex items-center gap-1.5">
                    {d.emoji && <span className="leading-none">{d.emoji}</span>}
                    <span className="truncate">{d.label || p.type}</span>
                  </span>
                </Td>
                <Td>
                  <WordCountDot words={p.wordCount} />
                </Td>
              </tr>
            );
          })}
          {posts.length === 0 && (
            <tr>
              <td colSpan={3} className="px-4 py-8 text-center text-sm text-tertiary">
                No posts yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      className={[
        "border-b border-secondary bg-secondary px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-quaternary",
        className ?? "",
      ].join(" ")}
    >
      {children}
    </th>
  );
}

function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <td className={["border-t border-secondary px-4 py-2.5 align-middle", className ?? ""].join(" ")}>
      {children}
    </td>
  );
}
