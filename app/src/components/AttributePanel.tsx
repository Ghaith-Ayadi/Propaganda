import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronDown, Copy04, Star01, Trash01 } from "@untitledui/icons";
import { db } from "@/lib/db";
import type { Collection, Post, PostVersion } from "@/types";
import { deletePost, duplicatePost, setPostStatus, toggleFavorite, updatePost } from "@/lib/posts";
import { collectionDisplay } from "@/lib/collections";
import { formatDate, relativeTime } from "@/lib/format";
import { go } from "@/lib/route";
import { DiffModal } from "@/components/DiffModal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ActionMenu } from "@/components/Menu";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { Button } from "@/components/base/buttons/button";

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
  const statusItems = [
    { id: "draft", label: "Draft" },
    { id: "published", label: "Published" },
  ];

  return (
    <aside className="flex h-full w-[300px] flex-col gap-5 overflow-y-auto border-l border-secondary bg-secondary px-5 py-6 text-sm">
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

      <FieldStack label="Status">
        <Select
          size="sm"
          selectedKey={post.status ?? "draft"}
          onSelectionChange={(k) => void setPostStatus(post.id, k as "draft" | "published")}
          items={statusItems}
        >
          {(item) => <Select.Item id={item.id} label={item.label} />}
        </Select>
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

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          color={post.favorited ? "primary" : "tertiary"}
          iconLeading={Star01}
          onClick={() => void toggleFavorite(post.id)}
        >
          {post.favorited ? "Favorited" : "Favorite"}
        </Button>
        <ActionMenu
          triggerClassName="inline-flex items-center gap-1.5 rounded-lg border border-secondary bg-primary px-3 py-1.5 text-sm font-semibold text-secondary outline-none transition hover:bg-primary_hover hover:text-primary data-[pressed]:bg-primary_hover"
          trigger={
            <>
              <span>Actions</span>
              <ChevronDown className="size-4" data-icon />
            </>
          }
          items={[
            {
              id: "duplicate",
              label: "Duplicate",
              icon: <Copy04 className="size-4" />,
              onAction: () => void onDuplicate(),
            },
            {
              id: "delete",
              label: "Delete",
              icon: <Trash01 className="size-4" />,
              destructive: true,
              onAction: () => setConfirmDelete(true),
            },
          ]}
        />
      </div>

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

