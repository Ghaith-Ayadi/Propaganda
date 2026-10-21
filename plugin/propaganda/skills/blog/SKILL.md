---
name: blog
description: Put a post on the person's Propaganda blog. Use when they say "blog about this", "write about this", "put this on the blog", "blog <tenant name>" or hand you material for a post; offer it once when a conversation has produced something worth publishing.
---

# Blog about this

Propaganda is the person's blog and its agents. This skill sends material there; the Writer drafts the post from it, in the tenant's voice, and a reviewer sees it before anything is published. Nothing you send goes live on its own.

## When to act

- **Explicit.** "Blog about this", "write about this", "put this on the blog", "blog it", "blog <tenant name>", "post this to <collection>": do it, no questions beyond the one below.
- **Implicit.** The conversation has produced a finding, a method, a result or an argument that reads like a post, and nobody asked for one: offer once, in one line ("Want this on the blog, in Research?"). Yes means act; no means drop it for the rest of the conversation.
- Never for private material, a draft the person is still deciding on, or anything they said stays internal.

## How

1. Call `list_collections` (MCP) the first time in a conversation. Pick the collection whose description and rules fit; when none plainly does, use the one the person named or ask once with the names on short lines.
2. Prepare the material as one Markdown document: the post as it would be written if you can (the tenant's voice, from the collection's rules; the person's facts and words, their argument in their order), else the notes, transcript or findings as they are. A title. Images and PDFs the post needs go as assets: a public URL, or the file's bytes base64 with its kind (`image` or `pdf`).
3. Call `assign_post` with `title`, `collection`, `markdown` and `assets`.
4. Tell the person in one line where it went: the collection, and the link the tool returned. Then stop; the Writer and the reviewer take it from there.

## Without the MCP server

The same door is plain HTTP, with the same token:

```
curl -X POST https://app.propaganda.pub/worker/v1/assign \
  -H "Authorization: Bearer $PROPAGANDA_TOKEN" -H "Content-Type: application/json" \
  -d '{"title": "...", "collection": "Research", "markdown": "...", "assets": []}'
```

`GET /worker/v1/me` says which blog the token is for.

## Setup

The token comes from the app: Settings, Connections, Claude, "Make a token". It is shown once. The plugin reads it as `PROPAGANDA_TOKEN`.
