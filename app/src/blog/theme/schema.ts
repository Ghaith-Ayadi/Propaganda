// Page options: per template, sections of typed options. Enums and booleans
// only (no free values), so every combination is enumerable and testable.
// `when` hides an option that does not apply; an enum with `dependsOn` takes
// its values from another option (the PostCard configurations depend on the
// PostsBunch layout).
//
// A site's design is { theme, overrides }; resolveDesign() merges
// DEFAULTS <- the theme's presets <- the overrides, field by field. Invalid
// values are dropped, never fatal, so an old or hand-edited design still renders.

import type { ThemeSource } from "./compile";

export type OptionValue = string | boolean;
export type Options = Record<string, OptionValue>;

export interface BoolSpec {
  type: "bool";
  label: string;
  when?: (o: Options) => boolean;
}
export interface EnumSpec {
  type: "enum";
  label: string;
  values: string[] | Record<string, string[]>;
  dependsOn?: string;
  labels: Record<string, string>;
  hints?: Record<string, string>;
  when?: (o: Options) => boolean;
}
export type OptionSpec = BoolSpec | EnumSpec;

export interface SectionSpec {
  label: string;
  component?: string;
  options: Record<string, OptionSpec>;
}

export type Template = "frame" | "home" | "collection" | "post" | "author";
export type Design = Record<Template, Record<string, Options>>;
/** What a site stores: only the fields it changed from its theme. */
export type DesignOverrides = Partial<Record<Template, Record<string, Options>>>;

const bunch = (): Record<string, OptionSpec> => ({
  layout: { type: "enum", label: "Layout", values: ["rows", "grid"], labels: { rows: "Rows", grid: "Grid" } },
  card: {
    type: "enum",
    label: "Post card",
    dependsOn: "layout",
    values: { rows: ["index", "summary", "feature"], grid: ["tile", "card", "cover"] },
    labels: { index: "Index", summary: "Summary", feature: "Feature", tile: "Tile", card: "Card", cover: "Cover" },
    hints: {
      index: "Title and date on one line",
      summary: "Title, subtitle, date",
      feature: "Summary with a thumbnail",
      tile: "Text only",
      card: "Image, title, subtitle",
      cover: "Big image, title",
    },
  },
  columns: { type: "enum", label: "Columns", values: ["auto", "2", "3"], labels: { auto: "Auto", 2: "2", 3: "3" }, when: (o) => o.layout === "grid" },
  lead: { type: "bool", label: "Feature the newest post" },
  group: { type: "enum", label: "Group by", values: ["none", "year"], labels: { none: "None", year: "Year" }, when: (o) => o.layout === "rows" },
  number: { type: "bool", label: "Post numbers" },
  dek: { type: "bool", label: "Subtitles", when: (o) => o.card !== "index" && o.card !== "cover" },
  readTime: { type: "bool", label: "Reading time" },
  collection: { type: "enum", label: "Collection name", values: ["auto", "show", "hide"], labels: { auto: "Auto", show: "Show", hide: "Hide" } },
  limit: { type: "enum", label: "Posts per page", values: ["6", "12", "24", "all"], labels: { 6: "6", 12: "12", 24: "24", all: "All" } },
});

export const SCHEMA: Record<Template, Record<string, SectionSpec>> = {
  frame: {
    header: { label: "Site header", options: { tagline: { type: "bool", label: "Tagline" }, sticky: { type: "bool", label: "Stick to the top" } } },
    footer: { label: "Footer", options: { poweredBy: { type: "bool", label: "“Published with Propaganda”" } } },
  },
  home: {
    intro: {
      label: "Intro",
      options: {
        variant: { type: "enum", label: "Style", values: ["manifesto", "compact", "author", "none"], labels: { manifesto: "Manifesto", compact: "Compact", author: "Author", none: "None" } },
        stats: { type: "bool", label: "Post and collection counts", when: (o) => o.variant !== "none" },
      },
    },
    feed: {
      label: "Posts",
      component: "PostsBunch",
      options: {
        mode: { type: "enum", label: "Show", values: ["latest", "shelves", "tabs"], labels: { latest: "Latest", shelves: "By collection", tabs: "Tabs" } },
        ...bunch(),
      },
    },
  },
  collection: {
    header: {
      label: "Collection header",
      options: {
        variant: { type: "enum", label: "Style", values: ["plain", "banner"], labels: { plain: "Plain", banner: "Banner" } },
        description: { type: "bool", label: "Description" },
        count: { type: "bool", label: "Post count" },
        siblings: { type: "bool", label: "Tabs to other collections" },
      },
    },
    posts: { label: "Posts", component: "PostsBunch", options: bunch() },
  },
  post: {
    header: {
      label: "Post header",
      options: {
        align: { type: "enum", label: "Alignment", values: ["start", "center"], labels: { start: "Left", center: "Centered" } },
        width: { type: "enum", label: "Width", values: ["content", "wide"], labels: { content: "Text width", wide: "Wide" } },
        dek: { type: "bool", label: "Subtitle" },
        byline: { type: "bool", label: "Byline" },
        readTime: { type: "bool", label: "Reading time" },
        number: { type: "bool", label: "Post number" },
      },
    },
    body: {
      label: "Body",
      options: {
        dropCap: { type: "bool", label: "Drop cap" },
        images: { type: "enum", label: "Images and code", values: ["column", "wide"], labels: { column: "Text width", wide: "Wide" } },
      },
    },
    after: {
      label: "After the post",
      options: {
        authorCard: { type: "bool", label: "Author card" },
        details: { type: "bool", label: "Details (words, dates, link)" },
        nav: { type: "enum", label: "Previous / next", values: ["cards", "inline", "none"], labels: { cards: "Cards", inline: "Links", none: "None" } },
        more: { type: "enum", label: "More from the collection", values: ["none", "3", "6"], labels: { none: "None", 3: "3", 6: "6" } },
      },
    },
  },
  author: {
    header: {
      label: "Author header",
      options: {
        variant: { type: "enum", label: "Style", values: ["center", "split"], labels: { center: "Centered", split: "Side by side" } },
        avatar: { type: "bool", label: "Photo" },
        links: { type: "bool", label: "Links" },
      },
    },
    posts: { label: "Posts", component: "PostsBunch", options: bunch() },
  },
};

export const TEMPLATES: Template[] = ["frame", "home", "collection", "post", "author"];

export const DEFAULTS: Design = {
  frame: { header: { tagline: true, sticky: false }, footer: { poweredBy: true } },
  home: {
    intro: { variant: "compact", stats: false },
    feed: { mode: "latest", layout: "rows", card: "summary", columns: "auto", lead: false, group: "none", number: false, dek: true, readTime: true, collection: "auto", limit: "12" },
  },
  collection: {
    header: { variant: "plain", description: true, count: true, siblings: false },
    posts: { layout: "rows", card: "summary", columns: "auto", lead: false, group: "none", number: false, dek: true, readTime: true, collection: "auto", limit: "24" },
  },
  post: {
    header: { align: "start", width: "content", dek: true, byline: true, readTime: true, number: false },
    body: { dropCap: false, images: "column" },
    after: { authorCard: true, details: false, nav: "inline", more: "none" },
  },
  author: {
    header: { variant: "center", avatar: true, links: true },
    posts: { layout: "rows", card: "summary", columns: "auto", lead: false, group: "year", number: false, dek: true, readTime: false, collection: "show", limit: "24" },
  },
};

/** The values an enum allows, given the other options of its section. */
export function enumValues(spec: EnumSpec, all: Options): string[] {
  if (Array.isArray(spec.values)) return spec.values;
  return spec.values[String(all[spec.dependsOn ?? ""])] ?? [];
}

function valid(spec: OptionSpec, v: unknown, all: Options): boolean {
  if (spec.type === "bool") return typeof v === "boolean";
  return typeof v === "string" && enumValues(spec, all).includes(v);
}

/** DEFAULTS <- the theme's presets, for one section: what "reset" returns to. */
export function baseOf(theme: ThemeSource | undefined, tpl: Template, sec: string): Options {
  return { ...DEFAULTS[tpl]?.[sec], ...(theme?.presets?.[tpl]?.[sec] as Options | undefined) };
}

/** defaults <- theme preset <- site overrides, field by field; invalid values are dropped, never fatal. */
export function resolveDesign(theme: ThemeSource | undefined, overrides: DesignOverrides = {}): { design: Design; dropped: string[] } {
  const out = {} as Design;
  const dropped: string[] = [];
  for (const tpl of TEMPLATES) {
    out[tpl] = {};
    for (const [sec, def] of Object.entries(SCHEMA[tpl])) {
      const base = baseOf(theme, tpl, sec);
      const merged: Options = { ...base };
      const ov = (overrides?.[tpl]?.[sec] ?? {}) as Options;
      for (const [k, v] of Object.entries(ov)) if (k in def.options) merged[k] = v;
      for (const [k, spec] of Object.entries(def.options)) {
        if (valid(spec, merged[k], merged)) continue;
        if (k in ov) dropped.push(`${tpl}.${sec}.${k}=${String(ov[k])}`);
        merged[k] = valid(spec, base[k], merged) ? base[k] : spec.type === "bool" ? false : enumValues(spec, merged)[0];
      }
      out[tpl][sec] = merged;
    }
  }
  return { design: out, dropped };
}

/** The overrides that differ from the theme: what a site stores. */
export function diffDesign(theme: ThemeSource | undefined, design: Design): DesignOverrides {
  const out: DesignOverrides = {};
  const plain = resolveDesign(theme).design;
  for (const tpl of TEMPLATES) {
    for (const sec of Object.keys(SCHEMA[tpl])) {
      const base = plain[tpl][sec];
      for (const [k, v] of Object.entries(design[tpl]?.[sec] ?? {})) {
        if (base[k] === v) continue;
        ((out[tpl] ??= {})[sec] ??= {})[k] = v;
      }
    }
  }
  return out;
}
