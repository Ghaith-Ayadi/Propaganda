// Vercel serverless function — extract top-3 verbatim pull-quotes from a post
// via Gemini, validate each as an exact substring, return the survivors.
//
// The Gemini API key is server-only; this proxies the call so it never touches
// the browser bundle.
//
// POST /api/extract-quotes
// Body: { postId: number; content: string }
// Returns: { quotes: string[] }   (0–3 items; only verbatim matches included)

const GEMINI_MODEL = "gemini-2.5-flash-lite";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return json({ error: "Gemini not configured" }, 503);
  }

  let body: { postId?: unknown; content?: unknown };
  try {
    body = await request.json() as { postId?: unknown; content?: unknown };
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) {
    return json({ error: "content is required" }, 400);
  }

  // ── Call Gemini ────────────────────────────────────────────────────────────

  const prompt = `You are extracting shareable pull-quotes from a piece of writing.

Return the 3 most quotable verbatim spans from the article below.
Rules:
- Copy the text EXACTLY as it appears — do not change a single word, punctuation mark, or capitalisation.
- Spans may be one or two sentences. Do not restrict to single sentences.
- Return ONLY a raw JSON array of 3 strings. No keys, no explanation, no markdown.

Article:
${content}`;

  let geminiResponse: Response;
  try {
    geminiResponse = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
  } catch (err) {
    return json({ error: "Gemini request failed", detail: String(err) }, 502);
  }

  if (!geminiResponse.ok) {
    const errText = await geminiResponse.text();
    return json({ error: "Gemini error", detail: errText }, 502);
  }

  const geminiData = await geminiResponse.json() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };

  const raw = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  // ── Parse ──────────────────────────────────────────────────────────────────

  let candidates: string[];
  try {
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) throw new Error("not an array");
    candidates = parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return json({ error: "Could not parse model response", raw }, 422);
  }

  // ── Verbatim validation — the most important step ─────────────────────────
  // Drop any quote that is not an exact substring of the source.
  // A rewritten quote is worse than no quote.

  const quotes = candidates.filter((q) => content.includes(q));

  return json({ quotes });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
