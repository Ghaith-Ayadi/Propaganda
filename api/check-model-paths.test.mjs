// node --test check-model-paths.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { scanSource } from "./check-model-paths.mjs";

test("browser chat UI imports of ai and @ai-sdk/react are allowed under app/src", () => {
  assert.deepEqual(scanSource("app/src/lib/chat/useChat.ts", `import { useChat } from "@ai-sdk/react";`), []);
  assert.deepEqual(scanSource("app/src/lib/chat/types.ts", `import type { UIMessage } from "ai";`), []);
  assert.deepEqual(scanSource("app/src/components/chat/ChatPage.tsx", `import { DefaultChatTransport } from 'ai';`), []);
});

test("the same imports are blocked outside app/src", () => {
  assert.equal(scanSource("api/chat.ts", `import { streamText } from "ai";`).length > 0, true);
  assert.equal(scanSource("worker/src/x.ts", `import { useChat } from "@ai-sdk/react";`).length, 1);
});

test("provider packages and model calls are blocked everywhere, app/src included", () => {
  for (const [rel, code] of [
    ["app/src/lib/x.ts", `import { anthropic } from "@ai-sdk/anthropic";`],
    ["app/src/lib/x.ts", `import OpenAI from "openai";`],
    ["api/x.ts", `import { createGoogleGenerativeAI } from "@ai-sdk/google";`],
    ["app/src/lib/x.ts", `const r = await generateText({ model, prompt });`],
    ["app/src/lib/x.ts", `const r = streamText({ model });`],
    ["app/src/lib/x.ts", `fetch("https://api.anthropic.com/v1/messages")`],
  ]) {
    assert.equal(scanSource(rel, code).length > 0, true, `${rel}: ${code}`);
  }
});

test("the gateway itself is exempt", () => {
  assert.deepEqual(scanSource("api/_ai/gateway.ts", `import { generateText } from "ai"; generateText({});`), []);
});
