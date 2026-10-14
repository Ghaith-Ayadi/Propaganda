// The conversation each site had open last, so the Chat page reopens it when the
// person comes back from another page (#/chat on its own). A per-viewer
// convenience: the messages themselves live on the server.

const key = (site: string) => `propaganda:chat-last:${site}`;

export function lastOpenConversation(site: string): string | null {
  try {
    return localStorage.getItem(key(site));
  } catch {
    return null; // private window or blocked storage
  }
}

export function rememberOpenConversation(site: string, id: string | null) {
  try {
    if (id) localStorage.setItem(key(site), id);
    else localStorage.removeItem(key(site));
  } catch {
    // nothing to do: Chat opens on a new chat
  }
}
