// Verbose — daily writing-activity heatmap (optional, personal module).
//
// EXTRACTION: this whole feature lives under src/features/verbose. To remove it
// from a Propaganda distribution, delete this folder and the two call sites
// marked "VERBOSE MODULE": the install block in EditorApp.tsx and the heatmap
// mount in HomePage.tsx. The generic lib/postEvents.ts seam and the
// writing_activity SQL can stay (both are harmless no-ops without the module).

import { onScopeReset } from "@/lib/scope";
import { installRecorder } from "./record";
import { installRealtime, notifyChanged, pullAll } from "./store";
import { backfillOnce } from "./backfill";

export { VerboseActivity } from "./activity";
export { isVerboseEnabled, useVerboseEnabled } from "./flag";

let installed = false;
let teardown: Array<() => void> = [];

// Per site: a switch stops recording into the old site; the new site's Shell
// installs again if its own `verbose.enabled` setting is on.
onScopeReset(() => {
  for (const stop of teardown) stop();
  teardown = [];
  installed = false;
  notifyChanged();
});

/** Idempotent per site. Starts recording word deltas and hydrates the local cache. */
export function installVerbose(): void {
  if (installed) return;
  installed = true;
  teardown.push(installRecorder());
  teardown.push(installRealtime());
  void (async () => {
    await pullAll();
    await backfillOnce();
  })();
}
