// #/content/<channel>[/<sub-channel>]. The header (Content, with a tab per
// channel) sits in the shared container; the body runs full width. Blog's body
// is a row of collections over the collection view (the 0.1 post table); the
// other channels come after 0.2.

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus } from "@untitledui/icons";
import { db } from "@/lib/db";
import { cx } from "@/utils/cx";
import type { Collection } from "@/types";
import { useActiveCollection, setActiveCollection } from "@/lib/activeCollection";
import { CollectionTabs } from "@/components/CollectionTabs";
import { PageHeader, PageTabs, PageBody } from "@/components/shell/PageHeader";
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
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        {channel === "blog" && <Collections active={sub ?? active} />}
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
  return (
    <nav aria-label="Collections" className="flex items-center gap-1 overflow-x-auto border-b border-secondary px-4 py-2 [scrollbar-width:none] md:px-8">
      {collections.map((c) => (
        <a
          key={c.name}
          href={`#/content/${contentRest("blog", c.name)}`}
          aria-current={c.name === active ? "page" : undefined}
          className={cx(
            "shrink-0 rounded-lg px-3 py-1.5 text-sm whitespace-nowrap transition",
            c.name === active ? "bg-primary text-primary shadow-xs ring-1 ring-secondary ring-inset" : "text-secondary hover:bg-primary_hover hover:text-primary",
          )}
        >
          {c.emoji ? `${c.emoji} ` : ""}
          {c.name}
        </a>
      ))}
      <button
        type="button"
        aria-label="New collection"
        title="New collection"
        onClick={() => setAdding(true)}
        className="shrink-0 rounded-lg p-2 text-quaternary transition hover:bg-primary_hover hover:text-secondary"
      >
        <Plus className="size-4" />
      </button>
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
    </nav>
  );
}
