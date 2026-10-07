// The Chat page's shapes. A conversation belongs to one tenant (site) and one
// account; a message is a list of parts so a single reply can carry text, the
// agents it handed work to, its sources and the actions it offers.
//
// The server streams a reply as ChatEvent lines (one JSON object per line,
// application/x-ndjson); applyEvent() in useChat.ts folds them into a message.

/** The agents of 0.2 (see /mnt/project-files/reviews/agents.md). */
export type AgentName =
  | "chat"
  | "strategist"
  | "listener"
  | "scout"
  | "pitcher"
  | "writer"
  | "checker"
  | "guardian";

/** Something a reply can point at. `id` is the object's own id in its table. */
export type RefKind = "claim" | "post" | "pitch" | "flag" | "goal" | "run";

export interface Ref {
  kind: RefKind;
  id: string;
  /** What the reader sees: a post title, a claim's statement. */
  label: string;
}

/** A source the reply relies on, numbered in the order it was first cited. */
export interface Citation extends Ref {
  n: number;
  /** The exact span quoted from the source, when there is one. */
  quote?: string;
}

/** Work the Chat agent handed to another agent (or the knowledge base). */
export interface Handoff {
  id: string;
  agent: AgentName;
  /** What it was asked, in a few words: "Search the knowledge base for SOC 2". */
  task: string;
  status: "running" | "done" | "failed" | "queued";
  /** One line on what came back. */
  summary?: string;
  /** API-price cost of the model calls this step made, from public.model_calls. */
  costUsd?: number;
  /** The DBOS workflow id when the work runs on the worker (Admin › Runs). */
  runId?: string;
}

export type QuickActionKind = "remember" | "open";

export interface QuickAction {
  id: string;
  kind: QuickActionKind;
  label: string;
  /** For "open": what to open. */
  target?: Ref;
  /** For "remember": the statement proposed to the Guardian. */
  statement?: string;
}

export type MessagePart =
  | { type: "text"; text: string }
  | { type: "handoff"; handoff: Handoff };

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  parts: MessagePart[];
  citations: Citation[];
  actions: QuickAction[];
  status: "streaming" | "done" | "stopped" | "error";
  error?: string;
  /** Sum of every model call behind this reply, chat's own included. */
  costUsd?: number;
  createdAt: string;
}

export interface Conversation {
  id: string;
  site: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

/** One line of the reply stream. */
export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "handoff"; handoff: Handoff }
  | { type: "citation"; citation: Citation }
  | { type: "action"; action: QuickAction }
  | { type: "title"; title: string }
  | { type: "done"; costUsd: number }
  | { type: "error"; message: string };
