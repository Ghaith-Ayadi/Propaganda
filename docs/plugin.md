# The Claude plugin

How a post gets on a Propaganda blog from wherever someone is working in Claude
(Ayadi, 2026-10-19). "Blog about this", "write about this", "put this on the
blog", "blog <tenant>" hand the material to the tenant; the Writer drafts it in
the tenant's voice; a reviewer sees it before anything is published. The plugin
detects the intent: an explicit ask is acted on, an implicit one (a conversation
that produced something worth a post) is offered once.

## Parts

- **The plugin**: `plugin/propaganda` (`.claude-plugin/plugin.json`, `.mcp.json`,
  `skills/blog/SKILL.md`). The repo root's `.claude-plugin/marketplace.json`
  makes this repository the marketplace: in Claude, add `Ghaith-Ayadi/Propaganda`
  and install `propaganda`. The skill carries the rules: when to act, when to
  offer, how to prepare the material (one Markdown document, already in the
  tenant's voice when it can be, plus images and PDFs as assets), the plain-HTTP
  fallback. More tools and skills go in the same folder.
- **The MCP server**: on the worker, `POST /worker/v1/mcp`
  ([worker/README.md](../worker/README.md), "The MCP server and assigned
  posts"). Tools today: `list_collections` (names, public descriptions and the
  tenant's rules for the agents) and `assign_post` (title, collection, markdown,
  assets). `POST /worker/v1/assign` is the same door without MCP.
- **The token**: a member makes one in Settings > Connections > Claude; it is
  shown once and the plugin reads it as `PROPAGANDA_TOKEN`. It acts as that
  member on that site. Revoking it there stops it at once
  (`supabase/migrations/20261010000160_api_tokens.sql`).
- **The post**: a regular post. Its brief has `origin = 'assigned'`, the material
  as its body and the attachments as its sources (with a `kind`). The Writer
  treats the body as source material: the tenant's own facts, usable as they
  are; a finished draft is edited into the house voice rather than rewritten
  (`worker/src/agents/writer-prompt.ts`). Images are placed in the post; PDFs
  are listed as attachments the Writer can't open yet. The reviewer sees the
  material under the draft's Brief tab, with the attachments as links.

## On the box and on Vercel

The worker stores an assigned post's images through the app's `/api/upload`
with `WORKER_DISPATCH_SECRET`, the secret it already shares with Chat's
hand-off: Vercel's copy must equal the box's, or plugin images fail with 401
and the post carries no image. A token may assign 20 posts an hour
(`ASSIGNS_PER_HOUR`, in the worker's memory); the global daily cap is the
brake after that.

## The other doors

The same hand-off, from inside the app:

- **Assign posts** on the Pipeline page: a list of posts, one paragraph each
  (title, then what it covers), straight to the Writer in a collection.
- **The + on the Writing column**: a title and everything the person has pasted
  under it; "Writer drafts it" hands it over, Enter keeps it for the person.

Chat's "blog about this" is not wired yet (parked, Ayadi 2026-10-19).

## Not yet

Reading PDFs (today they are listed, not read); tokens with narrower scopes in
the UI (every token has `read` and `assign`); more tools (search the knowledge
base, read a post's state).
