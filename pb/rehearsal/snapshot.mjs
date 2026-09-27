// Dumps every content row (id, updated, sha of content fields) for before/after comparison.
import PocketBase from "pocketbase";
import { createHash } from "crypto";
const pb = new PocketBase("http://127.0.0.1:8091");
await pb.collection("_superusers").authWithPassword("admin@test.local", "Passw0rd123!");
const out = {};
for (const c of ["posts", "post_versions", "collections", "briefs", "brief_templates", "app_settings", "writing_activity", "users"]) {
  const rows = await pb.collection(c).getFullList({ sort: "id" });
  out[c] = rows.map((r) => { const { site, collectionId, collectionName, expand, ...rest } = r; return [r.id, createHash("sha1").update(JSON.stringify(rest)).digest("hex")]; });
}
console.log(JSON.stringify(out));
