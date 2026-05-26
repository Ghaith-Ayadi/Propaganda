/**
 * test-quote-extraction.ts
 * One-shot test: fetch a published article, extract top-3 quotes via Gemini,
 * validate each as an exact verbatim substring of the source.
 *
 * Run: node --experimental-strip-types src/test-quote-extraction.ts
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(here, "..", "..", ".env.local") });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY!;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const GEMINI_MODEL = "gemini-2.5-flash-lite";

// ─── 1. Fetch a published article ────────────────────────────────────────────

const res = await fetch(
  `${SUPABASE_URL}/rest/v1/posts?status=eq.published&select=id,title,content_md&limit=1&order=published_at.desc`,
  { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
);

const [post] = await res.json() as { id: number; title: string; content_md: string }[];

if (!post) {
  console.error("No published articles found.");
  process.exit(1);
}

console.log(`\n📄 Article: "${post.title}" (id: ${post.id})`);
console.log(`   Length: ${post.content_md.length} chars / ~${Math.round(post.content_md.split(/\s+/).length)} words\n`);

// ─── 2. Call Gemini ───────────────────────────────────────────────────────────

const prompt = `You are extracting shareable pull-quotes from a piece of writing.

Return the 3 most quotable verbatim spans from the article below.
Rules:
- Copy the text EXACTLY as it appears — do not change a single word, punctuation mark, or capitalisation.
- Spans may be one or two sentences. Do not restrict to single sentences.
- Return ONLY a raw JSON array of 3 strings. No keys, no explanation, no markdown.

Article:
${post.content_md}`;

const geminiRes = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  }
);

const geminiData = await geminiRes.json() as any;
const raw = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

// ─── 3. Parse ─────────────────────────────────────────────────────────────────

let quotes: string[] = [];
try {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  quotes = JSON.parse(cleaned);
  if (!Array.isArray(quotes)) throw new Error("Not an array");
} catch {
  console.error("Failed to parse model response:\n", raw);
  process.exit(1);
}

// ─── 4. Validate verbatim ─────────────────────────────────────────────────────

console.log(`🔍 Validating ${quotes.length} quote(s) against source...\n`);

const source = post.content_md;
let passed = 0;

for (const [i, quote] of quotes.entries()) {
  const isExact = source.includes(quote);
  if (isExact) {
    passed++;
    console.log(`✅ Quote ${i + 1}: PASS`);
    console.log(`   "${quote}"\n`);
  } else {
    console.log(`❌ Quote ${i + 1}: FAIL (not verbatim — dropped)`);
    console.log(`   "${quote}"\n`);
  }
}

console.log(`─────────────────────────────────────`);
console.log(`Result: ${passed}/${quotes.length} quotes passed verbatim validation.`);
