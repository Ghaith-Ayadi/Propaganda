// Minimal ambient types for the Analytics Engine binding so this Worker
// typechecks without pulling in the full @cloudflare/workers-types package.
// wrangler bundles with esbuild (types stripped), so this is editor-only.

interface AnalyticsEngineDataPoint {
  indexes?: (string | ArrayBuffer)[];
  blobs?: (string | ArrayBuffer | null)[];
  doubles?: number[];
}

interface AnalyticsEngineDataset {
  writeDataPoint(event?: AnalyticsEngineDataPoint): void;
}
