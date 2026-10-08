// "Your Anthropic key": a tenant brings its own key (BYOK). Paste it, press
// Test: one tiny real call to Anthropic, and a green light when it answers.
// Only a key that passes is saved, and it never comes back to the browser.
// With a key saved, every Claude call for this tenant runs on it and nothing
// else does; if it stops working, runs wait for it. Without a key, Claude work
// waits too: only the tenants Propaganda runs itself have another account.

import { useEffect, useState } from "react";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { toast } from "@/components/base/toast/toast";
import { reportError } from "@/lib/telemetry";
import { userMessage } from "@/lib/errors";
import { type KeyInfo, loadKey, removeKey, retestKey, testAndSaveKey } from "@/lib/modelKey";
import { siteId } from "@/lib/scope";
import { cx } from "@/utils/cx";

type Light = { tone: "green" | "red" | "gray"; text: string };

function clock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function lightOf(key: KeyInfo | null, red: string | null, managed: boolean): Light {
  if (managed) return { tone: "green", text: "Claude runs on an Anthropic account Propaganda manages for this tenant." };
  if (red) return { tone: "red", text: red };
  if (!key) return { tone: "gray", text: "No key yet. Agent work waits until an owner saves one." };
  if (key.status === "failed") return { tone: "red", text: `Key ending ${key.last4} failed ${clock(key.checked)}: ${key.error}` };
  return { tone: "green", text: `Key ending ${key.last4} works. Last checked ${clock(key.checked)}.` };
}

export function ModelKeyCard({ site = siteId() }: { site?: string }) {
  const [key, setKey] = useState<KeyInfo | null>(null);
  const [managed, setManaged] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"test" | "retest" | "remove" | null>(null);
  // A red test of a new key: shown, not saved.
  const [red, setRed] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadKey(site)
      .then((r) => {
        if (!live) return;
        setKey(r.key);
        setManaged(r.managed === true);
      })
      .catch((err) => {
        reportError("model-key load", err);
        if (live) toast.add({ type: "error", title: userMessage(err) });
      })
      .finally(() => live && setLoaded(true));
    return () => {
      live = false;
    };
  }, [site]);

  const run = async (what: "test" | "retest" | "remove", fn: () => Promise<void>) => {
    setBusy(what);
    try {
      await fn();
    } catch (err) {
      reportError(`model-key ${what}`, err);
      toast.add({ type: "error", title: userMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  const test = () =>
    run("test", async () => {
      const r = await testAndSaveKey(site, draft.trim());
      if (r.ok) {
        setKey(r.key);
        setRed(null);
        setDraft("");
        toast.add({ type: "success", title: "Key works and is saved" });
      } else {
        setRed(r.error ?? "Anthropic didn't accept the key.");
      }
    });

  const retest = () =>
    run("retest", async () => {
      const r = await retestKey(site);
      setKey(r.key);
      setRed(null);
      toast.add(r.ok ? { type: "success", title: "Key works" } : { type: "error", title: "Key failed" });
    });

  const remove = () =>
    run("remove", async () => {
      await removeKey(site);
      setKey(null);
      setRed(null);
      toast.add({ type: "success", title: "Key removed" });
    });

  const light = lightOf(key, red, managed);

  return (
    <section className="rounded-xl border border-secondary bg-primary p-5 shadow-xs">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-title text-xl text-primary">Your Anthropic key</h2>
          <p className="mt-1 text-sm text-tertiary">
            Bring your own key and every Claude call for this tenant runs on it, billed to your Anthropic account. It is used for this
            tenant's work only.
          </p>
        </div>
        {key && <Badge size="sm" color={key.status === "ok" ? "success" : "error"}>{key.status === "ok" ? "Own key" : "Key failed"}</Badge>}
      </div>

      <div className="mt-4 space-y-4">
        <div className="flex items-start gap-2.5" role="status" aria-live="polite">
          <span
            aria-hidden
            className={cx(
              "mt-1 size-2.5 shrink-0 rounded-full",
              light.tone === "green" && "bg-success-solid",
              light.tone === "red" && "bg-error-solid",
              light.tone === "gray" && "bg-quaternary",
            )}
          />
          <p className={cx("text-sm", light.tone === "red" ? "text-error-primary" : light.tone === "green" ? "text-success-primary" : "text-tertiary")}>
            {loaded ? light.text : "Checking…"}
          </p>
        </div>

        <div className={cx("flex flex-col gap-2 sm:flex-row sm:items-end", managed && "hidden")}>
          <Input
            className="flex-1"
            size="sm"
            type="password"
            label={key ? "Replace with a new key" : "API key"}
            placeholder="sk-ant-…"
            autoComplete="off"
            value={draft}
            onChange={(v) => {
              setDraft(v);
              setRed(null);
            }}
            isDisabled={busy !== null}
          />
          <Button size="sm" onClick={test} isDisabled={!draft.trim() || busy !== null} isLoading={busy === "test"}>
            Test
          </Button>
        </div>

        {key && !managed && (
          <div className="flex gap-2">
            <Button size="sm" color="secondary" onClick={retest} isDisabled={busy !== null} isLoading={busy === "retest"}>
              Test again
            </Button>
            <Button size="sm" color="secondary-destructive" onClick={remove} isDisabled={busy !== null} isLoading={busy === "remove"}>
              Remove
            </Button>
          </div>
        )}

        <p className={cx("text-xs text-tertiary", managed && "hidden")}>
          Only owners can save or remove the key. Test makes one tiny call to Anthropic with it and saves it only if it answers. If it stops working later, agent
          work waits for it and never switches to another account: fix it on Anthropic's side or paste a new one here, and runs carry on
          by themselves.
        </p>
      </div>
    </section>
  );
}
