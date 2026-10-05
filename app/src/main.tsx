import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { editorRedirect } from "./lib/siteUrl";
import { isOAuthCallback, relayOAuthResult } from "./lib/oauthCallback";
import "./index.css";

// Side-effect: reads localStorage, applies `.dark-mode` class to <html>
// before first paint so there's no flash.
import "./lib/theme";

// Pages that belong somewhere else, sent there before anything renders:
//   - Installed-PWA entry point: the app is the writing tool, so when it's
//     launched standalone onto the public reader root ("/"), bounce to the
//     admin editor. Robust even if an older install cached the pre-/admin
//     start_url.
//   - The editor on a blog's subdomain goes to the app host, and the app
//     host's root is the editor (lib/siteUrl.ts).
function redirectTarget(): string | null {
  if (typeof window === "undefined") return null;
  const path = window.location.pathname;
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as { standalone?: boolean }).standalone === true;
  if (standalone && (path === "/" || path === "")) return "/admin" + window.location.hash;
  return editorRedirect();
}

const target = isOAuthCallback() ? null : redirectTarget();
if (isOAuthCallback()) {
  // The Google popup's last stop: hand the code to the window that asked.
  relayOAuthResult();
} else if (target) {
  window.location.replace(target);
} else {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
