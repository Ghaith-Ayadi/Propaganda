// Conformance harness page, /_pg/harness (dev builds, or builds with
// VITE_PG_HARNESS=1). Renders the themed templates from fixtures, no network,
// and exposes window.PPGD for app/scripts/pg-harness.mjs, which drives it with
// Playwright: every theme x template x fixture x width, crossed with a pairwise
// covering set of page options, checked against layout invariants.

import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import "../theme/pg.css";
import { PgSite } from "../theme/Site";
import { buildVM, type PgInput, type PgLinks, type PgRoute } from "../theme/vm";
import {
  resolveDesign,
  SCHEMA,
  type Design,
  type DesignOverrides,
} from "../theme/schema";
import { compiledOf, themeCss } from "../theme/design";
import { THEMES, THEME_IDS } from "../theme/themes";
import type { ThemeSource } from "../theme/compile";
import { harnessImage } from "./paint";
import FIXTURES from "./fixtures.json";

const fixtures = FIXTURES as unknown as Record<string, PgInput>;

const links: PgLinks = {
  home: () => "#/",
  collection: (slug) => `#/c/${slug}`,
  post: (c, slug) => `#/p/${c}/${slug}`,
  author: () => "#/author",
};

interface RenderState {
  theme: string;
  fixture: string;
  route: { tpl: PgRoute["tpl"]; collection?: string; post?: string };
  overrides?: DesignOverrides;
  outline?: boolean;
}

const extra: Record<string, ThemeSource> = {};
const themeById = (id: string) => extra[id] ?? THEMES[id] ?? THEMES.rubric;

/** The schema without its functions, for the harness script. */
function plainSchema() {
  const out: Record<
    string,
    Record<
      string,
      { options: Record<string, { type: string; values?: unknown }> }
    >
  > = {};
  for (const [t, secs] of Object.entries(SCHEMA)) {
    out[t] = {};
    for (const [s, d] of Object.entries(secs)) {
      out[t][s] = { options: {} };
      for (const [k, sp] of Object.entries(d.options))
        out[t][s].options[k] = {
          type: sp.type,
          values: sp.type === "enum" ? sp.values : undefined,
        };
    }
  }
  return out;
}

declare global {
  interface Window {
    PPGD?: {
      themes: readonly string[];
      fixtures: string[];
      schema: ReturnType<typeof plainSchema>;
      registerThemes: (list: ThemeSource[]) => void;
      render: (st: RenderState) => {
        dropped: string[];
        report: { level: string; msg: string }[];
      };
    };
  }
}

export function Harness() {
  const [view, setView] = useState<{
    st: RenderState;
    design: Design;
    n: number;
  } | null>(null);

  // Exposed once mounted: a render React throws away must not hold the setter.
  useEffect(() => {
    window.PPGD = {
      themes: THEME_IDS,
      fixtures: Object.keys(fixtures),
      schema: plainSchema(),
      registerThemes: (list) => {
        for (const t of list) extra[t.id] = t;
      },
      render: (st) => {
        const theme = themeById(st.theme);
        const { design, dropped } = resolveDesign(theme, st.overrides ?? {});
        const compiled = compiledOf(theme);
        let el = document.getElementById("pg-theme") as HTMLStyleElement | null;
        if (!el) {
          el = document.createElement("style");
          el.id = "pg-theme";
          document.head.appendChild(el);
        }
        el.textContent = themeCss(compiled);
        flushSync(() => setView((v) => ({ st, design, n: (v?.n ?? 0) + 1 })));
        return { dropped, report: compiled.report };
      },
    };
  }, []);

  if (!view)
    return (
      <p style={{ padding: 24, fontFamily: "system-ui" }}>
        Harness ready: window.PPGD.render(…)
      </p>
    );
  const { st, design, n } = view;
  const theme = themeById(st.theme);
  const compiled = compiledOf(theme);
  const input = fixtures[st.fixture] ?? fixtures.sample;
  const vm = buildVM(input, compiled, links, theme.layout?.headerAlign);
  // Like the prototype: a template without a target shows the first collection with posts, the first post.
  const firstCol =
    input.collections.find((c) =>
      input.posts.some((p) => p.collection === c.slug),
    ) ?? input.collections[0];
  let route: PgRoute;
  if (st.route.tpl === "collection")
    route = {
      tpl: "collection",
      collection: st.route.collection ?? firstCol?.slug ?? "",
    };
  else if (st.route.tpl === "post")
    route = { tpl: "post", post: st.route.post ?? input.posts[0]?.slug ?? "" };
  else route = { tpl: st.route.tpl } as PgRoute;
  return (
    <div data-outline={st.outline ? "true" : undefined}>
      <PgSite
        key={n}
        vm={vm}
        design={design}
        attrs={compiled.attrs}
        route={route}
        imageSrc={harnessImage}
      />
    </div>
  );
}
