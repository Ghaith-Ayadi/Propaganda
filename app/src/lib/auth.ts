import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export function useSession(): { session: Session | null; loading: boolean } {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      if (!mounted) return;
      setSession(s);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { session, loading };
}

/**
 * Password sign-in. Preferred over the OTP flow below because it sends no
 * email, so it works regardless of whether the Resend SMTP integration does.
 */
export async function signInWithPassword(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

/**
 * True when a Supabase session is sitting in localStorage, whether or not it is
 * still valid. Used to keep the editor open offline: the token can't be
 * refreshed without a network, and locking the author out of drafts that only
 * exist in IndexedDB would be far worse than trusting a stale token that the
 * server will reject anyway.
 */
export function hasStoredSession(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && /^sb-.*-auth-token$/.test(k)) return true;
    }
  } catch {
    // Storage blocked (private mode): fall back to requiring a live session.
  }
  return false;
}

export async function sendCode(email: string): Promise<void> {
  // Supabase sends both a 6-digit OTP and a magic link via the configured
  // email provider (Resend, in this project). The user can use either.
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw error;
}

export async function verifyCode(email: string, token: string): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}
