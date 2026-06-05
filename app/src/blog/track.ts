// Page-view beacon for the public blog. One ~500-byte navigator.sendBeacon
// per reading session, fired on pagehide / tab-hide. No SDK, no library, no
// blocking work on the reader's critical path.
//
// Writes go to the Cloudflare Worker at VITE_ANALYTICS_URL (/collect). The
// Worker derives country (request.cf) and device (UA) server-side; the client
// only sends what it alone knows: which post, how long, how far scrolled.

const BASE = (import.meta.env.VITE_ANALYTICS_URL as string | undefined)?.replace(/\/$/, "");
const TENANT = (import.meta.env.VITE_ANALYTICS_TENANT as string) || "verbatim";

export interface TrackOpts {
  postId?: string;
  collection?: string;
  path?: string;
}

/**
 * Start tracking the current page. Returns a teardown that flushes the beacon
 * (used on SPA navigation away). Safe to call when unconfigured or on
 * localhost — it becomes a no-op so dev sessions don't pollute real data.
 */
export function installPageTracker(opts: TrackOpts): () => void {
  if (!BASE || typeof window === "undefined" || !("sendBeacon" in navigator)) return () => {};
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host === "") return () => {};

  const sid = sessionId();
  const start = Date.now();
  let maxScroll = 0;
  let sent = false;

  const onScroll = () => {
    const doc = document.documentElement;
    const scrollable = doc.scrollHeight - window.innerHeight;
    const pct = scrollable > 0 ? window.scrollY / scrollable : 1;
    if (pct > maxScroll) maxScroll = Math.min(1, pct);
  };

  const send = () => {
    if (sent) return;
    sent = true;
    const payload = JSON.stringify({
      t: TENANT,
      e: "view",
      p: opts.postId ?? "",
      c: opts.collection ?? "",
      path: opts.path ?? window.location.pathname,
      r: document.referrer || "",
      sid,
      d: Math.round((Date.now() - start) / 1000),
      sc: Math.round(maxScroll * 100) / 100,
    });
    try {
      navigator.sendBeacon(`${BASE}/collect`, payload);
    } catch {
      /* never throw on the reader's path */
    }
  };

  const onVisibility = () => {
    if (document.visibilityState === "hidden") send();
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("pagehide", send);
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("pagehide", send);
    document.removeEventListener("visibilitychange", onVisibility);
    send(); // flush on SPA nav to the next post
  };
}

function sessionId(): string {
  try {
    const k = "verbatim:sid";
    let v = sessionStorage.getItem(k);
    if (!v) {
      v = (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)).slice(0, 36);
      sessionStorage.setItem(k, v);
    }
    return v;
  } catch {
    return Math.random().toString(36).slice(2);
  }
}
