// Vercel serverless function — receives a file upload and stores it in Vercel Blob.
// The client cannot call the Blob write API directly (the token is a server secret),
// so all uploads are proxied through here.
//
// Env: BLOB_READ_WRITE_TOKEN  (set in Vercel dashboard → Storage → Connect Blob store)

import { put } from "@vercel/blob";

export const config = {
  runtime: "edge",
};

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return new Response("Invalid form data", { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return new Response("Missing or invalid file field", { status: 400 });
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return new Response("Storage not configured", { status: 503 });
  }

  // Build a safe, time-namespaced path.
  const year = new Date().getFullYear();
  const ts = Date.now().toString(36);
  const safeName = file.name
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "file";
  const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
  const pathname = `${year}/${ts}-${safeName}.${ext}`;

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
