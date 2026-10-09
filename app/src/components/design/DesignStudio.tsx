// The Design editor: pick a theme, set each page's options, watch the blog
// change, then publish. Settings → Design opens it.
//
// Edits go to the site's draft (blog.design.draft) and to the preview frame,
// which is the real blog at ?pg-preview=draft (blog/theme/Themed.tsx) showing
// the draft instead of the published design. Publishing copies the draft to
// blog.design, which switches the public blog to it; "Use the original blog"
// clears blog.design again. Themes and options: blog/theme/{themes,schema}.ts.

import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { XClose } from "@untitledui/icons";
import "@/blog/theme/pg.css";
import { Button } from "@/components/base/buttons/button";
import { toast } from "@/components/base/toast/toast";
import { useWorkspace } from "@/components/Workspace";
import { db } from "@/lib/db";
import { setSetting, useSetting } from "@/lib/settings";
import { sitePublicUrl } from "@/lib/siteUrl";
import { UI_PREVIEW } from "@/lib/preview";
import { collectionSlugOf, hasAddress, postPath } from "@/lib/slug";
import { THEMES, THEME_IDS, DEFAULT_THEME } from "@/blog/theme/themes";
import { SCHEMA, baseOf, enumValues, resolveDesign, type DesignOverrides, type OptionValue, type Template } from "@/blog/theme/schema";
import { asCustomThemes, asDesign, compiledOf, DESIGN_KEY, DRAFT_KEY, THEMES_KEY, themeOf, type SiteDesign } from "@/blog/theme/design";
import type { ThemeSource } from "@/blog/theme/compile";

type Page = Exclude<Template, "frame">;
const PAGES: { id: Page; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "collection", label: "Collection" },
  { id: "post", label: "Post" },
  { id: "author", label: "Author" },
];
const WIDTHS = [
  { w: 390, label: "Phone" },
  { w: 768, label: "Tablet" },
  { w: 1280, label: "Desktop" },
];

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function Seg<T extends string | number>({ items, value, onPick, label }: { items: { v: T; label: string; hint?: string }[]; value: T; onPick: (v: T) => void; label?: string }) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label={label}>
      {items.map((it) => (
        <button
          key={String(it.v)}
          type="button"
          title={it.hint}
          aria-pressed={it.v === value}
          onClick={() => onPick(it.v)}
          className={[
            "min-h-8 rounded-md px-2.5 py-1 text-xs transition",
            it.v === value ? "bg-fg text-bg" : "bg-tertiary text-secondary hover:text-primary",
          ].join(" ")}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

function Switch({ checked, onChange, labelledBy }: { checked: boolean; onChange: (v: boolean) => void; labelledBy: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      onClick={() => onChange(!checked)}
      className={["relative h-[22px] w-9 shrink-0 rounded-full transition", checked ? "bg-fg" : "bg-quaternary"].join(" ")}
    >
      <span className={["absolute top-[3px] left-[3px] size-4 rounded-full bg-primary transition-transform", checked ? "translate-x-3.5" : ""].join(" ")} />
    </button>
  );
}

function ThemeCard({ theme, selected, onPick }: { theme: ThemeSource; selected: boolean; onPick: () => void }) {
  const c = compiledOf(theme);
  const aud = theme.audience ? theme.audience.charAt(0).toLowerCase() + theme.audience.slice(1) : null;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onPick}
      className={[
        "grid grid-cols-[minmax(0,1fr)_auto] gap-x-2.5 gap-y-0.5 rounded-lg border p-3 text-left transition",
        selected ? "border-fg ring-1 ring-fg ring-inset" : "border-secondary hover:border-primary",
      ].join(" ")}
    >
      <span className="text-[22px] leading-tight text-primary" style={{ fontFamily: String(c.vars["--pg-font-display"]), fontWeight: Number(theme.type?.display?.weight ?? 600) }}>
        {theme.name}
      </span>
      <span className="flex items-center gap-1" aria-hidden="true">
        {[c.palette.paper, c.palette.ink, c.palette.accent].map((x, i) => (
          <i key={i} className="size-3.5 rounded-full border border-primary" style={{ background: x }} />
        ))}
      </span>
      {theme.summary && <span className="col-span-2 text-xs text-tertiary">{theme.summary}</span>}
      {aud && <span className="col-span-2 mt-0.5 text-xs text-secondary">For {aud}</span>}
    </button>
  );
}

export function DesignStudio({ onClose }: { onClose: () => void }) {
  const { site } = useWorkspace();
  const published = asDesign(useSetting<unknown>(DESIGN_KEY, null));
  const storedDraft = asDesign(useSetting<unknown>(DRAFT_KEY, null));
  const custom = asCustomThemes(useSetting<unknown>(THEMES_KEY, null));
  const [draft, setDraft] = useState<SiteDesign>(() => storedDraft ?? published ?? { api: 1, theme: DEFAULT_THEME, overrides: {} });
  const [page, setPage] = useState<Page>("home");
  const [width, setWidth] = useState(1280);
  const [busy, setBusy] = useState(false);
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  const themes: ThemeSource[] = useMemo(() => [...THEME_IDS.map((id) => THEMES[id]), ...Object.values(custom)], [custom]);
  const theme = themeOf(draft.theme, custom);
  const { design } = resolveDesign(theme, draft.overrides);
  const dirty = !same(draft, published);

  // Targets for the page tabs: the collection and the post the preview opens.
  const cols = useLiveQuery(() => db.collections.orderBy("position").toArray(), []) ?? [];
  const latest = useLiveQuery(async () => {
    const all = await db.posts.orderBy("publishedAt").reverse().toArray();
    return all.find((p) => p.status === "published" && hasAddress(p) && p.slug && !cols.find((c) => c.name === p.type)?.isHidden) ?? null;
  }, [cols.length]);
  const pathOf = (p: Page): string => {
    if (p === "author") return "/author";
    if (p === "collection") {
      const c = latest ? cols.find((x) => x.name === latest.type) : cols.find((x) => !x.isHidden);
      return c ? `/${c.slug || collectionSlugOf(c.name, cols)}` : "/";
    }
    if (p === "post" && latest) return postPath(collectionSlugOf(latest.type, cols), latest.slug);
    return "/";
  };
  const origin = sitePublicUrl(site).replace(/\/$/, "");
  // UI preview mode (lib/preview.ts) has no blog server: the frame shows the
  // themes' harness page with its sample fixtures instead (same origin, dev builds).
  const [src] = useState(() => (UI_PREVIEW ? "/_pg/harness" : `${origin}/?pg-preview=draft`));
  const targetOrigin = new URL(origin).origin;
  const harness = (p: Page, tries = 20) => {
    const w = frameRef.current?.contentWindow as (Window & typeof globalThis) | null | undefined;
    const api = w?.PPGD;
    if (!api) {
      if (tries > 0) setTimeout(() => harness(p, tries - 1), 150);
      return;
    }
    api.registerThemes(Object.values(custom));
    api.render({ theme: draft.theme, fixture: "sample", route: { tpl: p }, overrides: draft.overrides });
  };

  // Every change reaches the preview at once, and the stored draft shortly after.
  const post = (msg: unknown) => frameRef.current?.contentWindow?.postMessage(msg, targetOrigin);
  const pushDesign = () =>
    UI_PREVIEW ? harness(page) : post({ type: "pg-preview", design: draft, theme: custom[draft.theme] ?? undefined });
  useEffect(() => {
    pushDesign();
    const t = setTimeout(() => {
      if (!same(draft, storedDraft)) void setSetting(DRAFT_KEY, draft);
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== targetOrigin) return;
      const data = e.data as { type?: string; tpl?: string } | null;
      if (data?.type === "pg-preview-ready") {
        pushDesign();
        post({ type: "pg-preview-go", path: pathOf(page) });
      } else if (data?.type === "pg-preview-route" && data.tpl && data.tpl !== page && PAGES.some((p) => p.id === data.tpl)) {
        setPage(data.tpl as Page);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const goPage = (p: Page) => {
    setPage(p);
    if (UI_PREVIEW) harness(p);
    else post({ type: "pg-preview-go", path: pathOf(p) });
  };

  const setOption = (tpl: Template, sec: string, k: string, v: OptionValue) => {
    setDraft((d) => {
      const overrides: DesignOverrides = structuredClone(d.overrides);
      const secO = ((overrides[tpl] ??= {})[sec] ??= {});
      secO[k] = v;
      // A new layout takes that layout's default card, so the pair stays valid.
      const card = SCHEMA[tpl][sec].options.card;
      if (k === "layout" && card?.type === "enum") {
        const cur = resolveDesign(themeOf(d.theme, custom), d.overrides).design[tpl][sec].card;
        const vals = enumValues(card, { ...secO, layout: v });
        if (!vals.includes(String(cur))) secO.card = vals[1] ?? vals[0];
      }
      // Keep only what differs from the theme.
      const base = baseOf(themeOf(d.theme, custom), tpl, sec);
      for (const [key, val] of Object.entries(secO)) if (base[key] === val) delete secO[key];
      if (!Object.keys(secO).length) delete overrides[tpl]![sec];
      if (!Object.keys(overrides[tpl]!).length) delete overrides[tpl];
      return { ...d, overrides };
    });
  };
  const resetSection = (tpl: Template, sec: string) =>
    setDraft((d) => {
      const overrides: DesignOverrides = structuredClone(d.overrides);
      if (overrides[tpl]) delete overrides[tpl]![sec];
      return { ...d, overrides };
    });

  async function publish() {
    setBusy(true);
    try {
      await setSetting(DESIGN_KEY, draft);
      await setSetting(DRAFT_KEY, draft);
      toast.add({ type: "success", title: "Published", description: `The blog now uses ${theme.name}.` });
    } finally {
      setBusy(false);
    }
  }
  function discard() {
    const back = published ?? { api: 1 as const, theme: DEFAULT_THEME, overrides: {} };
    setDraft(back);
  }
  async function unpublish() {
    if (!window.confirm("Switch the public blog back to the original design? Your theme and options stay saved here.")) return;
    setBusy(true);
    try {
      await setSetting(DESIGN_KEY, null);
      toast.add({ type: "success", title: "The blog uses its original design again" });
    } finally {
      setBusy(false);
    }
  }

  // Preview scale: the chosen width, shrunk to fit the stage.
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stage, setStage] = useState({ w: 1000, h: 700 });
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth - 32, h: el.clientHeight - 32 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = Math.min(1, stage.w / width);

  const blocks: [Template, string][] = [
    ...Object.keys(SCHEMA[page]).map((s) => [page, s] as [Template, string]),
    ...Object.keys(SCHEMA.frame).map((s) => ["frame", s] as [Template, string]),
  ];
  // What the compiler changed or refused: worth showing for a site's own theme (built-in ones compile clean).
  const report = THEMES[theme.id] ? [] : compiledOf(theme).report;

  return (
    <div className="fixed inset-0 z-[60] grid grid-cols-[340px_minmax(0,1fr)] bg-secondary text-primary max-md:grid-cols-1 max-md:grid-rows-[auto_minmax(520px,1fr)] max-md:overflow-y-auto">
      <aside className="flex flex-col gap-5 overflow-y-auto border-r border-secondary bg-primary p-5 max-md:overflow-visible" aria-label="Design">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="font-title text-base">Design</h2>
            <p className="mt-0.5 text-xs text-tertiary">
              Live: {published ? themeOf(published.theme, custom).name : "the original blog"}
              {dirty && " · unpublished changes"}
            </p>
          </div>
          <button aria-label="Close" onClick={onClose} className="rounded-md p-1 text-quaternary transition hover:bg-tertiary hover:text-primary">
            <XClose className="size-4" />
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" color="primary" isDisabled={!dirty || busy} onClick={() => void publish()}>
            Publish
          </Button>
          <Button size="sm" color="secondary" isDisabled={!dirty || busy} onClick={discard}>
            Discard changes
          </Button>
          {published && (
            <Button size="sm" color="tertiary" isDisabled={busy} onClick={() => void unpublish()}>
              Use the original blog
            </Button>
          )}
        </div>

        <section className="grid gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-quaternary" id="d-theme">
            Theme
          </h3>
          <div className="grid gap-2" role="radiogroup" aria-labelledby="d-theme">
            {themes.map((t) => (
              <ThemeCard key={t.id} theme={t} selected={t.id === draft.theme} onPick={() => setDraft((d) => ({ ...d, theme: t.id }))} />
            ))}
          </div>
          {report.length > 0 && (
            <ul className="list-disc pl-4 text-xs text-tertiary">
              {report.map((r, i) => (
                <li key={i}>{r.msg}</li>
              ))}
            </ul>
          )}
        </section>

        <section className="grid gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-quaternary">Page</h3>
          <Seg label="Page" items={PAGES.map((p) => ({ v: p.id, label: p.label }))} value={page} onPick={goPage} />
        </section>

        <section className="grid gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-quaternary">Width</h3>
          <Seg label="Width" items={WIDTHS.map((x) => ({ v: x.w, label: x.label }))} value={width} onPick={setWidth} />
        </section>

        <section className="grid gap-3">
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-quaternary">Page options</h3>
            <p className="mt-1 text-xs text-tertiary">Defaults come from the theme; a dot marks a choice you changed.</p>
          </div>
          {blocks.map(([tpl, sec]) => {
            const def = SCHEMA[tpl][sec];
            const vals = design[tpl][sec];
            const base = resolveDesign(theme).design[tpl][sec];
            const changed = Object.keys(draft.overrides?.[tpl]?.[sec] ?? {}).length > 0;
            return (
              <div key={`${tpl}.${sec}`} className="grid gap-2.5 border-t border-secondary pt-3">
                <header className="flex items-baseline justify-between gap-2">
                  <h4 className="text-[13px] font-semibold">
                    {def.label}
                    {tpl === "frame" && <span className="ml-1 text-xs font-normal text-tertiary">(every page)</span>}
                  </h4>
                  <span className="flex items-baseline gap-2">
                    {def.component && <span className="font-mono text-[11px] text-tertiary">{def.component}</span>}
                    {changed && (
                      <button type="button" className="text-xs text-brand-secondary hover:underline" onClick={() => resetSection(tpl, sec)}>
                        Reset
                      </button>
                    )}
                  </span>
                </header>
                {Object.entries(def.options).map(([k, spec]) => {
                  if (spec.when && !spec.when(vals)) return null;
                  const id = `d-${tpl}-${sec}-${k}`;
                  const dot = vals[k] !== base[k] && <i className="inline-block size-1.5 rounded-full bg-[#d0552e]" title="Changed from the theme default" />;
                  if (spec.type === "bool")
                    return (
                      <div key={k} className="flex min-h-[30px] items-center justify-between gap-2.5">
                        <span id={id} className="flex items-center gap-1.5 text-[12.5px] text-secondary">
                          {dot}
                          {spec.label}
                        </span>
                        <Switch checked={vals[k] === true} onChange={(v) => setOption(tpl, sec, k, v)} labelledBy={id} />
                      </div>
                    );
                  const list = enumValues(spec, vals);
                  const hint = spec.hints?.[String(vals[k])];
                  return (
                    <div key={k} className="grid gap-1.5">
                      <span id={id} className="flex items-center gap-1.5 text-[12.5px] text-secondary">
                        {dot}
                        {spec.label}
                      </span>
                      <Seg label={spec.label} items={list.map((v) => ({ v, label: spec.labels[v] ?? v, hint: spec.hints?.[v] }))} value={String(vals[k])} onPick={(v) => setOption(tpl, sec, k, v)} />
                      {hint && <p className="text-xs text-tertiary">{hint}</p>}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </section>
      </aside>

      <main className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] bg-tertiary">
        <div className="flex min-w-0 items-center gap-3 border-b border-secondary bg-secondary px-4 py-2.5">
          <div className="min-w-0 flex-1 truncate rounded-md bg-tertiary px-2.5 py-1.5 font-mono text-xs text-tertiary">
            {origin.replace(/^https?:\/\//, "")}
            {pathOf(page)}
          </div>
          <span className="font-mono text-xs whitespace-nowrap text-tertiary">
            {width}px{scale < 1 ? ` · shown at ${Math.round(scale * 100)}%` : ""}
          </span>
        </div>
        <div ref={stageRef} className="relative min-h-0 overflow-hidden">
          <div className="absolute top-4 left-1/2" style={{ width: width * scale, height: stage.h, marginLeft: -(width * scale) / 2 }}>
            <div className="absolute top-0 left-0 origin-top-left overflow-hidden rounded-xl bg-white shadow-xl" style={{ width, height: Math.max(200, stage.h / scale), transform: `scale(${scale})` }}>
              <iframe ref={frameRef} src={src} title="Blog preview" className="block h-full w-full border-0" onLoad={pushDesign} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
