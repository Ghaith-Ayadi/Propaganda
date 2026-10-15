// Which of a search's results an agent may cite (authority.ts has the lists).
// Pages on a list are decided without a model. Everything else gets one cheap
// look: an unknown domain, or a government or university page that matched
// only on its suffix. If nothing citable comes out, one more search aimed at
// studies, analyst firms and major press runs, and its results get the same
// look. Call from a workflow: every part is a step with a fixed name.

import { MODELS, askJson, arr, obj, str } from "./model.js";
import { authority, authorityQuery } from "./authority.js";
import { searchDurably, type SearchSession } from "./search.js";
import type { SearchHit } from "./web.js";

const VET_SYSTEM = `You decide which web pages a business blog may cite as a source. Be strict: a reader should nod at the name of the source.
Citable: peer-reviewed or institutional research, universities, governments and regulators (only when the page is about the topic), analyst and consulting firms, major newspapers and magazines, and publications of renowned experts that report their own findings or data under a named author or organisation.
Not citable: a vendor's or competitor's marketing page, an agency or SEO blog, a listicle or roundup, an aggregator, a site anyone can write on, a page with no named author or no original finding, anything unknown to you that looks like content marketing, and any page that is not about the topic.
A page on a respected site still fails when it is not about the topic or reports nothing of its own. When unsure, it is not citable.`;

export interface Vetted {
  /** The results shown to the model: the ones passed in, plus any the authority search found. */
  hits: SearchHit[];
  /** The URLs that may be cited. */
  citable: Set<string>;
}

interface Verdict {
  url: string;
  citable: boolean;
}

async function vet(site: string, job: string, step: string, topic: string, hits: SearchHit[]): Promise<Set<string>> {
  if (hits.length === 0) return new Set();
  const list = hits.slice(0, 20);
  const verdicts = await askJson(
    step,
    {
      site,
      job: `${job}:sources`,
      model: MODELS.base,
      maxOutputTokens: 2200,
      reasoning: "low",
      system: VET_SYSTEM,
      prompt: `The post is about: ${topic}

Pages:
${list.map((h, i) => `${i + 1}. ${h.title} <${h.url}>: ${h.snippet.slice(0, 240)}`).join("\n")}

Answer with JSON only: {"pages": [{"n": 1, "citable": false, "why": "five words"}]}, one entry per page.`,
    },
    (v): Verdict[] =>
      arr(obj(v, "The answer").pages, "pages").map((x, i) => {
        const o = obj(x, `pages[${i}]`);
        const n = Number(o.n);
        const hit = list[n - 1];
        if (!hit) throw new Error(`pages[${i}].n is not one of the pages: ${String(o.n)}`);
        str(o.why, `pages[${i}].why`, { optional: true, max: 200 });
        return { url: hit.url, citable: o.citable === true };
      }),
  );
  return new Set(verdicts.filter((x) => x.citable).map((x) => x.url));
}

/**
 * Sorts a search's results into citable and not. `topic` is what the post is
 * about; `label` makes the step names (one call per label per workflow).
 */
export async function vetSources(input: {
  site: string;
  job: string;
  topic: string;
  label: string;
  hits: SearchHit[];
  ownHosts?: string[];
  searches: SearchSession;
}): Promise<Vetted> {
  const { site, job, topic, label, searches } = input;
  const own = (input.ownHosts ?? []).map((o) => o.toLowerCase());
  const hits = [...input.hits];
  const isOwn = (url: string) => {
    try {
      const h = new URL(url).hostname.toLowerCase();
      return own.some((o) => h === o || h.endsWith(`.${o}`));
    } catch {
      return false;
    }
  };
  // The tenant's own pages are citable; a never-citable domain is out; every other result is read
  // by the model for what it says and whether it is about the topic. Listed domains come first so
  // they are never the ones cut off.
  const vettable = (list: SearchHit[]) =>
    list
      .filter((h) => authority(h.url).tier !== "D" && !isOwn(h.url))
      .sort((a, b) => Number(authority(a.url).tier === "U") - Number(authority(b.url).tier === "U"));
  const citable = new Set(hits.filter((h) => isOwn(h.url)).map((h) => h.url));
  for (const u of await vet(site, job, `vet sources ${label}`, topic, vettable(hits))) citable.add(u);

  if (citable.size === 0 && !searches.down) {
    // Plain results gave nothing to cite: ask for the sources that count.
    let more: SearchHit[] = [];
    try {
      more = await searchDurably(searches, authorityQuery(topic), 8, { site, job }, `authority search ${label}`);
    } catch {
      // A refused search costs this post its sources, not the run.
    }
    more = more.filter((h) => !hits.some((x) => x.url === h.url));
    for (const h of more) if (isOwn(h.url)) citable.add(h.url);
    for (const u of await vet(site, job, `vet authority sources ${label}`, topic, vettable(more))) citable.add(u);
    hits.push(...more);
  }
  return { hits, citable };
}
