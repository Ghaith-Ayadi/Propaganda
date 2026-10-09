// Where Chat's data comes from. useChat (Vercel AI SDK, @ai-sdk/react) runs the
// conversation; this file gives it a transport and keeps the conversation list.
// The page and hooks only see `chatBackend`.
//
// httpBackend is the real one, in every build: the SDK's DefaultChatTransport
// on POST /api/chat, which answers with createUIMessageStream. Its model calls
// go through the cost gateway (api/_ai/gateway.ts, job "chat"); agent work
// longer than a request starts on the DBOS worker and arrives as a handoff
// with its runId. placeholderBackend (UI preview only, VITE_UI_PREVIEW) keeps
// conversations in this browser and streams scripted replies; nothing there
// reaches a model.

import { DefaultChatTransport, type ChatTransport, type UIMessageChunk } from "ai";
import { authHeader, newId } from "@/lib/supabase";
import { UI_PREVIEW } from "@/lib/preview";
import type { AgentName, ChatUIMessage, Citation, Conversation, Handoff, QuickAction } from "./types";

export interface ChatBackend {
  /** True while the data is fake, so the page can say so. */
  readonly placeholder: boolean;
  /** What useChat streams replies through, for one tenant. */
  transport(site: string): ChatTransport<ChatUIMessage>;
  listConversations(site: string): Promise<Conversation[]>;
  /** `id` is the chat id useChat already holds, so the first message needs no re-key. */
  createConversation(site: string, id: string): Promise<Conversation>;
  deleteConversation(site: string, id: string): Promise<void>;
  loadMessages(site: string, conversationId: string): Promise<ChatUIMessage[]>;
  /** After a reply ends (finished or stopped). A server-backed chat stores as it streams. */
  saveMessages(site: string, conversationId: string, messages: ChatUIMessage[]): Promise<void>;
  /** Proposes a statement to the Guardian, the only writer to the knowledge base. */
  remember(site: string, statement: string, source: { conversationId: string; messageId: string }): Promise<void>;
}

// ───────────────────────────── placeholder ─────────────────────────────────

const KEY = (site: string) => `propaganda:chat-placeholder:${site}`;

interface Store {
  conversations: Conversation[];
  messages: Record<string, ChatUIMessage[]>;
}

function load(site: string): Store {
  try {
    const raw = localStorage.getItem(KEY(site));
    if (raw) {
      const s = JSON.parse(raw) as Store;
      // The first placeholder kept messages in another shape: start those over.
      if (s.messages && !Array.isArray(s.messages)) return s;
    }
  } catch {
    // private window or blocked storage: start empty
  }
  return { conversations: [], messages: {} };
}

function save(site: string, s: Store): void {
  try {
    localStorage.setItem(KEY(site), JSON.stringify(s));
  } catch {
    // the conversation still works for this page load
  }
}

const now = () => new Date().toISOString();

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
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
  steps: ({ handoff: Omit<Handoff, "status">; ms: number; queued?: boolean } | { text: string } | { citation: Omit<Citation, "n"> } | { action: QuickAction })[];
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

/** The scripted reply as the chunks a real /api/chat would send. */
async function* scriptChunks(question: string, isFirst: boolean, signal: AbortSignal | undefined): AsyncGenerator<UIMessageChunk> {
  const script = scriptFor(question);
  yield { type: "start" };
  if (isFirst) yield { type: "data-title", data: { title: script.title }, transient: true };
  await sleep(450, signal);

  let total = 0.0009; // the Chat agent's own calls
  let n = 0;
  let textId: string | null = null;
  const endText = function* (): Generator<UIMessageChunk> {
    if (textId) yield { type: "text-end", id: textId };
    textId = null;
  };

  for (const step of script.steps) {
    if ("handoff" in step) {
      yield* endText();
      const id = newId();
      const { summary, costUsd, ...ask } = step.handoff;
      yield { type: "data-handoff", id, data: { ...ask, status: step.queued ? "queued" : "running" } };
      if (step.queued) {
        await sleep(500, signal);
        yield { type: "data-handoff", id, data: { ...ask, status: "running" } };
      }
      await sleep(step.ms, signal);
      total += costUsd ?? 0;
      yield { type: "data-handoff", id, data: { ...ask, status: "done", summary, costUsd } };
    } else if ("text" in step) {
      if (!textId) {
        textId = newId();
        yield { type: "text-start", id: textId };
      }
      // Word by word, like a model.
      for (const word of step.text.match(/\S+\s*|\s+/g) ?? []) {
        await sleep(18 + Math.random() * 30, signal);
        yield { type: "text-delta", id: textId, delta: word };
      }
    } else if ("citation" in step) {
      const c: Citation = { ...step.citation, n: ++n };
      if (textId) yield { type: "text-delta", id: textId, delta: `[${c.n}](#cite-${c.n})` };
      yield { type: "data-citation", id: newId(), data: c };
    } else {
      yield { type: "data-action", id: newId(), data: step.action };
    }
  }
  yield* endText();
  yield { type: "finish", messageMetadata: { costUsd: Math.round(total * 1e6) / 1e6 } };
}

function textOf(m: ChatUIMessage | undefined): string {
  return (m?.parts ?? []).map((p) => (p.type === "text" ? p.text : "")).join("");
}

function placeholderTransport(site: string): ChatTransport<ChatUIMessage> {
  return {
    async sendMessages({ chatId, messages, abortSignal }) {
      const question = textOf([...messages].reverse().find((m) => m.role === "user"));
      const isFirst = messages.filter((m) => m.role === "user").length === 1;
      if (isFirst) {
        const s = load(site);
        const conv = s.conversations.find((c) => c.id === chatId);
        if (conv) {
          conv.title = scriptFor(question).title;
          save(site, s);
        }
      }
      const it = scriptChunks(question, isFirst, abortSignal);
      return new ReadableStream<UIMessageChunk>({
        async pull(controller) {
          try {
            const { value, done } = await it.next();
            if (done) controller.close();
            else controller.enqueue(value);
          } catch (err) {
            controller.error(err);
          }
        },
        async cancel() {
          await it.return(undefined);
        },
      });
    },
    async reconnectToStream() {
      return null;
    },
  };
}

export const placeholderBackend: ChatBackend = {
  placeholder: true,
  transport: placeholderTransport,

  async listConversations(site) {
    return [...load(site).conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async createConversation(site, id) {
    const s = load(site);
    const c: Conversation = { id, site, title: "New chat", createdAt: now(), updatedAt: now() };
    s.conversations.push(c);
    save(site, s);
    return c;
  },

  async deleteConversation(site, id) {
    const s = load(site);
    s.conversations = s.conversations.filter((c) => c.id !== id);
    delete s.messages[id];
    save(site, s);
  },

  async loadMessages(site, conversationId) {
    return load(site).messages[conversationId] ?? [];
  },

  async saveMessages(site, conversationId, messages) {
    const s = load(site);
    s.messages[conversationId] = messages;
    const conv = s.conversations.find((c) => c.id === conversationId);
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
export const httpBackend: ChatBackend = {
  placeholder: false,
  transport: (site) =>
    new DefaultChatTransport<ChatUIMessage>({
      api: "/api/chat",
      headers: async () => ({ Authorization: await authHeader() }),
      // The server has the history: send only the new message.
      prepareSendMessagesRequest: ({ id, messages, trigger, messageId }) => ({
        body: { site, id, trigger, messageId, message: messages[messages.length - 1] },
      }),
    }),
  async listConversations(site) {
    return (await api(`/api/chat/conversations?site=${encodeURIComponent(site)}`)).json();
  },
  async createConversation(site, id) {
    return (await api("/api/chat/conversations", { method: "POST", body: JSON.stringify({ site, id }) })).json();
  },
  async deleteConversation(site, id) {
    await api(`/api/chat/conversations/${id}?site=${encodeURIComponent(site)}`, { method: "DELETE" });
  },
  async loadMessages(site, conversationId) {
    return (await api(`/api/chat/conversations/${conversationId}/messages?site=${encodeURIComponent(site)}`)).json();
  },
  async saveMessages() {
    // The server stores both sides of the conversation as it streams.
  },
  async remember(site, statement, source) {
    await api("/api/chat/remember", { method: "POST", body: JSON.stringify({ site, statement, ...source }) });
  },
};

/** The real Chat (api/chat) in every build; the scripted placeholder in the UI preview only. */
export const chatBackend: ChatBackend = UI_PREVIEW ? placeholderBackend : httpBackend;

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
