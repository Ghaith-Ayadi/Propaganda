// Chat (#/chat, #/chat/<conversation>): the operator talks with the Chat agent,
// which calls the other agents and the knowledge base. Data comes from
// lib/chat/useChat.ts; until the backend exists it is the placeholder adapter's.
// Unlike most pages it keeps its own scroller, so the composer stays put.

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Menu01, MessageChatSquare, Plus, Send01, StopCircle, Trash01 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { ButtonUtility } from "@/components/base/buttons/button-utility";
import { BadgeWithDot } from "@/components/base/badges/badges";
import { useConversation, useConversations } from "@/lib/chat/useChat";
import type { Conversation } from "@/lib/chat/types";
import { activeSite } from "@/lib/scope";
import { goPage, usePageRest } from "@/lib/route";
import { CONTAINER, PageHeader } from "@/components/shell/PageHeader";
import { useIsMobile } from "@/lib/mobile";
import { cx } from "@/utils/cx";
import type { ChatStatus } from "ai";
import type { ChatUIMessage } from "@/lib/chat/types";
import { Message, ReplyError, ReplyRow, Thinking } from "./Message";

const SUGGESTIONS = [
  "Why is the SOC 2 pitch rated a strong fit?",
  "Why was the pricing flag raised?",
  "We're launching in November. Reposition us for it.",
  "What do we say about onboarding?",
];

export function ChatPage() {
  const site = activeSite();
  const rest = usePageRest();
  const activeId = rest && /^[a-z0-9]+$/.test(rest) ? rest : null;
  const siteId = site?.id ?? "";

  const { conversations, create, remove, touch, placeholder } = useConversations(siteId);
  const { messages, status, loading, busy, send, stop, retry, remember } = useConversation(siteId, activeId, {
    create,
    touch,
    onStarted: (id) => goPage("chat", id),
  });
  const isMobile = useIsMobile();
  const [listOpen, setListOpen] = useState(false);

  // A link to a conversation that isn't there (deleted, another site) goes back to a new chat.
  useEffect(() => {
    if (activeId && conversations && !conversations.some((c) => c.id === activeId)) goPage("chat");
  }, [activeId, conversations]);

  const ask = (text: string) => void send(text);

  const list = (
    <ConversationList
      conversations={conversations ?? []}
      activeId={activeId}
      onPick={(id) => {
        setListOpen(false);
        goPage("chat", id);
      }}
      onNew={() => {
        setListOpen(false);
        goPage("chat");
      }}
      onDelete={async (id) => {
        await remove(id);
        if (id === activeId) goPage("chat");
      }}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Chat"
        description={`Ask the agent about anything in ${site?.name ?? "your site"}: pitches, goals, the knowledge base.`}
        actions={
          <>
            {placeholder && (
              <BadgeWithDot color="warning" type="pill-color" size="sm">
                Example replies
              </BadgeWithDot>
            )}
            {isMobile && (
              <ButtonUtility size="sm" color="secondary" icon={Menu01} tooltip="Conversations" onClick={() => setListOpen((o) => !o)} />
            )}
            <Button size="sm" color="secondary" iconLeading={Plus} onClick={() => goPage("chat")}>
              New chat
            </Button>
          </>
        }
      />

      {/* The shared container, stretched to the window so the composer stays put. */}
      <div className={cx(CONTAINER, "flex min-h-0 flex-1 flex-col pt-6 pb-4 md:pt-8 md:pb-6")}>
        <div className="relative flex min-h-[420px] flex-1 overflow-hidden rounded-2xl bg-primary shadow-xs ring-1 ring-secondary">
          {!isMobile && <aside className="flex w-60 shrink-0 flex-col border-r border-secondary bg-secondary_alt">{list}</aside>}
          {isMobile && listOpen && (
            <aside className="absolute inset-y-0 left-0 z-10 flex w-72 max-w-[85%] flex-col border-r border-secondary bg-primary shadow-lg">{list}</aside>
          )}

          <section className="flex min-w-0 flex-1 flex-col">
            {messages.length > 0 || (activeId && loading) ? (
              <Thread messages={messages} status={status} onRemember={remember} onRetry={retry} />
            ) : (
              <Welcome onPick={ask} />
            )}
            <Composer streaming={busy} onSend={ask} onStop={() => void stop()} />
          </section>
        </div>
      </div>
    </div>
  );
}

function ConversationList({
  conversations,
  activeId,
  onPick,
  onNew,
  onDelete,
}: {
  conversations: Conversation[];
  activeId: string | null;
  onPick: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
      <button
        onClick={onNew}
        className={cx(
          "flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition hover:bg-primary_hover",
          !activeId ? "bg-primary font-medium text-primary shadow-xs ring-1 ring-secondary" : "text-secondary",
        )}
      >
        <Plus className="size-4 text-fg-quaternary" />
        New chat
      </button>
      {conversations.length > 0 && <p className="px-2.5 pt-3 pb-1 text-xs font-medium text-quaternary">Recent</p>}
      {conversations.map((c) => (
        <div
          key={c.id}
          className={cx(
            "group flex items-center gap-1 rounded-md transition hover:bg-primary_hover",
            c.id === activeId && "bg-primary shadow-xs ring-1 ring-secondary hover:bg-primary",
          )}
        >
          <button
            onClick={() => onPick(c.id)}
            className={cx(
              "min-w-0 flex-1 truncate px-2.5 py-2 text-left text-sm",
              c.id === activeId ? "font-medium text-primary" : "text-secondary",
            )}
          >
            {c.title}
          </button>
          <button
            onClick={() => onDelete(c.id)}
            aria-label={`Delete “${c.title}”`}
            className="mr-1 rounded p-1 text-fg-quaternary opacity-0 transition group-hover:opacity-100 hover:text-fg-error-primary focus-visible:opacity-100"
          >
            <Trash01 className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

function Welcome({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-6 py-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex size-12 items-center justify-center rounded-xl bg-secondary ring-1 ring-secondary ring-inset">
          <MessageChatSquare className="size-6 text-fg-secondary" />
        </span>
        <h2 className="type-title text-primary">What do you want to know?</h2>
        <p className="max-w-md text-sm text-tertiary">
          The agent answers from your knowledge base and your content, and brings in the other agents when it needs
          them: the Pitcher for a pitch, the Checker for a flag, the Strategist for your goals.
        </p>
      </div>
      <div className="flex w-full max-w-2xl flex-col gap-2">
        <p className="type-eyebrow text-quaternary">Try</p>
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => onPick(s)}
              className="rounded-full bg-primary px-3 py-1.5 text-sm text-secondary shadow-xs ring-1 ring-primary transition ring-inset hover:bg-primary_hover hover:text-primary"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Thread({
  messages,
  status,
  onRemember,
  onRetry,
}: {
  messages: ChatUIMessage[];
  status: ChatStatus;
  onRemember: (statement: string, messageId: string) => Promise<void>;
  onRetry: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  // Follow the reply while the reader is at the bottom; leave them be if they scrolled up.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  const last = messages[messages.length - 1];
  return (
    <div
      ref={scroller}
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
      className="min-h-0 flex-1 overflow-y-auto"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 md:px-6">
        {messages.map((m) => (
          <Message
            key={m.id}
            message={m}
            streaming={status === "streaming" && m === last && m.role === "assistant"}
            onRemember={onRemember}
          />
        ))}
        {/* Sent, nothing back yet: useChat adds the reply on its first chunk. */}
        {status === "submitted" && (
          <ReplyRow>
            <Thinking />
          </ReplyRow>
        )}
        {status === "error" && <ReplyError onRetry={onRetry} />}
      </div>
    </div>
  );
}

function Composer({ streaming, onSend, onStop }: { streaming: boolean; onSend: (t: string) => void; onStop: () => void }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow with the text, up to about eight lines.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const submit = () => {
    if (streaming || !text.trim()) return;
    onSend(text);
    setText("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="border-t border-secondary px-3 py-3 md:px-5">
      <div className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-xl bg-primary p-1.5 pl-3.5 shadow-xs ring-1 ring-primary ring-inset transition focus-within:ring-brand">
        <textarea
          ref={ref}
          rows={1}
          value={text}
          autoFocus
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask something"
          aria-label="Message the agent"
          className="max-h-50 min-h-9 flex-1 resize-none bg-transparent py-2 text-sm text-primary outline-hidden placeholder:text-placeholder"
        />
        {streaming ? (
          <Button size="sm" color="secondary" iconLeading={StopCircle} onClick={onStop}>
            Stop
          </Button>
        ) : (
          <Button size="sm" color="primary" iconLeading={Send01} isDisabled={!text.trim()} onClick={submit}>
            Send
          </Button>
        )}
      </div>
      <p className="mx-auto mt-1.5 hidden w-full max-w-3xl text-xs text-quaternary md:block">
        Enter to send, Shift+Enter for a new line. Every answer shows what it cost.
      </p>
    </div>
  );
}
