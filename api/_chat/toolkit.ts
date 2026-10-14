// What Chat is made of, apart from the stream that serves it: its system
// prompt, the conversation as the model sees it, and its tools. The Chat reply
// (agent.ts) and the Arena's replay of a captured turn (worker/src/arena.ts)
// both build from here, so a replay runs the tools and prompt that shipped.

import { z } from "zod";
import { tool, type ModelMessage } from "../_ai/gateway.js";
import { HOUSE_STYLE } from "../_ai/houseStyle.js";
import type { Sources } from "./citations.js";
import { DISPATCHABLE, dispatch, type DispatchResult } from "./dispatch.js";
import { readGoals, searchKnowledge, searchPosts } from "./lookups.js";
import type { ChatUIMessage, QuickAction } from "./types.js";

const AGENT_JOBS: Record<string, string> = {
  strategist: "proposes the quarter's goals and watches them",
  listener: "reads call transcripts and Slack for ideas and candidate facts",
  scout: "finds outside ideas: searches, AI answers, news, watched sites",
  pitcher: "turns ideas into pitches rated against the goals",
  writer: "writes a post from an approved brief",
  checker: "checks a post in review against its sources and the knowledge base",
};

export function systemPrompt(tenant: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `You are Chat, one of Propaganda's agents, talking with an operator of ${tenant}'s content. Today is ${today}.

Propaganda keeps a knowledge base of what ${tenant} actually believes (claims, each one plain sentence, settled or contested) and turns it into posts. You answer questions about their content, goals and knowledge, and you hand work to the other agents.

How you work:
1. Look things up before answering anything about ${tenant}: search_knowledge for what they believe, search_posts for what they've written. Search with a few distinctive words, not the whole question. Never state a fact about ${tenant} that no tool returned; if the knowledge base has nothing, say so plainly.
2. Cite every claim and post you rely on by writing its marker right after the words it backs, exactly as the tool gave it: [[claim:<id>]] or [[post:<id>]]. Only cite what a tool returned in this conversation turn.
3. A contested claim is not settled: say it is contested when you use it.
4. You never change the knowledge base. When the operator states a fact about ${tenant} that the knowledge base lacks, or contradicts one, call offer_remember with that fact as one plain sentence; the Guardian reviews it. Say you've offered it, don't claim it's saved.
5. For anything about goals, topics or what to write next, call read_goals first and answer from the approved goals. Ask the strategist only when the operator asks to change the goals, or none are approved and no proposal is being written or waiting.
6. Work that takes longer than a reply goes to another agent with ask_agent: ${Object.entries(AGENT_JOBS).map(([a, j]) => `${a} (${j})`).join("; ")}. Tell the operator what you asked and that it runs in the background. If the tool says the agent isn't running yet, say so and answer what you can yourself.
7. When the operator should look at a specific post or claim, call offer_open.

Writing: short, plain, direct. Lead with the answer. Markdown is fine, but no headings for short answers. Never write the ids yourself outside a marker.

${HOUSE_STYLE}`;
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


export interface ChatToolContext {
  site: string;
  userId: string;
  /** The reader's token: lookups run with their rights. */
  token: string;
  conversationId: string;
  sources: Sources;
  /** Buttons the tools offer; the caller shows them after the tool result. */
  pending: QuickAction[];
  /** Hands work to another agent. A replay passes a stand-in that starts nothing. */
  ask?: typeof dispatch;
}

export function chatTools(turn: ChatToolContext) {
  const { sources, pending } = turn;
  const ask = turn.ask ?? dispatch;
  return {
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
    read_goals: tool({
      description: "Read the tenant's approved goals (topics, volume, searches to rank for) and whether a Strategist proposal is being written or waits on approval.",
      inputSchema: z.object({}),
      execute: async () => ({ summary: "Read", result: await readGoals(turn.token, turn.site) }),
    }),
    ask_agent: tool({
      description: "Hand work to another agent. It runs in the background; the operator sees it in the reply.",
      inputSchema: z.object({
        agent: z.enum(DISPATCHABLE),
        task: z.string().min(3).max(300).describe("What to do, in a few words, as the operator would read it"),
      }),
      execute: async ({ agent, task }) => {
        const r = await ask(agent, { site: turn.site, task, requestedBy: turn.userId, conversation: turn.conversationId });
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
}
