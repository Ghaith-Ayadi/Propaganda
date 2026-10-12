// The release notes: one Markdown file per release in the repo's release-notes/
// folder (docs/releases.md), read at build time. The same files are the GitHub
// Release bodies (.github/workflows/release.yml).

import { byVersion, versionOf } from "./current";

const files = import.meta.glob<string>("../../../release-notes/v*.md", { query: "?raw", import: "default", eager: true });
const images = import.meta.glob<string>("../../../release-notes/images/*.{png,jpg,jpeg,gif,webp,svg}", {
  query: "?url",
  import: "default",
  eager: true,
});

export type ReleaseNote = { version: string; markdown: string };

/** Newest first, by version number. */
export const RELEASE_NOTES: ReleaseNote[] = Object.entries(files)
  .map(([path, markdown]) => ({ version: versionOf(path), markdown }))
  .filter((n) => n.version)
  .sort((a, b) => byVersion(a.version, b.version));

/** A note's image path (`images/x.png`) as the URL the build serves it at. */
export function imageUrl(src: string | undefined): string | undefined {
  if (!src || !src.startsWith("images/")) return src;
  return images[`../../../release-notes/${src}`] ?? src;
}
