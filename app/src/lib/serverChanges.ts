// "Something the agents write changed on the server": the stores that read
// those tables live (lib/goals/live.ts, the Inbox badge, lib/pipeline/store.ts)
// listen here, and lib/realtime.ts says so when a change event arrives. A
// small bus of its own so the realtime module never imports the stores (the
// goals adapter stays out of the main chunk).
//
//   strategy   strategy_proposals, goal_versions
//   pipeline   briefs, content_batches

export type ServerTopic = "strategy" | "pipeline";

const subs: Record<ServerTopic, Set<(from?: string) => void>> = { strategy: new Set(), pipeline: new Set() };

export function onServerChange(topic: ServerTopic, cb: (from?: string) => void): () => void {
  subs[topic].add(cb);
  return () => void subs[topic].delete(cb);
}

/** `from` names the store that noticed, so it can skip its own news. */
export function serverChanged(topic: ServerTopic, from?: string): void {
  for (const cb of subs[topic]) cb(from);
}
