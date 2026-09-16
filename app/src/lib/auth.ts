import { useEffect, useState } from "react";
import { pb, type PbUser } from "@/lib/pocketbase";

// Sign-in is Google only. PocketBase runs the OAuth2 flow in a popup and keeps
// the session in localStorage; `authStore.onChange` is where the app learns
// about sign-in and sign-out.

export function useSession(): { user: PbUser | null; loading: boolean } {
  const [user, setUser] = useState<PbUser | null>(() =>
    pb.authStore.isValid ? (pb.authStore.record as PbUser) : null,
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const unsubscribe = pb.authStore.onChange((_token, record) => {
      if (!mounted) return;
      setUser(pb.authStore.isValid ? (record as PbUser | null) : null);
    });
    // Validate a stored session once per load; a stale token signs out, unless
    // we are offline, where AuthGate's grace period keeps the drafts reachable.
    (async () => {
      if (pb.authStore.isValid && navigator.onLine) {
        try {
          await pb.collection("users").authRefresh();
        } catch (err) {
          if ((err as { status?: number }).status === 401) pb.authStore.clear();
        }
      }
      if (mounted) setLoading(false);
    })();
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return { user, loading };
}

export async function signInWithGoogle(): Promise<void> {
  await pb.collection("users").authWithOAuth2({ provider: "google" });
}

/**
 * True when a PocketBase session is sitting in localStorage, whether or not it
 * is still valid. Used to keep the editor open offline: the token can't be
 * refreshed without a network, and locking the author out of drafts that only
 * exist in IndexedDB would be far worse than trusting a stale token that the
 * server will reject anyway.
 */
export function hasStoredSession(): boolean {
  return Boolean(pb.authStore.token);
}

export async function signOut(): Promise<void> {
  pb.authStore.clear();
}
