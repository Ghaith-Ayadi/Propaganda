// Ranked list of top posts by views in the selected range.
// Each row: emoji, title, view count, mini 14-day sparkline.

import { go } from "@/lib/route";
import { useTopPosts } from "@/lib/analytics/hook";
import type { DateRangePreset } from "@/lib/analytics/types";
import { db } from "@/lib/db";
import { useLiveQuery } from "dexie-react-hooks";
import { Sparkline } from "./Sparkline";

interface Props { range: DateRangePreset; limit?: number }

function fmt(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

export function TopPostsPanel({ range, limit = 10 }: Props) {
  const rows = useTopPosts(range, limit);
  // Look up post IDs so click → navigates to the post.
  const posts = useLiveQuery(() => db.posts.toArray(), [], []);
  const slugToId = new Map(posts.map((p) => [p.slug, p.id]));

  return (
    <section className="rounded-xl border border-secondary bg-primary p-5">
      <h3 className="mb-3 text-[11px] font-medium uppercase tracking-wide text-quaternary">
        Top posts
      </h3>
      {rows == null ? (
        <div className="text-sm text-tertiary">
          No data yet. Try the command palette: <code>/simulateTraffic</code>.
        </div>
      ) : (
        <ol className="space-y-0.5">
          {rows.map((r, i) => {
            const id = slugToId.get(r.postSlug);
            return (
              <li key={r.postSlug}>
                <button
                  type="button"
                  onClick={() => id && go({ view: "post", id })}
                  disabled={!id}
                  className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm text-secondary transition hover:bg-secondary disabled:cursor-default"
                >
                  <span className="w-5 shrink-0 text-right font-mono text-[11px] text-quaternary">
                    {i + 1}.
                  </span>
                  <span className="w-4 shrink-0 text-center text-base leading-none">
                    {r.emoji ?? ""}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-primary">{r.title}</span>
                  <span className="shrink-0 text-utility-blue-500">
                    <Sparkline data={r.series} width={70} height={18} />
                  </span>
                  <span className="w-12 shrink-0 text-right font-mono text-xs text-secondary">
                    {fmt(r.views)}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
