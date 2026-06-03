// Keyboard-shortcut reference, rendered inline inside the command palette
// (open it with the "/keyboard shortcuts" command). Previously a floating "?"
// FAB; now it lives where the rest of the commands do.

import type { ReactNode } from "react";

interface Shortcut {
  keys: string[];
  label: string;
}

export const SHORTCUT_SECTIONS: { heading: string; items: Shortcut[] }[] = [
  {
    heading: "Global",
    items: [
      { keys: ["⌘", "K"], label: "Command palette" },
      { keys: ["⌘", "⇧", "N"], label: "New post in current collection" },
      { keys: ["⌘", "⇧", "S"], label: "Snapshot a version" },
      { keys: ["⌘", "⇧", "P"], label: "Publish current post" },
      { keys: ["⌘", "\\"], label: "Toggle author mode" },
      { keys: ["⌘", "⇧", "L"], label: "Toggle light / dark theme" },
      { keys: ["esc"], label: "Close palette / dialog" },
    ],
  },
  {
    heading: "Palette",
    items: [
      { keys: ["/"], label: "Switch to commands" },
      { keys: ["↑", "↓"], label: "Navigate" },
      { keys: ["↵"], label: "Select" },
    ],
  },
  {
    heading: "Editor",
    items: [
      { keys: ["[["], label: "Wikilink autocomplete" },
      { keys: ["↑", "↓"], label: "Prev / next post (header buttons)" },
      { keys: ["⌘", "B"], label: "Bold" },
      { keys: ["⌘", "I"], label: "Italic" },
      { keys: ["#"], label: "Heading (line start)" },
      { keys: ["- "], label: "Bullet list (line start)" },
      { keys: [">"], label: "Quote (line start)" },
    ],
  },
];

export function ShortcutsPanel() {
  return (
    <div className="text-sm">
      {SHORTCUT_SECTIONS.map((s) => (
        <section key={s.heading} className="mb-5 last:mb-0">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-quaternary">
            {s.heading}
          </h3>
          <ul className="space-y-1.5">
            {s.items.map((it, i) => (
              <li key={i} className="flex items-center justify-between gap-4 text-secondary">
                <span>{it.label}</span>
                <span className="flex shrink-0 items-center gap-1">
                  {it.keys.map((k, j) => (
                    <Kbd key={j}>{k}</Kbd>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-secondary bg-primary px-1.5 font-mono text-[11px] font-medium text-secondary">
      {children}
    </kbd>
  );
}
