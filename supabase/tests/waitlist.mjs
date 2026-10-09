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
check("…and fills in what was empty without wiping the rest",
  rows.length === 1 && rows[0][1] === "Ada" && rows[0][2] === "acme.test" && rows[0][3] === "We blog a lot", JSON.stringify(rows));
await join(guest, { p_email: "ada@acme.test", p_name: "Mallory", p_note: "rewritten" });
const after = sql("select name, note from private.waitlist");
check("joining again can't rewrite fields already filled", after[0][0] === "Ada" && after[0][1] === "We blog a lot", JSON.stringify(after));

check("signed out can't read the table", (await status(guest.schema("private").from("waitlist").select("*"))) >= 400);
check("signed out can't call admin_waitlist", (await status(guest.rpc("admin_waitlist"))) >= 400);
check("a signed-in non-superadmin can't either", (await status(stranger.rpc("admin_waitlist"))) === 403);
const list = await ok(ayadi.rpc("admin_waitlist"));
check("a superadmin reads the list", list.length === 1 && list[0].email === "ada@acme.test");
check("the service role sees it through SQL only", (await status(admin.from("waitlist").select("*"))) >= 400);

sql("insert into private.waitlist (email) select 'bulk' || g || '@x.test' from generate_series(1, 199) g");
check("past 200 new rows an hour, joining is refused", (await join(guest, { p_email: "late@acme.test" })) >= 400);

done("waitlist");
