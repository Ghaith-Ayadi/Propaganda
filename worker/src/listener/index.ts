// The Listener: transcripts and Slack threads into ideas and candidate facts.
// main.ts imports this before launch, so every workflow is registered for
// recovery, and calls startListener() after it.

import { DBOS } from "@dbos-inc/dbos-sdk";
import type { Pool } from "pg";
import { setListenerDb } from "./db.js";
import "../workflows/listener.js";
import { granolaSweep } from "./sources/granola.js";
import { meetPoll } from "./sources/meet.js";
import "./sources/slack.js";
import { teamsRenewScheduled } from "./sources/teams.js";
import "./sources/zoom.js";
import "./dispatch.js";

export { listenerRoute } from "./routes.js";

export function setListenerPool(db: Pool): void {
  setListenerDb(db);
}

/** The Listener's schedules (after DBOS.launch()). Each is a no-op for a tenant without that connection. */
export async function startListener(): Promise<void> {
  await DBOS.applySchedules([
    { scheduleName: "listener-granola-sweep", workflowFn: granolaSweep, schedule: "17 * * * *" },
    { scheduleName: "listener-meet-poll", workflowFn: meetPoll, schedule: "*/15 * * * *" },
    { scheduleName: "listener-teams-renew", workflowFn: teamsRenewScheduled, schedule: "5 */6 * * *" },
  ]);
}
