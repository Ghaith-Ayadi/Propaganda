// Vercel serverless function — extract top-3 verbatim pull-quotes from a post
// via a model, validate each as an exact substring, return the survivors.
//
// The model is reached only through the cost-logging gateway (_ai/gateway.ts),
// so every call is charged to the tenant. Requires a signed-in member of the
// site — it spends model credits per call.
//
// POST /api/extract-quotes
// Body: { site: string; postId: string; content: string }
// Returns: { quotes: string[] }   (0–3 items; only verbatim matches included)

import { requireMember } from "./_auth";
import { withTelemetry } from "./_telemetry";
import { BudgetError, callModel } from "./_ai/gateway";

const MODEL = "google/gemini-2.5-flash-lite";

async function handle(request: Request): Promise<Response> {
  let body: { site?: unknown; postId?: unknown; content?: unknown };
  try {
    body = await request.json() as { site?: unknown; postId?: unknown; content?: unknown };
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const site = typeof body.site === "string" ? body.site : "";
  try {
    await requireMember(request, site);
  } catch (err) {
    if (err instanceof Response) return err;
    return json({ error: "Auth failed" }, 500);
  }

  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) {
    return json({ error: "content is required" }, 400);
  }

  const prompt = `You are extracting shareable pull-quotes from a piece of writing.

Return the 3 most quotable verbatim spans from the article below.
Rules:
- Copy the text EXACTLY as it appears — do not change a single word, punctuation mark, or capitalisation.
- Spans may be one or two sentences. Do not restrict to single sentences.
- Return ONLY a raw JSON array of 3 strings. No keys, no explanation, no markdown.

Article:
${content}`;

  let raw: string;
  try {
    // The editor's own action, not background work: it keeps working at 100% of a tenant's budget.
    raw = (await callModel({ site, job: "extract-quotes", model: MODEL, background: false, prompt })).text;
  } catch (err) {
    if (err instanceof BudgetError) return json({ error: "Model budget reached", reason: err.reason }, 429);
    throw err;
  }

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

export const POST = withTelemetry("extract-quotes", handle);
