// Home: the two grades first, then coverage, then performance as an FYI.
// Vanity counts sit at the bottom, deliberately out of the goals.

import { ArrowRight, TrendUp01 } from "@untitledui/icons";
import { Button, Card, CardHead, Dot, Eyebrow, Grade, LinkRow, Meter, Pill, RangeBar, Spark, cx } from "../bits";
import { useStore } from "../store";
import * as D from "../data";

export function Home() {
  const { s, d, go } = useStore();
  const planned = s.objects.filter((o) => o.type === "blog" && (o.status !== "draft" || o.step === "review") && o.date >= "2026-10-05" && o.date <= "2026-10-11").length;

  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-5 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-title text-2xl text-primary">{D.site.name}</h1>
          <p className="mt-0.5 text-sm text-tertiary">
            {D.QUARTER} · {D.totalContent} pieces under watch · last swept today
          </p>
        </div>
        <Button kind="primary" onClick={() => go("inbox")}>
          {d.inboxTotal} in the inbox
          <ArrowRight className="size-4" />
        </Button>
      </header>

      {/* The pipeline, in one line */}
      <Card className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <Eyebrow>This week</Eyebrow>
          <p className="mt-1 text-sm text-primary">
            <span className="tnum">{d.inbox.pitches}</span> pitches and <span className="tnum">{d.inbox.reviews}</span>{" "}
            {d.inbox.reviews === 1 ? "review wait" : "reviews wait"} on you.{" "}
            <span className="tnum">{planned}</span> posts planned against a goal of <span className="tnum">{D.cadence}</span>.
          </p>
        </div>
        <Button onClick={() => go("pipeline")}>
          Open the pipeline
          <ArrowRight className="size-4" />
        </Button>
      </Card>

      {/* Consistency */}
      <Card className="flex flex-col gap-5">
        <CardHead
          title="Consistency"
          hint="On for every site. Two grades: what you published, and what you know."
          right={<Pill tone="neutral">Always on</Pill>}
        />
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <Grade letter={d.content.grade} label="Content" share={d.content.share} />
            <Meter value={d.content.share} tone={d.content.grade === "A" ? "good" : d.content.grade === "B" ? "info" : d.content.grade === "C" ? "warn" : "bad"} />
            <p className="text-xs text-tertiary">
              <span className="tnum">{d.content.denom - d.content.flagged}</span> of{" "}
              <span className="tnum">{d.content.denom}</span> pieces carry no open flag.
              {d.content.excluded > 0 && (
                <>
                  {" "}
                  <span className="tnum">{d.content.excluded}</span> left out as unfixable.
                </>
              )}
            </p>
            <div>
              <Eyebrow>What to work on</Eyebrow>
              <ul className="mt-2 flex flex-col gap-1.5">
                {d.content.notes.length === 0 && <li className="text-sm text-tertiary">Nothing open.</li>}
                {d.content.notes.map(([theme, n]) => (
                  <li key={theme} className="flex items-center gap-2 text-sm text-secondary">
                    <Dot tone={n > 2 ? "bad" : "warn"} />
                    <span className="min-w-0 flex-1 truncate">{theme}</span>
                    <span className="tnum shrink-0 text-xs text-quaternary">{n}</span>
                  </li>
                ))}
              </ul>
            </div>
            <LinkRow onClick={() => go("inbox")}>Work the flags</LinkRow>
          </div>

          <div className="flex flex-col gap-4 lg:border-l lg:border-secondary lg:pl-5">
            <Grade letter={d.kb.grade} label="Knowledge base" share={d.kb.share} />
            <Meter value={d.kb.share} tone={d.kb.grade === "A" ? "good" : d.kb.grade === "B" ? "info" : d.kb.grade === "C" ? "warn" : "bad"} />
            <p className="text-xs text-tertiary">
              <span className="tnum">{d.kb.entries}</span> claims, <span className="tnum">{s.contested.length}</span> contested,{" "}
              <span className="tnum">{s.contradictions.length}</span> contradicting.
            </p>
            <div className="rounded-lg border border-secondary bg-secondary p-3">
              <p className="text-xs text-secondary">
                Arguing a flag away on a thin case gets it admitted as contested. It closes the flag and
                lowers this grade, which is the point: the work moved, it didn't disappear.
              </p>
            </div>
            <LinkRow onClick={() => go("kb")}>Open the knowledge base</LinkRow>
          </div>
        </div>
      </Card>

      {/* Coverage */}
      <Card className="flex flex-col gap-5">
        <CardHead
          title="Coverage"
          hint={`How much of what you know became content, and how much search demand you took. ${D.QUARTER}.`}
          right={<Pill tone={d.coverage.pct >= 0.9 ? "good" : d.coverage.pct >= 0.5 ? "warn" : "bad"}>{Math.round(d.coverage.pct * 100)}%</Pill>}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <CoverageSide
            label="Internal"
            hint="From your calls and documents"
            c={d.coverage.internal}
            pct={d.coverage.internalPct}
          />
          <CoverageSide
            label="External"
            hint="From search demand"
            c={d.coverage.external}
            pct={d.coverage.externalPct}
          />
        </div>
        <div className="flex flex-col gap-3 border-t border-secondary pt-4">
          <Eyebrow>By topic</Eyebrow>
          <ul className="flex flex-col gap-3">
            {s.topics.map((t) => (
              <li key={t.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)_auto]">
                <span className="min-w-0 truncate text-sm text-primary">{t.name}</span>
                <span className="col-span-2 sm:col-span-1">
                  <RangeBar published={t.published} range={t.range} />
                </span>
                <span className="tnum shrink-0 text-right text-xs text-tertiary">
                  {t.published} / {t.range[0]}–{t.range[1]}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-quaternary">
            The bar is what you published; the grey band is the range the strategy agent recommends.
          </p>
        </div>
      </Card>

      {/* Performance */}
      <Card className="flex flex-col gap-5">
        <CardHead
          title="Performance"
          hint="Propaganda doesn't promote anything, so treat this as information, not a target it can hit."
          right={<Pill tone="neutral">FYI</Pill>}
        />
        <div className="grid gap-4 sm:grid-cols-3">
          {D.performance.metrics.map((m) => {
            const delta = (m.value - m.last) / m.last;
            const good = m.key === "tpp" ? delta < 0 : delta > 0;
            return (
              <div key={m.key} className="flex flex-col gap-2 rounded-xl bg-secondary p-4">
                <div className="text-xs text-tertiary">{m.label}</div>
                <div className="flex items-end justify-between gap-2">
                  <span className="tnum font-title text-2xl text-primary">
                    {m.value.toLocaleString()}
                    {m.unit}
                  </span>
                  <Spark points={m.spark} tone={good ? "good" : "warn"} />
                </div>
                <div className={cx("tnum flex items-center gap-1 text-xs", good ? "text-success-primary" : "text-warning-primary")}>
                  <TrendUp01 className={cx("size-3.5", delta < 0 && "rotate-180")} />
                  {Math.abs(Math.round(delta * 1000) / 10)}% on last quarter
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-quaternary">
          Target for {D.QUARTER}: <span className="tnum">{Math.round(D.performance.growthTarget * 100)}%</span> growth on
          last quarter's numbers.
        </p>
      </Card>

      {/* Vanity + activity */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <Card className="flex flex-col gap-4">
          <CardHead title="This quarter" hint="Counts, not goals." />
          <div className="grid grid-cols-3 gap-4">
            {[
              ["Raised", D.vanity.raised],
              ["Ditched", D.vanity.ditched],
              ["Pitched", D.vanity.pitched],
            ].map(([label, n]) => (
              <div key={label as string}>
                <div className="tnum font-title text-3xl text-primary">{n as number}</div>
                <div className="text-xs text-tertiary">{label as string}</div>
              </div>
            ))}
          </div>
        </Card>
        <Card pad={false}>
          <div className="border-b border-secondary px-4 py-3">
            <Eyebrow>What the agents did</Eyebrow>
          </div>
          <ul className="divide-y divide-[var(--color-border-secondary)]">
            {D.activity.map((a) => (
              <li key={a.when + a.what} className="flex items-baseline gap-3 px-4 py-2.5">
                <span className="tnum w-20 shrink-0 text-xs text-quaternary">{a.when}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-primary">{a.what}</span>
                  <span className="block text-xs text-tertiary">{a.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function CoverageSide({
  label,
  hint,
  c,
  pct,
}: {
  label: string;
  hint: string;
  c: { published: number; opportunities: number; goal: number };
  pct: number;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-secondary p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-primary">{label}</div>
          <div className="text-xs text-tertiary">{hint}</div>
        </div>
        <span className="tnum font-title text-2xl text-primary">{Math.round(pct * 100)}%</span>
      </div>
      <Meter value={pct} tone={pct >= 1 ? "good" : pct >= 0.5 ? "warn" : "bad"} />
      <dl className="tnum grid grid-cols-3 gap-2 text-xs">
        {[
          ["Published", c.published],
          ["Goal", c.goal],
          ["Opportunities", c.opportunities],
        ].map(([k, v]) => (
          <div key={k as string}>
            <dt className="text-quaternary">{k as string}</dt>
            <dd className="text-primary">{v as number}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-quaternary">published ÷ goal, capped at 100%</p>
    </div>
  );
}
