// The Listener end to end: a real Postgres with every migration, a real
// PostgREST in front of it (the worker writes through it, as on the box), the
// worker as a process, and a fake Granola, Slack and Zoom on one local port.
// Model answers are canned (WORKER_FAKE_ANSWERS): no model is called.
//
// Needs pgvector in the Postgres at PGURL, and PostgREST: POSTGREST_BIN, or
// `postgrest` on the PATH. Without PostgREST it says so and skips.

import { spawn, spawnSync } from "node:child_process";
import { createHmac, randomBytes, randomUUID, createCipheriv } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const PGURL = process.env.PGURL ?? "postgres://postgres:postgres@localhost:5432";
const APP = "listener_test_app";
const SYS = "listener_test_dbos";
const SECRET = "test-secret-test-secret-test-secret-0000";
const PORT = 3921;
const REST_PORT = 3922;
const PROXY_PORT = 3923;
const FAKE_PORT = 3924;
const API = `http://localhost:${PORT}`;
const FAKE = `http://localhost:${FAKE_PORT}`;
const SITE = "kontrasite00000";
const LITE = "litesite0000000";
const KEY = randomBytes(32).toString("base64");
const SLACK_SECRET = "slack-signing-secret";
const ZOOM_SECRET = "zoom-webhook-secret";
const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);
const SHIM = new URL("../../supabase/tests/kb/shim.sql", import.meta.url);

const POSTGREST = process.env.POSTGREST_BIN ?? "postgrest";
if (spawnSync(POSTGREST, ["--version"]).status !== 0) {
  console.log("  skip listener end to end: no PostgREST (set POSTGREST_BIN)");
  process.exit(0);
}

let failures = 0;
function check(cond, what) {
  if (cond) console.log(`  ok   ${what}`);
  else {
    failures++;
    console.log(`  FAIL ${what}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, fn, timeoutMs = 30000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(250);
  }
}

function jwt(claims, expIn = 3600) {
  const b = (x) => Buffer.from(JSON.stringify(x)).toString("base64url");
  const head = b({ alg: "HS256", typ: "JWT" });
  const body = b({ ...claims, exp: Math.floor(Date.now() / 1000) + expIn });
  return `${head}.${body}.${createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url")}`;
}
const member = randomUUID();
const stranger = randomUUID();
const DISPATCH = "dispatch-secret-for-the-listener-test";
const MEMBER = { Authorization: `Bearer ${jwt({ sub: member, role: "authenticated" })}` };
const SERVICE_KEY = jwt({ role: "service_role" }, 86400);

/** Seal a connection secret the way the worker does (connections.ts). */
function seal(secret) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", Buffer.from(KEY, "base64"), iv);
  const data = Buffer.concat([c.update(JSON.stringify(secret), "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

async function api(path, { method = "GET", body, headers = MEMBER, raw, type } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    redirect: "manual",
    headers: { ...headers, ...(body || raw ? { "Content-Type": type ?? "application/json" } : {}) },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text, headers: res.headers };
}

// ---- the fake outside world ----

const seen = { granolaHooks: [], granolaDeleted: [], zoomAuth: [] };
const WHSEC = `whsec_${randomBytes(24).toString("base64")}`;
const NOTE = "not_1d3tmYTlCICgjy";
const fake = createServer(async (req, res) => {
  const u = new URL(req.url, FAKE);
  let body = "";
  for await (const c of req) body += c;
  const send = (status, v, ctype = "application/json") => {
    res.writeHead(status, { "Content-Type": ctype });
    res.end(typeof v === "string" ? v : JSON.stringify(v));
  };
  // Granola
  if (u.pathname.startsWith("/granola/")) {
    if (req.headers.authorization !== "Bearer grn_testkey123456") return send(401, { message: "bad key" });
    const p = u.pathname.slice("/granola".length);
    if (p === "/notes" && req.method === "GET") return send(200, { notes: [], hasMore: false, cursor: null });
    if (p === "/webhook-endpoints" && req.method === "POST") {
      seen.granolaHooks.push(JSON.parse(body));
      return send(200, { id: "whe_2mKr8fQxLp7Ta3", signing_secret: WHSEC, created_by: { email: "ayadi@kontra.run" } });
    }
    if (p.startsWith("/webhook-endpoints/") && req.method === "DELETE") {
      seen.granolaDeleted.push(p);
      return send(200, { deleted: true });
    }
    if (p === `/notes/${NOTE}`) {
      return send(200, {
        id: NOTE,
        title: "Kontra x Acme discovery",
        owner: { name: "Ayadi", email: "ayadi@kontra.run" },
        created_at: new Date(Date.now() + 1000).toISOString(),
        web_url: "https://notes.granola.ai/d/abc",
        attendees: [{ name: "Dana", email: "dana@acme.com" }],
        calendar_event: null,
        transcript: [
          { speaker: { source: "microphone", attribution: "me" }, text: "Kontra runs batch jobs on Temporal under the hood.", start_time: new Date().toISOString() },
          { speaker: { source: "speaker", attribution: "them" }, text: "How do you price crawling at fleet scale?", start_time: new Date().toISOString() },
        ],
      });
    }
    return send(404, { message: "no" });
  }
  // Slack
  if (u.pathname === "/slack/users.info") {
    const id = u.searchParams.get("user");
    return send(200, { ok: true, user: { name: id.toLowerCase(), real_name: id === "U1" ? "Ayadi" : "Sam", profile: { email: `${id.toLowerCase()}@kontra.run` } } });
  }
  if (u.pathname === "/slack/conversations.info") return send(200, { ok: true, channel: { name: "product" } });
  if (u.pathname === "/slack/chat.getPermalink") return send(200, { ok: true, permalink: "https://kontra.slack.com/archives/C1/p100" });
  // Zoom
  if (u.pathname === "/zoom/transcript.vtt") {
    seen.zoomAuth.push(req.headers.authorization);
    if (req.headers.authorization !== "Bearer zoom-download-token") return send(401, "no");
    return send(200, "WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\nAyadi: Our retry policy is three attempts per job.\n\n2\n00:00:05.000 --> 00:00:08.000\nGuest: Why only three?\n", "text/vtt");
  }
  send(404, "no");
});

// ---- PostgREST, behind /rest/v1 like Caddy puts it ----

let postgrest;
const proxy = createServer((req, res) => {
  if (!req.url.startsWith("/rest/v1")) {
    res.writeHead(404);
    return res.end();
  }
  const p = request(
    { host: "localhost", port: REST_PORT, path: req.url.slice("/rest/v1".length) || "/", method: req.method, headers: req.headers },
    (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    },
  );
  req.pipe(p);
});

let worker;
async function startWorker(answersFile) {
  worker = spawn(process.execPath, ["dist/main.js"], {
    env: {
      ...process.env,
      APP_DATABASE_URL: `${PGURL}/${APP}`,
      DBOS_SYSTEM_DATABASE_URL: `${PGURL}/${SYS}`,
      JWT_SECRET: SECRET,
      WORKER_PORT: String(PORT),
      WORKER_DISPATCH_SECONDS: "0",
      WORKER_DISPATCH_SECRET: DISPATCH,
      WORKER_FAKE_ANSWERS: answersFile,
      SUPABASE_URL: `http://localhost:${PROXY_PORT}`,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
      LISTENER_SECRET_KEY: KEY,
      PUBLIC_URL: "https://app.example.test",
      GRANOLA_API_URL: `${FAKE}/granola`,
      SLACK_API_URL: `${FAKE}/slack`,
      SLACK_SIGNING_SECRET: SLACK_SECRET,
      SLACK_QUIET_HOURS: String(2 / 3600),
      ZOOM_WEBHOOK_SECRET: ZOOM_SECRET,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  worker.stdout.on("data", (d) => process.env.VERBOSE && process.stdout.write(`    [worker] ${d}`));
  worker.stderr.on("data", (d) => process.stdout.write(`    [worker!] ${d}`));
  await until("the worker", async () => {
    try {
      return (await fetch(`${API}/health`)).ok;
    } catch {
      return false;
    }
  });
}

async function main() {
  const root = new pg.Client({ connectionString: `${PGURL}/postgres` });
  await root.connect();
  await root.query(`drop database if exists ${APP} with (force)`);
  await root.query(`drop database if exists ${SYS} with (force)`);
  await root.query(`create database ${APP}`);
  await root.query(`do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'listener_authenticator') then
      create role listener_authenticator login password 'authenticator' noinherit;
    end if; end $$`);
  await root.end();

  const db = new pg.Client({ connectionString: `${PGURL}/${APP}` });
  await db.connect();
  await db.query(readFileSync(SHIM, "utf8"));
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    await db.query(readFileSync(new URL(f, MIGRATIONS), "utf8"));
  }
  await db.query(`grant anon, authenticated, service_role to listener_authenticator`);
  await db.query(`
    insert into auth.users (id, email) values ('${member}', 'ayadi@kontra.run'), ('${stranger}', 'eve@else.com');
    insert into public.sites (id, name, slug) values ('${SITE}', 'Kontra', 'kontra'), ('${LITE}', 'Lite', 'lite');
    insert into public.site_members (site, user_id, role) values ('${SITE}', '${member}', 'owner'), ('${LITE}', '${member}', 'owner');
    insert into public.kb_agent_sites (site) values ('${SITE}');
    insert into public.kb_topics (site, name) values ('${SITE}', 'Pricing');
  `);

  postgrest = spawn(POSTGREST, [], {
    env: {
      ...process.env,
      PGRST_DB_URI: `${PGURL.replace(/\/\/[^@]*@/, "//listener_authenticator:authenticator@")}/${APP}`,
      PGRST_DB_SCHEMAS: "public",
      PGRST_DB_ANON_ROLE: "anon",
      PGRST_JWT_SECRET: SECRET,
      PGRST_SERVER_PORT: String(REST_PORT),
      PGRST_LOG_LEVEL: "crit",
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
  await new Promise((r) => proxy.listen(PROXY_PORT, r));
  await new Promise((r) => fake.listen(FAKE_PORT, r));
  await until("PostgREST", async () => {
    try {
      return (await fetch(`http://localhost:${REST_PORT}/`)).status < 500;
    } catch {
      return false;
    }
  });

  // Canned answers, one per Listener run, in the order the runs happen below.
  const dir = mkdtempSync(join(tmpdir(), "listener-"));
  const answers = join(dir, "answers.json");
  writeFileSync(
    answers,
    JSON.stringify({
      listener: [
        {
          facts: [
            { text: "Kontra's Pro plan includes three seats.", quote: "We ship the Pro plan with three seats.", speaker: "Ayadi", topic: "Pricing" },
            { text: "Kontra needs SSO.", quote: "Is there SSO on Pro?", speaker: "Dana" },
            { text: "Kontra has SAML.", quote: "SAML is on every plan.", speaker: "Ayadi" },
          ],
          ideas: [{ title: "SSO on the Pro plan", kind: "question", why: "A prospect asked and got no answer.", quote: "Is there SSO on Pro?", speaker: "Dana" }],
        },
        {
          facts: [{ text: "Kontra runs batch jobs on Temporal.", quote: "Kontra runs batch jobs on Temporal under the hood.", speaker: "Ayadi", topic: "Product" }],
          ideas: [{ title: "Pricing crawls at fleet scale", kind: "question", why: "Asked on a discovery call.", quote: "How do you price crawling at fleet scale?", speaker: "Them" }],
        },
        {
          facts: [{ text: "Kontra's free tier allows 1,000 jobs a month.", quote: "free tier is 1,000 jobs a month", speaker: "Ayadi", topic: "Pricing" }],
          ideas: [],
        },
        { facts: [], ideas: [{ title: "Why three retries", kind: "question", why: "A guest asked.", quote: "Why only three?", speaker: "Guest" }] },
        { facts: [], ideas: [] },
      ],
    }),
  );
  await startWorker(answers);

  console.log("connections need a member");
  check((await api(`/connections?site=${SITE}`, { headers: {} })).status === 401, "no token: 401");
  check((await api(`/connections?site=${SITE}`, { headers: { Authorization: `Bearer ${jwt({ sub: stranger, role: "authenticated" })}` } })).status === 403, "not a member: 403");

  console.log("the ingest URL");
  const made = await api("/connections/url", { method: "POST", body: { site: SITE } });
  check(made.status === 200 && /^https:\/\/app\.example\.test\/worker\/v1\/ingest\/ppl_/.test(made.json?.url ?? ""), `a new ingest URL (${made.json?.url})`);
  const path = new URL(made.json.url).pathname.replace("/worker/v1", "");
  const stored = await db.query("select token_hash, secret from private.listener_connections where id = $1", [made.json.id]);
  check(stored.rows[0].token_hash.length === 64 && !stored.rows[0].token_hash.includes("ppl_") && stored.rows[0].secret === "", "only the token's hash is stored");
  const listed = await api(`/connections?site=${SITE}`);
  check(listed.json.connections.length === 1 && !("secret" in listed.json.connections[0]) && !("tokenHash" in listed.json.connections[0]), "the list carries no secrets");

  const vtt = `WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n<v Ayadi>We ship the Pro plan with three seats.</v>\n\n00:00:04.500 --> 00:00:07.000\n<v Dana>Is there SSO on Pro?</v>\n`;
  const post = await api(path, {
    method: "POST",
    body: { title: "Kontra x Acme", participants: [{ name: "Ayadi", email: "ayadi@kontra.run" }, { name: "Dana", email: "dana@acme.com" }], transcript: vtt },
  });
  check(post.status === 202 && post.json.created === true, `accepted (${post.status} ${post.text.slice(0, 120)})`);
  const src = post.json.source;
  const extracted = await until("extracted", async () => {
    const r = await db.query("select * from public.kb_sources where id = $1", [src]);
    return r.rows[0]?.status === "extracted" ? r.rows[0] : null;
  });
  check(extracted.kind === "call" && extracted.tier === 3 && extracted.site === SITE, "a kb_sources row of kind call, private to the tenant");
  check(extracted.body === "Ayadi: We ship the Pro plan with three seats.\nDana: Is there SSO on Pro?", "the body is the rendered transcript");
  const prop = (await db.query("select * from public.kb_proposals where site = $1 and origin = 'ingest'", [SITE])).rows;
  check(prop.length === 1 && prop[0].status === "open" && prop[0].opened_by_agent === "listener", "one open proposal for the source, by the Listener");
  const changes = (await db.query("select * from public.kb_changes where proposal = $1 order by position", [prop[0].id])).rows;
  check(changes.length === 1, `only the tenant's own, quoted fact (${changes.length}): the prospect's and the made-up quote are dropped`);
  const ev = changes[0]?.evidence?.[0];
  check(ev && extracted.body.slice(ev.span_start, ev.span_end) === "We ship the Pro plan with three seats." && ev.source === src, "evidence quotes the exact span");
  const pricing = (await db.query("select id from public.kb_topics where site = $1 and name = 'Pricing'", [SITE])).rows[0].id;
  check(changes[0]?.topics?.[0] === pricing, "matched to the tenant's existing topic");
  check((await db.query("select count(*)::int as n from public.kb_claims")).rows[0].n === 0, "no claim written: only the Guardian admits");
  const people = (await db.query("select email from public.kb_people where site = $1 order by email", [SITE])).rows.map((r) => r.email);
  check(people.join(",") === "ayadi@kontra.run,dana@acme.com", `speakers with emails become kb_people (${people})`);

  const runOut = async (id) => {
    const sys = new pg.Client({ connectionString: `${PGURL}/${SYS}` });
    await sys.connect();
    const r = await sys.query("select s.status, coalesce(o.output, s.output) as output from dbos.workflow_status s left join dbos.workflow_output o using (workflow_uuid) where s.workflow_uuid = $1", [id]);
    await sys.end();
    return r.rows[0];
  };
  const out = await runOut(post.json.run);
  check(out?.status === "SUCCESS" && /SSO on the Pro plan/.test(out.output ?? ""), `the idea is in the run's output for the Pitcher (${out?.status} ${String(out?.output).slice(0, 200)})`);

  const again = await api(path, { method: "POST", raw: "Ayadi: We ship the Pro plan with three seats.\nDana: Is there SSO on Pro?", type: "text/plain" });
  check(again.status === 202 && again.json.created === false && again.json.source === src, `the same transcript again is the same source, not read twice (${again.status} ${again.text.slice(0, 120)})`);
  check((await api(`/ingest/ppl_${"x".repeat(43)}`, { method: "POST", raw: "A: b", type: "text/plain" })).status === 404, "an unknown token: 404");
  check((await api(path, { method: "POST", body: {} })).status === 400, "an empty body: 400");

  console.log("a Lite tenant spends nothing");
  const lite = await api("/connections/url", { method: "POST", body: { site: LITE } });
  const litePost = await api(new URL(lite.json.url).pathname.replace("/worker/v1", ""), { method: "POST", raw: "Ayadi: Something worth reading.", type: "text/plain" });
  const liteOut = await until("lite run", async () => {
    const r = await runOut(litePost.json.run);
    return r?.status === "SUCCESS" ? r : null;
  });
  check(/agents are off/.test(liteOut.output), `the run stops before any model call (${String(liteOut.output).slice(0, 200)})`);
  check((await db.query("select status from public.kb_sources where id = $1", [litePost.json.source])).rows[0].status === "pending", "its source stays pending");

  console.log("Granola");
  check((await api("/connections/granola", { method: "POST", body: { site: SITE, apiKey: "grn_wrongkey12345" } })).status === 400, "a key Granola refuses: 400");
  const g = await api("/connections/granola", { method: "POST", body: { site: SITE, apiKey: "grn_testkey123456" } });
  check(g.status === 200, `connected (${g.text.slice(0, 100)})`);
  const hook = seen.granolaHooks[0];
  check(hook?.url === `https://app.example.test/worker/v1/hooks/granola/${g.json.id}` && hook.events.includes("note.generated"), "registered a webhook pointing back at the worker");
  const gRow = (await db.query("select secret, external_id, label from private.listener_connections where id = $1", [g.json.id])).rows[0];
  check(gRow.external_id === "whe_2mKr8fQxLp7Ta3" && !gRow.secret.includes("grn_") && !gRow.secret.includes(WHSEC.slice(6)), "the key and signing secret are stored encrypted");
  const gBody = JSON.stringify({ event_id: "e1", event_type: "note.generated", note_id: NOTE, occurred_at: new Date().toISOString() });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", Buffer.from(WHSEC.slice(6), "base64")).update(`e1.${ts}.${gBody}`).digest("base64");
  const gHeaders = { "webhook-id": "e1", "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` };
  check((await api(`/hooks/granola/${g.json.id}`, { method: "POST", raw: gBody, headers: { ...gHeaders, "webhook-signature": "v1,AAAA" } })).status === 401, "a bad signature: 401");
  check((await api(`/hooks/granola/${g.json.id}`, { method: "POST", raw: gBody, headers: gHeaders })).status === 200, "a signed delivery: 200");
  await api(`/hooks/granola/${g.json.id}`, { method: "POST", raw: gBody, headers: gHeaders }); // Granola retries: one run
  const gSrc = await until("granola source", async () => {
    const r = await db.query("select * from public.kb_sources where site = $1 and title = 'Kontra x Acme discovery' and status = 'extracted'", [SITE]);
    return r.rows[0];
  });
  check(gSrc.uri === "https://notes.granola.ai/d/abc" && gSrc.body.startsWith("Ayadi: Kontra runs batch jobs"), "the note's transcript became a source");
  check((await db.query("select count(*)::int as n from public.kb_proposals where site = $1 and origin = 'ingest'", [SITE])).rows[0].n === 2, "and its own proposal");

  console.log("Slack");
  await db.query(
    `insert into private.listener_connections (id, site, provider, external_id, label, secret, config)
     values ('slackconn000001', $1, 'slack', 'T123', 'Slack: Kontra', $2, '{}')`,
    [SITE, seal({ botToken: "xoxb-test", botUserId: "UBOT" })],
  );
  const slackPost = async (event, eventId) => {
    const raw = JSON.stringify({ type: "event_callback", team_id: "T123", event_id: eventId, event });
    const t = String(Math.floor(Date.now() / 1000));
    const s = `v0=${createHmac("sha256", SLACK_SECRET).update(`v0:${t}:${raw}`).digest("hex")}`;
    return api("/hooks/slack", { method: "POST", raw, headers: { "x-slack-request-timestamp": t, "x-slack-signature": s } });
  };
  const challenge = JSON.stringify({ type: "url_verification", challenge: "abc" });
  const ct = String(Math.floor(Date.now() / 1000));
  const cs = `v0=${createHmac("sha256", SLACK_SECRET).update(`v0:${ct}:${challenge}`).digest("hex")}`;
  check((await api("/hooks/slack", { method: "POST", raw: challenge, headers: { "x-slack-request-timestamp": ct, "x-slack-signature": cs } })).json?.challenge === "abc", "answers Slack's URL check");
  check((await api("/hooks/slack", { method: "POST", raw: challenge, headers: { "x-slack-request-timestamp": ct, "x-slack-signature": "v0=00" } })).status === 401, "a bad signature: 401");
  const long = "We changed it last week, and I want everyone in sales and support on the same page before the launch email goes out on Thursday.";
  await slackPost({ type: "message", channel: "C1", user: "U1", ts: "1760000000.000100", text: `Heads up <@U2>: our free tier is 1,000 jobs a month now. ${long}` }, "Ev1");
  await slackPost({ type: "message", channel: "C1", user: "U2", ts: "1760000001.000100", thread_ts: "1760000000.000100", text: `Got it. ${long}` }, "Ev2");
  await slackPost({ type: "message", channel: "C1", user: "U2", ts: "1760000001.000100", thread_ts: "1760000000.000100", text: `Got it. ${long}` }, "Ev2"); // a retry
  await slackPost({ type: "message", channel: "C1", bot_id: "B1", ts: "1760000002.000100", thread_ts: "1760000000.000100", text: "a bot" }, "Ev3");
  const sSrc = await until("slack source", async () => {
    const r = await db.query("select * from public.kb_sources where site = $1 and kind = 'slack' and status = 'extracted'", [SITE]);
    return r.rows[0];
  });
  check(sSrc.tier === 2 && sSrc.title.startsWith("#product: Heads up @Sam") && sSrc.uri === "https://kontra.slack.com/archives/C1/p100", `the quiet thread became one source (${sSrc.title})`);
  check(sSrc.body.split("\n").length === 2 && !sSrc.body.includes("a bot"), "both people's messages, once each, no bots");
  check((await db.query("select count(*)::int as n from public.kb_people where site = $1 and slack_id <> ''", [SITE])).rows[0].n === 2, "Slack people linked by Slack id");

  console.log("Zoom");
  await db.query(
    `insert into private.listener_connections (id, site, provider, external_id, label, secret, config)
     values ('zoomconn0000001', $1, 'zoom', 'zoomacct1', 'Zoom', $2, $3)`,
    [SITE, seal({ accessToken: "x", refreshToken: "y", expiresAt: Date.now() + 3600_000 }), JSON.stringify({ connectedAt: new Date(Date.now() - 60_000).toISOString() })],
  );
  const zoomPost = (obj) => {
    const raw = JSON.stringify(obj);
    const t = String(Math.floor(Date.now() / 1000));
    const s = `v0=${createHmac("sha256", ZOOM_SECRET).update(`v0:${t}:${raw}`).digest("hex")}`;
    return api("/hooks/zoom", { method: "POST", raw, headers: { "x-zm-request-timestamp": t, "x-zm-signature": s } });
  };
  const val = await zoomPost({ event: "endpoint.url_validation", payload: { plainToken: "pt1" } });
  check(val.json?.encryptedToken === createHmac("sha256", ZOOM_SECRET).update("pt1").digest("hex"), "answers Zoom's URL validation");
  const z = await zoomPost({
    event: "recording.transcript_completed",
    download_token: "zoom-download-token",
    payload: {
      account_id: "zoomacct1",
      object: {
        uuid: "abcUUID==",
        topic: "Weekly sync",
        start_time: new Date().toISOString(),
        host_email: "ayadi@kontra.run",
        recording_files: [{ file_type: "TRANSCRIPT", download_url: `${FAKE}/zoom/transcript.vtt` }],
      },
    },
  });
  check(z.status === 200, "a signed transcript_completed: 200");
  const zSrc = await until("zoom source", async () => {
    const r = await db.query("select * from public.kb_sources where site = $1 and title = 'Weekly sync' and status = 'extracted'", [SITE]);
    return r.rows[0];
  });
  check(zSrc.body === "Ayadi: Our retry policy is three attempts per job.\nGuest: Why only three?", "downloaded the VTT with the download token");
  check((await db.query("select count(*)::int as n from public.kb_proposals where site = $1", [SITE])).rows[0].n === 3, "no facts: no proposal for that call");

  console.log("Chat's hand-off");
  const D = { Authorization: `Bearer ${DISPATCH}` };
  const handoff = (task) => ({ site: SITE, task, requestedBy: member, conversation: "conv0000000test", post: null });
  check((await api("/agents/listener", { method: "POST", body: handoff("Read my last call please"), headers: D })).status === 422, "an ask with no transcript: 422");
  const pasted = "Ayadi: We changed the retry policy last month so jobs back off for longer.\nGuest: Does that slow down the whole fleet when one site is down?\nAyadi: No, each site backs off on its own and the rest keep going.";
  const h = await api("/agents/listener", { method: "POST", body: handoff(pasted), headers: D });
  check(h.status === 202 && /^listener-[a-f0-9]{15}$/.test(h.json?.runId ?? ""), `a pasted transcript starts a read (${h.status} ${h.text.slice(0, 80)})`);
  const h2 = await api("/agents/listener", { method: "POST", body: handoff(pasted), headers: D });
  check(h2.json?.runId === h.json?.runId, "pasted twice: the same run");
  const hOut = await until("hand-off run", async () => {
    const r = await runOut(h.json.runId);
    return r?.status === "SUCCESS" ? r : null;
  });
  check(!!hOut, "the hand-off run finishes");

  console.log("disconnect");
  check((await api(`/connections/${g.json.id}?site=${SITE}`, { method: "DELETE" })).status === 200, "disconnect Granola");
  check(seen.granolaDeleted.length === 1, "its webhook is removed on Granola's side");
  const gone = (await db.query("select status, secret from private.listener_connections where id = $1", [g.json.id])).rows[0];
  check(gone.status === "revoked" && gone.secret === "", "the row is revoked and its secret wiped");
  check((await api(`/hooks/granola/${g.json.id}`, { method: "POST", raw: gBody, headers: gHeaders })).status === 404, "its hook stops answering");

  worker.kill("SIGTERM");
  postgrest.kill("SIGTERM");
  proxy.close();
  fake.close();
  await db.end();
  console.log(failures ? `\n${failures} FAILED` : "\nLISTENER PASSED");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  worker?.kill("SIGKILL");
  postgrest?.kill("SIGKILL");
  process.exit(1);
});
