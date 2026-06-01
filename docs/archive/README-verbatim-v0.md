# Verbatim

> A writing tool for people who actually like writing.

**Try it:** [verbatim-rho.vercel.app](https://verbatim-rho.vercel.app)

![Verbatim](docs/screenshots/home-empty.png)

---

Verbatim is a calm, keyboard-first place to write. You open it, you write, you publish. Nothing pings, no algorithm, no Bezier curves, no plugin marketplace. Your posts live in collections that *you* name and own. The whole thing works offline and syncs in the background.

## Why you might want this

- **Writing should feel instant.** Every keystroke is local. The cloud catches up later. You can disconnect mid-flight on a plane and keep going.
- **Your work is yours.** Plain Markdown in your own Supabase. No vendor lock-in, no export-as-PDF dance. If Verbatim vanishes tomorrow, your posts are still right there in the database.
- **One screen, one focus.** Press `⌘\` for author mode — the sidebar and panels disappear and you're alone with the text.
- **Versions you'll actually use.** Every publish (and every manual `⌘⇧S`) snapshots the post. Open the side-by-side diff to see what you changed, revert with a click.
- **Search that's instant.** 200 posts indexed in under 10 ms. `⌘K`, type three letters, hit Enter.
- **Collections that mean something.** Each collection gets an emoji, a name, a description, and a stable id scheme — `HKM·01`, `HKM·02`. Like a series of notebooks.
- **Light or dark, your call.** `⌘⇧L` to flip.

## How it stacks up

|  | Verbatim | Medium | Ghost | Notion | WordPress |
| --- | :---: | :---: | :---: | :---: | :---: |
| You own the database | ✅ | ❌ | ✅ | ❌ | ✅ |
| Works offline | ✅ | ❌ | ❌ | partial | ❌ |
| Keyboard-first (palette, shortcuts) | ✅ | ❌ | partial | partial | ❌ |
| Plain Markdown source | ✅ | ❌ | partial | ❌ | partial |
| Built-in version diff + revert | ✅ | ❌ | ❌ | partial | partial |
| No themes, plugins, or upsells | ✅ | n/a | ❌ | n/a | ❌ |
| Free at this scale | ✅ | ✅ | ❌ | ✅ | depends |
| Designed for blogging (not docs) | ✅ | ✅ | ✅ | ❌ | ✅ |

The short version:
- **vs Medium / Substack:** you keep the audience, the data, and the URL. No platform fees, no recommendation feed deciding what your readers see next.
- **vs Ghost:** same content ownership, but Ghost wants a server you maintain. Verbatim runs out of your browser + a free Supabase tier.
- **vs Notion as a blog:** Notion is wonderful for notes, awkward as a publishing surface. Verbatim is built for the read-by-strangers case from day one.
- **vs WordPress:** no theme to choose, no plugin to forget to update, no 30 admin tabs. One screen. You write.

## How to use it

### The basics

1. **Open the app** ([live URL](https://verbatim-rho.vercel.app)). It loads instantly the second time — service worker caches the shell.
2. **Make a collection.** Top-left → click a collection in the sidebar. Type a name, add an emoji, write a one-line description. Tip: a collection like `📓 hokum` is a vibe; `📰 weekly digest` is a series.
3. **Press `⌘K`, then `↵`.** A new draft appears. Start typing. The first line is the title.
4. **Write Markdown shortcuts** as you go — `##` for a heading, `- ` for a bullet, `>` for a quote, `**bold**`, `_italic_`, `\`code\``. Or use the slash menu (`/`) for blocks.
5. **Insert images** by pasting or dragging — they upload to your Supabase Storage and the URL gets inlined.
6. **Link to other posts** with `[[`. Start typing a title, pick from the menu.
7. **Publish** when you're ready: open the right panel (`⌘\` if hidden), set status to `Published`. A version snapshot fires automatically.

### Navigating

- `⌘K` opens the palette. Just type to search posts; press `/` to switch to commands.
- Inside a post, the small `↑` `↓` buttons jump to the previous / next post in the same collection.
- The back arrow takes you to the collection home.
- Click the Verbatim wordmark to go to the very top.
- `?` in the bottom-right opens the full keyboard cheat sheet.

### Keyboard reference

| | |
| --- | --- |
| `⌘K` | Command palette |
| `⌘⇧N` | New post in current collection |
| `⌘⇧S` | Snapshot a version |
| `⌘⇧L` | Toggle light / dark |
| `⌘\` | Toggle author mode |
| `[[` | Wikilink autocomplete |
| `↑` `↓` (post header) | Prev / next post |
| `Esc` | Close palette or dialog |

## What's under the hood

If you care: it's a Vite + React 19 app with [BlockNote](https://www.blocknotejs.org) for the editor, [Dexie](https://dexie.org) for IndexedDB, and Supabase for cloud sync + storage. Posts round-trip as Markdown. There are no servers to run; the whole app is static.

If you don't care: it's a webpage. It works in any modern browser. You can install it as a PWA from the address bar.

## Roadmap

- **MCP server** so Claude Code (and other agents) can read, write, and publish on your behalf.
- **Public reader site** — the front-facing blog that renders these posts. Currently still on the old Payload setup.
- A few smaller polish items (post table with status filters, drag-to-reorder collections, comment imports).

## Living with it

Verbatim is meant to disappear. The best compliment it can earn is "I haven't thought about my writing tool in months." If something gets in your way — file an issue or open the editor and fix it. It's a one-screen app; the codebase is small.

---

© Ghaith Ayadi. Personal IP.
