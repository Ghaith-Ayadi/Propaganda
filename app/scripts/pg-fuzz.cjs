// Theme fuzzer: random themes across the whole Theme API v1, including values
// outside the allowed ranges and colours that can't be read.
//
//   node scripts/pg-fuzz.cjs compiler [count]          compile N random themes; check the guarantees
//   node scripts/pg-fuzz.cjs themes <count> <out.json> write N random themes for pg-harness.cjs
//
// The claim under test: any theme written in the format, however odd, compiles to
// tokens that keep text readable, and renders without breaking any template.
"use strict";
const path = require("path");

/** src/blog/theme/compile.ts, bundled on the fly (esbuild comes with Vite). */
function loadCompiler() {
  const { outputFiles } = require("esbuild").buildSync({
    entryPoints: [path.join(__dirname, "../src/blog/theme/compile.ts")],
    bundle: true, format: "cjs", platform: "node", write: false,
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }
const FONTS = ["Crimson Pro", "Epilogue", "Public Sans", "JetBrains Mono", "Red Hat Display", "Azeret Mono", "Sora", "Lora", "Plus Jakarta Sans", "system", "Comic Sans"];

function randomTheme(i) {
  const r = rng(1000 + i * 7919);
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const num = (lo, hi, wild = 0.12) => (r() < wild ? lo - (hi - lo) * r() * 0.8 + (r() < 0.5 ? 0 : (hi - lo) * 1.8) : lo + (hi - lo) * r());
  const hex = () => "#" + [0, 0, 0].map(() => Math.floor(r() * 256).toString(16).padStart(2, "0")).join("");
  const light = () => "#" + [0, 0, 0].map(() => Math.floor(215 + r() * 40).toString(16).padStart(2, "0")).join("");
  const dark = () => "#" + [0, 0, 0].map(() => Math.floor(r() * (r() < 0.2 ? 160 : 70)).toString(16).padStart(2, "0")).join("");
  return {
    api: 1, id: `fuzz${i}`, name: `Fuzz ${i}`, version: "0.0.1",
    fonts: { display: pick(FONTS), text: pick(FONTS), ui: pick(FONTS), mono: pick(["JetBrains Mono", "Azeret Mono", "system"]) },
    color: { paper: r() < 0.08 ? hex() : light(), ink: dark(), accent: hex(), ...(r() < 0.3 ? { highlight: hex() } : {}) },
    type: {
      text: { size: [num(15, 19), num(16, 22)], leading: num(1.4, 1.8), weight: pick([300, 400, 450]) },
      scale: [num(1.1, 1.25), num(1.125, 1.414)], figures: pick(["oldstyle", "lining"]),
      display: { weight: Math.round(num(200, 900)), leading: num(0.95, 1.3), tracking: num(-0.05, 0.02) },
      title: { weight: Math.round(num(300, 900)), font: pick(["display", "text", "ui"]), tracking: num(-0.05, 0.02) },
      dek: { font: pick(["display", "text", "ui"]), style: pick(["normal", "italic"]) },
      brand: { font: pick(["display", "text", "ui", "mono"]), weight: Math.round(num(300, 900)), style: pick(["normal", "italic"]), case: pick(["none", "upper"]), tracking: num(-0.05, 0.02) },
      label: { font: pick(["display", "text", "ui", "mono"]), case: pick(["upper", "smallcaps", "none"]), tracking: num(0, 0.2), weight: Math.round(num(300, 800)), color: pick(["accent", "muted", "ink"]), step: pick([-1, 0, -3]) },
      meta: { font: pick(["display", "text", "ui", "mono"]), style: pick(["normal", "italic"]), case: pick(["none", "upper"]), step: pick([-1, 0, 1]) },
      nav: { font: pick(["display", "text", "ui", "mono"]), case: pick(["none", "upper"]), step: pick([-1, 0, 1]), weight: Math.round(num(300, 800)) },
      section: { font: pick(["display", "label"]) },
      roles: { brand: pick([0, 1, 3, 5, 9]), manifesto: pick([1, 3, 4, 6, 12]), postTitle: pick([3, 4, 5, 6, 0]), collTitle: pick([2, 4, 6]), cardTitle: pick([0, 1, 2, 3, 7]), indexTitle: pick([0, 1, 2]), leadTitle: pick([2, 3, 5]), dek: pick([0, 1, 2]), section: pick([-1, 0, 2, 3]) },
    },
    space: { unit: pick([3, 4, 5, 6, 8, 12]), density: num(0.8, 1.3), row: pick([2, 3, 4, 5]) },
    shape: { radius: num(0, 16), imageRadius: num(0, 16), avatar: pick(["circle", "square"]), rule: pick(["solid", "dotted", "dashed", "wavy"]), ruleWidth: num(1, 3), leader: pick(["none", "dotted", "rule"]), headerRule: pick(["none", "thin", "strong", "thick"]), footerRule: pick(["none", "thin", "strong", "thick"]), card: pick(["plain", "surface", "outline"]) },
    layout: { container: num(880, 1400), measure: num(52, 78), margin: pick([0, 0, 120, 168, 220, 400]), wide: pick([80, 128, 200]), header: pick(["stacked", "inline", "rail", "sidebar"]), headerAlign: pick(["start", "center"]), rail: num(180, 300), footer: pick(["minimal", "columns"]), gridMin: num(200, 360), imageRatio: pick(["3 / 2", "4 / 3", "1 / 1", "16 / 9"]), coverRatio: pick(["4 / 5", "2 / 3", "1 / 1"]), leadRatio: pick(["16 / 10", "3 / 2", "21 / 9"]) },
    prose: { paragraph: pick(["space", "indent"]), ornament: pick(["¶", "§", "* * *", "· · ·", "—", "rule", "⁂"]), quote: pick(["accent", "strong", "none"]), quoteItalic: r() < 0.5, link: pick(["underline", "accent", "marker"]), caption: pick(["start", "center"]) },
    images: { filter: pick(["none", "soft", "mono"]) },
    format: { date: pick(["long", "medium", "iso"]), readTime: pick(["long", "short", "min"]), number: pick(["No. {n}", "#{n}", "{n:03}"]) },
    presets: {},
  };
}

const [, , mode, countArg, out] = process.argv;
if (mode === "compiler") {
  const E = loadCompiler();
  const N = +(countArg || 2000);
  let failures = 0, fixes = 0, errors = 0, warns = 0;
  for (let i = 0; i < N; i++) {
    const t = randomTheme(i);
    let c;
    try { c = E.compileTheme(t); } catch (e) { failures++; console.log(`theme ${i}: compiler threw ${e.message}`); continue; }
    const p = c.palette;
    const grounds = [p.paper, p.surface, E.mix(p.accent, p.paper, 0.1)];
    const worst = (x) => Math.min(...grounds.map((g) => E.contrast(x, g)));
    const bad = [];
    if (E.contrast(p.ink, p.paper) < 7) bad.push("ink");
    if (worst(p.muted) < 4.5) bad.push("muted");
    if (worst(p.ink2) < 4.5) bad.push("ink-2");
    if (worst(p.accentText) < 4.5) bad.push("accent text");
    if (E.contrast(p.ink, p.highlight) < 7) bad.push("highlight");
    // body text never below 15px, no step below 12px (the smallest size a rem value can take)
    const minPx = (v) => Math.min(...[...String(v).matchAll(/([\d.]+)rem(?!\s*\+)/g)].map((m) => +m[1] * 16));
    if (minPx(c.vars["--pg-step-0"]) < 15 - 0.01) bad.push(`body text ${minPx(c.vars["--pg-step-0"])}px`);
    for (let n = -2; n <= 6; n++) if (minPx(c.vars[`--pg-step-${n}`]) < 12 - 0.01) bad.push(`step ${n} ${minPx(c.vars[`--pg-step-${n}`])}px`);
    for (const [k, v] of Object.entries(c.vars)) if (v == null || String(v).includes("NaN") || String(v).includes("undefined")) bad.push(k);
    if (bad.length) { failures++; console.log(`theme ${i}: ${bad.join(", ")}`); }
    for (const x of c.report) { if (x.level === "fix") fixes++; else if (x.level === "error") errors++; else warns++; }
  }
  console.log(`${N} random themes compiled: ${failures} broke a guarantee; the compiler fixed ${fixes} colours, clamped ${warns} values, rejected ${errors} inputs`);
  process.exit(failures ? 1 : 0);
} else if (mode === "themes") {
  const N = +(countArg || 12);
  require("fs").writeFileSync(out, JSON.stringify(Array.from({ length: N }, (_, i) => randomTheme(i)), null, 1));
  console.log(`wrote ${N} themes to ${out}`);
}
