// Network settings for model calls.

import { Agent, fetch as undiciFetch } from "undici";

/**
 * The gateway's fetch with room for a slow model. A call is not streamed, so
 * its headers come only once the whole answer exists, and Node's default
 * (300 s) cut off a 12k-token draft on a slow model: three SDK attempts and a
 * DBOS step retry, each possibly billed upstream, before anything came back.
 * Only model calls get the long timeouts; the SDK's retries for real network
 * errors stay.
 */
export function gatewayFetch(seconds: number): typeof fetch {
  const ms = seconds * 1000;
  const dispatcher = new Agent({ headersTimeout: ms, bodyTimeout: ms });
  return ((url, init) => undiciFetch(url as never, { ...(init as object), dispatcher }) as unknown as Promise<Response>) as typeof fetch;
}
