# Search Console

The Strategist reads how a tenant's own blog does in Google (`worker/src/agents/gsc.ts`).

- **Hosted blogs.** One service account owns one Domain property, `sc-domain:propaganda.pub`
  (`GSC_PROPERTY` to change it). A tenant's data is that property filtered to pages under its host
  (`<slug>.propaganda.pub`), so no tenant signs in to anything. The key is
  `GSC_SERVICE_ACCOUNT_JSON` (the JSON key, base64) in the worker's environment; without it
  nothing here runs and plans use DataForSEO alone.
- **Custom domains** are another property and need their owner's own Google grant (OAuth, the
  `webmasters.readonly` scope, which Google reviews before accounts beyond test users can connect).
  Until that exists they read as nothing.
- **What the Strategist gets**, as its own step (`search console`, behind
  `DBOS.patch("strategist-search-console")`): the last 90 days of queries (ending three days back,
  the API's lag) with clicks, impressions and average position. They become the tenant's own
  rankings (`ours`), ahead of DataForSEO's estimates, plus two lists in the prompt: searches just
  off page one (position 11 to 30) and searches seen often but barely ranked (past 30). A row seen
  fewer than 10 times counts for neither. A failed read is logged and the plan goes on without it.
- **Cost.** The API is free, so nothing is written to `model_calls`.
- **Not yet.** A weekly snapshot table (trends need one; it is a migration), the weekly Pitcher
  reading the same data, and custom-domain OAuth.
