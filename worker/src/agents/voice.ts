// The Writer's first job on a tenant: a short voice guide, from the tenant's
// own published posts, that the tenant can edit (voice_guides; once a person
// edits it, the agent never writes it again). A tenant with no posts gets the
// default voice. A tenant can take its voice from another site's posts:
// Propaganda's own tenant reads Ayadi's posts on Verbatim.

import { DBOS } from "@dbos-inc/dbos-sdk";
import { getSite, publishedPosts, saveVoiceGuide, voiceGuide, type PostRow, type VoiceGuideRow } from "./store.js";
import { HOUSE_RULES } from "./writing.js";
import { MODELS, askJson, arr, obj, str } from "./model.js";

/**
 * The default voice, for a tenant with nothing published (Kontra). A first
 * draft for Ayadi to rewrite: agents.md says it is written with him.
 */
export const DEFAULT_VOICE = `# Default voice

**In one line:** a sharp practitioner explaining something to a smart friend over a drink. Alive, specific, a bit cheeky; never a brochure.

**Do**
1. Lead with the point. The first paragraph says what the reader will get and why it matters to them.
2. Be concrete: a real example, a number with its source, a named tool, a before and after. One good example beats three adjectives.
3. Have an opinion and say why. Admit the trade-off out loud.
4. Short paragraphs, plain words, active verbs. Vary sentence length; let a short one land.
5. Humour is welcome when it's earned: a jab at the industry's habits, never at the reader.
6. Talk to the reader as "you". The tenant is "we" only when it speaks about its own work.

**Don't**
1. Corporate filler: "leverage", "unlock", "in today's fast-paced world", "seamless", "robust", "game-changer".
2. Hedging every sentence. Say it once, with the evidence, and move on.
3. Listicles of thin points. Fewer points, each one earned.
4. The "That's not X. It's Y." move. Use a comparison: "This is much more X than it is Y."
5. Ending on a summary of what was just said. End on the next step or the sharpest line.

**Shape of a post**
- Title: specific and a little provocative; a promise the post keeps.
- 900 to 1,600 words unless the brief says otherwise.
- Subheads every 200 to 300 words, written as claims, not labels.
`;

export interface VoiceInput {
  site: string;
  /** Read another site's posts for the voice (Propaganda's own tenant reads Verbatim). */
  sourceSite?: string;
  /** Rewrite the agent's guide even when one exists (never a person's). */
  refresh?: boolean;
}

export interface VoiceResult {
  source: VoiceGuideRow["source"] | "kept";
  saved: boolean;
  posts: number;
}

const MIN_POSTS = 2;
const SAMPLE_POSTS = 8;
const CHARS_PER_POST = 6000;

function excerpt(p: PostRow): string {
  return `### ${p.title}${p.subtitle ? `\n_${p.subtitle}_` : ""}\n\n${p.content_md.slice(0, CHARS_PER_POST)}`;
}

interface Drafted {
  guide: string;
  samples: { title: string; passage: string }[];
}

function parseDrafted(posts: PostRow[]) {
  return (v: unknown): Drafted => {
    const o = obj(v, "The answer");
    const guide = str(o.guide, "guide", { max: 8000 });
    const samples = arr(o.samples, "samples").slice(0, 5).map((x, i) => {
      const s = obj(x, `samples[${i}]`);
      const passage = str(s.passage, `samples[${i}].passage`, { max: 1500 });
      // Samples must be verbatim: a quote we made up would teach the Writer our voice, not theirs.
      const flat = (t: string) => t.replace(/\s+/g, " ").trim();
      if (!posts.some((p) => flat(p.content_md).includes(flat(passage)))) {
        throw new Error(`samples[${i}].passage is not copied word for word from one of the posts.`);
      }
      return { title: str(s.title, `samples[${i}].title`, { max: 300 }), passage };
    });
    return { guide, samples };
  };
}

async function voiceGuideRun(input: VoiceInput): Promise<VoiceResult> {
  const { site } = input;
  const current = await DBOS.runStep(() => voiceGuide(site), { name: "read the current guide" });
  if (current?.source === "person") return { source: "kept", saved: false, posts: 0 };
  if (current && !input.refresh) return { source: "kept", saved: false, posts: 0 };

  const from = input.sourceSite ?? site;
  const posts = await DBOS.runStep(
    async () => (await publishedPosts(from, SAMPLE_POSTS, true)).filter((p) => p.content_md.trim().length > 400),
    { name: "read published posts" },
  );

  if (posts.length < MIN_POSTS) {
    const saved = await DBOS.runStep(
      () => saveVoiceGuide({ site, body: DEFAULT_VOICE, samples: [], source: "default", source_site: null }),
      { name: "save the default voice" },
    );
    return { source: "default", saved, posts: posts.length };
  }

  const tenant = await DBOS.runStep(() => getSite(site), { name: "read the tenant" });
  const drafted = await askJson(
    "write the voice guide",
    {
      site,
      job: "writer:voice-guide",
      model: MODELS.advanced,
      maxOutputTokens: 4000,
      system: `You study a writer's published posts and write down their voice so another writer can match it. You describe what is actually on the page, with evidence, never generic advice.

${HOUSE_RULES}`,
      prompt: `Write the voice guide for ${tenant?.name ?? "this tenant"} from the posts below.

The guide is short (300 to 500 words), in Markdown, and the tenant will edit it. Sections:
1. "In one line": the voice as a person (who's talking, to whom, in what mood).
2. "Do": 5 to 7 numbered habits, each with a short example lifted from the posts.
3. "Don't": 3 to 5 things this writer never does, as observed.
4. "Shape of a post": typical length, openings, subheads, endings.
5. "Words": words and phrases they use, and ones they'd never use.

Also pick 3 to 5 sample passages (40 to 150 words each) that show the voice best, copied word for word.

Answer with JSON only: {"guide": "<markdown>", "samples": [{"title": "<post title>", "passage": "<verbatim>"}]}

${posts.map(excerpt).join("\n\n---\n\n")}`,
    },
    parseDrafted(posts),
  );

  const saved = await DBOS.runStep(
    () =>
      saveVoiceGuide({
        site,
        body: drafted.guide,
        samples: drafted.samples,
        source: "content",
        source_site: input.sourceSite ?? null,
      }),
    { name: "save the voice guide" },
  );
  return { source: "content", saved, posts: posts.length };
}

/**
 * Tenants whose voice comes from another site's posts, from VOICE_FROM
 * ("<tenant>:<source site>,..."). Propaganda's own tenant takes Ayadi's voice
 * from Verbatim (verbatimsite000).
 */
export function voiceSourceFor(site: string): string | undefined {
  for (const pair of (process.env.VOICE_FROM ?? "").split(",")) {
    const [to, from] = pair.split(":").map((x) => x.trim());
    if (to === site && /^[a-z0-9]{15}$/.test(from ?? "")) return from;
  }
  return undefined;
}

export const voiceGuideWorkflow = DBOS.registerWorkflow(voiceGuideRun, { name: "writer:voice-guide" });

/** The guide the Writer follows: the tenant's, else the default. */
export function voiceFor(row: VoiceGuideRow | null): string {
  if (!row?.body.trim()) return DEFAULT_VOICE;
  const samples = (row.samples ?? []).map((s) => `> ${s.passage.replace(/\n/g, "\n> ")}\n> (from "${s.title}")`).join("\n\n");
  return samples ? `${row.body}\n\n## Sample passages\n\n${samples}` : row.body;
}
