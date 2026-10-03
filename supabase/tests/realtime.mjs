// Realtime through the gateway, used the way the app uses it (lib/realtime.ts):
// change events reach members of the row's site and nobody else (row-level
// security applies to them), a site filter holds, and deletes arrive, by id
// only, on an unfiltered subscription (a filter can't match a deleted row).
// A subscription counts as live on Realtime's "Subscribed to PostgreSQL"
// system message, not on SUBSCRIBED, which comes a little earlier. Also
// records why the app re-reads a row instead of trusting the event: an update
// event leaves out a large value that didn't change.
import { V, admin, check, done, newId, ok, user } from "./lib.mjs";

const owner = await user("alaarabi16@gmail.com");
const stranger = await user("stranger@test.local");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function watch(client, table, filter, event = "*") {
  const events = [];
  return new Promise((resolve, reject) => {
    const channel = client
      .channel(`t-${table}-${Math.random()}`)
      .on("postgres_changes", { event, schema: "public", table, ...(filter ? { filter } : {}) }, (e) => events.push(e))
      .on("system", {}, (m) => {
        if (m.extension === "postgres_changes" && m.status === "ok") resolve({ events, channel });
      })
      .subscribe((s, err) => {
        if (s === "CHANNEL_ERROR" || s === "TIMED_OUT") reject(err ?? new Error(s));
      });
  });
}

const ownerPosts = await watch(owner, "posts", `site=eq.${V}`);
const strangerPosts = await watch(stranger, "posts", `site=eq.${V}`);
const ownerVersions = await watch(owner, "post_versions", `site=eq.${V}`);
const ownerSettings = await watch(owner, "app_settings", `site=eq.${V}`);
const ownerDeletes = await watch(owner, "posts", null, "DELETE");

const draft = newId();
await ok(admin.from("posts").insert({ id: draft, site: V, title: "rt draft", status: "draft", type: "Test", content_md: "x".repeat(10000) }));
const published = newId();
await ok(admin.from("posts").insert({ id: published, site: V, title: "rt published", status: "published", type: "Test" }));
await ok(admin.from("post_versions").insert({ id: newId(), site: V, post: draft, version: 1, content: "v1", created_by: "user" }));
await ok(admin.from("app_settings").upsert({ site: V, key: "rt", value: 1 }, { onConflict: "site,key" }));
await sleep(2000);

const ids = (w) => w.events.map((e) => e.new?.id ?? e.old?.id);
check("a member hears inserts in their site", ids(ownerPosts).includes(draft) && ids(ownerPosts).includes(published));
check("a stranger hears the published post", ids(strangerPosts).includes(published));
check("…but not the draft", !ids(strangerPosts).includes(draft));
check("a member hears versions", ownerVersions.events.length === 1);
check("a member hears settings", ownerSettings.events.some((e) => e.new?.key === "rt"));

const big = (await ok(admin.from("posts").select("id").eq("site", V).eq("title", "Post 0")))[0].id;
await ok(admin.from("posts").update({ favorited: true }).eq("id", big));
await sleep(1500);
const ev = ownerPosts.events.find((e) => e.eventType === "UPDATE" && e.new?.id === big);
check("an update to a 1.2 MB post arrives", !!ev);
console.log(`  note: the update event ${ev && "content_md" in ev.new && ev.new.content_md.length > 1000 ? "carried" : "left out"} the unchanged body`);

await ok(admin.from("posts").delete().eq("id", draft));
await sleep(1500);
check("a filtered subscription doesn't see the delete", !ownerPosts.events.some((e) => e.eventType === "DELETE"));
const gone = ownerDeletes.events.find((e) => e.old?.id === draft);
check("an unfiltered one does, with the id and nothing else", !!gone && Object.keys(gone.old).join() === "id");

for (const w of [ownerPosts, strangerPosts, ownerVersions, ownerSettings, ownerDeletes]) await w.channel.unsubscribe();
done("REALTIME");
process.exit();
