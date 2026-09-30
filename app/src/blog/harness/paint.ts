// Harness only: deterministic pictures painted on a canvas, so the conformance
// run needs no network. Fixture bodies reference them as /_pg/img/<kind>/<seed>/<w>/<h>.jpg.
/* eslint-disable */
// @ts-nocheck
function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const cache = {};
function paint(kind, seed, w = 960, h = 640) {
  const key = `${kind}:${seed}:${w}x${h}`;
  if (cache[key]) return cache[key];
  if (typeof document === "undefined") return (cache[key] = "");
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const g = cv.getContext("2d"); const r = rng(seed);
  const grad = (y0, y1, stops) => { const gr = g.createLinearGradient(0, y0, 0, y1); stops.forEach(([o, c]) => gr.addColorStop(o, c)); return gr; };
  if (kind === "window") {
    g.fillStyle = "#c9b8a4"; g.fillRect(0, 0, w, h);
    g.fillStyle = grad(0, h, [[0, "#d8c7b1"], [1, "#a8927c"]]); g.fillRect(0, 0, w, h);
    g.save(); g.globalAlpha = 0.55; g.fillStyle = "#f7e6c4";
    for (let i = 0; i < 3; i++) { const x = w * (0.18 + i * 0.22); g.beginPath(); g.moveTo(x, 0); g.lineTo(x + w * 0.14, 0); g.lineTo(x + w * 0.34, h); g.lineTo(x + w * 0.2, h); g.closePath(); g.fill(); }
    g.restore(); g.strokeStyle = "rgba(60,44,32,.55)"; g.lineWidth = w * 0.006;
    for (let x = w * 0.08; x < w; x += w * 0.07) { g.beginPath(); g.moveTo(x, h * 0.62); g.lineTo(x + w * 0.05, h); g.stroke(); }
    g.fillStyle = "rgba(60,44,32,.6)"; g.fillRect(0, h * 0.6, w, h * 0.018);
    g.fillStyle = "#4d5b3a"; g.beginPath(); g.ellipse(w * 0.82, h * 0.5, w * 0.07, h * 0.16, -0.3, 0, 7); g.fill();
    g.fillStyle = "#8a5a3c"; g.fillRect(w * 0.78, h * 0.56, w * 0.08, h * 0.12);
  } else if (kind === "sea" || kind === "fog") {
    const fog = kind === "fog";
    g.fillStyle = grad(0, h * 0.55, fog ? [[0, "#cfd6d8"], [1, "#e6e8e4"]] : [[0, "#9fb8c9"], [1, "#e9dcc6"]]); g.fillRect(0, 0, w, h * 0.55);
    g.fillStyle = grad(h * 0.55, h, fog ? [[0, "#aab5b6"], [1, "#6f7f82"]] : [[0, "#5e8497"], [1, "#233f4f"]]); g.fillRect(0, h * 0.55, w, h * 0.45);
    g.globalAlpha = fog ? 0.25 : 0.35;
    for (let i = 0; i < 90; i++) { g.fillStyle = r() > 0.5 ? "#ffffff" : "#1c3441"; const y = h * 0.56 + r() * h * 0.44; g.fillRect(r() * w, y, w * (0.05 + r() * 0.2), 1 + r() * 2.2); }
    g.globalAlpha = 1;
    if (!fog) { g.fillStyle = "rgba(255,244,214,.85)"; g.beginPath(); g.arc(w * 0.68, h * 0.44, h * 0.06, 0, 7); g.fill(); }
    else { g.fillStyle = "#39464a"; g.beginPath(); g.moveTo(w * 0.3, h * 0.57); g.lineTo(w * 0.46, h * 0.57); g.lineTo(w * 0.43, h * 0.6); g.lineTo(w * 0.32, h * 0.6); g.fill(); g.fillRect(w * 0.36, h * 0.53, w * 0.05, h * 0.04); }
  } else if (kind === "city") {
    g.fillStyle = grad(0, h, [[0, "#f1d9b5"], [1, "#e7b98c"]]); g.fillRect(0, 0, w, h);
    const cols = ["#d9895b", "#e9c79c", "#c46a45", "#f2e3cb", "#b9b09a", "#e6a878"];
    for (let row = 0; row < 7; row++) {
      const y = h * (0.28 + row * 0.11);
      for (let x = -20; x < w; ) { const bw = 50 + r() * 110; g.fillStyle = cols[Math.floor(r() * cols.length)]; g.fillRect(x, y - r() * 40, bw, h); g.fillStyle = "rgba(90,50,30,.35)";
        for (let k = 0; k < 3; k++) g.fillRect(x + 10 + k * bw * 0.28, y + 14, bw * 0.12, 16); x += bw + 2; }
    }
    g.fillStyle = "rgba(255,255,255,.25)"; g.fillRect(0, 0, w, h * 0.22);
  } else if (kind === "field") {
    g.fillStyle = grad(0, h * 0.42, [[0, "#b9c9cf"], [1, "#e8e2cf"]]); g.fillRect(0, 0, w, h * 0.42);
    const cs = ["#8f9a55", "#b5a95e", "#6f7d44", "#c9b774", "#7e8a4d"];
    for (let i = 0; i < 9; i++) { g.fillStyle = cs[i % cs.length]; g.beginPath(); const y = h * (0.42 + i * 0.07); g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y - 20 * r(), w * 0.6, y + 30 * r(), w, y - 10); g.lineTo(w, h); g.lineTo(0, h); g.fill(); }
    g.fillStyle = "#3f4a2c"; g.fillRect(w * 0.7, h * 0.34, w * 0.006, h * 0.09); g.beginPath(); g.arc(w * 0.703, h * 0.33, h * 0.035, 0, 7); g.fill();
  } else if (kind === "table") {
    g.fillStyle = "#e9e4da"; g.fillRect(0, 0, w, h);
    g.fillStyle = grad(h * 0.35, h, [[0, "#b98e62"], [1, "#8c6541"]]); g.fillRect(0, h * 0.38, w, h);
    const obj = (x, y, rx, ry, col) => { g.fillStyle = "rgba(40,25,10,.25)"; g.beginPath(); g.ellipse(x + rx * 0.25, y + ry * 0.35, rx, ry * 0.5, 0, 0, 7); g.fill(); g.fillStyle = col; g.beginPath(); g.ellipse(x, y, rx, ry * 0.45, 0, 0, 7); g.fill(); };
    obj(w * 0.3, h * 0.66, w * 0.14, h * 0.2, "#f4f1ea"); obj(w * 0.3, h * 0.63, w * 0.06, h * 0.08, "#c9553c");
    obj(w * 0.62, h * 0.6, w * 0.07, h * 0.12, "#2f3b44"); obj(w * 0.78, h * 0.72, w * 0.09, h * 0.1, "#e2c46f");
  } else if (kind === "books") {
    g.fillStyle = "#ece6db"; g.fillRect(0, 0, w, h);
    const cs = ["#7a3b2e", "#2d4a5a", "#c9a84e", "#56663f", "#9c5c41", "#1f2a33", "#d8cbb4", "#843f52"];
    let x = w * 0.06;
    while (x < w * 0.94) { const bw = w * (0.03 + r() * 0.05), bh = h * (0.5 + r() * 0.35); g.fillStyle = cs[Math.floor(r() * cs.length)]; g.fillRect(x, h * 0.92 - bh, bw, bh); g.fillStyle = "rgba(255,255,255,.3)"; g.fillRect(x + bw * 0.2, h * 0.92 - bh * 0.8, bw * 0.6, 3); x += bw + 3; }
    g.fillStyle = "#6d5a47"; g.fillRect(0, h * 0.92, w, h * 0.08);
  } else if (kind === "portrait") {
    g.fillStyle = grad(0, h, [[0, "#c7b9a6"], [1, "#9e8d78"]]); g.fillRect(0, 0, w, h);
    g.fillStyle = "#3b2f28"; g.beginPath(); g.ellipse(w * 0.5, h * 0.4, w * 0.19, h * 0.22, 0, 0, 7); g.fill();
    g.fillStyle = "#d9b99a"; g.beginPath(); g.ellipse(w * 0.5, h * 0.44, w * 0.15, h * 0.19, 0, 0, 7); g.fill();
    g.fillStyle = "#2f3d44"; g.beginPath(); g.ellipse(w * 0.5, h * 1.02, w * 0.38, h * 0.36, 0, 0, 7); g.fill();
  } else if (kind === "mountain") {
    g.fillStyle = grad(0, h, [[0, seed % 2 ? "#e9c9a8" : "#c9d6de"], [0.6, seed % 2 ? "#f3e2cc" : "#eef1ee"], [1, "#d8d2c4"]]); g.fillRect(0, 0, w, h);
    const ridge = (base, amp, col) => { g.fillStyle = col; g.beginPath(); g.moveTo(0, h); let y = base; for (let x = 0; x <= w; x += w / 24) { y = base - amp * (0.3 + r() * 0.7) * Math.sin((x / w) * Math.PI * (1 + r())); g.lineTo(x, y); } g.lineTo(w, h); g.fill(); };
    ridge(h * 0.55, h * 0.28, "#8f97a0"); ridge(h * 0.68, h * 0.2, "#5f6a72"); ridge(h * 0.82, h * 0.12, "#3a4449");
  } else if (kind === "dune") {
    g.fillStyle = grad(0, h * 0.5, [[0, "#f2d9b7"], [1, "#f7eadb"]]); g.fillRect(0, 0, w, h);
    for (let i = 0; i < 5; i++) { g.fillStyle = ["#d9a36b", "#c98c55", "#e5b985", "#b87a47", "#d49a60"][i]; g.beginPath(); const y = h * (0.45 + i * 0.12); g.moveTo(0, y + 40); g.bezierCurveTo(w * 0.3, y - 60 * r(), w * 0.65, y + 50 * r(), w, y - 20); g.lineTo(w, h); g.lineTo(0, h); g.fill(); }
  } else if (kind === "street") {
    g.fillStyle = grad(0, h, [[0, "#b8c4cc"], [1, "#6f7479"]]); g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; ) { const bw = 80 + r() * 160, bh = h * (0.35 + r() * 0.5); g.fillStyle = ["#4b5359", "#5d666c", "#3c4247", "#6c747a"][Math.floor(r() * 4)]; g.fillRect(x, h - bh, bw, bh); g.fillStyle = "rgba(255,226,160,.55)"; for (let k = 0; k < 8; k++) g.fillRect(x + 10 + r() * (bw - 20), h - bh + 12 + r() * (bh - 40), 8, 12); x += bw + 4; }
    g.fillStyle = "#2c3034"; g.fillRect(0, h * 0.9, w, h * 0.1);
  } else if (kind === "bowl") {
    g.fillStyle = seed % 2 ? "#e8e1d6" : "#dfe5dc"; g.fillRect(0, 0, w, h);
    g.fillStyle = "rgba(60,40,20,.18)"; g.beginPath(); g.ellipse(w * 0.53, h * 0.56, w * 0.3, h * 0.36, 0, 0, 7); g.fill();
    g.fillStyle = "#f7f4ee"; g.beginPath(); g.arc(w * 0.5, h * 0.5, h * 0.36, 0, 7); g.fill();
    const cols = seed % 2 ? ["#c4452c", "#e6a33a", "#6d8f3a", "#d9683a"] : ["#7b9a3e", "#b9c96a", "#e3d7a8", "#9a3b2a"];
    for (let i = 0; i < 40; i++) { const a = r() * 7, d = r() * h * 0.26; g.fillStyle = cols[i % 4]; g.beginPath(); g.arc(w * 0.5 + Math.cos(a) * d, h * 0.5 + Math.sin(a) * d, h * (0.03 + r() * 0.05), 0, 7); g.fill(); }
  } else if (kind === "herbs") {
    g.fillStyle = grad(0, h, [[0, "#dfe6d6"], [1, "#b9c6a8"]]); g.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) { const x = w * (0.08 + r() * 0.84), y = h * (0.35 + r() * 0.5); g.strokeStyle = "#4f6b34"; g.lineWidth = 3; g.beginPath(); g.moveTo(x, h); g.quadraticCurveTo(x + 20 * (r() - 0.5), y + 40, x + 30 * (r() - 0.5), y); g.stroke();
      for (let k = 0; k < 5; k++) { g.fillStyle = ["#5f8a3c", "#7aa04c", "#3f6a2e"][k % 3]; g.beginPath(); g.ellipse(x + 30 * (r() - 0.5), y + k * 18, 16, 7, r() * 3, 0, 7); g.fill(); } }
    g.fillStyle = "#a45a3a"; g.fillRect(0, h * 0.88, w, h * 0.12);
  } else if (kind === "flat") {
    g.fillStyle = seed % 2 ? "#7f6a9b" : "#5c8a6e"; g.fillRect(0, 0, w, h);
  }
  // film grain, so flat shapes read as photographs
  const img = g.getImageData(0, 0, w, h); const px = img.data;
  for (let i = 0; i < px.length; i += 4) { const n = (r() - 0.5) * 18; px[i] += n; px[i + 1] += n; px[i + 2] += n; }
  g.putImageData(img, 0, 0);
  return (cache[key] = cv.toDataURL("image/jpeg", 0.8));
}

/** The painted data URL for a /_pg/img/… address, or the address unchanged. */
export function harnessImage(src: string): string {
  const m = src.match(/^\/_pg\/img\/(\w+)\/(\d+)\/(\d+)\/(\d+)\.jpg$/);
  return m ? paint(m[1], +m[2], +m[3], +m[4]) : src;
}
