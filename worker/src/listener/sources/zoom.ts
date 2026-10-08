// Zoom: cloud recording transcripts. The tenant installs Propaganda's Zoom app
// (OAuth, account level) from Settings > Connections; Zoom then calls
// POST /hooks/zoom with recording.transcript_completed when a recorded
// meeting's transcript is ready, and the worker downloads the VTT.
//
// Needs, on the tenant's side: a paid Zoom plan, cloud recording on, and
// "Create audio transcript" on in the recording settings. Zoom app setup
// (once, by Ayadi): docs/listener.md.

import { createHmac, timingSafeEqual } from "node:crypto";
import { DBOS } from "@dbos-inc/dbos-sdk";
import type { Pool } from "pg";
import { AGENT_QUEUE } from "../../workflows/agents.js";
import { connectionByExternal, getConnection, open, revokeConnection, saveConnection, touchConnection } from "../connections.js";
import { listenerDb } from "../db.js";
import { ingestInWorkflow } from "../ingest.js";
import { parseCaptions } from "../transcript.js";
import { connectionsPage, need, postForm, publicUrl, readState, signState } from "./public.js";

interface ZoomSecret {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

const REDIRECT = () => `${publicUrl()}/worker/v1/oauth/zoom/callback`;

function basic(): string {
  return `Basic ${Buffer.from(`${need("ZOOM_CLIENT_ID")}:${need("ZOOM_CLIENT_SECRET")}`).toString("base64")}`;
}

export function zoomInstallUrl(site: string, user: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: need("ZOOM_CLIENT_ID"),
    redirect_uri: REDIRECT(),
    state: signState({ site, user, provider: "zoom" }),
  });
  return `https://zoom.us/oauth/authorize?${params}`;
}

export async function zoomCallback(query: URLSearchParams): Promise<string> {
  const state = readState(query.get("state") ?? "", "zoom");
  if (!state) return connectionsPage("error=zoom-state");
  const code = query.get("code");
  if (!code) return connectionsPage("error=zoom-denied");
  const t = await postForm<{ access_token: string; refresh_token: string; expires_in: number }>(
    "https://zoom.us/oauth/token",
    { grant_type: "authorization_code", code, redirect_uri: REDIRECT() },
    { Authorization: basic() },
  );
  const me = await fetch("https://api.zoom.us/v2/users/me", { headers: { Authorization: `Bearer ${t.access_token}` } }).then(
    (r) => r.json() as Promise<{ account_id: string; email: string }>,
  );
  await saveConnection({
    site: state.site,
    provider: "zoom",
    externalId: me.account_id,
    label: `Zoom (${me.email})`,
    secret: { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: Date.now() + t.expires_in * 1000 } satisfies ZoomSecret,
    config: { connectedAt: new Date().toISOString(), installedBy: me.email },
    createdBy: state.user,
  });
  return connectionsPage("connected=zoom");
}

/** A usable access token, refreshed (and the new pair stored) when it's about to expire. */
async function accessToken(conn: { id: string; site: string; secret: string }): Promise<string> {
  const s = open<ZoomSecret>(conn.secret);
  if (s.expiresAt - Date.now() > 120_000) return s.accessToken;
  const t = await postForm<{ access_token: string; refresh_token: string; expires_in: number }>(
    "https://zoom.us/oauth/token",
    { grant_type: "refresh_token", refresh_token: s.refreshToken },
    { Authorization: basic() },
  );
  await saveConnection({
    id: conn.id,
    site: conn.site,
    provider: "zoom",
    secret: { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: Date.now() + t.expires_in * 1000 },
  });
  return t.access_token;
}

// ---- webhooks ----

/** x-zm-signature = "v0=" + HMAC-SHA256(secret token, "v0:<timestamp>:<body>"), hex. */
export function verifyZoom(timestamp: string, signature: string, rawBody: string, secret: string, now = Date.now()): boolean {
  if (!/^\d+$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const want = Buffer.from(`v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`);
  const got = Buffer.from(signature);
  return got.length === want.length && timingSafeEqual(got, want);
}

interface ZoomRecordingFile {
  file_type?: string;
  download_url?: string;
  status?: string;
}
interface ZoomPayload {
  event: string;
  payload: {
    plainToken?: string;
    account_id?: string;
    object?: {
      uuid: string;
      topic?: string;
      start_time?: string;
      host_email?: string;
      share_url?: string;
      recording_files?: ZoomRecordingFile[];
    };
  };
  download_token?: string;
}

export async function onZoomHook(
  db: Pool,
  headers: Record<string, string | string[] | undefined>,
  rawBody: string,
): Promise<{ status: number; body: unknown }> {
  const secret = need("ZOOM_WEBHOOK_SECRET");
  const body = JSON.parse(rawBody) as ZoomPayload;
  // Zoom checks the endpoint before using it, and every 72 hours.
  if (body.event === "endpoint.url_validation" && body.payload.plainToken) {
    const plainToken = body.payload.plainToken;
    return { status: 200, body: { plainToken, encryptedToken: createHmac("sha256", secret).update(plainToken).digest("hex") } };
  }
  const h = (n: string) => String(headers[n] ?? "");
  if (!verifyZoom(h("x-zm-request-timestamp"), h("x-zm-signature"), rawBody, secret)) return { status: 401, body: { error: "Bad signature" } };

  const account = body.payload.account_id ?? "";
  const conn = account ? await connectionByExternal(db, "zoom", account) : null;
  if (!conn) return { status: 200, body: { ok: true } };
  if (body.event === "app_deauthorized") {
    await revokeConnection(conn.id);
    return { status: 200, body: { ok: true } };
  }
  if (body.event !== "recording.transcript_completed" || !body.payload.object) return { status: 200, body: { ok: true } };
  const o = body.payload.object;
  const file = o.recording_files?.find((f) => f.file_type === "TRANSCRIPT" && f.download_url);
  if (!file) return { status: 200, body: { ok: true } };
  await DBOS.startWorkflow(zoomTranscript, {
    workflowID: `zoom-${conn.id}-${o.uuid}`,
    queueName: AGENT_QUEUE,
    workflowAttributes: { site: conn.site },
  })(conn.site, conn.id, {
    uuid: o.uuid,
    topic: o.topic ?? "Zoom call",
    startTime: o.start_time ?? null,
    hostEmail: o.host_email ?? "",
    shareUrl: o.share_url ?? "",
    downloadUrl: file.download_url!,
    // Valid 24 hours: good for the first try; after that the run uses the app's own token.
    downloadToken: body.download_token ?? "",
  });
  return { status: 200, body: { ok: true } };
}

// ---- reading a transcript ----


interface ZoomJob {
  uuid: string;
  topic: string;
  startTime: string | null;
  hostEmail: string;
  shareUrl: string;
  downloadUrl: string;
  downloadToken: string;
}

async function read(site: string, connectionId: string, job: ZoomJob): Promise<string> {
  const conn = await DBOS.runStep(() => getConnection(listenerDb(), connectionId), { name: "read connection" });
  if (!conn || conn.status === "revoked" || conn.site !== site) return "disconnected";
  const connectedAt = Date.parse(String(conn.config.connectedAt ?? "")) || 0;
  if (job.startTime && Date.parse(job.startTime) < connectedAt) return "older than the connection";

  const vtt = await DBOS.runStep(
    async () => {
      const token = job.downloadToken || (await accessToken(conn));
      let res = await fetch(job.downloadUrl, { headers: { Authorization: `Bearer ${token}` }, redirect: "follow" });
      if (res.status === 401 && job.downloadToken) {
        res = await fetch(job.downloadUrl, { headers: { Authorization: `Bearer ${await accessToken(conn)}` }, redirect: "follow" });
      }
      if (!res.ok) throw new Error(`Zoom transcript download: ${res.status}`);
      return res.text();
    },
    { name: "download transcript", retriesAllowed: true, maxAttempts: 4, intervalSeconds: 60 },
  );
  const segments = parseCaptions(vtt);
  if (!segments.length) return "empty transcript";
  const result = await ingestInWorkflow(site, {
        origin: "zoom",
        externalId: job.uuid,
        title: job.topic,
        uri: job.shareUrl,
        occurred: job.startTime ? Date.parse(job.startTime) : null,
        // Zoom's VTT names speakers but not their emails; the host is the tenant's.
        participants: job.hostEmail ? [{ name: job.hostEmail, email: job.hostEmail, side: "internal" }] : [],
        segments,
      });
  await DBOS.runStep(() => touchConnection(conn.id, site, "zoom"), { name: "seen" });
  return result.created ? `ingested ${result.source}` : `already had ${result.source}`;
}

export const zoomTranscript = DBOS.registerWorkflow(read, { name: "zoom-transcript" });
