// Fails when code reaches a model provider by any path other than the cost-
// logging gateway (api/_ai/gateway.ts). Run: npm run check:model-paths
// (from api/). Scans the whole repo's source, not just api/.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const ALLOWED = new Set(["api/_ai/gateway.ts", "api/check-model-paths.mjs"]);
const SKIP = new Set(["node_modules", ".git", "dist", ".claude", "docs", "scripts"]);
const FORBIDDEN = [
  [/generativelanguage\.googleapis\.com/, "Gemini API"],
  [/api\.anthropic\.com/, "Anthropic API"],
  [/api\.openai\.com/, "OpenAI API"],
  [/ai-gateway\.vercel\.sh/, "AI Gateway endpoint"],
  [/from\s+["'](ai|@ai-sdk\/[^"']+|@anthropic-ai\/[^"']+|openai|@google\/generative-ai|@google\/genai)["']/, "model SDK import"],
];

const bad = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) {
      const rel = relative(ROOT, path);
      if (ALLOWED.has(rel)) continue;
      const lines = readFileSync(path, "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const [re, what] of FORBIDDEN) if (re.test(line)) bad.push(`${rel}:${i + 1}  ${what}`);
      });
    }
  }
}
walk(ROOT);

if (bad.length) {
  console.error("Model calls must go through api/_ai/gateway.ts (callModel):\n" + bad.join("\n"));
  process.exit(1);
}
console.log("ok: no model call outside the gateway");
