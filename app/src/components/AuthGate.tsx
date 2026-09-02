import { useState, type FormEvent } from "react";
import { Button } from "@/components/base/buttons/button";
import { hasStoredSession, signInWithPassword, useSession } from "@/lib/auth";

/**
 * Gate around the editor. Everything behind it talks to Supabase as the
 * `authenticated` role, which is what the RLS policies grant write access to —
 * the anon key that ships in this bundle can only read published posts.
 *
 * Password sign-in rather than the older OTP flow: no email is sent, so it
 * doesn't depend on the Resend SMTP integration.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, loading } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signInWithPassword(email.trim(), password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

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
  const offlineGrace = !session && hasStoredSession() && !navigator.onLine;

  if (!session && !offlineGrace) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <form
          onSubmit={submit}
          className="w-[380px] max-w-[92vw] rounded-xl border border-secondary bg-secondary p-6 shadow-2xl ring-1 ring-primary"
        >
          <h1 className="font-title text-xl text-primary">Verbatim</h1>
          <p className="mt-1 text-sm text-secondary">Sign in to open the editor.</p>

          <label className="mt-5 flex flex-col">
            <span className="mb-1 text-[11px] font-medium uppercase tracking-wide text-quaternary">
              Email
            </span>
            <input
              type="email"
              autoFocus
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg border border-secondary bg-primary px-3 py-2 text-sm text-primary outline-none focus:border-tertiary"
            />
          </label>

          <label className="mt-3 flex flex-col">
            <span className="mb-1 text-[11px] font-medium uppercase tracking-wide text-quaternary">
              Password
            </span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-lg border border-secondary bg-primary px-3 py-2 text-sm text-primary outline-none focus:border-tertiary"
            />
          </label>

          {error && <p className="mt-3 text-sm text-error-primary">{error}</p>}

          <div className="mt-6 flex justify-end">
            <Button
              size="sm"
              color="primary"
              type="submit"
              isDisabled={busy || !email.trim() || !password}
            >
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </div>
        </form>
      </div>
    );
  }

  return <>{children}</>;
}
