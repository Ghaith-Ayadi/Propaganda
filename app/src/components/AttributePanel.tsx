import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Copy04, Link01, LinkExternal01, Plus, Star01, Trash01 } from "@untitledui/icons";
import { db } from "@/lib/db";
import type { Collection, Post, PostStatus, PostVersion } from "@/types";
import { deletePost, duplicatePost, setPostStatus, toggleFavorite, updatePost } from "@/lib/posts";
import { collectionDisplay } from "@/lib/collections";
import { formatExactDate, relativeTime } from "@/lib/format";
// Future: make the relative-vs-exact priority configurable per user. See
// the Propaganda Notion backlog task "Configurable post-date display."
import { go } from "@/lib/route";
import { createBrief, linkBriefToPost } from "@/lib/plan/briefs";
import type { Brief } from "@/lib/plan/types";
import { statusMeta } from "@/lib/plan/types";
import { StatusBadge } from "@/components/plan/bits";
import { LinkPickerDialog, type PickItem } from "@/components/plan/LinkPickerDialog";
import { DiffModal } from "@/components/DiffModal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SharePanel } from "@/components/SharePanel";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { ButtonUtility } from "@/components/base/buttons/button-utility";
import { Button } from "@/components/base/buttons/button";
import { ButtonGroup, ButtonGroupItem } from "@/components/base/button-group/button-group";
import { Tabs } from "@/components/application/tabs/tabs";

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
  const [slugWarnDismissed, setSlugWarnDismissed] = useState(false);
  const [slugEdited, setSlugEdited] = useState(false);
  const [tab, setTab] = useState<"details" | "brief" | "analytics">("details");

  const publicUrl = `${window.location.origin}/p/${post.slug}`;

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
        <div className="ml-auto">
          <ButtonUtility
            size="sm"
            color="tertiary"
            tooltip="Preview"
            icon={LinkExternal01}
            onClick={() => window.open(publicUrl, "_blank")}
          />
        </div>
      </div>

      <Tabs selectedKey={tab} onSelectionChange={(k) => setTab(k as TabKey)} className="gap-5">
        <Tabs.List type="underline" size="sm">
          <Tabs.Item id="details">Details</Tabs.Item>
          <Tabs.Item id="brief">Brief</Tabs.Item>
          <Tabs.Item id="analytics">Analytics</Tabs.Item>
        </Tabs.List>

        <Tabs.Panel id="brief">
          <BriefTab post={post} />
        </Tabs.Panel>
        <Tabs.Panel id="analytics">
          <AnalyticsTab />
        </Tabs.Panel>

        <Tabs.Panel id="details" className="flex flex-col gap-5">
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
          onChange={(v) => {
            setSlugEdited(true);
            void updatePost(post.id, { slug: v });
          }}
        />
        <p className="mt-1.5 select-all truncate text-[11px] text-quaternary">{publicUrl}</p>
        {post.status === "published" && slugEdited && !slugWarnDismissed && (
          <div className="mt-2 flex items-start justify-between gap-1.5 rounded-md bg-utility-yellow-100 px-2.5 py-1.5 text-[11px] text-utility-yellow-700">
            <span>Changing the slug will break any existing public links to this post.</span>
            <button
              onClick={() => setSlugWarnDismissed(true)}
              className="mt-0.5 shrink-0 opacity-60 hover:opacity-100"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        )}
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

      <FieldStack label="Category">
        <Input
          size="sm"
          value={post.category ?? ""}
          onChange={(v) => void updatePost(post.id, { category: v })}
        />
      </FieldStack>

      <SharePanel post={post} />

      <div className="mt-2 border-t border-secondary pt-4">
        <div className="mb-2 text-sm font-semibold text-secondary">History</div>
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

      <div className="mt-2 border-t border-secondary pt-4">
        <div className="mb-2 text-sm font-semibold text-secondary">Info</div>
        <dl className="space-y-1.5 text-xs">
          <div className="flex items-baseline justify-between gap-2">
            <dt className="shrink-0 text-quaternary">Post ID</dt>
            <dd className="select-all truncate font-mono text-secondary">{post.postId ?? post.slug}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt className="shrink-0 text-quaternary">Published</dt>
            <dd className="cursor-default text-secondary" title={formatExactDate(post.publishedAt)}>
              {post.publishedAt == null ? "—" : relativeTime(post.publishedAt)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt className="shrink-0 text-quaternary">Done</dt>
            <dd className="cursor-default text-secondary" title={formatExactDate(post.doneAt)}>
              {post.doneAt == null ? "—" : relativeTime(post.doneAt)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt className="shrink-0 text-quaternary">Last edited</dt>
            <dd className="cursor-default text-secondary" title={formatExactDate(post.updatedAt)}>
              {relativeTime(post.updatedAt)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt className="shrink-0 text-quaternary">Created</dt>
            <dd className="cursor-default text-secondary" title={formatExactDate(post.createdAt)}>
              {relativeTime(post.createdAt)}
            </dd>
          </div>
        </dl>
      </div>
        </Tabs.Panel>
      </Tabs>

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
  const options: { id: PostStatus; label: string; dot: string }[] = [
    { id: "draft",     label: "Draft",     dot: "bg-fg-quaternary" },
    { id: "done",      label: "Done",      dot: "bg-utility-blue-500" },
    { id: "published", label: "Published", dot: "bg-utility-green-500" },
  ];
  return (
    <ButtonGroup
      size="sm"
      selectedKeys={[value]}
      disallowEmptySelection
      onSelectionChange={(keys) => {
        const next = [...keys][0];
        if (next) onChange(next as PostStatus);
      }}
      className="w-full"
    >
      {options.map((o) => (
        <ButtonGroupItem
          key={o.id}
          id={o.id}
          className="flex-1 justify-center"
          iconLeading={<span className={`size-1.5 shrink-0 rounded-full ${o.dot}`} />}
        >
          {o.label}
        </ButtonGroupItem>
      ))}
    </ButtonGroup>
  );
}

function FieldStack({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-sm font-medium text-secondary">{label}</div>
      {children}
    </div>
  );
}

type TabKey = "details" | "brief" | "analytics";

function BriefTab({ post }: { post: Post }) {
  const [picking, setPicking] = useState(false);
  const linkedBrief = useLiveQuery(
    () => db.briefs.where("postId").equals(post.id).first(),
    [post.id],
  );
  const allBriefs = useLiveQuery(() => db.briefs.toArray(), [], [] as Brief[]);

  const createLinkedBrief = async () => {
    const b = await createBrief({ postId: post.id, collectionName: post.type, title: post.title });
    go({ view: "brief", id: b.id });
  };

  const pickItems: PickItem[] = allBriefs
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((b) => ({ id: b.id, label: b.title || "Untitled brief", sublabel: statusMeta(b.status).label }));

  if (linkedBrief) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-secondary p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-sm text-primary">
            {linkedBrief.title || "Untitled brief"}
          </span>
          <StatusBadge status={linkedBrief.status} />
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            color="secondary"
            iconLeading={LinkExternal01}
            onClick={() => go({ view: "brief", id: linkedBrief.id })}
          >
            Open brief
          </Button>
          <Button
            size="sm"
            color="tertiary"
            onClick={() => void linkBriefToPost(linkedBrief.id, null)}
          >
            Detach
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-secondary p-4">
      <p className="text-sm text-secondary">No brief attached to this post.</p>
      <p className="text-xs text-quaternary">
        A brief is the task to write this post: assignee, schedule, tags and checks. It lives
        separately and links here.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          color="secondary"
          iconLeading={Plus}
          onClick={() => void createLinkedBrief()}
        >
          Create brief
        </Button>
        <Button
          size="sm"
          color="secondary"
          iconLeading={Link01}
          onClick={() => setPicking(true)}
        >
          Attach existing
        </Button>
      </div>
      {picking && (
        <LinkPickerDialog
          title="Attach an existing brief"
          items={pickItems}
          emptyText="No briefs yet."
          onPick={(id) => void linkBriefToPost(String(id), post.id)}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

function AnalyticsTab() {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-secondary p-4">
      <p className="text-sm text-secondary">Per-post analytics</p>
      <p className="text-xs text-quaternary">
        Views, reading time and referrers for this post will appear here.
      </p>
    </div>
  );
}


