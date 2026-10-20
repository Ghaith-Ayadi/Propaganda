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
import { goPage, pageHref, usePageRest } from "@/lib/route";
import { lastOpenConversation, rememberOpenConversation } from "@/lib/chat/lastOpen";
import { PageHeader } from "@/components/shell/PageHeader";
import { useIsMobile } from "@/lib/mobile";
import { cx } from "@/utils/cx";
import type { ChatStatus } from "ai";
import type { ChatUIMessage } from "@/lib/chat/types";
import { Message, ReplyError, ReplyRow, Thinking } from "./Message";

const SUGGESTIONS = [
  "What should we write about this month?",
  "Pitch me three posts on what our customers ask most.",
  "What does the knowledge base say about our pricing?",
  "Which of our posts need updating?",
];

export function ChatPage() {
  const site = activeSite();
  const rest = usePageRest();
  // #/chat/new is a deliberate new chat; plain #/chat reopens the last conversation.
  const activeId = rest && rest !== "new" && /^[a-z0-9]+$/.test(rest) ? rest : null;
  const siteId = site?.id ?? "";

  const { conversations, create, remove, touch, placeholder } = useConversations(siteId);
  const { messages, status, loading, busy, send, stop, retry, remember } = useConversation(siteId, activeId, {
    create,
    touch,
    onStarted: (id) => goPage("chat", id),
  });
  const isMobile = useIsMobile();
  const [listOpen, setListOpen] = useState(false);

  // Coming back from another page lands on #/chat: reopen the conversation that was open.
  // (replace, so Back doesn't return to the bare address and bounce forward again.)
  useEffect(() => {
    if (rest !== null || !conversations || !siteId) return;
    const last = lastOpenConversation(siteId);
    if (last && conversations.some((c) => c.id === last)) window.location.replace(pageHref("chat", last));
  }, [rest, conversations, siteId]);

  useEffect(() => {
    if (!siteId) return;
    if (activeId) rememberOpenConversation(siteId, activeId);
    else if (rest === "new") rememberOpenConversation(siteId, null);
  }, [siteId, activeId, rest]);

  // A link to a conversation that isn't there (deleted, another site) goes back to a new chat.
  useEffect(() => {
    if (activeId && conversations && !conversations.some((c) => c.id === activeId)) goPage("chat", "new");
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
        goPage("chat", "new");
      }}
      onDelete={async (id) => {
        await remove(id);
        if (id === activeId) goPage("chat", "new");
      }}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Chat"
        description={`Ask about anything in ${site?.name ?? "your site"}: pitches, goals, the knowledge base.`}
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
            <Button size="sm" color="secondary" iconLeading={Plus} onClick={() => goPage("chat", "new")}>
              New chat
            </Button>
          </>
        }
      />

      {/* The chat is the page body: the conversation centered in the space
          left of the list, the list of chats against the right edge. */}
      <div className="relative flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col">
          {messages.length > 0 || (activeId && loading) ? (
            <Thread conversationId={activeId} messages={messages} status={status} onRemember={remember} onRetry={retry} />
          ) : (
            <Welcome onPick={ask} />
          )}
          <Composer streaming={busy} onSend={ask} onStop={() => void stop()} />
        </section>

        {!isMobile && <aside className="flex w-64 shrink-0 flex-col border-l border-secondary">{list}</aside>}
        {isMobile && listOpen && (
          <aside className="absolute inset-y-0 right-0 z-10 flex w-72 max-w-[85%] flex-col border-l border-secondary bg-primary shadow-lg">{list}</aside>
        )}
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
          !activeId ? "bg-primary_hover font-medium text-primary ring-1 ring-secondary ring-inset" : "text-secondary",
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
            c.id === activeId && "bg-primary_hover ring-1 ring-secondary ring-inset",
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
          We answer from your knowledge base, your strategy, your pitches and posts, and your website. Work that
          takes longer, like a new pitch or a check, runs in the background and shows up here.
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
  conversationId,
  messages,
  status,
  onRemember,
  onRetry,
}: {
  /** The open conversation, null for a new one. Existing ones load without animating. */
  conversationId: string | null;
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

  // Only replies that arrive after the conversation opened rise in. History loads in
  // after the first render, so seed on the first non-empty list. A new chat getting its
  // id on the first send keeps its seen-set (no remount); moving to another conversation resets it.
  const seen = useRef<{ conv: string | null; ids: Set<string> | null }>({ conv: conversationId, ids: null });
  if (seen.current.conv !== conversationId) {
    seen.current = seen.current.conv === null ? { ...seen.current, conv: conversationId } : { conv: conversationId, ids: null };
  }
  if (seen.current.ids === null && messages.length > 0) {
    seen.current.ids = new Set(conversationId ? messages.map((m) => m.id) : []);
  }
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
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 md:px-5 md:py-5 2xl:px-8 2xl:py-8">
        {messages.map((m) => (
          <div key={m.id} className={seen.current.ids?.has(m.id) ? undefined : "ppg-pop"}>
          <Message
            message={m}
            streaming={status === "streaming" && m === last && m.role === "assistant"}
            onRemember={onRemember}
          />
          </div>
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
    <div className="px-4 pt-2 pb-4 md:px-5 md:pb-5 2xl:px-8 2xl:pb-6">
      <div className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-xl bg-primary p-1.5 pl-3.5 shadow-xs ring-1 ring-primary ring-inset transition focus-within:ring-brand">
        <textarea
          ref={ref}
          rows={1}
          value={text}
          autoFocus
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask something"
          aria-label="Ask something"
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
