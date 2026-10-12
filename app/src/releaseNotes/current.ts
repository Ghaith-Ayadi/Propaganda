// Which release this build carries, from the release notes' file names alone
// (their text stays out of the editor's bundle; notes.ts reads it for the page).
// A release can't be cut without its notes (.github/workflows/release.yml), so
// the newest file is the release being deployed.

const names = Object.keys(import.meta.glob("../../../release-notes/v*.md", { query: "?raw" }));

/** "v0.2.2" from ".../release-notes/v0.2.2.md"; "" for any other name. */
export function versionOf(path: string): string {
  const name = path.split("/").pop()!.replace(/\.md$/, "");
  return /^v\d+\.\d+\.\d+$/.test(name) ? name : "";
}

/** Sorts newest first. */
export function byVersion(a: string, b: string): number {
  const [x, y] = [a, b].map((v) => v.slice(1).split(".").map(Number));
  return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
}

export const CURRENT_RELEASE = names.map(versionOf).filter(Boolean).sort(byVersion)[0] ?? "";
