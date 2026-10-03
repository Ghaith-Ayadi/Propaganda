// Who may read and write what (20261002000003 + the site functions). The port
// of pb/rehearsal/rules.mjs: members vs strangers vs anonymous, cross-site
// writes, memberships, site management, writing activity. The pre-multi-tenant
// checks (creates without a site from old builds) are gone with PocketBase: a
// site is required.
import { V, anon, check, done, newId, ok, status, user } from "./lib.mjs";

const owner = await user("alaarabi16@gmail.com");
const stranger = await user("stranger@test.local");
const guest = anon();

const ownerPosts = await ok(owner.from("posts").select("*").eq("site", V).order("number"));
check("owner sees every Verbatim post", ownerPosts.length === 33, ownerPosts.length);
const strangerPosts = await ok(stranger.from("posts").select("*"));
check("stranger sees only published", strangerPosts.length > 0 && strangerPosts.every((p) => p.status === "published"), strangerPosts.length);
const guestPosts = await ok(guest.from("posts").select("*"));
check("anon sees only published", guestPosts.length === strangerPosts.length && guestPosts.every((p) => p.status === "published"));
check("stranger can't list versions", (await ok(stranger.from("post_versions").select("id"))).length === 0);
check("anon can't list versions", (await guest.from("post_versions").select("id")).error !== null);
check("stranger can't list briefs", (await ok(stranger.from("briefs").select("id"))).length === 0);
check("stranger can't list templates", (await ok(stranger.from("brief_templates").select("id"))).length === 0);
check("anon can read settings", (await ok(guest.from("app_settings").select("*").eq("site", V))).length === 2);
check("a post without a site is rejected", (await stranger.from("posts").insert({ id: newId(), title: "x" })).error !== null);
check("anon can't write", (await status(guest.from("posts").insert({ id: newId(), site: V, title: "x" }))) >= 400);

// ---- a stranger makes a site ----
check("anon can't create a site", (await status(guest.rpc("create_site", { site_name: "A", site_slug: "anon-site" }))) === 401);
check("reserved slug rejected", (await status(stranger.rpc("create_site", { site_name: "A", site_slug: "admin" }))) === 400);
check("taken slug rejected", (await status(stranger.rpc("create_site", { site_name: "A", site_slug: "verbatim" }))) === 400);
const created = await ok(stranger.rpc("create_site", { site_name: "Propaganda", site_slug: "propaganda" }));
const site = created.site;
check("stranger creates a site", site?.slug === "propaganda" && created.membership?.role === "owner");
check("…with its analytics tenant", site?.analytics_tenant === "propaganda");

const sp = await ok(stranger.from("posts").insert({ id: newId(), title: "s draft", site: site.id, status: "draft", type: "Essays" }).select().single());
check("stranger writes own site", sp.site === site.id);
check("stranger can't write into Verbatim", (await status(stranger.from("posts").insert({ id: newId(), title: "x", site: V }))) === 403);
const target = ownerPosts[1];
check("stranger can't update a Verbatim post", (await ok(stranger.from("posts").update({ title: "pwn" }).eq("id", target.id).select())).length === 0);
check("stranger can't delete a Verbatim post", (await ok(stranger.from("posts").delete().eq("id", target.id).select())).length === 0);
const after = await ok(owner.from("posts").select("title").eq("id", target.id).single());
check("…and it is untouched", after.title === target.title);
check("owner can't see stranger draft", (await ok(owner.from("posts").select("id").eq("id", sp.id))).length === 0);
check("owner can't move a post to another site", (await owner.from("posts").update({ site: site.id }).eq("id", ownerPosts[0].id)).error !== null);
check("stranger can't pull a Verbatim post into own site", (await ok(stranger.from("posts").update({ site: site.id }).eq("id", ownerPosts[2].id).select())).length === 0);
check("same collection name in 2 sites", (await status(stranger.from("collections").insert({ name: "Essays", site: site.id }))) === 201);
check("same setting key in 2 sites", (await status(stranger.from("app_settings").insert({ key: "bio", value: "hi", site: site.id }))) === 201);
check("dup collection in same site rejected", (await status(stranger.from("collections").insert({ name: "Essays", site: site.id }))) === 409);

const mem = await ok(stranger.from("site_members").select("*"));
check("stranger sees only own membership", mem.length === 1 && mem[0].site === site.id);
check("stranger can't add himself to Verbatim", (await stranger.from("site_members").insert({ site: V, user_id: stranger.userId, role: "owner" })).error !== null);
check("non-owner update_site rejected", (await status(stranger.rpc("update_site", { site_id: V, site_name: "pwn" }))) === 403);
check("owner update_site works", (await ok(owner.rpc("update_site", { site_id: V, site_name: "Verbatim" }))).site.name === "Verbatim");
check("sites can't be inserted directly", (await stranger.from("sites").insert({ name: "x", slug: "xx" })).error !== null);
check("sites can't be updated directly", (await owner.from("sites").update({ name: "x" }).eq("id", V)).error !== null);
const publicSites = await ok(guest.from("sites").select("*"));
check("sites public", publicSites.length === 2);
check("created_by and the post counter aren't readable", publicSites.every((s) => !("created_by" in s) && !("post_counter" in s)));

// ---- writing activity ----
const inc = await ok(owner.rpc("increment_writing_activity", { p_site: V, p_day: "2026-09-01", p_delta: 5 }));
check("increment adds to the day", inc.words === 105 && inc.tenant === "verbatim", JSON.stringify(inc));
const inc2 = await ok(owner.rpc("increment_writing_activity", { p_site: V, p_day: "2026-09-03", p_delta: 7 }));
check("increment creates a new day", inc2.words === 7);
const burst = await Promise.all(Array.from({ length: 10 }, () => owner.rpc("increment_writing_activity", { p_site: V, p_day: "2026-09-03", p_delta: 1 })));
const day3 = await ok(owner.from("writing_activity").select("words").eq("site", V).eq("day", "2026-09-03").single());
check("10 increments at once all count", burst.every((r) => !r.error) && day3.words === 17, day3.words);
check("a negative delta adds nothing", (await ok(owner.rpc("increment_writing_activity", { p_site: V, p_day: "2026-09-03", p_delta: -50 }))).words === 17);
check("a bad day is rejected", (await status(owner.rpc("increment_writing_activity", { p_site: V, p_day: "Sept 3", p_delta: 1 }))) === 400);
check("stranger increment on Verbatim rejected", (await status(stranger.rpc("increment_writing_activity", { p_site: V, p_day: "2026-09-01", p_delta: 5 }))) === 403);
check("stranger can't read Verbatim activity", (await ok(stranger.from("writing_activity").select("id").eq("site", V))).length === 0);
check("activity can't be written directly", (await owner.from("writing_activity").insert({ tenant: "verbatim", day: "2026-09-09", site: V })).error !== null);

// ---- several sites ----
const s2 = (await ok(owner.rpc("create_site", { site_name: "Second", site_slug: "second-site" }))).site;
check("a 2-site owner writes to either", (await status(owner.from("posts").insert({ id: newId(), title: "ok", site: s2.id }))) === 201);
check("…but can't move a post between them", (await owner.from("posts").update({ site: s2.id }).eq("id", ownerPosts[3].id)).error !== null);

// ---- versions ----
check("stranger can't attach a version to a Verbatim post (Verbatim site)",
  (await stranger.from("post_versions").insert({ id: newId(), post: ownerPosts[3].id, site: V, version: 99, content: "x", created_by: "user" })).error !== null);
check("stranger can't attach a version to a Verbatim post (own site)",
  (await stranger.from("post_versions").insert({ id: newId(), post: ownerPosts[3].id, site: site.id, version: 99, content: "x", created_by: "user" })).error !== null);
check("stranger version on own post ok",
  (await status(stranger.from("post_versions").insert({ id: newId(), post: sp.id, site: site.id, version: 1, content: "x", created_by: "user" }))) === 201);
const dupe = await stranger.from("post_versions").insert({ id: newId(), post: sp.id, site: site.id, version: 1, content: "y", created_by: "user" });
check("a taken version number is a unique violation on (post, version)", dupe.error?.code === "23505" && /post_versions_post_version_key/.test(dupe.error.message), dupe.error?.message);
const orphan = await stranger.from("post_versions").insert({ id: newId(), post: newId(), site: site.id, version: 1, content: "y", created_by: "user" });
check("a version of a post not on the server is a foreign key violation", orphan.error?.code === "23503", orphan.error?.code);

// ---- server-owned fields ----
const stamped = await ok(stranger.from("posts").insert({ id: newId(), site: site.id, title: "t", created: "2000-01-01T00:00:00Z", updated: "2000-01-01T00:00:00Z" }).select().single());
check("clients can't set created / updated", !stamped.created.startsWith("2000") && !stamped.updated.startsWith("2000"));
const bumped = await ok(stranger.from("posts").update({ title: "t2" }).eq("id", stamped.id).select().single());
check("an update moves `updated`, not `created`", bumped.created === stamped.created && Date.parse(bumped.updated) >= Date.parse(stamped.updated));

done("ACCESS");
