// Checker bench: the current CHECK_SYSTEM vs a proposed one on the four round-4 drafts. Prints results.
import { readFileSync } from "node:fs";
import { generateText } from "ai";
const pack = JSON.parse(readFileSync("/worker/checkbench/pack.json", "utf8"));
const MODEL = "deepseek/deepseek-v4-pro";
const htmlToText = (h, max = 12000) => h.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim().slice(0, max);
function links(md, max = 6) {
  const out = [], seen = new Set();
  const re = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)|(?<![(\w])(https?:\/\/[^\s)<>\]]+)/g;
  for (const m of md.matchAll(re)) {
    const url = (m[2] ?? m[3] ?? "").replace(/[.,;:]+$/, "");
    if (!url || seen.has(url)) continue; seen.add(url);
    const at = m.index ?? 0, from = Math.max(0, md.lastIndexOf("\n", at) + 1, at - 300), nl = md.indexOf("\n", at);
    out.push({ url, context: md.slice(from, nl === -1 ? undefined : Math.min(nl, at + 300)).trim() });
    if (out.length >= max) break;
  }
  return out;
}
async function page(url) {
  try { const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(10000), headers: { "User-Agent": "PropagandaChecker/0.2 (+https://propaganda.pub)" } });
    if (!r.ok) return ""; const t = r.headers.get("content-type") ?? ""; const b = (await r.text()).slice(0, 2e6); return t.includes("html") ? htmlToText(b) : b.slice(0, 12000);
  } catch { return ""; }
}
const out = {};
for (const [model, post] of Object.entries(pack.posts)) {
  const pages = await Promise.all(links(post.content).map(async (l) => ({ url: l.url, sentence_in_post: l.context, page_text: (await page(l.url)) || null })));
  const prompt = JSON.stringify({ post: { title: post.title, status: "draft", published_at: null, content: post.content }, claims: [], linked_pages: pages }, null, 1);
  out[model] = { pageChars: pages.map((p) => [p.url, p.page_text?.length ?? 0]) };
  for (const which of ["current", "proposed"]) {
    const t0 = Date.now();
    try {
      const r = await generateText({ model: MODEL, system: pack[which], prompt, maxOutputTokens: 8000 });
      out[model][which] = { text: r.text, usage: r.usage, ms: Date.now() - t0, cost: r.providerMetadata?.gateway?.cost ?? null };
    } catch (e) { out[model][which] = { error: String(e.message ?? e) }; }
    console.error(model, which, Date.now() - t0, "ms");
  }
}
const { gzipSync } = await import("node:zlib");
console.log("RESULT_BEGIN"); console.log(gzipSync(JSON.stringify(out)).toString("base64")); console.log("RESULT_END");
