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

// What the agents write reaches the app live (20261010000070_realtime_agents):
// the worker turning a proposal to "sent", a pitch or a draft in review, a batch.
const ownerProposals = await watch(owner, "strategy_proposals", `site=eq.${V}`);
const strangerProposals = await watch(stranger, "strategy_proposals", `site=eq.${V}`);
const ownerBriefs = await watch(owner, "briefs", `site=eq.${V}`);
const strangerBriefs = await watch(stranger, "briefs", `site=eq.${V}`);
const ownerBatches = await watch(owner, "content_batches", `site=eq.${V}`);
const ownerGoals = await watch(owner, "goal_versions", `site=eq.${V}`);

const proposal = newId();
await ok(admin.from("strategy_proposals").insert({ id: proposal, site: V, quarter: "2026-Q4", kind: "onboarding", status: "running" }));
await ok(admin.from("strategy_proposals").update({ status: "sent", proposal: { summary: "x" } }).eq("id", proposal));
const brief = newId();
await ok(admin.from("briefs").insert({ id: brief, site: V, title: "rt pitch", status: "pitched" }));
await ok(admin.from("content_batches").insert({ site: V, quarter: "2026-Q4", number: 1, quota: 3 }));
await ok(admin.from("goal_versions").insert({ site: V, quarter: "2026-Q4", version: 1, targets: {}, proposal }));
await sleep(2000);

check("a member hears a proposal turn sent", ownerProposals.events.some((e) => e.eventType === "UPDATE" && e.new?.id === proposal && e.new?.status === "sent"));
check("…a stranger hears nothing of it", strangerProposals.events.length === 0);
check("a member hears a new pitch", ids(ownerBriefs).includes(brief));
check("…a stranger doesn't", strangerBriefs.events.length === 0);
check("a member hears a new batch", ownerBatches.events.length === 1);
check("a member hears approved goals", ownerGoals.events.length === 1);
await ok(admin.from("goal_versions").delete().eq("site", V));
await ok(admin.from("content_batches").delete().eq("site", V));
await ok(admin.from("strategy_proposals").delete().eq("id", proposal));
await ok(admin.from("briefs").delete().eq("id", brief));
for (const w of [ownerProposals, strangerProposals, ownerBriefs, strangerBriefs, ownerBatches, ownerGoals]) await w.channel.unsubscribe();
done("REALTIME");
process.exit();
