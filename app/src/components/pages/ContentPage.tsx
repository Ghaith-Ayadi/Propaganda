// #/content/<channel>[/<sub-channel>]. Blog renders the collection view (the
// 0.1 post table); the other channels come after 0.2.

import { useEffect } from "react";
import { CollectionTabs } from "@/components/CollectionTabs";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { setActiveCollection } from "@/lib/activeCollection";
import { goPage, usePageRest } from "@/lib/route";
import { cx } from "@/utils/cx";
import { CHANNELS, contentRest, parseContentRest } from "./contentTree";

export function ContentPage() {
  const { channel, sub } = parseContentRest(usePageRest());

  // The URL names the collection; the rest of the app reads the active one.
  useEffect(() => {
    if (channel === "blog" && sub) setActiveCollection(sub);
  }, [channel, sub]);

  const current = CHANNELS.find((c) => c.id === channel)!;

  return (
    <>
      <div className="mx-auto w-full max-w-[900px] px-4 pt-6 md:px-10 md:pt-10">
        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Channels">
          {CHANNELS.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={c.id === channel}
              onClick={() => goPage("content", contentRest(c.id))}
              className={cx(
                "shrink-0 rounded-full px-3 py-1 text-sm ring-1 ring-inset transition",
                c.id === channel
                  ? "bg-(--color-fg-primary) text-(--color-bg-primary) ring-transparent"
                  : "text-secondary ring-primary hover:bg-primary_hover",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      {current.live ? (
        <CollectionTabs />
      ) : (
        <PageBody>
          <PageHeader title={current.label} description="Comes after Propaganda 0.2." />
        </PageBody>
      )}
    </>
  );
}
