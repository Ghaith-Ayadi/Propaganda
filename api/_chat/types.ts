// Chat's shapes on the server. The page runs on the Vercel AI SDK's useChat,
// so a message is a UIMessage whose Propaganda-specific parts are typed data
// parts (data-handoff, data-citation, data-action), the same as
// app/src/lib/chat/types.ts (the app and the functions are separate
// packages: change both together). The agent itself speaks ChatEvent, and
// _chat/ui.ts turns those into the SDK's UI message chunks.

import type { UIMessage, UIMessageChunk } from "../_ai/gateway";

export type AgentName = "chat" | "strategist" | "listener" | "scout" | "pitcher" | "writer" | "checker" | "guardian";
export type RefKind = "claim" | "post" | "pitch" | "flag" | "goal" | "run";

export interface Ref {
  kind: RefKind;
  id: string;
  label: string;
}

export interface Citation extends Ref {
  n: number;
  quote?: string;
}

export interface Handoff {
  agent: AgentName;
  task: string;
  status: "queued" | "running" | "done" | "failed";
  summary?: string;
  costUsd?: number;
  runId?: string;
}

export interface QuickAction {
  kind: "remember" | "open";
  label: string;
  target?: Ref;
  statement?: string;
}

export type ChatDataParts = {
  handoff: Handoff;
  citation: Citation;
  action: QuickAction;
  title: { title: string };
};

export interface ChatMetadata {
  costUsd?: number;
  stopped?: boolean;
}

export type ChatUIMessage = UIMessage<ChatMetadata, ChatDataParts>;
export type ChatChunk = UIMessageChunk<ChatMetadata, ChatDataParts>;

export interface Conversation {
  id: string;
  site: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

/** What the agent emits as it works; `id` on a handoff is the tool call it tracks. */
export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "handoff"; id: string; handoff: Handoff }
  | { type: "citation"; citation: Citation }
  | { type: "action"; action: QuickAction }
  | { type: "done"; costUsd: number }
  | { type: "error"; message: string };
