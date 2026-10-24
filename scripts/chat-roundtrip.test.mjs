// node --test scripts/chat-roundtrip.test.mjs
// The check against a stub of the chat API: it passes on a correct server and names the step
// that fails on the two bugs it exists for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { roundTrip } from "./chat-roundtrip.mjs";

/** A chat API in memory; `htmlFor` makes one path answer with the app's HTML (the rewrite bug). */
function stub({ htmlFor, failSend } = {}) {
  const convs = new Map();
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const url = new URL(req.url, "http://x");
      const send = (status, data) => {
        res.statusCode = status;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(data));
      };
      if (htmlFor && url.pathname.endsWith(htmlFor)) {
        res.setHeader("Content-Type", "text/html");
        return void res.end("<!doctype html><html></html>");
      }
      const m = url.pathname.match(/^\/api\/chat\/conversations\/([a-z0-9]+)(\/messages)?$/);
      if (url.pathname === "/api/chat/conversations" && req.method === "POST") {
        const { id } = JSON.parse(body);
        convs.set(id, []);
        return send(201, { id });
      }
      if (url.pathname === "/api/chat/conversations") return send(200, [...convs.keys()].map((id) => ({ id })));
      if (m && m[2]) return send(200, convs.get(m[1]) ?? []);
      if (m && req.method === "DELETE") return convs.delete(m[1]) ? send(200, { ok: true }) : send(404, {});
      if (url.pathname === "/api/chat" && failSend) return send(500, { error: "boom" });
      if (url.pathname === "/api/chat") {
        const b = JSON.parse(body);
        convs.get(b.id).push({ role: "user" }, { role: "assistant" });
        res.statusCode = 200;
        return void res.end("data: [DONE]\n\n");
      }
      send(404, {});
    });
  });
  server.convs = convs;
  return server;
}

async function run(server, opts = {}) {
  await new Promise((r) => server.listen(0, r));
  try {
    return await roundTrip({ base: `http://127.0.0.1:${server.address().port}`, token: "t", site: "s", replyWaitMs: 500, ...opts });
  } finally {
    server.close();
  }
}

test("a correct server passes every step, with and without a message", async () => {
  for (const send of [false, true]) {
    const results = await run(stub(), { send });
    assert.ok(results.every((r) => r.ok), JSON.stringify(results.filter((r) => !r.ok)));
    assert.equal(results.some((r) => r.step === "send a message"), send);
  }
});

test("history answered with the app's HTML fails the read step", async () => {
  const results = await run(stub({ htmlFor: "/messages" }));
  assert.equal(results.find((r) => !r.ok)?.step, "read its messages (what a refresh does)");
});

test("a function that does not answer fails the first step and stops", async () => {
  const results = await run(stub({ htmlFor: "/conversations" }));
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, false);
});

test("a failed send still deletes the conversation it made", async () => {
  const server = stub({ failSend: true });
  const results = await run(server, { send: true });
  assert.equal(results.find((r) => !r.ok)?.step, "send a message");
  assert.equal(server.convs.size, 0);
});
