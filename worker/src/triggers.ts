// Admin's Run now (Admin > Runs, superadmins only): start what a schedule or
// the dispatcher would start, when someone wants it, for testing. Each trigger
// runs the agent's own workflow, so the run goes through the same steps, cost
// log and budgets as a scheduled one, and shows on the Runs page like any other.
//
//   GET  /triggers               { triggers, tenants }
//   POST /triggers/:id           { runs: [id...] }  body { site } (for a tenant trigger)
//
// A manual run gets its own id, never the schedule's: the morning's run for the
// same tenant still happens. The Checker and Guardian are the exception: their
// ids come from the work itself, so Run now only starts what is waiting.

import { DBOS, type WorkflowHandle } from "@dbos-inc/dbos-sdk";
import type { Pool } from "pg";
import { HttpError } from "./auth.js";
import { dispatchOnce } from "./agents/dispatch.js";
import { voiceSuggest } from "./agents/edits.js";
import { pitchBatch } from "./agents/pitcher.js";
import { voiceGuideWorkflow, voiceSourceFor } from "./agents/voice.js";
import { granolaSweep } from "./listener/sources/granola.js";
import { meetPoll } from "./listener/sources/meet.js";
import { teamsRenew } from "./listener/sources/teams.js";
import { AGENT_QUEUE } from "./workflows/agents.js";
import { scout } from "./workflows/scout.js";

export interface Trigger {
  id: string;
  /** The agent it belongs to, as the page groups them. */
  agent: string;
  label: string;
  /** One sentence: what it starts and what it can write. */
  detail: string;
  /** tenant: run for the picked tenant. all: one run covering every tenant with that connection. */
  scope: "tenant" | "all";
}

interface Who {
  /** The superadmin who pressed Run now (auth user id). */
  by: string;
}

type Start = (site: string | null, who: Who) => Promise<string[]>;

const today = () => new Date().toISOString().slice(0, 10);

/** Start `workflow` on the agents queue, marked as a manual run. */
async function manual<Args extends unknown[], R>(
  site: string | null,
  who: Who,
  workflow: (...args: Args) => Promise<R>,
  ...args: Args
): Promise<string[]> {
  const attributes: Record<string, string> = { trigger: "manual", requestedBy: who.by };
  if (site) attributes.site = site;
  const handle: WorkflowHandle<R> = await DBOS.startWorkflow(workflow, {
    queueName: AGENT_QUEUE,
    workflowAttributes: attributes,
  })(...args);
  return [handle.workflowID];
}

const need = (site: string | null): string => {
  if (!site) throw new HttpError(400, "Pick a tenant");
  return site;
};

const TRIGGERS: (Trigger & { start: Start })[] = [
  {
    id: "scout",
    agent: "Scout",
    label: "Weekly scout",
    detail: "Searches, AI mentions, news and watched sites for this tenant (DataForSEO is paid). Writes the Scout's own tables and ideas.",
    scope: "tenant",
    start: (site, who) => manual(site, who, scout, { site: need(site), day: today() }),
  },
  {
    id: "pitcher-batch",
    agent: "Pitcher",
    label: "Morning batch run",
    detail: "What the 7:00 run does: tops up short batches, and releases the week's batch if one is due.",
    scope: "tenant",
    start: (site, who) => manual(site, who, pitchBatch, { site: need(site), trigger: "schedule" }),
  },
  {
    id: "pitcher-next-batch",
    agent: "Pitcher",
    label: "Next batch now",
    detail: "Releases the next batch whatever the cadence, as when someone asks Chat for it.",
    scope: "tenant",
    start: (site, who) => manual(site, who, pitchBatch, { site: need(site), trigger: "asked" }),
  },
  {
    id: "writer-voice-suggest",
    agent: "Writer",
    label: "Voice suggestions from edits",
    detail: "The morning run: reads reviewers' edits to the Writer's drafts and suggests changes to the voice guide.",
    scope: "tenant",
    start: (site, who) => manual(site, who, voiceSuggest, { site: need(site) }),
  },
  {
    id: "writer-voice-guide",
    agent: "Writer",
    label: "Rebuild the voice guide",
    detail: "Rewrites the agent's voice guide from the tenant's posts. Never one a person edited.",
    scope: "tenant",
    start: (site, who) => {
      const s = need(site);
      return manual(site, who, voiceGuideWorkflow, { site: s, sourceSite: voiceSourceFor(s), refresh: true });
    },
  },
  {
    id: "kb-agents",
    agent: "Checker and Guardian",
    label: "Look for work now",
    detail: "Checks this tenant's newest post versions, re-checks, contests and open proposals now, without the settle wait. Starts nothing when nothing is waiting.",
    scope: "tenant",
    start: (site) => dispatchOnce(need(site), 0),
  },
  {
    id: "listener-granola",
    agent: "Listener",
    label: "Granola sweep",
    detail: "The hourly sweep: new notes from every tenant's Granola connection.",
    scope: "all",
    start: (_site, who) => manual(null, who, granolaSweep, new Date(), null),
  },
  {
    id: "listener-meet",
    agent: "Listener",
    label: "Meet poll",
    detail: "The 15-minute poll: new Google Meet transcripts from every connected tenant.",
    scope: "all",
    start: (_site, who) => manual(null, who, meetPoll, new Date(), null),
  },
  {
    id: "listener-teams",
    agent: "Listener",
    label: "Teams renewal",
    detail: "Renews every tenant's Teams transcript subscription (the 6-hourly run).",
    scope: "all",
    start: (_site, who) => manual(null, who, teamsRenew),
  },
];

export function listTriggers(): Trigger[] {
  return TRIGGERS.map(({ start: _start, ...t }) => t);
}

/** Every tenant, for the picker (the read-only pool; sites are public anyway). */
export async function listTenants(db: Pool): Promise<{ id: string; name: string }[]> {
  const r = await db.query<{ id: string; name: string }>("select id, name from public.sites order by name");
  return r.rows;
}

export async function runTrigger(db: Pool, id: string, site: string | null, who: Who): Promise<string[]> {
  const t = TRIGGERS.find((x) => x.id === id);
  if (!t) throw new HttpError(404, "No such trigger");
  if (t.scope === "tenant") {
    const found = await db.query("select 1 from public.sites where id = $1", [need(site)]);
    if (!found.rowCount) throw new HttpError(422, "No such tenant");
  }
  try {
    return await t.start(t.scope === "tenant" ? site : null, who);
  } catch (err) {
    // A table this agent reads isn't on this server yet (its migration hasn't landed).
    if ((err as { code?: string }).code === "42P01") {
      throw new HttpError(409, `${t.agent}: the tables this run needs aren't on this server yet.`);
    }
    throw err;
  }
}
