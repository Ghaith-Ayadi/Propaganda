// Top-level router. Path-based:
//   /admin*  → Editor (the writing tool — hash routes within)
//   /*       → Blog   (the public reader)
//   /_pg/harness → the blog themes' test page (dev and harness builds only)
//
// We pick once at mount; SPA navigation between the two zones is a full reload.

import { lazy, Suspense } from "react";

const EditorApp = lazy(() => import("./EditorApp").then((m) => ({ default: m.EditorApp })));
const BlogApp = lazy(() => import("./blog/BlogApp").then((m) => ({ default: m.BlogApp })));
const CardGallery = lazy(() => import("./shareable/CardGallery").then((m) => ({ default: m.CardGallery })));
// The blog themes' conformance harness (app/scripts/pg-harness.mjs): dev builds and VITE_PG_HARNESS builds only.
const HARNESS = import.meta.env.DEV || !!import.meta.env.VITE_PG_HARNESS;
const Harness = HARNESS ? lazy(() => import("./blog/harness/Harness").then((m) => ({ default: m.Harness }))) : null;

export default function App() {
  const path = typeof window !== "undefined" ? window.location.pathname : "";
  const isAdmin = path.startsWith("/admin");
  const isCards = path.startsWith("/cards");
  if (Harness && path.startsWith("/_pg/harness")) {
    return (
      <Suspense fallback={null}>
        <Harness />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={null}>
      {isAdmin ? <EditorApp /> : isCards ? <CardGallery /> : <BlogApp />}
    </Suspense>
  );
}
