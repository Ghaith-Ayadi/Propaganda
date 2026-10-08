// Where a reference in a reply opens. Pages that other 0.2 threads are still
// building (Knowledge base, Inbox, Goals) return null; the buttons then say so
// instead of going nowhere. Add a line here when one lands.

import { briefHref, postHref } from "@/lib/route";
import type { Ref } from "@/lib/chat/types";

export function hrefFor(ref: Ref): string | null {
  // The placeholder adapter's made-up objects have no page.
  if (ref.id.startsWith("placeholder-")) return null;
  switch (ref.kind) {
    case "post":
      return postHref(ref.id);
    case "pitch":
      // An approved pitch is a brief; the Pipeline page will take over pitches.
      return briefHref(ref.id);
    case "run":
      // Admin › Runs (superadmins only); it lists the run near the top.
      return "#/admin/runs";
    default:
      return null;
  }
}
