// Top-level router. Path-based:
//   /admin*  → Editor (the writing tool — hash routes within)
//   /*       → Blog   (the public reader)
//
// We pick once at mount; SPA navigation between the two zones is a full reload.

import { lazy, Suspense } from "react";

const EditorApp = lazy(() => import("./EditorApp").then((m) => ({ default: m.EditorApp })));
const BlogApp = lazy(() => import("./blog/BlogApp").then((m) => ({ default: m.BlogApp })));
const CardGallery = lazy(() => import("./shareable/CardGallery").then((m) => ({ default: m.CardGallery })));

export default function App() {
  const path = typeof window !== "undefined" ? window.location.pathname : "";
  const isAdmin = path.startsWith("/admin");
  const isCards = path.startsWith("/cards");

  return (
    <Suspense fallback={null}>
      {isAdmin ? <EditorApp /> : isCards ? <CardGallery /> : <BlogApp />}
    </Suspense>
  );
}
