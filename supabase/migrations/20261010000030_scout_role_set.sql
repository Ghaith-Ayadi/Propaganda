-- The Scout's worker connects as postgres and switches to propaganda_scout
-- (20261008000020_scout.sql) to write its own tables. Since Postgres 16 the
-- role's creator holds it without SET, so the switch fails with
-- "permission denied to set role" and every Scout run stops at its first step.
-- The same grant runs on the dev box since 2026-10-10 09:12Z (Scout run ee4cb91c).
grant propaganda_scout to postgres with set true;
