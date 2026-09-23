import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  LEGACY_STORE_KEY,
  accountsVersion,
  adoptLegacySession,
  cachedSites,
  fetchSites,
  getAccount,
  hasStoredSession,
  hasValidSession,
  listAccounts,
  refreshAllAccounts,
  signOutAccount,
  subscribeAccounts,
  type Account,
  type SiteRef,
} from "@/lib/accounts";
import { waitForWrites } from "@/lib/db";
import { captureCtx, pushInBackground, setSyncEnabled } from "@/lib/sync";
import { stopRealtime } from "@/lib/realtime";
import {
  VERBATIM_SITE_ID,
  activateScope,
  currentScope,
  deactivateScope,
  readActivePointer,
  updateActiveSite,
} from "@/lib/scope";
import { SignIn } from "@/components/workspace/SignIn";
import { Onboarding } from "@/components/workspace/Onboarding";

/**
 * The editor's outer shell: which account and site are open.
 *
 *   loading     restoring the saved accounts
 *   signin      no usable account (or "add account" was chosen)
 *   onboarding  the account has no site yet (or "new site" was chosen)
 *   switching   the old site's tree is unmounted; draining its writes
 *   ready       a scope is active; children render, keyed by scope
 *
 * Switching is instant by design: every saved account keeps its own session
 * (lib/accounts.ts) and every site its own local database (lib/scope.ts), so a
 * switch is IndexedDB work only. The old site's unsynced writes are pushed in
 * the background, pinned to that site.
 */

type Phase =
  | { kind: "loading" }
  | { kind: "signin"; reason?: string; cancellable: boolean }
  | { kind: "onboarding"; account: Account; cancellable: boolean }
  | { kind: "switching"; account: Account; site: SiteRef }
  | { kind: "ready"; key: string };

export interface WorkspaceApi {
  account: Account;
  site: SiteRef;
  /** Every saved account, in the order they were added. */
  accounts: Account[];
  /** Cached sites of an account (refreshed in the background). */
  sitesOf: (userId: string) => SiteRef[];
  /** Instant: no re-authentication. */
  switchTo: (userId: string, siteId: string) => void;
  /** Open the sign-in screen to add another account. */
  addAccount: () => void;
  /** Start onboarding a new site for the active account. */
  newSite: () => void;
  /** Sign an account out of this browser (local drafts are kept). */
  signOut: (userId: string) => void;
  /** Re-read the active site's details after an edit (e.g. rename). */
  refreshSite: (site: SiteRef) => void;
  /** False when the account's session expired; it needs signing in again. */
  isSignedIn: (userId: string) => boolean;
}

const WorkspaceContext = createContext<WorkspaceApi | null>(null);

export function useWorkspace(): WorkspaceApi {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace outside <Workspace>");
  return ctx;
}

/** Provisional site for the offline first run after the upgrade (see pickSites). */
const PROVISIONAL_VERBATIM: SiteRef = {
  id: VERBATIM_SITE_ID,
  name: "Verbatim",
  slug: "verbatim",
  domain: "verbatim.ayadighaith.com",
  analyticsTenant: "verbatim",
  role: "owner",
};

/**
 * The sites to offer for an account: the cache, refreshed from the server when
 * online. Offline with an empty cache, the account the single-tenant build was
 * signed in with gets Verbatim provisionally, so its drafts stay reachable; if
 * it turns out not to be a member, its pushes are refused and stay local.
 */
async function pickSites(account: Account): Promise<SiteRef[] | null> {
  const cached = cachedSites(account.userId);
  if (navigator.onLine && hasValidSession(account)) {
    const fresh = fetchSites(account).catch(() => null);
    if (!cached.length) return (await fresh) ?? (account.storeKey === LEGACY_STORE_KEY ? [PROVISIONAL_VERBATIM] : null);
    void fresh; // refresh in the background, start from the cache
  }
  if (cached.length) return cached;
  if (account.storeKey === LEGACY_STORE_KEY) return [PROVISIONAL_VERBATIM];
  return null;
}

function usable(account: Account): boolean {
  // Offline, an expired token can't be refreshed; drafts live in IndexedDB and
  // must stay reachable, so a stored session is enough to open the editor.
  return hasValidSession(account) || (!navigator.onLine && hasStoredSession(account));
}

export function Workspace({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const version = useSyncExternalStore(subscribeAccounts, accountsVersion);
  const draining = useRef(false);

  // Open a scope. Called with nothing mounted under us.
  const open = useCallback(async (account: Account, site: SiteRef) => {
    await activateScope(account, site);
    setSyncEnabled(true);
    setPhase({ kind: "ready", key: `${account.userId}:${site.id}` });
  }, []);

  // Pick the account + site to start in.
  const boot = useCallback(
    async (preferUserId?: string, preferSiteId?: string) => {
      const accounts = listAccounts();
      const pointer = readActivePointer();
      const wantUser = preferUserId ?? pointer?.userId;
      const ordered = [
        ...accounts.filter((a) => a.userId === wantUser),
        ...accounts.filter((a) => a.userId !== wantUser),
      ];
      const account = ordered.find(usable);
      if (!account) {
        setPhase({
          kind: "signin",
          reason: accounts.length ? "Your session expired. Sign in again to continue." : undefined,
          cancellable: false,
        });
        return;
      }
      const sites = await pickSites(account);
      if (!sites || !sites.length) {
        setPhase({ kind: "onboarding", account, cancellable: false });
        return;
      }
      const wantSite = preferSiteId ?? (pointer?.userId === account.userId ? pointer.siteId : undefined);
      const site = sites.find((s) => s.id === wantSite) ?? sites[0];
      await open(account, site);
    },
    [open],
  );

  useEffect(() => {
    adoptLegacySession();
    void boot();
    void refreshAllAccounts();
  }, [boot]);

  // The old tree has unmounted: drain, then open the new scope.
  useEffect(() => {
    if (phase.kind !== "switching" || draining.current) return;
    draining.current = true;
    const { account, site } = phase;
    void (async () => {
      try {
        setSyncEnabled(false);
        // Saves started by unmounting components (the editor's last keystroke)
        // land in the old database first. IndexedDB only: milliseconds.
        await waitForWrites(60);
        await stopRealtime();
        if (currentScope()) {
          const leaving = captureCtx();
          void pushInBackground(leaving);
        }
        await open(account, site);
      } catch (err) {
        console.error("Switch failed:", err);
        await boot();
      } finally {
        draining.current = false;
      }
    })();
  }, [phase, open, boot]);

  const switchTo = useCallback((userId: string, siteId: string) => {
    const account = getAccount(userId);
    if (!account) return;
    const cur = currentScope();
    if (cur && cur.account.userId === userId && cur.site.id === siteId) return;
    if (!usable(account)) {
      setPhase({ kind: "signin", reason: `Sign in to ${account.email} again to open it.`, cancellable: true });
      return;
    }
    const site = cachedSites(userId).find((s) => s.id === siteId);
    if (!site) return;
    setPhase({ kind: "switching", account, site });
  }, []);

  const signOut = useCallback(
    (userId: string) => {
      const cur = currentScope();
      signOutAccount(userId);
      if (cur?.account.userId !== userId) return;
      // Leave the scope the same way a switch does, then pick another account.
      setPhase({ kind: "loading" });
      void (async () => {
        setSyncEnabled(false);
        await waitForWrites(60);
        await stopRealtime();
        void pushInBackground(captureCtx());
        deactivateScope();
        await boot();
      })();
    },
    [boot],
  );

  // Back from sign-in / onboarding without finishing.
  const cancel = useCallback(() => {
    const cur = currentScope();
    if (cur) setPhase({ kind: "switching", account: cur.account, site: cur.site });
    else void boot();
  }, [boot]);

  if (phase.kind === "loading" || phase.kind === "switching") {
    return <div className="h-screen w-screen bg-primary" />;
  }

  if (phase.kind === "signin") {
    return (
      <SignIn
        reason={phase.reason}
        onCancel={phase.cancellable ? cancel : undefined}
        onSignedIn={(account) => {
          setPhase({ kind: "loading" });
          void (async () => {
            const sites = await fetchSites(account).catch(() => cachedSites(account.userId));
            if (!sites.length) setPhase({ kind: "onboarding", account, cancellable: false });
            else leaveThen(account, sites[0]);
          })();
        }}
      />
    );
  }

  if (phase.kind === "onboarding") {
    return (
      <Onboarding
        account={phase.account}
        onCancel={phase.cancellable ? cancel : undefined}
        onSignOut={() => signOut(phase.account.userId)}
        onDone={(site) => leaveThen(phase.account, site)}
      />
    );
  }

  // Switch into (account, site) from a screen where nothing is mounted.
  function leaveThen(account: Account, site: SiteRef) {
    setPhase({ kind: "switching", account, site });
  }

  const scope = currentScope();
  if (!scope) return <div className="h-screen w-screen bg-primary" />;

  const api: WorkspaceApi = {
    account: scope.account,
    site: scope.site,
    accounts: listAccounts(),
    sitesOf: cachedSites,
    switchTo,
    addAccount: () => setPhase({ kind: "signin", cancellable: true }),
    newSite: () => setPhase({ kind: "onboarding", account: scope.account, cancellable: true }),
    signOut,
    refreshSite: (site) => {
      updateActiveSite(site);
      setPhase({ kind: "ready", key: phase.key });
    },
    isSignedIn: (userId) => {
      const a = getAccount(userId);
      return Boolean(a && usable(a));
    },
  };
  void version; // re-render when accounts or cached sites change

  return (
    <WorkspaceContext.Provider value={api}>
      <div key={phase.key} className="contents">
        {children}
      </div>
    </WorkspaceContext.Provider>
  );
}
