import { useEffect, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { ArenaPage } from "./ArenaPage";
import { ArenaError, client, userMessage } from "./api";

// Sign-in is an emailed one-time code, the same accounts as the product. No
// redirect, so it needs nothing configured on the auth server for this host.
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

function SignIn() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!sent) {
        const { error } = await client.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false } });
        if (error) throw new ArenaError("ARENA-AUTH", "Couldn't send the code. Check the address.");
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

  const field = "rounded-lg border border-secondary bg-primary px-3 py-2 text-sm text-primary";
  return (
    <form onSubmit={(e) => void submit(e)} className="mx-auto flex max-w-sm flex-col gap-3 pt-16 text-sm">
      <input aria-label="Email" type="email" required placeholder="Email" value={email} disabled={sent} onChange={(e) => setEmail(e.target.value)} className={field} />
      {sent && (
        <input aria-label="Code" inputMode="numeric" autoComplete="one-time-code" required placeholder="Code from the email" value={code} onChange={(e) => setCode(e.target.value)} className={field} />
      )}
      <button type="submit" disabled={busy} className="rounded-lg bg-primary-solid px-3 py-2 font-medium text-white hover:opacity-90 disabled:opacity-50">
        {sent ? "Sign in" : "Send me a code"}
      </button>
      {error && <p className="text-error-primary">{error}</p>}
    </form>
  );
}
