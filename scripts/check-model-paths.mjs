// Fails when code reaches a model provider by any path other than the cost-
// logging gateway (api/_ai/gateway.ts). Run: npm run check:model-paths
// (from api/). Scans the whole repo's source, not just api/. It lives outside
// api/ because every file there is deployed as a Vercel function.
//
// Blocked everywhere outside the gateway: provider hosts, provider packages
// (@ai-sdk/anthropic, openai, ...) and model-call functions (generateText,
// streamText, ...). Allowed under app/src only: type imports from `ai` and
// `@ai-sdk/react`, plus a named allowlist of their runtime exports (the chat
// UI: useChat, DefaultChatTransport). They post to our own /api and never
// reach a provider. Namespace, default and unlisted named imports (even
// aliased) are blocked.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const GATEWAY = "api/_ai/gateway.ts";
const ALLOWED = new Set([GATEWAY, "scripts/check-model-paths.mjs", "scripts/check-model-paths.test.mjs"]);
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
const UI_RUNTIME_ALLOWED = new Set(["useChat", "DefaultChatTransport"]);
// import / export-from statements of the UI packages, across lines.
const UI_STATEMENT = /\b(import|export)\s+(type\s+)?([^;'"]*?)\s*from\s*["'](ai|@ai-sdk\/react)["']/gs;
const UI_DYNAMIC = /\bimport\s*\(\s*["'](?:ai|@ai-sdk\/react)["']\s*\)|\brequire\s*\(\s*["'](?:ai|@ai-sdk\/react)["']\s*\)/g;

/** Why a UI-package statement is not allowed, or null. `clause` is what sits between import and from. */
function uiClauseProblem(clause) {
  const c = clause.trim();
  if (!c.startsWith("{")) return "default or namespace import";
  for (const spec of c.replace(/^\{|\}$/g, "").split(",")) {
    const part = spec.trim();
    if (!part || part.startsWith("type ")) continue;
    const name = part.split(/\s+as\s+/)[0].trim();
    if (!UI_RUNTIME_ALLOWED.has(name)) return `${name} is not on the allowlist`;
  }
  return null;
}
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
  if (inBrowserApp) {
    const lineOf = (index) => text.slice(0, index).split("\n").length;
    for (const m of text.matchAll(UI_STATEMENT)) {
      if (m[2]) continue; // import type / export type: types only
      const problem = uiClauseProblem(m[3]);
      if (problem) found.push(`${rel}:${lineOf(m.index)}  ${m[4]} import: ${problem}`);
    }
    for (const m of text.matchAll(UI_DYNAMIC)) found.push(`${rel}:${lineOf(m.index)}  dynamic import of a UI package`);
  }
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
