// #/content/<channel>[/<sub-channel>]. A full-width header (Content, with a
// tab per channel), then the channel's drawer beside its body. Blog's body is
// the collection view (the 0.1 post table); the other channels come after 0.2.

import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { cx } from "@/utils/cx";
import type { Collection } from "@/types";
import { useActiveCollection, setActiveCollection } from "@/lib/activeCollection";
import { CollectionTabs } from "@/components/CollectionTabs";
import { PageHeader, PageTabs, PageBody } from "@/components/shell/PageHeader";
import { goPage, usePageRest } from "@/lib/route";
import { CHANNELS, contentRest, parseContentRest, type ChannelId } from "./contentTree";
import { ContentDrawer } from "./ContentDrawer";

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
        contained={false}
        tabs={
          <PageTabs
            label="Channels"
            items={CHANNELS.map((c) => ({ id: c.id, label: c.label }))}
            selected={channel}
            onChange={(id) => goPage("content", contentRest(id as ChannelId))}
          />
        }
      />
      <div className="flex min-h-0 flex-1">
        <ContentDrawer channel={channel} activeCollection={channel === "blog" ? sub ?? active : null} currentPostId={null} />
        <div className="min-w-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
          {/* The drawer is a column on desktop; a phone picks the collection here. */}
          {channel === "blog" && <PhoneCollections active={sub ?? active} />}
          {current.live ? (
            <CollectionTabs />
          ) : (
            <PageBody>
              <p className="text-sm text-tertiary">{current.label} comes after Propaganda 0.2.</p>
            </PageBody>
          )}
        </div>
      </div>
    </div>
  );
}

function PhoneCollections({ active }: { active: string | null }) {
  const collections = useLiveQuery(() => db.collections.orderBy("position").toArray(), [], [] as Collection[]);
  if (collections.length < 2) return null;
  return (
    <nav aria-label="Collections" className="flex gap-1 overflow-x-auto border-b border-secondary px-4 py-2 [scrollbar-width:none] md:hidden">
      {collections.map((c) => (
        <a
          key={c.name}
          href={`#/content/${contentRest("blog", c.name)}`}
          aria-current={c.name === active ? "page" : undefined}
          className={cx(
            "shrink-0 rounded-lg px-3 py-1.5 text-sm whitespace-nowrap",
            c.name === active ? "bg-primary text-primary shadow-xs ring-1 ring-secondary ring-inset" : "text-secondary",
          )}
        >
          {c.emoji ? `${c.emoji} ` : ""}
          {c.name}
        </a>
      ))}
    </nav>
  );
}
