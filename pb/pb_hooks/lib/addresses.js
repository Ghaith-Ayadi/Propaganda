// Post addresses: /<collection slug>/<post slug> under the site's base path.
// Shared by addresses.pb.js. pb_migrations/1758000007_post_addresses.js and the
// app (app/src/lib/slug.ts) carry the same slugify and reserved list. JSVM
// handlers can't see variables declared outside their own body, so every
// handler require()s this file.

/** First path segments the app or the edge already own. */
const RESERVED = ["admin", "api", "assets", "cards", "p"];

/** "Café au lait!" -> "cafe-au-lait". Empty when nothing usable is left. */
function slugify(text) {
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
}

/** base, base-2, base-3, …: the first one `taken` says is free. */
function dedupe(base, taken) {
  if (!taken(base)) return base;
  let n = 2;
  while (taken(base + "-" + n)) n++;
  return base + "-" + n;
}

/**
 * Whether a post has a public address: it is published, or it has been
 * (`published_at` is set on first publish and never cleared). Some imported
 * posts are published without a `published_at`, hence both.
 */
function hasAddress(record) {
  return record.getString("status") === "published" || !!record.getString("published_at");
}

function findOne(app, collection, filter, params) {
  try {
    return app.findFirstRecordByFilter(collection, filter, params);
  } catch (_) {
    return null;
  }
}

/** URL segment of the collection called `name` in `site`: its slug, else its name slugified. */
function collectionSlug(app, site, name) {
  const c = findOne(app, "collections", "site = {:s} && name = {:n}", { s: site, n: name });
  return (c && c.getString("slug")) || slugify(name) || "collection";
}

/**
 * Whether /<colSlug>/<slug> in `site` belongs to anyone but `postId`: a post of
 * the collection `type` that has been published, or a redirect.
 */
function addressTaken(app, site, type, colSlug, slug, postId) {
  const post = findOne(
    app,
    "posts",
    "site = {:s} && type = {:t} && slug = {:slug} && (status = 'published' || published_at != '') && id != {:id}",
    { s: site, t: type, slug: slug, id: postId },
  );
  if (post) return true;
  const redirect = findOne(
    app,
    "post_redirects",
    "site = {:s} && collection = {:c} && slug = {:slug} && post != {:id}",
    { s: site, c: colSlug, slug: slug, id: postId },
  );
  return !!redirect;
}

/** A free collection slug in `site` for `name`, other than record `id`'s own. */
function collectionSlugFor(app, site, name, id) {
  const taken = (s) =>
    RESERVED.indexOf(s) !== -1 ||
    !!findOne(app, "collections", "site = {:site} && slug = {:s} && id != {:id}", { site: site, s: s, id: id });
  return { base: slugify(name) || "collection", taken: taken };
}

module.exports = { RESERVED, slugify, dedupe, hasAddress, findOne, collectionSlug, addressTaken, collectionSlugFor };
