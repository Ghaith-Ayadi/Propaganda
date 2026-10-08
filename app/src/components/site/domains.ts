// A site's custom domain: the live check, connect and remove, through
// api/domains.ts (which holds the rules; read its header first). The domain
// being set up, before it's connected, is kept in the site's settings
// (`domain.pending`) so every member's Site page shows the same setup.

import { useCallback, useEffect, useRef, useState } from "react";
import { authHeader } from "@/lib/supabase";
import { AppError, coded } from "@/lib/errors";
import { reportError } from "@/lib/telemetry";
import { PLATFORM_DOMAIN } from "@/lib/siteUrl";

/** The answer of GET /api/domains: see DomainStatus in api/domains.ts. */
export interface DomainStatus {
  domain: string;
  zone: string;
  apex: boolean;
  provider: string;
  records: DomainRecord[];
  proxied: boolean;
  connected: boolean;
  taken: boolean;
  https: { check: "ok" | "pending" | "skipped"; detail: string };
}

export interface DomainRecord {
  role: "point" | "verify";
  type: "CNAME" | "A" | "TXT";
  name: string;
  value: string;
  check: "ok" | "missing" | "wrong";
  found: string[];
}

export const PENDING_DOMAIN_KEY = "domain.pending";

/** A host as people paste it ("https://Blog.Kontra.run/"), to "blog.kontra.run". "" if it can't be one. Same rules as the server. */
export function normalizeDomain(input: string): string {
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
  if (host.length > 253 || !host.includes(".")) return "";
  if (!host.split(".").every((l) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l))) return "";
  if (/^[0-9.]+$/.test(host)) return "";
  if (host === PLATFORM_DOMAIN || host.endsWith(`.${PLATFORM_DOMAIN}`)) return "";
  return host;
}

/** Before the server has looked: a guess at the zone, good enough to say "subdomain" or not. */
export function looksLikeApex(host: string): boolean {
  const labels = host.split(".");
  // co.uk, com.au, …: a two-letter country code under a short second level.
  const twoLevelSuffix =
    labels.length >= 3 && /^[a-z]{2}$/.test(labels[labels.length - 1]) && /^(co|com|net|org|ac|gov|edu)$/.test(labels[labels.length - 2]);
  return labels.length === (twoLevelSuffix ? 3 : 2);
}

async function call(method: string, query: string, body?: unknown): Promise<Response> {
  return fetch(`/api/domains${query}`, {
    method,
    headers: { Authorization: await authHeader(), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** The server's sentence and code, or ours when it sent none (a 404 in dev, a proxy error). */
async function failure(res: Response, code: string, fallback: string): Promise<AppError> {
  const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  return new AppError(body.code || code, body.error || fallback, { name: "HttpError", message: res.statusText, status: res.status });
}

/** The body as a DomainStatus. Not JSON: no function answered (the dev server serves the app instead). */
async function parse(res: Response, code: string): Promise<DomainStatus> {
  try {
    return (await res.json()) as DomainStatus;
  } catch (err) {
    throw coded(code, err, "The domain check isn't available here.");
  }
}

const OFFLINE = "Couldn't reach the server. Check your connection and try again.";

export async function checkDomain(site: string, domain: string): Promise<DomainStatus> {
  let res: Response;
  try {
    res = await call("GET", `?site=${site}&domain=${encodeURIComponent(domain)}`);
  } catch (err) {
    throw coded("DOMAIN-CHECK", err, OFFLINE);
  }
  if (!res.ok) throw await failure(res, "DOMAIN-CHECK", "The check couldn't run.");
  return parse(res, "DOMAIN-CHECK");
}

export async function connectDomain(site: string, domain: string): Promise<DomainStatus> {
  let res: Response;
  try {
    res = await call("POST", "", { site, domain });
  } catch (err) {
    throw coded("DOMAIN-CONNECT", err, OFFLINE);
  }
  if (!res.ok) throw await failure(res, "DOMAIN-CONNECT", "The domain couldn't be connected.");
  return parse(res, "DOMAIN-CONNECT");
}

export async function removeDomain(site: string): Promise<void> {
  let res: Response;
  try {
    res = await call("DELETE", `?site=${site}`);
  } catch (err) {
    throw coded("DOMAIN-REMOVE", err, OFFLINE);
  }
  if (!res.ok) throw await failure(res, "DOMAIN-REMOVE", "The domain couldn't be removed.");
}

/** Connected and the certificate issued. */
export function isLive(s: DomainStatus | null): boolean {
  return Boolean(s?.connected && s.https.check === "ok");
}

/** Both records found. */
export function dnsReady(s: DomainStatus | null): boolean {
  return Boolean(s && s.records.every((r) => r.check === "ok"));
}

/**
 * The live check of `domain`, re-run every `everyMs` until the domain is live
 * (paused while the tab is hidden). With `autoConnect`, the first check that
 * finds both records connects the domain, so the owner never presses a button.
 */
export function useDomainCheck(
  site: string,
  domain: string,
  opts: { everyMs?: number; autoConnect?: boolean; onConnected?: (s: DomainStatus) => void } = {},
): {
  status: DomainStatus | null;
  error: unknown;
  checking: boolean;
  lastChecked: number | null;
  recheck: () => void;
} {
  const everyMs = opts.everyMs ?? 10000;
  const [status, setStatus] = useState<DomainStatus | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const connecting = useRef(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    setStatus(null);
    setError(null);
    setLastChecked(null);
  }, [site, domain]);

  useEffect(() => {
    if (!domain) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function run() {
      if (document.visibilityState === "hidden") {
        timer = setTimeout(run, everyMs);
        return;
      }
      setChecking(true);
      try {
        let s = await checkDomain(site, domain);
        if (!cancelled && optsRef.current.autoConnect && dnsReady(s) && !s.connected && !s.taken && !connecting.current) {
          connecting.current = true;
          try {
            s = await connectDomain(site, domain);
            optsRef.current.onConnected?.(s);
          } finally {
            connecting.current = false;
          }
        }
        if (cancelled) return;
        setStatus(s);
        setError(null);
        if (isLive(s)) return;
      } catch (err) {
        if (cancelled) return;
        setError(err);
        reportError("Domain check failed", err);
        // A refusal won't change by asking again; a network blip will.
        const code = err instanceof AppError ? err.code : "";
        if (code === "DOMAIN-INVALID" || code === "DOMAIN-OFF" || code === "DOMAIN-OWNER") return;
      } finally {
        if (!cancelled) {
          setChecking(false);
          setLastChecked(Date.now());
        }
      }
      if (!cancelled) timer = setTimeout(run, everyMs);
    }

    void run();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [site, domain, everyMs, tick]);

  const recheck = useCallback(() => setTick((n) => n + 1), []);
  return { status, error, checking, lastChecked, recheck };
}
