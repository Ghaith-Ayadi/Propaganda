// The end of Google sign-in. The popup opened by lib/accounts.ts goes to
// Google, then to the auth server, which sends it here with `?code=` (or an
// error). This page only hands the result to the window that asked, which
// holds the PKCE verifier and exchanges the code itself, and closes.
//
// Two ways back, because a cross-origin trip can sever window.opener: a
// BroadcastChannel (same origin, any window) and postMessage to the opener.
// The asking window takes whichever arrives first. Kept free of imports so the
// popup doesn't load the app to run it.

export const OAUTH_CALLBACK_PATH = "/auth/callback";
export const OAUTH_MESSAGE = "propaganda:oauth";

export interface OAuthMessage {
  type: typeof OAUTH_MESSAGE;
  code: string | null;
  error: string | null;
}

export function isOAuthCallback(): boolean {
  return typeof window !== "undefined" && window.location.pathname === OAUTH_CALLBACK_PATH;
}

export function relayOAuthResult(): void {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const pick = (k: string) => query.get(k) ?? hash.get(k);
  const message: OAuthMessage = {
    type: OAUTH_MESSAGE,
    code: pick("code"),
    error: pick("error_description") ?? pick("error"),
  };
  try {
    const channel = new BroadcastChannel(OAUTH_MESSAGE);
    channel.postMessage(message);
    channel.close();
  } catch {
    // No BroadcastChannel: the opener path below.
  }
  try {
    window.opener?.postMessage(message, window.location.origin);
  } catch {
    // Severed or gone: the channel above.
  }
  document.body.textContent = message.code ? "Signed in. You can close this window." : "Sign-in didn't complete. You can close this window.";
  // A moment for the messages to leave before the window goes.
  window.setTimeout(() => window.close(), 150);
}
