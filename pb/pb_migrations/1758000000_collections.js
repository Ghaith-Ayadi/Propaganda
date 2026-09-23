/// <reference path="../pb_data/types.d.ts" />
// Propaganda: DRAFT, not yet deployed. The 7 collections the app touches
// (BEDROCK.md §8.2), translated from scripts/sql/0001..0019 plus the Payload-era
// `posts` columns read by app/src/lib/posts.ts. Payload tables do not migrate.
//
// Decisions (see §8.3-8.5):
//   - posts.id integer -> PocketBase id; old value kept as `legacy_id` for the
//     remap and audit. post_versions.post / briefs.post are relations.
//   - collections keyed by `name` (text PK) -> unique index on name; posts.type
//     stays a plain text pointer to the collection name, as the app uses it.
//   - RLS -> rules: published posts, collections and app_settings readable by
//     anyone; everything else authenticated only.
//   - writing_activity (tenant, day) PK -> unique index; the atomic increment is
//     pb_hooks/writing_activity.pb.js.
migrate((app) => {
  const authed = '@request.auth.id != ""';

  const collections = new Collection({
    name: "collections", type: "base",
    listRule: "", viewRule: "", createRule: authed, updateRule: authed, deleteRule: authed,
    fields: [
      { name: "name", type: "text", required: true },
      { name: "emoji", type: "text" },
      { name: "description", type: "text" },
      { name: "position", type: "number", onlyInt: true },
      { name: "is_hidden", type: "bool" },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_collections_name ON collections (name)"],
  });
  app.save(collections);

  const posts = new Collection({
    name: "posts", type: "base",
    listRule: 'status = "published" || @request.auth.id != ""',
    viewRule: 'status = "published" || @request.auth.id != ""',
    createRule: authed, updateRule: authed, deleteRule: authed,
    fields: [
      { name: "legacy_id", type: "number", onlyInt: true },
      { name: "title", type: "text" },
      { name: "slug", type: "text" },
      { name: "post_id", type: "text" },
      { name: "type", type: "text" },
      { name: "status", type: "select", values: ["draft", "done", "published"], maxSelect: 1 },
      { name: "subtitle", type: "text" },
      { name: "done_at", type: "date" },
      { name: "published_at", type: "date" },
      { name: "excerpt", type: "text" },
      { name: "category", type: "text" },
      { name: "tags", type: "json", maxSize: 4000 },
      { name: "content_md", type: "text", max: 2000000 },
      { name: "notion_id", type: "text" },
      { name: "favorited", type: "bool" },
      { name: "collection_seq", type: "number", onlyInt: true },
      { name: "word_count", type: "number", onlyInt: true },
      { name: "shareable_quotes", type: "json", maxSize: 20000 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_posts_legacy ON posts (legacy_id) WHERE legacy_id != 0",
      "CREATE INDEX idx_posts_slug ON posts (slug)",
      "CREATE INDEX idx_posts_post_id ON posts (post_id)",
      "CREATE INDEX idx_posts_type_seq ON posts (type, collection_seq)",
      "CREATE INDEX idx_posts_status_updated ON posts (status, updated)",
    ],
  });
  app.save(posts);

  const versions = new Collection({
    name: "post_versions", type: "base",
    listRule: authed, viewRule: authed, createRule: authed, updateRule: authed, deleteRule: authed,
    fields: [
      { name: "post", type: "relation", required: true, collectionId: posts.id, cascadeDelete: true, maxSelect: 1 },
      { name: "version", type: "number", required: true, onlyInt: true },
      { name: "content", type: "text", max: 2000000 },
      { name: "attributes", type: "json", maxSize: 50000 },
      { name: "created_by", type: "select", required: true, values: ["user", "mcp:claude-code", "migration"], maxSelect: 1 },
      { name: "message", type: "text" },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_versions_post_version ON post_versions (post, version)"],
  });
  app.save(versions);

  const templates = new Collection({
    name: "brief_templates", type: "base",
    listRule: authed, viewRule: authed, createRule: authed, updateRule: authed, deleteRule: authed,
    fields: [
      { name: "name", type: "text" },
      { name: "body", type: "text", max: 500000 },
      { name: "checks", type: "json", maxSize: 20000 },
      { name: "tenant", type: "text" },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
  });
  app.save(templates);

  const briefs = new Collection({
    name: "briefs", type: "base",
    listRule: authed, viewRule: authed, createRule: authed, updateRule: authed, deleteRule: authed,
    fields: [
      { name: "title", type: "text" },
      { name: "status", type: "select", required: true, values: ["backlog", "todo", "in_progress", "in_review", "done", "cancelled"], maxSelect: 1 },
      { name: "assignee_ids", type: "json", maxSize: 4000 },
      { name: "planned_date", type: "text" },
      { name: "tags", type: "json", maxSize: 4000 },
      { name: "template", type: "relation", collectionId: templates.id, cascadeDelete: false, maxSelect: 1 },
      { name: "collection_name", type: "text" },
      { name: "body", type: "text", max: 500000 },
      { name: "checks", type: "json", maxSize: 20000 },
      { name: "post", type: "relation", collectionId: posts.id, cascadeDelete: false, maxSelect: 1 },
      { name: "tenant", type: "text" },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE INDEX idx_briefs_status ON briefs (status)",
      "CREATE INDEX idx_briefs_planned ON briefs (planned_date)",
      "CREATE INDEX idx_briefs_post ON briefs (post)",
    ],
  });
  app.save(briefs);

  const settings = new Collection({
    name: "app_settings", type: "base",
    listRule: "", viewRule: "", createRule: authed, updateRule: authed, deleteRule: authed,
    fields: [
      { name: "key", type: "text", required: true },
      { name: "value", type: "json", required: true, maxSize: 200000 },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_app_settings_key ON app_settings (key)"],
  });
  app.save(settings);

  // day is "YYYY-MM-DD" text on purpose: the app keys on the calendar day, and a
  // date field would drag time zones into equality checks.
  const activity = new Collection({
    name: "writing_activity", type: "base",
    listRule: authed, viewRule: authed, createRule: authed, updateRule: authed, deleteRule: authed,
    fields: [
      { name: "tenant", type: "text", required: true },
      { name: "day", type: "text", required: true, pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      { name: "words", type: "number", onlyInt: true, min: 0 },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_activity_tenant_day ON writing_activity (tenant, day)"],
  });
  app.save(activity);
}, (app) => {
  for (const n of ["writing_activity", "app_settings", "briefs", "brief_templates", "post_versions", "posts", "collections"]) {
    try { app.delete(app.findCollectionByNameOrId(n)); } catch (_) {}
  }
});
