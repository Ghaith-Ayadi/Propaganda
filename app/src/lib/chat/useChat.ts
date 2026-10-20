// Chat's data hooks. The conversation itself is the Vercel AI SDK's useChat
// (@ai-sdk/react); these add the conversation list, loading and saving, and
// the first-message flow. They talk to chatBackend (adapter.ts), so swapping
// the placeholder for the real backend changes no UI.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chat, useChat } from "@ai-sdk/react";
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
      dropLiveChat(site, id);
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

/** What a conversation's Chat reports to the page showing it, kept current by useConversation. */
interface Listener {
  touch: (id: string, patch: Partial<Conversation>) => void;
}

interface Live {
  chat: Chat<ChatUIMessage>;
  /** Its messages came from the server, or it started here: never load over it. */
  loaded: boolean;
}

/**
 * Conversations live outside the page: one Chat per (site, conversation) for
 * the whole visit. Leaving the Chat page, or switching conversation, used to
 * drop useChat's own instance, which stopped a reply mid-stream and lost
 * what the next load hadn't stored yet; now a reply keeps streaming and the
 * conversation is as it was when the reader comes back.
 */
const live = new Map<string, Live>();
const listeners = new Map<string, Listener>();
const MAX_LIVE = 30;

function liveChat(site: string, id: string): Live {
  const key = `${site}:${id}`;
  const found = live.get(key);
  if (found) {
    // Most recently used last, so the oldest idle one goes first.
    live.delete(key);
    live.set(key, found);
    return found;
  }
  const entry: Live = {
    loaded: false,
    chat: new Chat<ChatUIMessage>({
      id,
      transport: chatBackend.transport(site),
      onData: (part) => {
        if (part.type === "data-title") listeners.get(site)?.touch(id, { title: part.data.title });
      },
      onFinish: ({ messages, isAbort }) => {
        let out = messages;
        if (isAbort) {
          const last = out[out.length - 1];
          if (last?.role === "assistant") {
            out = [...out.slice(0, -1), { ...last, metadata: { ...last.metadata, stopped: true } }];
            entry.chat.messages = out;
          }
        }
        listeners.get(site)?.touch(id, {});
        chatBackend.saveMessages(site, id, out).catch((err) => reportError("chat.saveMessages", err));
      },
      onError: (err) => reportError("chat.send", err),
    }),
  };
  live.set(key, entry);
  for (const [k, v] of live) {
    if (live.size <= MAX_LIVE) break;
    if (v.chat.status === "ready" || v.chat.status === "error") live.delete(k);
  }
  return entry;
}

/** Forgets a deleted conversation's live state. */
export function dropLiveChat(site: string, id: string) {
  live.get(`${site}:${id}`)?.chat.stop();
  live.delete(`${site}:${id}`);
}

/**
 * One conversation. `activeId` is the open conversation, or null for a new
 * chat: then it runs on a fresh draft id, and the first message creates the
 * conversation under that same id, so the chat isn't interrupted when the
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
  const chatId = activeId ?? draftId;
  const entry = useMemo(() => liveChat(site, chatId), [site, chatId]);

  const optsRef = useRef(opts);
  optsRef.current = opts;
  useEffect(() => {
    listeners.set(site, { touch: (id, patch) => optsRef.current.touch(id, patch) });
  }, [site]);

  // Back on "New chat" after the draft became a conversation: mint the next draft.
  useEffect(() => {
    if (activeId === null && live.get(`${site}:${draftId}`)?.loaded) setDraftId(newId());
  }, [activeId, draftId, site]);

  const chat = useChat<ChatUIMessage>({ chat: entry.chat });

  // Opening a saved conversation: load what it said, once per visit. One that
  // is streaming or was started here already holds its messages.
  const [loadingId, setLoadingId] = useState<string | null>(null);
  useEffect(() => {
    if (!activeId || entry.loaded) return;
    entry.loaded = true;
    setLoadingId(activeId);
    chatBackend
      .loadMessages(site, activeId)
      .then((ms) => {
        // A reply that began while this loaded wins over the stored copy.
        if (entry.chat.messages.length === 0) entry.chat.messages = ms;
      })
      .catch((err) => {
        entry.loaded = false;
        reportError("chat.loadMessages", err);
      })
      .finally(() => setLoadingId((cur) => (cur === activeId ? null : cur)));
  }, [site, activeId, entry]);
  const loading = loadingId !== null && loadingId === activeId;

  const busy = chat.status === "submitted" || chat.status === "streaming";

  const send = useCallback(
    async (text: string) => {
      const body = text.trim();
      if (!body || busy) return;
      if (!activeId) {
        entry.loaded = true;
        await optsRef.current.create(chatId);
        optsRef.current.onStarted(chatId);
      }
      track("chat_message_sent");
      await chat.sendMessage({ text: body });
    },
    [activeId, chatId, busy, chat, entry],
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
