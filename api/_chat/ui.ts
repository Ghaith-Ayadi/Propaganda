// The agent's events as the AI SDK's UI message chunks (what useChat reads),
// and the same chunks folded into the message the server stores, so what is
// saved is what the reader saw.
//
// A data part re-sent with the same id replaces the earlier one: that is how a
// hand-off moves from running to done.

import type { ChatChunk, ChatEvent, ChatUIMessage } from "./types";

export class UiReply {
  readonly message: ChatUIMessage;
  private textId: string | null = null;
  private textIndex = -1;

  constructor(
    private send: (chunk: ChatChunk) => void,
    private newId: () => string,
    messageId: string,
  ) {
    this.message = { id: messageId, role: "assistant", parts: [], metadata: {} };
    this.emit({ type: "start", messageId });
  }

  private emit(chunk: ChatChunk): void {
    this.send(chunk);
  }

  private endText(): void {
    if (!this.textId) return;
    this.emit({ type: "text-end", id: this.textId });
    this.textId = null;
  }

  private text(delta: string): void {
    if (!this.textId) {
      this.textId = this.newId();
      this.emit({ type: "text-start", id: this.textId });
      this.message.parts.push({ type: "text", text: "" });
      this.textIndex = this.message.parts.length - 1;
    }
    this.emit({ type: "text-delta", id: this.textId, delta });
    const part = this.message.parts[this.textIndex];
    if (part.type === "text") part.text += delta;
  }

  /** A transient title for a new conversation: shown, never stored. */
  title(title: string): void {
    this.emit({ type: "data-title", data: { title }, transient: true });
  }

  push(e: ChatEvent): void {
    switch (e.type) {
      case "text":
        this.text(e.delta);
        break;
      case "citation": {
        const { n } = e.citation;
        this.text(`[${n}](#cite-${n})`);
        // A source cited again keeps its first number and part.
        const id = `cite-${e.citation.kind}-${e.citation.id}`;
        if (!this.message.parts.some((p) => p.type === "data-citation" && p.id === id)) {
          this.emit({ type: "data-citation", id, data: e.citation });
          this.message.parts.push({ type: "data-citation", id, data: e.citation });
        }
        break;
      }
      case "handoff": {
        this.endText();
        this.emit({ type: "data-handoff", id: e.id, data: e.handoff });
        const i = this.message.parts.findIndex((p) => p.type === "data-handoff" && p.id === e.id);
        const part = { type: "data-handoff" as const, id: e.id, data: e.handoff };
        if (i < 0) this.message.parts.push(part);
        else this.message.parts[i] = part;
        break;
      }
      case "action": {
        this.endText();
        const id = this.newId();
        this.emit({ type: "data-action", id, data: e.action });
        this.message.parts.push({ type: "data-action", id, data: e.action });
        break;
      }
      case "done":
        this.endText();
        this.message.metadata = { ...this.message.metadata, costUsd: e.costUsd };
        this.emit({ type: "finish", messageMetadata: { costUsd: e.costUsd } });
        break;
      case "error":
        this.endText();
        this.emit({ type: "error", errorText: e.message });
        break;
    }
  }

  /** The reader stopped the reply: what arrived is kept, marked stopped. */
  stopped(): void {
    this.endText();
    this.message.metadata = { ...this.message.metadata, stopped: true };
    this.emit({ type: "abort" });
  }
}
