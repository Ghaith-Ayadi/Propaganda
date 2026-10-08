// Microsoft Teams: meeting transcripts through Microsoft Graph. A Microsoft
// 365 admin of the tenant's organisation grants Propaganda's app consent
// (Settings > Connections > Teams), once for the whole organisation. The
// worker then subscribes to every new transcript in that organisation
// (communications/onlineMeetings/getAllTranscripts), renews the subscription
// before it lapses, and downloads each transcript as VTT when Graph says it's
// ready.
//
// Needs, on the tenant's side: transcription on in Teams meetings, an admin
// to consent, and, where Microsoft asks for it, an application access policy
// for the app (docs/listener.md). Azure app setup (once, by Ayadi): same doc.

import { randomBytes, timingSafeEqual } from "node:crypto";
import { DBOS } from "@dbos-inc/dbos-sdk";
import type { Pool } from "pg";
import { AGENT_QUEUE } from "../../workflows/agents.js";
import { activeConnections, connectionByExternal, getConnection, open, saveConnection, touchConnection, type Connection } from "../connections.js";
import { listenerDb } from "../db.js";
import { ingestInWorkflow } from "../ingest.js";
import { parseCaptions } from "../transcript.js";
import { connectionsPage, need, postForm, publicUrl, readState, signState } from "./public.js";

const GRAPH = "https://graph.microsoft.com/v1.0";
/** Graph allows transcript subscriptions up to about three days; renew well before. */
const SUBSCRIPTION_MS = 60 * 3600_000;

interface TeamsSecret {
  /** Echoed by Graph on every notification: proves it's ours. */
  clientState: string;
}

const REDIRECT = () => `${publicUrl()}/worker/v1/oauth/teams/callback`;

export function teamsConsentUrl(site: string, user: string): string {
  const params = new URLSearchParams({
    client_id: need("MS_CLIENT_ID"),
    redirect_uri: REDIRECT(),
    scope: "https://graph.microsoft.com/.default",
    state: signState({ site, user, provider: "teams" }),
  });
  return `https://login.microsoftonline.com/organizations/v2.0/adminconsent?${params}`;
}

/** An app-only token for one Microsoft tenant. */
async function appToken(msTenant: string): Promise<string> {
  const t = await postForm<{ access_token: string }>(`https://login.microsoftonline.com/${encodeURIComponent(msTenant)}/oauth2/v2.0/token`, {
    client_id: need("MS_CLIENT_ID"),
    client_secret: need("MS_CLIENT_SECRET"),
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  return t.access_token;
}

async function graph<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path.startsWith("http") ? path : `${GRAPH}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
  });
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`Graph ${init.method ?? "GET"} ${path.split("?")[0]}: ${res.status} ${text.slice(0, 300)}`), { status: res.status });
  return (text && res.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text) as T;
}

async function subscribe(msTenant: string, clientState: string): Promise<{ id: string; expirationDateTime: string }> {
  const token = await appToken(msTenant);
  return graph(token, "/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      changeType: "created",
      notificationUrl: `${publicUrl()}/worker/v1/hooks/teams`,
      lifecycleNotificationUrl: `${publicUrl()}/worker/v1/hooks/teams`,
      resource: "communications/onlineMeetings/getAllTranscripts",
      expirationDateTime: new Date(Date.now() + SUBSCRIPTION_MS).toISOString(),
      clientState,
    }),
  });
}

export async function teamsCallback(query: URLSearchParams): Promise<string> {
  const state = readState(query.get("state") ?? "", "teams");
  if (!state) return connectionsPage("error=teams-state");
  const msTenant = query.get("tenant");
  if (query.get("admin_consent") !== "True" || !msTenant) return connectionsPage("error=teams-denied");
  const clientState = randomBytes(24).toString("base64url");
  // The row first: Graph validates the notification URL while the subscription is created.
  const id = await saveConnection({
    site: state.site,
    provider: "teams",
    externalId: msTenant,
    label: "Microsoft Teams",
    secret: { clientState } satisfies TeamsSecret,
    config: { connectedAt: new Date().toISOString() },
    createdBy: state.user,
  });
  try {
    const sub = await subscribe(msTenant, clientState);
    await saveConnection({ id, site: state.site, provider: "teams", config: { connectedAt: new Date().toISOString(), subscription: sub.id, expires: sub.expirationDateTime } });
  } catch (err) {
    await touchConnection(id, state.site, "teams", String((err as Error).message));
    return connectionsPage("error=teams-subscribe");
  }
  return connectionsPage("connected=teams");
}

// ---- notifications ----

interface Notification {
  subscriptionId: string;
  clientState?: string;
  tenantId?: string;
  resource?: string;
  lifecycleEvent?: string;
}

export async function onTeamsHook(db: Pool, query: URLSearchParams, rawBody: string): Promise<{ status: number; body: unknown; text?: boolean }> {
  // Creating or renewing a subscription: echo the token as plain text within 10 seconds.
  const validation = query.get("validationToken");
  if (validation !== null) return { status: 200, body: validation, text: true };

  const { value = [] } = JSON.parse(rawBody) as { value?: Notification[] };
  for (const n of value) {
    if (!n.tenantId) continue;
    const conn = await connectionByExternal(db, "teams", n.tenantId);
    if (!conn || !conn.secret) continue;
    const want = Buffer.from(open<TeamsSecret>(conn.secret).clientState);
    const got = Buffer.from(n.clientState ?? "");
    if (got.length !== want.length || !timingSafeEqual(got, want)) continue;
    if (n.lifecycleEvent) {
      // reauthorizationRequired, subscriptionRemoved, missed: the renewal run sorts it out.
      await DBOS.startWorkflow(teamsRenew, { workflowID: `teams-renew-${conn.id}-${Date.now()}` })();
      continue;
    }
    // users('<organiser>')/onlineMeetings('<meeting>')/transcripts('<transcript>')
    if (!n.resource || !/onlineMeetings\('[^']+'\)\/transcripts\('[^']+'\)$/.test(n.resource)) continue;
    await DBOS.startWorkflow(teamsTranscript, {
      workflowID: `teams-${conn.id}-${n.resource.replace(/[^A-Za-z0-9]/g, "").slice(-120)}`,
      queueName: AGENT_QUEUE,
      workflowAttributes: { site: conn.site },
    })(conn.site, conn.id, n.resource);
  }
  // Graph wants a 2xx within three seconds for every batch.
  return { status: 202, body: { ok: true } };
}

// ---- reading a transcript ----


async function read(site: string, connectionId: string, resource: string): Promise<string> {
  const conn = await DBOS.runStep(() => getConnection(listenerDb(), connectionId), { name: "read connection" });
  if (!conn || conn.status === "revoked" || conn.site !== site) return "disconnected";
  const got = await DBOS.runStep(
    async () => {
      const token = await appToken(conn.externalId);
      const meetingPath = resource.replace(/\/transcripts\('[^']+'\)$/, "");
      const meeting = await graph<{
        subject?: string;
        startDateTime?: string;
        joinWebUrl?: string;
        participants?: { organizer?: { upn?: string; identity?: { user?: { displayName?: string } } } };
      }>(token, `/${meetingPath}`).catch(() => null);
      const vtt = await graph<string>(token, `/${resource}/content?$format=text/vtt`, { headers: { Accept: "text/vtt" } });
      return { meeting, vtt };
    },
    { name: "download transcript", retriesAllowed: true, maxAttempts: 4, intervalSeconds: 60 },
  );
  const segments = parseCaptions(got.vtt);
  if (!segments.length) return "empty transcript";
  const organiser = got.meeting?.participants?.organizer;
  const result = await ingestInWorkflow(site, {
        origin: "teams",
        externalId: resource,
        title: got.meeting?.subject || "Teams meeting",
        uri: got.meeting?.joinWebUrl ?? "",
        occurred: got.meeting?.startDateTime ? Date.parse(got.meeting.startDateTime) : null,
        participants: organiser?.upn
          ? [{ name: organiser.identity?.user?.displayName || organiser.upn, email: organiser.upn, side: "internal" }]
          : [],
        segments,
      });
  await DBOS.runStep(() => touchConnection(conn.id, site, "teams"), { name: "seen" });
  return result.created ? `ingested ${result.source}` : `already had ${result.source}`;
}

export const teamsTranscript = DBOS.registerWorkflow(read, { name: "teams-transcript" });

// ---- keeping subscriptions alive ----

async function renewOne(conn: Connection & { secret: string }): Promise<void> {
  const token = await appToken(conn.externalId);
  const sub = String(conn.config.subscription ?? "");
  const expires = new Date(Date.now() + SUBSCRIPTION_MS).toISOString();
  try {
    if (!sub) throw Object.assign(new Error("no subscription"), { status: 404 });
    await graph(token, `/subscriptions/${encodeURIComponent(sub)}`, { method: "PATCH", body: JSON.stringify({ expirationDateTime: expires }) });
    await saveConnection({ id: conn.id, site: conn.site, provider: "teams", config: { ...conn.config, expires } });
  } catch (err) {
    if ((err as { status?: number }).status !== 404) throw err;
    const fresh = await subscribe(conn.externalId, open<TeamsSecret>(conn.secret).clientState);
    await saveConnection({ id: conn.id, site: conn.site, provider: "teams", config: { ...conn.config, subscription: fresh.id, expires: fresh.expirationDateTime } });
  }
}

async function renew(): Promise<void> {
  const conns = await DBOS.runStep(() => activeConnections(listenerDb(), "teams"), { name: "connections" });
  for (const conn of conns) {
    await DBOS.runStep(
      () => renewOne(conn).catch((err) => touchConnection(conn.id, conn.site, "teams", String((err as Error).message))),
      { name: `renew ${conn.id}` },
    );
  }
}

export const teamsRenew = DBOS.registerWorkflow(renew, { name: "teams-renew" });

async function renewScheduled(_at: Date, _context: unknown): Promise<void> {
  await renew();
}
export const teamsRenewScheduled = DBOS.registerWorkflow(renewScheduled, { name: "teams-renew-scheduled" });
