// Theme compiler (Theme API v1). A theme is data: JSON in the shape of ThemeSource.
// compileTheme() validates and clamps every field, derives the palette with
// contrast guarantees on every background text can sit on, builds a fluid type
// scale, and returns the CSS custom properties the blog stylesheet (pg.css)
// reads, plus four frame attributes for .pg-site. Nothing here is theme-specific.
//
// Built-in themes use the font library below (SIL OFL fonts, self-hosted under
// /fonts/pg/). A custom theme (site data, see lib/design.ts) may declare its own
// fonts in `fonts.custom`; they are compiled into @font-face rules for that theme.
//
// Proposal and harness: docs/proposals/blog-themes/.

/* ---------------------------------------------------------------- types */

export interface CustomFont {
  /** CSS font-family stack; defaults to the family name plus a generic fallback. */
  stack?: string;
  /** Font file URL. Omit for a font the reader's system provides. */
  src?: string;
  format?: string;
  weight?: string;
  style?: "normal" | "italic";
  /** Average character width in em, for line-length maths. Defaults to 0.5. */
  avgChar?: number;
}

export interface ThemeSource {
  api: 1;
  id: string;
  name: string;
  version?: string;
  summary?: string;
  audience?: string;
  fonts: { display: string; text?: string; ui?: string; mono?: string; custom?: Record<string, CustomFont> };
  color: { paper: string; ink: string; accent: string; highlight?: string };
  // The rest is loosely typed on purpose: the compiler checks and clamps it.
  type?: Record<string, any>;
  space?: Record<string, any>;
  shape?: Record<string, any>;
  layout?: Record<string, any>;
  prose?: Record<string, any>;
  images?: Record<string, any>;
  format?: { date?: "long" | "medium" | "iso"; readTime?: "long" | "short" | "min"; number?: string };
  /** A logo shown before the site's name; with `wordmark`, the logo is the name. */
  brand?: { logo?: string; wordmark?: boolean };
  presets?: Record<string, Record<string, Record<string, unknown>>>;
}

export interface CompileNote {
  level: "warn" | "fix" | "error";
  msg: string;
}

export interface Palette {
  paper: string; ink: string; ink2: string; muted: string; rule: string; surface: string;
  accent: string; accentText: string; onAccent: string; highlight: string;
}

export interface CompiledTheme {
  id: string;
  css: string;
  vars: Record<string, string | number>;
  attrs: { "data-theme": string; "data-header": string; "data-footer": string; "data-margin": string };
  palette: Palette;
  report: CompileNote[];
  presets: NonNullable<ThemeSource["presets"]>;
  format: NonNullable<ThemeSource["format"]>;
  logo: string | null;
  wordmark: boolean;
}

/* ---------------------------------------------------------------- colour maths */

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round = (x: number, n = 3) => Math.round(x * 10 ** n) / 10 ** n;

function hexToRgb(h: unknown): [number, number, number] | null {
  let s = String(h ?? "").trim().replace("#", "");
  if (s.length === 3) s = s.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(s)) return null;
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (rgb: number[]) => "#" + rgb.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("");
const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const unlin = (c: number) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex)!.map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function oklab(hex: string): number[] {
  const [r, g, b] = hexToRgb(hex)!.map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function fromOklab([L, a, b]: number[]): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return toHex([4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map(unlin));
}
/** t = share of `a` (like CSS color-mix(in oklab, a t%, b)). */
export function mix(a: string, b: string, t: number): string {
  const A = oklab(a), B = oklab(b);
  return fromOklab(A.map((v, i) => v * t + B[i] * (1 - t)));
}
/** Smallest share of `a` in mix(a, b) whose result passes `ok`, or null. */
function seek(a: string, b: string, ok: (c: string) => boolean): string | null {
  if (!ok(mix(a, b, 1))) return null;
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (ok(mix(a, b, m))) hi = m; else lo = m; }
  return mix(a, b, hi);
}

/* ---------------------------------------------------------------- font library */

/** The built-in fonts: SIL OFL, subset to Latin, self-hosted (public/fonts/pg, @font-face rules in pg.css). */
export const FONT_LIBRARY: Record<string, { stack: string; avgChar: number }> = {
  "Crimson Pro": { stack: '"Crimson Pro", "Iowan Old Style", "Palatino Linotype", Georgia, serif', avgChar: 0.387 },
  "Epilogue": { stack: 'Epilogue, "Helvetica Neue", Arial, system-ui, sans-serif', avgChar: 0.484 },
  "Public Sans": { stack: '"Public Sans", "Helvetica Neue", Arial, system-ui, sans-serif', avgChar: 0.442 },
  "JetBrains Mono": { stack: '"JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace', avgChar: 0.6 },
  "Red Hat Display": { stack: '"Red Hat Display", "Helvetica Neue", Arial, system-ui, sans-serif', avgChar: 0.427 },
  "Azeret Mono": { stack: '"Azeret Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace', avgChar: 0.65 },
  "Sora": { stack: 'Sora, "Helvetica Neue", Arial, system-ui, sans-serif', avgChar: 0.489 },
  "Lora": { stack: 'Lora, Georgia, "Times New Roman", serif', avgChar: 0.455 },
  "Plus Jakarta Sans": { stack: '"Plus Jakarta Sans", "Helvetica Neue", Arial, system-ui, sans-serif', avgChar: 0.452 },
  system: { stack: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace', avgChar: 0.6 },
};

/** Characters every library font contains. An ornament outside this set would fall back to a system font. */
const ORNAMENTS: Record<string, string> = { "¶": "¶", "§": "§", "* * *": "* * *", "· · ·": "· · ·", "—": "—", rule: "" };

const RANGES = {
  textMin: [15, 19], textMax: [16, 22], ratioMin: [1.1, 1.25], ratioMax: [1.125, 1.414], leading: [1.4, 1.8],
  displayLeading: [0.95, 1.3], displayWeight: [200, 900], titleWeight: [300, 900], tracking: [-0.05, 0.02],
  labelTracking: [0, 0.2], capsTracking: [0, 0.25], weight: [100, 900], unit: [3, 8], container: [880, 1400],
  measure: [52, 78], margin: [0, 220], rail: [180, 300], gridMin: [200, 360], radius: [0, 16], ruleWidth: [1, 3],
  density: [0.8, 1.3], avgChar: [0.3, 0.8],
} as const;
type RangeKey = keyof typeof RANGES;

/** Theme data reaches CSS: keep strings inside their declaration. */
const cssSafe = (s: unknown) => String(s ?? "").replace(/[{}<>;\\]/g, "").slice(0, 300);
const quoteless = (s: unknown) => cssSafe(s).replace(/["'()]/g, "");
const idSafe = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40) || "theme";

/* ---------------------------------------------------------------- compiler */

export function compileTheme(src: ThemeSource): CompiledTheme {
  const report: CompileNote[] = [];
  const note = (level: CompileNote["level"], msg: string) => report.push({ level, msg });
  const num = (v: unknown, key: RangeKey, fallback: number): number => {
    const [lo, hi] = RANGES[key];
    let x = Number(v);
    if (v == null || !Number.isFinite(x)) { if (v != null) note("warn", `${key}: not a number, used ${fallback}`); return fallback; }
    if (x < lo || x > hi) { const c = clamp(x, lo, hi); note("warn", `${key}: ${x} is outside ${lo}–${hi}, clamped to ${c}`); x = c; }
    return x;
  };
  const id = idSafe(src.id);
  const t = (src.type ?? {}) as Record<string, any>;
  const c = src.color ?? ({} as ThemeSource["color"]);
  const l = (src.layout ?? {}) as Record<string, any>;
  const sh = (src.shape ?? {}) as Record<string, any>;
  const p = (src.prose ?? {}) as Record<string, any>;
  const vars: Record<string, string | number> = {};
  const V = (k: string, v: string | number) => { vars[`--pg-${k}`] = v; };

  /* colour: three inputs, everything else derived with contrast guarantees */
  let paper = hexToRgb(c.paper) ? c.paper : "#ffffff";
  let ink = hexToRgb(c.ink) ? c.ink : "#161616";
  const accent = hexToRgb(c.accent) ? c.accent : ink;
  if (luminance(paper) < 0.6) { note("error", "paper: light themes only in v1; paper must be light"); paper = "#ffffff"; }
  if (contrast(ink, paper) < 7) {
    const fixed = seek("#000000", ink, (x) => contrast(x, paper) >= 7) ?? "#000000";
    note("fix", `ink ${ink} is ${round(contrast(ink, paper), 2)}:1 on paper; darkened to ${fixed}`);
    ink = fixed;
  }
  const rule = mix(ink, paper, 0.14);
  const surface = mix(ink, paper, 0.05);
  const placeholder = mix(accent, paper, 0.1);
  const grounds = [paper, surface, placeholder]; // every background text can sit on
  const readable = (x: string, min: number) => grounds.every((g) => contrast(x, g) >= min);
  const muted = seek(ink, paper, (x) => readable(x, 4.6)) ?? ink;
  const ink2 = seek(ink, paper, (x) => readable(x, 8)) ?? ink;
  let accentText = accent;
  if (!readable(accent, 4.6)) {
    accentText = seek(ink, accent, (x) => readable(x, 4.6)) ?? ink;
    note("fix", `accent ${accent} is ${round(contrast(accent, paper), 2)}:1 on paper; accent text uses ${accentText}`);
  }
  const onAccent = contrast(paper, accent) >= contrast(ink, accent) ? paper : ink;
  let highlight = c.highlight && hexToRgb(c.highlight) ? c.highlight : mix(accent, paper, 0.22);
  if (contrast(ink, highlight) < 7) highlight = seek(paper, highlight, (x) => contrast(ink, x) >= 7) ?? paper;
  Object.assign(vars, {
    "--pg-paper": paper, "--pg-ink": ink, "--pg-accent": accent, "--pg-ink-2": ink2, "--pg-muted": muted,
    "--pg-rule": rule, "--pg-rule-strong": ink, "--pg-surface": surface, "--pg-accent-text": accentText,
    "--pg-on-accent": onAccent, "--pg-highlight": highlight, "--pg-focus": accentText, "--pg-placeholder-bg": placeholder,
  });
  const palette: Palette = { paper, ink, ink2, muted, rule, surface, accent, accentText, onAccent, highlight };

  /* fonts: roles point at families from the library, or at the theme's own fonts */
  const fonts = src.fonts ?? ({ display: "system" } as ThemeSource["fonts"]);
  const custom = fonts.custom ?? {};
  const faces: string[] = [];
  const known = (name: string | undefined) => !!name && (name in FONT_LIBRARY || name in custom);
  const stackOf = (name: string | undefined): string => {
    if (name && FONT_LIBRARY[name]) return FONT_LIBRARY[name].stack;
    if (name && custom[name]) return cssSafe(custom[name].stack) || `"${quoteless(name)}", system-ui, sans-serif`;
    note("error", `font "${name}" is not in the font library or the theme's own fonts; used the system stack`);
    return FONT_LIBRARY.system.stack;
  };
  for (const [family, f] of Object.entries(custom)) {
    if (!f?.src) continue;
    const fmt = f.format ? ` format("${quoteless(f.format)}")` : "";
    faces.push(`@font-face{font-family:"${quoteless(family)}";src:url("${quoteless(f.src).replace(/\s/g, "%20")}")${fmt};font-weight:${cssSafe(f.weight || "100 900")};font-style:${f.style === "italic" ? "italic" : "normal"};font-display:swap}`);
  }
  V("font-display", stackOf(fonts.display)); V("font-text", stackOf(fonts.text || fonts.display));
  V("font-ui", stackOf(fonts.ui || fonts.text || fonts.display)); V("font-mono", stackOf(fonts.mono || "system"));
  const fontRef = (r: string) => ({ display: "var(--pg-font-display)", text: "var(--pg-font-text)", ui: "var(--pg-font-ui)", mono: "var(--pg-font-mono)" } as Record<string, string>)[r] ?? "var(--pg-font-ui)";

  /* type scale: two base sizes and two ratios -> fluid steps -2..6 (rem, so text zoom works) */
  const textName = known(fonts.text || fonts.display) ? (fonts.text || fonts.display)! : "system";
  const avgChar = FONT_LIBRARY[textName]?.avgChar ?? num(custom[textName]?.avgChar ?? 0.5, "avgChar", 0.5);
  let tMin = num(t.text?.size?.[0] ?? 17, "textMin", 17);
  // real line breaking wastes 10-20% of a line, so the arithmetic aims above the targets
  const phoneCap = Math.floor((288 / (38 * avgChar)) * 4) / 4;
  if (tMin > phoneCap) { note("fix", `text size ${round(tMin, 2)}px leaves too few characters a line on a 320px phone in ${textName}; used ${phoneCap}px`); tMin = phoneCap; }
  const tMax = num(t.text?.size?.[1] ?? 19, "textMax", 19);
  const rMin = num(t.scale?.[0] ?? 1.2, "ratioMin", 1.2);
  const rMax = num(t.scale?.[1] ?? 1.25, "ratioMax", 1.25);
  const rem = (px: number) => `${round(px / 16, 4)}rem`;
  for (let n = -2; n <= 6; n++) {
    let lo = tMin * rMin ** n, hi = Math.max(tMin, tMax) * rMax ** n;
    if (n < 0) { lo = Math.max(lo, 12); hi = Math.max(hi, 12); }
    const slope = (hi - lo) / (1280 - 360), base = lo - slope * 360;
    V(`step-${n}`, Math.abs(hi - lo) < 0.25 ? rem(lo) : `clamp(${rem(Math.min(lo, hi))}, ${rem(base)} + ${round(slope * 100, 4)}vw, ${rem(Math.max(lo, hi))})`);
  }
  const stepRef = (n: unknown, lo = -1, hi = 6) => `var(--pg-step-${clamp(Math.round(Number(n) || 0), lo, hi)})`;
  const roles = { brand: 1, manifesto: 4, postTitle: 5, collTitle: 4, cardTitle: 1, indexTitle: 0, leadTitle: 3, dek: 1, section: -1, ...(t.roles ?? {}) };
  V("size-brand", stepRef(roles.brand, 0, 5)); V("size-manifesto", stepRef(roles.manifesto, 1, 6));
  V("size-post-title", stepRef(roles.postTitle, 3, 6)); V("size-coll-title", stepRef(roles.collTitle, 2, 6));
  V("size-card-title", stepRef(roles.cardTitle, 0, 3)); V("size-index-title", stepRef(roles.indexTitle, 0, 2));
  V("size-lead-title", stepRef(roles.leadTitle, 2, 5)); V("size-dek", stepRef(roles.dek, 0, 2)); V("size-section", stepRef(roles.section, -1, 3));
  V("leading-text", num(t.text?.leading ?? 1.6, "leading", 1.6));
  V("leading-display", num(t.display?.leading ?? 1.1, "displayLeading", 1.1));
  V("leading-tight", round(Math.min(1.3, Math.max(1.12, (Number(t.display?.leading) || 1.1) + 0.12)), 2));
  V("weight-text", num(t.text?.weight ?? 400, "weight", 400));
  V("weight-display", num(t.display?.weight ?? 600, "displayWeight", 600));
  V("weight-title", num(t.title?.weight ?? 600, "titleWeight", 600));
  V("weight-strong", num(t.text?.strong ?? 650, "weight", 650));
  V("tracking-display", `${num(t.display?.tracking ?? -0.01, "tracking", -0.01)}em`);
  V("tracking-title", `${num(t.title?.tracking ?? 0, "tracking", 0)}em`);
  V("figures", t.figures === "oldstyle" ? "oldstyle-nums proportional-nums" : "lining-nums");
  V("title-font", fontRef(t.title?.font || "display"));
  V("dek-font", fontRef(t.dek?.font || "text")); V("dek-style", t.dek?.style === "italic" ? "italic" : "normal");
  const caseOf = (x: unknown) => (x === "upper" ? "uppercase" : "none");
  const b = t.brand ?? {};
  V("brand-font", fontRef(b.font || "display")); V("brand-weight", num(b.weight ?? 600, "weight", 600)); V("brand-style", b.style === "italic" ? "italic" : "normal");
  V("brand-case", caseOf(b.case)); V("brand-tracking", `${num(b.tracking ?? -0.01, b.case === "upper" ? "capsTracking" : "tracking", -0.01)}em`);
  const lab = t.label ?? {};
  V("label-font", fontRef(lab.font || "ui")); V("label-size", stepRef(lab.step ?? -1, -1, 0)); V("label-weight", num(lab.weight ?? 500, "weight", 500));
  V("label-case", lab.case === "upper" ? "uppercase" : "none"); V("label-caps", lab.case === "smallcaps" ? "all-small-caps" : "normal");
  V("label-tracking", `${num(lab.tracking ?? 0.08, "labelTracking", 0.08)}em`); V("label-style", lab.style === "italic" ? "italic" : "normal");
  V("label-color", lab.color === "accent" ? "var(--pg-accent-text)" : lab.color === "ink" ? "var(--pg-ink)" : "var(--pg-muted)");
  const me = t.meta ?? {};
  V("meta-font", fontRef(me.font || "ui")); V("meta-size", stepRef(me.step ?? -1, -1, 0)); V("meta-case", caseOf(me.case));
  V("meta-tracking", `${num(me.tracking ?? 0, "labelTracking", 0)}em`); V("meta-style", me.style === "italic" ? "italic" : "normal");
  V("meta-sep", JSON.stringify(cssSafe(me.sep || "·").slice(0, 3)));
  const nv = t.nav ?? {};
  V("nav-font", fontRef(nv.font || "ui")); V("nav-size", stepRef(nv.step ?? -1, -1, 1)); V("nav-case", caseOf(nv.case));
  V("nav-tracking", `${num(nv.tracking ?? 0, "labelTracking", 0)}em`); V("nav-weight", num(nv.weight ?? 500, "weight", 500));
  if (t.section?.font === "display") {
    V("section-font", "var(--pg-font-display)"); V("section-weight", "var(--pg-weight-display)"); V("section-case", "none");
    V("section-tracking", "var(--pg-tracking-display)");
  }

  /* space */
  const unit = num(src.space?.unit ?? 4, "unit", 4);
  const density = num(src.space?.density ?? 1, "density", 1);
  [1, 2, 3, 4, 6, 8, 12, 18, 28].forEach((k, i) => V(`space-${i + 1}`, `${round(unit * k * (i > 3 ? density : 1), 1)}px`));
  V("row-pad", `${round(unit * clamp(Number(src.space?.row) || 4, 2, 6) * density, 1)}px`);

  /* shape and rules */
  const radius = num(sh.radius ?? 0, "radius", 0);
  V("radius-sm", `${Math.min(radius, 6)}px`); V("card-radius", `${radius}px`); V("image-radius", `${num(sh.imageRadius ?? 0, "radius", 0)}px`);
  V("avatar-radius", sh.avatar === "square" ? `${Math.min(radius, 6)}px` : "50%");
  V("rule-width", `${num(sh.ruleWidth ?? 1, "ruleWidth", 1)}px`);
  V("rule-style", ["solid", "dotted", "dashed"].includes(sh.rule) ? sh.rule : "solid");
  V("leader", sh.leader === "dotted" ? "1.5px dotted var(--pg-muted)" : sh.leader === "rule" ? "1px solid var(--pg-rule)" : "0 none transparent");
  const edge = (k: unknown) => (k === "thick" ? "3px solid var(--pg-ink)" : k === "strong" ? "1px solid var(--pg-ink)" : k === "none" ? "0 none transparent" : "1px solid var(--pg-rule)");
  V("header-rule", edge(sh.headerRule)); V("footer-rule", edge(sh.footerRule));
  const cardStyle = sh.card || "plain";
  V("card-bg", cardStyle === "surface" ? "var(--pg-surface)" : "transparent");
  V("card-border", cardStyle === "outline" ? "1px solid var(--pg-rule)" : "0 solid transparent");
  V("card-pad", cardStyle === "surface" || cardStyle === "outline" ? "var(--pg-space-4)" : "0px");
  V("image-filter", ({ none: "none", mono: "grayscale(1) contrast(1.05)", soft: "saturate(0.8) contrast(0.97)" } as Record<string, string>)[src.images?.filter || "none"] ?? "none");

  /* layout */
  V("container", `${num(l.container ?? 1120, "container", 1120)}px`);
  V("measure", `${round(num(l.measure ?? 66, "measure", 66) * avgChar * 1.15, 2)}em`);
  const margin = num(l.margin ?? 0, "margin", 0);
  V("margin", `${margin}px`); V("wide", `${margin || clamp(Number(l.wide) || 128, 0, 320)}px`);
  V("rail", `${num(l.rail ?? 232, "rail", 232)}px`);
  V("grid-min", `${num(l.gridMin ?? 260, "gridMin", 260)}px`);
  const ratio = (v: unknown, d: string) => (typeof v === "string" && /^\d+(\.\d+)? \/ \d+(\.\d+)?$/.test(v) ? v : d);
  V("image-ratio", ratio(l.imageRatio, "3 / 2")); V("cover-ratio", ratio(l.coverRatio, "4 / 5")); V("lead-ratio", ratio(l.leadRatio, "16 / 10"));
  V("header-align", l.headerAlign === "center" ? "center" : "flex-start"); V("header-text-align", l.headerAlign === "center" ? "center" : "start");

  /* prose */
  if (p.paragraph === "indent") { V("para-space", "0"); V("para-indent", "1.4em"); } else { V("para-space", "1em"); V("para-indent", "0"); }
  let orn = "* * *";
  if (p.ornament != null) {
    if (p.ornament in ORNAMENTS) orn = p.ornament;
    else note("warn", `ornament "${p.ornament}" is not in the fonts; used "* * *"`);
  }
  V("ornament", JSON.stringify(ORNAMENTS[orn]));
  V("quote-border", p.quote === "none" ? "0 none transparent" : p.quote === "accent" ? "2px solid var(--pg-accent-text)" : "3px solid var(--pg-rule-strong)");
  V("quote-style", p.quoteItalic ? "italic" : "normal");
  if (p.link === "marker") {
    V("link-color", "var(--pg-ink)"); V("link-decoration", "transparent"); V("link-thickness", "0px");
    V("link-bg", "linear-gradient(transparent 58%, var(--pg-highlight) 58%, var(--pg-highlight) 92%, transparent 92%)");
  } else if (p.link === "accent") {
    V("link-color", "var(--pg-accent-text)"); V("link-decoration", "var(--pg-accent-text)"); V("link-thickness", "1px"); V("link-bg", "none");
  } else {
    V("link-color", "var(--pg-ink)"); V("link-decoration", "var(--pg-accent-text)"); V("link-thickness", "1px"); V("link-bg", "none");
  }
  V("caption-align", p.caption === "center" ? "center" : "start");
  const code = ["panel", "rule", "plain"].includes(p.code) ? p.code : "panel";
  V("code-bg", code === "plain" ? "transparent" : "var(--pg-surface)");
  V("code-border", code === "rule" ? "3px solid var(--pg-accent-text)" : "0 none transparent");
  V("code-frame", code === "panel" ? "1px solid var(--pg-rule)" : "0 none transparent");
  V("code-size", p.codeSize === "text" ? "0.9em" : "var(--pg-step--1)");

  const attrs = {
    "data-theme": id,
    "data-header": ["stacked", "inline", "rail"].includes(l.header) ? l.header : "inline",
    "data-footer": ["minimal", "columns"].includes(l.footer) ? l.footer : "minimal",
    "data-margin": margin > 0 ? "true" : "false",
  };
  const css = `${faces.join("\n")}\n.pg-site[data-theme="${id}"]{\n${Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`).join("\n")}\n}`;
  const logo = typeof src.brand?.logo === "string" && src.brand.logo ? quoteless(src.brand.logo) : null;
  return { id, css, vars, attrs, palette, report, presets: src.presets ?? {}, format: src.format ?? {}, logo, wordmark: !!logo && src.brand?.wordmark === true };
}
