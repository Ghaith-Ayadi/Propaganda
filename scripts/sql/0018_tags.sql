-- Add tags to posts.
-- Replaces the old single free-text `category` with a tenant-wide, multi-value
-- tag set. Stored as a text array; a post can carry any number of tags.
-- NULL  = never set (the app falls back to reading the legacy `category`).
-- '{}'  = explicitly cleared (no tags).
--
-- Purely additive: no existing row is touched, so updated_at does not change and
-- no client re-pull / draft-clobber can be triggered. The legacy `category`
-- column is intentionally left in place (read as a fallback, never dropped) so
-- nothing is lost for posts that had a category before tags existed.

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT NULL;
