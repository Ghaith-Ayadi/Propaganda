// Domain types.
// Mirror the Supabase schema but use camelCase + ms timestamps locally.

export type PostStatus = "draft" | "done" | "published";

export interface Post {
  id: number;
  title: string;
  slug: string;                 // URL slug (editable, auto-generated from title while draft)
  postId: string | null;        // system-managed identifier: {PREFIX}·{SEQ}, changes with collection
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
}

export interface Collection {
  name: string;
  emoji: string | null;
  description: string | null;
  position: number;
  isHidden: boolean;            // hidden from public nav; articles 404 to a "private collection" page
  createdAt: number;
  updatedAt: number;
  syncedAt?: number | null;
  dirty?: boolean;
}

export interface PostVersion {
  id: string;
  postId: number;
  version: number;
  content: string;
  attributes: Record<string, unknown>;
  createdAt: number;
  createdBy: "user" | "mcp:claude-code" | "migration";
  message: string | null;
  // sync metadata, local-only. Set when the snapshot was taken while the server
  // was unreachable (or before its post had a real id); cleared once pushed.
  dirty?: boolean;
}
