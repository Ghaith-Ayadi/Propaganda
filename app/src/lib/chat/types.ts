// The Chat page's shapes, on the Vercel AI SDK's message model. A message is a
// UIMessage: its text streams as text parts, and what Propaganda adds rides as
// typed data parts (`data-handoff`, `data-citation`, `data-action`). The server
// sends them with the SDK's UI message stream (createUIMessageStream /
// writer.write), and useChat folds them into messages; a data part re-sent with
// the same id replaces the earlier one, which is how a handoff moves from
// queued to done.

import type { UIMessage } from "ai";

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

/**
 * A source the reply relies on, numbered in the order it was first cited. The
 * text marks the spot with a markdown link to `#cite-<n>`.
 */
export interface Citation extends Ref {
  n: number;
  /** The exact passage quoted from the source, when there is one. */
  quote?: string;
}

/** Work the Chat agent handed to another agent (or the knowledge base). */
export interface Handoff {
  agent: AgentName;
  /** What it was asked, in a few words: "Search the knowledge base for SOC 2". */
  task: string;
  status: "queued" | "running" | "done" | "failed";
  /** One line on what came back. */
  summary?: string;
  /** API-price cost of the model calls this step made, from public.model_calls. */
  costUsd?: number;
  /** The DBOS workflow id when the work runs on the worker (Admin › Runs). */
  runId?: string;
}

export interface QuickAction {
  kind: "remember" | "open";
  label: string;
  /** For "open": what to open. */
  target?: Ref;
  /** For "remember": the statement proposed to the Guardian. */
  statement?: string;
}

/** Data parts, by name: `data-handoff` carries a Handoff, and so on. */
export type ChatDataParts = {
  handoff: Handoff;
  citation: Citation;
  action: QuickAction;
  /** Transient: names a new conversation from its first question. */
  title: { title: string };
};

export interface ChatMetadata {
  /** Sum of every model call behind this reply, chat's own included. */
  costUsd?: number;
  /** Set when the operator stopped the reply part way. */
  stopped?: boolean;
}

export type ChatUIMessage = UIMessage<ChatMetadata, ChatDataParts>;

export interface Conversation {
  id: string;
  site: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}
