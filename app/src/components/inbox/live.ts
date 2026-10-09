// The Inbox's live source: pitches waiting on a decision, read from the
// pipeline (lib/pipeline/store.ts, the tenant's briefs). Deciding here is the
// same decision as on the Pipeline board. Flags and knowledge items live on the
// Knowledge base pages for now.

import { fitGrade } from "@/lib/pipeline/fit";
import { approvePitch, currentBatch, isReleased, pipelineSnapshot, rejectPitch, subscribePipeline } from "@/lib/pipeline/store";
import type { PipelineSnapshot } from "@/lib/pipeline/types";
import type { InboxSnapshot, InboxSource, Pitch } from "./data";

let seen: PipelineSnapshot | null = null;
let snap: InboxSnapshot = { flags: [], batch: null, knowledge: [], notes: [] };

function snapshot(): InboxSnapshot {
  const p = pipelineSnapshot();
  if (p === seen) return snap;
  seen = p;
  const pitches: Pitch[] = p.items
    .filter((i) => i.stage === "pitched" && isReleased(i, p.batches))
    .sort((a, b) => a.publishBy.localeCompare(b.publishBy))
    .map((i) => ({
      id: i.id,
      title: i.title,
      topic: i.topics[0] ?? "",
      collection: i.collection,
      fit: fitGrade(i.reasons),
      reasons: i.reasons.filter((r) => r.counts).map((r) => r.text),
      angle: i.angle,
      outline: i.outline.map((l) => l.text),
      sources: i.sources,
      drafted: !!i.postId,
      publishOn: i.publishBy,
      decision: null,
    }));
  const batch = currentBatch(p.batches);
  snap = {
    flags: [],
    knowledge: [],
    notes: [],
    batch: pitches.length
      ? { number: batch?.number ?? 1, of: Math.max(p.batches.length, 1), due: pitches[pitches.length - 1].publishOn, pitches }
      : null,
  };
  return snap;
}

const nothing = async () => {};

export const liveInbox: InboxSource = {
  example: false,
  snapshot,
  subscribe: subscribePipeline,
  applyFix: nothing,
  contest: nothing,
  closeFlag: nothing,
  async decidePitch(id, kind, note) {
    const item = pipelineSnapshot().items.find((i) => i.id === id);
    if (!item) return;
    if (kind === "rejected") return rejectPitch(id, note);
    await approvePitch(id, {
      writerId: item.writerId,
      reviewerId: item.reviewerId,
      publishBy: item.publishBy,
      notes: note ? [{ lineId: null, text: note }] : [],
    });
  },
  rule: nothing,
};
