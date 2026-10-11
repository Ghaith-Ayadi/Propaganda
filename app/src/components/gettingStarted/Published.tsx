// Step 7: the first article is live. Confetti once, its live link, a strip to
// put the blog on the tenant's own domain (dismissed for good), and "What
// happens next": what's waiting, where it lives, and two ways on.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowRight, Check, CheckCircle, Columns03, Globe01, LinkExternal01, Rocket02, XClose } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { useWorkspace } from "@/components/Workspace";
import { db } from "@/lib/db";
import { goPage } from "@/lib/route";
import { setSetting, useSetting } from "@/lib/settings";
import { postPublicUrl, readableUrl, siteHost } from "@/lib/siteUrl";
import { collectionSlugOf } from "@/lib/slug";
import { cx } from "@/utils/cx";
import type { PipelineItem } from "@/lib/pipeline/types";
import type { FirstDay } from "./state";

export function PublishedStep({ day, onNext }: { day: FirstDay; onNext: () => void }) {
  const { site } = useWorkspace();
  const dismissed = !!useSetting<string>("onboarding.domainStripDismissed", "");
  const post = useLiveQuery(() => (day.firstArticle ? db.posts.get(day.firstArticle) : undefined), [day.firstArticle]);
  const cols = useLiveQuery(() => db.collections.toArray(), [], []);
  const url = post?.slug ? postPublicUrl({ slug: site.slug, domain: site.domain }, collectionSlugOf(post.type, cols), post.slug) : null;
  const done = day.completed;

  return (
    <div className="flex flex-col gap-8">
      {!dismissed && !site.domain && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-secondary px-4 py-3">
          <Globe01 className="size-5 text-fg-quaternary" />
          <span className="flex-1 text-sm text-secondary">
            Put your blog on your own domain instead of <span className="font-medium text-primary">{siteHost({ slug: site.slug, domain: "" })}</span>.
          </span>
          <Button size="sm" color="secondary" onClick={() => goPage("site")}>
            Set up domain
          </Button>
          <button
            type="button"
            aria-label="Dismiss for good"
            onClick={() => void setSetting("onboarding.domainStripDismissed", new Date().toISOString())}
            className="rounded p-1 text-quaternary hover:bg-primary_hover hover:text-secondary"
          >
            <XClose className="size-4" />
          </button>
        </div>
      )}

      <section className="flex flex-col items-center gap-4 py-10 text-center">
        <span className="grid size-14 place-items-center rounded-full bg-success-secondary">
          <CheckCircle className="size-7 text-fg-success-primary" />
        </span>
        <h2 className="font-title text-3xl text-primary">{done ? "You're all set" : "Your first article is live"}</h2>
        {post?.title && <p className="max-w-md text-sm text-tertiary">{post.title}</p>}
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 font-mono text-sm text-primary ring-1 ring-secondary ring-inset hover:bg-primary_hover"
          >
            {readableUrl(url)} <LinkExternal01 className="size-4 text-quaternary" />
          </a>
        )}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {done ? (
            <Button iconTrailing={ArrowRight} onClick={() => goPage("pipeline")}>
              Go to the Pipeline
            </Button>
          ) : (
            <Button color="secondary" iconTrailing={ArrowRight} onClick={onNext}>
              What happens next
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}

/** What's still waiting from the first batch. */
function waitingOf(pitches: PipelineItem[]) {
  return {
    drafts: pitches.filter((p) => p.stage === "in_review" || (p.stage === "pitched" && p.postId)).length,
    pitches: pitches.filter((p) => p.stage === "pitched" && !p.postId).length,
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function NextDialog({ day, onClose, onGuide, onPipeline }: { day: FirstDay; onClose: () => void; onGuide: () => void; onPipeline: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const w = waitingOf(day.firstPitches);
  const launch = day.proposal?.launch;
  const nothingLeft = w.drafts + w.pitches === 0;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-overlay/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal aria-labelledby="next-title" onClick={(e) => e.stopPropagation()} className="w-[760px] max-w-full rounded-2xl bg-primary shadow-2xl ring-1 ring-secondary">
        <div className="flex items-start justify-between gap-4 border-b border-secondary px-6 py-5">
          <div>
            <h2 id="next-title" className="type-title text-primary">What happens next</h2>
            <p className="mt-1 text-sm text-tertiary">
              Your first article is live.{nothingLeft ? "" : " The rest of your first batch is waiting for you."}
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded p-1 text-quaternary hover:bg-primary_hover hover:text-secondary">
            <XClose className="size-5" />
          </button>
        </div>

        <div className="grid gap-6 px-6 py-5 md:grid-cols-[1fr_1.1fr]">
          <ul className="flex flex-col gap-3 text-sm text-secondary">
            {!nothingLeft && (
              <Bullet>
                <b className="font-medium text-primary">{plural(w.drafts, "draft", "drafts")}</b> {w.drafts === 1 ? "is" : "are"} ready or being written, and{" "}
                <b className="font-medium text-primary">{plural(w.pitches, "pitch", "pitches")}</b> {w.pitches === 1 ? "waits" : "wait"} for a yes or no.
              </Bullet>
            )}
            <Bullet>
              Everything lives in the <b className="font-medium text-primary">Pipeline</b>: pitches, then writing, then review, then published.
            </Bullet>
            <Bullet>The next batch of pitches is written after what you approved and rejected today.</Bullet>
            {launch && <Bullet>Your Launch runs {launch.publishOverDays} days: {launch.target} posts, the first one live today.</Bullet>}
            <li className="mt-1 rounded-lg bg-secondary px-3 py-2.5 text-primary">
              <span className="font-medium">What to do:</span> approve what you'd publish, reject with a reason, and open each draft when it's ready. A few minutes a day is enough.
            </li>
          </ul>
          <PipelineIllustration pitches={day.firstPitches} />
        </div>

        <div className="grid gap-4 border-t border-secondary px-6 py-5 sm:grid-cols-2">
          <ChoiceTile
            icon={<Rocket02 className="size-6" />}
            title="Continue the first batch now"
            body={nothingLeft ? "Nothing left in it: you're through." : `Stay in this guide: ${plural(w.drafts, "draft", "drafts")} and ${plural(w.pitches, "pitch", "pitches")}.`}
            primary
            onClick={onGuide}
          />
          <ChoiceTile icon={<Columns03 className="size-6" />} title="I got it" body="Put everything in the Pipeline. I'll handle it later." onClick={onPipeline} />
        </div>
      </div>
    </div>
  );
}

function Bullet({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <Check className="mt-0.5 size-4 shrink-0 text-fg-success-primary" />
      <span>{children}</span>
    </li>
  );
}

function ChoiceTile({ icon, title, body, primary, onClick }: { icon: ReactNode; title: string; body: string; primary?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "flex aspect-square max-h-56 w-full flex-col justify-between rounded-xl p-5 text-left ring-1 ring-inset transition sm:aspect-auto sm:h-48",
        primary ? "bg-brand-solid text-white ring-transparent hover:bg-brand-solid_hover" : "bg-primary ring-secondary hover:bg-primary_hover",
      )}
    >
      <span className={cx(primary ? "text-white" : "text-fg-quaternary")}>{icon}</span>
      <span>
        <span className={cx("block text-lg font-semibold", primary ? "text-white" : "text-primary")}>{title}</span>
        <span className={cx("mt-1 block text-sm", primary ? "text-white/80" : "text-tertiary")}>{body}</span>
      </span>
    </button>
  );
}

/** A small, real-HTML picture of the Pipeline board with today's own pitches in it. */
function PipelineIllustration({ pitches }: { pitches: PipelineItem[] }) {
  const col = (stages: string[]) => pitches.filter((p) => stages.includes(p.stage));
  const cols = [
    { name: "Pitched", items: col(["pitched"]) },
    { name: "Writing", items: col(["writing"]) },
    { name: "Review", items: col(["in_review"]) },
    { name: "Live", items: col(["scheduled", "published"]) },
  ];
  return (
    <div aria-hidden className="rounded-xl bg-secondary p-3 ring-1 ring-secondary ring-inset">
      <div className="mb-2 flex items-center gap-1.5 px-1 text-xs font-medium text-tertiary">
        <Columns03 className="size-3.5" /> Pipeline
      </div>
      <div className="grid grid-cols-4 gap-2">
        {cols.map((c) => (
          <div key={c.name} className="flex flex-col gap-1.5">
            <p className="px-1 text-[10px] font-medium tracking-wide text-quaternary uppercase">{c.name}</p>
            {c.items.slice(0, 3).map((p) => (
              <div key={p.id} className="rounded-md bg-primary p-1.5 text-[10px] leading-tight text-secondary shadow-xs ring-1 ring-secondary ring-inset">
                {p.title}
              </div>
            ))}
            {c.items.length > 3 && <div className="px-1 text-[10px] text-quaternary">+{c.items.length - 3} more</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// Confetti in the app's own neutrals (no accent colours in the product).
export function Confetti() {
  const pieces = useRef(
    Array.from({ length: 120 }, (_, i) => ({
      left: Math.random() * 100,
      delay: Math.random() * 0.6,
      duration: 2.4 + Math.random() * 1.8,
      size: 6 + Math.random() * 6,
      rotate: Math.random() * 360,
      shade: ["#0a0a0a", "#404040", "#737373", "#a3a3a3", "#d4d4d4"][i % 5],
      round: i % 3 === 0,
    })),
  ).current;
  const [show, setShow] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setShow(false), 4500);
    return () => window.clearTimeout(t);
  }, []);
  if (!show || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      <style>{`@keyframes gs-confetti{0%{transform:translateY(-10vh) rotate(0)}100%{transform:translateY(110vh) rotate(720deg)}}`}</style>
      {pieces.map((p, i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            top: 0,
            left: `${p.left}%`,
            width: p.size,
            height: p.round ? p.size : p.size * 0.45,
            background: p.shade,
            borderRadius: p.round ? "9999px" : "1px",
            transform: `rotate(${p.rotate}deg)`,
            animation: `gs-confetti ${p.duration}s ${p.delay}s cubic-bezier(.2,.6,.4,1) forwards`,
          }}
        />
      ))}
    </div>
  );
}
