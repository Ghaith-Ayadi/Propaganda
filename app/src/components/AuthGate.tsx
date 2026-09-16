import { useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { hasStoredSession, signInWithGoogle, useSession } from "@/lib/auth";

/**
 * Gate around the editor. Everything behind it talks to PocketBase as a
 * signed-in user, which is what the collection rules grant write access to;
 * anonymous requests can only read published posts, collections and settings.
 *
 * Sign-in is Google only, through PocketBase's OAuth2 popup. No passwords, no
 * emailed codes, nothing that depends on SMTP.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Must run straight from the click: browsers block the popup otherwise.
  const onSignIn = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center text-xs uppercase tracking-widest text-quaternary">
        Loading…
      </div>
    );
  }

  // Offline, an expired token can't be refreshed. Drafts live in IndexedDB and
  // the author must be able to reach them, so a stored session is enough to
  // open the editor; writes stay dirty until sync can authenticate again.
  const offlineGrace = !user && hasStoredSession() && !navigator.onLine;

  if (user || offlineGrace) return <>{children}</>;

  return (
    <div className="flex h-screen w-screen items-center justify-center">
      <div className="w-[380px] max-w-[92vw] rounded-xl border border-secondary bg-secondary p-6 shadow-2xl ring-1 ring-primary">
        <h1 className="font-title text-xl text-primary">Verbatim</h1>
        <p className="mt-1 text-sm text-secondary">Sign in to open the editor.</p>

        {error && <p className="mt-3 text-sm text-error-primary">{error}</p>}

        <div className="mt-6 flex items-center justify-end">
          <Button size="sm" color="primary" isDisabled={busy} onClick={() => void onSignIn()}>
            {busy ? "Working…" : "Continue with Google"}
          </Button>
        </div>
      </div>
    </div>
  );
}
