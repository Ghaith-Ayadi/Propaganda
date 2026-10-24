// Chat's round trip against a deployed server: start a conversation, send a message, read the
// conversation back the way a refresh does, delete it. Every answer has to be JSON from our
// functions: the two bugs this was written for (a function that crashed on load, and a rewrite
// that answered the history request with the app's HTML) both looked fine to every unit test.
//
//   CHAT_CHECK_TOKEN=<a member's access token> CHAT_CHECK_SITE=<site id> \
//     node scripts/chat-roundtrip.mjs [--base https://dev.propaganda.pub] [--send]
//
// Without --send it never calls a model (create, list, read back, delete). With --send it also
// sends one short message (a few cents on the dev box's DeepSeek) and waits for the reply to be
// stored. Exit 0 = every step passed, 1 = a step failed, 2 = it could not run (no token or site).
import { fileURLToPath } from "node:url";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const id = () => Array.from(crypto.getRandomValues(new Uint8Array(15)), (b) => ALPHABET[b % ALPHABET.length]).join("");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Runs the steps; returns [{ step, ok, detail }]. */
export async function roundTrip({ base, token, site, send = false, replyWaitMs = 60_000 }) {
  const results = [];
  const conv = id();
  const note = (step, ok, detail = "") => {
    results.push({ step, ok, detail });
    return ok;
  };
  const call = async (path, init = {}) => {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: res.status, json, text, type: res.headers.get("content-type") ?? "" };
  };
  /** A step passes when the status is right and the body is JSON, not a page. */
  const json = (r, want) => r.status === want && r.json !== undefined;
  const why = (r) => `${r.status} ${r.type}: ${r.text.slice(0, 80).replace(/\s+/g, " ")}`;
  const q = `site=${encodeURIComponent(site)}`;

  const created = await call("/api/chat/conversations", { method: "POST", body: JSON.stringify({ site, id: conv }) });
  if (!note("create a conversation", json(created, 201), why(created))) return results;

  const listed = await call(`/api/chat/conversations?${q}`);
  note("the list holds it", json(listed, 200) && Array.isArray(listed.json) && listed.json.some((c) => c.id === conv), why(listed));

  const empty = await call(`/api/chat/conversations/${conv}/messages?${q}`);
  note("read its messages (what a refresh does)", json(empty, 200) && Array.isArray(empty.json), why(empty));

  if (send) {
    const sent = await call("/api/chat", {
      method: "POST",
      body: JSON.stringify({
        site,
        id: conv,
        trigger: "submit-message",
        messageId: id(),
        message: { id: id(), role: "user", parts: [{ type: "text", text: "Say hello in one word." }] },
      }),
    });
    if (!note("send a message", sent.status === 200, why(sent))) return results;
    // The reply is stored when the stream ends; the stream was read to its end above.
    const end = Date.now() + replyWaitMs;
    let back;
    do {
      back = await call(`/api/chat/conversations/${conv}/messages?${q}`);
      if (json(back, 200) && back.json.some((m) => m.role === "assistant")) break;
      await sleep(2000);
    } while (Date.now() < end);
    const roles = json(back, 200) && Array.isArray(back.json) ? back.json.map((m) => m.role).join(",") : why(back);
    note("the question and the reply are there after a refresh", roles === "user,assistant", roles);
  }

  const gone = await call(`/api/chat/conversations/${conv}?${q}`, { method: "DELETE" });
  note("delete it", gone.status >= 200 && gone.status < 300 && (gone.json !== undefined || gone.text === ""), why(gone));
  const after = await call(`/api/chat/conversations?${q}`);
  note("the list no longer holds it", json(after, 200) && Array.isArray(after.json) && !after.json.some((c) => c.id === conv), why(after));
  return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const base = (args.includes("--base") ? args[args.indexOf("--base") + 1] : "https://dev.propaganda.pub").replace(/\/$/, "");
  const token = process.env.CHAT_CHECK_TOKEN;
  const site = process.env.CHAT_CHECK_SITE;
  if (!token || !site) {
    console.error("Set CHAT_CHECK_TOKEN (a member's access token) and CHAT_CHECK_SITE (the site id).");
    process.exit(2);
  }
  const results = await roundTrip({ base, token, site, send: args.includes("--send") });
  for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.step}${r.ok ? "" : `: ${r.detail}`}`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}
