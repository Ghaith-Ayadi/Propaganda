// The waitlist (join_waitlist, admin_waitlist): anyone can join, joining twice
// keeps one row, and only a superadmin can read the list.
import { admin, anon, check, done, ok, sql, status, user } from "./lib.mjs";

const guest = anon();
const ayadi = await user("alaarabi16@gmail.com");
const stranger = await user("stranger@test.local");
sql(`insert into private.superadmins (user_id) values ('${ayadi.userId}') on conflict do nothing`);
sql("truncate private.waitlist");

const join = (c, args) => status(c.rpc("join_waitlist", args));
check("signed out can join", (await join(guest, { p_email: "ada@acme.test", p_name: "Ada", p_website: "acme.test" })) === 204);
check("a bad email is refused", (await join(guest, { p_email: "not an email" })) === 400);
check("joining again with the same email (other case) keeps one row",
  (await join(guest, { p_email: "ADA@acme.test", p_note: "We blog a lot" })) === 204);
const rows = sql("select email, name, website, note from private.waitlist");
check("…and fills in what's new without wiping the rest",
  rows.length === 1 && rows[0][1] === "Ada" && rows[0][2] === "acme.test" && rows[0][3] === "We blog a lot", JSON.stringify(rows));

check("signed out can't read the table", (await status(guest.schema("private").from("waitlist").select("*"))) >= 400);
check("signed out can't call admin_waitlist", (await status(guest.rpc("admin_waitlist"))) >= 400);
check("a signed-in non-superadmin can't either", (await status(stranger.rpc("admin_waitlist"))) === 403);
const list = await ok(ayadi.rpc("admin_waitlist"));
check("a superadmin reads the list", list.length === 1 && list[0].email === "ada@acme.test");
check("the service role sees it through SQL only", (await status(admin.from("waitlist").select("*"))) >= 400);

done("waitlist");
