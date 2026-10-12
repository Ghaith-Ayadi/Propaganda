import { useEffect, useRef, useState } from "react";
import { Plus, Trash01 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { clientFor, createSite, isSlugAvailable, type Account, type SiteRef } from "@/lib/accounts";
import { must } from "@/lib/supabase";
import { siteHost } from "@/lib/siteUrl";
import { REVIEW_OPTIONS } from "@/components/onboarding/SetupStep";
import { NativeSelect } from "@/components/base/select/select-native";
import { rememberPlan, type Plan } from "@/lib/tenantPlan";
import { cx } from "@/utils/cx";
import { coded, userMessage } from "@/lib/errors";
import { reportError } from "@/lib/telemetry";

/** A collection row while onboarding — not yet a `collections` record. */
interface DraftCollection {
  emoji: string;
  name: string;
}

const DEFAULT_COLLECTIONS: DraftCollection[] = [
  { emoji: "✍️", name: "Essays" },
  { emoji: "📓", name: "Notes" },
];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

const SLUG_RE = /^[a-z0-9-]{2,40}$/;

type SlugStatus = "idle" | "checking" | "available" | "taken" | "invalid";

/**
 * First-run (or "new site") flow. The first question is which Propaganda
 * (Ayadi, 2026-10-12):
 *   full  one screen, the business (name, address, website, posts a month),
 *         then Getting started picks up at the strategy. Nothing is asked twice.
 *   lite  the CMS alone, no AI: name the site, say who's writing, seed a couple
 *         of collections, then the editor.
 * Either way it ends in a `createSite` call plus the starter `app_settings`
 * (`tenant.plan` among them, lib/tenantPlan.ts) and `collections` rows.
 */
export function Onboarding({
  account,
  onCancel,
  onSignOut,
  onDone,
}: {
  account: Account;
  onCancel?: () => void;
  onSignOut: () => void;
  onDone: (site: SiteRef, plan: Plan) => void;
}) {
  // Step 0 picks the plan; full has one step after it, Lite three.
  const [plan, setPlan] = useState<Plan | null>(null);
  const [step, setStep] = useState(0);
  const last = plan === "lite" ? 3 : 1;

  // Full
  const [website, setWebsite] = useState("");
  const [review, setReview] = useState("8");

  // Step 1
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [slugStatus, setSlugStatus] = useState<SlugStatus>("idle");

  // Step 2
  const [authorName, setAuthorName] = useState(account.name);
  const [tagline, setTagline] = useState("");
  const [bio, setBio] = useState("");

  // Step 3
  const [collections, setCollections] = useState<DraftCollection[]>(DEFAULT_COLLECTIONS);

  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounced slug availability check.
  useEffect(() => {
    if (!slug) {
      setSlugStatus("idle");
      return;
    }
    if (!SLUG_RE.test(slug)) {
      setSlugStatus("invalid");
      return;
    }
    setSlugStatus("checking");
    const timer = setTimeout(() => {
      isSlugAvailable(clientFor(account), slug)
        .then((ok) => setSlugStatus(ok ? "available" : "taken"))
        .catch(() => setSlugStatus("idle"));
    }, 300);
    return () => clearTimeout(timer);
  }, [slug, account]);

  const onNameChange = (v: string) => {
    setName(v);
    if (!slugEdited) setSlug(slugify(v));
  };

  const canContinueName = name.trim().length > 0 && slugStatus === "available";
  const canContinueCollections = collections.some((c) => c.name.trim());

  async function finish() {
    if (!plan) return;
    setError(null);
    setFinishing(true);
    let site: SiteRef;
    try {
      site = await createSite(account, name.trim(), slug);
    } catch (err) {
      reportError("Site not created", err);
      setError(userMessage(err));
      setFinishing(false);
      return;
    }

    // The site exists now; a settings/collections write failing shouldn't strand
    // the author on this screen — they can fix it up in Settings afterward.
    try {
      const c = clientFor(account);
      const settings: Array<[string, string]> = [
        ["tenant.plan", plan],
        ["site.title", name.trim()],
        ["author.name", authorName.trim()],
        ["author.tagline", tagline.trim()],
        ["author.bio", bio.trim()],
      ];
      if (plan === "full") {
        // Getting started's "Your business" was this screen: it opens on the strategy.
        settings.push(
          ["tenant.website", website.trim()],
          ["strategist.reviewPerMonth", review],
          ["onboarding.business", new Date().toISOString()],
        );
      }
      await Promise.all(
        settings
          .filter(([, value]) => value)
          .map(([key, value]) => must(c.from("app_settings").insert({ site: site.id, key, value }))),
      );
      const rows = collections.filter((row) => row.name.trim());
      await Promise.all(
        rows.map((row, i) =>
          must(c.from("collections").insert({
            site: site.id,
            name: row.name.trim(),
            emoji: row.emoji.trim(),
            description: "",
            position: i,
            is_hidden: false,
          })),
        ),
      );
    } catch (err) {
      reportError("Onboarding: seeding settings/collections failed", coded("SITE-SEED", err));
    }

    rememberPlan(site.id, plan);
    setFinishing(false);
    onDone(site, plan);
  }

  const url = siteHost({ slug: slug || "…", domain: "" });

  // Which screen: 0 the plan; full 1 the business; Lite 1 the site, 2 about you, 3 collections.
  const screen = step === 0 ? "plan" : plan === "full" ? "business" : (["site", "about", "collections"] as const)[step - 1];
  const canContinue =
    screen === "plan" ? plan !== null : screen === "business" || screen === "site" ? canContinueName : screen === "collections" ? canContinueCollections : true;

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-primary">
      <div className="w-[480px] max-w-[92vw] rounded-xl border border-secondary bg-secondary p-6 shadow-2xl ring-1 ring-primary">
        <div className="flex items-center justify-between">
          <h1 className="type-title text-primary">
            {screen === "plan" && "Which Propaganda?"}
            {screen === "business" && "Your business"}
            {screen === "site" && "Name your site"}
            {screen === "about" && "About you"}
            {screen === "collections" && "Collections"}
          </h1>
          {plan && <StepDots step={step} count={last + 1} />}
        </div>

        {error && <p className="mt-3 text-sm text-error-primary">{error}</p>}

        <div className="mt-5">
          {screen === "plan" && (
            <div className="space-y-3">
              <PlanChoice
                picked={plan === "full"}
                onPick={() => setPlan("full")}
                title="Propaganda"
                body="The agents plan your blog, pitch posts and draft them. You review and publish. Your first article goes out today."
              />
              <PlanChoice
                picked={plan === "lite"}
                onPick={() => setPlan("lite")}
                title="Propaganda Lite"
                body="The editor and your blog, free. You write every word yourself. No AI."
              />
            </div>
          )}

          {screen === "business" && (
            <div className="space-y-4">
              <Field label="Your business's name">
                <Input size="sm" placeholder="Acme" value={name} onChange={onNameChange} />
              </Field>
              <Field label="Address" hint={slugHint(slugStatus)}>
                <Input
                  size="sm"
                  value={slug}
                  onChange={(v) => {
                    setSlugEdited(true);
                    setSlug(slugify(v));
                  }}
                />
              </Field>
              <p className="-mt-2 truncate text-xs text-tertiary">Your blog: {url}</p>
              <Field label="Your business's website" hint="The site your customers know you by.">
                <Input size="sm" type="url" placeholder="https://example.com" value={website} onChange={setWebsite} />
              </Field>
              <Field label="Posts a month your team can review" hint="We do the writing. The Strategist plans to this number; change it any time.">
                <NativeSelect size="sm" value={review} onChange={(e) => setReview(e.target.value)} options={REVIEW_OPTIONS} />
              </Field>
            </div>
          )}

          {screen === "site" && (
            <div className="space-y-4">
              <Field label="Site name">
                <Input size="sm" placeholder="My Site" value={name} onChange={onNameChange} />
              </Field>
              <Field label="Address" hint={slugHint(slugStatus)}>
                <Input
                  size="sm"
                  value={slug}
                  onChange={(v) => {
                    setSlugEdited(true);
                    setSlug(slugify(v));
                  }}
                />
              </Field>
              <p className="truncate text-xs text-tertiary">{url}</p>
            </div>
          )}

          {screen === "about" && (
            <div className="space-y-4">
              <Field label="Author name">
                <Input size="sm" value={authorName} onChange={setAuthorName} />
              </Field>
              <Field label="Tagline" hint="One line, shown under the title.">
                <Input size="sm" value={tagline} onChange={setTagline} />
              </Field>
              <Field label="Bio">
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  rows={4}
                  className="w-full resize-none rounded-lg bg-primary px-3 py-2 text-sm text-primary shadow-xs outline-none ring-1 ring-inset ring-primary transition-shadow duration-100 ease-linear focus:ring-2 focus:ring-inset focus:ring-brand"
                />
              </Field>
            </div>
          )}

          {screen === "collections" && (
            <div className="space-y-3">
              {collections.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={row.emoji}
                    onChange={(e) =>
                      setCollections((rows) => rows.map((r, j) => (j === i ? { ...r, emoji: e.target.value } : r)))
                    }
                    className="w-11 rounded-lg bg-primary px-2 py-2 text-center text-sm text-primary shadow-xs outline-none ring-1 ring-inset ring-primary focus:ring-2 focus:ring-brand"
                  />
                  <input
                    value={row.name}
                    onChange={(e) =>
                      setCollections((rows) => rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))
                    }
                    placeholder="Collection name"
                    className="flex-1 rounded-lg bg-primary px-3 py-2 text-sm text-primary shadow-xs outline-none ring-1 ring-inset ring-primary placeholder:text-placeholder focus:ring-2 focus:ring-brand"
                  />
                  <button
                    aria-label="Remove"
                    onClick={() => setCollections((rows) => rows.filter((_, j) => j !== i))}
                    disabled={collections.length <= 1}
                    className="rounded-md p-1.5 text-quaternary transition hover:bg-tertiary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Trash01 className="size-4" />
                  </button>
                </div>
              ))}
              <Button
                size="sm"
                color="tertiary"
                iconLeading={Plus}
                onClick={() => setCollections((rows) => [...rows, { emoji: "", name: "" }])}
              >
                Add collection
              </Button>
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center justify-between border-t border-secondary pt-4">
          <div className="text-xs text-tertiary">
            Signed in as {account.email} ·{" "}
            <button onClick={onSignOut} className="text-tertiary underline hover:text-primary">
              Sign out
            </button>
          </div>
          <div className="flex items-center gap-2">
            {step === 0 && onCancel && (
              <Button size="sm" color="tertiary" onClick={onCancel}>
                Cancel
              </Button>
            )}
            {step > 0 && (
              <Button size="sm" color="tertiary" isDisabled={finishing} onClick={() => setStep((s) => s - 1)}>
                Back
              </Button>
            )}
            {step < last && (
              <Button size="sm" color="primary" isDisabled={!canContinue} onClick={() => setStep((s) => s + 1)}>
                Continue
              </Button>
            )}
            {step === last && (
              <Button size="sm" color="primary" isDisabled={!canContinue || finishing} onClick={() => void finish()}>
                {finishing ? "Creating…" : plan === "full" ? "Start" : "Create site"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PlanChoice({ picked, onPick, title, body }: { picked: boolean; onPick: () => void; title: string; body: string }) {
  return (
    <button
      type="button"
      aria-pressed={picked}
      onClick={onPick}
      className={cx(
        "block w-full rounded-lg bg-primary px-4 py-3 text-left shadow-xs ring-1 ring-inset transition",
        picked ? "ring-2 ring-brand" : "ring-primary hover:bg-primary_hover",
      )}
    >
      <div className="text-sm font-semibold text-primary">{title}</div>
      <p className="mt-1 text-sm text-tertiary">{body}</p>
    </button>
  );
}

function slugHint(status: SlugStatus): string {
  switch (status) {
    case "checking":
      return "Checking…";
    case "available":
      return "Available.";
    case "taken":
      return "Already taken.";
    case "invalid":
      return "Lowercase letters, numbers and dashes, 2–40 characters.";
    default:
      return "Lowercase letters, numbers and dashes.";
  }
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 type-eyebrow text-quaternary">{label}</div>
      {children}
      {hint && <p className="mt-1.5 text-xs text-tertiary">{hint}</p>}
    </label>
  );
}

function StepDots({ step, count }: { step: number; count: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={cx("h-1.5 w-1.5 rounded-full transition", i === step ? "bg-brand-solid" : "bg-border-secondary")}
        />
      ))}
    </div>
  );
}
