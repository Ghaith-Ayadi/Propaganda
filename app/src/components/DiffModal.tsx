import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { diffLines, type DiffOp } from "@/lib/diff";
import { revertToVersion } from "@/lib/versions";
import type { Post, PostVersion } from "@/types";

interface Props {
  post: Post;
  initialVersion: PostVersion;
  onClose: () => void;
}

export function DiffModal({ post, initialVersion, onClose }: Props) {
  const versions = useLiveQuery(
    () =>
      db.versions
        .where("postId")
        .equals(post.id)
        .reverse()
        .sortBy("version"),
    [post.id],
    [] as PostVersion[],
  );

  const [selectedId, setSelectedId] = useState(initialVersion.id);
  const selected = versions.find((v) => v.id === selectedId) ?? initialVersion;

  const ops = useMemo(
    () => diffLines(selected.content, post.content),
    [selected.content, post.content],
  );

  async function revert() {
    if (!confirm(`Revert "${post.title || "Untitled"}" to v${selected.version}? Current state will be saved as a new version first.`)) return;
    await revertToVersion(post.id, selected.version);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[80vh] w-[min(1100px,92vw)] flex-col overflow-hidden rounded-xl border border-border bg-bg-elev shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            <div className="text-sm text-fg-faint">Comparing</div>
            <div className="font-serif text-lg italic">{post.title || "Untitled"}</div>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="rounded border border-border bg-bg px-2 py-1 text-sm outline-none"
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.version} · {new Date(v.createdAt).toLocaleString()} · {v.createdBy}
                </option>
              ))}
            </select>
            <button
              onClick={revert}
              className="rounded-md border border-border px-3 py-1 text-sm hover:bg-bg-hover"
            >
              Revert to this
            </button>
            <button
              onClick={onClose}
              className="text-fg-muted hover:text-fg"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="grid flex-1 grid-cols-2 overflow-y-auto font-mono text-[13px] leading-relaxed">
          <div className="border-r border-border">
            <div className="sticky top-0 z-10 border-b border-border bg-bg-elev px-4 py-1.5 text-[11px] uppercase tracking-wide text-fg-faint">
              v{selected.version} ({new Date(selected.createdAt).toLocaleDateString()})
            </div>
            <DiffSide ops={ops} side="left" />
          </div>
          <div>
            <div className="sticky top-0 z-10 border-b border-border bg-bg-elev px-4 py-1.5 text-[11px] uppercase tracking-wide text-fg-faint">
              Current
            </div>
            <DiffSide ops={ops} side="right" />
          </div>
        </div>
      </div>
    </div>
  );
}

function DiffSide({ ops, side }: { ops: DiffOp[]; side: "left" | "right" }) {
  return (
    <div className="px-4 py-2">
      {ops.map((op, i) => {
        const isLeft = side === "left";
        // Show: left = same + removes; right = same + adds.
        if (op.kind === "same") return <Line key={i} text={op.line} />;
        if (isLeft && op.kind === "remove")
          return <Line key={i} text={op.line} tone="remove" />;
        if (!isLeft && op.kind === "add")
          return <Line key={i} text={op.line} tone="add" />;
        // Spacer to keep sides aligned.
        return <Line key={i} text=" " tone="ghost" />;
      })}
    </div>
  );
}

function Line({ text, tone }: { text: string; tone?: "add" | "remove" | "ghost" }) {
  const bg =
    tone === "add" ? "bg-emerald-500/10"
    : tone === "remove" ? "bg-rose-500/10"
    : tone === "ghost" ? "opacity-30"
    : "";
  return (
    <div className={`min-h-[1.4em] whitespace-pre-wrap px-1 ${bg}`}>
      {text || " "}
    </div>
  );
}
