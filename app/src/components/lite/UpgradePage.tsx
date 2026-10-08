// Lite's one way up: what the tenant has, what the full plan adds, and a way
// to ask for it. Plans and copy follow the marketing site's pricing section.
// Upgrading is by hand for now, so the button only says we'll be in touch.

import { Check } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { toast } from "@/components/base/toast/toast";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { cx } from "@/utils/cx";

const LITE = [
  "The editor, a real writing tool",
  "A hosted blog on your own domain, themes included",
  "Collections, version history, drafts, scheduling",
  "Readership numbers for every post",
];

const FULL = [
  "All eight agents: they plan the quarter, pitch, write and fact-check",
  "A knowledge base of what your company actually believes, kept straight by the Guardian",
  "Blog, newsletter, social and sales collateral that agree with each other",
  "Granola, transcripts and Slack as sources",
  "Five goals, tracked daily",
];

export function UpgradePage() {
  return (
    <PageBody>
      <PageHeader
        title="Upgrade"
        description="You're on Propaganda Lite. Free forever, and you write every word yourself, like it's 2019."
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Plan name="Lite" price="Free" note="Your plan" items={LITE} />
        <Plan
          name="Propaganda"
          price="$500 / month"
          note="One company, one voice, the whole machine."
          items={FULL}
          highlight
          action={
            <Button
              color="primary"
              onClick={() =>
                toast.add({
                  title: "We'll be in touch",
                  description: "Upgrades are set up by hand while 0.2 rolls out.",
                })
              }
            >
              Book a call
            </Button>
          }
        />
      </div>

      <p className="mt-6 text-sm text-tertiary">
        Want a person on it too? Propaganda with a human is $999 a month, and Teams start at $5,000 a month.
      </p>
    </PageBody>
  );
}

function Plan({
  name,
  price,
  note,
  items,
  highlight = false,
  action,
}: {
  name: string;
  price: string;
  note: string;
  items: string[];
  highlight?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <section
      className={cx(
        "flex flex-col rounded-xl bg-primary p-5 shadow-xs ring-1 ring-inset",
        highlight ? "ring-2 ring-brand" : "ring-secondary",
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold text-primary">{name}</h2>
        <span className="text-sm font-medium text-secondary tabular-nums">{price}</span>
      </div>
      <p className="mt-1 text-sm text-tertiary">{note}</p>
      <ul className="mt-4 flex flex-1 flex-col gap-2">
        {items.map((i) => (
          <li key={i} className="flex gap-2 text-sm text-secondary">
            <Check className="mt-0.5 size-4 shrink-0 text-fg-brand-primary" />
            <span>{i}</span>
          </li>
        ))}
      </ul>
      {action && <div className="mt-5">{action}</div>}
    </section>
  );
}
