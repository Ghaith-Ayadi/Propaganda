// Domain types.
// Mirror the Supabase schema but use camelCase + ms timestamps locally.

export type PostStatus = "draft" | "done" | "published";

export interface Post {
  /** Record id, minted on the client (lib/supabase.ts newId). */
  id: string;
  /** The post's number in its site: 1, 2, 3… Set by the server on create, never reused or edited; null until then. */
  number: number | null;
  title: string;
  slug: string;                 // URL slug: follows the title until first published, then fixed (lib/slug.ts)
  postId: string | null;        // legacy {PREFIX}·{SEQ} code; old links by it still resolve. Not shown.
  type: string;                 // free-form collection name (hokum, journal, brief, …)
  status: PostStatus | null;
  subtitle: string | null;      // short standfirst shown below the title
  doneAt: number | null;        // first time writing finished (draft → done or draft → published)
  publishedAt: number | null;
  excerpt: string | null;
  category: string | null;      // legacy single free-text category; superseded by tags, kept as a read fallback
  tags: string[];               // tenant-wide, multi-value tags (derived from category when unset)
  content: string;              // Markdown body (content_md in the DB)
  notionId: string | null;
  favorited: boolean;
  collectionSeq: number | null; // 1-based position inside its collection
  wordCount: number | null;
  shareableQuotes: string[] | null; // LLM-extracted pull-quotes; null = not yet run
  createdAt: number;
  updatedAt: number;
  // sync metadata, local-only
  syncedAt?: number | null;
  dirty?: boolean;
  /** Server `updated` (ms) of a push answered while this row was edited again: that copy is ours, never newer (lib/sync.ts). */
  pushedUpdatedAt?: number;
}

export interface Collection {
  name: string;
  /** URL segment, set by the server from the name ("" until it has answered; see lib/slug.ts collectionSlugOf). */
  slug: string;
  emoji: string | null;
  description: string | null;
  position: number;
  isHidden: boolean;            // hidden from public nav; articles 404 to a "private collection" page
  createdAt: number;
  updatedAt: number;
  syncedAt?: number | null;
  dirty?: boolean;
  /** Server `updated` (ms) of a push answered while this row was edited again: that copy is ours, never newer (lib/sync.ts). */
  pushedUpdatedAt?: number;
}

export interface PostVersion {
  id: string;
  postId: string;
  version: number;
  content: string;
  attributes: Record<string, unknown>;
  createdAt: number;
  createdBy: "user" | "mcp:claude-code" | "migration" | "agent:writer";
  message: string | null;
  // sync metadata, local-only. Set when the snapshot was taken while the server
  // was unreachable (or before its post had a real id); cleared once pushed.
  dirty?: boolean;
}
