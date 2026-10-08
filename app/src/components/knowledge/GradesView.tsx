// The two letter grades. Content consistency: the share of published posts
// with no open, snoozed or won't-fix flag. Knowledge base consistency: the
// share of live claims, weighted by the posts relying on them, that are
// settled and in no contradiction. Fixed bands; an A doesn't need zero issues.

import { kb } from "@/lib/knowledge/adapter";
import { useKb } from "@/lib/knowledge/hooks";
import { BANDS, type Letter } from "@/lib/knowledge/types";
import { pageHref } from "@/lib/route";
import { cx } from "@/utils/cx";
import { ClaimStatusBadge, ConflictBadge, Empty, LetterGrade, Loading, Panel, SectionLabel, percent } from "./bits";

export function GradesView() {
  const grades = useKb("kb.grades", () => kb().grades(), []);
  if (grades.loading && !grades.data) return <Loading />;
  if (!grades.data) return <Empty title="Couldn't work out the grades">Try again in a moment.</Empty>;
  const { content, knowledge } = grades.data;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Panel className="flex flex-col gap-5">
        <GradeHead
          letter={content.letter}
          share={content.share}
          title="Content consistency"
          line={`${content.posts - content.flagged} of ${content.posts} published posts agree with the knowledge base.`}
        />
        <Bands share={content.share} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Open flags" value={content.breakdown.open} href={pageHref("knowledge", "flags")} />
          <Stat label="Re-checks" value={content.breakdown.rechecks} href={pageHref("knowledge", "rechecks")} />
          <Stat label="Snoozed" value={content.breakdown.snoozed} />
          <Stat label="Won't fix" value={content.breakdown.wontFix} />
        </div>
        <div>
          <SectionLabel>Where it comes from</SectionLabel>
          {content.notes.length === 0 ? (
            <p className="text-sm text-tertiary">Nothing counts against it right now.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-secondary">
              {content.notes.map((n) => (
                <li key={n.label}>
                  <a href={n.href} className="flex items-center justify-between gap-3 py-2 text-sm hover:text-primary">
                    <span className="text-secondary">{n.label}</span>
                    <span className="text-tertiary">{n.count === 1 ? "1 post" : `${n.count} posts`}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="text-sm text-tertiary">
          A post counts once however many flags it has. Snoozed and won't-fix posts keep counting; posts you took down, and
          re-checks the agent found still hold, don't.
        </p>
      </Panel>

      <Panel className="flex flex-col gap-5">
        <GradeHead
          letter={knowledge.letter}
          share={knowledge.share}
          title="Knowledge base consistency"
          line={`${knowledge.claims} live claims; ${knowledge.contested} contested, ${knowledge.inConflict} in a contradiction.`}
        />
        <Bands share={knowledge.share} />
        <div>
          <SectionLabel>Settle these first</SectionLabel>
          {knowledge.todo.length === 0 ? (
            <p className="text-sm text-tertiary">Every live claim is settled and agrees with the rest.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-secondary">
              {knowledge.todo.map((c) => (
                <li key={c.id}>
                  <a href={pageHref("knowledge", `claims/${c.id}`)} className="flex flex-col gap-1 py-2.5 hover:text-primary">
                    <span className="text-sm text-primary">{c.text}</span>
                    <span className="flex flex-wrap items-center gap-2 text-xs text-quaternary">
                      <ClaimStatusBadge status={c.status} />
                      {c.inConflict && <ConflictBadge />}
                      {c.weight > 1 ? `${c.weight - 1} ${c.weight === 2 ? "post relies" : "posts rely"} on it` : "Nothing relies on it"}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="text-sm text-tertiary">
          Each claim weighs one plus the posts relying on it, so a contested claim ten posts lean on costs far more than one
          nobody uses, and splitting claims into trivial ones doesn't move the grade.
        </p>
      </Panel>
    </div>
  );
}

function GradeHead({ letter, share, title, line }: { letter: Letter; share: number; title: string; line: string }) {
  const next = BANDS.slice()
    .reverse()
    .find((b) => b.min > share);
  return (
    <div className="flex items-start gap-4">
      <LetterGrade letter={letter} />
      <div className="min-w-0">
        <h2 className="font-title text-2xl text-primary">{title}</h2>
        <p className="mt-0.5 text-sm text-tertiary">
          <span className="font-medium text-secondary">{percent(share)}</span> · {line}
        </p>
        <p className="mt-0.5 text-xs text-quaternary">
          {next ? `${percent(next.min - share)} more for ${next.letter}.` : "Top band. It doesn't need zero issues to stay here."}
        </p>
      </div>
    </div>
  );
}

/** The fixed bands as one bar, with the current share marked. */
function Bands({ share }: { share: number }) {
  // Show 40%-100%: below that everything is F and the bar would be mostly empty.
  const from = 0.4;
  const pos = (v: number) => `${(Math.max(0, v - from) / (1 - from)) * 100}%`;
  const bands = BANDS.filter((b) => b.letter !== "F");
  return (
    <div className="pt-5">
      <div className="relative h-2 rounded-full bg-tertiary">
        {bands.map((b, i) => {
          const upper = i === 0 ? 1 : bands[i - 1].min;
          return (
            <div
              key={b.letter}
              className={cx("absolute inset-y-0 border-l border-primary", i === 0 && "rounded-r-full")}
              style={{ left: pos(b.min), width: `calc(${pos(upper)} - ${pos(b.min)})` }}
            >
              <span className="absolute -top-5 left-1 text-xs text-quaternary">{b.letter}</span>
            </div>
          );
        })}
        <div className="absolute -top-1 size-4 -translate-x-1/2 rounded-full bg-brand-solid ring-2 ring-bg-primary" style={{ left: pos(Math.min(1, share)) }} />
      </div>
    </div>
  );
}

function Stat({ label, value, href }: { label: string; value: number; href?: string }) {
  const body = (
    <>
      <span className="block text-xs text-tertiary">{label}</span>
      <span className="block font-title text-2xl text-primary">{value}</span>
    </>
  );
  return href ? (
    <a href={href} className="rounded-lg px-3 py-2 ring-1 ring-secondary hover:bg-primary_hover">
      {body}
    </a>
  ) : (
    <div className="rounded-lg px-3 py-2 ring-1 ring-secondary">{body}</div>
  );
}
