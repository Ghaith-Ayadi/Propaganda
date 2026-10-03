// Deleting a site (delete_site): owner only, never while the site has a post,
// and everything the site owned goes with it, so the same slug can be created
// again (how onboarding gets tested). The port of pb/rehearsal/sites.mjs.
import { V, admin, anon, check, done, newId, ok, status, user } from "./lib.mjs";

const owner = await user("alaarabi16@gmail.com");
const stranger = await user("stranger@test.local");
const guest = anon();

const del = (c, id) => status(c.rpc("delete_site", { site_id: id }));
const onboard = async (c, slug) => {
  const { site } = await ok(c.rpc("create_site", { site_name: "Try", site_slug: slug }));
  await ok(c.from("collections").insert({ site: site.id, name: "Essays", emoji: "", description: "", position: 0, is_hidden: false }));
  await ok(c.from("app_settings").insert({ site: site.id, key: "site.title", value: "Try" }));
  return site;
};
const left = async (id) => {
  let n = 0;
  for (const t of ["collections", "app_settings", "site_members", "brief_templates", "writing_activity"]) {
    n += (await ok(admin.from(t).select("id").eq("site", id))).length;
  }
  return n;
};
const exists = async (id) => (await ok(admin.from("sites").select("id").eq("id", id))).length === 1;

check("signed out can't delete a site", (await del(guest, V)) === 401);
check("a non-member can't delete Verbatim", (await del(stranger, V)) === 403);
check("its owner can't either: it has posts", (await del(owner, V)) === 400);
check("…and Verbatim is untouched", await exists(V));

const first = await onboard(stranger, "try-onboarding");
await ok(stranger.from("brief_templates").insert({ id: newId(), site: first.id, name: "T" }));
await ok(stranger.rpc("increment_writing_activity", { p_site: first.id, p_day: "2026-10-01", p_delta: 3 }));
check("an onboarded site without posts can be deleted", (await del(stranger, first.id)) === 200);
check("…the site is gone", !(await exists(first.id)));
check("…and so is everything it owned", (await left(first.id)) === 0);
const again = await onboard(stranger, "try-onboarding");
check("the same slug can be created again", again.slug === "try-onboarding" && again.id !== first.id);
check("…and deleted again", (await del(stranger, again.id)) === 200);

const kept = await onboard(stranger, "has-a-draft");
await ok(stranger.from("posts").insert({ id: newId(), title: "a draft", site: kept.id, status: "draft", type: "Essays" }));
check("a site with one draft can't be deleted", (await del(stranger, kept.id)) === 400);
check("…and keeps everything", (await left(kept.id)) >= 3);

done("SITES");
