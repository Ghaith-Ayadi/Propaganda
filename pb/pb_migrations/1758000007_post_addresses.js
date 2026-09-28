/// <reference path="../pb_data/types.d.ts" />
// Post numbers, collection slugs and redirects: what a post's public address is
// made of. The address is /<collection slug>/<post slug> under the site's base
// path ("" on its own domain, "/@<site slug>" elsewhere).
//
//   posts.number        a per-site counter, assigned once by
//                       pb_hooks/addresses.pb.js when a post is created: never
//                       reused (a deleted post's number stays spent), never
//                       edited. Existing posts keep the id they had in the
//                       Postgres days (legacy_id); the rest follow in creation
//                       order after the highest.
//   sites.post_counter  the last number handed out. Hidden from the API.
//   collections.slug    the collection's URL segment: its name slugified,
//                       unique in its site, never one the app's own routes use.
//   post_redirects      an old address of a post (collection slug + post slug).
//                       Written by the hooks when a post that has been published
//                       changes slug or collection. Readable by anyone (the blog
//                       sends old links on with it), deletable by the site's
//                       members, never written by clients.
//
// DATA SAFETY. Only new fields, indexes and a new collection. The backfill is
// raw SQL that writes the new columns and nothing else: no content changes and
// `updated` is not bumped, so no device re-downloads a post or sees a server
// copy newer than its own drafts. The app fetches the numbers on their own.
migrate((app) => {
  // Keep in step with pb_hooks/lib/addresses.js (a migration can't require it).
  const RESERVED = ["admin", "api", "assets", "cards", "p"];
  const slugify = (text) => {
    let s = String(text || "");
    if (typeof s.normalize === "function") s = s.normalize("NFKD");
    return s
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/['’`]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
      .replace(/-+$/, "");
  };

  // ---- schema ----
  const sites = app.findCollectionByNameOrId("sites");
  sites.fields.add(new NumberField({ name: "post_counter", onlyInt: true, hidden: true }));
  app.save(sites);

  const posts = app.findCollectionByNameOrId("posts");
  posts.fields.add(new NumberField({ name: "number", onlyInt: true }));
  posts.indexes.push("CREATE UNIQUE INDEX idx_posts_site_number ON posts (site, number) WHERE number > 0");
  app.save(posts);

  const collections = app.findCollectionByNameOrId("collections");
  collections.fields.add(new TextField({ name: "slug", max: 80 }));
  collections.indexes.push("CREATE UNIQUE INDEX idx_collections_site_slug ON collections (site, slug) WHERE slug != ''");
  app.save(collections);

  const redirects = new Collection({
    name: "post_redirects", type: "base",
    // Public: the blog turns an old address into the post's current one.
    listRule: "", viewRule: "",
    // Written by pb_hooks/addresses.pb.js only. A member may drop one, e.g. to
    // free an old address for another post.
    createRule: null, updateRule: null,
    deleteRule: "site.site_members_via_site.user ?= @request.auth.id",
    fields: [
      { name: "site", type: "relation", required: true, collectionId: sites.id, cascadeDelete: true, maxSelect: 1 },
      { name: "collection", type: "text", required: true, max: 80 },
      { name: "slug", type: "text", required: true, max: 200 },
      { name: "post", type: "relation", required: true, collectionId: posts.id, cascadeDelete: true, maxSelect: 1 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_post_redirects_address ON post_redirects (site, collection, slug)",
      "CREATE INDEX idx_post_redirects_post ON post_redirects (post)",
    ],
  });
  app.save(redirects);

  // ---- backfill: new columns only ----
  const db = app.db();
  const siteRows = arrayOf(new DynamicModel({ id: "" }));
  db.newQuery("SELECT id FROM sites ORDER BY created, id").all(siteRows);

  for (const site of siteRows) {
    // Numbers: the Postgres-era id where there is one, then the others after
    // the highest, oldest first.
    const rows = arrayOf(new DynamicModel({ id: "", legacy_id: 0 }));
    db.newQuery("SELECT id, COALESCE(legacy_id, 0) AS legacy_id FROM posts WHERE site = {:s} ORDER BY created, id")
      .bind({ s: site.id })
      .all(rows);
    let last = 0;
    for (const r of rows) {
      if (r.legacy_id > 0) {
        db.newQuery("UPDATE posts SET number = {:n} WHERE id = {:id}").bind({ n: r.legacy_id, id: r.id }).execute();
        if (r.legacy_id > last) last = r.legacy_id;
      }
    }
    for (const r of rows) {
      if (!(r.legacy_id > 0)) {
        last++;
        db.newQuery("UPDATE posts SET number = {:n} WHERE id = {:id}").bind({ n: last, id: r.id }).execute();
      }
    }
    db.newQuery("UPDATE sites SET post_counter = {:n} WHERE id = {:s}").bind({ n: last, s: site.id }).execute();

    // Collection slugs, in the order the site lists its collections.
    const cols = arrayOf(new DynamicModel({ id: "", name: "" }));
    db.newQuery("SELECT id, COALESCE(name, '') AS name FROM collections WHERE site = {:s} ORDER BY position, created, id")
      .bind({ s: site.id })
      .all(cols);
    const taken = {};
    for (const word of RESERVED) taken[word] = true;
    for (const c of cols) {
      const base = slugify(c.name) || "collection";
      let slug = base;
      for (let n = 2; taken[slug]; n++) slug = base + "-" + n;
      taken[slug] = true;
      db.newQuery("UPDATE collections SET slug = {:slug} WHERE id = {:id}").bind({ slug: slug, id: c.id }).execute();
    }
  }
}, (app) => {
  // Manual rollback only. Numbers, slugs and redirects are dropped; content is
  // untouched.
  try {
    app.delete(app.findCollectionByNameOrId("post_redirects"));
  } catch (_) {}
  const posts = app.findCollectionByNameOrId("posts");
  posts.fields.removeByName("number");
  posts.indexes = posts.indexes.filter((i) => i.indexOf("idx_posts_site_number") === -1);
  app.save(posts);
  const collections = app.findCollectionByNameOrId("collections");
  collections.fields.removeByName("slug");
  collections.indexes = collections.indexes.filter((i) => i.indexOf("idx_collections_site_slug") === -1);
  app.save(collections);
  const sites = app.findCollectionByNameOrId("sites");
  sites.fields.removeByName("post_counter");
  app.save(sites);
});
