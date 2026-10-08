// Fails when code reaches a model provider by any path other than the cost-
// logging gateway (api/_ai/gateway.ts). Run: npm run check:model-paths
// (from api/). Scans the whole repo's source, not just api/.
//
// Blocked everywhere outside the gateway: provider hosts, provider packages
// (@ai-sdk/anthropic, openai, ...) and model-call functions (generateText,
// streamText, ...). Allowed under app/src only: `ai` and `@ai-sdk/react`
// imports, which are the browser's chat UI and types; they post to our own
// /api and never reach a provider.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const GATEWAY = "api/_ai/gateway.ts";
const ALLOWED = new Set([GATEWAY, "api/check-model-paths.mjs", "api/check-model-paths.test.mjs"]);
const SKIP = new Set(["node_modules", ".git", "dist", ".claude", "docs", "scripts"]);

const HOSTS = [
  [/generativelanguage\.googleapis\.com/, "Gemini API"],
  [/api\.anthropic\.com/, "Anthropic API"],
  [/api\.openai\.com/, "OpenAI API"],
  [/ai-gateway\.vercel\.sh/, "AI Gateway endpoint"],
];
const CALLS = /\b(generateText|streamText|generateObject|streamObject|embedMany)\s*\(/;
const IMPORT = /(?:from|import)\s*\(?\s*["']([^"']+)["']/;
const UI_PACKAGES = new Set(["ai", "@ai-sdk/react"]);
const PROVIDER_PACKAGE = /^(@ai-sdk\/|@anthropic-ai\/|openai$|@google\/generative-ai$|@google\/genai$|ai$)/;

/** Problems in one file's text. `rel` is its repo-relative path with forward slashes. */
export function scanSource(rel, text) {
  if (ALLOWED.has(rel)) return [];
  const inBrowserApp = rel.startsWith("app/src/");
  const found = [];
  text.split("\n").forEach((line, i) => {
    const at = `${rel}:${i + 1}`;
    for (const [re, what] of HOSTS) if (re.test(line)) found.push(`${at}  ${what}`);
    if (CALLS.test(line)) found.push(`${at}  model call outside the gateway`);
    const pkg = IMPORT.exec(line)?.[1];
    if (pkg && PROVIDER_PACKAGE.test(pkg)) {
      if (!(inBrowserApp && UI_PACKAGES.has(pkg))) found.push(`${at}  model SDK import (${pkg})`);
    }
  });
  return found;
}

function scanRepo(root) {
  const bad = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      if (SKIP.has(name)) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) {
        const rel = relative(root, path).split("\\").join("/");
        bad.push(...scanSource(rel, readFileSync(path, "utf8")));
      }
    }
  })(root);
  return bad;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const bad = scanRepo(resolve(import.meta.dirname, ".."));
  if (bad.length) {
    console.error("Model calls must go through api/_ai/gateway.ts (callModel):\n" + bad.join("\n"));
    process.exit(1);
  }
  console.log("ok: no model call outside the gateway");
}
