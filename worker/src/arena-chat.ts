// The Arena's Chat test: a turn captured from a tenant's real conversation,
// replayed on any model with Chat's own system prompt and tools
// (api/_chat/toolkit.ts, the code that shipped). The tools answer from the
// tenant's data, read only; the ones with side effects (ask_agent, the Remember
// and Open buttons) are recorded and answered without starting anything.
// The captured reply is shown beside the new ones as "Before".

import { streamModel } from "../../api/_ai/gateway";
import { Sources } from "../../api/_chat/citations.js";
import { chatTools, historyMessages, systemPrompt } from "../../api/_chat/toolkit.js";
import type { ChatUIMessage, QuickAction } from "../../api/_chat/types.js";
import { HttpError } from "./auth.js";
import { enc, select } from "./agents/backend.js";
import { getSite } from "./agents/store.js";

export const CHAT_MAX_STEPS = 6;
export const CHAT_OUTPUT_TOKENS = 2000;

export interface ChatCaseRow {
  /** "<conversation>-<turn>", turn counted from 1. */
  id: string;
  title: string;
}

export interface ChatBefore {
  text: string;
  model: string;
  costUsd: number;
  at: string;
}

interface MessageRow {
  id: string;
  role: "user" | "assistant";
  parts: ChatUIMessage["parts"];
  metadata: ChatUIMessage["metadata"];
  created: string;
}

const textOf = (m: Pick<ChatUIMessage, "parts">) =>
  m.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("")
    .trim();

async function messages(site: string, conversation: string): Promise<MessageRow[]> {
  return select<MessageRow>(
    "chat_messages",
    `site=eq.${enc(site)}&conversation=eq.${enc(conversation)}&select=id,role,parts,metadata,created&order=created&limit=200`,
  );
}

/** Every operator message of the tenant's conversations, each a case. */
export async function chatCases(site: string): Promise<ChatCaseRow[]> {
  const convs = await select<{ id: string; title: string }>("chat_conversations", `site=eq.${enc(site)}&select=id,title&order=updated.desc&limit=20`);
  const out: ChatCaseRow[] = [];
  for (const c of convs) {
    let turn = 0;
    for (const m of await messages(site, c.id)) {
      if (m.role !== "user") continue;
      turn++;
      out.push({ id: `${c.id}-${turn}`, title: textOf(m).slice(0, 120) || "(no text)" });
    }
  }
  return out;
}

export interface ChatCase {
  tenant: string;
  system: string;
  history: ModelHistory;
  user: string;
  before: ChatBefore | null;
}
type ModelHistory = ReturnType<typeof historyMessages>;

export async function loadChatCase(site: string, caseId: string): Promise<ChatCase> {
  const m = /^([a-z0-9]{15})-(\d{1,3})$/.exec(caseId);
  if (!m) throw new HttpError(400, "Pick a conversation turn.");
  const all = await messages(site, m[1]!);
  const turn = Number(m[2]);
  const at = all.findIndex((r, i) => r.role === "user" && all.slice(0, i + 1).filter((x) => x.role === "user").length === turn);
  if (at < 0) throw new HttpError(404, "No such turn for this tenant");
  const user = all[at]!;
  const reply = all.slice(at + 1).find((r) => r.role === "assistant" || r.role === "user");
  const tenant = (await getSite(site))?.name ?? "this tenant";
  const history = historyMessages(all.slice(0, at).map((r) => ({ id: r.id, role: r.role, parts: r.parts, metadata: r.metadata ?? {} }) as ChatUIMessage));
  return {
    tenant,
    system: systemPrompt(tenant),
    history,
    user: textOf(user as unknown as ChatUIMessage),
    before:
      reply && reply.role === "assistant"
        ? { text: textOf(reply as unknown as ChatUIMessage), model: "as it ran", costUsd: reply.metadata?.costUsd ?? 0, at: reply.created }
        : null,
  };
}

export interface ChatReplay {
  text: string;
  /** What Chat looked up and offered, in order. */
  calls: { tool: string; input: unknown; result: string }[];
  costUsd: number;
}

/** One model's reply to the captured turn, with the real tools. */
export async function replayChat(opts: { c: ChatCase; site: string; arenaSite: string; model: string }): Promise<ChatReplay> {
  const { c } = opts;
  const sources = new Sources();
  const pending: QuickAction[] = [];
  const token = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const tools = chatTools({
    site: opts.site,
    tenant: c.tenant,
    userId: "arena",
    token,
    conversationId: "arena",
    sources,
    pending,
    ask: async (agent) => ({ started: false, reason: `not started: this is an Arena replay (${agent})` }),
  });
  const stream = await streamModel({
    site: opts.arenaSite,
    job: "arena:chat",
    model: opts.model,
    background: true,
    system: c.system,
    messages: [...c.history, { role: "user", content: c.user }],
    tools,
    maxSteps: CHAT_MAX_STEPS,
    maxOutputTokens: CHAT_OUTPUT_TOKENS,
  });
  const calls: ChatReplay["calls"] = [];
  const names = new Map<string, { tool: string; input: unknown }>();
  let text = "";
  for await (const part of stream.parts) {
    if (part.type === "text-delta") text += part.text;
    else if (part.type === "tool-call") names.set(part.toolCallId, { tool: part.toolName, input: part.input });
    else if (part.type === "tool-result") {
      const n = names.get(part.toolCallId);
      const out = part.output as { result?: string; summary?: string } | string;
      calls.push({ tool: n?.tool ?? part.toolName, input: n?.input, result: typeof out === "string" ? out : (out.result ?? out.summary ?? "").slice(0, 4000) });
    } else if (part.type === "tool-error") {
      const n = names.get(part.toolCallId);
      calls.push({ tool: n?.tool ?? part.toolName, input: n?.input, result: "The tool failed." });
    }
  }
  return { text: text.trim(), calls, costUsd: stream.costUsd() };
}
