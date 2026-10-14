import { useEffect, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { ArenaPage } from "./ArenaPage";
import { ArenaError, client, emailCodesEnabled, signInWithGoogle, userMessage } from "./api";

// Sign-in is Google (the product's accounts). Production is Google-only; an emailed one-time code
// shows only in builds with VITE_EMAIL_SIGNIN=1 (dev) and when the server can send one. Google comes back to this page, so the auth server must allow this origin as a
// redirect URL (GOTRUE_URI_ALLOW_LIST in Bedrock).
// Only superadmins can run a round or read the votes; anyone else sees empty
// pages and refusals.

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    client.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = client.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return null;
  return (
    <div className="min-h-screen bg-primary text-primary">
      <header className="flex items-center justify-between border-b border-secondary px-6 py-3">
        <h1 className="type-heading">Arena</h1>
        {session && (
          <button type="button" onClick={() => void client.auth.signOut()} className="text-sm text-tertiary hover:text-primary">
            Sign out {session.user.email}
          </button>
        )}
      </header>
      <main className="mx-auto max-w-6xl px-6 py-6">{session ? <ArenaPage /> : <SignIn />}</main>
    </div>
  );
}

const field = "rounded-lg border border-secondary bg-primary px-3 py-2 text-sm text-primary";

function SignIn() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailOn, setEmailOn] = useState(false);

  useEffect(() => {
    void emailCodesEnabled().then(setEmailOn);
  }, []);

  const google = async () => {
    setError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(userMessage(err));
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!sent) {
        const { error } = await client.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false } });
        if (error) {
          const noAccount = (error as { code?: string }).code === "otp_disabled";
          throw new ArenaError("ARENA-AUTH", noAccount ? "No account for that address. Use the email you sign in to Propaganda with." : "Couldn't send the code. Try again.");
        }
        setSent(true);
      } else {
        const { error } = await client.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
        if (error) throw new ArenaError("ARENA-AUTH", "That code didn't work. Try again.");
      }
    } catch (err) {
      setError(userMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-3 pt-16 text-sm">
      <button type="button" onClick={() => void google()} className="rounded-lg bg-primary-solid px-3 py-2 font-medium text-white hover:opacity-90">
        Continue with Google
      </button>
      {emailOn && (
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
          <input aria-label="Email" type="email" required placeholder="Email" value={email} disabled={sent} onChange={(e) => setEmail(e.target.value)} className={field} />
          {sent && (
            <input aria-label="Code" inputMode="numeric" autoComplete="one-time-code" required placeholder="Code from the email" value={code} onChange={(e) => setCode(e.target.value)} className={field} />
          )}
          <button type="submit" disabled={busy} className="rounded-lg border border-secondary px-3 py-2 font-medium text-secondary hover:bg-secondary disabled:opacity-50">
            {sent ? "Sign in" : "Email me a code"}
          </button>
        </form>
      )}
      {error && <p className="text-error-primary">{error}</p>}
    </div>
  );
}
