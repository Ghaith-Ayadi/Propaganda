// Build/deploy metadata, injected at build time by vite.config.ts. On Vercel
// the build runs at deploy time, so BUILD_TIME is effectively the last-deploy
// timestamp. Surfaced in the command palette via the "/version" command.

export const BUILD_TIME = String(import.meta.env.VITE_BUILD_TIME ?? "");
export const COMMIT_SHA = String(import.meta.env.VITE_COMMIT_SHA ?? "");
export const DEPLOY_ENV = String(import.meta.env.VITE_DEPLOY_ENV ?? "development");

/** The build/deploy time as a Date, or null if unset. */
export function buildDate(): Date | null {
  if (!BUILD_TIME) return null;
  const d = new Date(BUILD_TIME);
  return Number.isNaN(d.getTime()) ? null : d;
}
