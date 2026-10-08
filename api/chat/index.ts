// POST /api/chat   The Chat page's useChat transport (DefaultChatTransport):
//   { site, id, trigger, messageId, message }
// `id` is the conversation, `message` the person's newest message (the server
// keeps the history). Stores it, then answers with the Vercel AI SDK's UI
// message stream (createUIMessageStream): text, data-handoff parts re-sent
// under the same id as their status moves, data-citation, data-action, a
// transient data-title on a conversation's first reply, and messageMetadata
// { costUsd } on finish. The reply is stored as it ends, stopped ones too.
// Model calls go through the gateway (job "chat"); a stopped reply's call is
// logged as well.

import { waitUntil } from "@vercel/functions";
import { createUIMessageStream, createUIMessageStreamResponse } from "../_ai/gateway";
import { report, withTelemetry } from "../_telemetry";
import { runChat } from "../_chat/agent";
import { ID_RE, backendFailure, json, member } from "../_chat/http";
import { deleteMessage, getConversation, listMessages, saveMessage, touchConversation } from "../_chat/store";
import type { ChatChunk, ChatUIMessage } from "../_chat/types";
import { UiReply } from "../_chat/ui";

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(15));
  return Array.from(bytes, (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("");
}

/** useChat mints the person's message ids (16 letters and digits by default). */
const MESSAGE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** The first message names the conversation. */
export function titleFrom(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 48 ? `${line.slice(0, 45).trimEnd()}…` : line;
}

interface Body {
  site?: unknown;
  id?: unknown;
  trigger?: unknown;
  messageId?: unknown;
  message?: { id?: unknown; role?: unknown; parts?: unknown };
}

async function handle(request: Request): Promise<Response> {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const user = await member(request, body.site);
  if (user instanceof Response) return user;
  const site = body.site as string;
  const conversationId = typeof body.id === "string" ? body.id : "";
  if (!ID_RE.test(conversationId)) return json({ error: "Invalid id" }, 400);
  const regenerate = body.trigger === "regenerate-message";
  if (!regenerate && body.trigger !== "submit-message") return json({ error: "Invalid trigger" }, 400);

  // Only the person's words are kept from what the browser sends.
  const m = body.message;
  const parts = Array.isArray(m?.parts) ? (m.parts as { type?: unknown; text?: unknown }[]) : [];
  const text = parts
    .map((p) => (p?.type === "text" && typeof p.text === "string" ? p.text : ""))
    .join("")
    .trim();
  if (m?.role !== "user" || typeof m.id !== "string" || !MESSAGE_ID_RE.test(m.id)) {
    return json({ error: "message must be the person's newest message" }, 400);
  }
  if (!text || text.length > 20_000) return json({ error: "message text must be 1 to 20000 characters" }, 400);
  const asked: ChatUIMessage = { id: m.id, role: "user", parts: [{ type: "text", text }], metadata: {} };

  let history: ChatUIMessage[];
  let first = false;
  try {
    if (!(await getConversation(site, user.userId, conversationId))) return json({ error: "No such conversation" }, 404);
    history = (await listMessages(site, user.userId, conversationId, 40)).filter((h) => h.id !== asked.id);
    // Only a conversation's first reply names it (a retried first reply already did).
    first = history.length === 0;
    // Regenerating (Retry) replaces the reply after the question.
    const last = history[history.length - 1];
    if (regenerate && last?.role === "assistant") {
      await deleteMessage(site, user.userId, conversationId, last.id);
      history.pop();
    }
    await saveMessage(site, user.userId, conversationId, asked);
  } catch (err) {
    return backendFailure(err);
  }

  const stop = new AbortController();
  request.signal?.addEventListener("abort", () => stop.abort(), { once: true });
  const title = first ? titleFrom(text) : undefined;

  const stream = createUIMessageStream<ChatUIMessage>({
    execute: ({ writer }) => {
      // Told when the reader goes (closed tab, Stop): the merged stream is
      // cancelled with the response, which aborts the model call.
      let closeWatch = () => {};
      writer.merge(
        new ReadableStream<ChatChunk>({
          start: (c) => {
            closeWatch = () => {
              try {
                c.close();
              } catch {
                // already cancelled
              }
            };
          },
          cancel: () => stop.abort(),
        }),
      );
      const reply = new UiReply((chunk) => writer.write(chunk), newId, newId());
      const work = (async () => {
        try {
          if (title) reply.title(title);
          for await (const e of runChat({
            site,
            userId: user.userId,
            token: user.token,
            conversationId,
            text,
            history,
            signal: stop.signal,
          })) {
            reply.push(e);
          }
          if (stop.signal.aborted) reply.stopped();
        } catch (err) {
          await report(err, "chat");
          reply.push({ type: "error", message: "The agent didn't answer. Try again in a moment." });
        } finally {
          // Kept even when the reader left: the stopped part is part of the conversation.
          if (reply.message.parts.length > 0) {
            await saveMessage(site, user.userId, conversationId, reply.message).catch((err) =>
              report(err, "chat", { step: "save reply" }),
            );
          }
          await touchConversation(site, user.userId, conversationId, title).catch((err) =>
            report(err, "chat", { step: "touch conversation" }),
          );
          closeWatch();
        }
      })();
      // The function stays alive to log and store a reply the reader stopped.
      waitUntil(work);
      return work;
    },
  });

  return createUIMessageStreamResponse({ stream, headers: { "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}

export const POST = withTelemetry("chat", handle);
