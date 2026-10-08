# Prototype and harness

A working sketch of the proposal in `../README.md`. It is plain HTML, CSS and JavaScript,
so the markup, stylesheet and theme format can be read directly and ported to React.
It is not part of the app build.

## Open it

`dist/prototype.html` is self-contained (fonts and images included). Open it in any
browser. Use the left column to pick a theme, a page, the content (sample, edge cases,
empty), a width, and the page options. Links inside the preview navigate between pages.

## Rebuild

```sh
python3 build.py          # writes dist/prototype.html and dist/embed.html
```

`build.py` inlines `fonts/*.woff2` (OFL, subset to Latin; licences alongside),
`site.css`, `engine.js`, `fixtures.js` and `shell.html`.

## Run the harness

Needs Node and Playwright with Chromium.

```sh
node harness.js dist/embed.html out/            # full matrix
node harness.js dist/embed.html out/ --quick    # 2 widths, 4 option sets per template
```

Results go to `out/harness-results.json`. The exit code is 1 when any check fails.
`embed.html` renders one page per call to `window.PPGD.render(state)`, where state is
`{ theme, fixture, route: { tpl }, overrides }`. The harness drives it at each viewport
width.

## Fonts

The font subsets were made with `pyftsubset`, keeping all name records (copyright and
licence fields). They cover U+0000–017F plus common punctuation. Sources: the Fontshare
downloads of Crimson Pro, Epilogue, Public Sans, JetBrains Mono, Red Hat Display,
Azeret Mono, Sora, Lora and Plus Jakarta Sans, all SIL OFL 1.1. See
the `*-OFL.txt` files.
