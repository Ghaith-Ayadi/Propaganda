// Runtime gate. The module is "installed" in code but only active when the
// `verbose.enabled` app setting is true — so a Propaganda instance can ship the
// code yet keep the feature dark, independent of physically removing the folder.

import { getSetting, useSetting } from "@/lib/settings";

const KEY = "verbose.enabled";

export function isVerboseEnabled(): boolean {
  return getSetting<boolean>(KEY, false) === true;
}

export function useVerboseEnabled(): boolean {
  return useSetting<boolean>(KEY, false) === true;
}
