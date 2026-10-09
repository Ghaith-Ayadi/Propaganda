// UI preview mode: the 0.2 screens on example data.
//
// Off unless the build sets VITE_UI_PREVIEW=1 (`npm run dev:ui`). Only then do
// the pages fall back to their placeholder adapters (fictional tenants such as
// Ledgerline and Tidewell). Everywhere else, localhost against a real server
// included, every page reads the tenant's own data and shows an empty state
// when there is none: a tenant never sees sample content.

export const UI_PREVIEW = import.meta.env.VITE_UI_PREVIEW === "1";
