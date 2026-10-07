// Typed data hooks for the Settings and Connections pages (0.2).
//
// Everything here is stored as per-tenant key/value settings in `app_settings`
// (lib/settings.ts): already per site, already synced, and adding a key never
// touches a client's existing data. No schema change.
//
// PLACEHOLDER ADAPTERS: three things have no server table yet and are marked
// below. When the real tables land, only this file changes; the pages call the
// hooks and never see where the data comes from.
//   1. People: the member list and invites (needs a read of site_members + an
//      invite flow).
//   2. Connection status: Granola, Slack, newsletter and CMS "connect" only
//      records that the tenant asked; nothing reaches the outside service.
//   3. The transcript URL and MCP URL are shaped like the real ones but the
//      endpoints do not exist yet.
// Secrets never go in here: app_settings is readable by every member.

import { useCallback } from "react";
import { setSetting, useSetting } from "@/lib/settings";

/** A setting with a typed default, and a setter that stores the whole value. */
function useConfig<T>(key: string, fallback: T): [T, (next: T) => void] {
  const value = useSetting<T>(key, fallback) ?? fallback;
  const set = useCallback((next: T) => void setSetting(key, next), [key]);
  return [value, set];
}

// ---- Models ---------------------------------------------------------------

/** Off by default. When on, background jobs only use Western model providers. */
export const useWesternOnly = () => useConfig<boolean>("tenant.models.westernOnly", false);

// ---- Agents ---------------------------------------------------------------

export type AgentId =
  | "strategist" | "listener" | "scout" | "pitcher" | "writer" | "checker" | "guardian" | "chat";

export interface AgentInfo {
  id: AgentId;
  name: string;
  job: string;
  model: "Opus" | "Sonnet";
  internet: boolean;
}

/** The roster from reviews/agents.md (approved 2026-10-07). */
export const AGENTS: AgentInfo[] = [
  { id: "strategist", name: "Strategist", job: "Proposes the quarter's goals and keeps an eye on them", model: "Opus", internet: true },
  { id: "listener", name: "Listener", job: "Reads incoming transcripts and Slack; finds ideas and candidate facts", model: "Sonnet", internet: false },
  { id: "scout", name: "Scout", job: "Finds outside ideas: search demand, AI answers, news, watched sites", model: "Sonnet", internet: true },
  { id: "pitcher", name: "Pitcher", job: "Turns ideas into pitches rated against goals, or rejects them with a reason", model: "Sonnet", internet: true },
  { id: "writer", name: "Writer", job: "Writes the post from the approved brief, minding tone, voice and veracity", model: "Opus", internet: true },
  { id: "checker", name: "Checker", job: "Checks a post in review: sources, numbers, and the knowledge base", model: "Sonnet", internet: true },
  { id: "guardian", name: "Guardian", job: "The only writer to the knowledge base; admits, contests, rejects or escalates", model: "Opus", internet: false },
  { id: "chat", name: "Chat", job: "Talks with the operator and calls the others", model: "Sonnet", internet: true },
];

export type StageMode = "off" | "ask" | "auto";
export type StageId = "suggest" | "flag" | "plan" | "write" | "review" | "publish";

export const STAGES: { id: StageId; name: string; what: string }[] = [
  { id: "suggest", name: "Suggest", what: "Find ideas and pitch the ones with a reason" },
  { id: "flag", name: "Flag", what: "Raise consistency flags against the knowledge base" },
  { id: "plan", name: "Plan", what: "Turn accepted pitches into briefs" },
  { id: "write", name: "Write", what: "Draft from a brief" },
  { id: "review", name: "Review", what: "Check drafts for veracity before a person sees them" },
  { id: "publish", name: "Publish", what: "Push to the site" },
];

const STAGE_DEFAULTS: Record<StageId, StageMode> = {
  suggest: "auto", flag: "auto", plan: "ask", write: "ask", review: "auto", publish: "off",
};

/** How far each stage goes on its own. Off means the stage does not run at all. */
export function useStageModes(): [Record<StageId, StageMode>, (id: StageId, mode: StageMode) => void] {
  const [modes, setModes] = useConfig<Partial<Record<StageId, StageMode>>>("tenant.agents.stages", {});
  const merged = { ...STAGE_DEFAULTS, ...modes };
  return [merged, (id, mode) => setModes({ ...modes, [id]: mode })];
}

/** The Writer's voice guide: short, editable. Empty means the default voice. */
export const useVoiceGuide = () => useConfig<string>("tenant.voice.guide", "");

/** House rule for every Writer draft (Ayadi, 2026-10-07). Read-only on purpose. */
export const WRITER_RULE = {
  rule: "Never write “That's not X. It's Y.” unless there is truly no other way.",
  instead: "Say it as a comparison: “This is much more of a maintenance job than it is the ol' art of writing.”",
};

// ---- Knowledge ------------------------------------------------------------

export interface SourceTier { id: string; name: string; what: string }

/** Strongest evidence first. The tenant can reorder; the ids never change. */
export const DEFAULT_TIERS: SourceTier[] = [
  { id: "signed", name: "Signed documents", what: "Contracts, pricing sheets, security reports" },
  { id: "owner", name: "A topic owner's word", what: "Said on the record, in a call or a decision" },
  { id: "internal", name: "Internal documents", what: "Decks, wikis, specs" },
  { id: "calls", name: "Calls", what: "What anyone said in a transcript" },
  { id: "published", name: "Published content", what: "Our own posts. The weakest evidence" },
];

export function useSourceTiers(): [SourceTier[], (order: string[]) => void] {
  const [order, setOrder] = useConfig<string[]>("tenant.kb.tiers", DEFAULT_TIERS.map((t) => t.id));
  // Tolerate a stored order that misses a tier (added later) or names one that is gone.
  const known = new Map(DEFAULT_TIERS.map((t) => [t.id, t]));
  const seen = order.filter((id) => known.has(id));
  const tiers = [...seen, ...DEFAULT_TIERS.map((t) => t.id).filter((id) => !seen.includes(id))].map((id) => known.get(id)!);
  return [tiers, setOrder];
}

export type GuardianStrictness = "relaxed" | "balanced" | "strict";

/** How readily the Guardian contests a claim. It flags; it never rejects a person's Remember. */
export const useGuardianStrictness = () => useConfig<GuardianStrictness>("tenant.kb.strictness", "balanced");

/** Re-read every piece that relies on a claim when the claim changes. */
export const useRecheckOnChange = () => useConfig<boolean>("tenant.kb.recheck", true);

// ---- People ---------------------------------------------------------------

export interface Person {
  id: string;
  name: string;
  email: string;
  avatar: string;
  status: "active" | "invited";
}

interface Invite { email: string; at: string }

/**
 * PLACEHOLDER ADAPTER (1/3). Active members: just the signed-in account until
 * the server lets a member read `site_members`. Invites are remembered here but
 * no email is sent. One user type: everyone allowed in does and sees everything.
 */
export function usePeople(me: { userId: string; email: string; name: string; avatar: string }) {
  const [invites, setInvites] = useConfig<Invite[]>("tenant.people.invites", []);
  const people: Person[] = [
    { id: me.userId, name: me.name || me.email, email: me.email, avatar: me.avatar, status: "active" },
    ...invites.map((i) => ({ id: `invite:${i.email}`, name: i.email, email: i.email, avatar: "", status: "invited" as const })),
  ];
  return {
    people,
    invite: (email: string) => {
      const e = email.trim().toLowerCase();
      if (!e || invites.some((i) => i.email === e)) return;
      setInvites([...invites, { email: e, at: new Date().toISOString() }]);
    },
    removeInvite: (email: string) => setInvites(invites.filter((i) => i.email !== email)),
  };
}

/** Topic owner per topic (a person's id), and the one top authority who has the last word. */
export const useTopicOwners = () => useConfig<Record<string, string>>("tenant.people.topicOwners", {});
export const useTopAuthority = () => useConfig<string>("tenant.people.topAuthority", "");

// ---- Content types --------------------------------------------------------

export type Platform = "linkedin" | "x" | "bluesky" | "threads" | "facebook" | "instagram";

export const PLATFORMS: { id: Platform; name: string }[] = [
  { id: "linkedin", name: "LinkedIn" },
  { id: "x", name: "X" },
  { id: "bluesky", name: "Bluesky" },
  { id: "threads", name: "Threads" },
  { id: "facebook", name: "Facebook" },
  { id: "instagram", name: "Instagram" },
];

/** A channel is a platform plus a specific page or account; two LinkedIn pages is fine. */
export interface SocialChannel { id: string; platform: Platform; page: string }
export interface EmailThread { id: string; name: string; about: string }

const rid = () => Math.random().toString(36).slice(2, 10);

export function useSocialChannels() {
  const [channels, set] = useConfig<SocialChannel[]>("tenant.content.channels", []);
  return {
    channels,
    add: (platform: Platform, page: string) => set([...channels, { id: rid(), platform, page: page.trim() }]),
    remove: (id: string) => set(channels.filter((c) => c.id !== id)),
  };
}

export function useEmailThreads() {
  const [threads, set] = useConfig<EmailThread[]>("tenant.content.emailThreads", []);
  return {
    threads,
    add: (name: string, about: string) => set([...threads, { id: rid(), name: name.trim(), about: about.trim() }]),
    remove: (id: string) => set(threads.filter((t) => t.id !== id)),
  };
}

// ---- Connections ----------------------------------------------------------

export type ConnectionId =
  | "granola" | "slack" | "newsletter"
  | "framer" | "webflow" | "wordpress" | "ghost" | "squarespace";

export type ConnectionStatus = "none" | "requested";

/**
 * PLACEHOLDER ADAPTER (2/3). "Connect" records that the tenant asked and keeps
 * its non-secret details (a workspace name, a feed URL). Nothing reaches the
 * outside service yet, and no credential is ever stored here.
 */
export function useConnection(id: ConnectionId) {
  const [all, setAll] = useConfig<Partial<Record<ConnectionId, { status: ConnectionStatus; detail?: string }>>>(
    "tenant.connections",
    {},
  );
  const entry = all[id] ?? { status: "none" as const };
  return {
    status: entry.status,
    detail: entry.detail ?? "",
    request: (detail = "") => setAll({ ...all, [id]: { status: "requested", detail } }),
    clear: () => {
      const next = { ...all };
      delete next[id];
      setAll(next);
    },
  };
}

export interface WatchedSite { id: string; url: string; topic: string }

/** Sites the Scout follows for this tenant, each tied to a topic (e.g. a regulator's news page). */
export function useWatchedSites() {
  const [sites, set] = useConfig<WatchedSite[]>("tenant.connections.watched", []);
  return {
    sites,
    add: (url: string, topic: string) => set([...sites, { id: rid(), url: url.trim(), topic: topic.trim() }]),
    remove: (id: string) => set(sites.filter((s) => s.id !== id)),
  };
}

function randomToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 28);
}

/**
 * PLACEHOLDER ADAPTER (3/3). The open URL anyone can POST a transcript to, no
 * integration needed. The token is minted here for now; the real one is minted
 * by the server (see the draft table in the PR) and the endpoint does not exist.
 */
export function useTranscriptUrl() {
  const [token, setToken] = useConfig<string>("tenant.connections.transcriptToken", "");
  return {
    url: token ? `${window.location.origin}/api/ingest/${token}` : "",
    create: () => setToken(randomToken()),
    regenerate: () => setToken(randomToken()),
  };
}

/** PLACEHOLDER (3/3): the MCP endpoint other AI tools connect to. */
export function mcpUrl(): string {
  return `${window.location.origin}/mcp`;
}
