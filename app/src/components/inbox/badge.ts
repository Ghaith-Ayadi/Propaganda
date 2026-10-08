// The count beside Inbox in the nav: everything waiting on the person.

import { useInbox } from "./data";

export function useInboxBadge(): number | null {
  const { total } = useInbox();
  return total || null;
}
