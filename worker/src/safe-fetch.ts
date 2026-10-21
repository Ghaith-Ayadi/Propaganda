// A fetch for addresses a tenant chose (a site, a plan file, a watched page).

import { Agent, fetch as undiciFetch } from "undici";
import { guardedLookup, type Resolver } from "../../api/_chat/website";

type Fetch = typeof fetch;

/**
 * Reading a page connects to an address a tenant chose, so it connects through
 * Chat's guarded lookup (api/_chat/website.ts): the address is resolved once, at
 * connect time, and refused unless public. The address checked is the address
 * used, so a host can't answer a public one to a check and 127.0.0.1 to the
 * connection, on the first request or on any redirect hop.
 */
export function guardedPageFetch(resolver?: Resolver): Fetch {
  const dispatcher = new Agent({ connect: { lookup: guardedLookup(resolver) } });
  return (((url: unknown, init?: object) => undiciFetch(url as never, { ...init, dispatcher })) as unknown) as Fetch;
}
/** One guarded fetch for the process. */
export const guardedFetch: Fetch = guardedPageFetch();
