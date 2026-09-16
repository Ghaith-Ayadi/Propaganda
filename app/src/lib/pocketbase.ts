import PocketBase, { type RecordModel } from "pocketbase";

// The backend: Propaganda's PocketBase instance on Bedrock (Ghaith-Ayadi/Bedrock).
const url = import.meta.env.VITE_PB_URL as string | undefined;

if (!url) {
  throw new Error("Missing VITE_PB_URL");
}

export const pb = new PocketBase(url);

// The editor fires overlapping list requests; the SDK's default cancels the
// earlier one, which the sync engine would read as a failure.
pb.autoCancellation(false);

export type PbUser = RecordModel & {
  email: string;
  name?: string;
  avatar?: string;
};

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Mint a PocketBase record id on the client: 15 chars of [a-z0-9], the same
 * shape the server generates. Records are created locally with their final id,
 * so nothing has to be re-keyed after the first push, offline or not.
 */
export function newId(): string {
  const bytes = new Uint8Array(15);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ID_ALPHABET[b % ID_ALPHABET.length];
  return out;
}

/** PocketBase date strings are "YYYY-MM-DD HH:mm:ss.sssZ"; Safari's Date needs the T. */
export function pbDateToMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value.includes("T") ? value : value.replace(" ", "T"));
  return Number.isNaN(ms) ? null : ms;
}

/** Milliseconds to an ISO string PocketBase accepts for date fields, or "" for none. */
export function msToPbDate(ms: number | null | undefined): string {
  return ms ? new Date(ms).toISOString() : "";
}

/** True when a 400 from PocketBase names this field in its validation errors. */
export function fieldError(err: unknown, field: string): boolean {
  const data = (err as { data?: { data?: Record<string, unknown> } })?.data?.data;
  return Boolean(data && field in data);
}

export function httpStatus(err: unknown): number {
  return (err as { status?: number })?.status ?? 0;
}
