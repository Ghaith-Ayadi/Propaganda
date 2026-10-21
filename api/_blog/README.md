`dist/` is the blog's rendering bundle (`api/blog.ts` loads `dist/entry.js`), built by
`app/vite.ssr.config.ts` as the last step of the app's build and never committed.
Its source is `app/src/blog/server/`.
