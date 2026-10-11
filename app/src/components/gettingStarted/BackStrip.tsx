// Above a draft opened from Getting started: back to the guide, and, for a
// first-day draft, "Approve and publish now". The Review tab beside the text
// still holds the notes and checks; this is only the decision.

import { useState } from "react";
import { ArrowLeft, Rocket02 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { toast } from "@/components/base/toast/toast";
import { publishNow, usePipelineItemForPost } from "@/lib/pipeline/store";
import { goPage } from "@/lib/route";
import { setSetting, useSetting } from "@/lib/settings";
import { coded, userMessage } from "@/lib/errors";
import { reportError, track } from "@/lib/telemetry";
import { forgetStart, JUST_PUBLISHED_KEY, openedFromStart } from "./backLink";

export function BackStrip({ postId }: { postId: string }) {
  const item = usePipelineItemForPost(postId);
  const first = !useSetting<string>("onboarding.firstArticle", "");
  const [busy, setBusy] = useState(false);
  if (!openedFromStart(postId)) return null;

  const back = () => {
    forgetStart();
    goPage("getting-started");
  };

  const publish = async () => {
    if (!item) return;
    setBusy(true);
    try {
      await publishNow(item.id);
      if (first) await setSetting("onboarding.firstArticle", postId);
      try {
        sessionStorage.setItem(JUST_PUBLISHED_KEY, postId);
      } catch {
        // No confetti: the page still says it's live.
      }
      track("getting_started_published", { first });
      back();
    } catch (err) {
      const e = coded("START-PUBLISH", err, "Couldn't publish it. Try again.");
      reportError("Getting started: not published", e);
      toast.add({ type: "error", title: "Couldn't publish it", description: userMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const canPublish = item && item.stage !== "published" && item.stage !== "rejected";
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-secondary bg-secondary px-4 py-2.5 md:px-6">
      <button type="button" onClick={back} className="flex items-center gap-1.5 text-sm text-secondary hover:text-primary">
        <ArrowLeft className="size-4" /> Back to Getting started
      </button>
      {canPublish && (
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-tertiary max-sm:hidden">Read it as a reader would. The Review tab has the checks.</span>
          <Button size="sm" iconLeading={Rocket02} isLoading={busy} onClick={() => void publish()}>
            Approve and publish now
          </Button>
        </div>
      )}
    </div>
  );
}
