// Uploads an image to Vercel Blob via /api/upload.
// Applies client-side compression before upload (browser-image-compression).
// Non-image files are sent as-is (no compression).

import imageCompression from "browser-image-compression";

const ACCEPTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/avif",
]);

const COMPRESSION_OPTIONS = {
  maxSizeMB: 1,           // target ≤1MB
  maxWidthOrHeight: 1920, // never enlarge
  useWebWorker: true,
  fileType: "image/webp", // convert to WebP on compression
  initialQuality: 0.85,
};

async function compress(file: File): Promise<File> {
  // Only compress raster images (skip SVG, GIF animations, non-images).
  if (
    file.type === "image/svg+xml" ||
    file.type === "image/gif" ||
    !ACCEPTED_IMAGE_TYPES.has(file.type)
  ) {
    return file;
  }
  try {
    const compressed = await imageCompression(file, COMPRESSION_OPTIONS);
    // Rename to .webp if we converted.
    if (COMPRESSION_OPTIONS.fileType === "image/webp" && !file.name.endsWith(".webp")) {
      const webpName = file.name.replace(/\.[^.]+$/, ".webp");
      return new File([compressed], webpName, { type: "image/webp" });
    }
    return compressed;
  } catch (err) {
    console.warn("Image compression failed — uploading original:", err);
    return file;
  }
}

export async function uploadFile(file: File): Promise<string> {
  const toUpload = await compress(file);

  const form = new FormData();
  form.append("file", toUpload);

  const res = await fetch("/api/upload", { method: "POST", body: form });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Upload failed (${res.status}): ${text}`);
  }

  const { url } = (await res.json()) as { url: string };
  return url;
}
