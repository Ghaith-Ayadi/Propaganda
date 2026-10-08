// One flag, as the Guardian raised it: what the content says (its whole
// paragraph, a link to the original) against the knowledge base item, the
// suggested update, and the other ways to close it. Contesting
// happens here, as pushback on the flag: the person says why both can be true,
// the agent drafts the change, the Guardian rules.
//
// Self-contained (takes a flag id) so the Inbox can show it too.

import { useState } from "react";
import { ArrowUpRight, Check, Edit05 } from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { ButtonGroup, ButtonGroupItem } from "@/components/base/button-group/button-group";
import { toast } from "@/components/base/toast/toast";
import { coded, userMessage } from "@/lib/errors";
import { reportError, track } from "@/lib/telemetry";
import { go, pageHref, postHref } from "@/lib/route";
import { kb } from "@/lib/knowledge/adapter";
import { changed, useKb } from "@/lib/knowledge/hooks";
import type { ClaimDetail, ContestAxis, ContestState, FlagDetail, HandClose } from "@/lib/knowledge/types";
import { cx } from "@/utils/cx";
import {
  ClaimStatusBadge,
  DecisionCard,
  Empty,
  FixDiff,
  FLAG_STATUS_LABEL,
  FlagStatusBadge,
  Loading,
  Panel,
  QuoteInContext,
  SectionLabel,
  TextArea,
  UrgentBadge,
  formatDate,
} from "./bits";
import { EvidenceItem } from "./ClaimDetailView";

export function FlagDetailView({ id }: { id: string }) {
  const flag = useKb("kb.flag", () => kb().flag(id), [id]);
  if (flag.loading && !flag.data) return <Loading />;
  if (!flag.data) return <Empty title="This flag isn't here">It may have been closed and cleaned up, or the link is wrong.</Empty>;
  return <FlagBody flag={flag.data} />;
}

async function act<T>(code: string, where: string, fn: () => Promise<T>, failTitle: string): Promise<T | undefined> {
  try {
    const out = await fn();
    changed();
    return out;
  } catch (err) {
    const e = coded(code, err);
    reportError(where, e);
    toast.add({ type: "error", title: failTitle, description: userMessage(e) });
    return undefined;
  }
}

function FlagBody({ flag }: { flag: FlagDetail }) {
  const open = flag.status === "open" || flag.status === "snoozed";
  const conflict = flag.kind === "kb_conflict";
  const editable = !kb().sample && !!flag.postId;

  return (
    <div className="flex flex-col gap-5">
      <Panel
        title={conflict ? flag.headline : flag.postTitle}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {flag.urgency === "high" && open && <UrgentBadge />}
            {flag.status !== "open" && <FlagStatusBadge status={flag.status} />}
            {[conflict ? "Two claims disagree" : flag.headline, `raised ${formatDate(flag.created)}`].join(" · ")}
          </span>
        }
        actions={
          editable && (
            <Button size="sm" color="secondary" href={postHref(flag.postId!)}>
              Open in editor
            </Button>
          )
        }
        bodyClassName="flex flex-col gap-5"
      >
        {!open && (
          <p className="rounded-lg bg-secondary px-3.5 py-2.5 text-sm text-secondary">
            Closed as <span className="font-medium">{FLAG_STATUS_LABEL[flag.status].toLowerCase()}</span>.
            {flag.status === "wont_fix" && " It still counts against the content grade."}
            {flag.status === "retracted" && " The content is gone, so it's out of the grade."}
            {flag.note && <span className="text-tertiary"> “{flag.note}”</span>}
          </p>
        )}
        {flag.status === "snoozed" && (
          <p className="rounded-lg bg-secondary px-3.5 py-2.5 text-sm text-secondary">
            Snoozed{flag.snoozedUntil ? ` until ${formatDate(flag.snoozedUntil)}` : ""}. It still counts against the content grade.
            {flag.note && <span className="text-tertiary"> “{flag.note}”</span>}
          </p>
        )}

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {conflict ? (
            <ClaimSide label="Remembered" claim={flag.claim} />
          ) : (
            <div className="flex min-w-0 flex-col gap-2">
              <SectionLabel>
                {flag.passage.uri ? (
                  <a href={flag.passage.uri} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-tertiary">
                    Original text
                    <ArrowUpRight className="size-3.5" />
                  </a>
                ) : (
                  "Original text"
                )}
              </SectionLabel>
              <QuoteInContext before={flag.passage.before} quote={flag.passage.quote} after={flag.passage.after} tone="error" />
            </div>
          )}
          <ClaimSide label={conflict ? "Already in the knowledge base" : "Knowledge base item"} claim={conflict ? flag.otherClaim ?? flag.claim : flag.claim} />
        </div>

        {flag.explanation && <p className="text-sm text-secondary">{flag.explanation}</p>}
        {conflict && open && (
          <p className="text-sm text-tertiary">
            {ownersLine(flag)} Settling it means replacing or retracting one of the two, in chat with the agent. Until then both
            count against the knowledge base grade.
          </p>
        )}
      </Panel>

      {open && flag.fix && <FixPanel flag={flag} />}

      {flag.contest && <ContestResult flagId={flag.id} contest={flag.contest} open={open} />}

      {open && <CloseOtherWays flag={flag} />}
    </div>
  );
}

function ownersLine(flag: FlagDetail): string {
  const owners = [...flag.claim.owners, ...(flag.otherClaim?.owners ?? [])];
  const names = [...new Set(owners.map((o) => o.name))];
  return names.length ? `${names.join(" or ")} decides, as the topic's owner.` : "The top authority decides; this topic has no owner.";
}

function ClaimSide({ label, claim }: { label: string; claim: ClaimDetail }) {
  const [showEvidence, setShowEvidence] = useState(false);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <SectionLabel right={<ClaimStatusBadge status={claim.status} />}>{label}</SectionLabel>
      <a href={pageHref("knowledge", `claims/${claim.id}`)} className="rounded-lg px-4 py-3 ring-1 ring-secondary transition hover:bg-primary_hover">
        <p className="font-serif text-lg text-primary">{claim.text}</p>
        <p className="mt-1.5 text-xs text-quaternary">
          {[
            claim.topics.map((t) => t.name).join(", "),
            claim.rememberedBy ? `added by ${claim.rememberedBy.name}` : "",
            claim.validFrom ? `since ${formatDate(claim.validFrom)}` : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </a>
      {claim.evidence.length > 0 && (
        <button type="button" onClick={() => setShowEvidence((s) => !s)} className="self-start text-sm text-tertiary hover:text-secondary">
          {showEvidence ? "Hide sources" : "Show sources"}
        </button>
      )}
      {showEvidence && (
        <ul className="flex flex-col gap-4">
          {claim.evidence.map((e) => (
            <EvidenceItem key={e.id} evidence={e} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FixPanel({ flag }: { flag: FlagDetail }) {
  const [busy, setBusy] = useState(false);
  const apply = async () => {
    setBusy(true);
    const ok = await act("KB-FIX", "kb.applyFix", () => kb().applyFix(flag.id), "Couldn't apply the update");
    setBusy(false);
    if (ok !== undefined) {
      track("kb_flag_fixed", { kind: flag.kind });
      toast.add({ type: "success", title: "Updated", description: "The flag closes and the post counts as consistent again." });
    }
  };
  return (
    <Panel
      title="Suggested update"
      actions={
        kb().sample ? (
          <Button size="sm" color="primary" iconLeading={Check} isLoading={busy} onClick={() => void apply()}>
            Apply
          </Button>
        ) : (
          flag.postId && (
            <Button size="sm" color="primary" iconLeading={Edit05} onClick={() => go({ view: "post", id: flag.postId! })}>
              Edit the post
            </Button>
          )
        )
      }
    >
      <FixDiff fix={flag.fix!} />
    </Panel>
  );
}

const AXES: { id: ContestAxis; label: string; hint: string }[] = [
  { id: "time", label: "Time", hint: "It changed, and the content is dated." },
  { id: "scope", label: "Scope", hint: "A product, plan, region or kind of customer." },
  { id: "audience", label: "Audience", hint: "Said for a different reader." },
  { id: "wording", label: "Wording", hint: "The same fact said differently." },
];

function CloseOtherWays({ flag }: { flag: FlagDetail }) {
  const [mode, setMode] = useState<null | "contest" | "wont_fix">(flag.contest?.status === "rejected" ? "contest" : null);
  const [note, setNote] = useState("");
  const conflict = flag.kind === "kb_conflict";
  const draftOpen = flag.contest && (flag.contest.status === "draft" || flag.contest.status === "open" || flag.contest.status === "escalated");

  const close = async (status: HandClose, opts?: { note?: string; until?: string }) => {
    const ok = await act("KB-FLAG-CLOSE", "kb.closeFlag", () => kb().closeFlag(flag.id, status, opts), "Couldn't close the flag");
    if (ok !== undefined) {
      track("kb_flag_closed", { status, kind: flag.kind });
      toast.add({ type: "success", title: status === "snoozed" ? "Snoozed for a week" : `Closed as ${FLAG_STATUS_LABEL[status].toLowerCase()}` });
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <SectionLabel>Or close it another way</SectionLabel>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {!conflict && !draftOpen && (
          <OptionCard
            title="It isn't inconsistent"
            body="Argue why both can be true. The Guardian decides, not you."
            active={mode === "contest"}
            onPress={() => setMode(mode === "contest" ? null : "contest")}
          />
        )}
        {!conflict && (
          <OptionCard
            title="True, but not worth fixing"
            body="Closes the task. Still counts against your content grade."
            active={mode === "wont_fix"}
            onPress={() => setMode(mode === "wont_fix" ? null : "wont_fix")}
          />
        )}
        {!conflict && (
          <OptionCard
            title="We took it down"
            body="The content is gone, so it leaves the grade."
            onPress={() => void close("retracted")}
          />
        )}
        {flag.status !== "snoozed" && (
          <OptionCard
            title="Not now"
            body="Snooze it for a week. It still counts while it waits."
            onPress={() => void close("snoozed", { until: new Date(Date.now() + 7 * 864e5).toISOString() })}
          />
        )}
      </div>

      {mode === "wont_fix" && (
        <Panel
          title="True, but not worth fixing"
          actions={
            <>
              <Button size="sm" color="tertiary" onClick={() => setMode(null)}>
                Cancel
              </Button>
              <Button size="sm" color="primary" onClick={() => void close("wont_fix", { note })}>
                Close as won't fix
              </Button>
            </>
          }
        >
          <TextArea label="Why (optional)" value={note} onChange={setNote} rows={2} placeholder="An old post nobody reads." />
        </Panel>
      )}
      {mode === "contest" && !draftOpen && <ContestForm flag={flag} onCancel={() => setMode(null)} />}
    </div>
  );
}

function OptionCard({ title, body, onPress, active }: { title: string; body: string; onPress: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onPress}
      className={cx(
        "flex flex-col gap-1 rounded-xl bg-primary px-4 py-3.5 text-left shadow-xs ring-1 ring-secondary transition hover:bg-primary_hover",
        active && "ring-2 ring-brand",
      )}
    >
      <span className="text-sm font-medium text-primary">{title}</span>
      <span className="text-sm text-tertiary">{body}</span>
    </button>
  );
}

function ContestForm({ flag, onCancel }: { flag: FlagDetail; onCancel: () => void }) {
  const [reason, setReason] = useState(flag.contest?.status === "rejected" ? flag.contest.reason : "");
  const [axis, setAxis] = useState<ContestAxis | null>(flag.contest?.axis ?? null);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    const out = await act("KB-CONTEST", "kb.contest", () => kb().contest(flag.id, reason.trim(), axis), "Couldn't send that");
    setBusy(false);
    if (out) track("kb_contest_opened", { axis: axis ?? "none" });
  };

  return (
    <Panel
      title="Why both can be true"
      description="One sentence is enough. A strong source settles it; your word alone goes in as contested."
      actions={
        <>
          <Button size="sm" color="tertiary" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" color="primary" isDisabled={!reason.trim()} isLoading={busy} onClick={() => void send()}>
            Draft the change
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-secondary">What makes the difference</span>
          <ButtonGroup
            size="sm"
            selectedKeys={axis ? [axis] : []}
            onSelectionChange={(keys) => {
              const next = [...keys][0];
              setAxis(next ? (next as ContestAxis) : null);
            }}
          >
            {AXES.map((a) => (
              <ButtonGroupItem key={a.id} id={a.id}>
                {a.label}
              </ButtonGroupItem>
            ))}
          </ButtonGroup>
          <span className="text-xs text-quaternary">{axis ? AXES.find((a) => a.id === axis)!.hint : "Pick the one that fits, if any."}</span>
        </div>
        <TextArea
          label="Your argument"
          value={reason}
          onChange={setReason}
          autoFocus
          rows={3}
          placeholder="Nookal shipped in August 2026; it's in the integrations catalogue."
        />
      </div>
    </Panel>
  );
}

function ContestResult({ flagId, contest, open }: { flagId: string; contest: ContestState; open: boolean }) {
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const out = await act("KB-CONTEST", "kb.submitContest", () => kb().submitContest(flagId), "Couldn't send it to the Guardian");
    setBusy(false);
    if (out?.decision) {
      track("kb_contest_ruled", { verdict: out.decision.verdict });
      const v = out.decision.verdict;
      toast.add({
        type: v === "reject" ? "error" : "success",
        title:
          v === "admit"
            ? "Reconciled. The flag is closed."
            : v === "admit_contested"
              ? "In as contested. The flag is closed."
              : v === "escalate"
                ? "Sent to the topic's owner."
                : "The Guardian rejected it. The flag stays open.",
      });
    }
  };

  return (
    <Panel
      title="Your contest"
      className={cx(contest.decision?.verdict === "reject" && "ring-error_subtle")}
      actions={
        contest.status === "draft" && (
          <Button size="sm" color="primary" isLoading={busy} isDisabled={!contest.changes.length} onClick={() => void submit()}>
            Send to the Guardian
          </Button>
        )
      }
    >
      <p className="text-sm text-secondary">
        “{contest.reason}”
        {contest.axis && (
          <Badge type="color" size="sm" color="gray" className="ml-2 align-middle">
            {contest.axis}
          </Badge>
        )}
      </p>
      {contest.changes.length > 0 ? (
        <div className="mt-4">
          <p className="mb-1.5 text-sm font-medium text-secondary">The agent drafted</p>
          <ul className="flex flex-col gap-1.5">
            {contest.changes.map((c, i) => (
              <li key={i} className="rounded-lg bg-secondary px-3.5 py-2 text-sm text-primary">
                <span className="mr-2 type-eyebrow text-tertiary">{c.op === "add" ? "New claim" : c.op}</span>
                {c.text}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        contest.status === "draft" && <p className="mt-3 text-sm text-tertiary">The agent is drafting the change from your sentence.</p>
      )}

      {contest.status === "open" && <p className="mt-3 text-sm text-tertiary">With the Guardian.</p>}
      {contest.decision && (
        <div className="mt-5">
          <DecisionCard decision={contest.decision} />
          {contest.decision.verdict === "reject" && open && (
            <p className="mt-3 text-sm text-tertiary">Fix the post, or argue again below with what the Guardian asked for.</p>
          )}
        </div>
      )}
    </Panel>
  );
}
