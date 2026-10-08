// Where every source enters: a connector hands over a Transcript, ingest()
// stores it as one kb_sources row (private to the tenant, like everything with
// a `site`) and starts the Listener on it.
//
// "Transcripts never look back" (PPG-83): connectors only pass on calls that
// happen after the tenant connects them. The first sweep reads posts, never
// old calls.

import { DBOS } from "@dbos-inc/dbos-sdk";
import { AGENT_QUEUE } from "../workflows/agents.js";
import { listener, type ListenInput } from "../workflows/listener.js";
import { putSource, sourceId } from "./store.js";
import { renderBody, sha256, type Transcript } from "./transcript.js";

/**
 * Evidence weight (1 strongest; a Remember is 1, posts are 5). Slack is where
 * the subject-matter experts state facts in writing; a call is spoken and
 * looser.
 */
const TIER = { call: 3, slack: 2 } as const;

export interface Ingested {
  source: string;
  /** False when the tenant already had this exact text (its run is the same one as before). */
  created: boolean;
  run: string;
}

export function listenerRunId(source: string): string {
  return `listener-${source}`;
}

interface Stored {
  site: string;
  source: string;
  created: boolean;
  input: ListenInput;
}

/** Stores the transcript as a kb_sources row. Safe inside a step. */
async function store(site: string, t: Transcript): Promise<Stored> {
  const body = renderBody(t.segments);
  if (!body.trim()) throw new Error("The transcript has no text");
  const sha = sha256(body);
  const id = sourceId(site, sha);
  const kind = t.origin === "slack" ? "slack" : "call";
  const created = await putSource({
    id,
    site,
    kind,
    tier: TIER[kind],
    title: t.title.slice(0, 300),
    uri: t.uri.slice(0, 2000),
    body,
    sha256: sha,
    occurred: t.occurred ? new Date(t.occurred).toISOString() : null,
    status: "pending",
  });
  return { site, source: id, created, input: { site, source: id, origin: t.origin, participants: t.participants } };
}

/**
 * Starts the Listener on a stored source. The run id is fixed, so starting it
 * again (the same text posted twice, a crash between storing and starting) is
 * the same run, never a second read.
 */
async function start(s: Stored, attributes: Record<string, string> = { site: s.site }): Promise<Ingested> {
  const run = listenerRunId(s.source);
  await DBOS.startWorkflow(listener, {
    workflowID: run,
    queueName: AGENT_QUEUE,
    workflowAttributes: attributes,
  })(s.input);
  return { source: s.source, created: s.created, run };
}

/** From an HTTP route, outside any workflow. `attributes` tag the run (Chat's hand-off adds its conversation). */
export async function ingest(site: string, t: Transcript, attributes?: Record<string, string>): Promise<Ingested> {
  return start(await store(site, t), attributes);
}

/** From inside a connector's workflow: the write is a step, the start a child workflow. */
export async function ingestInWorkflow(site: string, t: Transcript): Promise<Ingested> {
  return start(await DBOS.runStep(() => store(site, t), { name: "ingest" }));
}
