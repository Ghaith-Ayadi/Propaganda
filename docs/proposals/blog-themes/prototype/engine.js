/* Propaganda blog templates: prototype engine.
   Theme compiler, options schema, view models, components, templates.
   Pure functions of (fixture, theme, design options, route) -> HTML string,
   so the same code runs in the prototype, in the conformance harness, and
   (ported to React) in app/src/blog. */
(function (global) {
  "use strict";

  /* ------------------------------------------------------------------ utils */
  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESC[c]);
  const at = (name, v) => (v == null || v === false ? "" : v === true ? ` ${name}` : ` ${name}="${esc(v)}"`);
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const round = (x, n = 3) => Math.round(x * 10 ** n) / 10 ** n;

  /* ---------------------------------------------------------- colour maths */
  function hexToRgb(h) {
    h = String(h).trim().replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const toHex = (rgb) => "#" + rgb.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("");
  const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const unlin = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  function luminance(hex) { const [r, g, b] = hexToRgb(hex).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
  function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function oklab(hex) {
    const [r, g, b] = hexToRgb(hex).map(lin);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  }
  function fromOklab([L, a, b]) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return toHex([4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map(unlin));
  }
  /** t = share of `a` (like CSS color-mix(in oklab, a t%, b)). */
  function mix(a, b, t) { const A = oklab(a), B = oklab(b); return fromOklab(A.map((v, i) => v * t + B[i] * (1 - t))); }
  /** Smallest share of `a` in mix(a, b) whose result passes `ok`, or null. */
  function seek(a, b, ok) {
    if (!ok(mix(a, b, 1))) return null;
    let lo = 0, hi = 1;
    for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (ok(mix(a, b, m))) hi = m; else lo = m; }
    return mix(a, b, hi);
  }

  /* ------------------------------------------------------------ Theme API v1
     The source format a theme is written in (built-in themes here; custom
     themes from the Part 2 skill). Every field is typed and ranged; the
     compiler clamps what is out of range and reports it. */
  const FONT_STACKS = {
    "Crimson Pro": '"Crimson Pro", "Iowan Old Style", "Palatino Linotype", Georgia, serif',
    "Epilogue": 'Epilogue, "Helvetica Neue", Arial, system-ui, sans-serif',
    "Public Sans": '"Public Sans", "Helvetica Neue", Arial, system-ui, sans-serif',
    "JetBrains Mono": '"JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
    "Red Hat Display": '"Red Hat Display", "Helvetica Neue", Arial, system-ui, sans-serif',
    "Azeret Mono": '"Azeret Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
    "Sora": 'Sora, "Helvetica Neue", Arial, system-ui, sans-serif',
    "Lora": 'Lora, Georgia, "Times New Roman", serif',
    "Plus Jakarta Sans": '"Plus Jakarta Sans", "Helvetica Neue", Arial, system-ui, sans-serif',
    system: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
  };
  /* Average advance of running English text, in em, measured from the font files. CSS `ch` (the
     width of "0") is not font-independent: Crimson Pro's average character is 0.68 of its "0". */
  const FONT_METRICS = { "Crimson Pro": 0.387, "Epilogue": 0.484, "Public Sans": 0.442, "JetBrains Mono": 0.6, "Red Hat Display": 0.427, "Azeret Mono": 0.65, "Sora": 0.489, "Lora": 0.455, "Plus Jakarta Sans": 0.452, system: 0.6 };

  /* Characters the shipped font files contain (U+0000-017F plus punctuation).
     An ornament outside this set would fall back to a system font. */
  const ORNAMENTS = { "¶": "¶", "§": "§", "* * *": "* * *", "· · ·": "· · ·", "—": "—", "rule": "" };

  const RANGES = {
    textMin: [15, 19], textMax: [16, 22], ratioMin: [1.1, 1.25], ratioMax: [1.125, 1.414], leading: [1.4, 1.8],
    displayLeading: [0.95, 1.3], displayWeight: [200, 900], titleWeight: [300, 900], tracking: [-0.05, 0.02],
    labelTracking: [0, 0.2], capsTracking: [0, 0.25], weight: [100, 900], unit: [3, 8], container: [880, 1400], measure: [52, 78], margin: [0, 220], rail: [180, 300],
    gridMin: [200, 360], radius: [0, 16], ruleWidth: [1, 3], density: [0.8, 1.3], step: [-1, 6],
  };

  function compileTheme(src) {
    const report = [];
    const note = (level, msg) => report.push({ level, msg });
    const num = (v, key, fallback) => {
      const [lo, hi] = RANGES[key];
      let x = Number(v);
      if (!Number.isFinite(x)) { note("warn", `${key}: not a number, used ${fallback}`); return fallback; }
      if (x < lo || x > hi) { const c = clamp(x, lo, hi); note("warn", `${key}: ${x} is outside ${lo}–${hi}, clamped to ${c}`); x = c; }
      return x;
    };
    const t = src.type || {}, c = src.color || {}, l = src.layout || {}, sh = src.shape || {}, p = src.prose || {};
    const vars = {};
    const V = (k, v) => { vars[`--pg-${k}`] = v; };

    /* colour: three inputs, everything else derived with contrast guarantees */
    let paper = hexToRgb(c.paper) ? c.paper : "#ffffff";
    let ink = hexToRgb(c.ink) ? c.ink : "#161616";
    let accent = hexToRgb(c.accent) ? c.accent : ink;
    if (luminance(paper) < 0.6) { note("error", "paper: light themes only in v1; paper must be light"); paper = "#ffffff"; }
    if (contrast(ink, paper) < 7) {
      const fixed = seek("#000000", ink, (x) => contrast(x, paper) >= 7) || "#000000";
      note("fix", `ink ${ink} is ${round(contrast(ink, paper), 2)}:1 on paper; darkened to ${fixed}`);
      ink = fixed;
    }
    const rule = mix(ink, paper, 0.14);
    const surface = mix(ink, paper, 0.05);
    const placeholder = mix(accent, paper, 0.1);
    const grounds = [paper, surface, placeholder];          // every background text can sit on
    const readable = (x, min) => grounds.every((g) => contrast(x, g) >= min);
    const muted = seek(ink, paper, (x) => readable(x, 4.6)) || ink;
    const ink2 = seek(ink, paper, (x) => readable(x, 8)) || ink;
    let accentText = accent;
    if (!readable(accent, 4.6)) {
      accentText = seek(ink, accent, (x) => readable(x, 4.6)) || ink;
      note("fix", `accent ${accent} is ${round(contrast(accent, paper), 2)}:1 on paper; accent text uses ${accentText}`);
    }
    const onAccent = contrast(paper, accent) >= contrast(ink, accent) ? paper : ink;
    let highlight = hexToRgb(c.highlight) ? c.highlight : mix(accent, paper, 0.22);
    if (contrast(ink, highlight) < 7) highlight = seek(paper, highlight, (x) => contrast(ink, x) >= 7) || paper;
    Object.assign(vars, {
      "--pg-paper": paper, "--pg-ink": ink, "--pg-accent": accent, "--pg-ink-2": ink2, "--pg-muted": muted,
      "--pg-rule": rule, "--pg-rule-strong": ink, "--pg-surface": surface, "--pg-accent-text": accentText,
      "--pg-on-accent": onAccent, "--pg-highlight": highlight, "--pg-focus": accentText,
      "--pg-placeholder-bg": placeholder,
    });
    const palette = { paper, ink, ink2, muted, rule, surface, accent, accentText, onAccent, highlight };

    /* fonts: roles point at families; a family must be a shipped OFL font */
    const fonts = src.fonts || {};
    const stack = (name) => {
      if (FONT_STACKS[name]) return FONT_STACKS[name];
      note("error", `font "${name}" is not in the font library; used the system stack`);
      return FONT_STACKS.system;
    };
    const role = { display: stack(fonts.display), text: stack(fonts.text || fonts.display), ui: stack(fonts.ui || fonts.text), mono: stack(fonts.mono || "system") };
    V("font-display", role.display); V("font-text", role.text); V("font-ui", role.ui); V("font-mono", role.mono);
    const fontRef = (r) => ({ display: "var(--pg-font-display)", text: "var(--pg-font-text)", ui: "var(--pg-font-ui)", mono: "var(--pg-font-mono)" }[r] || "var(--pg-font-ui)");

    /* type scale: two base sizes and two ratios -> fluid steps -2..6 (rem, so text zoom works) */
    const textFont = FONT_STACKS[fonts.text || fonts.display] ? fonts.text || fonts.display : "system";
    const avgChar = FONT_METRICS[textFont] || 0.5;
    let tMin = num(t.text?.size?.[0] ?? 17, "textMin", 17);
    // real line breaking wastes 10-20% of a line, so the arithmetic aims above the targets
    const phoneCap = Math.floor((288 / (36 * avgChar)) * 4) / 4;
    if (tMin > phoneCap) { note("fix", `text size ${round(tMin, 2)}px leaves too few characters a line on a 320px phone in ${textFont}; used ${phoneCap}px`); tMin = phoneCap; }
    const tMax = num(t.text?.size?.[1] ?? 19, "textMax", 19);
    const rMin = num(t.scale?.[0] ?? 1.2, "ratioMin", 1.2);
    const rMax = num(t.scale?.[1] ?? 1.25, "ratioMax", 1.25);
    const steps = {};
    for (let n = -2; n <= 6; n++) {
      let lo = tMin * rMin ** n, hi = Math.max(tMin, tMax) * rMax ** n;
      if (n < 0) { lo = Math.max(lo, 12); hi = Math.max(hi, 12); }
      const slope = (hi - lo) / (1280 - 360), base = lo - slope * 360;
      const rem = (px) => `${round(px / 16, 4)}rem`;
      steps[n] = Math.abs(hi - lo) < 0.25 ? rem(lo) : `clamp(${rem(Math.min(lo, hi))}, ${rem(base)} + ${round(slope * 100, 4)}vw, ${rem(Math.max(lo, hi))})`;
      V(`step-${n}`, steps[n]);
      steps[`px${n}`] = [round(lo, 1), round(hi, 1)];
    }
    const stepRef = (n, lo = -1, hi = 6) => `var(--pg-step-${clamp(Math.round(n), lo, hi)})`;
    const roles = Object.assign({ brand: 1, manifesto: 4, postTitle: 5, collTitle: 4, cardTitle: 1, indexTitle: 0, leadTitle: 3, dek: 1, section: -1 }, t.roles || {});
    V("size-brand", stepRef(roles.brand, 0, 5)); V("size-manifesto", stepRef(roles.manifesto, 1, 6));
    V("size-post-title", stepRef(roles.postTitle, 3, 6)); V("size-coll-title", stepRef(roles.collTitle, 2, 6));
    V("size-card-title", stepRef(roles.cardTitle, 0, 3)); V("size-index-title", stepRef(roles.indexTitle, 0, 2));
    V("size-lead-title", stepRef(roles.leadTitle, 2, 5)); V("size-dek", stepRef(roles.dek, 0, 2)); V("size-section", stepRef(roles.section, -1, 3));
    V("leading-text", num(t.text?.leading ?? 1.6, "leading", 1.6));
    V("leading-display", num(t.display?.leading ?? 1.1, "displayLeading", 1.1));
    V("leading-tight", round(Math.min(1.3, Math.max(1.12, (t.display?.leading ?? 1.1) + 0.12)), 2));
    V("weight-text", num(t.text?.weight ?? 400, "weight", 400));
    V("weight-display", num(t.display?.weight ?? 600, "displayWeight", 600));
    V("weight-title", num(t.title?.weight ?? 600, "titleWeight", 600));
    V("weight-strong", num(t.text?.strong ?? 650, "weight", 650));
    V("tracking-display", `${num(t.display?.tracking ?? -0.01, "tracking", -0.01)}em`);
    V("tracking-title", `${num(t.title?.tracking ?? 0, "tracking", 0)}em`);
    V("figures", t.figures === "oldstyle" ? "oldstyle-nums proportional-nums" : "lining-nums");
    V("title-font", fontRef(t.title?.font || "display"));
    V("dek-font", fontRef(t.dek?.font || "text")); V("dek-style", t.dek?.style === "italic" ? "italic" : "normal");
    const caseOf = (x) => (x === "upper" ? "uppercase" : "none");
    const b = t.brand || {};
    V("brand-font", fontRef(b.font || "display")); V("brand-weight", num(b.weight ?? 600, "weight", 600)); V("brand-style", b.style === "italic" ? "italic" : "normal");
    V("brand-case", caseOf(b.case)); V("brand-tracking", `${num(b.tracking ?? -0.01, b.case === "upper" ? "capsTracking" : "tracking", -0.01)}em`);
    const lab = t.label || {};
    V("label-font", fontRef(lab.font || "ui")); V("label-size", stepRef(lab.step ?? -1, -1, 0)); V("label-weight", num(lab.weight ?? 500, "weight", 500));
    V("label-case", lab.case === "upper" ? "uppercase" : "none"); V("label-caps", lab.case === "smallcaps" ? "all-small-caps" : "normal");
    V("label-tracking", `${num(lab.tracking ?? 0.08, "labelTracking", 0.08)}em`); V("label-style", lab.style === "italic" ? "italic" : "normal");
    V("label-color", lab.color === "accent" ? "var(--pg-accent-text)" : lab.color === "ink" ? "var(--pg-ink)" : "var(--pg-muted)");
    const me = t.meta || {};
    V("meta-font", fontRef(me.font || "ui")); V("meta-size", stepRef(me.step ?? -1, -1, 0)); V("meta-case", caseOf(me.case));
    V("meta-tracking", `${num(me.tracking ?? 0, "labelTracking", 0)}em`); V("meta-style", me.style === "italic" ? "italic" : "normal");
    V("meta-sep", JSON.stringify(me.sep || "·"));
    const nv = t.nav || {};
    V("nav-font", fontRef(nv.font || "ui")); V("nav-size", stepRef(nv.step ?? -1, -1, 1)); V("nav-case", caseOf(nv.case));
    V("nav-tracking", `${num(nv.tracking ?? 0, "labelTracking", 0)}em`); V("nav-weight", num(nv.weight ?? 500, "weight", 500));
    const se = t.section || {};
    if (se.font === "display") {
      V("section-font", "var(--pg-font-display)"); V("section-weight", "var(--pg-weight-display)"); V("section-case", "none");
      V("section-tracking", "var(--pg-tracking-display)");
    }

    /* space */
    const unit = num(src.space?.unit ?? 4, "unit", 4);
    const density = num(src.space?.density ?? 1, "density", 1);
    [1, 2, 3, 4, 6, 8, 12, 18, 28].forEach((k, i) => V(`space-${i + 1}`, `${round(unit * k * (i > 3 ? density : 1), 1)}px`));
    V("row-pad", `${round(unit * (src.space?.row ?? 4) * density, 1)}px`);

    /* shape and rules */
    const radius = num(sh.radius ?? 0, "radius", 0);
    V("radius-sm", `${Math.min(radius, 6)}px`); V("card-radius", `${radius}px`); V("image-radius", `${num(sh.imageRadius ?? 0, "radius", 0)}px`);
    V("avatar-radius", sh.avatar === "square" ? `${Math.min(radius, 6)}px` : "50%");
    const rw = num(sh.ruleWidth ?? 1, "ruleWidth", 1);
    V("rule-width", `${rw}px`); V("rule-style", ["solid", "dotted", "dashed"].includes(sh.rule) ? sh.rule : "solid");
    V("leader", sh.leader === "dotted" ? "1.5px dotted var(--pg-muted)" : sh.leader === "rule" ? "1px solid var(--pg-rule)" : "0 none transparent");
    const edge = (k) => (k === "thick" ? "3px solid var(--pg-ink)" : k === "strong" ? "1px solid var(--pg-ink)" : k === "none" ? "0 none transparent" : "1px solid var(--pg-rule)");
    V("header-rule", edge(sh.headerRule)); V("footer-rule", edge(sh.footerRule));
    const cardStyle = sh.card || "plain";
    V("card-bg", cardStyle === "surface" ? "var(--pg-surface)" : "transparent");
    V("card-border", cardStyle === "outline" ? "1px solid var(--pg-rule)" : "0 solid transparent");
    V("card-pad", cardStyle === "plain" ? "0px" : "var(--pg-space-4)");
    V("image-filter", { none: "none", mono: "grayscale(1) contrast(1.05)", soft: "saturate(0.8) contrast(0.97)" }[src.images?.filter || "none"] || "none");

    /* layout */
    V("container", `${num(l.container ?? 1120, "container", 1120)}px`);
    V("measure", `${round(num(l.measure ?? 66, "measure", 66) * avgChar * 1.15, 2)}em`);
    const margin = num(l.margin ?? 0, "margin", 0);
    V("margin", `${margin}px`); V("wide", `${margin || l.wide || 128}px`);
    V("rail", `${num(l.rail ?? 232, "rail", 232)}px`);
    V("grid-min", `${num(l.gridMin ?? 260, "gridMin", 260)}px`);
    V("image-ratio", l.imageRatio || "3 / 2"); V("cover-ratio", l.coverRatio || "4 / 5"); V("lead-ratio", l.leadRatio || "16 / 10");
    V("header-align", l.headerAlign === "center" ? "center" : "flex-start"); V("header-text-align", l.headerAlign === "center" ? "center" : "start");

    /* prose */
    if (p.paragraph === "indent") { V("para-space", "0"); V("para-indent", "1.4em"); } else { V("para-space", "1em"); V("para-indent", "0"); }
    const orn = p.ornament in ORNAMENTS ? p.ornament : (note("warn", `ornament "${p.ornament}" is not in the fonts; used "* * *"`), "* * *");
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
      "data-theme": src.id,
      "data-header": ["stacked", "inline", "rail"].includes(l.header) ? l.header : "inline",
      "data-footer": ["minimal", "columns"].includes(l.footer) ? l.footer : "minimal",
      "data-margin": margin > 0 ? "true" : "false",
    };
    const css = `.pg-site[data-theme="${src.id}"]{\n${Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`).join("\n")}\n}`;
    return { id: src.id, css, vars, attrs, palette, steps, report, presets: src.presets || {}, format: src.format || {} };
  }

  /* ------------------------------------------------------------ built-in themes */
  const THEMES = {
    rubric: {
      api: 1, id: "rubric", name: "Rubric", version: "1.0.0",
      summary: "Book typography: one serif, red rubrication, dates in the margin.",
      audience: "Essayists, memoirists, critics and fiction writers: long, finished prose.",
      fonts: { display: "Crimson Pro", text: "Crimson Pro", ui: "Crimson Pro", mono: "system" },
      color: { paper: "#FCFBF8", ink: "#1D1814", accent: "#A8261B" },
      type: {
        text: { size: [18, 21], leading: 1.55, weight: 400, strong: 650 }, scale: [1.2, 1.25], figures: "oldstyle",
        display: { weight: 300, leading: 1.06, tracking: -0.012 }, title: { weight: 500, font: "display", tracking: -0.004 },
        dek: { font: "text", style: "italic" },
        brand: { font: "display", weight: 400, tracking: -0.015 },
        label: { font: "ui", case: "upper", tracking: 0.14, weight: 500, color: "accent", step: -1 },
        meta: { font: "ui", style: "italic", step: -1 },
        nav: { font: "ui", step: 0, weight: 400, tracking: 0.005 },
        roles: { brand: 4, manifesto: 4, postTitle: 5, collTitle: 5, cardTitle: 2, indexTitle: 1, leadTitle: 4, dek: 1, section: -1 },
      },
      space: { unit: 4, density: 1.1 },
      shape: { radius: 0, imageRadius: 0, avatar: "circle", rule: "solid", headerRule: "none", footerRule: "thin", leader: "none" },
      layout: { container: 1040, measure: 64, margin: 168, header: "stacked", headerAlign: "start", footer: "minimal", gridMin: 250, imageRatio: "3 / 2" },
      prose: { paragraph: "indent", ornament: "¶", quote: "accent", quoteItalic: true, link: "underline", caption: "center" },
      images: { filter: "soft" },
      format: { date: "long", readTime: "long", number: "No. {n}" },
      presets: {
        frame: { header: { tagline: true, sticky: false }, footer: { poweredBy: true } },
        home: { intro: { variant: "manifesto", stats: false }, feed: { mode: "latest", layout: "rows", card: "summary", lead: false, group: "none", number: false, dek: true, readTime: true, collection: "auto", limit: "12" } },
        collection: { header: { variant: "banner", description: true, count: true, siblings: false }, posts: { layout: "rows", card: "summary", lead: false, group: "year", number: false, dek: true, readTime: false, collection: "auto", limit: "24" } },
        post: { header: { align: "center", dek: true, byline: true, readTime: true, number: true }, body: { dropCap: true, images: "column" }, after: { authorCard: true, details: false, nav: "inline", more: "none" } },
        author: { header: { variant: "center", avatar: true, links: true }, posts: { layout: "rows", card: "index", lead: false, group: "year", number: false, dek: false, readTime: false, collection: "show", limit: "24" } },
      },
    },
    edition: {
      api: 1, id: "edition", name: "Edition", version: "1.0.0",
      summary: "A modern magazine: big grotesque headlines, image-led grids, one ultramarine.",
      audience: "Small magazines, newsletters and multi-writer publications: many posts, images, sections.",
      fonts: { display: "Epilogue", text: "Epilogue", ui: "Epilogue", mono: "system" },
      color: { paper: "#FFFFFF", ink: "#0E0E13", accent: "#3525E6" },
      type: {
        text: { size: [16.5, 19], leading: 1.62, weight: 400, strong: 700 }, scale: [1.2, 1.333], figures: "lining",
        display: { weight: 800, leading: 0.98, tracking: -0.035 }, title: { weight: 700, font: "display", tracking: -0.018 },
        dek: { font: "text", style: "normal" },
        brand: { font: "display", weight: 800, tracking: -0.04 },
        label: { font: "ui", case: "smallcaps", tracking: 0.06, weight: 650, color: "accent", step: -1 },
        meta: { font: "ui", step: -1 },
        nav: { font: "ui", step: -1, weight: 600 },
        section: { font: "display" },
        roles: { brand: 3, manifesto: 5, postTitle: 5, collTitle: 5, cardTitle: 1, indexTitle: 1, leadTitle: 4, dek: 1, section: 2 },
      },
      space: { unit: 4, density: 1 },
      shape: { radius: 0, imageRadius: 0, avatar: "circle", rule: "solid", headerRule: "thick", footerRule: "thick", leader: "none", card: "plain" },
      layout: { container: 1240, measure: 66, margin: 0, wide: 150, header: "inline", footer: "columns", gridMin: 240, imageRatio: "4 / 3", leadRatio: "3 / 2" },
      prose: { paragraph: "space", ornament: "rule", quote: "strong", quoteItalic: false, link: "accent", caption: "start" },
      images: { filter: "none" },
      format: { date: "medium", readTime: "short", number: "#{n}" },
      presets: {
        frame: { header: { tagline: false, sticky: true }, footer: { poweredBy: true } },
        home: { intro: { variant: "compact", stats: false }, feed: { mode: "latest", layout: "grid", card: "card", columns: "3", lead: true, group: "none", number: false, dek: true, readTime: true, collection: "auto", limit: "12" } },
        collection: { header: { variant: "plain", description: true, count: true, siblings: true }, posts: { layout: "grid", card: "card", columns: "3", lead: true, group: "none", number: false, dek: true, readTime: true, collection: "auto", limit: "12" } },
        post: { header: { align: "start", width: "wide", dek: true, byline: true, readTime: true, number: false }, body: { dropCap: false, images: "wide" }, after: { authorCard: true, details: false, nav: "none", more: "3" } },
        author: { header: { variant: "split", avatar: true, links: true }, posts: { layout: "grid", card: "tile", columns: "3", lead: false, group: "none", number: false, dek: true, readTime: true, collection: "show", limit: "12" } },
      },
    },
    ledger: {
      api: 1, id: "ledger", name: "Ledger", version: "1.0.0",
      summary: "A notebook: numbered entries, ISO dates, a highlighter.",
      audience: "Working notes, reading logs and research journals: frequent short entries.",
      fonts: { display: "Public Sans", text: "Public Sans", ui: "JetBrains Mono", mono: "JetBrains Mono" },
      color: { paper: "#F4F4F0", ink: "#1C1D1F", accent: "#E9CF2B", highlight: "#F3E27A" },
      type: {
        text: { size: [16, 17], leading: 1.66, weight: 400, strong: 650 }, scale: [1.16, 1.2], figures: "lining",
        display: { weight: 650, leading: 1.14, tracking: -0.02 }, title: { weight: 600, font: "display", tracking: -0.008 },
        dek: { font: "text", style: "normal" },
        brand: { font: "ui", weight: 600, tracking: -0.01 },
        label: { font: "ui", case: "none", tracking: 0, weight: 400, color: "muted", step: -1 },
        meta: { font: "ui", step: -1 },
        nav: { font: "ui", step: -1, weight: 400 },
        roles: { brand: 0, manifesto: 2, postTitle: 4, collTitle: 3, cardTitle: 1, indexTitle: 0, leadTitle: 2, dek: 1, section: -1 },
      },
      space: { unit: 4, density: 0.9, row: 3 },
      shape: { radius: 2, imageRadius: 2, avatar: "square", rule: "solid", headerRule: "none", footerRule: "thin", leader: "dotted", card: "outline" },
      layout: { container: 1160, measure: 68, margin: 0, header: "rail", rail: 220, footer: "minimal", gridMin: 220, imageRatio: "4 / 3" },
      prose: { paragraph: "space", ornament: "§", quote: "strong", quoteItalic: false, link: "marker", caption: "start" },
      images: { filter: "mono" },
      format: { date: "iso", readTime: "min", number: "{n:03}" },
      presets: {
        frame: { header: { tagline: true, sticky: false }, footer: { poweredBy: true } },
        home: { intro: { variant: "none", stats: true }, feed: { mode: "latest", layout: "rows", card: "index", lead: false, group: "year", number: true, dek: false, readTime: false, collection: "auto", limit: "24" } },
        collection: { header: { variant: "plain", description: true, count: true, siblings: false }, posts: { layout: "rows", card: "index", lead: false, group: "year", number: true, dek: false, readTime: false, collection: "auto", limit: "24" } },
        post: { header: { align: "start", dek: true, byline: false, readTime: true, number: true }, body: { dropCap: false, images: "column" }, after: { authorCard: false, details: true, nav: "inline", more: "none" } },
        author: { header: { variant: "split", avatar: true, links: true }, posts: { layout: "rows", card: "index", lead: false, group: "year", number: true, dek: false, readTime: false, collection: "show", limit: "24" } },
      },
    },
  };

  Object.assign(THEMES, {
    manual: {
      api: 1, id: "manual", name: "Manual", version: "1.0.0",
      summary: "Technical writing: code first, clear headings, a violet accent.",
      audience: "Engineers and technical writers: postmortems, deep dives, code-heavy posts, few images.",
      fonts: { display: "Red Hat Display", text: "Red Hat Display", ui: "Azeret Mono", mono: "Azeret Mono" },
      color: { paper: "#F7F8FA", ink: "#13161B", accent: "#6D28D9" },
      type: {
        text: { size: [16, 18], leading: 1.65, weight: 400, strong: 700 }, scale: [1.18, 1.25], figures: "lining",
        display: { weight: 750, leading: 1.1, tracking: -0.022 }, title: { weight: 700, font: "display", tracking: -0.012 },
        dek: { font: "text", style: "normal" },
        brand: { font: "display", weight: 800, tracking: -0.02 },
        label: { font: "ui", case: "none", tracking: 0, weight: 500, color: "accent", step: -1 },
        meta: { font: "ui", step: -1 },
        nav: { font: "display", step: -1, weight: 600 },
        roles: { brand: 1, manifesto: 3, postTitle: 5, collTitle: 4, cardTitle: 1, indexTitle: 0, leadTitle: 3, dek: 1, section: -1 },
      },
      space: { unit: 4, density: 1 },
      shape: { radius: 6, imageRadius: 6, avatar: "square", rule: "solid", headerRule: "thin", footerRule: "thin", leader: "none", card: "outline" },
      layout: { container: 1180, measure: 72, margin: 0, wide: 120, header: "inline", footer: "columns", gridMin: 260, imageRatio: "16 / 9" },
      prose: { paragraph: "space", ornament: "rule", quote: "accent", quoteItalic: false, link: "accent", caption: "start", code: "panel", codeSize: "text" },
      images: { filter: "none" },
      format: { date: "medium", readTime: "short", number: "#{n}" },
      presets: {
        frame: { header: { tagline: true, sticky: true }, footer: { poweredBy: true } },
        home: { intro: { variant: "compact", stats: false }, feed: { mode: "latest", layout: "rows", card: "summary", lead: false, group: "none", number: false, dek: true, readTime: true, collection: "auto", limit: "12" } },
        collection: { header: { variant: "plain", description: true, count: true, siblings: true }, posts: { layout: "rows", card: "summary", lead: false, group: "year", number: false, dek: true, readTime: true, collection: "auto", limit: "24" } },
        post: { header: { align: "start", width: "content", dek: true, byline: true, readTime: true, number: false }, body: { dropCap: false, images: "wide" }, after: { authorCard: false, details: true, nav: "cards", more: "3" } },
        author: { header: { variant: "split", avatar: true, links: true }, posts: { layout: "rows", card: "index", lead: false, group: "year", number: false, dek: false, readTime: false, collection: "show", limit: "24" } },
      },
    },
    plate: {
      api: 1, id: "plate", name: "Plate", version: "1.0.0",
      summary: "A portfolio: big pictures, quiet type, captions that carry the detail.",
      audience: "Photographers, illustrators, architects and designers: the image is the post.",
      fonts: { display: "Sora", text: "Sora", ui: "Sora", mono: "system" },
      color: { paper: "#F8F8F6", ink: "#111111", accent: "#6B5C47" },
      type: {
        text: { size: [15, 17], leading: 1.65, weight: 400, strong: 600 }, scale: [1.2, 1.3], figures: "lining",
        display: { weight: 300, leading: 1.08, tracking: -0.02 }, title: { weight: 400, font: "display", tracking: -0.01 },
        dek: { font: "text", style: "normal" },
        brand: { font: "display", weight: 500, case: "upper", tracking: 0.2 },
        label: { font: "ui", case: "upper", tracking: 0.14, weight: 500, color: "muted", step: -1 },
        meta: { font: "ui", step: -1 },
        nav: { font: "ui", case: "upper", step: -1, weight: 500, tracking: 0.12 },
        roles: { brand: 0, manifesto: 3, postTitle: 5, collTitle: 4, cardTitle: 0, indexTitle: 0, leadTitle: 3, dek: 1, section: -1 },
      },
      space: { unit: 4, density: 1.15 },
      shape: { radius: 0, imageRadius: 0, avatar: "circle", rule: "solid", headerRule: "none", footerRule: "thin", leader: "none", card: "plain" },
      layout: { container: 1320, measure: 60, margin: 0, wide: 260, header: "stacked", headerAlign: "center", footer: "minimal", gridMin: 280, imageRatio: "4 / 5", coverRatio: "4 / 5", leadRatio: "3 / 2" },
      prose: { paragraph: "space", ornament: "· · ·", quote: "none", quoteItalic: false, link: "underline", caption: "center", code: "plain" },
      images: { filter: "none" },
      format: { date: "long", readTime: "short", number: "No. {n}" },
      presets: {
        frame: { header: { tagline: false, sticky: false }, footer: { poweredBy: true } },
        home: { intro: { variant: "none", stats: false }, feed: { mode: "latest", layout: "grid", card: "cover", columns: "3", lead: true, group: "none", number: false, dek: false, readTime: false, collection: "hide", limit: "12" } },
        collection: { header: { variant: "plain", description: true, count: false, siblings: true }, posts: { layout: "grid", card: "cover", columns: "3", lead: false, group: "none", number: false, dek: false, readTime: false, collection: "hide", limit: "24" } },
        post: { header: { align: "center", width: "content", dek: true, byline: false, readTime: false, number: true }, body: { dropCap: false, images: "wide" }, after: { authorCard: false, details: false, nav: "cards", more: "3" } },
        author: { header: { variant: "center", avatar: true, links: true }, posts: { layout: "grid", card: "cover", columns: "3", lead: false, group: "none", number: false, dek: false, readTime: false, collection: "hide", limit: "24" } },
      },
    },
    almanac: {
      api: 1, id: "almanac", name: "Almanac", version: "1.0.0",
      summary: "Practical and warm: rounded cards, a friendly serif, sections by season or subject.",
      audience: "Cooks, gardeners, makers and travel writers: how-tos with photos, recipes, lists.",
      fonts: { display: "Lora", text: "Plus Jakarta Sans", ui: "Plus Jakarta Sans", mono: "system" },
      color: { paper: "#F4F6EF", ink: "#1E2A22", accent: "#276B40" },
      type: {
        text: { size: [17, 18], leading: 1.7, weight: 400, strong: 700 }, scale: [1.2, 1.25], figures: "lining",
        display: { weight: 600, leading: 1.12, tracking: -0.01 }, title: { weight: 600, font: "display", tracking: -0.005 },
        dek: { font: "text", style: "normal" },
        brand: { font: "display", weight: 700, tracking: -0.01 },
        label: { font: "ui", case: "none", tracking: 0, weight: 650, color: "accent", step: -1 },
        meta: { font: "ui", step: -1 },
        nav: { font: "ui", step: -1, weight: 600 },
        section: { font: "display" },
        roles: { brand: 2, manifesto: 3, postTitle: 5, collTitle: 4, cardTitle: 1, indexTitle: 0, leadTitle: 3, dek: 1, section: 2 },
      },
      space: { unit: 4, density: 1 },
      shape: { radius: 14, imageRadius: 12, avatar: "circle", rule: "solid", headerRule: "none", footerRule: "thin", leader: "none", card: "surface" },
      layout: { container: 1200, measure: 64, margin: 0, wide: 140, header: "inline", footer: "columns", gridMin: 250, imageRatio: "4 / 3", leadRatio: "16 / 10" },
      prose: { paragraph: "space", ornament: "* * *", quote: "accent", quoteItalic: false, link: "accent", caption: "start", code: "panel" },
      images: { filter: "none" },
      format: { date: "medium", readTime: "short", number: "#{n}" },
      presets: {
        frame: { header: { tagline: false, sticky: false }, footer: { poweredBy: true } },
        home: { intro: { variant: "author", stats: false }, feed: { mode: "shelves", layout: "grid", card: "card", columns: "3", lead: false, group: "none", number: false, dek: true, readTime: true, collection: "auto", limit: "12" } },
        collection: { header: { variant: "plain", description: true, count: true, siblings: true }, posts: { layout: "grid", card: "card", columns: "3", lead: true, group: "none", number: false, dek: true, readTime: true, collection: "auto", limit: "12" } },
        post: { header: { align: "start", width: "content", dek: true, byline: true, readTime: true, number: false }, body: { dropCap: false, images: "wide" }, after: { authorCard: true, details: false, nav: "cards", more: "3" } },
        author: { header: { variant: "split", avatar: true, links: true }, posts: { layout: "grid", card: "card", columns: "3", lead: false, group: "none", number: false, dek: true, readTime: true, collection: "show", limit: "12" } },
      },
    },
  });

  /* ------------------------------------------------------------ options schema
     Per template: sections, each with typed options. Enums only (no free
     values), so every combination is enumerable and testable. `when` hides an
     option that does not apply; `values` keyed by another option makes an
     enum depend on it (PostCard configurations depend on the PostsBunch layout). */
  const bunch = (extra = {}) => ({
    layout: { type: "enum", label: "Layout", values: ["rows", "grid"], labels: { rows: "Rows", grid: "Grid" } },
    card: { type: "enum", label: "Post card", dependsOn: "layout", values: { rows: ["index", "summary", "feature"], grid: ["tile", "card", "cover"] },
      labels: { index: "Index", summary: "Summary", feature: "Feature", tile: "Tile", card: "Card", cover: "Cover" },
      hints: { index: "Title and date on one line", summary: "Title, subtitle, date", feature: "Summary with a thumbnail", tile: "Text only", card: "Image, title, subtitle", cover: "Big image, title" } },
    columns: { type: "enum", label: "Columns", values: ["auto", "2", "3"], labels: { auto: "Auto", 2: "2", 3: "3" }, when: (o) => o.layout === "grid" },
    lead: { type: "bool", label: "Feature the newest post" },
    group: { type: "enum", label: "Group by", values: ["none", "year"], labels: { none: "None", year: "Year" }, when: (o) => o.layout === "rows" },
    number: { type: "bool", label: "Post numbers" },
    dek: { type: "bool", label: "Subtitles", when: (o) => o.card !== "index" && o.card !== "cover" },
    readTime: { type: "bool", label: "Reading time" },
    collection: { type: "enum", label: "Collection name", values: ["auto", "show", "hide"], labels: { auto: "Auto", show: "Show", hide: "Hide" } },
    limit: { type: "enum", label: "Posts per page", values: ["6", "12", "24", "all"], labels: { 6: "6", 12: "12", 24: "24", all: "All" } },
    ...extra,
  });
  const SCHEMA = {
    frame: {
      header: { label: "Site header", options: { tagline: { type: "bool", label: "Tagline" }, sticky: { type: "bool", label: "Stick to the top" } } },
      footer: { label: "Footer", options: { poweredBy: { type: "bool", label: "“Published with Propaganda”" } } },
    },
    home: {
      intro: { label: "Intro", options: {
        variant: { type: "enum", label: "Style", values: ["manifesto", "compact", "author", "none"], labels: { manifesto: "Manifesto", compact: "Compact", author: "Author", none: "None" } },
        stats: { type: "bool", label: "Post and collection counts", when: (o) => o.variant !== "none" } } },
      feed: { label: "Posts", component: "PostsBunch", options: {
        mode: { type: "enum", label: "Show", values: ["latest", "shelves", "tabs"], labels: { latest: "Latest", shelves: "By collection", tabs: "Tabs" } },
        ...bunch() } },
    },
    collection: {
      header: { label: "Collection header", options: {
        variant: { type: "enum", label: "Style", values: ["plain", "banner"], labels: { plain: "Plain", banner: "Banner" } },
        description: { type: "bool", label: "Description" }, count: { type: "bool", label: "Post count" },
        siblings: { type: "bool", label: "Tabs to other collections" } } },
      posts: { label: "Posts", component: "PostsBunch", options: bunch() },
    },
    post: {
      header: { label: "Post header", options: {
        align: { type: "enum", label: "Alignment", values: ["start", "center"], labels: { start: "Left", center: "Centered" } },
        width: { type: "enum", label: "Width", values: ["content", "wide"], labels: { content: "Text width", wide: "Wide" } },
        dek: { type: "bool", label: "Subtitle" }, byline: { type: "bool", label: "Byline" },
        readTime: { type: "bool", label: "Reading time" }, number: { type: "bool", label: "Post number" } } },
      body: { label: "Body", options: {
        dropCap: { type: "bool", label: "Drop cap" },
        images: { type: "enum", label: "Images and code", values: ["column", "wide"], labels: { column: "Text width", wide: "Wide" } } } },
      after: { label: "After the post", options: {
        authorCard: { type: "bool", label: "Author card" }, details: { type: "bool", label: "Details (words, dates, link)" },
        nav: { type: "enum", label: "Previous / next", values: ["cards", "inline", "none"], labels: { cards: "Cards", inline: "Links", none: "None" } },
        more: { type: "enum", label: "More from the collection", values: ["none", "3", "6"], labels: { none: "None", 3: "3", 6: "6" } } } },
    },
    author: {
      header: { label: "Author header", options: {
        variant: { type: "enum", label: "Style", values: ["center", "split"], labels: { center: "Centered", split: "Side by side" } },
        avatar: { type: "bool", label: "Photo" }, links: { type: "bool", label: "Links" } } },
      posts: { label: "Posts", component: "PostsBunch", options: bunch() },
    },
  };
  const DEFAULTS = {
    frame: { header: { tagline: true, sticky: false }, footer: { poweredBy: true } },
    home: { intro: { variant: "compact", stats: false }, feed: { mode: "latest", layout: "rows", card: "summary", columns: "auto", lead: false, group: "none", number: false, dek: true, readTime: true, collection: "auto", limit: "12" } },
    collection: { header: { variant: "plain", description: true, count: true, siblings: false }, posts: { layout: "rows", card: "summary", columns: "auto", lead: false, group: "none", number: false, dek: true, readTime: true, collection: "auto", limit: "24" } },
    post: { header: { align: "start", width: "content", dek: true, byline: true, readTime: true, number: false }, body: { dropCap: false, images: "column" }, after: { authorCard: true, details: false, nav: "inline", more: "none" } },
    author: { header: { variant: "center", avatar: true, links: true }, posts: { layout: "rows", card: "summary", columns: "auto", lead: false, group: "year", number: false, dek: true, readTime: false, collection: "show", limit: "24" } },
  };

  function valid(spec, v, all) {
    if (spec.type === "bool") return typeof v === "boolean";
    const vals = spec.dependsOn ? spec.values[all[spec.dependsOn]] || [] : spec.values;
    return vals.includes(v);
  }
  /** defaults <- theme preset <- site overrides, field by field; invalid values are dropped, never fatal. */
  function resolveDesign(themeId, overrides = {}) {
    const theme = THEMES[themeId] || THEMES.rubric;
    const out = {};
    const dropped = [];
    for (const [tpl, sections] of Object.entries(SCHEMA)) {
      out[tpl] = {};
      for (const [sec, def] of Object.entries(sections)) {
        const merged = Object.assign({}, DEFAULTS[tpl]?.[sec], theme.presets?.[tpl]?.[sec]);
        const ov = overrides?.[tpl]?.[sec] || {};
        for (const [k, v] of Object.entries(ov)) if (k in def.options) merged[k] = v;
        for (const [k, spec] of Object.entries(def.options)) {
          if (!valid(spec, merged[k], merged)) {
            if (k in ov) dropped.push(`${tpl}.${sec}.${k}=${ov[k]}`);
            const base = Object.assign({}, DEFAULTS[tpl]?.[sec], theme.presets?.[tpl]?.[sec]);
            merged[k] = valid(spec, base[k], merged) ? base[k] : spec.type === "bool" ? false : (spec.dependsOn ? spec.values[merged[spec.dependsOn]] : spec.values)[0];
          }
        }
        out[tpl][sec] = merged;
      }
    }
    return { design: out, dropped };
  }

  /* ------------------------------------------------------------ view models */
  const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtDate(ms, style) {
    if (ms == null || !Number.isFinite(ms)) return null;
    const d = new Date(ms);
    const Y = d.getUTCFullYear(), M = d.getUTCMonth(), D = d.getUTCDate();
    if (style === "iso") return `${Y}-${String(M + 1).padStart(2, "0")}-${String(D).padStart(2, "0")}`;
    if (style === "medium") return `${MONTHS_SHORT[M]} ${D}, ${Y}`;
    return `${D} ${MONTHS_LONG[M]} ${Y}`;
  }
  function fmtRead(words, style) {
    if (!words || words <= 0) return null;
    const m = Math.max(1, Math.ceil(words / 220));
    if (style === "long") return `${m.toLocaleString("en")} ${m === 1 ? "minute" : "minutes"}`;
    if (style === "min") return `${m.toLocaleString("en")} min`;
    return `${m.toLocaleString("en")} min read`;
  }
  function fmtNumber(n, pattern) {
    if (!n) return null;
    return (pattern || "No. {n}").replace(/\{n(?::0(\d))?\}/, (_, w) => (w ? String(n).padStart(+w, "0") : String(n)));
  }
  const lenOf = (s, [a, b]) => { const n = [...String(s || "")].length; return n > b ? "xlong" : n > a ? "long" : null; };
  function initialOf(s) {
    const str = String(s || "").trim();
    if (!str) return "·";
    try { const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" }); for (const { segment } of seg.segment(str)) return segment.toUpperCase(); } catch (_) { /* old engines */ }
    return [...str][0].toUpperCase();
  }
  function buildVM(fx, compiled, route) {
    const fmt = compiled.format;
    const collections = fx.collections.map((c) => ({ ...c, count: 0, href: `#/c/${c.slug}` }));
    const byName = new Map(collections.map((c) => [c.slug, c]));
    const posts = fx.posts
      .map((p) => {
        const col = byName.get(p.collection) || { name: p.collection, slug: p.collection, emoji: null };
        const title = (p.title || "").trim() || "Untitled";
        const dek = (p.subtitle || p.excerpt || "").trim() || null;
        return {
          ...p, title, untitled: !(p.title || "").trim(), dek, col,
          titleLen: lenOf(title, [64, 120]), dekLen: lenOf(dek, [180, 360]),
          dateText: fmtDate(p.date, fmt.date), readText: fmtRead(p.words, fmt.readTime), numberText: fmtNumber(p.number, fmt.number),
          year: p.date ? new Date(p.date).getUTCFullYear() : null, href: `#/p/${p.slug}`,
        };
      })
      .sort((a, b) => (b.date ?? -Infinity) - (a.date ?? -Infinity));
    for (const p of posts) if (byName.has(p.col.slug)) byName.get(p.col.slug).count++;
    const a = fx.author || {};
    const author = { ...a, displayName: (a.name || "").trim() || fx.site.name, initial: initialOf(a.name || fx.site.name), nameLen: lenOf(a.name, [28, 60]) };
    const lastUpdate = posts.find((p) => p.date)?.date ?? null;
    return { site: { ...fx.site, nameLen: lenOf(fx.site.name, [30, 70]) }, author, collections, posts, route, fmt, lastUpdate, lastText: fmtDate(lastUpdate, fmt.date) };
  }

  /* Arrows are drawn, not typed: two of the three text faces have no arrow glyphs. */
  const ICONS = {
    left: '<path d="M15 6l-6 6 6 6"/>', right: '<path d="M9 6l6 6-6 6"/>',
    back: '<path d="M9 14l-4-4 4-4"/><path d="M5 10h9a5 5 0 0 1 0 10h-2"/>',
  };
  const Icon = (name) => `<svg class="pg-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;

  /* ------------------------------------------------------------ components
     Each returns markup with stable classes and data-part attributes: the
     styling contract. Missing data removes a part; it never leaves an empty box. */
  function Avatar(author, cls = "") {
    if (author.avatar) return `<span class="pg-avatar ${cls}" data-part="avatar"><img src="${esc(author.avatar)}" alt="" loading="lazy" data-initial="${esc(author.initial)}"></span>`;
    return `<span class="pg-avatar ${cls}" data-part="avatar" aria-hidden="true"><span>${esc(author.initial)}</span></span>`;
  }

  function SiteHeader(vm, o) {
    const cur = vm.route;
    const items = vm.collections.filter((c) => !c.hidden).map((c) => {
      const current = cur.tpl === "collection" && cur.collection === c.slug;
      return `<li><a href="${c.href}"${at("aria-current", current ? "page" : null)} title="${esc(c.name)}" dir="auto"><span class="pg-nav__label">${esc(c.name)}</span></a></li>`;
    });
    items.push(`<li><a href="#/author"${at("aria-current", cur.tpl === "author" ? "page" : null)}>About</a></li>`);
    const tagline = o.header.tagline && vm.site.tagline ? `<p class="pg-tagline" data-part="tagline" dir="auto">${esc(vm.site.tagline)}</p>` : "";
    return `<header class="pg-header" data-part="header" data-variant="${vm.frame.header}"${at("data-sticky", o.header.sticky ? "true" : null)}>
  <div class="pg-header__inner pg-container">
    <div class="pg-brand-block"><a class="pg-brand" data-part="brand" href="#/" dir="auto">${vm.site.logo ? `<img src="${esc(vm.site.logo)}" alt="">` : ""}<span>${esc(vm.site.name)}</span></a>${tagline}</div>
    <nav class="pg-nav" data-part="nav" aria-label="Collections"><ul role="list">${items.join("")}</ul></nav>
  </div>
</header>`;
  }

  function SiteFooter(vm, o) {
    const year = new Date(vm.lastUpdate || Date.UTC(2026, 8, 29)).getUTCFullYear();
    const powered = o.footer.poweredBy ? `<a href="https://propaganda.pub" data-part="powered">Published with Propaganda</a>` : "";
    if (vm.frame.footer === "columns") {
      const cols = vm.collections.slice(0, 12).map((c) => `<li><a href="${c.href}" dir="auto">${esc(c.name)}</a></li>`).join("");
      return `<footer class="pg-footer" data-part="footer" data-variant="columns"><div class="pg-footer__inner pg-container">
  <div><p class="pg-footer__name" dir="auto">${esc(vm.site.name)}</p><p>© ${year} ${esc(vm.author.displayName)}</p></div>
  <div><h2 class="pg-label">Collections</h2><ul role="list">${cols}</ul></div>
  <div><h2 class="pg-label">More</h2><ul role="list"><li><a href="#/author">About</a></li><li><a href="#/">RSS</a></li>${powered ? `<li>${powered}</li>` : ""}</ul></div>
</div></footer>`;
    }
    return `<footer class="pg-footer" data-part="footer" data-variant="minimal"><div class="pg-footer__inner pg-container">
  <p dir="auto">© ${year} ${esc(vm.site.name)}</p><ul role="list"><li><a href="#/author">About</a></li><li><a href="#/">RSS</a></li>${powered ? `<li>${powered}</li>` : ""}</ul>
</div></footer>`;
  }

  function Media(post, cls = "") {
    if (post.image) {
      const initial = initialOf(post.col.emoji || post.col.name);
      return `<div class="pg-media ${cls}" data-part="media"><img src="${esc(post.image.src)}" alt="${esc(post.image.alt || "")}" loading="lazy" data-initial="${esc(initial)}"></div>`;
    }
    return `<div class="pg-media ${cls}" data-part="media" data-placeholder aria-hidden="true"><span>${esc(initialOf(post.col.emoji || post.col.name))}</span></div>`;
  }

  function PostCard(post, o, ctx) {
    const card = o.card;
    const showCol = o.collection === "show" || (o.collection === "auto" && ctx.mixed);
    const eyebrowBits = [];
    if (showCol) eyebrowBits.push(`<a href="${post.col.href || `#/c/${post.col.slug}`}" data-part="collection" dir="auto" style="position:relative;z-index:1">${esc(post.col.name)}</a>`);
    if (o.number && post.numberText && card !== "index") eyebrowBits.push(`<span data-part="number">${esc(post.numberText)}</span>`);
    const eyebrow = eyebrowBits.length ? `<p class="pg-card__eyebrow pg-label" data-part="eyebrow">${eyebrowBits.join("")}</p>` : "";
    const hTag = `h${Math.min(6, ctx.cardLevel || 3)}`;
    const title = `<${hTag} class="pg-card__title" data-part="title"${at("data-len", post.titleLen)} dir="auto"><a href="${post.href}">${esc(post.title)}</a></${hTag}>`;
    const showDek = o.dek && post.dek && card !== "index" && card !== "cover";
    const dek = showDek ? `<p class="pg-card__dek" data-part="dek" dir="auto">${esc(post.dek)}</p>` : "";
    const metaBits = [];
    if (post.dateText) metaBits.push(`<time data-part="date"${at("datetime", post.date ? new Date(post.date).toISOString().slice(0, 10) : null)}>${esc(post.dateText)}</time>`);
    if (o.readTime && post.readText && card !== "index" && card !== "cover") metaBits.push(`<span data-part="read-time">${esc(post.readText)}</span>`);
    const meta = metaBits.length ? `<p class="pg-meta" data-part="meta">${metaBits.join("")}</p>` : "";
    const wantsMedia = card === "feature" || card === "card" || card === "cover" || (ctx.lead && o.layout === "grid" && card !== "tile");
    const media = card === "feature" ? (post.image ? Media(post) : "") : wantsMedia ? Media(post) : "";
    const hasMedia = !!media && !(card === "feature" && !post.image);
    let body;
    if (card === "index") {
      const num = o.number && post.numberText ? `<span data-part="number">${esc(post.numberText)}</span>` : "";
      body = `<div class="pg-card__body">${num}${title}<span class="pg-card__leader" aria-hidden="true"></span>${meta}</div>`;
    } else {
      body = `<div class="pg-card__body">${eyebrow}${title}${dek}${meta}</div>`;
    }
    return `<article class="pg-card" data-part="card" data-card="${card}"${at("data-has-media", hasMedia)}${at("data-has-number", !!(o.number && post.numberText))}>${card === "feature" ? body + media : media + body}</article>`;
  }

  function PostsBunch(posts, o, ctx = {}) {
    const limit = o.limit === "all" ? Infinity : Number(o.limit) + (ctx.extra || 0);
    const shown = posts.slice(0, limit);
    if (!posts.length) return `<p class="pg-empty" data-part="empty">${esc(ctx.empty || "Nothing published here yet.")}</p>`;
    const level = ctx.level || 3;
    const grouped = o.layout === "rows" && o.group === "year";
    ctx = { ...ctx, cardLevel: grouped ? level + 1 : level };
    const leadId = o.lead ? shown[0]?.id : null;
    const item = (p) => `<li${at("data-lead", p.id === leadId)}>${PostCard(p, o, { ...ctx, lead: p.id === leadId })}</li>`;
    let lists;
    if (grouped) {
      const groups = [];
      for (const p of shown) {
        const key = p.year ?? "Undated";
        let g = groups[groups.length - 1];
        if (!g || g.key !== key) groups.push((g = { key, items: [] }));
        g.items.push(p);
      }
      lists = groups.map((g) => `<div class="pg-group" data-part="group"><h${level} class="pg-group__label pg-label" data-part="group-label">${esc(g.key)}</h${level}><ol class="pg-bunch__list" role="list">${g.items.map(item).join("")}</ol></div>`).join("");
    } else {
      lists = `<ol class="pg-bunch__list" role="list">${shown.map(item).join("")}</ol>`;
    }
    const more = posts.length > shown.length ? `<div class="pg-bunch__more"><button class="pg-button" type="button" data-action="more" data-key="${esc(ctx.key || "")}">Show more <span aria-hidden="true">(${posts.length - shown.length})</span></button></div>` : "";
    return `<div class="pg-bunch" data-part="bunch" data-layout="${o.layout}" data-cols="${o.columns || "auto"}"${at("data-group", o.layout === "rows" ? o.group : null)}>${lists}${more}</div>`;
  }

  function SectionHead(title, link) {
    return `<div class="pg-section-head" data-part="section-head"><h2 dir="auto">${esc(title)}</h2>${link ? `<a href="${link.href}">${esc(link.label)}${link.icon ? Icon(link.icon) : ""}</a>` : ""}</div>`;
  }

  function Tabs(vm, currentSlug, mode) {
    const links = vm.collections.map((c) => {
      const href = mode === "home" ? `#/tab/${c.slug}` : c.href;
      return `<a href="${href}"${at("aria-current", c.slug === currentSlug ? "page" : null)} title="${esc(c.name)}" dir="auto"><span class="pg-nav__label">${esc(c.name)}</span> <span class="pg-nav__count">${c.count}</span></a>`;
    }).join("");
    return `<nav class="pg-tabs" data-part="tabs" aria-label="Collections">${links}</nav>`;
  }

  /* ------------------------------------------------------------ templates */
  function Home(vm, d, st) {
    const o = d.home;
    let intro = "";
    const iv = o.intro.variant;
    const stats = o.intro.stats ? `<p class="pg-intro__stats pg-label" data-part="stats"><span><b>${vm.posts.length}</b> posts</span><span><b>${vm.collections.length}</b> collections</span>${vm.lastText ? `<span>Updated <b>${esc(vm.lastText)}</b></span>` : ""}</p>` : "";
    if (iv === "manifesto" && vm.site.manifesto) {
      intro = `<div class="pg-container"><section class="pg-intro" data-part="intro" data-variant="manifesto"><p class="pg-intro__statement" data-part="statement"${at("data-len", lenOf(vm.site.manifesto, [150, 320]))} dir="auto">${esc(vm.site.manifesto)}</p>${stats}</section></div>`;
    } else if (iv === "compact" && (vm.site.tagline || vm.site.manifesto)) {
      intro = `<div class="pg-container"><section class="pg-intro" data-part="intro" data-variant="compact"><p class="pg-intro__statement" data-part="statement" dir="auto">${esc(vm.site.manifesto && vm.site.manifesto.length < 200 ? vm.site.manifesto : vm.site.tagline || vm.site.manifesto)}</p>${stats}</section></div>`;
    } else if (iv === "author") {
      const a = vm.author;
      intro = `<div class="pg-container"><section class="pg-intro" data-part="intro" data-variant="author"><div class="pg-intro__author">${Avatar(a)}<div><h2${at("data-len", a.nameLen)} dir="auto">${esc(a.displayName)}</h2>${a.bio ? `<p dir="auto">${esc(a.bio.split("\n")[0])}</p>` : ""}<a href="#/author">More about me${Icon("right")}</a></div></div>${stats}</section></div>`;
    } else if (stats) {
      intro = `<div class="pg-container"><section class="pg-intro" data-part="intro" data-variant="compact">${stats}</section></div>`;
    }
    const f = o.feed;
    let feed;
    if (!vm.posts.length) {
      feed = `<section class="pg-section pg-container">${PostsBunch([], f, { empty: "Nothing has been published yet. Posts appear here as soon as they are." })}</section>`;
    } else if (f.mode === "shelves") {
      feed = vm.collections.filter((c) => c.count).map((c) => {
        const ps = vm.posts.filter((p) => p.col.slug === c.slug);
        return `<section class="pg-section pg-container">${SectionHead(c.name, { href: c.href, label: `All ${c.count}`, icon: "right" })}${PostsBunch(ps, { ...f, limit: "6", lead: false }, { mixed: false, key: `shelf-${c.slug}`, extra: 0 })}</section>`;
      }).join("");
    } else if (f.mode === "tabs") {
      const withPosts = vm.collections.find((c) => c.count) || vm.collections[0];
      const slug = st.homeTab && vm.collections.some((c) => c.slug === st.homeTab) ? st.homeTab : withPosts?.slug;
      const ps = vm.posts.filter((p) => p.col.slug === slug);
      feed = `<section class="pg-section pg-container">${Tabs(vm, slug, "home")}${PostsBunch(ps, f, { mixed: false, key: `tab-${slug}`, extra: st.more?.[`tab-${slug}`] || 0, level: 2, empty: "Nothing published in this collection yet." })}</section>`;
    } else {
      feed = `<section class="pg-section pg-container">${SectionHead("Latest")}${PostsBunch(vm.posts, f, { mixed: vm.collections.length > 1, key: "latest", extra: st.more?.latest || 0 })}</section>`;
    }
    return { title: vm.site.name, main: `<h1 class="pg-sr-only">${esc(vm.site.name)}</h1>${intro}${feed}` };
  }

  function Collection(vm, d, st, slug) {
    const o = d.collection;
    const c = vm.collections.find((x) => x.slug === slug) || vm.collections[0];
    if (!c) return System("No collections yet", "This blog has no collections. Once it has one, it gets a page here.");
    const ps = vm.posts.filter((p) => p.col.slug === c.slug);
    const h = o.header;
    const count = h.count ? `<p class="pg-label" data-part="count">${c.count} ${c.count === 1 ? "post" : "posts"}</p>` : "";
    const desc = h.description && c.description ? `<p class="pg-coll-head__desc" data-part="description" dir="auto">${esc(c.description)}</p>` : "";
    const head = `<div class="pg-container"><header class="pg-coll-head" data-part="collection-header" data-variant="${h.variant}"${at("data-align", vm.frame.header === "stacked" && vm.frame.align === "center" ? "center" : null)}>${count}<h1 class="pg-coll-head__title" data-part="title"${at("data-len", lenOf(c.name, [28, 60]))} dir="auto">${esc(c.name)}</h1>${desc}</header></div>`;
    const tabs = h.siblings && vm.collections.length > 1 ? `<div class="pg-container">${Tabs(vm, c.slug, "collection")}</div>` : "";
    return { title: `${c.name} — ${vm.site.name}`, main: `${head}${tabs}<section class="pg-section pg-container">${PostsBunch(ps, o.posts, { mixed: false, key: `col-${c.slug}`, extra: st.more?.[`col-${c.slug}`] || 0, level: 2, empty: "Nothing published in this collection yet." })}</section>` };
  }

  function prose(html) {
    // What the markdown renderer guarantees: h1 in a body becomes h2; images stand alone as
    // figures; tables sit in their own scroller; every block gets dir="auto".
    return html
      .replace(/<h1(\s|>)/g, "<h2$1").replace(/<\/h1>/g, "</h2>")
      .replace(/<table>/g, '<div class="pg-table" tabindex="0" role="region" aria-label="Table"><table>').replace(/<\/table>/g, "</table></div>")
      .replace(/<(p|h2|h3|h4|li|blockquote|figcaption)>/g, '<$1 dir="auto">')
      .replace(/>↩<\/a>/g, ` class="pg-backref">${Icon("back")}<span class="pg-sr-only">Back to the text</span></a>`);
  }

  function Post(vm, d, st, slug) {
    const o = d.post;
    const post = vm.posts.find((p) => p.slug === slug) || vm.posts[0];
    if (!post) return System("Not found", "That post isn’t published, or the address is off.", true);
    const h = o.header;
    const eyebrow = `<p class="pg-post-head__eyebrow pg-label" data-part="eyebrow"><a href="#/c/${post.col.slug}" data-part="collection" dir="auto">${esc(post.col.name)}</a>${h.number && post.numberText ? `<span data-part="number">${esc(post.numberText)}</span>` : ""}</p>`;
    const dek = h.dek && post.dek ? `<p class="pg-post-head__dek" data-part="dek"${at("data-len", post.dekLen)} dir="auto">${esc(post.dek)}</p>` : "";
    const metaBits = [];
    if (post.dateText) metaBits.push(`<time data-part="date">${esc(post.dateText)}</time>`);
    if (h.readTime && post.readText) metaBits.push(`<span data-part="read-time">${esc(post.readText)}</span>`);
    const meta = metaBits.length ? `<p class="pg-meta" data-part="meta">${metaBits.join("")}</p>` : "";
    const byline = h.byline
      ? `<div class="pg-byline" data-part="byline">${Avatar(vm.author)}<div class="pg-byline__who"><span class="pg-byline__name"><a href="#/author" dir="auto">${esc(vm.author.displayName)}</a></span>${meta}</div></div>`
      : meta;
    const head = `<header class="pg-post-head" data-part="post-header" data-align="${h.align}" data-width="${h.width}">${eyebrow}<h1 class="pg-post-head__title" data-part="title"${at("data-len", post.titleLen)} dir="auto">${esc(post.title)}</h1>${dek}${byline}</header>`;
    let body = prose(post.body || `<p>${esc(post.dek || "")}</p>`);
    // "wide" lets figures and code blocks use the wide track: code lines are often longer than prose lines
    if (o.body.images === "wide") body = body.replace(/<figure>/g, '<figure data-width="wide">').replace(/<pre>/g, '<pre data-width="wide">');
    const flowBody = `<div class="pg-prose" data-part="prose"${at("data-dropcap", o.body.dropCap ? "true" : null)}>${body}</div>`;
    const a = o.after;
    const peers = vm.posts.filter((p) => p.col.slug === post.col.slug);
    const i = peers.indexOf(post);
    const older = peers[i + 1], newer = peers[i - 1];
    const parts = [];
    if (a.authorCard) {
      const au = vm.author;
      parts.push(`<section class="pg-author-card" data-part="author-card">${Avatar(au)}<div><h2 dir="auto">${esc(au.displayName)}</h2>${au.bio ? `<p dir="auto">${esc(au.bio.split("\n")[0])}</p>` : ""}<a class="pg-more" href="#/author">About the author${Icon("right")}</a></div></section>`);
    }
    if (a.details) {
      parts.push(`<dl class="pg-details" data-part="details"><dt>Filed under</dt><dd dir="auto">${esc(post.col.name)}</dd>${post.words ? `<dt>Words</dt><dd>${post.words.toLocaleString("en")}</dd>` : ""}${post.dateText ? `<dt>Published</dt><dd>${esc(post.dateText)}</dd>` : ""}<dt>Address</dt><dd>${esc(`${vm.site.host}/${post.col.slug}/${post.slug}`)}</dd></dl>`);
    }
    if (a.nav !== "none" && (older || newer)) {
      const link = (p, dir) => (p ? `<a href="${p.href}" data-dir="${dir}"><span class="pg-label">${dir === "prev" ? `${Icon("left")}Previous` : `Next${Icon("right")}`}</span><span class="pg-postnav__title" dir="auto">${esc(p.title)}</span></a>` : "<span></span>");
      parts.push(`<nav class="pg-postnav" data-part="post-nav" data-variant="${a.nav}" aria-label="More in ${esc(post.col.name)}">${link(older, "prev")}${link(newer, "next")}</nav>`);
    }
    let more = "";
    if (a.more !== "none") {
      const others = peers.filter((p) => p !== post);
      if (others.length) {
        const mOpts = { ...d.collection.posts, limit: a.more, lead: false, group: "none" };
        more = `<section class="pg-section pg-container" data-part="more">${SectionHead(`More from ${post.col.name}`, { href: `#/c/${post.col.slug}`, label: "All", icon: "right" })}${PostsBunch(others, mOpts, { mixed: false, key: "more", extra: 0 })}</section>`;
      }
    }
    const after = parts.length ? `<div class="pg-after" data-part="after">${parts.join("")}</div>` : "";
    return { title: `${post.title} — ${vm.site.name}`, main: `<article class="pg-flow" data-part="post">${head}${flowBody}${after}</article>${more}` };
  }

  function Author(vm, d, st) {
    const o = d.author;
    const a = vm.author;
    const h = o.header;
    const links = h.links && a.links?.length ? `<p class="pg-author-head__links" data-part="links">${a.links.map((l) => `<a href="${esc(l.url)}">${esc(l.label)}</a>`).join("")}</p>` : "";
    const metaBits = [];
    if (a.location) metaBits.push(`<span dir="auto">${esc(a.location)}</span>`);
    metaBits.push(`<span>${vm.posts.length} ${vm.posts.length === 1 ? "post" : "posts"}</span>`);
    const head = `<div class="pg-container"><header class="pg-author-head" data-part="author-header" data-variant="${h.variant}">${h.avatar ? Avatar(a) : ""}<div class="pg-author-head__text"><h1${at("data-len", a.nameLen)} dir="auto">${esc(a.displayName)}</h1>${a.tagline ? `<p class="pg-author-head__tagline" dir="auto">${esc(a.tagline)}</p>` : ""}<p class="pg-meta" data-part="meta">${metaBits.join("")}</p>${links}</div></header></div>`;
    const bio = a.bio ? `<div class="pg-container"><div class="pg-author-bio pg-prose" data-part="bio">${a.bio.split(/\n+/).map((pp) => `<p dir="auto">${esc(pp)}</p>`).join("")}</div></div>` : "";
    return { title: `${a.displayName} — ${vm.site.name}`, main: `${head}${bio}<section class="pg-section pg-container">${SectionHead("All posts")}${PostsBunch(vm.posts, o.posts, { mixed: vm.collections.length > 1, key: "author", extra: st.more?.author || 0, empty: "No posts yet." })}</section>` };
  }

  function System(title, text, withHome) {
    return { title, main: `<div class="pg-container"><section class="pg-system" data-part="system"><h1>${esc(title)}</h1><p>${esc(text)}</p>${withHome ? `<p><a href="#/">Go to the home page</a></p>` : ""}</section></div>` };
  }

  /** The whole page for a route: <div class="pg-site"> with the theme's frame attributes. */
  function renderSite(fx, themeId, overrides, route, st = {}) {
    const compiled = compileTheme(THEMES[themeId] || THEMES.rubric);
    const { design, dropped } = resolveDesign(themeId, overrides);
    const vm = buildVM(fx, compiled, route);
    vm.frame = { header: compiled.attrs["data-header"], footer: compiled.attrs["data-footer"], align: THEMES[themeId].layout.headerAlign };
    let page;
    if (route.tpl === "collection") page = Collection(vm, design, st, route.collection);
    else if (route.tpl === "post") page = Post(vm, design, st, route.post);
    else if (route.tpl === "author") page = Author(vm, design, st);
    else page = Home(vm, design, st);
    const attrs = Object.entries(compiled.attrs).map(([k, v]) => at(k, v)).join("") + at("data-outline", st.outline ? "true" : null);
    const html = `<div class="pg-site"${attrs} lang="${esc(fx.site.lang || "en")}">
<a class="pg-skip" href="#pg-main">Skip to content</a>
<div class="pg-page" data-header="${vm.frame.header}">
${SiteHeader(vm, design.frame)}
<main class="pg-main" id="pg-main" data-template="${route.tpl}">${page.main}</main>
${SiteFooter(vm, design.frame)}
</div></div>`;
    return { html, css: compiled.css, title: page.title, compiled, design, dropped };
  }

  global.PPGD_ENGINE = { THEMES, SCHEMA, DEFAULTS, compileTheme, resolveDesign, renderSite, contrast, mix, esc };
})(typeof window !== "undefined" ? window : globalThis);
