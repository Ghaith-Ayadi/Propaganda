import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Copy04, Star01, Trash01 } from "@untitledui/icons";
import { db } from "@/lib/db";
import type { Collection, Post, PostStatus, PostVersion } from "@/types";
import { deletePost, duplicatePost, setPostStatus, toggleFavorite, updatePost } from "@/lib/posts";
import { collectionDisplay } from "@/lib/collections";
import { formatDate, relativeTime } from "@/lib/format";
import { go } from "@/lib/route";
import { DiffModal } from "@/components/DiffModal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { ButtonUtility } from "@/components/base/buttons/button-utility";

interface Props {
  post: Post;
}

export function AttributePanel({ post }: Props) {
  const collectionRows = useLiveQuery(
    () => db.collections.orderBy("position").toArray(),
    [],
    [] as Collection[],
  );
  const versions = useLiveQuery(
    () => db.versions.where("postId").equals(post.id).reverse().sortBy("version"),
    [post.id],
    [] as PostVersion[],
  );

  const [diffFor, setDiffFor] = useState<PostVersion | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function onDuplicate() {
    const dup = await duplicatePost(post);
    if (dup) go({ view: "post", id: dup.id });
  }

  async function onDelete() {
    await deletePost(post.id);
    go({ view: "list" });
  }

  const collectionItems = useMemo(
    () =>
      collectionRows.map((c) => {
        const d = collectionDisplay(c.name, collectionRows);
        return {
          id: c.name,
          label: d.emoji ? `${d.emoji}  ${d.label || c.name}` : c.name,
        };
      }),
    [collectionRows],
  );
  const status: PostStatus = post.status ?? "draft";

  return (
    <aside className="flex h-full w-[300px] flex-col gap-5 overflow-y-auto border-l border-secondary bg-secondary px-5 py-6 text-sm">
      <div className="flex items-center gap-1">
        <ButtonUtility
          size="sm"
          color="tertiary"
          tooltip={post.favorited ? "Remove from favorites" : "Add to favorites"}
          icon={(props) => (
            <Star01
              {...props}
              fill={post.favorited ? "currentColor" : "none"}
              className={[props?.className ?? "", post.favorited ? "text-warning-primary" : ""].join(" ")}
            />
          )}
          onClick={() => void toggleFavorite(post.id)}
        />
        <ButtonUtility
          size="sm"
          color="tertiary"
          tooltip="Duplicate"
          icon={Copy04}
          onClick={() => void onDuplicate()}
        />
        <ButtonUtility
          size="sm"
          color="tertiary"
          tooltip="Delete"
          icon={Trash01}
          onClick={() => setConfirmDelete(true)}
        />
      </div>

      <FieldStack label="Status">
        <StatusGroup
          value={status}
          onChange={(s) => void setPostStatus(post.id, s)}
        />
      </FieldStack>

      <FieldStack label="Slug">
        <Input
          size="sm"
          value={post.slug}
          onChange={(v) => void updatePost(post.id, { slug: v })}
        />
      </FieldStack>

      <FieldStack label="Collection">
        <Select
          size="sm"
          selectedKey={post.type ?? null}
          onSelectionChange={(k) => void updatePost(post.id, { type: String(k ?? "") })}
          items={collectionItems}
          placeholder="—"
        >
          {(item) => <Select.Item id={item.id} label={item.label} />}
        </Select>
        <p className="mt-1.5 text-[11px] text-quaternary">
          Edit the collection's name, emoji and description from the home tab.
        </p>
      </FieldStack>

      <FieldStack label="Published">
        <div className="date-pill text-secondary">{formatDate(post.publishedAt)}</div>
      </FieldStack>

      <FieldStack label="Category">
        <Input
          size="sm"
          value={post.category ?? ""}
          onChange={(v) => void updatePost(post.id, { category: v })}
        />
      </FieldStack>

      <div className="mt-2 border-t border-secondary pt-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-quaternary">
          History
        </div>
        {versions.length === 0 ? (
          <div className="text-xs text-tertiary">No versions yet.</div>
        ) : (
          <ul className="space-y-1 text-xs">
            {versions.map((v) => (
              <li key={v.id}>
                <button
                  onClick={() => setDiffFor(v)}
                  className="flex w-full justify-between text-left text-secondary transition hover:text-primary"
                >
                  <span>
                    v{v.version}
                    {v.createdBy !== "user" && (
                      <span className="ml-1 text-quaternary">· {v.createdBy}</span>
                    )}
                  </span>
                  <span className="date-pill text-quaternary">{relativeTime(v.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {diffFor && (
        <DiffModal post={post} initialVersion={diffFor} onClose={() => setDiffFor(null)} />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={`Delete "${post.title || "Untitled"}"?`}
          message="The post and all of its versions will be permanently deleted."
          confirmLabel="Delete post"
          destructive
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => void onDelete()}
        />
      )}
    </aside>
  );
}

function StatusGroup({
  value,
  onChange,
}: {
  value: PostStatus;
  onChange: (s: PostStatus) => void;
}) {
  const options: { id: PostStatus; label: string }[] = [
    { id: "draft", label: "Draft" },
    { id: "published", label: "Published" },
  ];
  return (
    <div className="flex items-center gap-1 rounded-lg border border-secondary bg-secondary p-0.5">
      {options.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className={[
              "flex-1 rounded-md px-2.5 py-1 text-sm transition",
              active
                ? "bg-primary text-primary shadow-xs ring-1 ring-secondary"
                : "text-secondary hover:text-primary",
            ].join(" ")}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function FieldStack({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-quaternary">
        {label}
      </div>
      {children}
    </div>
  );
}

