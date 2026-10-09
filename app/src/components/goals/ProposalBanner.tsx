// The Strategist's proposal, waiting on the tenant: on Goals, Home and the
// Inbox. It links to the proposal on Goals > Strategist, where it is approved.

import { ArrowRight } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import type { Proposal } from "@/lib/goals/types";
import { quarterLabel } from "@/lib/goals/quarter";
import { pageHref } from "@/lib/route";

/** Where a proposal is reviewed: Goals > Strategist, on its quarter. */
export function proposalHref(proposal: Proposal): string {
  return pageHref("goals", `strategist/${proposal.quarter.toLowerCase()}`);
}

export function ProposalBanner({ proposal, onOpen }: { proposal: Proposal; onOpen?: () => void }) {
  const revising = proposal.status === "changes_requested";
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-brand-primary_alt p-5 ring-1 ring-brand ring-inset md:flex-row md:items-center md:justify-between">
      <div>
        <p className="font-medium text-brand-secondary">
          {revising ? "The Strategist is revising" : `The Strategist proposed ${quarterLabel(proposal.quarter)}'s goals`}
        </p>
        <p className="mt-0.5 text-sm text-secondary">{proposal.summary}</p>
      </div>
      <Button
        size="sm"
        color="primary"
        iconTrailing={ArrowRight}
        {...(onOpen ? { onClick: onOpen } : { href: proposalHref(proposal) })}
      >
        {revising ? "See it" : "Review and approve"}
      </Button>
    </div>
  );
}
