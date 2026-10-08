// Re-checks: when a claim is replaced or retracted, every post relying on it
// gets a re-check, grouped in one thread per change (the decision). The thread
// shows the change, then a TL;DR per post with the suggested action and fix,
// and bulk actions over the selection.

import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { ButtonGroup, ButtonGroupItem } from "@/components/base/button-group/button-group";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { toast } from "@/components/base/toast/toast";
import { coded, userMessage } from "@/lib/errors";
import { reportError, track } from "@/lib/telemetry";
import { goPage, pageHref, postHref } from "@/lib/route";
import { kb } from "@/lib/knowledge/adapter";
import { changed, useKb } from "@/lib/knowledge/hooks";
import type { BulkAction, RecheckItem, RecheckThread, RecheckThreadSummary } from "@/lib/knowledge/types";
import { cx } from "@/utils/cx";
import { ActionBadge, DecisionCard, Empty, FixDiff, FlagStatusBadge, Loading, Panel, QuoteInContext, SeverityBadge, formatDate } from "./bits";

const OPEN = new Set(["open", "snoozed"]);

export function RechecksView({ selected }: { selected: string | null }) {
  const threads = useKb("kb.rechecks", () => kb().rechecks(), []);
  const list = threads.data ?? [];
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]">
      <div className={cx("flex min-w-0 flex-col gap-3", selected && "max-lg:hidden")}>
        {threads.loading && !threads.data ? (
          <Loading />
        ) : list.length === 0 ? (
          <Empty title="No re-checks">When a claim changes, the posts relying on it are re-read and land here as one thread.</Empty>
        ) : (
          <ul className="divide-y divide-secondary overflow-hidden rounded-xl bg-primary shadow-xs ring-1 ring-secondary">
            {list.map((t) => (
              <ThreadRow key={t.id} thread={t} active={t.id === selected} />
            ))}
          </ul>
        )}
      </div>
      <div className={cx("min-w-0", !selected && "max-lg:hidden")}>
        {selected ? (
          <>
            <Button size="sm" color="link-gray" iconLeading={ArrowLeft} onClick={() => goPage("knowledge", "rechecks")} className="mb-3 lg:hidden">
              All re-checks
            </Button>
            <RecheckThreadView key={selected} id={selected} />
          </>
        ) : (
          <Empty title="Pick a change">One thread per changed claim, with a short summary for every post and actions for all of them at once.</Empty>
        )}
      </div>
    </div>
  );
}

function ThreadRow({ thread, active }: { thread: RecheckThreadSummary; active: boolean }) {
  return (
    <li>
      <a
        href={pageHref("knowledge", `rechecks/${thread.id}`)}
        className={cx("flex flex-col gap-1.5 px-4 py-3 transition hover:bg-primary_hover", active && "bg-secondary")}
        aria-current={active ? "true" : undefined}
      >
        <span className="text-sm font-medium text-primary">{thread.title}</span>
        <span className="flex flex-wrap items-center gap-2 text-xs text-quaternary">
          <SeverityBadge severity={thread.severity} />
          {thread.open ? `${thread.open} of ${thread.total} posts need you` : `All ${thread.total} posts done`}
          <span>· {formatDate(thread.created)}</span>
        </span>
      </a>
    </li>
  );
}

export function RecheckThreadView({ id }: { id: string }) {
  const thread = useKb("kb.recheck", () => kb().recheck(id), [id]);
  if (thread.loading && !thread.data) return <Loading />;
  if (!thread.data) return <Empty title="This thread isn't here" />;
  return <ThreadBody thread={thread.data} />;
}

const BULK_LABEL: Record<BulkAction, string> = {
  apply_fix: "Apply the suggested updates",
  wont_fix: "Won't fix",
  snooze: "Snooze a week",
  retracted: "We took them down",
};

function ThreadBody({ thread }: { thread: RecheckThread }) {
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<BulkAction | null>(null);
  const items = useMemo(() => (filter === "open" ? thread.items.filter((i) => OPEN.has(i.status)) : thread.items), [thread.items, filter]);
  const openItems = thread.items.filter((i) => OPEN.has(i.status));
  const selection = [...picked].filter((id) => openItems.some((i) => i.flagId === id));
  const allPicked = openItems.length > 0 && selection.length === openItems.length;
  const fixable = selection.filter((id) => thread.items.find((i) => i.flagId === id)?.fix);

  const run = async (action: BulkAction) => {
    const ids = action === "apply_fix" ? fixable : selection;
    if (!ids.length) return;
    setBusy(action);
    try {
      await kb().bulk(ids, action);
      track("kb_recheck_bulk", { action, count: ids.length });
      toast.add({ type: "success", title: `${BULK_LABEL[action]}: ${ids.length} ${ids.length === 1 ? "post" : "posts"}` });
      setPicked(new Set());
      changed();
    } catch (err) {
      const e = coded("KB-BULK", err);
      reportError("kb.bulk", e);
      toast.add({ type: "error", title: "Couldn't do that", description: userMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <Panel title="What changed" actions={<SeverityBadge severity={thread.severity} />}>
        <div className="flex flex-col gap-2 md:flex-row md:items-stretch">
          <a href={pageHref("knowledge", `claims/${thread.oldClaim.id}`)} className="flex-1 rounded-lg bg-secondary px-4 py-3 text-sm text-tertiary line-through decoration-1">
            {thread.oldClaim.text}
          </a>
          <ArrowRight className="size-4 shrink-0 self-center text-quaternary max-md:rotate-90" />
          {thread.newClaim ? (
            <a href={pageHref("knowledge", `claims/${thread.newClaim.id}`)} className="flex-1 rounded-lg px-4 py-3 text-sm text-primary ring-1 ring-secondary hover:bg-primary_hover">
              {thread.newClaim.text}
            </a>
          ) : (
            <span className="flex-1 rounded-lg px-4 py-3 text-sm text-tertiary ring-1 ring-secondary">Retracted, with nothing in its place.</span>
          )}
        </div>
        <div className="mt-4">
          <DecisionCard decision={thread.decision} title="The ruling" />
        </div>
        {thread.owner && <p className="mt-3 text-sm text-tertiary">Assigned to {thread.owner.name}, as the topic's owner.</p>}
      </Panel>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ButtonGroup
          size="sm"
          selectedKeys={[filter]}
          disallowEmptySelection
          onSelectionChange={(keys) => {
            const next = [...keys][0];
            if (next) setFilter(next as "open" | "all");
          }}
        >
          <ButtonGroupItem id="open">Needs you ({openItems.length})</ButtonGroupItem>
          <ButtonGroupItem id="all">All posts ({thread.items.length})</ButtonGroupItem>
        </ButtonGroup>
        {openItems.length > 0 && (
          <Checkbox
            label="Select all that need you"
            isSelected={allPicked}
            isIndeterminate={selection.length > 0 && !allPicked}
            onChange={(on) => setPicked(on ? new Set(openItems.map((i) => i.flagId)) : new Set())}
          />
        )}
      </div>

      {selection.length > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-xl bg-primary px-4 py-3 shadow-lg ring-1 ring-secondary">
          <span className="mr-auto text-sm font-medium text-primary">
            {selection.length} selected
          </span>
          {kb().sample && (
            <Button size="sm" color="primary" isDisabled={!fixable.length} isLoading={busy === "apply_fix"} onClick={() => void run("apply_fix")}>
              {fixable.length === selection.length ? BULK_LABEL.apply_fix : `Apply updates (${fixable.length})`}
            </Button>
          )}
          <Button size="sm" color="secondary" isLoading={busy === "wont_fix"} onClick={() => void run("wont_fix")}>
            {BULK_LABEL.wont_fix}
          </Button>
          <Button size="sm" color="secondary" isLoading={busy === "snooze"} onClick={() => void run("snooze")}>
            {BULK_LABEL.snooze}
          </Button>
          <Button size="sm" color="secondary" isLoading={busy === "retracted"} onClick={() => void run("retracted")}>
            {BULK_LABEL.retracted}
          </Button>
        </div>
      )}

      {items.length === 0 ? (
        <Empty title="Nothing left here">Every post in this thread is fixed, closed, or still holds.</Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <RecheckRow
              key={item.flagId}
              item={item}
              picked={picked.has(item.flagId)}
              onPick={(on) =>
                setPicked((cur) => {
                  const next = new Set(cur);
                  if (on) next.add(item.flagId);
                  else next.delete(item.flagId);
                  return next;
                })
              }
            />
          ))}
        </ul>
      )}
      <p className="text-xs text-quaternary">
        Won't fix and snoozed posts still count against the content grade. Posts the agent marked “still holds” don't.
      </p>
    </div>
  );
}

function RecheckRow({ item, picked, onPick }: { item: RecheckItem; picked: boolean; onPick: (on: boolean) => void }) {
  const [showFix, setShowFix] = useState(false);
  const open = OPEN.has(item.status);
  return (
    <li className={cx("overflow-hidden rounded-xl bg-primary shadow-xs ring-1 ring-secondary ring-inset", picked && "ring-2 ring-brand")}>
      <header className="flex items-center gap-3 border-b border-secondary px-5 py-3.5">
        {open && <Checkbox aria-label={`Select ${item.postTitle}`} isSelected={picked} onChange={onPick} />}
        {kb().sample || !item.postId ? (
          <h3 className="min-w-0 flex-1 truncate text-md font-semibold text-primary">{item.postTitle}</h3>
        ) : (
          <a href={postHref(item.postId)} className="min-w-0 flex-1 truncate text-md font-semibold text-primary hover:underline">
            {item.postTitle}
          </a>
        )}
        {open ? <ActionBadge action={item.suggestedAction} /> : <FlagStatusBadge status={item.status} />}
      </header>
      <div className="flex flex-col gap-2.5 px-5 py-4">
        {item.tldr && <p className="text-sm text-secondary">{item.tldr}</p>}
        {item.quote && <QuoteInContext before={item.before} quote={item.quote} after={item.after} />}
        {item.fix && open && (
          <>
            <button type="button" onClick={() => setShowFix((s) => !s)} className="self-start text-sm text-tertiary hover:text-secondary">
              {showFix ? "Hide the suggested update" : "Show the suggested update"}
            </button>
            {showFix && <FixDiff fix={item.fix} />}
          </>
        )}
      </div>
    </li>
  );
}
