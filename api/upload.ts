// Vercel serverless function — receives a file upload and stores it in Vercel Blob.
// The client cannot call the Blob write API directly (the token is a server secret),
// so all uploads are proxied through here.
//
// Requires a signed-in PocketBase member of the target site (`site` form field);
// files are namespaced under sites/<siteId>/... so tenants can't see or overwrite
// each other's uploads.
//
// Env: BLOB_READ_WRITE_TOKEN  (set in Vercel dashboard → Storage → Connect Blob store)

import { put } from "@vercel/blob";
import { requireMember } from "./_auth";

// Node.js runtime required — @vercel/blob uses Node streams (not Edge-compatible).

export async function POST(request: Request): Promise<Response> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return new Response("Invalid form data", { status: 400 });
  }

  const site = formData.get("site");
  if (typeof site !== "string" || !site) {
    return new Response("Missing site field", { status: 400 });
  }

  try {
    await requireMember(request, site);
  } catch (err) {
    if (err instanceof Response) return err;
    return new Response("Auth failed", { status: 500 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return new Response("Missing or invalid file field", { status: 400 });
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return new Response("Storage not configured", { status: 503 });
  }

  // Build a safe, site- and time-namespaced path. Existing blob URLs (from
  // before multi-tenancy) are untouched — this only affects new uploads.
  const year = new Date().getFullYear();
  const ts = Date.now().toString(36);
  const safeName = file.name
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "file";
  const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
  const pathname = `sites/${site}/${year}/${ts}-${safeName}.${ext}`;

  const blob = await put(pathname, file, {
    access: "public",
    token,
    cacheControlMaxAge: 31_536_000,
  });

  return new Response(JSON.stringify({ url: blob.url }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
