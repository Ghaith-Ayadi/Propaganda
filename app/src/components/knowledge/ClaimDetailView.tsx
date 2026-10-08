// One claim: the bare statement, its status and metadata (who remembered it is
// metadata, never part of the text), its sources with their tiers and the
// quotes in context, its relationships, the posts relying on it, and the
// ruling that let it in (and the one that retired it).

import { useState } from "react";
import { ChevronDown, ChevronUp } from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import { pageHref, postHref } from "@/lib/route";
import { kb } from "@/lib/knowledge/adapter";
import { useKb } from "@/lib/knowledge/hooks";
import type { ClaimDetail, Evidence } from "@/lib/knowledge/types";
import { cx } from "@/utils/cx";
import {
  ClaimStatusBadge,
  ConflictBadge,
  DecisionCard,
  Empty,
  Loading,
  OriginalLink,
  Panel,
  QuoteInContext,
  RELATION_LABEL,
  RELIANCE_LABEL,
  SOURCE_KIND_LABEL,
  SectionLabel,
  TierBadge,
  formatDate,
} from "./bits";

export function ClaimDetailView({ id }: { id: string }) {
  const claim = useKb("kb.claim", () => kb().claim(id), [id]);
  if (claim.loading && !claim.data) return <Loading />;
  if (!claim.data) return <Empty title="This claim isn't here">It may belong to another tenant, or the link is wrong.</Empty>;
  return <ClaimBody claim={claim.data} />;
}

export function ClaimBody({ claim }: { claim: ClaimDetail }) {
  const meta = [
    claim.topics.map((t) => t.name).join(", "),
    claim.rememberedBy ? `added by ${claim.rememberedBy.name}` : "",
    claim.validFrom ? `since ${formatDate(claim.validFrom)}` : "",
    claim.validUntil ? `until ${formatDate(claim.validUntil)}` : "",
    claim.retired ? `retired ${formatDate(claim.retired)}` : "",
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <ClaimStatusBadge status={claim.status} />
          {claim.inConflict && <ConflictBadge />}
          {claim.weight > 1 && (
            <Badge type="modern" size="sm" color="gray">
              Weight {claim.weight}
            </Badge>
          )}
        </div>
        <p className="font-title text-2xl leading-snug text-primary">{claim.text}</p>
        <p className="mt-2 text-sm text-tertiary">{meta.join(" · ")}</p>
        {Object.keys(claim.scope).length > 0 && (
          <dl className="mt-3 flex flex-wrap gap-2">
            {Object.entries(claim.scope).map(([k, v]) => (
              <Badge key={k} type="color" size="sm" color="gray">
                {k.replace(/_/g, " ")}: {v}
              </Badge>
            ))}
          </dl>
        )}
        {claim.rationale && (
          <p className="mt-4 border-l-2 border-secondary pl-3 text-sm text-secondary">
            <span className="text-tertiary">Why: </span>
            {claim.rationale}
          </p>
        )}
        {claim.owners.length > 0 && (
          <p className="mt-4 text-sm text-tertiary">
            Owned by {claim.owners.map((o) => o.name).join(", ")}. Changing or retiring it is their call.
          </p>
        )}
        {claim.reviewAfter && <p className="mt-1 text-sm text-tertiary">Review after {formatDate(claim.reviewAfter)}.</p>}
      </Panel>

      <Panel>
        <SectionLabel>Sources ({claim.evidence.length})</SectionLabel>
        {claim.evidence.length === 0 ? (
          <p className="text-sm text-tertiary">No quoted source yet.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {claim.evidence.map((e) => (
              <EvidenceItem key={e.id} evidence={e} />
            ))}
          </ul>
        )}
      </Panel>

      {claim.relationships.length > 0 && (
        <Panel>
          <SectionLabel>Relationships</SectionLabel>
          <ul className="flex flex-col gap-2">
            {claim.relationships.map((r) => (
              <li key={r.id} className="flex flex-col gap-0.5 text-sm sm:flex-row sm:gap-3">
                <span className={cx("w-32 shrink-0 text-tertiary", r.kind === "contradicts" && "text-error-primary")}>
                  {RELATION_LABEL[r.kind][r.direction]}
                </span>
                <a href={pageHref("knowledge", `claims/${r.other.id}`)} className="text-primary hover:underline">
                  {r.other.text}
                  <span className="ml-2 text-xs text-quaternary">{r.other.status}</span>
                </a>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel>
        <SectionLabel>Posts that rely on it ({claim.posts.length})</SectionLabel>
        {claim.posts.length === 0 ? (
          <p className="text-sm text-tertiary">Nothing published relies on it yet. Changing it won't queue any re-checks.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-secondary">
            {claim.posts.map((p) => (
              <li key={`${p.postId}-${p.version}`} className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {kb().sample ? (
                    <span className="font-medium text-primary">{p.title}</span>
                  ) : (
                    <a href={postHref(p.postId)} className="font-medium text-primary hover:underline">
                      {p.title}
                    </a>
                  )}
                  <span className="text-xs text-quaternary">version {p.version}</span>
                  <Badge type="color" size="sm" color={p.reliance === "mentions" ? "gray" : "blue"}>
                    {RELIANCE_LABEL[p.reliance]}
                  </Badge>
                </div>
                {p.quote && <p className="text-sm text-tertiary">“{p.quote}”</p>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {(claim.admittedBy || claim.retiredBy || claim.history.length > 0) && (
        <Panel>
          <SectionLabel>History</SectionLabel>
          <div className="flex flex-col gap-5">
            {claim.retiredBy && <DecisionCard decision={claim.retiredBy} title={claim.status === "retracted" ? "Retracted" : "Replaced"} />}
            {claim.admittedBy && <DecisionCard decision={claim.admittedBy} title="Let in" />}
            {claim.history.length > 0 && (
              <div>
                <p className="mb-1.5 text-sm font-medium text-secondary">Earlier versions</p>
                <ul className="flex flex-col gap-1">
                  {claim.history.map((h) => (
                    <li key={h.id} className="text-sm">
                      <a href={pageHref("knowledge", `claims/${h.id}`)} className="text-tertiary line-through decoration-1 hover:text-secondary">
                        {h.text}
                      </a>
                      <span className="ml-2 text-xs text-quaternary">{formatDate(h.created)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Panel>
      )}
    </div>
  );
}

export function EvidenceItem({ evidence: e }: { evidence: Evidence }) {
  const [open, setOpen] = useState(true);
  return (
    <li className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-primary">{e.source.title || SOURCE_KIND_LABEL[e.source.kind]}</span>
        <TierBadge tier={e.source.tier} />
        {e.stance === "contradicts" && (
          <Badge type="pill-color" size="sm" color="error">
            Against it
          </Badge>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 text-xs text-quaternary">
        <span>{SOURCE_KIND_LABEL[e.source.kind]}</span>
        {e.source.occurred && <span>{formatDate(e.source.occurred)}</span>}
        {e.source.person && <span>{e.source.person.name}</span>}
        <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-0.5 text-tertiary hover:text-secondary">
          {open ? "Hide the quote" : "Show the quote"}
          {open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
        <OriginalLink href={e.source.uri} />
      </div>
      {open && <QuoteInContext before={e.before} quote={e.quote} after={e.after} />}
    </li>
  );
}
