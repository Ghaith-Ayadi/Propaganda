// The Chat agent (agents.md #8): talks with the operator, answers from the
// tenant's knowledge base and posts, and hands work to the other agents. One
// reply is one streamModel() run (api/_ai/gateway.ts), logged as job "chat";
// its tool calls are read-only lookups or hand-offs, never writes to the
// knowledge base (only the Guardian writes there; Chat can offer Remember).

import { z } from "zod";
import {
  BudgetError,
  CostLogUnavailableError,
  KeysUnavailableError,
  TenantKeyError,
  UsageLimitError,
  streamModel,
  tool,
  type ModelMessage,
} from "../_ai/gateway";
import { report } from "../_telemetry";
import { CitationStream, Sources } from "./citations";
import { DISPATCHABLE, dispatch } from "./dispatch";
import { searchKnowledge, searchPosts, siteName } from "./lookups";
import type { AgentName, ChatEvent, ChatUIMessage, Handoff, QuickAction } from "./types";

/**
 * Sonnet, per agents.md. The id is the AI Gateway's (on a tenant's own key the
 * gateway asks Anthropic for claude-sonnet-5-5); CHAT_MODEL overrides it.
 */
export const CHAT_MODEL = process.env.CHAT_MODEL || "anthropic/claude-sonnet-5.5";

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

const AGENT_JOBS: Record<string, string> = {
  strategist: "proposes the quarter's goals and watches them",
  listener: "reads call transcripts and Slack for ideas and candidate facts",
  scout: "finds outside ideas: searches, AI answers, news, watched sites",
  pitcher: "turns ideas into pitches rated against the goals",
  writer: "writes a post from an approved brief",
  checker: "checks a post in review against its sources and the knowledge base",
};

function systemPrompt(tenant: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `You are Chat, one of Propaganda's agents, talking with an operator of ${tenant}'s content. Today is ${today}.

Propaganda keeps a knowledge base of what ${tenant} actually believes (claims, each one plain sentence, settled or contested) and turns it into posts. You answer questions about their content, goals and knowledge, and you hand work to the other agents.

How you work:
1. Look things up before answering anything about ${tenant}: search_knowledge for what they believe, search_posts for what they've written. Search with a few distinctive words, not the whole question. Never state a fact about ${tenant} that no tool returned; if the knowledge base has nothing, say so plainly.
2. Cite every claim and post you rely on by writing its marker right after the words it backs, exactly as the tool gave it: [[claim:<id>]] or [[post:<id>]]. Only cite what a tool returned in this conversation turn.
3. A contested claim is not settled: say it is contested when you use it.
4. You never change the knowledge base. When the operator states a fact about ${tenant} that the knowledge base lacks, or contradicts one, call offer_remember with that fact as one plain sentence; the Guardian reviews it. Say you've offered it, don't claim it's saved.
5. Work that takes longer than a reply goes to another agent with ask_agent: ${Object.entries(AGENT_JOBS).map(([a, j]) => `${a} (${j})`).join("; ")}. Tell the operator what you asked and that it runs in the background. If the tool says the agent isn't running yet, say so and answer what you can yourself.
6. When the operator should look at a specific post or claim, call offer_open.

Writing: short, plain, direct. Lead with the answer. Markdown is fine, but no headings for short answers. Never use the "That's not X. It's Y." contrast; say it as a comparison instead ("This is much more of a maintenance job than it is the ol' art of writing"). Never write the ids yourself outside a marker.`;
}

/** The conversation so far, as the model sees it: text only, citations named, hand-offs summarized. */
export function historyMessages(history: ChatUIMessage[], maxChars = 40_000): ModelMessage[] {
  const out: ModelMessage[] = [];
  let used = 0;
  for (const m of [...history].reverse()) {
    const labels = new Map<number, string>();
    for (const p of m.parts) if (p.type === "data-citation") labels.set(p.data.n, p.data.label);
    const text = m.parts
      .map((p) => {
        if (p.type === "text") return p.text.replace(/\[(\d+)\]\(#cite-\d+\)/g, (_, n) => ` [source: ${labels.get(Number(n)) ?? n}]`);
        if (p.type === "data-handoff") {
          const h = p.data;
          return `(${h.agent}: ${h.task}${h.summary ? `: ${h.summary}` : ""}, ${h.status})`;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
    if (!text) continue;
    used += text.length;
    if (used > maxChars) break;
    out.push({ role: m.role === "user" ? "user" : "assistant", content: m.metadata?.stopped ? `${text}\n(stopped by the operator)` : text });
  }
  return out.reverse();
}

/** What the reader sees for a failure, in their words. Unexpected ones are reported. */
async function failure(err: unknown): Promise<ChatEvent> {
  if (!(err instanceof BudgetError || err instanceof UsageLimitError || err instanceof TenantKeyError)) await report(err, "chat");
  return { type: "error", message: failureMessage(err) };
}

export function failureMessage(err: unknown): string {
  if (err instanceof BudgetError) {
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
    return err.retryAt
      ? "Your Anthropic key hit its rate limit. Try again in a minute."
      : "Anthropic refused this tenant's own key, or its account is out of credit. An owner can fix it in Settings.";
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

  const tools = {
    search_knowledge: tool({
      description: `Search ${"the tenant's"} knowledge base (claims) by keywords. Returns the nearest claims with their markers.`,
      inputSchema: z.object({ query: z.string().min(2).max(200).describe("A few distinctive words") }),
      execute: async ({ query }) => {
        const r = await searchKnowledge(turn.token, turn.site, query);
        if (!r.available) return { summary: "The knowledge base isn't set up yet", result: "The knowledge base isn't set up yet. Nothing to cite." };
        for (const c of r.claims) sources.add({ kind: "claim", id: c.id, label: c.text });
        return {
          summary: r.claims.length ? `${r.claims.length} claim${r.claims.length === 1 ? "" : "s"} match` : "Nothing matches",
          result: r.claims.length
            ? r.claims.map((c) => `[[claim:${c.id}]] ${c.text}${c.status === "contested" ? " (CONTESTED)" : ""}${c.topics.length ? ` — topics: ${c.topics.join(", ")}` : ""}`).join("\n")
            : "No claims match.",
        };
      },
    }),
    search_posts: tool({
      description: "Search the tenant's posts (drafts and published) by keywords. Returns titles, status and the passage around the match.",
      inputSchema: z.object({ query: z.string().min(2).max(200).describe("A few distinctive words") }),
      execute: async ({ query }) => {
        const posts = await searchPosts(turn.token, turn.site, query);
        for (const p of posts) sources.add({ kind: "post", id: p.id, label: p.title });
        return {
          summary: posts.length ? `${posts.length} post${posts.length === 1 ? "" : "s"} found` : "No posts match",
          result: posts.length
            ? posts.map((p) => `[[post:${p.id}]] "${p.title}" (${p.status}${p.collection ? `, ${p.collection}` : ""}${p.publishedAt ? `, published ${p.publishedAt.slice(0, 10)}` : ""})\n${p.excerpt}`).join("\n\n")
            : "No posts match.",
        };
      },
    }),
    ask_agent: tool({
      description: "Hand work to another agent. It runs in the background; the operator sees it in the reply.",
      inputSchema: z.object({
        agent: z.enum(DISPATCHABLE),
        task: z.string().min(3).max(300).describe("What to do, in a few words, as the operator would read it"),
      }),
      execute: async ({ agent, task }) => {
        const r = await dispatch(agent, { site: turn.site, task, requestedBy: turn.userId, conversation: turn.conversationId });
        return r.started
          ? { summary: "Started", runId: r.runId, result: `The ${agent} has started (run ${r.runId}).` }
          : { summary: `Not available: ${r.reason}`, failed: true, result: `The ${agent} could not start: ${r.reason}.` };
      },
    }),
    offer_remember: tool({
      description: "Offer the operator a Remember button for one fact about the tenant, which goes to the Guardian for review.",
      inputSchema: z.object({ statement: z.string().min(5).max(1000).describe("One plain sentence, no names of people") }),
      execute: async ({ statement }) => {
        pending.push({ kind: "remember", label: "Remember this", statement });
        return { result: "Offered. The operator decides." };
      },
    }),
    offer_open: tool({
      description: "Offer a button that opens a post or claim returned by a search in this turn.",
      inputSchema: z.object({ kind: z.enum(["post", "claim"]), id: z.string() }),
      execute: async ({ kind, id }) => {
        const ref = sources.get(kind, id);
        if (!ref) return { result: "Unknown id: only offer what a search returned." };
        pending.push({
          kind: "open",
          label: kind === "post" ? `Open “${ref.label.length > 40 ? `${ref.label.slice(0, 38)}…` : ref.label}”` : "Open the claim",
          target: { kind, id, label: ref.label },
        });
        return { result: "Offered." };
      },
    }),
  };

  // Which agent a lookup shows as, and how its task reads.
  const shown: Record<string, (input: Record<string, string>) => { agent: AgentName; task: string } | null> = {
    search_knowledge: (i) => ({ agent: "guardian", task: `Search the knowledge base for “${i.query}”` }),
    search_posts: (i) => ({ agent: "chat", task: `Search posts for “${i.query}”` }),
    ask_agent: (i) => ({ agent: i.agent as AgentName, task: i.task }),
  };

  let tenant = "this tenant";
  try {
    tenant = await siteName(turn.token, turn.site);
  } catch {
    // The name only colours the prompt.
  }

  let stream;
  try {
    stream = await streamModel({
      site: turn.site,
      job: "chat",
      model: CHAT_MODEL,
      background: false, // the operator is waiting: the editor's budget rules
      system: systemPrompt(tenant),
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
          yield* cites.push(part.text);
          break;
        case "tool-call": {
          yield* cites.flush();
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
          for (const a of pending.splice(0)) yield { type: "action", action: a };
          break;
        }
        case "tool-error": {
          const h = handoffs.get(part.toolCallId);
          if (h) yield { type: "handoff", id: part.toolCallId, handoff: { ...h, status: "failed", summary: "Failed" } };
          break;
        }
      }
    }
    yield* cites.flush();
    // Stopped: the reader already marks the reply; the stopped call is in the cost log.
    if (turn.signal.aborted) return;
    yield { type: "done", costUsd: stream.costUsd() };
  } catch (err) {
    yield* cites.flush();
    if (turn.signal.aborted) return;
    yield await failure(err);
  }
}
