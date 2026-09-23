/// <reference path="../pb_data/types.d.ts" />
// Multi-tenancy: every piece of content belongs to a Site, and people reach a
// Site through a membership (owner / editor).
//
//   sites          name, slug (the /@slug address), domain (custom host, set by
//                  a superuser only), analytics_tenant (fixed at creation).
//   site_members   (site, user, role). Written only by pb_hooks/sites.pb.js.
//   site           a required relation added to posts, post_versions,
//                  collections, briefs, brief_templates, app_settings and
//                  writing_activity.
//
// Existing data becomes the "Verbatim" site (id verbatimsite000, slug verbatim,
// domain verbatim.ayadighaith.com, analytics tenant "verbatim"), owned by the
// account that owns everything today.
//
// DATA SAFETY. This migration never deletes or rewrites content:
//   - it only ADDS collections and fields, and swaps a few indexes for their
//     per-site equivalents;
//   - the backfill is one `UPDATE ... SET site = ? WHERE site = ''` per table in
//     raw SQL: no hooks, no validation re-run over 2MB bodies, and `updated` is
//     NOT bumped, so every device's sync cursor stays valid and nothing
//     re-downloads or looks newer than a local draft;
//   - it runs inside PocketBase's migration transaction: any failure rolls the
//     whole thing back and the instance refuses to start rather than half-apply.
// Clients still running the single-tenant build keep working: pb_hooks/
// tenancy.pb.js fills `site` on creates that omit it.
migrate((app) => {
  const VERBATIM = "verbatimsite000";
  const OWNER_EMAIL = "alaarabi16@gmail.com";
  const users = app.findCollectionByNameOrId("users");

  // ---- sites ----
  const sites = new Collection({
    name: "sites", type: "base",
    // Public: the blog resolves /@slug and custom domains anonymously.
    listRule: "", viewRule: "",
    // Created and edited through /api/propaganda/sites only.
    createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "name", type: "text", required: true, max: 120 },
      { name: "slug", type: "text", required: true, max: 40, pattern: "^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$" },
      { name: "domain", type: "text", max: 253 },
      { name: "analytics_tenant", type: "text", max: 96 },
      { name: "created_by", type: "relation", collectionId: users.id, cascadeDelete: false, maxSelect: 1, hidden: true },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_sites_slug ON sites (slug)",
      "CREATE UNIQUE INDEX idx_sites_domain ON sites (domain) WHERE domain != ''",
    ],
  });
  app.save(sites);

  // ---- site_members ----
  const members = new Collection({
    name: "site_members", type: "base",
    // Your own memberships, and the other members of sites you belong to.
    listRule: 'user = @request.auth.id || site.site_members_via_site.user ?= @request.auth.id',
    viewRule: 'user = @request.auth.id || site.site_members_via_site.user ?= @request.auth.id',
    createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "site", type: "relation", required: true, collectionId: sites.id, cascadeDelete: true, maxSelect: 1 },
      { name: "user", type: "relation", required: true, collectionId: users.id, cascadeDelete: true, maxSelect: 1 },
      { name: "role", type: "select", required: true, values: ["owner", "editor"], maxSelect: 1 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_site_members_site_user ON site_members (site, user)",
      "CREATE INDEX idx_site_members_user ON site_members (user)",
    ],
  });
  app.save(members);

  // ---- the Verbatim site and its owner ----
  const verbatim = new Record(sites);
  verbatim.set("id", VERBATIM);
  verbatim.set("name", "Verbatim");
  verbatim.set("slug", "verbatim");
  verbatim.set("domain", "verbatim.ayadighaith.com");
  verbatim.set("analytics_tenant", "verbatim");
  let owner = null;
  try { owner = app.findAuthRecordByEmail(users, OWNER_EMAIL); } catch (_) {}
  if (owner) verbatim.set("created_by", owner.id);
  app.save(verbatim);

  // The owner, or on an instance without that account (a laptop, a rehearsal),
  // every existing user: they are the people who could already see everything.
  const owners = owner ? [owner] : app.findAllRecords(users);
  for (const u of owners) {
    const m = new Record(members);
    m.set("site", VERBATIM);
    m.set("user", u.id);
    m.set("role", "owner");
    app.save(m);
  }

  // ---- `site` on every content collection ----
  const member = "site.site_members_via_site.user ?= @request.auth.id";
  // Records never move between sites.
  const staysPut = "(@request.body.site:isset = false || @request.body.site = site)";
  const writeRules = (c) => {
    // `site = ""` lets a create without a site reach pb_hooks/tenancy.pb.js,
    // which fills it from the author's memberships or rejects the request.
    c.createRule = `@request.auth.id != "" && (site = "" || ${member})`;
    c.updateRule = `${member} && ${staysPut}`;
    c.deleteRule = member;
  };
  const addSite = (c) => {
    // Required, but the column is added empty and filled below. PocketBase does
    // not re-validate existing rows when a field is added.
    c.fields.add(new RelationField({
      name: "site", required: true, collectionId: sites.id, cascadeDelete: false, maxSelect: 1,
    }));
  };
  const dropIndex = (c, name) => {
    c.indexes = c.indexes.filter((i) => !i.includes(` ${name} `));
  };

  const posts = app.findCollectionByNameOrId("posts");
  addSite(posts);
  posts.listRule = `status = "published" || ${member}`;
  posts.viewRule = `status = "published" || ${member}`;
  writeRules(posts);
  posts.indexes.push("CREATE INDEX idx_posts_site_slug ON posts (site, slug)");
  posts.indexes.push("CREATE INDEX idx_posts_site_updated ON posts (site, updated)");
  app.save(posts);

  const versions = app.findCollectionByNameOrId("post_versions");
  addSite(versions);
  versions.listRule = member;
  versions.viewRule = member;
  writeRules(versions);
  versions.indexes.push("CREATE INDEX idx_versions_site_created ON post_versions (site, created)");
  app.save(versions);

  const collections = app.findCollectionByNameOrId("collections");
  addSite(collections);
  collections.listRule = "";
  collections.viewRule = "";
  writeRules(collections);
  dropIndex(collections, "idx_collections_name");
  collections.indexes.push("CREATE UNIQUE INDEX idx_collections_site_name ON collections (site, name)");
  app.save(collections);

  for (const name of ["briefs", "brief_templates"]) {
    const c = app.findCollectionByNameOrId(name);
    addSite(c);
    c.listRule = member;
    c.viewRule = member;
    writeRules(c);
    c.indexes.push(`CREATE INDEX idx_${name}_site ON ${name} (site)`);
    app.save(c);
  }

  const settings = app.findCollectionByNameOrId("app_settings");
  addSite(settings);
  settings.listRule = "";
  settings.viewRule = "";
  writeRules(settings);
  dropIndex(settings, "idx_app_settings_key");
  settings.indexes.push("CREATE UNIQUE INDEX idx_app_settings_site_key ON app_settings (site, key)");
  app.save(settings);

  const activity = app.findCollectionByNameOrId("writing_activity");
  addSite(activity);
  activity.listRule = member;
  activity.viewRule = member;
  // Written by /api/verbose/increment (superuser context) only.
  activity.createRule = null;
  activity.updateRule = null;
  activity.deleteRule = null;
  dropIndex(activity, "idx_activity_tenant_day");
  activity.indexes.push("CREATE UNIQUE INDEX idx_activity_site_day ON writing_activity (site, day) WHERE site != ''");
  activity.indexes.push("CREATE INDEX idx_activity_tenant_day ON writing_activity (tenant, day)");
  app.save(activity);

  // ---- backfill: everything that exists today is Verbatim's ----
  const fill = (table, extra) => {
    app.db()
      .newQuery(`UPDATE ${table} SET site = {:s} WHERE (site = '' OR site IS NULL)${extra || ""}`)
      .bind({ s: VERBATIM })
      .execute();
  };
  for (const t of ["posts", "post_versions", "collections", "briefs", "brief_templates", "app_settings"]) fill(t);
  // Only the Verbatim tenant existed; anything else is left unassigned (and
  // unreadable through the API) rather than merged into Verbatim's days.
  fill("writing_activity", " AND (tenant = 'verbatim' OR tenant = '')");
}, (app) => {
  // Manual rollback only. Removes the tenancy layer; content rows are kept.
  // Restoring the global unique indexes fails if two sites now share a
  // collection name or setting key: resolve those duplicates first.
  const restore = {
    collections: "CREATE UNIQUE INDEX idx_collections_name ON collections (name)",
    app_settings: "CREATE UNIQUE INDEX idx_app_settings_key ON app_settings (key)",
    writing_activity: "CREATE UNIQUE INDEX idx_activity_tenant_day ON writing_activity (tenant, day)",
  };
  const authed = '@request.auth.id != ""';
  for (const n of ["posts", "post_versions", "collections", "briefs", "brief_templates", "app_settings", "writing_activity"]) {
    const c = app.findCollectionByNameOrId(n);
    c.fields.removeByName("site");
    c.indexes = c.indexes.filter((i) => !/_site|idx_activity_tenant_day/.test(i));
    if (restore[n]) c.indexes.push(restore[n]);
    c.createRule = authed;
    c.updateRule = authed;
    c.deleteRule = authed;
    if (["post_versions", "briefs", "brief_templates", "writing_activity"].includes(n)) {
      c.listRule = authed;
      c.viewRule = authed;
    }
    if (n === "posts") {
      c.listRule = 'status = "published" || @request.auth.id != ""';
      c.viewRule = 'status = "published" || @request.auth.id != ""';
    }
    app.save(c);
  }
  for (const n of ["site_members", "sites"]) {
    try { app.delete(app.findCollectionByNameOrId(n)); } catch (_) {}
  }
});
