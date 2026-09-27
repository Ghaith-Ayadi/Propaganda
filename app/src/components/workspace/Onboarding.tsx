import { useEffect, useRef, useState } from "react";
import { Plus, Trash01 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { clientFor, createSite, isSlugAvailable, type Account, type SiteRef } from "@/lib/accounts";
import { cx } from "@/utils/cx";

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
 * First-run (or "new site") flow: name a site, say who's writing, seed a
 * couple of collections. A calm three-step form in one card, ending in a
 * `createSite` call plus the starter `app_settings` and `collections` rows.
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
  onDone: (site: SiteRef) => void;
}) {
  const [step, setStep] = useState(0);

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

  const canContinueStep1 = name.trim().length > 0 && slugStatus === "available";
  const canContinueStep3 = collections.some((c) => c.name.trim());

  async function finish() {
    setError(null);
    setFinishing(true);
    let site: SiteRef;
    try {
      site = await createSite(account, name.trim(), slug);
    } catch (err) {
      setError((err as Error).message);
      setFinishing(false);
      return;
    }

    // The site exists now; a settings/collections write failing shouldn't strand
    // the author on this screen — they can fix it up in Settings afterward.
    try {
      const c = clientFor(account);
      const settings: Array<[string, string]> = [
        ["site.title", name.trim()],
        ["author.name", authorName.trim()],
        ["author.tagline", tagline.trim()],
        ["author.bio", bio.trim()],
      ];
      await Promise.all(
        settings
          .filter(([, value]) => value)
          .map(([key, value]) => c.collection("app_settings").create({ site: site.id, key, value })),
      );
      const rows = collections.filter((row) => row.name.trim());
      await Promise.all(
        rows.map((row, i) =>
          c.collection("collections").create({
            site: site.id,
            name: row.name.trim(),
            emoji: row.emoji.trim(),
            description: "",
            position: i,
            is_hidden: false,
          }),
        ),
      );
    } catch (err) {
      console.error("Onboarding: seeding settings/collections failed:", err);
    }

    setFinishing(false);
    onDone(site);
  }

  const url = `${location.origin}/@${slug || "…"}`;

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-primary">
      <div className="w-[440px] max-w-[92vw] rounded-xl border border-secondary bg-secondary p-6 shadow-2xl ring-1 ring-primary">
        <div className="flex items-center justify-between">
          <h1 className="font-title text-xl text-primary">
            {step === 0 && "Name your site"}
            {step === 1 && "About you"}
            {step === 2 && "Collections"}
          </h1>
          <StepDots step={step} count={3} />
        </div>

        {error && <p className="mt-3 text-sm text-error-primary">{error}</p>}

        <div className="mt-5">
          {step === 0 && (
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

          {step === 1 && (
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

          {step === 2 && (
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
            {step < 2 && (
              <Button
                size="sm"
                color="primary"
                isDisabled={step === 0 && !canContinueStep1}
                onClick={() => setStep((s) => s + 1)}
              >
                Continue
              </Button>
            )}
            {step === 2 && (
              <Button size="sm" color="primary" isDisabled={!canContinueStep3 || finishing} onClick={() => void finish()}>
                {finishing ? "Creating…" : "Create site"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
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
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-quaternary">{label}</div>
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
