// Typed data hooks for the Settings and Connections pages (0.2).
//
// Everything here is stored as per-tenant key/value settings in `app_settings`
// (lib/settings.ts): already per site, already synced, and adding a key never
// touches a client's existing data. No schema change.
//
// PLACEHOLDER ADAPTERS: two things have no server table yet and are marked
// below. When the real tables land, only this file changes; the pages call the
// hooks and never see where the data comes from. (People and invites are real:
// lib/people.ts.)
//   1. Connection status: Granola, Slack, newsletter and CMS "connect" only
//      records that the tenant asked; nothing reaches the outside service.
//   2. The transcript URL and MCP URL are shaped like the real ones but the
//      endpoints do not exist yet (and the transcript token is not minted).
//
// EVERY KEY HERE IS PUBLIC. The blog reads app_settings through the anonymous
// client ("anyone reads settings", 20261002000003_access.sql), so anyone on the
// internet can read these rows. Never put a secret, an email address or an
// account id in one. Anything that must not be public gets a server table.

import { useCallback } from "react";
import { setSetting, useSetting } from "@/lib/settings";

/** A setting with a typed default, and a setter that stores the whole value. */
function useConfig<T>(key: string, fallback: T): [T, (next: T) => void] {
  const value = useSetting<T>(key, fallback) ?? fallback;
  const set = useCallback((next: T) => void setSetting(key, next), [key]);
  return [value, set];
}

// ---- Agents ---------------------------------------------------------------

export type AgentId =
  | "strategist" | "listener" | "scout" | "pitcher" | "writer" | "checker" | "guardian" | "chat";

export interface AgentInfo {
  id: AgentId;
  name: string;
  job: string;
  internet: boolean;
}

/** The roster from reviews/agents.md (approved 2026-10-07). */
export const AGENTS: AgentInfo[] = [
  { id: "strategist", name: "Strategist", job: "Proposes the quarter's goals and keeps an eye on them", internet: true },
  { id: "listener", name: "Listener", job: "Reads incoming transcripts and Slack; finds ideas and candidate facts", internet: false },
  { id: "scout", name: "Scout", job: "Finds outside ideas: search demand, AI answers, news, watched sites", internet: true },
  { id: "pitcher", name: "Pitcher", job: "Turns ideas into pitches rated against goals, or rejects them with a reason", internet: true },
  { id: "writer", name: "Writer", job: "Writes the post from the approved brief, minding tone, voice and veracity", internet: true },
  { id: "checker", name: "Checker", job: "Checks a post in review: sources, numbers, and the knowledge base", internet: true },
  { id: "guardian", name: "Guardian", job: "The only writer to the knowledge base; admits, contests, rejects or escalates", internet: false },
  { id: "chat", name: "Chat", job: "Talks with the operator and calls the others", internet: true },
];

/** The Writer's voice guide: short, editable. Empty means the default voice. */
export const useVoiceGuide = () => useConfig<string>("tenant.voice.guide", "");

/** House rule for every Writer draft (Ayadi, 2026-10-07). Read-only on purpose. */
export const WRITER_RULE = {
  rule: "Never write “That's not X. It's Y.” unless there is truly no other way.",
  instead: "Say it as a comparison: “This is much more of a maintenance job than it is the ol' art of writing.”",
};

const rid = () => Math.random().toString(36).slice(2, 10);

// ---- Connections ----------------------------------------------------------

export type ConnectionId =
  | "granola" | "slack" | "newsletter"
  | "framer" | "webflow" | "wordpress" | "ghost" | "squarespace";

export type ConnectionStatus = "none" | "requested";

/**
 * PLACEHOLDER ADAPTER (1/2). "Connect" records that the tenant asked and keeps
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

/**
 * PLACEHOLDER ADAPTER (2/2). The open URL anyone can POST a transcript to.
 * No token is minted here: app_settings is public, so a token stored there
 * would be a public secret. The server mints it (see the ingest_tokens draft in
 * the PR) and this shows only the shape of the address.
 */
export function transcriptUrlShape(): string {
  return `${window.location.origin}/api/ingest/<token>`;
}

/** PLACEHOLDER (2/2): the MCP endpoint other AI tools connect to. */
export function mcpUrl(): string {
  return `${window.location.origin}/mcp`;
}
