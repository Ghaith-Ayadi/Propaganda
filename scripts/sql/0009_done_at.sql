-- "Done" status: the date writing was finished, independent of publish date.
-- Set the first time a post transitions to "done" or is published directly
-- from "draft" without passing through "done".

alter table public.posts add column if not exists done_at timestamptz;
