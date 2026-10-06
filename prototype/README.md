# 0.2 UI prototype (throwaway)

Clickable prototype of the Propaganda 0.2 screens, built to judge the flow
before the knowledge base, the Guardian and the data model get designed.

- **No backend, no wiring.** Every number and sentence comes from
  `src/data.ts`; `src/store.tsx` holds the clicks in memory and recomputes the
  grades. A reload starts over.
- **Isolated.** This folder has its own `package.json` and its own copy of the
  app's theme (`src/styles/theme.css`). It imports nothing from `../app` and
  nothing in the app imports it. Delete the folder and nothing breaks.
- The company on screen (Ledgerline) is invented.

## Run it

```sh
cd prototype
npm install
npm run dev      # http://localhost:5173
npm run build    # one self-contained dist/index.html
```

## Screens

| Route | What it shows |
| --- | --- |
| `#onboarding` | Sign in, name the site, connect content, pick topics and the quarter's goal, drop documents, watch the first sweep |
| `#home` | The two consistency grades with their notes, coverage against goal and per topic, performance as an FYI, vanity counts |
| `#inbox` | Flags on typed objects (quote in context, contrasted with the knowledge base or other content, the fix shown), pitches as full briefs in a panel, knowledge base debt, drafts waiting on a person |
| `#pipeline` | Board (pitched, writing, in review, scheduled) beside a one-week calendar; pitches open as a full brief to approve, annotate or reject with a reason |
| `#review-<id>` | A draft in review: source check, the pitch notes, Remember for sentences about us |
| `#goals`, `#site`, `#chat`, `#connections` | Cadence, mix and the grades; the hosting pitch; a stub chat; sources, AI over MCP and outside publishing |
| `#blog` | Blog collections and their posts; the one content type that works |
| `#post-<id>` | The editor: title, body with flagged sentences, side panel for flags, brief and linked claims |
| `#social`, `#email`, `#sales` | Top-level pages only: channels, threads, and a placeholder |
| `#kb` | Contested claims, contradictions, every claim with its sources |
| `#settings` | Workspace, inputs, rules (knowledge base, goals, agents, voice), notifications, plan |

## What to click

- **Inbox → Flags.** Each flag has one of the four exits. "It isn't
  inconsistent" opens the Guardian, and each flag is rigged to return a
  different verdict: *Integration count* is admitted, *How fast is the close?*
  comes back contested, *SOC 2* is rejected, *Are we an ERP?* is escalated.
  Watch the grades in the left rail move as you close things.
- **Inbox → Review → Approve and publish** moves coverage and the topic range
  on Home.
- The left rail has a dark-mode switch, a link back to onboarding, and a reset.
