// The shape of production, small: the Verbatim site and its owner, a stranger,
// collections that exercise the slug rules, 33 posts (one 1.2 MB body, some
// published without published_at, as some imported posts are), versions,
// settings, a brief and its template, writing activity. Same data as
// pb/rehearsal/seed.mjs, written through the service role, so every trigger runs.
import { V, admin, newId, ok, user } from "./lib.mjs";

const owner = await user("alaarabi16@gmail.com");
await user("stranger@test.local");

await ok(admin.from("sites").insert({
  id: V, name: "Verbatim", slug: "verbatim", domain: "verbatim.ayadighaith.com", analytics_tenant: "verbatim",
}));
await ok(admin.from("site_members").insert({ site: V, user_id: owner.userId, role: "owner" }));

const collections = [
  ["Essays", "✍️"], ["Test", "🧪"],
  // A reserved word, an accent, a clash, a name with nothing to slugify.
  ["Admin", ""], ["Café Notes", ""], ["Essays!", ""], ["日記", ""],
];
for (const [i, [name, emoji]] of collections.entries()) {
  await ok(admin.from("collections").insert({ site: V, name, emoji, position: i + 1 }));
}

const big = "lorem ".repeat(200000);
for (let i = 0; i < 30; i++) {
  const id = newId();
  await ok(admin.from("posts").insert({
    id, site: V, title: `Post ${i}`, slug: `post-${i}`, type: i % 2 ? "Essays" : "Test",
    status: i % 3 === 0 ? "published" : "draft", content_md: i === 0 ? big : `content ${i}`, legacy_id: i + 1,
  }));
  for (let v = 1; v <= 3; v++) {
    await ok(admin.from("post_versions").insert({
      id: newId(), site: V, post: id, version: v, content: `v${v} of ${i}`, created_by: "user",
    }));
  }
}
for (let i = 0; i < 3; i++) {
  await ok(admin.from("posts").insert({
    id: newId(), site: V, title: `Fresh ${i}`, slug: `fresh-${i}`, type: "Café Notes", content_md: `fresh ${i}`,
    status: i === 1 ? "published" : "draft", published_at: i === 1 ? "2026-09-20T10:00:00.000Z" : null,
  }));
}

await ok(admin.from("app_settings").insert([
  { site: V, key: "bio", value: "I write." },
  { site: V, key: "flag", value: false },
]));
const template = newId();
await ok(admin.from("brief_templates").insert({ id: template, site: V, name: "T", body: "b", tenant: "verbatim" }));
await ok(admin.from("briefs").insert({ id: newId(), site: V, title: "B", status: "todo", template, tenant: "verbatim" }));
await ok(admin.from("writing_activity").insert([
  { site: V, tenant: "verbatim", day: "2026-09-01", words: 100 },
  { site: V, tenant: "verbatim", day: "2026-09-02", words: 50 },
]));
console.log("seeded");
