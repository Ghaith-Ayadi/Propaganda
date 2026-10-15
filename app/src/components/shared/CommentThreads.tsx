// Comment threads beside a document, Google Docs style. Presentational: the
// caller owns the data (the post's comments, a pitch's notes) and passes what
// to show and what each action does. Two kinds read differently on purpose:
// a contextual comment is pinned to a highlighted passage and shows it as a
// quote; a general comment is about the whole piece and says so.

import { useEffect, useRef, useState } from "react";
import { Check, Trash01 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { cx } from "@/utils/cx";

export interface CommentItem {
  id: string;
  author: string;
  at: number;
  body: string;
  /** Not sent yet: waits for "Send". */
  draft?: boolean;
  mine?: boolean;
}

export interface ThreadItem {
  id: string;
  /** The highlighted words; null on a general comment. */
  quote: string | null;
  /** The words are no longer in the text. */
  lost?: boolean;
  resolved?: boolean;
  comments: CommentItem[];
}

interface Props {
  threads: ThreadItem[];
  /** The passage just highlighted, waiting for its comment. */
  draftQuote: string | null;
  activeId: string | null;
  hoverId: string | null;
  onActivate: (id: string) => void;
  onHover: (id: string | null) => void;
  /** Writes the comment for the highlighted passage. */
  onComment: (body: string) => void;
  onCancelDraft: () => void;
  /** A comment about the whole piece, from the box at the bottom. */
  onGeneral: (body: string) => void;
  onReply: (threadId: string, body: string) => void;
  onResolve: (threadId: string, resolved: boolean) => void;
  onDelete: (commentId: string) => void;
  /** Drafts waiting to be sent together; with this set, a "Send" row shows. */
  pending?: number;
  onSend?: () => void;
  generalPlaceholder?: string;
}

function when(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function Composer({
  placeholder,
  submit,
  onSubmit,
  onCancel,
  autoFocus,
}: {
  placeholder: string;
  submit: string;
  onSubmit: (body: string) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const [body, setBody] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  const send = () => {
    if (!body.trim()) return;
    onSubmit(body);
    setBody("");
  };
  return (
    <div className="flex flex-col gap-2">
      <textarea
        ref={ref}
        value={body}
        rows={2}
        placeholder={placeholder}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
          if (e.key === "Escape") onCancel?.();
        }}
        className="w-full resize-y rounded-lg bg-primary px-3 py-2 text-sm text-primary shadow-xs ring-1 ring-primary outline-hidden ring-inset placeholder:text-placeholder focus:ring-2 focus:ring-brand"
      />
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button size="sm" color="tertiary" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button size="sm" color="primary" isDisabled={!body.trim()} onClick={send}>
          {submit}
        </Button>
      </div>
    </div>
  );
}

function Quote({ text, lost }: { text: string; lost?: boolean }) {
  return (
    <blockquote className={cx("border-l-2 pl-3 text-sm text-tertiary", lost ? "border-secondary line-through" : "border-brand")}>
      <span className="line-clamp-3">{text}</span>
    </blockquote>
  );
}

function Thread({ t, active, hover, p }: { t: ThreadItem; active: boolean; hover: boolean; p: Props }) {
  const [replying, setReplying] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active]);
  return (
    <div
      ref={ref}
      data-comment-thread={t.id}
      onMouseEnter={() => p.onHover(t.id)}
      onMouseLeave={() => p.onHover(null)}
      onClick={() => p.onActivate(t.id)}
      className={cx(
        "flex flex-col gap-3 rounded-xl bg-primary p-3 ring-1 ring-secondary ring-inset animate-in fade-in slide-in-from-right-2 duration-200 motion-reduce:animate-none",
        (active || hover) && "ring-2 ring-brand",
        t.resolved && "opacity-60",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-quaternary uppercase">{t.quote ? "On highlighted text" : "General"}</span>
        <button
          type="button"
          title={t.resolved ? "Reopen" : "Resolve"}
          onClick={(e) => {
            e.stopPropagation();
            p.onResolve(t.id, !t.resolved);
          }}
          className="flex items-center gap-1 text-xs text-tertiary hover:text-primary"
        >
          <Check className="size-4" />
          {t.resolved ? "Reopen" : "Resolve"}
        </button>
      </div>
      {t.quote && <Quote text={t.quote} lost={t.lost} />}
      {t.lost && <p className="text-xs text-quaternary">The highlighted words were changed or removed.</p>}
      {t.comments.map((c) => (
        <div key={c.id} className="group flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2 text-xs text-tertiary">
            <span className="font-semibold text-secondary">{c.author || "Someone"}</span>
            <span className="flex items-center gap-2">
              {c.draft ? "Draft" : when(c.at)}
              {c.mine && (
                <button
                  type="button"
                  title="Delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    p.onDelete(c.id);
                  }}
                  className="text-quaternary opacity-0 group-hover:opacity-100 hover:text-primary"
                >
                  <Trash01 className="size-3.5" />
                </button>
              )}
            </span>
          </div>
          <p className="text-sm whitespace-pre-wrap text-primary">{c.body}</p>
        </div>
      ))}
      {replying ? (
        <div onClick={(e) => e.stopPropagation()}>
          <Composer
            autoFocus
            placeholder="Reply"
            submit="Reply"
            onSubmit={(b) => {
              p.onReply(t.id, b);
              setReplying(false);
            }}
            onCancel={() => setReplying(false)}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setReplying(true);
          }}
          className="self-start text-xs text-tertiary hover:text-primary"
        >
          Reply
        </button>
      )}
    </div>
  );
}

export function CommentThreads(p: Props) {
  const open = p.threads.filter((t) => !t.resolved);
  const done = p.threads.filter((t) => t.resolved);
  return (
    <div className="flex flex-col gap-3">
      {p.draftQuote && (
        <div className="flex flex-col gap-3 rounded-xl bg-primary p-3 ring-2 ring-brand">
          <span className="text-xs text-quaternary uppercase">On highlighted text</span>
          <Quote text={p.draftQuote} />
          <Composer autoFocus placeholder="Comment on this passage" submit="Comment" onSubmit={p.onComment} onCancel={p.onCancelDraft} />
        </div>
      )}
      {!open.length && !p.draftQuote && (
        <p className="text-sm text-tertiary">Highlight text in the post and choose Comment, or write a general comment below.</p>
      )}
      {open.map((t) => (
        <Thread key={t.id} t={t} active={p.activeId === t.id} hover={p.hoverId === t.id} p={p} />
      ))}
      {!!p.pending && p.onSend && (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-secondary p-3 ring-1 ring-secondary ring-inset">
          <span className="text-sm text-secondary">{p.pending} to send</span>
          <Button size="sm" color="primary" onClick={p.onSend}>
            Send all
          </Button>
        </div>
      )}
      <div className="flex flex-col gap-2 border-t border-secondary pt-3">
        <span className="text-xs text-quaternary uppercase">General comment</span>
        <Composer placeholder={p.generalPlaceholder ?? "About the whole piece"} submit="Comment" onSubmit={p.onGeneral} />
      </div>
      {!!done.length && (
        <details className="text-sm">
          <summary className="cursor-pointer text-tertiary">Resolved ({done.length})</summary>
          <div className="mt-2 flex flex-col gap-3">
            {done.map((t) => (
              <Thread key={t.id} t={t} active={p.activeId === t.id} hover={p.hoverId === t.id} p={p} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
