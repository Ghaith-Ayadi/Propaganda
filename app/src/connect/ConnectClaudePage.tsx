// /connect/claude: where Claude sends a person to connect it to their blog
// (worker/src/mcp/oauth.ts). They pick one of their blogs, as one of the
// accounts signed in on this browser, and allow or deny; the worker hands
// Claude a token for that blog, listed under Settings > Connections > Claude.

import { useEffect, useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { Page } from "@/components/shell/PageHeader";
import { addAccountWithGoogle, cachedSites, fetchSites, hasValidSession, listAccounts, SignInCancelled, subscribeAccounts, type Account, type SiteRef } from "@/lib/accounts";
import { answerConnection, connectionRequest } from "@/lib/apiTokens";
import { loadAppFonts } from "@/lib/appFonts";
import { userMessage } from "@/lib/errors";
import { reportError } from "@/lib/telemetry";

loadAppFonts();

interface Choice {
  account: Account;
  site: SiteRef;
}

function choices(): Choice[] {
  return listAccounts()
    .filter(hasValidSession)
    .flatMap((account) => cachedSites(account.userId).map((site) => ({ account, site })));
}

const keyOf = (c: Choice) => `${c.account.userId}:${c.site.id}`;

export function ConnectClaudePage() {
  const request = new URLSearchParams(window.location.search).get("request") ?? "";
  const asked = connectionRequest(request);
  const [list, setList] = useState<Choice[]>(choices);
  const [picked, setPicked] = useState<string>("");
  const [busy, setBusy] = useState<"allow" | "deny" | "signin" | null>(null);
  const [error, setError] = useState("");

  // Refresh every signed-in account's blogs, then keep the list in step.
  useEffect(() => {
    const unsubscribe = subscribeAccounts(() => setList(choices()));
    void Promise.all(listAccounts().filter(hasValidSession).map((a) => fetchSites(a).catch((err) => reportError("connect.claude.sites", err)))).then(() => setList(choices()));
    return unsubscribe;
  }, []);
  useEffect(() => {
    if (!picked && list.length) setPicked(keyOf(list[0]!));
  }, [list, picked]);

  const signIn = async () => {
    setBusy("signin");
    setError("");
    try {
      const account = await addAccountWithGoogle();
      await fetchSites(account);
      setList(choices());
    } catch (err) {
      if (!(err instanceof SignInCancelled)) {
        reportError("connect.claude.signin", err);
        setError(userMessage(err));
      }
    } finally {
      setBusy(null);
    }
  };

  const answer = async (allow: boolean) => {
    const choice = list.find((c) => keyOf(c) === picked);
    if (allow && !choice) return;
    setBusy(allow ? "allow" : "deny");
    setError("");
    try {
      window.location.href = await answerConnection(request, allow ? { account: choice!.account, site: choice!.site.id } : "deny");
    } catch (err) {
      reportError("connect.claude.answer", err);
      setError(userMessage(err));
      setBusy(null);
    }
  };

  if (!asked) {
    return (
      <div className="min-h-dvh bg-primary">
        <Page title="Connect Claude" description="This link isn't complete. Start again from Claude: add Propaganda as a connector and press Connect." >
          <div />
        </Page>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-primary">
      <Page title={`Connect ${asked.client} to your blog`} description="It will be able to read your collections and hand posts to us to draft. Nothing it sends is published until you review it.">
        <div className="flex max-w-lg flex-col gap-5">
          <p className="text-sm text-secondary">
            After you answer, you go back to <span className="font-medium text-primary">{asked.host}</span>.
          </p>
          {!asked.known && (
            <p className="rounded-lg border border-secondary p-3 text-sm text-primary">
              This is not Claude. Allow it only if you set up {asked.host} yourself: it will be able to post to the blog you pick.
            </p>
          )}
          {list.length > 0 ? (
            <fieldset className="flex flex-col divide-y divide-secondary rounded-lg border border-secondary">
              <legend className="mb-2 type-eyebrow text-quaternary">Which blog</legend>
              {list.map((c) => (
                <label key={keyOf(c)} className="flex cursor-pointer items-center gap-3 px-4 py-3 text-sm">
                  <input type="radio" name="site" checked={picked === keyOf(c)} onChange={() => setPicked(keyOf(c))} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-primary">{c.site.name}</span>
                    <span className="block truncate text-tertiary">{c.account.email}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          ) : (
            <p className="text-sm text-secondary">Sign in to Propaganda to pick the blog Claude posts to.</p>
          )}
          {error && <p className="text-sm text-error-primary">{error}</p>}
          <div className="flex flex-wrap gap-2">
            {list.length > 0 && (
              <Button size="md" color="primary" isLoading={busy === "allow"} isDisabled={!!busy || !picked} onClick={() => void answer(true)}>
                Allow
              </Button>
            )}
            <Button size="md" color={list.length ? "secondary" : "primary"} isLoading={busy === "signin"} isDisabled={!!busy} onClick={() => void signIn()}>
              {list.length ? "Use another account" : "Sign in with Google"}
            </Button>
            <Button size="md" color="tertiary" isLoading={busy === "deny"} isDisabled={!!busy} onClick={() => void answer(false)}>
              Deny
            </Button>
          </div>
          <p className="text-xs text-tertiary">
            Claude gets its own key for this blog. You see it in Settings, Connections, Claude, and revoking it there disconnects Claude at once.
          </p>
        </div>
      </Page>
    </div>
  );
}
