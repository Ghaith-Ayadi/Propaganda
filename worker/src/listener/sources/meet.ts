// Google Meet: transcripts through the Meet REST API. A person connects their
// Google account (Settings > Connections > Google Meet); every 15 minutes the
// worker lists that person's conference records that ended since the last
// look and reads each transcript once Google has finished it.
//
// Polling, not the Workspace Events API: events would need a Pub/Sub topic
// and a push endpoint per tenant, for a result that's ready minutes after the
// call anyway. Transcript entries are kept only 30 days, so 15 minutes is
// plenty early.
//
// Needs, on the tenant's side: a Workspace edition with Meet transcripts, and
// transcripts turned on in the call. Google Cloud setup (once, by Ayadi;
// the meetings scope needs Google's app verification): docs/listener.md.

import { DBOS } from "@dbos-inc/dbos-sdk";
import type { Pool } from "pg";
import { AGENT_QUEUE } from "../../workflows/agents.js";
import { activeConnections, getConnection, open, saveConnection, touchConnection, type Connection } from "../connections.js";
import { listenerDb } from "../db.js";
import { ingestInWorkflow } from "../ingest.js";
import type { Participant, Segment } from "../transcript.js";
import { connectionsPage, need, postForm, publicUrl, readState, signState } from "./public.js";

const MEET = "https://meet.googleapis.com/v2";
export const MEET_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/meetings.space.readonly"];

interface MeetSecret {
  refreshToken: string;
}

const REDIRECT = () => `${publicUrl()}/worker/v1/oauth/meet/callback`;

export function meetInstallUrl(site: string, user: string): string {
  const params = new URLSearchParams({
    client_id: need("GOOGLE_CLIENT_ID"),
    redirect_uri: REDIRECT(),
    response_type: "code",
    scope: MEET_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state: signState({ site, user, provider: "meet" }),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function meetCallback(query: URLSearchParams): Promise<string> {
  const state = readState(query.get("state") ?? "", "meet");
  if (!state) return connectionsPage("error=meet-state");
  const code = query.get("code");
  if (!code) return connectionsPage("error=meet-denied");
  const t = await postForm<{ refresh_token?: string; id_token?: string }>("https://oauth2.googleapis.com/token", {
    code,
    client_id: need("GOOGLE_CLIENT_ID"),
    client_secret: need("GOOGLE_CLIENT_SECRET"),
    redirect_uri: REDIRECT(),
    grant_type: "authorization_code",
  });
  if (!t.refresh_token || !t.id_token) return connectionsPage("error=meet-token");
  // The id token comes straight from Google's token endpoint over TLS: its claims are enough here.
  const claims = JSON.parse(Buffer.from(t.id_token.split(".")[1]!, "base64url").toString("utf8")) as { sub: string; email: string };
  await saveConnection({
    site: state.site,
    provider: "meet",
    externalId: claims.sub,
    label: `Google Meet (${claims.email})`,
    secret: { refreshToken: t.refresh_token } satisfies MeetSecret,
    config: { connectedAt: new Date().toISOString(), polledUntil: new Date().toISOString(), email: claims.email },
    createdBy: state.user,
  });
  return connectionsPage("connected=meet");
}

async function accessToken(secret: string): Promise<string> {
  const t = await postForm<{ access_token: string }>("https://oauth2.googleapis.com/token", {
    client_id: need("GOOGLE_CLIENT_ID"),
    client_secret: need("GOOGLE_CLIENT_SECRET"),
    refresh_token: open<MeetSecret>(secret).refreshToken,
    grant_type: "refresh_token",
  });
  return t.access_token;
}

async function meet<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${MEET}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  if (!res.ok) throw new Error(`Meet ${path.split("?")[0]}: ${res.status} ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

async function all<T>(token: string, path: string, key: string, cap = 2000): Promise<T[]> {
  const out: T[] = [];
  let page = "";
  do {
    const sep = path.includes("?") ? "&" : "?";
    const r = await meet<Record<string, unknown>>(token, `${path}${sep}pageSize=100${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`);
    out.push(...((r[key] as T[] | undefined) ?? []));
    page = (r.nextPageToken as string | undefined) ?? "";
  } while (page && out.length < cap);
  return out;
}


// ---- one transcript ----

interface MeetParticipant {
  name: string;
  signedinUser?: { displayName?: string };
  anonymousUser?: { displayName?: string };
  phoneUser?: { displayName?: string };
}
interface MeetEntry {
  participant: string;
  text: string;
  startTime: string;
}

async function read(site: string, connectionId: string, record: string, transcript: string, startTime: string): Promise<string> {
  const conn = await DBOS.runStep(() => getConnection(listenerDb(), connectionId), { name: "read connection" });
  if (!conn || conn.status === "revoked" || conn.site !== site) return "disconnected";
  const got = await DBOS.runStep(
    async () => {
      const token = await accessToken(conn.secret);
      const people = await all<MeetParticipant>(token, `/${record}/participants`, "participants");
      const entries = await all<MeetEntry>(token, `/${transcript}/entries`, "transcriptEntries", 20_000);
      return { people, entries };
    },
    { name: "read transcript", retriesAllowed: true, maxAttempts: 4, intervalSeconds: 60 },
  );
  const names = new Map(
    got.people.map((p) => [p.name, p.signedinUser?.displayName || p.anonymousUser?.displayName || p.phoneUser?.displayName || "Unknown"]),
  );
  const segments: Segment[] = got.entries.map((e) => ({ speaker: names.get(e.participant) ?? "Unknown", text: e.text, at: Date.parse(e.startTime) || undefined }));
  if (!segments.length) return "empty transcript";
  const email = String(conn.config.email ?? "");
  const participants: Participant[] = [...new Set(names.values())].map((name) => ({ name }));
  if (email) participants.push({ name: email, email, side: "internal" });
  const result = await ingestInWorkflow(site, {
        origin: "meet",
        externalId: transcript,
        title: `Google Meet call, ${new Date(startTime).toISOString().slice(0, 10)}`,
        uri: "",
        occurred: Date.parse(startTime) || null,
        participants,
        segments,
      });
  await DBOS.runStep(() => touchConnection(conn.id, site, "meet"), { name: "seen" });
  return result.created ? `ingested ${result.source}` : `already had ${result.source}`;
}

export const meetTranscript = DBOS.registerWorkflow(read, { name: "meet-transcript" });

// ---- the poll ----

async function pollOne(conn: Connection & { secret: string }, now: number): Promise<{ record: string; transcript: string; start: string }[]> {
  const token = await accessToken(conn.secret);
  // Records that ended since the last poll, with an hour of overlap: a transcript
  // can take a while after the call to be FILE_GENERATED.
  const since = new Date((Date.parse(String(conn.config.polledUntil ?? conn.config.connectedAt)) || now) - 3600_000).toISOString();
  const connectedAt = Date.parse(String(conn.config.connectedAt ?? "")) || 0;
  const records = await all<{ name: string; startTime: string }>(
    token,
    `/conferenceRecords?filter=${encodeURIComponent(`end_time>="${since}"`)}`,
    "conferenceRecords",
    500,
  );
  const ready: { record: string; transcript: string; start: string }[] = [];
  for (const r of records) {
    if (Date.parse(r.startTime) < connectedAt) continue; // never look back
    const ts = await all<{ name: string; state: string }>(token, `/${r.name}/transcripts`, "transcripts");
    for (const t of ts) if (t.state === "FILE_GENERATED") ready.push({ record: r.name, transcript: t.name, start: r.startTime });
  }
  return ready;
}

async function poll(_at: Date, _context: unknown): Promise<void> {
  const conns = await DBOS.runStep(() => activeConnections(listenerDb(), "meet"), { name: "connections" });
  for (const conn of conns) {
    const now = await DBOS.now();
    const ready = await DBOS.runStep(
      () => pollOne(conn, now).catch(async (err) => {
        await touchConnection(conn.id, conn.site, "meet", String((err as Error).message));
        return [];
      }),
      { name: `poll ${conn.id}` },
    );
    for (const r of ready) {
      // One run per transcript: the overlapping polls start it once.
      await DBOS.startWorkflow(meetTranscript, {
        workflowID: `meet-${conn.id}-${r.transcript.replace(/[^A-Za-z0-9]/g, "")}`,
        queueName: AGENT_QUEUE,
        workflowAttributes: { site: conn.site },
      })(conn.site, conn.id, r.record, r.transcript, r.start);
    }
    await DBOS.runStep(
      () => saveConnection({ id: conn.id, site: conn.site, provider: "meet", config: { ...conn.config, polledUntil: new Date(now).toISOString() } }),
      { name: `polled ${conn.id}` },
    );
  }
}

export const meetPoll = DBOS.registerWorkflow(poll, { name: "meet-poll" });
