// Everything a model got and gave back, one row per model call in
// public.model_call_io (migration 20261010000040), linked to its model_calls
// row. It is the raw material for Propaganda Labs (Ayadi, 2026-10-10): read a
// past answer, change a prompt, replay the same input and compare.
//
// Superadmin only: it holds tenants' drafts, call transcripts and knowledge
// base claims. Written with the service role, read by nobody else.
//
// A capture never fails the call it records: the answer is already paid for.
// A database without the table (before the migration) answers 404 and the
// capture is skipped quietly; any other failure is reported once per process.

import { scrub } from "./modelKeys";

/** Above this, a request or response is cut and the row marked truncated. Chat transcripts can be long. */
export const CAPTURE_MAX_CHARS = Number(process.env.MODEL_CAPTURE_MAX_CHARS ?? 2_000_000);

type Rest = (path: string, init?: RequestInit) => Promise<Response>;

export interface Capture {
  /** The model_calls row this belongs to. */
  call: string;
  site: string;
  /** The steps of one streamed reply share a turn; a single call has none. */
  turn?: string | null;
  step?: number;
  /** What the model got: system, prompt or messages, tools, settings. */
  request: unknown;
  /** What came back: text, reasoning, tool calls and results, why it stopped; or the error. */
  response: unknown;
}

/** A call id as the cost log stores it: 15 characters of [a-z0-9], minted here so the capture can point at it. */
export function newCallId(): string {
  const abc = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(15));
  return Array.from(bytes, (b) => abc[b % abc.length]).join("");
}

let off = process.env.MODEL_CAPTURE === "off";
let warned = false;

/** For tests. */
export function setCapture(on: boolean): void {
  off = !on;
}

function fit(value: unknown): { value: unknown; cut: boolean } {
  const json = JSON.stringify(value ?? null);
  if (json.length <= CAPTURE_MAX_CHARS) return { value: value ?? null, cut: false };
  return { value: { truncated: json.slice(0, CAPTURE_MAX_CHARS) }, cut: true };
}

export async function writeCapture(rest: Rest, c: Capture): Promise<void> {
  if (off) return;
  try {
    const req = fit(c.request);
    const res = fit(c.response);
    const r = await rest("/model_call_io", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        call: c.call,
        site: c.site,
        turn: c.turn ?? null,
        step: c.step ?? 1,
        request: req.value,
        response: res.value,
        truncated: req.cut || res.cut,
      }),
    });
    if (r.status === 404) return; // no table yet on this database
    if (!r.ok && !warned) {
      warned = true;
      console.error(`model capture: model_call_io insert answered ${r.status}: ${(await r.text()).slice(0, 300)}`);
    }
  } catch (err) {
    if (!warned) {
      warned = true;
      console.error(`model capture: ${String(err)}`);
    }
  }
}

/** An error as data: its message and, when the provider gave them, status and body. */
export function errorOf(err: unknown): Record<string, unknown> {
  const e = err as { name?: string; message?: string; statusCode?: number; responseBody?: string };
  return {
    error: {
      name: e?.name ?? "Error",
      message: scrub(String(e?.message ?? err)),
      status: e?.statusCode ?? null,
      body: e?.responseBody ? scrub(e.responseBody.slice(0, 4000)) : null,
    },
  };
}
