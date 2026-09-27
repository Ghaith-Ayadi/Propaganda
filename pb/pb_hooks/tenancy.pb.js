/// <reference path="../pb_data/types.d.ts" />
// Fills `site` on creates that don't carry one, so a device still running the
// single-tenant build keeps saving new drafts after the multi-tenant migration:
//   - a post version inherits its post's site;
//   - anything else goes to the author's site when they belong to exactly one.
// With several sites and no `site` in the body, the create is rejected and the
// record stays dirty (and safe) on the device.
//
// PocketBase checks the create rule before this hook runs, so the rules admit
// `site = ""` and this hook is what enforces membership for those creates.

onRecordCreateRequest((e) => {
  if (!e.record.getString("site") && !e.hasSuperuserAuth()) {
    if (!e.auth) throw new BadRequestError("Failed to create record.");
    const t = require(`${__hooks}/lib/tenancy.js`);
    const name = e.collection.name;
    let site = "";
    if (name === "post_versions") {
      try {
        site = e.app.findRecordById("posts", e.record.getString("post")).getString("site");
      } catch (_) {}
    }
    if (!site) {
      const ids = t.siteIdsOf(e.app, e.auth.id);
      if (ids.length === 1) site = ids[0];
    }
    if (!site || !t.membership(e.app, site, e.auth.id)) {
      throw new BadRequestError("Pick a site for this record.", { site: "required" });
    }
    e.record.set("site", site);
  }
  // A version always lives in its post's site.
  if (e.collection.name === "post_versions") {
    let postSite = null;
    try {
      postSite = e.app.findRecordById("posts", e.record.getString("post")).getString("site");
    } catch (_) {
      // No such post: record validation below reports it on the `post` field,
      // which the app reads as "push the post first, retry the version later".
    }
    if (postSite !== null && postSite !== e.record.getString("site")) {
      throw new BadRequestError("A version must be in its post's site.", { site: "mismatch" });
    }
  }
  e.next();
}, "posts", "post_versions", "collections", "briefs", "brief_templates", "app_settings");
