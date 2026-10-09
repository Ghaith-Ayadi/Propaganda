// Inbox: only what waits on the person. Four kinds, one tab each: flags on
// content, the current batch of pitches, knowledge base rulings, and drafts to
// review. Nothing here closes itself.
//
// URL: #/inbox/<tab>[/<item id>]. On a wide screen the list sits beside the
// open item (the first one when none is picked); on a phone the list and the
// item take turns.

import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, ArrowUpRight, Flag01, InfoCircle, Lightbulb02, Scales02, FileCheck02, SearchLg, Lock01 } from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import { Input } from "@/components/base/input/input";
import { PageBody, PageHeader, PageTabs } from "@/components/shell/PageHeader";
import { ExampleBadge } from "@/components/shared/ExampleBadge";
import { ObjectIcon } from "@/components/shared/ObjectIcon";
import { parseDay, shortDate } from "@/components/shared/quarter";
import { briefHref, goPage, postHref, usePageRest } from "@/lib/route";
import { cx } from "@/utils/cx";
import { EmptyState, ListRow, UrgentChip } from "./bits";
import { useInbox, type Flag, type KnowledgeItem, type Pitch, type Review, type StrategistNote } from "./data";
import { FlagDetail } from "./FlagDetail";
import { KnowledgeDetail } from "./KnowledgeDetail";
import { PitchDetail, fitBadge } from "./PitchDetail";
import { ProposalBanner } from "@/components/goals/ProposalBanner";

type Tab = "flags" | "pitches" | "knowledge" | "review";
const TABS: Tab[] = ["flags", "pitches", "knowledge", "review"];

const EXAMPLE_WHY =
  "Flags, pitches and knowledge rulings come from tables that aren't on the server yet (the knowledge base and content batches). Reviews are real.";

export function InboxPage() {
  const inbox = useInbox();
  const rest = usePageRest();
  const [query, setQuery] = useState("");

  const [tabPart, idPart] = (rest ?? "").split("/");
  const tab: Tab = (TABS as string[]).includes(tabPart) ? (tabPart as Tab) : "flags";
  const picked = idPart ? decodeURIComponent(idPart) : null;

  const q = query.trim().toLowerCase();
  const match = (...texts: string[]) => !q || texts.some((t) => t.toLowerCase().includes(q));
  const flags = useMemo(() => inbox.flags.filter((f) => match(f.object.title, f.topic, f.says.quote)), [inbox.flags, q]);
  const pitches = useMemo(() => (inbox.batch?.pitches ?? []).filter((p) => match(p.title, p.topic, p.angle)), [inbox.batch, q]);
  const knowledge = useMemo(() => inbox.knowledge.filter((k) => match(k.title, k.a.text, k.b.text)), [inbox.knowledge, q]);
  const reviews = useMemo(() => inbox.reviews.filter((r) => match(r.title)), [inbox.reviews, q]);

  const open = (t: Tab, id?: string | null) => goPage("inbox", id ? `${t}/${encodeURIComponent(id)}` : t);

  const withIcon = (Icon: typeof Flag01, label: string, badge?: ReactNode) => (
    <span className="flex items-center gap-2">
      <Icon className="size-4" />
      {label}
      {badge}
    </span>
  );

  return (
    <>
      <PageHeader
        title="Inbox"
        description={
          inbox.total === 0
            ? "Nothing needs you. Nothing here closes itself, so this is real."
            : `${inbox.total} ${inbox.total === 1 ? "thing needs" : "things need"} you. Nothing here closes itself.`
        }
        actions={
          <div className="flex items-center gap-3">
            {inbox.example && <ExampleBadge why={EXAMPLE_WHY} />}
            <div className="w-full sm:w-72">
              <Input size="sm" icon={SearchLg} placeholder="Search the inbox" aria-label="Search the inbox" value={query} onChange={setQuery} />
            </div>
          </div>
        }
        tabs={
          <PageTabs
            label="Inbox sections"
            selected={tab}
            onChange={(id) => open(id as Tab)}
            items={[
              {
                id: "flags",
                // The count is red only while a flag is urgent.
                label: withIcon(
                  Flag01,
                  "Flags",
                  inbox.flags.length > 0 && (
                    <Badge size="sm" type="pill-color" color={inbox.urgent > 0 ? "error" : "gray"} className="-my-px hidden md:flex">
                      {inbox.flags.length}
                    </Badge>
                  ),
                ),
              },
              { id: "pitches", label: withIcon(Lightbulb02, "Pitches"), badge: inbox.pendingPitches || undefined },
              { id: "knowledge", label: withIcon(Scales02, "Knowledge"), badge: inbox.knowledge.length || undefined },
              { id: "review", label: withIcon(FileCheck02, "Review"), badge: inbox.reviews.length || undefined },
            ]}
          />
        }
      />
      <PageBody>
      {inbox.proposal && (
        <div className="mb-4">
          <ProposalBanner proposal={inbox.proposal} />
        </div>
      )}
      <Notes notes={inbox.notes.filter((n) => n.tab === tab)} />

      {tab === "flags" && (
        <Split
          items={flags}
          picked={picked}
          onPick={(id) => open("flags", id)}
          onBack={() => open("flags")}
          empty={<EmptyState title="No open flags" body="Everything you've published agrees with the knowledge base and with itself." />}
          row={(f, selected, pick) => <FlagRow key={f.id} flag={f} selected={selected} onSelect={pick} />}
          detail={(f) => <FlagDetail key={f.id} flag={f} source={inbox.source} />}
        />
      )}

      {tab === "pitches" && (
        <>
          {inbox.batch && (
            <p className="mb-4 text-sm text-secondary">
              Batch {inbox.batch.number} of {inbox.batch.of}, to be written by {shortDate(parseDay(inbox.batch.due))}.{" "}
              <span className="text-tertiary">
                {inbox.pendingPitches === 0
                  ? "All decided: the next batch arrives tomorrow morning."
                  : "The next batch arrives once two thirds of this one is decided, or in 7 days."}
              </span>
            </p>
          )}
          <Split
            items={pitches}
            picked={picked}
            onPick={(id) => open("pitches", id)}
            onBack={() => open("pitches")}
            empty={<EmptyState title="No pitches waiting" body="The next batch lands here when the Strategist's plan calls for it." />}
            row={(p, selected, pick) => <PitchRow key={p.id} pitch={p} selected={selected} onSelect={pick} />}
            detail={(p) => <PitchDetail key={p.id} pitch={p} source={inbox.source} />}
          />
        </>
      )}

      {tab === "knowledge" && (
        <Split
          items={knowledge}
          picked={picked}
          onPick={(id) => open("knowledge", id)}
          onBack={() => open("knowledge")}
          empty={<EmptyState title="Nothing to rule on" body="When two claims disagree, or a change needs an owner, it shows up here." />}
          row={(k, selected, pick) => <KnowledgeRow key={k.id} item={k} selected={selected} onSelect={pick} />}
          detail={(k) => <KnowledgeDetail key={k.id} item={k} source={inbox.source} />}
        />
      )}

      {tab === "review" &&
        (reviews.length === 0 ? (
          <EmptyState title="Nothing to review" body="Drafts that need your read before they ship land here." />
        ) : (
          <div className="flex flex-col gap-3">
            {reviews.map((r) => (
              <ReviewRow key={r.id} review={r} />
            ))}
          </div>
        ))}
      </PageBody>
    </>
  );
}

/** A list beside the open item; on a phone, one or the other. */
function Split<T extends { id: string }>({
  items,
  picked,
  onPick,
  onBack,
  empty,
  row,
  detail,
}: {
  items: T[];
  picked: string | null;
  onPick: (id: string) => void;
  onBack: () => void;
  empty: ReactNode;
  row: (item: T, selected: boolean, pick: () => void) => ReactNode;
  detail: (item: T) => ReactNode;
}) {
  if (items.length === 0) return <>{empty}</>;
  const explicit = picked ? items.find((i) => i.id === picked) : undefined;
  const shown = explicit ?? items[0];
  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(300px,420px)_1fr]">
      <div className={cx("overflow-hidden rounded-xl border border-secondary bg-primary", explicit && "hidden lg:block")}>
        {items.map((i) => row(i, i.id === shown.id, () => onPick(i.id)))}
      </div>
      <div className={cx("min-w-0", !explicit && "hidden lg:block")}>
        <button type="button" onClick={onBack} className="mb-4 flex items-center gap-1.5 text-sm text-secondary lg:hidden">
          <ArrowLeft className="size-4" /> Back to the list
        </button>
        {detail(shown)}
      </div>
    </div>
  );
}

/** The Strategist's notes on this tab (moved here from Home). */
function Notes({ notes }: { notes: StrategistNote[] }) {
  if (notes.length === 0) return null;
  return (
    <ul className="mb-4 flex flex-col gap-2">
      {notes.map((n) => (
        <li key={n.id} className="flex gap-2.5 rounded-lg border border-secondary bg-primary px-4 py-3 text-sm text-secondary">
          {n.severity === "warning" ? (
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-fg-warning-secondary" aria-label="Warning" />
          ) : (
            <InfoCircle className="mt-0.5 size-4 shrink-0 text-fg-quaternary" aria-label="Note" />
          )}
          <span>
            <span className="font-semibold text-primary">The Strategist: </span>
            {n.message}
          </span>
        </li>
      ))}
    </ul>
  );
}

function FlagRow({ flag, selected, onSelect }: { flag: Flag; selected: boolean; onSelect: () => void }) {
  return (
    <ListRow
      selected={selected}
      onSelect={onSelect}
      icon={<ObjectIcon kind={flag.object.kind} />}
      title={flag.object.title}
      sub={flag.topic}
      aside={flag.urgency === "high" ? <UrgentChip /> : undefined}
      extra={
        flag.status === "rejected" ? (
          <Badge type="pill-color" color="error" size="sm">Guardian rejected</Badge>
        ) : flag.status === "contesting" ? (
          <Badge type="pill-color" color="gray" size="sm">With the Guardian</Badge>
        ) : flag.cantFix ? (
          <Badge type="pill-color" color="gray" size="sm">
            <Lock01 className="mr-1 size-3" /> Can't be fixed
          </Badge>
        ) : undefined
      }
    />
  );
}

function PitchRow({ pitch, selected, onSelect }: { pitch: Pitch; selected: boolean; onSelect: () => void }) {
  const fit = fitBadge[pitch.fit];
  return (
    <ListRow
      selected={selected}
      onSelect={onSelect}
      icon={<ObjectIcon kind="blog" />}
      title={pitch.title}
      sub={`${pitch.collection} · ${pitch.topic}`}
      extra={
        <>
          {pitch.decision ? (
            <Badge type="pill-color" color={pitch.decision.kind === "approved" ? "success" : "gray"} size="sm">
              {pitch.decision.kind === "approved" ? "Approved" : "Rejected"}
            </Badge>
          ) : (
            <Badge type="pill-color" color={fit.color} size="sm">{fit.label}</Badge>
          )}
          {pitch.drafted && <Badge type="pill-color" color="gray" size="sm">Draft ready</Badge>}
        </>
      }
    />
  );
}

function KnowledgeRow({ item, selected, onSelect }: { item: KnowledgeItem; selected: boolean; onSelect: () => void }) {
  return (
    <ListRow
      selected={selected}
      onSelect={onSelect}
      icon={<Scales02 className="size-5 text-fg-quaternary" />}
      title={item.title}
      sub={item.kind === "conflict" ? "Two claims disagree" : "A change needs its owner"}
    />
  );
}

function ReviewRow({ review }: { review: Review }) {
  const href = review.object.postId ? postHref(review.object.postId) : briefHref(review.briefId);
  return (
    <a
      href={href}
      className="flex items-start gap-3 rounded-xl border border-secondary bg-primary px-5 py-4 outline-focus-ring transition-colors hover:bg-primary_hover focus-visible:outline-2"
    >
      <ObjectIcon kind={review.object.kind} className="mt-1" />
      <span className="min-w-0 flex-1">
        <span className="block font-title text-xl text-primary">{review.title}</span>
        <span className="mt-0.5 block text-sm text-tertiary">
          {review.ask}
          {review.due && <> · due {shortDate(parseDay(review.due))}</>}
        </span>
      </span>
      <ArrowUpRight className="size-4 text-fg-quaternary" />
    </a>
  );
}
