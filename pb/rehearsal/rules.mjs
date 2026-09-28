import PocketBase from "pocketbase";
const URL = "http://127.0.0.1:8091";
const client = async (email, pass) => { const pb = new PocketBase(URL); pb.autoCancellation(false); if (email) await pb.collection("users").authWithPassword(email, pass); return pb; };
process.on("unhandledRejection",e=>{console.log("ERR",e.status,e.url,JSON.stringify(e.response));process.exit(1)});
const owner = await client("alaarabi16@gmail.com", "ownerpass123");
const stranger = await client("stranger@test.local", "strangerpass1");
const anon = await client();
let fails = 0;
const check = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name} ${extra}`); if (!cond) fails++; };
const status = async (p) => { try { await p; return 200; } catch (e) { return e.status; } };

const ownerPosts = await owner.collection("posts").getFullList();
check("owner sees all 30 posts", ownerPosts.length >= 30, ownerPosts.length);
const strangerPosts = await stranger.collection("posts").getFullList();
check("stranger sees only published", strangerPosts.every((p) => p.status === "published"), strangerPosts.length);
const anonPosts = await anon.collection("posts").getFullList();
check("anon sees only published", anonPosts.length === strangerPosts.length && anonPosts.every((p) => p.status === "published"));
check("stranger can't list versions", (await stranger.collection("post_versions").getFullList()).length === 0);
check("stranger can't list briefs", (await stranger.collection("briefs").getFullList()).length === 0);
check("anon can read settings", (await anon.collection("app_settings").getFullList()).length === 2);

// old client: create without site
const legacy = await owner.collection("posts").create({ title: "legacy client draft", type: "Test", status: "draft" });
check("old-client create gets Verbatim", legacy.site === "verbatimsite000", legacy.site);
const legacyV = await owner.collection("post_versions").create({ post: legacy.id, version: 1, content: "x", created_by: "user" });
check("old-client version inherits post site", legacyV.site === "verbatimsite000");
const upd = await owner.collection("posts").update(legacy.id, { title: "legacy edit" });
check("old-client update works", upd.title === "legacy edit");
check("stranger create w/o site rejected", (await status(stranger.collection("posts").create({ title: "x" }))) === 400);

// stranger makes a site
check("reserved slug rejected", (await status(stranger.send("/api/propaganda/sites", { method: "POST", body: { name: "A", slug: "admin" } }))) === 400);
check("taken slug rejected", (await status(stranger.send("/api/propaganda/sites", { method: "POST", body: { name: "A", slug: "verbatim" } }))) === 400);
const { site } = await stranger.send("/api/propaganda/sites", { method: "POST", body: { name: "Propaganda", slug: "propaganda" } });
check("stranger creates a site", site?.slug === "propaganda");
const sp = await stranger.collection("posts").create({ title: "s draft", site: site.id, status: "draft", type: "Essays" });
check("stranger writes own site", sp.site === site.id);
check("stranger can't write into Verbatim", (await status(stranger.collection("posts").create({ title: "x", site: "verbatimsite000" }))) === 400);
check("stranger can't update Verbatim post", (await status(stranger.collection("posts").update(ownerPosts[1].id, { title: "pwn" }))) === 404);
check("stranger can't delete Verbatim post", (await status(stranger.collection("posts").delete(ownerPosts[1].id))) === 404);
check("owner can't see stranger draft", (await status(owner.collection("posts").getOne(sp.id))) === 404);
check("owner can't move post to other site", (await status(owner.collection("posts").update(legacy.id, { site: site.id }))) !== 200);
check("stranger can't pull Verbatim post into own site", (await status(stranger.collection("posts").update(ownerPosts[2].id, { site: site.id }))) === 404);
check("same collection name in 2 sites", (await status(stranger.collection("collections").create({ name: "Essays", site: site.id }))) === 200);
check("same setting key in 2 sites", (await status(stranger.collection("app_settings").create({ key: "bio", value: "hi", site: site.id }))) === 200);
check("dup collection in same site rejected", (await status(stranger.collection("collections").create({ name: "Essays", site: site.id }))) === 400);
const mem = await stranger.collection("site_members").getFullList();
check("stranger sees only own membership", mem.length === 1 && mem[0].site === site.id);
check("stranger can't add himself to Verbatim", (await status(stranger.collection("site_members").create({ site: "verbatimsite000", user: stranger.authStore.record.id, role: "owner" }))) !== 200);
check("non-owner PATCH rejected", (await status(stranger.send("/api/propaganda/sites/verbatimsite000", { method: "PATCH", body: { name: "pwn" } }))) === 403);
check("owner PATCH works", (await owner.send("/api/propaganda/sites/verbatimsite000", { method: "PATCH", body: { name: "Verbatim" } })).site.name === "Verbatim");
check("sites create via API blocked", (await status(stranger.collection("sites").create({ name: "x", slug: "xx" }))) !== 200);
check("sites public", (await anon.collection("sites").getFullList()).length === 2);
check("created_by hidden", (await anon.collection("sites").getFullList())[0].created_by === undefined);

// activity
const inc = await owner.send("/api/verbose/increment", { method: "POST", body: { tenant: "verbatim", day: "2026-09-01", delta: 5 } });
check("old-format increment", inc.words === 105, JSON.stringify(inc));
const inc2 = await owner.send("/api/verbose/increment", { method: "POST", body: { site: "verbatimsite000", day: "2026-09-01", delta: 5 } });
check("new-format increment", inc2.words === 110);
check("stranger increment on Verbatim rejected", (await status(stranger.send("/api/verbose/increment", { method: "POST", body: { site: "verbatimsite000", day: "2026-09-01", delta: 5 } }))) === 403);
check("stranger can't read Verbatim activity", (await stranger.collection("writing_activity").getFullList()).length === 0);
check("activity direct create blocked", (await status(owner.collection("writing_activity").create({ tenant: "verbatim", day: "2026-09-09", site: "verbatimsite000" }))) !== 200);

// owner with 2 sites, no site in body -> rejected, not misfiled
const { site: s2 } = await owner.send("/api/propaganda/sites", { method: "POST", body: { name: "Second", slug: "second-site" } });
check("2-site owner create w/o site rejected", (await status(owner.collection("posts").create({ title: "ambiguous" }))) === 400);
check("2-site owner explicit site ok", (await status(owner.collection("posts").create({ title: "ok", site: s2.id }))) === 200);
console.log(fails ? `${fails} FAILED` : "ALL PASS");
check("stranger can't attach version to Verbatim post (no site)", (await status(stranger.collection("post_versions").create({ post: ownerPosts[3].id, version: 99, content: "x", created_by: "user" }))) === 400);
check("stranger can't attach version to Verbatim post (own site)", (await status(stranger.collection("post_versions").create({ post: ownerPosts[3].id, site: site.id, version: 99, content: "x", created_by: "user" }))) === 400);
check("stranger version on own post ok", (await status(stranger.collection("post_versions").create({ post: sp.id, site: site.id, version: 1, content: "x", created_by: "user" }))) === 200);
const su = new PocketBase(URL); await su.collection("_superusers").authWithPassword("admin@test.local", "Passw0rd123!");
const uc = await su.collections.getOne("users");
console.log("users rules", JSON.stringify({ c: uc.createRule, l: uc.listRule, v: uc.viewRule, u: uc.updateRule }), "tokenDuration", uc.authToken.duration, "otp", uc.otp.enabled);
console.log(fails ? `${fails} FAILED` : "ALL PASS (2)");
process.exitCode = fails ? 1 : 0;
