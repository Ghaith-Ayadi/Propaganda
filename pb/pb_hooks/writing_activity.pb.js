/// <reference path="../pb_data/types.d.ts" />
// Replaces the Postgres function increment_writing_activity(p_tenant, p_day, p_delta):
// an atomic find-or-create-then-add, inside one transaction. Members only.
//   POST /api/verbose/increment  {"site":"<site id>","day":"2026-09-15","delta":120}
// Builds from before multi-tenancy send {"tenant":"verbatim"} instead of a
// site; that resolves to the site with that analytics tenant.
routerAdd("POST", "/api/verbose/increment", (e) => {
  const t = require(`${__hooks}/lib/tenancy.js`);
  const body = e.requestInfo().body;
  const day = String(body.day || "");
  const delta = Math.max(0, parseInt(body.delta, 10) || 0);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new BadRequestError("day (YYYY-MM-DD) is required");
  }
  let site = null;
  try {
    site = body.site
      ? e.app.findRecordById("sites", String(body.site))
      : e.app.findFirstRecordByFilter("sites", "analytics_tenant = {:t}", { t: String(body.tenant || "") });
  } catch (_) {}
  if (!site || !t.membership(e.app, site.id, e.auth.id)) {
    throw new ForbiddenError("Not a member of that site.");
  }
  const tenant = site.getString("analytics_tenant");
  let words = 0;
  e.app.runInTransaction((tx) => {
    let rec;
    try {
      rec = tx.findFirstRecordByFilter("writing_activity", "site = {:s} && day = {:d}", { s: site.id, d: day });
    } catch (_) {
      rec = new Record(tx.findCollectionByNameOrId("writing_activity"));
      rec.set("site", site.id);
      rec.set("tenant", tenant);
      rec.set("day", day);
      rec.set("words", 0);
    }
    words = (rec.getInt("words") || 0) + delta;
    rec.set("words", words);
    tx.save(rec);
  });
  return e.json(200, { site: site.id, tenant, day, words });
}, $apis.requireAuth("users"));
