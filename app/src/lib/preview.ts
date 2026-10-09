// UI preview mode: the whole 0.2 UI on example data, with no server.
//
// LOCAL ONLY. Off unless the build sets VITE_UI_PREVIEW=1 (`npm run dev:ui`).
// Only then do the pages fall back to their placeholder adapters; everywhere
// else every page reads the tenant's own data and shows an empty state when
// there is none: a tenant never sees sample content. In preview this also
// seeds one fake account and tenant into this browser and tells the app it is
// offline, so the Workspace opens straight into the shell, sync never runs and
// nothing reaches a server.

export const UI_PREVIEW = import.meta.env.VITE_UI_PREVIEW === "1";

const ACCOUNT = {
  userId: "uipreview00000a",
  authId: "uipreview00000a",
  email: "preview@propaganda.local",
  name: "Preview",
  avatar: "",
  storeKey: "propaganda:uipreview:session",
};

const SITE = {
  id: "uipreviewsite00",
  name: "Kontra (preview)",
  slug: "kontra",
  domain: "",
  analyticsTenant: "",
  role: "owner",
};

function seed(): void {
  try {
    const accounts = JSON.parse(localStorage.getItem("propaganda:accounts") || "[]") as { userId: string }[];
    if (!accounts.some((a) => a.userId === ACCOUNT.userId)) {
      localStorage.setItem("propaganda:accounts", JSON.stringify([ACCOUNT, ...accounts]));
    }
    // A session that looks renewable and never expires: offline, it is never checked.
    localStorage.setItem(
      ACCOUNT.storeKey,
      JSON.stringify({
        access_token: "preview",
        refresh_token: "preview",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: 4102444800,
        user: { id: ACCOUNT.authId, email: ACCOUNT.email, app_metadata: {}, user_metadata: { full_name: ACCOUNT.name } },
      }),
    );
    localStorage.setItem(`propaganda:sites:${ACCOUNT.userId}`, JSON.stringify([SITE]));
    if (!localStorage.getItem("propaganda:active")) {
      localStorage.setItem("propaganda:active", JSON.stringify({ userId: ACCOUNT.userId, siteId: SITE.id }));
    }
  } catch {
    // Private mode: the shell shows sign-in instead.
  }
}

/** Run once, before anything renders. */
export function installPreview(): void {
  if (!UI_PREVIEW || typeof window === "undefined") return;
  seed();
  // Offline as far as the app knows: no sync, no session checks, no realtime.
  Object.defineProperty(Navigator.prototype, "onLine", { configurable: true, get: () => false });
  // The editor lives at /admin; the root is the public blog, which needs a server.
  if (window.location.pathname === "/" || window.location.pathname === "") {
    window.history.replaceState(null, "", "/admin" + window.location.hash);
  }
}

/**
 * Example writing for the preview tenant's own local database (never a real
 * one): a collection and a few posts, so Content and the editor have something
 * to open. Only fills an empty database.
 */
export async function seedPreviewContent(): Promise<void> {
  if (!UI_PREVIEW) return;
  const { db } = await import("@/lib/db");
  if (db.siteId !== SITE.id || (await db.collections.count()) > 0) return;
  const now = Date.now();
  const day = 86_400_000;
  await db.collections.add({ name: "Field notes", slug: "field-notes", emoji: null, description: "What we learn shipping Kontra.", position: 0, isHidden: false, createdAt: now, updatedAt: now });
  const posts: [string, "published" | "draft", string][] = [
    ["Why month-end close still takes eight days", "published", "Most finance teams lose three of those days to waiting on approvals.\n\nHere is where the time goes, and what changes when the approvals move into the ledger."],
    ["Approvals belong next to the numbers", "published", "An approval that lives in email is an approval nobody can audit.\n\nWe moved ours into the ledger and the close got two days shorter."],
    ["Draft: what an auditor actually asks for", "draft", "Notes from three audits this year. The pattern is simple: show who approved what, and when."],
  ];
  await db.posts.bulkAdd(
    posts.map(([title, status, content], i) => ({
      id: `uipreviewpost0${i}`,
      number: i + 1,
      title,
      slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      postId: null,
      type: "Field notes",
      status,
      subtitle: null,
      doneAt: status === "published" ? now - (10 - i * 3) * day : null,
      publishedAt: status === "published" ? now - (10 - i * 3) * day : null,
      excerpt: null,
      category: null,
      tags: [],
      content,
      notionId: null,
      favorited: false,
      collectionSeq: i + 1,
      wordCount: content.split(/\s+/).length,
      shareableQuotes: null,
      createdAt: now - (12 - i * 3) * day,
      updatedAt: now - (10 - i * 3) * day,
      syncedAt: now,
      dirty: false,
    })),
  );
}
