/* Content fixtures for the prototype and the conformance harness.
   sample: a believable blog. edge: content chosen to break layouts.
   empty: a new blog with nothing published. Images are painted on a canvas
   (deterministic seeds) so the page needs no network. */
(function (global) {
  "use strict";
  const D = (y, m, d) => Date.UTC(y, m - 1, d, 9);

  /* ---------------------------------------------------------------- images */
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

  /* ---------------------------------------------------------------- sample */
  const ESSAY = `
<p>The balcony faced east, which meant the first hour of every day belonged to it. I wrote there through three winters and one very long spring, and somewhere in the fourth year I noticed that the light had started arriving before I did.</p>
<p>That is the whole essay, really. The rest is me trying to work out when a place stops being where you live and becomes where you are from.</p>
<h2>The inventory</h2>
<p>When I finally decided to go, I made a list of the things I would miss. It was shorter than I expected, and stranger: the bakery that closed at eleven because the owner liked to swim; the woman on the fourth floor who practised the same four bars of Satie every evening and never, in eleven years, got past them; the sound the tram made on the bend by the river, a sort of iron sigh.</p>
<p>Nothing on the list was a person I would lose. Everyone I loved could be visited. What I was leaving was a set of rhythms, and rhythms, it turns out, do not travel.</p>
<blockquote><p>Nothing ends. It just stops being yours.</p></blockquote>
<p>My neighbour said that when I told her, handing me a jar of quince jam through the gap in the door as if she had been waiting for the occasion. I have thought about it more than anything anyone else said to me that year.</p>
<figure><img src="{{img:window:11}}" alt="Morning light falling across a balcony railing and a plant pot"><figcaption>The balcony on the last morning. The plant stayed.</figcaption></figure>
<h2>What staying costs</h2>
<p>People talk about the courage it takes to leave. Fewer talk about the slow, quiet cost of staying past the point where a place is still teaching you anything. I had become very good at my city. I knew which side of the street stayed cool in August and which café would let me sit for three hours on one coffee. I had stopped being surprised, and a writer who has stopped being surprised is in some trouble.<sup><a href="#fn1" id="fnref1">1</a></sup></p>
<p>So I made a second list, of the things I would not miss:</p>
<ul><li>The version of me who answered “same as ever” when anyone asked what was new.</li><li>Knowing, to the minute, how long every errand would take.</li><li>The feeling that the year had already been written and I was only reading it back.</li></ul>
<hr>
<p>I left on a Tuesday, on the early train, with two bags and the jam. The light came up over the river as we crossed it, the way it always had, and for the first time in years I was not there to meet it. It did not seem to mind.</p>
<section class="footnotes"><ol><li id="fn1"><p>A friend who edits novels says the same about characters: once they stop being surprised by their own lives, the book is over. <a href="#fnref1">↩</a></p></li></ol></section>`;

  const short = (a, b) => `<p>${a}</p><p>${b}</p>`;
  const sample = {
    site: {
      name: "Slow Weather", host: "slowweather.propaganda.pub", lang: "en",
      tagline: "Essays and notes on staying, leaving, and ordinary days.",
      manifesto: "Essays and notes on staying put, leaving anyway, and the small machinery of ordinary days. Written slowly, published when finished.",
    },
    author: {
      name: "Ines Varga", tagline: "Writes about staying and leaving.", location: "Porto",
      bio: "I write essays and short notes about places, routines and the people who keep them running. Before this I spent a decade editing guidebooks, which taught me that the best part of any city is never in the guide.\nI publish here when a piece is finished and not before. Some weeks that means three notes; some months it means nothing at all.",
      avatar: "{{img:portrait:5:480:480}}",
      links: [{ label: "Newsletter", url: "#/" }, { label: "Mastodon", url: "#/" }, { label: "Email", url: "#/" }],
    },
    collections: [
      { name: "Essays", slug: "essays", description: "Longer pieces, written slowly and revised until they stop arguing back." },
      { name: "Notes", slug: "notes", description: "Short observations. Unpolished on purpose." },
      { name: "Dispatches", slug: "dispatches", description: "Letters from wherever I happen to be." },
      { name: "Reading", slug: "reading", description: "Books, and what they did to me." },
    ],
    posts: [
      { id: "p1", number: 48, slug: "on-leaving-the-city", collection: "essays", title: "On leaving the city before it leaves you", subtitle: "What eleven years of mornings taught me about staying put, and the week I finally didn’t.", date: D(2026, 9, 12), words: 612, image: { src: "{{img:window:11}}", alt: "Morning light on a balcony" }, body: ESSAY },
      { id: "p2", number: 47, slug: "three-kinds-of-quiet", collection: "notes", title: "Three kinds of quiet", subtitle: "A library, a snowfall, and the minute after an argument.", date: D(2026, 9, 3), words: 240, body: short("There is the quiet of a library, which is a held breath shared by forty strangers. There is the quiet of snow, which is not silence so much as a lowering of the whole world’s voice.", "And there is the quiet after an argument, which is the loudest of the three.") },
      { id: "p3", number: 46, slug: "lisbon-in-the-heat", collection: "dispatches", title: "Lisbon, in the week of the heat", subtitle: "Shutters down at noon, the river the colour of tin, and a city that simply refused to hurry.", date: D(2026, 8, 14), words: 1840, image: { src: "{{img:city:3}}", alt: "Rooftops of Lisbon in afternoon light" }, body: short("By Wednesday the pavements were too hot to stand on for long, so everybody moved through the city in short, deliberate hops between patches of shade.", "Nobody complained. Complaining would have taken energy, and energy was the one thing the week had made precious.") },
      { id: "p4", number: 45, slug: "a-bus-driver-who-waves-at-dogs", collection: "notes", title: "A bus driver who waves at dogs", subtitle: null, date: D(2026, 7, 30), words: 180, body: short("The number 207 has a driver who lifts one hand from the wheel for every dog on the pavement. Not for people. Only dogs.", "I have ridden that bus for a year now and I still don’t know his name, but I know he has never missed one.") },
      { id: "p5", number: 44, slug: "rereading-stoner-at-forty", collection: "reading", title: "Rereading Stoner at forty", subtitle: "The saddest book I know turned out to be about something else entirely.", date: D(2026, 7, 22), words: 1210, image: { src: "{{img:books:8}}", alt: "A shelf of worn books" }, body: short("At twenty I read it as a tragedy. At forty I read it as an argument for paying attention.", "The plot has not changed. I have.") },
      { id: "p6", number: 43, slug: "the-kitchen-table", collection: "essays", title: "The kitchen table as a unit of time", subtitle: "Every table I’ve owned has measured a different part of my life.", date: D(2026, 7, 3), words: 1650, image: { src: "{{img:table:21}}", alt: "Cups and a bowl of lemons on a wooden table" }, body: short("The first was a door on two trestles. The second came from a school that was closing and still had a name carved into its underside.", "You can tell a lot about a year by what it left on the table.") },
      { id: "p7", number: 42, slug: "a-ferry-to-nowhere", collection: "dispatches", title: "A ferry to nowhere in particular", subtitle: "Forty minutes each way, fog on both banks, and nothing to do but look.", date: D(2026, 5, 27), words: 1390, image: { src: "{{img:fog:9}}", alt: "A small ferry crossing in fog" }, body: short("I bought a return ticket without looking at where the boat went. That was the point.", "Halfway across, the fog closed behind us and the far bank had not yet appeared, and for ten minutes the ferry was the only thing in the world.") },
      { id: "p8", number: 41, slug: "receipts", collection: "notes", title: "Receipts", subtitle: "A shoebox of them, kept for tax reasons, turned out to be a diary.", date: D(2026, 5, 2), words: 310, body: short("Two coffees, one croissant, a Tuesday in March. I remember exactly who the second coffee was for.", "I have kept the box, though the tax office no longer needs it.") },
      { id: "p9", number: 40, slug: "against-the-productive-walk", collection: "essays", title: "Against the productive walk", subtitle: "A walk with a purpose is just a commute with better shoes.", date: D(2026, 4, 18), words: 1320, body: short("Somewhere along the way walking became exercise, and exercise became something to measure.", "I would like to propose the opposite: a walk that counts nothing, arrives nowhere, and is over when it is over.") },
      { id: "p10", number: 39, slug: "notes-on-trains", collection: "notes", title: "Why I stopped taking notes on trains, and what I lost", subtitle: "Eleven notebooks of other people’s conversations, abandoned in a single week.", date: D(2026, 3, 11), words: 520, body: short("For years I wrote down what strangers said on trains. Then I realised I had stopped listening to the people I was travelling with.", "I miss the notebooks. I do not miss who I was when I kept them.") },
      { id: "p11", number: 38, slug: "books-i-lie-about", collection: "reading", title: "The books I lie about having read", subtitle: "A confession in four titles, and one I finished out of spite.", date: D(2026, 1, 15), words: 980, body: short("Everyone has a list. Mine starts with a Russian novel and ends with a book about bees.", "The spite one was worth it.") },
      { id: "p12", number: 37, slug: "what-the-tide-tables-dont-tell-you", collection: "essays", title: "What the tide tables don’t tell you", subtitle: "Numbers for the height of the water, none for the mood of the town.", date: D(2025, 11, 9), words: 2810, image: { src: "{{img:sea:14}}", alt: "Low sun over a wide grey sea" }, body: short("The tables give you times and heights. They say nothing about the hour when the boats sit crooked in the mud and the whole harbour smells of rope.", "That hour is the one worth planning around.") },
      { id: "p13", number: 36, slug: "a-town-with-one-traffic-light", collection: "dispatches", title: "Notes from a town with one traffic light", subtitle: "It has been red for six years. Nobody stops.", date: D(2025, 9, 3), words: 1750, image: { src: "{{img:field:4}}", alt: "Fields at the edge of a small town" }, body: short("The light was installed after a meeting nobody remembers, for a crossing nobody uses.", "It is the most beloved object in town.") },
      { id: "p14", number: 35, slug: "salt", collection: "essays", title: "Salt", subtitle: null, date: D(2025, 6, 21), words: 890, body: short("My grandmother kept salt in a wooden box by the stove, and took it by the pinch, never the spoon.", "I have tried to measure a pinch. It cannot be done.") },
    ],
  };

  /* ---------------------------------------------------------------- edge */
  const LONG_TITLE = "An exceptionally long title, of the kind people write when they cannot decide what the piece is about, which keeps going past the point where a reasonable editor would have stopped it, and then keeps going a little further still";
  const EDGE_BODY = `
<h1>A heading written as h1 inside the body, which the renderer demotes</h1>
<p>A paragraph with a very long address in it: https://example.com/an/extremely/long/path/that/never/offers/a/natural/break/point/for/the/browser/to/wrap/at/index.html?utm_source=nowhere&amp;utm_medium=everywhere and then the sentence carries on as if nothing happened.</p>
<p>Supercalifragilisticexpialidociousantidisestablishmentarianismfloccinaucinihilipilificationpneumonoultramicroscopic is one word, as far as the layout is concerned.</p>
<h2>A second-level heading that is also far too long, because headings in real posts are sometimes whole sentences with clauses and asides</h2>
<table><thead><tr><th>Year</th><th>Posts</th><th>Words</th><th>Longest</th><th>Shortest</th><th>Collections</th><th>Drafts</th><th>Notes</th></tr></thead><tbody><tr><td>2024</td><td>112</td><td>184,220</td><td>9,812</td><td>41</td><td>7</td><td>33</td><td>A column with more text than the others</td></tr><tr><td>2025</td><td>98</td><td>166,004</td><td>12,450</td><td>12</td><td>9</td><td>21</td><td>—</td></tr></tbody></table>
<pre><code>const veryLongLine = "this line of code is deliberately longer than any reasonable column so the block has to scroll sideways instead of stretching the page";</code></pre>
<ul><li>Level one<ul><li>Level two<ul><li>Level three<ul><li>Level four, with enough words to wrap onto a second line at phone width</li></ul></li></ul></li></ul></li></ul>
<blockquote><p>A quotation.</p><blockquote><p>A quotation inside a quotation, inside a post about quotations.</p></blockquote></blockquote>
<figure><img src="{{img:flat:1:2000:400}}" alt="A very wide panorama"><figcaption>A 5:1 panorama.</figcaption></figure>
<figure><img src="{{img:flat:2:400:1600}}" alt="A very tall image"><figcaption>A 1:4 portrait.</figcaption></figure>
<figure><img src="data:image/png;base64,AAAA" alt="An image that fails to load"><figcaption>This image fails to load.</figcaption></figure>
<p dir="rtl">ملاحظات حول الكتابة في الصباح الباكر قبل أن يستيقظ أحد، وهي فقرة كاملة باللغة العربية لاختبار الاتجاه من اليمين إلى اليسار.</p>
<p>🔥🔥🔥 A paragraph that starts with emoji. <code>inline_code_that_is_also_rather_long_and_unbroken_for_no_good_reason</code></p>
<hr>
<p>The end.<sup><a href="#fe1" id="fer1">1</a></sup></p>
<section class="footnotes"><ol><li id="fe1"><p>A footnote. <a href="#fer1">↩</a></p></li></ol></section>`;

  function edgeFixture() {
    const cols = [
      { name: "🌱 Garden", slug: "garden", description: "" },
      { name: "Collected Correspondence, Marginalia and Miscellaneous Fragments of Uncertain Provenance", slug: "correspondence", description: "A description long enough to wrap onto several lines at every width: letters received and not answered, notes found inside second-hand books, and the occasional postcard from someone who signed only with an initial and a drawing of a fish." },
      { name: "Empty", slug: "empty", description: "A collection with no posts in it." },
      { name: "One", slug: "one", description: "Exactly one post." },
      { name: "ملاحظات", slug: "mulahazat", description: "مجموعة بعنوان عربي." },
      { name: "日本語ノート", slug: "nihongo", description: "" },
      { name: "Q", slug: "q", description: "" },
      { name: "Archive 2009–2014", slug: "archive", description: "" },
      { name: "Links", slug: "links", description: "" },
      { name: "Photographs", slug: "photos", description: "" },
      { name: "Talks", slug: "talks", description: "" },
      { name: "Misc.", slug: "misc", description: "" },
    ];
    const titles = [
      LONG_TITLE,
      "Supercalifragilisticexpialidociousantidisestablishmentarianismfloccinaucinihilipilification",
      "https://example.com/an/extremely/long/path/that/does/not/break/naturally/index.html",
      "🔥🔥🔥",
      "",
      "ملاحظات حول الكتابة في الصباح الباكر قبل أن يستيقظ أحد",
      "東京の雨の日に書いた短いメモと、その後で考えたこと",
      "A",
      "Normal title for contrast",
      "Another ordinary title, of ordinary length",
    ];
    const deks = [
      null,
      "A subtitle that runs far past the length anyone intended, because the writer pasted the first paragraph into the subtitle field and never went back to trim it. It keeps going with clauses, qualifications, a parenthetical remark (which itself goes on for a while), and then a final thought that should really have been its own sentence, maybe its own post, and possibly its own collection. Still going. The end is near. Almost there. Done.",
      "Short.",
      "https://example.com/a/subtitle/that/is/only/a/link/with/no/spaces/at/all",
      null,
    ];
    const imgs = [null, "{{img:flat:1:2:2}}", "{{img:flat:2:400:1600}}", "{{img:flat:1:2000:400}}", "data:image/png;base64,AAAA", "{{img:sea:14}}", null];
    const words = [0, 1, 250000, null, 1200, 45];
    const slugs = cols.map((c) => c.slug).filter((s) => s !== "empty");
    const posts = [];
    for (let i = 0; i < 64; i++) {
      const col = i === 0 ? "correspondence" : i === 5 ? "one" : slugs[(i * 7) % slugs.length] === "one" ? "garden" : slugs[(i * 7) % slugs.length];
      posts.push({
        id: `e${i}`, number: i === 3 ? 99999 : 900 - i, slug: `edge-${i}`, collection: col,
        title: titles[i % titles.length], subtitle: deks[i % deks.length],
        date: i % 9 === 4 ? null : D(2026 - Math.floor(i / 6), 12 - (i % 12), 1 + (i % 27)),
        words: words[i % words.length], image: imgs[i % imgs.length] ? { src: imgs[i % imgs.length], alt: "" } : null,
        body: EDGE_BODY,
      });
    }
    return {
      site: {
        name: "The Extraordinarily Long-Named Society for the Preservation of Unfinished Sentences and Other Loose Ends", host: "a-very-long-subdomain-name-for-testing.propaganda.pub", lang: "en",
        tagline: "A tagline that goes on for quite a while because nobody could agree on which half to cut, so both halves stayed and now it wraps.",
        manifesto: "A manifesto that is far too long for the space a manifesto usually gets. It was written in one sitting, late, and never edited, so it wanders: from why the blog exists, to what it will and will not publish, to a list of influences, to an apology for the list, to a promise about frequency that has already been broken twice, to a closing line that tries to tie it together and mostly succeeds, followed by a postscript nobody asked for about the font, the colours, the cat, and the unreasonable number of collections.",
      },
      author: { name: "Aleksandra Wolfeschlegelsteinhausenbergerdorff-Montgomery", tagline: "", location: "", bio: "", avatar: null, links: [] },
      collections: cols,
      posts,
    };
  }

  const empty = {
    site: { name: "New blog", host: "new-blog.propaganda.pub", lang: "en", tagline: "", manifesto: "" },
    author: { name: "", tagline: "", location: "", bio: "", avatar: null, links: [] },
    collections: [{ name: "Notes", slug: "notes", description: "" }],
    posts: [],
  };

  /* ------------------------------------------------------------ engineering */
  const POOL = `
<p>In March we replaced one connection pool per worker with a single shared pool of 64 connections in front of PgBouncer. Throughput went up by about a fifth. Two weeks later our p99 on the checkout path had doubled, and nothing in the dashboards said why.</p>
<p>This is the write-up: what changed, how we found it, and the one-line fix that turned out to be the least interesting part.</p>
<h2>The change</h2>
<p>Each worker used to open its own <code>pgxpool</code> with eight connections. With 40 workers that meant 320 server connections at peak, most of them idle. The new setup shares one pool per host:</p>
<pre><code>pool, err := pgxpool.NewWithConfig(ctx, &amp;pgxpool.Config{
    ConnConfig:        connCfg,
    MaxConns:          64,
    MinConns:          8,
    MaxConnIdleTime:   30 * time.Second,
    HealthCheckPeriod: 15 * time.Second,
})
if err != nil {
    return fmt.Errorf("configure pool: %w", err)
}</code></pre>
<p>On paper this is strictly better: fewer connections, better reuse, less memory on the database.</p>
<h2>What the traces showed</h2>
<p>Every slow request spent 40–180 ms inside <code>pool.Acquire()</code> before running a query that took 3 ms. The pool was not too small on average. It was too small for about 400 ms at a time, whenever the batch export woke up and took 50 connections for long-running reads.</p>
<table><thead><tr><th>Configuration</th><th>p50</th><th>p99</th><th>Acquire wait (p99)</th><th>Server connections</th></tr></thead><tbody><tr><td>Per-worker pools</td><td>18 ms</td><td>94 ms</td><td>0.2 ms</td><td>320</td></tr><tr><td>Shared pool, 64</td><td>15 ms</td><td>211 ms</td><td>162 ms</td><td>64</td></tr><tr><td>Shared pool + export pool</td><td>15 ms</td><td>81 ms</td><td>0.4 ms</td><td>80</td></tr></tbody></table>
<h2>The fix</h2>
<p>Give the batch export its own small pool, so it can never starve interactive requests:</p>
<pre><code>-- Also cap it on the server side, in case someone reuses the wrong pool.
ALTER ROLE export_worker CONNECTION LIMIT 16;</code></pre>
<blockquote><p>A shared resource needs a shared understanding of who is allowed to hold it, and for how long.</p></blockquote>
<h2>What we changed in how we work</h2>
<ol><li>Every pool exports its acquire-wait histogram, not just its size.</li><li>Batch jobs get their own pool and their own database role.</li><li>Load tests include one noisy neighbour, on purpose.</li></ol>
<p>The fix was one line of SQL and twelve lines of Go. Finding it took nine days, most of which went into dashboards that measured the wrong thing.</p>`;
  const TIL_BODY = (a, b, c) => `<p>${a}</p><pre><code>${c}</code></pre><p>${b}</p>`;
  const engineering = {
    site: { name: "Tail Latency", host: "tail-latency.propaganda.pub", lang: "en", tagline: "Notes on databases, queues and the bugs between them.", manifesto: "Postmortems, deep dives and small things I learned the hard way. Mostly Postgres, Go and the network in between." },
    author: { name: "Priya Raman", tagline: "Staff engineer. Writes the postmortem so you don't have to.", location: "Bristol", bio: "I work on storage and reliability for a payments company. Before that I spent six years on-call for a search engine, which is where I learned to love histograms.\nThis blog is where the notes go after the incident review is over.", avatar: "{{img:portrait:9:480:480}}", links: [{ label: "GitHub", url: "#/" }, { label: "Mastodon", url: "#/" }, { label: "RSS", url: "#/" }] },
    collections: [
      { name: "Postmortems", slug: "postmortems", description: "What broke, why, and what we changed afterwards." },
      { name: "Deep dives", slug: "deep-dives", description: "Long explanations of short behaviours." },
      { name: "TIL", slug: "til", description: "Small things learned today, written down before they are forgotten." },
      { name: "Talks", slug: "talks", description: "Slides and notes from conference talks." },
    ],
    posts: [
      { id: "g1", number: 61, slug: "p99-doubled-after-pool-change", collection: "postmortems", title: "Why our p99 doubled after the connection-pool change", subtitle: "A shared pool, a batch job, and nine days of looking at the wrong dashboard.", date: D(2026, 9, 14), words: 2380, body: POOL },
      { id: "g2", number: 60, slug: "til-psql-watch", collection: "til", title: "TIL: \\watch in psql re-runs the last query", subtitle: "A poor engineer's dashboard, in one backslash command.", date: D(2026, 9, 8), words: 210, body: TIL_BODY("If you end a query with <code>\\watch 2</code> instead of a semicolon, psql runs it every two seconds.", "It is my favourite way to watch a migration or a queue drain.", "SELECT state, count(*) FROM pg_stat_activity GROUP BY state \\watch 2") },
      { id: "g3", number: 59, slug: "how-vacuum-actually-works", collection: "deep-dives", title: "How VACUUM actually decides what to clean", subtitle: "Visibility maps, the xmin horizon, and why one idle transaction can bloat a table.", date: D(2026, 8, 21), words: 4120, body: TIL_BODY("VACUUM can only remove a dead row once no running transaction could still see it.", "One forgotten <code>BEGIN</code> in a psql session holds back the horizon for the whole cluster.", "SELECT pid, now() - xact_start AS age, state\nFROM pg_stat_activity\nWHERE xact_start IS NOT NULL\nORDER BY age DESC\nLIMIT 5;") },
      { id: "g4", number: 58, slug: "til-go-context-afterfunc", collection: "til", title: "TIL: context.AfterFunc", subtitle: "Run cleanup when a context is cancelled, without a goroutine per request.", date: D(2026, 8, 2), words: 180, body: TIL_BODY("Go 1.21 added <code>context.AfterFunc</code>, which registers a function to run once the context is done.", "It replaced a surprising number of hand-rolled goroutines in our codebase.", "stop := context.AfterFunc(ctx, func() {\n    conn.Close()\n})\ndefer stop()") },
      { id: "g5", number: 57, slug: "queue-that-lost-messages", collection: "postmortems", title: "The queue that lost 0.01% of messages", subtitle: "An at-least-once system, an at-most-once consumer, and a retry that wasn't.", date: D(2026, 7, 10), words: 1980, body: TIL_BODY("The broker delivered every message. Our consumer acknowledged before processing, so a crash in between dropped the work.", "Moving the acknowledgement after the side effect fixed it, and exposed three handlers that were not idempotent.", "msg := <-deliveries\nif err := handle(msg); err != nil {\n    msg.Nack(false, true) // requeue\n    continue\n}\nmsg.Ack(false)") },
      { id: "g6", number: 56, slug: "histograms-not-averages", collection: "talks", title: "Histograms, not averages", subtitle: "Slides and notes from my talk at a regional SRE meetup.", date: D(2026, 6, 18), words: 1450, body: TIL_BODY("The mean latency of a service is a number that describes no request that ever happened.", "The talk walks through three incidents where the average looked fine and the histogram did not.", "histogram_quantile(0.99,\n  sum by (le) (rate(http_request_duration_seconds_bucket[5m])))") },
      { id: "g7", number: 55, slug: "til-git-bisect-run", collection: "til", title: "TIL: git bisect run", subtitle: "Let a script find the commit that broke the build.", date: D(2026, 5, 29), words: 160, body: TIL_BODY("<code>git bisect run</code> takes a command and uses its exit code to decide good or bad.", "It found a regression across 340 commits in eleven minutes.", "git bisect start HEAD v2.4.0\ngit bisect run go test ./payments/...") },
      { id: "g8", number: 54, slug: "timeouts-all-the-way-down", collection: "deep-dives", title: "Timeouts, all the way down", subtitle: "Why a 30-second client timeout and a 60-second server timeout are a bug.", date: D(2026, 4, 12), words: 3050, body: TIL_BODY("Each layer should time out slightly before the layer that called it, or work keeps running after nobody is waiting for it.", "We now set budgets from the edge inward and pass the remaining budget along with every call.", "deadline, _ := ctx.Deadline()\nbudget := time.Until(deadline) - 50*time.Millisecond") },
      { id: "g9", number: 53, slug: "dns-ttl-outage", collection: "postmortems", title: "A DNS TTL of 86400 seconds", subtitle: "The failover worked. The clients didn't notice for a day.", date: D(2025, 12, 3), words: 1720, body: TIL_BODY("Our database failover moved the primary in 40 seconds. Half the clients kept talking to the old address until the next morning.", "The record had been created years ago with a one-day TTL and never revisited.", "dig +noall +answer db-primary.internal") },
      { id: "g10", number: 52, slug: "til-explain-buffers", collection: "til", title: "TIL: EXPLAIN (ANALYZE, BUFFERS)", subtitle: null, date: D(2025, 10, 20), words: 140, body: TIL_BODY("Adding <code>BUFFERS</code> shows how many pages a query read from cache and from disk.", "It is the fastest way to tell a slow plan from a cold cache.", "EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM orders WHERE customer_id = 42;") },
    ],
  };

  /* ------------------------------------------------------------ photography */
  const shot = (kind, seed, alt, cap, text) => `<figure><img src="{{img:${kind}:${seed}:1200:1500}}" alt="${alt}"><figcaption>${cap}</figcaption></figure><p>${text}</p>`;
  const photo = {
    site: { name: "Low Light", host: "lowlight.propaganda.pub", lang: "en", tagline: "Photographs made early, late, or in bad weather.", manifesto: "Photographs made early, late, or in bad weather." },
    author: { name: "Tomás Ferreira", tagline: "Photographer. Mostly landscapes, sometimes streets.", location: "Lisbon", bio: "I photograph places at the edges of the day, on a small camera and the occasional roll of film.\nPrints are available on request; the email address is on the about page of every good photographer and now this one.", avatar: "{{img:portrait:13:480:480}}", links: [{ label: "Prints", url: "#/" }, { label: "Instagram", url: "#/" }] },
    collections: [
      { name: "Landscapes", slug: "landscapes", description: "Deserts, coasts and mountains, mostly before breakfast." },
      { name: "Cities", slug: "cities", description: "Streets after dark." },
      { name: "Film", slug: "film", description: "Rolls of Portra and HP5, scanned at home." },
    ],
    posts: [
      { id: "f1", number: 23, slug: "salt-flats-first-light", collection: "landscapes", title: "Salt flats, first light", subtitle: "Forty minutes before sunrise the flats turn the colour of the inside of a shell.", date: D(2026, 9, 18), words: 260, image: { src: "{{img:dune:3:1200:1500}}", alt: "Pale dunes in early light" }, body: shot("dune", 3, "Pale dunes in early light", "Salt flats, 6:12 am · X100V, 23mm, f/8, 1/250", "We walked out in the dark and waited. The light arrived all at once, the way it does when there is nothing for it to climb over.") + shot("dune", 7, "Dunes with long shadows", "Twenty minutes later · f/11, 1/500", "By seven it was just a bright place.") },
      { id: "f2", number: 22, slug: "ridge-line-in-november", collection: "landscapes", title: "Ridge line in November", subtitle: "Three layers of mountain and a sky that could not decide.", date: D(2026, 8, 30), words: 180, image: { src: "{{img:mountain:4:1200:1500}}", alt: "Layered mountain ridges" }, body: shot("mountain", 4, "Layered mountain ridges", "Serra da Estrela · 90mm, f/5.6", "The haze does the work: each ridge a little lighter than the one in front.") },
      { id: "f3", number: 21, slug: "harbour-at-blue-hour", collection: "cities", title: "Harbour at blue hour", subtitle: null, date: D(2026, 8, 11), words: 120, image: { src: "{{img:street:5:1200:1500}}", alt: "Buildings with lit windows at dusk" }, body: shot("street", 5, "Buildings with lit windows at dusk", "Porto · f/2, 1/60, ISO 3200", "Every window a different colour temperature.") },
      { id: "f4", number: 20, slug: "fog-crossing", collection: "film", title: "Fog crossing", subtitle: "One frame from a roll of HP5 pushed to 1600.", date: D(2026, 7, 26), words: 140, image: { src: "{{img:fog:9:1200:1500}}", alt: "A ferry crossing in fog" }, body: shot("fog", 9, "A ferry crossing in fog", "HP5 at 1600 · developed in Ilfosol 3", "The grain is the point.") },
      { id: "f5", number: 19, slug: "long-walk-north-coast", collection: "landscapes", title: "A long walk on the north coast", subtitle: "Eleven kilometres, one lens, no people.", date: D(2026, 7, 2), words: 420, image: { src: "{{img:sea:22:1200:1500}}", alt: "Low sun over a wide sea" }, body: shot("sea", 22, "Low sun over a wide sea", "North coast · 35mm, f/9", "I took the same photograph eleven times and kept this one.") },
      { id: "f6", number: 18, slug: "rooftops-at-noon", collection: "cities", title: "Rooftops at noon", subtitle: null, date: D(2026, 6, 14), words: 90, image: { src: "{{img:city:8:1200:1500}}", alt: "Terracotta rooftops" }, body: shot("city", 8, "Terracotta rooftops", "Alfama · 50mm, f/8", "Hard light, for once on purpose.") },
      { id: "f7", number: 17, slug: "fields-after-rain", collection: "film", title: "Fields after rain", subtitle: "Portra 400, overexposed by a stop, as it likes.", date: D(2026, 5, 20), words: 110, image: { src: "{{img:field:11:1200:1500}}", alt: "Green fields under a pale sky" }, body: shot("field", 11, "Green fields under a pale sky", "Portra 400 · Olympus XA", "The colours only look like this on film.") },
      { id: "f8", number: 16, slug: "second-ridge", collection: "landscapes", title: "Second ridge", subtitle: null, date: D(2026, 4, 3), words: 60, image: { src: "{{img:mountain:7:1200:1500}}", alt: "Mountains at dusk" }, body: shot("mountain", 7, "Mountains at dusk", "f/8, 1/30", "Same trip, the evening after.") },
      { id: "f9", number: 15, slug: "night-tram", collection: "cities", title: "Night tram", subtitle: "The last one, 00:40, nearly empty.", date: D(2025, 12, 12), words: 80, image: { src: "{{img:street:12:1200:1500}}", alt: "A street at night" }, body: shot("street", 12, "A street at night", "f/1.8, 1/30, ISO 6400", "Handheld, braced against a lamp post.") },
    ],
  };

  /* ------------------------------------------------------------ kitchen and garden */
  const GALETTE = `
<p>This is the galette I make every week from late July until the tomatoes stop. It asks for very little: good tomatoes, bought pastry, and an hour's patience while the salt does its work.</p>
<figure><img src="{{img:bowl:3}}" alt="Sliced tomatoes in a white bowl"><figcaption>Salting the slices draws out the water that would otherwise soak the pastry.</figcaption></figure>
<h2>Ingredients</h2>
<ul><li>500 g ripe tomatoes, a mix of sizes, sliced 5 mm thick</li><li>1 tsp flaky salt</li><li>1 sheet all-butter puff pastry (about 320 g)</li><li>60 g butter</li><li>2 tbsp Dijon mustard</li><li>A handful of basil and thyme</li><li>1 egg, beaten, for the edges</li></ul>
<h2>Method</h2>
<ol><li>Lay the tomato slices on a rack, salt them, and leave for an hour.</li><li>Brown the butter in a small pan until it smells of hazelnuts. Let it cool a little.</li><li>Heat the oven to 200°C. Roll the pastry onto a lined tray and spread the mustard, leaving a 3 cm border.</li><li>Pat the tomatoes dry, overlap them on the mustard, and spoon over half the brown butter.</li><li>Fold the border over, brush with egg, and bake for 35–40 minutes until deep golden.</li><li>Finish with the rest of the butter and the herbs.</li></ol>
<blockquote><p>If the pastry is pale underneath, give it five minutes on the oven floor.</p></blockquote>
<p>It keeps for a day, but it has never had to.</p>`;
  const kitchen = {
    site: { name: "Second Helping", host: "secondhelping.propaganda.pub", lang: "en", tagline: "Recipes and a small vegetable garden, through the year.", manifesto: "Recipes, a small vegetable garden, and notes on what to do with too many courgettes." },
    author: { name: "Maren Holt", tagline: "Cooks, grows, writes it down.", location: "Kent", bio: "I cook for a family of four and grow what I can on an allotment the size of a tennis court. Everything here has been made at least three times in a normal kitchen.\nIf a recipe doesn't work for you, tell me; I would rather fix it than be right.", avatar: "{{img:portrait:17:480:480}}", links: [{ label: "Newsletter", url: "#/" }, { label: "Instagram", url: "#/" }] },
    collections: [
      { name: "Recipes", slug: "recipes", description: "Tested at least three times, in a normal kitchen." },
      { name: "Garden", slug: "garden", description: "What is growing, what failed, and what to plant next." },
      { name: "Pantry", slug: "pantry", description: "Jams, pickles and things that keep." },
    ],
    posts: [
      { id: "k1", number: 88, slug: "brown-butter-tomato-galette", collection: "recipes", title: "Brown butter tomato galette", subtitle: "Serves 4 · 1 hr 10 min. The trick is salting the tomatoes an hour ahead.", date: D(2026, 9, 10), words: 640, image: { src: "{{img:bowl:3}}", alt: "Sliced tomatoes in a bowl" }, body: GALETTE },
      { id: "k2", number: 87, slug: "september-in-the-garden", collection: "garden", title: "September on the allotment", subtitle: "Squash curing, the last beans, and sowing broad beans for spring.", date: D(2026, 9, 3), words: 780, image: { src: "{{img:herbs:4}}", alt: "Herbs growing in a bed" }, body: short("The squash are curing on the shed roof and the beans have given up for the year.", "Next weekend: broad beans in the long bed, garlic by the fence.") },
      { id: "k3", number: 86, slug: "quick-pickled-courgettes", collection: "pantry", title: "Quick-pickled courgettes", subtitle: "For when the plants will not stop.", date: D(2026, 8, 19), words: 420, image: { src: "{{img:bowl:6}}", alt: "Pickled vegetables" }, body: short("Slice them thin, salt them for twenty minutes, then cover in a warm brine of vinegar, sugar and dill.", "They are ready tomorrow and keep for a fortnight in the fridge.") },
      { id: "k4", number: 85, slug: "one-pan-lemon-chicken", collection: "recipes", title: "One-pan lemon and thyme chicken", subtitle: "Serves 4 · 50 min. Thighs, potatoes and a whole lemon, all in one tin.", date: D(2026, 8, 2), words: 560, image: { src: "{{img:table:31}}", alt: "A dinner table" }, body: short("Everything goes into one tin: halved potatoes, thighs skin side up, lemon wedges and a lot of thyme.", "Forty-five minutes at 200°C and the potatoes have soaked up everything.") },
      { id: "k5", number: 84, slug: "what-failed-this-year", collection: "garden", title: "What failed this year, and why", subtitle: "Carrots, again. And a lesson about netting.", date: D(2026, 7, 21), words: 910, image: { src: "{{img:field:15}}", alt: "Garden rows" }, body: short("The carrot fly found them in June, as it does every year I forget the fleece.", "The brassicas survived only because the pigeons preferred the neighbour's.") },
      { id: "k6", number: 83, slug: "strawberry-jam-low-sugar", collection: "pantry", title: "Low-sugar strawberry jam", subtitle: null, date: D(2026, 6, 28), words: 480, body: short("Less sugar means a softer set and a shorter shelf life, and a jam that tastes of strawberries.", "Keep it in the fridge once opened and eat it within a month.") },
      { id: "k7", number: 82, slug: "summer-herb-salad", collection: "recipes", title: "A salad that is mostly herbs", subtitle: "Serves 2 · 10 min.", date: D(2026, 6, 9), words: 300, image: { src: "{{img:herbs:9}}", alt: "Fresh herbs" }, body: short("Parsley, mint, dill and chives by the handful, with a little lettuce to hold it together.", "Dress it at the table, not before.") },
      { id: "k8", number: 81, slug: "seed-order-for-spring", collection: "garden", title: "The seed order for next spring", subtitle: "Twelve varieties, three of them new.", date: D(2026, 1, 12), words: 650, image: { src: "{{img:books:19}}", alt: "Seed packets on a shelf" }, body: short("Two new tomatoes, a climbing French bean, and another attempt at celeriac.", "The order goes in before the good ones sell out, which is now.") },
    ],
  };

  /** Replace {{img:kind:seed[:w:h]}} tokens with painted data URLs (deep). */
  function hydrate(obj) {
    const rep = (s) => s.replace(/\{\{img:(\w+):(\d+)(?::(\d+):(\d+))?\}\}/g, (_, k, seed, w, h) => paint(k, +seed, w ? +w : 960, h ? +h : 640));
    if (typeof obj === "string") return rep(obj);
    if (Array.isArray(obj)) return obj.map(hydrate);
    if (obj && typeof obj === "object") { const o = {}; for (const [k, v] of Object.entries(obj)) o[k] = hydrate(v); return o; }
    return obj;
  }
  let built = null;
  function fixtures() {
    if (!built) built = { sample: hydrate(sample), engineering: hydrate(engineering), photo: hydrate(photo), kitchen: hydrate(kitchen), edge: hydrate(edgeFixture()), empty: hydrate(empty) };
    return built;
  }
  global.PPGD_FIXTURES = { fixtures };
})(typeof window !== "undefined" ? window : globalThis);
