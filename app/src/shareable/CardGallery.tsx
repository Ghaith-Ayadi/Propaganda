import { StoryCard, TEMPLATE_NAMES } from "./StoryCard";
import type { CardData, TemplateId } from "./StoryCard";

// ── Test data ───────────────────────────────────────────────────────────────
// Article: "On imitation" — 3 quotes extracted + validated by Gemini.

const META = {
  title: "On imitation",
  author: "Ghaith Ayadi",
  date: "May 25, 2026",
  slug: "on-imitation",
};

const QUOTES: CardData[] = [
  { ...META, quote: "It's littirally: Monkey business." },
  {
    ...META,
    quote:
      "But the current human beings, espetially of the gen Z persuasion, have collectively decided that they are gonna do everything possible to follow trends, actively, loudly, and shamelessly.",
  },
  {
    ...META,
    quote:
      "How the fuck does one wake up in the morning and say: “G, mate… I wonder what the others are doing so I can do exactly the same thing”.",
  },
];

const TEMPLATES = Object.keys(TEMPLATE_NAMES).map(Number) as TemplateId[];

// ── Gallery ─────────────────────────────────────────────────────────────────

export function CardGallery() {
  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.pageHeader}>
        <h1 style={styles.pageTitle}>Story Card Gallery</h1>
        <p style={styles.pageSub}>10 templates · 3 quotes · Verbatim</p>
      </div>

      {/* Template rows */}
      {TEMPLATES.map((tid) => {
        const { name, vibe } = TEMPLATE_NAMES[tid];
        return (
          <section key={tid} style={styles.section}>
            {/* Template label */}
            <div style={styles.label}>
              <span style={styles.labelNum}>
                {String(tid).padStart(2, "0")}
              </span>
              <span style={styles.labelName}>{name}</span>
              <span style={styles.labelVibe}>{vibe}</span>
            </div>

            {/* 3 cards */}
            <div style={styles.row}>
              {QUOTES.map((data, qi) => (
                <StoryCard key={qi} template={tid} data={data} />
              ))}
            </div>
          </section>
        );
      })}

      <div style={styles.footer}>
        <span style={styles.footerText}>verbatim · shareable assets</span>
      </div>
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  page: {
    background: "#111111",
    minHeight: "100vh",
    padding: "64px 48px 96px",
    boxSizing: "border-box",
    fontFamily: '"Geist", sans-serif',
    WebkitFontSmoothing: "antialiased",
  },
  pageHeader: {
    marginBottom: "72px",
    borderBottom: "1px solid #222",
    paddingBottom: "28px",
  },
  pageTitle: {
    fontFamily: '"Roslindale Display", "Georgia", serif',
    fontWeight: 300,
    fontSize: "36px",
    color: "#ffffff",
    margin: "0 0 8px",
    letterSpacing: "-0.01em",
  },
  pageSub: {
    fontFamily: '"Geist Mono", monospace',
    fontSize: "11px",
    color: "#444",
    margin: 0,
    letterSpacing: "0.04em",
  },
  section: {
    marginBottom: "60px",
  },
  label: {
    display: "flex",
    alignItems: "baseline",
    gap: "14px",
    marginBottom: "18px",
  },
  labelNum: {
    fontFamily: '"Geist Mono", monospace',
    fontSize: "11px",
    color: "#333",
    letterSpacing: "0.08em",
  },
  labelName: {
    fontFamily: '"Geist", sans-serif',
    fontSize: "13px",
    fontWeight: 500,
    color: "#ffffff",
    letterSpacing: "0.01em",
  },
  labelVibe: {
    fontFamily: '"Geist", sans-serif',
    fontSize: "11px",
    color: "#444",
    letterSpacing: "0.01em",
  },
  row: {
    display: "flex",
    gap: "18px",
    flexWrap: "nowrap",
  },
  footer: {
    marginTop: "80px",
    borderTop: "1px solid #1a1a1a",
    paddingTop: "24px",
  },
  footerText: {
    fontFamily: '"Geist Mono", monospace',
    fontSize: "10px",
    color: "#2a2a2a",
    letterSpacing: "0.1em",
    textTransform: "uppercase",
  },
};
