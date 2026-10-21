// The Chat agent (agents.md #8): talks with the operator, answers from the
// tenant's knowledge base and posts, and hands work to the other agents. One
// reply is one streamModel() run (api/_ai/gateway.ts), logged as job "chat";
// its tool calls are read-only lookups or hand-offs, never writes to the
// knowledge base (only the Guardian writes there; Chat can offer Remember).

import {
  BudgetError,
  CostLogUnavailableError,
  DEFAULT_MODEL,
  KeysUnavailableError,
  TenantKeyError,
  UsageLimitError,
  streamModel,
  type ModelMessage,
} from "../_ai/gateway.js";
import { report } from "../_telemetry.js";
import { CitationStream, Sources } from "./citations.js";
import { stylesBlock } from "../_ai/houseStyle.js";
import { siteName, siteStyles } from "./lookups.js";
import { chatTools, historyMessages, systemPrompt } from "./toolkit.js";
import type { AgentName, ChatEvent, ChatUIMessage, Citation, Handoff, QuickAction } from "./types.js";

export { historyMessages };

/**
 * The gateway's DEFAULT_MODEL;
 * CHAT_MODEL overrides it.
 */
export const CHAT_MODEL = process.env.CHAT_MODEL || DEFAULT_MODEL;

export interface ChatTurn {
  site: string;
  userId: string;
  token: string;
  conversationId: string;
  text: string;
  /** Earlier messages of the conversation, oldest first, without this turn. */
  history: ChatUIMessage[];
  signal: AbortSignal;
}

/** "/collective" for https://www.example.com/collective, "the home page" for the root. */
export function pageName(raw: string | undefined): string {
  try {
    const path = new URL(raw || "/", "https://x.invalid").pathname.replace(/\/+$/, "");
    return path ? path : "the home page";
  } catch {
    return "a page";
  }
}

/**
 * The Open button a reply talks about when the model wrote "the button below"
 * without calling offer_open: the first post, pitch or claim it cited, so the
 * reply stays true. Null when it offered one, or said nothing of a button.
 */
export function promisedButton(text: string, cited: Citation[], offered: boolean): QuickAction | null {
  if (offered || !/\bbutton\b/i.test(text)) return null;
  const c = cited.find((x) => x.kind === "post" || x.kind === "brief" || x.kind === "claim");
  if (!c) return null;
  const label = c.kind === "claim" ? "Open the claim" : `Open “${c.label.length > 40 ? `${c.label.slice(0, 38)}…` : c.label}”`;
  return { kind: "open", label, target: { kind: c.kind, id: c.id, label: c.label } };
}

/** What the reader sees for a failure, in their words. Unexpected ones are reported. */
async function failure(err: unknown): Promise<ChatEvent> {
  if (!(err instanceof BudgetError || err instanceof UsageLimitError || err instanceof TenantKeyError)) await report(err, "chat");
  return { type: "error", message: failureMessage(err) };
}

export function failureMessage(err: unknown): string {
  if (err instanceof BudgetError) {
    if (err.reason === "suspended") return "This tenant is suspended, so its model calls are off.";
    return err.reason === "tenant-budget"
      ? "This tenant's model budget for the month is used up."
      : "Model calls are paused for now (the daily cap or the kill switch). An admin can lift it.";
  }
  if (err instanceof UsageLimitError) {
    const at = new Date(err.resetsAt).toISOString().slice(11, 16);
    return `The agents have hit their usage limit until ${at} UTC. Try again after that.`;
  }
  if (err instanceof TenantKeyError) {
    // The provider's own words stay in the cost log, not in the conversation.
    if (err.retryAt) return "The Anthropic key hit its rate limit. Try again in a minute.";
    return "Anthropic refused this tenant's key, or its account is out of credit. An owner can fix it in Settings.";
  }
  if (err instanceof KeysUnavailableError) return "This tenant's own Anthropic key can't be read on this server right now.";
  if (err instanceof CostLogUnavailableError) return "Model usage logging isn't set up on this server, so Chat can't call a model.";
  return "The agent didn't answer. Try again in a moment.";
}

/**
 * One reply, as Chat page events. Ends with `done`, or `error` on a failure;
 * an abort (the reader left or pressed Stop) just ends the stream.
 */
export async function* runChat(turn: ChatTurn): AsyncGenerator<ChatEvent> {
  const sources = new Sources();
  const cites = new CitationStream(sources);
  // A tool result's UI: the hand-off line it updates and the actions it offers.
  const handoffs = new Map<string, Handoff>();
  const pending: QuickAction[] = [];

  let tenant = "this site";
  let tenantStyles = "";
  try {
    tenant = await siteName(turn.token, turn.site);
  } catch {
    // The name only colours the prompt and the tool descriptions.
  }
  try {
    tenantStyles = stylesBlock(await siteStyles(turn.token, turn.site));
  } catch {
    // Without its style rules Chat still answers, on the twenty rules alone.
  }

  const tools = chatTools({ ...turn, tenant, sources, pending });

  // Which agent a lookup shows as, and how its task reads.
  const shown: Record<string, (input: Record<string, string>) => Pick<Handoff, "agent" | "kind" | "task"> | null> = {
    search_knowledge: (i) => ({ agent: "guardian", kind: "lookup", task: `Searched the knowledge base for “${i.query}”` }),
    search_posts: (i) => ({ agent: "chat", kind: "lookup", task: `Searched posts for “${i.query}”` }),
    search_pitches: (i) => ({ agent: "pitcher", kind: "lookup", task: `Searched pitches and ideas for “${i.query}”` }),
    read_goals: () => ({ agent: "strategist", kind: "lookup", task: "Read the goals and the strategy" }),
    read_website: (i) => ({ agent: "chat", kind: "lookup", task: `Read ${pageName(i.url)} on their website` }),
    ask_agent: (i) => ({ agent: i.agent as AgentName, kind: "agent", task: i.task }),
  };
  // What the reply said, cited and offered: a reply that promises a button gets one.
  let said = "";
  const cited: Citation[] = [];
  let offeredOpen = false;
  const watch = (e: ChatEvent): ChatEvent => {
    if (e.type === "text") said += e.delta;
    else if (e.type === "citation") cited.push(e.citation);
    else if (e.type === "action" && e.action.kind === "open") offeredOpen = true;
    return e;
  };

  let stream;
  try {
    stream = await streamModel({
      site: turn.site,
      job: "chat",
      model: CHAT_MODEL,
      background: false, // the operator is waiting: the editor's budget rules
      system: systemPrompt(tenant, tenantStyles),
      messages: [...historyMessages(turn.history), { role: "user", content: turn.text }],
      tools,
      maxSteps: 6,
      maxOutputTokens: 2000,
      abortSignal: turn.signal,
    });
  } catch (err) {
    yield await failure(err);
    return;
  }

  try {
    for await (const part of stream.parts) {
      switch (part.type) {
        case "text-delta":
          for (const e of cites.push(part.text)) yield watch(e);
          break;
        case "tool-call": {
          for (const e of cites.flush()) yield watch(e);
          const view = shown[part.toolName]?.(part.input as Record<string, string>);
          if (view) {
            const h: Handoff = { ...view, status: "running" };
            handoffs.set(part.toolCallId, h);
            yield { type: "handoff", id: part.toolCallId, handoff: h };
          }
          break;
        }
        case "tool-result": {
          const out = part.output as { summary?: string; runId?: string; failed?: boolean };
          const h = handoffs.get(part.toolCallId);
          if (h) {
            const next: Handoff = {
              ...h,
              status: out.failed ? "failed" : out.runId ? "queued" : "done",
              ...(out.summary ? { summary: out.summary } : {}),
              ...(out.runId ? { runId: out.runId } : {}),
            };
            handoffs.set(part.toolCallId, next);
            yield { type: "handoff", id: part.toolCallId, handoff: next };
          }
          for (const a of pending.splice(0)) yield watch({ type: "action", action: a });
          break;
        }
        case "tool-error": {
          const h = handoffs.get(part.toolCallId);
          if (h) yield { type: "handoff", id: part.toolCallId, handoff: { ...h, status: "failed", summary: "Failed" } };
          break;
        }
      }
    }
    for (const e of cites.flush()) yield watch(e);
    // Stopped: the reader already marks the reply; the stopped call is in the cost log.
    if (turn.signal.aborted) return;
    const promised = promisedButton(said, cited, offeredOpen);
    if (promised) yield { type: "action", action: promised };
    yield { type: "done", costUsd: stream.costUsd() };
  } catch (err) {
    yield* cites.flush();
    if (turn.signal.aborted) return;
    yield await failure(err);
  }
}
