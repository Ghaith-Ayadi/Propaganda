// Chat's data hooks. The conversation itself is the Vercel AI SDK's useChat
// (@ai-sdk/react); these add the conversation list, loading and saving, and
// the first-message flow. They talk to chatBackend (adapter.ts), so swapping
// the placeholder for the real backend changes no UI.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { newId } from "@/lib/supabase";
import { reportError, track } from "@/lib/telemetry";
import { chatBackend } from "./adapter";
import type { ChatUIMessage, Conversation } from "./types";

export function useConversations(site: string) {
  const [conversations, setConversations] = useState<Conversation[] | null>(null);

  useEffect(() => {
    let live = true;
    chatBackend
      .listConversations(site)
      .then((cs) => live && setConversations(cs))
      .catch((err) => {
        reportError("chat.listConversations", err);
        if (live) setConversations([]);
      });
    return () => {
      live = false;
    };
  }, [site]);

  const create = useCallback(
    async (id: string) => {
      const c = await chatBackend.createConversation(site, id);
      setConversations((cs) => [c, ...(cs ?? [])]);
      return c;
    },
    [site],
  );

  const remove = useCallback(
    async (id: string) => {
      await chatBackend.deleteConversation(site, id);
      setConversations((cs) => (cs ?? []).filter((c) => c.id !== id));
    },
    [site],
  );

  /** Updates one conversation in the list without a round trip (a new title, a new reply). */
  const touch = useCallback((id: string, patch: Partial<Conversation>) => {
    setConversations((cs) => {
      if (!cs) return cs;
      const next = cs.map((c) => (c.id === id ? { ...c, ...patch, updatedAt: new Date().toISOString() } : c));
      return next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
  }, []);

  return { conversations, create, remove, touch, placeholder: chatBackend.placeholder };
}

/**
 * One conversation. `activeId` is the open conversation, or null for a new
 * chat: then useChat runs on a fresh draft id, and the first message creates
 * the conversation under that same id, so the chat isn't interrupted when the
 * page moves to it.
 */
export function useConversation(
  site: string,
  activeId: string | null,
  opts: {
    create: (id: string) => Promise<Conversation>;
    touch: (id: string, patch: Partial<Conversation>) => void;
    onStarted: (id: string) => void;
  },
) {
  const [draftId, setDraftId] = useState(newId);
  const started = useRef(new Set<string>());
  const chatId = activeId ?? draftId;

  // Back on "New chat" after using the draft: mint the next one.
  useEffect(() => {
    if (activeId === null && started.current.has(draftId)) setDraftId(newId());
  }, [activeId, draftId]);

  const transport = useMemo(() => chatBackend.transport(site), [site]);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const setMessagesRef = useRef<(ms: ChatUIMessage[]) => void>(() => {});

  const chat = useChat<ChatUIMessage>({
    id: chatId,
    transport,
    onData: (part) => {
      if (part.type === "data-title") optsRef.current.touch(chatId, { title: part.data.title });
    },
    onFinish: ({ messages, isAbort, isError }) => {
      let out = messages;
      if (isAbort) {
        const last = out[out.length - 1];
        if (last?.role === "assistant") {
          out = [...out.slice(0, -1), { ...last, metadata: { ...last.metadata, stopped: true } }];
          setMessagesRef.current(out);
        }
      }
      optsRef.current.touch(chatId, {});
      chatBackend.saveMessages(site, chatId, out).catch((err) => reportError("chat.saveMessages", err));
    },
    onError: (err) => reportError("chat.send", err),
  });

  // Opening a saved conversation: load what it said. A conversation this hook
  // just started already has its messages in useChat.
  const [loading, setLoading] = useState(false);
  const { setMessages } = chat;
  setMessagesRef.current = setMessages;
  useEffect(() => {
    if (!activeId || started.current.has(activeId)) return;
    let live = true;
    setLoading(true);
    chatBackend
      .loadMessages(site, activeId)
      .then((ms) => live && setMessages(ms))
      .catch((err) => reportError("chat.loadMessages", err))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [site, activeId, setMessages]);

  const busy = chat.status === "submitted" || chat.status === "streaming";

  const send = useCallback(
    async (text: string) => {
      const body = text.trim();
      if (!body || busy) return;
      if (!activeId) {
        started.current.add(chatId);
        await optsRef.current.create(chatId);
        optsRef.current.onStarted(chatId);
      }
      track("chat_message_sent");
      await chat.sendMessage({ text: body });
    },
    [activeId, chatId, busy, chat],
  );

  const remember = useCallback(
    (statement: string, messageId: string) => chatBackend.remember(site, statement, { conversationId: chatId, messageId }),
    [site, chatId],
  );

  return {
    messages: chat.messages,
    status: chat.status,
    error: chat.error,
    busy,
    loading,
    send,
    stop: chat.stop,
    retry: () => {
      chat.clearError();
      void chat.regenerate();
    },
    remember,
  };
}
