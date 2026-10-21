// callModel streams, so a mock written as doGenerate answers the stream the same way.
import { MockLanguageModelV3 as Base, simulateReadableStream } from "ai/test";

/** The stream a doGenerate answer makes. */
export function streamFromGenerate(doGenerate) {
  return async (opts) => {
    const r = await doGenerate(opts);
    const parts = [{ type: "stream-start", warnings: r.warnings ?? [] }];
    r.content.forEach((c, i) => {
      const kind = c.type === "reasoning" ? "reasoning" : "text";
      parts.push({ type: `${kind}-start`, id: String(i) }, { type: `${kind}-delta`, id: String(i), delta: c.text }, { type: `${kind}-end`, id: String(i) });
    });
    parts.push({ type: "finish", finishReason: r.finishReason, usage: r.usage, providerMetadata: r.providerMetadata });
    return { stream: simulateReadableStream({ chunks: parts }) };
  };
}

export class MockLanguageModelV3 extends Base {
  constructor(o = {}) {
    super(o.doGenerate && !o.doStream ? { ...o, doStream: streamFromGenerate(o.doGenerate) } : o);
  }
}
