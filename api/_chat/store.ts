// Conversations and messages (draft migration 20261008000003_chat.sql). A
// message is stored as the UIMessage useChat holds, so a conversation reloads
// exactly as it streamed. Server writes only; every query carries the site and
// the account.

import { asServer, eq } from "./db";
import type { ChatUIMessage, Conversation } from "./types";

interface ConversationRow {
  id: string;
  site: string;
  title: string;
  created: string;
  updated: string;
}

interface MessageRow {
  id: string;
  role: "user" | "assistant";
  parts: ChatUIMessage["parts"];
  metadata: ChatUIMessage["metadata"];
}

const toConversation = (r: ConversationRow): Conversation => ({
  id: r.id,
  site: r.site,
  title: r.title,
  createdAt: r.created,
  updatedAt: r.updated,
});

const toMessage = (r: MessageRow): ChatUIMessage => ({ id: r.id, role: r.role, parts: r.parts, metadata: r.metadata ?? {} });

const owned = (site: string, userId: string) => `site=${eq(site)}&user_id=${eq(userId)}`;

export async function listConversations(site: string, userId: string): Promise<Conversation[]> {
  const rows = await asServer().get<ConversationRow[]>(
    `/chat_conversations?select=id,site,title,created,updated&${owned(site, userId)}&order=updated.desc&limit=200`,
  );
  return rows.map(toConversation);
}

export async function getConversation(site: string, userId: string, id: string): Promise<Conversation | null> {
  const [row] = await asServer().get<ConversationRow[]>(
    `/chat_conversations?select=id,site,title,created,updated&${owned(site, userId)}&id=${eq(id)}`,
  );
  return row ? toConversation(row) : null;
}

export async function createConversation(site: string, userId: string, id: string): Promise<Conversation> {
  const [row] = await asServer().post<ConversationRow[]>(
    "/chat_conversations?select=id,site,title,created,updated",
    { id, site, user_id: userId },
    "return=representation",
  );
  return toConversation(row);
}

export async function touchConversation(site: string, userId: string, id: string, title?: string): Promise<void> {
  await asServer().patch(`/chat_conversations?${owned(site, userId)}&id=${eq(id)}`, {
    updated: new Date().toISOString(),
    ...(title ? { title } : {}),
  });
}

export async function deleteConversation(site: string, userId: string, id: string): Promise<void> {
  await asServer().del(`/chat_conversations?${owned(site, userId)}&id=${eq(id)}`);
}

export async function listMessages(site: string, userId: string, conversation: string, limit = 500): Promise<ChatUIMessage[]> {
  // Newest `limit`, returned oldest first.
  const rows = await asServer().get<MessageRow[]>(
    `/chat_messages?select=id,role,parts,metadata&${owned(site, userId)}&conversation=${eq(conversation)}` +
      `&order=created.desc&limit=${limit}`,
  );
  return rows.reverse().map(toMessage);
}

/** Stores a message. Sent twice (a retried request), the first copy stays. */
export async function saveMessage(site: string, userId: string, conversation: string, m: ChatUIMessage): Promise<void> {
  await asServer().post(
    "/chat_messages?on_conflict=conversation,id",
    { id: m.id, site, conversation, user_id: userId, role: m.role, parts: m.parts, metadata: m.metadata ?? {} },
    "resolution=ignore-duplicates,return=minimal",
  );
}

/** Regenerating a reply replaces it: the conversation's last reply goes. */
export async function deleteMessage(site: string, userId: string, conversation: string, id: string): Promise<void> {
  await asServer().del(`/chat_messages?${owned(site, userId)}&conversation=${eq(conversation)}&id=${eq(id)}`);
}
