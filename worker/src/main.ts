// Propaganda's worker: the agents as DBOS workflows, and the Runs API.
// One process on the Bedrock box, in the propaganda-supabase stack.
//
// On start DBOS creates or upgrades its own database (propaganda_dbos) and
// resumes every run that was in flight, stalls included. On SIGTERM (a
// deploy) it stops taking work; whatever was running resumes on the next start.

import { DBOS } from "@dbos-inc/dbos-sdk";
import pg from "pg";
import { wireGateway } from "./agents/model.js";
import { config } from "./config.js";
import { startServer } from "./http.js";
import { registerQueues } from "./workflows/agents.js";
// Every workflow must be registered before launch, so recovery finds it.
import "./workflows/demo.js";
import "./agents/pitcher.js";
import "./agents/writer.js";
import "./agents/voice.js";

async function main(): Promise<void> {
  DBOS.setConfig({
    name: "propaganda",
    systemDatabaseUrl: config.systemDatabaseUrl,
    applicationVersion: config.appVersion,
    // One process: the default executor id is what recovery keys on, keep it stable.
    executorID: "propaganda-worker",
  });
  // Every model and paid-API call is then logged with its run and step.
  wireGateway();
  await DBOS.launch();
  await registerQueues();

  // The app's database holds people's content: this pool can only read it.
  // Any write through it fails at the server, whatever code asks for one.
  const db = new pg.Pool({
    connectionString: config.appDatabaseUrl,
    max: 4,
    options: "-c default_transaction_read_only=on",
  });
  db.on("error", (err) => console.error("app database:", err.message));
  const server = startServer(db, config.port);
  console.log(`worker ${config.appVersion} up, Runs API on :${config.port}`);

  const stop = async (signal: string) => {
    console.log(`${signal}: shutting down`);
    server.close();
    await DBOS.shutdown();
    await db.end();
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGINT", () => void stop("SIGINT"));
}

main().catch((err) => {
  console.error("worker failed to start:", err);
  process.exit(1);
});
