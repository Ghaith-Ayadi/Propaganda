import PocketBase from "pocketbase";
const pb = new PocketBase("http://127.0.0.1:8091");
await pb.collection("_superusers").authWithPassword("admin@test.local", "Passw0rd123!");
const u = await pb.collection("users").create({ email: "alaarabi16@gmail.com", password: "ownerpass123", passwordConfirm: "ownerpass123", name: "Ghaith" });
await pb.collection("users").create({ email: "stranger@test.local", password: "strangerpass1", passwordConfirm: "strangerpass1", name: "Stranger" });
await pb.collection("collections").create({ name: "Essays", emoji: "✍️", position: 1 });
await pb.collection("collections").create({ name: "Test", emoji: "🧪", position: 2 });
// For the addresses migration (1758000007): a reserved word, a clash, a name
// with nothing to slugify.
await pb.collection("collections").create({ name: "Admin", position: 3 });
await pb.collection("collections").create({ name: "Café Notes", position: 4 });
await pb.collection("collections").create({ name: "Essays!", position: 5 });
await pb.collection("collections").create({ name: "日記", position: 6 });
const big = "lorem ".repeat(200000);
for (let i = 0; i < 30; i++) {
  const p = await pb.collection("posts").create({ title: `Post ${i}`, slug: `post-${i}`, type: i % 2 ? "Essays" : "Test", status: i % 3 === 0 ? "published" : "draft", content_md: i === 0 ? big : `content ${i}`, legacy_id: i + 1 });
  for (let v = 1; v <= 3; v++) await pb.collection("post_versions").create({ post: p.id, version: v, content: `v${v} of ${i}`, created_by: "user" });
}
// Posts from after the Postgres days: no legacy_id. One is published.
for (let i = 0; i < 3; i++) {
  await pb.collection("posts").create({
    title: `Fresh ${i}`, slug: `fresh-${i}`, type: "Café Notes", content_md: `fresh ${i}`,
    status: i === 1 ? "published" : "draft", published_at: i === 1 ? "2026-09-20 10:00:00.000Z" : "",
  });
}
await pb.collection("app_settings").create({ key: "bio", value: "I write." });
await pb.collection("app_settings").create({ key: "flag", value: false });
const t = await pb.collection("brief_templates").create({ name: "T", body: "b", tenant: "verbatim" });
await pb.collection("briefs").create({ title: "B", status: "todo", template: t.id, tenant: "verbatim" });
await pb.collection("writing_activity").create({ tenant: "verbatim", day: "2026-09-01", words: 100 });
await pb.collection("writing_activity").create({ tenant: "verbatim", day: "2026-09-02", words: 50 });
await pb.collection("writing_activity").create({ tenant: "other", day: "2026-09-01", words: 7 });
console.log("seeded", u.id);
