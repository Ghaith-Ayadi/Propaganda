// The house style rules, before and after, on a real model: the same ideas pitched
// with the prompts of main and with the prompts of this branch, the same brief
// drafted both ways, and PPGD's own Strategist input proposed both ways. Counts how
// many titles, topic names and sentences break the title rules (titleHits) and the
// house rules (styleHits), and what each arm cost. Run by hand, never at a release:
//
//   AI_GATEWAY_API_KEY=... node test/live/style-ab.mjs        (from worker/, after npm run build)
//
// Everything runs on DeepSeek V4 Pro (dev testing, Ayadi 2026-10-11), the
// Strategist included. The "old" prompts are in style-ab.fixtures.json, copied
// from main at the time of the change (2026-10-12).

import { readFileSync } from "node:fs";
import { liveEnv, standInRest } from "./kit.mjs";

liveEnv("style-ab");
const t = await import("../../dist/agents/testing.js");
const fx = JSON.parse(readFileSync(new URL("./style-ab.fixtures.json", import.meta.url), "utf8"));

const SITE = "livestyle000001";
const db = { model_calls: [], model_keys: [], app_settings: [] };
await standInRest(db);
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

const OLD_SPEC = '"a specific, slightly provocative title"';
const NEW_SPEC = '"a specific, slightly provocative title: one plain statement under twelve words, by the title rules"';

async function pitchArm(name, system, spec, retitle) {
  const from = db.model_calls.length;
  const titles = [];
  let retitled = 0;
  for (const idea of IDEAS) {
    const o = await json(system, pitchPrompt(idea, spec));
    let title = String(o?.title ?? "");
    const hits = t.titleHits(title);
    if (retitle && hits.length) {
      const again = await json(
        system,
        `The title of this pitch breaks the title rules:\n${hits.map((h) => `- "${h.sentence}" (${h.rule})`).join("\n")}\n\nThe idea: ${idea}\nThe angle: ${o?.angle ?? ""}\n\nWrite the title again as one plain statement of what the post says, under twelve words. Answer with JSON only: {"title": "..."}`,
        300,
      );
      const second = String(again?.title ?? "");
      if (second && t.titleHits(second).length === 0) {
        retitled++;
        titles.push({ idea, first: title, title: second });
        continue;
      }
    }
    titles.push({ idea, title });
  }
  const bad = titles.filter((x) => t.titleHits(x.title).length);
  console.log(`\n## Pitcher, ${name}: ${bad.length}/${titles.length} titles break the rules${retitle ? `, ${retitled} fixed by the retitle call` : ""}, $${costOf(from).toFixed(4)}`);
  for (const x of titles) console.log(`  ${t.titleHits(x.title).map((h) => h.rule).join(",") || "ok"}\t${x.title}${x.first ? `\n  \t  (was: ${x.first})` : ""}`);
  return { bad: bad.length, n: titles.length, usd: costOf(from) };
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
async function writerArm(name, rules) {
  const from = db.model_calls.length;
  const system = `You are the Writer for Propaganda: you write blog posts for a tenant, in the tenant's voice, from an approved brief. Your three concerns are tone, voice and veracity.\n\n${rules}\n\nThe tenant's voice guide (follow it closely):\n\n${VOICE}`;
  const o = await json(system, draftPrompt, 6000);
  const md = String(o?.markdown ?? "");
  const prose = t.styleHits(md);
  const title = [...t.titleHits(String(o?.title ?? "")), ...t.titleHits(String(o?.subtitle ?? ""))];
  console.log(`\n## Writer, ${name}: ${prose.length} prose hits, ${title.length} title hits, ${md.split(/\s+/).length} words, $${costOf(from).toFixed(4)}`);
  console.log(`  title: ${o?.title}\n  subtitle: ${o?.subtitle}`);
  for (const h of [...title, ...prose]) console.log(`  ${h.rule}\t${h.sentence.slice(0, 140)}`);
  return { prose: prose.length, title: title.length, usd: costOf(from) };
}

// ---- the Strategist: PPGD's real input (2026-10-10), both system prompts ----

async function strategistArm(name, system) {
  const from = db.model_calls.length;
  const o = await json(system, fx.strat_user, 6000);
  const topics = (o?.topics ?? []).map((x) => String(x.name ?? ""));
  const bad = topics.filter((x) => t.titleHits(x).length);
  console.log(`\n## Strategist, ${name}: ${bad.length}/${topics.length} topic names break the rules, $${costOf(from).toFixed(4)}`);
  for (const x of topics) console.log(`  ${t.titleHits(x).map((h) => h.rule).join(",") || "ok"}\t${x}`);
  console.log(`  summary: ${o?.summary}`);
  return { bad: bad.length, n: topics.length, usd: costOf(from) };
}

const newStrat = fx.new_strat.replace("${TITLE_RULES}", t.TITLE_RULES);
const out = {
  pitcherOld: await pitchArm("old prompts", fx.old_pitch, OLD_SPEC, false),
  pitcherNew: await pitchArm("new prompts + retitle", t.PITCHER_SYSTEM, NEW_SPEC, true),
  writerOld: await writerArm("old house rules", fx.old_house),
  writerNew: await writerArm("new house rules + title rules", `${t.HOUSE_RULES}\n\n${t.TITLE_RULES}`),
  strategistOld: await strategistArm("old system prompt", fx.old_strat),
  strategistNew: await strategistArm("new system prompt", newStrat),
};
console.log(`\n## Totals (${MODEL})`);
console.log(JSON.stringify(out, null, 1));
console.log(`total $${costOf(0).toFixed(4)} over ${db.model_calls.length} calls`);
process.exit(0);
