// Marks for the connectors list, in one file. Brand marks come from simple-icons
// and Untitled UI's own set (Framer). Slack, OpenAI and Granola are not in
// simple-icons (brands asked for removal or never listed), so those keep a plain
// tile until their official artwork is added here.

import type { ReactNode } from "react";
import { Framer, Globe02, Link01, Mail01 } from "@untitledui/icons";
import { siClaude, siCursor, siGhost, siWebflow, siWordpress, siSquarespace, type SimpleIcon } from "simple-icons";
import { cx } from "@/utils/cx";

export type LogoId =
  | "granola" | "transcript-url" | "slack" | "websites" | "newsletter"
  | "claude" | "chatgpt" | "cursor"
  | "framer" | "webflow" | "wordpress" | "ghost" | "squarespace";

const svg = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" className="size-[60%]" fill="none" aria-hidden="true">{children}</svg>
);

const brand = (i: SimpleIcon) => svg(<path d={i.path} fill="currentColor" />);

const TILES: Record<LogoId, { bg: string; fg: string; glyph: ReactNode }> = {
  granola: { bg: "#3E8E5A", fg: "#fff", glyph: svg(<path d="M17 8.5A6 6 0 1 0 17 15.5M12 12h5v3" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />) },
  "transcript-url": { bg: "var(--color-bg-secondary, #f4f4f5)", fg: "#52525b", glyph: <Link01 className="size-[55%]" /> },
  slack: { bg: "#4A154B", fg: "#fff", glyph: svg(<path d="M9 4 7.5 20M16.5 4 15 20M4 9h16M3.5 15.5h16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />) },
  websites: { bg: "var(--color-bg-secondary, #f4f4f5)", fg: "#52525b", glyph: <Globe02 className="size-[55%]" /> },
  newsletter: { bg: "var(--color-bg-secondary, #f4f4f5)", fg: "#52525b", glyph: <Mail01 className="size-[55%]" /> },
  claude: { bg: "#D97757", fg: "#fff", glyph: brand(siClaude) },
  chatgpt: { bg: "#10A37F", fg: "#fff", glyph: svg(<path d="M12 3.5 19 7.5v9l-7 4-7-4v-9l7-4Zm0 0v17M5 7.5l14 9M19 7.5l-14 9" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />) },
  cursor: { bg: "#18181B", fg: "#fff", glyph: brand(siCursor) },
  framer: { bg: "#0A0A0A", fg: "#fff", glyph: <Framer className="size-[55%]" /> },
  webflow: { bg: "#146EF5", fg: "#fff", glyph: brand(siWebflow) },
  wordpress: { bg: "#21759B", fg: "#fff", glyph: brand(siWordpress) },
  ghost: { bg: "#15171A", fg: "#fff", glyph: brand(siGhost) },
  squarespace: { bg: "#111", fg: "#fff", glyph: brand(siSquarespace) },
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
