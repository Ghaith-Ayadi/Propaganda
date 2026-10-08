// Marks for the connectors list. One file, so real brand artwork can replace
// these simplified tiles without touching the pages. A tile is the service's
// colour with a simple glyph; services without a mark of their own use a kit icon.

import type { ReactNode } from "react";
import { Globe02, Link01, Mail01, Server01 } from "@untitledui/icons";
import { cx } from "@/utils/cx";

export type LogoId =
  | "granola" | "transcript-url" | "slack" | "websites" | "newsletter"
  | "claude" | "chatgpt" | "cursor"
  | "framer" | "webflow" | "wordpress" | "ghost" | "squarespace";

const svg = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" className="size-[60%]" fill="none" aria-hidden="true">{children}</svg>
);

const TILES: Record<LogoId, { bg: string; fg: string; glyph: ReactNode }> = {
  granola: { bg: "#3E8E5A", fg: "#fff", glyph: svg(<path d="M17 8.5A6 6 0 1 0 17 15.5M12 12h5v3" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />) },
  "transcript-url": { bg: "var(--color-bg-secondary, #f4f4f5)", fg: "#52525b", glyph: <Link01 className="size-[55%]" /> },
  slack: { bg: "#4A154B", fg: "#fff", glyph: svg(<path d="M9 4 7.5 20M16.5 4 15 20M4 9h16M3.5 15.5h16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />) },
  websites: { bg: "var(--color-bg-secondary, #f4f4f5)", fg: "#52525b", glyph: <Globe02 className="size-[55%]" /> },
  newsletter: { bg: "var(--color-bg-secondary, #f4f4f5)", fg: "#52525b", glyph: <Mail01 className="size-[55%]" /> },
  claude: { bg: "#D97757", fg: "#fff", glyph: svg(<path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />) },
  chatgpt: { bg: "#10A37F", fg: "#fff", glyph: svg(<path d="M12 3.5 19 7.5v9l-7 4-7-4v-9l7-4Zm0 0v17M5 7.5l14 9M19 7.5l-14 9" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />) },
  cursor: { bg: "#18181B", fg: "#fff", glyph: svg(<path d="M5 3.5 19 11l-6 1.5L10.5 19 5 3.5Z" fill="currentColor" />) },
  framer: { bg: "#0A0A0A", fg: "#fff", glyph: svg(<path d="M6 3h12v6h-6l6 6H6V3Zm0 12h6v6l-6-6Z" fill="currentColor" />) },
  webflow: { bg: "#146EF5", fg: "#fff", glyph: svg(<path d="m3 8 3.5 9 3-6 3 6L16 8l1 5 4-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />) },
  wordpress: { bg: "#21759B", fg: "#fff", glyph: svg(<path d="m4 8 4 10 3-8 3 8 4-10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />) },
  ghost: { bg: "#15171A", fg: "#fff", glyph: svg(<path d="M6 20v-8a6 6 0 0 1 12 0v8l-3-2-3 2-3-2-3 2Z" fill="currentColor" />) },
  squarespace: { bg: "#111", fg: "#fff", glyph: svg(<path d="M8 16l8-8M10.5 18.5l8-8M5.5 13.5l8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />) },
};

export function Logo({ id, size = "md" }: { id: LogoId; size?: "md" | "lg" }) {
  const t = TILES[id];
  return (
    <span
      aria-hidden="true"
      style={{ background: t.bg, color: t.fg }}
      className={cx(
        "flex shrink-0 items-center justify-center rounded-lg ring-1 ring-black/5",
        size === "md" ? "size-9" : "size-12 rounded-xl",
      )}
    >
      {t.glyph}
    </span>
  );
}

export { Server01 };
