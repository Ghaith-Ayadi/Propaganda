# Schema rehearsal

`rehearse.sh` replays the migrations since multi-tenancy on a throwaway PocketBase
0.40.4 (the version on the box) and checks that it is safe:

1. builds the pre-migration schema and seeds users, posts (one 1.2 MB body),
   versions, collections, settings, briefs and writing activity;
2. snapshots every row (a hash of all fields, including `updated`);
3. applies the current `pb/` and snapshots again: **every row must be
   byte-identical** apart from the new `site` field;
4. runs `rules.mjs`: members vs strangers vs anonymous, old-build clients that
   don't send `site`, cross-site writes, slugs, memberships, activity.
5. runs `addresses.mjs` (1758000007): numbers kept from `legacy_id` and handed
   out after it, never reused, per site, safe under concurrent creates;
   collection slugs (clashes, reserved words, renames, old-app renames); post
   slugs deduped per collection; redirects written, readable, deletable only
   by members, and cleaned up.

Both suites exit non-zero on a failed check, and `snapshot.mjs` ignores only
the fields a migration adds on purpose (`posts.number`, `collections.slug`).

```
PB_BIN=~/bin/pocketbase pb/rehearsal/rehearse.sh
```

It only ever talks to 127.0.0.1:8091 with its own data directory. Run it
before deploying any change to `pb/`.
