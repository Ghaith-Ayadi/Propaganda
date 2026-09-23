/// <reference path="../pb_data/types.d.ts" />
// app_settings.value may legitimately be false, 0, "" or null (feature flags,
// cleared bios). A required json field rejects those as blank.
migrate((app) => {
  const c = app.findCollectionByNameOrId("app_settings");
  const f = c.fields.getByName("value");
  f.required = false;
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("app_settings");
  c.fields.getByName("value").required = true;
  app.save(c);
});
