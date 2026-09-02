import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/base/buttons/button";
import { supabase } from "@/lib/supabase";
import {
  hasStoredSession,
  sendPasswordReset,
  signInWithPassword,
  updatePassword,
  useSession,
} from "@/lib/auth";

type Mode = "signin" | "forgot" | "recover";

/**
 * Gate around the editor. Everything behind it talks to Supabase as the
 * `authenticated` role, which is what the RLS policies grant write access to —
 * the anon key that ships in this bundle can only read published posts.
 *
 * Password sign-in rather than the older OTP flow: no email is sent on the
 * happy path, so day-to-day access doesn't depend on the SMTP setup. Recovery
 * does need working email, hence the reset flow below.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, loading } = useSession();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A recovery link signs the user in behind the scenes, so without this the
  // gate would hand them the editor and no way to actually set a password.
  // Checked two ways: the auth event, and the URL fragment for the case where
  // the client parsed the link before this component mounted.
  useEffect(() => {
    if (window.location.hash.includes("type=recovery")) setMode("recover");
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setMode("recover");
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const onSignIn = (e: FormEvent) => {
    e.preventDefault();
    void run(() => signInWithPassword(email.trim(), password));
  };

  const onForgot = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await sendPasswordReset(email.trim());
      setNotice(`If ${email.trim()} has an account, a reset link is on its way.`);
    });
  };

  const onRecover = (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    void run(async () => {
      await updatePassword(password);
      // Drop the recovery fragment so a refresh doesn't reopen this form.
      window.history.replaceState(null, "", `${window.location.pathname}#/`);
      setMode("signin");
      setPassword("");
      setConfirm("");
    });
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
  const offlineGrace = !session && hasStoredSession() && !navigator.onLine;

  if (mode !== "recover" && (session || offlineGrace)) return <>{children}</>;

  const field =
    "rounded-lg border border-secondary bg-primary px-3 py-2 text-sm text-primary outline-none focus:border-tertiary";
  const label = "mb-1 text-[11px] font-medium uppercase tracking-wide text-quaternary";

  return (
    <div className="flex h-screen w-screen items-center justify-center">
      <form
        onSubmit={mode === "recover" ? onRecover : mode === "forgot" ? onForgot : onSignIn}
        className="w-[380px] max-w-[92vw] rounded-xl border border-secondary bg-secondary p-6 shadow-2xl ring-1 ring-primary"
      >
        <h1 className="font-title text-xl text-primary">Verbatim</h1>
        <p className="mt-1 text-sm text-secondary">
          {mode === "recover"
            ? "Choose a new password."
            : mode === "forgot"
              ? "We'll email you a reset link."
              : "Sign in to open the editor."}
        </p>

        {mode !== "recover" && (
          <label className="mt-5 flex flex-col">
            <span className={label}>Email</span>
            <input
              type="email"
              autoFocus
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={field}
            />
          </label>
        )}

        {mode !== "forgot" && (
          <label className="mt-3 flex flex-col">
            <span className={label}>{mode === "recover" ? "New password" : "Password"}</span>
            <input
              type="password"
              autoFocus={mode === "recover"}
              autoComplete={mode === "recover" ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={field}
            />
          </label>
        )}

        {mode === "recover" && (
          <label className="mt-3 flex flex-col">
            <span className={label}>Confirm</span>
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={field}
            />
          </label>
        )}

        {error && <p className="mt-3 text-sm text-error-primary">{error}</p>}
        {notice && <p className="mt-3 text-sm text-secondary">{notice}</p>}

        <div className="mt-6 flex items-center justify-between gap-2">
          {mode === "signin" ? (
            <button
              type="button"
              onClick={() => {
                setMode("forgot");
                setError(null);
                setNotice(null);
              }}
              className="text-xs text-tertiary underline-offset-2 hover:underline"
            >
              Forgot password?
            </button>
          ) : mode === "forgot" ? (
            <button
              type="button"
              onClick={() => {
                setMode("signin");
                setError(null);
                setNotice(null);
              }}
              className="text-xs text-tertiary underline-offset-2 hover:underline"
            >
              Back to sign in
            </button>
          ) : (
            <span />
          )}

          <Button
            size="sm"
            color="primary"
            type="submit"
            isDisabled={
              busy ||
              (mode === "signin" && (!email.trim() || !password)) ||
              (mode === "forgot" && !email.trim()) ||
              (mode === "recover" && (!password || !confirm))
            }
          >
            {busy
              ? "Working…"
              : mode === "recover"
                ? "Set password"
                : mode === "forgot"
                  ? "Send reset link"
                  : "Sign in"}
          </Button>
        </div>
      </form>
    </div>
  );
}
