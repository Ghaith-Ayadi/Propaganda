// Slack: the #1 place facts and ideas come from (the subject-matter experts
// write them down there). One Propaganda Slack app; each tenant installs it
// into its workspace from Settings > Connections and invites @Propaganda to
// the channels it should listen to. Being in a channel is the opt-in.
//
// A thread is one source. Slack throttles history reads for apps outside its
// Marketplace, so the worker never reads history: it keeps what the Events API
// sends. Each thread gets a collector run (slack-<team>-<channel>-<ts>) that
// receives the thread's messages as DBOS messages and, once the thread has
// been quiet for SLACK_QUIET_HOURS (6 by default), hands the whole thread to
// ingest(). Collectors are not on the agents queue: they mostly wait.
//
// Slack app setup (once, by Ayadi): docs/listener.md.

import { createHmac, timingSafeEqual } from "node:crypto";
import { DBOS } from "@dbos-inc/dbos-sdk";
import type { Pool } from "pg";
import { connectionByExternal, getConnection, open, revokeConnection, saveConnection, touchConnection } from "../connections.js";
import { listenerDb } from "../db.js";
import { ingestInWorkflow } from "../ingest.js";
import type { Participant, Segment } from "../transcript.js";
import { connectionsPage, need, postForm, publicUrl, readState, signState } from "./public.js";

const QUIET_SECONDS = Number(process.env.SLACK_QUIET_HOURS ?? 6) * 3600;
/** A thread still going after this long is read as it stands. */
const MAX_COLLECT_MS = 3 * 24 * 3600_000;
/** Below this a thread is chatter: one short message isn't worth a model call. */
const MIN_CHARS = 280;

const API = process.env.SLACK_API_URL ?? "https://slack.com/api";

export const SLACK_SCOPES = ["channels:history", "groups:history", "channels:read", "groups:read", "users:read", "users:read.email", "team:read"];

interface SlackSecret {
  botToken: string;
  botUserId: string;
}

async function slack<T>(token: string, method: string, args: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${API}/${method}?${new URLSearchParams(args)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await res.json()) as { ok: boolean; error?: string } & T;
  if (!body.ok) throw new Error(`Slack ${method}: ${body.error ?? res.status}`);
  return body;
}

// ---- install ----

export function slackInstallUrl(site: string, user: string): string {
  const params = new URLSearchParams({
    client_id: need("SLACK_CLIENT_ID"),
    scope: SLACK_SCOPES.join(","),
    redirect_uri: `${publicUrl()}/worker/v1/oauth/slack/callback`,
    state: signState({ site, user, provider: "slack" }),
  });
  return `https://slack.com/oauth/v2/authorize?${params}`;
}

/** Slack sends the browser back here; returns where to send it next. */
export async function slackCallback(query: URLSearchParams): Promise<string> {
  const state = readState(query.get("state") ?? "", "slack");
  if (!state) return connectionsPage("error=slack-state");
  if (query.get("error") || !query.get("code")) return connectionsPage("error=slack-denied");
  const r = await postForm<{
    ok: boolean;
    error?: string;
    access_token: string;
    bot_user_id: string;
    team: { id: string; name: string };
  }>(`${API}/oauth.v2.access`, {
    client_id: need("SLACK_CLIENT_ID"),
    client_secret: need("SLACK_CLIENT_SECRET"),
    code: query.get("code")!,
    redirect_uri: `${publicUrl()}/worker/v1/oauth/slack/callback`,
  });
  if (!r.ok) return connectionsPage(`error=slack-${r.error ?? "exchange"}`);
  await saveConnection({
    site: state.site,
    provider: "slack",
    externalId: r.team.id,
    label: `Slack: ${r.team.name}`,
    secret: { botToken: r.access_token, botUserId: r.bot_user_id } satisfies SlackSecret,
    config: { connectedAt: new Date().toISOString() },
    createdBy: state.user,
  });
  return connectionsPage("connected=slack");
}

// ---- events ----

/** Slack's v0 signature over "v0:<timestamp>:<body>", five minutes' tolerance. */
export function verifySlack(
  timestamp: string,
  signature: string,
  rawBody: string,
  secret: string,
  now = Date.now(),
): boolean {
  if (!/^\d+$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const want = Buffer.from(`v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`);
  const got = Buffer.from(signature);
  return got.length === want.length && timingSafeEqual(got, want);
}

export interface SlackMessage {
  kind: "add" | "edit" | "delete";
  ts: string;
  user: string;
  text: string;
}

interface SlackEvent {
  type: string;
  subtype?: string;
  channel?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  message?: { user?: string; text?: string; ts?: string; thread_ts?: string; bot_id?: string };
  previous_message?: { ts?: string; thread_ts?: string };
  deleted_ts?: string;
}

/** What a message event means for its thread, or null when it's nothing the Listener reads. */
export function threadMessage(ev: SlackEvent): { channel: string; thread: string; msg: SlackMessage } | null {
  if (ev.type !== "message" || !ev.channel) return null;
  if (!ev.subtype || ev.subtype === "thread_broadcast") {
    if (ev.bot_id || !ev.user || !ev.ts) return null;
    return { channel: ev.channel, thread: ev.thread_ts ?? ev.ts, msg: { kind: "add", ts: ev.ts, user: ev.user, text: ev.text ?? "" } };
  }
  if (ev.subtype === "message_changed" && ev.message?.ts && ev.message.user && !ev.message.bot_id) {
    const m = ev.message;
    return { channel: ev.channel, thread: m.thread_ts ?? m.ts!, msg: { kind: "edit", ts: m.ts!, user: m.user!, text: m.text ?? "" } };
  }
  if (ev.subtype === "message_deleted" && ev.deleted_ts) {
    const thread = ev.previous_message?.thread_ts ?? ev.deleted_ts;
    return { channel: ev.channel, thread, msg: { kind: "delete", ts: ev.deleted_ts, user: "", text: "" } };
  }
  return null;
}

export async function onSlackEvent(
  db: Pool,
  headers: Record<string, string | string[] | undefined>,
  rawBody: string,
): Promise<{ status: number; body: unknown }> {
  const h = (n: string) => String(headers[n] ?? "");
  if (!verifySlack(h("x-slack-request-timestamp"), h("x-slack-signature"), rawBody, need("SLACK_SIGNING_SECRET"))) {
    return { status: 401, body: { error: "Bad signature" } };
  }
  const payload = JSON.parse(rawBody) as {
    type: string;
    challenge?: string;
    team_id?: string;
    event_id?: string;
    event?: SlackEvent;
  };
  if (payload.type === "url_verification") return { status: 200, body: { challenge: payload.challenge } };
  if (payload.type !== "event_callback" || !payload.team_id || !payload.event) return { status: 200, body: { ok: true } };

  const conn = await connectionByExternal(db, "slack", payload.team_id);
  if (!conn) return { status: 200, body: { ok: true } }; // a workspace no tenant has connected (any more)

  const ev = payload.event;
  if (ev.type === "app_uninstalled" || ev.type === "tokens_revoked") {
    await revokeConnection(conn.id);
    return { status: 200, body: { ok: true } };
  }
  const t = threadMessage(ev);
  if (!t) return { status: 200, body: { ok: true } };
  const id = `slack-${payload.team_id}-${t.channel}-${t.thread}`;
  await DBOS.startWorkflow(slackThread, { workflowID: id, workflowAttributes: { site: conn.site } })(
    conn.site,
    conn.id,
    t.channel,
    t.thread,
  );
  // Slack retries a slow delivery with the same event id: send it once.
  await DBOS.send(id, t.msg, "msg", payload.event_id);
  return { status: 200, body: { ok: true } };
}

// ---- collecting a thread ----


/** The thread as it stands: edits applied, deletions removed, in order. */
export function applyMessages(msgs: SlackMessage[]): SlackMessage[] {
  const byTs = new Map<string, SlackMessage>();
  for (const m of msgs) {
    if (m.kind === "delete") byTs.delete(m.ts);
    else if (m.kind === "edit") {
      if (byTs.has(m.ts)) byTs.set(m.ts, { ...m, kind: "add" });
    } else byTs.set(m.ts, m);
  }
  return [...byTs.values()].sort((a, b) => Number(a.ts) - Number(b.ts));
}

/** Slack markup to plain text, with mentions replaced by names. */
export function plainSlack(text: string, names: Map<string, string>): string {
  return text
    .replace(/<@([A-Z0-9]+)>/g, (_, id: string) => `@${names.get(id) ?? "someone"}`)
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1")
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2 ($1)")
    .replace(/<(https?:[^>]+)>/g, "$1")
    .replace(/<!(here|channel|everyone)>/g, "@$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

async function collect(site: string, connectionId: string, channel: string, thread: string): Promise<string> {
  const started = await DBOS.now();
  const msgs: SlackMessage[] = [];
  for (;;) {
    const left = started + MAX_COLLECT_MS - (await DBOS.now());
    if (left <= 0) break;
    const m = await DBOS.recv<SlackMessage>("msg", { timeoutSeconds: Math.min(QUIET_SECONDS, Math.ceil(left / 1000)) });
    if (!m) break;
    msgs.push(m);
  }
  const thread_ = applyMessages(msgs);
  if (thread_.reduce((n, m) => n + m.text.length, 0) < MIN_CHARS) return "too short to read";

  const conn = await DBOS.runStep(() => getConnection(listenerDb(), connectionId), { name: "read connection" });
  if (!conn || conn.status === "revoked" || conn.site !== site) return "disconnected";

  const ctx = await DBOS.runStep(
    async () => {
      const token = open<SlackSecret>(conn.secret).botToken;
      const people = new Map<string, Participant & { slackId: string }>();
      for (const userId of new Set(thread_.map((m) => m.user))) {
        const u = await slack<{ user: { real_name?: string; name: string; profile?: { display_name?: string; email?: string } } }>(
          token,
          "users.info",
          { user: userId },
        ).catch(() => null);
        const name = u?.user.profile?.display_name || u?.user.real_name || u?.user.name || userId;
        people.set(userId, { name, email: u?.user.profile?.email, slackId: userId, side: "internal" });
      }
      const info = await slack<{ channel: { name?: string } }>(token, "conversations.info", { channel }).catch(() => null);
      const link = await slack<{ permalink: string }>(token, "chat.getPermalink", { channel, message_ts: thread }).catch(() => null);
      return { people: [...people.values()], channelName: info?.channel.name ?? channel, permalink: link?.permalink ?? "" };
    },
    { name: "read names" },
  );

  const names = new Map(ctx.people.map((p) => [p.slackId, p.name]));
  const segments: Segment[] = thread_.map((m) => ({
    speaker: names.get(m.user) ?? m.user,
    text: plainSlack(m.text, names),
    at: Math.round(Number(m.ts) * 1000),
  }));
  const first = segments[0]!.text;
  const result = await ingestInWorkflow(site, {
        origin: "slack",
        externalId: `${channel}/${thread}`,
        title: `#${ctx.channelName}: ${first.length > 80 ? `${first.slice(0, 77)}...` : first}`,
        uri: ctx.permalink,
        occurred: Math.round(Number(thread) * 1000),
        participants: ctx.people,
        segments,
      });
  await DBOS.runStep(() => touchConnection(conn.id, site, "slack"), { name: "seen" });
  return result.created ? `ingested ${result.source}` : `already had ${result.source}`;
}

export const slackThread = DBOS.registerWorkflow(collect, { name: "slack-thread" });
