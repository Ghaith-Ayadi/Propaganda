// What Chat is made of, apart from the stream that serves it: its system
// prompt, the conversation as the model sees it, and its tools. The Chat reply
// (agent.ts) and the Arena's replay of a captured turn (worker/src/arena.ts)
// both build from here, so a replay runs the tools and prompt that shipped.

import { z } from "zod";
import { tool, type ModelMessage } from "../_ai/gateway.js";
import { HOUSE_STYLE } from "../_ai/houseStyle.js";
import type { Sources } from "./citations.js";
import { DISPATCHABLE, dispatch, type DispatchResult } from "./dispatch.js";
import { readGoals, searchKnowledge, searchPitches, searchPosts } from "./lookups.js";
import { readWebsite } from "./website.js";
import type { ChatUIMessage, QuickAction } from "./types.js";

const AGENT_JOBS: Record<string, string> = {
  strategist: "proposes the quarter's goals and watches them",
  listener: "reads call transcripts and Slack for ideas and candidate facts",
  scout: "finds outside ideas: searches, AI answers, news, watched sites",
  pitcher: "turns ideas into pitches rated against the goals",
  writer: "writes a post from an approved brief",
  checker: "checks a post in review against its sources and the knowledge base",
};

/** `tenantStyles` is the site's own style rules as a block (stylesBlock), read after the twenty. */
export function systemPrompt(tenant: string, tenantStyles = ""): string {
  const today = new Date().toISOString().slice(0, 10);
  return `You are Chat, one of Propaganda's agents, talking with an operator of ${tenant}'s content. Today is ${today}.

Propaganda keeps a knowledge base of what ${tenant} actually believes (claims, each one plain sentence, settled or contested) and turns it into posts. You answer questions about their content, goals and knowledge, and you hand work to the other agents.

How you work:
1. Look things up before answering anything about ${tenant}. Each tool covers one place: search_knowledge for what they believe (claims), search_posts for what they've written (drafts and published posts), search_pitches for the pitches and ideas in the Pipeline (not yet posts), read_goals for the approved goals and the Strategist's proposal (topics, the reasons and sources behind each, its questions to the operator), read_website for a page of ${tenant}'s own website. Search with a few distinctive words, or paste a sentence the operator quoted. Never state a fact about ${tenant} that no tool returned.
2. A search that finds nothing only tells you about the place it searched. Say which place ("no post says that", "the knowledge base has no claims yet") and look in the next one before you say it isn't there. If two searches return the same results, stop searching and answer from what you have.
3. Cite every claim, post and pitch you rely on by writing its marker right after the words it backs, exactly as the tool gave it: [[claim:<id>]], [[post:<id>]], [[brief:<id>]] or [[idea:<id>]]. Only cite what a tool returned in this conversation turn.
4. A contested claim is not settled: say it is contested when you use it.
5. You never change the knowledge base. When the operator states a fact about ${tenant} that the knowledge base lacks, or contradicts one, call offer_remember with that fact as one plain sentence; the Guardian reviews it. Say you've offered it, don't claim it's saved.
6. Call read_goals first on the first question of a conversation, and for any question about why ${tenant} writes what it writes: goals, the strategy or the proposal, topics, what to write next, patterns or repetition across the posts and pitches, the angle of a pitch. The goals explain most of that, because the Pitcher pitches against them. When the operator asks about something the strategy or a pitch mentions, find where it came from: a topic's "Based on" names the source ("Their site says" is their website, "Your answer" is what they told us in onboarding). For their website, call read_website on the pages read_goals lists, with the words you're looking for, and answer from the page: what it is, its date, who is involved. Link the page. Ask the strategist only when the operator asks to change the goals, or none are approved and no proposal is being written or waiting.
7. Work that takes longer than a reply goes to another agent with ask_agent: ${Object.entries(AGENT_JOBS).map(([a, j]) => `${a} (${j})`).join("; ")}. Tell the operator what you asked and that it runs in the background. If the tool says the agent isn't running yet, say so and answer what you can yourself.
8. When the operator should look at a specific post, pitch or claim, call offer_open before you write the reply. That puts a button under your reply. You do not open anything yourself, so never write "I opened" or "I've opened", and never mention a button unless offer_open ran in this turn.
9. Answer the question that was asked. When the operator asks what something is, say what it is in the first sentence, from the tool that holds it. Only say you can't find it after read_goals and the places it points to came back empty.

Writing: short, plain, direct. Lead with the answer, usually in under 100 words. When the operator points at something, look for it before you say you can't find it. Call ${tenant} by name, or say "they"; never call the operator's company "the tenant". Markdown is fine, but no headings for short answers. Never write the ids yourself outside a marker.

${HOUSE_STYLE}${tenantStyles ? `\n\n${tenantStyles}` : ""}`;
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
  /** The site's name, for the tool descriptions. */
  tenant: string;
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
  const { sources, pending, tenant } = turn;
  const ask = turn.ask ?? dispatch;
  return {
    search_knowledge: tool({
      description: `Search ${tenant}'s knowledge base (claims) by keywords. Returns the nearest claims with their markers. Covers claims only, not posts or pitches.`,
      inputSchema: z.object({ query: z.string().min(2).max(200).describe("A few distinctive words") }),
      execute: async ({ query }) => {
        const r = await searchKnowledge(turn.token, turn.site, query);
        if (!r.available) return { summary: "The knowledge base isn't set up yet", result: "The knowledge base isn't set up yet. Nothing to cite." };
        for (const c of r.claims) sources.add({ kind: "claim", id: c.id, label: c.text });
        if (!r.claims.length && r.total === 0) {
          return { summary: "No claims yet", result: "The knowledge base has no claims yet, so there was nothing to search. Say that, not that nothing matched." };
        }
        return {
          summary: r.claims.length ? `${r.claims.length} claim${r.claims.length === 1 ? "" : "s"} match` : "Nothing matches",
          result: r.claims.length
            ? r.claims.map((c) => `[[claim:${c.id}]] ${c.text}${c.status === "contested" ? " (CONTESTED)" : ""}${c.topics.length ? ` — topics: ${c.topics.join(", ")}` : ""}`).join("\n")
            : `No claims match${r.total ? ` (the knowledge base holds ${r.total >= 500 ? "500 or more" : r.total})` : ""}.`,
        };
      },
    }),
    search_posts: tool({
      description: `Search ${tenant}'s posts (drafts and published) by keywords or a pasted sentence. Returns titles, status and the passage around the match. Covers posts only, not pitches or ideas (search_pitches).`,
      inputSchema: z.object({ query: z.string().min(2).max(200).describe("A few distinctive words, or a whole sentence to find it") }),
      execute: async ({ query }) => {
        const posts = await searchPosts(turn.token, turn.site, query);
        for (const p of posts) sources.add({ kind: "post", id: p.id, label: p.title });
        return {
          summary: posts.length ? `${posts.length} post${posts.length === 1 ? "" : "s"} found` : "No posts match",
          result: posts.length
            ? posts.map((p) => `[[post:${p.id}]] "${p.title}" (${p.status}${p.collection ? `, ${p.collection}` : ""}${p.publishedAt ? `, published ${p.publishedAt.slice(0, 10)}` : ""})${p.exact ? " [holds the exact phrase]" : ""}\n${p.excerpt}`).join("\n\n")
            : "No posts match. This searched posts only; pitches and ideas are in search_pitches.",
        };
      },
    }),
    search_pitches: tool({
      description: `Search ${tenant}'s pitches and ideas in the Pipeline (not yet posts) by keywords or a pasted sentence: a pitch's title, angle and body, an idea's title and summary. Returns the passage around the match.`,
      inputSchema: z.object({ query: z.string().min(2).max(200).describe("A few distinctive words, or a whole sentence to find it") }),
      execute: async ({ query }) => {
        const hits = await searchPitches(turn.token, turn.site, query);
        for (const h of hits) sources.add({ kind: h.kind, id: h.id, label: h.title });
        return {
          summary: hits.length ? `${hits.length} pitch${hits.length === 1 ? "" : "es"} or idea${hits.length === 1 ? "" : "s"} found` : "No pitches or ideas match",
          result: hits.length
            ? hits.map((h) => `[[${h.kind}:${h.id}]] ${h.kind === "brief" ? "pitch" : "idea"} "${h.title}" (${h.status})${h.exact ? " [holds the exact phrase]" : ""}\n${h.excerpt}`).join("\n\n")
            : "No pitches or ideas match. This searched the Pipeline only; posts are in search_posts.",
        };
      },
    }),
    read_goals: tool({
      description: `Read ${tenant}'s approved goals (topics, volume, searches to rank for) and whether a Strategist proposal is being written or waits on approval. The pitches are written against these.`,
      inputSchema: z.object({}),
      execute: async () => ({ summary: "Read", result: await readGoals(turn.token, turn.site) }),
    }),
    read_website: tool({
      description: `Read one page of ${tenant}'s own website as text (only their site, from their settings). Give the page's address or a path ("/collective"), and the words you're looking for to get the passage around them. read_goals lists the pages the Strategist read.`,
      inputSchema: z.object({
        url: z.string().min(1).max(500).describe("An address on their site, or a path"),
        query: z.string().max(200).optional().describe("A few words to find on the page"),
      }),
      execute: async ({ url, query }) => {
        const r = await readWebsite(turn.token, turn.site, url, query ?? "");
        if (!r.ok) return { summary: "Couldn't read it", failed: true, result: `Not read: ${r.reason}.` };
        return { summary: `Read ${r.page.title || r.page.url}`, result: `${r.page.url} "${r.page.title}"\n${r.page.text}` };
      },
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
      description: "Put an Open button under your reply for a post, pitch or claim returned by a search in this turn. You open nothing yourself.",
      inputSchema: z.object({ kind: z.enum(["post", "claim", "brief"]), id: z.string() }),
      execute: async ({ kind, id }) => {
        const ref = sources.get(kind, id);
        if (!ref) return { result: "Unknown id: only offer what a search returned." };
        const label =
          kind === "claim" ? "Open the claim" : `Open “${ref.label.length > 40 ? `${ref.label.slice(0, 38)}…` : ref.label}”`;
        pending.push({ kind: "open", label, target: { kind, id, label: ref.label } });
        return { result: `A button "${label}" now shows under your reply. Nothing is open yet: the operator presses it. Call it a button.` };
      },
    }),
  };
}
