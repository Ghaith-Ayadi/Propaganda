# The blog, rendered on the server

Every public blog page is answered with real HTML: the post's text, its title and
description, canonical and Open Graph tags, JSON-LD, and per site a `sitemap.xml`, a
`feed.xml` (RSS) and a `robots.txt`. Before this, every address on every blog host served
the app's shell and the browser fetched the post, so crawlers saw a page titled
"Propaganda" and nothing else.

## How a request travels

1. Caddy on the box (Bedrock `compose/sites/propaganda-blogs.caddy`,
   `propaganda-custom-domains.caddy`, `verbatim.caddy`) proxies every blog host to the
   Vercel deployment, as before, and adds `X-Propaganda-Host` with the host the reader
   asked for. Vercel only ever sees its own host, so without the header the function could
   not tell blogs apart.
2. `vercel.json` sends every request carrying that header to `api/blog.ts`, except `/api/*`
   and the files of the build (Vercel serves those first). The app host never carries the
   header, so the editor is untouched.
3. `api/blog.ts` loads the rendering bundle, `api/_blog/dist/entry.js`, and hands it the
   request. The bundle is `app/src/blog/server/` and everything it imports (React,
   `react-dom/server`, `react-markdown`, the blog's own components, the built shell and the
   blog's stylesheets as strings), built by `app/vite.ssr.config.ts` as the last step of
   `npm run build` in `app/`. It is never committed. Vercel builds the app before the
   functions, so the bundle exists when the function is bundled; the dev box builds the
   same way (`dev/up.sh`).
4. `entry.tsx` resolves the site from the host (subdomain, else custom domain), reads its
   settings, collections and published posts from PostgREST with the anonymous key (the
   same rows the browser reads, through `blog/model.ts`), and renders the page with the
   same React components the browser uses: `blog/components/` for the original blog,
   `blog/theme/` for the themed one, chosen by the `blog.design` setting as
   `BlogApp.tsx` chooses it.
5. The markup goes in `<div id="pg-ssr">` next to the empty `#root`; the shell's own
   script and stylesheet tags follow. The browser loads the app as before, and `BlogApp`
   renders nothing while the server's page is on screen, then takes it down in the same
   frame as its first real render (`TakeOver`). The themed blog's `<style id="pg-theme">`
   is the element `Themed.tsx` reuses.

## What answers what

| Address | Answer |
|---|---|
| `/`, `/author`, `/<collection>`, `/<collection>/<slug>` | The page, 200; a post or collection that does not exist, 404 with the page's own not-found markup and `noindex` |
| `/p/<slug>`, an address a published post has left | 301 to the current address (`post_redirects`, the legacy `post_id` code too) |
| `/@<slug>/…` | 301 to the same path on that site's host |
| `<slug>.propaganda.pub` when the site has a custom domain | 301 to the custom domain |
| `/robots.txt`, `/sitemap.xml`, `/feed.xml` (`/rss.xml`) | Per site. The sitemap lists collection and author pages only for themed blogs, which have them |
| `?pg-preview=draft` | The plain shell: the Design panel's draft lives in the browser |
| A host no site has | 404, "Site not found" |

Pages carry `Cache-Control: public, max-age=60` and `Vary: X-Propaganda-Host`; there is no
`s-maxage`, so Vercel's cache never serves one blog's page for another (its key would not
include the header).

## When it fails

The API unreachable, a row that will not parse: the bundle reports the error
(`api/_telemetry.ts`, PostHog) and answers its copy of the plain shell with
`X-Blog-Render: failed`, so readers get the app in the browser as before. The bundle itself
missing (a build that left `api/_blog/dist/entry.js` out): `api/blog.ts` fetches the
deployment's own static `/index.html` (no host header, so the rewrite stays out of it) and
answers that with `X-Blog-Render: unavailable`; only if that fails too is the answer a 503.
Production Caddy has no fallback of its own, so a 5xx would blank the blog. Nothing in the
browser depends on the server's page.

Settings: the server fetches only the keys it renders (`PUBLIC_SETTING_KEYS` in
`app/src/blog/server/api.ts`); a private key is never read, whatever the API allows.

## On the box: the pages as files

The function above is the slow path: it fetches a site's rows on every uncached request
(measured on Verbatim: 400 to 1100 ms of fetching for 1 to 11 ms of rendering). The fast
path is `app/src/blog/server/box.ts`, one Node process on the box (`propaganda-blog` in
Bedrock's `compose/propaganda-supabase`, bundled by `app/vite.box.config.ts`, `npm run
build:box`), which writes every public page of every site as a file that Caddy serves.
Four rules keep it out of cache trouble:

1. **A page is stored as a fragment, not a page** (`fragmentOf` in `fill.ts`): the `<html>`
   attributes, the favicon tag, the head with its styles, the markup. Nothing from the app
   build is in it. Caddy wraps it in the app's current shell when a reader asks (Bedrock's
   `compose/blog/wrap.html`, a Caddy template that only concatenates: `wrap()` in `fill.ts`
   is the same join, and the test checks it against `fillShell`). The shell's pieces come
   from the deployment itself (`BLOG_SHELL_URL`, refreshed every tick), so a deploy of the
   app invalidates no file.
2. **A site is rewritten when its rows change.** Every tick (10 s) compares a mark (row
   count and newest `updated`) of posts, collections, settings and the site row, read
   through PostgREST as the anonymous key, so only published rows are ever seen. A changed
   site is rendered whole (Verbatim: 173 pages in 1.6 s), each file written and renamed
   into place, then the paths the site no longer has are removed, and host directories of
   sites that are gone or moved domain.
3. **A missing file is never an error.** Caddy's `blog_files` snippet serves a page only
   when its file exists (and not for `?pg-preview`); everything else goes to the function
   as before. A sweep every 24 h rewrites every site regardless. A site whose render fails
   keeps its old files and is retried with backoff.
4. **The data decides, not the UI.** A publish from the editor, the plugin, a sync or an
   import all move the marks the same way.

Files under `/srv/blogs`: `shell/0.html` to `4.html` and `shell/favicon.html`;
`sites/<host>/<path>/index.html` per page, `sites/<host>/{sitemap.xml,feed.xml,rss.xml,robots.txt}`
whole; `state.json` (marks, last sweep). `<host>` is the site's canonical host; the other
answers 301 from the function. The dev box runs the same (`dev/docker-compose.yml`, `blog`),
reading the shell from the build Caddy serves. `/health` on port 3030 reports the state.

Known limit: a site is rendered whole, so a site with thousands of posts fetches them all
on every change; render single posts when one gets there.

## Working on it

- `npm run build:blog` in `app/` rebuilds only the bundle (after `vite build`, which the
  shell comes from). `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are baked in for
  whatever the function's env leaves out; `SUPABASE_URL` and `SUPABASE_ANON_KEY` in the
  function's env win (the dev box reaches its gateway by its internal name).
- Try it without a server: import `api/_blog/dist/entry.js` and call
  `handle(new Request(url, { headers: { "x-propaganda-host": "verbatim.ayadighaith.com" } }))`.
  `renderPage`, `sitemap`, `rss`, `robots`, `siteBySlug` and `dataOf` are exported for tests.
- The components the server renders must stay pure of the browser: they take the site and
  the settings as props (`blog/original.ts`, `blog/theme/input.ts`), and touch `window`
  only inside handlers or behind `typeof window`.
- Settings the server reads: `site.title`, `site.tagline`, `site.manifesto`, `author.*`,
  `favicon.url`, `blog.design`, `blog.themes`. Any allowlist of public settings must keep
  them readable without a key.
