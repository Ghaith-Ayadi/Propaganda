/// <reference path="../pb_data/types.d.ts" />
// PocketBase sits behind Caddy, so every request arrives from Caddy's IP. Without
// this, per-IP rate limits share one bucket and the realtime same-IP check is
// meaningless. Caddy appends the client to X-Forwarded-For; the rightmost entry
// (useLeftmostIP=false) is the one Caddy itself saw and cannot be spoofed.
// When Cloudflare proxying (orange cloud) is turned on, switch to
// CF-Connecting-IP, or the rightmost entry becomes Cloudflare's edge.
migrate((app) => {
  const s = app.settings();
  s.trustedProxy.headers = ["X-Forwarded-For"];
  s.trustedProxy.useLeftmostIP = false;
  app.save(s);
}, (app) => {
  const s = app.settings();
  s.trustedProxy.headers = [];
  app.save(s);
});
