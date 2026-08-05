import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Side-effect: reads localStorage, applies `.dark-mode` class to <html>
// before first paint so there's no flash.
import "./lib/theme";

// Installed-PWA entry point: the app is the writing tool, so when it's launched
// standalone onto the public reader root ("/"), bounce to the admin editor.
// This is robust even if an older install cached the pre-/admin start_url.
if (typeof window !== "undefined") {
  const path = window.location.pathname;
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as { standalone?: boolean }).standalone === true;
  if (standalone && (path === "/" || path === "")) {
    window.location.replace("/admin" + window.location.hash);
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
