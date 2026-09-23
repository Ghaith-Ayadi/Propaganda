/// <reference path="../pb_data/types.d.ts" />
// Replaces the Postgres function increment_writing_activity(p_tenant, p_day, p_delta):
// an atomic find-or-create-then-add, inside one transaction. Authenticated only.
//   POST /api/verbose/increment  {"tenant":"verbatim","day":"2026-09-15","delta":120}
routerAdd("POST", "/api/verbose/increment", (e) => {
  const body = e.requestInfo().body;
  const tenant = String(body.tenant || "");
  const day = String(body.day || "");
  const delta = Math.max(0, parseInt(body.delta, 10) || 0);
  if (!tenant || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new BadRequestError("tenant and day (YYYY-MM-DD) are required");
  }
  let words = 0;
  e.app.runInTransaction((tx) => {
    let rec;
    try {
      rec = tx.findFirstRecordByFilter("writing_activity", "tenant = {:t} && day = {:d}", { t: tenant, d: day });
    } catch (_) {
      rec = new Record(tx.findCollectionByNameOrId("writing_activity"));
      rec.set("tenant", tenant);
      rec.set("day", day);
      rec.set("words", 0);
    }
    words = (rec.getInt("words") || 0) + delta;
    rec.set("words", words);
    tx.save(rec);
  });
  return e.json(200, { tenant, day, words });
}, $apis.requireAuth());
