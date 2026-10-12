// The house style rules, before and after, on a real model: the same ideas pitched
// with the prompts of main and with the prompts of this branch, the same brief
// drafted both ways, and PPGD's own Strategist input proposed both ways. Counts how
// many titles, topic names and sentences break the title rules (titleHits) and the
// house rules (styleHits), and what each arm cost. Run by hand, never at a release:
//
//   AI_GATEWAY_API_KEY=... node test/live/style-ab.mjs        (from worker/, after npm run build)
//
// Everything runs on DeepSeek V4 Pro (dev testing, Ayadi 2026-10-11), the
// Strategist included. The "prev" prompts are in style-ab.fixtures.json, copied
// from main at the time of the change (2026-10-12, after #139); "new" is this
// branch's: the twenty rules in the prompts, then the polish call (code flags,
// one call judges, rewrites only) the agents run after a draft. Counts are
// before and after that call, and how often the judge kept a flagged word.

import { readFileSync } from "node:fs";
import { liveEnv, standInRest } from "./kit.mjs";

liveEnv("style-ab");
const SITE = "livestyle000001";
const db = { model_calls: [], model_keys: [], app_settings: [] };
// Before the gateway loads: it reads SUPABASE_URL at import.
await standInRest(db);
const t = await import("../../dist/agents/testing.js");
const fx = JSON.parse(readFileSync(new URL("./style-ab.fixtures.json", import.meta.url), "utf8"));
t.wireGateway();
const MODEL = process.env.AGENT_MODEL_BASE || "deepseek/deepseek-v4-pro";

const costOf = (from) => db.model_calls.slice(from).reduce((s, c) => s + Number(c.cost_usd ?? 0), 0);
async function json(system, prompt, maxOutputTokens = 2500) {
  const r = await t.callModel({ site: SITE, job: "style-ab", model: MODEL, background: true, system, prompt, maxOutputTokens });
  return t.extractJson(r.text);
}

// ---- the Pitcher: PPGD's ideas, in the shape its own pitches took ----

const IDEAS = [
  "What a founder without a marketing team should ask an AI content tool before paying for it",
  "Turning sales-call transcripts into the posts prospects asked for",
  "Why a blog, a newsletter and a LinkedIn feed written three times disagree with each other",
  "How many posts a month a founder reviewing alone can keep up",
  "What keywords a brand-new domain can rank for in its first quarter",
  "Using the sites you already read as the brief for this week's post",
  "AI content tools and the facts they make up about your own product",
  "Why most startup blogs stop after eight posts",
];
const COLLECTIONS = "Blog, Notes";
const CLAIMS = `- Propaganda suggests blog posts, social posts and newsletters, writes them and publishes them through its app.
- Propaganda is in beta; social posting launches this quarter.
- Every draft's facts about the tenant come from a knowledge base the tenant controls.`;

const pitchPrompt = (idea, titleSpec) => `Write the pitch for this idea as a full brief.

Idea:
[idea0000000001] ${idea}
  origin: plan
  A post for PPGD (Propaganda), the AI content team for founders without a marketing team.

Why it's worth pitching (already decided, don't argue it):
- It belongs to this quarter's first topic.

What the tenant knows (knowledge base):
${CLAIMS}

What's already ranking for it:
(no search results)

Collections on this blog: ${COLLECTIONS}.

What this tenant has decided before (learn from it; their own words win):
(nothing yet)

Answer with JSON only:
{"title": ${titleSpec}, "why": "one sentence: why this, why now", "angle": "the argument this post makes that the ranking pages don't", "audience": "who it's for and what they need", "length": "e.g. 1,000 to 1,400 words", "collection": "one of the collections", "outline": ["4 to 10 lines, each a section as a claim"], "sources": [], "learned": ""}`;

const NEW_SPEC = '"a specific, slightly provocative title: one plain statement under twelve words, by the title rules"';

// The twenty rules' counts on a set of texts: titles, hard hits, soft flags.
function counts(texts, titles = []) {
  return {
    titleHits: titles.filter((x) => t.houseTitleHits(x).length).length,
    hard: texts.reduce((n, x) => n + t.hardHits(x).length + t.styleHits(x).length, 0),
    dashes: texts.reduce((n, x) => n + (x.match(/\u2014/g) ?? []).length, 0),
    soft: texts.reduce((n, x) => n + t.softHits(x).length, 0),
  };
}

// The agents' polish step (polish.ts), outside DBOS: flag, one call, apply, no dashes.
const judged = { items: 0, kept: 0, rewritten: 0, refused: 0, calls: 0 };
async function polish(system, texts) {
  const items = t.polishItems(texts.flatMap(t.hardHits), texts.flatMap(t.softHits));
  let out = texts;
  if (items.length) {
    const r = await t.callModel({ site: SITE, job: "style-ab", model: MODEL, background: true, system, prompt: t.polishPrompt(items), maxOutputTokens: 600 + 150 * items.length, reasoning: "low" });
    let answers = [];
    try { answers = t.parsePolish(t.extractJson(r.text)); } catch { /* counted as kept */ }
    const a = t.applyPolish(texts, items, answers);
    out = a.texts;
    judged.calls++;
    for (const k of ["items", "kept", "rewritten", "refused"]) judged[k] += a.stats[k];
    for (const it of items) {
      const got = answers.find((x) => x.n === it.n);
      console.log(`  judge ${got === undefined ? "kept" : got.rewrite ? "rewrote" : "deleted"}\t${it.why.map((w) => w.split(":")[0]).join(" + ")}\t${it.sentence.slice(0, 110)}${got?.rewrite ? `\n  \t  -> ${got.rewrite.slice(0, 110)}` : ""}`);
    }
  }
  return out.map(t.noDashes);
}

const briefTexts = (o) => [o?.why, o?.angle, o?.audience, ...(Array.isArray(o?.outline) ? o.outline : [])].map((x) => String(x ?? "")).filter(Boolean);

async function pitchArm(name, system, spec, styled) {
  const from = db.model_calls.length;
  const check = styled ? t.houseTitleHits : t.titleHits;
  const titles = [];
  const before = [];
  const after = [];
  let retitled = 0;
  for (const idea of IDEAS) {
    const o = await json(system, pitchPrompt(idea, spec));
    let title = String(o?.title ?? "");
    const hits = check(title);
    if (hits.length) {
      const again = await json(
        system,
        `The title of this pitch breaks the title rules:\n${hits.map((h) => `- "${h.sentence}" (${h.rule})`).join("\n")}\n\nThe idea: ${idea}\nThe angle: ${o?.angle ?? ""}\n\nWrite the title again as one plain statement of what the post says, under twelve words. Answer with JSON only: {"title": "..."}`,
        300,
      );
      const second = String(again?.title ?? "");
      if (second && check(second).length === 0) {
        retitled++;
        title = second;
      }
    }
    const texts = [title, ...briefTexts(o)];
    before.push(...texts.slice(1));
    const done = styled ? await polish(system, texts) : texts;
    after.push(...done.slice(1));
    titles.push({ idea, title: styled && done[0] && t.houseTitleHits(done[0]).length === 0 ? done[0] : styled ? t.noDashes(title) : title });
  }
  const c0 = counts(before, titles.map((x) => x.title));
  const c1 = counts(after, titles.map((x) => x.title));
  console.log(`\n## Pitcher, ${name}: ${c1.titleHits}/${titles.length} titles break the rules (${retitled} retitled); brief text before polish: ${c0.hard} hard, ${c0.dashes} em dashes, ${c0.soft} soft flags; after: ${c1.hard} hard, ${c1.dashes} em dashes, ${c1.soft} soft; $${costOf(from).toFixed(4)}`);
  for (const x of titles) console.log(`  ${t.houseTitleHits(x.title).map((h) => h.rule).join(",") || "ok"}\t${x.title}`);
  return { titles: c1.titleHits, n: titles.length, before: c0, after: c1, usd: costOf(from) };
}
// ---- the Writer: one brief, drafted both ways ----

const BRIEF = `Title: Your blog, newsletter and LinkedIn disagree because they were written three times
Angle: Inconsistency across channels comes from writing the same idea three times from scratch, each time with a different model of the reader; a founder fixes it by writing once and deriving, which is what an AI content team does when it keeps the facts in one place.
Audience: A founder with no marketing team who publishes on three channels and has noticed they contradict each other.
Length: 900 to 1,200 words
Outline:
1. The three versions of the same claim a founder published last month
2. Each channel was written from scratch, with a different reader in mind
3. The contradictions readers notice (and prospects quote back)
4. Write once, derive three times
5. What the derived versions keep and what they change`;

const draftPrompt = `Write the full post for Propaganda from this brief.

${BRIEF}

What the tenant knows (knowledge base; the only source for facts about the tenant):
${CLAIMS}

Sources you read (cite them as Markdown links on the words they support; use no other URLs):
(no sources could be read)

Write the whole post in Markdown: no H1 (the title is separate), H2 subheads, links inline. Then list the facts about the tenant you needed and didn't have.

Answer with JSON only: {"title": "...", "subtitle": "...", "excerpt": "one or two sentences for listings", "markdown": "...", "missingFacts": ["..."]}`;

const VOICE = "# Voice\n\nPlain, direct, a founder talking to a founder. Short sentences. No hype.";
async function writerArm(name, rules, styled) {
  const from = db.model_calls.length;
  const system = `You are the Writer for Propaganda: you write blog posts for a tenant, in the tenant's voice, from an approved brief. Your three concerns are tone, voice and veracity.\n\n${rules}\n\nThe tenant's voice guide (follow it closely):\n\n${VOICE}`;
  const o = await json(system, draftPrompt, 6000);
  const texts = [String(o?.markdown ?? ""), String(o?.title ?? ""), String(o?.subtitle ?? ""), String(o?.excerpt ?? "")];
  const c0 = counts([texts[0], texts[3]], [texts[1], texts[2]]);
  const done = styled ? await polish(system, texts) : texts;
  const c1 = counts([done[0], done[3]], [done[1], done[2]]);
  console.log(`\n## Writer, ${name}: before polish ${c0.hard} hard, ${c0.dashes} em dashes, ${c0.soft} soft flags, ${c0.titleHits} title hits; after: ${c1.hard} hard, ${c1.dashes} em dashes, ${c1.soft} soft, ${c1.titleHits} title hits; ${done[0].split(/\s+/).length} words, $${costOf(from).toFixed(4)}`);
  console.log(`  title: ${done[1]}\n  subtitle: ${done[2]}`);
  for (const h of [...t.hardHits(done[0]), ...t.styleHits(done[0])]) console.log(`  left ${h.rule}\t${h.sentence.slice(0, 140)}`);
  if (styled) console.log(`\n### The draft after polish\n\n${done[0]}\n`);
  return { before: c0, after: c1, usd: costOf(from) };
}

// ---- the Strategist: PPGD's real input (2026-10-10), both system prompts ----

async function strategistArm(name, system, styled) {
  const from = db.model_calls.length;
  let o = await json(system, fx.strat_user, 6000);
  const texts = (x) => [x?.summary, ...(x?.topics ?? []).flatMap((tp) => [tp.why, tp.basis]), x?.volume?.why, ...(x?.questions ?? [])].map((v) => String(v ?? "")).filter(Boolean);
  const c0 = counts(texts(o), (o?.topics ?? []).map((x) => String(x.name ?? "")));
  if (styled) o = t.proposalWithoutDashes(o);
  const topics = (o?.topics ?? []).map((x) => String(x.name ?? ""));
  const c1 = counts(texts(o), topics);
  console.log(`\n## Strategist, ${name}: ${c1.titleHits}/${topics.length} topic names break the rules; text: ${c0.dashes} em dashes, ${c0.soft} soft flags (after code: ${c1.dashes} em dashes); $${costOf(from).toFixed(4)}`);
  for (const x of topics) console.log(`  ${t.houseTitleHits(x).map((h) => h.rule).join(",") || "ok"}\t${x}`);
  console.log(`  summary: ${o?.summary}`);
  return { before: c0, after: c1, n: topics.length, usd: costOf(from) };
}

// ---- the judge alone, on real PPGD sentences the soft lists flag (house-style/twenty-rules.md),
// mixed with sentences where the flagged word does work. STYLE_AB_JUDGE=1 runs only this. ----

const JUDGE_TEXTS = [
  "Propaganda really does track AI answers; a post comparing what these tools measure answers it directly.",
  "a post on keeping the voice true literally answers it",
  "The hard part is knowing what your company actually believes.",
  "The lean marketing stack: only the SEO and AI apps that earn their place, a journey every founder knows.",
  "Lean marketing teams evaluating AI and SEO tools.",
  "Writing is cheap now. It's worth noting that a new domain won't rank for head terms in its first quarter.",
  "Paste your Anthropic API key in Settings; the key is stored encrypted and never sent back to the browser.",
  "Hiring a content agency that publishes opinionated pieces for businesses and organizations is the usual route.",
  "Our customer's journey from trial to paid took eleven days, and the onboarding email did most of the work.",
  "Why does this matter? Because your prospects notice.",
  "The landscape photos on your travel blog are the reason readers stay.",
  "Most users never open the settings page, so the default voice is the one they get.",
];

async function judgeArm() {
  const from = db.model_calls.length;
  const before = counts(JUDGE_TEXTS);
  const done = await polish(PITCHER_JUDGE_SYSTEM, JUDGE_TEXTS);
  const after = counts(done);
  console.log(`\n## Judge on ${JUDGE_TEXTS.length} sentences: ${before.hard} hard, ${before.soft} soft flags before; ${after.hard} hard, ${after.soft} soft after; $${costOf(from).toFixed(4)}`);
  done.forEach((x, i) => console.log(`  ${x === JUDGE_TEXTS[i] ? "same" : "new "}\t${x}`));
  return { before, after, usd: costOf(from) };
}
const PITCHER_JUDGE_SYSTEM = t.PITCHER_SYSTEM;

if (process.env.STYLE_AB_JUDGE) {
  const j = await judgeArm();
  console.log(`\n## Totals (${MODEL})\n${JSON.stringify({ judgeArm: j, judge: judged }, null, 1)}\ntotal $${costOf(0).toFixed(4)} over ${db.model_calls.length} calls`);
  process.exit(0);
}

const newStrat = fx.new_strat.replace("${HOUSE_STYLE}", t.HOUSE_STYLE).replace("${TITLE_RULES}", t.TITLE_RULES);
const out = {
  pitcherPrev: await pitchArm("main (#139)", fx.prev_pitch, NEW_SPEC, false),
  pitcherNew: await pitchArm("twenty rules + polish", t.PITCHER_SYSTEM, NEW_SPEC, true),
  writerPrev: await writerArm("main (#139)", fx.prev_house, false),
  writerNew: await writerArm("twenty rules + polish", `${t.HOUSE_RULES}\n\n${t.TITLE_RULES}`, true),
  strategistPrev: await strategistArm("main (#139)", fx.prev_strat, false),
  strategistNew: await strategistArm("twenty rules", newStrat, true),
  judgeArm: await judgeArm(),
  judge: judged,
};
console.log(`\n## Totals (${MODEL})`);
console.log(JSON.stringify(out, null, 1));
console.log(`total $${costOf(0).toFixed(4)} over ${db.model_calls.length} calls`);
process.exit(0);
