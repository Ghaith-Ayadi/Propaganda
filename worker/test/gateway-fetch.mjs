// The gateway's fetch waits as long as it is told for a slow model's first byte
// (Node's own limit is 300 s, which cut off long drafts and billed the retries).
import assert from "node:assert/strict";
import http from "node:http";
import { gatewayFetch } from "../dist/net.js";

const server = http.createServer((req, res) => {
  const wait = Number(new URL(req.url, "http://x").searchParams.get("wait"));
  setTimeout(() => res.end("ok"), wait);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

// Slower than the limit: the request fails on the headers timeout, not before.
const started = Date.now();
await assert.rejects(() => gatewayFetch(1)(`${base}/?wait=3000`), /fetch failed/);
assert.ok(Date.now() - started < 2500, "gave up at the configured limit");
// Inside the limit: the answer comes.
const res = await gatewayFetch(5)(`${base}/?wait=2000`);
assert.equal(await res.text(), "ok");

server.close();
console.log("gateway-fetch ok");
