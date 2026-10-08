// Where Chat's data comes from. The page and hooks only see ChatAdapter; this
// file picks the implementation.
//
// ┌──────────────────────────────────────────────────────────────────────────┐
// │ PLACEHOLDER. There is no chat backend yet: no conversations or messages   │
// │ tables, no /api/chat. Until they exist, placeholderAdapter keeps          │
// │ conversations in this browser (localStorage, per site) and streams        │
// │ scripted replies with made-up costs. Nothing here reaches a model.        │
// │                                                                          │
// │ httpAdapter is the real contract: POST /api/chat answers one ChatEvent    │
// │ per line (types.ts). The function runs its model calls through callModel()│
// │ in api/_ai/gateway.ts with job "chat"; agent work longer than a request   │
// │ starts on the DBOS worker and arrives as a handoff with its runId. Set    │
// │ VITE_CHAT_BACKEND=http once that endpoint and the tables are deployed.    │
// └──────────────────────────────────────────────────────────────────────────┘

import { authHeader, newId } from "@/lib/supabase";
import type { AgentName, ChatEvent, ChatMessage, Citation, Conversation, Handoff, QuickAction } from "./types";

export interface ChatAdapter {
  /** True while the data is fake, so the page can say so. */
  readonly placeholder: boolean;
  listConversations(site: string): Promise<Conversation[]>;
  createConversation(site: string): Promise<Conversation>;
  deleteConversation(site: string, id: string): Promise<void>;
  listMessages(site: string, conversationId: string): Promise<ChatMessage[]>;
  /** Saves the user's message and streams the reply. Abort to stop the reply. */
  send(site: string, conversationId: string, text: string, signal: AbortSignal): AsyncIterable<ChatEvent>;
  /** Persists a finished (or stopped) assistant message. */
  saveMessage(site: string, message: ChatMessage): Promise<void>;
  /** Proposes a statement to the Guardian, the only writer to the knowledge base. */
  remember(site: string, statement: string, source: { conversationId: string; messageId: string }): Promise<void>;
}

// ───────────────────────────── placeholder ─────────────────────────────────

const KEY = (site: string) => `propaganda:chat-placeholder:${site}`;

interface Store {
  conversations: Conversation[];
  messages: ChatMessage[];
}

function load(site: string): Store {
  try {
    const raw = localStorage.getItem(KEY(site));
    if (raw) return JSON.parse(raw) as Store;
  } catch {
    // private window or blocked storage: start empty
  }
  return { conversations: [], messages: [] };
}

function save(site: string, s: Store): void {
  try {
    localStorage.setItem(KEY(site), JSON.stringify(s));
  } catch {
    // the conversation still works for this page load
  }
}

const now = () => new Date().toISOString();

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

interface Script {
  title: string;
  steps: ({ handoff: Omit<Handoff, "id" | "status">; ms: number; queued?: boolean } | { text: string } | { citation: Omit<Citation, "n"> } | { action: Omit<QuickAction, "id"> })[];
}

/** Scripted replies, picked by a word or two in the question. Demo data only. */
function scriptFor(question: string): Script {
  const q = question.toLowerCase();
  if (q.includes("flag")) {
    return {
      title: "Why the pricing flag was raised",
      steps: [
        { handoff: { agent: "checker", task: "Reread the flag on “Pricing that scales”", summary: "1 conflict: the post says 3 seats, the claim says 5", costUsd: 0.0041 }, ms: 900 },
        { handoff: { agent: "guardian", task: "Look up the claim and its history", summary: "Admitted on 12 Sep from the pricing call; not contested", costUsd: 0.0018 }, ms: 700 },
        { text: "The Checker raised it because the post says the starter plan includes **3 seats** " },
        { citation: { kind: "post", id: "placeholder-post", label: "Pricing that scales", quote: "Every starter plan comes with 3 seats." } },
        { text: ", while the knowledge base says **5** " },
        { citation: { kind: "claim", id: "placeholder-claim-1", label: "The starter plan includes 5 seats.", quote: "Starter: five seats, no limit on posts." } },
        { text: ". The claim came from the September pricing call and nobody has contested it, so the post is the one that's out of date.\n\nIf 3 is the new number, tell me and I'll send it to the Guardian as a correction." },
        { action: { kind: "open", label: "Open the flag", target: { kind: "flag", id: "placeholder-flag", label: "Seats on the starter plan" } } },
        { action: { kind: "open", label: "Open the post", target: { kind: "post", id: "placeholder-post", label: "Pricing that scales" } } },
      ],
    };
  }
  if (q.includes("reposition") || q.includes("strategy") || q.includes("goal")) {
    return {
      title: "Repositioning for the November launch",
      steps: [
        { handoff: { agent: "guardian", task: "Read what the knowledge base says about positioning", summary: "14 claims, 2 contested", costUsd: 0.0022 }, ms: 800 },
        { handoff: { agent: "strategist", task: "Redo this quarter's goals around the launch", summary: "Proposal ready for your review", costUsd: 0.1873, runId: "placeholder-run" }, ms: 2600, queued: true },
        { text: "The Strategist has a proposal. It moves two of the four focus topics toward the launch and keeps Volume where it is, since the team's pace hasn't changed. Coverage of the old topic drops from 6 posts to 3 " },
        { citation: { kind: "goal", id: "placeholder-goal", label: "Q4 Coverage", quote: "Topic A: 4 to 6 posts" } },
        { text: ".\n\nTwo positioning claims are contested " },
        { citation: { kind: "claim", id: "placeholder-claim-2", label: "We sell to mid-market finance teams." } },
        { text: ", so the proposal leans on the ones that aren't. Nothing changes until you approve it." },
        { action: { kind: "open", label: "Review the proposal", target: { kind: "goal", id: "placeholder-goal", label: "Q4 goals" } } },
      ],
    };
  }
  if (q.includes("pitch")) {
    return {
      title: "Why the SOC 2 pitch is a strong fit",
      steps: [
        { handoff: { agent: "pitcher", task: "Explain the fit rating on the SOC 2 pitch", summary: "Strong: 3 reasons", costUsd: 0.0067 }, ms: 1000 },
        { text: "Three reasons. Two open flags come from the same confusion about Type I and Type II, and this piece would replace the flagged post " },
        { citation: { kind: "post", id: "placeholder-post-2", label: "SOC 2 in plain words", quote: "Type I and Type II are the same audit, done twice." } },
        { text: ". It's audit season, so it's worth less after November. And 2,400 people a month search for it while we don't rank " },
        { citation: { kind: "claim", id: "placeholder-claim-3", label: "“soc 2 type 1 vs type 2”: 2,400 searches a month, not in the top 50." } },
        { text: "." },
        { action: { kind: "open", label: "Open the pitch", target: { kind: "pitch", id: "placeholder-pitch", label: "SOC 2 Type I vs Type II" } } },
        { action: { kind: "remember", label: "Remember this", statement: "Audit season runs from September to November." } },
      ],
    };
  }
  return {
    title: question.length > 48 ? `${question.slice(0, 45).trimEnd()}…` : question,
    steps: [
      { handoff: { agent: "guardian", task: "Search the knowledge base", summary: "3 claims match", costUsd: 0.0012 }, ms: 700 },
      { text: "Here's what the knowledge base has on that. We say our onboarding takes **under a day** " },
      { citation: { kind: "claim", id: "placeholder-claim-4", label: "Onboarding takes under a day.", quote: "Most teams are live the same afternoon." } },
      { text: ", and two posts repeat it " },
      { citation: { kind: "post", id: "placeholder-post-3", label: "Your first week with us" } },
      { text: ". This is a placeholder answer: the real Chat agent isn't connected yet." },
      { action: { kind: "remember", label: "Remember this", statement: "Onboarding takes under a day." } },
    ],
  };
}

export const placeholderAdapter: ChatAdapter = {
  placeholder: true,

  async listConversations(site) {
    return [...load(site).conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async createConversation(site) {
    const s = load(site);
    const c: Conversation = { id: newId(), site, title: "New chat", createdAt: now(), updatedAt: now() };
    s.conversations.push(c);
    save(site, s);
    return c;
  },

  async deleteConversation(site, id) {
    const s = load(site);
    save(site, {
      conversations: s.conversations.filter((c) => c.id !== id),
      messages: s.messages.filter((m) => m.conversationId !== id),
    });
  },

  async listMessages(site, conversationId) {
    return load(site).messages.filter((m) => m.conversationId === conversationId);
  },

  async *send(site, conversationId, text, signal) {
    const s = load(site);
    s.messages.push({
      id: newId(),
      conversationId,
      role: "user",
      parts: [{ type: "text", text }],
      citations: [],
      actions: [],
      status: "done",
      createdAt: now(),
    });
    const conv = s.conversations.find((c) => c.id === conversationId);
    const isFirst = s.messages.filter((m) => m.conversationId === conversationId).length === 1;
    if (conv) conv.updatedAt = now();
    save(site, s);

    const script = scriptFor(text);
    if (isFirst) {
      if (conv) conv.title = script.title;
      save(site, s);
      yield { type: "title", title: script.title };
    }
    await sleep(350, signal);

    let total = 0.0009; // the Chat agent's own calls
    let n = 0;
    for (const step of script.steps) {
      if ("handoff" in step) {
        const h: Handoff = { ...step.handoff, id: newId(), status: step.queued ? "queued" : "running" };
        const { summary, costUsd, ...start } = h;
        yield { type: "handoff", handoff: start };
        if (step.queued) {
          await sleep(500, signal);
          yield { type: "handoff", handoff: { ...start, status: "running" } };
        }
        await sleep(step.ms, signal);
        total += costUsd ?? 0;
        yield { type: "handoff", handoff: { ...h, status: "done", summary, costUsd } };
      } else if ("text" in step) {
        // Word by word, like a model.
        for (const word of step.text.match(/\S+\s*|\s+/g) ?? []) {
          await sleep(18 + Math.random() * 30, signal);
          yield { type: "text", delta: word };
        }
      } else if ("citation" in step) {
        yield { type: "citation", citation: { ...step.citation, n: ++n } };
      } else {
        yield { type: "action", action: { ...step.action, id: newId() } };
      }
    }
    yield { type: "done", costUsd: Math.round(total * 1e6) / 1e6 };
  },

  async saveMessage(site, message) {
    const s = load(site);
    s.messages = s.messages.filter((m) => m.id !== message.id).concat(message);
    const conv = s.conversations.find((c) => c.id === message.conversationId);
    if (conv) conv.updatedAt = now();
    save(site, s);
  },

  async remember() {
    // The Guardian isn't built: accept and forget.
  },
};

// ───────────────────────────────── http ────────────────────────────────────

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: await authHeader(), ...init.headers },
  });
  if (!res.ok) throw new Error(`${path} answered ${res.status}: ${await res.text().catch(() => "")}`);
  return res;
}

/** The real backend, once /api/chat and its tables exist (see the PR's draft schema). */
export const httpAdapter: ChatAdapter = {
  placeholder: false,
  async listConversations(site) {
    return (await api(`/api/chat/conversations?site=${encodeURIComponent(site)}`)).json();
  },
  async createConversation(site) {
    return (await api("/api/chat/conversations", { method: "POST", body: JSON.stringify({ site, id: newId() }) })).json();
  },
  async deleteConversation(site, id) {
    await api(`/api/chat/conversations/${id}?site=${encodeURIComponent(site)}`, { method: "DELETE" });
  },
  async listMessages(site, conversationId) {
    return (await api(`/api/chat/conversations/${conversationId}/messages?site=${encodeURIComponent(site)}`)).json();
  },
  async *send(site, conversationId, text, signal) {
    const res = await api("/api/chat", { method: "POST", body: JSON.stringify({ site, conversationId, text }), signal });
    if (!res.body) throw new Error("/api/chat sent no body");
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) yield JSON.parse(line) as ChatEvent;
      }
    }
    if (buf.trim()) yield JSON.parse(buf) as ChatEvent;
  },
  async saveMessage() {
    // The server stores both sides of the conversation as it streams.
  },
  async remember(site, statement, source) {
    await api("/api/chat/remember", { method: "POST", body: JSON.stringify({ site, statement, ...source }) });
  },
};

export const chatAdapter: ChatAdapter = import.meta.env.VITE_CHAT_BACKEND === "http" ? httpAdapter : placeholderAdapter;

/** How each agent is named on screen. */
export const AGENT_LABEL: Record<AgentName, string> = {
  chat: "Chat",
  strategist: "Strategist",
  listener: "Listener",
  scout: "Scout",
  pitcher: "Pitcher",
  writer: "Writer",
  checker: "Checker",
  guardian: "Guardian",
};
