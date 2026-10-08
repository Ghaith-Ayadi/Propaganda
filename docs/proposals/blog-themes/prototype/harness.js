// Conformance harness for the blog templates (proposal prototype).
//
//   node harness.js <embed.html> <out-dir> [--quick]
//
// Renders every theme x template x fixture x viewport, crossed with a pairwise
// covering set of page options (plus each theme's own defaults), and checks
// invariants in the page: things that must hold for ANY theme and ANY content.
// No screenshot comparison: a custom theme is new by definition, so the checks
// are rules, not goldens. Exit code 1 when any check fails.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const [, , embedPath, outDir, flag] = process.argv;
const QUICK = process.argv.includes("--quick");
const THEME_FILE = (process.argv.find((a) => a.startsWith("--themes=")) || "").slice(9);
const EXTRA_THEMES = THEME_FILE ? JSON.parse(fs.readFileSync(THEME_FILE, "utf8")) : [];
const THEMES = EXTRA_THEMES.length ? EXTRA_THEMES.map((t) => t.id) : ["rubric", "edition", "ledger", "manual", "plate", "almanac"];
const FIXTURES = ["sample", "engineering", "photo", "kitchen", "edge", "empty"];
const TEMPLATES = ["home", "collection", "post", "author"];
const WIDTHS = QUICK ? [390, 1280] : [320, 390, 768, 1023, 1024, 1440];

/* ---------------- pairwise covering set over a template's options ---------------- */
function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }
function dimensionsFor(schema, tpl) {
  const dims = [];
  for (const [t, sections] of [[tpl, schema[tpl]], ["frame", schema.frame]]) {
    for (const [sec, def] of Object.entries(sections)) {
      const opts = def.options;
      if (opts.layout && opts.card) {
        // layout and card move together: one dimension of valid pairs
        const pairs = [];
        for (const l of opts.layout.values) for (const c of opts.card.values[l]) pairs.push(`${l}:${c}`);
        dims.push({ key: `${t}.${sec}.layout+card`, values: pairs });
      }
      for (const [k, spec] of Object.entries(opts)) {
        if (k === "layout" || k === "card") continue;
        dims.push({ key: `${t}.${sec}.${k}`, values: spec.type === "bool" ? [true, false] : spec.values });
      }
    }
  }
  return dims;
}
function pairwise(dims, seed = 7) {
  const r = rng(seed);
  const uncovered = new Set();
  const pk = (i, a, j, b) => `${i}=${a}|${j}=${b}`;
  for (let i = 0; i < dims.length; i++) for (let j = i + 1; j < dims.length; j++)
    for (const a of dims[i].values) for (const b of dims[j].values) uncovered.add(pk(i, a, j, b));
  const tests = [];
  while (uncovered.size) {
    let best = null, bestGain = -1;
    for (let attempt = 0; attempt < 30; attempt++) {
      const t = dims.map((d) => d.values[Math.floor(r() * d.values.length)]);
      // greedy fill: for each dimension pick the value covering most uncovered pairs with the others
      for (let pass = 0; pass < 2; pass++) for (let i = 0; i < dims.length; i++) {
        let bv = t[i], bg = -1;
        for (const v of dims[i].values) {
          let g = 0;
          for (let j = 0; j < dims.length; j++) if (j !== i) g += uncovered.has(i < j ? pk(i, v, j, t[j]) : pk(j, t[j], i, v)) ? 1 : 0;
          if (g > bg) { bg = g; bv = v; }
        }
        t[i] = bv;
      }
      let gain = 0;
      for (let i = 0; i < dims.length; i++) for (let j = i + 1; j < dims.length; j++) if (uncovered.has(pk(i, t[i], j, t[j]))) gain++;
      if (gain > bestGain) { bestGain = gain; best = t; }
    }
    for (let i = 0; i < dims.length; i++) for (let j = i + 1; j < dims.length; j++) uncovered.delete(pk(i, best[i], j, best[j]));
    tests.push(best);
  }
  return tests.map((t) => {
    const o = {};
    t.forEach((v, i) => {
      const parts = dims[i].key.split(".");
      const [tt, sec, k] = parts;
      o[tt] = o[tt] || {}; o[tt][sec] = o[tt][sec] || {};
      if (k === "layout+card") { const [l, c] = String(v).split(":"); o[tt][sec].layout = l; o[tt][sec].card = c; }
      else o[tt][sec][k] = v;
    });
    return o;
  });
}

/* ---------------- the in-page checks ---------------- */
function inPageChecks() {
  const out = [];
  const W = window.innerWidth;
  const site = document.querySelector(".pg-site");
  const sig = (el) => {
    const bits = [];
    for (let e = el, n = 0; e && e !== site && n < 3; e = e.parentElement, n++) {
      const part = e.getAttribute("data-part"), card = e.getAttribute("data-card");
      bits.unshift(e.tagName.toLowerCase() + (part ? `[${part}]` : "") + (card ? `{${card}}` : "") + (e.classList.length && !part ? "." + [...e.classList][0] : ""));
    }
    return bits.join(" > ");
  };
  const fail = (check, el, detail) => out.push({ check, where: el ? sig(el) : "", detail });
  // inside a box that scrolls sideways right now (decided by computed style, not by class names)
  const inScroller = (el) => { for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { if (/(auto|scroll)/.test(getComputedStyle(a).overflowX)) return true; } return false; };
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && !el.closest(".pg-sr-only, .pg-skip"); };

  // 1. the page never scrolls sideways
  const sw = document.documentElement.scrollWidth;
  if (sw > W + 1) fail("h-overflow", null, `scrollWidth ${sw} > viewport ${W}`);

  const all = [...site.querySelectorAll("*")].filter((el) => !(el instanceof SVGElement) && visible(el));
  for (const el of all) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    // 2. nothing sticks out of the viewport (scrollers excepted)
    if (!inScroller(el) && (r.right > W + 1 || r.left < -1)) {
      let L = r.left, R = r.right;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const acs = getComputedStyle(a);
        if (acs.overflowX !== "visible") { const ar = a.getBoundingClientRect(); L = Math.max(L, ar.left); R = Math.min(R, ar.right); }
      }
      if (R > W + 1 || L < -1) fail("escapes-viewport", el, `left ${Math.round(L)} right ${Math.round(R)} / ${W}`);
    }
    // 3. no text cut off unless the part is allowed to truncate (ellipsis or line clamp)
    const clips = /(hidden|clip)/.test(cs.overflowX) || /(hidden|clip)/.test(cs.overflowY);
    if (clips && !inScroller(el) && el.textContent.trim() && !el.matches(".pg-media, .pg-media *, .pg-avatar, .pg-avatar *, .pg-sr-only")) {
      const truncates = cs.textOverflow === "ellipsis" || (cs.webkitLineClamp && cs.webkitLineClamp !== "none");
      if (!truncates && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 2)) fail("clipped-text", el, `${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight}`);
    }
    // 7. minimum text size
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (hasText && parseFloat(cs.fontSize) < 12 && !el.closest("[aria-hidden='true']")) fail("min-font", el, cs.fontSize);
    // 13. no empty boxes
    if (el.hasAttribute("data-part") && !el.textContent.trim() && !el.querySelector("img, svg, span") && !el.matches(".pg-media, .pg-avatar")) fail("empty-part", el, "");
  }

  // 4. parts inside a card never overlap each other
  const overlap = (a, b) => { const x = Math.min(a.right, b.right) - Math.max(a.left, b.left), y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); return x > 1 && y > 1 ? x * y : 0; };
  for (const card of site.querySelectorAll(".pg-card, .pg-post-head, .pg-header__inner, .pg-byline, .pg-author-head, .pg-coll-head")) {
    const parts = [...card.querySelectorAll(":scope > *, :scope > .pg-card__body > *, :scope > .pg-brand-block > *, :scope > .pg-author-head__text > *")].filter((e) => visible(e) && !e.classList.contains("pg-card__body") && !e.classList.contains("pg-brand-block") && !e.classList.contains("pg-author-head__text"));
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
      const A = parts[i].getBoundingClientRect(), B = parts[j].getBoundingClientRect();
      if (parts[i].contains(parts[j]) || parts[j].contains(parts[i])) continue;
      const area = overlap(A, B);
      if (area > 4) fail("overlap", card, `${sig(parts[i])} with ${sig(parts[j])} (${Math.round(area)}px²)`);
    }
  }

  // 5. text contrast (WCAG 2.x: 4.5:1, or 3:1 for large text)
  const parse = (c) => {
    let m = c.match(/rgba?\(([^)]+)\)/);
    if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; }
    m = c.match(/color\(srgb ([^)]+)\)/);
    if (m) { const p = m[1].split(/[\s/]+/).filter(Boolean).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1]; }
    return null;
  };
  const lum = ([r, g, b]) => { const f = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const bgOf = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage !== "none" && !cs.backgroundImage.includes("gradient")) return null;
      const c = parse(cs.backgroundColor);
      if (c && c[3] > 0.95) return c;
    }
    return [255, 255, 255, 1];
  };
  for (const el of all) {
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!hasText || el.closest("[aria-hidden='true']")) continue;
    const cs = getComputedStyle(el);
    const fg = parse(cs.color), bg = bgOf(el);
    if (!fg || !bg) continue;
    let op = 1; for (let e = el; e; e = e.parentElement) op *= parseFloat(getComputedStyle(e).opacity);
    const a = fg[3] * op;
    const eff = [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a));
    const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    const got = ratio(eff, bg);
    if (got < need - 0.02) fail("contrast", el, `${got.toFixed(2)}:1 < ${need}:1 (${cs.color} on rgb(${bg.slice(0, 3).map(Math.round)}))`);
  }

  // 6. tap targets for navigation-type controls (WCAG 2.2 2.5.8: 24 x 24)
  for (const el of site.querySelectorAll(".pg-nav a, .pg-tabs a, .pg-footer a, .pg-button, .pg-postnav a, .pg-author-head__links a, .pg-section-head a")) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.height < 24 || r.width < 24) fail("tap-target", el, `${Math.round(r.width)}x${Math.round(r.height)}`);
  }

  // 8/9. document structure
  const hs = [...site.querySelectorAll("h1, h2, h3, h4, h5, h6")].filter((h) => !h.closest(".pg-footer"));
  const h1s = hs.filter((h) => h.tagName === "H1").length;
  if (h1s !== 1) fail("headings", null, `${h1s} h1 elements`);
  let prev = 0;
  for (const h of hs) { const lv = +h.tagName[1]; if (prev && lv > prev + 1) fail("headings", h, `h${prev} then h${lv}`); prev = lv; }
  for (const [sel, name] of [["header", "banner"], ["main", "main"], ["nav", "navigation"], ["footer", "contentinfo"]])
    if (!site.querySelector(sel)) fail("landmarks", null, `no ${name}`);

  // 10. images: alt present, none broken
  for (const img of site.querySelectorAll("img")) {
    if (!img.hasAttribute("alt")) fail("img-alt", img, img.src.slice(0, 40));
    if (img.complete && img.naturalWidth === 0) fail("img-broken", img, img.src.slice(0, 40));
  }

  // 11. prose line length (characters per line) on post pages
  // paragraphs with inline code are left out: monospace identifiers are content, and they wrap early by nature
  const paras = [...site.querySelectorAll(".pg-prose > p")].filter((p) => p.textContent.length > 200 && !/\S{40,}/.test(p.textContent) && !p.querySelector("code"));
  if (paras.length) {
    const cpl = paras.map((p) => { const lh = parseFloat(getComputedStyle(p).lineHeight); const lines = Math.round(p.getBoundingClientRect().height / lh); return p.textContent.length / Math.max(1, lines); }).sort((a, b) => a - b);
    const med = cpl[Math.floor(cpl.length / 2)];
    const [lo, hi] = W >= 768 ? [45, 80] : [30, 80];
    if (med < lo || med > hi) fail("measure", paras[0], `${Math.round(med)} characters per line`);
  }
  return out;
}

/* ---------------- run ---------------- */
(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const WORKERS = Math.max(1, Math.min(4, require("os").cpus().length));
  const pageErrors = [];
  const open = async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    await page.goto("file://" + path.resolve(embedPath), { waitUntil: "load" });
    if (EXTRA_THEMES.length) await page.evaluate((list) => window.PPGD.registerThemes(list), EXTRA_THEMES);
    return page;
  };
  const first = await open();
  const schema = await first.evaluate(() => {
    const S = window.PPGD.engine.SCHEMA, out = {};
    for (const [t, secs] of Object.entries(S)) { out[t] = {}; for (const [s, d] of Object.entries(secs)) { out[t][s] = { options: {} }; for (const [k, sp] of Object.entries(d.options)) out[t][s].options[k] = { type: sp.type, values: sp.values }; } }
    return out;
  });
  const combos = {};
  for (const tpl of TEMPLATES) combos[tpl] = [null, ...pairwise(dimensionsFor(schema, tpl), 11)];
  const jobs = [];
  for (const width of WIDTHS) for (const theme of THEMES) for (const fixture of FIXTURES) for (const tpl of TEMPLATES) {
    const list = QUICK ? combos[tpl].slice(0, 4) : combos[tpl];
    for (let ci = 0; ci < list.length; ci++) jobs.push({ width, theme, fixture, tpl, ci });
  }
  const results = [];
  let renders = 0, next = 0;
  const t0 = Date.now();
  const pages = [first, ...(await Promise.all(Array.from({ length: WORKERS - 1 }, open)))];
  await Promise.all(pages.map(async (page) => {
    let curW = 0;
    while (next < jobs.length) {
      const { width, theme, fixture, tpl, ci } = jobs[next++];
      if (width !== curW) { await page.setViewportSize({ width, height: 900 }); curW = width; }
      const overrides = combos[tpl][ci] || {};
      const info = await page.evaluate((st) => window.PPGD.render(st), { theme, fixture, route: { tpl }, overrides });
      await page.evaluate(() => document.fonts.ready);
      const v = await page.evaluate(inPageChecks);
      renders++;
      if (info.dropped.length) v.push({ check: "invalid-option", where: "", detail: info.dropped.join(", ") });
      for (const x of v) results.push({ ...x, theme, fixture, tpl, width, combo: ci });
    }
  }));
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  // group identical failures
  const groups = new Map();
  for (const r of results) {
    const key = `${r.check} | ${r.theme} | ${r.tpl} | ${r.where}`;
    if (!groups.has(key)) groups.set(key, { ...r, count: 0, widths: new Set(), fixtures: new Set() });
    const g = groups.get(key); g.count++; g.widths.add(r.width); g.fixtures.add(r.fixture);
  }
  const byCheck = {};
  for (const r of results) byCheck[r.check] = (byCheck[r.check] || 0) + 1;
  const summary = {
    renders, seconds: +secs, widths: WIDTHS, themes: THEMES, fixtures: FIXTURES, templates: TEMPLATES,
    combosPerTemplate: Object.fromEntries(Object.entries(combos).map(([k, v]) => [k, v.length])),
    failures: results.length, byCheck, pageErrors: [...new Set(pageErrors)],
    groups: [...groups.values()].map((g) => ({ check: g.check, theme: g.theme, tpl: g.tpl, where: g.where, detail: g.detail, count: g.count, widths: [...g.widths], fixtures: [...g.fixtures], example: { fixture: g.fixture, width: g.width, combo: g.combo, overrides: combos[g.tpl][g.combo] } })),
  };
  fs.writeFileSync(path.join(outDir, "harness-results.json"), JSON.stringify(summary, null, 1));
  console.log(`${renders} renders in ${secs}s; ${results.length} failures in ${groups.size} groups`);
  console.log(JSON.stringify(byCheck));
  for (const g of summary.groups.slice(0, 60)) console.log(`- ${g.check} [${g.theme}/${g.tpl}] ${g.where} :: ${g.detail} (x${g.count}; widths ${g.widths.join(",")}; ${g.fixtures.join(",")})`);
  if (summary.pageErrors.length) console.log("PAGE ERRORS:", summary.pageErrors.join("\n"));
  await browser.close();
  process.exit(results.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
