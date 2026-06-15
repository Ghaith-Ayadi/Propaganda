// Verbose — daily writing-activity heatmap (optional, personal module).
//
// EXTRACTION: this whole feature lives under src/features/verbose. To remove it
// from a Propaganda distribution, delete this folder and the two call sites
// marked "VERBOSE MODULE": the install block in EditorApp.tsx and the heatmap
// mount in HomePage.tsx. The generic lib/postEvents.ts seam and the
// writing_activity SQL can stay (both are harmless no-ops without the module).

import { installRecorder } from "./record";
import { installRealtime, pullAll } from "./store";
import { backfillOnce } from "./backfill";

export { VerboseActivity } from "./activity";
export { isVerboseEnabled, useVerboseEnabled } from "./flag";

let installed = false;

/** Idempotent. Starts recording word deltas and hydrates the local cache. */
export function installVerbose(): void {
  if (installed) return;
  installed = true;
  installRecorder();
  installRealtime();
  void (async () => {
    await pullAll();
    await backfillOnce();
  })();
}
