// #/content/<channel>[/<sub-channel>]. Two plain tab rows, both in the shared
// container: the channels in the header, then (for Blog) the collections with
// a + for a new one. Below them, the collection view (the 0.1 post table); the
// other channels come after 0.2.

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus } from "@untitledui/icons";
import { db } from "@/lib/db";
import { cx } from "@/utils/cx";
import type { Collection } from "@/types";
import { useActiveCollection, setActiveCollection } from "@/lib/activeCollection";
import { CollectionTabs } from "@/components/CollectionTabs";
import { PageHeader, PageTabs, PageBody, CONTAINER } from "@/components/shell/PageHeader";
import { go, goPage, usePageRest } from "@/lib/route";
import { CHANNELS, contentRest, parseContentRest, type ChannelId } from "./contentTree";
import { NewCollectionDialog } from "@/components/NewCollectionDialog";
import { createCollection } from "@/lib/collections";
import { createPost } from "@/lib/posts";

export function ContentPage() {
  const { channel, sub } = parseContentRest(usePageRest());
  const [active] = useActiveCollection();

  // The URL names the collection; the rest of the app reads the active one.
  useEffect(() => {
    if (channel === "blog" && sub) setActiveCollection(sub);
  }, [channel, sub]);

  const current = CHANNELS.find((c) => c.id === channel)!;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Content"
        tabs={
          <PageTabs
            label="Channels"
            items={CHANNELS.map((c) => ({ id: c.id, label: c.label }))}
            selected={channel}
            onChange={(id) => goPage("content", contentRest(id as ChannelId))}
          />
        }
      />
      {channel === "blog" && <Collections active={sub ?? active} />}
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        {current.live ? (
          <CollectionTabs />
        ) : (
          <PageBody>
            <p className="text-sm text-tertiary">{current.label} comes after Propaganda 0.2.</p>
          </PageBody>
        )}
      </div>
    </div>
  );
}

function Collections({ active }: { active: string | null }) {
  const collections = useLiveQuery(() => db.collections.orderBy("position").toArray(), [], [] as Collection[]);
  const [adding, setAdding] = useState(false);
  const selected = active && collections.some((c) => c.name === active) ? active : (collections[0]?.name ?? "");
  return (
    <div className="border-b border-secondary">
      <div className={cx(CONTAINER, "flex items-end gap-1 pt-3")}>
        {collections.length > 0 && (
          <div className="-mb-px min-w-0">
            <PageTabs
              label="Collections"
              items={collections.map((c) => ({ id: c.name, label: c.emoji ? `${c.emoji} ${c.name}` : c.name }))}
              selected={selected}
              onChange={(name) => goPage("content", contentRest("blog", name))}
            />
          </div>
        )}
        <button
          type="button"
          aria-label="New collection"
          title="New collection"
          onClick={() => setAdding(true)}
          className="mb-1.5 shrink-0 rounded-md p-1.5 text-quaternary transition hover:bg-primary_hover hover:text-secondary"
        >
          <Plus className="size-4" />
        </button>
      </div>
      {adding && (
        <NewCollectionDialog
          onClose={() => setAdding(false)}
          onConfirm={async ({ name, emoji, withPost }) => {
            await createCollection(name, { emoji });
            goPage("content", contentRest("blog", name));
            if (withPost) {
              const post = await createPost(name);
              if (post) go({ view: "post", id: post.id });
            }
          }}
        />
      )}
    </div>
  );
}
