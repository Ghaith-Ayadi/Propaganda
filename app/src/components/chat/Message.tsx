// One message in the thread: the operator's bubble, or the agent's reply with
// the agents it called, its sources and the actions it offers.

import { useState, type FC } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertCircle,
  BookOpen01,
  CheckCircle,
  Compass03,
  CpuChip01,
  Edit05,
  File06,
  Flag05,
  Hourglass03,
  Lightbulb02,
  Loading02,
  MessageChatSquare,
  Microphone01,
  SearchLg,
  ShieldTick,
  Stars02,
  Target04,
  CheckVerified02,
} from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Badge } from "@/components/base/badges/badges";
import { Tooltip, TooltipTrigger } from "@/components/base/tooltip/tooltip";
import { toast } from "@/components/base/toast/toast";
import { AGENT_LABEL } from "@/lib/chat/adapter";
import type { AgentName, ChatUIMessage, Citation, Handoff, QuickAction, RefKind } from "@/lib/chat/types";
import { reportError } from "@/lib/telemetry";
import { cx } from "@/utils/cx";
import { hrefFor } from "./targets";

type Icon = FC<{ className?: string }>;

const AGENT_ICON: Record<AgentName, Icon> = {
  chat: MessageChatSquare,
  strategist: Compass03,
  listener: Microphone01,
  scout: SearchLg,
  pitcher: Lightbulb02,
  writer: Edit05,
  checker: CheckVerified02,
  guardian: ShieldTick,
};

const KIND_ICON: Record<RefKind, Icon> = {
  claim: BookOpen01,
  post: File06,
  pitch: Lightbulb02,
  flag: Flag05,
  goal: Target04,
  run: CpuChip01,
};

const KIND_LABEL: Record<RefKind, string> = {
  claim: "Knowledge base",
  post: "Post",
  pitch: "Pitch",
  flag: "Flag",
  goal: "Goal",
  run: "Run",
};

export function formatUsd(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function open(ref: Citation | NonNullable<QuickAction["target"]>) {
  const href = hrefFor(ref);
  if (href) window.location.hash = href;
  else toast.add({ title: `${KIND_LABEL[ref.kind]}s don't have a page yet`, description: "It arrives with the rest of the 0.2 screens." });
}

type Part = ChatUIMessage["parts"][number];

export function textOf(m: ChatUIMessage): string {
  return m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
}

export function Message({
  message,
  streaming,
  onRemember,
}: {
  message: ChatUIMessage;
  /** This reply is the one streaming in. */
  streaming: boolean;
  onRemember: (statement: string, messageId: string) => Promise<void>;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary-solid px-4 py-2.5 text-sm whitespace-pre-wrap text-white">
          {textOf(message)}
        </div>
      </div>
    );
  }
  return <Reply message={message} streaming={streaming} onRemember={onRemember} />;
}

/** The agent's avatar column beside a reply, or beside "Thinking" before the reply starts. */
export function ReplyRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-secondary text-fg-brand-primary">
        <Stars02 className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3">{children}</div>
    </div>
  );
}

function Reply({
  message,
  streaming,
  onRemember,
}: {
  message: ChatUIMessage;
  streaming: boolean;
  onRemember: (statement: string, messageId: string) => Promise<void>;
}) {
  const citations: Citation[] = [];
  const actions: QuickAction[] = [];
  const handoffs: Handoff[] = [];
  const shown: Part[] = [];
  for (const p of message.parts) {
    if (p.type === "data-citation") citations.push(p.data);
    else if (p.type === "data-action") actions.push(p.data);
    else if (p.type === "data-handoff") {
      handoffs.push(p.data);
      shown.push(p);
    } else if (p.type === "text") shown.push(p);
  }
  const last = shown[shown.length - 1];

  return (
    <ReplyRow>
      {shown.length === 0 && streaming && <Thinking />}

      {shown.map((p, i) =>
        p.type === "data-handoff" ? (
          <HandoffCard key={p.id ?? i} handoff={p.data} />
        ) : p.type === "text" ? (
          <Prose key={i} text={p.text} citations={citations} caret={streaming && p === last} />
        ) : null,
      )}

      {citations.length > 0 && !streaming && <Sources citations={citations} />}

      {actions.length > 0 && !streaming && (
        <div className="flex flex-wrap gap-2">
          {actions.map((a, i) => (
            <ActionButton key={i} action={a} onRemember={(s) => onRemember(s, message.id)} />
          ))}
        </div>
      )}

      {!streaming && <Footer message={message} handoffs={handoffs} />}
    </ReplyRow>
  );
}

/** Under the thread when the last reply failed. */
export function ReplyError({ onRetry }: { onRetry: () => void }) {
  return (
    <ReplyRow>
      <div className="flex items-center gap-2 text-sm text-error-primary">
        <AlertCircle className="size-4" />
        <span>The agent didn't answer.</span>
        <Button size="xs" color="link-gray" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </ReplyRow>
  );
}

export function Thinking() {
  return (
    <div className="flex items-center gap-2 py-1 text-sm text-tertiary">
      <Loading02 className="size-4 animate-spin" />
      Thinking
    </div>
  );
}

function Footer({ message, handoffs }: { message: ChatUIMessage; handoffs: Handoff[] }) {
  const agents = new Set(handoffs.map((h) => h.agent)).size;
  const bits: string[] = [];
  if (message.metadata?.stopped) bits.push("Stopped");
  if (agents > 0) bits.push(`${agents} ${agents === 1 ? "agent" : "agents"}`);
  if (message.metadata?.costUsd !== undefined) bits.push(formatUsd(message.metadata.costUsd));
  if (bits.length === 0) return null;
  return <p className="text-xs text-quaternary">{bits.join(" · ")}</p>;
}

/** The reply's words, with citation numbers rendered as chips. */
function Prose({ text, citations, caret }: { text: string; citations: Citation[]; caret: boolean }) {
  return (
    <div
      className={cx(
        "chat-prose text-sm text-primary",
        "[&_p]:my-0 [&_p+p]:mt-3 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5",
        "[&_strong]:font-medium [&_code]:rounded [&_code]:bg-secondary [&_code]:px-1 [&_code]:text-sm",
        caret && "[&>*:last-child]:after:ml-0.5 [&>*:last-child]:after:inline-block [&>*:last-child]:after:h-4 [&>*:last-child]:after:w-1.5 [&>*:last-child]:after:translate-y-0.5 [&>*:last-child]:after:animate-pulse [&>*:last-child]:after:bg-fg-quaternary [&>*:last-child]:after:content-['']",
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const m = href?.match(/^#cite-(\d+)$/);
            if (m) {
              const c = citations.find((x) => x.n === Number(m[1]));
              if (c) return <CitationChip citation={c} />;
            }
            return (
              <a href={href} target="_blank" rel="noreferrer" className="text-brand-secondary underline underline-offset-2">
                {children}
              </a>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function CitationChip({ citation }: { citation: Citation }) {
  const Icon = KIND_ICON[citation.kind];
  return (
    <Tooltip
      title={
        <span className="flex items-center gap-1.5">
          <Icon className="size-3.5" />
          {KIND_LABEL[citation.kind]}
        </span>
      }
      description={
        <span className="flex flex-col gap-1">
          <span>{citation.label}</span>
          {citation.quote && <span className="italic opacity-80">“{citation.quote}”</span>}
        </span>
      }
    >
      <TooltipTrigger
        onPress={() => open(citation)}
        className="mx-0.5 inline-flex h-4.5 min-w-4.5 -translate-y-px cursor-pointer items-center justify-center rounded-md bg-secondary px-1 align-middle text-xs font-medium text-secondary ring-1 ring-secondary ring-inset transition hover:bg-brand-primary hover:text-brand-secondary"
        aria-label={`Source ${citation.n}: ${citation.label}`}
      >
        {citation.n}
      </TooltipTrigger>
    </Tooltip>
  );
}

function Sources({ citations }: { citations: Citation[] }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="type-eyebrow text-quaternary">Sources</p>
      <ol className="flex flex-col">
        {citations.map((c) => {
          const Icon = KIND_ICON[c.kind];
          return (
            <li key={c.n}>
              <button
                onClick={() => open(c)}
                className="flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left text-sm transition hover:bg-primary_hover"
              >
                <span className="w-4 shrink-0 text-right text-xs font-medium text-quaternary tabular-nums leading-5">{c.n}</span>
                <Icon className="mt-0.5 size-4 shrink-0 text-fg-quaternary" />
                <span className="min-w-0 flex-1">
                  <span className="text-secondary">{c.label}</span>
                  {c.quote && <span className="block truncate text-xs text-tertiary italic">“{c.quote}”</span>}
                </span>
                <span className="shrink-0 text-xs text-quaternary">{KIND_LABEL[c.kind]}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function HandoffCard({ handoff: h }: { handoff: Handoff }) {
  const Icon = AGENT_ICON[h.agent];
  return (
    <div className="flex items-start gap-3 rounded-xl bg-primary px-3.5 py-3 shadow-xs ring-1 ring-secondary">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-fg-secondary ring-1 ring-secondary ring-inset">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium text-primary">{AGENT_LABEL[h.agent]}</span>
          <HandoffStatus status={h.status} />
          {h.runId && (
            <Badge color="gray" type="modern" size="sm">
              Runs on the worker
            </Badge>
          )}
        </div>
        <p className="text-sm text-tertiary">{h.task}</p>
        {h.summary && <p className="mt-1 text-sm text-secondary">{h.summary}</p>}
      </div>
      {h.costUsd !== undefined && (
        <span className="shrink-0 text-xs text-quaternary tabular-nums" title="API-price cost of this step's model calls">
          {formatUsd(h.costUsd)}
        </span>
      )}
    </div>
  );
}

function HandoffStatus({ status }: { status: Handoff["status"] }) {
  if (status === "running")
    return (
      <span className="flex items-center gap-1 text-xs text-brand-secondary">
        <Loading02 className="size-3.5 animate-spin" /> Working
      </span>
    );
  if (status === "queued")
    return (
      <span className="flex items-center gap-1 text-xs text-tertiary">
        <Hourglass03 className="size-3.5" /> Queued
      </span>
    );
  if (status === "failed")
    return (
      <span className="flex items-center gap-1 text-xs text-error-primary">
        <AlertCircle className="size-3.5" /> Failed
      </span>
    );
  return (
    <span className="flex items-center gap-1 text-xs text-success-primary">
      <CheckCircle className="size-3.5" /> Done
    </span>
  );
}

function ActionButton({ action, onRemember }: { action: QuickAction; onRemember: (statement: string) => Promise<void> }) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");

  if (action.kind === "remember") {
    const statement = action.statement ?? "";
    return (
      <Tooltip title="Send to the Guardian" description={`“${statement}”`}>
        <Button
          size="sm"
          color="secondary"
          iconLeading={state === "sent" ? CheckCircle : BookOpen01}
          isLoading={state === "sending"}
          isDisabled={state !== "idle"}
          onClick={async () => {
            setState("sending");
            try {
              await onRemember(statement);
              setState("sent");
              toast.add({
                type: "success",
                title: "Sent to the Guardian",
                description: "It checks the statement against the knowledge base before it's admitted.",
              });
            } catch (err) {
              reportError("chat.remember", err);
              setState("idle");
              toast.add({ type: "error", title: "Couldn't send it to the Guardian", description: "Try again in a moment." });
            }
          }}
        >
          {state === "sent" ? "Sent to the Guardian" : action.label}
        </Button>
      </Tooltip>
    );
  }

  const target = action.target;
  if (!target) return null;
  const Icon = KIND_ICON[target.kind];
  return (
    <Button size="sm" color="secondary" iconLeading={Icon} onClick={() => open(target)}>
      {action.label}
    </Button>
  );
}
