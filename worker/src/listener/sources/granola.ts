// Granola (docs.granola.ai). The tenant pastes an API key (Granola desktop >
// Settings > API; Business or Enterprise plan) in Settings > Connections. The
// worker then registers a webhook on Granola pointing back at itself, and
// every new note's transcript arrives without polling:
//
//   note.generated / note.access_granted  ->  POST /hooks/granola/<connection>
//     (Standard Webhooks signature)  ->  granolaNote run: Get Note with the
//     transcript  ->  ingest()
//
// An hourly sweep lists notes created since the last one, for anything a
// webhook missed (Granola stops retrying after four days). Notes created
// before the connection are never read: transcripts never look back.

import { createHmac, timingSafeEqual } from "node:crypto";
import { DBOS } from "@dbos-inc/dbos-sdk";
import type { Pool } from "pg";
import { AGENT_QUEUE } from "../../workflows/agents.js";
import { activeConnections, getConnection, open, saveConnection, touchConnection, type Connection } from "../connections.js";
import { listenerDb } from "../db.js";
import { ingestInWorkflow } from "../ingest.js";
import type { Participant, Segment, Transcript } from "../transcript.js";
import { publicUrl } from "./public.js";

const API = process.env.GRANOLA_API_URL ?? "https://public-api.granola.ai/v1";

export interface GranolaSecret {
  apiKey: string;
  signingSecret: string;
  webhookId: string;
}

export class GranolaError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GranolaError";
  }
}

async function call<T>(apiKey: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...init.headers },
  });
  const text = await res.text();
  if (!res.ok) throw new GranolaError(res.status, `Granola ${init.method ?? "GET"} ${path.split("?")[0]}: ${res.status} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}

// ---- connecting ----

/**
 * Check the key, register the webhook, store the connection. A personal key
 * gets notes the person owns or that are shared with them plus public ones;
 * a workspace key gets the workspace's.
 */
export async function connectGranola(input: { site: string; apiKey: string; createdBy: string }): Promise<string> {
  const apiKey = input.apiKey.trim();
  if (!/^grn_[A-Za-z0-9_-]{8,}$/.test(apiKey)) throw new GranolaError(400, "That isn't a Granola API key (they start with grn_)");
  await call(apiKey, "/notes?page_size=1"); // 401 here means a bad key

  // The connection id is in the webhook's URL, so it exists first, paused.
  const id = await saveConnection({ site: input.site, provider: "granola", label: "Granola", status: "paused", createdBy: input.createdBy });
  const url = `${publicUrl()}/worker/v1/hooks/granola/${id}`;
  const events = ["note.generated", "note.access_granted"];
  let hook: { id: string; signing_secret: string; created_by?: { email?: string } | null };
  try {
    hook = await call(apiKey, "/webhook-endpoints", { method: "POST", body: JSON.stringify({ url, events, scopes: ["personal", "public"] }) });
  } catch (err) {
    // A workspace key accepts exactly ["workspace"].
    if (!(err instanceof GranolaError) || err.status >= 500) throw err;
    hook = await call(apiKey, "/webhook-endpoints", { method: "POST", body: JSON.stringify({ url, events, scopes: ["workspace"] }) });
  }
  const who = hook.created_by?.email;
  await saveConnection({
    id,
    site: input.site,
    provider: "granola",
    externalId: hook.id,
    label: who ? `Granola (${who})` : "Granola (workspace)",
    secret: { apiKey, signingSecret: hook.signing_secret, webhookId: hook.id } satisfies GranolaSecret,
    config: { connectedAt: new Date().toISOString(), sweptUntil: new Date().toISOString() },
    status: "active",
  });
  return id;
}

/** Remove the webhook on Granola's side; the caller revokes the row. */
export async function disconnectGranola(conn: Connection & { secret: string }): Promise<void> {
  if (!conn.secret) return;
  const s = open<GranolaSecret>(conn.secret);
  await call(s.apiKey, `/webhook-endpoints/${encodeURIComponent(s.webhookId)}`, { method: "DELETE" }).catch((err) => {
    if (!(err instanceof GranolaError && err.status === 404)) throw err;
  });
}

// ---- deliveries ----

/** Standard Webhooks: HMAC-SHA256 of "<id>.<timestamp>.<body>" with the whsec_ secret, five minutes' tolerance. */
export function verifyGranola(
  headers: Record<string, string | string[] | undefined>,
  rawBody: string,
  signingSecret: string,
  now = Date.now(),
): boolean {
  const h = (n: string) => {
    const v = headers[n];
    return Array.isArray(v) ? v[0] ?? "" : v ?? "";
  };
  const id = h("webhook-id");
  const ts = h("webhook-timestamp");
  if (!id || !/^\d+$/.test(ts) || Math.abs(now / 1000 - Number(ts)) > 300) return false;
  const key = Buffer.from(signingSecret.replace(/^whsec_/, ""), "base64");
  const expected = Buffer.from(createHmac("sha256", key).update(`${id}.${ts}.${rawBody}`, "utf8").digest("base64"));
  return h("webhook-signature")
    .split(" ")
    .some((part) => {
      const [version, sig = ""] = part.split(",");
      const got = Buffer.from(sig);
      return version === "v1" && got.length === expected.length && timingSafeEqual(got, expected);
    });
}

/** Answer a delivery: 200 once the note's run is queued (Granola allows 15 seconds). */
export async function onGranolaHook(
  db: Pool,
  connectionId: string,
  headers: Record<string, string | string[] | undefined>,
  rawBody: string,
): Promise<{ status: number; body: unknown }> {
  const conn = await getConnection(db, connectionId);
  if (!conn || conn.provider !== "granola" || !conn.secret || conn.status === "revoked") return { status: 404, body: { error: "Unknown hook" } };
  const secret = open<GranolaSecret>(conn.secret);
  if (!verifyGranola(headers, rawBody, secret.signingSecret)) return { status: 401, body: { error: "Bad signature" } };
  const event = JSON.parse(rawBody) as { event_type?: string; note_id?: string };
  if ((event.event_type === "note.generated" || event.event_type === "note.access_granted") && /^not_[A-Za-z0-9]{14}$/.test(event.note_id ?? "")) {
    await startNote(conn.site, conn.id, event.note_id!);
  }
  return { status: 200, body: { ok: true } };
}

function startNote(site: string, connection: string, noteId: string) {
  // One run per note and connection: retries, the sweep and an edit later are the same run.
  return DBOS.startWorkflow(granolaNote, {
    workflowID: `granola-${connection}-${noteId}`,
    queueName: AGENT_QUEUE,
    workflowAttributes: { site },
  })(site, connection, noteId);
}

// ---- reading a note ----

interface GranolaUser {
  name: string | null;
  email: string;
}
interface GranolaItem {
  speaker: { source: string; attribution?: "me" | "them"; diarization_label?: string; name?: string };
  text: string;
  start_time: string;
}
export interface GranolaNote {
  id: string;
  title: string | null;
  owner: GranolaUser;
  created_at: string;
  web_url?: string;
  attendees?: GranolaUser[];
  calendar_event?: { event_title: string | null; scheduled_start_time: string | null } | null;
  transcript?: GranolaItem[] | null;
}

/** A Granola note and its transcript as the Listener's Transcript. The note's owner is the tenant's side. */
export function noteToTranscript(note: GranolaNote, items: GranolaItem[]): Transcript {
  const owner = note.owner.name || note.owner.email;
  const segments: Segment[] = items.map((i) => ({
    speaker:
      i.speaker.name ||
      (i.speaker.attribution === "me" ? owner : i.speaker.diarization_label || (i.speaker.attribution === "them" ? "Them" : "Unknown")),
    text: i.text,
    at: Date.parse(i.start_time) || undefined,
  }));
  const participants: Participant[] = [{ name: owner, email: note.owner.email, side: "internal" }];
  for (const a of note.attendees ?? []) {
    if (a.email.toLowerCase() === note.owner.email.toLowerCase()) continue;
    participants.push({ name: a.name || a.email, email: a.email });
  }
  return {
    origin: "granola",
    externalId: note.id,
    title: note.title || note.calendar_event?.event_title || "Granola note",
    uri: note.web_url ?? "",
    occurred: Date.parse(note.calendar_event?.scheduled_start_time ?? "") || Date.parse(note.created_at) || null,
    participants,
    segments,
  };
}

async function fetchNote(apiKey: string, noteId: string): Promise<{ note: GranolaNote; items: GranolaItem[] }> {
  const id = encodeURIComponent(noteId);
  try {
    const note = await call<GranolaNote>(apiKey, `/notes/${id}?include=transcript`);
    if (Array.isArray(note.transcript)) return { note, items: note.transcript };
  } catch (err) {
    if (!(err instanceof GranolaError && /TRANSCRIPT_TOO_LARGE/.test(err.message))) throw err;
  }
  const note = await call<GranolaNote>(apiKey, `/notes/${id}`);
  const items: GranolaItem[] = [];
  let cursor: string | null = null;
  do {
    const page: { transcript: GranolaItem[]; hasMore: boolean; cursor: string | null } = await call(
      apiKey,
      `/notes/${id}/transcript?page_size=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    items.push(...page.transcript);
    cursor = page.hasMore ? page.cursor : null;
  } while (cursor);
  return { note, items };
}


async function readNote(site: string, connectionId: string, noteId: string): Promise<string> {
  const conn = await DBOS.runStep(async () => {
    const c = await getConnection(listenerDb(), connectionId);
    return c && c.site === site && c.status !== "revoked" ? c : null;
  }, { name: "read connection" });
  if (!conn) return "disconnected";

  const got = await DBOS.runStep(
    async () => {
      try {
        return await fetchNote(open<GranolaSecret>(conn.secret).apiKey, noteId);
      } catch (err) {
        await touchConnection(conn.id, site, "granola", String((err as Error).message)).catch(() => {});
        throw err;
      }
    },
    { name: "fetch note", retriesAllowed: true, maxAttempts: 4, intervalSeconds: 30 },
  );
  const connectedAt = Date.parse(String(conn.config.connectedAt ?? "")) || 0;
  if (Date.parse(got.note.created_at) < connectedAt) return "older than the connection";
  if (!got.items.length) return "no transcript";

  const result = await ingestInWorkflow(site, noteToTranscript(got.note, got.items));
  await DBOS.runStep(() => touchConnection(conn.id, site, "granola"), { name: "seen" });
  return result.created ? `ingested ${result.source}` : `already had ${result.source}`;
}

export const granolaNote = DBOS.registerWorkflow(readNote, { name: "granola-note" });

// ---- the sweep ----

async function sweep(): Promise<void> {
  const conns = await DBOS.runStep(() => activeConnections(listenerDb(), "granola"), { name: "connections" });
  for (const conn of conns) {
    const since = String(conn.config.sweptUntil ?? conn.config.connectedAt ?? new Date().toISOString());
    const until = await DBOS.now();
    const ids = await DBOS.runStep(
      async () => {
        const out: string[] = [];
        const key = open<GranolaSecret>(conn.secret).apiKey;
        let cursor: string | null = null;
        do {
          const page: { notes: { id: string }[]; hasMore: boolean; cursor: string | null } = await call(
            key,
            `/notes?page_size=30&created_after=${encodeURIComponent(since)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
          );
          out.push(...page.notes.map((n) => n.id));
          cursor = page.hasMore ? page.cursor : null;
        } while (cursor && out.length < 500);
        return out;
      },
      { name: `list notes ${conn.id}` },
    ).catch(() => [] as string[]);
    for (const noteId of ids) await startNote(conn.site, conn.id, noteId);
    await DBOS.runStep(
      // An hour of overlap: a note created just before the last sweep may not have had its summary yet.
      () => saveConnection({ id: conn.id, site: conn.site, provider: "granola", config: { ...conn.config, sweptUntil: new Date(until - 3600_000).toISOString() } }),
      { name: `swept ${conn.id}` },
    );
  }
}

async function sweepScheduled(_at: Date, _context: unknown): Promise<void> {
  await sweep();
}

export const granolaSweep = DBOS.registerWorkflow(sweepScheduled, { name: "granola-sweep" });
