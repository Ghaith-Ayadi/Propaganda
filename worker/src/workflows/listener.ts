// The Listener: reads one source (a call, a Slack thread) once and hands on
// what it found. Ideas go to the Pitcher; candidate facts go to the Guardian
// as one proposal for the whole source. It never writes a claim.
//
// A source gets here through ingest() (src/listener/ingest.ts), which stores
// it as a kb_sources row and starts this workflow with an id derived from the
// source, so the same transcript arriving twice is read once.

import { DBOS } from "@dbos-inc/dbos-sdk";
import { ask } from "../agents/ai.js";
import { MODELS } from "../agents/model.js";
import { config } from "../config.js";
import {
  CHUNK_CHARS,
  checkExtraction,
  chunks,
  mergeExtractions,
  systemPrompt,
  userPrompt,
  type Extraction,
} from "../listener/extract.js";
import { listenerDb } from "../listener/db.js";
import { handOff, type IdeaIn } from "../listener/ideas.js";
import {
  agentsOn,
  getSource,
  nearbyClaims,
  readTenant,
  setSourceStatus,
  topicIds,
  upsertPeople,
  writeProposal,
  type ProposalChange,
} from "../listener/store.js";
import { sideOf, type Origin, type Participant, type Side } from "../listener/transcript.js";

/** The base tier (MODELS.base). */
const MODEL = () => process.env.LISTENER_MODEL || MODELS.base;
/** A source with more than this many facts is cut: past it, it's a document, not a call. */
const MAX_FACTS = 40;

export interface ListenInput {
  site: string;
  source: string;
  origin: Origin;
  participants: Participant[];
}

export interface ListenResult {
  facts: number;
  ideas: number;
  dropped: number;
  proposal: string | null;
  /** True once the Pitcher's inbox took the ideas; until then they're listed here. */
  ideasHandedOff: boolean;
  ideaList?: IdeaIn[];
  skipped?: string;
}

const db = listenerDb;

async function listen(input: ListenInput): Promise<ListenResult> {
  const { site } = input;
  const none = { facts: 0, ideas: 0, dropped: 0, proposal: null, ideasHandedOff: false };
  const read = await DBOS.runStep(
    async () => {
      const source = await getSource(site, input.source);
      if (!source) throw new Error(`No source ${input.source}`);
      const tenant = await readTenant(db(), site);
      return { source, tenant, on: await agentsOn(db(), site) };
    },
    { name: "read source" },
  );
  const { source, tenant } = read;
  // Lite tenants never spend a token. The source stays pending.
  if (!read.on) return { ...none, skipped: "agents are off for this tenant" };

  if (!source.body.trim()) {
    await DBOS.runStep(() => setSourceStatus(site, source.id, "skipped"), { name: "nothing to read" });
    return { ...none, skipped: "empty" };
  }

  const domains = new Set(tenant.domains);
  const people = input.participants.map((p) => ({
    ...p,
    // Slack is the tenant's own workspace: everyone in it is internal.
    side: (input.origin === "slack" ? "internal" : sideOf(p, domains)) as Side,
  }));
  const sides = new Map(people.map((p) => [p.name.toLowerCase(), p.side]));
  const kind = source.kind === "slack" ? "slack" : "call";

  const parts = chunks(source.body, CHUNK_CHARS);
  const found: Extraction[] = [];
  for (const [index, chunk] of parts.entries()) {
    const answer = await ask<Record<string, unknown>>(parts.length > 1 ? `read part ${index + 1}` : "read", {
      site,
      job: "listener",
      model: MODEL(),
      system: systemPrompt(tenant.name),
      prompt: userPrompt({ title: source.title, kind, participants: people, text: chunk.text, part: { index, of: parts.length } }),
    });
    // Checking is pure and deterministic: it replays the same from the stored answer.
    found.push(checkExtraction(answer, source.body, chunk, sides));
  }
  const all = mergeExtractions(found);
  const facts = all.facts.slice(0, MAX_FACTS);

  const personIds = await DBOS.runStep(() => upsertPeople(site, input.participants), { name: "people" });

  let proposal: string | null = null;
  if (facts.length) {
    proposal = await DBOS.runStep(
      async () => {
        const topics = await topicIds(site, facts.map((f) => f.topic));
        const changes: ProposalChange[] = [];
        for (const f of facts) {
          const near = await nearbyClaims(site, f.text, 3).catch(() => []);
          const lines = [
            f.speaker ? `Said by ${f.speaker}${personIds.has(f.speaker.toLowerCase()) ? "" : " (not matched to a person)"}.` : "",
            f.topic && !topics.get(f.topic.toLowerCase()) ? `Suggested topic: ${f.topic}.` : "",
            near.length ? `Nearest claims: ${near.map((n) => `${n.id} "${n.text}" (${n.status})`).join("; ")}.` : "",
          ].filter(Boolean);
          const topic = topics.get(f.topic.toLowerCase());
          changes.push({
            text: f.text,
            topics: topic ? [topic] : [],
            rationale: lines.join(" "),
            evidence: [{ source: source.id, quote: f.quote, span_start: f.start, span_end: f.end, stance: "supports" }],
          });
        }
        return writeProposal({
          site,
          source: source.id,
          title: `${facts.length} fact${facts.length === 1 ? "" : "s"} from ${source.title || (kind === "call" ? "a call" : "a Slack thread")}`,
          summary:
            `The Listener read this ${kind === "call" ? "call" : "Slack thread"} and found these candidate facts. ` +
            `Each quotes the exact passage it comes from.` +
            (all.facts.length > facts.length ? ` ${all.facts.length - facts.length} more were left out (cap of ${MAX_FACTS}).` : ""),
          changes,
        });
      },
      { name: "propose facts" },
    );
    // The Guardian's dispatcher finds it as an open proposal.
  }

  let ideas: IdeaIn[] = [];
  let ideasHandedOff = false;
  if (all.ideas.length) {
    ideas = all.ideas.map((i) => ({
      title: i.title,
      summary: i.why,
      origin: input.origin === "slack" ? ("team" as const) : ("calls" as const),
      evidence: [
        {
          label: source.title || (kind === "call" ? "Call" : "Slack thread"),
          url: source.uri || undefined,
          quote: i.quote,
          at: source.occurred ?? undefined,
          detail: `${i.kind.replace("_", " ")}${i.speaker ? `, ${i.speaker}` : ""}`,
          source_id: source.id,
          span_start: i.start,
          span_end: i.end,
        },
      ],
    }));
    ideasHandedOff = await DBOS.runStep(() => handOff(site, ideas, { sourceAgent: "listener", key: source.id }), {
      name: "hand ideas to pitcher",
    });
  }

  await DBOS.runStep(() => setSourceStatus(site, source.id, "extracted"), { name: "done" });
  return {
    facts: facts.length,
    ideas: ideas.length,
    dropped: all.dropped,
    proposal,
    ideasHandedOff,
    ...(ideasHandedOff ? {} : { ideaList: ideas }),
  };
}

export const listener = DBOS.registerWorkflow(listen, { name: "listener" });
