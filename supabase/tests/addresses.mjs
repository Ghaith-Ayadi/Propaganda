// Post numbers, collection slugs and redirects (20261002000002). The port of
// pb/rehearsal/addresses.mjs; its "backfill" part (numbers from legacy ids)
// belongs to the import now and is checked by import/verify.
import { V, admin, anon, check, done, newId, ok, sql, user } from "./lib.mjs";

const owner = await user("alaarabi16@gmail.com");
const stranger = await user("stranger@test.local");
const guest = anon();

const posts = (c) => c.from("posts");
const redirects = (c) => c.from("post_redirects");
const draft = (c, fields) => ok(posts(c).insert({ id: newId(), site: V, status: "draft", ...fields }).select().single());
const update = (c, id, patch) => ok(posts(c).update(patch).eq("id", id).select().single());
const publish = (c, id, extra = {}) => update(c, id, { status: "published", published_at: new Date().toISOString(), ...extra });
const get = (c, id) => ok(posts(c).select("*").eq("id", id).single());
const redirectAt = async (c, filter) => {
  let q = redirects(c).select("*");
  for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
  return (await ok(q))[0] ?? null;
};
const counter = (site) => Number(sql(`select post_counter from private.site_internals where site = '${site}'`)[0][0]);

// ---- seeded state ----
const vPosts = await ok(posts(admin).select("*").eq("site", V).order("created").order("id"));
const numbers = vPosts.map((p) => p.number);
check("every post has a number, unique in the site", numbers.every((n) => n > 0) && new Set(numbers).size === numbers.length);
check("numbers follow creation order", numbers.join() === vPosts.map((_, i) => i + 1).join());
check("counter = highest number", counter(V) === Math.max(...numbers), `${counter(V)} vs ${Math.max(...numbers)}`);

const cols = await ok(admin.from("collections").select("*").eq("site", V).order("position"));
const slugOf = Object.fromEntries(cols.map((c) => [c.name, c.slug]));
check("collection slugs from names", slugOf["Essays"] === "essays" && slugOf["Test"] === "test" && slugOf["Café Notes"] === "cafe-notes", JSON.stringify(slugOf));
check("reserved word avoided", slugOf["Admin"] === "admin-2", slugOf["Admin"]);
check("clash gets -2", slugOf["Essays!"] === "essays-2", slugOf["Essays!"]);
check("nothing to slugify -> collection", slugOf["日記"] === "collection", slugOf["日記"]);
check("anyone can read collection slugs", (await ok(guest.from("collections").select("slug").eq("site", V))).every((c) => c.slug));

// ---- numbers ----
const top = counter(V);
const n1 = await draft(owner, { title: "N1", type: "Essays", number: 999 });
check("a new post gets the next number, whatever it sends", n1.number === top + 1, n1.number);
check("the number can't be changed", (await update(owner, n1.id, { number: 5, title: "N1b" })).number === n1.number);
await ok(posts(owner).delete().eq("id", n1.id));
const n2 = await draft(owner, { title: "N2", type: "Essays" });
check("a deleted post's number is never reused", n2.number === top + 2, n2.number);
const burst = await Promise.all(Array.from({ length: 10 }, (_, i) => draft(owner, { title: `burst ${i}`, type: "Test" })));
const bn = burst.map((p) => p.number).sort((x, y) => x - y);
check("10 posts at once: distinct and consecutive", new Set(bn).size === 10 && bn[9] - bn[0] === 9, bn.join());
const sSite = (await ok(stranger.rpc("create_site", { site_name: "Mine", site_slug: "mine" }))).site.id;
const s1 = await ok(posts(stranger).insert({ id: newId(), site: sSite, title: "first", status: "draft" }).select().single());
check("another site counts from 1", s1.number === 1, s1.number);
const s2 = await ok(posts(stranger).insert({ id: newId(), site: sSite, title: "second", status: "draft" }).select().single());
check("…and on from its own counter", s2.number === 2, s2.number);

// ---- addresses ----
const a = await draft(owner, { title: "Hello World", slug: "hello-world", type: "Essays" });
check("publishing keeps a free slug", (await publish(owner, a.id)).slug === "hello-world");
const b = await draft(owner, { title: "Hello World", slug: "hello-world", type: "Essays" });
check("drafts may share a slug", b.slug === "hello-world");
check("publishing into a taken address adds -2", (await publish(owner, b.id)).slug === "hello-world-2");
const c = await draft(owner, { title: "Hello World", slug: "hello-world", type: "Test" });
check("the same slug in another collection is fine", (await publish(owner, c.id)).slug === "hello-world");

check("a published post's slug can be edited", (await update(owner, a.id, { slug: "greetings" })).slug === "greetings");
check("its old address redirects, readable by anyone", (await redirectAt(guest, { site: V, collection: "essays", slug: "hello-world" }))?.post === a.id);
const d = await draft(owner, { title: "Hello World", slug: "hello-world", type: "Essays" });
check("a redirect's address counts as taken", (await publish(owner, d.id)).slug === "hello-world-3");

await update(owner, a.id, { type: "Test" });
check("moving collection keeps a free slug", (await get(owner, a.id)).slug === "greetings");
check("…and the old collection address redirects", !!(await redirectAt(guest, { collection: "essays", slug: "greetings", post: a.id })));

await update(owner, a.id, { type: "Essays", slug: "hello-world" });
const aAddrs = (await ok(redirects(guest).select("*").eq("post", a.id))).map((r) => `${r.collection}/${r.slug}`).sort().join(" ");
check("back at an old address: its redirect goes, the one it left comes", aAddrs === "essays/greetings test/greetings", aAddrs);
check("…with its old slug back", (await get(owner, a.id)).slug === "hello-world");

const e = await draft(owner, { title: "Draft", slug: "draft", type: "Essays" });
await update(owner, e.id, { slug: "draft-renamed", type: "Test" });
check("never-published posts leave no redirects", (await ok(redirects(admin).select("id").eq("post", e.id))).length === 0);

await update(owner, b.id, { status: "draft" });
await update(owner, b.id, { slug: "bye" });
check("an unpublished post that was public still leaves one", (await redirectAt(guest, { collection: "essays", slug: "hello-world-2" }))?.post === b.id);

const seeded = vPosts.find((p) => p.status === "published" && !p.published_at);
await update(owner, seeded.id, { slug: `${seeded.slug}-moved` });
check("published without published_at counts as public", (await redirectAt(guest, { slug: seeded.slug }))?.post === seeded.id);

const imp = await ok(posts(owner).insert({ id: newId(), site: V, title: "Hello World", slug: "hello-world", type: "Test", status: "published", published_at: new Date().toISOString() }).select().single());
check("created already published into a taken address adds -2", imp.slug === "hello-world-2", imp.slug);

const rb = await redirectAt(guest, { post: b.id });
check("nobody writes redirects directly",
  (await redirects(owner).insert({ site: V, collection: "x", slug: "y", post: a.id })).error !== null &&
  (await redirects(guest).insert({ site: V, collection: "x", slug: "y", post: a.id })).error !== null);
check("a stranger can't delete them",
  (await ok(redirects(stranger).delete().eq("id", rb.id).select())).length === 0 &&
  (await ok(redirects(admin).select("id").eq("id", rb.id))).length === 1);
check("a member can", (await ok(redirects(owner).delete().eq("id", rb.id).select())).length === 1);
await ok(posts(owner).delete().eq("id", a.id));
check("deleting a post drops its redirects", (await ok(redirects(admin).select("id").eq("post", a.id))).length === 0);

// ---- collections ----
const cols2 = (c) => c.from("collections");
const sCol = await ok(cols2(stranger).insert({ site: sSite, name: "Test" }).select().single());
check("collection slugs are per site", sCol.slug === "test", sCol.slug);
check("a reserved word gets -2", (await ok(cols2(stranger).insert({ site: sSite, name: "API" }).select().single())).slug === "api-2");
const essays = cols.find((x) => x.name === "Essays");
const renamed = await ok(cols2(owner).update({ name: "ESSAYS" }).eq("id", essays.id).select().single());
check("a rename that slugifies the same keeps the slug", renamed.slug === "essays");
await ok(cols2(owner).update({ name: "Essays" }).eq("id", essays.id));
check("clients can't set a collection slug", (await ok(cols2(owner).update({ slug: "hacked" }).eq("id", essays.id).select().single())).slug === "essays");

// The app renames posts first, then the collection record in place.
const test = cols.find((x) => x.name === "Test");
const inTest = await ok(posts(owner).select("*").eq("site", V).eq("type", "Test"));
const testPublic = inTest.filter((p) => p.status === "published" || p.published_at);
for (const p of inTest) await update(owner, p.id, { type: "Tests" });
check("a renamed collection gets a new slug", (await ok(cols2(owner).update({ name: "Tests" }).eq("id", test.id).select().single())).slug === "tests");
const fromTest = await ok(redirects(guest).select("*").eq("site", V).eq("collection", "test"));
check("its public posts redirect from the old address", testPublic.length > 0 && testPublic.every((p) => fromTest.some((r) => r.post === p.id && r.slug === p.slug)), `${fromTest.length}/${testPublic.length}`);

// The old app's rename: create the new collection, move the posts, delete the old one.
const cafe = cols.find((x) => x.name === "Café Notes");
const cafePublic = vPosts.filter((p) => p.type === "Café Notes" && (p.status === "published" || p.published_at));
const writing = await ok(cols2(owner).insert({ site: V, name: "Writing" }).select().single());
for (const p of await ok(posts(owner).select("id").eq("site", V).eq("type", "Café Notes"))) await update(owner, p.id, { type: "Writing" });
await ok(cols2(owner).delete().eq("id", cafe.id));
const fromCafe = await ok(redirects(guest).select("*").eq("site", V).eq("collection", "cafe-notes"));
check("old app's rename: public posts redirect too", cafePublic.length === 1 && cafePublic.every((p) => fromCafe.some((r) => r.post === p.id)), `${fromCafe.length}/${cafePublic.length}`);
check("…and the new collection has its slug", writing.slug === "writing");

done("ADDRESSES");
