// Deleting a site (pb_hooks/sites.pb.js): owner only, never while the site has
// a post, and everything the site owned goes with it, so the same slug can be
// created again (how onboarding gets tested). Runs after rules.mjs.
import PocketBase from "pocketbase";
const URL = "http://127.0.0.1:8091";
process.on("unhandledRejection",e=>{console.log("ERR",e.status,e.url,JSON.stringify(e.response));process.exit(1)});
let fails = 0;
const check = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name} ${extra}`); if (!cond) fails++; };
const status = async (p) => { try { await p; return 200; } catch (e) { return e.status; } };

// Sign-ins are rate-limited (2 every 3 s per client): wait out a 429.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const signIn = async (collection, email, pass) => {
  const pb = new PocketBase(URL);
  pb.autoCancellation(false);
  for (let attempt = 1; ; attempt++) {
    try { await pb.collection(collection).authWithPassword(email, pass); return pb; }
    catch (e) { if (e.status !== 429 || attempt >= 5) throw e; await sleep(4000); }
  }
};
const owner = await signIn("users", "alaarabi16@gmail.com", "ownerpass123");
const stranger = await signIn("users", "stranger@test.local", "strangerpass1");
const admin = await signIn("_superusers", "admin@test.local", "Passw0rd123!");
const anon = new PocketBase(URL);

const del = (pb, id) => status(pb.send(`/api/propaganda/sites/${id}`, { method: "DELETE" }));
const onboard = async (pb, slug) => {
  const { site } = await pb.send("/api/propaganda/sites", { method: "POST", body: { name: "Try", slug } });
  await pb.collection("collections").create({ site: site.id, name: "Essays", emoji: "", description: "", position: 0, is_hidden: false });
  await pb.collection("app_settings").create({ site: site.id, key: "site.title", value: "Try" });
  return site;
};
const left = async (id) => {
  const f = `site = "${id}"`;
  const counts = await Promise.all(["collections", "app_settings", "site_members"].map((c) => admin.collection(c).getList(1, 1, { filter: f }).then((r) => r.totalItems)));
  return counts.reduce((a, b) => a + b, 0);
};

check("signed out can't delete a site", (await del(anon, "verbatimsite000")) === 401);
check("a non-member can't delete Verbatim", (await del(stranger, "verbatimsite000")) === 403);
check("its owner can't either: it has posts", (await del(owner, "verbatimsite000")) === 400);
check("…and Verbatim is untouched", (await status(admin.collection("sites").getOne("verbatimsite000"))) === 200);

const first = await onboard(stranger, "try-onboarding");
check("an onboarded site without posts can be deleted", (await del(stranger, first.id)) === 200);
check("…the site is gone", (await status(admin.collection("sites").getOne(first.id))) === 404);
check("…and so are its collections, settings and membership", (await left(first.id)) === 0);
const again = await onboard(stranger, "try-onboarding");
check("the same slug can be created again", again.slug === "try-onboarding" && again.id !== first.id);
check("…and deleted again", (await del(stranger, again.id)) === 200);

const kept = await onboard(stranger, "has-a-draft");
await stranger.collection("posts").create({ title: "a draft", site: kept.id, status: "draft", type: "Essays" });
check("a site with one draft can't be deleted", (await del(stranger, kept.id)) === 400);
check("…and keeps everything", (await left(kept.id)) >= 3);

console.log(fails ? `${fails} FAILED` : "SITES: ALL PASS");
process.exitCode = fails ? 1 : 0;
