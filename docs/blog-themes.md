# Blog themes

Themed templates for the public blog: four pages (Home, Collection, Post, Author), six
built-in themes, per-page options, and custom themes as site data. The design record,
with the reasoning, the audiences and the harness numbers, is
[proposals/blog-themes](proposals/blog-themes/README.md).

## Which renderer a site gets

A site with no published design keeps the original blog (`blog/components/`), untouched.
Publishing a design from **Settings → Design** switches it to the themed templates;
**Use the original blog** in the same place switches it back. `BlogApp.tsx` decides from
the `blog.design` setting, after settings load.

## Where things live

| | |
|---|---|
| `app/src/blog/theme/compile.ts` | Theme API v1 compiler: validates and clamps a theme, derives the palette with contrast guarantees, builds the type scale, returns `--pg-*` custom properties and frame attributes |
| `app/src/blog/theme/themes.ts` | The six built-in themes (Rubric, Edition, Ledger, Manual, Plate, Almanac) |
| `app/src/blog/theme/schema.ts` | Page options (enums and booleans only), defaults, `resolveDesign` (defaults ← theme presets ← site overrides) |
| `app/src/blog/theme/vm.ts` | View models: fallbacks, `data-len` hints, dates, reading times, post numbers |
| `app/src/blog/theme/Site.tsx` | The templates and components. Classes and `data-part` attributes are the styling contract |
| `app/src/blog/theme/pg.css` | Component CSS, reading only `--pg-*` tokens, in cascade layers `pg.base`, `pg.components`, `pg.theme`, `pg.custom` |
| `app/src/blog/theme/Themed.tsx` | The live themed blog: settings, posts, routes, preview frame |
| `app/src/blog/theme/design.ts` | Setting keys, theme lookup, compile cache |
| `app/src/components/design/DesignStudio.tsx` | The Design editor |
| `app/public/fonts/pg/` | The built-in themes' fonts: SIL OFL, Latin subsets, licences alongside |

## Site data (`app_settings`, per site, public read)

| Key | Value |
|---|---|
| `blog.design` | The published design: `{ api: 1, theme, overrides }`. Absent: the original blog |
| `blog.design.draft` | What the Design editor is editing; the blog shows it only at `?pg-preview=draft` |
| `blog.themes` | The site's custom themes: `{ [id]: ThemeSource }` |
| `author.avatar`, `author.links` | Author photo (uploaded through `api/upload.ts`) and `[{ label, url }]` |
| `site.tagline` | One line under the site name; falls back to `author.tagline` |

`overrides` holds only what differs from the theme, per template and section, e.g.
`{ "home": { "feed": { "layout": "rows", "card": "summary" } } }`. Invalid values are
dropped when the design resolves, never fatal.

## Routes

`/` home, `/<collection slug>` a collection, `/<collection slug>/<post slug>` a post,
`/author` the author page. `author`, `feed`, `rss`, `search` and `tags` are reserved first
segments (`app/src/lib/slug.ts`; the server-side list in `private.reserved_collection_slugs()` still needs the same words, a migration waiting for the owner's go-ahead): no collection gets one.
Old `/p/<slug>` links forward as before. The original blog shows its home for collection
and author addresses.

## Custom themes

A custom theme is site data, in the same format as the built-in ones plus two fields:

- `fonts.custom`: `{ [family]: { src?, format?, weight?, style?, stack?, avgChar? } }`. A
  family with `src` gets an `@font-face`; one without is expected on the reader's system
  or already loaded by the page. `avgChar` (average character width in em) keeps line
  lengths right.
- `brand`: `{ logo?, wordmark? }`. A logo shows before the site name; with `wordmark:
  true` the logo is the name.

There is no upload UI and no validation beyond what the compiler clamps, on purpose (that
is Part 2). To install one, open the editor signed in to the site and run, in the
browser console:

```js
await propaganda.installTheme("/themes/verbatim.json") // a URL, or a theme object
propaganda.themes()                                    // the site's custom themes
await propaganda.removeTheme("verbatim")
```

Installing only adds the theme to **Settings → Design**; the blog changes when a design
using it is published. A custom theme's id can't be a built-in one's.

**Verbatim**: `app/public/themes/verbatim.json` is Verbatim's look as a custom theme
(Roslindale headlines, Charter prose, Geist for the interface, the wordmark from
`public/brand/verbatim.svg`). Roslindale is licensed to Verbatim only, which is why this
is not a public theme. Nothing has been installed on the live site; that, and publishing
it, is the owner's call.

## Preview frame

The Design editor shows the real blog in an iframe at `?pg-preview=draft`. It posts every
change (`{ type: "pg-preview", design, theme? }`) and page switches
(`{ type: "pg-preview-go", path }`) to the frame, which accepts them only from the app's
origin or its own; the frame reports `pg-preview-ready` and the template it shows
(`pg-preview-route`). Page views in the frame aren't counted.

## Testing

- `node app/scripts/pg-fuzz.cjs compiler 2000`: random themes, including out-of-range
  values and unreadable colours, through the real compiler; every one must keep its
  contrast guarantees.
- `app/scripts/pg-harness.cjs`: a build with `VITE_PG_HARNESS=1` (or `vite dev`) serves
  `/_pg/harness`, fixtures without a network. The script renders every theme x template x
  fixture x width (320 to 1440) with a pairwise set of page options and checks layout
  invariants: no sideways scroll, nothing clipped or overlapping, contrast, tap targets,
  minimum text size, heading order, landmarks, image alt text, line length. `--themes=`
  runs random themes from `pg-fuzz.cjs themes`.
- Body text is never under 15px. A text face too wide to fit a comfortable phone line at
  that size (a monospace, say) gets short lines on phones instead; the compiler reports it,
  and only then does the harness accept phone lines down to 22 characters.
- CI: `.github/workflows/blog-themes.yml` runs all three on changes to the blog.

Fixture bodies are markdown (`app/src/blog/harness/fixtures.json`), converted once from the
prototype's HTML fixtures; images are painted on a canvas (`harness/paint.ts`).
