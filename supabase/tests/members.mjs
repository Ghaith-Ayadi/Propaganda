// A site's people (20261010000180_site_invites.sql): who may invite, change a
// role or remove someone; that a site keeps an owner; that an invite becomes a
// membership when the invited email signs in; and that nobody reads the invites
// table or someone else's site people.
import { admin, anon, check, done, ok, sql, status, user } from "./lib.mjs";

const owner = await user("members-owner@test.local");
const editor = await user("members-editor@test.local");
const newcomer = await user("Members-Newcomer@test.local");
const outsider = await user("members-outsider@test.local");
const guest = anon();

const { site } = await ok(owner.rpc("create_site", { site_name: "People", site_slug: "people-test" }));
await ok(admin.from("site_members").insert({ site: site.id, user_id: editor.userId, role: "editor" }));
const people = (c) => c.rpc("site_people", { p_site: site.id });
const invite = (c, email, role) => c.rpc("invite_member", { p_site: site.id, p_email: email, ...(role ? { p_role: role } : {}) });

// ---- reading ----
const seen = await ok(people(owner));
check("an owner sees both members with their emails", seen.members.length === 2 && seen.members.every((m) => m.email), JSON.stringify(seen.members.map((m) => m.email)));
check("…and who is the owner", seen.members.find((m) => m.email === "members-owner@test.local")?.role === "owner");
check("an editor sees the members too", (await ok(people(editor))).members.length === 2);
check("an editor sees no invites", (await ok(people(editor))).invites.length === 0);
check("a stranger can't read the people", (await status(people(outsider))) === 403);
check("anon can't read the people", (await status(people(guest))) >= 400);

// ---- inviting ----
check("an editor can't invite", (await status(invite(editor, "someone@test.local"))) === 403);
check("a stranger can't invite", (await status(invite(outsider, "someone@test.local"))) === 403);
check("anon can't invite", (await status(invite(guest, "someone@test.local"))) >= 400);
check("a bad address is rejected", (await status(invite(owner, "not-an-email"))) === 400);
check("a bad role is rejected", (await status(invite(owner, "someone@test.local", "admin"))) === 400);
check("a member can't be invited again", (await status(invite(owner, "MEMBERS-EDITOR@test.local"))) === 400);
const sent = await ok(invite(owner, "  Members-Newcomer@Test.local ", "owner"));
check("an owner invites (the address is lowercased)", sent.email === "members-newcomer@test.local" && sent.role === "owner");
const changed = await ok(invite(owner, "members-newcomer@test.local", "editor"));
check("inviting again changes the role, not the count", changed.role === "editor" && (await ok(people(owner))).invites.length === 1);
check("the invites table isn't readable by a member", (await owner.from("site_invites").select("*")).error !== null);
check("…nor through the private schema", (await owner.schema("private").from("site_invites").select("*")).error !== null);
check("an editor can't withdraw an invite", (await status(editor.rpc("revoke_invite", { p_site: site.id, p_email: "members-newcomer@test.local" }))) === 403);
check("…and the invite is still there", (await ok(people(owner))).invites.length === 1);

// ---- accepting ----
check("someone not invited joins nothing", (await ok(outsider.rpc("accept_invites"))).length === 0);
const joined = await ok(newcomer.rpc("accept_invites"));
check("the invited email joins on sign-in, whatever its case", joined.length === 1 && joined[0] === site.id, JSON.stringify(joined));
const after = await ok(people(owner));
check("…as the invited role", after.members.find((m) => m.email === "members-newcomer@test.local")?.role === "editor");
check("…and the invite is used up", after.invites.length === 0);
check("accepting again does nothing", (await ok(newcomer.rpc("accept_invites"))).length === 0);
check("anon can't accept", (await status(guest.rpc("accept_invites"))) >= 400);
check("the newcomer can now read the people", (await ok(people(newcomer))).members.length === 3);

// ---- roles and removal ----
const role = (c, uid, r) => c.rpc("set_member_role", { p_site: site.id, p_user: uid, p_role: r });
const remove = (c, uid) => c.rpc("remove_member", { p_site: site.id, p_user: uid });
check("an editor can't change a role", (await status(role(editor, editor.userId, "owner"))) === 403);
check("a stranger can't change a role", (await status(role(outsider, editor.userId, "owner"))) === 403);
check("a role has to be owner or editor", (await status(role(owner, editor.userId, "admin"))) === 400);
check("an owner makes an editor an owner", (await ok(role(owner, editor.userId, "owner"))).role === "owner");
check("an owner steps down when another owner stays", (await ok(role(owner, owner.userId, "editor"))).role === "editor");
check("the last owner can't step down", (await status(role(editor, editor.userId, "editor"))) === 400);
check("the last owner can't leave", (await status(remove(editor, editor.userId))) === 400);
check("an editor can't remove someone else", (await status(remove(owner, editor.userId))) === 403);
check("an owner removes an editor", (await status(remove(editor, newcomer.userId))) === 200);
check("…who is then off the site", (await status(people(newcomer))) === 403);
check("a member can leave", (await status(remove(owner, owner.userId))) === 200);
check("the site still has its owner", (await ok(people(editor))).members.length === 1);

// ---- the site's invites go with the site ----
await ok(invite(editor, "late@test.local"));
await ok(editor.rpc("delete_site", { site_id: site.id }));
check("deleting the site clears its invites", sql(`select count(*) from private.site_invites where site = '${site.id}'`)[0][0] === "0");

done("MEMBERS");
