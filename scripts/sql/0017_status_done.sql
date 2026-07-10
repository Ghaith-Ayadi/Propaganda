-- Add the missing "done" value to the post status enum.
--
-- The app has supported a three-state status (draft → done → published) since
-- the v6 doneAt feature, but enum_posts_status only ever had 'draft' and
-- 'published' (it predates this migrations folder — inherited from the original
-- Payload schema). Marking a post "Done" wrote status='done' into local Dexie,
-- and the next sync push (a single batch upsert of all pending posts) was
-- rejected by Postgres with `invalid input value for enum … "done"`. Because
-- the whole batch fails together, ONE done post silently blocked all syncing —
-- so newly-published posts never reached Supabase and the public site showed
-- nothing new.
--
-- ADD VALUE is safe inside Supabase's Postgres (15+) as long as the new label
-- isn't referenced in the same statement; this file only adds it.

alter type public.enum_posts_status add value if not exists 'done' before 'published';
