/// <reference path="../pb_data/types.d.ts" />
// post_versions.authored: when the snapshot was taken on the author's device.
// `created` is when the server received it, which can be much later for a
// snapshot made offline; history must read in the order it was written.
// Also carries `legacy_id` for the import audit.
migrate((app) => {
  const c = app.findCollectionByNameOrId("post_versions");
  c.fields.add(new DateField({ name: "authored" }));
  c.fields.add(new TextField({ name: "legacy_id", max: 64 }));
  c.indexes.push("CREATE INDEX idx_versions_authored ON post_versions (authored)");
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("post_versions");
  c.fields.removeByName("authored");
  c.fields.removeByName("legacy_id");
  c.indexes = c.indexes.filter((i) => !i.includes("idx_versions_authored"));
  app.save(c);
});
