// The Listener's code that needs no model, database or network: transcript
// formats, quote anchoring, the extraction rules, webhook signatures,
// Slack threads, secrets.
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";

process.env.LISTENER_SECRET_KEY = randomBytes(32).toString("base64");
// config.ts reads these when it loads; nothing here connects.
process.env.POSTGRES_PASSWORD ??= "unused";

const {
  parseCaptions, parsePlain, parseTranscriptText, renderBody, sideOf,
  anchor, checkExtraction, chunks, mergeExtractions,
  seal, open, tokenHash, newToken,
  fromUrlPost, BadInput,
  verifyGranola, noteToTranscript,
  verifySlack, threadMessage, applyMessages, plainSlack,
  verifyZoom,
} = await import("../dist/listener/testing.js");

// ---- formats ----
const teamsVtt = `WEBVTT

00:00:01.000 --> 00:00:04.000
<v Ayadi Ghaith>We ship the Pro plan with three seats.</v>

00:00:04.500 --> 00:00:07.000
<v Dana Prospect>Is there SSO on Pro?</v>
`;
assert.deepEqual(
  parseCaptions(teamsVtt).map((s) => [s.speaker, s.text, s.at]),
  [
    ["Ayadi Ghaith", "We ship the Pro plan with three seats.", 1000],
    ["Dana Prospect", "Is there SSO on Pro?", 4500],
  ],
);
const zoomVtt = `WEBVTT

1
00:00:01.000 --> 00:00:03.000
Ayadi: Hello there.

2
00:01:02.250 --> 00:01:05.000
Dana: Hi.`;
assert.deepEqual(parseCaptions(zoomVtt).map((s) => [s.speaker, s.text, s.at]), [
  ["Ayadi", "Hello there.", 1000],
  ["Dana", "Hi.", 62250],
]);
const srt = `1\n00:00:01,000 --> 00:00:02,000\nAyadi: One.\n\n2\n00:00:03,000 --> 00:00:04,000\nTwo, unnamed.`;
assert.deepEqual(parseTranscriptText(srt).map((s) => s.speaker), ["Ayadi", "Unknown"]);
assert.deepEqual(parsePlain("Ayadi: first\ncontinued\n[00:12] Dana: second").map((s) => [s.speaker, s.text]), [
  ["Ayadi", "first continued"],
  ["Dana", "second"],
]);
assert.deepEqual(parsePlain("just some notes\nwith no speakers"), [{ speaker: "Unknown", text: "just some notes with no speakers" }]);
assert.equal(
  renderBody([
    { speaker: "A", text: "one" },
    { speaker: "A", text: " two\n" },
    { speaker: "B", text: "three" },
    { speaker: "C", text: "   " },
  ]),
  "A: one two\nB: three",
);
const domains = new Set(["kontra.run"]);
assert.equal(sideOf({ name: "x", email: "x@kontra.run" }, domains), "internal");
assert.equal(sideOf({ name: "x", email: "x@acme.com" }, domains), "external");
assert.equal(sideOf({ name: "x" }, domains), "unknown");
console.log("  ok   transcript formats");

// ---- anchoring and the extraction rules ----
const body = "Ayadi: We ship the Pro plan with three seats.\nDana: Is there SSO on Pro? We’d need it.";
assert.deepEqual(anchor(body, "the Pro plan with three seats"), { start: 15, end: 44 });
// Case, whitespace and curly quotes don't break a quote; the span is the body's own text.
const a = anchor(body, "we'd  NEED it");
assert.equal(body.slice(a.start, a.end), "We’d need it");
assert.equal(anchor(body, "SAML on Pro"), null);
const sides = new Map([["ayadi", "internal"], ["dana", "external"]]);
const ex = checkExtraction(
  {
    facts: [
      { text: "Kontra's Pro plan includes three seats.", quote: "Pro plan with three seats", speaker: "Ayadi", topic: "Pricing" },
      { text: "Kontra needs SSO.", quote: "We’d need it", speaker: "Dana" }, // a prospect: not a fact
      { text: "Kontra has SAML.", quote: "SAML on Pro", speaker: "Ayadi" }, // not in the transcript
    ],
    ideas: [{ title: "SSO on the Pro plan", kind: "question", why: "Asked, no answer.", quote: "Is there SSO on Pro?", speaker: "Dana" }],
  },
  body,
  { offset: 0, text: body },
  sides,
);
assert.equal(ex.facts.length, 1);
assert.equal(ex.facts[0].quote, "Pro plan with three seats");
assert.equal(ex.ideas.length, 1);
assert.equal(ex.ideas[0].kind, "question");
assert.equal(ex.dropped, 2);
assert.deepEqual(checkExtraction(null, body, { offset: 0, text: body }, sides), { facts: [], ideas: [], dropped: 0 });

// Long sources are read in parts cut at line breaks; spans stay in the whole body.
const long = Array.from({ length: 400 }, (_, i) => `Speaker${i % 3}: line number ${i} of a long call.`).join("\n");
const parts = chunks(long, 2000);
assert.ok(parts.length > 5);
assert.equal(parts.map((p) => p.text).join(""), long);
assert.ok(parts.every((p) => p.text.endsWith("\n") || p.offset + p.text.length === long.length));
const p3 = parts[3];
const quote = p3.text.split("\n")[1];
const inPart = checkExtraction({ facts: [{ text: "x", quote, speaker: "Speaker1" }] }, long, p3, new Map());
assert.equal(long.slice(inPart.facts[0].start, inPart.facts[0].end), quote);
const merged = mergeExtractions([ex, ex]);
assert.equal(merged.facts.length, 1);
assert.equal(merged.dropped, 4);
console.log("  ok   extraction rules");

// ---- the ingest URL's bodies ----
const q = new URLSearchParams("title=Weekly%20call&occurred=2026-10-08T10:00:00Z");
const plain = fromUrlPost("text/plain; charset=utf-8", "Ayadi: hello\nDana: hi", q);
assert.equal(plain.title, "Weekly call");
assert.equal(plain.occurred, Date.parse("2026-10-08T10:00:00Z"));
assert.equal(plain.segments.length, 2);
const j = fromUrlPost(
  "application/json",
  JSON.stringify({ title: "T", participants: [{ name: "Ayadi", email: "a@kontra.run" }, { email: "d@acme.com" }], segments: [{ speaker: "Ayadi", text: "hi" }] }),
  new URLSearchParams(),
);
assert.deepEqual(j.participants.map((p) => p.name), ["Ayadi", "d@acme.com"]);
assert.equal(fromUrlPost("application/json", JSON.stringify({ transcript: teamsVtt }), new URLSearchParams()).segments.length, 2);
assert.throws(() => fromUrlPost("application/json", "[]", new URLSearchParams()), BadInput);
assert.throws(() => fromUrlPost("application/json", "{}", new URLSearchParams()), BadInput);
console.log("  ok   ingest URL bodies");

// ---- signatures ----
const whsec = `whsec_${randomBytes(24).toString("base64")}`;
const gBody = JSON.stringify({ event_type: "note.generated", note_id: "not_1d3tmYTlCICgjy" });
const now = Date.now();
const ts = String(Math.floor(now / 1000));
const gSig = createHmac("sha256", Buffer.from(whsec.slice(6), "base64")).update(`evt_1.${ts}.${gBody}`).digest("base64");
const gh = { "webhook-id": "evt_1", "webhook-timestamp": ts, "webhook-signature": `v1,${gSig}` };
assert.equal(verifyGranola(gh, gBody, whsec, now), true);
assert.equal(verifyGranola({ ...gh, "webhook-signature": "v1,AAAA v1,BBBB" }, gBody, whsec, now), false);
assert.equal(verifyGranola(gh, gBody + " ", whsec, now), false);
assert.equal(verifyGranola(gh, gBody, whsec, now + 10 * 60_000), false); // a replay
const sSecret = "8f742231b10e8888abcd99yyyzzz85a5";
const sSig = `v0=${createHmac("sha256", sSecret).update(`v0:${ts}:${gBody}`).digest("hex")}`;
assert.equal(verifySlack(ts, sSig, gBody, sSecret, now), true);
assert.equal(verifySlack(ts, sSig, gBody, "other", now), false);
assert.equal(verifySlack("0", sSig, gBody, sSecret, now), false);
const zSig = `v0=${createHmac("sha256", "zsecret").update(`v0:${ts}:${gBody}`).digest("hex")}`;
assert.equal(verifyZoom(ts, zSig, gBody, "zsecret", now), true);
assert.equal(verifyZoom(ts, zSig, "{}", "zsecret", now), false);
console.log("  ok   webhook signatures");

// ---- Granola notes ----
const note = {
  id: "not_1d3tmYTlCICgjy",
  title: null,
  owner: { name: "Ayadi", email: "ayadi@kontra.run" },
  created_at: "2026-10-08T10:00:00Z",
  web_url: "https://notes.granola.ai/d/x",
  attendees: [{ name: "Ayadi", email: "ayadi@kontra.run" }, { name: null, email: "dana@acme.com" }],
  calendar_event: { event_title: "Kontra x Acme", scheduled_start_time: "2026-10-08T09:30:00Z" },
};
const gt = noteToTranscript(note, [
  { speaker: { source: "microphone", attribution: "me" }, text: "Pro has three seats.", start_time: "2026-10-08T09:31:00Z" },
  { speaker: { source: "speaker", attribution: "them" }, text: "And SSO?", start_time: "2026-10-08T09:31:05Z" },
  { speaker: { source: "speaker", name: "Dana Smith" }, text: "Named.", start_time: "2026-10-08T09:31:09Z" },
]);
assert.equal(gt.title, "Kontra x Acme");
assert.equal(gt.occurred, Date.parse("2026-10-08T09:30:00Z"));
assert.deepEqual(gt.segments.map((s) => s.speaker), ["Ayadi", "Them", "Dana Smith"]);
assert.deepEqual(gt.participants.map((p) => [p.name, p.side]), [["Ayadi", "internal"], ["dana@acme.com", undefined]]);
console.log("  ok   Granola notes");

// ---- Slack threads ----
const ev = (o) => threadMessage({ type: "message", channel: "C1", ...o });
assert.deepEqual(ev({ user: "U1", text: "root", ts: "100.1" }), { channel: "C1", thread: "100.1", msg: { kind: "add", ts: "100.1", user: "U1", text: "root" } });
assert.equal(ev({ user: "U2", text: "reply", ts: "101.1", thread_ts: "100.1" }).thread, "100.1");
assert.equal(ev({ bot_id: "B1", text: "bot", ts: "102.1" }), null);
assert.equal(ev({ subtype: "channel_join", user: "U3", ts: "103.1" }), null);
assert.equal(ev({ subtype: "message_changed", message: { user: "U1", text: "root, edited", ts: "100.1" } }).msg.kind, "edit");
assert.equal(ev({ subtype: "message_deleted", deleted_ts: "101.1", previous_message: { ts: "101.1", thread_ts: "100.1" } }).thread, "100.1");
const msgs = applyMessages([
  { kind: "add", ts: "100.1", user: "U1", text: "root" },
  { kind: "add", ts: "102.1", user: "U2", text: "second" },
  { kind: "add", ts: "101.1", user: "U2", text: "first" },
  { kind: "edit", ts: "100.1", user: "U1", text: "root, edited" },
  { kind: "delete", ts: "102.1", user: "", text: "" },
  { kind: "edit", ts: "999.1", user: "U9", text: "edit of a message we never saw" },
]);
assert.deepEqual(msgs.map((m) => m.text), ["root, edited", "first"]);
assert.equal(
  plainSlack("<@U1> see <https://kontra.run|our site> in <#C9|general> &amp; <!here>", new Map([["U1", "Ayadi"]])),
  "@Ayadi see our site (https://kontra.run) in #general & @here",
);
console.log("  ok   Slack threads");

// ---- secrets ----
const sealed = seal({ apiKey: "grn_abc" });
assert.ok(!sealed.includes("grn_abc"));
assert.deepEqual(open(sealed), { apiKey: "grn_abc" });
const tampered = sealed.slice(0, -2) + (sealed.endsWith("A") ? "BB" : "AA");
assert.throws(() => open(tampered));
const token = newToken();
assert.match(token, /^ppl_[A-Za-z0-9_-]{43}$/);
assert.match(tokenHash(token), /^[0-9a-f]{64}$/);
console.log("  ok   connection secrets");
