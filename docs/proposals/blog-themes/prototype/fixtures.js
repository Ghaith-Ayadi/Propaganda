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
    if (!built) built = { sample: hydrate(sample), edge: hydrate(edgeFixture()), empty: hydrate(empty) };
    return built;
  }
  global.PPGD_FIXTURES = { fixtures };
})(typeof window !== "undefined" ? window : globalThis);
