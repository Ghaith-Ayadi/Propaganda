/// <reference path="../pb_data/types.d.ts" />
// Sites are created and edited here, not through the collection API, so a site
// and its owner membership always appear together and slugs are checked
// against the reserved list.
//
//   POST  /api/propaganda/sites        {"name":"Propaganda","slug":"propaganda"}
//   PATCH /api/propaganda/sites/{id}   {"name":"…","slug":"…"}          owner only
//
// `domain` is not editable here: mapping a hostname is a superuser action in the
// dashboard (it has to be configured in Vercel too).

routerAdd("POST", "/api/propaganda/sites", (e) => {
  const t = require(`${__hooks}/lib/tenancy.js`);
  const body = e.requestInfo().body || {};
  const name = String(body.name || "").trim().slice(0, 120);
  const slug = String(body.slug || "").trim().toLowerCase();
  if (!name) throw new BadRequestError("A site needs a name.");
  if (!t.validSlug(slug)) {
    throw new BadRequestError("That address isn't available: use 2–40 lowercase letters, digits or dashes.", { slug: "invalid" });
  }
  try {
    e.app.findFirstRecordByFilter("sites", "slug = {:s}", { s: slug });
    throw new BadRequestError("That address is taken.", { slug: "taken" });
  } catch (err) {
    if (err instanceof BadRequestError) throw err;
  }
  // Soft cap so an open sign-up can't mint sites in a loop.
  if (t.siteIdsOf(e.app, e.auth.id).length >= 20) {
    throw new BadRequestError("You already belong to 20 sites.");
  }

  let site, member;
  e.app.runInTransaction((tx) => {
    site = new Record(tx.findCollectionByNameOrId("sites"));
    site.set("name", name);
    site.set("slug", slug);
    site.set("analytics_tenant", slug);
    site.set("created_by", e.auth.id);
    tx.save(site);
    member = new Record(tx.findCollectionByNameOrId("site_members"));
    member.set("site", site.id);
    member.set("user", e.auth.id);
    member.set("role", "owner");
    tx.save(member);
  });
  return e.json(200, { site: site, membership: member });
}, $apis.requireAuth("users"));

routerAdd("PATCH", "/api/propaganda/sites/{id}", (e) => {
  const t = require(`${__hooks}/lib/tenancy.js`);
  const id = e.request.pathValue("id");
  const m = t.membership(e.app, id, e.auth.id);
  if (!m || m.getString("role") !== "owner") throw new ForbiddenError("Only the site's owner can change it.");
  const site = e.app.findRecordById("sites", id);
  const body = e.requestInfo().body || {};
  if (body.name !== undefined) {
    const name = String(body.name).trim().slice(0, 120);
    if (!name) throw new BadRequestError("A site needs a name.");
    site.set("name", name);
  }
  if (body.slug !== undefined) {
    const slug = String(body.slug).trim().toLowerCase();
    if (slug !== site.getString("slug")) {
      if (!t.validSlug(slug)) throw new BadRequestError("That address isn't available.", { slug: "invalid" });
      try {
        e.app.findFirstRecordByFilter("sites", "slug = {:s} && id != {:id}", { s: slug, id: id });
        throw new BadRequestError("That address is taken.", { slug: "taken" });
      } catch (err) {
        if (err instanceof BadRequestError) throw err;
      }
      site.set("slug", slug);
    }
  }
  e.app.save(site);
  return e.json(200, { site: site });
}, $apis.requireAuth("users"));
