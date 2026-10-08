// Chat's data hooks. The page talks to these; these talk to the adapter
// (adapter.ts), so swapping the placeholder for the real backend changes no UI.

import { useCallback, useEffect, useRef, useState } from "react";
import { newId } from "@/lib/supabase";
import { reportError, track } from "@/lib/telemetry";
import { chatAdapter } from "./adapter";
import type { ChatEvent, ChatMessage, Conversation } from "./types";

/** Folds one stream event into the reply being built. Pure, so it is easy to test. */
export function applyEvent(m: ChatMessage, e: ChatEvent): ChatMessage {
  switch (e.type) {
    case "text": {
      const parts = [...m.parts];
      const last = parts[parts.length - 1];
      if (last?.type === "text") parts[parts.length - 1] = { type: "text", text: last.text + e.delta };
      else parts.push({ type: "text", text: e.delta });
      return { ...m, parts };
    }
    case "handoff": {
      const i = m.parts.findIndex((p) => p.type === "handoff" && p.handoff.id === e.handoff.id);
      const part = { type: "handoff" as const, handoff: e.handoff };
      if (i < 0) return { ...m, parts: [...m.parts, part] };
      const parts = [...m.parts];
      parts[i] = part;
      return { ...m, parts };
    }
    case "citation": {
      // The marker goes where the text has got to, so the number sits after the
      // words it backs. A source cited twice keeps its first number.
      const known = m.citations.find((c) => c.id === e.citation.id && c.kind === e.citation.kind);
      const n = known?.n ?? e.citation.n;
      const withMarker = applyEvent(m, { type: "text", delta: `[${n}](#cite-${n})` });
      return known ? withMarker : { ...withMarker, citations: [...m.citations, e.citation] };
    }
    case "action":
      return { ...m, actions: [...m.actions, e.action] };
    case "done":
      return { ...m, status: "done", costUsd: e.costUsd };
    case "error":
      return { ...m, status: "error", error: e.message };
    case "title":
      return m;
  }
}

export function useConversations(site: string) {
  const [conversations, setConversations] = useState<Conversation[] | null>(null);

  const refresh = useCallback(async () => {
    try {
      setConversations(await chatAdapter.listConversations(site));
    } catch (err) {
      reportError("chat.listConversations", err);
      setConversations([]);
    }
  }, [site]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(async () => {
    const c = await chatAdapter.createConversation(site);
    setConversations((cs) => [c, ...(cs ?? [])]);
    return c;
  }, [site]);

  const remove = useCallback(
    async (id: string) => {
      await chatAdapter.deleteConversation(site, id);
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

  return { conversations, create, remove, touch, refresh, placeholder: chatAdapter.placeholder };
}

export function useConversation(site: string, conversationId: string | null, onTouch?: (id: string, patch: Partial<Conversation>) => void) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // A conversation started by send() itself: the page moves to it while the
  // reply streams, and that move must not reload or stop anything.
  const startedRef = useRef<string | null>(null);

  useEffect(() => {
    if (conversationId && conversationId === startedRef.current) return;
    startedRef.current = null;
    abortRef.current?.abort();
    setMessages([]);
    if (!conversationId) return;
    let live = true;
    setLoading(true);
    chatAdapter
      .listMessages(site, conversationId)
      .then((ms) => live && setMessages(ms))
      .catch((err) => reportError("chat.listMessages", err))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [site, conversationId]);

  // Leaving the page stops the reply (the stopped part is kept).
  useEffect(() => () => abortRef.current?.abort(), []);

  const send = useCallback(
    async (text: string, toConversation?: string) => {
      const convId = toConversation ?? conversationId;
      const body = text.trim();
      if (!convId || !body || streaming) return;
      if (toConversation && toConversation !== conversationId) startedRef.current = toConversation;

      const created = new Date().toISOString();
      const user: ChatMessage = {
        id: newId(), conversationId: convId, role: "user", parts: [{ type: "text", text: body }],
        citations: [], actions: [], status: "done", createdAt: created,
      };
      let reply: ChatMessage = {
        id: newId(), conversationId: convId, role: "assistant", parts: [],
        citations: [], actions: [], status: "streaming", createdAt: created,
      };
      setMessages((ms) => [...ms, user, reply]);
      setStreaming(true);
      track("chat_message_sent");

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const put = (m: ChatMessage) => setMessages((ms) => ms.map((x) => (x.id === m.id ? m : x)));

      try {
        for await (const e of chatAdapter.send(site, convId, body, ctrl.signal)) {
          if (e.type === "title") onTouch?.(convId, { title: e.title });
          reply = applyEvent(reply, e);
          put(reply);
        }
        if (reply.status === "streaming") reply = { ...reply, status: "done" };
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          reply = { ...reply, status: "stopped" };
        } else {
          reportError("chat.send", err);
          reply = { ...reply, status: "error", error: "The agent didn't answer. Try again in a moment." };
        }
      } finally {
        put(reply);
        setStreaming(false);
        abortRef.current = null;
        onTouch?.(convId, {});
        await chatAdapter.saveMessage(site, reply).catch((err) => reportError("chat.saveMessage", err));
      }
    },
    [site, conversationId, streaming, onTouch],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const remember = useCallback(
    (statement: string, messageId: string) =>
      chatAdapter.remember(site, statement, { conversationId: conversationId ?? "", messageId }),
    [site, conversationId],
  );

  return { messages, loading, streaming, send, stop, remember };
}
