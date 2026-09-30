// Post numbers, collection slugs and redirects (1758000007 + pb_hooks/addresses.pb.js),
// run by rehearse.sh after rules.mjs, on the same throwaway instance.
import PocketBase from "pocketbase";
const URL = "http://127.0.0.1:8091";
const login = async (email, pass, collection = "users") => {
  const pb = new PocketBase(URL);
  pb.autoCancellation(false);
  // PocketBase's default rate limits (sign-ins, creates) are tighter than this
  // suite: wait them out instead of failing on a 429.
  const send = pb.send.bind(pb);
  pb.send = async (path, options) => {
    for (let i = 0; ; i++) {
      try {
        return await send(path, options);
      } catch (e) {
        if (e.status !== 429 || i === 30) throw e;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  };
  if (email) await pb.collection(collection).authWithPassword(email, pass);
  return pb;
};
process.on("unhandledRejection", (e) => { console.log("ERR", e.status, e.url, JSON.stringify(e.response)); process.exit(1); });
const su = await login("admin@test.local", "Passw0rd123!", "_superusers");
const owner = await login("alaarabi16@gmail.com", "ownerpass123");
const stranger = await login("stranger@test.local", "strangerpass1");
const anon = await login();
let fails = 0;
const check = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name} ${extra}`); if (!cond) fails++; };
const status = async (p) => { try { await p; return 200; } catch (e) { return e.status; } };
const V = "verbatimsite000";
const posts = (pb) => pb.collection("posts");
const redirects = (pb) => pb.collection("post_redirects");
const one = (pb, filter) => redirects(pb).getFirstListItem(filter).catch(() => null);
const publish = (pb, id, extra = {}) => posts(pb).update(id, { status: "published", published_at: new Date().toISOString(), ...extra });
const draft = (pb, fields) => posts(pb).create({ site: V, status: "draft", ...fields });

// ---- backfill ----
const vPosts = await posts(su).getFullList({ filter: `site = "${V}"`, sort: "created,id" });
const legacy = vPosts.filter((p) => p.legacy_id > 0);
check("legacy posts keep their Postgres id", legacy.length === 30 && legacy.every((p) => p.number === p.legacy_id));
const fresh = vPosts.filter((p) => p.title.startsWith("Fresh "));
check("the others follow the highest, oldest first", fresh.map((p) => p.number).join() === "31,32,33", fresh.map((p) => p.number).join());
const numbers = vPosts.map((p) => p.number);
check("numbers unique and set", new Set(numbers).size === numbers.length && numbers.every((n) => n > 0));
const vSite = await su.collection("sites").getOne(V);
check("counter = highest number", vSite.post_counter === Math.max(...numbers), `${vSite.post_counter} vs ${Math.max(...numbers)}`);
check("counter hidden from the public", (await anon.collection("sites").getOne(V)).post_counter === undefined);

const cols = await su.collection("collections").getFullList({ filter: `site = "${V}"`, sort: "position" });
const slugOf = Object.fromEntries(cols.map((c) => [c.name, c.slug]));
check("collection slugs from names", slugOf["Essays"] === "essays" && slugOf["Test"] === "test" && slugOf["Café Notes"] === "cafe-notes", JSON.stringify(slugOf));
check("reserved word avoided", slugOf["Admin"] === "admin-2", slugOf["Admin"]);
check("clash gets -2", slugOf["Essays!"] === "essays-2", slugOf["Essays!"]);
check("nothing to slugify -> collection", slugOf["日記"] === "collection", slugOf["日記"]);
check("anyone can read collection slugs", (await anon.collection("collections").getFullList({ filter: `site = "${V}"` })).every((c) => c.slug));

// ---- numbers ----
const top = (await su.collection("sites").getOne(V)).post_counter;
const n1 = await draft(owner, { title: "N1", type: "Essays", number: 999 });
check("a new post gets the next number, whatever it sends", n1.number === top + 1, n1.number);
check("the number can't be changed", (await posts(owner).update(n1.id, { number: 5, title: "N1b" })).number === n1.number);
await posts(owner).delete(n1.id);
const n2 = await draft(owner, { title: "N2", type: "Essays" });
check("a deleted post's number is never reused", n2.number === top + 2, n2.number);
const burst = await Promise.all(Array.from({ length: 10 }, (_, i) => draft(owner, { title: `burst ${i}`, type: "Test" })));
const bn = burst.map((p) => p.number).sort((x, y) => x - y);
check("10 posts at once: distinct and consecutive", new Set(bn).size === 10 && bn[9] - bn[0] === 9, bn.join());
const sSite = (await stranger.collection("site_members").getFullList())[0].site;
const sPosts = await posts(stranger).getFullList({ filter: `site = "${sSite}"`, sort: "number" });
check("another site counts from 1", sPosts.length > 0 && sPosts[0].number === 1, sPosts.map((p) => p.number).join());
const s2 = await posts(stranger).create({ site: sSite, title: "second", status: "draft" });
check("…and on from its own counter", s2.number === sPosts.length + 1, s2.number);

// ---- addresses ----
const a = await draft(owner, { title: "Hello World", slug: "hello-world", type: "Essays" });
check("publishing keeps a free slug", (await publish(owner, a.id)).slug === "hello-world");
const b = await draft(owner, { title: "Hello World", slug: "hello-world", type: "Essays" });
check("drafts may share a slug", b.slug === "hello-world");
check("publishing into a taken address adds -2", (await publish(owner, b.id)).slug === "hello-world-2");
const c = await draft(owner, { title: "Hello World", slug: "hello-world", type: "Test" });
check("the same slug in another collection is fine", (await publish(owner, c.id)).slug === "hello-world");

check("a published post's slug can be edited", (await posts(owner).update(a.id, { slug: "greetings" })).slug === "greetings");
check("its old address redirects, readable by anyone", (await one(anon, `site = "${V}" && collection = "essays" && slug = "hello-world"`))?.post === a.id);
const d = await draft(owner, { title: "Hello World", slug: "hello-world", type: "Essays" });
check("a redirect's address counts as taken", (await publish(owner, d.id)).slug === "hello-world-3");

await posts(owner).update(a.id, { type: "Test" });
check("moving collection keeps a free slug", (await posts(owner).getOne(a.id)).slug === "greetings");
check("…and the old collection address redirects", !!(await one(anon, `collection = "essays" && slug = "greetings" && post = "${a.id}"`)));

await posts(owner).update(a.id, { type: "Essays", slug: "hello-world" });
const aAddrs = (await redirects(anon).getFullList({ filter: `post = "${a.id}"` })).map((r) => `${r.collection}/${r.slug}`).sort().join(" ");
check("back at an old address: its redirect goes, the one it left comes", aAddrs === "essays/greetings test/greetings", aAddrs);
check("…with its old slug back", (await posts(owner).getOne(a.id)).slug === "hello-world");

const e = await draft(owner, { title: "Draft", slug: "draft", type: "Essays" });
await posts(owner).update(e.id, { slug: "draft-renamed", type: "Test" });
check("never-published posts leave no redirects", (await redirects(su).getFullList({ filter: `post = "${e.id}"` })).length === 0);

await posts(owner).update(b.id, { status: "draft" });
await posts(owner).update(b.id, { slug: "bye" });
check("an unpublished post that was public still leaves one", (await one(anon, `collection = "essays" && slug = "hello-world-2"`))?.post === b.id);

const seeded = vPosts.find((p) => p.status === "published" && !p.published_at);
await posts(owner).update(seeded.id, { slug: `${seeded.slug}-moved` });
check("published without published_at counts as public", (await one(anon, `slug = "${seeded.slug}"`))?.post === seeded.id);

const imp = await posts(owner).create({ site: V, title: "Hello World", slug: "hello-world", type: "Test", status: "published", published_at: new Date().toISOString() });
check("created already published into a taken address adds -2", imp.slug === "hello-world-2", imp.slug);

const rb = await one(anon, `post = "${b.id}"`);
check("nobody writes redirects directly", (await status(redirects(owner).create({ site: V, collection: "x", slug: "y", post: a.id }))) !== 200 && (await status(redirects(anon).create({ site: V, collection: "x", slug: "y", post: a.id }))) !== 200);
check("a stranger can't delete them", (await status(redirects(stranger).delete(rb.id))) !== 200 && !!(await redirects(su).getOne(rb.id).catch(() => null)));
check("a member can", (await status(redirects(owner).delete(rb.id))) === 200);
await posts(owner).delete(a.id);
check("deleting a post drops its redirects", (await redirects(su).getFullList({ filter: `post = "${a.id}"` })).length === 0);

// ---- collections ----
const sCol = await stranger.collection("collections").create({ site: sSite, name: "Test" });
check("collection slugs are per site", sCol.slug === "test", sCol.slug);
check("a reserved word gets -2", (await stranger.collection("collections").create({ site: sSite, name: "API" })).slug === "api-2");
check("the author page's segment is reserved", (await stranger.collection("collections").create({ site: sSite, name: "Author" })).slug === "author-2");
const essays = cols.find((x) => x.name === "Essays");
check("a rename that slugifies the same keeps the slug", (await owner.collection("collections").update(essays.id, { name: "ESSAYS" })).slug === "essays");
await owner.collection("collections").update(essays.id, { name: "Essays" });
check("clients can't set a collection slug", (await owner.collection("collections").update(essays.id, { slug: "hacked" })).slug === "essays");

// The app renames posts first, then the collection record in place.
const test = cols.find((x) => x.name === "Test");
const testPublic = (await posts(owner).getFullList({ filter: `site = "${V}" && type = "Test"` })).filter((p) => p.status === "published" || p.published_at);
for (const p of await posts(owner).getFullList({ filter: `site = "${V}" && type = "Test"` })) await posts(owner).update(p.id, { type: "Tests" });
check("a renamed collection gets a new slug", (await owner.collection("collections").update(test.id, { name: "Tests" })).slug === "tests");
const fromTest = await redirects(anon).getFullList({ filter: `site = "${V}" && collection = "test"` });
check("its public posts redirect from the old address", testPublic.length > 0 && testPublic.every((p) => fromTest.some((r) => r.post === p.id && r.slug === p.slug)), `${fromTest.length}/${testPublic.length}`);

// The old app's rename: create the new collection, move the posts, delete the old one.
const cafe = cols.find((x) => x.name === "Café Notes");
const cafePublic = vPosts.filter((p) => p.type === "Café Notes" && (p.status === "published" || p.published_at));
const writing = await owner.collection("collections").create({ site: V, name: "Writing" });
for (const p of await posts(owner).getFullList({ filter: `site = "${V}" && type = "Café Notes"` })) await posts(owner).update(p.id, { type: "Writing" });
await owner.collection("collections").delete(cafe.id);
const fromCafe = await redirects(anon).getFullList({ filter: `site = "${V}" && collection = "cafe-notes"` });
check("old app's rename: public posts redirect too", cafePublic.length === 1 && cafePublic.every((p) => fromCafe.some((r) => r.post === p.id)), `${fromCafe.length}/${cafePublic.length}`);
check("…and the new collection has its slug", writing.slug === "writing");

console.log(fails ? `${fails} FAILED` : "ADDRESSES: ALL PASS");
process.exitCode = fails ? 1 : 0;
