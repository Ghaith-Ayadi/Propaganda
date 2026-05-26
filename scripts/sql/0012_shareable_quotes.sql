-- Add shareable_quotes to posts.
-- Stores the 3 LLM-extracted verbatim pull-quotes as a text array.
-- NULL  = not yet extracted (or cleared for re-run on edit).
-- '{}'  = extraction ran but every quote failed verbatim validation.

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS shareable_quotes TEXT[] DEFAULT NULL;
