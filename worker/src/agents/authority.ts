// Which web sources an agent may cite (Ayadi, 2026-10-15; design in project files
// kb-styles/design.md). A page found by search is only a lead until its domain has
// authority. Four tiers for external sources, apart from the knowledge base's own
// source tiers:
//   A primary: journals, universities, governments, statistics offices, standards bodies
//   B institutions with editorial standards: research and consulting firms, major press
//   C renowned expert publications, quoted for their own findings and named
//   D never quoted: competitors, vendor marketing, agencies, aggregators, user-written sites
//   U unknown: not quoted until a person or the Guardian classifies it
// This first version is code only, so it needs no migration: the lists below are the
// seed of what becomes the source_authority table, where tenants and the Guardian add rows.

export type Authority = "A" | "B" | "C" | "D" | "U";

export interface Verdict {
  tier: Authority;
  /** The list entry or rule that decided it, for the log. */
  why: string;
}

const A_SUFFIX = [".edu", ".gov", ".mil", ".int", ".ac.uk", ".gov.uk", ".edu.au", ".gov.au", ".ac.jp", ".gc.ca", ".europa.eu"];
const A = [
  "nature.com", "science.org", "sciencedirect.com", "springer.com", "jstor.org", "arxiv.org", "ssrn.com", "nber.org",
  "ieee.org", "acm.org", "plos.org", "thelancet.com", "nejm.org", "bmj.com", "cell.com", "pnas.org", "oecd.org",
  "worldbank.org", "imf.org", "un.org", "iso.org", "w3.org", "ietf.org",
];
const B = [
  "gartner.com", "forrester.com", "mckinsey.com", "bain.com", "bcg.com", "deloitte.com", "pwc.com", "kpmg.com", "ey.com",
  "accenture.com", "idc.com", "pewresearch.org", "hbr.org", "nytimes.com", "wsj.com", "ft.com", "newyorker.com",
  "economist.com", "reuters.com", "apnews.com", "bloomberg.com", "theatlantic.com", "washingtonpost.com", "bbc.com",
  "bbc.co.uk", "theguardian.com", "wired.com", "technologyreview.com", "fortune.com", "scientificamerican.com",
];
const C = [
  "contentmarketinginstitute.com", "searchengineland.com", "stripe.com", "a16z.com", "ahrefs.com", "sequoiacap.com", "firstround.com", "paulgraham.com", "lennysnewsletter.com",
  "openai.com", "anthropic.com", "research.google", "github.blog", "netflixtechblog.com", "blog.cloudflare.com",
];
// Never quoted, whatever the page says: competitors of Propaganda (meeting and call tools, AI
// content tools), and sites whose text is anyone's.
const D = [
  "fireflies.ai", "otter.ai", "fathom.video", "fathom.ai", "gong.io", "grain.com", "avoma.com", "read.ai", "tldv.io",
  "sembly.ai", "jamie.ai", "chorus.ai", "clari.com", "notta.ai", "granola.ai", "fellow.app", "zoom.com", "zoom.us",
  "airops.com", "jasper.ai", "copy.ai", "writesonic.com", "surferseo.com", "clearscope.io", "frase.io", "marketmuse.com",
  "wikipedia.org", "reddit.com", "quora.com", "medium.com", "substack.com", "linkedin.com", "youtube.com", "facebook.com",
  "x.com", "twitter.com", "pinterest.com", "slideshare.net", "scribd.com", "blogspot.com", "wordpress.com",
];

function host(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

const on = (h: string, d: string) => h === d || h.endsWith(`.${d}`);

/** The tier of a URL's domain. Competitors and user-written sites are D before any other list is read. */
export function authority(url: string): Verdict {
  const h = host(url);
  if (!h) return { tier: "U", why: "not a URL" };
  const d = D.find((x) => on(h, x));
  if (d) return { tier: "D", why: d };
  const a = A.find((x) => on(h, x)) ?? A_SUFFIX.find((s) => h.endsWith(s) || `.${h}` === s);
  if (a) return { tier: "A", why: a };
  const b = B.find((x) => on(h, x));
  if (b) return { tier: "B", why: b };
  const c = C.find((x) => on(h, x));
  if (c) return { tier: "C", why: c };
  // The box's own additions, comma separated (never lifts a D): AUTHORITY_ALLOW.
  const extra = (process.env.AUTHORITY_ALLOW ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  const e = extra.find((x) => on(h, x));
  if (e) return { tier: "C", why: `AUTHORITY_ALLOW ${e}` };
  return { tier: "U", why: h };
}

/** May a draft or a brief cite this? A to C, or a host the tenant owns. */
export function quotable(url: string, ownHosts: string[] = []): boolean {
  const h = host(url);
  if (h && ownHosts.some((o) => on(h, o.toLowerCase()))) return true;
  const t = authority(url).tier;
  return t === "A" || t === "B" || t === "C";
}

/**
 * Does this URL need a look before it is cited? Unknown domains do, and so does a
 * government or university address that matched only on its suffix: ai.cms.gov is
 * authoritative, but not about content marketing.
 */
export function needsVetting(url: string, ownHosts: string[] = []): boolean {
  const h = host(url);
  if (h && ownHosts.some((o) => on(h, o.toLowerCase()))) return false;
  const v = authority(url);
  return v.tier === "U" || (v.tier === "A" && A_SUFFIX.includes(v.why));
}

/** The words that carry a topic, in order, for a search query. */
function keyWords(text: string, max: number): string {
  const stop = new Set("a an and are as at be but by can do does for from how i if in into is it its of on or our so than that the their them then there these they this to too vs was we what when where which who why will with without you your".split(" "));
  const out: string[] = [];
  for (const w of text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)) {
    if (w.length > 2 && !stop.has(w) && !out.includes(w)) out.push(w);
    if (out.length >= max) break;
  }
  return out.join(" ");
}

/** A search aimed at the sources that count: studies, analyst firms, major press. The topic is cut to its first eight keywords, so a long thesis can't pull the results away from it. */
export function authorityQuery(topic: string): string {
  return `${keyWords(topic, 8)} (study OR research OR survey OR report) (site:edu OR site:gov OR gartner.com OR forrester.com OR mckinsey.com OR bain.com OR nytimes.com OR hbr.org OR newyorker.com)`;
}

/** The sentence the agents get about the rule, so the model knows why a source is missing. */
export const AUTHORITY_RULE =
  "Authority: don't quote sources with no authority. Cite journals, universities, governments, research and consulting firms (Gartner, Bain, McKinsey), major press (The New York Times, The New Yorker) and renowned expert publications, by name, for what they found. Never cite a competitor's or a vendor's marketing page, an agency blog, an aggregator or a site anyone can write on. A page marked 'not citable' may inform what you write but is never a source.";
