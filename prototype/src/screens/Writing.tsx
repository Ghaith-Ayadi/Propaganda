// Writing: Propaganda is still the editor. Four top-level kinds of content,
// each grouped its own way: Blog (collections), Social (channels), Email
// (threads), Sales enablement (later). The blog list and the editor work;
// the other kinds show their top-level page and open in the same editor.

import { useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Check, FileCheck02, Plus, Scales02, Star01 } from "@untitledui/icons";
import {
  Button,
  Card,
  Dot,
  Empty,
  Excerpt,
  OriginalLink,
  Pill,
  TypeIcon,
  TypeLabel,
  cx,
} from "../bits";
import { NEEDS_ACTION, bodyFor, claimOf, objectOf, topicName, useStore } from "../store";
import * as D from "../data";
import type { ContentObject, Flag } from "../data";

const words = (paras: string[]) => paras.join(" ").split(/\s+/).filter(Boolean).length;

function useFlagsByObject() {
  const { s } = useStore();
  return useMemo(() => {
    const m = new Map<string, Flag[]>();
    for (const f of s.flags) if (NEEDS_ACTION.includes(f.status)) m.set(f.objectId, [...(m.get(f.objectId) ?? []), f]);
    return m;
  }, [s.flags]);
}

function newId() {
  return "n" + Math.random().toString(36).slice(2, 9);
}

// ── Blog ───────────────────────────────────────────────────────────────

export function BlogPage({ initialCollection = "all" }: { initialCollection?: string }) {
  const { s, dispatch, go } = useStore();
  const [coll, setColl] = useState(initialCollection);
  const flagsBy = useFlagsByObject();
  const blog = s.objects.filter((o) => o.type === "blog");
  const shown = blog.filter((o) => coll === "all" || o.group === coll).sort((a, b) => b.date.localeCompare(a.date));

  const create = () => {
    const id = newId();
    dispatch({
      type: "newPost",
      obj: { id, type: "blog", group: coll === "all" ? "guides" : coll, title: "", topic: "close", date: D.TODAY, url: "", status: "draft" },
      body: [""],
    });
    go(`post-${id}`);
  };

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <TypeIcon type="blog" className="size-6" />
          <div>
            <h1 className="font-title text-2xl text-primary">Blog</h1>
            <p className="mt-0.5 text-sm text-tertiary">{D.site.blogUrl.replace("https://", "")} · published to {D.site.destination}</p>
          </div>
        </div>
        <Button kind="primary" iconLeading={<Plus className="size-4" />} onClick={create}>New post</Button>
      </header>

      <nav className="flex gap-1 overflow-x-auto border-b border-secondary">
        {[{ id: "all", name: "All", emoji: "" }, ...D.collections].map((c) => {
          const n = c.id === "all" ? blog.length : blog.filter((o) => o.group === c.id).length;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setColl(c.id)}
              aria-pressed={coll === c.id}
              className={cx(
                "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition",
                coll === c.id ? "border-brand-solid text-primary" : "border-transparent text-tertiary hover:text-secondary",
              )}
            >
              {c.emoji && <span>{c.emoji}</span>}
              {c.name}
              <span className="tnum text-xs text-quaternary">{n}</span>
            </button>
          );
        })}
        <button type="button" className="ml-1 shrink-0 px-2 text-quaternary hover:text-secondary" aria-label="New collection">
          <Plus className="size-4" />
        </button>
      </nav>

      <Card pad={false}>
        <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <Th>Title</Th>
              <Th className="hidden w-40 sm:table-cell">Collection</Th>
              <Th className="w-28">Status</Th>
              <Th className="hidden w-28 md:table-cell">Date</Th>
              <Th className="w-20 text-right">Flags</Th>
            </tr>
          </thead>
          <tbody>
            {shown.map((o) => {
              const c = D.collections.find((x) => x.id === o.group);
              const f = flagsBy.get(o.id)?.length ?? 0;
              return (
                <tr key={o.id} tabIndex={0} onClick={() => go(`post-${o.id}`)} onKeyDown={(e) => e.key === "Enter" && go(`post-${o.id}`)} className="cursor-pointer outline-none transition hover:bg-secondary focus:bg-secondary">
                  <Td className="truncate text-primary">{o.title || <span className="text-quaternary">Untitled</span>}</Td>
                  <Td className="hidden truncate text-xs text-tertiary sm:table-cell">{c?.emoji} {c?.name}</Td>
                  <Td><Pill tone={o.status === "published" ? "good" : "neutral"}>{o.status === "published" ? "Published" : "Draft"}</Pill></Td>
                  <Td className="tnum hidden text-xs text-quaternary md:table-cell">{o.date}</Td>
                  <Td className="text-right">
                    {f > 0 ? (
                      <span className="tnum inline-flex items-center gap-1 text-xs text-error-primary"><AlertTriangle className="size-3.5" />{f}</span>
                    ) : (
                      <span className="text-xs text-quaternary">·</span>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {shown.length === 0 && <Empty title="Nothing in this collection yet" hint="New posts land in the collection you're looking at." />}
      </Card>
    </div>
  );
}

// ── Social ─────────────────────────────────────────────────────────────

export function SocialPage() {
  const { s, go } = useStore();
  const flagsBy = useFlagsByObject();
  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-title text-2xl text-primary">Social</h1>
          <p className="mt-0.5 text-sm text-tertiary">Grouped by channel: a platform plus a specific account. A company can have more than one on the same platform.</p>
        </div>
        <Button iconLeading={<Plus className="size-4" />}>Add a channel</Button>
      </header>
      <div className="grid gap-4 md:grid-cols-3">
        {D.channels.map((c) => {
          const items = s.objects.filter((o) => o.group === c.id);
          return (
            <Card key={c.id} pad={false} className="flex flex-col">
              <div className="flex items-center gap-3 border-b border-secondary px-4 py-3">
                <TypeIcon type={c.type} className="size-6" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-primary">{c.name}</div>
                  <div className="truncate text-xs text-tertiary">{D.objectTypes[c.type].label.replace(" post", "")} · {c.handle} · {c.followers}</div>
                </div>
              </div>
              <ul className="flex-1 divide-y divide-[var(--color-border-secondary)]">
                {items.map((o) => (
                  <ObjectRow key={o.id} o={o} flags={flagsBy.get(o.id)?.length ?? 0} onClick={() => go(`post-${o.id}`)} />
                ))}
              </ul>
              <div className="border-t border-secondary px-4 py-2.5">
                <button type="button" className="flex items-center gap-1 text-xs font-medium text-tertiary hover:text-secondary"><Plus className="size-3.5" /> New post</button>
              </div>
            </Card>
          );
        })}
      </div>
      <p className="text-xs text-quaternary">Prototype: social posts open in the same editor as the blog. Scheduling to each channel isn't drawn.</p>
    </div>
  );
}

// ── Email ──────────────────────────────────────────────────────────────

export function EmailPage() {
  const { s, go } = useStore();
  const flagsBy = useFlagsByObject();
  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <TypeIcon type="newsletter" className="size-6" />
          <div>
            <h1 className="font-title text-2xl text-primary">Email</h1>
            <p className="mt-0.5 text-sm text-tertiary">Grouped by thread: a newsletter, a sequence. Once sent, an email can't be fixed.</p>
          </div>
        </div>
        <Button iconLeading={<Plus className="size-4" />}>New thread</Button>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        {D.threads.map((t) => {
          const items = s.objects.filter((o) => o.group === t.id).sort((a, b) => b.date.localeCompare(a.date));
          return (
            <Card key={t.id} pad={false}>
              <div className="border-b border-secondary px-4 py-3">
                <div className="text-sm font-medium text-primary">{t.name}</div>
                <div className="text-xs text-tertiary">{t.desc} · {t.audience}</div>
              </div>
              <ul className="divide-y divide-[var(--color-border-secondary)]">
                {items.map((o) => (
                  <ObjectRow key={o.id} o={o} flags={flagsBy.get(o.id)?.length ?? 0} onClick={() => go(`post-${o.id}`)} sentLabel />
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ── Sales enablement ──────────────────────────────────────────────────

export function SalesPage() {
  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5 px-4 py-8 sm:px-6">
      <header>
        <h1 className="font-title text-2xl text-primary">Sales enablement</h1>
        <p className="mt-0.5 text-sm text-tertiary">Battlecards, one-pagers, objection handling. Checked against the same knowledge base.</p>
      </header>
      <Card>
        <div className="grid place-items-center gap-2 px-6 py-14 text-center">
          <Pill>After 0.2</Pill>
          <p className="max-w-md text-sm text-secondary">
            The objections already pulled from your calls will seed this: {D.vanity.raised} raised this quarter.
          </p>
        </div>
      </Card>
    </div>
  );
}

function ObjectRow({ o, flags, onClick, sentLabel }: { o: ContentObject; flags: number; onClick: () => void; sentLabel?: boolean }) {
  return (
    <li>
      <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-secondary">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-primary">{o.title}</span>
          <span className="tnum block text-xs text-quaternary">
            {o.status === "draft" ? "Draft" : sentLabel ? `Sent ${o.date}` : o.date}
          </span>
        </span>
        {flags > 0 && <span className="tnum inline-flex items-center gap-1 text-xs text-error-primary"><AlertTriangle className="size-3.5" />{flags}</span>}
      </button>
    </li>
  );
}

// ── The editor ─────────────────────────────────────────────────────────

type Tab = "flags" | "brief" | "knowledge";

export function PostEditor({ id }: { id: string }) {
  const { s, dispatch, go, toast } = useStore();
  const o = s.objects.find((x) => x.id === id);
  const [tab, setTab] = useState<Tab>("flags");
  const [active, setActive] = useState<string | null>(null);
  const [liveWords, setLiveWords] = useState<number | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  if (!o) {
    return (
      <div className="mx-auto max-w-[720px] px-4 py-16 sm:px-6">
        <Empty title="This piece doesn't exist in the prototype" hint="Reloading resets the dummy data." />
      </div>
    );
  }

  const kind = D.kindOf(o.type);
  const type = D.objectTypes[o.type];
  const body = bodyFor(s, o.id);
  const flags = s.flags.filter((f) => f.objectId === o.id && NEEDS_ACTION.includes(f.status));
  const closed = s.flags.filter((f) => f.objectId === o.id && !NEEDS_ACTION.includes(f.status));
  const locked = !type.fixable && o.status === "published";
  const pitch = o.briefId ? s.pitches.find((p) => p.id === o.briefId) : undefined;
  const claimIds = [...new Set([...(pitch?.claimIds ?? []), ...s.flags.filter((f) => f.objectId === o.id && f.against.kind === "kb").map((f) => (f.against as { claimId: string }).claimId)])];
  const groupName =
    kind === "blog" ? D.collections.find((c) => c.id === o.group)?.name : kind === "social" ? D.channels.find((c) => c.id === o.group)?.name : D.threads.find((t) => t.id === o.group)?.name;

  const commit = () => {
    if (!bodyRef.current) return;
    const paras = [...bodyRef.current.querySelectorAll<HTMLElement>("[data-para]")].map((el) => el.innerText.trim());
    dispatch({ type: "body", id: o.id, body: paras });
  };

  return (
    <div className="flex min-h-full flex-col xl:flex-row">
      <div className="min-w-0 flex-1 bg-primary">
        <div className="mx-auto flex max-w-[760px] flex-col gap-6 px-4 py-8 sm:px-10">
          <div className="flex flex-wrap items-center gap-2 text-xs text-tertiary">
            <button type="button" onClick={() => go(kind as "blog")} className="inline-flex items-center gap-1 hover:text-secondary">
              <ArrowLeft className="size-3.5" />
              {kind === "blog" ? "Blog" : kind === "social" ? "Social" : "Email"}
            </button>
            <span className="text-quaternary">/</span>
            <span>{groupName}</span>
            <span className="flex-1" />
            {o.url && <OriginalLink url={o.url} label="View live" />}
          </div>

          <textarea
            id={`title-${o.id}`}
            value={o.title}
            readOnly={locked}
            onChange={(e) => dispatch({ type: "title", id: o.id, title: e.target.value })}
            placeholder="Untitled"
            rows={1}
            className="w-full resize-none bg-transparent font-title text-4xl leading-tight text-primary outline-none [field-sizing:content] placeholder:text-quaternary"
          />

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-secondary pb-4 text-xs">
            <TypeLabel type={o.type} />
            {kind === "blog" && (
              <select
                aria-label="Collection"
                value={o.group}
                onChange={(e) => dispatch({ type: "object", id: o.id, patch: { group: e.target.value } })}
                className="rounded-md bg-secondary px-2 py-1 text-xs text-secondary outline-none ring-1 ring-inset ring-secondary"
              >
                {D.collections.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
              </select>
            )}
            <Pill tone={o.status === "published" ? "good" : "neutral"}>{o.status === "published" ? (o.type === "newsletter" ? "Sent" : "Published") : "Draft"}</Pill>
            <span className="text-tertiary">{topicName(o.topic)}</span>
            <span className="tnum text-quaternary">{liveWords ?? words(body)} words</span>
            <span className="flex-1" />
            {o.status === "draft" && (
              <Button size="sm" kind="primary" onClick={() => { commit(); dispatch({ type: "object", id: o.id, patch: { status: "published", date: D.TODAY } }); toast(kind === "blog" ? `Published to ${D.site.destination}` : "Scheduled"); }}>
                {kind === "email" ? "Send" : "Publish"}
              </Button>
            )}
          </div>

          {locked && (
            <div className="rounded-lg border border-secondary bg-secondary px-3 py-2 text-xs text-tertiary">
              {type.why} This copy is read-only; corrections go in the next one.
            </div>
          )}

          <div
            ref={bodyRef}
            onInput={() => bodyRef.current && setLiveWords(bodyRef.current.innerText.split(/\s+/).filter(Boolean).length)}
            onBlur={commit}
            className="flex flex-col gap-4 text-[17px] leading-[1.7] text-primary"
          >
            {body.map((p, i) => (
              <Paragraph
                key={i + ":" + p}
                text={p}
                flags={flags}
                editable={!locked}
                active={active}
                onMark={(fid) => { setActive(fid); setTab("flags"); }}
              />
            ))}
          </div>
        </div>
      </div>

      <aside className="w-full shrink-0 border-t border-secondary bg-secondary xl:sticky xl:top-0 xl:h-full xl:max-h-screen xl:w-[360px] xl:overflow-y-auto xl:border-t-0 xl:border-l">
        <div className="flex gap-1 border-b border-secondary px-3 pt-3">
          {([
            ["flags", `Flags`, flags.length, <AlertTriangle key="a" className="size-3.5" />],
            ["brief", "Brief", 0, <FileCheck02 key="b" className="size-3.5" />],
            ["knowledge", "Knowledge", claimIds.length, <Scales02 key="c" className="size-3.5" />],
          ] as const).map(([k, label, n, icon]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              aria-pressed={tab === k}
              className={cx("-mb-px flex items-center gap-1.5 border-b-2 px-2.5 py-2 text-xs font-medium transition", tab === k ? "border-brand-solid text-primary" : "border-transparent text-tertiary hover:text-secondary")}
            >
              {icon}
              {label}
              {n > 0 && <span className="tnum text-quaternary">{n}</span>}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3 p-4">
          {tab === "flags" && (
            <>
              {flags.length === 0 && <Empty title="Nothing flagged" hint="Edits are checked against the knowledge base as you write." />}
              {flags.map((f) => (
                <SideFlag key={f.id} f={f} active={active === f.id} fixable={type.fixable} onFocus={() => setActive(f.id)} />
              ))}
              {closed.length > 0 && (
                <p className="text-xs text-quaternary">
                  {closed.length} closed flag{closed.length > 1 ? "s" : ""} on this piece.
                </p>
              )}
            </>
          )}

          {tab === "brief" &&
            (pitch ? (
              <div className="flex flex-col gap-3 text-sm">
                <Pill tone="info"><Star01 className="size-3" /> From a pitch</Pill>
                <div><div className="text-xs font-semibold text-quaternary">Why</div><p className="text-secondary">{pitch.reason}</p></div>
                <div><div className="text-xs font-semibold text-quaternary">Angle</div><p className="text-secondary">{pitch.angle}</p></div>
                <div>
                  <div className="text-xs font-semibold text-quaternary">Outline</div>
                  <ol className="mt-1 flex flex-col gap-1 text-secondary">
                    {pitch.outline.map((l, i) => <li key={l} className="flex gap-2"><span className="tnum text-quaternary">{i + 1}.</span>{l}</li>)}
                  </ol>
                </div>
                <div className="tnum text-xs text-tertiary">{pitch.words[0]}–{pitch.words[1]} words · {pitch.keywords.join(", ")}</div>
              </div>
            ) : (
              <Empty title="No brief" hint="Posts written from a pitch carry their brief here." />
            ))}

          {tab === "knowledge" &&
            (claimIds.length === 0 ? (
              <Empty title="No claims linked yet" hint="The first check links every claim this piece relies on." />
            ) : (
              <ul className="flex flex-col gap-2">
                {claimIds.map((cid) => {
                  const c = claimOf(cid);
                  return (
                    <li key={cid} className="rounded-lg border border-secondary bg-primary px-3 py-2.5">
                      <p className="text-sm text-primary">{c.text}</p>
                      <div className="mt-1.5 flex items-center gap-2">
                        <Pill tone={c.status === "Settled" ? "good" : "warn"}>{c.status}</Pill>
                        <span className="text-xs text-quaternary">{c.evidence.length} source{c.evidence.length > 1 ? "s" : ""}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ))}
        </div>
      </aside>
    </div>
  );
}

/** One paragraph, editable, with flagged passages marked inline. */
function Paragraph({
  text,
  flags,
  editable,
  active,
  onMark,
}: {
  text: string;
  flags: Flag[];
  editable: boolean;
  active: string | null;
  onMark: (flagId: string) => void;
}) {
  const html = useMemo(() => {
    let out = escape(text);
    for (const f of flags) {
      const needle = escape(f.excerpt.text);
      if (!out.includes(needle)) continue;
      out = out.replace(
        needle,
        `<mark data-flag="${f.id}" class="cursor-pointer rounded-sm bg-error-primary px-0.5 text-primary underline decoration-wavy decoration-[var(--color-fg-error-primary)] underline-offset-4 ${active === f.id ? "ring-2 ring-error_subtle" : ""}">${needle}</mark>`,
      );
    }
    return out;
  }, [text, flags, active]);

  return (
    <p
      data-para
      contentEditable={editable}
      suppressContentEditableWarning
      spellCheck
      onClick={(e) => {
        const m = (e.target as HTMLElement).closest("mark[data-flag]");
        if (m) onMark(m.getAttribute("data-flag")!);
      }}
      className="outline-none empty:before:text-quaternary empty:before:content-['Start_writing…']"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function escape(t: string) {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function SideFlag({ f, active, fixable, onFocus }: { f: Flag; active: boolean; fixable: boolean; onFocus: () => void }) {
  const { dispatch, go, toast } = useStore();
  const against = f.against.kind === "kb" ? claimOf(f.against.claimId).text : `${objectOf(f.against.objectId).title}: “${f.against.excerpt.text}”`;
  return (
    <div
      onClick={onFocus}
      className={cx("flex flex-col gap-2.5 rounded-xl border bg-primary p-3 transition", active ? "border-error_subtle ring-2 ring-error_subtle" : "border-secondary")}
    >
      <div className="flex items-center gap-2">
        <Dot tone="bad" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-secondary">{f.theme}</span>
        <span className="tnum text-xs text-quaternary">{Math.round(f.confidence * 100)}%</span>
      </div>
      <p className="text-xs text-tertiary">
        <span className="text-quaternary">{f.against.kind === "kb" ? "Knowledge base: " : "Contradicts: "}</span>
        {against}
      </p>
      {fixable && f.fix ? (
        <>
          <Excerpt excerpt={{ ...f.excerpt, before: "", after: "" }} replace={f.fix} head={<>Fix</>} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" kind="primary" onClick={() => { dispatch({ type: "applyFix", id: f.id, fix: f.fix! }); toast("Fixed in the text. The flag is closed."); }}>
              <Check className="size-3.5" />
              Apply
            </Button>
            <Button size="sm" onClick={() => go("inbox")}>Other options</Button>
          </div>
        </>
      ) : (
        <Button size="sm" className="self-start" onClick={() => go("inbox")}>Handle in the inbox</Button>
      )}
    </div>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={cx("border-b border-secondary bg-secondary px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-quaternary", className)}>{children}</th>;
}
function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cx("border-t border-secondary px-4 py-2.5 align-middle", className)}>{children}</td>;
}

