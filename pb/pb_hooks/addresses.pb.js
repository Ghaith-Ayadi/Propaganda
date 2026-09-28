/// <reference path="../pb_data/types.d.ts" />
// Post numbers and addresses (see pb_migrations/1758000007_post_addresses.js).
//
//   number    handed out from the site's counter when a post is created: never
//             reused, even after a delete, and never changed afterwards.
//             Clients don't send it; anything they send is ignored.
//   address   /<collection slug>/<post slug>. The app keeps the slug in step
//             with the title until the post is first published; after that only
//             an explicit edit changes it. A post that has been published keeps
//             an address unique in its collection (a clash gets -2, -3, …), and
//             moving it, to another slug or another collection, leaves a
//             post_redirects row at the old address so old links keep working.
//             "Has been published" is lib/addresses.js hasAddress: published
//             now, or `published_at` set (it is never cleared, so unpublishing
//             doesn't free the address).
//   collection slug   the collection's URL segment: from its name, unique in
//             its site, following the name when the collection is renamed.

// ---- posts ----

onRecordCreateExecute((e) => {
  const a = require(`${__hooks}/lib/addresses.js`);
  const site = e.record.getString("site");
  // One statement, so two creates at once can't draw the same number.
  const counter = new DynamicModel({ post_counter: 0 });
  e.app
    .db()
    .newQuery("UPDATE sites SET post_counter = post_counter + 1 WHERE id = {:s} RETURNING post_counter")
    .bind({ s: site })
    .one(counter);
  e.record.set("number", counter.post_counter);

  if (a.hasAddress(e.record)) {
    // Created already published (an import, a copy): its address must be free.
    const type = e.record.getString("type");
    const col = a.collectionSlug(e.app, site, type);
    const base = a.slugify(e.record.getString("slug")) || a.slugify(e.record.getString("title")) || "untitled";
    e.record.set("slug", a.dedupe(base, (s) => a.addressTaken(e.app, site, type, col, s, e.record.id)));
  }
  e.next();
}, "posts");

onRecordUpdate((e) => {
  // A post's number never changes.
  e.record.set("number", e.record.original().getInt("number"));
  e.next();
}, "posts");

onRecordUpdateExecute((e) => {
  const a = require(`${__hooks}/lib/addresses.js`);
  const before = e.record.original();
  const site = e.record.getString("site");
  const type = e.record.getString("type");
  const oldType = before.getString("type");
  const oldSlug = before.getString("slug");
  const hadAddress = a.hasAddress(before);
  const hasAddress = a.hasAddress(e.record);
  // Most updates are content saves: nothing to do unless the address changes.
  const moved = type !== oldType || e.record.getString("slug") !== oldSlug;
  if (!hasAddress || (hadAddress && !moved)) {
    e.next();
    return;
  }

  const col = a.collectionSlug(e.app, site, type);
  const base = a.slugify(e.record.getString("slug")) || a.slugify(e.record.getString("title")) || "untitled";
  e.record.set("slug", a.dedupe(base, (s) => a.addressTaken(e.app, site, type, col, s, e.record.id)));
  const slug = e.record.getString("slug");

  if (hadAddress && oldSlug && (type !== oldType || slug !== oldSlug)) {
    // The old address now points here. Looked up before a renamed collection
    // takes its new name (the app moves the posts first), so it's the old slug.
    const oldCol = a.collectionSlug(e.app, site, oldType);
    const row = a.findOne(e.app, "post_redirects", "site = {:s} && collection = {:c} && slug = {:slug}", {
      s: site,
      c: oldCol,
      slug: oldSlug,
    });
    if (!row) {
      const r = new Record(e.app.findCollectionByNameOrId("post_redirects"));
      r.set("site", site);
      r.set("collection", oldCol);
      r.set("slug", oldSlug);
      r.set("post", e.record.id);
      e.app.save(r);
    } else if (row.getString("post") !== e.record.id) {
      row.set("post", e.record.id);
      e.app.save(row);
    }
  }

  // Back at one of its old addresses: that redirect has nothing left to do.
  const own = a.findOne(e.app, "post_redirects", "site = {:s} && collection = {:c} && slug = {:slug} && post = {:id}", {
    s: site,
    c: col,
    slug: slug,
    id: e.record.id,
  });
  if (own) e.app.delete(own);
  e.next();
}, "posts");

// ---- collections ----

onRecordCreateExecute((e) => {
  const a = require(`${__hooks}/lib/addresses.js`);
  const s = a.collectionSlugFor(e.app, e.record.getString("site"), e.record.getString("name"), e.record.id);
  e.record.set("slug", a.dedupe(s.base, s.taken));
  e.next();
}, "collections");

onRecordUpdateExecute((e) => {
  const a = require(`${__hooks}/lib/addresses.js`);
  const before = e.record.original();
  const current = before.getString("slug");
  // Clients don't set the slug; it follows the name.
  e.record.set("slug", current);
  if (e.record.getString("name") !== before.getString("name") || !current) {
    const s = a.collectionSlugFor(e.app, e.record.getString("site"), e.record.getString("name"), e.record.id);
    // Keep the slug when the new name still gives it ("Essays" -> "ESSAYS").
    const same = current && current.replace(/-\d+$/, "") === s.base && !s.taken(current);
    e.record.set("slug", same ? current : a.dedupe(s.base, s.taken));
  }
  e.next();
}, "collections");
