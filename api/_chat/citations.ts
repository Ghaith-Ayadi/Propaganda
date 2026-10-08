// The model cites a source by writing a marker, [[claim:<id>]] or
// [[post:<id>]], right after the words it backs. This turns the text stream
// into text and citation events. Only sources a tool actually returned in
// this reply can be cited: a marker for anything else is dropped, so a
// made-up id never reaches the reader.

import type { Citation, ChatEvent, Ref } from "./types";

const MARKER = /^\[\[([a-z]+):([a-z0-9]{1,40})\]\]/;
// What a marker can look like before it is complete.
const PARTIAL = /^\[(\[([a-z]*(:[a-z0-9]{0,40}(\])?)?)?)?$/;

export class Sources {
  private known = new Map<string, Ref & { quote?: string }>();
  private numbers = new Map<string, number>();

  add(ref: Ref & { quote?: string }): void {
    this.known.set(`${ref.kind}:${ref.id}`, ref);
  }

  has(kind: string, id: string): boolean {
    return this.known.has(`${kind}:${id}`);
  }

  get(kind: string, id: string): (Ref & { quote?: string }) | undefined {
    return this.known.get(`${kind}:${id}`);
  }

  /** The citation for a marker, numbered in order of first use; null when the source is unknown. */
  cite(kind: string, id: string): Citation | null {
    const key = `${kind}:${id}`;
    const ref = this.known.get(key);
    if (!ref) return null;
    let n = this.numbers.get(key);
    if (n === undefined) this.numbers.set(key, (n = this.numbers.size + 1));
    return { ...ref, n };
  }
}

export class CitationStream {
  private buf = "";
  constructor(private sources: Sources) {}

  push(delta: string): ChatEvent[] {
    this.buf += delta;
    return this.drain(false);
  }

  /** The end of the text: whatever is held back is plain text after all. */
  flush(): ChatEvent[] {
    return this.drain(true);
  }

  private drain(final: boolean): ChatEvent[] {
    const out: ChatEvent[] = [];
    let text = "";
    while (this.buf) {
      const i = this.buf.indexOf("[");
      if (i < 0) {
        text += this.buf;
        this.buf = "";
        break;
      }
      text += this.buf.slice(0, i);
      this.buf = this.buf.slice(i);
      const m = MARKER.exec(this.buf);
      if (m) {
        const c = this.sources.cite(m[1], m[2]);
        if (c) {
          if (text) out.push({ type: "text", delta: text });
          text = "";
          out.push({ type: "citation", citation: c });
        }
        this.buf = this.buf.slice(m[0].length);
        continue;
      }
      if (!final && PARTIAL.test(this.buf)) break; // wait for more
      text += "[";
      this.buf = this.buf.slice(1);
    }
    if (text) out.push({ type: "text", delta: text });
    return out;
  }
}
